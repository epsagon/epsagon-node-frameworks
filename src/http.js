/**
 * @fileoverview Utility functions
 */
let ignoredEndpoints = [];
const EPSAGON_HEADER = 'epsagon-trace-id';
const IGNORED_HEADERS = {
    'user-agent': 'elb-healthchecker/2.0',
};

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
 * @param {Object} headers of the request
 * @returns {Boolean} True if should ignore or false
 */
function shouldIgnore(path, headers) {
    let headersCheck = false;
    if (headers) {
        headersCheck = Object.keys(IGNORED_HEADERS).map((key) => {
            const headerKey = Object.keys(headers).find(header => header.toLowerCase() === key);
            return headerKey && headers[headerKey].toLowerCase() === IGNORED_HEADERS[key];
        }).includes(true);
    }
    return ignoredEndpoints.filter(
        endpoint => path.startsWith(endpoint)
    ).length > 0 || headersCheck;
}

module.exports.ignoreEndpoints = ignoreEndpoints;
module.exports.ignoredEndpoints = getIgnoredEndpoints;
module.exports.extractEpsagonHeader = extractEpsagonHeader;
module.exports.EPSAGON_HEADER = EPSAGON_HEADER;
module.exports.shouldIgnore = shouldIgnore;
