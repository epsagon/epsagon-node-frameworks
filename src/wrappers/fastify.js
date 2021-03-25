/* eslint-disable prefer-rest-params,no-underscore-dangle */
/**
 * @fileoverview Handlers for Fastify instrumentation
 */

const {
    tracer,
    utils,
    moduleUtils,
    eventInterface,
    httpHelpers,
} = require('epsagon');
const traceContext = require('../trace_context.js');
const fastifyRunner = require('../runners/fastify.js');
const { shouldIgnore } = require('../http.js');


/**
 * Terminates the running Fastify (runner)
 * @param {Object} tracerObj trace object
 * @param {Object} fastifyEvent runner's fastify event
 * @param {Response} reply response data
 * @param {Request} request The Fastify's request data
 * @param {Int} startTime Runner start time
 * @param {Function} resolve runner promise resolve function
 * @param {String} reqBody request body
 */
function handleResponse(tracerObj, fastifyEvent, reply, request, startTime, resolve, reqBody) {
    traceContext.setAsyncReference(tracerObj);
    traceContext.setMainReference();
    utils.debugLog('[fastify] - got close event, handling response');
    try {
        fastifyRunner.finishRunner(fastifyEvent, reply, request, startTime, reqBody);
        utils.debugLog('[fastify] - finished runner');
    } catch (err) {
        tracer.addException(err);
    }
    utils.debugLog('[fastify] - sending trace');
    tracer.sendTrace(() => {}, tracerObj).then(resolve).then(() => {
        utils.debugLog('[fastify] - trace sent + request resolved');
    });
}

/**
 * Fastify requests middleware that runs in context
 * @param {Request} request The Fastify's request data
 * @param {Response} reply The Fastify's response data
 */
function fastifyMiddleware(request, reply) {
    // Check if endpoint is ignored
    traceContext.setMainReference();
    utils.debugLog('[fastify] - starting middleware');
    const tracerObj = tracer.getTrace();
    if (!tracerObj) {
        utils.debugLog('[fastify] - no tracer found on init');
    }
    if (shouldIgnore(request.url, request.headers)) {
        utils.debugLog(`Ignoring request: ${request.url}`);
        return;
    }
    const chunks = [];
    request.raw.on('data', chunk => httpHelpers.addChunk(chunk, chunks));

    tracer.restart();
    let fastifyEvent;
    const startTime = Date.now();
    try {
        fastifyEvent = fastifyRunner.createRunner(request, startTime);
        utils.debugLog('[fastify] - created runner');
        // Handle response
        const requestPromise = new Promise((resolve) => {
            let isFinished = false;
            traceContext.setAsyncReference(tracerObj);
            utils.debugLog('[fastify] - creating response promise');

            reply.raw.once('finish', () => {
                utils.debugLog('[fastify] - got to finish event');
                if (!isFinished) {
                    isFinished = true;
                    handleResponse(
                        tracerObj,
                        fastifyEvent,
                        reply,
                        request,
                        startTime,
                        resolve,
                        Buffer.concat(chunks).toString()
                    );
                }
            });
            reply.raw.once('close', () => {
                utils.debugLog('[fastify] - got to close event');
                if (!isFinished) {
                    isFinished = true;
                    handleResponse(
                        tracerObj,
                        fastifyEvent,
                        reply,
                        request,
                        startTime,
                        resolve,
                        Buffer.concat(chunks).toString()
                    );
                }
            });
        });

        request.context._EPSAGON_EVENT = fastifyEvent;
        if (!request.context._originalErrorHandler) {
            request.context._originalErrorHandler = request.context.errorHandler;
            request.context.errorHandler = (err, req, rep) => {
                eventInterface.setException(req.context._EPSAGON_EVENT, err);
                request.context._originalErrorHandler(err, req, rep);
            };
        }

        tracer.addRunner(fastifyEvent, requestPromise);
        utils.debugLog('[fastify] - added runner');

        // Inject trace functions
        const { label, setError, getTraceUrl } = tracer;
        request.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        traceContext.setMainReference(false);
    } catch (err) {
        utils.debugLog('[fastify] - general catch');
        utils.debugLog(err);
    } finally {
        utils.debugLog('[fastify] - general finally');
    }
}

/**
 * Wraps the Fastify module request function with tracing
 * @param {Function} wrappedFunction Fastify init function
 * @return {Function} updated wrapped init
 */
function fastifyWrapper(wrappedFunction) {
    utils.debugLog('[fastify] - wrapping');
    return function internalFastifyWrapper(functions, runner, request, reply, cb) {
        try {
            if (cb && cb instanceof Function && cb.name !== 'runPreParsing') {
                utils.debugLog('[fastify] - incoming callback type is not runPreParsing');
                return wrappedFunction.apply(this, arguments);
            }
            utils.debugLog('[fastify] - incoming request');
            if (traceContext.isTracingEnabled()) {
                traceContext.RunInContext(
                    tracer.createTracer,
                    () => fastifyMiddleware(request, reply)
                );
            }
        } catch (err) {
            utils.debugLog(`[fastify] - failed wrapping ${err}`);
        }
        utils.debugLog('[fastify] - calling the original function');
        return wrappedFunction.apply(this, arguments);
    };
}

module.exports = {
    /**
     * Initializes the Fastify tracer
     */
    init() {
        moduleUtils.patchModule(
            'fastify/lib/hooks.js',
            'hookRunner',
            fastifyWrapper
        );
    },
};
