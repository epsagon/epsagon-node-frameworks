/** @fileoverview clear tracers every hour */

const { utils } = require('epsagon');
const schedule = require('node-schedule');
const traceContext = require('../trace_context');

const MAX_TRACERS = parseInt(process.env.EPSAGON_RESOURCE_MAX_TRACERS || '50', 10);
const MAX_TRACER_TTL = parseInt(process.env.EPSAGON_RESOURCE_MAX_TRACER_TTL || '300', 10);
const TTL_CHECK_CRON_EXPR = process.env.EPSAGON_RESOURCE_TTL_CHECK_CRON || '*/5 * * * *'; // every 5 minutes
const CLEAR_TRACERS_CRON_EXPR = process.env.EPSAGON_RESOURCE_CLEAR_TRACERS_CRON || '0 * * * *'; // every hour

/** clear all tracers */
function clearTracers() {
    utils.debugLog('[resource-monitor] removing tracers from memory');
    traceContext.privateClearTracers(MAX_TRACERS);
}

/** run ttl checks */
function tracersTTLCheck() {
    /**
     * predicate to check if tracer should be deleted
     * @param {Object} tracer    the tracer to check
     * @returns {Boolean} indication if the tracer should be deleted
     */
    function shouldDelete(tracer) {
        if (!tracer.createdAt) {
            return false;
        }

        const now = Date.now();
        const elapsed = (now - tracer.createdAt) / 1000; // to seconds
        return elapsed > MAX_TRACER_TTL;
    }

    traceContext.privateCheckTTLConditions(shouldDelete);
}

schedule.scheduleJob('checkTTL', TTL_CHECK_CRON_EXPR, tracersTTLCheck);
schedule.scheduleJob('clearTracers', CLEAR_TRACERS_CRON_EXPR, clearTracers);
