'use strict';

var Bucket = require('../bucket');
var util = require('../../util/util');
var loadGeometry = require('../load_geometry');
var EXTENT = Bucket.EXTENT;

module.exports = CircleBucket;

/**
 * Circles are represented by two triangles.
 *
 * Each corner has a pos that is the center of the circle and an extrusion
 * vector that is where it points.
 * @private
 */
function CircleBucket() {
    Bucket.apply(this, arguments);
}

CircleBucket.prototype = util.inherit(Bucket, {});

CircleBucket.prototype.shaderInterfaces = {
    circle: {
        vertexBuffer: true,
        elementBuffer: true,

        attributeArgs: ['globalProperties', 'featureProperties', 'x', 'y', 'extrudeX', 'extrudeY'],

        attributes: [{
            name: 'pos',
            components: 2,
            type: Bucket.AttributeType.SHORT,
            value: [
                '(x * 2) + ((extrudeX + 1) / 2)',
                '(y * 2) + ((extrudeY + 1) / 2)'
            ]
        }, {
            name: 'color',
            components: 4,
            type: Bucket.AttributeType.UNSIGNED_BYTE,
            value: (
                'this._premultiplyColor(' +
                    'this.layer.getPaintValue("circle-color", globalProperties, featureProperties),' +
                    'this.layer.getPaintValue("circle-opacity", globalProperties, featureProperties)' +
                ')'
            ),
            multiplier: 255,
            isDisabled: function() {
                return (
                    this.layer.isPaintValueFeatureConstant("circle-color") &&
                    this.layer.isPaintValueFeatureConstant('circle-opacity')
                );
            }
        }]
    }
};

CircleBucket.prototype.addFeature = function(feature) {
    var globalProperties = {$zoom: this.zoom};
    var geometries = loadGeometry(feature);

    for (var j = 0; j < geometries.length; j++) {
        for (var k = 0; k < geometries[j].length; k++) {

            var x = geometries[j][k].x;
            var y = geometries[j][k].y;

            // Do not include points that are outside the tile boundaries.
            if (x < 0 || x >= EXTENT || y < 0 || y >= EXTENT) continue;

            // this geometry will be of the Point type, and we'll derive
            // two triangles from it.
            //
            // ┌─────────┐
            // │ 3     2 │
            // │         │
            // │ 0     1 │
            // └─────────┘

            var group = this.makeRoomFor('circle', 4);

            var index = this.addCircleVertex(globalProperties, feature.properties, x, y, -1, -1) - group.vertexStartIndex;
            this.addCircleVertex(globalProperties, feature.properties, x, y, 1, -1);
            this.addCircleVertex(globalProperties, feature.properties, x, y, 1, 1);
            this.addCircleVertex(globalProperties, feature.properties, x, y, -1, 1);
            group.vertexLength += 4;

            this.addCircleElement(index, index + 1, index + 2);
            this.addCircleElement(index, index + 3, index + 2);
            group.elementLength += 2;
        }
    }

};
