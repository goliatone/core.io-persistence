/*jshint esversion:6, node:true*/
'use strict';

const extend = require('gextend');
const Waterline = require('waterline');
var uuid = require('random-uuid-v4');

var BaseModel = Waterline.Collection.extend({
    persistence: null,
    connection: process.env.NODE_ENV || 'default',
    attributes: {
        displayName: function(){
            var props = ['name', 'label', 'id', 'createdAt', 'updatedAt'];
            var found = false;

            Object.keys(this).map(function(key){
                props.map(function(prop){
                    if(found) return;
                    if(prop !== key) return;
                    if(typeof this[prop] !== 'string') return;
                    found = prop;
                }, this);
            }, this);
            return this[found];
        },
        uuid: {
            type: 'string',
            unique: true,
            // required: true,
            defaultsTo: function() { return uuid();}
        }
    },
    afterCreate: function (record, next) {
        if(this.persistence){
            this.persistence.emitModelEvent(this.identity, 'create',  record);
        }
        next();
    },

    afterUpdate: function(record, next) {
        if(this.persistence){
            this.persistence.emitModelEvent(this.identity, 'update',  record);
        }
        next();
    },

    afterDestroy: function(record, next){
        if(this.persistence){
            this.persistence.emitModelEvent(this.identity, 'destroy',  record);
        }
        next();
    },
    updateOrCreate: function(criteria, values, populate, cb) {
        
        if(typeof populate === 'function') {
            cb = populate;
            populate = undefined;
        }

        cb = cb || function(){};

        let id = values.id;
        // delete values.id;

        if(!criteria) {
            // criteria = {id: record.id};
            console.warn('%s:updateOrCreate called without "criteria" argument.', this.exportName);
            criteria = id ? {id} : {};
        }

        // console.log('%s.findOne(%j)', this.exportName, criteria);

        let query = this.findOne(criteria);

        if(populate) {
            if(typeof populate === 'string' || Array.isArray(populate)){
            } else if(typeof populate === 'object') {
                if(populate.name) query.populate(populate.name, populate.criteria);
                else query.populate(populate);
            }
        }
        // console.log('%s.updateOrCreate(%j, %j)', this.exportName, criteria, values);
        // console.log('Populate-> %j', populate);

        return query.then((model) => {
            if(model) {
                return this.update(model.id, values).then((res) => {
                    return res[0];
                });
            }
            // console.log('Query did not return an instance, we create %%s.', id);
            // console.log('----');
            // if(id) values.id = id;
            return this.create(values);
        });
    }
});

BaseModel.extend = function(protoProps, staticProps) {
  // Waterline wants each model to have its own connection property, rather than inheriting
    if (protoProps.connection === undefined) {
        protoProps.connection = this.prototype.connection;
    }
    // Waterline wants each model to have its own attributes property, we want to combine
    if (protoProps.attributes === undefined) {
        protoProps.attributes = {};
    }

    ['afterCreate', 'afterUpdate', 'afterDestroy'].map((method)=>{
        var _ac = protoProps[method];
        if(_ac){
            protoProps[method] = function $basemodelExtendedActions(record, next){
                var self = this;

                var wrap = function $basemodelExtendedActionWrapper(err){
                    if(err) next(err);
                    else self.constructor.__super__[method](record, next);
                };

                _ac.call(protoProps, record, wrap);
            };
        }
    });

    protoProps.attributes = extend({}, this.prototype.attributes, protoProps.attributes);
    return Waterline.Collection.extend.call(this, protoProps, staticProps);
};

BaseModel.uuid = uuid;

module.exports = BaseModel;
