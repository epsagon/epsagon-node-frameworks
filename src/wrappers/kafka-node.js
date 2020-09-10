/**
 * @fileoverview Handlers for kafka-node instrumentation
 */

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
 * @param {Consumer} consumer original consumer
 */
function kafkaMiddleware(message, originalHandler, consumer) {
    let originalHandlerSyncErr;
    let runnerResult;
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
            offset: message.offset,
            key: message.key,
            host: consumer.client.options.kafkaHost,
        };

        // kafka-node doesn't support headers, so we're checking if Epsagon found in a JSON value
        try {
            const jsonData = JSON.parse(message.value);
            if (jsonData[EPSAGON_HEADER]) {
                metadata[EPSAGON_HEADER] = jsonData[EPSAGON_HEADER].toString();
            }
        } catch (err) {
            utils.debugLog('kafka-node - Could not extract epsagon header');
        }

        tracer.addEvent(kafkaEvent);
        eventInterface.finalizeEvent(kafkaEvent, kafkaStartTime, null, metadata, {
            body: message.value.toString(),
        });

        const { label, setError } = tracer;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
        };
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface.initializeEvent(
            'node_function', originalHandler.name || `${message.topic}-consumer`, 'execute', 'runner'
        );
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
 * Wraps the kafka-node run function to add the Epsagon middleware
 * @param {Function} wrappedFunction The kafka-node run function
 * @returns {Function} The wrapped function
 */
function kafkaConsumerRunWrapper(wrappedFunction) {
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalKafkaWrapper(event, handler) {
        const consumer = this;
        if (event !== 'message') {
            return wrappedFunction.apply(this, [event, handler]);
        }
        // Add middleware only if eachMessage exists
        if (typeof handler !== 'function') {
            return wrappedFunction.apply(this, [event, handler]);
        }

        const patchedHandler = message => traceContext.RunInContext(
            tracer.createTracer,
            () => kafkaMiddleware(message, handler, consumer)
        );

        return wrappedFunction.apply(this, [event, patchedHandler]);
    };
}

module.exports = {
    /**
     * Initializes the kafka-node tracer
     */
    init() {
        moduleUtils.patchModule(
            'kafka-node',
            'on',
            kafkaConsumerRunWrapper,
            kafka => kafka.Consumer.prototype
        );
    },
};
