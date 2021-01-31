require('./resource_monitor');
const epsagon = require('epsagon');
const http = require('./http.js');
const traceContext = require('./trace_context');

// Requiring patcher to instrument modules
const patcher = require('./patcher.js'); // eslint-disable-line no-unused-vars

epsagon.disableAll = () => {
    epsagon.unpatch();
    traceContext.disableTracing();
};

epsagon.ignoreEndpoints = http.ignoreEndpoints;

const originalEpsagonInit = epsagon.init;
epsagon.init = (options) => {
    originalEpsagonInit(options);
    traceContext.init();
};

module.exports = epsagon;
