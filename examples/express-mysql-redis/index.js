const express = require('express');
const epsagon = require('epsagon-frameworks');
const redis = require('redis');
const mysql = require('mysql');
const app = express();

const pool = mysql.createPool(
{
  connectionLimit: 60,
  waitForConnections: true,
  charset:"UTF8",
  host     : process.env.MYSQL_HOST || 'localhost',
  user     : process.env.MYSQL_USER || 'root',
  password : process.env.MYSQL_PASSWORD || 'secret',
  database : process.env.MYSQL_DB || 'mysql'
})

const host = process.env.REDIS_HOST || 'localhost';
const redisPort = process.env.REDIS_PORT || 6379;
const client = redis.createClient(redisPort, host, {});

epsagon.init({
    token: '5a407ec1-199b-439a-8d66-39aa9edf78f7',
    appName: 'haim-test',
    ignoredKeys:['password*'], // Ignore PII keys, properties
    metadataOnly: false,
    sendTimeout: 2000
  });

app.get('/redis_sql_pool', (req, res) => {
    client.get('test', (err, result)  => {
        if (err) throw err;
        pool.query('SELECT 1 + 1 AS solution', function (error, results, fields) {
            if (error) throw error;
            console.log("Express call log")
            res.send('Express return from mysql pool')
        });
    })
})

app.listen(3000, () => {
  console.log(`Server listening at http://localhost:${3000}`)
})