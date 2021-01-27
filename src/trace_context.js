/**
 * @fileoverview Tracer context for managing multiple tracers
 */

const { utils } = require('epsagon');
const asyncHooks = require('async_hooks');
const semver = require('semver');

// https://github.com/nodejs/node/issues/19859
const hasKeepAliveBug = !semver.satisfies(process.version, '^8.13 || >=10.14.2');

let tracers = {};
const weaks = new WeakMap();

/**
 * Destroys the tracer of an async context
 * @param {Number} asyncId The id of the async thread
 * @param {Boolean} forceDelete Force delete all traces relationships
 */
function destroyAsync(asyncId, forceDelete = false) {
    if (forceDelete) {
        const asyncTrace = tracers[asyncId];
        Object.entries(tracers).forEach(([key, tracer]) => {
            if (asyncTrace === tracer) {
                delete tracers[key];
            }
        });
    } else if (tracers[asyncId] && !tracers[asyncId].withRelationship) {
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
 * @param {boolean} withRelationship sets with relationship if needed
 */
function setAsyncReference(asyncId, withRelationship = false) {
    if (!tracers[asyncId]) return;
    const currentAsyncId = asyncHooks.executionAsyncId();
    tracers[currentAsyncId] = tracers[asyncId];
    if (tracers[currentAsyncId] && !tracers[currentAsyncId].withRelationship) {
        tracers[currentAsyncId].withRelationship = withRelationship;
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
        tracers = {};
    }
}

/**
 * run ttl checks and remove the relevant tracers
 * @param {Function} shouldDelete    predicate to check if a tracer should be deleted
 */
function privateCheckTTLConditions(shouldDelete) {
    const passedTTL = Object
        .entries(tracers)
        .filter(([, tracer]) => shouldDelete(tracer));

    if (passedTTL.length) {
        utils.debugLog(`[resource-monitor] found ${passedTTL.length} tracers to remove`);
        utils.debugLog(`[resource-monitor] tracers before delete: ${Object.values(tracers).length}`)
        passedTTL.forEach(([id]) => {
            delete tracers[id];
        });

        utils.debugLog(`[resource-monitor] tracers after delete: ${Object.values(tracers).length}`)
    }

}

module.exports = {
    get,
    init,
    setAsyncReference,
    destroyAsync,
    RunInContext,
    privateClearTracers,
    privateCheckTTLConditions,
};
