/*jshint esversion:6, node:true*/
'use strict';

module.exports = {
    adapters: {
        'sails-disk': require('sails-disk')
    },
    // connections: {
    datastores: {
        development: {
            adapter: 'sails-disk'
        }
    },
    // defaults: {
    defaultModelSettings: {
        migrate: process.env.NODE_ENV === 'production' ? 'safe' : 'drop',
        datastore: process.env.NODE_PERSISTENCE_CONNECTION || 'development'
    }
};
