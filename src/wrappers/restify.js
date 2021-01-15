/**
 * @fileoverview Handlers for Restify instrumentation
 */

const {
    tracer,
    utils,
    moduleUtils,
} = require('epsagon');
const traceContext = require('../trace_context.js');
const restifyRunner = require('../runners/restify.js');
const { shouldIgnore } = require('../http.js');

const METHODS = ['get', 'post', 'put', 'patch', 'head', 'opts', 'del'];


/**
 * Restify requests middleware that runs in context
 * @param {IncomingRequest} req Restify request
 * @param {ServerResponse} res Restify response
 * @param {function} next restify function
 * @param {function} originalCallback original handler
 * @returns {Object} runnerResult Promise or result object
 */
function restifyMiddleware(req, res, next, originalCallback) {
    let originalHandlerSyncErr;
    let runnerResult;
    let restifyEvent;
    let sendTracePromise = Promise.resolve();
    const startTime = Date.now();
    try {
        if (shouldIgnore(req.url, req.headers)) {
            utils.debugLog(`Ignoring request: ${req.url}`);
            return originalCallback(req, res, next);
        }

        // Initialize tracer and runner.
        tracer.restart();
        restifyEvent = restifyRunner.createRunner(req, startTime);

        tracer.addRunner(restifyEvent);

        const { label, setError, getTraceUrl } = tracer;
        // eslint-disable-next-line no-param-reassign
        req.epsagon = {
            label,
            setError,
            getTraceUrl,
        };

        try {
            runnerResult = originalCallback(req, res, next);
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
                restifyRunner.finishRunner(
                    restifyEvent,
                    req,
                    res,
                    startTime,
                    originalHandlerAsyncError
                );
                tracer.sendTrace(() => {});
            });
        } else {
            // Finalize sync user function.
            restifyRunner.finishRunner(restifyEvent, req, res, startTime, originalHandlerSyncErr);
            sendTracePromise = tracer.sendTrace(() => {});
        }
    } catch (err) {
        tracer.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        sendTracePromise.then(() => {
            throw originalHandlerSyncErr;
        });
    } else {
        return runnerResult;
    }
    return runnerResult;
}


/**
 * Wraps the Restify module request function with tracing
 * @param {Function} wrappedFunction Restify use function
 * @return {Function} updated wrapped use
 */
function restifyWrapper(wrappedFunction) {
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalRestifyWrapper(opts, callback) {
        const originalCallback = callback;
        const patchedCallback = (req, res, next) => traceContext.RunInContext(
            tracer.createTracer,
            () => restifyMiddleware(req, res, next, originalCallback)
        );
        return wrappedFunction.apply(this, [opts, patchedCallback]);
    };
}


module.exports = {
    /**
     * Initializes the Restify tracer
     */
    init() {
        // Loop over http methods and patch them all with method wrapper
        for (let i = 0; i < METHODS.length; i += 1) {
            moduleUtils.patchModule(
                'restify/lib/server',
                METHODS[i],
                restifyWrapper,
                server => server.prototype
            );
        }
    },
};
