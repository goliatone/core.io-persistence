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
Waterline.Model.prototype.updateOrCreate = function $updateOrCreate(criteria, values, populate) {

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

    return query.then(model => {
        if (model) {
            return this.update(model.id, values).then(res => {
                return res[0];
            });
        }
        // console.log('Query did not return an instance, we create %%s.', id);
        // console.log('----');
        // if(id) values.id = id;
        return this.create(values);
    });
};


const BaseModel = {
    persistence: null,
    datastore: process.env.NODE_ENV || 'default',
    // tableName:,
    // fetchRecordsOnCreate: true,
    // fetchRecordsOnUpdate: true,
    // fetchRecordsOnDestroy: true,
    // fetchRecordsOnCreateEach: true,
    //cascadeOnDestroy: true,
    attributes: {
        id: {
            type: 'string',
            // autoIncrement: true,
            // primaryKey: true,
            // unique: true,
            // columnName: user_id
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
        /**
         * Check to see if we have a function to set
         * a defualt value. If we do store it and remove
         * it so it passes validation.
         */
        if (attr && typeof attr.defaultsTo === 'function') {
            _defaultsTo[key] = attr.defaultsTo;
            delete attr.defaultsTo;
        }

        /**
         * Enable individaul model definitions to remove 
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
     * This get's called in both create and createEach.
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
 * Returns a lifesycle method:
 * - afterCreate
 * - afterUpdate
 * - afterDelete
 * 
 * @param {String} action create|update|delete
 * @returns {String} Lifcycle method name
 */
function makeLifecycleCallback(action) {
    return `after${capitalize(action)}`;
}

/**
 * This will return a function that can be used
 * for one of the lyfe cycle callbacks.
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
