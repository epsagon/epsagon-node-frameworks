'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var async_hooks = _interopDefault(require('async_hooks'));
var semver = _interopDefault(require('semver'));
var uuid4 = _interopDefault(require('uuid4'));
var epsagon = _interopDefault(require('epsagon'));
var shimmer = _interopDefault(require('shimmer'));

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
 * Returns whether a certain path or header should be ignored or not
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

var ignoreEndpoints_1 = ignoreEndpoints;
var ignoredEndpoints_1 = getIgnoredEndpoints;
var extractEpsagonHeader_1 = extractEpsagonHeader;
var EPSAGON_HEADER_1 = EPSAGON_HEADER;
var shouldIgnore_1 = shouldIgnore;

var http = {
	ignoreEndpoints: ignoreEndpoints_1,
	ignoredEndpoints: ignoredEndpoints_1,
	extractEpsagonHeader: extractEpsagonHeader_1,
	EPSAGON_HEADER: EPSAGON_HEADER_1,
	shouldIgnore: shouldIgnore_1
};

/**
 * @fileoverview Tracer context for managing multiple tracers
 */




// https://github.com/nodejs/node/issues/19859
const hasKeepAliveBug = !semver.satisfies(process.version, '^8.13 || >=10.14.2');

const tracers = {};
const weaks = new WeakMap();

/**
 * Destroys the tracer of an async context
 * @param {Number} asyncId The id of the async thread
 * @param {Boolean} forceDelete Force delete all traces relationships
 */
function destroyAsync(asyncId, forceDelete = false) {
    if (forceDelete) {
        Object.entries(tracers).forEach(([key, tracer]) => {
            if (tracers[asyncId] === tracer) {
                delete tracers[key];
            }
        });
    } else if (tracers[asyncId] && !tracers[asyncId].withRelationship) {
        delete tracers[asyncId];
    }
}

/**
 * Initializes the tracer of an async context. Uses the parent tracer, if exists
 * @param {Number} asyncId The id of the async thread
 * @param {String} type The type of the async thread
 * @param {Number} triggerAsyncId the id of the async thread that triggered the creation of this
 *     one
 * @param {String} resource The resource
 */
function initAsync(asyncId, type, triggerAsyncId, resource) {
    if (tracers[triggerAsyncId]) {
        tracers[asyncId] = tracers[triggerAsyncId];
    } else if (tracers[async_hooks.executionAsyncId()]) {
        tracers[asyncId] = tracers[async_hooks.executionAsyncId()];
    }

    if (hasKeepAliveBug && (type === 'TCPWRAP' || type === 'HTTPPARSER')) {
        destroyAsync(weaks.get(resource));
        weaks.set(resource, asyncId);
    }
}


/**
 * Creates a reference to another asyncId
 * @param {Number} asyncId sets the reference to this asyncId
 * @param {boolean} withRelationship sets with relationship if needed
 */
function setAsyncReference(asyncId, withRelationship = false) {
    if (!tracers[asyncId]) return;
    tracers[async_hooks.executionAsyncId()] = tracers[asyncId];
    if (tracers[async_hooks.executionAsyncId()]) {
        tracers[async_hooks.executionAsyncId()].withRelationship = withRelationship;
    }
}


/**
 * Creates an active context for tracer and run the handle
 * @param {Function} createTracer create a tracer object
 * @param {Function} handle function to run the context in
 * @returns {Object} The return value
 */
function RunInContext(createTracer, handle) {
    const tracer = createTracer();
    if (tracer != null) {
        tracers[async_hooks.executionAsyncId()] = tracer;
    }
    return handle();
}

/**
 * Returns the active trace
 * @return {Object} tracer object
 */
function get() {
    return tracers[async_hooks.executionAsyncId()] || null;
}

/**
 * Initialize context namespace
 */
function init() {
    const hook = async_hooks.createHook({
        init: initAsync,
        destroy: destroyAsync,
        promiseResolve: destroyAsync,
    });
    hook.enable();
}

var trace_context = {
    get,
    init,
    setAsyncReference,
    destroyAsync,
    RunInContext,
};

/**
 * @fileoverview Runner for Express application
 */

const {
    utils,
    eventInterface,
    event,
    errorCode,
} = epsagon;
const { extractEpsagonHeader: extractEpsagonHeader$1 } = http;

/**
 * Creates an Event representing the running Hapi (runner)
 * @param {Object} req The Hapi's request data
 * @param {Int} startTime Runner start time
 * @return {Object} The runner event
 */
function createRunner(req, startTime) {
    const hapiEvent = new event.Event([
        `hapi-${uuid4()}`,
        utils.createTimestampFromTime(startTime),
        null,
        'runner',
        0,
        errorCode.ErrorCode.OK,
    ]);
    const resource = new event.Resource([
        req.url.host,
        'hapi',
        req.method,
    ]);

    hapiEvent.setResource(resource);
    eventInterface.createTraceIdMetadata(hapiEvent);

    return hapiEvent;
}


/**
 * Terminates the running Hapi (runner)
 * @param {Object} hapiEvent runner's Hapi event
 * @param {Request} req The Hapi's request data
 * @param {Response} res response data
 * @param {Int} startTime Runner start time
 */
function finishRunner(hapiEvent, req, res, startTime) {
    hapiEvent.setDuration(utils.createDurationTimestamp(startTime));
    eventInterface.addToMetadata(hapiEvent, {
        url: req.url.href,
        route: req.route.path,
        query: req.url.search,
        status_code: res.statusCode,
    }, {
        request_headers: req.headers,
        params: req.params,
        response_headers: res.headers,
    });

    if (extractEpsagonHeader$1(req.headers)) {
        eventInterface.addToMetadata(hapiEvent, {
            http_trace_id: extractEpsagonHeader$1(req.headers),
        });
    }

    if (res.statusCode >= 500) {
        hapiEvent.setErrorCode(errorCode.ErrorCode.EXCEPTION);
    }
}

var createRunner_1 = createRunner;
var finishRunner_1 = finishRunner;

var hapi = {
	createRunner: createRunner_1,
	finishRunner: finishRunner_1
};

/* eslint-disable prefer-rest-params */
/**
 * @fileoverview Handlers for Hapi instrumentation
 */


const {
    tracer,
    utils: utils$1,
    eventInterface: eventInterface$1,
    moduleUtils,
} = epsagon;


const { shouldIgnore: shouldIgnore$1 } = http;

const IGNORED_PLUGINS = [
    'hapi-swagger',
    'hapi-pino',
    '@hapi/inert',
    '@hapi/vision',
];


/**
 * Handles Hapi's response
 * @param {Object} hapiEvent Runner event object
 * @param {Object} request The Hapi's request data
 * @param {Object} response The Hapi's response data
 * @param {Date} startTime Event start time
 * @param {Error} hapiErr Optional error in case happened in route
 */
function handleResponse(hapiEvent, request, response, startTime, hapiErr) {
    try {
        hapi.finishRunner(hapiEvent, request, response, startTime);
        if (hapiErr) {
            eventInterface$1.setException(hapiEvent, hapiErr);
        }
    } catch (err) {
        tracer.addException(err);
    }
    tracer.sendTrace(() => {});
}


/**
 * Hapi requests middleware
 * @param {Object} request The Hapi's request data
 * @param {Object} h The Hapi's response data
 * @param {Function} originalHandler function for the Hapi's route
 * @return {Object} response
 */
function hapiMiddleware(request, h, originalHandler) {
    // Initialize tracer
    tracer.restart();

    let hapiEvent;
    const startTime = Date.now();
    try {
        hapiEvent = hapi.createRunner(request, startTime);
        tracer.addRunner(hapiEvent);
    } catch (err) {
        utils$1.debugLog(err);
        return originalHandler(request, h);
    }

    // Inject trace functions
    const { label, setError, getTraceUrl } = tracer;
    request.epsagon = {
        label,
        setError,
        getTraceUrl,
    };

    // Run the request, activate the context
    const response = originalHandler(request, h);

    // Check if endpoint is ignored
    if (shouldIgnore$1(request.route.path, request.headers)) {
        utils$1.debugLog(`Ignoring request: ${request.route.path}`);
        return response;
    }

    // Handle response. In some cases (plugins) it's not a promise.
    if (utils$1.isPromise(response)) {
        response.then(() => {
            handleResponse(hapiEvent, request, response, startTime);
        }).catch((err) => {
            handleResponse(hapiEvent, request, response, startTime, err);
        });
    } else {
        handleResponse(hapiEvent, request, response, startTime);
    }

    return response;
}


/**
 * Wraps the Hapi route function with tracing
 * @param {Function} wrappedFunction Hapi's route init function
 * @return {Function} updated wrapped init
 */
function hapiRouteWrapper(wrappedFunction) {
    trace_context.init();
    tracer.getTrace = trace_context.get;
    return function internalHapiRouteWrapper() {
        // argument can be an Object or Array of Objects. We convert it for consistency
        if (!Array.isArray(arguments[0])) {
            arguments[0] = [arguments[0]];
        }
        arguments[0].forEach((route) => {
            if (!route.handler) return;
            const originalHandler = route.handler;
            // Changing the original handler to the middleware
            // eslint-disable-next-line no-param-reassign
            route.handler = (request, h) => trace_context.RunInContext(
                tracer.createTracer,
                () => hapiMiddleware(request, h, originalHandler)
            );
        });
        return wrappedFunction.apply(this, arguments);
    };
}


/**
 * Wraps the Hapi clone function with tracing
 * @param {Function} wrappedFunction Hapi's server clone function
 * @return {Function} updated wrapped init
 */
function hapiCloneWrapper(wrappedFunction) {
    return function internalHapiCloneWrapper(name) {
        const server = wrappedFunction.apply(this, [name]);
        if (!IGNORED_PLUGINS.includes(name)) {
            // trace only non-ignored plugins
            if (server.route) {
                shimmer.wrap(server, 'route', hapiRouteWrapper);
            }
        }
        return server;
    };
}


/**
 * Wraps the Hapi module request function with tracing
 * @param {Function} wrappedFunction Hapi init function
 * @return {Function} updated wrapped init
 */
function hapiServerWrapper(wrappedFunction) {
    return function internalHapiServerWrapper() {
        const server = wrappedFunction.apply(this, arguments);
        if (server.route) {
            shimmer.wrap(server, 'route', hapiRouteWrapper);
        }
        // eslint-disable-next-line no-underscore-dangle
        if (server._clone) {
            shimmer.wrap(server, '_clone', hapiCloneWrapper);
        }
        return server;
    };
}


var hapi$1 = {
    /**
     * Initializes the Hapi tracer
     */
    init() {
        moduleUtils.patchModule(
            '@hapi/hapi',
            'server',
            hapiServerWrapper
        );
        moduleUtils.patchModule(
            'hapi',
            'server',
            hapiServerWrapper
        );
        moduleUtils.patchModule(
            'hapi',
            'Server',
            hapiServerWrapper
        );
    },
};

/**
 * @fileoverview Runner for Express application
 */

const {
    utils: utils$2,
    eventInterface: eventInterface$2,
    event: event$1,
    errorCode: errorCode$1,
} = epsagon;
const { extractEpsagonHeader: extractEpsagonHeader$2 } = http;

/**
 * Creates an Event representing the running Express (runner)
 * @param {Request} req The Express's request data
 * @param {Int} startTime Runner start time
 * @return {Object} The runner event
 */
function createRunner$1(req, startTime) {
    const expressEvent = new event$1.Event([
        `express-${uuid4()}`,
        utils$2.createTimestampFromTime(startTime),
        null,
        'runner',
        0,
        errorCode$1.ErrorCode.OK,
    ]);

    const resource = new event$1.Resource([
        req.hostname,
        'express',
        req.method,
    ]);

    expressEvent.setResource(resource);
    eventInterface$2.createTraceIdMetadata(expressEvent);

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
function finishRunner$1(expressEvent, res, req, startTime) {
    eventInterface$2.addToMetadata(expressEvent, {
        url: `${req.protocol}://${req.hostname}${req.originalUrl}`,
        status_code: res.statusCode,
    }, {
        request_headers: req.headers,
        response_headers: res.getHeaders(),
    });

    if (req.query && Object.keys(req.query).length) {
        eventInterface$2.addToMetadata(expressEvent, { query: req.query });
    }

    if (req.params && Object.keys(req.params).length) {
        eventInterface$2.addToMetadata(expressEvent, {}, { params: req.params });
    }

    if (req.route) {
        const routePath = (req.route.path instanceof Array) ?
            findCalledParameteredPath(req) : req.route.path;
        if (routePath) {
            eventInterface$2.addToMetadata(expressEvent,
                { route_path: req.baseUrl + routePath });
        }
    }

    if (extractEpsagonHeader$2(req.headers)) {
        eventInterface$2.addToMetadata(expressEvent, {
            http_trace_id: extractEpsagonHeader$2(req.headers),
        });
    }

    if (res.statusCode >= 500) {
        expressEvent.setErrorCode(errorCode$1.ErrorCode.EXCEPTION);
    }

    expressEvent.setDuration(utils$2.createDurationTimestamp(startTime));
}

var createRunner_1$1 = createRunner$1;
var finishRunner_1$1 = finishRunner$1;

var express = {
	createRunner: createRunner_1$1,
	finishRunner: finishRunner_1$1
};

var methods = ['get',
    'post',
    'put',
    'head',
    'delete',
    'options',
    'trace',
    'copy',
    'lock',
    'mkcol',
    'move',
    'purge',
    'propfind',
    'proppatch',
    'unlock',
    'report',
    'mkactivity',
    'checkout',
    'merge',
    'm-search',
    'notify',
    'subscribe',
    'unsubscribe',
    'patch',
    'search',
    'connect',
];

var http_methods = {
	methods: methods
};

var consts = {
    methods: http_methods,
};

/* eslint-disable prefer-rest-params */
/**
 * @fileoverview Handlers for Express instrumentation
 */


const {
    tracer: tracer$1,
    utils: utils$3,
    moduleUtils: moduleUtils$1,
} = epsagon;


const { shouldIgnore: shouldIgnore$2 } = http;
const { methods: methods$1 } = consts;

/**
 * Express requests middleware that runs in context
 * @param {Request} req The Express's request data
 * @param {Response} res The Express's response data
 * @param {Function} next express function
 */
function expressMiddleware(req, res, next) {
    // Check if endpoint is ignored
    utils$3.debugLog('Epsagon Express - starting express middleware');

    if (shouldIgnore$2(req.originalUrl, req.headers)) {
        utils$3.debugLog(`Ignoring request: ${req.originalUrl}`);
        next();
        return;
    }

    tracer$1.restart();
    let expressEvent;
    const startTime = Date.now();
    try {
        expressEvent = express.createRunner(req, startTime);
        utils$3.debugLog('Epsagon Express - created runner');
        // Handle response
        const requestPromise = new Promise((resolve) => {
            utils$3.debugLog('Epsagon Express - creating response promise');
            res.once('finish', function handleResponse() {
                utils$3.debugLog('Epsagon Express - got finish event, handling response');
                if (
                    ((process.env.EPSAGON_ALLOW_NO_ROUTE || '').toUpperCase() !== 'TRUE') &&
                    (!req.route)
                ) {
                    utils$3.debugLog('Epsagon Express - req.route not set - not reporting trace');
                    return;
                }
                try {
                    express.finishRunner(expressEvent, this, req, startTime);
                    utils$3.debugLog('Epsagon Express - finished runner');
                } catch (err) {
                    tracer$1.addException(err);
                }
                utils$3.debugLog('Epsagon Express - sending trace');
                tracer$1.sendTrace(() => {}).then(resolve).then(() => {
                    utils$3.debugLog('Epsagon Express - trace sent + request resolved');
                    trace_context.destroyAsync(async_hooks.executionAsyncId(), true);
                });
            });
        });
        tracer$1.addRunner(expressEvent, requestPromise);
        utils$3.debugLog('Epsagon Express - added runner');

        // Inject trace functions
        const { label, setError, getTraceUrl } = tracer$1;
        req.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
    } catch (err) {
        utils$3.debugLog('Epsagon Express - general catch');
        utils$3.debugLog(err);
    } finally {
        utils$3.debugLog('Epsagon Express - general finally');
        next();
    }
}

/**
 * Wraps express next function that calls next middleware
 * @param {*} next express next middleware
 * @returns {*} wrapeed function
 */
function nextWrapper(next) {
    const asyncId = async_hooks.executionAsyncId();
    const originalNext = next;
    return function internalNextWrapper(error) {
        utils$3.debugLog('Epsagon Next - middleware executed');

        if (error) {
            utils$3.debugLog(error);
        }

        trace_context.setAsyncReference(asyncId, true);
        const result = originalNext(...arguments);
        trace_context.setAsyncReference(asyncId, true);
        return result;
    };
}
/**
 * Wraps next with next wrapper.
 * @param {*} args - list of arguments
 * @return {*} - list of arguments with wrapped next function
 */
function getWrappedNext(args) {
    const copyArgs = [...args];
    const next = copyArgs[copyArgs.length - 1];
    if (next && next.name === 'next') {
        copyArgs[copyArgs.length - 1] = nextWrapper(args[args.length - 1]);
    }

    return copyArgs;
}


/**
 * Wrapts clients middleware
 * @param {*} middleware - middleware to wrap
 * @returns {function} wrapped middleware
 */
function middlewareWrapper(middleware) {
    /* eslint-disable no-unused-vars */
    // length checks function argument quantity
    if (middleware.length === 4) {
        return function internalMiddlewareWrapper(error, req, res, next) {
            return middleware.apply(this, getWrappedNext(arguments));
        };
    }
    return function internalMiddlewareWrapper(req, res, next) {
        return middleware.apply(this, getWrappedNext(arguments));
    };
    /* eslint-enable no-unused-vars */
}

/**
 * Wraps express http methods function
 * @param {*} original - original http method function
 * @returns {function} - wrapped http method function
 */
function methodWrapper(original) {
    return function internalMethodWrapper() {
        // Check if we have middlewares
        for (let i = 0; i < arguments.length - 1; i += 1) {
            if (arguments[i] && typeof arguments[i] === 'function') {
                arguments[i] = middlewareWrapper(arguments[i]);
            }
        }

        return original.apply(this, arguments);
    };
}

/**
 * Wraps express use function
 * @param {*} original - original use function
 * @returns {function} - wrapped use function
 */
function useWrapper(original) {
    return function internalUseWrapper() {
        // Check if we have middleware
        if (arguments.length > 1 && arguments[1] && typeof arguments[1] === 'function') {
            arguments[1] = middlewareWrapper(arguments[1]);
        }
        return original.apply(this, arguments);
    };
}


/**
 * Wraps the Express module request function with tracing
 * @param {Function} wrappedFunction Express init function
 * @return {Function} updated wrapped init
 */
function expressWrapper(wrappedFunction) {
    utils$3.debugLog('Epsagon Express - wrapping express');
    trace_context.init();
    tracer$1.getTrace = trace_context.get;
    return function internalExpressWrapper() {
        utils$3.debugLog('Epsagon Express - express app created');
        const result = wrappedFunction.apply(this, arguments);
        utils$3.debugLog('Epsagon Express - called the original function');
        this.use(
            (req, res, next) => trace_context.RunInContext(
                tracer$1.createTracer,
                () => expressMiddleware(req, res, next)
            )
        );
        return result;
    };
}

/**
 * Wraps the Express module listen function in order to add the last error middleware
 * @param {Function} wrappedFunction Express listen function
 * @return {Function} updated wrapped listen
 */
function expressListenWrapper(wrappedFunction) {
    return function internalExpressListenWrapper() {
        const result = wrappedFunction.apply(this, arguments);
        this.use((err, req, _res, next) => {
            // Setting the express err as an Epsagon err
            if (err) {
                req.epsagon.setError({
                    name: 'Error',
                    message: err.message,
                    stack: err.stack,
                });
            }
            next();
        });
        return result;
    };
}

var express$1 = {
    /**
     * Initializes the Express tracer
     */
    init() {
        moduleUtils$1.patchModule(
            'express',
            'init',
            expressWrapper,
            express$$1 => express$$1.application
        );
        moduleUtils$1.patchModule(
            'express',
            'listen',
            expressListenWrapper,
            express$$1 => express$$1.application
        );
        moduleUtils$1.patchModule(
            'express',
            'use',
            useWrapper,
            express$$1 => express$$1.Router
        );
        // Loop over http methods and patch them all with method wrapper
        for (let i = 0; i < methods$1.length; i += 1) {
            moduleUtils$1.patchModule(
                'express',
                methods$1[i],
                methodWrapper,
                express$$1 => express$$1.Route.prototype
            );
        }
    },
};

/**
 * @fileoverview Runner for Koa application
 */

const {
    utils: utils$4,
    eventInterface: eventInterface$3,
    event: event$2,
    errorCode: errorCode$2,
} = epsagon;
const { extractEpsagonHeader: extractEpsagonHeader$3 } = http;

/**
 * Creates an Event representing the running Koa (runner)
 * @param {Request} req The Koa's request data
 * @param {Int} startTime Runner start time
 * @return {Object} The runner event
 */
function createRunner$2(req, startTime) {
    const koaEvent = new event$2.Event([
        `koa-${uuid4()}`,
        utils$4.createTimestampFromTime(startTime),
        null,
        'runner',
        0,
        errorCode$2.ErrorCode.OK,
    ]);

    const resource = new event$2.Resource([
        req.hostname,
        'koa',
        req.method,
    ]);

    koaEvent.setResource(resource);
    eventInterface$3.createTraceIdMetadata(koaEvent);

    return koaEvent;
}


/**
 * Terminates the running Koa (runner)
 * @param {Object} koaEvent runner's Koa event
 * @param {Response} res response data
 * @param {Request} req The Koa's request data
 * @param {Int} startTime Runner start time
 */
function finishRunner$2(koaEvent, res, req, startTime) {
    eventInterface$3.addToMetadata(koaEvent, {
        url: `${req.protocol}://${req.hostname}${req.path}`,
        query: req.query,
        status_code: res.status,
    }, {
        request_headers: req.headers,
        response_headers: res.headers,
    });

    if (extractEpsagonHeader$3(req.headers)) {
        eventInterface$3.addToMetadata(koaEvent, {
            http_trace_id: extractEpsagonHeader$3(req.headers),
        });
    }

    if (res.status >= 500) {
        koaEvent.setErrorCode(errorCode$2.ErrorCode.EXCEPTION);
    }

    koaEvent.setDuration(utils$4.createDurationTimestamp(startTime));
}

var createRunner_1$2 = createRunner$2;
var finishRunner_1$2 = finishRunner$2;

var koa = {
	createRunner: createRunner_1$2,
	finishRunner: finishRunner_1$2
};

/* eslint-disable prefer-rest-params,no-underscore-dangle */
/**
 * @fileoverview Handlers for Koa instrumentation
 */

const {
    tracer: tracer$2,
    utils: utils$5,
    moduleUtils: moduleUtils$2,
} = epsagon;


const { shouldIgnore: shouldIgnore$3 } = http;


/**
 * Koa requests middleware that runs in context
 * @param {Context} ctx The Koa's context data
 * @param {Function} next Koa function
 */
async function koaMiddleware(ctx, next) {
    // Check if endpoint is ignored
    if (shouldIgnore$3(ctx.request.originalUrl, ctx.request.headers)) {
        utils$5.debugLog(`Ignoring request: ${ctx.request.originalUrl}`);
        await next();
        return;
    }

    tracer$2.restart();
    let koaEvent;
    const startTime = Date.now();
    try {
        koaEvent = koa.createRunner(ctx.request, startTime);
        // Handle response
        const requestPromise = new Promise((resolve) => {
            ctx.res.once('finish', () => {
                if (ctx.response.status === 404) {
                    return;
                }
                try {
                    koa.finishRunner(koaEvent, ctx.response, ctx.request, startTime);
                } catch (err) {
                    tracer$2.addException(err);
                }
                tracer$2.sendTrace(() => {}).then(resolve);
            });
        });
        tracer$2.addRunner(koaEvent, requestPromise);

        // Inject trace functions
        const { label, setError, getTraceUrl } = tracer$2;
        ctx.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
    } catch (err) {
        utils$5.debugLog(err);
    } finally {
        await next();
    }
}


/**
 * Wraps the Koa module request function with tracing
 * @param {Function} wrappedFunction Koa use function
 * @return {Function} updated wrapped use
 */
function koaWrapper(wrappedFunction) {
    trace_context.init();
    tracer$2.getTrace = trace_context.get;
    return function internalKoaWrapper() {
        const result = wrappedFunction.apply(this, arguments);
        if (this.__EPSAGON_PATCH) {
            return result;
        }
        this.__EPSAGON_PATCH = true;
        this.use(
            (ctx, next) => trace_context.RunInContext(
                tracer$2.createTracer,
                () => koaMiddleware(ctx, next)
            )
        );

        // Wrap error events
        this.on('error', async (err, ctx) => {
            if (ctx.epsagon) {
                await ctx.epsagon.setError(err);
            }
        });
        return result;
    };
}


var koa$1 = {
    /**
     * Initializes the Koa tracer
     */
    init() {
        moduleUtils$2.patchModule(
            'koa/lib/application.js',
            'use',
            koaWrapper,
            Koa => Koa.prototype
        );
    },
};

/**
 * @fileoverview Handlers for Pubsub instrumentation
 */

const {
    tracer: tracer$3,
    moduleUtils: moduleUtils$3,
    eventInterface: eventInterface$4,
    utils: utils$6,
} = epsagon;


/**
 * Handle subscriber event emitter of eventName='message'
 * @param {Message} message received message.
 * @param {*} originalHandler listener callback function.
 * @param {*} requestFunctionThis request arguments.
 */
function pubSubSubscriberMiddleware(message, originalHandler, requestFunctionThis) {
    let originalHandlerSyncErr;
    try {
        // Initialize tracer and evnets.
        tracer$3.restart();
        const { slsEvent: pubSubEvent, startTime: pubSubStartTime } =
        eventInterface$4.initializeEvent(
            'pubsub',
            requestFunctionThis.projectId,
            'messagePullingListener',
            'trigger'
        );
        tracer$3.addEvent(pubSubEvent);
        // Getting message data.
        const messageId = message.id;
        const triggerMetadata = { messageId };
        let payload = {};
        pubSubEvent.setId(messageId);
        const messageData = (message.data && JSON.parse(`${message.data}`));
        if (messageData && typeof messageData === 'object') {
            payload = messageData;
        }
        eventInterface$4.finalizeEvent(pubSubEvent, pubSubStartTime, null, triggerMetadata, payload);

        const { label, setError, getTraceUrl } = tracer$3;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface$4.initializeEvent(
            'node_function', 'message_handler', 'execute', 'runner'
        );
        let runnerResult;
        try {
            runnerResult = originalHandler(message, {});
        } catch (err) {
            originalHandlerSyncErr = err;
        }
        const originalHandlerName = originalHandler.name;
        if (originalHandlerName) {
            nodeEvent.getResource().setName(originalHandlerName);
        }
        // Handle and finalize async user function.
        if (utils$6.isPromise(runnerResult)) {
            let originalHandlerAsyncError;
            runnerResult.catch((err) => {
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                eventInterface$4.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerAsyncError);
                tracer$3.sendTrace(() => {});
            });
        } else {
            // Finalize sync user function.
            eventInterface$4.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
            tracer$3.sendTrace(() => {});
        }
        tracer$3.addRunner(nodeEvent, runnerResult);
    } catch (err) {
        tracer$3.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
}

/**
 * Wraps pubsub subscriber event emitter function with tracing.
 * @param {Function} wrappedFunction pubsub init function
 * @return {Function} updated wrapped init
 */
function pubSubSubscriberWrapper(wrappedFunction) {
    trace_context.init();
    tracer$3.getTrace = trace_context.get;
    return function internalPubSubSubscriberWrapper(eventName, callback) {
        if (eventName !== 'message') {
            return wrappedFunction.apply(this, [eventName, callback]);
        }
        const requestFunctionThis = this;
        const patchedCallback = message => trace_context.RunInContext(
            tracer$3.createTracer,
            () => pubSubSubscriberMiddleware(message, callback, requestFunctionThis)
        );
        return wrappedFunction.apply(this, [eventName, patchedCallback]);
    };
}

var pubsub = {
    /**
     * Initializes the pubsub tracer
     */
    init() {
        moduleUtils$3.patchModule(
            '@google-cloud/pubsub/build/src/subscription',
            'on',
            pubSubSubscriberWrapper,
            subscription => subscription.Subscription.prototype
        );
    },
};

/* eslint-disable camelcase */
/**
 * @fileoverview Handlers for Nats instrumentation
 */


const {
    tracer: tracer$4,
    moduleUtils: moduleUtils$4,
    eventInterface: eventInterface$5,
    utils: utils$7,
} = epsagon;



const NATS_TYPES = {
    name: 'nats',
    mainWrappedFunction: 'Client',
    serverDefaultHostname: 'unknown',
    inboxSignature: '_INBOX',
};

const getServerHostname = currentServer => (
    (currentServer.url && currentServer.url.hostname) ?
        currentServer.url.hostname :
        NATS_TYPES.serverDefaultHostname
);

/**
 * Checking if subscribe subject is inbox listener id.
 *
 * @param {String} subject subsribe subject.
 * @returns {Boolean} true if subscribe subject is inbox listener id, else false.
 */
const isNatsRequestCall = subject => !!(subject && typeof subject === 'string' && subject.startsWith(NATS_TYPES.inboxSignature));

const getSubscribeParams = (opts, callback) => {
    let opts_internal = opts;
    let callback_internal = callback;
    if (typeof opts === 'function') {
        callback_internal = opts;
        opts_internal = undefined;
    }
    return {
        opts_internal, callback_internal,
    };
};

/**
 * Handle nats subscribe callback event.
 *
 * @param {String} callback_msg received message.
 * @param {String} callback_reply received reply.
 * @param {String} callback_subject received subject.
 * @param {Number} callback_sid received subscribe id.
 * @param {Function} callback  callback function.
 * @param {Boolean} jsonConnectProperty json connect property.
 * @param {String} serverHostname nats server host name.
 * @param {Boolean} isRequestCall true if this subscribe call came from nats Client.request.
 * @returns {Object} callback result.
 */
function natsSubscribeCallbackMiddleware(
    callback_msg,
    callback_reply,
    callback_subject,
    callback_sid,
    callback,
    jsonConnectProperty,
    serverHostname,
    isRequestCall
) {
    let originalHandlerSyncErr;
    let runnerResult;
    try {
        // Initialize tracer and events.
        tracer$4.restart();
        const { slsEvent: natsEvent, startTime: natsStartTime } =
        eventInterface$5.initializeEvent(
            'nats',
            callback_subject,
            isRequestCall ? 'requestMessageListener' : 'subscribeMessageListener',
            'trigger'
        );
        tracer$4.addEvent(natsEvent);
        // Getting message data.
        const triggerMetadata = {};
        const payload = {};
        if (serverHostname) {
            triggerMetadata.server_host_name = serverHostname;
        }
        if (callback_subject) {
            triggerMetadata.subject = callback_subject;
        }
        if (callback_sid) {
            triggerMetadata.sid = callback_sid;
        }
        if (callback_msg) {
            payload.msg = callback_msg;
            if (jsonConnectProperty && typeof callback_msg === 'object' &&
            (process.env.EPSAGON_PROPAGATE_NATS_ID || '').toUpperCase() === 'TRUE') {
                const { epsagon_id } = callback_msg;
                if (epsagon_id) {
                    triggerMetadata.epsagon_id = epsagon_id;
                }
            }
        }
        if (callback_reply) {
            payload.reply = callback_reply;
        }
        // Finalize nats event.
        eventInterface$5.finalizeEvent(natsEvent, natsStartTime, null, triggerMetadata, payload);
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface$5.initializeEvent(
            'node_function',
            isRequestCall ? 'requestMessagHandler' : 'subscribeMessageHandler',
            'messageReceived',
            'runner'
        );
        try {
            runnerResult = callback(callback_msg, callback_reply, callback_subject, callback_sid);
        } catch (err) {
            originalHandlerSyncErr = err;
        }
        const originalHandlerName = callback.name;
        if (originalHandlerName) {
            nodeEvent.getResource().setName(originalHandlerName);
        }
        // Handle and finalize async user function.
        if (utils$7.isPromise(runnerResult)) {
            let originalHandlerAsyncError;
            runnerResult = runnerResult.catch((err) => {
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                eventInterface$5.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerAsyncError);
                tracer$4.sendTrace(() => {});
            });
        } else {
            // Finalize sync user function.
            eventInterface$5.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
            tracer$4.sendTrace(() => {});
        }
        tracer$4.addRunner(nodeEvent, runnerResult);
    } catch (err) {
        tracer$4.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
    return runnerResult;
}

/**
 * Wraps nats subscribe function with tracing.
 * @param {Function} wrappedFunction nats subscribe function.
 * @param {string} serverHostname nats server host name.
 * @param {Boolean} jsonConnectProperty json connect property.
 * @return {Function} subscribe function rsoponse.
 */
function natsSubscribeWrapper(wrappedFunction, serverHostname, jsonConnectProperty) {
    return function internalNatsSubscribeWrapper(subject, opts, callback) {
        const { opts_internal, callback_internal } = getSubscribeParams(opts, callback);
        let patchedCallback = callback_internal;
        try {
            const isRequestCall = isNatsRequestCall(subject);
            patchedCallback = (callback_msg, callback_reply, callback_subject, callback_sid) => {
                trace_context.RunInContext(
                    tracer$4.createTracer,
                    () => natsSubscribeCallbackMiddleware(
                        callback_msg,
                        callback_reply,
                        callback_subject,
                        callback_sid,
                        callback_internal,
                        jsonConnectProperty,
                        serverHostname,
                        isRequestCall
                    )
                );
            };
        } catch (err) {
            tracer$4.addException(err);
        }
        return wrappedFunction.apply(this, [subject, opts_internal, patchedCallback]);
    };
}

/**
 * Wraps nats connect function.
 * @param {Function} connectFunction nats connect function.
 * @return {Function} nats connect function response.
 */
function natsConnectWrapper(connectFunction) {
    trace_context.init();
    tracer$4.getTrace = trace_context.get;
    return function internalNatsConnectWrapper(url, opts) {
        const connectFunctionResponse = connectFunction.apply(this, [url, opts]);
        try {
            if (connectFunctionResponse && connectFunctionResponse.constructor) {
                if (connectFunctionResponse.constructor.name !== NATS_TYPES.mainWrappedFunction) {
                    return connectFunctionResponse;
                }
                const jsonConnectProperty = connectFunctionResponse.options ?
                    connectFunctionResponse.options.json : null;
                const serverHostname = getServerHostname(connectFunctionResponse.currentServer);
                shimmer.wrap(connectFunctionResponse, 'subscribe', () => natsSubscribeWrapper(connectFunctionResponse.subscribe, serverHostname, jsonConnectProperty));
            }
        } catch (err) {
            tracer$4.addException(err);
        }
        return connectFunctionResponse;
    };
}

var nats = {
    /**
     * Initializes the nats tracer
     */
    init() {
        moduleUtils$4.patchModule(
            'nats',
            'connect',
            natsConnectWrapper
        );
    },
};

/**
 * @fileoverview Handlers for kafkajs instrumentation
 */


const {
    tracer: tracer$5,
    moduleUtils: moduleUtils$5,
    eventInterface: eventInterface$6,
    utils: utils$8,
} = epsagon;

const { EPSAGON_HEADER: EPSAGON_HEADER$1 } = http;

/**
 * acts as a middleware for `consumer.run()`
 * @param {object} message the messages param to send
 * @param {function} originalHandler original consumer function
 */
function kafkaMiddleware(message, originalHandler) {
    let originalHandlerSyncErr;
    try {
        // Initialize tracer and runner.
        tracer$5.restart();
        const { slsEvent: kafkaEvent, startTime: kafkaStartTime } =
        eventInterface$6.initializeEvent(
            'kafka',
            message.topic,
            'consume',
            'trigger'
        );

        const metadata = {
            partition: message.partition,
            offset: message.message.offset,
            timestamp: new Date(parseInt(message.message.timestamp, 10)).toUTCString(),
        };
        if (message.message.headers[EPSAGON_HEADER$1]) {
            metadata[EPSAGON_HEADER$1] = message.message.headers[EPSAGON_HEADER$1].toString();
        }

        // Convert headers from array to object and stringify them
        const headers = Object.entries(message.message.headers).reduce((total, entry) => {
            // eslint-disable-next-line no-param-reassign
            total[entry[0]] = entry[1].toString();
            return total;
        }, {});

        tracer$5.addEvent(kafkaEvent);
        eventInterface$6.finalizeEvent(kafkaEvent, kafkaStartTime, null, metadata, {
            headers,
            body: message.message.value.toString(),
        });

        const { label, setError, getTraceUrl } = tracer$5;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface$6.initializeEvent(
            'node_function', 'message_handler', 'execute', 'runner'
        );
        let runnerResult;
        try {
            runnerResult = originalHandler(message);
        } catch (err) {
            originalHandlerSyncErr = err;
        }

        if (originalHandler.name) {
            nodeEvent.getResource().setName(originalHandler.name);
        }

        // Handle and finalize async user function.
        if (utils$8.isPromise(runnerResult)) {
            let originalHandlerAsyncError;
            runnerResult = runnerResult.catch((err) => {
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                eventInterface$6.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerAsyncError);
                tracer$5.sendTrace(() => {});
            });
        } else {
            // Finalize sync user function.
            eventInterface$6.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
            tracer$5.sendTrace(() => {});
        }
        tracer$5.addRunner(nodeEvent, runnerResult);
    } catch (err) {
        tracer$5.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
}


/**
 * Wraps the kafkajs run function to add the Epsagon middleware
 * @param {Function} wrappedFunction The kafkajs run function
 * @returns {Function} The wrapped function
 */
function kafkaConsumerRunWrapper(wrappedFunction) {
    trace_context.init();
    tracer$5.getTrace = trace_context.get;
    return function internalKafkaWrapper(options) {
        // Add middleware only if eachMessage exists
        if (!options.eachMessage) {
            return wrappedFunction.apply(this, [options]);
        }
        const originalHandler = options.eachMessage;
        const patchedHandler = message => trace_context.RunInContext(
            tracer$5.createTracer,
            () => kafkaMiddleware(message, originalHandler)
        );
        // eslint-disable-next-line no-param-reassign
        options.eachMessage = patchedHandler.bind(options);
        return wrappedFunction.apply(this, [options]);
    };
}


/**
 * Wraps the kafkajs consumer creation to wrap the run function
 * @param {Function} wrappedFunction The kafkajs consumer function
 * @returns {Function} The wrapped function
 */
function kafkaConsumerWrapper(wrappedFunction) {
    return function internalKafkaConsumerWrapper(options) {
        const consumer = wrappedFunction.apply(this, [options]);
        if (consumer.run) {
            shimmer.wrap(consumer, 'run', kafkaConsumerRunWrapper);
        }
        return consumer;
    };
}

var kafkajs = {
    /**
     * Initializes the kafkajs tracer
     */
    init() {
        moduleUtils$5.patchModule(
            'kafkajs',
            'consumer',
            kafkaConsumerWrapper,
            kafka => kafka.Kafka.prototype
        );
    },
};

/**
 * @fileoverview Handlers for kafka-node instrumentation
 */

const {
    tracer: tracer$6,
    moduleUtils: moduleUtils$6,
    eventInterface: eventInterface$7,
    utils: utils$9,
} = epsagon;

const { EPSAGON_HEADER: EPSAGON_HEADER$2 } = http;

/**
 * acts as a middleware for `consumer.run()`
 * @param {object} message the messages param to send
 * @param {function} originalHandler original consumer function
 * @param {Consumer} consumer original consumer
 * @returns {object} Original handler's response
 */
function kafkaMiddleware$1(message, originalHandler, consumer) {
    let originalHandlerSyncErr;
    let runnerResult;
    try {
        // Initialize tracer and runner.
        tracer$6.restart();
        const { slsEvent: kafkaEvent, startTime: kafkaStartTime } =
        eventInterface$7.initializeEvent(
            'kafka',
            message.topic,
            'consume',
            'trigger'
        );

        const metadata = {
            partition: message.partition,
            offset: message.offset,
            key: message.key,
            host: consumer.client.options.kafkaHost,
        };

        // kafka-node doesn't support headers, so we're checking if Epsagon found in a JSON value
        try {
            const jsonData = JSON.parse(message.value);
            if (jsonData[EPSAGON_HEADER$2]) {
                metadata[EPSAGON_HEADER$2] = jsonData[EPSAGON_HEADER$2].toString();
            }
        } catch (err) {
            utils$9.debugLog('kafka-node - Could not extract epsagon header');
        }

        tracer$6.addEvent(kafkaEvent);
        eventInterface$7.finalizeEvent(kafkaEvent, kafkaStartTime, null, metadata, {
            body: message.value.toString(),
        });

        const { label, setError, getTraceUrl } = tracer$6;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface$7.initializeEvent(
            'node_function', originalHandler.name || `${message.topic}-consumer`, 'execute', 'runner'
        );
        try {
            runnerResult = originalHandler(message);
        } catch (err) {
            originalHandlerSyncErr = err;
        }

        // Handle and finalize async user function.
        if (utils$9.isPromise(runnerResult)) {
            let originalHandlerAsyncError;
            runnerResult = runnerResult.catch((err) => {
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                eventInterface$7.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerAsyncError);
                tracer$6.sendTrace(() => {});
            });
        } else {
            // Finalize sync user function.
            eventInterface$7.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
            tracer$6.sendTrace(() => {});
        }
        tracer$6.addRunner(nodeEvent, runnerResult);
    } catch (err) {
        tracer$6.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
    return runnerResult;
}


/**
 * Wraps the kafka-node run function to add the Epsagon middleware
 * @param {Function} wrappedFunction The kafka-node run function
 * @returns {Function} The wrapped function
 */
function kafkaConsumerRunWrapper$1(wrappedFunction) {
    trace_context.init();
    tracer$6.getTrace = trace_context.get;
    return function internalKafkaWrapper(event, handler) {
        const consumer = this;
        if (event !== 'message') {
            return wrappedFunction.apply(this, [event, handler]);
        }
        // Add middleware only if eachMessage exists
        if (typeof handler !== 'function') {
            return wrappedFunction.apply(this, [event, handler]);
        }

        const patchedHandler = message => trace_context.RunInContext(
            tracer$6.createTracer,
            () => kafkaMiddleware$1(message, handler, consumer)
        );

        return wrappedFunction.apply(this, [event, patchedHandler]);
    };
}

var kafkaNode = {
    /**
     * Initializes the kafka-node tracer
     */
    init() {
        moduleUtils$6.patchModule(
            'kafka-node',
            'on',
            kafkaConsumerRunWrapper$1,
            kafka => kafka.Consumer.prototype
        );
    },
};

/**
 * @fileoverview Handlers for sqs-consumer instrumentation
 */

const {
    tracer: tracer$7,
    moduleUtils: moduleUtils$7,
    eventInterface: eventInterface$8,
    utils: utils$a,
    sqsUtils,
} = epsagon;


/**
 * Parse queue URL into name, account and region
 * @param {String} queueUrl queue URL.
 * @return {object} { queueName, awsAccount, region }.
 */
function parseQueueUrl(queueUrl) {
    let queueName = '';
    let awsAccount = '';
    let region = '';
    if (queueUrl.startsWith('https://vpce')) {
        // eslint-disable-next-line no-unused-vars
        const [_, __, awsPath, parsedQueueName] = queueUrl.split('/');
        // eslint-disable-next-line prefer-destructuring
        region = awsPath.split('.')[2];
        queueName = parsedQueueName;
    } else {
        // eslint-disable-next-line no-unused-vars
        const [_, __, awsPath, parsedAccount, parsedQueueName] = queueUrl.split('/');
        queueName = parsedQueueName;
        awsAccount = parsedAccount;
        // eslint-disable-next-line prefer-destructuring
        region = awsPath.split('.')[1];
    }
    return { queueName, awsAccount, region };
}

/**
 * Handle consumer event from sqs
 * @param {SQSMessage} message received message.
 * @param {object} app consumer app.
 */
function sqsConsumerMiddleware(message, app) {
    utils$a.debugLog('Epsagon SQS - starting middleware');
    let originalHandlerSyncErr;
    try {
        // Initialize tracer and runner.
        tracer$7.restart();
        const { queueName, awsAccount, region } = parseQueueUrl(app.queueUrl);
        utils$a.debugLog('Epsagon SQS - parsed queue url', queueName, awsAccount, region);
        const { slsEvent: sqsEvent, startTime: sqsStartTime } =
        eventInterface$8.initializeEvent(
            'sqs',
            queueName,
            'ReceiveMessage',
            'trigger'
        );
        tracer$7.addEvent(sqsEvent);
        eventInterface$8.finalizeEvent(sqsEvent, sqsStartTime, null, {
            aws_account: awsAccount,
            region,
            md5_of_message_body: message.MD5OfBody,
            message_id: message.MessageId,
        }, {
            message_body: message.Body,
            message_attributed: message.MessageAttributes,
        });
        utils$a.debugLog('Epsagon SQS - created sqs event');
        const snsData = sqsUtils.getSNSTrigger([message]);
        if (snsData != null) {
            utils$a.debugLog('Epsagon SQS - created sns event');
            eventInterface$8.addToMetadata(sqsEvent, { 'SNS Trigger': snsData });
        }

        const { label, setError, getTraceUrl } = tracer$7;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface$8.initializeEvent(
            'node_function', 'message_handler', 'execute', 'runner'
        );
        utils$a.debugLog('Epsagon SQS - initialized runner event');
        let runnerResult;
        try {
            runnerResult = app.originalHandleMessage(message);
            utils$a.debugLog('Epsagon SQS - executed original handler');
        } catch (err) {
            utils$a.debugLog('Epsagon SQS - error in original handler');
            originalHandlerSyncErr = err;
        }

        if (app.originalHandleMessage.name) {
            utils$a.debugLog('Epsagon SQS - set handler name');
            nodeEvent.getResource().setName(app.originalHandleMessage.name);
        }

        // Handle and finalize async user function.
        if (utils$a.isPromise(runnerResult)) {
            utils$a.debugLog('Epsagon SQS - result is promise');
            let originalHandlerAsyncError;
            runnerResult.catch((err) => {
                utils$a.debugLog('Epsagon SQS - original handler threw error');
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                utils$a.debugLog('Epsagon SQS - finalizing event');
                eventInterface$8.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerAsyncError);
                utils$a.debugLog('Epsagon SQS - sending trace');
                tracer$7.sendTrace(() => {}).then(() => {
                    utils$a.debugLog('Epsagon SQS - trace sent');
                });
                utils$a.debugLog('Epsagon SQS - post send');
            });
        } else {
            // Finalize sync user function.
            utils$a.debugLog('Epsagon SQS - response not promise');
            utils$a.debugLog('Epsagon SQS - finalizing event');
            eventInterface$8.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
            utils$a.debugLog('Epsagon SQS - sending trace');
            tracer$7.sendTrace(() => {}).then(() => {
                utils$a.debugLog('Epsagon SQS - trace sent');
            });
            utils$a.debugLog('Epsagon SQS - post send');
        }
        tracer$7.addRunner(nodeEvent, runnerResult);
        utils$a.debugLog('Epsagon SQS - added runner');
    } catch (err) {
        utils$a.debugLog('Epsagon SQS - general error', err);
        tracer$7.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        utils$a.debugLog('Epsagon SQS - rethrowing original sync error');
        throw originalHandlerSyncErr;
    }
}

/**
 * Wraps sqs-consumer create event emitter function with tracing.
 * @param {Function} wrappedFunction sqs-consumer init function
 * @return {Function} updated wrapped init
 */
function sqsConsumerWrapper(wrappedFunction) {
    trace_context.init();
    tracer$7.getTrace = trace_context.get;
    return function internalSqsConsumerWrapper(options) {
        const app = wrappedFunction.apply(this, [options]);
        const patchedCallback = message => trace_context.RunInContext(
            tracer$7.createTracer,
            () => sqsConsumerMiddleware(message, app)
        );
        app.originalHandleMessage = app.handleMessage;
        app.handleMessage = patchedCallback;
        return app;
    };
}

var sqsConsumer = {
    /**
     * Initializes the sqs-consumer tracer
     */
    init() {
        moduleUtils$7.patchModule(
            'sqs-consumer',
            'create',
            sqsConsumerWrapper,
            sqs => sqs.Consumer
        );
    },
};

/**
 * @fileoverview Handlers for amqplib instrumentation
 */

const {
    tracer: tracer$8,
    moduleUtils: moduleUtils$8,
    eventInterface: eventInterface$9,
    utils: utils$b,
} = epsagon;

const { EPSAGON_HEADER: EPSAGON_HEADER$3 } = http;

/**
 * acts as a middleware for `consumer.run()`
 * @param {object} message the messages param to send
 * @param {Function} callback the callback function
 * @param {Channel} channel the Channel object of amqplib
 * @param {function} originalHandler original consumer function
 * @returns {object} runnerResult original callback result
 */
function amqplibSubscriberMiddleware(message, callback, channel) {
    let originalHandlerSyncErr;
    let runnerResult;
    let nodeEvent;
    let nodeStartTime;
    try {
        if (message.properties.headers.bunnyBus) {
            utils$b.debugLog('[amqplib] Skipping BunnyBus messages');
            return callback(message);
        }

        // Initialize tracer and runner.
        tracer$8.restart();
        const { slsEvent: amqpEvent, startTime: amqpStartTime } =
        eventInterface$9.initializeEvent(
            'rabbitmq',
            message.fields.routingKey,
            'consume',
            'trigger'
        );
        utils$b.debugLog('[amqplib] Done initializing event');

        const metadata = {
            exchange: message.fields.exchange,
            redelivered: message.fields.redelivered,
            host: channel.connection.stream._host, // eslint-disable-line no-underscore-dangle
            consumer_tag: message.fields.consumerTag,
        };
        if (message.properties.headers[EPSAGON_HEADER$3]) {
            metadata[EPSAGON_HEADER$3] = message.properties.headers[EPSAGON_HEADER$3].toString();
        }

        tracer$8.addEvent(amqpEvent);
        utils$b.debugLog('[amqplib] Event added');
        eventInterface$9.finalizeEvent(amqpEvent, amqpStartTime, null, metadata, {
            headers: message.properties.headers,
            message: message.content.toString(),
        });

        const { label, setError, getTraceUrl } = tracer$8;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const runnerName = callback && callback.name ? callback.name : `${message.fields.routingKey}-consumer`;
        const { slsEvent, startTime } = eventInterface$9.initializeEvent(
            'node_function', runnerName, 'execute', 'runner'
        );
        nodeEvent = slsEvent;
        nodeStartTime = startTime;
        utils$b.debugLog('[amqplib] Runner initialized');
    } catch (err) {
        utils$b.debugLog('[amqplib] Exception initializing');
        tracer$8.addException(err);
    }

    try {
        runnerResult = callback(message);
        utils$b.debugLog('[amqplib] Original runner ran');
    } catch (err) {
        utils$b.debugLog('[amqplib] Original runner got an error');
        originalHandlerSyncErr = err;
    }

    try {
        if (nodeEvent) {
            // Handle and finalize async user function.
            if (utils$b.isPromise(runnerResult)) {
                utils$b.debugLog('[amqplib] Original runner is a promise');
                let originalHandlerAsyncError;
                runnerResult = runnerResult.catch((err) => {
                    utils$b.debugLog('[amqplib] Original runner in catch');
                    originalHandlerAsyncError = err;
                    throw err;
                }).finally(() => {
                    utils$b.debugLog('[amqplib] Original runner in finally');
                    eventInterface$9.finalizeEvent(
                        nodeEvent,
                        nodeStartTime,
                        originalHandlerAsyncError
                    );
                    tracer$8.sendTrace(() => {});
                    utils$b.debugLog('[amqplib] Trace sent');
                });
            } else {
                // Finalize sync user function.
                utils$b.debugLog('[amqplib] Original runner is not a promise');
                eventInterface$9.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
                tracer$8.sendTrace(() => {});
            }
            utils$b.debugLog('[amqplib] Runner added');
            tracer$8.addRunner(nodeEvent, runnerResult);
        }
    } catch (err) {
        utils$b.debugLog('[amqplib] Exception adding runner');
        tracer$8.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
    utils$b.debugLog('[amqplib] Return result');
    return runnerResult;
}

/**
 * Wraps the amqplib callback and channel consumer creation to wrap the run function
 * @param {Function} wrappedFunction The amqplib consumer function
 * @returns {Function} The wrapped function
 */
function amqplibConsumerWrapper(wrappedFunction) {
    trace_context.init();
    tracer$8.getTrace = trace_context.get;
    return function internalamqplibConsumerWrapper(queue, callback, options, cb0) {
        const channel = this;
        let patchedCallback = callback;
        if (typeof callback === 'function') {
            patchedCallback = message => trace_context.RunInContext(
                tracer$8.createTracer,
                () => amqplibSubscriberMiddleware(message, callback, channel)
            );
        }
        return wrappedFunction.apply(this, [queue, patchedCallback, options, cb0]);
    };
}

var amqplib = {
    /**
     * Initializes the amqplib tracer
     */
    init() {
        moduleUtils$8.patchModule(
            'amqplib/lib/callback_model.js',
            'consume',
            amqplibConsumerWrapper,
            amqplib => amqplib.Channel.prototype
        );
        moduleUtils$8.patchModule(
            'amqplib/lib/channel_model.js',
            'consume',
            amqplibConsumerWrapper,
            amqplib => amqplib.Channel.prototype
        );
    },
};

/**
 * @fileoverview Handlers for amqp instrumentation
 */

const {
    tracer: tracer$9,
    moduleUtils: moduleUtils$9,
    eventInterface: eventInterface$a,
    utils: utils$c,
} = epsagon;

const { EPSAGON_HEADER: EPSAGON_HEADER$4 } = http;

/**
 * acts as a middleware for `queue.subscribe()`
 * @param {object} queue queue object
 * @param {object} message message data
 * @param {object} headers headers data
 * @param {object} deliveryInfo information about the delivery
 * @param {object} messageObject raw message
 * @param {Function} originalCallback original consumer function
 * @returns {object} runnerResult original callback result
 */
function amqpSubscriberMiddleware(
    queue, message, headers, deliveryInfo, messageObject, originalCallback
) {
    let originalHandlerSyncErr;
    let runnerResult;
    let nodeEvent;
    let nodeStartTime;
    try {
        if (headers.bunnyBus) {
            utils$c.debugLog('[amqp] Skipping BunnyBus messages');
            return originalCallback(message, headers, deliveryInfo, messageObject);
        }

        // Initialize tracer and runner.
        tracer$9.restart();
        const { slsEvent: amqpEvent, startTime: amqpStartTime } =
        eventInterface$a.initializeEvent(
            'rabbitmq',
            deliveryInfo.routingKey,
            'consume',
            'trigger'
        );
        utils$c.debugLog('[amqp] Done initializing event');

        const metadata = {
            exchange: deliveryInfo.exchange,
            redelivered: deliveryInfo.redelivered,
            queue: deliveryInfo.queue,
            host: queue.connection.options.host,
            vhost: queue.connection.options.vhost,
            consumer_tag: deliveryInfo.consumerTag,
        };
        if (headers[EPSAGON_HEADER$4]) {
            metadata[EPSAGON_HEADER$4] = headers[EPSAGON_HEADER$4].toString();
        }

        tracer$9.addEvent(amqpEvent);
        utils$c.debugLog('[amqp] Event added');
        eventInterface$a.finalizeEvent(amqpEvent, amqpStartTime, null, metadata, {
            headers,
            message: JSON.stringify(message),
        });

        const { label, setError, getTraceUrl } = tracer$9;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const runnerName = originalCallback && originalCallback.name ? originalCallback.name : `${deliveryInfo.routingKey}-consumer`;
        const { slsEvent, startTime } = eventInterface$a.initializeEvent(
            'node_function', runnerName, 'execute', 'runner'
        );
        nodeEvent = slsEvent;
        nodeStartTime = startTime;
        utils$c.debugLog('[amqp] Runner initialized');
    } catch (err) {
        utils$c.debugLog('[amqp] Exception initializing');
        tracer$9.addException(err);
    }

    try {
        runnerResult = originalCallback(message, headers, deliveryInfo, messageObject);
        utils$c.debugLog('[amqp] Original runner ran');
    } catch (err) {
        utils$c.debugLog('[amqp] Original runner got an error');
        originalHandlerSyncErr = err;
    }

    try {
        if (nodeEvent) {
            // Handle and finalize async user function.
            if (utils$c.isPromise(runnerResult)) {
                utils$c.debugLog('[amqp] Original runner is a promise');
                let originalHandlerAsyncError;
                runnerResult = runnerResult.catch((err) => {
                    utils$c.debugLog('[amqp] Original runner in catch');
                    originalHandlerAsyncError = err;
                    throw err;
                }).finally(() => {
                    utils$c.debugLog('[amqp] Original runner in finally');
                    eventInterface$a.finalizeEvent(
                        nodeEvent,
                        nodeStartTime,
                        originalHandlerAsyncError
                    );
                    tracer$9.sendTrace(() => {});
                    utils$c.debugLog('[amqp] Trace sent');
                });
            } else {
                // Finalize sync user function.
                utils$c.debugLog('[amqp] Original runner is not a promise');
                eventInterface$a.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
                tracer$9.sendTrace(() => {});
            }
            utils$c.debugLog('[amqp] Runner added');
            tracer$9.addRunner(nodeEvent, runnerResult);
        }
    } catch (err) {
        utils$c.debugLog('[amqp] Exception adding runner');
        tracer$9.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
    utils$c.debugLog('[amqp] Return result');
    return runnerResult;
}

/**
 * Wraps the amqp queue consumer creation to wrap the run function
 * @param {Function} wrappedFunction The amqp queue function
 * @returns {Function} The wrapped function
 */
function amqpSubscribeWrapper(wrappedFunction) {
    trace_context.init();
    tracer$9.getTrace = trace_context.get;
    return function internalamqpSubscribeWrapper(options, messageListener, oldConsumerTag) {
        const queue = this;
        const originalCallback = typeof options === 'function' ? options : messageListener;
        let patchedCallback = originalCallback;
        if (typeof originalCallback === 'function') {
            patchedCallback = (
                message, headers, deliveryInfo, messageObject
            ) => trace_context.RunInContext(
                tracer$9.createTracer,
                () => amqpSubscriberMiddleware(
                    queue, message, headers, deliveryInfo, messageObject, originalCallback
                )
            );
        }
        if (typeof options === 'function') {
            options = patchedCallback; // eslint-disable-line no-param-reassign
        } else {
            messageListener = patchedCallback; // eslint-disable-line no-param-reassign
        }
        return wrappedFunction.apply(this, [options, messageListener, oldConsumerTag]);
    };
}

var amqp = {
    /**
     * Initializes the amqp tracer
     */
    init() {
        moduleUtils$9.patchModule(
            'amqp/lib/queue.js',
            'subscribe',
            amqpSubscribeWrapper,
            amqp => amqp.prototype
        );
    },
};

/**
 * @fileoverview Handlers for BunnyBus instrumentation
 */

const {
    tracer: tracer$a,
    moduleUtils: moduleUtils$a,
    eventInterface: eventInterface$b,
    utils: utils$d,
} = epsagon;

const { EPSAGON_HEADER: EPSAGON_HEADER$5 } = http;
/**
 * Post given trace to epsagon's infrastructure.
 * @param {*} time The trace data to send.
 * @param {*} callback The trace data to send.
 *  */
function sleep(time, callback) {
    const stop = new Date().getTime();
    while (new Date().getTime() < stop + time) {}
    callback();
}
/**
 * acts as a middleware for `BunnyBus consumer messages
 * @param {object} config data of the bunnybus
 * @param {Function} callback the callback function
 * @param {string} queue queue
 * @param {string} topic topic
 * @param {object} handlerParams original handler arguments
 * @returns {any} runnerResult results from callback
 */
function bunnybusSubscriberMiddleware(config, callback, queue, topic, handlerParams) {
    let originalHandlerSyncErr;
    let runnerResult;
    try {
        // Initialize tracer and runner.
        tracer$a.restart();
        const { slsEvent: amqpEvent, startTime: amqpStartTime } =
        eventInterface$b.initializeEvent(
            'rabbitmq',
            handlerParams.metaData.headers.routeKey,
            'consume',
            'trigger'
        );

        const metadata = {
            host: config.hostname,
            vhost: config.vhost,
            'messaging.message_payload_size_bytes': JSON.stringify(handlerParams.message).length,
        };
        if (handlerParams.metaData.headers[EPSAGON_HEADER$5]) {
            metadata[EPSAGON_HEADER$5] = handlerParams.metaData.headers[EPSAGON_HEADER$5].toString();
        }

        tracer$a.addEvent(amqpEvent);
        eventInterface$b.finalizeEvent(amqpEvent, amqpStartTime, null, metadata, {
            headers: handlerParams.metaData.headers,
            message: handlerParams.message,
        });

        const { label, setError, getTraceUrl } = tracer$a;
        // eslint-disable-next-line no-param-reassign
        handlerParams.epsagon = {
            label,
            setError,
            getTraceUrl,
        };

        const runnerName = callback && callback.name ? callback.name : `${topic}-consumer`;
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface$b.initializeEvent(
            'node_function', runnerName, 'execute', 'runner'
        );

        try {
            runnerResult = callback(handlerParams);
        } catch (err) {
            originalHandlerSyncErr = err;
        }

        // Handle and finalize async user function.
        if (utils$d.isPromise(runnerResult)) {
            let originalHandlerAsyncError;
            runnerResult = runnerResult.catch((err) => {
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                eventInterface$b.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerAsyncError);
                sleep(1000, () => {
                    console.log('Finished sleeping');
                });
                tracer$a.sendTrace(() => {});
            });
        } else {
            // Finalize sync user function.
            eventInterface$b.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
            tracer$a.sendTrace(() => {});
        }
        tracer$a.addRunner(nodeEvent, runnerResult);
    } catch (err) {
        tracer$a.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
    return runnerResult;
}

/**
 * Wraps the BunnyBus callback and channel consumer creation to wrap the run function
 * @param {Function} wrappedFunction The BunnyBus subscribe function
 * @returns {Function} The wrapped function
 */
function bunnybusConsumerWrapper(wrappedFunction) {
    trace_context.init();
    tracer$a.getTrace = trace_context.get;
    return function internalBunnybusConsumerWrapper({ queue, handlers, options }) {
        if (!queue) {
            // Support only version >=7.0.0
            utils$d.debugLog('Found BunnyBus <7.0.0, skipping instrumentation.');
            return wrappedFunction.apply(this, [{ queue, handlers, options }]);
        }
        try {
            const bunny = this;
            bunny.__EPSAGON_PATCH = {}; // eslint-disable-line no-underscore-dangle
            Object.keys(handlers).forEach((topic) => {
                const callback = handlers[topic];
                if (
                    typeof handlers[topic] === 'function' &&
                    bunny.__EPSAGON_PATCH && // eslint-disable-line no-underscore-dangle
                    !bunny.__EPSAGON_PATCH[topic] // eslint-disable-line no-underscore-dangle
                ) {
                    // eslint-disable-next-line no-underscore-dangle
                    bunny.__EPSAGON_PATCH[topic] = true;
                    // eslint-disable-next-line no-param-reassign
                    handlers[topic] = handlerParams => trace_context.RunInContext(
                        tracer$a.createTracer,
                        () => bunnybusSubscriberMiddleware(
                            this.config,
                            callback,
                            queue,
                            topic,
                            handlerParams
                        )
                    );
                }
            });
        } catch (err) {
            utils$d.debugLog(`Could not enable BunnyBus tracing - ${err}`);
        }
        return wrappedFunction.apply(this, [{ queue, handlers, options }]);
    };
}

var bunnybus = {
    /**
     * Initializes the BunnyBus tracer
     */
    init() {
        moduleUtils$a.patchModule(
            '@tenna-llc/bunnybus/lib/index.js',
            'subscribe',
            bunnybusConsumerWrapper,
            BunnyBus => BunnyBus.prototype
        );
    },
};

/**
 * @fileoverview Wrapping superagent's http library, since we can't trace calls
 * (async_hooks params always equals 0)
 */

const {
    tracer: tracer$b,
    moduleUtils: moduleUtils$b,
    eventInterface: eventInterface$c,
    utils: utils$e,
    httpHelpers,
} = epsagon;
const { EPSAGON_HEADER: EPSAGON_HEADER$6 } = http;

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
                eventInterface$c.initializeEvent(
                    'http',
                    hostname,
                    response.method,
                    'http'
                );

            const epsagonTraceId = httpHelpers.generateEpsagonTraceId();
            // Inject header to support tracing over HTTP requests
            if ((process.env.EPSAGON_DISABLE_HTTP_TRACE_ID || '').toUpperCase() !== 'TRUE') {
                response.set(EPSAGON_HEADER$6, epsagonTraceId);
            }

            eventInterface$c.addToMetadata(httpEvent,
                {
                    url,
                    http_trace_id: epsagonTraceId,
                }, {
                    path,
                });

            const responsePromise = new Promise((resolve) => {
                response.once('end', () => {
                    eventInterface$c.addToMetadata(httpEvent,
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
                    httpEvent.setDuration(utils$e.createDurationTimestamp(startTime));
                    resolve();
                });
            });

            tracer$b.addEvent(httpEvent, responsePromise);
        } catch (error) {
            tracer$b.addException(error);
        }

        return response;
    };
}

var superagent = {
    /**
   * Initializes the superagent tracer
   */
    init() {
        ['post', 'get', 'put', 'patch', 'delete'].forEach((method) => {
            moduleUtils$b.patchModule(
                'superagent',
                method,
                superagentWrapper
            );
        });
    },
};

/**
 * @fileoverview Wrapping superagent-wrapper's http library, since we can't trace calls
 * (async_hooks params always equals 0)
 */

const {
    tracer: tracer$c,
    moduleUtils: moduleUtils$c,
    eventInterface: eventInterface$d,
    utils: utils$f,
    httpHelpers: httpHelpers$1,
} = epsagon;
const { EPSAGON_HEADER: EPSAGON_HEADER$7 } = http;

/**
 * Wraps the superagent-wrapper http send command function with tracing
 * @param {Function} wrappedFunction The wrapped function from superagent-wrapper module
 * @returns {Function} The wrapped function
 */
function superagentWrapper$1(wrappedFunction) {
    return function internalSuperagentClientWrapper(req) {
        const response = wrappedFunction.apply(this, [req]);
        try {
            const { hostname, pathname: path } = new URL(req.url);

            const { slsEvent: httpEvent, startTime } =
                eventInterface$d.initializeEvent(
                    'http',
                    hostname,
                    req.method,
                    'http'
                );

            const epsagonTraceId = httpHelpers$1.generateEpsagonTraceId();
            // Inject header to support tracing over HTTP requests
            if ((process.env.EPSAGON_DISABLE_HTTP_TRACE_ID || '').toUpperCase() !== 'TRUE') {
                req.header[EPSAGON_HEADER$7] = epsagonTraceId;
            }

            eventInterface$d.addToMetadata(httpEvent,
                {
                    url: req.url,
                    http_trace_id: epsagonTraceId,
                }, {
                    request_headers: req.header,
                    path,
                });

            const responsePromise = new Promise((resolve) => {
                req.once('response', (res) => {
                    eventInterface$d.addToMetadata(httpEvent,
                        {
                            status_code: res.statusCode,
                        }, {
                            response_headers: res.headers,
                        });
                    httpHelpers$1.setJsonPayload(
                        httpEvent,
                        'response_body',
                        res.text,
                        res.headers['content-encoding']
                    );
                    httpEvent.setDuration(utils$f.createDurationTimestamp(startTime));
                    resolve();
                });
            });

            tracer$c.addEvent(httpEvent, responsePromise);
        } catch (error) {
            tracer$c.addException(error);
        }

        return response;
    };
}

var superagentWrapper_1 = {
    /**
   * Initializes the superagent-wrapper tracer
   */
    init() {
        moduleUtils$c.patchModule(
            '@tenna-llc/superagent-wrapper',
            '_setDefaults',
            superagentWrapper$1,
            wrapper => wrapper.ProxyAgent.prototype
        );
    },
};

/**
 * @fileoverview Wraps redis calls to support async context propagation
 */


const {
    tracer: tracer$d,
    moduleUtils: moduleUtils$d,
} = epsagon;
const { setAsyncReference: setAsyncReference$1 } = trace_context;

/**
 * Wraps the redis' send command function with tracing
 * @param {Function} wrappedFunction The wrapped function from redis module
 * @returns {Function} The wrapped function
 */
function redisClientWrapper(wrappedFunction) {
    return function internalRedisClientWrapper(commandObj) {
        try {
            // This is used to prevent duplicates command tracing. In this case,
            // the command won't be executed until the client is able to do it,
            // and the wrapped internal function will be called again.
            if (this.ready === false || this.stream.writable === false) {
                return wrappedFunction.apply(this, [commandObj]);
            }

            const originalAsyncId = async_hooks.executionAsyncId();

            const { callback } = commandObj;

            commandObj.callback = (err, res) => { // eslint-disable-line no-param-reassign
                setAsyncReference$1(originalAsyncId);

                if (callback) {
                    callback(err, res);
                }
            };
        } catch (error) {
            tracer$d.addException(error);
        }

        return wrappedFunction.apply(this, [commandObj]);
    };
}

var redis = {
    /**
   * Initializes the Redis tracer
   */
    init() {
        moduleUtils$d.patchModule(
            'redis',
            'internal_send_command',
            redisClientWrapper,
            redis => redis.RedisClient.prototype
        );
    },
};

/**
 * @fileoverview Handlers for WS instrumentation
 */

const {
    tracer: tracer$e,
    moduleUtils: moduleUtils$e,
    eventInterface: eventInterface$e,
    utils: utils$g,
} = epsagon;


/**
 * @param {Socket} socket socket object.
 * @return {string} socket address.
 */
const getWebsocketAddress = socket => (socket ? socket.localAddress : 'websocket');


/**
 * Handle event emitter of eventName='message'
 * @param {Message} message received message.
 * @param {*} originalHandler listener callback function.
 * @param {*} requestFunctionThis request arguments.
 */
function websocketEmitterMiddleware(message, originalHandler, requestFunctionThis) {
    let originalHandlerSyncErr;

    try {
        // Initialize tracer and evnets.
        tracer$e.restart();
        const { slsEvent: websocketEvent, startTime: websocketStartTime } =
        eventInterface$e.initializeEvent(
            'websocket',
            // eslint-disable-next-line no-underscore-dangle
            getWebsocketAddress(requestFunctionThis._socket),
            'messagePullingListener',
            'trigger'
        );
        tracer$e.addEvent(websocketEvent);
        // Getting message data.
        const triggerMetadata = { message };
        eventInterface$e.finalizeEvent(websocketEvent, websocketStartTime, null, triggerMetadata);

        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface$e.initializeEvent(
            'node_function', 'message_handler', 'execute', 'runner'
        );
        let runnerResult;
        try {
            runnerResult = originalHandler(message, {});
        } catch (err) {
            originalHandlerSyncErr = err;
        }
        const originalHandlerName = originalHandler.name;
        if (originalHandlerName) {
            nodeEvent.getResource().setName(originalHandlerName);
        }
        // Handle and finalize async user function.
        if (utils$g.isPromise(runnerResult)) {
            let originalHandlerAsyncError;
            runnerResult.catch((err) => {
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                eventInterface$e.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerAsyncError);
                tracer$e.sendTrace(() => {});
            });
        } else {
            // Finalize sync user function.
            eventInterface$e.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
            tracer$e.sendTrace(() => {});
        }
        tracer$e.addRunner(nodeEvent, runnerResult);
    } catch (err) {
        tracer$e.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        throw originalHandlerSyncErr;
    }
}

/**
 * Wraps websocket event emitter function with tracing.
 * @param {Function} wrappedFunction websocket init function
 * @return {Function} updated wrapped init
 */
function websocketEmitterWrapper(wrappedFunction) {
    trace_context.init();
    tracer$e.getTrace = trace_context.get;
    return function internalWebSocketEmitterWrapper(eventName, callback) {
        if (eventName !== 'message') {
            return wrappedFunction.apply(this, [eventName, callback]);
        }
        const requestFunctionThis = this;
        const patchedCallback = message => trace_context.RunInContext(
            tracer$e.createTracer,
            () => websocketEmitterMiddleware(message, callback, requestFunctionThis)
        );
        return wrappedFunction.apply(this, [eventName, patchedCallback]);
    };
}

var ws = {
    /**
     * Initializes the websocket tracer
     */
    init() {
        moduleUtils$e.patchModule(
            'ws',
            'on',
            websocketEmitterWrapper,
            websocket => websocket.prototype
        );
    },
};

/**
 * @fileoverview Patcher for all the libraries we are instrumenting
 * IMPORTANT: when requiring this module, all of the libraries will be automatically patched!
 */
const { config, utils: utils$h } = epsagon;

















/**
 * Patches a module
 * @param {Object} patcher module
 */
function patch(patcher) {
    try {
        patcher.init();
    } catch (error) {
        if ((process.env.EPSAGON_DEBUG || '').toUpperCase() === 'TRUE') {
            utils$h.debugLog(error);
        }
    }
}


if (!config.getConfig().isEpsagonPatchDisabled) {
    [
        express$1,
        hapi$1,
        koa$1,
        pubsub,
        nats,
        kafkajs,
        kafkaNode,
        sqsConsumer,
        amqplib,
        amqp,
        bunnybus,
        superagent,
        superagentWrapper_1,
        redis,
        ws,
    ].forEach(patch);
}

// Requiring patcher to instrument modules
 // eslint-disable-line no-unused-vars

epsagon.ignoreEndpoints = http.ignoreEndpoints;

var src = epsagon;

module.exports = src;
