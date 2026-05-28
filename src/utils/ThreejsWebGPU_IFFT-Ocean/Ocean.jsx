import React, { useEffect, useMemo } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import OceanChunkManager from './src/ocean/ocean.js';
import { wave_generator } from './src/waves/wave-generator.js';
import * as THREE from 'three/webgpu';

// Dummy GUI to prevent errors from the vanilla JS code
class DummyGUI {
  addFolder() { return this; }
  add() { return this; }
  addColor() { return this; }
  step() { return this; }
  onChange() { return this; }
  close() { }
}

export default function Ocean({ sharedHUD, oceanConfig, oceanReflector, onLoaded }) {
  const { gl, scene, camera } = useThree();
  const oceanState = useMemo(() => ({ initialized: false, offset: new THREE.Vector2(0, 0) }), []);

  useEffect(() => {
    let active = true;

    async function initOcean() {
      const gui = new DummyGUI();
      const guiParams = {
        sky: {
          rayleigh: 3.0,
          elevation: 9.86,
          azimuth: -149.7,
          turbidity: 10,
          mieCoefficient: 0.005,
          mieDirectionalG: 0.7,
          up: new THREE.Vector3(0, 1, 0),
          exposure: 1
        },
        ocean: {
          wireframe: false,
          renderRadius: 175.0,
          falloffDistance: 30.0,
          seaColor: [0.4, 0.016, 0.047],
          waveColor: [0.14, 0.25, 0.18],
          skyColor: [0.196, 0.588, 0.785],
          roughness: 0.1,
          metallic: 0.8,
        }
      };

      const basicParams = {
        scene,
        camera,
        renderer: gl,
        gui,
        guiParams
      };



      const waveGen = new wave_generator.WaveGenerator();
      await waveGen.Init(basicParams);

      // Force wind direction towards camera (Z axis)
      if (waveGen.waveSettings) {
        if (waveGen.waveSettings.windDirection) waveGen.waveSettings.windDirection.value = Math.PI / 2; // +Z
        if (waveGen.waveSettings.d_windDirection) waveGen.waveSettings.d_windDirection.value = Math.PI / 2; // +Z
      }

      const oceanGen = new OceanChunkManager();
      await oceanGen.Init({
        ...basicParams,
        sunpos: new THREE.Vector3(100000, 0, 100000),
        waveGenerator: waveGen,
        oceanConfig: oceanConfig,
        oceanReflector: oceanReflector,
        layer: 0
      });

      if (active) {
        oceanState.waveGen = waveGen;
        oceanState.oceanGen = oceanGen;
        oceanState.initialized = true;
        if (onLoaded) onLoaded();
      }
    }

    initOcean();

    return () => {
      active = false;
      // Cleanup logic if supported
    };
  }, [gl, scene, camera, oceanState]);

  useFrame((state, delta) => {
    if (!oceanState.initialized) return;

    // Fixed timestep logic from main.js
    const dt = 1000 / 60; // Fixed delta for stable physics

    oceanState.waveGen.Update_(dt);
    oceanState.oceanGen.Update_(dt);

    // Animate globalOffset based on speed
    if (sharedHUD && sharedHUD.current && oceanState.oceanGen.material_) {
      const hud = sharedHUD.current;
      const speed = (hud.scrollVelocity * 600) + (hud.cursorSpeed * 20) + 10; // Base speed + scroll boost + cursor boost

      // Move offset.y (which maps to Z axis in 3D since globalOffset is added to morphedPosition.xz)
      // Moving in +Y in the 2D offset means moving in +Z in the 3D world (towards the camera)
      // Since UVs move with offset, subtracting from offset moves the waves towards the camera visually
      oceanState.offset.y -= speed * (delta / 2);

      oceanState.oceanGen.material_.colorNode.parameters.globalOffset.value.copy(oceanState.offset);
      if (hud.shipPosition && oceanState.oceanGen.material_.colorNode.parameters.shipPosition) {
        oceanState.oceanGen.material_.colorNode.parameters.shipPosition.value.copy(hud.shipPosition);
        // We also need to pass the speed to the material for dynamic wake intensity
        if(oceanState.oceanGen.material_.colorNode.parameters.shipSpeed) {
           oceanState.oceanGen.material_.colorNode.parameters.shipSpeed.value = hud.cursorSpeed;
        }
      }
    }
  });

  return null;
}
