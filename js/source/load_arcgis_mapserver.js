'use strict';
var util = require('../util/util');
var ajax = require('../util/ajax');
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

var _withinPercentage = function (a, b, percentage) {
    var diff = Math.abs((a / b) - 1);
    return diff < percentage;
};

module.exports = function(options, callback) {
    var loaded = function(err, metadata) {
        if (err) {
            return callback(err);
        }

        var result = util.pick(metadata,
            ['tileInfo', 'initialExtent', 'spatialReference', 'tileServers', 'documentInfo']);

        result._lodMap = {};
        var zoomOffsetAllowance = 0.1;
        var sr = metadata.spatialReference.latestWkid || metadata.spatialReference.wkid;
        if (sr === 102100 || sr === 3857) {
          // create the zoom level data
            var arcgisLODs = metadata.tileInfo.lods;
            var correctResolutions = MercatorZoomLevels;
            result.minzoom = arcgisLODs[0].level;
            result.maxzoom = arcgisLODs[arcgisLODs.length - 1].level;
            for (var i = 0; i < arcgisLODs.length; i++) {
                var arcgisLOD = arcgisLODs[i];
                for (var ci in correctResolutions) {
                    var correctRes = correctResolutions[ci];

                    if (_withinPercentage(arcgisLOD.resolution, correctRes, zoomOffsetAllowance)) {
                        result._lodMap[ci] = arcgisLOD.level;
                        break;
                    }
                }
            }
        } else {
            callback(new Error('non-mercator spatial reference'));
        }

        callback(null, result);
    };

    if (options.url) {
        ajax.getJSON(options.url, loaded);
    } else {
        browser.frame(loaded.bind(null, null, options));
    }
};
