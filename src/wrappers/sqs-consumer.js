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
    let originalHandlerSyncErr;
    try {
        // Initialize tracer and runner.
        tracer.restart();
        const { queueName, awsAccount, region } = parseQueueUrl(app.queueUrl);
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
        const snsData = sqsUtils.getSNSTrigger([message]);
        if (snsData != null) {
            eventInterface.addToMetadata(sqsEvent, { 'SNS Trigger': snsData });
        }

        const { label, setError } = tracer;
        // eslint-disable-next-line no-param-reassign
        message.epsagon = {
            label,
            setError,
        };
        const { slsEvent: nodeEvent, startTime: nodeStartTime } = eventInterface.initializeEvent(
            'node_function', 'message_handler', 'execute', 'runner'
        );
        let runnerResult;
        try {
            runnerResult = app.originalHandleMessage(message);
        } catch (err) {
            originalHandlerSyncErr = err;
        }

        if (app.originalHandleMessage.name) {
            nodeEvent.getResource().setName(app.originalHandleMessage.name);
        }

        // Handle and finalize async user function.
        if (utils.isPromise(runnerResult)) {
            let originalHandlerAsyncError;
            runnerResult.catch((err) => {
                originalHandlerAsyncError = err;
                throw err;
            }).finally(() => {
                eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerAsyncError);
                tracer.sendTrace(() => {});
            });
        } else {
            // Finalize sync user function.
            eventInterface.finalizeEvent(nodeEvent, nodeStartTime, originalHandlerSyncErr);
            tracer.sendTrace(() => {});
        }
        tracer.addRunner(nodeEvent, runnerResult);
    } catch (err) {
        tracer.addException(err);
    }
    // Throwing error in case of sync user function.
    if (originalHandlerSyncErr) {
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
        const app = wrappedFunction.apply(this, [options]);
        const patchedCallback = message => traceContext.RunInContext(
            tracer.createTracer,
            () => sqsConsumerMiddleware(message, app)
        );
        app.originalHandleMessage = app.handleMessage;
        app.handleMessage = patchedCallback;
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
