'use strict';

const Persistence = require('./Persistence');

module.exports = function $initPersistence(context, config) {

    const _logger = context.getLogger('persistence');

    _logger.info('Persistence module booting...');

    if(!config.logger) config.logger = _logger;
    if(!config.dispatcher) config.dispatcher = context;

    const persistence = new Persistence(config);

    return new Promise((resolve, reject) => {
        /*
         * Start our ORM framework. We will
         * autoload models from models directory,
         * when ready, we'll get notified.
         */
        persistence.connect().then((orm)=>{
            
            function register() {
                context.models = {};
                
                /*
                    * Make all models available under
                    * Model User will be available as:
                    * context.models.user
                    */
                context.models = persistence.collections;
    
                /*
                    * Export using export name.
                    * Model User will be available as:
                    * context.models.User
                    * Where User is User.exportName
                    */
                persistence.export(persistence.collections, context.models);
            }
            
            register();

            _logger.info('Persistence module ready.');
            
            persistence.on('persistence.reloaded', (orm)=>{
                _logger.info('Persistence module has been relaoded....');
                register();
                //TODO: context.invalidate();
                context.emit('context.invalidated');
            });

            // context.emit('persistence.ready');
            resolve(persistence);

        }).catch(function(err) {
            _logError(err);
            reject(err);
        });
    });

    function _logError(err){
        _logger.error('---------------------');
        _logger.error('ORM ERR');
        _logger.error(err.message);
        _logger.error(err.stack);
        _logger.error('---------------------');
    }
};
