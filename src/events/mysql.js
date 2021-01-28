/**
 * @fileoverview Wraps mysql calls to support async context propagation
 */

const asyncHooks = require('async_hooks');
const {
    tracer,
    moduleUtils,
} = require('epsagon');
const { setAsyncReference } = require('../trace_context');

/**
 * Parse query arguments - get the callback and params
 * @param {Array|Function} values First sql argument
 * @param {Function} cb Second sql argument
 * @returns {{params: Array, callback: Function}} The callback and params
 */
function parseQueryArgs(values, cb) {
    const paramNotSet = (cb === undefined && values instanceof Function);
    const callback = (paramNotSet) ? values : cb;
    const params = (paramNotSet) ? [] : values;

    return { params, callback };
}

/**
 * Wraps mysql Query with tracing
 * @param {Function} wrappedFunction The wrapped function from mysql module
 * @returns {Function} The wrapped function
 */
function mysqlQueryWrapper(wrappedFunction) {
    return function internalMysqlQueryWrapper(sql, values, cb) {
        try {
            let callback;
            let params;
            let overrideInnerCallback = false;

            const originalAsyncId = asyncHooks.executionAsyncId();

            if (sql.onResult) {
                params = sql.values;
                callback = sql.onResult;
            } else {
                ({ params, callback } = parseQueryArgs(values, cb));
            }

            if (callback === undefined && sql._callback) { // eslint-disable-line
                // In pool connection, no callback passed, but _callback is being used.
                callback = sql._callback; // eslint-disable-line no-underscore-dangle
                overrideInnerCallback = true;
            }

            const patchedCallback = (error, results, fields) => {
                setAsyncReference(originalAsyncId);

                if (callback) {
                    callback(error, results, fields);
                }
            };

            if (sql.onResult) {
                sql.onResult = patchedCallback; // eslint-disable-line
            }
            if (overrideInnerCallback) {
                // eslint-disable-next-line no-underscore-dangle,no-param-reassign
                sql._callback = patchedCallback;
            }

            return wrappedFunction.apply(this, [sql, params, (callback && !overrideInnerCallback) ? patchedCallback : cb]); // eslint-disable-line
        } catch (error) {
            tracer.addException(error);
        }

        return wrappedFunction.apply(this, [sql, values, cb]);
    };
}

/**
 * Wraps the redis' send command function with tracing
 * @param {Function} wrappedFunction The wrapped function from redis module
 * @returns {Function} The wrapped function
 */
function mysqlGetConnectionWrapper(wrappedFunction) {
    return function internalMysqlGetConnectionWrapper(callback) {
        let patchedCallback = callback;
        try {
            const originalAsyncId = asyncHooks.executionAsyncId();

            patchedCallback = (error, rconnection) => {
                setAsyncReference(originalAsyncId);

                if (callback) {
                    callback(error, rconnection);
                }
            };
        } catch (error) {
            tracer.addException(error);
        }

        return wrappedFunction.apply(this, [patchedCallback]);
    };
}

module.exports = {
    /**
   * Initializes the Redis tracer
   */
    init() {
        moduleUtils.patchModule(
            'mysql2',
            'query',
            mysqlQueryWrapper,
            mysql2 => mysql2.Connection.prototype
        );

        moduleUtils.patchModule(
            'mysql2',
            'execute',
            mysqlQueryWrapper,
            mysql2 => mysql2.Connection.prototype
        );

        moduleUtils.patchModule(
            'mysql/lib/Connection.js',
            'query',
            mysqlQueryWrapper,
            mysqlConnection => mysqlConnection.prototype
        );

        moduleUtils.patchModule(
            'mysql/lib/Pool.js',
            'getConnection',
            mysqlGetConnectionWrapper,
            mysqlPool => mysqlPool.prototype
        );
    },
};
