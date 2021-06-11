/* eslint-disable prefer-rest-params */
/**
 * @fileoverview Handlers for http-server instrumentation
 */

const http = require('http');
const https = require('https');
const shimmer = require('shimmer');
const {
    tracer,
    utils,
    httpHelpers,
} = require('epsagon');
const traceContext = require('../trace_context.js');
const httpServerRunner = require('../runners/httpServer.js');
const { shouldIgnore } = require('../http.js');

/**
 * Wraps with promise http-server finish event
 * @param {Object} req The http-server's request data
 * @param {Object} tracerObj Epsagon's traces
 * @param {Object} httpEvent server event
 * @param {Date} startTime Event's start date
 * @param {Promise} resolve Promise resolved
 * @param {Object} parent Parent this
 * @param {string} module http/https
 * @param {Buffer} chunks request data buffer
 */
function handleHttpServerRequestFinished(
    req, tracerObj, httpEvent, startTime, resolve, parent, module, chunks
) {
    traceContext.setAsyncReference(tracerObj);
    traceContext.setMainReference();
    utils.debugLog('[http-server] - got close event, handling response');
    try {
        httpServerRunner.finishRunner(httpEvent, parent, req, startTime, module, chunks);
        utils.debugLog('[http-server] - finished runner');
    } catch (err) {
        tracer.addException(err);
    }
    utils.debugLog('[http-server] - sending trace');
    tracer.sendTrace(() => {}, tracerObj).then(resolve).then(() => {
        utils.debugLog('[http-server] - trace sent + request resolved');
    });
}

/**
 * http-server requests middleware that runs in context
 * @param {Request} req The http-server's request data
 * @param {Response} res The http-server's response data
 * @param {Function} requestListener original handler
 * @param {string} module http/https
 * @returns {object} original return handler
 */
function httpServerMiddleware(req, res, requestListener, module) {
    // Check if endpoint is ignored
    traceContext.setMainReference();
    utils.debugLog('[http-server] - starting middleware');
    const tracerObj = tracer.getTrace();
    if (!tracerObj) {
        utils.debugLog('[http-server] - no tracer found on init');
    }
    if (shouldIgnore(req.url, req.headers)) {
        utils.debugLog(`Ignoring request: ${req.url}`);
        return requestListener(req, res);
    }

    tracer.restart();
    let httpEvent;
    const chunks = [];
    const startTime = Date.now();
    try {
        httpEvent = httpServerRunner.createRunner(req, startTime);
        utils.debugLog('[http-server] - created runner');

        if ((process.env.EPSAGON_ENABLE_HTTP_BODY || '').toUpperCase() === 'TRUE') {
            req.on('data', (chunk) => {
                httpHelpers.addChunk(chunk, chunks);
            });
        }

        // Handle response
        const requestPromise = new Promise((resolve) => {
            traceContext.setAsyncReference(tracerObj);
            utils.debugLog('[http-server] - creating response promise');
            res.once('finish', function handleResponse() {
                handleHttpServerRequestFinished(
                    req,
                    tracerObj,
                    httpEvent,
                    startTime,
                    resolve,
                    this,
                    module,
                    chunks
                );
            });
        });
        tracer.addRunner(httpEvent, requestPromise);
        utils.debugLog('[http-server] - added runner');

        // Inject trace functions
        const { label, setError, getTraceUrl } = tracer;
        req.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        traceContext.setMainReference(false);
    } catch (err) {
        utils.debugLog('[http-server] - general catch');
        utils.debugLog(err);
    } finally {
        utils.debugLog('[http-server] - general finally');
    }
    return requestListener(req, res);
}


/**
 * Wraps the http-server module request function with tracing
 * @param {Function} wrappedFunction http-server init function
 * @param {string} module http/https
 * @return {Function} updated wrapped init
 */
function httpServerWrapper(wrappedFunction, module) {
    utils.debugLog('[http-server] - wrapping');
    return function internalHttpServerWrapper(a, b) {
        const requestListener = b || a;
        const options = b ? a : undefined;
        const patchedListener =
            (req, res) => (traceContext.isTracingEnabled() ? traceContext.RunInContext(
                tracer.createTracer,
                () => httpServerMiddleware(req, res, requestListener, module)
            ) : requestListener);
        return wrappedFunction.apply(this, [options, patchedListener]);
    };
}


module.exports = {
    /**
     * Initializes the http-server tracer
     */
    init() {
        shimmer.wrap(http, 'createServer', func => httpServerWrapper(func, 'http'));
        shimmer.wrap(https, 'createServer', func => httpServerWrapper(func, 'https'));
    },
};
