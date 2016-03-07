'use strict';

var createMapboxGLFunction = require('mapbox-gl-function');

function create(reference, parameters) {
    if (parameters.stops) {
        var domain = [];
        var range = [];

        for (var i = 0; i < parameters.stops.length; i++) {
            domain.push(parameters.stops[i][0]);
            range.push(parameters.stops[i][1]);
        }

        parameters.domain = domain;
        parameters.range = range;
        delete parameters.stops;

        if (reference.function === 'interpolated') {
            parameters.type = 'exponential';
        } else {
            parameters.domain.shift();
            parameters.type = 'interval';
        }
    }

    return createMapboxGLFunction(parameters);
}

module.exports = create;
