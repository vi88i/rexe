# rexe

![banner](./assets/banner.png)

## Features

- Remotely solve algorithmic problems and execute C++ or python code in secure environment.
- Test your code, set memory and time limit.
- Save and share your work.

## Architecture

<p align="center"><img src="https://github.com/vi88i/rexe/blob/main/assets/rexe.png" alt="rexe"></p>

- Node.js web server: Handles all user requests.
- mongoDB: Stores client information.
- Docker: Manage Docker containers.
- Message queue: Queue requests.
- AWS S3: Store static files.