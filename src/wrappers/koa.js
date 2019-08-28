/* eslint-disable prefer-rest-params,no-underscore-dangle */
/**
 * @fileoverview Handlers for Koa instrumentation
 */

const shimmer = require('shimmer');
const {
    tracer,
    utils,
    tryRequire,
} = require('epsagon');
const traceContext = require('../trace_context.js');
const koaRunner = require('../runners/koa.js');
const { ignoredEndpoints } = require('../http.js');

const Koa = tryRequire('koa/lib/application.js');

/**
 * Koa requests middleware that runs in context
 * @param {Context} ctx The Koa's context data
 * @param {Function} next Koa function
 */
async function koaMiddleware(ctx, next) {
    // Check if endpoint is ignored
    if (ignoredEndpoints().includes(ctx.request.originalUrl)) {
        utils.debugLog(`Ignoring request: ${ctx.request.originalUrl}`);
        next();
        return;
    }

    tracer.restart();
    let koaEvent;
    const startTime = Date.now();
    try {
        koaEvent = koaRunner.createRunner(ctx.request, startTime);
        // Handle response
        const requestPromise = new Promise((resolve) => {
            ctx.res.once('finish', () => {
                if (ctx.response.status === 404) {
                    return;
                }
                try {
                    koaRunner.finishRunner(koaEvent, ctx.response, ctx.request, startTime);
                } catch (err) {
                    tracer.addException(err);
                }
                tracer.sendTrace(() => {}).then(resolve);
            });
        });
        tracer.addRunner(koaEvent, requestPromise);

        // Inject trace functions
        const { label, setError } = tracer;
        ctx.epsagon = {
            label,
            setError,
        };
    } catch (err) {
        utils.debugLog(err);
    } finally {
        next();
    }
}


/**
 * Wraps the Koa module request function with tracing
 * @param {Function} wrappedFunction Koa use function
 * @return {Function} updated wrapped use
 */
function koaWrapper(wrappedFunction) {
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalKoaWrapper() {
        const result = wrappedFunction.apply(this, arguments);
        if (this.__EPSAGON_PATCH) {
            return result;
        }
        this.__EPSAGON_PATCH = true;
        this.use(
            (ctx, next) => traceContext.RunInContext(
                tracer.createTracer,
                () => koaMiddleware(ctx, next)
            )
        );
        return result;
    };
}


module.exports = {
    /**
     * Initializes the Koa tracer
     */
    init() {
        if (Koa) {
            shimmer.wrap(Koa.prototype, 'use', koaWrapper);
        }
    },
};
