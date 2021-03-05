/**
 * @fileoverview Handlers for amqplib instrumentation
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
 * @param {Function} callback the callback function
 * @param {Channel} channel the Channel object of amqplib
 * @param {function} originalHandler original consumer function
 * @returns {object} runnerResult original callback result
 */
function amqplibSubscriberMiddleware(message, callback, channel) {
    let originalHandlerSyncErr;
    let runnerResult;
    let nodeEvent;
    let nodeStartTime;
    const tracerObj = tracer.getTrace();
    traceContext.setAsyncReference(tracerObj);
    traceContext.setMainReference();
    try {
        if (message.properties.headers.bunnyBus) {
            utils.debugLog('[amqplib] Skipping BunnyBus messages');
            return callback(message);
        }

        // Initialize tracer and runner.
        tracer.restart();
        const { slsEvent: amqpEvent, startTime: amqpStartTime } =
        eventInterface.initializeEvent(
            'rabbitmq',
            message.fields.routingKey,
            'consume',
            'trigger'
        );
        utils.debugLog('[amqplib] Done initializing event');

        const metadata = {
            exchange: message.fields.exchange,
            redelivered: message.fields.redelivered,
            host: channel.connection.stream._host, // eslint-disable-line no-underscore-dangle
            consumer_tag: message.fields.consumerTag,
        };
        if (message.properties.headers[EPSAGON_HEADER]) {
            metadata[EPSAGON_HEADER] = message.properties.headers[EPSAGON_HEADER].toString();
        }

        tracer.addEvent(amqpEvent);
        utils.debugLog('[amqplib] Event added');
        eventInterface.finalizeEvent(amqpEvent, amqpStartTime, null, metadata, {
            headers: message.properties.headers,
            message: message.content.toString(),
        });

        const { label, setError, getTraceUrl } = tracer;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const runnerName = callback && callback.name ? callback.name : `${message.fields.routingKey}-consumer`;
        const { slsEvent, startTime } = eventInterface.initializeEvent(
            'node_function', runnerName, 'execute', 'runner'
        );
        nodeEvent = slsEvent;
        nodeStartTime = startTime;
        utils.debugLog('[amqplib] Runner initialized');
    } catch (err) {
        utils.debugLog('[amqplib] Exception initializing');
        tracer.addException(err);
    }

    try {
        runnerResult = callback(message);
        utils.debugLog('[amqplib] Original runner ran');
    } catch (err) {
        utils.debugLog('[amqplib] Original runner got an error');
        originalHandlerSyncErr = err;
    }

    try {
        if (nodeEvent) {
            // Handle and finalize async user function.
            if (utils.isPromise(runnerResult)) {
                utils.debugLog('[amqplib] Original runner is a promise');
                let originalHandlerAsyncError;
                runnerResult = runnerResult.catch((err) => {
                    utils.debugLog('[amqplib] Original runner in catch');
                    originalHandlerAsyncError = err;
                    throw err;
                }).finally(() => {
                    utils.debugLog('[amqplib] Original runner in finally');
                    eventInterface.finalizeEvent(
                        nodeEvent,
                        nodeStartTime,
                        originalHandlerAsyncError
                    );
                    tracer.sendTrace(() => {});
                    utils.debugLog('[amqplib] Trace sent');
                });
            } else {
                // Finalize sync user function.
                utils.debugLog('[amqplib] Original runner is not a promise');
                eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
                tracer.sendTrace(() => {});
            }
            utils.debugLog('[amqplib] Runner added');
            tracer.addRunner(nodeEvent, runnerResult);
        }
    } catch (err) {
        utils.debugLog('[amqplib] Exception adding runner');
        tracer.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
    utils.debugLog('[amqplib] Return result');
    return runnerResult;
}

/**
 * Wraps the amqplib callback and channel consumer creation to wrap the run function
 * @param {Function} wrappedFunction The amqplib consumer function
 * @returns {Function} The wrapped function
 */
function amqplibConsumerWrapper(wrappedFunction) {
    return function internalamqplibConsumerWrapper(queue, callback, options, cb0) {
        const channel = this;
        let patchedCallback = callback;
        if (typeof callback === 'function') {
            patchedCallback = message => traceContext.RunInContext(
                tracer.createTracer,
                () => amqplibSubscriberMiddleware(message, callback, channel)
            );
        }
        return wrappedFunction.apply(this, [queue, patchedCallback, options, cb0]);
    };
}

module.exports = {
    /**
     * Initializes the amqplib tracer
     */
    init() {
        moduleUtils.patchModule(
            'amqplib/lib/callback_model.js',
            'consume',
            amqplibConsumerWrapper,
            amqplib => amqplib.Channel.prototype
        );
        moduleUtils.patchModule(
            'amqplib/lib/channel_model.js',
            'consume',
            amqplibConsumerWrapper,
            amqplib => amqplib.Channel.prototype
        );
    },
};
