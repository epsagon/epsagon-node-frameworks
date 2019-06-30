const epsagon = require('epsagon');
const http = require('./http.js');

// Requiring patcher to instrument modules
const patcher = require('./patcher.js'); // eslint-disable-line no-unused-vars

epsagon.ignoreEndpoints = http.ignoreEndpoints;

module.exports = epsagon;
