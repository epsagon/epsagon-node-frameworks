/**
 * @fileoverview Wrapping superagent-wrapper's http library, since we can't trace calls
 * (async_hooks params always equals 0)
 */

const {
    tracer,
    moduleUtils,
    eventInterface,
    utils,
    httpHelpers,
} = require('epsagon');
const { EPSAGON_HEADER } = require('../http.js');

/**
 * Wraps the superagent-wrapper http send command function with tracing
 * @param {Function} wrappedFunction The wrapped function from superagent-wrapper module
 * @returns {Function} The wrapped function
 */
function superagentWrapper(wrappedFunction) {
    return function internalSuperagentClientWrapper(req) {
        const response = wrappedFunction.apply(this, [req]);
        try {
            const { hostname, pathname: path } = new URL(req.url);

            const { slsEvent: httpEvent, startTime } =
                eventInterface.initializeEvent(
                    'http',
                    hostname,
                    req.method,
                    'http'
                );

            const epsagonTraceId = httpHelpers.generateEpsagonTraceId();
            // Inject header to support tracing over HTTP requests
            if ((process.env.EPSAGON_DISABLE_HTTP_TRACE_ID || '').toUpperCase() !== 'TRUE') {
                req.header[EPSAGON_HEADER] = epsagonTraceId;
            }

            eventInterface.addToMetadata(httpEvent,
                {
                    url: req.url,
                    http_trace_id: epsagonTraceId,
                }, {
                    request_headers: req.header,
                    path,
                });

            const responsePromise = new Promise((resolve) => {
                req.once('response', (res) => {
                    eventInterface.addToMetadata(httpEvent,
                        {
                            status_code: res.statusCode,
                        }, {
                            response_headers: res.headers,
                        });
                    httpHelpers.setJsonPayload(
                        httpEvent,
                        'response_body',
                        res.text,
                        res.headers['content-encoding']
                    );
                    httpEvent.setDuration(utils.createDurationTimestamp(startTime));
                    resolve();
                });
            });

            tracer.addEvent(httpEvent, responsePromise);
        } catch (error) {
            tracer.addException(error);
        }

        return response;
    };
}

module.exports = {
    /**
   * Initializes the superagent-wrapper tracer
   */
    init() {
        moduleUtils.patchModule(
            '@tenna-llc/superagent-wrapper',
            '_setDefaults',
            superagentWrapper,
            wrapper => wrapper.ProxyAgent.prototype
        );
    },
};
