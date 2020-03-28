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

module.exports.ignoreEndpoints = ignoreEndpoints;
module.exports.ignoredEndpoints = getIgnoredEndpoints;
module.exports.extractEpsagonHeader = extractEpsagonHeader;
module.exports.EPSAGON_HEADER = EPSAGON_HEADER;
