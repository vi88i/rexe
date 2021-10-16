# rexe

![banner](./assets/banner.png)

## Motivation

On multiple occasions programmers system crashes/freezes while solving an algorithmic problems because of executing unsafe/untested code on bare-metal system without any resource constraints, this requires them to restart their entire system. And rebooting system will eat up their contest time.

## Features

- Remotely solve algorithmic problems and execute your code on secure and safe environment.
- Test your code, set time and memory limit.
- Save and load your work.

## Architecture

<p align="center"><img src="https://github.com/vi88i/rexe/blob/main/assets/rexe.png" alt="rexe"></p>

- <b>Node.js web server</b>: Responsible for authentication, enqueuing submissions, dequeuing results from message queue, fetching/putting objects from/to object storage. Since most of these tasks involve heavy network I/O, Node.js is suitable for these tasks.
- <b>MySQL</b>: Stores users (authentication) and their submission information. Since schema is static and requires referential integrity between users and their submissions, relational database is suitable for this problem.
- <b>Docker</b>: Provides services to manage docker containers. On executing untrusted code on containers any damage caused would be limited to the container reducing potential exposure to the other applications running on that bare metal system (<a href='https://anchore.com/blog/is-docker-more-secure/'>read more</a>). 
- <b>AWS SQS</b>: Message queue for queuing submissions and results.
- <b>AWS S3</b>: Object storage for submissions and results.
- <b>redis</b>: Used in various procedures such as blacklisting JWT tokens till time to live of token, short polling for results retrieval and preventing duplicate submissions within retention period of FIFO queue or till the results are available.

## Examples

![ui](./assets/ui.png)
![normal](./assets/normal.png)
![error](./assets/error.png)
![tle](./assets/tle.png)
![segfault](./assets/segfault.png)
![backend](./assets/backend.png)

## TODO

- Run containers as non-root users, restrict user from executing shell commands programatically.