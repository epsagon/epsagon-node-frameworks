/**
 * @fileoverview monitor and manage epsagon resource usage
 */

const schedule = require('node-schedule');
const { utils } = require('epsagon');
const trace_context = require('./trace_context');

const MAX_TRACERS = parseInt(process.env.EPSAGON_RESOURCE_MAX_TRACERS || '50', 10);
const CLEAR_TRACERS_CRON_EXPR = process.env.EPSAGON_RESOURCE_CLEAR_TRACERS_CRON || '0 * * * *';

schedule.scheduleJob('clearTracesEveryHour', CLEAR_TRACERS_CRON_EXPR, () => {
    utils.debugLog('[resource-monitor] removing tracers from memory');
    trace_context.__private_clear_tracers(MAX_TRACERS);
});
