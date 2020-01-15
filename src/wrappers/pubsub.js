/**
 * @fileoverview Handlers for Pubsub instrumentation
 */

const shimmer = require('shimmer');
const {
    tracer,
    tryRequire,
    eventInterface,
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
    let originalHandlerErr;
    try {
        // Initialize tracer and evnets.
        tracer.restart();
        const functionName = originalHandler.name || 'messageHandler';
        const { slsEvent: pubSubEvent, startTime: pubSubStartTime } =
        eventInterface.initializeEvent(
            'pubsub',
            requestFunctionThis.projectId,
            'messagePullingListener',
            'trigger'
        );
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface.initializeEvent(
            'node_function', functionName, 'messageReceived', 'runner'
        );
        tracer.addEvent(pubSubEvent);

        // Getting message data.
        let callbackResponse = { messageId: message.id };
        const messageData = (message.data && JSON.parse(`${message.data}`));
        if (messageData && typeof messageData === 'object') {
            callbackResponse = Object.assign(callbackResponse, messageData);
        }
        const { label, setError } = tracer;
        const returnMessage = message;
        returnMessage.epsagon = {
            label,
            setError,
        };

        // Finalize pubsub event.
        eventInterface.finalizeEvent(pubSubEvent, pubSubStartTime, null, callbackResponse);
        let promise;
        try {
            promise = originalHandler(returnMessage, {});
        } catch (err) {
            originalHandlerErr = err;
        }
        // Handle and finalize async user function.
        if (promise && promise.then) {
            promise.catch((err) => {
                originalHandlerErr = err;
                throw err;
            }).finally(() => {
                eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerErr);
                tracer.sendTrace(() => {});
            });
        } else {
            // Finalize sync user function.
            eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerErr);
            tracer.sendTrace(() => {});
        }
        tracer.addRunner(nodeEvent, promise);
    } catch (err) {
        tracer.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerErr) {
        throw originalHandlerErr;
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
