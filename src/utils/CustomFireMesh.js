// CustomFireMesh.js – ES module fork of @wolffo/three-fire TSL
// Adds an explicit `opacity` uniform so alpha is independent of the color's red channel.

import * as THREE from 'three/webgpu';
import * as tsl from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

// ── Uniforms ────────────────────────────────────────────────
const createFireUniforms = (config) => {
  const colorValue =
    config.color instanceof THREE.Color
      ? config.color
      : new THREE.Color(config.color ?? 0xeeeeee);

  config.fireTex.magFilter = THREE.LinearFilter;
  config.fireTex.minFilter = THREE.LinearFilter;
  config.fireTex.wrapS = THREE.ClampToEdgeWrapping;
  config.fireTex.wrapT = THREE.ClampToEdgeWrapping;

  return {
    fireTex: config.fireTex,
    color: tsl.uniform(colorValue),
    opacity: tsl.uniform(1.0), // NEW – explicit alpha control
    time: tsl.uniform(0),
    seed: tsl.uniform(Math.random() * 19.19),
    invModelMatrix: tsl.uniform(new THREE.Matrix4()),
    scale: tsl.uniform(new THREE.Vector3(1, 1, 1)),
    noiseScale: tsl.uniform(
      new THREE.Vector4(...(config.noiseScale ?? [1, 2, 1, 0.3]))
    ),
    magnitude: tsl.uniform(config.magnitude ?? 1.3),
    lacunarity: tsl.uniform(config.lacunarity ?? 2.0),
    gain: tsl.uniform(config.gain ?? 0.5),
  };
};

// ── Turbulence (FBM) ────────────────────────────────────────
const createTurbulence = (octaves) =>
  tsl.Fn(([p, lacunarityU, gainU]) => {
    const sum = tsl.float(0).toVar('turbSum');
    const freq = tsl.float(1).toVar('turbFreq');
    const amp = tsl.float(1).toVar('turbAmp');
    const pos = tsl.vec3(p).toVar('turbPos');
    tsl.Loop(tsl.int(octaves), () => {
      sum.addAssign(tsl.abs(tsl.mx_noise_float(pos.mul(freq))).mul(amp));
      freq.mulAssign(lacunarityU);
      amp.mulAssign(gainU);
    });
    return sum;
  });

const turbulence3 = createTurbulence(3);

const localize = tsl.Fn(([worldPos, invMatrix]) =>
  invMatrix.mul(tsl.vec4(worldPos, 1.0)).xyz
);

// ── Fire sampler ────────────────────────────────────────────
const createSamplerFire = (uniforms) =>
  tsl.Fn(([p, scaleVec]) => {
    const radius = tsl.sqrt(tsl.dot(p.xz, p.xz));
    const st = tsl.vec2(radius, p.y).toVar('st');
    const animP = tsl.vec3(p).toVar('animP');
    const timeOffset = uniforms.seed.add(tsl.time).mul(scaleVec.w);
    animP.y.subAssign(timeOffset);
    animP.assign(animP.mul(tsl.vec3(scaleVec.x, scaleVec.y, scaleVec.z)));
    const turbulenceValue = turbulence3(animP, uniforms.lacunarity, uniforms.gain);
    st.y.addAssign(tsl.sqrt(st.y).mul(uniforms.magnitude).mul(turbulenceValue));
    const outOfBounds = st.x
      .lessThanEqual(0.0)
      .or(st.x.greaterThanEqual(1.0))
      .or(st.y.lessThanEqual(0.0))
      .or(st.y.greaterThanEqual(1.0));
    const texSample = tsl.texture(uniforms.fireTex, st);
    return tsl.select(outOfBounds, tsl.vec4(0.0), texSample);
  });

// ── Fragment node ───────────────────────────────────────────
const createFireFragmentNode = (uniforms, iterations = 20) => {
  const samplerFire = createSamplerFire(uniforms);
  return tsl.Fn(() => {
    const rayPos = tsl.vec3(tsl.positionWorld).toVar('rayPos');
    const rayDir = tsl.normalize(rayPos.sub(tsl.cameraPosition)).toVar('rayDir');
    const rayLen = tsl.float(0.0288).mul(tsl.length(uniforms.scale));
    const col = tsl.vec4(0.0).toVar('col');
    tsl.Loop(tsl.int(iterations), () => {
      rayPos.addAssign(rayDir.mul(rayLen));
      const lp = localize(rayPos, uniforms.invModelMatrix).toVar('lp');
      lp.y.addAssign(0.5);
      lp.x.mulAssign(2.0);
      lp.z.mulAssign(2.0);
      col.addAssign(samplerFire(lp, uniforms.noiseScale));
    });
    // Capture the raw fire density BEFORE color tinting.
    // This is the key fix: density is color-independent, so alpha won't
    // drop when using colors with low red (e.g. cyan #00eeff).
    const density = tsl.float(col.x).toVar('density');
    const colorVec = tsl.vec3(uniforms.color);
    col.x.mulAssign(colorVec.x);
    col.y.mulAssign(colorVec.y);
    col.z.mulAssign(colorVec.z);
    // Alpha = fire shape density × opacity uniform
    col.w.assign(density.mul(uniforms.opacity));
    return col;
  })();
};

// ── Mesh class ──────────────────────────────────────────────
export class CustomFireMesh extends THREE.Mesh {
  constructor({
    fireTex,
    color = 0xeeeeee,
    opacity = 1.0,
    iterations = 20,
    noiseScale = [1, 2, 1, 0.3],
    magnitude = 1.3,
    lacunarity = 2.0,
    gain = 0.5,
  }) {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const config = {
      fireTex,
      color: color instanceof THREE.Color ? color : new THREE.Color(color),
      noiseScale,
      magnitude,
      lacunarity,
      gain,
    };
    const uniforms = createFireUniforms(config);
    uniforms.opacity.value = opacity;

    const material = new MeshBasicNodeMaterial();
    material.fragmentNode = createFireFragmentNode(uniforms, iterations);
    material.transparent = true;
    material.depthWrite = false;
    material.depthTest = false;

    super(geometry, material);
    this.uniforms = uniforms;
    this._time = 0;
  }

  update(time) {
    if (time !== undefined) {
      this._time = time;
      this.uniforms.time.value = time;
    }
    this.updateMatrixWorld();
    this.uniforms.invModelMatrix.value.copy(this.matrixWorld).invert();
    this.uniforms.scale.value.copy(this.scale);
  }

  get time() {
    return this._time;
  }
  set time(v) {
    this._time = v;
    this.uniforms.time.value = v;
  }

  get opacity() {
    return this.uniforms.opacity.value;
  }
  set opacity(v) {
    this.uniforms.opacity.value = v;
  }
}
