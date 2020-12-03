/**
 * @fileoverview Patcher for all the libraries we are instrumenting
 * IMPORTANT: when requiring this module, all of the libraries will be automatically patched!
 */
const { config, utils } = require('epsagon');
const hapiPatcher = require('./wrappers/hapi.js');
const expressPatcher = require('./wrappers/express.js');
const koaPatcher = require('./wrappers/koa.js');
const pubusbPatcher = require('./wrappers/pubsub.js');
const natsPatcher = require('./wrappers/nats.js');
const kafkajsPatcher = require('./wrappers/kafkajs.js');
const kafkaNodePatcher = require('./wrappers/kafka-node.js');
const sqsConsumerPatcher = require('./wrappers/sqs-consumer.js');
const amqplibPatcher = require('./wrappers/amqplib.js');
const amqpPatcher = require('./wrappers/amqp.js');
const bunnybusPatcher = require('./wrappers/bunnybus.js');
const superagentPatcher = require('./events/superagent.js');
const superagentWrapperPatcher = require('./events/superagent-wrapper.js');
const redisPatcher = require('./events/redis.js');
const wsPatcher = require('./wrappers/ws.js');
const restifyPatcher = require('./wrappers/restify.js');


/**
 * Patches a module
 * @param {Object} patcher module
 */
function patch(patcher) {
    try {
        patcher.init();
    } catch (error) {
        if ((process.env.EPSAGON_DEBUG || '').toUpperCase() === 'TRUE') {
            utils.debugLog(error);
        }
    }
}


if (!config.getConfig().isEpsagonPatchDisabled) {
    [
        expressPatcher,
        hapiPatcher,
        koaPatcher,
        pubusbPatcher,
        natsPatcher,
        kafkajsPatcher,
        kafkaNodePatcher,
        sqsConsumerPatcher,
        amqplibPatcher,
        amqpPatcher,
        bunnybusPatcher,
        superagentPatcher,
        superagentWrapperPatcher,
        redisPatcher,
        wsPatcher,
        restifyPatcher,
    ].forEach(patch);
}
