/* eslint-disable no-undef */
'use strict';

/* get environment */
const environment = process.env.NODE_ENV || 'development';

/* load the .env to access constants */
require('dotenv').config();

/* require all modules here */
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const db = require('./db/index');

/* create express application */
const app = express();

/* add JSON body parser */
app.use(express.json());

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
