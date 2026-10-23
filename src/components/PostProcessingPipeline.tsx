import React, { useEffect, useRef, useState } from 'react'
import { useThree, useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { PostProcessing } from 'three/webgpu'
import {
  pass,
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  uv,
  smoothstep,
  texture3D,
  clamp,
  min,
  max,
  abs,
  dot,
  mix,
  Fn
} from 'three/tsl'
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js'
import { dof } from 'three/examples/jsm/tsl/display/DepthOfFieldNode.js'
import { lut3D } from 'three/examples/jsm/tsl/display/Lut3DNode.js'
import { LUTCubeLoader } from 'three/examples/jsm/loaders/LUTCubeLoader.js'

export interface BloomSettings {
  enabled: boolean
  strength: number
  radius: number
  threshold: number
}

export interface DoFSettings {
  enabled: boolean
  focus: number
  aperture: number
  maxblur: number
}

export interface VignetteSettings {
  enabled: boolean
  offset: number
  darkness: number
}

export interface ToneMappingSettings {
  mode: 'aces' | 'agx' | 'neutral'
  exposure: number
}

export interface FSRSettings {
  enabled: boolean
  qualityMode: 'native' | 'ultra-quality' | 'quality' | 'balanced' | 'performance'
  path: 'spatial' | 'temporal' | 'bilinear' | 'rcas-only'
  sharpness: number
  rcasDenoise: boolean
  lockThinFeatures: boolean
  detectShadingChanges: boolean
  preExposure: number
  debugView: 'off' | 'edges' | 'sharpening' | 'luma'
}

export interface LutSettings {
  enabled: boolean
  lut: 'Bourbon 64' | 'Chemical 168' | 'Clayton 33' | 'Cubicle 99' | 'Remy 24'
  intensity: number
}

interface PostProcessingPipelineProps {
  bloomSettings?: BloomSettings
  dofSettings?: DoFSettings
  vignetteSettings?: VignetteSettings
  toneMappingSettings?: ToneMappingSettings
  fsrSettings?: FSRSettings
  lutSettings?: LutSettings
}

// Global LUT cache to prevent re-fetching and parsing 3D DataTextures
const lutCache = new Map<string, { size: number; texture3D: THREE.Data3DTexture }>()

/**
 * Native TSL AMD FidelityFX FSR 1.0 (RCAS + Denoise + Pre-exposure)
 */
const fsrRcasNode = Fn(([textureNode, sharpnessNode, denoiseNode, preExpNode]) => {
  const uvCoord = uv()
  const stepVal = vec2(0.0008, 0.0008)

  const expVal = max(preExpNode, float(0.01))
  const spM = textureNode.mul(expVal)
  const spN = textureNode.sample(uvCoord.add(vec2(0.0, stepVal.y.negate()))).mul(expVal)
  const spS = textureNode.sample(uvCoord.add(vec2(0.0, stepVal.y))).mul(expVal)
  const spW = textureNode.sample(uvCoord.add(vec2(stepVal.x.negate(), 0.0))).mul(expVal)
  const spE = textureNode.sample(uvCoord.add(vec2(stepVal.x, 0.0))).mul(expVal)

  // Green-weighted luma: 0.5 * R + G + 0.5 * B
  const lumaWeight = vec3(0.5, 1.0, 0.5)
  const lM = dot(spM.rgb, lumaWeight)
  const lN = dot(spN.rgb, lumaWeight)
  const lS = dot(spS.rgb, lumaWeight)
  const lW = dot(spW.rgb, lumaWeight)
  const lE = dot(spE.rgb, lumaWeight)

  const minL = min(min(min(lN, lS), min(lW, lE)), lM)
  const maxL = max(max(max(lN, lS), max(lW, lE)), lM)

  // RCAS adaptive lobe
  const baseLobe = float(-0.20).mul(sharpnessNode)
  const contrastLimit = min(minL, float(2.0).sub(maxL)).div(max(maxL, float(0.001))).negate()
  let lobe = max(baseLobe, contrastLimit)

  // RCAS Denoise: attenuates sharpening on high-noise areas
  const ringAvg = lN.add(lS).add(lW).add(lE).mul(0.25)
  const noise = abs(ringAvg.sub(lM)).div(max(maxL.sub(minL), float(0.001)))
  lobe = mix(lobe, lobe.mul(float(1.0).sub(clamp(noise, 0.0, 1.0).mul(0.65))), denoiseNode)

  // Sharpened result
  const sharpWeight = float(1.0).div(float(1.0).add(lobe.mul(4.0)))
  const sharpened = spM.add(spN.add(spS).add(spW).add(spE).mul(lobe)).mul(sharpWeight)

  const minCol = min(min(spN, spS), min(min(spW, spE), spM)).mul(0.9)
  const maxCol = max(max(spN, spS), max(max(spW, spE), spM)).mul(1.1)
  return clamp(sharpened, minCol, maxCol).div(expVal)
})

/**
 * TSL Edge Detection Debug Node
 */
const fsrEdgeDebugNode = Fn(([textureNode]) => {
  const uvCoord = uv()
  const stepVal = vec2(0.0008, 0.0008)
  const spN = textureNode.sample(uvCoord.add(vec2(0.0, stepVal.y.negate())))
  const spS = textureNode.sample(uvCoord.add(vec2(0.0, stepVal.y)))
  const spW = textureNode.sample(uvCoord.add(vec2(stepVal.x.negate(), 0.0)))
  const spE = textureNode.sample(uvCoord.add(vec2(stepVal.x, 0.0)))
  const lumaWeight = vec3(0.5, 1.0, 0.5)
  const lN = dot(spN.rgb, lumaWeight)
  const lS = dot(spS.rgb, lumaWeight)
  const lW = dot(spW.rgb, lumaWeight)
  const lE = dot(spE.rgb, lumaWeight)
  const edgeLen = abs(lE.sub(lW)).add(abs(lS.sub(lN)))
  return vec4(vec3(edgeLen.mul(4.0)), 1.0)
})

export const PostProcessingPipeline: React.FC<PostProcessingPipelineProps> = ({
  bloomSettings = { enabled: true, strength: 0.35, radius: 0.3, threshold: 0.8 },
  dofSettings = { enabled: true, focus: 0.30, aperture: 0.03, maxblur: 0.01 },
  vignetteSettings = { enabled: true, offset: 0.3, darkness: 0.5 },
  toneMappingSettings = { mode: 'neutral', exposure: 1.0 },
  fsrSettings = {
    enabled: true,
    qualityMode: 'native',
    path: 'spatial',
    sharpness: 0.8,
    rcasDenoise: true,
    lockThinFeatures: true,
    detectShadingChanges: true,
    preExposure: 1.0,
    debugView: 'off'
  },
  lutSettings = {
    enabled: true,
    lut: 'Chemical 168',
    intensity: 0.85
  }
}) => {
  const gl = useThree((state) => state.gl)
  const scene = useThree((state) => state.scene)
  const camera = useThree((state) => state.camera)

  const postProcessingRef = useRef<PostProcessing | null>(null)
  const [loadedLut, setLoadedLut] = useState<{ size: number; texture3D: THREE.Data3DTexture } | null>(null)

  // Asynchronously load selected 3D LUT .CUBE file
  useEffect(() => {
    if (!lutSettings?.enabled || !lutSettings?.lut) {
      setLoadedLut(null)
      return
    }

    const lutName = lutSettings.lut
    if (lutCache.has(lutName)) {
      setLoadedLut(lutCache.get(lutName)!)
      return
    }

    const loader = new LUTCubeLoader()
    loader.load(
      `/luts/${lutName}.CUBE`,
      (result) => {
        const entry = { size: result.size, texture3D: result.texture3D }
        lutCache.set(lutName, entry)
        setLoadedLut(entry)
      },
      undefined,
      (err) => {
        console.warn(`[PostProcessingPipeline] Could not load LUT /luts/${lutName}.CUBE:`, err)
      }
    )
  }, [lutSettings?.enabled, lutSettings?.lut])

  // Reactive TSL Uniforms for smooth real-time parameter tweaking without rebuilding the pipeline graph
  const uBloomStrength = useRef(uniform(bloomSettings.strength))
  const uBloomRadius = useRef(uniform(bloomSettings.radius))
  const uBloomThreshold = useRef(uniform(bloomSettings.threshold))

  const uDoFFocus = useRef(uniform(dofSettings.focus))
  const uDoFAperture = useRef(uniform(dofSettings.aperture))
  const uDoFMaxBlur = useRef(uniform(dofSettings.maxblur))

  const uVignetteOffset = useRef(uniform(vignetteSettings.offset))
  const uVignetteDarkness = useRef(uniform(vignetteSettings.darkness))

  const uExposure = useRef(uniform(toneMappingSettings.exposure))
  const uFSRSharpness = useRef(uniform(fsrSettings.sharpness))
  const uFSRDenoise = useRef(uniform(fsrSettings.rcasDenoise ? 1.0 : 0.0))
  const uFSRPreExp = useRef(uniform(fsrSettings.preExposure ?? 1.0))
  const uLutIntensity = useRef(uniform(lutSettings.intensity))

  // Initialize native WebGPU PostProcessing graph
  useEffect(() => {
    if (!(gl as any).isWebGPURenderer && !(gl as any).hasInitialized) return

    const postProcessing = new PostProcessing(gl as any)

    // 1. Scene Pass
    const scenePass = pass(scene, camera)
    const rawSceneColor: any = scenePass.getTextureNode('output')

    // 2. FSR / RCAS Pass
    let colorNode: any = rawSceneColor
    if (fsrSettings.enabled) {
      if (fsrSettings.debugView === 'edges') {
        colorNode = fsrEdgeDebugNode(rawSceneColor)
      } else {
        colorNode = fsrRcasNode(
          rawSceneColor,
          uFSRSharpness.current,
          uFSRDenoise.current,
          uFSRPreExp.current
        )

        if (fsrSettings.debugView === 'sharpening') {
          colorNode = vec4(abs(colorNode.sub(rawSceneColor)).rgb.mul(8.0), 1.0)
        } else if (fsrSettings.debugView === 'luma') {
          const lumaVal = dot(colorNode.rgb, vec3(0.5, 1.0, 0.5))
          colorNode = vec4(vec3(lumaVal), 1.0)
        }
      }
    }

    // 3. Depth of Field (optional)
    if (dofSettings.enabled) {
      try {
        const viewZ = scenePass.getViewZNode()
        colorNode = dof(
          colorNode,
          viewZ,
          uDoFFocus.current,
          uDoFAperture.current,
          uDoFMaxBlur.current
        )
      } catch (e) {
        console.warn('[PostProcessingPipeline] DoF Node warning:', e)
      }
    }

    // 4. Bloom Node (TSL)
    if (bloomSettings.enabled) {
      try {
        const bloomPass: any = bloom(
          colorNode,
          bloomSettings.strength,
          bloomSettings.radius,
          bloomSettings.threshold
        )
        colorNode = colorNode.add(bloomPass)
      } catch (e) {
        console.warn('[PostProcessingPipeline] Bloom Node warning:', e)
      }
    }

    // 5. 3D LUT Color Grading (TSL Lut3DNode)
    if (lutSettings.enabled && loadedLut && loadedLut.texture3D) {
      try {
        const lutTextureNode = texture3D(loadedLut.texture3D)
        colorNode = lut3D(colorNode, lutTextureNode, loadedLut.size, uLutIntensity.current)
      } catch (e) {
        console.warn('[PostProcessingPipeline] LUT 3D warning:', e)
      }
    }

    // 6. Vignette Node (TSL)
    if (vignetteSettings.enabled) {
      const uvCoord = uv().sub(0.5)
      const dist = uvCoord.length()
      const vig = smoothstep(
        uVignetteOffset.current,
        uVignetteOffset.current.add(uVignetteDarkness.current),
        dist
      )
      colorNode = colorNode.mul(float(1.0).sub(vig))
    }

    // 7. Native ToneMapping configured directly on the WebGPURenderer
    const tmAlgorithm =
      toneMappingSettings.mode === 'agx'
        ? (THREE as any).AgXToneMapping ?? 6
        : toneMappingSettings.mode === 'neutral'
        ? (THREE as any).NeutralToneMapping ?? 7
        : (THREE as any).ACESFilmicToneMapping ?? 4

    gl.toneMapping = tmAlgorithm
    gl.toneMappingExposure = toneMappingSettings.exposure

    postProcessing.outputNode = colorNode
    postProcessingRef.current = postProcessing

    return () => {
      postProcessingRef.current = null
      postProcessing.dispose()
    }
  }, [
    gl,
    scene,
    camera,
    bloomSettings.enabled,
    dofSettings.enabled,
    vignetteSettings.enabled,
    toneMappingSettings.mode,
    fsrSettings.enabled,
    fsrSettings.debugView,
    lutSettings.enabled,
    loadedLut
  ])

  // Update dynamic uniform values without rebuilding the pipeline graph
  useEffect(() => {
    uBloomStrength.current.value = bloomSettings.strength
    uBloomRadius.current.value = bloomSettings.radius
    uBloomThreshold.current.value = bloomSettings.threshold

    uDoFFocus.current.value = dofSettings.focus
    uDoFAperture.current.value = dofSettings.aperture
    uDoFMaxBlur.current.value = dofSettings.maxblur

    uVignetteOffset.current.value = vignetteSettings.offset
    uVignetteDarkness.current.value = vignetteSettings.darkness

    uExposure.current.value = toneMappingSettings.exposure
    uFSRSharpness.current.value = fsrSettings.sharpness
    uFSRDenoise.current.value = fsrSettings.rcasDenoise ? 1.0 : 0.0
    uFSRPreExp.current.value = fsrSettings.preExposure ?? 1.0

    uLutIntensity.current.value = lutSettings.intensity

    // Update renderer tone mapping
    const tmAlgorithm =
      toneMappingSettings.mode === 'agx'
        ? (THREE as any).AgXToneMapping ?? 6
        : toneMappingSettings.mode === 'neutral'
        ? (THREE as any).NeutralToneMapping ?? 7
        : (THREE as any).ACESFilmicToneMapping ?? 4

    gl.toneMapping = tmAlgorithm
    gl.toneMappingExposure = toneMappingSettings.exposure
    if (postProcessingRef.current) {
      postProcessingRef.current.needsUpdate = true
    }
  }, [
    gl,
    bloomSettings.strength,
    bloomSettings.radius,
    bloomSettings.threshold,
    dofSettings.focus,
    dofSettings.aperture,
    dofSettings.maxblur,
    vignetteSettings.offset,
    vignetteSettings.darkness,
    toneMappingSettings.mode,
    toneMappingSettings.exposure,
    fsrSettings.sharpness,
    fsrSettings.rcasDenoise,
    fsrSettings.preExposure,
    lutSettings.intensity
  ])

  // Native render loop execution with priority 1 (overriding R3F's default render loop)
  useFrame((state) => {
    // Guard against zero-sized canvas during resize, orientation change, or initial layout
    if (state.size.width <= 0 || state.size.height <= 0) return

    if (postProcessingRef.current) {
      try {
        postProcessingRef.current.render()
      } catch (err) {
        console.error('[PostProcessingPipeline] Render error:', err)
        state.gl.render(state.scene, state.camera)
      }
    } else {
      state.gl.render(state.scene, state.camera)
    }
  }, 1)

  return null
}
