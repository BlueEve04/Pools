import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { WATER_Y, WATER_MAX_DEPTH } from './config.js';

const MAX_RIPPLES = 8;

const WaterShader = {
  name: 'PoolWaterShader',

  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.2, 1.0, 0.15).normalize() },
    uSunColor: { value: new THREE.Color(0xfff0d2) },
    uDeepColor: { value: new THREE.Color(0x05363d) },
    uShallowColor: { value: new THREE.Color(0x1f8a86) },
    uCameraPos: { value: new THREE.Vector3(0, 2, 0) },
    uRipples: {
      value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, 0, 0)),
    },
    uDistortion: { value: 0.1 },
    uFogColor: { value: new THREE.Color(0xd9e9e4) },
    uFogDensity: { value: 0.0052 },
    uAlpha: { value: 0.8 },
    uDepthMap: { value: null },
    uMapMin: { value: new THREE.Vector2(0, 0) },
    uMapSize: { value: new THREE.Vector2(1, 1) },
    uMaxDepth: { value: WATER_MAX_DEPTH },
    uShoreColor: { value: new THREE.Color(0xa9eadf) },
    tRefraction: { value: null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uRefractionDistortion: { value: 0.14 },
  },

  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vReflectCoord;
    varying vec3 vWorldPos;

    void main() {
      vec4 worldPosition = modelMatrix * vec4( position, 1.0 );
      vWorldPos = worldPosition.xyz;
      vReflectCoord = textureMatrix * vec4( position, 1.0 );
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,

  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 color;
    uniform float uTime;
    uniform vec3 uSunDir;
    uniform vec3 uSunColor;
    uniform vec3 uDeepColor;
    uniform vec3 uShallowColor;
    uniform vec3 uCameraPos;
    uniform vec4 uRipples[ ${MAX_RIPPLES} ];
    uniform float uDistortion;
    uniform vec3 uFogColor;
    uniform float uFogDensity;
    uniform float uAlpha;
    uniform sampler2D uDepthMap;
    uniform vec2 uMapMin;
    uniform vec2 uMapSize;
    uniform float uMaxDepth;
    uniform vec3 uShoreColor;
    uniform sampler2D tRefraction;
    uniform vec2 uResolution;
    uniform float uRefractionDistortion;

    varying vec4 vReflectCoord;
    varying vec3 vWorldPos;

    float hash12( vec2 p ) {
      vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
      p3 += dot( p3, p3.yzx + 33.33 );
      return fract( ( p3.x + p3.y ) * p3.z );
    }

    float vnoise( vec2 p ) {
      vec2 i = floor( p );
      vec2 f = fract( p );
      f = f * f * ( 3.0 - 2.0 * f );
      float a = hash12( i );
      float b = hash12( i + vec2( 1.0, 0.0 ) );
      float c = hash12( i + vec2( 0.0, 1.0 ) );
      float d = hash12( i + vec2( 1.0, 1.0 ) );
      return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
    }

    float fbm2( vec2 p ) {
      float v = 0.0;
      float a = 0.5;
      for ( int i = 0; i < 3; i ++ ) {
        v += vnoise( p ) * a;
        p = p * 2.03 + 17.13;
        a *= 0.5;
      }
      return v;
    }

    float waterHeight( vec2 p, float t ) {
      float h = 0.0;
      h += sin( dot( p, vec2( 0.72, 0.41 ) ) * 1.10 + t * 0.52 ) * 0.0165;
      h += sin( dot( p, vec2( -0.43, 0.86 ) ) * 1.90 + t * 0.78 ) * 0.0095;
      h += sin( dot( p, vec2( 0.93, -0.31 ) ) * 3.40 + t * 1.35 ) * 0.0030;
      h += ( fbm2( p * 0.55 + vec2( t * 0.034, -t * 0.021 ) ) - 0.5 ) * 0.030;
      h += ( fbm2( p * 2.10 + vec2( -t * 0.06, t * 0.045 ) ) - 0.5 ) * 0.010;

      for ( int i = 0; i < ${MAX_RIPPLES}; i ++ ) {
        vec4 r = uRipples[ i ];
        if ( r.w <= 0.001 ) continue;
        float age = t - r.z;
        if ( age < 0.0 || age > 5.0 ) continue;
        float radius = age * 0.82;
        float d = length( p - r.xy );
        float band = exp( -pow( ( d - radius ) * 4.0, 2.0 ) );
        float decay = exp( -age * 0.9 );
        h += sin( ( d - radius ) * 19.0 ) * band * decay * 0.032 * r.w;
      }
      return h;
    }

    vec3 waterNormal( vec2 p, float t ) {
      float e = 0.12;
      float h0 = waterHeight( p, t );
      float hx = waterHeight( p + vec2( e, 0.0 ), t );
      float hz = waterHeight( p + vec2( 0.0, e ), t );
      return normalize( vec3( ( h0 - hx ) / e, 1.0, ( h0 - hz ) / e ) );
    }

    void main() {
      vec2 p = vWorldPos.xz;

      vec2 depthUv = ( p - uMapMin ) / uMapSize;
      float depth = texture2D( uDepthMap, clamp( depthUv, vec2( 0.0 ), vec2( 1.0 ) ) ).r * uMaxDepth;
      if ( depth < 0.002 ) discard;

      vec3 n = waterNormal( p, uTime );

      vec2 uv = vReflectCoord.xy / vReflectCoord.w;
      vec2 distortion = n.xz * uDistortion;
      vec2 ruv = clamp( uv + distortion, vec2( 0.001 ), vec2( 0.999 ) );
      vec3 reflection = texture2D( tDiffuse, ruv ).rgb;

      vec3 viewDir = normalize( uCameraPos - vWorldPos );
      float cosTheta = clamp( dot( viewDir, n ), 0.0, 1.0 );
      float fres = pow( 1.0 - cosTheta, 2.25 );
      float reflAmount = clamp( 0.07 + 0.95 * fres, 0.0, 1.0 );

      float shallowAtten = smoothstep( 0.015, 0.24, depth );
      reflAmount *= mix( 0.12, 1.0, shallowAtten );

      /* screen-space refraction of the scene below the surface */
      vec2 screenUv = gl_FragCoord.xy / uResolution;
      float refractScale = mix( 0.45, 1.0, smoothstep( 0.02, 0.4, depth ) );
      vec2 refrUv = clamp(
        screenUv + n.xz * uRefractionDistortion * refractScale,
        vec2( 0.002 ), vec2( 0.998 )
      );
      vec3 refracted = texture2D( tRefraction, refrUv ).rgb;

      /* depth absorption */
      float depthF = smoothstep( 0.0, 0.75, depth );
      vec3 absorb = mix( vec3( 0.82, 0.97, 0.94 ), vec3( 0.40, 0.76, 0.75 ), depthF );
      refracted *= absorb;
      refracted = mix( refracted, uShallowColor, 0.08 + 0.10 * depthF );

      vec3 halfDir = normalize( uSunDir + viewDir );
      float ndh = max( dot( n, halfDir ), 0.0 );
      float spec = pow( ndh, 900.0 ) + pow( ndh, 120.0 ) * 0.10;
      vec3 specular = uSunColor * spec * 3.0;

      vec3 reflTint = mix( vec3( 0.55, 0.82, 0.80 ), vec3( 0.78, 0.92, 0.92 ), shallowAtten );
      vec3 col = mix( refracted, reflection * reflTint, reflAmount );
      col += specular * ( 0.30 + 0.70 * fres );

      float shore = 1.0 - smoothstep( 0.004, 0.10, depth );
      float foamNoise = fbm2( p * 5.0 + vec2( uTime * 0.2, -uTime * 0.12 ) );
      float foam = shore * ( 0.55 + 0.45 * foamNoise );
      col = mix( col, vec3( 0.94, 1.0, 0.97 ), foam * 0.65 );

      /* the water is opaque; the refraction texture already contains the floor */
      gl_FragColor = vec4( col, 1.0 );
    }
  `,
};

export class Water {
  constructor(renderer) {
    this.renderer = renderer;
    this.time = 0;
    this.cursor = 0;

    const geometry = new THREE.PlaneGeometry(150, 130);
    const reflector = new Reflector(geometry, {
      shader: WaterShader,
      clipBias: 0.004,
      textureWidth: 1024,
      textureHeight: 1024,
      multisample: 4,
    });

    reflector.rotation.x = -Math.PI / 2;
    reflector.position.set(3, WATER_Y, -14);
    reflector.renderOrder = 2;
    reflector.material.transparent = true;
    reflector.material.depthWrite = false;
    reflector.material.side = THREE.FrontSide;

    this.mesh = reflector;
    this.uniforms = reflector.material.uniforms;
    this.uniforms.color.value = new THREE.Color(0x7f7f7f);
    this.rippleSlots = this.uniforms.uRipples.value;
    this.waterHeight = WATER_Y;
    this.depthTexture = null;

    this.refractionTarget = new THREE.WebGLRenderTarget(512, 512, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    this.refractionTarget.texture.name = 'PoolWaterRefraction';
    this.uniforms.tRefraction.value = this.refractionTarget.texture;
  }

  /**
   * Render the scene without the water into the refraction texture.
   * Call once per frame before the main composer render.
   */
  renderRefraction(renderer, scene, camera) {
    const prevRT = renderer.getRenderTarget();
    const prevXr = renderer.xr.enabled;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;

    renderer.xr.enabled = false;
    renderer.shadowMap.autoUpdate = false;
    this.mesh.visible = false;

    renderer.setRenderTarget(this.refractionTarget);
    renderer.state.buffers.depth.setMask(true);
    renderer.clear();
    renderer.render(scene, camera);

    this.mesh.visible = true;
    renderer.xr.enabled = prevXr;
    renderer.shadowMap.autoUpdate = prevShadowAuto;
    renderer.setRenderTarget(prevRT);
  }

  /**
   * Build a top-down floor-depth map from walkable zones. The water shader
   * uses it to discard dry areas and shade shallow steps differently.
   */
  setDepthMapFromZones(zones, { waterY = WATER_Y, maxDepth = WATER_MAX_DEPTH, size = 1024, padding = 2.5 } = {}) {
    if (!zones || zones.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const z of zones) {
      if (z.minX < minX) minX = z.minX;
      if (z.maxX > maxX) maxX = z.maxX;
      if (z.minZ < minZ) minZ = z.minZ;
      if (z.maxZ > maxZ) maxZ = z.maxZ;
    }
    minX -= padding; maxX += padding;
    minZ -= padding; maxZ += padding;
    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, size, size);

    const sorted = [...zones].sort((a, b) => a.y - b.y);
    for (const zone of sorted) {
      const depth = Math.max(0, Math.min(maxDepth, waterY - zone.y));
      const v = Math.round((depth / maxDepth) * 255);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      const x0 = ((zone.minX - minX) / spanX) * size;
      const y0 = ((zone.minZ - minZ) / spanZ) * size;
      const x1 = ((zone.maxX - minX) / spanX) * size;
      const y1 = ((zone.maxZ - minZ) / spanZ) * size;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.flipY = false;
    tex.colorSpace = THREE.NoColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;

    this.uniforms.uDepthMap.value = tex;
    this.uniforms.uMapMin.value.set(minX, minZ);
    this.uniforms.uMapSize.value.set(spanX, spanZ);
    this.uniforms.uMaxDepth.value = maxDepth;
    this.depthTexture = tex;
    this.depthBounds = { minX, minZ, maxX, maxZ };
  }

  addRipple(x, z, strength = 1.0) {
    const slot = this.rippleSlots[this.cursor];
    slot.set(x, z, this.time, Math.min(1.4, strength));
    this.cursor = (this.cursor + 1) % MAX_RIPPLES;
  }

  setAtmosphere(color, density) {
    this.uniforms.uFogColor.value.copy(color);
    this.uniforms.uFogDensity.value = density;
  }

  setSun(direction, color) {
    this.uniforms.uSunDir.value.copy(direction).normalize();
    if (color) this.uniforms.uSunColor.value.copy(color);
  }

  update(time, camera) {
    this.time = time;
    this.uniforms.uTime.value = time;
    this.uniforms.uCameraPos.value.copy(camera.position);
  }

  setSize(width, height, screenWidth = width, screenHeight = height) {
    const w = Math.max(256, Math.floor(width));
    const h = Math.max(180, Math.floor(height));
    const rt = this.mesh.getRenderTarget();
    if (rt) rt.setSize(w, h);
    this.refractionTarget.setSize(w, h);
    this.uniforms.uResolution.value.set(screenWidth, screenHeight);
  }
}
