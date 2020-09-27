// const express = require("express");
// const epsagon = require("../../../src/index");
// const epsagon = require("epsagon-frameworks");
const BunnyBus = require("@tenna-llc/bunnybus");
var axios = require("axios");

// epsagon.init({
//   token: process.env.EPSAGON_TOKEN,
//   appName: "itay-bunnybus-test",
//   metadataOnly: false,
// });

const bunnyBus = new BunnyBus({
  // hostname: "localhost",
  hostname: "eager-deer-01.rmq.cloudamqp.com",
  port: 5672,
  password: "ibMZarLKO5ALU3jSRvIdpGwavIItpDKO",
  username: "zqlqwfrd",
  vhost: "zqlqwfrd",
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
          const res = await axios.get(
            "http://dummy.restapiexample.com/api/v1/employees"
          );
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
    bunnyBus.publish({
      message: {
        event: "create-event",
        comment: "Test message",
      },
    });
    console.log("message published");
  } catch (err) {
    console.log("failed to publish", err);
  }
}

// subscribeHandlers();

setInterval(async () => {
  await Promise.all([
    publishMessage(),
    publishMessage(),
    publishMessage(),
    publishMessage(),
    publishMessage(),
    publishMessage(),
    publishMessage(),
    publishMessage(),
    publishMessage(),
    publishMessage(),
  ]);
}, 1);

// const app = express();

// app.post("/", async (req, res) => {
//   res.send("Message published!");
//   await publishMessage();
// });

// app.listen(3000);
