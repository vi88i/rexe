/* eslint linebreak-style: ["error", "unix"] */
'use strict';

const redis = require('redis');

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

(async function connect() {
  await redisAuthClient.connect();
  await redisSubClient.connect();
})();

exports.redisAuthClient = redisAuthClient;
exports.redisSubClient = redisSubClient;