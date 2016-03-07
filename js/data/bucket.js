'use strict';

var featureFilter = require('feature-filter');
var Buffer = require('./buffer');
var StyleLayer = require('../style/style_layer');
var util = require('../util/util');

module.exports = Bucket;

/**
 * Instantiate the appropriate subclass of `Bucket` for `options`.
 * @private
 * @param options See `Bucket` constructor options
 * @returns {Bucket}
 */
Bucket.create = function(options) {
    var Classes = {
        fill: require('./bucket/fill_bucket'),
        line: require('./bucket/line_bucket'),
        circle: require('./bucket/circle_bucket'),
        symbol: require('./bucket/symbol_bucket')
    };
    return new Classes[options.layer.type](options);
};

Bucket.AttributeType = Buffer.AttributeType;


/**
 * The maximum extent of a feature that can be safely stored in the buffer.
 * In practice, all features are converted to this extent before being added.
 *
 * Positions are stored as signed 16bit integers.
 * One bit is lost for signedness to support featuers extending past the left edge of the tile.
 * One bit is lost because the line vertex buffer packs 1 bit of other data into the int.
 * One bit is lost to support features extending past the extent on the right edge of the tile.
 * This leaves us with 2^13 = 8192
 *
 * @property {number}
 * @private
 * @readonly
 */
Bucket.EXTENT = 8192;

/**
 * The `Bucket` class is the single point of knowledge about turning vector
 * tiles into WebGL buffers.
 *
 * `Bucket` is an abstract class. A subclass exists for each Mapbox GL
 * style spec layer type. Because `Bucket` is an abstract class,
 * instances should be created via the `Bucket.create` method.
 *
 * For performance reasons, `Bucket` creates its "add"s methods at
 * runtime using `new Function(...)`.
 *
 * @class Bucket
 * @private
 * @param options
 * @param {number} options.zoom Zoom level of the buffers being built. May be
 *     a fractional zoom level.
 * @param options.layer A Mapbox GL style layer object
 * @param {Object.<string, Buffer>} options.buffers The set of `Buffer`s being
 *     built for this tile. This object facilitates sharing of `Buffer`s be
       between `Bucket`s.
 */
function Bucket(options) {
    this.zoom = options.zoom;
    this.overscaling = options.overscaling;
    this.layer = options.layer;
    this.childLayers = options.childLayers;

    this.type = this.layer.type;
    this.features = [];
    this.id = this.layer.id;
    this['source-layer'] = this.layer['source-layer'];
    this.interactive = this.layer.interactive;
    this.minZoom = this.layer.minzoom;
    this.maxZoom = this.layer.maxzoom;

    // TODO make this call more efficient or unnecessary
    this.createStyleLayers(options.style);
    this.attributes = createAttributes(this);

    if (options.elementGroups) {
        this.elementGroups = options.elementGroups;
        this.buffers = util.mapObject(options.buffers, function(options) {
            return new Buffer(options);
        });
    }
}

/**
 * Build the buffers! Features are set directly to the `features` property.
 * @private
 */
Bucket.prototype.populateBuffers = function() {
    this.createBuffers();

    for (var i = 0; i < this.features.length; i++) {
        this.addFeature(this.features[i]);
    }

    this.trimBuffers();
};

/**
 * Check if there is enough space available in the current element group for
 * `vertexLength` vertices. If not, append a new elementGroup. Should be called
 * by `populateBuffers` and its callees.
 * @private
 * @param {string} shaderName the name of the shader associated with the buffer that will receive the vertices
 * @param {number} vertexLength The number of vertices that will be inserted to the buffer.
 */
Bucket.prototype.makeRoomFor = function(shaderName, numVertices) {
    var groups = this.elementGroups[shaderName];
    var currentGroup = groups.length && groups[groups.length - 1];

    if (!currentGroup || currentGroup.vertexLength + numVertices > 65535) {
        var vertexBuffer = this.buffers[this.getBufferName(shaderName, 'vertex')];
        var elementBuffer = this.buffers[this.getBufferName(shaderName, 'element')];
        var secondElementBuffer = this.buffers[this.getBufferName(shaderName, 'secondElement')];

        currentGroup = {
            vertexStartIndex: vertexBuffer.length,
            elementStartIndex: elementBuffer && elementBuffer.length,
            secondElementStartIndex: secondElementBuffer && secondElementBuffer.length,
            elementLength: 0,
            vertexLength: 0,
            secondElementLength: 0,
            elementOffset: elementBuffer && elementBuffer.length * elementBuffer.itemSize,
            secondElementOffset: secondElementBuffer && secondElementBuffer.length * secondElementBuffer.itemSize,
            vertexOffset: vertexBuffer && vertexBuffer.length * vertexBuffer.itemSize
        };
        groups.push(currentGroup);
    }

    return currentGroup;
};

/**
 * Start using a new shared `buffers` object and recreate instances of `Buffer`
 * as necessary.
 * @private
 */
Bucket.prototype.createBuffers = function() {
    var elementGroups = this.elementGroups = {};
    var buffers = this.buffers = {};

    for (var shaderName in this.shaderInterfaces) {
        var shaderInterface = this.shaderInterfaces[shaderName];

        if (shaderInterface.vertexBuffer) {
            var vertexBufferName = this.getBufferName(shaderName, 'vertex');
            var vertexAddMethodName = this.getAddMethodName(shaderName, 'vertex');
            var enabledAttributes = this.attributes[shaderName].enabled;

            buffers[vertexBufferName] = new Buffer({
                type: Buffer.BufferType.VERTEX,
                attributes: enabledAttributes
            });

            this[vertexAddMethodName] = this[vertexAddMethodName] || createVertexAddMethod(this, shaderName);
        }

        if (shaderInterface.elementBuffer) {
            var elementBufferName = this.getBufferName(shaderName, 'element');
            buffers[elementBufferName] = createElementBuffer(shaderInterface.elementBufferComponents);
            this[this.getAddMethodName(shaderName, 'element')] = createElementAddMethod(this.buffers[elementBufferName]);
        }

        if (shaderInterface.secondElementBuffer) {
            var secondElementBufferName = this.getBufferName(shaderName, 'secondElement');
            buffers[secondElementBufferName] = createElementBuffer(shaderInterface.secondElementBufferComponents);
            this[this.getAddMethodName(shaderName, 'secondElement')] = createElementAddMethod(this.buffers[secondElementBufferName]);
        }

        elementGroups[shaderName] = [];
    }
};

Bucket.prototype.destroy = function(gl) {
    for (var k in this.buffers) {
        this.buffers[k].destroy(gl);
    }
};

Bucket.prototype.trimBuffers = function() {
    for (var bufferName in this.buffers) {
        this.buffers[bufferName].trim();
    }
};

/**
 * Set the attribute pointers in a WebGL context
 * @private
 * @param gl The WebGL context
 * @param shader The active WebGL shader
 * @param {number} offset The offset of the attribute data in the currently bound GL buffer.
 * @param {Array} arguments to be passed to disabled attribute value functions
 */
Bucket.prototype.setAttribPointers = function(shaderName, gl, shader, offset, layer, args) {
    // Set disabled attributes
    var disabledAttributes = this.attributes[shaderName].disabled;
    for (var i = 0; i < disabledAttributes.length; i++) {
        var attribute = disabledAttributes[i];
        var attributeId = shader[attribute.shaderName];
        gl.disableVertexAttribArray(attributeId);
        gl['vertexAttrib' + attribute.components + 'fv'](attributeId, attribute.getValue.apply(this, args));
    }

    // Set enabled attributes
    var enabledAttributes = this.attributes[shaderName].enabled.filter(function(attribute) {
        return attribute.isLayerConstant !== false || attribute.layerId === layer.id;
    });
    var vertexBuffer = this.buffers[this.getBufferName(shaderName, 'vertex')];
    vertexBuffer.setAttribPointers(
        gl,
        shader,
        offset,
        util.mapObjectKV(enabledAttributes, function(attribute) {
            return [attribute.name, attribute.shaderName];
        })
    );
};

Bucket.prototype.bindBuffers = function(shaderInterfaceName, gl, options) {
    var shaderInterface = this.shaderInterfaces[shaderInterfaceName];

    if (shaderInterface.vertexBuffer) {
        var vertexBuffer = this.buffers[this.getBufferName(shaderInterfaceName, 'vertex')];
        vertexBuffer.bind(gl);
    }

    if (shaderInterface.elementBuffer && (!options || !options.secondElement)) {
        var elementBuffer = this.buffers[this.getBufferName(shaderInterfaceName, 'element')];
        elementBuffer.bind(gl);
    }

    if (shaderInterface.secondElementBuffer && (options && options.secondElement)) {
        var secondElementBuffer = this.buffers[this.getBufferName(shaderInterfaceName, 'secondElement')];
        secondElementBuffer.bind(gl);
    }
};

/**
 * Get the name of the method used to add an item to a buffer.
 * @param {string} shaderName The name of the shader that will use the buffer
 * @param {string} type One of "vertex", "element", or "secondElement"
 * @returns {string}
 */
Bucket.prototype.getAddMethodName = function(shaderName, type) {
    return 'add' + capitalize(shaderName) + capitalize(type);
};

/**
 * Get the name of a buffer.
 * @param {string} shaderName The name of the shader that will use the buffer
 * @param {string} type One of "vertex", "element", or "secondElement"
 * @returns {string}
 */
Bucket.prototype.getBufferName = function(shaderName, type) {
    return shaderName + capitalize(type);
};

Bucket.prototype.serialize = function() {
    return {
        layer: this.layer.serialize(),
        zoom: this.zoom,
        elementGroups: this.elementGroups,
        buffers: util.mapObject(this.buffers, function(buffer) {
            return buffer.serialize();
        }),
        childLayers: this.childLayers.map(function(layer) {
            return layer.serialize();
        })
    };
};

// TODO there will be race conditions when the layer passed here has changed
// since it was used to construct the buffers
Bucket.prototype.createStyleLayers = function(style) {
    var that = this;
    var refLayer = this.layer = create(this.layer);
    this.childLayers = this.childLayers.map(create);

    function create(layer) {
        if (style) {
            return style.getLayer(layer.id);
        } else if (!(layer instanceof StyleLayer)) {
            layer = StyleLayer.create(layer, refLayer);
            layer.cascade({}, {transition: false});
            layer.recalculate(that.zoom, { lastIntegerZoom: Infinity, lastIntegerZoomTime: 0, lastZoom: 0 });
            return layer;
        } else {
            return layer;
        }
    }
};

// TODO use lazy evaluation to get rid of this call
Bucket.prototype.createFilter = function() {
    if (!this.filter) {
        this.filter = featureFilter(this.layer.filter);
    }
};

Bucket.prototype._premultiplyColor = util.premultiply;


var createVertexAddMethodCache = {};
function createVertexAddMethod(bucket, interfaceName) {
    var enabledAttributes = bucket.attributes[interfaceName].enabled;
    var shaderInterface = bucket.shaderInterfaces[interfaceName];

    var body = 'var layer;\n';

    var pushArgs = [];

    for (var i = 0; i < enabledAttributes.length; i++) {
        var attribute = enabledAttributes[i];

        var attributePushArgs = [];
        if (Array.isArray(attribute.value)) {
            attributePushArgs = attributePushArgs.concat(attribute.value);
            attributePushArgs[0] = 'layer = this.childLayers[' + attribute.layerIndex + '] &&' + attributePushArgs[0];
        } else {
            body += 'layer = this.childLayers[' + attribute.layerIndex + '];\n';
            var attributeId = '_' + i;
            body += 'var ' + attributeId + ' = ' + attribute.value + ';\n';
            for (var j = 0; j < attribute.components; j++) {
                attributePushArgs.push(attributeId + '[' + j + ']');
            }
        }

        var multipliedAttributePushArgs;
        if (attribute.multiplier) {
            multipliedAttributePushArgs = [];
            for (var k = 0; k < attributePushArgs.length; k++) {
                multipliedAttributePushArgs[k] = attributePushArgs[k] + '*' + attribute.multiplier;
            }
        } else {
            multipliedAttributePushArgs = attributePushArgs;
        }

        pushArgs = pushArgs.concat(multipliedAttributePushArgs);
    }

    var bufferName = bucket.getBufferName(interfaceName, 'vertex');
    body += 'return this.buffers.' + bufferName + '.push(' + pushArgs.join(',') + ');';

    if (!createVertexAddMethodCache[body]) {
        createVertexAddMethodCache[body] = new Function(shaderInterface.attributeArgs, body);
    }

    return createVertexAddMethodCache[body];
}

function createElementAddMethod(buffer) {
    return function(one, two, three) {
        return buffer.push(one, two, three);
    };
}

var _getAttributeValueCache = {};
function createGetAttributeValueMethod(bucket, interfaceName, attribute, layerIndex) {
    if (!_getAttributeValueCache[interfaceName]) {
        _getAttributeValueCache[interfaceName] = {};
    }

    if (!_getAttributeValueCache[interfaceName][attribute.name]) {
        var bodyArgs = bucket.shaderInterfaces[interfaceName].attributeArgs;
        var body = '';

        body += 'var layer = this.childLayers[' + layerIndex + '];\n';

        if (Array.isArray(attribute.value)) {
            body += 'return [' + attribute.value.join(', ') + ']';
        } else {
            body += 'return ' + attribute.value;
        }

        if (attribute.multiplier) {
            body += '.map(function(v) { return v * ' + attribute.multiplier + '; })';
        }
        body += ';';

        _getAttributeValueCache[interfaceName][attribute.name] = new Function(bodyArgs, body);
    }

    return _getAttributeValueCache[interfaceName][attribute.name];
}

function createElementBuffer(components) {
    return new Buffer({
        type: Buffer.BufferType.ELEMENT,
        attributes: [{
            name: 'vertices',
            components: components || 3,
            type: Buffer.ELEMENT_ATTRIBUTE_TYPE
        }]
    });
}

function capitalize(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function createAttributes(bucket) {
    var attributes = {};
    for (var interfaceName in bucket.shaderInterfaces) {
        var interfaceAttributes = attributes[interfaceName] = { enabled: [], disabled: [] };
        var interface_ = bucket.shaderInterfaces[interfaceName];
        for (var i = 0; i < interface_.attributes.length; i++) {
            var attribute = interface_.attributes[i];
            for (var j = 0; j < bucket.childLayers.length; j++) {
                var layer = bucket.childLayers[j];
                if (attribute.isLayerConstant !== false && layer.id !== bucket.layer.id) continue;
                if (isAttributeDisabled(bucket, attribute, layer)) {
                    interfaceAttributes.disabled.push(util.extend({}, attribute, {
                        getValue: createGetAttributeValueMethod(bucket, interfaceName, attribute, j),
                        name: layer.id + '__' + attribute.name,
                        shaderName: 'a_' + attribute.name,
                        layerId: layer.id,
                        layerIndex: j
                    }));
                } else {
                    interfaceAttributes.enabled.push(util.extend({}, attribute, {
                        name: layer.id + '__' + attribute.name,
                        shaderName: 'a_' + attribute.name,
                        layerId: layer.id,
                        layerIndex: j
                    }));
                }
            }
        }
    }
    return attributes;
}


function isAttributeDisabled(bucket, attribute, layer) {
    if (attribute.isDisabled === undefined || attribute.isDisabled === false) {
        return false;
    } else if (attribute.isDisabled === true) {
        return true;
    } else {
        return !!attribute.isDisabled.call(bucket, layer);
    }
}
