/**
 * @fileoverview Wraps redis calls to support async context propagation
 */

const {
    tracer,
    moduleUtils,
} = require('epsagon');
const { setAsyncReference, getAsyncUUID } = require('../trace_context');

/**
 * Wraps the redis' send command function with tracing
 * @param {Function} wrappedFunction The wrapped function from redis module
 * @returns {Function} The wrapped function
 */
function redisClientWrapper(wrappedFunction) {
    return function internalRedisClientWrapper(commandObj) {
        try {
            // This is used to prevent duplicates command tracing. In this case,
            // the command won't be executed until the client is able to do it,
            // and the wrapped internal function will be called again.
            if (this.ready === false || this.stream.writable === false) {
                return wrappedFunction.apply(this, [commandObj]);
            }

            const originalAsyncUuid = getAsyncUUID();

            const { callback } = commandObj;

            commandObj.callback = (err, res) => { // eslint-disable-line no-param-reassign
                setAsyncReference(originalAsyncUuid);

                if (callback) {
                    callback(err, res);
                }
            };
        } catch (error) {
            tracer.addException(error);
        }

        return wrappedFunction.apply(this, [commandObj]);
    };
}

module.exports = {
    /**
   * Initializes the Redis tracer
   */
    init() {
        moduleUtils.patchModule(
            'redis',
            'internal_send_command',
            redisClientWrapper,
            redis => redis.RedisClient.prototype
        );
    },
};
