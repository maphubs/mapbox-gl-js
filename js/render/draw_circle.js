'use strict';

var browser = require('../util/browser');

module.exports = drawCircles;

function drawCircles(painter, source, layer, coords) {
    if (painter.isOpaquePass) return;

    var gl = painter.gl;

    var shader = painter.circleShader;
    painter.gl.switchShader(shader);

    painter.setDepthSublayer(0);
    painter.depthMask(false);

    // Allow circles to be drawn across boundaries, so that
    // large circles are not clipped to tiles
    gl.disable(gl.STENCIL_TEST);

    // antialiasing factor: this is a minimum blur distance that serves as
    // a faux-antialiasing for the circle. since blur is a ratio of the circle's
    // size and the intent is to keep the blur at roughly 1px, the two
    // are inversely related.
    var antialias = 1 / browser.devicePixelRatio / layer.paint['circle-radius'];

    gl.disableVertexAttribArray(shader.a_blur);
    gl.vertexAttrib1f(shader.a_blur, Math.max(layer.paint['circle-blur'], antialias));

    gl.disableVertexAttribArray(shader.a_size);
    gl.vertexAttrib1f(shader.a_size, layer.paint['circle-radius']);

    for (var i = 0; i < coords.length; i++) {
        var coord = coords[i];

        var tile = source.getTile(coord);
        var bucket = tile.getBucket(layer);
        if (!bucket) continue;
        bucket.createStyleLayer(layer);
        var elementGroups = bucket.elementGroups.circle;
        if (!elementGroups) continue;

        var vertex = bucket.buffers.circleVertex;
        var elements = bucket.buffers.circleElement;

        gl.setPosMatrix(painter.translatePosMatrix(
            painter.calculatePosMatrix(coord, source.maxzoom),
            tile,
            layer.paint['circle-translate'],
            layer.paint['circle-translate-anchor']
        ));
        gl.setExMatrix(painter.transform.exMatrix);

        for (var k = 0; k < elementGroups.length; k++) {
            var group = elementGroups[k];
            var offset = group.vertexStartIndex * vertex.itemSize;

            vertex.bind(gl);
            bucket.setAttribPointers('circle', gl, shader, offset, [{$zoom: painter.transform.zoom}]);

            elements.bind(gl);

            var count = group.elementLength * 3;
            var elementOffset = group.elementStartIndex * elements.itemSize;
            gl.drawElements(gl.TRIANGLES, count, gl.UNSIGNED_SHORT, elementOffset);
        }

        bucket.unsetAttribPointers('circle', gl, shader);
    }

    gl.enableVertexAttribArray(shader.a_blur);
    gl.enableVertexAttribArray(shader.a_size);
}
