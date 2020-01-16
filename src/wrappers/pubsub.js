/**
 * @fileoverview Handlers for Pubsub instrumentation
 */

const shimmer = require('shimmer');
const {
    tracer,
    tryRequire,
    eventInterface,
    utils,
} = require('epsagon');
const traceContext = require('../trace_context.js');

const subscriber = tryRequire('@google-cloud/pubsub/build/src/subscriber');

/**
 * Handle subscriber event emitter of eventName='message'
 * @param {Message} message received message.
 * @param {*} originalHandler listener callback function.
 * @param {*} requestFunctionThis request arguments.
 */
function pubSubSubscriberMiddleware(message, originalHandler, requestFunctionThis) {
    let originalHandlerSyncErr;
    try {
        // Initialize tracer and evnets.
        tracer.restart();
        const { slsEvent: pubSubEvent, startTime: pubSubStartTime } =
        eventInterface.initializeEvent(
            'pubsub',
            requestFunctionThis.projectId,
            'messagePullingListener',
            'trigger'
        );
        tracer.addEvent(pubSubEvent);

        // Getting message data.
        let runnerMetadata = { messageId: message.id };
        const messageData = (message.data && JSON.parse(`${message.data}`));
        if (messageData && typeof messageData === 'object') {
            runnerMetadata = Object.assign(runnerMetadata, messageData);
        }
        const { label, setError } = tracer;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
        };

        // Finalize pubsub event.
        eventInterface.finalizeEvent(pubSubEvent, pubSubStartTime, null, runnerMetadata);
        let promise;
        try {
            promise = originalHandler(message, {});
        } catch (err) {
            originalHandlerSyncErr = err;
        }

        const functionName = originalHandler.name || 'messageHandler';
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface.initializeEvent(
            'node_function', functionName, 'messageReceived', 'runner'
        );
        // Handle and finalize async user function.
        if (utils.isPromise(promise)) {
            let originalHandlerAsyncError;
            promise.catch((err) => {
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
        tracer.addRunner(nodeEvent, promise);
    } catch (err) {
        tracer.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
}

/**
 * Wraps pubsub subscriber event emitter function with tracing.
 * @param {Function} wrappedFunction pubsub init function
 * @return {Function} updated wrapped init
 */
function pubSubSubscriberWrapper(wrappedFunction) {
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalPubSubSubscriberWrapper(eventName, callback) {
        if (eventName !== 'message') {
            return wrappedFunction.apply(this, [eventName, callback]);
        }
        const requestFunctionThis = this;
        const patchedCallback = message => traceContext.RunInContext(
            tracer.createTracer,
            () => pubSubSubscriberMiddleware(message, callback, requestFunctionThis)
        );
        return wrappedFunction.apply(this, [eventName, patchedCallback]);
    };
}

module.exports = {
    /**
     * Initializes the pubsub tracer
     */
    init() {
        const subscription = tryRequire('@google-cloud/pubsub/build/src/subscription');
        if (subscriber) {
            shimmer.wrap(subscription.Subscription.prototype, 'on', pubSubSubscriberWrapper);
        }
    },
};
