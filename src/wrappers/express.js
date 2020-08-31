/* eslint-disable prefer-rest-params */
/**
 * @fileoverview Handlers for Express instrumentation
 */

const uuid4 = require('uuid4')
const {
    tracer,
    utils,
    moduleUtils,
} = require('epsagon');
const traceContext = require('../trace_context.js');
const expressRunner = require('../runners/express.js');
const { ignoredEndpoints } = require('../http.js');

/**
 * Express requests middleware that runs in context
 * @param {Request} req The Express's request data
 * @param {Response} res The Express's response data
 * @param {Function} next express function
 */
function expressMiddleware(req, res, next) {
    // Check if endpoint is ignored
    utils.debugLog('Epsagon Express - starting express middleware');
    if (ignoredEndpoints().includes(req.originalUrl)) {
        utils.debugLog(`Ignoring request: ${req.originalUrl}`);
        next();
        return;
    }

    tracer.restart();
    let expressEvent;
    const startTime = Date.now();
    const epsagonIdentifier = uuid4();
    try {
        // Add epsagon id to 
        req._epsagon_id = epsagonIdentifier
        tracer.getTrace = () => {
            return traceContext.get(epsagonIdentifier)
        }
        expressEvent = expressRunner.createRunner(req, startTime);
        utils.debugLog('Epsagon Express - created runner');
        // Handle response
        const requestPromise = new Promise((resolve) => {
            utils.debugLog('Epsagon Express - creating response promise');
            res.once('finish', function handleResponse() {
                utils.debugLog('Epsagon Express - got finish event, handling response');
                if (
                    ((process.env.EPSAGON_ALLOW_NO_ROUTE || '').toUpperCase() !== 'TRUE') &&
                    (!req.route)
                ) {
                    utils.debugLog('Epsagon Express - req.route not set - not reporting trace');
                    return;
                }
                try {
                    expressRunner.finishRunner(expressEvent, this, req, startTime);
                    utils.debugLog('Epsagon Express - finished runner');
                } catch (err) {
                    tracer.addException(err);
                }
                utils.debugLog('Epsagon Express - sending trace');
                tracer.sendTrace(() => {}).then(resolve).then(() => {
                    utils.debugLog('Epsagon Express - trace sent + request resolved');
                });
            });
        });
        tracer.addRunner(expressEvent, requestPromise);
        utils.debugLog('Epsagon Express - added runner');

        // Inject trace functions
        const { label, setError } = tracer;
        req.epsagon = {
            label,
            setError,
        };
    } catch (err) {
        utils.debugLog('Epsagon Express - general catch');
        utils.debugLog(err);
    } finally {
        utils.debugLog('Epsagon Express - general finally');
        next();
    }
}

/**
 * 
 * @param {*} req 
 * @param {*} next 
 */
function wrapNext (req, next) {
   const originalNext = next

  return function (error) {
    if (error) {
        utils.debugLog('Epsagon Next - middleware executed');
        utils.debugLog(error);
    }
    traceContext.setTraceToEpsagonId(req._epsagon_id)
    originalNext.apply(null, arguments)
    traceContext.setTraceToEpsagonId(req._epsagon_id)
  }
}


/**
 * Wraps the Express module request function with tracing
 * @param {Function} wrappedFunction Express init function
 * @return {Function} updated wrapped init
 */
function expressWrapper(wrappedFunction) {
    utils.debugLog('Epsagon Express - wrapping express');
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalExpressWrapper() {
        utils.debugLog('Epsagon Express - express app created');
        const result = wrappedFunction.apply(this, arguments);
        utils.debugLog('Epsagon Express - called the original function');
        this.use(
            (req, res, next) => traceContext.RunInContext(
                tracer.createTracer,
                () => expressMiddleware(req, res, wrapNext(req, next))
            )
        );
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
    },
};
