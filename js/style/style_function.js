'use strict';

var MapboxGLFunction = require('mapbox-gl-function');

function create(reference, parameters) {
    var legacyFunction = MapboxGLFunction[reference.function || 'piecewise-constant'](parameters);
    return function(globalProperties) {
        return legacyFunction(globalProperties && globalProperties.$zoom);
    };
}

module.exports = create;
