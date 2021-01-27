/** @fileoverview clear tracers every hour */

const { utils } = require('epsagon');
const schedule = require('node-schedule');
const traceContext = requre('../trace_context');

const MAX_TRACERS = parseInt(process.env.EPSAGON_RESOURCE_MAX_TRACERS || '50', 10);
const CLEAR_TRACERS_CRON_EXPR = process.env.EPSAGON_RESOURCE_CLEAR_TRACERS_CRON || '0 * * * *'; // every hour

function clearTracers() {
    utils.debugLog('[resource-monitor] removing tracers from memory');
    traceContext.privateClearTracers(MAX_TRACERS);
};

schedule.scheduleJob('clearTracers', CLEAR_TRACERS_CRON_EXPR, clearTracers);
