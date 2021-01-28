/**
 * @fileoverview Wraps mysql calls to support async context propagation
 */

const asyncHooks = require('async_hooks');
const http = require('http');
const https = require('https');
const shimmer = require('shimmer');
const { tracer } = require('../epsagon-node/src');
const { setAsyncReference } = require('../trace_context');


/**
 * Parses arguments for http wrapper
 * @param {object} a First http wrapper param
 * @param {object} b Second http wrapper param
 * @param {object} c Third http wrapper param
 * @returns {object} The params object { url, options, callback }
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
 * Builds the HTTP Params array
 * @param {string} url The URL, if exists
 * @param {object} options The Options object, if exists
 * @param {callback} callback The callback function, if exists
 * @returns {object} The params array
 */
function buildParams(url, options, callback) {
    if (url && options) {
        // in case of both input and options returning all three
        return [url, options, callback];
    }
    if (url && !options) {
        // in case of missing options returning only url and callback
        return [url, callback];
    }
    // url is missing - returning options and callback
    return [options, callback];
}


/**
 * Wraps the http's module request function with tracing
 * @param {Function} wrappedFunction The http's request module
 * @returns {Function} The wrapped function
 */
function httpWrapper(wrappedFunction) {
    return function internalHttpWrapper(a, b, c) {
        const { url, options, callback } = parseArgs(a, b, c);
        const originalAsyncId = asyncHooks.executionAsyncId();

        if (callback && callback.__epsagonCallback) { // eslint-disable-line no-underscore-dangle
            // we are already tracing this request. can happen in
            // https->http cases
            return wrappedFunction.apply(this, [a, b, c]);
        }
        let clientRequest = null;
        try {
            const patchedCallback = (res) => {
                setAsyncReference(originalAsyncId);
                if (callback && typeof callback === 'function') {
                    callback(res);
                }
            };
            clientRequest = wrappedFunction.apply(
                this, buildParams(url, options, patchedCallback)
            );
        } catch (error) {
            tracer.addException(error);
        }

        if (!clientRequest) {
            clientRequest = wrappedFunction.apply(this, [a, b, c]);
        }

        return clientRequest;
    };
}


module.exports = {
    /**
     * Initializes the http tracer
     */
    init() {
        shimmer.wrap(http, 'request', httpWrapper);
        shimmer.wrap(https, 'request', httpWrapper);
    },
};
