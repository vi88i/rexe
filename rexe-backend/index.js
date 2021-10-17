/* eslint-disable no-undef */
'use strict';

/* get environment */
const environment = process.env.NODE_ENV || 'development';

/* require all modules here */
require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const express = require('express');
const db = require('./mysqldb/index');
const { enqueue, putJSON, delJSON, dequeue, deleteSQSMessage, getRandomId, getJSON, checkIfObjectExist } = require('./aws/index');
const { redisAuthClient, redisSubClient } = require('./redisdb/index');

process.on('SIGINT', async () => {
  console.log('Graceful shutdown');
  await db.end();
  redisSubClient.quit();
  redisAuthClient.quit();
  process.exit(0);
});

/* create express application */
const app = express();

/* 
  add JSON body parser and cookie parser 
  JSON limit applies only to incoming requests
*/
app.use(express.json({ limit: process.env.JSON_LIMIT }));
app.use(cookieParser(process.env.COOKIE_SECRET));

/* basic logging for requests */
app.use((req, _, next) => {
  if (environment === 'development') {
    console.log(new Date().toISOString() + ' ' + req.method + ' ' + req.url);
  }
  next();
});

/* set common headers */
app.use((_, res, next) => {
  res.header('Cache-Control', 'no-store');
  next();
});

/* serve static files */
app.use(express.static(path.join('..', 'rexe-frontend', 'static')));

/* home page route */
app.get('/', (_, res) => {
  res.sendFile(path.join(__dirname, '..', 'rexe-frontend', 'index.html'));
});

/* sign-in route */
app.get('/sign-in', (_, res) => {
  res.redirect(301, 'sign-in.html');
});

/* sign-up route */
app.get('/sign-up', (_, res) => {
  res.redirect(301, 'sign-up.html');
}); 

/* verify sign up credentials */
app.post('/verify', async (req, res, next) => {
  const { username, password } = req.body;
  if (username && username.length > 0 && password && password.length > 0) {
    let conn = null;
    try {
      conn = await db.getConnection();
      const { rows } = await db.query(conn, 'SELECT COUNT(*) AS count FROM users WHERE username = ?', [username]);
      if (rows[0].count > 0) {
        next({ status: 400, msg: 'Username already exists!' });
        return;
      }
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      await db.query(conn, 'INSERT INTO users VALUES(?, ?)', [username, hash]);
      res.status(200).json({ msg: 'Success, redirecting you to sign in page' });
    } catch (err) {
      next(err);
    } finally {
      if (conn && conn.state === 'authenticated') {
        conn.release();
      }
    }
  } else {
    next({ status: 400, msg: 'Username and password cannot be empty' });
  }
});

/* authenticate */
app.post('/auth', async (req, res, next) => {
  const { username, password } = req.body;
  if (username && username.length > 0 && password && password.length > 0) {
    let conn = null;
    try {
      conn = await db.getConnection();
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      const { rows } = await db.query(conn, 'SELECT COUNT(*) AS count FROM users WHERE username = ? AND password_hash = ?', [username, hash]);
      if (rows[0].count === 0) {
        next({ status: 401, msg: 'Invalid username or password!' });
        return;
      }
      let token = jwt.sign({ username: username }, process.env.JWT_SECRET, {
        expiresIn: '1h',
        issuer: 'rexe',
      });
      res.cookie('token', token, {
        httpOnly: true,
        maxAge: 60 * 60 * 1000,
        secure: false,
        signed: true,
        sameSite: 'strict'
      });     
      res.cookie('username', username, {
        httpOnly: false,
        maxAge: 60 * 60 * 1000,
        secure: false,
        sameSite: 'strict'
      }); 
      res.status(200).json({ msg: 'Success, redirecting you to code editor' });
    } catch (err) {
      next(err);
    } finally {
      if (conn && conn.state === 'authenticated') {
        conn.release();
      }
    }
  } else {
    next({ status: 400, msg: 'Username and password cannot be empty' });
  }
});

/* check if user is logged in */
app.get('/isLoggedIn', (req, res) => {
  if (req.signedCookies) {
    let token = req.signedCookies.token;
    jwt.verify(token, process.env.JWT_SECRET, (err) => {
      if (err) {
        res.status(401).json({ msg: 'Unauthorized' });
      } else {
        res.status(200).json({ msg: 'ok' });
      }
    });    
  } else {
    res.status(401).json({ msg: 'Unauthorized' });
  }
});

/* authorization middleware */
const requireAuthorization = async (req, res, next) => {
  if (req.signedCookies && req.signedCookies.token) {
    try {
      let token = req.signedCookies.token;
      const reply = await redisAuthClient.get(token);
      if (reply) {
        res.status(401).json({ msg: 'Unauthorized' });
      } else {
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
          if (err) {
            next({ status: 401, msg: 'Unauthorized' });
          } else {
            res.locals.username = decoded.username;
            res.locals.ttl = decoded.exp - Math.floor(Date.now() / 1000);
          }
          next();
        });
      }
    } catch(err) {
      next(err);
    }    
  } else {
    next({ status: 401, msg: 'Unauthorized' });
  }
};

/* sign out the user and blacklist the token */
app.get('/sign-out', requireAuthorization, async (req, res, next) => {
  try {
    if (req.signedCookies && req.signedCookies.token) {
      if (res.locals.ttl > 0) {
        await redisAuthClient.sendCommand(['SET', req.signedCookies.token, '1', 'EX', res.locals.ttl]);
      }
      res.clearCookie('username');
      res.clearCookie('token');
      res.status(200).json({ msg: 'ok' });
    } else {
      res.status(401).json({ msg: 'Unauthorized' });
    }
  } catch(err) {
    next(err);
  }
});

/* 
  Processing of code submission
  1. Check if filename and code is not empty
  2. Check if previous submission for same request is still being processed (by querying for submission key in redis), 
     if the previous submission is still being processed return 429, else continue.
  3. Check if time and memory constraints are valid, else return 400
  4. Find the md5 digest of the file (this is the token while short polling)
  5. If (username, submission key, digest) is present in the MySQL database, don't enqueue the request
     (result is available in S3, during short polling the user is provided with the result)
  6. Otherwise,
     6.1 Put the code and config in S3 bucket
     6.2 Queue the submission key (it will help consumer identify which object should be grabbed from S3 for processing)
     6.3 
        - SET <submission key (key), '1'> in redis with TTL value which eqauls retention period of FIFO queue, 
        While this <submission key (key), '1'> is present in redis it implies the request is still being processed,
        this mapping is removed only when result is ready. (this is used to prevent duplicate submissions)
        - Set md5 digest as cookie. When user uses short polling (user sends filename, language and cookie), 
        the submission key and cookie is used to query the database to check if result is available.
  7. Respond to client with suitable message   

  NOTES:
  - submission key = (username, filename, lang)
  - the request and result are stored separately (key for request in S3: ('request', username, filename, lang), and ('result', username, filename, lang) 
    for result). Reason: If in the future we want to store all versions of user submissions. 
*/
app.post('/run', requireAuthorization, async (req, res, next) => {
  let conn = null;
  try {
    const { code, input, filename, lang, time_limit, memory_limit } = req.body;
    const username = res.locals.username;
  
    console.log('[x] Checking filename and code length');
    if (filename && filename.length > 0 && code && code.length > 0) {
      console.log('[x] Checking programming language');
      if (lang && ['cpp', 'py'].indexOf(lang) === -1) {
        next({ status: 400, msg: 'Invalid language code' });
        return;
      }
    
      const timestamp = Date.now().toString();
      const submissionKey = username + '-' + filename + '-' + lang;
      const status = await redisSubClient.get(submissionKey);

      console.log('[x] Checking if submission is still being processed');
      if (status) {
        next({ status: 429, msg: 'Your previous submission is still being processed' });
        return;
      }

      let mb = Math.floor(Number(memory_limit)); 
      let sec = Math.floor(Number(time_limit));
  
      console.log('[x] Checking time and memory limit');
      if (Number.isNaN(mb) || Number.isNaN(sec) || mb < 32 || mb > 512 || sec < 2 || sec > 7) {
        next({ status: 400, msg: 'Invalid memory or time limit' });
        return;
      }

      const hash = crypto.createHash('md5');
      hash.update(code);
      hash.update(input);
      hash.update(lang);
      hash.update(mb.toString());
      hash.update(sec.toString());
      const digest = hash.digest('hex');

      conn = await db.getConnection();
      console.log('[x] Checking if same submission exists in database');
      const { rows } = await db.query(
        conn, 
        'SELECT COUNT(username) AS count FROM submissions WHERE username=? AND fname=? AND lang=? AND file_hash=?', 
        [username, filename, lang, digest]
      );

      if (rows[0].count == 0) {
        console.log('[x] Preparing packet for submission');
        const packet = {
          ...req.body,
          memory_limit: mb,
          time_limit: sec
        };
        console.log('[x] Dumping the request on S3 bucket');
        await putJSON('request-' + submissionKey, packet, process.env.S3_BUCKET);
        console.log('[x] Queueing the submission request');
        await enqueue(
          // if user submits within 5 min interval, deduplication id should be different, else the request is not queued immediately (check deuplication rules in AWS SQS for FIFO)
          submissionKey + '-' + timestamp, 
          lang === 'cpp' ? process.env.SQS_CPP_URL : process.env.SQS_PY_URL, 
          { key: submissionKey, hash: digest }
        );
        console.log('[x] Caching the submission key');
        await redisSubClient.sendCommand(['SET', submissionKey, '1', 'EX', process.env.SQS_SUBMISSON_RETENTION_PERIOD]);
      }

      res.cookie('file_hash', digest, {
        httpOnly: true,
        maxAge: process.env.SQS_SUBMISSON_RETENTION_PERIOD * 1000,
        secure: false,
        signed: true,
        sameSite: 'strict'  
      });
      res.status(200).json({ status: 'pending', msg: 'Your code is being processed' });
      console.log(`[x] Finished processing ${submissionKey} - ${digest}`);
    } else {
      res.status(400).json({ msg: 'Filename and code cannot be empty' });
    }
  } catch (err) {
    next(err);
  } finally {
    if (conn && conn.state === 'authenticated') {
      conn.release();
    }
  }
});

/*
  Check if result is available:
  - Generate the submission key and extract the hash from cookie
  - If cookie is not found, it implies the the submission has timed out (retention period is over and request is removed from queue)
  - If cookie is valid, query the MySQL database for (username, submission key, hash)
  - If the tuple is present in database, get the result from S3 and send it to user
*/
app.post('/check', requireAuthorization, async (req, res, next) => {
  let conn = null;
  if (req.signedCookies && req.signedCookies.file_hash) {
    try {
      const { filename, lang } = req.body;
      const username = res.locals.username;
      const submissionKey = username + '-' + filename + '-' + lang;
      console.log(`[x] Checking if result is available for ${submissionKey} - ${req.signedCookies.file_hash}`);
      conn = await db.getConnection();
      const { rows } = await db.query(
        conn, 
        'SELECT COUNT(username) AS count FROM submissions WHERE username=? AND fname=? AND lang=? AND file_hash=?', 
        [username, filename, lang, req.signedCookies.file_hash]
      );
      if (rows[0].count > 0) {
        console.log('[x] Fetching data from S3');
        const data = await getJSON('result-' + submissionKey, process.env.S3_BUCKET);
        res.status(200).json(data);   
      } else {
        res.status(200).json({ status: 'pending' });
      }
      console.log(`[x] Finished /check for ${submissionKey} - ${req.signedCookies.file_hash}`);
    } catch(err) {
      next(err);
    } finally {
      if (conn && conn.state === 'authenticated') {
        conn.release();
      }
    }
  } else {
    res.status(200).json({ status: 'stop' });
  }
});

/* 
  If result and request is available send both
  else if request is available send request
  else not found
*/
app.post('/load', requireAuthorization, async (req, res, next) => {
  try {
    const { filename, lang } = req.body, username = res.locals.username;
    const requestSubmissionKey = ['request', username, filename, lang].join('-');
    const resultSubmissionKey = ['result', username, filename, lang].join('-');
    let resultStatus = false, requestStatus = false;
    try {
      resultStatus = await checkIfObjectExist(resultSubmissionKey, process.env.S3_BUCKET);
    } catch(err) {
      console.log(err);
    }
    try {
      requestStatus = await checkIfObjectExist(requestSubmissionKey, process.env.S3_BUCKET);
    } catch(err) {
      console.log(err);
    }   
    if (resultStatus && requestStatus) {
      res.status(200).json({ 
        msg: 'Success', 
        request: await getJSON(requestSubmissionKey, process.env.S3_BUCKET), 
        result: await getJSON(resultSubmissionKey, process.env.S3_BUCKET) 
      });      
    } else if (requestStatus) {
      res.status(200).json({ 
        msg: 'Success', 
        request: await getJSON(requestSubmissionKey, process.env.S3_BUCKET) 
      });
    } else {
      res.status(200).json({ msg: 'Failed' });
    }
  } catch(err) {
    next(err);
  }
});

/*
  If user saves their work, delete any previous request if it exists. (currently we maintain only one (latest) version of submission)
  NOTE: The result is not stored. It is assumed that user saves only when they make changes to code and config. If code and config
  changes it most likely changes the output as well. If we don't delete the result when user saves, in later point of time
  when user loads the file, the result may not correspond to changes made by user in code and config.
*/
app.post('/save', requireAuthorization, async (req, res, next) => {
  try {
    const { filename, code, lang } = req.body, username = res.locals.username;
    if (filename && filename.length > 0 && code && code.length > 0) {
      const requestSubmissionKey = ['request', username, filename, lang].join('-');
      const resultSubmissionKey = ['result', username, filename, lang].join('-');
      await delJSON(resultSubmissionKey, process.env.S3_BUCKET);      
      await putJSON(
        requestSubmissionKey,
        req.body,
        process.env.S3_BUCKET
      );
      res.status(200).json({ msg: 'Saved' });
    } else {
      res.status(200).json({ msg: 'Filename and code cannot be empty' });
    }
  } catch(err) {
    next(err);
  }
});

/*  
  Consume from result queue (uses long polling 20s): 
  - Extract the submission key and hash from result queue
  - Insert/Update into database
  - Delete the message from queue
*/
(async function startSQSResponseConsumer() {
  const status = true;
  let retry = 0, id = getRandomId(), conn = null;
  while (status) {
    try {
      if (retry === 0) {
        console.log(`Starting new request: ${id}`);
      }
      const res = await dequeue(id, process.env.SQS_RES_URL);
      if (res) {
        res.forEach(async (e) => {
          const { key: submissionKey, hash } = JSON.parse(e.Body);
          const splits = submissionKey.split('-');
          const username = splits[0], filename = splits.slice(1, splits.length - 1).join('-'), lang = splits[splits.length - 1];
          console.log(`[x] Received response for ${submissionKey} - ${hash}`);
          try {
            conn = await db.getConnection();
            console.log(`[x] Inserting ${submissionKey} - ${hash} into database`);
            await db.query(conn, 'CALL insert_submission(?, ?, ?, ?)', [username, filename, lang, hash]);
          } catch (err) {
            next(err);
          } finally {
            if (conn && conn.state === 'authenticated') {
              conn.release();
            }
          }
          console.log(`[x] Deleting ${submissionKey} - ${hash} from response queue`);
          await deleteSQSMessage(e.ReceiptHandle, process.env.SQS_RES_URL);
          console.log(`[x] Deleting ${submissionKey} from redis cache`);
          await redisSubClient.del(submissionKey);
        });
      }
      retry = 0, id = getRandomId();
    } catch(err) {
      console.log(err);
      retry += 1;
      if (retry === 2) {
        console.log(`Failed request: ${id}`);
        retry = 0, id = getRandomId();
      } else {
        console.log(`Retrying request: ${id}`);
      }
    }
  }
})();

/* 404 responses */
app.use((_, res) => {
  res.status(404).send('Sorry can\'t find that!');
});

/* default error handler */
app.use((err, _, res, next) => {
  console.log(err);
  if (res.headersSent) {
    next(err);
  } else if (err.msg && err.status) {
    res.status(err.status).json({ msg: err.msg });
  } else {
    res.status(500).send('Something went wrong!');
  }
});

/* start listening for connections */
app.listen(process.env.PORT, process.env.HOST, process.env.BACKLOG, (err) => {
  if (err) {
    console.log(err);
    process.exit(0);
  } else {
    console.log(`Server listening on port ${process.env.PORT}`);
  }
});
