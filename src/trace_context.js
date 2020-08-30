/**
 * @fileoverview Tracer context for managing multiple tracers
 */

const asyncHooks = require('async_hooks');
const semver = require('semver');

// https://github.com/nodejs/node/issues/19859
const hasKeepAliveBug = !semver.satisfies(process.version, '^8.13 || >=10.14.2');

const tracers = {};
const weaks = new WeakMap();

/**
 * Destroys the tracer of an async context
 * @param {Number} asyncId The id of the async thread
 */
function destroyAsync(asyncId) {
    delete tracers[asyncId];
}

/**
 * Initializes the tracer of an async context. Uses the parent tracer, if exists
 * @param {Number} asyncId The id of the async thread
 * @param {String} type The type of the async thread
 * @param {Number} triggerAsyncId the id of the async thread that triggered the creation of this
 *     one
 * @param {String} resource The resource
 */
function initAsync(asyncId, type, triggerAsyncId, resource) {
    if (tracers[triggerAsyncId]) {
        tracers[asyncId] = tracers[triggerAsyncId];
    } else if (tracers[asyncHooks.executionAsyncId()]) {
        tracers[asyncId] = tracers[asyncHooks.executionAsyncId()];
    }

    if (hasKeepAliveBug && (type === 'TCPWRAP' || type === 'HTTPPARSER')) {
        destroyAsync(weaks.get(resource));
        weaks.set(resource, asyncId);
    }
}


/**
 * Creates a reference to another asyncId
 * @param {Number} asyncId sets the reference to this asyncId
 */
function setAsyncReference(asyncId) {
    if (!tracers[asyncId]) return;
    tracers[asyncHooks.executionAsyncId()] = tracers[asyncId];
    tracers[asyncHooks.triggerAsyncId()] = tracers[asyncId];
}


/**
 * Creates an active context for tracer and run the handle
 * @param {Function} createTracer create a tracer object
 * @param {Function} handle function to run the context in
 * @returns {Object} The return value
 */
function RunInContext(createTracer, handle) {
    const tracer = createTracer();
    if (tracer != null) {
        tracers[asyncHooks.executionAsyncId()] = tracer;
    }
    return handle();
}


/**
 * Returns the active trace
 * @return {Object} tracer object
 */
function get() {
    return tracers[asyncHooks.executionAsyncId()] || null;
}

/**
 * Initialize context namespace
 */
function init() {
    const hook = asyncHooks.createHook({
        init: initAsync,
        destroy: destroyAsync,
        promiseResolve: destroyAsync,
    });
    hook.enable();
}


module.exports = {
    get,
    init,
    setAsyncReference,
    RunInContext,
};
