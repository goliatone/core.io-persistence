'use strict';

const extend = require('gextend');
const Waterline = require('waterline');
const uuid = require('random-uuid-v4');

const _create = Waterline.Model.prototype.create;

Waterline.Model.prototype.create = function(newRecord, explicitCbMaybe, metaContainer) {
    if (this._callbacks.beforeValidate) {
        this._callbacks.beforeValidate(newRecord);
    }
    return _create.call(this, newRecord, explicitCbMaybe, metaContainer);
};

const _createEach = Waterline.Model.prototype.createEach;

Waterline.Model.prototype.createEach = function(...args) {
    if (this._callbacks.beforeValidate) {
        args[0].map(this._callbacks.beforeValidate);
    }
    return _createEach.apply(this, args);
};


/**
 * Add an `updateOrCreate` method to our
 * models.
 */
Waterline.Model.prototype.updateOrCreate = async function $updateOrCreate(criteria, values, populate) {

    if (!values) {
        values = criteria;
    }


    let id = values.id;
    // delete values.id;

    if (!criteria) {
        // criteria = {id: record.id};
        console.warn(
            '%s:updateOrCreate called without "criteria" argument.',
            this.globalId
        );
        criteria = id ? { id } : {};
    }

    // console.log('%s.findOne(%j)', this.globalId, criteria);

    let query = this.findOne(criteria);

    if (populate) {
        if (typeof populate === 'string' || Array.isArray(populate)) {} else if (typeof populate === 'object') {
            if (populate.name) {
                query.populate(populate.name, populate.criteria);
            } else query.populate(populate);
        }
    }
    // console.log('%s.updateOrCreate(%j, %j)', this.globalId, criteria, values);
    // console.log('Populate-> %j', populate);

    let model = await query;

    if (model) {
        return this.updateOne(model.id).set(values);
    }
    // console.log('Query did not return an instance, we create %%s.', id);
    // console.log('----');
    // if(id) values.id = id;
    return this.create(values).fetch();
};


const BaseModel = {
    persistence: null,
    primaryKey: 'id',
    datastore: process.env.NODE_ENV || 'default',
    // tableName:,
    // fetchRecordsOnCreate: true,
    // fetchRecordsOnUpdate: true,
    // fetchRecordsOnDestroy: true,
    // fetchRecordsOnCreateEach: true,
    //cascadeOnDestroy: true,

    /**
     * TODO: Not sure if this is a great idea
     * https://github.com/balderdashy/sails-mongo/blob/master/test/run-adapter-specific-tests.js#L731
     */
    dontUseObjectIds: true,
    attributes: {
        /**
         * This actually will be defined differently
         * depending on adapter.
         */
        id: {
            type: 'string',
            columnName: '_id',
            required: true,
            defaultsTo: uuid,
            autoMigrations: {
                columnType: 'string',
                unique: true,
                required: true,
                autoIncrement: false
            }
        },
        uuid: {
            type: 'string',
            required: true,
            unique: true,
            index: true,
            defaultsTo: uuid
        },
        createdAt: { type: 'string', autoCreatedAt: true, },
        updatedAt: { type: 'string', autoUpdatedAt: true, },
    }
};

BaseModel.extend = function(protoProps, _) {

    if (protoProps.connection) {
        protoProps.datastore = protoProps.connection;
        delete protoProps.connection;
    }

    if (protoProps.exportName) {
        protoProps.globalId = protoProps.exportName;
        delete protoProps.exportName;
    }

    /**
     * Create lifecycle callback methods:
     * - afterCreate
     * - afterUpdate
     * - afterDestroy
     */
    ['create', 'update', 'destroy'].map(action => {
        const method = makeLifecycleCallback(action);

        const callback = protoProps[method];
        protoProps[method] = makeCallback(BaseModel, action, protoProps.identity, callback);
    });

    /**
     * Bootstrap prototype properties with
     * what we have defined in BaseModel.
     * TODO: We don't want to extend, we want to overwrite!
     * ! We are merging two attribute definitions, probably not
     * ! what we want to do.
     */
    protoProps = extend({},
        BaseModel,
        protoProps
    );

    /**
     * v1 no longer supports functions as `defaultsTo`
     * so we need to accomplish this on a `beforeCreate`
     * hook.
     */
    const _defaultsTo = {};
    Object.keys(protoProps.attributes).forEach(key => {
        let attr = protoProps.attributes[key];

        //TODO: make sure we have the right types
        //Here we want to use columnType
        //@see https://sailsjs.com/documentation/concepts/models-and-orm/attributes#?columntype
        if (attr.type === 'text') {
            attr.type = 'string';
        }

        /**
         * Check to see if we have a function to set
         * a default value. If we do store it and remove
         * it so it passes validation.
         */
        if (attr && typeof attr.defaultsTo === 'function') {
            _defaultsTo[key] = attr.defaultsTo;
            delete attr.defaultsTo;
        }

        /**
         * Enable individual model definitions to remove 
         * any of the default fields. We want to do this after
         * we extend our `protoProps`.
         */
        if (attr == null) {
            delete protoProps.attributes[key];
        }

        //attr = uuid. prop = type, unique
        Object.keys(attr).map(prop => {
            /**
             * If this is a validation key, lets 
             * move it to it's own object.
             */
            if (validationKeys.includes(prop)) {
                if (typeof attr.validations !== 'object') {
                    attr.validations = {};
                }
                attr.validations[prop] = attr[prop];
                delete attr[prop];
            }

            if (autoMigrationKeys.includes(prop)) {
                if (typeof attr.autoMigrations !== 'object') {
                    attr.autoMigrations = {};
                }
                attr.autoMigrations[prop] = attr[prop];
                delete attr[prop];
            }
        });

    });

    /**
     * If we actually have old style `defaultsTo`
     * then we wrap them in a `beforeValidate` function
     * which is also not supported.
     * This gets called in both create and createEach.
     * We override those methods ^^.
     */
    if (_notEmpty(_defaultsTo)) {
        const _beforeValidate = protoProps.beforeValidate;
        protoProps.beforeValidate = function $beforeCreateDefaults(record, _) {
            Object.keys(_defaultsTo).map(key => {
                let value = record[key];
                if (value !== undefined && value !== '') return;
                record[key] = _defaultsTo[key]();
            });

            if (_beforeValidate) _beforeValidate(record, _);
        };
    }

    return Waterline.Model.extend(protoProps);
};

BaseModel.uuid = uuid;

module.exports = BaseModel;


function capitalize(word = '') {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * Returns a lifecycle method:
 * - afterCreate
 * - afterUpdate
 * - afterDelete
 * 
 * @param {String} action create|update|delete
 * @returns {String} Lifecycle method name
 */
function makeLifecycleCallback(action) {
    return `after${capitalize(action)}`;
}

/**
 * This will return a function that can be used
 * for one of the lifecycle callbacks.
 * 
 * @param {Object} Model BaseModel
 * @param {String} action CRUD action
 * @param {String} identity Model identity
 * @param {Function} propMethod Original method defined in props
 */
function makeCallback(Model, action, identity, propMethod) {

    return function $baseExtendedAction(record, next) {

        function $done(err) {
            if (err) return next(err);

            if (Model.persistence) {
                Model.persistence.emitModelEvent(identity, action, record);
            }

            next();
        }

        if (propMethod) propMethod(record, $done);
        else $done();
    }
}

function _notEmpty(obj) {
    if (typeof obj === 'object') {
        return Object.keys(obj).length > 0;
    }
}

const autoMigrationKeys = [
    'index',
    'unique',
    'autoIncrement',
    //'allowNull', //only valid on string, number, boolean
    'columnType',
];

const metaKeys = [
    'skipAllLifecycleCallbacks',
];

const validationKeys = [
    // 'required',
    'isAfter',
    'isBefore',
    'isBoolean',
    'isCreditCard',
    'isEmail',
    'isHexColor',
    'isIn',
    'isInteger',
    'isIP',
    'isNotEmptyString',
    'isNotIn',
    'isNumber',
    'isString',
    'isURL',
    'isUUID',
    'max',
    'min',
    'maxLength',
    'minLength',
    'regex',
    'custom'
];

// function _makeTypeEmptyCheck(type) {
//     return function _isEmpty(value) {
//         switch (type) {
//             case 'string':
//                 return value === '';
//                 break;
//             case 'number'
//         }
//     }
// }