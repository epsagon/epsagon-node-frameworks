/* eslint-disable prefer-rest-params */
/**
 * @fileoverview Handlers for Express instrumentation
 */

const {
    tracer,
    utils,
    moduleUtils,
    config,
} = require('epsagon');
const expressRunner = require('../runners/express.js');
const { shouldIgnore } = require('../http.js');

/**
 * Express requests middleware that runs in context
 * @param {Request} req The Express's request data
 * @param {Response} res The Express's response data
 * @param {Function} next express function
 */
function expressMiddleware(req, res, next) {
    // Check if endpoint is ignored
    utils.debugLog('[express] - starting express middleware');
    const tracerObj = tracer.createTracer();
    if (shouldIgnore(req.originalUrl, req.headers)) {
        utils.debugLog(`Ignoring request: ${req.originalUrl}`);
        next();
        return;
    }

    tracerObj.trace.setAppName(config.getConfig().appName);
    tracerObj.trace.setToken(config.getConfig().token);
    let expressEvent;
    const startTime = Date.now();
    try {
        expressEvent = expressRunner.createRunner(req, startTime);
        utils.debugLog('[express] - created runner');
        // Handle response
        const requestPromise = new Promise((resolve) => {
            utils.debugLog('[express] - creating response promise');
            res.once('finish', function handleResponse() {
                utils.debugLog('[express] - got finish event, handling response');
                if (
                    ((process.env.EPSAGON_ALLOW_NO_ROUTE || '').toUpperCase() !== 'TRUE') &&
                    (!req.route)
                ) {
                    utils.debugLog('[express] - req.route not set - not reporting trace');
                    return;
                }
                try {
                    expressRunner.finishRunner(expressEvent, this, req, startTime);
                    utils.debugLog('[express] - finished runner');
                } catch (err) {
                    tracer.addException(err);
                }
                utils.debugLog('[express] - sending trace');
                tracer.sendTrace(() => {}, tracerObj).then(resolve).then(() => {
                    utils.debugLog('[express] - trace sent + request resolved');
                });
            });
        });
        tracerObj.trace.addEvent(expressEvent, requestPromise);
        tracerObj.currRunner = expressEvent;
        utils.debugLog('[express] - added runner');

        // Inject trace functions
        const { label, setError, getTraceUrl } = tracer;
        req.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
    } catch (err) {
        utils.debugLog('[express] - general catch');
        utils.debugLog(err);
    } finally {
        utils.debugLog('[express] - general finally');
        next();
    }
}


/**
 * Wraps the Express module request function with tracing
 * @param {Function} wrappedFunction Express init function
 * @return {Function} updated wrapped init
 */
function expressWrapper(wrappedFunction) {
    utils.debugLog('[express] - wrapping express');
    return function internalExpressWrapper() {
        utils.debugLog('[express] - express app created');
        const result = wrappedFunction.apply(this, arguments);
        utils.debugLog('[express] - called the original function');
        this.use(expressMiddleware);
        return result;
    };
}

/**
 * Wraps the Express module listen function in order to add the last error middleware
 * @param {Function} wrappedFunction Express listen function
 * @return {Function} updated wrapped listen
 */
function expressListenWrapper(wrappedFunction) {
    return function internalExpressListenWrapper() {
        const result = wrappedFunction.apply(this, arguments);
        this.use((err, req, _res, next) => {
            // Setting the express err as an Epsagon err
            if (err && req.epsagon) {
                req.epsagon.setError({
                    name: 'Error',
                    message: err.message,
                    stack: err.stack,
                });
                return next(err);
            }
            return next();
        });
        return result;
    };
}

module.exports = {
    /**
     * Initializes the Express tracer
     */
    init() {
        moduleUtils.patchModule(
            'express',
            'init',
            expressWrapper,
            express => express.application
        );
        moduleUtils.patchModule(
            'express',
            'listen',
            expressListenWrapper,
            express => express.application
        );
    },
};
