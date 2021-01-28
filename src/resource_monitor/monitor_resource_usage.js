/** @fileoverview track cpu and memory usage and shutdown epsagon when necessary */

const schedule = require('node-schedule');
const epsagon = require('epsagon');
const traceContext = require('../trace_context');
const { getCPUUsage, getMemoryUsage } = require('./utils');

const MAX_CPU_USAGE = parseInt(process.env.EPSAGON_RESOURCE_MAX_CPU || '90', 10) / 100;
const MAX_MEM_USAGE = parseInt(process.env.EPSAGON_RESOURCE_MAX_MEM || '90', 10) / 100;
const RESOURCE_MONITOR_CRON_EXPR = process.env.EPSAGON_RESOURCE_MONITOR_CRON || '* * * * *'; // every minute

/** check cpu/mem usage */
function monitorResources() {
    console.log('[resource-monitor] checking resource usage');
    getCPUUsage().then((usedCPU) => {
        const usedMemory = getMemoryUsage();

        if (usedCPU > MAX_CPU_USAGE || usedMemory > MAX_MEM_USAGE) {
            console.log(
                `[resource-monitor] cpu/mem exceeded allowed limit, disabling epsagon, cpu: ${usedCPU}, mem: ${usedMemory}`
            );

            // disable epsagon
            epsagon.unpatch();
            traceContext.disableTracing();
        }
    });
}

schedule.scheduleJob('monitorResources', RESOURCE_MONITOR_CRON_EXPR, monitorResources);
