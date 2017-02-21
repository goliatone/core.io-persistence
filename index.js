/*jshint esversion:6, node:true*/
'use strict';

/*
 * Expose Persistence
 */
module.exports.Persistence = require('./lib/Persistence');

/*
 * Expose BaseModel.
 * Our models will extend this class.
 */
module.exports.BaseModel = require('./lib/BaseModel');

/*
 * Default initializer for the module.
 *
 * You can always override this and make
 * a custom initializer.
 */
module.exports.init = require('./lib/init');

module.exports.capitalize = require('./lib/capitalize');
