/**
 * @fileoverview Tracer context for managing multiple tracers
 */

const asyncHooks = require('async_hooks');
const { eventInterface, tracer: originalTracer, utils } = require('epsagon');
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
 * @param {Tracer} tracerObj A tracerObject to set
 */
function setAsyncReference(tracerObj) {
    if (!tracerObj) {
        return;
    }
    const currentAsyncId = asyncHooks.executionAsyncId();
    tracers[currentAsyncId] = tracerObj;
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
    if (tracer != null) {
        tracer.relatedAsyncIds = new Set();
        tracer.mainAsyncIds = new Set();
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
    originalTracer.getTrace = get;
}

/**
 * clear the current traces in the context
 * @param {Number} maxTracers  maximum number of allowed tracers
 */
function privateClearTracers(maxTracers) {
    if (Object.keys(tracers).length > maxTracers) {
        utils.debugLog(`[resource-monitor] found ${Object.keys(tracers).length}, deleting`);

        Object.values(tracers).forEach((tracer) => {
            eventInterface.addToMetadata(tracer.currRunner, { instrum_cleared_hourly: true });
        });

        tracers = {};
    }
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
        utils.debugLog(`[resource-monitor] found ${passedTTL.length} tracers to remove`);
        utils.debugLog(`[resource-monitor] tracers before delete: ${Object.values(tracers).length}`);

        passedTTL.forEach((tracer) => {
            eventInterface.addToMetadata(tracer.currRunner, { instrum_cleared_ttl: true });
            tracer.relatedAsyncIds.forEach((id) => {
                delete tracers[id];
            });
        });

        utils.debugLog(`[resource-monitor] tracers after delete: ${Object.values(tracers).length}`);
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
};
