# rexe

![banner](./assets/banner.png)

## Motivation

On multiple occasions my system crashed while solving an algorithmic problem, which required me to restart my system.

## Features

- Remotely solve algorithmic problems and execute your code on secure environment.
- Test your code, set time and memory limit.
- Save and load your work.

## Architecture

<p align="center"><img src="https://github.com/vi88i/rexe/blob/main/assets/rexe.png" alt="rexe"></p>

- <b>Node.js web server</b>: Responsible for authentication, enqueuing submissions, dequeuing results from message queue, fetching/putting objects from/to object storage. Since most of these tasks involve heavy network I/O, Node.js is suitable for these tasks.
- <b>MySQL</b>: Stores users (authentication) and their submission information. Since schema is static and requires referential integrity between users and their submissions, relational database is suitable for this problem.
- <b>Docker</b>: Provides services to manage docker containers.
- <b>AWS SQS</b>: Message queue for queuing submissions and results.
- <b>AWS S3</b>: Object storage for submissions and results.
- <b>redis</b>: Used in various procedures such as blacklisting JWT tokens till time to live of token, short polling for results retrieval and preventing duplicate submissions within retention period of FIFO queue or till the results are available.

## Examples

![ui](./assets/ui.png)
![normal](./assets/normal.png)
![error](./assets/error.png)
![tle](./assets/tle.png)
![segfault](./assets/segfault.png)
