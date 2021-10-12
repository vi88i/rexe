CREATE DATABASE rexe;
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '<PASSWORD>';
flush privileges;

CREATE TABLE users (
  username VARCHAR(80),
  password_hash VARCHAR(64),
  PRIMARY KEY (username)
);
