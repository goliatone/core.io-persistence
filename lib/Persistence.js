/*jshint esversion:6, node:true*/
'use strict';

const BaseModel = require('./BaseModel');
const capitalize = require('./capitalize');
const extend = require('gextend');
const Promise = require('bluebird');
const Waterline = require('waterline');
const EventEmitter = require('events');

const fs = Promise.promisifyAll(require('fs'));

const join = require('path').join;
const resolve = require('path').resolve;
const basename = require('path').basename;
const logger = require('noop-console').logger();

var DEFAULTS = {
    logger,
    autoinitialize: true,
    exportToGlobal: true,
    eventTypePrefix: 'persistence',
    timeout: 0.5 * 60 * 1000, // 30s timeout,
    modelsDir: process.cwd() + '/models',
    REGEXP_FILE: /^.*\.(js)$/,
    orm: require('./config')
};

class Persistence extends EventEmitter {
    constructor(config) {
        super();
        this.name = 'persistence';

        config = extend({}, DEFAULTS, config);

        if (config.autoinitialize) this.init(config);
    }

    init(options) {
        /*
         * Initialize all future BaseModel instances
         * with this Persistence intance as their
         * "persistence" attribute.
         */
        BaseModel.prototype.persistence = this;

        if (!options.dispatcher) options.dispatcher = this;

        this.config = options;

        extend(this, options);

        var ormConfig = options.orm;

        this._validateORMConfig(ormConfig);

        var ormTimeout = options.timeout;

        this.orm = new Waterline();

        this.orm.connect = function(config = {}) {
            config = extend({}, ormConfig, config);

            return new Promise((resolve, reject) => {
                var __timeout = setTimeout(() => {
                    reject(new Error('ORM timeout'));
                }, ormTimeout);

                this.initialize(config, (err, orm) => {
                    clearTimeout(__timeout);
                    if (err) {
                        options.logger.error('ORM initialize error...', err.message);
                        reject(err);
                    } else resolve(orm);
                });
            });
        };
    }

    _validateORMConfig(config) {
        if (!config) {
            this.logger.warn('Persistence did not get any ORM configuration options.');
        }

        if (!config.connections) {
            this.logger.warn('Persistence did not get a connection configuration.');
            this.logger.warn('At the very least you need to define "%s".', BaseModel.prototype.connection);
            this.logger.warn('Did you forget?');

            throw new Error('Connection details not defined: ', BaseModel.connection);
        }
    }

    /*
     * Perform all async tasks needed to
     * bootstrap the engine.
     *
     * TODO: make recursive so we can load models
     *      from multiple directories.
     * TODO: posibly want to call loadDir multiple
     *       times before calling connect. One per
     *       module.
     */
    connect() {
        return this.loadDir(this.modelsDir).then(identities => {
            this.logger.info('Persistence: connected. Identitites are: %j', identities);

            return this.orm.connect().then((orm) => {
                if (!orm) throw new Error('Error creating ORM instance...');
                if (!orm.connections) throw new Error('No connections created');
                if (!orm.collections) this.logger.warn('ORM initialized but without models...');

                this.logger.info('Connections: %j', orm.connections.development)
                this.connections = orm.connections;
                this.collections = orm.collections;

                this.export();

                // if(this.exportToGlobal) this.export(orm.collections);
                // else this.logger.warn('Skipping export of models...');

                this.emit('persistence.ready', orm);

                return orm;
            }).catch(err => {
                this.emit('persistence.error', err);
                throw err;
            });
        }).catch(err => {
            this.logger.error('ERROR %s', err.message);
            throw err;
        });
    }

    loadDir(dir) {
        this.logger.log('Persistence: loading directory "%s".', dir);
        /*
         * does the dir exist
         */
        if (!this._dirExists(dir)) {
            //TODO: How should we handle this?! this _will_ screw most things
            //unless is an optional path... which, maybe but not really.
            var err = new Error('Persistence: model dir "' + dir + '" not found.');
            this.logger.error(err.message);
            return Promise.reject(err);
        }

        let identities = [];
        return fs.readdirAsync(dir).each(file => {
            if (!this.REGEXP_FILE.test(file)) return;
            let filename = basename(file, '.js');

            let p = resolve(join(dir, filename));

            let m = require(p);

            /*
             * If we did not specify an `exportName` we will
             * use the filename.
             * so models/ActivityLog.js will expose:
             * - models.ActivityLog
             * - models.activitylog
             */
            if (!m.prototype.exportName) m.prototype.exportName = filename;

            let id = m.prototype.identity;

            identities.push(id);

            let connection = m.prototype.connection;

            if (!this.hasConnection(connection)) {
                throw new Error('Model "' + id + '" requires a non existent conntection: "' + connection + '"');
            }

            return this.loadModel(id, m);
        }).then(_ => identities);
    }

    hasConnection(connection) {
        let c = this.config;
        if (!c || !c.orm || !c.orm.connections) {
            return false;
        }
        return !!c.orm.connections[connection];
    }

    _dirExists(dir) {
        try {
            fs.accessSync(dir);
        } catch (e) {
            return false;
        }

        return true;
    }

    /*
     * used by BaseModel instances to update on:
     * - create
     * - update
     * - delete
     */
    emitModelEvent(identity, action, record) {

        let event = {
            identity,
            action,
            record
        };

        //ie: persistence.user.update
        event.type = this.getEventType(identity, action);
        this.dispatcher.emit(event.type, event);

        //ie: persistence.user.*
        event.type = this.getEventType(identity, '*');
        this.dispatcher.emit(event.type, event);

        //catch all event
        event.type = 'persistence.*';
        this.dispatcher.emit(event.type, event);
    }

    /*
     * Makes the event type for the
     * entity's event.
     * If we want to customize it
     * we should override it.
     */
    getEventType(identity, action) {
        let type = identity + '.' + action;

        if (this.eventTypePrefix) {
            type = this.eventTypePrefix + '.' + type;
        }

        return type;
    }

    /**
     * Register a model once is ready.
     * 
     * @param {String} id Model identity string
     * @param {Object} model Model instance
     * @private
     */
    loadModel(id, model) {
        this.logger.info('Persistence: registering model %s', id);
        this.orm.loadCollection(model);
    }

    /**
     * Retrieve a model by its identity
     * 
     * @param {String} identity Model identity
     * @returns {Promise}
     * @throws {Error} If no matching model found
     */
    getModel(identity) {
        const Model = this.collections[identity];
        if (Model) return Promise.resolve(Model);
        return Promise.reject(new Error(`No model found matching identity: ${identity}`));
    }

    /**
     * Retrieve a model by its identity
     * syncronously.
     * 
     * @param {String} identity Model identity
     * @returns {Model}
     * @throws {Error} If no matching model found
     */
    getModelSync(identity) {
        const Model = this.collections[identity];
        if (Model) return Model;
        new Error(`No model found matching identity: ${identity}`);
    }

    /**
     * Iterate over each entity in the `collections`
     * attribute and call our callback with the 
     * model and it's entity name.
     * 
     * If we pass an array with a list of entity names
     * the iterator will skip these.
     * 
     * @param {Function} callback Called on each entity
     * @param {Array}  [ignored=[]] Set of identity names to ignore
     * @returns {void}
     */
    iterateModels(callback, ignored = []) {

        const visited = {};

        Object.keys(this.collections).map(identity => {
            /**
             * We actually register models twice, one in lowercase
             * and one in uppercase. Just ignore uppercase.
             * We are iterating over models and Waterline will 
             * create some junction tables for us.
             */
            identity = identity.toLowerCase();

            const isIgnored = ignored.includes(identity);
            const isMetaClass = identity.indexOf('_') > -1;
            const isRegistered = visited[identity];

            if (isIgnored || isMetaClass || isRegistered) {
                return;
            }

            visited[identity] = true;

            const resource = this.collections[identity];

            callback(resource, identity);
        });
    }

    /**
     * Export all available models using their
     * `exportName` if present.
     * @param {Array} collections Set of Models
     * @param {Object} context Context to injext
     */
    export (collections, context = global) {
        collections = collections || this.collections;

        if (!collections) {
            this.logger.error('The module %s was unable to export models...', this.name);
            this.logger.error('ORM returned empty collections');
            this.logger.error('If you do have models, make sure there are no errors');
            return;
        }

        this.logger.debug('Exporting models to context...');

        Object.keys(collections).map(m => {
            let name = collections[m].exportName || capitalize(m);
            if (name.indexOf('-') === 4) return;
            this.logger.debug('Exporting model "%s" as "%s"', m, name);
            context[name] = collections[m];
        });
    }
}

module.exports = Persistence;