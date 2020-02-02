/**
 * @fileoverview Runner for Koa application
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
 * Creates an Event representing the running Koa (runner)
 * @param {Request} req The Koa's request data
 * @param {Int} startTime Runner start time
 * @return {Object} The runner event
 */
function createRunner(req, startTime) {
    const koaEvent = new event.Event([
        `koa-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);

    const resource = new event.Resource([
        req.hostname,
        'koa',
        req.method,
    ]);

    koaEvent.setResource(resource);

    return koaEvent;
}


/**
 * Terminates the running Koa (runner)
 * @param {Object} koaEvent runner's Koa event
 * @param {Response} res response data
 * @param {Request} req The Koa's request data
 * @param {Int} startTime Runner start time
 */
function finishRunner(koaEvent, res, req, startTime) {
    eventInterface.addToMetadata(koaEvent, {
        url: `${req.protocol}://${req.hostname}${req.path}`,
        query: req.query,
        status_code: res.status,
    }, {
        request_headers: req.headers,
        response_headers: res.headers,
    });

    if (extractEpsagonHeader(req.headers)) {
        eventInterface.addToMetadata(koaEvent, {
            http_trace_id: extractEpsagonHeader(req.headers),
        });
    }

    if (res.status >= 500) {
        koaEvent.setErrorCode(errorCode.ErrorCode.EXCEPTION);
    }

    koaEvent.setDuration(utils.createDurationTimestamp(startTime));
}

module.exports.createRunner = createRunner;
module.exports.finishRunner = finishRunner;
