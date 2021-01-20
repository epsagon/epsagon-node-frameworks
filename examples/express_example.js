const express = require('express');
const epsagon = require('../src/index.js');
var redis = require('redis');

epsagon.init({
    token: '57986555-4114-403f-b341-47e27385406a',
    appName: 'madison-repro',
    metadataOnly: false,
});

var host = 'localhost'
var redisPort = 6379
var client = redis.createClient(redisPort, host, {});
const mysql = require('mysql');
 
// create the connection to database
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'debian-sys-maint',
  password: 'BXrw158wCBVXJZu0',
  database: 'mysql'
});
 
//const Sequelize = require('sequelize');
//const sequelize = new Sequelize('mysql', 'debian-sys-maint', 'BXrw158wCBVXJZu0', { host: 'localhost', dialect: 'mysql' });
//var User = sequelize.define('user', { username: Sequelize.STRING, birthday: Sequelize.DATE });
//sequelize.sync()
const app = express()

app.get('/', (req, res) => res.send('Hello World!'))

app.get('/redis', (req, res) => {
    // Example label usage
    setTimeout( () => {
	    client.get('test', (err, result) => {
		    req.epsagon.label('myFirstLabel', 'customValue1');
		    res.send('Hello World!')
	    });
    }, 50);
})

app.get('/sql', (req, res) => {
    // Example label usage
    setTimeout( () => {
	    client.get('test', (err, result) => {
		    req.epsagon.label('myFirstLabel', 'customValue1');
connection.query(
  'SELECT * FROM `table` ',
  function(err, results, fields) {
	  console.log(err)
    console.log(results); // results contains rows returned by server
    console.log(fields); // fields contains extra meta data about results, if available
		    res.send('Hello World!')
  }
);
	    });
    }, 50);
})
app.get('/sqlize', (req, res) => {
    client.get('test', (err, result)  => {
        sequelize.query("SELECT * FROM `users`", { type: Sequelize.QueryTypes.SELECT }).then((response) => {
          res.send('Hello World!')
        })
    });
})
app.listen(3000, () => {console.log("Server listening at http://localhost:3000")})
