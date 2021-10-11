'use strict';

/*
  Request: 
  {
    code: String,
    test: String,
    time_limit: String,
    memory_limit: String
  }
  Response:
  {
    status: {Success, Compile error, TLE, OLE, MLE, Runtime error},
    signal: {null, SIGFPE, SIGABRT, SIGSEGV, SIGTERM, ...}
    output: stderr | stdout
  }
*/

require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const AWS = require('aws-sdk');

AWS.config.loadFromPath('aws_config.json');

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });

const run = async (body) => {
  /*
    250KB limit on stdout and stderr

    For compile stage:
      if ret.status === 0: 
        continue
      else
        return stderr

    For exec stage:
      Always get the signal sent to the process (as it hints to potential flaws in uses code)
      if ret.error and ret.error.code in ['ETIMEDOUT', 'ENOBUFS']:
        ETIMEDOUT : TLE (don't send anything)
        ENOBUFS   : OLE (return the sliced stdout, don't send stderr)
      else if stderr:
        return stderr
      else:
        return stdout
  */
  const data = JSON.parse(body);
  const submissionKey = data.username + '-' + data.filename;

  await new Promise((resolve, reject) => {
    fs.writeFile('code.cpp', data.code, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  await new Promise((resolve, reject) => {
    fs.writeFile('test.txt', data.input, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  const res = {
    status: '',
    signal: '',
    output: ''
  };

  const compileResult = spawnSync('g++', ['-o', 'output', 'code.cpp']);
  if (compileResult.status === 1) {
    res.status = 'Compiler error';
    const output = compileResult.stderr.toString();
    res.output = output.slice(0, Math.min(output.length, Number(process.env.OUTPUT_LIMIT)));
  } else {
    const execResult = spawnSync('./output' , ['< test.txt'], {
      timeout: Number(data.time_limit) * 1000,
      maxBuffer: Number(process.env.OUTPUT_LIMIT)
    });
    res.signal = execResult.signal ? execResult.signal : '';
    if (execResult.error && ['ETIMEDOUT', 'ENOBUFS'].indexOf(execResult.error.code) !== -1) {
      if (execResult.error.code === 'ETIMEDOUT') {
        res.status = 'Time Limit Exceeded';
      } else {
        res.status = 'Output Limit Exceeded';
        const output = execResult.stdout.toString();
        res.output = output.slice(0, Math.min(output.length, Number(process.env.OUTPUT_LIMIT))); 
      }
    } else if (execResult.stderr.length > 0) {
      res.status = 'Runtime error';
      const output = execResult.stderr.toString(); 
      res.output = output.slice(0, Math.min(output.length, Number(process.env.OUTPUT_LIMIT)));
    } else {
      res.status = 'Success';
      const output = execResult.stdout.toString();
      res.output = output.slice(0, Math.min(output.length, Number(process.env.OUTPUT_LIMIT)));
    }
  }

  return [submissionKey, JSON.stringify(res)];
};

function recvParams(id) {
  return {
    MaxNumberOfMessages: 1,
    QueueUrl: process.env.SQS_CPP_URL,
    ReceiveRequestAttemptId: id
  };
}

const getRandomId = () => {
  return (Date.now() / 1000).toString() + '-' + (Math.floor(Math.random() * 10000000000) + 1).toString();
};

const deleteSQSMessage = (id) => {
  return new Promise((resolve, reject) => {
    const deleteParams = {
      QueueUrl: process.env.SQS_CPP_URL,
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

const sendSQSMessage = (submissionKey, body) => {
  return new Promise((resolve, reject) => {
    const params = {
      MessageBody: body,
      MessageDeduplicationId: submissionKey,
      MessageGroupId: 'Group1',    
      QueueUrl: process.env.SQS_RES_URL
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

const sqsConsumer = (id) => {
  return new Promise((resolve, reject) => {
    const params = recvParams(id);
    sqs.receiveMessage(params, async (err, data) => {
      try {
        if (err) {
          reject(err);
        } else if (data.Messages) {
          const [submissionKey, body] = await run(data.Messages[0].Body);
          await sendSQSMessage(submissionKey, body);
          await deleteSQSMessage(data.Messages[0].ReceiptHandle);
          resolve();
        } else {
          resolve();
        }
      } catch(err) {
        reject(err);      
      }
    });
  });
};

const exec = async () => {
  const status = true;
  let retry = 0, id = getRandomId();
  while (status) {
    try {
      await sqsConsumer(id);
      retry = 0, id = getRandomId();
    } catch(err) {
      console.log(err);
      retry += 1;
      if (retry === 2) {
        retry = 0, id = getRandomId();
      }
    }
  }
};

exec();