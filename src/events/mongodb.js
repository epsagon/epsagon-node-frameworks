/**
 * @fileoverview Wraps mongodb calls to support async context propagation
 */
const {
    tracer,
    moduleUtils,
} = require('epsagon');
const traceContext = require('../trace_context');

/**
 * Passes tracer from one async resource to another
 * @param  {...any} args function original arguments
 * @returns {Function} return wrapped function execution
 */
function mongodbAsyncPasser(...args) {
    const wrappedFunction = args[args.length - 1];
    const callback = args[args.length - 2];

    let patchedCallback = callback;
    try {
        const tracerObj = tracer.getTrace();

        patchedCallback = (error, response) => {
            traceContext.setAsyncReference(tracerObj);

            if (callback) {
                callback(error, response);
            }
        };
    } catch (error) {
        tracer.addException(error);
    }

    arguments[args.length - 2] = patchedCallback; // eslint-disable-line prefer-rest-params
    Array.prototype.pop.apply(arguments); // eslint-disable-line prefer-rest-params
    return wrappedFunction.apply(this, arguments); // eslint-disable-line prefer-rest-params
}

/**
 * Wraps the mongodb operation function with tracing
 * @param {Function} wrappedFunction The wrapped function from mongodb module
 * @returns {Function} The wrapped function
 */
function mongodbWrapper(wrappedFunction) {
    return function internalMongodbWrapper(...args) {
        return mongodbAsyncPasser(...args, wrappedFunction);
    };
}

/**
 * Wraps mongodb command function
 * @param {*} wrappedFunction The wrapped function from mongodb module
 * @returns {Function} The wrapped function
 */
function mongodbCommandWrapper(wrappedFunction) {
    return function internalMongodbCommandWrapper(...args) {
        const cmd = args[2];
        if (cmd && cmd.ismaster) {
            return wrappedFunction.apply(this, args);
        }
        return mongodbAsyncPasser(...args, wrappedFunction);
    };
}

module.exports = {
    /**
   * Initializes the MongoDB tracer
   */
    init() {
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'insert',
            mongodbWrapper,
            mongodb => mongodb
        );
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'update',
            mongodbWrapper,
            mongodb => mongodb
        );
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'remove',
            mongodbWrapper,
            mongodb => mongodb
        );
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'query',
            mongodbWrapper,
            mongodb => mongodb
        );
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'getMore',
            mongodbWrapper,
            mongodb => mongodb
        );
        moduleUtils.patchModule(
            'mongodb/lib/core/wireprotocol/index.js',
            'command',
            mongodbCommandWrapper,
            mongodb => mongodb
        );
    },
};
