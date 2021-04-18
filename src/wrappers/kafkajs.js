/**
 * @fileoverview Handlers for kafkajs instrumentation
 */

const shimmer = require('shimmer');
const {
    tracer,
    moduleUtils,
    eventInterface,
    utils,
} = require('epsagon');
const traceContext = require('../trace_context.js');
const { EPSAGON_HEADER } = require('../http.js');

/**
 * acts as a middleware for `consumer.run()`
 * @param {object} message the messages param to send
 * @param {function} originalHandler original consumer function
 * @param {Boolean} isBatch whether the method is batched
 * @returns {Object} runnerResult Promise or result object
 */
function kafkaMiddleware(message, originalHandler, isBatch) {
    let originalHandlerSyncErr;
    let runnerResult;
    try {
        // Initialize tracer and runner.
        tracer.restart();
        const messageData = isBatch ? message.batch : message;
        const { slsEvent: kafkaEvent, startTime: kafkaStartTime } =
        eventInterface.initializeEvent(
            'kafka',
            messageData.topic,
            'consume',
            'trigger'
        );

        const messages = isBatch ? messageData.messages : [message.message];
        // Taking 50 messages max.
        const messagesData = messages.slice(0, 50).map(messageObj => ({
            offset: messageObj.offset,
            timestamp: new Date(parseInt(messageObj.timestamp, 10)).toUTCString(),
            // Convert headers from array to object and stringify them
            headers: Object.entries(messageObj.headers).reduce((total, entry) => {
                // eslint-disable-next-line no-param-reassign
                total[entry[0]] = entry[1].toString();
                return total;
            }, {}),
            body: messageObj.value.toString(),
        }));

        const messageIds = [];
        messages.forEach((messageObj) => {
            if (
                messageObj.headers &&
                messageObj.headers[EPSAGON_HEADER] &&
                !messageIds.includes(messageObj.headers[EPSAGON_HEADER].toString())
            ) {
                messageIds.push(messageObj.headers[EPSAGON_HEADER].toString());
            }
        });

        tracer.addEvent(kafkaEvent);
        eventInterface.finalizeEvent(kafkaEvent, kafkaStartTime, null, {
            'messaging.kafka.partition': messageData.partition,
            'messaging.messages_count': messages.length,
            'epsagon.trace_ids': messageIds,
        }, {
            'messaging.messages': messagesData,
        });

        const { label, setError, getTraceUrl } = tracer;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const runnerName = `${messageData.topic}_${isBatch ? 'batch' : 'message'}_handler`;
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface.initializeEvent(
            'node_function', runnerName, 'execute', 'runner'
        );
        // Setting runner for `message.epsagon` use.
        const tracerObj = tracer.getTrace();
        tracerObj.currRunner = nodeEvent;

        try {
            runnerResult = originalHandler(message);
        } catch (err) {
            originalHandlerSyncErr = err;
        }

        // Handle and finalize async user function.
        if (utils.isPromise(runnerResult)) {
            let originalHandlerAsyncError;
            runnerResult = runnerResult.catch((err) => {
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerAsyncError);
                tracer.sendTrace(() => {});
            });
        } else {
            // Finalize sync user function.
            eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
            tracer.sendTrace(() => {});
        }
        tracer.addRunner(nodeEvent, runnerResult);
    } catch (err) {
        tracer.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
    return runnerResult;
}


/**
 * Wraps the kafkajs run function to add the Epsagon middleware
 * @param {Function} wrappedFunction The kafkajs run function
 * @returns {Function} The wrapped function
 */
function kafkaConsumerRunWrapper(wrappedFunction) {
    return function internalKafkaWrapper(options) {
        // Add middleware only if eachMessage exists
        if (options.eachMessage) {
            const originalMessageHandler = options.eachMessage;
            const patchedHandler = message => traceContext.RunInContext(
                tracer.createTracer,
                () => kafkaMiddleware(message, originalMessageHandler, false)
            );
            // eslint-disable-next-line no-param-reassign
            options.eachMessage = patchedHandler.bind(options);
        }
        // Add middleware only if eachBatch exists
        if (options.eachBatch) {
            const originalBatchHandler = options.eachBatch;
            const patchedHandler = message => traceContext.RunInContext(
                tracer.createTracer,
                () => kafkaMiddleware(message, originalBatchHandler, true)
            );
            // eslint-disable-next-line no-param-reassign
            options.eachBatch = patchedHandler.bind(options);
        }
        return wrappedFunction.apply(this, [options]);
    };
}


/**
 * Wraps the kafkajs consumer creation to wrap the run function
 * @param {Function} wrappedFunction The kafkajs consumer function
 * @returns {Function} The wrapped function
 */
function kafkaConsumerWrapper(wrappedFunction) {
    return function internalKafkaConsumerWrapper(options) {
        const consumer = wrappedFunction.apply(this, [options]);
        if (consumer.run) {
            shimmer.wrap(consumer, 'run', kafkaConsumerRunWrapper);
        }
        return consumer;
    };
}

module.exports = {
    /**
     * Initializes the kafkajs tracer
     */
    init() {
        moduleUtils.patchModule(
            'kafkajs',
            'consumer',
            kafkaConsumerWrapper,
            kafka => kafka.Kafka.prototype
        );
    },
};
