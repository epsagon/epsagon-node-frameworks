/**
 * @fileoverview Runner for http-server application
 */
const uuid4 = require('uuid4');
const os = require('os');
const {
    utils,
    eventInterface,
    event,
    errorCode,
    httpHelpers,
} = require('epsagon');
const { extractEpsagonHeader } = require('../http.js');

/**
 * Creates an Event representing the running http-server (runner)
 * @param {Request} req The http-server's request data
 * @param {Int} startTime Runner start time
 * @return {Object} The runner event
 */
function createRunner(req, startTime) {
    const httpEvent = new event.Event([
        `http-server-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);

    const resource = new event.Resource([
        req.headers.host || os.hostname(),
        'http-server',
        req.method,
    ]);

    httpEvent.setResource(resource);
    eventInterface.createTraceIdMetadata(httpEvent);

    return httpEvent;
}


/**
 * Terminates the running http-server (runner)
 * @param {Object} httpEvent runner's http-server event
 * @param {Response} res response data
 * @param {Request} req The http-server's request data
 * @param {Int} startTime Runner start time
 * @param {string} module http/https
 * @param {Buffer} chunks request data buffer
 */
function finishRunner(httpEvent, res, req, startTime, module, chunks) {
    eventInterface.addToMetadata(httpEvent, {
        url: `${module}://${req.headers.host}${req.url}`,
        status_code: res.statusCode,
    }, {
        request_headers: req.headers,
        response_headers: res.getHeaders(),
    });

    if (extractEpsagonHeader(req.headers)) {
        eventInterface.addToMetadata(httpEvent, {
            http_trace_id: extractEpsagonHeader(req.headers),
        });
    }

    if (chunks && chunks.length) {
        httpHelpers.setJsonPayload(httpEvent, 'request_body', Buffer.concat(chunks));
    }

    if (res.statusCode >= 500) {
        httpEvent.setErrorCode(errorCode.ErrorCode.EXCEPTION);
    }

    httpEvent.setDuration(utils.createDurationTimestamp(startTime));
}

module.exports.createRunner = createRunner;
module.exports.finishRunner = finishRunner;
