import React, { Suspense, useRef, useEffect, useMemo, useState } from 'react'
import { Canvas, useThree, useFrame } from '@react-three/fiber'
import { SkyMesh } from 'three/examples/jsm/objects/SkyMesh.js'
import { Leva, useControls } from 'leva'
import * as THREE from 'three'
import { HandsModel } from './components/HandsModel'

import { TableTopModel } from './components/TableTopModel'
import { SkySphereModel } from './components/SkySphereModel'
import { SceneLights } from './components/SceneLights'
import { PostProcessingPipeline } from './components/PostProcessingPipeline'
import { useCameraCulling } from './hooks/useCameraCulling'
import { StudioLoader, ShaderCompiler } from './components/StudioLoader'
import { WebGPUText } from 'r3f-webgpu-text'
import { Perf } from 'r3f-webgpu-perf'


// ── Native WebGPU Atmospheric Sky Mesh ──────────────────────
function WebGPUSky({
  turbidity,
  rayleigh,
  mieCoefficient,
  mieDirectionalG,
  sunPosition,
  distance = 450000
}: {
  turbidity: number
  rayleigh: number
  mieCoefficient: number
  mieDirectionalG: number
  sunPosition: [number, number, number] | THREE.Vector3
  distance?: number
}) {
  const skyMesh = useMemo(() => {
    const sky = new SkyMesh()
    sky.scale.setScalar(distance)
    return sky
  }, [distance])

  useEffect(() => {
    if (skyMesh) {
      skyMesh.turbidity.value = turbidity
      skyMesh.rayleigh.value = rayleigh
      skyMesh.mieCoefficient.value = mieCoefficient
      skyMesh.mieDirectionalG.value = mieDirectionalG
      if (Array.isArray(sunPosition)) {
        skyMesh.sunPosition.value.set(sunPosition[0], sunPosition[1], sunPosition[2])
      } else {
        skyMesh.sunPosition.value.copy(sunPosition)
      }
    }
  }, [skyMesh, turbidity, rayleigh, mieCoefficient, mieDirectionalG, sunPosition])

  return <primitive object={skyMesh} />
}

// Smooth Adaptive DPR with continuous interpolation
function SmoothAdaptiveDpr({
  minDpr = 0.6,
  maxDpr = 0.8,
  enabled = true,
  lerpSpeed = 3.5
}: {
  minDpr: number
  maxDpr: number
  enabled: boolean
  lerpSpeed: number
}) {
  const gl = useThree((state) => state.gl)
  const regress = useThree((state) => state.performance.regress)
  const currentDpr = useRef(maxDpr)
  const isMoving = useRef(false)
  const moveTimeout = useRef<any>(null)
  const lastPointer = useRef(new THREE.Vector2())

  useFrame((state, delta) => {
    if (!enabled) return

    // Detect mouse motion
    const pointerDist = lastPointer.current.distanceToSquared(state.pointer)
    if (pointerDist > 0.00002) {
      if (!isMoving.current) {
        regress()
      }
      isMoving.current = true
      lastPointer.current.copy(state.pointer)
      if (moveTimeout.current) clearTimeout(moveTimeout.current)
      moveTimeout.current = setTimeout(() => {
        isMoving.current = false
      }, 300)
    }

    const targetDpr = isMoving.current ? minDpr : maxDpr

    // Continuous smooth damping between min and max DPR
    const nextDpr = THREE.MathUtils.damp(
      currentDpr.current,
      targetDpr,
      lerpSpeed,
      delta
    )

    if (Math.abs(nextDpr - currentDpr.current) > 0.002) {
      currentDpr.current = nextDpr
      gl.setPixelRatio(nextDpr)
    }
  })

  useEffect(() => {
    return () => {
      if (moveTimeout.current) clearTimeout(moveTimeout.current)
    }
  }, [])

  return null
}

// Direct Camera Controller with Smooth Mouse Parallax
function CameraController({
  position,
  target,
  fov,
  near,
  far,
  parallaxIntensity
}: {
  position: { x: number; y: number; z: number }
  target: { x: number; y: number; z: number }
  fov: number
  near: number
  far: number
  parallaxIntensity: number
}) {
  const { camera } = useThree()
  const offset = useRef(new THREE.Vector2(0, 0))

  // Update Field of View, Near, and Far clipping planes dynamically
  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      let changed = false
      if (camera.fov !== fov) {
        camera.fov = fov
        changed = true
      }
      if (camera.near !== near) {
        camera.near = near
        changed = true
      }
      if (camera.far !== far) {
        camera.far = far
        changed = true
      }
      if (changed) {
        camera.updateProjectionMatrix()
      }
    }
  }, [fov, near, far, camera])

  // Smooth mouse parallax loop
  useFrame((state, delta) => {
    const targetOffsetX = state.pointer.x * parallaxIntensity
    const targetOffsetY = state.pointer.y * parallaxIntensity

    offset.current.x = THREE.MathUtils.damp(offset.current.x, targetOffsetX, 4, delta)
    offset.current.y = THREE.MathUtils.damp(offset.current.y, targetOffsetY, 4, delta)

    state.camera.position.set(
      position.x + offset.current.x,
      position.y + offset.current.y,
      position.z
    )

    state.camera.lookAt(
      target.x + offset.current.x * 0.15,
      target.y + offset.current.y * 0.15,
      target.z
    )
  })

  return null
}

// Scene Frustum Culling Sub-component
function SceneFrustumCullingHelper({
  enabled,
  tableGroup,
  pointLight1,
  pointLight2
}: {
  enabled: boolean
  tableGroup: THREE.Group | null
  pointLight1: THREE.PointLight | null
  pointLight2: THREE.PointLight | null
}) {
  useCameraCulling({
    enabled,
    throttleFrames: 4,
    targets: [tableGroup],
    pointLights: [pointLight1, pointLight2]
  })
  return null
}

export default function App() {
  const [shadersCompiled, setShadersCompiled] = useState(false)

  // Object references for Frustum Culling
  const [tableGroup, setTableGroup] = useState<THREE.Group | null>(null)
  const pointLight1Ref = useRef<THREE.PointLight | null>(null)
  const pointLight2Ref = useRef<THREE.PointLight | null>(null)

  // ── 1. Camera Controls + Mouse Parallax ──────────────────────
  const cameraControls = useControls('Camera', {
    position: {
      value: { x: 0, y: 0.17, z: 0.35 },
      step: 0.005,
      label: 'Posición'
    },
    target: {
      value: { x: 0, y: 0, z: 0 },
      step: 0.005,
      label: 'Target'
    },
    fov: {
      value: 45,
      min: 15,
      max: 95,
      step: 1,
      label: 'FOV'
    },
    near: {
      value: 0.05,
      min: 0.001,
      max: 1.0,
      step: 0.005,
      label: 'Near Clip'
    },
    far: {
      value: 3000,
      min: 50,
      max: 10000,
      step: 50,
      label: 'Far Clip / Draw Dist'
    },
    parallaxIntensity: {
      value: 0.05,
      min: 0,
      max: 0.25,
      step: 0.005,
      label: 'Parallax Mouse'
    }
  })

  // ── 2. Directional Key Light ─────────────────────────────────
  const directionalLightControls = useControls('Directional Light', {
    intensity: {
      value: 2.0,
      min: 0,
      max: 8.0,
      step: 0.1,
      label: 'Intensidad'
    },
    color: {
      value: '#ffffff',
      label: 'Color'
    },
    position: {
      value: { x: 2.0, y: 5, z: 4 },
      step: 0.2,
      label: 'Posición'
    },
    castShadows: {
      value: true,
      label: 'Cast Shadows'
    }
  })

  // ── 3. Point Lights (Independently Toggleable) ───────────────
  const pointLight1Controls = useControls('Point Light 1 (Cálida)', {
    enabled: {
      value: true,
      label: 'Habilitar Luz 1'
    },
    color: {
      value: '#f59e0b',
      label: 'Color'
    },
    intensity: {
      value: 4.7,
      min: 0,
      max: 10.0,
      step: 0.1,
      label: 'Intensidad'
    },
    position: {
      value: { x: -1.3, y: -0.8, z: -0.6 },
      step: 0.05,
      label: 'Posición'
    },
    distance: {
      value: 3.5,
      min: 0.5,
      max: 10.0,
      step: 0.1,
      label: 'Distancia'
    }
  })

  const pointLight2Controls = useControls('Point Light 2 (Fría)', {
    enabled: {
      value: false,
      label: 'Habilitar Luz 2'
    },
    color: {
      value: '#386ff8',
      label: 'Color'
    },
    intensity: {
      value: 3,
      min: 0,
      max: 10.0,
      step: 0.1,
      label: 'Intensidad'
    },
    position: {
      value: { x: 1.20, y: -0.90, z: -0.20 },
      step: 0.05,
      label: 'Posición'
    },
    distance: {
      value: 3.5,
      min: 0.5,
      max: 10.0,
      step: 0.1,
      label: 'Distancia'
    }
  })

  // ── 3b. Animación de Luces con el Cursor (Mouse Parallax) ────
  const lightMotionControls = useControls('Animación de Luces (Cursor Parallax)', {
    enabled: {
      value: true,
      label: 'Activar Movimiento de Luces'
    },
    smoothing: {
      value: 4.0,
      min: 1.0,
      max: 12.0,
      step: 0.5,
      label: 'Suavizado (Smoothing)'
    },
    dirLightXOffset: {
      value: 0.3,
      min: 0.0,
      max: 5.0,
      step: 0.1,
      label: 'Luz Direccional X (Offset)'
    },
    dirLightYOffset: {
      value: 0.3,
      min: 0.0,
      max: 3.0,
      step: 0.1,
      label: 'Luz Direccional Y (Offset)'
    },
    point1XOffset: {
      value: 0.9,
      min: 0.0,
      max: 3.0,
      step: 0.05,
      label: 'Luz Cálida 1 X (Offset)'
    },
    point1YOffset: {
      value: 0.4,
      min: 0.0,
      max: 2.0,
      step: 0.05,
      label: 'Luz Cálida 1 Y (Offset)'
    },
    point2XOffset: {
      value: 0.9,
      min: 0.0,
      max: 3.0,
      step: 0.05,
      label: 'Luz Fría 2 X (Offset)'
    },
    point2YOffset: {
      value: 0.4,
      min: 0.0,
      max: 2.0,
      step: 0.05,
      label: 'Luz Fría 2 Y (Offset)'
    },
    invertDirection: {
      value: true,
      label: 'Invertir Sentido (Contraluz)'
    }
  })

  // ── 4. Atmospheric Sky (Matching three.js webgpu_sky.html) ────
  const skyControls = useControls('Cielo Atmosférico (webgpu_sky)', {
    enabled: {
      value: false,
      label: 'Activar Cielo'
    },
    elevation: {
      value: 2.0,
      min: -5.0,
      max: 90.0,
      step: 0.5,
      label: 'Elevación Solar'
    },
    azimuth: {
      value: 180,
      min: 0,
      max: 360,
      step: 1,
      label: 'Azimuth Solar'
    },
    turbidity: {
      value: 10,
      min: 0,
      max: 20,
      step: 0.1,
      label: 'Turbidity'
    },
    rayleigh: {
      value: 3,
      min: 0,
      max: 4,
      step: 0.1,
      label: 'Rayleigh'
    },
    mieCoefficient: {
      value: 0.06,
      min: 0,
      max: 0.1,
      step: 0.001,
      label: 'Mie Coefficient'
    },
    mieDirectionalG: {
      value: 0.32,
      min: 0,
      max: 1.0,
      step: 0.01,
      label: 'Mie Directional G'
    }
  })

  const sunPosition = useMemo(() => {
    const phi = THREE.MathUtils.degToRad(90 - skyControls.elevation)
    const theta = THREE.MathUtils.degToRad(skyControls.azimuth)
    const sun = new THREE.Vector3()
    sun.setFromSphericalCoords(1, phi, theta)
    return [sun.x, sun.y, sun.z] as [number, number, number]
  }, [skyControls.elevation, skyControls.azimuth])

  // ── 5. Post-Processing Nativo por Nodos (WebGPU TSL) ──────────
  const postControls = useControls('Post-Processing (WebGPU TSL)', {
    bloomEnabled: { value: true, label: 'Bloom Activo' },
    bloomStrength: { value: 0.35, min: 0.0, max: 2.0, step: 0.05, label: 'Bloom Strength' },
    bloomRadius: { value: 0.3, min: 0.0, max: 1.0, step: 0.05, label: 'Bloom Radius' },
    bloomThreshold: { value: 0.8, min: 0.0, max: 1.5, step: 0.05, label: 'Bloom Threshold' },

    dofEnabled: { value: true, label: 'DoF Activo' },
    dofFocus: { value: 0.30, min: 0.05, max: 2.0, step: 0.01, label: 'DoF Focus Distance' },
    dofAperture: { value: 0.02, min: 0.001, max: 0.2, step: 0.005, label: 'DoF Aperture' },
    dofMaxBlur: { value: 0.02, min: 0.001, max: 0.05, step: 0.001, label: 'DoF Max Blur' },

    vignetteEnabled: { value: true, label: 'Vignette Activo' },
    vignetteOffset: { value: 0.3, min: 0.0, max: 1.0, step: 0.02, label: 'Vignette Offset' },
    vignetteDarkness: { value: 0.5, min: 0.0, max: 1.5, step: 0.05, label: 'Vignette Darkness' },

    toneMappingMode: {
      value: 'neutral',
      options: ['aces', 'agx', 'neutral'],
      label: 'ToneMapping Mode'
    },
    exposure: { value: 1.0, min: 0.1, max: 3.0, step: 0.05, label: 'ToneMapping Exposure' }
  })

  // ── 5b. FSR / FidelityFX & Nitidez (WebGPU TSL) ──────────────
  const fsrControls = useControls('FSR & Nitidez (FidelityFX)', {
    enabled: { value: true, label: 'FSR Activo' },
    qualityMode: {
      value: 'native',
      options: ['native', 'ultra-quality', 'quality', 'balanced', 'performance'],
      label: 'Modo de Calidad'
    },
    path: {
      value: 'spatial',
      options: ['spatial', 'temporal', 'bilinear', 'rcas-only'],
      label: 'Algoritmo (Path)'
    },
    sharpness: { value: 0.8, min: 0.0, max: 1.0, step: 0.05, label: 'RCAS Sharpness' },
    rcasDenoise: { value: true, label: 'RCAS Denoise' },
    preExposure: { value: 1.0, min: 0.1, max: 3.0, step: 0.05, label: 'Pre-Exposure' },
    lockThinFeatures: { value: true, label: 'Bloquear Rasgos Finos' },
    detectShadingChanges: { value: true, label: 'Detectar Sombreado' },
    debugView: {
      value: 'off',
      options: ['off', 'edges', 'sharpening', 'luma'],
      label: 'Modo Depuración'
    }
  })

  // ── 5c. Color Grading 3D LUT (.CUBE) ─────────────────────────
  const lutControls = useControls('Color Grading (3D LUT CUBE)', {
    enabled: { value: true, label: 'LUT Activo' },
    lut: {
      value: 'Remy 24',
      options: ['Chemical 168', 'Bourbon 64', 'Clayton 33', 'Cubicle 99', 'Remy 24'],
      label: 'Perfil LUT'
    },
    intensity: { value: 0.20, min: 0.0, max: 1.0, step: 0.05, label: 'Intensidad LUT' }
  })

  // ── 6. WebGPU Glass Transmission Material ("hands" - ektogamat/r3f-alpha-6) ──
  const glassControls = useControls('Material Cristal ("hands")', {
    thickness: {
      value: 1.85,
      min: 0.01,
      max: 4.0,
      step: 0.05,
      label: 'Thickness (Grosor)'
    },
    backsideThickness: {
      value: 0.75,
      min: 0.01,
      max: 2.0,
      step: 0.02,
      label: 'Backside Thickness'
    },
    roughness: {
      value: 0.02,
      min: 0,
      max: 1.0,
      step: 0.01,
      label: 'Roughness'
    },
    ior: {
      value: 1.52,
      min: 1.0,
      max: 2.5,
      step: 0.01,
      label: 'IOR (Refracción)'
    },
    dispersion: {
      value: 3.5,
      min: 0,
      max: 20.0,
      step: 0.2,
      label: 'Dispersion Cromática'
    },
    distortion: {
      value: 0.015,
      min: 0,
      max: 0.2,
      step: 0.005,
      label: 'Distorsión de Rayo'
    },
    distortionScale: {
      value: 0.007,
      min: 0,
      max: 0.05,
      step: 0.001,
      label: 'Distortion Scale'
    },
    temporalDistortion: {
      value: 0.0,
      min: 0,
      max: 1.0,
      step: 0.05,
      label: 'Temporal Distortion'
    },
    anisotropicBlur: {
      value: 0.015,
      min: 0,
      max: 0.1,
      step: 0.005,
      label: 'Anisotropic Blur'
    },
    backside: {
      value: true,
      label: 'Backside Pass (Doble Cara)'
    },
    reflections: {
      value: 1.20,
      min: 0,
      max: 2.0,
      step: 0.05,
      label: 'Reflejos / EnvMap'
    },
    color: {
      value: '#96d4ff',
      label: 'Glass Tint (Color)'
    },
    attenuationColor: {
      value: '#ffe9b3',
      label: 'Attenuation Color'
    },
    attenuationDistance: {
      value: 1.750,
      min: 0.0,
      max: 5.0,
      step: 0.05,
      label: 'Attenuation Dist'
    },
    clearcoat: {
      value: 0.60,
      min: 0,
      max: 1.0,
      step: 0.05,
      label: 'Clearcoat'
    },
    clearcoatRoughness: {
      value: 0.08,
      min: 0,
      max: 1.0,
      step: 0.02,
      label: 'Clearcoat Roughness'
    },
    iridescence: {
      value: 0.55,
      min: 0,
      max: 1.0,
      step: 0.05,
      label: 'Iridescence'
    },
    depthWrite: {
      value: true,
      label: 'Depth Write (false = Sin artefactos)'
    },
    side: {
      value: 'FrontSide',
      options: ['DoubleSide', 'FrontSide', 'BackSide'],
      label: 'Lado de Render (Side)'
    }
  })

  // ── 6b. 3D MSDF WebGPU Typography (r3f-webgpu-text) ─────────
  const textControls = useControls('Texto 3D MSDF (r3f-webgpu-text)', {
    visible: { value: false, label: 'Mostrar Texto 3D' },
    title: { value: 'YEBERSON ORTA', label: 'Título' },
    subtitle: { value: 'CREATIVE DEVELOPER & GRAPHICS ENGINEER', label: 'Subtítulo' },
    fontSize: { value: 0.024, min: 0.005, max: 0.08, step: 0.002, label: 'Tamaño Fuente' },
    color: { value: '#ffffff', label: 'Color Título' },
    subColor: { value: '#99f7ff', label: 'Color Subtítulo' },
    posX: { value: 0, min: -1.0, max: 1.0, step: 0.01, label: 'Pos X' },
    posY: { value: 0.12, min: -0.2, max: 0.6, step: 0.01, label: 'Pos Y' },
    posZ: { value: -0.15, min: -0.8, max: 0.4, step: 0.01, label: 'Pos Z' },
    letterSpacing: { value: 0.06, min: 0, max: 0.25, step: 0.01, label: 'Espaciado' },
    opacity: { value: 0.95, min: 0.0, max: 1.0, step: 0.05, label: 'Opacidad' }
  })

  // ── 7. Animation Controls ────────────────────────────────────
  const animControls = useControls('Animación', {
    isPlaying: {
      value: true,
      label: 'Reproducir'
    },
    animationSpeed: {
      value: 1.0,
      min: 0.1,
      max: 3.0,
      step: 0.1,
      label: 'Velocidad'
    }
  })

  // ── 7b. Barrido de Emisión Cartas Tarot (hands_skills.glb) ───
  const tarotSweepControls = useControls('Barrido Emisión Tarot (6 Cartas)', {
    enabled: {
      value: true,
      label: 'Activar Barrido'
    },
    direction: {
      value: 'Der > Izq',
      options: ['Izq > Der', 'Der > Izq'],
      label: 'Dirección del Barrido'
    },
    minEmission: {
      value: 0.05,
      min: 0.0,
      max: 5.0,
      step: 0.05,
      label: 'Emisión Default (Base)'
    },
    maxEmission: {
      value: 8.0,
      min: 0.5,
      max: 50.0,
      step: 0.1,
      label: 'Emisión Máxima (Pico)'
    },
    spread: {
      value: 0.24,
      min: 0.05,
      max: 0.8,
      step: 0.02,
      label: 'Ancho de Onda (Spread)'
    },
    smoothing: {
      value: 8.0,
      min: 1.0,
      max: 20.0,
      step: 0.5,
      label: 'Suavizado (Smoothing)'
    }
  })

  // ── 8. Model Transform Controls ──────────────────────────────
  const modelControls = useControls('Modelo Manos (hands_skills.glb)', {
    position: {
      value: { x: 0, y: -0.12, z: 0.12 },
      step: 0.01,
      label: 'Posición'
    },
    rotation: {
      value: { x: 0, y: 0, z: 0 },
      step: 0.05,
      label: 'Rotación'
    },
    scale: {
      value: 1,
      min: 0.1,
      max: 5,
      step: 0.05,
      label: 'Escala'
    }
  })

  // ── 9. Table Top Model (table_top.glb) ───────────────────────
  const tableControls = useControls('Mesa (table_top.glb)', {
    position: {
      value: { x: 0, y: -0.90, z: -0.15 },
      step: 0.01,
      label: 'Posición'
    },
    rotation: {
      value: { x: 0, y: 1.60, z: 0 },
      step: 0.05,
      label: 'Rotación'
    },
    scale: {
      value: 1.0,
      min: 0.1,
      max: 5.0,
      step: 0.05,
      label: 'Escala'
    }
  })

  // ── 10. Sky Sphere Model (sky_sphere.glb) ────────────────────
  const skySphereControls = useControls('Esfera Celeste (sky_sphere.glb)', {
    visible: {
      value: true,
      label: 'Visible'
    },
    position: {
      value: { x: 0, y: 0, z: 0 },
      step: 0.1,
      label: 'Posición'
    },
    rotation: {
      value: { x: 0, y: 0, z: 0 },
      step: 0.02,
      label: 'Rotación'
    },
    scale: {
      value: 30.0,
      min: 0.5,
      max: 150.0,
      step: 0.5,
      label: 'Escala'
    },
    useColorAsEmission: {
      value: true,
      label: 'ColorMap como EmissionMap'
    },
    emissiveIntensity: {
      value: 2.9,
      min: 0.0,
      max: 10.0,
      step: 0.1,
      label: 'Intensidad Emisión'
    },
    side: {
      value: 'FrontSide',
      options: ['BackSide', 'DoubleSide', 'FrontSide'],
      label: 'Lado de Render (Side)'
    }
  })

  // ── 11. Rendimiento & Frustum Culling ────────────────────────
  const perfControls = useControls('Rendimiento & Frustum Culling', {
    enableFrustumCulling: {
      value: true,
      label: 'Frustum Culling Activo'
    },
    smoothRegression: {
      value: true,
      label: 'Regresión Suave (Lerp)'
    },
    minDpr: {
      value: 0.6,
      disabled: true,
      label: 'DPR Mínimo Base'
    },
    maxDpr: {
      value: 0.80,
      disabled: true,
      label: 'DPR Máximo Base'
    },
    lerpSpeed: {
      value: 8.5,
      min: 1.0,
      max: 10.0,
      step: 0.5,
      label: 'Velocidad Suavizado'
    }
  })

  // ── 12. Auditor de Rendimiento WebGPU (r3f-webgpu-perf) ─────
  const webgpuPerfControls = useControls('Auditor WebGPU (r3f-webgpu-perf)', {
    enabled: {
      value: false,
      label: 'Activar HUD Perf'
    },
    position: {
      value: 'bottom-left',
      options: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      label: 'Posición'
    },
    showGraph: {
      value: true,
      label: 'Gráfico Histórico'
    },
    showGauge: {
      value: true,
      label: 'Medidor Circular (Gauge)'
    },
    minimal: {
      value: true,
      label: 'Modo Minimal'
    },
    showVRAM: {
      value: true,
      label: 'Uso de VRAM'
    },
    openByDefault: {
      value: true,
      label: 'Abierto por Defecto'
    }
  })

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {/* ── Leva Controls Panel (Floating Theme) ───────────────── */}
      <Leva
        collapsed={false}
        oneLineLabels={false}
        titleBar={{ title: 'R3F WebGPU Studio • Controles' }}
        theme={{
          colors: {
            elevation1: 'rgba(10, 14, 23, 0.92)',
            elevation2: 'rgba(18, 24, 38, 0.95)',
            elevation3: 'rgba(28, 38, 58, 0.9)',
            accent1: '#38bdf8',
            accent2: '#0284c7',
            accent3: '#0ea5e9',
            highlight1: '#f8fafc',
            highlight2: '#94a3b8',
            highlight3: '#64748b'
          },
          radii: {
            xs: '4px',
            sm: '6px',
            lg: '8px'
          }
        }}
      />

      {/* ── 3D Native WebGPU / R3F Canvas ──────────────────────── */}
      <div className="canvas-container">
        <Canvas
          shadows="percentage"
          dpr={[perfControls.minDpr, perfControls.maxDpr]}
          performance={{ min: 0.5 }}
          camera={{
            position: [
              cameraControls.position.x,
              cameraControls.position.y,
              cameraControls.position.z
            ],
            fov: cameraControls.fov,
            near: cameraControls.near,
            far: cameraControls.far
          }}
          gl={async (props) => {
            const { WebGPURenderer } = await import('three/webgpu')
            const canvasEl = ((props as any)?.canvas ?? props) as unknown as HTMLCanvasElement
            const renderer = new WebGPURenderer({
              canvas: canvasEl,
              antialias: false,
              powerPreference: 'high-performance'
            })
            await renderer.init()
            return renderer
          }}
        >

          {/* Real GPU Shader pre-compiler: signals the hybrid loader once all materials are compiled */}
          <ShaderCompiler onCompiled={() => setShadersCompiled(true)} />

          {/* Conditional Background/Fog when Sky and SkySphere are disabled */}
          {!skyControls.enabled && !skySphereControls.visible && (
            <color attach="background" args={['#06080e']} />
          )}
          {!skyControls.enabled && !skySphereControls.visible && (
            <fog attach="fog" args={['#06080e', 4, 12]} />
          )}

          {/* Atmospheric Sky (Native WebGPU SkyMesh) */}
          {skyControls.enabled && !skySphereControls.visible && (
            <WebGPUSky
              distance={450000}
              sunPosition={sunPosition}
              turbidity={skyControls.turbidity}
              rayleigh={skyControls.rayleigh}
              mieCoefficient={skyControls.mieCoefficient}
              mieDirectionalG={skyControls.mieDirectionalG}
            />
          )}

          {/* Live WebGPU Performance Monitor (r3f-webgpu-perf) */}
          {webgpuPerfControls.enabled && (
            <Perf
              position={webgpuPerfControls.position as any}
              showGraph={webgpuPerfControls.showGraph}
              showGauge={webgpuPerfControls.showGauge}
              minimal={webgpuPerfControls.minimal}
              showVRAM={webgpuPerfControls.showVRAM}
              openByDefault={webgpuPerfControls.openByDefault}
            />
          )}

          {/* Smooth Adaptive DPR: continuous exponential lerp between min and max DPR on movement */}
          <SmoothAdaptiveDpr
            minDpr={perfControls.minDpr}
            maxDpr={perfControls.maxDpr}
            enabled={perfControls.smoothRegression}
            lerpSpeed={perfControls.lerpSpeed}
          />

          {/* Direct Camera Controller with Smooth Mouse Parallax */}
          <CameraController
            position={cameraControls.position}
            target={cameraControls.target}
            fov={cameraControls.fov}
            near={cameraControls.near}
            far={cameraControls.far}
            parallaxIntensity={cameraControls.parallaxIntensity}
          />

          {/* Camera Frustum Culling for static meshes and secondary lights */}
          <SceneFrustumCullingHelper
            enabled={perfControls.enableFrustumCulling}
            tableGroup={tableGroup}
            pointLight1={pointLight1Ref.current}
            pointLight2={pointLight2Ref.current}
          />

          {/* Directional Light + 2 Toggleable Point Lights */}
          <SceneLights
            intensity={directionalLightControls.intensity}
            color={directionalLightControls.color}
            castShadows={directionalLightControls.castShadows}
            lightPosition={[
              directionalLightControls.position.x,
              directionalLightControls.position.y,
              directionalLightControls.position.z
            ]}
            pointLight1={{
              enabled: pointLight1Controls.enabled,
              color: pointLight1Controls.color,
              intensity: pointLight1Controls.intensity,
              position: [
                pointLight1Controls.position.x,
                pointLight1Controls.position.y,
                pointLight1Controls.position.z
              ],
              distance: pointLight1Controls.distance
            }}
            pointLight2={{
              enabled: pointLight2Controls.enabled,
              color: pointLight2Controls.color,
              intensity: pointLight2Controls.intensity,
              position: [
                pointLight2Controls.position.x,
                pointLight2Controls.position.y,
                pointLight2Controls.position.z
              ],
              distance: pointLight2Controls.distance
            }}
            pointLight1Ref={pointLight1Ref}
            pointLight2Ref={pointLight2Ref}
            lightMotion={lightMotionControls}
          />

          {/* 3D Models & Postprocessing */}
          <Suspense fallback={null}>
            {/* Hands Model */}
            <HandsModel
              isPlaying={animControls.isPlaying}
              animationSpeed={animControls.animationSpeed}
              position={[
                modelControls.position.x,
                modelControls.position.y,
                modelControls.position.z
              ]}
              rotation={[
                modelControls.rotation.x,
                modelControls.rotation.y,
                modelControls.rotation.z
              ]}
              scale={modelControls.scale}
              glassProps={glassControls as any}
              tarotSweep={tarotSweepControls as any}
            />

            {/* Table Top Model */}
            <TableTopModel
              position={[
                tableControls.position.x,
                tableControls.position.y,
                tableControls.position.z
              ]}
              rotation={[
                tableControls.rotation.x,
                tableControls.rotation.y,
                tableControls.rotation.z
              ]}
              scale={tableControls.scale}
              onLoaded={(group) => setTableGroup(group)}
            />

            {/* Sky Sphere Model */}
            <SkySphereModel
              visible={skySphereControls.visible}
              position={[
                skySphereControls.position.x,
                skySphereControls.position.y,
                skySphereControls.position.z
              ]}
              rotation={[
                skySphereControls.rotation.x,
                skySphereControls.rotation.y,
                skySphereControls.rotation.z
              ]}
              scale={skySphereControls.scale}
              useColorAsEmission={skySphereControls.useColorAsEmission}
              emissiveIntensity={skySphereControls.emissiveIntensity}
              side={skySphereControls.side as any}
            />

            {/* 3D MSDF WebGPU Typography (r3f-webgpu-text) */}
            {textControls.visible && (
              <group
                position={[textControls.posX, textControls.posY, textControls.posZ]}
              >
                <WebGPUText
                  position={[0, 0, 0]}
                  fontSize={textControls.fontSize}
                  color={textControls.color}
                  letterSpacing={textControls.letterSpacing}
                  opacity={textControls.opacity}
                  anchorX="center"
                  anchorY="middle"
                >
                  {textControls.title}
                </WebGPUText>
                <WebGPUText
                  position={[0, -textControls.fontSize * 1.35, 0]}
                  fontSize={textControls.fontSize * 0.48}
                  color={textControls.subColor}
                  letterSpacing={textControls.letterSpacing * 1.5}
                  opacity={textControls.opacity * 0.85}
                  anchorX="center"
                  anchorY="middle"
                >
                  {textControls.subtitle}
                </WebGPUText>
              </group>
            )}

            {/* Native Three.js WebGPU Post-Processing Pipeline */}
            <PostProcessingPipeline
              bloomSettings={{
                enabled: postControls.bloomEnabled,
                strength: postControls.bloomStrength,
                radius: postControls.bloomRadius,
                threshold: postControls.bloomThreshold
              }}
              dofSettings={{
                enabled: postControls.dofEnabled,
                focus: postControls.dofFocus,
                aperture: postControls.dofAperture,
                maxblur: postControls.dofMaxBlur
              }}
              vignetteSettings={{
                enabled: postControls.vignetteEnabled,
                offset: postControls.vignetteOffset,
                darkness: postControls.vignetteDarkness
              }}
              toneMappingSettings={{
                mode: postControls.toneMappingMode as any,
                exposure: postControls.exposure
              }}
              fsrSettings={fsrControls as any}
              lutSettings={lutControls as any}
            />
          </Suspense>
        </Canvas>
      </div>

      {/* ── Robust Hybrid Loader ────────────────────────────────── */}
      <StudioLoader shadersCompiled={shadersCompiled} />
    </div>
  )
}
