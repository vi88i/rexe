'use strict';

const path = require('path');
const AWS = require('aws-sdk');

AWS.config.loadFromPath(path.join('..', 'aws_config.json'));

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

const getRandomId = () => {
  return (Math.floor(Date.now() / 1000)).toString() + '-' + (Math.floor(Math.random() * 10000000000) + 1).toString();
};

const deleteSQSMessage = (id, url) => {
  return new Promise((resolve, reject) => {
    const deleteParams = {
      QueueUrl: url,
      ReceiptHandle: id
    };
    
    sqs.deleteMessage(deleteParams, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
};

const dequeue = (id, url) => {
  return new Promise((resolve, reject) => {
    const params = {
      MaxNumberOfMessages: 1,
      QueueUrl: url,
      ReceiveRequestAttemptId: id
    };
    
    sqs.receiveMessage(params, async (err, data) => {
      try {
        if (err) {
          reject(err);
        } else if (data.Messages) {
          resolve(data.Messages);
        } else {
          resolve(null);
        }
      } catch(err) {
        reject(err);      
      }
    });
  });
};

const enqueue = (key, url, packet) => {
  return new Promise((resolve, reject) => {
    const params = {
      MessageBody: JSON.stringify(packet),
      MessageDeduplicationId: key,
      MessageGroupId: process.env.SQS_GROUP,    
      QueueUrl: url
    }; 

    sqs.sendMessage(params, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });    
  });
};

const putJSON = (key, body, bucket) => {
  return new Promise((resolve, reject) => {
    const params = {
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(body)
    };

    s3.upload(params, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });  
};

const getJSON = (key, bucket) => {
  return new Promise((resolve, reject) => {
    const params = {
      Bucket: bucket,
      Key: key
    };

    s3.getObject(params, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(JSON.parse(data.Body.toString()));
      }
    });    
  });
};

const delJSON = (key, bucket) => {
  return new Promise((resolve, reject) => {
    const params = {
      Bucket: bucket,
      Key: key
    };
    
    s3.deleteObject(params, (err, data) => {
      if ((err && ['Not Found'].indexOf(err.code) > -1) || !data) {
        resolve();
      } else {
        reject(err);
      }
    });
  });
};

const checkIfObjectExist = (key, bucket) => {
  return new Promise((resolve, reject) => {
    const params = {
      Bucket: bucket,
      Key: key
    };

    s3.headObject(params, (err) => {
      if (err) {
        if (['Not Found', 'Forbidden'].indexOf(err.code) > -1) {
          resolve(false);
        } else {
          reject(err);
        }
      } else {
        resolve(true);
      }
    });
  });
};

exports.putJSON = putJSON;
exports.getJSON = getJSON;
exports.delJSON = delJSON;
exports.checkIfObjectExist = checkIfObjectExist;
exports.enqueue = enqueue;
exports.dequeue = dequeue;
exports.getRandomId = getRandomId;
exports.deleteSQSMessage = deleteSQSMessage;