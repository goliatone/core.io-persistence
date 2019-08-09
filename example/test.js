'use strict';

var util = require('util');
var _ = require('@sailshq/lodash');
var SailsDiskAdapter = require('sails-disk');
var Waterline = require('waterline');

const BaseModel = require('../lib/BaseModel');


BaseModel.persistence = {
    emitModelEvent(identity, action, record) {
        console.log('emit(%s, %s)', identity, action);
        console.log(record);
        console.log('......')
    }
};

let models = {
    user: {
        ///
        identity: 'user',
        globalId: 'User',
        ///
        datastore: 'default',
        attributes: {
            id: { type: 'number', autoMigrations: { autoIncrement: true } },
            numChickens: { type: 'number' },
            name: { type: 'string', unique: true, required: true },
            pets: { collection: 'pet' }
        },
        primaryKey: 'id',
        schema: true
    },
    pet: {
        ///
        identity: 'pet',
        globalId: 'Pet',
        ///
        datastore: 'default',
        attributes: {
            id: { type: 'number', autoMigrations: { autoIncrement: true } },
            name: { type: 'string', unique: true, required: true }
        },
        primaryKey: 'id',
        schema: true
    }
};

const orm = new Waterline();

//This maps to the Waterline.start routine. 
//TODO: Ensure we do similar validation
const um = BaseModel.extend(models.user);
// const um = Waterline.Model.extend(models.user);
orm.registerModel(um);

// const pm = Waterline.Model.extend(models.pet);
const pm = BaseModel.extend(models.pet);
orm.registerModel(pm);

orm.initialize({
    adapters: {
        'sails-disk': SailsDiskAdapter,
    },
    datastores: {
        default: {
            adapter: 'sails-disk'
        }
    }
}, function whenWaterlineIsReady(err, _classicOntology) {
    if (err) {
        return onComputeDone(new Error('Could not start up Waterline ORM: ' + err.stack));
    } //--•

    Object.defineProperty(orm, 'collections', {
        value: _classicOntology.collections
    });
    Object.defineProperty(orm, 'datastores', {
        value: _classicOntology.datastores
    });

    ready(onComputeDone);
});

function ready(done) {
    handleLog();
    handleLog();
    handleLog('--');
    handleLog('Waterline ORM is started and ready.');

    // Get access to models:
    var Pet = Waterline.getModel('pet', orm);
    var User = Waterline.getModel('user', orm);

    handleLog('(this is where you could write come code)');
    // ...for example, like this:

    handleLog(
        '\n' +
        '\n' +
        '==========================================================================\n' +
        '• EXAMPLE: Calling some model methods:                                   •\n' +
        '==========================================================================\n'
    );


    var PET_NAMES = ['Champ', 'Mimo', 'Momo', 'Paws', 'Mr. Big', 'Champ II', 'Mimo II', 'Momo II', 'Paws II', 'Mr. Big II'];
    var USR_NAMES = ['Carrie', 'Samantha', 'Charlotte', 'Miranda', 'Carrie II', 'Samantha II', 'Charlotte II', 'Miranda II'];

    // let pets = Pet.find({ name: 'Mr. Big' }).then(console.log);

    // return

    Pet.createEach([{
                name: _random(PET_NAMES)
                    // , uuid: BaseModel.uuid() 
            },
            {
                name: _random(PET_NAMES),
                // uuid: BaseModel.uuid()
            }
        ])
        .meta({ fetch: true })
        .exec(function(err, pets) {
            if (err) { return done(new Error('Failed to create new pets: ' + err.stack)); }

            console.log('User.create()');

            let user = {
                name: _random(USR_NAMES),
                numChickens: pets.length,
                pets: _.pluck(pets, 'id'),
                // uuid: BaseModel.uuid()
            };

            User.updateOrCreate({ name: user.name }, user).then(function() {
                console.log('User.create() complete!');
                User.stream()
                    .populate('pets')
                    .eachRecord(function eachRecord(user, next) {
                        handleLog('Streamed record:', util.inspect(user, { depth: null }));
                        return next();
                    })
                    .exec(function afterwards(err) {
                        if (err) { return done(new Error('Unexpected error occurred while streaming users:', err.stack)); }

                        return done();

                    });
            }).catch(err => {
                console.log(err.code)
                return done(new Error('Failed to create new user: ' + err.stack));
            });
        });

}

function onComputeDone(err) {
    if (err) {
        Waterline.stop(orm, function(secondaryErr) {
            if (secondaryErr) {
                handleLog();
                handleLog('An error occurred, and then, when trying to shut down the ORM gracefully, THAT failed too!');
                handleLog('More on the original error in just a while.');
                handleLog('But first, here\'s the secondary error that was encountered while trying to shut down the ORM:\n', secondaryErr);
                handleLog('... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ');
                return whenFinishedAndORMHasBeenStopped(err);
            } //-•

            return whenFinishedAndORMHasBeenStopped(err);

        }); //_∏_
        return;
    } //-•

    // IWMIH, everything went well.
    handleLog();
    handleLog('Done.  (Stopping ORM...)');
    handleLog('... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ... ');
    Waterline.stop(orm, function(secondaryErr) {
        if (secondaryErr) {
            return whenFinishedAndORMHasBeenStopped(new Error('Everything else went fine, but then when attempting to shut down the ORM gracefully, something went wrong!  Details:' + secondaryErr.stack));
        }
        return whenFinishedAndORMHasBeenStopped();
    });
}

function handleLog() {
    console.log.apply(console, Array.prototype.slice.call(arguments));
}

function whenFinishedAndORMHasBeenStopped(err) {
    if (err) {
        console.log();
        console.log('code', err.code);
        console.log(err.stack);
        console.log();
        console.log(' ✘      Something went wrong.');
        console.log('       (see stack trace above)');
        console.log();
        return process.exit(1);
    } //-•

    console.log();
    console.log(' ✔      OK.');
    console.log();
    return process.exit(0);
}

function _random(arr = []) {
    let index = Math.floor(Math.random() * arr.length)
    return arr.splice(index, 1)[0];
}
