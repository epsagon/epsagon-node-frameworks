/* eslint-disable prefer-rest-params,no-underscore-dangle */
/**
 * @fileoverview Handlers for Koa instrumentation
 */

const {
    tracer,
    utils,
    moduleUtils,
} = require('epsagon');
const traceContext = require('../trace_context.js');
const koaRunner = require('../runners/koa.js');
const { shouldIgnore } = require('../http.js');


/**
 * Koa requests middleware that runs in context
 * @param {Context} ctx The Koa's context data
 * @param {Function} next Koa function
 */
async function koaMiddleware(ctx, next) {
    // Check if endpoint is ignored
    if (shouldIgnore(ctx.request.originalUrl, ctx.request.headers)) {
        utils.debugLog(`Ignoring request: ${ctx.request.originalUrl}`);
        await next();
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
        const { label, setError, getTraceUrl } = tracer;
        ctx.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
    } catch (err) {
        utils.debugLog(err);
    } finally {
        await next();
    }
}


/**
 * Wraps the Koa module request function with tracing
 * @param {Function} wrappedFunction Koa use function
 * @return {Function} updated wrapped use
 */
function koaWrapper(wrappedFunction) {
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

        // Wrap error events
        this.on('error', async (err, ctx) => {
            if (ctx.epsagon) {
                await ctx.epsagon.setError(err);
            }
        });
        return result;
    };
}


module.exports = {
    /**
     * Initializes the Koa tracer
     */
    init() {
        moduleUtils.patchModule(
            'koa/lib/application.js',
            'use',
            koaWrapper,
            Koa => Koa.prototype
        );
    },
};
