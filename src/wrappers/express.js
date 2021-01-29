/* eslint-disable prefer-rest-params */
/**
 * @fileoverview Handlers for Express instrumentation
 */

const asyncHooks = require('async_hooks');
const {
    tracer,
    utils,
    moduleUtils,
    eventInterface,
} = require('epsagon');
const traceContext = require('../trace_context.js');
const expressRunner = require('../runners/express.js');
const { shouldIgnore } = require('../http.js');
const { methods } = require('../consts');

/**
 * Express requests middleware that runs in context
 * @param {Request} req The Express's request data
 * @param {Response} res The Express's response data
 * @param {Function} next express function
 */
function expressMiddleware(req, res, next) {
    // Check if endpoint is ignored
    traceContext.setMainReference();
    utils.debugLog('[express] - starting express middleware');
    const tracerObj = tracer.getTrace();
    if (!tracerObj) {
        utils.debugLog('[express] - no tracer found on init');
    }
    const originalAsyncId = asyncHooks.executionAsyncId();
    if (shouldIgnore(req.originalUrl, req.headers)) {
        utils.debugLog(`Ignoring request: ${req.originalUrl}`);
        next();
        return;
    }

    tracer.restart();
    let expressEvent;
    const startTime = Date.now();
    try {
        expressEvent = expressRunner.createRunner(req, startTime);
        utils.debugLog('[express] - created runner');
        // Handle response
        const requestPromise = new Promise((resolve) => {
            traceContext.setAsyncReference(originalAsyncId);
            utils.debugLog('[express] - creating response promise');
            res.once('finish', function handleResponse() {
                traceContext.setMainReference();
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
                    traceContext.superClear();
                });
            });
        });
        tracer.addRunner(expressEvent, requestPromise);
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
        traceContext.setMainReference(false);
    }
}

/**
 * Wraps express next function that calls next middleware
 * @param {*} next express next middleware
 * @returns {*} wrapeed function
 */
function nextWrapper(next) {
    const asyncId = asyncHooks.executionAsyncId();
    const originalNext = next;
    return function internalNextWrapper(error) {
        utils.debugLog('[express] - middleware executed');

        if (error) {
            utils.debugLog(error);
        }

        traceContext.setAsyncReference(asyncId);
        const result = originalNext(...arguments);
        return result;
    };
}
/**
 * Wraps next with next wrapper.
 * @param {*} args - list of arguments
 * @return {*} - list of arguments with wrapped next function
 */
function getWrappedNext(args) {
    const copyArgs = [...args];
    const next = copyArgs[copyArgs.length - 1];
    if (next && next.name === 'next') {
        copyArgs[copyArgs.length - 1] = nextWrapper(args[args.length - 1]);
    }

    return copyArgs;
}


/**
 * Wraps clients middleware
 * @param {*} middleware - middleware to wrap
 * @returns {function} wrapped middleware
 */
function middlewareWrapper(middleware) {
    /* eslint-disable no-unused-vars */
    // length checks function argument quantity
    if (middleware.length === 4) {
        return function internalMiddlewareWrapper(error, req, res, next) {
            // Capture the error into the trace
            const tracerObj = tracer.getTrace();
            if (tracerObj && tracerObj.currRunner) {
                eventInterface.setException(tracerObj.currRunner, error);
            }

            return middleware.apply(this, getWrappedNext(arguments));
        };
    }
    return function internalMiddlewareWrapper(req, res, next) {
        return middleware.apply(this, getWrappedNext(arguments));
    };
    /* eslint-enable no-unused-vars */
}

/**
 * Wraps express http methods function
 * @param {*} original - original http method function
 * @returns {function} - wrapped http method function
 */
function methodWrapper(original) {
    return function internalMethodWrapper() {
        // Check if we have middlewares
        for (let i = 0; i < arguments.length - 1; i += 1) {
            if (arguments[i] && typeof arguments[i] === 'function') {
                arguments[i] = middlewareWrapper(arguments[i]);
            }
        }

        return original.apply(this, arguments);
    };
}

/**
 * Wraps express use function
 * @param {*} original - original use function
 * @returns {function} - wrapped use function
 */
function useWrapper(original) {
    return function internalUseWrapper() {
        // Check if we have middleware
        if (arguments.length > 1 && arguments[1] && typeof arguments[1] === 'function') {
            arguments[1] = middlewareWrapper(arguments[1]);
        }
        return original.apply(this, arguments);
    };
}


/**
 * Wraps the Express module request function with tracing
 * @param {Function} wrappedFunction Express init function
 * @return {Function} updated wrapped init
 */
function expressWrapper(wrappedFunction) {
    utils.debugLog('[express] - wrapping express');
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalExpressWrapper() {
        utils.debugLog('[express] - express app created');
        const result = wrappedFunction.apply(this, arguments);
        utils.debugLog('[express] - called the original function');
        this.use(
            (req, res, next) => (traceContext.isTracingEnabled() ? traceContext.RunInContext(
                tracer.createTracer,
                () => expressMiddleware(req, res, next)
            ) : next())
        );
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
            if (!traceContext.isTracingEnabled()) return next();

            // Setting the express err as an Epsagon err
            if (err) {
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
        moduleUtils.patchModule(
            'express',
            'use',
            useWrapper,
            express => express.Router
        );
        // Loop over http methods and patch them all with method wrapper
        for (let i = 0; i < methods.length; i += 1) {
            moduleUtils.patchModule(
                'express',
                methods[i],
                methodWrapper,
                express => express.Route.prototype
            );
        }
    },
};
