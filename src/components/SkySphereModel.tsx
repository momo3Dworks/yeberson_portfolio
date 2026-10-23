import React, { useMemo, useEffect, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { configureGLTFLoader, ensureWebGPUGeometry } from '../utils/gltfLoaders'

export interface SkySphereProps {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
  visible?: boolean
  useColorAsEmission?: boolean
  emissiveIntensity?: number
  side?: 'BackSide' | 'DoubleSide' | 'FrontSide'
}

const MODEL_PATH = '/models/sky_sphere.glb'

/**
 * WebGPU-optimized SkySphere component.
 * Uses MeshBasicNodeMaterial with BackSide and disabled shadows to eliminate
 * redundant fragment light evaluations on the background dome.
 */
export const SkySphereModel: React.FC<SkySphereProps> = ({
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = 30,
  visible = true,
  useColorAsEmission = true,
  emissiveIntensity = 1.0,
  side = 'BackSide'
}) => {
  const groupRef = useRef<THREE.Group>(null)
  const gl = useThree((state) => state.gl)
  const basicMatRef = useRef<MeshBasicNodeMaterial | null>(null)

  // Configure useGLTF with singleton loaders
  const { scene } = useGLTF(
    MODEL_PATH,
    true,
    true,
    (loader) => {
      configureGLTFLoader(loader as any, gl)
    }
  )

  useMemo(() => {
    // Ensure WebGPU 4-byte attribute alignment
    ensureWebGPUGeometry(scene)
  }, [scene])

  useEffect(() => {

    const selectedSide =
      side === 'BackSide'
        ? THREE.BackSide
        : side === 'FrontSide'
        ? THREE.FrontSide
        : THREE.DoubleSide

    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.castShadow = false
        mesh.receiveShadow = false
        mesh.frustumCulled = false
        mesh.renderOrder = -1000

        if (mesh.material) {
          const originalMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
          const textureMap =
            (originalMat as any).emissiveMap ||
            (originalMat as any).map ||
            basicMatRef.current?.map

          if (!basicMatRef.current) {
            basicMatRef.current = new MeshBasicNodeMaterial({
              map: textureMap,
              side: selectedSide,
              depthWrite: false,
              fog: false,
              toneMapped: false
            })
          }

          basicMatRef.current.side = selectedSide
          basicMatRef.current.fog = false
          basicMatRef.current.depthWrite = false
          if (textureMap && basicMatRef.current.map !== textureMap) {
            basicMatRef.current.map = textureMap
          }

          // Modulate brightness/intensity directly through base color on WebGPU
          const factor = useColorAsEmission ? Math.max(emissiveIntensity, 0.0) : 1.0
          basicMatRef.current.color.setRGB(factor, factor, factor)
          basicMatRef.current.needsUpdate = true

          mesh.material = basicMatRef.current
        }
      }
    })
  }, [scene, useColorAsEmission, emissiveIntensity, side])

  if (!visible) return null

  return (
    <group
      ref={groupRef}
      dispose={null}
      position={position}
      rotation={rotation}
      scale={typeof scale === 'number' ? [scale, scale, scale] : scale}
    >
      <primitive object={scene} />
    </group>
  )
}

useGLTF.preload(MODEL_PATH)
