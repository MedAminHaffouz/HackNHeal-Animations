/**
 * Post-processing stack shared by every visual:
 *   RenderPass → UnrealBloomPass → OutputPass (sRGB) → FinalPass (CA, grain, vignette, scanlines)
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SavePass } from 'three/examples/jsm/postprocessing/SavePass.js';
import type { VizParams } from './params';
import fullscreenVert from './glsl/fullscreen.vert.glsl?raw';
import finalFrag from './glsl/final.frag.glsl?raw';

export interface PostOptions {
  bloomStrength?: number;
  bloomRadius?: number;
  bloomThreshold?: number;
  grain?: number;
  aberration?: number;
  vignette?: number;
  scanlines?: number;
}

export interface PostStack {
  composer: EffectComposer;
  renderPass: RenderPass;
  bloom: UnrealBloomPass;
  final: ShaderPass;
  setSize(w: number, h: number, pixelRatio: number): void;
  render(time: number): void;
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  params: VizParams,
  o: PostOptions = {},
): PostStack {
  const high = params.quality === 'high';
  // HalfFloat keeps HDR values (> 1) alive so bloom can pick out "hot" emissive parts.
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: high ? 4 : 0,
  });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  if (params.transparent) {
    renderPass.clearColor = new THREE.Color(0x000000);
    renderPass.clearAlpha = 0;
  }
  composer.addPass(renderPass);
  // Transparent mode: keep the pre-bloom coverage alpha (bloom destroys it)
  const save = params.transparent ? new SavePass(new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType })) : null;
  if (save) composer.addPass(save);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(256, 256),
    o.bloomStrength ?? 1.1,
    o.bloomRadius ?? 0.55,
    o.bloomThreshold ?? 0.72,
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const final = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uTime: { value: 0 },
        uGrain: { value: (o.grain ?? 0.05) * (params.reducedMotion ? 0.5 : 1) },
        uAberration: { value: high ? o.aberration ?? 2.0 : 0 },
        uVignette: { value: o.vignette ?? 0.55 },
        uScanlines: { value: o.scanlines ?? 0.6 },
        uTransparent: { value: params.transparent ? 1 : 0 },
        tScene: { value: save ? save.renderTarget.texture : null },
      },
      vertexShader: fullscreenVert,
      fragmentShader: finalFrag,
      transparent: params.transparent,
    }),
  );
  composer.addPass(final);

  return {
    composer,
    renderPass,
    bloom,
    final,
    setSize(w, h, pr) {
      composer.setPixelRatio(pr);
      composer.setSize(w, h);
      // bloom is resolution-hungry: run it at reduced size on low quality
      const bs = high ? 1 : 0.5;
      bloom.resolution.set(w * pr * bs, h * pr * bs);
      bloom.setSize(w * pr * bs, h * pr * bs);
      final.uniforms.uResolution.value.set(w * pr, h * pr);
    },
    render(time) {
      // static grain under reduced motion avoids flicker
      final.uniforms.uTime.value = params.reducedMotion ? 0 : time;
      composer.render();
    },
  };
}
