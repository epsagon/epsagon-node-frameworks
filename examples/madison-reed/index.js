const express = require('express');
const epsagon = require('../../src/index');
const redis = require('redis');
const mysql = require('mysql');
// const mysql2 = require('mysql2');
const app = express();

const connection = mysql.createConnection({
  host     : 'localhost',
  user     : 'root',
  password : 'secret',
  database : 'mysql'
});

connection.connect();

const pool = mysql.createPool(
{
  connectionLimit: 60,
  waitForConnections: true,
  charset:"UTF8",
  host     : 'localhost',
  user: 'debian-sys-maint',
  password: 'BXrw158wCBVXJZu0',
//   user     : 'root',
//   password : 'secret',
  database : 'mysql'
})

var host = 'localhost' // '127.0.0.1';
var redisPort = 6379;
var client = redis.createClient(redisPort, host, {});

epsagon.init({
    token: '5a407ec1-199b-439a-8d66-39aa9edf78f7',
    appName: 'haim-test',
    ignoredKeys:['password*'], // Ignore PII keys, properties
    metadataOnly: false,
    sendTimeout: 2000
  });

app.get('/redis_sql_connection', (req, res) => {
    client.get('test', (err, result)  => {
        if (err) throw err;
        connection.query('SELECT 1 + 1 AS solution', function (error, results, fields) {
            if (error) throw error;
            console.log('The solution is: ', results[0].solution);
            res.send('result from connection')
        });
    })
})

app.get('/redis_sql_pool', (req, res) => {
    client.get('test', (err, result)  => {
        if (err) throw err;
        pool.query('SELECT 1 + 1 AS solution', function (error, results, fields) {
            if (error) throw error;
            console.log('The solution is: ', results[0].solution);
            res.send('result from pool')
        });        
    })
})

app.get('/redis_sql_pool_connection', (req, res) => {
    client.get('test', (err, result)  => {
        if (err) throw err;
        pool.getConnection(function(er, connection) {
            if (er) throw er; // not connected!

            // Use the connection
            connection.query('SELECT 1 + 1 AS solution', function (error, results, fields) {
                // When done with the connection, release it.
                connection.release();

                // Handle error after the release.
                if (error) throw error;
                console.log('The solution is: ', results[0].solution);
                res.send('result from pool coonection')
            });
        });
    })
})

app.get('/sql', (req, res) => {
    res.send('sql demo')
})

app.get('/redis', (req, res) => {
    res.send('redis demo')
})

app.listen(3000, () => {
  console.log(`Server listening at http://localhost:${3000}`)
})