/**
 * @fileoverview Handlers for kafkajs instrumentation
 */

const shimmer = require('shimmer');
const {
    tracer,
    moduleUtils,
    eventInterface,
    utils,
    consts,
} = require('epsagon');
const traceContext = require('../trace_context.js');

const { EPSAGON_HEADER } = consts;

/**
 * acts as a middleware for `consumer.run()`
 * @param {object} message the messages param to send
 * @param {function} originalHandler original consumer function
 */
function kafkaMiddleware(message, originalHandler) {
    let originalHandlerSyncErr;
    try {
        // Initialize tracer and runner.
        tracer.restart();
        const { slsEvent: kafkaEvent, startTime: kafkaStartTime } =
        eventInterface.initializeEvent(
            'kafka',
            message.topic,
            'consume',
            'trigger'
        );

        const metadata = {
            partition: message.partition,
            offset: message.message.offset,
            timestamp: new Date(parseInt(message.message.timestamp, 10)).toUTCString(),
        };
        if (message.message.headers[EPSAGON_HEADER]) {
            metadata[EPSAGON_HEADER] = message.message.headers[EPSAGON_HEADER].toString();
        }

        // Convert headers from array to object and stringify them
        const headers = Object.entries(message.message.headers).reduce((total, entry) => {
            // eslint-disable-next-line no-param-reassign
            total[entry[0]] = entry[1].toString();
            return total;
        }, {});

        tracer.addEvent(kafkaEvent);
        eventInterface.finalizeEvent(kafkaEvent, kafkaStartTime, null, metadata, {
            headers,
            body: message.message.value.toString(),
        });

        const { label, setError } = tracer;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
        };
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface.initializeEvent(
            'node_function', 'message_handler', 'execute', 'runner'
        );
        let runnerResult;
        try {
            runnerResult = originalHandler(message);
        } catch (err) {
            originalHandlerSyncErr = err;
        }

        if (originalHandler.name) {
            nodeEvent.getResource().setName(originalHandler.name);
        }

        // Handle and finalize async user function.
        if (utils.isPromise(runnerResult)) {
            let originalHandlerAsyncError;
            runnerResult.catch((err) => {
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
}


/**
 * Wraps the kafkajs run function to add the Epsagon middleware
 * @param {Function} wrappedFunction The kafkajs run function
 * @returns {Function} The wrapped function
 */
function kafkaConsumerRunWrapper(wrappedFunction) {
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalKafkaWrapper(options) {
        // Add middleware only if eachMessage exists
        if (!options.eachMessage) {
            return wrappedFunction.apply(this, [options]);
        }
        const originalHandler = options.eachMessage;
        const patchedHandler = message => traceContext.RunInContext(
            tracer.createTracer,
            () => kafkaMiddleware(message, originalHandler)
        );
        // eslint-disable-next-line no-param-reassign
        options.eachMessage = patchedHandler;
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
