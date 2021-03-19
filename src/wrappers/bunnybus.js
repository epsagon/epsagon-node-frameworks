/**
 * @fileoverview Handlers for BunnyBus instrumentation
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
 * acts as a middleware for `BunnyBus consumer messages
 * @param {object} config data of the bunnybus
 * @param {Function} callback the callback function
 * @param {string} queue queue
 * @param {string} topic topic
 * @param {object} handlerParams original handler arguments
 * @returns {any} runnerResult results from callback
 */
function bunnybusSubscriberMiddleware(config, callback, queue, topic, handlerParams) {
    let originalHandlerSyncErr;
    let runnerResult;
    try {
        // Initialize tracer and runner.
        const tracerObj = tracer.getTrace();
        traceContext.setAsyncReference(tracerObj);
        traceContext.setMainReference();
        tracer.restart();
        const { slsEvent: amqpEvent, startTime: amqpStartTime } =
        eventInterface.initializeEvent(
            'rabbitmq',
            handlerParams.metaData.headers.routeKey,
            'consume',
            'trigger'
        );

        const metadata = {
            host: config.hostname,
            vhost: config.vhost,
            'messaging.message_payload_size_bytes': JSON.stringify(handlerParams.message).length,
        };
        if (handlerParams.metaData.headers[EPSAGON_HEADER]) {
            metadata[EPSAGON_HEADER] = handlerParams.metaData.headers[EPSAGON_HEADER].toString();
        }

        tracer.addEvent(amqpEvent);
        eventInterface.finalizeEvent(amqpEvent, amqpStartTime, null, metadata, {
            headers: handlerParams.metaData.headers,
            message: handlerParams.message,
        });

        const { label, setError, getTraceUrl } = tracer;
        // eslint-disable-next-line no-param-reassign
        handlerParams.epsagon = {
            label,
            setError,
            getTraceUrl,
        };

        const runnerName = callback && callback.name ? callback.name : `${topic}-consumer`;
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface.initializeEvent(
            'node_function', runnerName, 'execute', 'runner'
        );

        eventInterface.createTraceIdMetadata(nodeEvent);

        try {
            runnerResult = callback(handlerParams);
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
                traceContext.setAsyncReference(tracerObj);
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
 * Wraps the BunnyBus callback and channel consumer creation to wrap the run function
 * @param {Function} wrappedFunction The BunnyBus subscribe function
 * @returns {Function} The wrapped function
 */
function bunnybusConsumerWrapper(wrappedFunction) {
    return function internalBunnybusConsumerWrapper({ queue, handlers, options }) {
        if (!queue) {
            // Support only version >=7.0.0
            utils.debugLog('Found BunnyBus <7.0.0, skipping instrumentation.');
            return wrappedFunction.apply(this, [{ queue, handlers, options }]);
        }
        try {
            const bunny = this;
            bunny.__EPSAGON_PATCH = {}; // eslint-disable-line no-underscore-dangle
            Object.keys(handlers).forEach((topic) => {
                const callback = handlers[topic];
                if (
                    typeof handlers[topic] === 'function' &&
                    bunny.__EPSAGON_PATCH && // eslint-disable-line no-underscore-dangle
                    !bunny.__EPSAGON_PATCH[topic] // eslint-disable-line no-underscore-dangle
                ) {
                    // eslint-disable-next-line no-underscore-dangle
                    bunny.__EPSAGON_PATCH[topic] = true;
                    // eslint-disable-next-line no-param-reassign
                    handlers[topic] = handlerParams => traceContext.RunInContext(
                        tracer.createTracer,
                        () => bunnybusSubscriberMiddleware(
                            this.config,
                            callback,
                            queue,
                            topic,
                            handlerParams
                        )
                    );
                }
            });
        } catch (err) {
            utils.debugLog(`Could not enable BunnyBus tracing - ${err}`);
        }
        return wrappedFunction.apply(this, [{ queue, handlers, options }]);
    };
}

module.exports = {
    /**
     * Initializes the BunnyBus tracer
     */
    init() {
        moduleUtils.patchModule(
            '@tenna-llc/bunnybus/lib/index.js',
            'subscribe',
            bunnybusConsumerWrapper,
            BunnyBus => BunnyBus.prototype
        );
    },
};
