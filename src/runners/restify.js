/**
 * @fileoverview Runner for Restify application
 */
const uuid4 = require('uuid4');
const {
    utils,
    eventInterface,
    event,
    errorCode,
} = require('epsagon');
const { extractEpsagonHeader } = require('../http.js');

/**
 * Creates an Event representing the running Restify (runner)
 * @param {Request} req The Restify's request data
 * @param {Int} startTime Runner start time
 * @return {Object} The runner event
 */
function createRunner(req, startTime) {
    const restifyEvent = new event.Event([
        `restify-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);

    const resource = new event.Resource([
        req.headers.host,
        'restify',
        req.method,
    ]);

    restifyEvent.setResource(resource);
    eventInterface.createTraceIdMetadata(restifyEvent);

    return restifyEvent;
}


/**
 * Terminates the running Restify (runner)
 * @param {Object} restifyEvent runner's Restify event
 * @param {Request} req The Restify's request data
 * @param {Response} res response data
 * @param {Int} startTime Runner start time
 * @param {Error} error if happens
 */
function finishRunner(restifyEvent, req, res, startTime, error) {
    restifyEvent.setDuration(utils.createDurationTimestamp(startTime));
    eventInterface.addToMetadata(restifyEvent, {
        url: req.url,
        route: req.route.path,
        status_code: res.statusCode,
    }, {
        request_headers: req.headers,
        params: req.params,
        response_headers: res.headers,
    });

    if (extractEpsagonHeader(req.headers)) {
        eventInterface.addToMetadata(restifyEvent, {
            http_trace_id: extractEpsagonHeader(req.headers),
        });
    }

    if (error) {
        eventInterface.setException(restifyEvent, error);
    }

    if (res.statusCode >= 500) {
        restifyEvent.setErrorCode(errorCode.ErrorCode.EXCEPTION);
    }
}

module.exports.createRunner = createRunner;
module.exports.finishRunner = finishRunner;
