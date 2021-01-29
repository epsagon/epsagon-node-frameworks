/**
 * @fileoverview Tracer context for managing multiple tracers
 */

const asyncHooks = require('async_hooks');
const semver = require('semver');

// https://github.com/nodejs/node/issues/19859
const hasKeepAliveBug = !semver.satisfies(process.version, '^8.13 || >=10.14.2');
let tracingEnabled = true;

let tracers = {};
const weaks = new WeakMap();

/**
 * Destroys the tracer of an async context
 * @param {Number} asyncId The id of the async thread
 */
function destroyAsync(asyncId) {
    if (tracers[asyncId] && tracers[asyncId].mainAsyncIds.has(asyncId)) {
        const asyncTracer = tracers[asyncId];
        asyncTracer.relatedAsyncIds.forEach((temporaryAsyncId) => {
            delete tracers[temporaryAsyncId];
        });
        asyncTracer.relatedAsyncIds.clear();
        asyncTracer.mainAsyncIds.clear();
    } else if (tracers[asyncId]) {
        tracers[asyncId].relatedAsyncIds.delete(asyncId);
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
        tracers[asyncId] = tracers[triggerAsyncId];
        tracers[asyncId].relatedAsyncIds.add(asyncId);
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
    const currentAsyncId = asyncHooks.executionAsyncId();
    tracers[currentAsyncId] = tracers[asyncId];
    tracers[currentAsyncId].relatedAsyncIds.add(currentAsyncId);
}


/**
 * Sets the current execution Async Id as main.
 * This means that when this Async Id object is deleted
 * all references to the tracer will be removed
 * @param {Boolean} add Should the current async id be added as main,
 *    if false then if will be removed
 */
function setMainReference(add = true) {
    const currentAsyncId = asyncHooks.executionAsyncId();
    if (!tracers[currentAsyncId]) return;
    if (add) {
        tracers[currentAsyncId].mainAsyncIds.add(currentAsyncId);
    } else {
        tracers[currentAsyncId].mainAsyncIds.delete(currentAsyncId);
    }
}


/**
 * Creates an active context for tracer and run the handle
 * @param {Function} createTracer create a tracer object
 * @param {Function} handle function to run the context in
 * @returns {Object} The return value
 */
function RunInContext(createTracer, handle) {
    const tracer = createTracer();
    tracer.relatedAsyncIds = new Set();
    tracer.mainAsyncIds = new Set();
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

/**
 * clear the current traces in the context
 * @param {Number} maxTracers  maximum number of allowed tracers
 */
function privateClearTracers(maxTracers) {
    if (Object.keys(tracers).length > maxTracers) {
        console.log(`[resource-monitor] found ${tracers.length}, deleting`);
        tracers = {};
    }
}

/**
 * documentation
 */
function superClear() {
    Object.keys(tracers).forEach((key) => { delete tracers[key]; });
}

/**
 * run ttl checks and remove the relevant tracers
 * @param {Function} shouldDelete    predicate to check if a tracer should be deleted
 */
function privateCheckTTLConditions(shouldDelete) {
    const passedTTL = [...new Set(Object
        .values(tracers))]
        .filter(tracer => shouldDelete(tracer));

    if (passedTTL.length) {
        console.log(`[resource-monitor] found ${passedTTL.length} tracers to remove`);
        console.log(`[resource-monitor] tracers before delete: ${Object.values(tracers).length}`);

        passedTTL.forEach((tracer) => {
            tracer.relatedAsyncIds.forEach((id) => {
                delete tracers[id];
            });
        });

        console.log(`[resource-monitor] tracers after delete: ${Object.values(tracers).length}`);
    }
}

/**
 * disable tracing globaly
 * sets a flag, each middleware wrapper should check when running
 */
function disableTracing() {
    tracingEnabled = false;
}

/** @returns {Boolean}  tracing enabled flag */
function isTracingEnabled() {
    return tracingEnabled;
}

module.exports = {
    get,
    init,
    setAsyncReference,
    destroyAsync,
    RunInContext,
    privateClearTracers,
    privateCheckTTLConditions,
    disableTracing,
    isTracingEnabled,
    setMainReference,
    superClear,
};
