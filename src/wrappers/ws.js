/**
 * @fileoverview Handlers for WS instrumentation
 */

const {
    tracer,
    moduleUtils,
    eventInterface,
    utils,
} = require('epsagon');
const traceContext = require('../trace_context.js');

/**
 * @param {Socket} socket socket object.
 * @return {string} socket address.
 */
const getWebsocketAddress = socket => (socket ? socket.localAddress : 'websocket');


/**
 * Handle event emitter of eventName='message'
 * @param {Message} message received message.
 * @param {*} originalHandler listener callback function.
 * @param {*} requestFunctionThis request arguments.
 */
function websocketEmitterMiddleware(message, originalHandler, requestFunctionThis) {
    let originalHandlerSyncErr;

    try {
        // Initialize tracer and evnets.
        tracer.restart();
        const { slsEvent: websocketEvent, startTime: websocketStartTime } =
        eventInterface.initializeEvent(
            'websocket',
            // eslint-disable-next-line no-underscore-dangle
            getWebsocketAddress(requestFunctionThis._socket),
            'messagePullingListener',
            'trigger'
        );
        tracer.addEvent(websocketEvent);
        // Getting message data.
        const triggerMetadata = { message };
        eventInterface.finalizeEvent(websocketEvent, websocketStartTime, null, triggerMetadata);

        const { label, setError, getTraceUrl } = tracer;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface.initializeEvent(
            'node_function', 'message_handler', 'execute', 'runner'
        );
        let runnerResult;
        try {
            runnerResult = originalHandler(message, {});
        } catch (err) {
            originalHandlerSyncErr = err;
        }
        const originalHandlerName = originalHandler.name;
        if (originalHandlerName) {
            nodeEvent.getResource().setName(originalHandlerName);
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
 * Wraps websocket event emitter function with tracing.
 * @param {Function} wrappedFunction websocket init function
 * @return {Function} updated wrapped init
 */
function websocketEmitterWrapper(wrappedFunction) {
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalWebSocketEmitterWrapper(eventName, callback) {
        if (eventName !== 'message') {
            return wrappedFunction.apply(this, [eventName, callback]);
        }
        const requestFunctionThis = this;
        const patchedCallback = message => traceContext.RunInContext(
            tracer.createTracer,
            () => websocketEmitterMiddleware(message, callback, requestFunctionThis)
        );
        return wrappedFunction.apply(this, [eventName, patchedCallback]);
    };
}

module.exports = {
    /**
     * Initializes the websocket tracer
     */
    init() {
        moduleUtils.patchModule(
            'ws',
            'on',
            websocketEmitterWrapper,
            websocket => websocket.prototype
        );
    },
};
