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
 * Remove hooks and related hooks from tracers dictionary
 * @param {*} hookId hookId to remove
 */
function removeRelatedHooks(hookId) {
    if (tracers[hookId] && tracers[hookId].relatedHooks) {
        let clonedRelatedHooks = new Set(tracers[hookId].relatedHooks);
        let index = 0;
        while (index < clonedRelatedHooks.size) {
            const arrayOfRelatedHooks = [...clonedRelatedHooks];
            const currentTrace = tracers[arrayOfRelatedHooks[index]];
            delete tracers[arrayOfRelatedHooks[index]];
            if (currentTrace && currentTrace.relatedHooks) {
                clonedRelatedHooks =
                new Set([...arrayOfRelatedHooks, ...currentTrace.relatedHooks]);
            }
            index += 1;
        }
    }
    delete tracers[hookId];
}

/**
 * Destroys the tracer of an async context
 * @param {Number} asyncId The id of the async thread
 * @param {Boolean} forceDelete Force delete all traces relationships
 */
function destroyAsync(asyncId, forceDelete = false) {
    if (forceDelete) {
        removeRelatedHooks(asyncId);
    } else if (tracers[asyncId] && !tracers[asyncId].relatedHooks) {
        delete tracers[asyncId];
    }
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
        tracers[asyncId] = { ...tracers[triggerAsyncId] };
    } else if (tracers[asyncHooks.executionAsyncId()]) {
        tracers[asyncId] = { ...tracers[asyncHooks.executionAsyncId()] };
    }
    if (tracers[asyncId] && tracers[asyncId].relatedHooks) {
        tracers[asyncId].relatedHooks.add(asyncHooks.executionAsyncId());
        tracers[asyncId].relatedHooks.add(triggerAsyncId);
        tracers[asyncId].relatedHooks.add(asyncId);
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
    if (!tracers[asyncHooks.executionAsyncId()].relatedHooks) {
        tracers[asyncHooks.executionAsyncId()].relatedHooks = new Set();
    }
    tracers[asyncHooks.executionAsyncId()].relatedHooks.add(asyncId);
    tracers[asyncHooks.executionAsyncId()].relatedHooks.add(asyncHooks.triggerAsyncId());
    tracers[asyncHooks.executionAsyncId()].relatedHooks.add(asyncHooks.executionAsyncId());
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
    destroyAsync,
    RunInContext,
};
