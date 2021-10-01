/* eslint-disable no-undef */
'use strict';

/* load the .env to access constants */
require('dotenv').config();

/* require all modules here */
const express = require('express');

/* create express application */
const app = express();

/* 404 responses */
app.use((_, res) => {
  res.status(404).send('Sorry can\'t find that!');
});

/* default error handler */
app.use((err, _, res, next) => {
  if (res.headersSent) {
    next(err);
  } else if (err.msg && err.status) {
    res.status(err.status).send(err.msg);
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
