const express = require('express');
const epsagon = require('epsagon-frameworks');
const redis = require('redis');
const app = express();

const host = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;
const client = redis.createClient(redisPort, host, {});

epsagon.init({
    token: '5a407ec1-199b-439a-8d66-39aa9edf78f7',
    appName: 'express-redis-http',
    ignoredKeys:['password*'], // Ignore PII keys, properties
    metadataOnly: false,
    sendTimeout: 2000
  });

app.get('/', (req, res) => {
    client.get('test', (err, result)  => {
        if (err) throw err;
        console.log("Express call log")
        res.send('Express return from redis client')
    })
})

app.listen(3000, () => {
  console.log(`Server listening at http://localhost:${3000}`)
})