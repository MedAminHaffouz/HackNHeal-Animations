// Sugar-phosphate backbone tube. The helix runs along local +X, so a vertex's
// radial direction is simply normalize(position.yz). Strand separation
// ("unzipping") pushes each strand outward along its own radial direction.
// unzip() MUST match unzipAt() in helix.ts.
uniform float uUnzipC;   // bubble centre (local x)
uniform float uUnzipW;   // bubble half-width
uniform float uUnzipAmt; // 0..1
uniform float uUnzipSep; // max radial push
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vDepth;
varying float vX;

float unzip(float x) {
  return uUnzipAmt * (1.0 - smoothstep(uUnzipW * 0.45, uUnzipW, abs(x - uUnzipC)));
}

void main() {
  vec3 pos = position;
  vec2 rad = normalize(pos.yz + 1e-5);
  pos.yz += rad * unzip(pos.x) * uUnzipSep;
  vX = pos.x;
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vNormal = normalize(mat3(modelMatrix) * normal);
  vViewDir = normalize(cameraPosition - wp.xyz);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
