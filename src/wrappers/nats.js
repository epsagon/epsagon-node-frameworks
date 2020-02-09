/* eslint-disable camelcase */
/**
 * @fileoverview Handlers for Nats instrumentation
 */

const shimmer = require('shimmer');
const {
    tracer,
    tryRequire,
    eventInterface,
    utils,
} = require('epsagon');
const traceContext = require('../trace_context.js');


const NATS_TYPES = {
    name: 'nats',
    mainWrappedFunction: 'Client',
    serverDefaultHostname: 'unknown',
    inboxSignature: '_INBOX',
};

const getServerHostname = currentServer => (
    (currentServer.url && currentServer.url.hostname) ?
        currentServer.url.hostname :
        NATS_TYPES.serverDefaultHostname
);

/**
 * Checking if subscribe subject is inbox listener id.
 *
 * @param {String} subject subsribe subject.
 * @returns {Boolean} true if subscribe subject is inbox listener id, else false.
 */
const isNatsRequestCall = subject => !!(subject && typeof subject === 'string' && subject.startsWith(NATS_TYPES.inboxSignature));

const getSubscribeParams = (opts, callback) => {
    let opts_internal = opts;
    let callback_internal = callback;
    if (typeof opts === 'function') {
        callback_internal = opts;
        opts_internal = undefined;
    }
    return {
        opts_internal, callback_internal,
    };
};

/**
 * Handle nats subscribe callback event.
 *
 * @param {String} callback_msg received message.
 * @param {String} callback_reply received reply.
 * @param {String} callback_subject received subject.
 * @param {Number} callback_sid received subscribe id.
 * @param {Function} callback  callback function.
 * @param {String} serverHostname nats server host name.
 * @param {Boolean} isRequestCall true if this subscribe call came from nats Client.request.
 * @returns {Object} callback result.
 */
function natsSubscribeCallbackMiddleware(
    callback_msg,
    callback_reply,
    callback_subject,
    callback_sid,
    callback,
    serverHostname,
    isRequestCall
) {
    let originalHandlerSyncErr;
    let runnerResult;
    try {
        // Initialize tracer and events.
        tracer.restart();
        const { slsEvent: natsEvent, startTime: natsStartTime } =
        eventInterface.initializeEvent(
            'nats',
            serverHostname,
            isRequestCall ? 'requestMessageListener' : 'subscribeMessageListener',
            'trigger'
        );
        tracer.addEvent(natsEvent);
        // Getting message data.
        const triggerMetadata = {};
        if (callback_msg) {
            triggerMetadata.msg = callback_msg;
        }
        if (callback_reply) {
            triggerMetadata.reply = callback_reply;
        }
        if (callback_subject) {
            triggerMetadata.subject = callback_subject;
        }
        if (callback_sid) {
            triggerMetadata.sid = callback_sid;
        }
        // Finalize nats event.
        eventInterface.finalizeEvent(natsEvent, natsStartTime, null, triggerMetadata);
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface.initializeEvent(
            'node_function', 'messageHandler', 'messageReceived', 'runner'
        );
        try {
            runnerResult = callback(callback_msg, callback_reply, callback_subject, callback_sid);
        } catch (err) {
            originalHandlerSyncErr = err;
        }
        const originalHandlerName = callback.name;
        if (originalHandlerName) {
            nodeEvent.getResource().setName(originalHandlerName);
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
 * Wraps nats subscribe function with tracing.
 * @param {Function} wrappedFunction nats subscribe function.
 * @param {string} serverHostname nats server host name.
 * @return {Function} subscribe function rsoponse.
 */
function natsSubscribeWrapper(wrappedFunction, serverHostname) {
    return function internalNatsSubscribeWrapper(subject, opts, callback) {
        const { opts_internal, callback_internal } = getSubscribeParams(opts, callback);
        let patchedCallback = callback_internal;
        try {
            const isRequestCall = isNatsRequestCall(subject);
            patchedCallback = (callback_msg, callback_reply, callback_subject, callback_sid) => {
                traceContext.RunInContext(
                    tracer.createTracer,
                    () => natsSubscribeCallbackMiddleware(
                        callback_msg,
                        callback_reply,
                        callback_subject,
                        callback_sid,
                        callback_internal,
                        serverHostname,
                        isRequestCall
                    )
                );
            };
        } catch (err) {
            tracer.addException(err);
        }
        return wrappedFunction.apply(this, [subject, opts_internal, patchedCallback]);
    };
}

/**
 * Wraps nats connect function.
 * @param {Function} connectFunction nats connect function.
 * @return {Function} nats connect function response.
 */
function natsConnectWrapper(connectFunction) {
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalNatsConnectWrapper(url, opts) {
        const connectFunctionResponse = connectFunction.apply(this, [url, opts]);
        try {
            if (connectFunctionResponse && connectFunctionResponse.constructor) {
                if (connectFunctionResponse.constructor.name !== NATS_TYPES.mainWrappedFunction) {
                    return connectFunctionResponse;
                }
                const serverHostname = getServerHostname(connectFunctionResponse.currentServer);
                shimmer.wrap(connectFunctionResponse, 'subscribe', () => natsSubscribeWrapper(connectFunctionResponse.subscribe, serverHostname));
            }
        } catch (err) {
            tracer.addException(err);
        }
        return connectFunctionResponse;
    };
}

module.exports = {
    /**
     * Initializes the nats tracer
     */
    init() {
        const nats = tryRequire('nats');
        if (nats) {
            shimmer.wrap(nats, 'connect', natsConnectWrapper);
        }
    },
};
