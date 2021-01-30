const express = require("express");
const axios = require("axios");
const mysql = require("mysql");
const epsagon = require("../src");

epsagon.init({
  token: "my-secret-token",
  appName: "my-app-name",
  metadataOnly: false,
});

const app = express();

app.get("/", (req, res) => res.send("Hello World!"));

app.get("/trace", (req, res) => {
  var connection = mysql.createConnection({
    host: "localhost",
    password: "my-secret-pw",
    database: "my_db",
  });

  connection.connect();
  connection.query(
    "SELECT 1 + 1 AS solution",
    function (error, results, fields) {
      if (error) throw error;
      console.log("The solution is: ", results[0].solution);
    }
  );

  connection.end();
});

app.get("/label_example", (req, res) => {
  // Example label usage
  req.epsagon.label("myFirstLabel", "customValue1");
  res.send("Hello World!");
});

app.listen(3000);
