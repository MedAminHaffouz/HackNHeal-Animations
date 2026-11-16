// Instancing-aware vertex shader for the "holographic" surface look.
// Works for plain meshes, InstancedMesh (instanceMatrix / instanceColor)
// and vertex-coloured geometry.
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec3 vColor;
varying float vDepth;
#ifdef USE_DISP
// optional per-vertex displacement (e.g. protease flaps opening)
attribute vec3 aDisp;
uniform float uDisp;
#endif

void main() {
  vec3 pos = position;
  vec3 nrm = normal;
  vColor = vec3(1.0);
#ifdef USE_DISP
  pos += aDisp * uDisp;
#endif
#ifdef USE_INSTANCING
  pos = (instanceMatrix * vec4(pos, 1.0)).xyz;
  nrm = mat3(instanceMatrix) * nrm;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor *= instanceColor;
#endif
#ifdef USE_COLOR
  vColor *= color;
#endif
  vec4 wp = modelMatrix * vec4(pos, 1.0);
  vNormal = normalize(mat3(modelMatrix) * nrm);
  vViewDir = normalize(cameraPosition - wp.xyz);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
