# select light weight base image
FROM alpine:3.14
# set workdir 
WORKDIR /app
# install node js, npm and g++
RUN apk update && apk add nodejs npm g++ 
# copy all files in current directory and not in .dockerignore
COPY . /app/
# run the application
CMD [ "node", "index.js" ]