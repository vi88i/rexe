CREATE DATABASE rexe;
ALTER USER 'root'@'localhost' IDENTIFIED WITH mysql_native_password BY '<PASSWORD>';
flush privileges;

CREATE TABLE users (
  username VARCHAR(80),
  password_hash VARCHAR(64),
  PRIMARY KEY (username)
);

CREATE TABLE submissions (
  username VARCHAR(80),
  submission VARCHAR(80),
  file_hash VARCHAR(64),
  PRIMARY KEY(username, submission),
  FOREIGN KEY (username) REFERENCES users(username)
);

DROP PROCEDURE IF EXISTS insert_submission;
DELIMITER $$
CREATE PROCEDURE insert_submission(IN username VARCHAR(80), IN submission VARCHAR(80), IN file_hash VARCHAR(64))  
BEGIN
  DECLARE cnt INT DEFAULT 0;
  
  SELECT COUNT(username) INTO cnt
  FROM submissions AS S
  WHERE S.username=username AND S.submission=submission;
  
  IF cnt = 0 THEN
    INSERT INTO submissions VALUES(username, submission, file_hash);
  ELSE
    UPDATE submissions AS S
    SET S.file_hash=file_hash
    WHERE S.username=username AND S.submission=submission;
  END IF;
END $$
DELIMITER ; 