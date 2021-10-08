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
const express = require('express');
const db = require('./db/index');

/* setup AWS config and SQS */
AWS.config.loadFromPath('./aws_config.json');
const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

/* create express application */
const app = express();

/* add JSON body parser */
app.use(express.json());
/* add cookie parser middleware */
app.use(cookieParser(process.env.COOKIE_SECRET));

/* basic logging for requests */
app.use((req, _, next) => {
  if (environment === 'development') {
    console.log(new Date().toISOString() + ' ' + req.method + ' ' + req.url + ' ');
  }
  next();
});

/* set common headers */
app.use((_, res, next) => {
  res.header('Cache-Control', 'no-store');
  next();
});

/* serve static files */
app.use(express.static('..\\rexe-frontend\\static'));

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
  if (req.body.username && req.body.username.length > 0 && req.body.username && req.body.username.length > 0) {
    let conn = null;
    try {
      conn = await db.getConnection();
      const { rows } = await db.query(conn, 'SELECT COUNT(*) AS count FROM users WHERE username = ?', [req.body.username]);
      if (rows[0].count > 0) {
        throw { status: 409, msg: 'Username already exists!' };
      }
      const hash = crypto.createHash('sha256').update(req.body.password).digest('hex');
      await db.query(conn, 'INSERT INTO users VALUES(?, ?)', [req.body.username, hash]);
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
  if (req.body.username && req.body.username.length > 0 && req.body.username && req.body.username.length > 0) {
    let conn = null;
    try {
      conn = await db.getConnection();
      const hash = crypto.createHash('sha256').update(req.body.password).digest('hex');
      const { rows } = await db.query(conn, 'SELECT COUNT(*) AS count FROM users WHERE username = ? AND password_hash = ?', [req.body.username, hash]);
      if (rows[0].count === 0) {
        throw { status: 401, msg: 'Invalid username or password!' };
      }
      let token = jwt.sign({ username: req.body.username }, process.env.JWT_SECRET, {
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
      res.cookie('username', req.body.username, {
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
  if (req.signedCookies) {
    let token = req.signedCookies.token;
    jwt.verify(token, process.env.JWT_SECRET, function(err, decoded) {
      if (err) {
        next({ status: 401, msg: 'Unauthorized' });
      } else {
        req.user = {};
        req.user.username = decoded.username;
      }
      next();
    });    
  } else {
    next({ status: 401, msg: 'Unauthorized' });
  }
};

/* sign out the user */
app.get('/sign-out', requireAuthorization, (req, res) => {
  // TODO: blacklist token in redis till TTL
  res.clearCookie('username');
  res.clearCookie('token');
  res.status(200).json({ msg: 'ok' });
});

/* process code submission */
app.post('/run', requireAuthorization, (req, res, next) => {
  /*
    TODO:
    1. Check in cache
    2. Queue on SQS
    3. Prevent duplicate request by same user on same file
  */
  if (
    req.body.filename && req.body.filename.length > 0 && 
    req.body.code && req.body.code.length > 0 &&
    req.body.lang && ['cpp', 'py'].indexOf(req.body.lang) !== -1
  ) {
    const memory_limit = req.body.memory_limit || process.env.MEMORY_LIMIT;
    const time_limit = req.body.time_limit || process.env.TIME_LIMIT;

    const packet = {
      ...req.body,
      memory_limit: memory_limit,
      time_limit: time_limit
    };

    const params = {
      MessageAttributes: {
        "author": {
          DataType: "String",
          StringValue: req.body.username
        },
        "filename": {
          DataType: "String",
          StringValue: req.body.filename          
        }
      },
      MessageBody: JSON.stringify(packet),
      MessageDeduplicationId: req.body.username + '-' + req.body.lang, // come up with something better here
      MessageGroupId: "Group1",    
      QueueUrl: req.body.lang === 'cpp' ? process.env.SQS_CPP_URL : process.env.SQS_PY_URL   
    };
    
    sqs.sendMessage(params, (err, data) => {
      if (err) {
        console.log("Error", err);
        res.status(200).json({ msg: 'Failed to process your request' });
      } else {
        console.log("Success", data.MessageId);
        res.status(200).json({ msg: 'Your code is being processed' });
      }
    });    
  } else {
    res.status(200).json({ msg: 'Filename and code cannot be empty' });
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
