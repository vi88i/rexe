/* eslint-disable no-undef */
'use strict';

/* get environment */
const environment = process.env.NODE_ENV || 'development';

/* load the .env to access constants */
require('dotenv').config();

/* require all modules here */
const crypto = require('crypto');
const path = require('path');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const AWS = require('aws-sdk');
const redis = require('redis');
const express = require('express');
const db = require('./db/index');

/* setup AWS config and SQS */
AWS.config.loadFromPath(path.join('..', 'aws_config.json'));
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

/* setup connection to token blacklist database and user submission request database */
const redisAuthClient = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  db: process.env.REDIS_BLACKLIST_DB
});

const redisSubClient = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  db: process.env.REDIS_SUBMISSION_DB  
});

redisAuthClient.on('error', (err) => {
  console.log(err);
  process.exit(0);
});

redisSubClient.on('error', (err) => {
  console.log(err);
  process.exit(0);
});

/* create express application */
const app = express();

/* add JSON body parser and cookie parser */
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
        throw { status: 400, msg: 'Username already exists!' };
      }
      const hash = crypto.createHash('sha256').update(password).digest('hex');
      await db.query(conn, 'INSERT INTO users VALUES(?, ?)', [username, hash]);
      res.status(200).json({ msg: 'Success, redirecting you to sign in page' });
    } catch (err) {
      next(err);
    } finally {
      if (conn) {
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
        throw { status: 401, msg: 'Invalid username or password!' };
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
        sameSite: 'strict',  
      });     
      res.cookie('username', username, {
        httpOnly: false,
        maxAge: 60 * 60 * 1000,
        secure: false,
        sameSite: 'strict',
      }); 
      res.status(200).json({ msg: 'Success, redirecting you to code editor' });
    } catch (err) {
      next(err);
    } finally {
      if (conn) {
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
const requireAuthorization = (req, res, next) => {
  if (req.signedCookies && req.signedCookies.token) {
    let token = req.signedCookies.token;
    redisAuthClient.get(token, (err, reply) => {
      if (err) {
        next(err);
      } else if (reply) {
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
    });    
  } else {
    next({ status: 401, msg: 'Unauthorized' });
  }
};

/* sign out the user */
app.get('/sign-out', requireAuthorization, async (req, res) => {
  try {
    if (req.signedCookies && req.signedCookies.token) {
      if (res.locals.ttl > 0) {
        await new Promise((resolve, reject) => {
          redisAuthClient.set(req.signedCookies.token, '1', 'EX', res.locals.ttl, (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
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

/* process code submission */
app.post('/run', requireAuthorization, async (req, res, next) => {
  try {
    const { code, filename, lang, time_limit, memory_limit } = req.body;
    const username = res.locals.username;
  
    if (filename && filename.length > 0 && code && code.length > 0) {
      if (lang && ['cpp', 'py'].indexOf(lang) === -1) {
        throw { status: 400, msg: 'Invalid language code' };
      }
  
      const submissionKey = username + '-' + filename;
      const status = await new Promise((resolve, reject) => {
        redisSubClient.get(submissionKey, (err, reply) => {
          if (err) {
            reject(err);
          } else {
            // reply is empty, if key is not found
            resolve(reply);
          }
        });
      });
  
      if (status) {
        throw { status: 429, msg: 'Your previous submission for same problem is still being processed' };
      }
  
      await new Promise((resolve, reject) => {
        redisSubClient.set(submissionKey, '1', 'EX', process.env.SQS_SUBMISSON_RETENTION_PERIOD, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });
  
      let mb = Math.floor(Number(memory_limit)); 
      let sec = Math.floor(Number(time_limit));
  
      if (Number.isNaN(mb) || Number.isNaN(sec) || mb < 1 || mb > 512 || sec < 1 || sec > 7) {
        throw { status: 400, msg: 'Invalid memory or time limit' };
      }
  
      const packet = {
        ...req.body,
        memory_limit: mb,
        time_limit: sec
      };
  
      const params = {
        MessageBody: JSON.stringify(packet),
        MessageDeduplicationId: submissionKey,
        MessageGroupId: 'Group1',    
        QueueUrl: lang === 'cpp' ? process.env.SQS_CPP_URL : process.env.SQS_PY_URL
      };
      
      sqs.sendMessage(params, (err, data) => {
        if (err) {
          console.log('Error', err);
          res.status(200).json({ msg: 'Failed to process your request' });
        } else {
          console.log('Success', data.MessageId);
          res.status(200).json({ msg: 'Your code is being processed' });
        }
      });
    } else {
      res.status(400).json({ msg: 'Filename and code cannot be empty' });
    }
  } catch (err) {
    next(err);
  }
});

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
