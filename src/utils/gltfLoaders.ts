import * as THREE from 'three'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

let dracoLoaderInstance: DRACOLoader | null = null
let ktx2LoaderInstance: KTX2Loader | null = null

/**
 * Singleton DRACOLoader instance to avoid duplicate WebAssembly worker allocations
 */
export function getDracoLoader(): DRACOLoader {
  if (!dracoLoaderInstance) {
    dracoLoaderInstance = new DRACOLoader()
    dracoLoaderInstance.setDecoderPath('/draco/')
  }
  return dracoLoaderInstance
}

/**
 * Singleton KTX2Loader instance configured with WebGPU/WebGL capability detection
 */
export function getKTX2Loader(gl?: any): KTX2Loader {
  if (!ktx2LoaderInstance) {
    ktx2LoaderInstance = new KTX2Loader()
    ktx2LoaderInstance.setTranscoderPath('/basis/')
  }
  if (gl && !(ktx2LoaderInstance as any).workerConfig) {
    try {
      ktx2LoaderInstance.detectSupport(gl)
    } catch (e) {
      console.warn('KTX2Loader detectSupport warning:', e)
    }
  }
  return ktx2LoaderInstance
}

/**
 * Helper to configure a GLTFLoader instance with shared singletons and automatic WebGPU geometry sanitization.
 */
export function configureGLTFLoader(loader: GLTFLoader, gl?: any): void {
  loader.setDRACOLoader(getDracoLoader())
  if (gl) {
    loader.setKTX2Loader(getKTX2Loader(gl))
  }

  // Intercept loader.parse so all geometries are sanitized before they enter R3F's cache/scene
  const originalParse = loader.parse.bind(loader)
  loader.parse = function (data: any, path: string, onLoad: (gltf: any) => void, onError?: (err: any) => void) {
    return originalParse(
      data,
      path,
      (gltf: any) => {
        if (gltf && gltf.scene) {
          ensureWebGPUGeometry(gltf.scene)
        }
        onLoad(gltf)
      },
      onError
    )
  }
}

/**
 * Ensures all vertex buffer attributes in the geometry have an arrayStride that is a multiple of 4 bytes.
 * WebGPU hardware specifications strictly require:
 * `Vertex buffer arrayStride must be a multiple of 4`.
 * Quantized 16-bit attributes (like SHORT VEC3, stride = 6) and interleaved attributes are unpacked into Float32Array (stride = 12).
 */
export function ensureWebGPUGeometry(scene: THREE.Object3D): void {
  scene.traverse((child: any) => {
    if (child.geometry && child.geometry.attributes) {
      const geom = child.geometry as THREE.BufferGeometry
      const attrNames = Object.keys(geom.attributes)
      for (const name of attrNames) {
        const attr = geom.attributes[name] as any
        if (!attr) continue

        const isInterleaved = !!attr.isInterleavedBufferAttribute
        const rawArray = isInterleaved ? attr.data?.array : attr.array
        const bytesPerElem = rawArray?.BYTES_PER_ELEMENT || 4
        const stride = isInterleaved
          ? (attr.data?.stride || attr.itemSize) * bytesPerElem
          : attr.itemSize * bytesPerElem

        // If stride is not a multiple of 4 (e.g. 6 bytes for Vec3 Int16), or if it is interleaved with non-4 stride
        if (stride % 4 !== 0 || isInterleaved || (bytesPerElem < 4 && (attr.itemSize % 2 !== 0 || stride % 4 !== 0))) {
          const count = attr.count
          const itemSize = attr.itemSize
          const floatArr = new Float32Array(count * itemSize)
          for (let i = 0; i < count; i++) {
            floatArr[i * itemSize] = attr.getX(i)
            if (itemSize > 1) floatArr[i * itemSize + 1] = attr.getY(i)
            if (itemSize > 2) floatArr[i * itemSize + 2] = attr.getZ(i)
            if (itemSize > 3) floatArr[i * itemSize + 3] = attr.getW(i)
            for (let c = 4; c < itemSize; c++) {
              floatArr[i * itemSize + c] = attr.getComponent ? attr.getComponent(i, c) : 0
            }
          }
          geom.setAttribute(name, new THREE.Float32BufferAttribute(floatArr, itemSize, false))
        }
      }
    }
  })
}
