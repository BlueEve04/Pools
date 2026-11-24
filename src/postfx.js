import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  name: 'PoolGradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.022 },
    uAberration: { value: 0.0016 },
    uContrast: { value: 1.13 },
    uSaturation: { value: 1.1 },
    uGamma: { value: 1.04 },
    uSCurve: { value: 0.2 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uResolution;
    uniform float uVignette;
    uniform float uGrain;
    uniform float uAberration;
    uniform float uContrast;
    uniform float uSaturation;
    uniform float uGamma;
    uniform float uSCurve;
    varying vec2 vUv;

    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 uv = vUv;
      vec2 centered = uv - 0.5;
      float aspect = uResolution.x / max(1.0, uResolution.y);
      float r2 = dot(centered, centered);
      vec2 off = centered * (0.35 + r2 * 0.95) * uAberration;

      float cr = texture2D(tDiffuse, uv + off).r;
      vec4 cg = texture2D(tDiffuse, uv);
      float cb = texture2D(tDiffuse, uv - off).b;
      vec3 col = vec3(cr, cg.g, cb);

      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));

      vec3 shadowTint = vec3(0.935, 1.0, 1.015);
      vec3 highTint = vec3(1.03, 1.005, 0.972);
      col *= mix(shadowTint, highTint, smoothstep(0.22, 0.86, lum));

      col = pow(max(col, vec3(0.0)), vec3(uGamma));
      vec3 sCurve = col * col * (3.0 - 2.0 * col);
      col = mix(col, sCurve, uSCurve);
      col = (col - 0.5) * uContrast + 0.5;
      col = mix(vec3(lum), col, uSaturation);

      float vd = length((uv - 0.5) * vec2(aspect * 0.72, 1.0));
      float vig = 1.0 - smoothstep(0.50, 1.06, vd) * 0.44 * uVignette;
      col *= vig;

      float n = hash12(gl_FragCoord.xy + vec2(uTime * 37.0, uTime * 57.0)) - 0.5;
      col += n * uGrain;

      gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `,
};

export function createPost(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.renderTarget1.samples = 4;
  composer.renderTarget2.samples = 4;

  const renderPass = new RenderPass(scene, camera);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.18,
    0.45,
    1.25,
  );

  const output = new OutputPass();

  const grade = new ShaderPass(GradeShader);
  grade.name = 'PoolGrade';

  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(grade);

  function setSize(w, h) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
    bloom.setSize(w, h);
    grade.uniforms.uResolution.value.set(w, h);
  }

  function update(t) {
    grade.uniforms.uTime.value = t;
  }

  function render() {
    composer.render();
  }

  return {
    composer,
    bloom,
    grade,
    output,
    renderPass,
    setSize,
    update,
    render,
  };
}
