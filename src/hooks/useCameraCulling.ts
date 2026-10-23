import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

export interface CullingOptions {
  enabled?: boolean
  throttleFrames?: number
  targets?: (THREE.Object3D | null | undefined)[]
  pointLights?: (THREE.PointLight | null | undefined)[]
}

// Reusable singletons to prevent per-frame garbage collection
const _projScreenMatrix = new THREE.Matrix4()
const _frustum = new THREE.Frustum()
const _sphere = new THREE.Sphere()

/**
 * Lightweight Camera Frustum Culling hook throttled every N frames.
 * Evaluates visibility for static meshes and secondary lights (PointLights)
 * to skip off-screen rendering and light tile passes on WebGPU/CPU.
 */
export function useCameraCulling({
  enabled = true,
  throttleFrames = 4,
  targets = [],
  pointLights = []
}: CullingOptions) {
  const frameCount = useRef(0)
  const camera = useThree((state) => state.camera)

  useFrame(() => {
    if (!enabled) return

    frameCount.current += 1
    // Throttling: evaluate every 4 frames (or throttleFrames)
    if (frameCount.current % throttleFrames !== 0) return

    // Update frustum from current camera state
    _projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    _frustum.setFromProjectionMatrix(_projScreenMatrix)

    // 1. Evaluate mesh visibility
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      if (!target) continue

      target.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh
          if (mesh.geometry) {
            if (!mesh.geometry.boundingSphere) {
              mesh.geometry.computeBoundingSphere()
            }
            if (mesh.geometry.boundingSphere) {
              _sphere.copy(mesh.geometry.boundingSphere).applyMatrix4(mesh.matrixWorld)
              mesh.visible = _frustum.intersectsSphere(_sphere)
            }
          }
        }
      })
    }

    // 2. Evaluate secondary PointLight bounds
    for (let i = 0; i < pointLights.length; i++) {
      const light = pointLights[i]
      if (!light) continue

      const radius = light.distance > 0 ? light.distance : 3.5
      _sphere.set(light.position, radius)
      const inFrustum = _frustum.intersectsSphere(_sphere)

      if (light.visible !== inFrustum) {
        light.visible = inFrustum
      }
    }
  })
}
