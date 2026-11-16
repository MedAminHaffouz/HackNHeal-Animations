/** Reusable shader materials (holographic surface + bokeh dust). */
import * as THREE from 'three';
import { colors } from './tokens';
import holoVert from './glsl/holo.vert.glsl?raw';
import holoFrag from './glsl/holo.frag.glsl?raw';
import dustVert from './glsl/dust.vert.glsl?raw';
import dustFrag from './glsl/dust.frag.glsl?raw';
import backdropFrag from './glsl/backdrop.frag.glsl?raw';
import fullscreenVert from './glsl/fullscreen.vert.glsl?raw';
import { rng } from './math';

export interface HoloOptions {
  color?: THREE.ColorRepresentation;
  intensity?: number;
  rim?: number;
  opacity?: number;
  rimOpacity?: number;
  fog?: [number, number];
  vertexColors?: boolean;
  transparent?: boolean;
  additive?: boolean;
  side?: THREE.Side;
  depthWrite?: boolean;
  vertexShader?: string;
  extraUniforms?: Record<string, THREE.IUniform>;
  /** Enable the `aDisp * uDisp` vertex displacement. */
  displace?: boolean;
}

export function holoMaterial(o: HoloOptions = {}): THREE.ShaderMaterial {
  const transparent = o.transparent ?? (o.opacity !== undefined && o.opacity < 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uDisp: { value: 0 },
      uColor: { value: new THREE.Color(o.color ?? 0xffffff) },
      uFogColor: { value: new THREE.Color(colors.bg) },
      uFog: { value: new THREE.Vector2(...(o.fog ?? [40, 120])) },
      uIntensity: { value: o.intensity ?? 1 },
      uRim: { value: o.rim ?? 0.8 },
      uOpacity: { value: o.opacity ?? 1 },
      uRimOpacity: { value: o.rimOpacity ?? 0 },
      ...(o.extraUniforms ?? {}),
    },
    vertexShader: o.vertexShader ?? holoVert,
    fragmentShader: holoFrag,
    vertexColors: o.vertexColors ?? false,
    transparent,
    depthWrite: o.depthWrite ?? !transparent,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: o.side ?? THREE.FrontSide,
  });
  if (o.displace) mat.defines = { USE_DISP: '' };
  return mat;
}

export interface DustOptions {
  count: number;
  /** Half-extents of the box the dust lives in. */
  box: [number, number, number];
  color?: THREE.ColorRepresentation;
  size?: number;
  focus?: number;
  aperture?: number;
  drift?: number;
  seed?: number;
}

export function createDust(o: DustOptions): THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> {
  const r = rng(o.seed ?? 7);
  const pos = new Float32Array(o.count * 3);
  const seed = new Float32Array(o.count);
  for (let i = 0; i < o.count; i++) {
    pos[i * 3] = (r() * 2 - 1) * o.box[0];
    pos[i * 3 + 1] = (r() * 2 - 1) * o.box[1];
    pos[i * 3 + 2] = (r() * 2 - 1) * o.box[2];
    seed[i] = r();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const m = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: o.size ?? 1.5 },
      uPixelRatio: { value: 1 },
      uFocus: { value: o.focus ?? 20 },
      uAperture: { value: o.aperture ?? 0.08 },
      uDrift: { value: o.drift ?? 0.6 },
      uColor: { value: new THREE.Color(o.color ?? colors.cyan) },
    },
    vertexShader: dustVert,
    fragmentShader: dustFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}


/**
 * Large camera-facing plate placed far behind the subject.
 * Call `update(camera, time)` each frame so it stays centred in view.
 */
export function createBackdrop(color2: THREE.ColorRepresentation = colors.magenta, grid = 1) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(colors.cyan) },
      uColor2: { value: new THREE.Color(color2) },
      uTime: { value: 0 },
      uGrid: { value: grid },
      uAspect: { value: 1 },
    },
    vertexShader: fullscreenVert,
    fragmentShader: backdropFrag,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  const dir = new THREE.Vector3();
  return {
    mesh,
    update(camera: THREE.PerspectiveCamera, time: number, distance = 120) {
      camera.getWorldDirection(dir);
      mesh.position.copy(camera.position).addScaledVector(dir, distance);
      mesh.quaternion.copy(camera.quaternion);
      const h = 2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      mesh.scale.set(h * camera.aspect, h, 1);
      mat.uniforms.uAspect.value = camera.aspect;
      mat.uniforms.uTime.value = time;
    },
  };
}
