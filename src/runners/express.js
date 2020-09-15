/**
 * @fileoverview Runner for Express application
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
 * Creates an Event representing the running Express (runner)
 * @param {Request} req The Express's request data
 * @param {Int} startTime Runner start time
 * @return {Object} The runner event
 */
function createRunner(req, startTime) {
    const expressEvent = new event.Event([
        `express-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);

    const resource = new event.Resource([
        req.hostname,
        'express',
        req.method,
    ]);

    expressEvent.setResource(resource);
    eventInterface.createTraceIdMetadata(expressEvent);

    return expressEvent;
}

/**
 * Check if parametered path and absolute path are equal
 * @param {Array} parameteredPathSplitted parametered splitted path
 * @param {Array} pathSplitted absolete splitted path
 * @return {Boolean} true if equal false if not.
 */
function checkIfPathsAreEqual(parameteredPathSplitted, pathSplitted) {
    if (parameteredPathSplitted.length !== pathSplitted.length) return false;
    for (let i = 0; i < pathSplitted.length; i += 1) {
        if (parameteredPathSplitted[i] !== pathSplitted[i] &&
            parameteredPathSplitted[i] &&
            parameteredPathSplitted[i][0] !== ':') {
            return false;
        }
    }

    return true;
}

/**
 * Find the parametered path that was called
 * @param {*} req - express http request object
 * @return {Object} parametered path if not find
 * return the last one.
 */
function findCalledParameteredPath(req) {
    let matchedPath;
    req.route.path.forEach((parameteredPath) => {
        const parameteredPathSplitted = parameteredPath.split('/');
        const pathSplitted = req.path.split('/');
        if (checkIfPathsAreEqual(parameteredPathSplitted, pathSplitted)) {
            matchedPath = parameteredPath;
        }
    });
    return matchedPath;
}


/**
 * Terminates the running Express (runner)
 * @param {Object} expressEvent runner's express event
 * @param {Response} res response data
 * @param {Request} req The Express's request data
 * @param {Int} startTime Runner start time
 */
function finishRunner(expressEvent, res, req, startTime) {
    eventInterface.addToMetadata(expressEvent, {
        url: `${req.protocol}://${req.hostname}${req.originalUrl}`,
        status_code: res.statusCode,
    }, {
        request_headers: req.headers,
        response_headers: res.getHeaders(),
    });

    if (Object.keys(req.query).length) {
        eventInterface.addToMetadata(expressEvent, { query: req.query });
    }

    if (Object.keys(req.params).length) {
        eventInterface.addToMetadata(expressEvent, {}, { params: req.params });
    }

    if (req.route) {
        const routePath = (req.route.path instanceof Array) ?
            findCalledParameteredPath(req) : req.route.path;
        if (routePath) {
            eventInterface.addToMetadata(expressEvent,
                { route_path: req.baseUrl + routePath });
        }
    }

    if (extractEpsagonHeader(req.headers)) {
        eventInterface.addToMetadata(expressEvent, {
            http_trace_id: extractEpsagonHeader(req.headers),
        });
    }

    if (res.statusCode >= 500) {
        expressEvent.setErrorCode(errorCode.ErrorCode.EXCEPTION);
    }

    expressEvent.setDuration(utils.createDurationTimestamp(startTime));
}

module.exports.createRunner = createRunner;
module.exports.finishRunner = finishRunner;
