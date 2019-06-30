const epsagon = require('epsagon');
const utils = require('./utils.js');

// Requiring patcher to instrument modules
const patcher = require('./patcher.js'); // eslint-disable-line no-unused-vars

epsagon.ignoreEndpoints = utils.ignoreEndpoints;

module.exports = epsagon;
