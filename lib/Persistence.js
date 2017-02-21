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

var DEFAULTS = {
    logger: console,
    autoinitialize: true,
    exportToGlobal: true,
    eventTypePrefix: 'persistence',
    timeout: 0.5 * 60 * 1000,// 30s timeout,
    modelsDir: process.cwd() + '/models',
    REGEXP_FILE: /[^\/\~]$/,
    orm: require('./config')
};


class Persistence extends EventEmitter {
    constructor(config){
        super();
        this.name = 'persistence';

        config = extend({}, DEFAULTS, config);
        if(config.autoinitialize) this.init(config);
    }

    init(options){

        /*
         * Initialize all future BaseModel instances
         * with this Persistence intance as their
         * "persistence" attribute.
         */
        BaseModel.prototype.persistence = this;

        if(!options.dispatcher) options.dispatcher = this;

        extend(this, options);

        var ormConfig = options.orm;

        this._validateORMConfig(ormConfig);

        var ormTimeout = options.timeout;

        this.orm = new Waterline();

        this.orm.connect = function(config){
            config = extend({}, ormConfig, config);

            return new Promise((resolve, reject) => {
                var __timeout = setTimeout(function(){
                    reject(new Error('ORM time out'));
                }, ormTimeout);

                this.initialize(config, (err, orm)=> {
                    clearTimeout(__timeout);
                    if(err) reject(err);
                    else resolve(orm);
                });
            });
        };
    }

    _validateORMConfig(config){
        if(!config){
            this.logger.warn('Persistence did not get any ORM configuration options.');
        }

        if(!config.connections){
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
    connect(){
        return this.loadDir(this.modelsDir).then((identities) => {
            this.logger.info('Persistence: connected. Identitites are: %j', identities);

            return this.orm.connect().then((orm) => {
                if(!orm) throw new Error('Error creating ORM instance...');
                if(!orm.connections) throw new Error('No connections created');
                if(!orm.collections) this.logger.warn('ORM initialized but without models...');

                this.connections = orm.connections;
                this.collections = orm.collections;

                this.export();

                // if(this.exportToGlobal) this.export(orm.collections);
                // else this.logger.warn('Skipping export of models...');

                this.emit('persistence.ready', orm);

                return orm;
            }).catch((err)=> {
                this.emit('persistence.error', err);
                return err;
            });
        }).catch((err)=> {
            this.logger.error('ERROR %s', err.message);
            return err;
        });
    }

    loadDir(dir){
        this.logger.log('Persistence: loading directory "%s".', dir);
        /*
         * does the dir exist
         */
        if(!this._dirExists(dir)){
            //TODO: How should we handle this?! this _will_ screw most things
            //unless is an optional path... which, maybe but not really.
            var err = new Error('Persistence: model dir "' + dir + '" not found.');
            this.logger.error(err.message);
            return Promise.reject(err);
        }

        let identities = [];
        return fs.readdirAsync(dir).each((file)=>{
            if(!this.REGEXP_FILE.test(file)) return;
            var p = resolve(join(dir, basename(file, '.js')));
            var m = require(p);
            var id = m.prototype.identity;
            identities.push(id);
            return this.loadModel(id, m);
        }).then(() => identities);
    }

    _dirExists(dir){
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
    emitModelEvent(identity, action, record){

        //ie: persistence.user.update
        var etype = this.getEventType(identity, action);
        this.dispatcher.emit(etype, record);

        //ie: persistence.user.*
        etype = this.getEventType(identity, '*');
        this.dispatcher.emit(etype, record);

        //catch all event
        this.dispatcher.emit('persistence.*', {
            identity,
            action,
            record
        });
    }

    /*
     * Makes the event type for the
     * entity's event.
     * If we want to customize it
     * we should override it.
     */
    getEventType(identity, action){
        let type = identity + '.' + action;

        if(this.eventTypePrefix){
            type = this.eventTypePrefix + '.' + type;
        }

        return type;
    }

    loadModel(id, model){
        this.logger.info('Persistence: registering model %s', id);
        this.orm.loadCollection(model);
    }

    getModel(id) {
        var Model = this.collections[id];
        if(Model) return Promise.resolve(Model);
        return Promise.reject(new Error('No model found matching identity: ' + id));
    }

    export(collections, target=global){
        collections = collections || this.collections;

        if(!collections) {
            this.logger.warn('The module %s was unable to export models...', this.name);
            this.logger.warn('ORM returned empty collections');
            return;
        }

        this.logger.info('Exporting models to target...');

        Object.keys(collections).map((m) =>{
            var name = collections[m].exportName || capitalize(m);
            this.logger.info('Exporting model "%s" as "%s"', m, name);
            target[name] = collections[m];
        });
    }
}

module.exports = Persistence;
