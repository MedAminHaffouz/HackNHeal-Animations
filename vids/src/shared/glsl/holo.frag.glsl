// "Holographic" shading: soft key light + fresnel rim + HDR emissive (feeds bloom)
// + depth fog toward the background colour.
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform vec2 uFog;        // (near, far) in view-space units
uniform float uIntensity; // emissive multiplier; > 1 blooms
uniform float uRim;       // fresnel rim strength
uniform float uOpacity;
uniform float uRimOpacity; // extra opacity at grazing angles (glass look)
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vColor;
varying float vDepth;

void main() {
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(vViewDir);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.2);

  vec3 L = normalize(vec3(0.35, 0.8, 0.55));
  float diff = 0.30 + 0.70 * max(dot(n, L), 0.0);
  float spec = pow(max(dot(reflect(-L, n), v), 0.0), 24.0) * 0.35;

  vec3 base = uColor * vColor;
  vec3 col = base * diff * uIntensity
           + mix(base, vec3(1.0), 0.35) * fres * uRim
           + vec3(spec);

  float fog = smoothstep(uFog.x, uFog.y, vDepth);
  col = mix(col, uFogColor, fog);
  float alpha = clamp(uOpacity + fres * uRimOpacity, 0.0, 1.0) * (1.0 - fog * 0.6);
  gl_FragColor = vec4(col, alpha);
}
