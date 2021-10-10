'use strict';

require('dotenv').config();
const { exec } = require('child_process');

const run = async () => {
  try {
    /*
      Maximum compilation time is 3 seconds
      Compliation can generate two types of error:
      1. Taking too much time for compilation (err.signal: 'SIGTERM')
      2. Syntax errors in code (err.signal = null)
      Get detail output from stderr
    */
    const { compileStdout, compileStderr } = await new Promise((resolve, reject) => {
      exec('g++ -o output code.cpp', { timeout: Number(process.env.COMPILATION_TIME) }, (err, stdout, stderr) => {
        if (err) {
          reject(err);
        } else {
          resolve({ stdout: stdout, stderr: stderr });
        }
      });
    });
    // add small delay so that output binary is properly written
    await new Promise((resolve) => setInterval(() => { resolve(); }, 100));
    /*
      Multiple errors can occur:
      1. Output limit exceeded (code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER')
      2. Time limit exceeded (code: SIGTERM)
      3. Other errors (SIGFPE (3221225620), SIGSEGV (3221225477), SIGABRT, SIGILL)
    */
    const { codeStdout, codeStderr } = await new Promise((resolve, reject) => {
      exec('output < test.txt', { timeout: 2 * 1000, maxBuffer: Number(process.env.OUTPUT_LIMIT) }, (err, stdout, stderr) => {
        if (err) {
          reject(err);
        } else {
          resolve({ stdout: stdout, stderr: stderr });
        }        
      });
    });
  } catch (err) {
    console.log(err);
  }
};

run();