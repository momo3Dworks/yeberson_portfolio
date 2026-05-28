import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame, useThree, useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import * as THREE from 'three/webgpu';
import { texture, time, sin, mix, color, positionWorld, cameraPosition, smoothstep, uniform } from 'three/tsl';

const BUILDING_ASSETS = [
  '/assets/Building1.glb',
  '/assets/Building2.glb',
  '/assets/Building3.glb',
  '/assets/Building4.glb',
  '/assets/Building5.glb',
  '/assets/Building6.glb',
];

const DEPTH_LAYERS = [
  { layer: "Near", z_range: [-10, -40], speed_multiplier: 4, count: 50 },
  { layer: "Mid", z_range: [-70, -150], speed_multiplier: 2.5, count: 30 },
  { layer: "Far", z_range: [-160, -400], speed_multiplier: 1.5, count: 10 }
];

export default function SciFiCityBackground({ speedFactor, cityConfig }) {
  const { camera, gl } = useThree();

  const gltfs = useLoader(GLTFLoader, BUILDING_ASSETS, (loader) => {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);

    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath('https://unpkg.com/three@0.184.0/examples/jsm/libs/basis/');
    ktx2Loader.detectSupport(gl);
    loader.setKTX2Loader(ktx2Loader);
  });

  const baseSpeed = 0.8;
  const globalPosition = [0, -15, 0];
  const globalScale = [28, 28, 28];

  // Extract geometries and materials
  const buildingData = useMemo(() => {
    return gltfs.map(gltf => {
      let geo = null;
      let mat = null;
      gltf.scene.traverse((child) => {
        if (child.isMesh && !geo) {
          geo = child.geometry;
          mat = child.material;
        }
      });

      if (mat) {
        // En WebGPU podemos inyectar nodos TSL directamente al material estándar cargado
        mat.transparent = false;
        mat.depthWrite = true; // CRÍTICO: Evitar glitches de z-sorting con el océano

        // Distance Falloff Logic
        const camera_distance = positionWorld.distance(cameraPosition);
        const visibility_factor = smoothstep(
          uniform(cityConfig.renderRadius - cityConfig.falloffDistance),
          uniform(cityConfig.renderRadius),
          camera_distance
        ).oneMinus();

        mat.opacityNode = visibility_factor;

        if (mat.emissiveMap) {
          const emission_map = texture(mat.emissiveMap);
          const flicker_noise = sin(time.mul(0.8)).add(1.0).mul(0.5);
          const smooth_mix = mix(0.3, 1.0, flicker_noise);
          const final_emission = emission_map.mul(smooth_mix).mul(color('#00ffff')).mul(visibility_factor);
          mat.emissiveNode = final_emission;
        } else if (mat.emissive && mat.emissive.getHex() > 0) {
          // Si no tiene mapa pero tiene color emisivo
          const flicker_noise = sin(time.mul(0.8)).add(1.0).mul(0.5);
          const smooth_mix = mix(0.3, 1.0, flicker_noise);
          mat.emissiveNode = color(mat.emissive).mul(smooth_mix).mul(visibility_factor);
        }
      }
      return { geometry: geo, material: mat };
    });
  }, [gltfs, cityConfig]);

  // We need multiple InstancedMeshes, one per building type
  const instances = useRef([]);
  // Store metadata for each instance: { meshIndex, instanceIndex, speed, resetZ }
  const instancesData = useRef([]);

  useMemo(() => {
    instancesData.current = [];
    DEPTH_LAYERS.forEach(layer => {
      for (let i = 0; i < layer.count; i++) {
        const meshIndex = Math.floor(Math.random() * buildingData.length);

        // Metropolis densa: reducir la dispersión X de 800 a 200
        const x = (Math.random() - 0.5) * 150;

        // Pasillo central más estrecho: dejar 20 unidades libres en lugar de 50
        const finalX = x > 0 ? x + 20 : x - 2;

        const y = 0;
        const z = layer.z_range[0] + Math.random() * (layer.z_range[1] - layer.z_range[0]);

        const scale = 1.0 + Math.random() * 2.0;
        const rotation = Math.random() * Math.PI * 2;

        instancesData.current.push({
          meshIndex,
          speedMultiplier: layer.speed_multiplier,
          zRange: layer.z_range,
          position: new THREE.Vector3(finalX, y, z),
          scale: new THREE.Vector3(scale, scale, scale),
          rotation: new THREE.Euler(0, rotation, 0)
        });
      }
    });
  }, [buildingData]);

  useFrame((state, delta) => {
    const impulse = speedFactor?.current ?? 0;
    const currentSpeed = baseSpeed + impulse * 20; // Increased speed during boost

    // Update positions
    instancesData.current.forEach((data, i) => {
      data.position.z += currentSpeed * data.speedMultiplier * delta;

      // Loop logic: if (instance.position.z > camera.position.z) resetToHorizon
      if (data.position.z > camera.position.z) {
        data.position.z = data.zRange[1]; // Reset to the far end of its layer
      }
    });

    // Update instanced meshes matrices
    if (instances.current.length === buildingData.length) {
      // Create a temporary Object3D to compute matrices
      const dummy = new THREE.Object3D();

      // Counters for each mesh type
      const counters = new Array(buildingData.length).fill(0);

      instancesData.current.forEach(data => {
        dummy.position.copy(data.position);
        dummy.scale.copy(data.scale);
        dummy.rotation.copy(data.rotation);
        dummy.updateMatrix();

        const mesh = instances.current[data.meshIndex];
        const instanceIdx = counters[data.meshIndex];

        if (mesh) {
          mesh.setMatrixAt(instanceIdx, dummy.matrix);
          counters[data.meshIndex]++;
        }
      });

      // Mark instances as needing update
      instances.current.forEach(mesh => {
        if (mesh) mesh.instanceMatrix.needsUpdate = true;
      });
    }
  });

  return (
    <group position={globalPosition} scale={globalScale}>
      {buildingData.map((data, index) => {
        // Count how many instances of this mesh we need
        const count = instancesData.current.filter(d => d.meshIndex === index).length;
        if (!data.geometry || count === 0) return null;

        return (
          <instancedMesh
            key={`building-${index}`}
            ref={el => instances.current[index] = el}
            args={[data.geometry, data.material, count]}
          />
        );
      })}
    </group>
  );
}
