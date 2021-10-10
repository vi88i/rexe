'use strict';

const mysql = require('mysql');

const pool = mysql.createPool({
  connectionLimit: process.env.DB_CONN_POOL,
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB
});

/* promisify pool.getConnection */
exports.getConnection = () => {
  return new Promise((resolve, reject) => {
    pool.getConnection((err, conn) => {
      if (err) {
        reject(err);
      }
      resolve(conn);
    });
  });  
};

/* promisify connection.query */
exports.query = (conn, q, args) => {
  return new Promise((resolve, reject) => {
    conn.query(q, args, (err, results) => {
      if (err) {
        reject(err);
      }
      resolve({ rows: results });
    });
  });
};
