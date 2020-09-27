// const express = require("express");
// const epsagon = require("../../../src/index");
const epsagon = require("epsagon-frameworks");
const BunnyBus = require("@tenna-llc/bunnybus");
var axios = require("axios");

// epsagon.init({
//   token: process.env.EPSAGON_TOKEN,
//   appName: "itay-bunnybus-test",
//   metadataOnly: false,
// });

const bunnyBus = new BunnyBus({
  hostname: "bonobo-01.rmq.cloudamqp.com",
  port: 5672,
  password: "e--sOFi9AEw2Yi475rGVA7-nEpccsHH5",
  username: "stitheal",
  vhost: "stitheal",
});

// function sleep(ms) {
//   return new Promise((resolve) => {
//     setTimeout(resolve, ms);
//   });
// }

async function subscribeHandlers() {
  try {
    await bunnyBus.subscribe({
      queue: "queue1",
      handlers: {
        "create-event": async ({ message, ack, epsagon }) => {
          // await sleep(200);
          epsagon.label("testKey", "testValue");
          console.log(message.comment);
          await axios.get("http://dummy.restapiexample.com/api/v1/employees");
          await ack();
        },
      },
    });
  } catch (err) {
    console.log("failed to subscribe", err);
  }
}

async function publishMessage() {
  try {
    await bunnyBus.publish({
      message: {
        event: "create-event",
        comment: "Test message",
      },
    });
  } catch (err) {
    console.log("failed to publish", err);
  }
}

subscribeHandlers();

// setInterval(() => {
//   publishMessage();
//   console.log("message published");
// }, 200);

// const app = express();

// app.post("/", async (req, res) => {
//   res.send("Message published!");
//   await publishMessage();
// });

// app.listen(3000);
