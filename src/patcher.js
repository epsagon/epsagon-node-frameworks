/**
 * @fileoverview Patcher for all the libraries we are instrumenting
 * IMPORTANT: when requiring this module, all of the libraries will be automatically patched!
 */
const { config, utils } = require('epsagon');
const expressPatcher = require('./wrappers/express.js');


/**
 * Patches a module
 * @param {Object} patcher module
 */
function patch(patcher) {
    try {
        patcher.init();
    } catch (error) {
        if ((process.env.EPSAGON_DEBUG || '').toUpperCase() === 'TRUE') {
            utils.debugLog(error);
        }
    }
}


if (!config.getConfig().isEpsagonPatchDisabled) {
    [
        expressPatcher,
    ].forEach(patch);
}
