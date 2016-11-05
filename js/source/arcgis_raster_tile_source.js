'use strict';

var util = require('../util/util');
var ajax = require('../util/ajax');
var Evented = require('../util/evented');
var loadArcGISMapServer = require('./load_arcgis_mapserver');

module.exports = ArcGISRasterTileSource;

//From https://github.com/Leaflet/Leaflet/blob/master/src/core/Util.js
var _templateRe = /\{ *([\w_]+) *\}/g;
var _template = function (str, data) {
    return str.replace(_templateRe, function (str, key) {
        var value = data[key];

        if (value === undefined) {
            throw new Error('No value provided for variable ' + str);

        } else if (typeof value === 'function') {
            value = value(data);
        }
        return value;
    });
};

//From https://github.com/Leaflet/Leaflet/blob/master/src/layer/tile/TileLayer.js
var _getSubdomain = function (tilePoint) {
    var index = Math.abs(tilePoint.x + tilePoint.y) % this.subdomains.length;
    return this.subdomains[index];
};

function ArcGISRasterTileSource(id, options, dispatcher, eventedParent) {
    this.id = id;
    this.dispatcher = dispatcher;
    util.extend(this, util.pick(options, ['url', 'scheme', 'tileSize']));

    this.setEventedParent(eventedParent);
    this.fire('dataloading', {dataType: 'source'});

    loadArcGISMapServer(options, function (err, metadata) {
        if (err) {
            return this.fire('error', err);
        }
        util.extend(this, metadata);
        this.fire('data', {dataType: 'source'});
        this.fire('source.load');
    }.bind(this));
}

ArcGISRasterTileSource.prototype = util.inherit(Evented, {
    minzoom: 0,
    maxzoom: 22,
    roundZoom: true,
    tileSize: 512,
    _loaded: false,

    onAdd: function (map) {
        this.map = map;

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

    serialize: function() {
        return {
            type: 'arcgisraster',
            url: this.url,
            tileSize: this.tileSize,
            tiles: this.tiles
        };
    },



    loadTile: function(tile, callback) {
        //convert to ags coords
        var tilePoint = tile.coord;
        var url =  _template(this.tileUrl, util.extend({
            s: _getSubdomain(tilePoint),
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
                return callback(err);
            }

            var gl = this.map.painter.gl;
            tile.texture = this.map.painter.getTileTexture(img.width);
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

            this.map.animationLoop.set(this.map.style.rasterFadeDuration);

            tile.state = 'loaded';

            callback(null);
        }
    },

    abortTile: function(tile) {
        if (tile.request) {
            tile.request.abort();
            delete tile.request;
        }
    },

    unloadTile: function(tile) {
        if (tile.texture) this.map.painter.saveTileTexture(tile.texture);
    }
});
