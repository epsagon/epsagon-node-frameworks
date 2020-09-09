/**
 * @fileoverview Utility functions
 */
let ignoredEndpoints = [];
const EPSAGON_HEADER = 'epsagon-trace-id';

/**
 * Sets the ignored endpoints for the frameworks
 * @param {Array} endpoints array of endpoints to ignore
 */
function ignoreEndpoints(endpoints) {
    ignoredEndpoints = endpoints;
}

/**
 * Gets the ignored endpoints for the frameworks
 * @returns {Array} endpoints to ignore
 */
function getIgnoredEndpoints() {
    return ignoredEndpoints;
}


/**
 * Gets the Epsagon header if exists, otherwise undefined
 * @param {Object} headers object
 * @returns {String} Epsagon header value
 */
function extractEpsagonHeader(headers) {
    return headers && headers[EPSAGON_HEADER];
}

/**
 * Returns whether a certain path should be ignored or not
 * @param {String} path of the request
 * @returns {Boolean} True if should ignore or false
 */
function shouldIgnore(path) {
    return ignoredEndpoints.filter(
        endpoint => path.startsWith(endpoint)
    ).length > 0;
}

module.exports.ignoreEndpoints = ignoreEndpoints;
module.exports.ignoredEndpoints = getIgnoredEndpoints;
module.exports.extractEpsagonHeader = extractEpsagonHeader;
module.exports.EPSAGON_HEADER = EPSAGON_HEADER;
module.exports.shouldIgnore = shouldIgnore;
