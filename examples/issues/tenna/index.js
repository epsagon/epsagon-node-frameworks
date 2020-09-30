// const express = require("express");
// const epsagon = require("../../../src/index");
const BunnyBus = require("@tenna-llc/bunnybus");
var axios = require("axios");
require("log-timestamp");

// const yargs = require("yargs");

var myArgs = process.argv.slice(2);
const bunnyBus = new BunnyBus({
  // hostname: "localhost",
  hostname: "fat-coral.rmq.cloudamqp.com",
  port: 5672,
  password: "6GpPOPXCjVVLlgcnA_nmuYm2DNj3U57c",
  username: "ehqhhctv",
  vhost: "ehqhhctv",
  // prefetch: 50,
});
const bunnyBus2 = new BunnyBus({
  // hostname: "localhost",
  hostname: "fat-coral.rmq.cloudamqp.com",
  port: 5672,
  password: "6GpPOPXCjVVLlgcnA_nmuYm2DNj3U57c",
  username: "ehqhhctv",
  vhost: "ehqhhctv",
  prefetch: 50,
});
// function sleep(ms) {
//   return new Promise((resolve) => {
//     setTimeout(resolve, ms);
//   });
// }

async function publishMessage(bunnyBus) {
  try {
    bunnyBus.publish({
      message: {
        event: "create-event",
        options: { routeKey: "queue1" },
        message: "Test message",
      },
    });
    console.log("published message");
  } catch (err) {
    console.log("failed to publish", err);
  }
}

const operation = myArgs[0];
const rate = myArgs[1];
const period = myArgs[2];
const epsagon = myArgs[3];

if (operation === "publish") {
  // const promises = Array.apply(null, Array(rate)).map(function () {
  //   return publishMessage();
  // });
  setInterval(async () => {
    publishMessage(bunnyBus);
    publishMessage(bunnyBus2);

    console.log("batch published");
  }, period);
} else if (operation === "subscribe") {
  if (epsagon === "epsagon") {
    const epsagon = require("epsagon-frameworks");
    // const epsagon = require("../../../src/index");

    console.log("init epsagon");

    epsagon.init({
      token: process.env.EPSAGON_TOKEN,
      appName: "itay-bunnybus-test",
      metadataOnly: false,
    });
  }

  try {
    bunnyBus.subscribe({
      queue: "queue1",
      handlers: {
        "create-event": async ({ message, ack, epsagon }) => {
          // await sleep(200);

          console.log("message consumed");
          // axios.get("http://www.google.com");
          // axios.get("http://www.google.com");

          await ack();
        },
      },
    });
  } catch (err) {
    console.log("failed to subscribe", err);
  }
}
