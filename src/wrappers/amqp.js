/**
 * @fileoverview Handlers for amqp instrumentation
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
 * acts as a middleware for `queue.subscribe()`
 * @param {object} queue queue object
 * @param {object} message message data
 * @param {object} headers headers data
 * @param {object} deliveryInfo information about the delivery
 * @param {object} messageObject raw message
 * @param {Function} originalCallback original consumer function
 * @returns {object} runnerResult original callback result
 */
function amqpSubscriberMiddleware(
    queue, message, headers, deliveryInfo, messageObject, originalCallback
) {
    let originalHandlerSyncErr;
    let runnerResult;
    let nodeEvent;
    let nodeStartTime;
    try {
        if (typeof headers === 'object' && headers.bunnyBus) {
            utils.debugLog('[amqp] Skipping BunnyBus messages');
            return originalCallback(message, headers, deliveryInfo, messageObject);
        }

        // Initialize tracer and runner.
        tracer.restart();
        const { slsEvent: amqpEvent, startTime: amqpStartTime } =
        eventInterface.initializeEvent(
            'rabbitmq',
            deliveryInfo.routingKey,
            'consume',
            'trigger'
        );
        utils.debugLog('[amqp] Done initializing event');

        const metadata = {
            exchange: deliveryInfo.exchange,
            redelivered: deliveryInfo.redelivered,
            queue: deliveryInfo.queue,
            host: queue.connection.options.host,
            vhost: queue.connection.options.vhost,
            consumer_tag: deliveryInfo.consumerTag,
        };
        if (headers[EPSAGON_HEADER]) {
            metadata[EPSAGON_HEADER] = headers[EPSAGON_HEADER].toString();
        }

        tracer.addEvent(amqpEvent);
        utils.debugLog('[amqp] Event added');
        eventInterface.finalizeEvent(amqpEvent, amqpStartTime, null, metadata, {
            headers,
            message: JSON.stringify(message),
        });

        const { label, setError, getTraceUrl } = tracer;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const runnerName = originalCallback && originalCallback.name ? originalCallback.name : `${deliveryInfo.routingKey}-consumer`;
        const { slsEvent, startTime } = eventInterface.initializeEvent(
            'node_function', runnerName, 'execute', 'runner'
        );
        nodeEvent = slsEvent;
        nodeStartTime = startTime;
        utils.debugLog('[amqp] Runner initialized');
    } catch (err) {
        utils.debugLog('[amqp] Exception initializing');
        tracer.addException(err);
    }

    try {
        runnerResult = originalCallback(message, headers, deliveryInfo, messageObject);
        utils.debugLog('[amqp] Original runner ran');
    } catch (err) {
        utils.debugLog('[amqp] Original runner got an error');
        originalHandlerSyncErr = err;
    }

    try {
        if (nodeEvent) {
            // Handle and finalize async user function.
            if (utils.isPromise(runnerResult)) {
                utils.debugLog('[amqp] Original runner is a promise');
                let originalHandlerAsyncError;
                runnerResult = runnerResult.catch((err) => {
                    utils.debugLog('[amqp] Original runner in catch');
                    originalHandlerAsyncError = err;
                    throw err;
                }).finally(() => {
                    utils.debugLog('[amqp] Original runner in finally');
                    eventInterface.finalizeEvent(
                        nodeEvent,
                        nodeStartTime,
                        originalHandlerAsyncError
                    );
                    tracer.sendTrace(() => {});
                    utils.debugLog('[amqp] Trace sent');
                });
            } else {
                // Finalize sync user function.
                utils.debugLog('[amqp] Original runner is not a promise');
                eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
                tracer.sendTrace(() => {});
            }
            utils.debugLog('[amqp] Runner added');
            tracer.addRunner(nodeEvent, runnerResult);
        }
    } catch (err) {
        utils.debugLog('[amqp] Exception adding runner');
        tracer.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
    utils.debugLog('[amqp] Return result');
    return runnerResult;
}

/**
 * Wraps the amqp queue consumer creation to wrap the run function
 * @param {Function} wrappedFunction The amqp queue function
 * @returns {Function} The wrapped function
 */
function amqpSubscribeWrapper(wrappedFunction) {
    return function internalamqpSubscribeWrapper(options, messageListener, oldConsumerTag) {
        const queue = this;
        const originalCallback = typeof options === 'function' ? options : messageListener;
        let patchedCallback = originalCallback;
        if (typeof originalCallback === 'function') {
            patchedCallback = (
                message, headers, deliveryInfo, messageObject
            ) => traceContext.RunInContext(
                tracer.createTracer,
                () => amqpSubscriberMiddleware(
                    queue, message, headers, deliveryInfo, messageObject, originalCallback
                )
            );
        }
        if (typeof options === 'function') {
            options = patchedCallback; // eslint-disable-line no-param-reassign
        } else {
            messageListener = patchedCallback; // eslint-disable-line no-param-reassign
        }
        return wrappedFunction.apply(this, [options, messageListener, oldConsumerTag]);
    };
}

module.exports = {
    /**
     * Initializes the amqp tracer
     */
    init() {
        moduleUtils.patchModule(
            'amqp/lib/queue.js',
            'subscribe',
            amqpSubscribeWrapper,
            amqp => amqp.prototype
        );
    },
};
