'use strict';

module.exports = function capitalize(str){
    str = str || '';
    return str.charAt(0).toUpperCase() + str.slice(1);
};
