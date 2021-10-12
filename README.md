# rexe

![banner](./assets/banner.png)

## Features

- Remotely solve algorithmic problems and execute C++ or Python code in secure environment.
- Test your code, set memory and time limit.
- Save your progress.

## Architecture

<p align="center"><img src="https://github.com/vi88i/rexe/blob/main/assets/rexe.png" alt="rexe"></p>

- <b>Node.js web server</b>: Handles all user requests.
- <b>MySQL</b>: Stores client information.
- <b>Docker</b>: Manage Docker containers.
- <b>AWS SQS</b>: Queue requests and responses.
- <b>AWS S3</b>: Store static files.
- <b>redis</b>: Caching static data.

## Build and Run containers

```bash
cd rexe-backend/containers/cpp
docker build -t cpp-container . # only once for every change you make to application you run on docker
docker run -i -t --rm cpp-container # start the docker container
```

## TODO

- Explain why you chose each technology
- motivation behind the project
- challenges faced and how you overcame them