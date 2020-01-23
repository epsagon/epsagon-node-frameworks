const epsagon = require('../src/index.js');

epsagon.init({
    token: '57986555-4114-403f-b341-47e27385406a',
    appName: 'nats-instrumention',
    metadataOnly: false,
});

const testFunction = () => {
const NATS = require('nats')

const nc = NATS.connect()
function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
const publishHandler = () => {
  // await timeout(10000);
  console.log('msg published')
}
const publishHandlerAsync = async() => {
  // await timeout(10000);
  console.log('msg published')
}
// Simple Publisher
//  nc.publish('foo', 'Hello World!', publishHandler)
//  nc.publish('foo', 'Hello World!', publishHandlerAsync)
//  nc.publish('foo', 'Hello World!')
// const a = nc.publish('foo', 'Hello World!')
// debugger
// Simple Subscriber
// nc.subscribe('foo', function (msg) {
//   console.log('Received a message: ' + msg)
//   debugger
// })

// // // Unsubscribing
// const sid = nc.subscribe('foo', (function (msg) {}))
// // nc.unsubscribe(sid)

// // Subscription/Request callbacks are given multiple arguments:
// // - msg is the payload for the message
// // - reply is an optional reply subject set by the sender (could be undefined)
// // - subject is the subject the message was sent (which may be more specific
// //   than the subscription subject - see "Wildcard Subscriptions".
// // - finally the subscription id is the local id for the subscription
// //   this is the same value returned by tbhe subscribe call.
// nc.subscribe('foo', (msg, reply, subject, sid) => {
//   debugger;
//   if (reply) {
//     nc.publish(reply, 'got ' + msg + ' on ' + subject + ' in subscription id ' + sid)
//     return
//   }
//   console.log('Received a message: ' + msg + " it wasn't a request.")
// })

// Request, creates a subscription to handle any replies to the request
// subject, and publishes the request with an optional payload. This usage
// // allows you to collect responses from multiple services
// nc.request('request', (msg) => {
//   debugger
//   console.log('Got a response in msg stream: ' + msg)
// })

// Request with a max option will unsubscribe after
// the first max messages are received. You can also specify the number
// of milliseconds you are willing to wait for the response - when a timeout
// is specified, you can receive an error
nc.request('help', null, { max: 1, timeout: 100000 }, async (msg) => {
  debugger;
  if (msg instanceof NATS.NatsError && msg.code === NATS.REQ_TIMEOUT) {
    console.log('request timed out')
    try{

      foo();
    } catch (err) {
      console.log(err);
    }
  } else {
    console.log('Got a response for help: ' + msg)
  }
})

// // Replies
// debugger;
nc.subscribe('help', function (request, replyTo) {
  debugger
  nc.publish(replyTo, 'I can help!')
})

// Close connection
// nc.close()

// const nats = NATS.connect(config);
// nats.once("connect", () => {
//   logger.trace(`connected to nats server`);
// });
// subscribe to a topic
// const topic = 'topic';
// const queueName = 'queueName';
// nc.subscribe(topic, { queue: queueName }, (msg, replyTopic, subject, sid) => {
//   try {
//     // handle message from nats
//     nats.publish(replyTopic, {hi: "there"});
//   } catch (e) {
//     console.log(`error handling request`);
//   }
// });
// const message = JSON.stringify({hello: "world"});
// nc.publish(topic, message, err => {
//   console.log(`published NATS message`);
// });
// nc.requestOne(topic, message, {}, timeout, response => {
//   console.log(`received response`);
// });

  }
const start = epsagon.nodeWrapper(testFunction);

start()
// testFunction();