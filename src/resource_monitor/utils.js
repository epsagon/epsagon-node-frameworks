/**
 * @fileoverview utils for the resource monitor module
 */

const os = require('os');

/**
 * get cpu info
 * @returns {Object} cpu info
 */
function getCPUInfo() {
    const cpus = os.cpus();
    const counts = cpus.reduce((sum, current) => ({
        user: sum.user + current.times.user,
        nice: sum.nice + current.times.nice,
        sys: sum.sys + current.times.sys,
        irq: sum.irq + current.times.irq,
        idle: sum.idle + current.times.idle,
    }), {
        user: 0,
        nice: 0,
        sys: 0,
        irq: 0,
        idle: 0,
    });

    const {
        user,
        nice,
        sys,
        idle,
        irq,
    } = counts;
    const total = user + nice + sys + idle + irq;
    return {
        idle,
        total,
    };
}

/**
 * get cpu usage
 * @returns {Promise<Number>} cpu usage
 */
function getCPUUsage() {
    return new Promise((resolve) => {
        const stats1 = getCPUInfo();
        const startIdle = stats1.idle;
        const startTotal = stats1.total;

        setTimeout(() => {
            const stats2 = getCPUInfo();
            const endIdle = stats2.idle;
            const endTotal = stats2.total;
            const idle = endIdle - startIdle;
            const total = endTotal - startTotal;
            const perc = idle / total;

            resolve(1 - perc);
        }, 1000);
    });
}

/**
 * get memory usage
 * @returns {Number} memory usage percent
 */
function getMemoryUsage() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return used / total;
}

module.exports = { getCPUUsage, getMemoryUsage };
