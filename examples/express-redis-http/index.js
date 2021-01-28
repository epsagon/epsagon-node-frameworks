const express = require('express');
const epsagon = require('../../src/index');
const redis = require('redis');
const request = require('request');
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
        request('https://httpbin.org/post',
          { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ test: 1 }) },
          (error, response, body) => {
            //console.log('statusCode:', response && response.statusCode);
            res.send('Express return from request pool')
        })
    })
})

app.listen(3000, () => {
  console.log(`Server listening at http://localhost:${3000}`)
})