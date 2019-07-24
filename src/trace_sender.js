/**
 * @fileoverview Traces sender.
 */

let sender;
const BULK_SIZE = 500;
const { utils, config } = require('epsagon');
const axios = require('axios');
const http = require('http');
const https = require('https');

/**
 * The timeout to send for send operations (both sync and async)
 */
const sendTimeoutMilliseconds = 3000;

/**
 * Session for the post requests to the collector
 */
const session = axios.create({
    timeout: sendTimeoutMilliseconds,
    httpAgent: new http.Agent({ keepAlive: true }),
    httpsAgent: new https.Agent({ keepAlive: true }),
});

/**
 * Initializes the traces sender.
 */
function init() {
    sender = {
        traces: [],
    };
}

/**
 * Returns the traces sender.
 * @return {Object} traces sender object.
 */
function get() {
    if (!sender) init();
    return sender;
}

/**
 * Send traces to collector
 * @return {Object} TODO
 */
function sendTraces() {
    delete sender.timer;
    const tracesToSend = sender.traces;
    sender.traces = [];
    utils.debugLog(`Posting ${tracesToSend.length} traces to ${config.getConfig().traceCollectorURL}`);

    return session.post(
        config.getConfig().traceCollectorURL,
        tracesToSend,
        { headers: { Authorization: `Bearer ${config.getConfig().token}` } }
    ).then((res) => {
        utils.debugLog('Traces posted!');
        return res;
    }).catch((err) => {
        utils.debugLog(`Error sending trace. Trace size: ${err.config.data.length}`);
        utils.debugLog(err.stack);
        return err;
    }); // Always resolve.
}

/**
 * Add tracer to the sender object, and send traces if there are enough for bulk.
 * @param {Object} trace to add to the list.
 */
function addTrace(trace) {
    sender.traces.push(trace);
    if (!sender.timer) {
        sender.timer = setTimeout(sendTraces, sendTimeoutMilliseconds);
    }
    if (sender.traces.length >= BULK_SIZE) {
        clearTimeout(sender.timer);
        sendTraces();
    }
}


module.exports = {
    get,
    init,
    addTrace,
};
