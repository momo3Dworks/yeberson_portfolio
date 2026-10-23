import React, { useMemo, useRef } from 'react'
import { useGLTF } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { configureGLTFLoader, ensureWebGPUGeometry } from '../utils/gltfLoaders'

interface TableTopModelProps {
  position?: [number, number, number]
  rotation?: [number, number, number]
  scale?: number | [number, number, number]
  onLoaded?: (group: THREE.Group) => void
}

const MODEL_PATH = '/models/table_top.glb'

/**
 * WebGPU-optimized static TableTopModel.
 * Computes bounding volumes, ensures WebGPU 4-byte attribute alignment,
 * and freezes transformation matrices to eliminate per-frame recalculations.
 */
export const TableTopModel: React.FC<TableTopModelProps> = ({
  position = [0, -0.35, 0],
  rotation = [0, 0, 0],
  scale = 1,
  onLoaded
}) => {
  const groupRef = useRef<THREE.Group>(null)
  const gl = useThree((state) => state.gl)

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
    // Ensure all vertex attributes satisfy WebGPU 4-byte stride requirements
    ensureWebGPUGeometry(scene)

    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh
        mesh.castShadow = true
        mesh.receiveShadow = true

        // Compute bounds for reliable frustum culling
        if (mesh.geometry) {
          mesh.geometry.computeBoundingSphere()
          mesh.geometry.computeBoundingBox()
        }

        // Freeze static transform matrices
        mesh.matrixAutoUpdate = false
        mesh.updateMatrix()

        if (mesh.material) {
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
          mats.forEach((mat) => {
            const stdMat = mat as THREE.MeshStandardMaterial
            if (stdMat.roughness !== undefined) {
              stdMat.roughness = Math.min(Math.max(stdMat.roughness ?? 0.6, 0.2), 0.95)
              stdMat.needsUpdate = true
            }
          })
        }
      }
    })

    if (groupRef.current && onLoaded) {
      onLoaded(groupRef.current)
    }
  }, [scene, onLoaded])

  return (
    <group
      ref={groupRef}
      dispose={null}
      position={position}
      rotation={rotation}
      scale={scale}
    >
      <primitive object={scene} />
    </group>
  )
}

useGLTF.preload(MODEL_PATH)
