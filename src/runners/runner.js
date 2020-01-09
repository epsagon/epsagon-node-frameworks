
const uuid4 = require('uuid4');
const {
    utils,
    eventInterface,
    event: serverlessEvent,
    errorCode,
    tracer,
} = require('epsagon');

/**
 * Create and initialize a new serverless event in the epsagon format.
 * @param {string} resourceType resourceType name
 * @param {string} name Event name
 * @param {string} operation Operation name
 * @param {string} origin Origin name (optional)
 * @returns {Object} Object with dnsEvent and event start time.
 */
const initializeEvent = (resourceType, name, operation, origin) => {
    const startTime = Date.now();
    const resource = new serverlessEvent.Resource([
        name,
        resourceType,
        operation,
    ]);
    const event = new serverlessEvent.Event([
        `${resourceType}-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        origin || resourceType,
        0,
        errorCode.ErrorCode.OK,
    ]);
    event.setResource(resource);
    return { event, startTime };
};

/**
 * Adding callback data/error to event, and finalize event.
 * @param {serverlessEvent.Event} event Serverless event.
 * @param {number} startTime Event start time.
 * @param {Error} error Callback error.
 * @param {string[] | Object[] | Object} metadata Callback metadata.
 */
const finalizeEvent = (event, startTime, error, metadata) => {
    try {
        if (error) {
            eventInterface.setException(event, error);
        }
        if (metadata) {
            eventInterface.addToMetadata(event, metadata);
        }
        event.setDuration(utils.createDurationTimestamp(startTime));
    } catch (err) {
        tracer.addException(err);
    }
};
module.exports = {
    initializeEvent, finalizeEvent,
};
