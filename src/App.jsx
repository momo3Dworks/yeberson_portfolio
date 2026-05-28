import React, { Suspense, useMemo, useEffect, useState, useRef } from 'react';
import { Canvas, useThree, useFrame, extend, useLoader } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three/webgpu';
import { pass, color, mix, uv } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import Fire from './utils/Fire.jsx';
import SmokeTrails from './components/SmokeTrails.jsx';
import MagicalOrbs from './components/MagicalOrbs.jsx';
import EnergyShield from './components/EnergyShield.jsx';
import SpeedLines from './components/SpeedLines.jsx';
import SpeedParticles from './components/SpeedParticles.jsx';
import SpeedometerHUD from './components/SpeedometerHUD.jsx';
import CockpitHUD from './components/CockpitHUD.jsx';
import VolumetricClouds from './components/VolumetricClouds.jsx';
import SciFiCityBackground from './components/SciFiCityBackground.jsx';
import Experience from './components/Experience.jsx';

// --- PARAMETERS TO TWEAK ---
// Ship Configuration
const SHIP_POSITION = [0, 5, 2];
const SHIP_ROTATION = [0, 0, 0];
const SHIP_SCALE = [1, 1, 1];

// Ocean Configuration
const oceanConfig = {
  renderRadius: 150.0,
  falloffDistance: 20.0
};

// City Configuration
const cityConfig = {
  renderRadius: 4000.0,
  falloffDistance: 1000.0
};

// Movement Amplitudes
const SHIP_MOVE_AMPLITUDE_X = 8.0; // Aumenta este valor para más movimiento horizontal
const SHIP_MOVE_AMPLITUDE_Y = 6.5; // Aumenta este valor para más movimiento vertical

const FOV_BASE = 55;    // default camera fov
const FOV_MAX = 120;    // max fov during max thrust (exaggerated warp)
const IMPULSE = 20;     // forward position offset (units) per scroll event (exaggerated)
const DECAY = 0.022; // lerp factor — slightly slower return for drama

// speedFactor and scroll listener moved into App component

//const CAMERA_POSITION = [0, 4, 20];
const CAMERA_POSITION = [13, 7, 15];
const CAMERA_TARGET = [0, 5, 0];
// ---------------------------

// Extend R3F with the Node-based materials required for WebGPU/TSL
extend({
  MeshStandardNodeMaterial: THREE.MeshStandardNodeMaterial,
});

function SceneEnv() {
  const { scene } = useThree();
  const hdrTexture = useLoader(
    RGBELoader,
    'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/qwantani_moon_noon_puresky_1k.hdr'
  );

  useEffect(() => {
    hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdrTexture;
    scene.background = hdrTexture;
    scene.environmentIntensity = 0.5; // Adjust the intensity to look good with bloom
  }, [hdrTexture, scene]);

  return null;
}

function PostProcessing() {
  const { gl, scene, camera } = useThree();

  const pipeline = useMemo(() => {
    // Create the PostProcessing pipeline using the WebGPU renderer
    const postProcessing = new THREE.PostProcessing(gl);

    // Scene pass
    const scenePass = pass(scene, camera);
    const sceneColor = scenePass.getTextureNode('output');

    // Bloom effect using TSL bloom node
    // bloom(inputNode, strength, radius, threshold)
    const bloomPass = bloom(sceneColor, 0.7, 0.4, 0.8);

    // Combine scene color and bloom
    postProcessing.outputNode = sceneColor.add(bloomPass);

    return postProcessing;
  }, [gl, scene, camera]);

  // Hook into the render loop and render the pipeline instead of standard scene
  useFrame(() => {
    pipeline.render();
  }, 1); // priority 1 takes over the render loop

  return null;
}

function ShipModel({ speedFactor, scrollVelocity, sharedHUD }) {
  const { gl, camera } = useThree();
  const shipRef = React.useRef();
  const fireTexture = useLoader(THREE.TextureLoader, '/assets/Fire.webp');


  const gltf = useLoader(GLTFLoader, '/assets/YebersonShip_compressed.glb', (loader) => {
    // Setup Draco
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
    loader.setDRACOLoader(dracoLoader);

    // Setup KTX2
    const ktx2Loader = new KTX2Loader();
    ktx2Loader.setTranscoderPath('https://unpkg.com/three@0.184.0/examples/jsm/libs/basis/');
    ktx2Loader.detectSupport(gl);
    loader.setKTX2Loader(ktx2Loader);
  });

  const fireRefs = React.useRef([]);
  const prevMouse = React.useRef(new THREE.Vector2());
  const cursorSpeed = React.useRef(0);
  const isAway = React.useRef(false);

  useEffect(() => {
    const handleLeave = () => isAway.current = true;
    const handleEnter = () => isAway.current = false;

    document.addEventListener('mouseleave', handleLeave);
    window.addEventListener('blur', handleLeave);
    document.addEventListener('mouseenter', handleEnter);
    window.addEventListener('focus', handleEnter);

    return () => {
      document.removeEventListener('mouseleave', handleLeave);
      window.removeEventListener('blur', handleLeave);
      document.removeEventListener('mouseenter', handleEnter);
      window.removeEventListener('focus', handleEnter);
    };
  }, []);

  // Shared shield hit buffer: MagicalOrbs writes, EnergyShield reads
  // Each hit: { localPoint: Vector3 (normalized direction in ship-local space), time: float }
  const shieldHitsRef = React.useRef({
    hits: Array.from({ length: 8 }, () => ({
      localPoint: new THREE.Vector3(0, 1, 0),
      time: -999,
    })),
    hitIndex: 0,
  });

  const setFireRef = (el, index) => {
    fireRefs.current[index] = el;
  };
  const idleColor = useMemo(() => new THREE.Color("#ff5500"), []); // naranja idle
  const boostColor = useMemo(() => new THREE.Color("#00eeff"), []); // cyan por cursor rápido
  const boostScrollColor = useMemo(() => new THREE.Color("#ff00cc"), []); // magenta por scroll

  // Animación suave de rotación y posición según el mouse
  useFrame((state, delta) => {
    if (shipRef.current) {
      // -- CÁLCULO DE VELOCIDAD --
      const mouseVelX = state.mouse.x - prevMouse.current.x;
      const mouseVelY = state.mouse.y - prevMouse.current.y;

      // La velocidad real del cursor
      const speed = Math.sqrt(mouseVelX * mouseVelX + mouseVelY * mouseVelY) / delta;

      // Suavizamos la velocidad para que los cambios sean fluidos
      cursorSpeed.current = THREE.MathUtils.lerp(cursorSpeed.current, speed, delta * 5);

      prevMouse.current.copy(state.mouse);

      // -- ROTACIÓN --
      const targetRotX = isAway.current ? 0 : state.mouse.y * 0.3;
      const targetRotY = isAway.current ? 0 : -state.mouse.x * 0.5;

      // Curvatura/Alabeo (bank) dinámico: la nave se inclina hacia los lados basándose en el movimiento lateral
      const bankAngle = -mouseVelX * 15.0;
      const targetRotZ = -state.mouse.x * 0.2 + bankAngle;

      shipRef.current.rotation.x = THREE.MathUtils.lerp(shipRef.current.rotation.x, targetRotX, delta * 3);
      shipRef.current.rotation.y = THREE.MathUtils.lerp(shipRef.current.rotation.y, targetRotY, delta * 3);
      shipRef.current.rotation.z = THREE.MathUtils.lerp(shipRef.current.rotation.z, targetRotZ, delta * 5); // Interpolación más rápida para Z

      // -- POSICIÓN --
      const targetPosX = isAway.current ? 0 : state.mouse.x * SHIP_MOVE_AMPLITUDE_X;
      const targetPosY = isAway.current ? 0 : state.mouse.y * SHIP_MOVE_AMPLITUDE_Y;

      shipRef.current.position.x = THREE.MathUtils.lerp(shipRef.current.position.x, targetPosX, delta * 2);
      shipRef.current.position.y = THREE.MathUtils.lerp(shipRef.current.position.y, targetPosY, delta * 2);

      // --- Impulse forward thrust based on scroll ---
      // Smoothly decay the impulse magnitude back to 0 each frame
      speedFactor.current = THREE.MathUtils.lerp(speedFactor.current, 0, DECAY);

      // --- Global scroll velocity for HUD speedometer ---
      // Lerps back to 0: fast decay (0.04) keeps it responsive
      if (scrollVelocity) {
        scrollVelocity.current = THREE.MathUtils.lerp(scrollVelocity.current, 0, 0.04);
      }

      // --- Write shared HUD data (read by SpeedometerHUD & CockpitHUD) ---
      if (sharedHUD) {
        sharedHUD.current.mouseX = state.mouse.x;
        sharedHUD.current.mouseY = state.mouse.y;
        sharedHUD.current.cursorSpeed = cursorSpeed.current;
        sharedHUD.current.scrollVelocity = scrollVelocity ? scrollVelocity.current : 0;
      }

      // Lerp position.z toward the impulse target for a smooth surge & return
      const targetZ = -IMPULSE * speedFactor.current;
      shipRef.current.position.z = THREE.MathUtils.lerp(
        shipRef.current.position.z,
        targetZ,
        delta * 6
      );

      // --- Camera FOV eases in and out with the impulse ---
      const targetFov = THREE.MathUtils.lerp(FOV_BASE, FOV_MAX, speedFactor.current);
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, delta * 6);
      camera.updateProjectionMatrix();

      // -- ANIMACIÓN DE FUEGO DINÁMICO --
      const isMovingFast = cursorSpeed.current > 0.5;

      fireRefs.current.forEach((fire, index) => {
        if (fire) {
          // Configuración base dependiendo del propulsor (0,1 son los principales; 2,3 secundarios; 4 el central)
          let baseZ = 0;
          let zShift = 0;
          let baseYScale = 2.5;

          if (index === 0 || index === 1) {
            baseZ = 5.3;
            zShift = 0.8; // De 5.3 a 6.0
            baseYScale = 2.5;
          } else if (index === 2 || index === 3) {
            baseZ = 4.5;
            zShift = 0.5; // De 4.5 a 5.5
            baseYScale = 2.0;
          } else if (index === 4) {
            baseZ = 6.0;
            zShift = 0.5; // De 6.0 a 6.5
            baseYScale = 2.5;
          }

          // Animación de la escala Y
          const extraScale = isMovingFast ? (cursorSpeed.current * 0.5) : 0;
          const jitter = isMovingFast ? (Math.random() - 0.5) * cursorSpeed.current * 0.3 : 0;
          const targetYScale = baseYScale + extraScale + jitter;

          fire.scale.y = THREE.MathUtils.lerp(fire.scale.y, targetYScale, delta * 15);

          // Animación de la posición Z (se mueve hacia atrás al acelerar)
          const speedFactorLocal = Math.min(cursorSpeed.current, 2.0) / 2.0; // Factor suavizado entre 0 y 1
          const targetZ = baseZ + (zShift * speedFactorLocal);
          fire.position.z = THREE.MathUtils.lerp(fire.position.z, targetZ, delta * 15);

          // Animación de la magnitud (intensidad del efecto)
          if (fire.uniforms && fire.uniforms.magnitude) {
            const baseMagnitude = 2.0;
            const extraMag = isMovingFast ? cursorSpeed.current * 0.5 : 0;
            fire.uniforms.magnitude.value = THREE.MathUtils.lerp(fire.uniforms.magnitude.value, baseMagnitude + extraMag, delta * 10);
          }

          // Animación del Color (0 impacto en performance porque es un Uniform)
          if (fire.uniforms && fire.uniforms.color) {
            // Scroll impulse → magenta; cursor speed → cyan; idle → naranja
            const scrollImpulse = speedFactor.current; // 0..1
            const cursorBoost = isMovingFast;
            let targetColor;
            if (scrollImpulse > 0.05) {
              // Blend between cyan and magenta based on impulse strength
              targetColor = boostColor.clone().lerp(boostScrollColor, scrollImpulse);
            } else if (cursorBoost) {
              targetColor = boostColor;
            } else {
              targetColor = idleColor;
            }
            fire.uniforms.color.value.lerp(targetColor, delta * 8);
          }
        }
      });
    }
  });

  return (
    <group position={SHIP_POSITION} rotation={SHIP_ROTATION} scale={SHIP_SCALE}>
      <group ref={shipRef}>
        <primitive object={gltf.scene} />

        {/* Energy Shield - hex grid sphere that reacts to fairy impacts */}
        <EnergyShield shieldHitsRef={shieldHitsRef} />

        {/* Fire Instances */}
        <Fire
          ref={(el) => setFireRef(el, 0)}
          texture={fireTexture}
          position={[1.3, 0.2, 5.3]}
          rotation={[-4.8, 0, 0]}
          scale={[0.7, 2.5, 0.7]}
          color="#ff5500"
          iterations={5}
          octaves={0.2}
          noiseScale={10.5}
          magnitude={2}
          lacunarity={10.02}
          gain={0.01}
          speed={14}
        />
        <Fire
          ref={(el) => setFireRef(el, 1)}
          texture={fireTexture}
          position={[-1.2, 0.2, 5.3]}
          rotation={[-4.8, 0, 0]}
          scale={[0.7, 2.5, 0.7]}
          color="#ff5500"
          iterations={5}
          octaves={0.2}
          noiseScale={10.5}
          magnitude={2}
          lacunarity={10.02}
          gain={0.01}
        />
        <Fire
          ref={(el) => setFireRef(el, 2)}
          texture={fireTexture}
          position={[-3.2, -1.5, 4.5]}
          rotation={[-4.8, 0, 0]}
          scale={[0.7, 2, 0.7]}
          color="#ff5500"
          iterations={5}
          octaves={0.2}
          noiseScale={10.5}
          magnitude={2}
          lacunarity={10.02}
          gain={0.01}
        />
        <Fire
          ref={(el) => setFireRef(el, 3)}
          texture={fireTexture}
          position={[3.2, -1.5, 4.5]}
          rotation={[-4.8, 0, 0]}
          scale={[0.7, 2, 0.7]}
          color="#ff5500"
          iterations={5}
          octaves={0.2}
          noiseScale={10.5}
          magnitude={2}
          lacunarity={10.02}
          gain={0.01}
        />
        <Fire
          ref={(el) => setFireRef(el, 4)}
          texture={fireTexture}
          position={[0, 0.05, 6]}
          rotation={[-4.8, 0, 0]}
          scale={[0.7, 2.5, 0.7]}
          color="#ff5500"
          iterations={5}
          octaves={0.2}
          noiseScale={10.5}
          magnitude={2}
          lacunarity={10.02}
          gain={0.01}
        />
      </group>

      {/* Smoke Trails Particles */}
      <SmokeTrails fireRefs={fireRefs} cursorSpeed={cursorSpeed} speedFactor={speedFactor} />

      {/* Speed Lines (burst on each scroll) */}
      <SpeedLines shipRef={shipRef} speedFactor={speedFactor} />

      {/* Magical Glowing Orbs (Fairies) with Trails */}
      <MagicalOrbs shipRef={shipRef} shieldHitsRef={shieldHitsRef} cursorSpeed={cursorSpeed} />

      {/* Speed Particles (Space dust that passes by the ship) */}
      <SpeedParticles shipRef={shipRef} cursorSpeed={cursorSpeed} />

      {/* WebGPU Volumetric Clouds with raymarching */}
      <VolumetricClouds shipRef={shipRef} speedFactor={speedFactor} />
    </group>
  );
}

export default function App() {
  const [dpr, setDpr] = useState(() => window.innerWidth <= 768 ? 0.7 : 0.9);

  // Single ref holding the current impulse magnitude (0 = idle, 1 = full)
  const speedFactor = useRef(0);

  // Global scroll velocity ref (0..1) — feeds ShipModel shaders & SpeedometerHUD
  // Value: peaks at 1 on each scroll-down, lerps back to 0 in useFrame (no setState)
  const scrollVelocity = useRef(0);

  // Shared HUD data ref — single source of truth for SpeedometerHUD & CockpitHUD.
  // Written each frame by ShipModel's useFrame; never causes re-renders.
  const sharedHUD = useRef({
    mouseX: 0,
    mouseY: 0,
    cursorSpeed: 0,
    scrollVelocity: 0,
    boostTarget: 660, // km/h target on scroll boost (randomised per event)
  });

  // Register wheel listener once
  useEffect(() => {
    const onWheel = (e) => {
      if (e.deltaY > 0) {
        // Each scroll-down fires a fresh impulse
        speedFactor.current = 1;
        // Peak the global velocity for the HUD speedometer
        scrollVelocity.current = 1;
        // Randomise km/h boost target (650–675) for the speedometer
        sharedHUD.current.boostTarget = 650 + Math.random() * 25;
      }
    };
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);

  // handle responsive DPR
  useEffect(() => {
    const handleResize = () => {
      setDpr(window.innerWidth <= 768 ? 0.6 : 0.8);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <Canvas
      dpr={dpr}
      gl={async (props) => {
        // Initialize the asynchronous WebGPURenderer
        const renderer = new THREE.WebGPURenderer({ ...props, antialias: true });
        await renderer.init();
        return renderer;
      }}
      camera={{ position: CAMERA_POSITION, fov: 50 }}
    >
      <color attach="background" args={['#000']} />

      <Suspense fallback={null}>
        {/* Lights */}
        <ambientLight intensity={0.2} />
        <directionalLight position={[10, 20, 10]} intensity={1.5} />

        <ShipModel speedFactor={speedFactor} scrollVelocity={scrollVelocity} sharedHUD={sharedHUD} />

        {/* Brutalist speedometer — reads sharedHUD, zero re-renders */}
        <SpeedometerHUD sharedHUD={sharedHUD} />

        {/* Full-viewport cockpit overlay — reads sharedHUD, zero re-renders */}
        <CockpitHUD sharedHUD={sharedHUD} />

        {/* Instanced Futuristic City */}
        <SciFiCityBackground speedFactor={speedFactor} cityConfig={cityConfig} />

        {/* WebGPU IFFT Ocean Simulator */}
        <Experience sharedHUD={sharedHUD} oceanConfig={oceanConfig} />

        <PostProcessing />
      </Suspense>

      {/* OrbitControls bloqueados como solicitaste */}
      <OrbitControls target={CAMERA_TARGET} enableRotate={false} enableZoom={false} enablePan={false} />
    </Canvas>
  );
}
