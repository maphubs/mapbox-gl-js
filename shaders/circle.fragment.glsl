precision mediump float;

varying lowp vec4 v_color;
varying vec2 v_extrude;
varying lowp float v_blur;
varying float v_size;

void main() {
    float t = smoothstep(1.0 - v_blur, 1.0, length(v_extrude));
    gl_FragColor = v_color * (1.0 - t);
}
