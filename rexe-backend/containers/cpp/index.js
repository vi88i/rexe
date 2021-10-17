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
    output: stderr | stdout,
    time: <Number|null>,
    memory: <Number|null>
  }
*/

require('dotenv').config();
const { spawnSync } = require('child_process');
const fs = require('fs');
const AWS = require('aws-sdk');

AWS.config.loadFromPath('aws_config.json');

const sqs = new AWS.SQS({ apiVersion: '2012-11-05' });
const s3 = new AWS.S3({ apiVersion: '2006-03-01' });

const stub = fs.readFileSync('stub.cpp', { encoding: 'utf8', flag: 'r' });

process.on('SIGINT', () => {
  console.log('Bye!');
  process.exit(0);
});

const putJSON = (key, body) => {
  return new Promise((resolve, reject) => {
    const params = {
      Bucket: process.env.S3_BUCKET,
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

const getJSON = (key) => {
  return new Promise((resolve, reject) => {
    const params = {
      Bucket: process.env.S3_BUCKET,
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

const run = async (body) => {
  const binaryFilename = process.platform === 'win32' ? 'output' : './output';
  const { key: submissionKey, hash } = JSON.parse(body);
  const data = await getJSON('request-' + submissionKey);

  console.log(`${submissionKey} : ${hash}`);

  // write the user's code to code.cpp
  await new Promise((resolve, reject) => {
    const reps = {
      '%MEMORY_LIMIT%': Number(data.memory_limit),
      '%TIME_LIMIT%': Number(data.time_limit)
    };
    fs.writeFile('code.cpp', stub.replace(/%\w+%/g, (e) => reps[e] || e) + data.code, { encoding: 'utf8', flag: 'w' }, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });

  const res = {
    status: null,
    signal: null,
    output: null,
    time: null,
    memory: null
  };

  // compile the program
  const compileResult = spawnSync('g++', ['-o', 'output', 'code.cpp']);
  // if exit status is 1, compilation failed
  if (compileResult.status === 1) {
    res.status = 'Compiler error';
    const output = compileResult.stderr.toString();
    res.output = output.slice(0, Math.min(output.length, Number(process.env.OUTPUT_LIMIT)));
  } else {
    // execute the binary
    const execResult = spawnSync(binaryFilename , { maxBuffer: Number(process.env.OUTPUT_LIMIT), input: data.input });
    let resourceUsage = null;
    /* when signal is delivered to process, almost always its bad for the process (somthing went wrong)  */
    res.signal = execResult.signal ? execResult.signal : null;
    /* if there is no error, resourceUsage is definitely return the stub */
    if (res.signal === null) {
      // time,memory
      resourceUsage = fs.readFileSync('rusage.txt', { encoding: 'utf8', flag: 'r' }).split(',');
    }
    if (execResult.error && execResult.error.code === 'ENOBUFS') {
      // check Node.js docs for Process module
      res.status = 'Output Limit Exceeded';
      const output = execResult.stdout.toString();
      res.output = output.slice(0, Math.min(output.length, Number(process.env.OUTPUT_LIMIT)));
    } else if (res.signal === 'SIGKILL') {
      // check man page of setrlimit() for RLIMIT_CPU
      res.status = 'Time Limit Exceeded';
    } else if (res.signal === 'SIGSEGV') {
      // check man page of setrlimit() for RLIMIT_AS
      if (resourceUsage && Number(resourceUsage[1]) > Number(data.memory_limit)) {
        res.status = 'Memory Limit Exceeded';
      } else {
        res.status = 'Segmentation fault';
      }
    } else if (res.signal !== null || execResult.stderr.length > 0) {
      // some signal other than SIGKILL, SIGSEGV
      res.status = 'Runtime error';
      const output = execResult.stderr.toString(); 
      res.output = output.slice(0, Math.min(output.length, Number(process.env.OUTPUT_LIMIT)));
    } else {
      // Yay!
      res.status = 'Success';
      res.time = Number(resourceUsage[0]);
      res.memory = Number(resourceUsage[1]);
      const output = execResult.stdout.toString();
      res.output = output.slice(0, Math.min(output.length, Number(process.env.OUTPUT_LIMIT)));
    }
  }

  const tmp = {};
  Object.keys(res).forEach((key) => {
    if (key !== 'output') {
      tmp[key] = res[key];
    }
  });
  console.log(tmp);

  return [submissionKey, hash, res];
};

const getRandomId = () => {
  return (Math.floor(Date.now() / 1000)).toString() + '-' + (Math.floor(Math.random() * 10000000000) + 1).toString();
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
      MessageBody: JSON.stringify(body),
      MessageDeduplicationId: submissionKey,
      MessageGroupId: process.env.SQS_GROUP,    
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
    const params = {
      MaxNumberOfMessages: 1,
      QueueUrl: process.env.SQS_CPP_URL,
      ReceiveRequestAttemptId: id
    };
    sqs.receiveMessage(params, async (err, data) => {
      try {
        if (err) {
          reject(err);
        } else if (data.Messages) {
          const timestamp = Date.now().toString();
          const [submissionKey, hash, body] = await run(data.Messages[0].Body);
          await putJSON('result-' + submissionKey, body);
          await sendSQSMessage(submissionKey + '-' + timestamp, { key: submissionKey, hash: hash });
          await deleteSQSMessage(data.Messages[0].ReceiptHandle);
        }
        resolve();
      } catch(err) {
        reject(err);      
      }
    });
  });
};

(async function startSQSCppConsumer() {
  const status = true;
  let retry = 0, id = getRandomId();
  while (status) {
    try {
      if (retry === 0) {
        console.log(`Starting new request: ${id}`);
      }
      await sqsConsumer(id);
      retry = 0, id = getRandomId();
    } catch(err) {
      console.log(err);
      retry += 1;
      if (retry === 2) {
        console.log(`Failed request: ${id}`);
        retry = 0, id = getRandomId();
      } else {
        console.log(`Retrying request: ${id}`);
      }
    }
  }
})();

// const json = {
//   code: fs.readFileSync('dummy.cpp', { encoding: 'utf8', flag: 'r' }),
//   input: '',
//   username: 'vighnesh',
//   filename: 'xxx',
//   time_limit: 2,
//   memory_limit: 256,
//   lang: 'cpp'
// };

// (async function stub(){
//   console.log(await run(JSON.stringify({ key: 'xxx' })));
// })();