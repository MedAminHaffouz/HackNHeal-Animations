// Backbone shading: holographic rim + a hot band where the read head passes,
// and a slightly brighter "already sequenced" region behind it.
uniform vec3 uColor;
uniform vec3 uScanColor;
uniform vec3 uFogColor;
uniform vec2 uFog;
uniform float uScanX;     // read-head position (local x)
uniform float uScanOn;    // 0..1 visibility of the read head
uniform float uIntensity;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vDepth;
varying float vX;

void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(vViewDir);
  float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 2.0);
  float diff = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.3, 0.8, 0.5))), 0.0);

  float d = vX - uScanX;
  float band = exp(-d * d * 3.0) * uScanOn;          // hot band under the ring
  float done = (1.0 - smoothstep(-0.2, 0.4, d)) * uScanOn; // sequenced side

  vec3 col = uColor * diff * uIntensity * (0.55 + 0.35 * done)
           + mix(uColor, vec3(1.0), 0.4) * fres * 1.1
           + uScanColor * band * 1.3;
  float fog = smoothstep(uFog.x, uFog.y, vDepth);
  col = mix(col, uFogColor, fog);
  gl_FragColor = vec4(col, 1.0);
}
