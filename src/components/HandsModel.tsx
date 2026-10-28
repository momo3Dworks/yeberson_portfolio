import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react'
import { useGLTF, useAnimations } from '@react-three/drei'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { configureGLTFLoader, ensureWebGPUGeometry } from '../utils/gltfLoaders'
import { createGlass } from '../glass/create-glass.js'
import { updateGlass, GlassSettings } from '../glass/update-glass'
import { captureTransmissionBackdrop } from '../glass/transmissionBackdrop.js'
import {
  TAROT_SECTIONS,
  TarotSectionConfig,
  frameToSeconds,
  secondsToFrame,
  quantizeTimeToFps,
  BLENDER_EXPORT_FPS
} from '../config/tarotSections'

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

export interface HandsModelProps {
  isPlaying?: boolean
  animationSpeed?: number
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
  glassProps?: GlassMaterialProps
  tarotSweep?: TarotSweepProps
  // ── Tarot Navigation via 'AllCards' ──────────────────────
  sections?: TarotSectionConfig[]
  activeStep?: number
  onStepChange?: (step: number, section: TarotSectionConfig | null) => void
  enableScrollNavigation?: boolean
  smoothSpeed?: number
  /** Si está activo, cuantiza los fotogramas de la animación a targetFps exactos (estilo cinematográfico 30 FPS) */
  quantizeFps?: boolean
  /** FPS de referencia para la línea de tiempo y cuantización (por defecto 30 FPS) */
  targetFps?: number
  /** Modo de transición entre pasos: 'smooth' (curva controlada), 'linear' (velocidad constante), 'spring' (elástico) */
  transitionMode?: 'smooth' | 'linear' | 'spring'
  /** Modo de reproducción: 'step-snap' (snap entre cartas) o 'continuous' (reproducción continua libre) */
  playMode?: 'step-snap' | 'continuous'
  onModelLoaded?: (info: { animations: string[]; nodeCount: number }) => void
}

interface CardMaterialItem {
  index: number
  name: string
  mesh: THREE.Mesh
  material: THREE.MeshStandardMaterial
}

const MODEL_PATH = '/models/hands_skills_compressed.glb'

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
 * WebGPU HandsModel using Anderson Mancini's (ektogamat/r3f-alpha-6) Glass Transmission,
 * interactive Tarot cards emission sweep, and step-based scroll snapping for 'AllCards'.
 */
export const HandsModel: React.FC<HandsModelProps> = ({
  isPlaying = true,
  animationSpeed = 1.0,
  position = [0, -0.05, 0],
  rotation = [0, 0, 0],
  scale = 1,
  glassProps,
  tarotSweep,
  sections = TAROT_SECTIONS,
  activeStep: activeStepProp,
  onStepChange,
  enableScrollNavigation = true,
  smoothSpeed = 4.5,
  quantizeFps = false,
  targetFps = 30,
  transitionMode = 'smooth',
  playMode = 'step-snap',
  onModelLoaded
}) => {
  const groupRef = useRef<THREE.Group>(null)
  const { gl, scene: rootScene, camera } = useThree()

  // Track the 6 Tarot card meshes and materials
  const cardsRef = useRef<CardMaterialItem[]>([])
  const cardEmissions = useRef<number[]>([0.05, 0.05, 0.05, 0.05, 0.05, 0.05])

  // ── Tarot Step State & Playback Timeline Refs ───────────────
  const [internalStep, setInternalStep] = useState<number>(activeStepProp ?? 0)
  const currentStepRef = useRef<number>(activeStepProp ?? 0)
  const currentTimeRef = useRef<number>(frameToSeconds(1, BLENDER_EXPORT_FPS))
  const targetTimeRef = useRef<number>(frameToSeconds(1, BLENDER_EXPORT_FPS))
  const startTransitionTimeRef = useRef<number>(frameToSeconds(1, BLENDER_EXPORT_FPS))
  const transitionProgressRef = useRef<number>(1.0)
  const transitionDurationRef = useRef<number>(1.0)
  const isTransitioningRef = useRef<boolean>(false)
  const gestureCooldownRef = useRef<boolean>(false)
  const cooldownTimerRef = useRef<any>(null)
  const prevActiveStepPropRef = useRef<number | undefined>(activeStepProp)

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

  // Hook into animations and Drei mixer
  const { actions, names, mixer } = useAnimations(animations, groupRef)

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

  // Helper to change step and compute target frame / time
  const goToStep = useCallback(
    (newStep: number) => {
      const clamped = Math.max(0, Math.min(newStep, sections.length))
      // If already at this step and finished transitioning, do not lock and return
      if (clamped === currentStepRef.current && !isTransitioningRef.current) {
        gestureCooldownRef.current = false
        return
      }

      currentStepRef.current = clamped
      setInternalStep(clamped)

      // Target Frame logic:
      // Step 0 -> startFrame of section 0 (Frame 1) -> Reposo inicial en 'AllCards'
      // Step 1 -> endFrame of section 0 (Frame 62)  -> Carta #1: "VI - CREATIVE DEVELOPER"
      // Step 2 -> endFrame of section 1 (Frame 122) -> Carta #2: "V - CREATIVE DIRECTOR"
      const targetFrame =
        clamped === 0 ? (sections[0]?.startFrame ?? 1) : sections[clamped - 1].endFrame

      const newTargetTime = frameToSeconds(targetFrame, BLENDER_EXPORT_FPS)
      startTransitionTimeRef.current = currentTimeRef.current
      targetTimeRef.current = newTargetTime
      transitionProgressRef.current = 0.0

      const distance = Math.abs(newTargetTime - currentTimeRef.current)
      transitionDurationRef.current = distance > 0.0001 ? distance : 0.0001
      isTransitioningRef.current = distance > 0.0001
      gestureCooldownRef.current = true

      const activeSec = clamped > 0 ? (sections[clamped - 1] ?? null) : null
      onStepChange?.(clamped, activeSec)
    },
    [sections, onStepChange]
  )

  // Sync when activeStep prop changes from parent (e.g. Leva or UI buttons)
  useEffect(() => {
    if (activeStepProp !== undefined && activeStepProp !== prevActiveStepPropRef.current) {
      prevActiveStepPropRef.current = activeStepProp
      goToStep(activeStepProp)
    }
  }, [activeStepProp, goToStep])

  // ── Scroll, Keyboard & Touch Snap Navigation ────────────────
  useEffect(() => {
    if (!enableScrollNavigation) return

    let accumulatedDelta = 0
    let resetTimer: any = null

    const WHEEL_THRESHOLD = 40

    const handleWheel = (e: WheelEvent) => {
      // Do not hijack scroll if interacting with Leva GUI panel
      const targetEl = e.target as HTMLElement | null
      if (targetEl && targetEl.closest('.leva-c, [class*="leva"]')) {
        return
      }

      // If animation is currently transitioning OR in cooldown, completely discard delta
      if (isTransitioningRef.current || gestureCooldownRef.current) {
        accumulatedDelta = 0
        return
      }

      accumulatedDelta += e.deltaY

      if (resetTimer) clearTimeout(resetTimer)
      resetTimer = setTimeout(() => {
        accumulatedDelta = 0
      }, 150)

      if (accumulatedDelta >= WHEEL_THRESHOLD) {
        accumulatedDelta = 0
        gestureCooldownRef.current = true
        goToStep(currentStepRef.current + 1)
      } else if (accumulatedDelta <= -WHEEL_THRESHOLD) {
        accumulatedDelta = 0
        gestureCooldownRef.current = true
        goToStep(currentStepRef.current - 1)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      if (isTransitioningRef.current || gestureCooldownRef.current) return

      if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        gestureCooldownRef.current = true
        goToStep(currentStepRef.current + 1)
      } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
        e.preventDefault()
        gestureCooldownRef.current = true
        goToStep(currentStepRef.current - 1)
      }
    }

    let touchStartY = 0
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) touchStartY = e.touches[0].clientY
    }
    const handleTouchEnd = (e: TouchEvent) => {
      if (isTransitioningRef.current || gestureCooldownRef.current) return
      if (e.changedTouches.length > 0) {
        const deltaY = touchStartY - e.changedTouches[0].clientY
        if (Math.abs(deltaY) > 40) {
          gestureCooldownRef.current = true
          if (deltaY > 0) {
            goToStep(currentStepRef.current + 1)
          } else {
            goToStep(currentStepRef.current - 1)
          }
        }
      }
    }

    window.addEventListener('wheel', handleWheel, { passive: true })
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchend', handleTouchEnd)
      if (resetTimer) clearTimeout(resetTimer)
      if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
    }
  }, [enableScrollNavigation, goToStep])

  // Synchronize dynamic glass settings and capture backdrop before rendering
  useFrame((state, delta) => {
    // Guard against zero-sized canvas during resize, orientation change, or initial layout
    if (state.size.width <= 0 || state.size.height <= 0) return

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

    // ── Smooth Timeline Scrubbing & Snapping for 'AllCards' ──
    if (isPlaying) {
      const dt = Math.min(delta, 0.1)
      const speed = Math.max(animationSpeed || 1.0, 0.001)

      if (playMode === 'continuous') {
        const minTime = frameToSeconds(sections[0]?.startFrame ?? 1, BLENDER_EXPORT_FPS)
        const maxTime = frameToSeconds(
          sections[sections.length - 1]?.endFrame ?? 122,
          BLENDER_EXPORT_FPS
        )
        const duration = Math.max(maxTime - minTime, 0.1)
        let nextTime = currentTimeRef.current + dt * speed
        if (nextTime > maxTime) {
          nextTime = minTime + ((nextTime - minTime) % duration)
        }
        currentTimeRef.current = nextTime
      } else {
        // Step-snap mode
        const tgt = targetTimeRef.current

        if (isTransitioningRef.current) {
          const stepDuration = transitionDurationRef.current
          const progressIncrement = (dt * speed) / stepDuration
          transitionProgressRef.current = Math.min(
            1.0,
            transitionProgressRef.current + progressIncrement
          )
          const p = transitionProgressRef.current

          let easedProgress = p
          if (transitionMode === 'linear') {
            easedProgress = p
          } else {
            // Smoothstep curve: silky smooth start, steady middle, and gentle smooth deceleration ("frenar smooth")
            easedProgress = p * p * (3 - 2 * p)
          }

          currentTimeRef.current = THREE.MathUtils.lerp(
            startTransitionTimeRef.current,
            tgt,
            easedProgress
          )

          if (p >= 1.0) {
            currentTimeRef.current = tgt
            isTransitioningRef.current = false

            // Set a short quiet cooldown (280ms) after settling to discard any lingering inertial wheel events
            if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current)
            cooldownTimerRef.current = setTimeout(() => {
              gestureCooldownRef.current = false
            }, 280)
          }
        } else {
          // Completely settled at target snap frame
          currentTimeRef.current = tgt
        }
      }

      const finalTime = currentTimeRef.current
      // Quantize time to targetFps if quantizeFps is enabled (e.g. 30 FPS stop-motion/cinematic feel)
      const displayTime = quantizeFps ? quantizeTimeToFps(finalTime, targetFps) : finalTime

      // Action scrubbing: ONLY 'AllCards' at 100% weight, identical to Blender and external glTF viewers
      const actionAllCards = actions['AllCards']

      if (actionAllCards) {
        actionAllCards.time = displayTime
        actionAllCards.setEffectiveWeight(1.0)
      }

      // Force the mixer to re-evaluate bone transforms on this exact frame.
      // Guarantees zero-lag evaluation of bone and skinned mesh positions.
      mixer.update(0)
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

      const cardCount = 6
      const smoothSpeedParam = smoothing

      for (let i = 0; i < cardsRef.current.length; i++) {
        const item = cardsRef.current[i]
        const cardIndex = item.index

        let targetEmission = minEmission

        if (enabled) {
          // Normalized center of each card along [0, 1] axis aligned with direction
          const cardCenter =
            direction === 'Izq > Der'
              ? (cardIndex + 0.5) / cardCount
              : (cardCount - 1 - cardIndex + 0.5) / cardCount

          const sweepPos = direction === 'Izq > Der' ? pointerNorm : 1.0 - pointerNorm
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
          smoothSpeedParam,
          delta
        )

        const currentIntensity = cardEmissions.current[cardIndex]

        // Update emissive Color (direct uniform reference in Three.js WebGPU) AND emissiveIntensity
        item.material.emissive.setRGB(currentIntensity, currentIntensity, currentIntensity)
        item.material.emissiveIntensity = currentIntensity
      }
    }
  }, -1)

  // ── Animation Initialization ('AllCards' timeline) ─
  useEffect(() => {
    // Desestimar cualquier otra acción en el modelo para asegurar exclusividad total a 'AllCards'
    Object.keys(actions).forEach((key) => {
      if (key !== 'AllCards') {
        actions[key]?.stop()
      }
    })

    const actionAllCards = actions['AllCards']

    if (actionAllCards) {
      actionAllCards.reset().play()
      actionAllCards.paused = true
      actionAllCards.setLoop(THREE.LoopOnce, 1)
      actionAllCards.clampWhenFinished = true
      // Inicia en reposo absoluto en el Frame 1 esperando la interacción del usuario
      actionAllCards.time = frameToSeconds(sections[0]?.startFrame ?? 1, BLENDER_EXPORT_FPS)
      actionAllCards.setEffectiveWeight(1.0)
      mixer.update(0)
    }

    if (onModelLoaded) {
      let nodeCount = 0
      modelScene.traverse(() => nodeCount++)
      onModelLoaded({ animations: names, nodeCount })
    }

    // Expose devtools navigator for testing
    ; (window as any).__TAROT_NAV = {
      getStep: () => currentStepRef.current,
      goToStep,
      getFrame: () => secondsToFrame(currentTimeRef.current, BLENDER_EXPORT_FPS),
      getTime: () => currentTimeRef.current,
      sections
    }

    return () => {
      actionAllCards?.fadeOut(0.3)
    }
  }, [actions, names, modelScene, goToStep, sections, onModelLoaded, mixer])

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
      ; (window as any).__TAROT_CARDS = cardItems
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
