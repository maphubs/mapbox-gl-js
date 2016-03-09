'use strict';

var util = require('../util/util');
var ajax = require('../util/ajax');
var Evented = require('../util/evented');
var Source = require('./source');
var normalizeURL = require('../util/mapbox').normalizeTileURL;

var TilePyramid = require('./tile_pyramid');
var browser = require('../util/browser');

//Contains code from esri-leaflet https://github.com/Esri/esri-leaflet

var MercatorZoomLevels = {
    '0': 156543.03392799999,
    '1': 78271.516963999893,
    '2': 39135.758482000099,
    '3': 19567.879240999901,
    '4': 9783.9396204999593,
    '5': 4891.9698102499797,
    '6': 2445.9849051249898,
    '7': 1222.9924525624899,
    '8': 611.49622628138002,
    '9': 305.74811314055802,
    '10': 152.874056570411,
    '11': 76.437028285073197,
    '12': 38.218514142536598,
    '13': 19.109257071268299,
    '14': 9.5546285356341496,
    '15': 4.7773142679493699,
    '16': 2.38865713397468,
    '17': 1.1943285668550501,
    '18': 0.59716428355981699,
    '19': 0.29858214164761698,
    '20': 0.14929107082381,
    '21': 0.07464553541191,
    '22': 0.0373227677059525,
    '23': 0.0186613838529763
};

module.exports = ArcGISRasterTileSource;


var _withinPercentage = function (a, b, percentage) {
    var diff = Math.abs((a / b) - 1);
    return diff < percentage;
};

var loadArcGISMapServer = function(options) {
    var loaded = function(err, metadata) {
        if (err) {
            this.fire('error', {error: err});
            return;
        }

        util.extend(this, util.pick(metadata,
            ['tileInfo', 'initialExtent', 'spatialReference', 'tileServers', 'documentInfo']));

        this._lodMap = {};
        var sr = metadata.spatialReference.latestWkid || metadata.spatialReference.wkid;
        if (sr === 102100 || sr === 3857) {
          // create the zoom level data
            var arcgisLODs = metadata.tileInfo.lods;
            var correctResolutions = MercatorZoomLevels;
            this.minzoom = arcgisLODs[0].level;
            this.maxzoom = arcgisLODs[arcgisLODs.length - 1].level;
            for (var i = 0; i < arcgisLODs.length; i++) {
                var arcgisLOD = arcgisLODs[i];
                for (var ci in correctResolutions) {
                    var correctRes = correctResolutions[ci];

                    if (_withinPercentage(arcgisLOD.resolution, correctRes, this.zoomOffsetAllowance)) {
                        this._lodMap[ci] = arcgisLOD.level;
                        break;
                    }
                }
            }

        } else {
            this.fire('tile.error', {tile: null, error: 'non-mercator spatial reference'});
        }

        this._pyramid = new TilePyramid({
            tileSize: metadata.tileInfo.rows,
            minzoom: this.minzoom,
            maxzoom: this.maxzoom,
            roundZoom: this.roundZoom,
            reparseOverscaled: this.reparseOverscaled,
            load: this._loadTile.bind(this),
            abort: this._abortTile.bind(this),
            unload: this._unloadTile.bind(this),
            add: this._addTile.bind(this),
            remove: this._removeTile.bind(this),
            redoPlacement: this._redoTilePlacement ? this._redoTilePlacement.bind(this) : undefined
        });

        this.fire('load');
    }.bind(this);

    if (options.url) {
        ajax.getJSON(normalizeURL(options.url), loaded);
    } else {
        browser.frame(loaded.bind(this, null, options));
    }
};


function ArcGISRasterTileSource(options) {
    util.extend(this, util.pick(options, ['url', 'tileSize', 'token']));

    loadArcGISMapServer.call(this, options);
}

ArcGISRasterTileSource.prototype = util.inherit(Evented, {
    minzoom: 0,
    maxzoom: 22,
    roundZoom: true,
    tileSize: 512,
    zoomOffsetAllowance: 0.1,
    _loaded: false,

    onAdd: function(map) {
        this.map = map;

        //Lookup service metadata

        //Source._loadTileJSON.call(this, options);
        // set the urls
        var baseUrl = this.url.split('?')[0];
        this.tileUrl = baseUrl + '/tile/{z}/{y}/{x}';

        var arcgisonline = new RegExp(/tiles.arcgis(online)?\.com/g);
        if (arcgisonline.test(this.url)) {
            this.tileUrl = this.tileUrl.replace('://tiles', '://tiles{s}');
            this.subdomains = ['1', '2', '3', '4'];
        }

        if (this.token) {
            this.tileUrl += ('?token=' + this.token);
        }
    },

    loaded: function() {
        return this._loaded;
    },

    update: function(transform) {
        if (this._pyramid) {
            this._pyramid.update(this.used, transform, this.map.style.rasterFadeDuration);
        }
    },

    reload: function() {
        // noop
    },

    serialize: function() {
        return {
            type: 'arcgisraster',
            url: this.url,
            tileSize: this.tileSize
        };
    },

    getVisibleCoordinates: Source._getVisibleCoordinates,
    getTile: Source._getTile,

    //From https://github.com/Leaflet/Leaflet/blob/master/src/layer/tile/TileLayer.js
    _getSubdomain: function (tilePoint) {
        var index = Math.abs(tilePoint.x + tilePoint.y) % this.subdomains.length;
        return this.subdomains[index];
    },

    //From https://github.com/Leaflet/Leaflet/blob/master/src/core/Util.js
    _templateRe: /\{ *([\w_]+) *\}/g,
    _template: function (str, data) {
        return str.replace(this._templateRe, function (str, key) {
            var value = data[key];

            if (value === undefined) {
                throw new Error('No value provided for variable ' + str);

            } else if (typeof value === 'function') {
                value = value(data);
            }
            return value;
        });
    },


    _loadTile: function(tile) {
        //var url = normalizeURL(tile.coord.url(this.tiles), this.url, this.tileSize);
        //convert to ags coords
        var tilePoint = tile.coord;
        var url =  this._template(this.tileUrl, util.extend({
            s: this._getSubdomain(tilePoint),
            z: (this._lodMap && this._lodMap[tilePoint.z]) ? this._lodMap[tilePoint.z] : tilePoint.z, // try lod map first, then just defualt to zoom level
            x: tilePoint.x,
            y: tilePoint.y
        }, this.options));
        tile.request = ajax.getImage(url, done.bind(this));

        function done(err, img) {
            delete tile.request;

            if (tile.aborted)
                return;

            if (err) {
                tile.errored = true;
                this.fire('tile.error', {tile: tile, error: err});
                return;
            }

            var gl = this.map.painter.gl;
            tile.texture = this.map.painter.getTexture(img.width);
            if (tile.texture) {
                gl.bindTexture(gl.TEXTURE_2D, tile.texture);
                gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, img);
            } else {
                tile.texture = gl.createTexture();
                gl.bindTexture(gl.TEXTURE_2D, tile.texture);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
                tile.texture.size = img.width;
            }
            gl.generateMipmap(gl.TEXTURE_2D);

            tile.timeAdded = new Date().getTime();
            this.map.animationLoop.set(this.style.rasterFadeDuration);

            tile.source = this;
            tile.loaded = true;

            this.fire('tile.load', {tile: tile});
        }
    },

    _abortTile: function(tile) {
        tile.aborted = true;

        if (tile.request) {
            tile.request.abort();
            delete tile.request;
        }
    },

    _addTile: function(tile) {
        this.fire('tile.add', {tile: tile});
    },

    _removeTile: function(tile) {
        this.fire('tile.remove', {tile: tile});
    },

    _unloadTile: function(tile) {
        if (tile.texture) this.map.painter.saveTexture(tile.texture);
    },

    featuresAt: function(point, params, callback) {
        callback(null, []);
    },

    featuresIn: function(bbox, params, callback) {
        callback(null, []);
    }
});
