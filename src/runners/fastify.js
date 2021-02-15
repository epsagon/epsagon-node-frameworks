/**
 * @fileoverview Runner for Fastify application
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
 * Creates an Event representing the running Fastify (runner)
 * @param {Request} request The Fastify's request data
 * @param {Int} startTime Runner start time
 * @return {Object} The runner event
 */
function createRunner(request, startTime) {
    const fastifyEvent = new event.Event([
        `fastify-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);

    const resource = new event.Resource([
        request.hostname,
        'fastify',
        request.method,
    ]);

    fastifyEvent.setResource(resource);
    eventInterface.createTraceIdMetadata(fastifyEvent);

    return fastifyEvent;
}


/**
 * Terminates the running Fastify (runner)
 * @param {Object} fastifyEvent runner's fastify event
 * @param {Response} res response data
 * @param {Request} req The Fastify's request data
 * @param {Int} startTime Runner start time
 * @param {String} reqBody request body
 */
function finishRunner(fastifyEvent, res, req, startTime, reqBody) {
    eventInterface.addToMetadata(fastifyEvent, {
        url: `${req.protocol}://${req.hostname}${req.url}`,
        status_code: res.statusCode,
    }, {
        request_headers: req.headers,
        response_headers: res.getHeaders(),
    });

    if (req.query && Object.keys(req.query).length) {
        eventInterface.addToMetadata(fastifyEvent, { query: req.query });
    }

    if (req.params && Object.keys(req.params).length) {
        eventInterface.addToMetadata(fastifyEvent, {}, { params: req.params });
    }


    if (reqBody && Object.keys(reqBody).length) {
        eventInterface.addToMetadata(fastifyEvent, {}, { request_data: reqBody });
    }

    if (req.routerPath) {
        eventInterface.addToMetadata(fastifyEvent, { route: req.routerPath });
    }

    if (extractEpsagonHeader(req.headers)) {
        eventInterface.addToMetadata(fastifyEvent, {
            http_trace_id: extractEpsagonHeader(req.headers),
        });
    }

    if (res.statusCode >= 500) {
        fastifyEvent.setErrorCode(errorCode.ErrorCode.EXCEPTION);
    }

    fastifyEvent.setDuration(utils.createDurationTimestamp(startTime));
}

module.exports.createRunner = createRunner;
module.exports.finishRunner = finishRunner;
