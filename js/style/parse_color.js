'use strict';

var parseCSSColor = require('csscolorparser').parseCSSColor;
var util = require('../util/util');

var colorCache = {};

function parseColor(input) {

    if (colorCache[input]) {
        return colorCache[input];

    // RGBA array
    } else if (Array.isArray(input)) {
        return input;

    // GL function
    } else if (input && input.range) {
        return util.extend({}, input, {
            range: input.range.map(parseColor)
        });

    // Color string
    } else if (typeof input === 'string') {
        var parsedColor = parseCSSColor(input);
        if (!parsedColor) { throw new Error('Invalid color ' + input); }

        var output = colorDowngrade(parsedColor);
        colorCache[input] = output;
        return output;

    } else {
        throw new Error('Invalid color ' + input);
    }

}

function colorDowngrade(color) {
    return [color[0] / 255, color[1] / 255, color[2] / 255, color[3] / 1];
}

module.exports = parseColor;
