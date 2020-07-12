/**
 * @fileoverview Wrapping superagent's http library, since we can't trace calls
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
 * Wraps the superagent http send command function with tracing
 * @param {Function} wrappedFunction The wrapped function from superagent module
 * @returns {Function} The wrapped function
 */
function superagentWrapper(wrappedFunction) {
    return function internalSuperagentClientWrapper(url, data, fn) {
        const response = wrappedFunction.apply(this, [url, data, fn]);
        try {
            const { hostname, pathname: path } = new URL(url);

            const { slsEvent: httpEvent, startTime } =
                eventInterface.initializeEvent(
                    'http',
                    hostname,
                    response.method,
                    'http'
                );

            const epsagonTraceId = httpHelpers.generateEpsagonTraceId();
            // Inject header to support tracing over HTTP requests
            if ((process.env.EPSAGON_DISABLE_HTTP_TRACE_ID || '').toUpperCase() !== 'TRUE') {
                response.set(EPSAGON_HEADER, epsagonTraceId);
            }

            eventInterface.addToMetadata(httpEvent,
                {
                    url,
                    http_trace_id: epsagonTraceId,
                }, {
                    path,
                });

            const responsePromise = new Promise((resolve) => {
                response.once('end', () => {
                    eventInterface.addToMetadata(httpEvent,
                        {
                            status_code: response.res.statusCode,
                        }, {
                            request_headers: response.header,
                            response_headers: response.res.headers,
                        });
                    // eslint-disable-next-line no-underscore-dangle
                    httpHelpers.setJsonPayload(httpEvent, 'request_body', response._data);
                    httpHelpers.setJsonPayload(
                        httpEvent,
                        'response_body',
                        response.res.text,
                        response.res.headers['content-encoding']
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
   * Initializes the superagent tracer
   */
    init() {
        ['post', 'get', 'put', 'patch', 'delete'].forEach((method) => {
            moduleUtils.patchModule(
                'superagent',
                method,
                superagentWrapper
            );
        });
    },
};
