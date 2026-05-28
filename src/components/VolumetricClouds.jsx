import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { float, vec3, vec4, smoothstep, texture3D, uniform, Fn, min, mix } from 'three/tsl';
import { RaymarchingBox } from 'three/addons/tsl/utils/Raymarching.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';

export default function VolumetricClouds({ shipRef, speedFactor }) {
  const meshRef = useRef();

  // Bigger, taller box so the ship flies THROUGH the middle, not just skimming the top
  const CLOUD_STEPS = 80;
  const CLOUD_SIZE = [100, 40, 220];
  const CLOUD_POS = [-1, -5, 0]; // ship at Y≈0 → roughly center of cloud layer

  // 3D noise texture – RepeatWrapping is CRITICAL for seamless scrolling animation
  const cloudTexture = useMemo(() => {
    const size = 64;
    const data = new Uint8Array(size * size * size);
    const perlin = new ImprovedNoise();
    const scale = 0.05;

    let i = 0;
    for (let z = 0; z < size; z++) {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let d = 1.0 - Math.abs(perlin.noise(x * scale, y * scale, z * scale));
          d += 0.5 * (1.0 - Math.abs(perlin.noise(x * scale * 2, y * scale * 2, z * scale * 2)));
          d += 0.25 * (1.0 - Math.abs(perlin.noise(x * scale * 4, y * scale * 4, z * scale * 4)));
          data[i++] = Math.max(0, Math.min(255, d * 128));
        }
      }
    }

    const texture = new THREE.Data3DTexture(data, size, size, size);
    texture.format = THREE.RedFormat;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    // ← Without RepeatWrapping the UV drift clamps and animation is invisible
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.wrapR = THREE.RepeatWrapping; // Z-axis repeat for the 3D texture
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
  }, []);

  // TSL Uniforms
  const driftUniform = uniform(vec3(0, 0, 0));
  const shipPosUniform = uniform(vec3(0, 0, 0));
  const shipSpeedUniform = uniform(0.0);

  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide, // render back faces → works correctly when camera is inside
    });

    const DISP_RADIUS = float(0.05);
    const DISP_STRENGTH = float(0.5);

    const buildColorNode = Fn(() => {
      const accumulatedColor = vec3(0.0).toVar();
      const transmittance = float(1.0).toVar();

      RaymarchingBox(CLOUD_STEPS, ({ positionRay }) => {

        // ── Dual-octave UV sampling ──────────────────────────────────────────
        // uv1: large cloud shapes, drifting with the main drift uniform
        const uv1 = positionRay.add(0.5).add(driftUniform);
        // uv2: fine detail at 2× spatial frequency, slightly faster drift
        const uv2 = positionRay.mul(2.1).add(0.5).add(driftUniform.mul(1.6));

        const s1 = texture3D(cloudTexture, uv1).r;
        const s2 = texture3D(cloudTexture, uv2).r;
        // Combine: big shapes dominate, detail adds local variation
        const combined = s1.mul(0.65).add(s2.mul(0.35));

        // ── Height-based density fade ─────────────────────────────────────────
        // positionRay.y: -0.5 (bottom) → +0.5 (top) in local box space
        const normY = positionRay.y.add(0.5);           // 0..1
        const heightFade = smoothstep(float(0.0), float(0.22), normY)
          .mul(smoothstep(float(1.0), float(0.78), normY));   // thin at edges, thick in middle

        const density = smoothstep(float(0.38), float(0.72), combined).mul(heightFade);

        // ── Ship dispersion ───────────────────────────────────────────────────
        const toShip = shipPosUniform.sub(positionRay);
        const dist = toShip.length();
        const falloff = float(1.0).sub(smoothstep(float(0.0), DISP_RADIUS, dist));
        const dynStr = DISP_STRENGTH.mul(shipSpeedUniform.mul(1.8).add(0.4));
        const pushDir = toShip.div(dist.add(0.0001)).negate(); // away from ship
        const uvDisp = uv1.add(pushDir.mul(dynStr).mul(falloff));

        // Resample at displaced UV near ship (clouds "pushed aside")
        const sDisp = texture3D(cloudTexture, uvDisp).r;
        const dDisp = smoothstep(float(0.38), float(0.72), sDisp).mul(heightFade);

        // Hull mask: zero density in tiny zone right around ship body
        const hullMask = smoothstep(DISP_RADIUS.mul(0.2), DISP_RADIUS.mul(0.5), dist);

        // Blend displaced vs normal density based on proximity
        const nearFactor = falloff;                                  // 1 near ship, 0 far
        const finalDensity = mix(density, dDisp, nearFactor).mul(hullMask);

        // ── Fake volumetric scattering ────────────────────────────────────────
        // Top of clouds: bright sunlit white
        // Bottom: cool blue-gray (shadowed underside)
        const sunFactor = normY.mul(0.4).add(0.3);                  // 0.4 → 1.0 bottom→top
        const topColor = vec3(0.97, 0.97, 1.00);                   // sunlit white
        const botColor = vec3(0.15, 0.3, 0.82);                   // shadow blue
        const cloudColor = mix(botColor, topColor, sunFactor);

        // ── Front-to-back compositing ─────────────────────────────────────────
        const stepAlpha = min(finalDensity.mul(0.03), float(1.0));
        accumulatedColor.addAssign(cloudColor.mul(stepAlpha).mul(transmittance));
        transmittance.mulAssign(float(1.0).sub(stepAlpha));
      });

      const finalAlpha = float(0.3).sub(transmittance);
      return vec4(accumulatedColor, finalAlpha);
    });

    mat.colorNode = buildColorNode();
    return mat;
  }, [cloudTexture]);

  useFrame((state, delta) => {
    const speed = speedFactor?.current ?? 0;
    const t = state.clock.elapsedTime;

    // ── Animated drift ────────────────────────────────────────────────────────
    // X: sinusoidal lateral turbulence (non-linear so it feels organic)
    driftUniform.value.x = Math.sin(t * 0.07) * 0.07;
    // Y: gentle vertical breathing
    driftUniform.value.y = Math.sin(t * 0.043 + 1.2) * 0.04;
    // Z: primary forward scroll – much faster than before, boosts with speed
    // RepeatWrapping handles wrapping in shader, no need to fmod here
    driftUniform.value.z += delta * 0.12 * (1.0 + speed * 7.0);

    // ── Ship speed uniform (smoothed) ─────────────────────────────────────────
    const targetSpeed = Math.min(1.0, speed);
    shipSpeedUniform.value += (targetSpeed - shipSpeedUniform.value) * delta * 2.5;

    // ── Ship position in local box coords ─────────────────────────────────────
    if (shipRef?.current && meshRef.current) {
      const shipWorld = new THREE.Vector3();
      shipRef.current.getWorldPosition(shipWorld);
      const boxInvMatrix = new THREE.Matrix4()
        .copy(meshRef.current.matrixWorld)
        .invert();
      shipWorld.applyMatrix4(boxInvMatrix);
      shipPosUniform.value.set(shipWorld.x, shipWorld.y, shipWorld.z);
    }
  });

  return (
    <mesh ref={meshRef} position={CLOUD_POS} scale={CLOUD_SIZE} material={material}>
      <boxGeometry args={[1, 1, 1]} />
    </mesh>
  );
}
