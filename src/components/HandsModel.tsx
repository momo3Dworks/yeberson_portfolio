import React, { useEffect, useRef, useMemo } from 'react'
import { useGLTF, useAnimations } from '@react-three/drei'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { configureGLTFLoader, ensureWebGPUGeometry } from '../utils/gltfLoaders'
import { createGlass } from '../glass/create-glass.js'
import { updateGlass, GlassSettings } from '../glass/update-glass'
import { captureTransmissionBackdrop } from '../glass/transmissionBackdrop.js'

export interface GlassMaterialProps {
  transmission?: number
  thickness?: number
  backsideThickness?: number
  roughness?: number
  ior?: number
  dispersion?: number
  distortion?: number
  distortionScale?: number
  temporalDistortion?: number
  anisotropicBlur?: number
  color?: string
  attenuationColor?: string
  attenuationDistance?: number
  clearcoat?: number
  clearcoatRoughness?: number
  iridescence?: number
  depthWrite?: boolean
  backside?: boolean
  side?: 'DoubleSide' | 'FrontSide' | 'BackSide'
  reflections?: number
}

export interface TarotSweepProps {
  enabled: boolean
  direction: 'Izq > Der' | 'Der > Izq'
  minEmission: number
  maxEmission: number
  spread: number
  smoothing: number
}

interface HandsModelProps {
  isPlaying: boolean
  animationSpeed: number
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
  glassProps?: GlassMaterialProps
  tarotSweep?: TarotSweepProps
  onModelLoaded?: (info: { animations: string[]; nodeCount: number }) => void
}

interface CardMaterialItem {
  index: number
  name: string
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
}

const MODEL_PATH = '/models/hands_skills.glb'

function getCardIndex(meshName: string, matName: string, parentName?: string): number {
  const combined = `${meshName} ${matName} ${parentName || ''}`.toLowerCase()

  if (combined.includes('creativedev')) return 0
  if (combined.includes('creativedirector')) return 1
  if (combined.includes('animat')) return 2
  if (combined.includes('artist')) return 3
  if (combined.includes('ux')) return 4
  if (combined.includes('vector')) return 5

  return -1
}

/**
 * WebGPU HandsModel using Anderson Mancini's (ektogamat/r3f-alpha-6) Glass Transmission
 * and interactive Tarot cards emission sweep.
 */
export const HandsModel: React.FC<HandsModelProps> = ({
  isPlaying,
  animationSpeed,
  position = [0, -0.05, 0],
  rotation = [0, 0, 0],
  scale = 1,
  glassProps,
  tarotSweep,
  onModelLoaded
}) => {
  const groupRef = useRef<THREE.Group>(null)
  const { gl, scene: rootScene, camera } = useThree()

  // Track the 6 Tarot card meshes and materials
  const cardsRef = useRef<CardMaterialItem[]>([])
  const cardEmissions = useRef<number[]>([0.05, 0.05, 0.05, 0.05, 0.05, 0.05])

  // Configure useGLTF with singleton loaders
  const { scene: modelScene, animations } = useGLTF(
    MODEL_PATH,
    true,
    true,
    (loader) => {
      configureGLTFLoader(loader as any, gl)
    }
  )

  // Ensure vertex buffer attributes adhere to WebGPU 4-byte stride requirements
  useMemo(() => {
    ensureWebGPUGeometry(modelScene)
  }, [modelScene])

  // Hook into animations
  const { actions, names } = useAnimations(animations, groupRef)

  // Initialize ektogamat's WebGPU Glass Material system
  const glass = useMemo(() => {
    return createGlass(gl, rootScene, camera)
  }, [gl, rootScene, camera])

  // Cleanup material and manager registration on unmount
  useEffect(() => {
    return () => {
      glass.dispose()
    }
  }, [glass])

  // Synchronize dynamic glass settings and capture backdrop before rendering
  useFrame((state, delta) => {
    const time = state.clock.getElapsedTime()

    if (glass) {
      const settings: GlassSettings = {
        ior: glassProps?.ior ?? 1.5,
        thickness: glassProps?.thickness ?? 0.45,
        reflections: glassProps?.reflections ?? 0.85,
        glassTint: glassProps?.color ?? '#99f7ff',
        roughness: glassProps?.roughness ?? 0.02,
        dispersion: glassProps?.dispersion ?? 2.5,
        distortion: glassProps?.distortion ?? 0.015,
        backside: glassProps?.backside ?? true,
        backsideThickness: glassProps?.backsideThickness ?? glassProps?.thickness ?? 0.45,
        anisotropicBlur: glassProps?.anisotropicBlur ?? 0.015,
        distortionScale: glassProps?.distortionScale ?? 0.007,
        temporalDistortion: glassProps?.temporalDistortion ?? 0,
        attenuationDistance: glassProps?.attenuationDistance ?? 0.85,
        attenuationColor: glassProps?.attenuationColor ?? '#fffb6c',
        clearcoat: glassProps?.clearcoat ?? 1.0,
        clearcoatRoughness: glassProps?.clearcoatRoughness ?? 0.08,
        iridescence: glassProps?.iridescence ?? 0.35,
        depthWrite: glassProps?.depthWrite ?? false
      }

      updateGlass(glass, settings, time)

      if (glass.material) {
        glass.material.depthWrite = glassProps?.depthWrite ?? false
        glass.material.side =
          glassProps?.side === 'FrontSide'
            ? THREE.FrontSide
            : glassProps?.side === 'BackSide'
            ? THREE.BackSide
            : THREE.DoubleSide
      }

      // Capture transmission backdrop before main render / post-processing pass
      captureTransmissionBackdrop(state.gl, state.scene, state.camera, time)
    }

    // ── Progressive Tarot Cards Emission Sweep ─────────────────
    if (cardsRef.current.length > 0 && tarotSweep) {
      const {
        enabled = true,
        direction = 'Izq > Der',
        minEmission = 0.05,
        maxEmission = 15.0,
        spread = 0.22,
        smoothing = 8.0
      } = tarotSweep

      // Map pointer.x from screen range [-0.75, 0.75] to normalized [0, 1]
      const sweepRangeMin = -0.75
      const sweepRangeMax = 0.75
      const pointerNorm = THREE.MathUtils.clamp(
        (state.pointer.x - sweepRangeMin) / (sweepRangeMax - sweepRangeMin),
        0,
        1
      )

      // Sweep position:
      // 'Izq > Der': cursor left (0) illuminates card 0; moving right (1) sweeps to card 5
      // 'Der > Izq': cursor left (0) illuminates card 5; moving right (1) sweeps to card 0
      const sweepPos = direction === 'Izq > Der' ? pointerNorm : 1.0 - pointerNorm

      const cardCount = 6
      const smoothSpeed = smoothing

      for (let i = 0; i < cardsRef.current.length; i++) {
        const item = cardsRef.current[i]
        const cardIndex = item.index

        let targetEmission = minEmission

        if (enabled) {
          // Normalized center of each card along [0, 1] axis
          const cardCenter = (cardIndex + 0.5) / cardCount
          const dist = Math.abs(sweepPos - cardCenter)

          if (dist < spread) {
            const factor = 1.0 - dist / spread
            // Hermite cubic smoothstep: 3x^2 - 2x^3 for a silky-smooth wave peak
            const smoothFactor = factor * factor * (3.0 - 2.0 * factor)
            targetEmission = minEmission + (maxEmission - minEmission) * smoothFactor
          }
        }

        // Smooth continuous damping
        cardEmissions.current[cardIndex] = THREE.MathUtils.damp(
          cardEmissions.current[cardIndex] ?? minEmission,
          targetEmission,
          smoothSpeed,
          delta
        )

        const currentIntensity = cardEmissions.current[cardIndex]

        // Update emissive Color (direct uniform reference in Three.js WebGPU) AND emissiveIntensity
        item.material.emissive.setRGB(currentIntensity, currentIntensity, currentIntensity)
        item.material.emissiveIntensity = currentIntensity
      }
    }
  }, -1)

  // Default Action: '1stPose'
  useEffect(() => {
    const targetActionName = names.includes('1stPose') ? '1stPose' : names[0]
    const action = actions[targetActionName]

    if (action) {
      action.reset().fadeIn(0.4)
      if (isPlaying) {
        action.play()
        action.paused = false
      } else {
        action.play()
        action.paused = true
      }
      action.setEffectiveTimeScale(animationSpeed)
    }

    if (onModelLoaded) {
      let nodeCount = 0
      modelScene.traverse(() => nodeCount++)
      onModelLoaded({ animations: names, nodeCount })
    }

    return () => {
      action?.fadeOut(0.3)
    }
  }, [actions, names, modelScene])

  // Animation play/pause & speed
  useEffect(() => {
    const targetActionName = names.includes('1stPose') ? '1stPose' : names[0]
    const action = actions[targetActionName]
    if (action) {
      action.paused = !isPlaying
      action.setEffectiveTimeScale(animationSpeed)
    }
  }, [isPlaying, animationSpeed, actions, names])

  // Setup materials: glass for hands, configure emission for 6 tarot cards
  useEffect(() => {
    const cardItems: CardMaterialItem[] = []
    const detectedIndices = new Set<number>()

    modelScene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh

        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          const isHands =
            mesh.name === 'hands' ||
            mesh.name.toLowerCase().includes('hand') ||
            mats.some((m) => m && (m.name === 'hands' || m.name === 'hands_glass'))

          if (isHands) {
            mesh.castShadow = false
            mesh.receiveShadow = false
            mesh.renderOrder = 10
            if (glass?.material) {
              mesh.material = glass.material
            }
          } else {
            mesh.castShadow = true
            mesh.receiveShadow = true
            mats.forEach((mat) => {
              const stdMat = mat as THREE.MeshStandardMaterial
              if (stdMat.roughness !== undefined) {
                stdMat.roughness = Math.min(Math.max(stdMat.roughness ?? 0.4, 0.15), 0.85)
              }

              const cardIdx = getCardIndex(mesh.name, stdMat.name || '', mesh.parent?.name)
              if (cardIdx !== -1 && !detectedIndices.has(cardIdx)) {
                detectedIndices.add(cardIdx)

                // Clone material to ensure 100% independent uniforms per card in Three.js WebGPU
                const clonedMat = stdMat.clone() as THREE.MeshStandardMaterial
                mesh.material = clonedMat

                // Set initial base emission to minEmission so cards don't start at blown out 1.0 (#ffffff)
                const initEmission = tarotSweep?.minEmission ?? 0.05
                clonedMat.emissive.setRGB(initEmission, initEmission, initEmission)
                clonedMat.emissiveIntensity = initEmission

                // Fallback to diffuse map if emissiveMap isn't populated
                if (!clonedMat.emissiveMap && clonedMat.map) {
                  clonedMat.emissiveMap = clonedMat.map
                }
                clonedMat.needsUpdate = true

                cardItems.push({
                  index: cardIdx,
                  name: mesh.name,
                  mesh: mesh,
                  material: clonedMat
                })
              }
            })
          }
        }
      }
    })

    cardItems.sort((a, b) => a.index - b.index)
    console.log(
      '[HandsModel] Configured Tarot cards for emission sweep:',
      cardItems.map((c) => ({
        idx: c.index,
        mesh: c.name,
        mat: c.material.name,
        emissiveHex: c.material.emissive.getHexString()
      }))
    )
    cardsRef.current = cardItems
    ;(window as any).__TAROT_CARDS = cardItems
  }, [modelScene, glass])

  return (
    <group
      ref={groupRef}
      dispose={null}
      position={position}
      rotation={rotation}
      scale={scale}
    >
      <primitive object={modelScene} />
    </group>
  )
}

useGLTF.preload(MODEL_PATH)
