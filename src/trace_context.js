/**
 * @fileoverview Tracer context for managing multiple tracers
 */

const asyncHooks = require('async_hooks');
const semver = require('semver');
const uuid4 = require('uuid4');

// https://github.com/nodejs/node/issues/19859
const hasKeepAliveBug = !semver.satisfies(process.version, '^8.13 || >=10.14.2');
let tracingEnabled = true;

let tracers = {};
const weaks = new WeakMap();
const asyncIDToUUID = {};


/**
 * Destroy the tracer associated with asyncUuid if it exists
 * and asyncUuid is one of its mainAsyncIds.
 * @param {string} asyncUuid the async UUID to destroy.
 */
function maybeDestroyTracer(asyncUuid) {
    const tracer = tracers[asyncUuid];
    if (!tracer || !tracer.mainAsyncIds.has(asyncUuid)) return;

    tracer.relatedAsyncIds.forEach((relatedAsyncUuid) => {
        delete tracers[relatedAsyncUuid];
    });
    tracer.relatedAsyncIds.clear();
    tracer.mainAsyncIds.clear();
}


/**
 * Destroys the tracer of an async context
 * @param {Number} asyncId The id of the async thread
 */
function destroyAsync(asyncId) {
    const asyncUuid = asyncIDToUUID[asyncId];
    if (!asyncUuid) {
        return;
    }
    delete asyncIDToUUID[asyncId];

    maybeDestroyTracer(asyncUuid);
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
    const asyncUuid = uuid4();
    asyncIDToUUID[asyncId] = asyncUuid;

    const triggerAsyncUuid = asyncIDToUUID[triggerAsyncId];
    if (triggerAsyncUuid && tracers[triggerAsyncUuid]) {
        tracers[asyncUuid] = tracers[triggerAsyncUuid];
        tracers[asyncUuid].relatedAsyncIds.add(asyncUuid);
    }

    if (hasKeepAliveBug && (type === 'TCPWRAP' || type === 'HTTPPARSER')) {
        destroyAsync(weaks.get(resource));
        weaks.set(resource, asyncId);
    }
}


/**
 * get the async UUID of the currently active async ID.
 * @returns {null|*} the async UUID.
 */
function getAsyncUUID() {
    const currentAsyncId = asyncHooks.executionAsyncId();
    const currentAsyncUuid = asyncIDToUUID[currentAsyncId];
    if (!currentAsyncUuid) {
        return null;
    }

    return currentAsyncUuid;
}

/**
 * Creates a reference to another asyncId
 * @param {string} asyncUuid sets the reference to this asyncUuid
 */
function setAsyncReference(asyncUuid) {
    if (!asyncUuid) {
        return;
    }

    const tracer = tracers[asyncUuid];
    if (!tracer) {
        return;
    }

    const currentAsyncUuid = getAsyncUUID();
    if (!currentAsyncUuid) {
        return;
    }

    tracers[currentAsyncUuid] = tracer;
    tracer.relatedAsyncIds.add(currentAsyncUuid);
}


/**
 * Sets the current execution Async Id as main.
 * This means that when this Async Id object is deleted
 * all references to the tracer will be removed
 * @param {Boolean} add Should the current async id be added as main,
 *    if false then if will be removed
 */
function setMainReference(add = true) {
    const currentAsyncUuid = getAsyncUUID();
    if (!currentAsyncUuid) {
        return;
    }

    const tracer = tracers[currentAsyncUuid];
    if (!tracer) {
        return;
    }

    if (add) {
        tracer.mainAsyncIds.add(currentAsyncUuid);
    } else {
        tracer.mainAsyncIds.delete(currentAsyncUuid);
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

    const currentAsyncUuid = getAsyncUUID();
    if (currentAsyncUuid) {
        tracers[currentAsyncUuid] = tracer;
    }
    return handle();
}

/**
 * Returns the active trace
 * @return {Object} tracer object
 */
function get() {
    const currentAsyncUuid = getAsyncUUID();
    if (!currentAsyncUuid || !tracers[currentAsyncUuid]) {
        return null;
    }

    return tracers[currentAsyncUuid];
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
        console.log(`[resource-monitor] found ${Object.keys(tracers).length}, deleting`);
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
    getAsyncUUID,
};
