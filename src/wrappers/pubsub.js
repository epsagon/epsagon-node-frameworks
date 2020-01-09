/* eslint-disable prefer-rest-params */
/**
 * @fileoverview Handlers for Pubsub instrumentation
 */

const shimmer = require('shimmer');
const {
    tracer,
    tryRequire,
} = require('epsagon');
const { initializeEvent, finalizeEvent } = require('../runners/runner');
const traceContext = require('../trace_context.js');

const GOOGLE_CLOUD_TYPES = {
    defaultProjectId: '{{projectId}}',
    pubsub: {
        name: 'pubsub',
    },
};

const subscriber = tryRequire('@google-cloud/pubsub/build/src/subscriber');

/**
 * Handle subscriber event emitter of eventName='message'
 * @param {Message} message received message.
 * @param {*} originalHandler listener callback function.
 * @param {*} requestFunctionThis request arguments.
 */
function pubSubSubscriberMiddleware(message, originalHandler, requestFunctionThis) {
    try {
        tracer.restart();
        const functionName = originalHandler.name || 'messageHandler';
        const { event: pubSubEvent, startTime: pubSubStartTime } = initializeEvent(
            GOOGLE_CLOUD_TYPES.pubsub.name,
            // eslint-disable-next-line no-underscore-dangle
            requestFunctionThis._subscription.projectId,
            'messagePullingListener',
            'trigger'
        );
        const { event: nodeEvent, startTime: nodeStartTime } = initializeEvent(
            'node_function', functionName, 'messageReceived', 'runner'
        );
        tracer.addEvent(pubSubEvent);
        const messageData = JSON.parse(`${message.data}`);
        const callbackResponse = { messageId: message.id, ...messageData };
        finalizeEvent(pubSubEvent, pubSubStartTime, null, callbackResponse);
        const { label, setError } = tracer;
        let originalHandlerErr;
        tracer.addRunner(nodeEvent);
        try {
            const returnMessage = message;
            returnMessage.epsagon = {
                label,
                setError,
            };
            originalHandler(returnMessage, {});
            finalizeEvent(nodeEvent, nodeStartTime, null, callbackResponse);
        } catch (err) {
            finalizeEvent(nodeEvent, nodeStartTime, err);
            originalHandlerErr = err;
        }
        tracer.sendTrace(() => {});
        if (originalHandlerErr) {
            throw originalHandlerErr;
        }
    } catch (err) {
        tracer.addException(err);
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
        if (subscriber) {
            shimmer.wrap(subscriber.Subscriber.prototype, 'on', pubSubSubscriberWrapper);
        }
    },
};
