import React, { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

export interface PointLightConfig {
  enabled: boolean
  color: string
  intensity: number
  position: [number, number, number]
  distance: number
}

export interface LightMotionConfig {
  enabled: boolean
  smoothing: number
  dirLightXOffset: number
  dirLightYOffset: number
  point1XOffset: number
  point1YOffset: number
  point2XOffset: number
  point2YOffset: number
  invertDirection: boolean
}

interface SceneLightsProps {
  intensity: number
  color: string
  castShadows: boolean
  lightPosition: [number, number, number]
  pointLight1: PointLightConfig
  pointLight2: PointLightConfig
  pointLight1Ref?: React.Ref<THREE.PointLight>
  pointLight2Ref?: React.Ref<THREE.PointLight>
  lightMotion?: LightMotionConfig
}

export const SceneLights: React.FC<SceneLightsProps> = ({
  intensity,
  color,
  castShadows,
  lightPosition,
  pointLight1,
  pointLight2,
  pointLight1Ref,
  pointLight2Ref,
  lightMotion
}) => {
  const dirLightRef = useRef<THREE.DirectionalLight>(null)
  const internalPoint1Ref = useRef<THREE.PointLight | null>(null)
  const internalPoint2Ref = useRef<THREE.PointLight | null>(null)

  // Accumulated smooth offsets for each light
  const currentOffsets = useRef({
    dirX: 0,
    dirY: 0,
    p1X: 0,
    p1Y: 0,
    p2X: 0,
    p2Y: 0
  })

  useFrame((state, delta) => {
    if (!lightMotion || !lightMotion.enabled) {
      // Restore default static positions if light motion is disabled
      if (dirLightRef.current) {
        dirLightRef.current.position.set(lightPosition[0], lightPosition[1], lightPosition[2])
      }
      if (internalPoint1Ref.current) {
        internalPoint1Ref.current.position.set(
          pointLight1.position[0],
          pointLight1.position[1],
          pointLight1.position[2]
        )
      }
      if (internalPoint2Ref.current) {
        internalPoint2Ref.current.position.set(
          pointLight2.position[0],
          pointLight2.position[1],
          pointLight2.position[2]
        )
      }
      return
    }

    const mult = lightMotion.invertDirection ? -1 : 1
    const targetDirX = state.pointer.x * lightMotion.dirLightXOffset * mult
    const targetDirY = state.pointer.y * lightMotion.dirLightYOffset * mult

    const targetP1X = state.pointer.x * lightMotion.point1XOffset * mult
    const targetP1Y = state.pointer.y * lightMotion.point1YOffset * mult

    // Point Light 2 moves in complementary offset phase for dynamic specular depth
    const targetP2X = state.pointer.x * -lightMotion.point2XOffset * mult
    const targetP2Y = state.pointer.y * lightMotion.point2YOffset * mult

    const speed = lightMotion.smoothing

    currentOffsets.current.dirX = THREE.MathUtils.damp(
      currentOffsets.current.dirX,
      targetDirX,
      speed,
      delta
    )
    currentOffsets.current.dirY = THREE.MathUtils.damp(
      currentOffsets.current.dirY,
      targetDirY,
      speed,
      delta
    )

    currentOffsets.current.p1X = THREE.MathUtils.damp(
      currentOffsets.current.p1X,
      targetP1X,
      speed,
      delta
    )
    currentOffsets.current.p1Y = THREE.MathUtils.damp(
      currentOffsets.current.p1Y,
      targetP1Y,
      speed,
      delta
    )

    currentOffsets.current.p2X = THREE.MathUtils.damp(
      currentOffsets.current.p2X,
      targetP2X,
      speed,
      delta
    )
    currentOffsets.current.p2Y = THREE.MathUtils.damp(
      currentOffsets.current.p2Y,
      targetP2Y,
      speed,
      delta
    )

    if (dirLightRef.current) {
      dirLightRef.current.position.set(
        lightPosition[0] + currentOffsets.current.dirX,
        lightPosition[1] + currentOffsets.current.dirY,
        lightPosition[2]
      )
    }

    if (internalPoint1Ref.current) {
      internalPoint1Ref.current.position.set(
        pointLight1.position[0] + currentOffsets.current.p1X,
        pointLight1.position[1] + currentOffsets.current.p1Y,
        pointLight1.position[2]
      )
    }

    if (internalPoint2Ref.current) {
      internalPoint2Ref.current.position.set(
        pointLight2.position[0] + currentOffsets.current.p2X,
        pointLight2.position[1] + currentOffsets.current.p2Y,
        pointLight2.position[2]
      )
    }
  })

  return (
    <>
      {/* Ambient Fill Light */}
      <ambientLight intensity={0.25} color="#e2e8f0" />

      {/* Main Key Directional Light */}
      <directionalLight
        ref={dirLightRef}
        position={lightPosition}
        intensity={intensity}
        color={color}
        castShadow={castShadows}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-1.5}
        shadow-camera-right={1.5}
        shadow-camera-top={1.5}
        shadow-camera-bottom={-1.5}
        shadow-camera-near={0.1}
        shadow-camera-far={10}
        shadow-bias={-0.00015}
        shadow-normalBias={0.025}
      />

      {/* Subtle Cyan/Blue Backlight / Rim light for depth */}
      <directionalLight
        position={[-3, 2, -3]}
        intensity={intensity * 0.4}
        color="#38bdf8"
      />

      {/* ── Point Light 1 (Warm, animated with cursor) ── */}
      {pointLight1.enabled && (
        <pointLight
          ref={(node) => {
            internalPoint1Ref.current = node
            if (typeof pointLight1Ref === 'function') pointLight1Ref(node)
            else if (pointLight1Ref) (pointLight1Ref as any).current = node
          }}
          position={pointLight1.position}
          intensity={pointLight1.intensity}
          color={pointLight1.color}
          distance={pointLight1.distance}
          decay={2}
        />
      )}

      {/* ── Point Light 2 (Cool, animated with cursor) ── */}
      {pointLight2.enabled && (
        <pointLight
          ref={(node) => {
            internalPoint2Ref.current = node
            if (typeof pointLight2Ref === 'function') pointLight2Ref(node)
            else if (pointLight2Ref) (pointLight2Ref as any).current = node
          }}
          position={pointLight2.position}
          intensity={pointLight2.intensity}
          color={pointLight2.color}
          distance={pointLight2.distance}
          decay={2}
        />
      )}
    </>
  )
}
