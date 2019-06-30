/**
 * @fileoverview Utility functions
 */
let ignoredEndpoints = [];

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

module.exports.ignoreEndpoints = ignoreEndpoints;
module.exports.ignoredEndpoints = getIgnoredEndpoints;
