/**
 * @fileoverview Wraps http calls to support async context propagation
 */
const asyncHooks = require('async_hooks');
const shimmer = require('shimmer');
const http = require('http');

const {
    tracer,
    utils,
    // moduleUtils,
} = require('../epsagon-node/src');
const traceContext = require('../trace_context.js');

/**
 * doc
 */
function parseArgs(a, b, c) {
    let url = a;
    let options = b;
    let callback = c;
    // handling case of request(options, callback)
    if (!(['string', 'URL'].includes(typeof url)) && !callback) {
        callback = b;
        options = a;
        url = undefined;
    }
    // handling case of request(url, callback)
    if ((typeof options === 'function') && (!callback)) {
        callback = options;
        options = null;
    }
    // handling case of got.post(url, options)
    if (a.constructor && a.constructor.name === 'URL' && typeof b === 'object' && !c) {
        url = a;
        url.path = url.pathname;
        options = b;
        callback = undefined;
    }
    return { url, options, callback };
}

/**
 * Wraps the http send command function with tracing
 * @param {Module} module The wrapped function from http module
 * @returns {Function} The wrapped function
 */
function httpGetWrapper(module) {
    return function internalHttpGetWrapper(url, options, callback) {
        const req = module.request(url, options, callback);
        req.end();
        return req;
    };
}

/**
 * Wraps the http send command function with tracing
 * @param {Function} wrappedFunction The wrapped function from http module
 * @returns {Function} The wrapped function
 */
function httpWrapper(wrappedFunction) {
    return function internalHttpGetWrapper(a, b, c) {
        const { url, options, callback } = parseArgs(a, b, c);
        const tracerObj = tracer.getTrace();
        utils.debugLog(`EREZ DEBUG:: inside internalHttpGetWrapper asyncId: ${asyncHooks.executionAsyncId()}`);
        const patchedCallback = (res) => { // eslint-disable-line no-param-reassign
            traceContext.setAsyncReference(tracerObj);

            if (callback && typeof callback === 'function') {
                callback(res);
            }
            return null;
        };
        return wrappedFunction.apply(this, [url, options, patchedCallback]);
    };
}

module.exports = {
    /**
   * Initializes the Http tracer
   */
    init() {
        shimmer.wrap(http, 'get', () => httpGetWrapper(http));
        shimmer.wrap(http, 'request', httpWrapper);
        // moduleUtils.patchModule(
        //     'http',
        //     'get',
        //     httpGetWrapper,
        //     http => http.prototype
        // );
    },
};
