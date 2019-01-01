'use strict';

const Persistence = require('./Persistence');

module.exports = function $initPersistence(context, config) {

    const _logger = context.getLogger(context.moduleid);

    _logger.info('Persistence module booting...');

    if (!config.logger) config.logger = _logger;
    if (!config.dispatcher) config.dispatcher = context;

    const persistence = new Persistence(config);

    return new Promise((resolve, reject) => {
        /*
         * Start our ORM framework. We will
         * autoload models from models directory,
         * when ready, we'll get notified.
         */
        persistence.connect().then(orm => {
            context.models = {};

            /*
             * Make all models available under
             * Model User will be available as:
             * context.models.user
             */
            context.provide('models', persistence.collections);

            /**
             * Expose a function to iterate over all registered
             * entities.
             */
            context.provide('iterateModels', persistence.iterateModels);

            /*
             * Export using export name.
             * Model User will be available as:
             * context.models.User
             * Where User is User.exportName
             */
            persistence.export(persistence.collections, context.models);

            _logger.info('Persistence module ready.');
            resolve(persistence);

        }).catch(err => {
            _logError(err);
            reject(err);
        });
    });

    function _logError(err) {
        _logger.error('---------------------');
        _logger.error('ORM ERR');
        _logger.error(err.message);
        _logger.error(err.stack);
        _logger.error('---------------------');
    }
};