/**
 * @fileoverview Handlers for sqs-consumer instrumentation
 */

const {
    tracer,
    moduleUtils,
    eventInterface,
    utils,
} = require('epsagon');
const traceContext = require('../trace_context.js');

/**
 * Handle consumer event from sqs
 * @param {SQSMessage} message received message.
 * @param {object} app consumer app.
 */
function sqsConsumerMiddleware(message, app) {
    // eslint-disable-next-line no-unused-vars
    const [_, __, awsPath, awsAccount, queueName] = app.queueUrl.split('/');
    const region = awsPath.split('.')[1];
    let originalHandlerSyncErr;
    try {
        // Initialize tracer and runner.
        tracer.restart();
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
        // Add error events
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
