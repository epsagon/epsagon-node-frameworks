/**
 * @fileoverview Handlers for sqs-consumer instrumentation
 */

const {
    tracer,
    moduleUtils,
    eventInterface,
    utils,
    sqsUtils,
} = require('epsagon');
const traceContext = require('../trace_context.js');

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
    utils.debugLog('sqs-consumer - starting middleware');
    let originalHandlerSyncErr;
    try {
        // Initialize tracer and runner.
        tracer.restart();
        const { queueName, awsAccount, region } = parseQueueUrl(app.queueUrl);
        utils.debugLog('sqs-consumer - parsed queue url', queueName, awsAccount, region);
        const { slsEvent: sqsEvent, startTime: sqsStartTime } =
        eventInterface.initializeEvent(
            'sqs',
            queueName,
            'ReceiveMessage',
            'trigger'
        );
        tracer.addEvent(sqsEvent);
        eventInterface.finalizeEvent(sqsEvent, sqsStartTime, null, {
            aws_account: awsAccount,
            region,
            md5_of_message_body: message.MD5OfBody,
            message_id: message.MessageId,
        }, {
            message_body: message.Body,
            message_attributed: message.MessageAttributes,
        });
        utils.debugLog('sqs-consumer - created sqs event');
        const snsData = sqsUtils.getSNSTrigger([message]);
        if (snsData != null) {
            utils.debugLog('sqs-consumer - created sns event');
            eventInterface.addToMetadata(sqsEvent, { 'SNS Trigger': snsData });
        }

        const { label, setError, getTraceUrl } = tracer;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
            getTraceUrl,
        };
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface.initializeEvent(
            'node_function', 'message_handler', 'execute', 'runner'
        );
        utils.debugLog('sqs-consumer - initialized runner event');
        let runnerResult;
        try {
            runnerResult = app.originalHandleMessage(message);
            utils.debugLog('sqs-consumer - executed original handler');
        } catch (err) {
            utils.debugLog('sqs-consumer - error in original handler');
            originalHandlerSyncErr = err;
        }

        if (app.originalHandleMessage.name) {
            utils.debugLog('sqs-consumer - set handler name');
            nodeEvent.getResource().setName(app.originalHandleMessage.name);
        }

        // Handle and finalize async user function.
        if (utils.isPromise(runnerResult)) {
            utils.debugLog('sqs-consumer - result is promise');
            let originalHandlerAsyncError;
            runnerResult.catch((err) => {
                utils.debugLog('sqs-consumer - original handler threw error');
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                utils.debugLog('sqs-consumer - finalizing event');
                eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerAsyncError);
                utils.debugLog('sqs-consumer - sending trace');
                tracer.sendTrace(() => {}).then(() => {
                    utils.debugLog('sqs-consumer - trace sent');
                });
                utils.debugLog('sqs-consumer - post send');
            });
        } else {
            // Finalize sync user function.
            utils.debugLog('sqs-consumer - response not promise');
            utils.debugLog('sqs-consumer - finalizing event');
            eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
            utils.debugLog('sqs-consumer - sending trace');
            tracer.sendTrace(() => {}).then(() => {
                utils.debugLog('sqs-consumer - trace sent');
            });
            utils.debugLog('sqs-consumer - post send');
        }
        tracer.addRunner(nodeEvent, runnerResult);
        utils.debugLog('sqs-consumer - added runner');
    } catch (err) {
        utils.debugLog(`sqs-consumer - general error ${err}`);
        tracer.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
        utils.debugLog('sqs-consumer - rethrowing original sync error');
        throw originalHandlerSyncErr;
    }
}

/**
 * Wraps sqs-consumer create event emitter function with tracing.
 * @param {Function} wrappedFunction sqs-consumer init function
 * @return {Function} updated wrapped init
 */
function sqsConsumerWrapper(wrappedFunction) {
    traceContext.init();
    tracer.getTrace = traceContext.get;
    return function internalSqsConsumerWrapper(options) {
        utils.debugLog('sqs-consumer - inside wrapper');
        utils.debugLog(`sqs-consumer - options: ${options}`);
        const app = wrappedFunction.apply(this, [options]);
        const patchedCallback = message => traceContext.RunInContext(
            tracer.createTracer,
            () => sqsConsumerMiddleware(message, app)
        );
        app.originalHandleMessage = app.handleMessage;
        app.handleMessage = patchedCallback;
        utils.debugLog('sqs-consumer - done wrapper');
        return app;
    };
}

module.exports = {
    /**
     * Initializes the sqs-consumer tracer
     */
    init() {
        moduleUtils.patchModule(
            'sqs-consumer',
            'create',
            sqsConsumerWrapper,
            sqs => sqs.Consumer
        );
    },
};
