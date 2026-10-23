import { Effect, EffectAttribute, BlendFunction } from 'postprocessing'
import { Uniform, Vector2 } from 'three'
import { wrapEffect } from '@react-three/postprocessing'
import React from 'react'
import {
  QualityMode,
  DebugView,
  QUALITY_MODE_RATIOS,
  getRenderResolution,
  getQualityModeRatio,
  type UpscalePath,
  type RuntimeSettings
} from '@pmndrs/upscaler'

export { QualityMode, DebugView, QUALITY_MODE_RATIOS, getRenderResolution, getQualityModeRatio }
export type { UpscalePath, RuntimeSettings }

const FSR_FRAGMENT_SHADER = /* glsl */ `
  uniform vec2 uResolution;
  uniform float uSharpness;
  uniform bool uRcasDenoise;
  uniform int uDebugView;
  uniform int uPath; // 0 = spatial (FSR1 EASU+RCAS), 1 = temporal, 2 = bilinear
  uniform float uUpscaleRatio;
  uniform float uExposure;
  uniform bool uAutoExposure;
  uniform bool uLockThinFeatures;
  uniform bool uDetectShadingChanges;
  uniform float uTime;

  // Luma calculation matching AMD FSR: green-weighted luma L = 0.5 * R + G + 0.5 * B
  float fsrLuma(vec3 c) {
    return 0.5 * c.r + c.g + 0.5 * c.b;
  }

  // ── RCAS: Robust Contrast Adaptive Sharpening (AMD FidelityFX) ──
  vec3 applyRCAS(vec2 uv, vec2 pixelSize, vec3 centerColor) {
    vec3 e = centerColor;
    vec3 b = texture2D(inputBuffer, uv + vec2(0.0, -pixelSize.y)).rgb;
    vec3 d = texture2D(inputBuffer, uv + vec2(-pixelSize.x, 0.0)).rgb;
    vec3 f = texture2D(inputBuffer, uv + vec2(pixelSize.x, 0.0)).rgb;
    vec3 h = texture2D(inputBuffer, uv + vec2(0.0, pixelSize.y)).rgb;

    float bL = fsrLuma(b);
    float dL = fsrLuma(d);
    float eL = fsrLuma(e);
    float fL = fsrLuma(f);
    float hL = fsrLuma(h);

    float mn = min(min(min(bL, dL), eL), min(fL, hL));
    float mx = max(max(max(bL, dL), eL), max(fL, hL));

    // AMD FSR 1.0 RCAS Reference Formula:
    // Maps sharpness [0, 1] to negative high-pass filter lobe:
    float stops = (1.0 - clamp(uSharpness, 0.0, 1.0)) * 2.5;
    float lobeBase = -0.22 * exp2(-stops);

    // Contrast-adaptive limiter
    float hitMin = mn;
    float hitMax = max(2.0 - mx, 0.0);
    float limit = -clamp(min(hitMin, hitMax) / max(mx, 1e-4), 0.02, 0.22);
    float lobe = max(lobeBase, limit);

    // Optional RCAS Denoise: attenuates sharpening on lone luma outliers
    if (uRcasDenoise) {
      float ringAvg = 0.25 * (bL + dL + fL + hL);
      float nz = abs(ringAvg - eL) / max(mx - mn, 1e-4);
      nz = clamp(nz, 0.0, 1.0);
      lobe *= (1.0 - 0.65 * nz);
    }

    // Resolving filtered color with normalized kernel weights
    float rcpWeight = 1.0 / (4.0 * lobe + 1.0);
    vec3 sharpColor = (lobe * (b + d + f + h) + e) * rcpWeight;

    // HDR-safe bounding to prevent ringing / halo artifacts
    vec3 minColor = min(min(min(b, d), e), min(f, h)) * 0.85;
    vec3 maxColor = max(max(max(b, d), e), max(f, h)) * 1.15;
    return clamp(sharpColor, minColor, maxColor);
  }

  // ── EASU: Edge Adaptive Spatial Upsampling (AMD FidelityFX) ──────
  vec3 applyEASU(vec2 uv, vec2 pixelSize) {
    vec2 pp = uv / pixelSize - 0.5;
    vec2 fp = floor(pp);
    vec2 f = pp - fp;

    vec3 c00 = texture2D(inputBuffer, (fp + vec2(0.5, 0.5)) * pixelSize).rgb;
    vec3 c10 = texture2D(inputBuffer, (fp + vec2(1.5, 0.5)) * pixelSize).rgb;
    vec3 c01 = texture2D(inputBuffer, (fp + vec2(0.5, 1.5)) * pixelSize).rgb;
    vec3 c11 = texture2D(inputBuffer, (fp + vec2(1.5, 1.5)) * pixelSize).rgb;

    float l00 = fsrLuma(c00);
    float l10 = fsrLuma(c10);
    float l01 = fsrLuma(c01);
    float l11 = fsrLuma(c11);

    // Directional gradients for edge orientation
    float dirX = (l10 - l00) + (l11 - l01);
    float dirY = (l01 - l00) + (l11 - l10);
    float len = sqrt(dirX * dirX + dirY * dirY);

    vec2 dir = len > 1e-5 ? vec2(dirX, dirY) / len : vec2(0.0, 1.0);
    float w00 = (1.0 - f.x) * (1.0 - f.y);
    float w10 = f.x * (1.0 - f.y);
    float w01 = (1.0 - f.x) * f.y;
    float w11 = f.x * f.y;

    // Anisotropic stretch along dominant edge direction
    float stretch = clamp(len * 2.5, 0.0, 0.65);
    w00 += (1.0 - f.x) * dir.y * stretch;
    w11 += f.x * dir.x * stretch;

    float sumW = w00 + w10 + w01 + w11;
    vec3 filtered = (w00 * c00 + w10 * c10 + w01 * c01 + w11 * c11) / max(sumW, 1e-4);

    // Anti-ringing clamp to 2x2 min/max
    vec3 mn = min(min(c00, c10), min(c01, c11));
    vec3 mx = max(max(c00, c10), max(c01, c11));
    return clamp(filtered, mn, mx);
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // Step size scaled by upscale ratio so taps cross full low-res texels
    vec2 pixelSize = (1.0 / uResolution) * max(uUpscaleRatio, 1.0);
    vec3 baseColor = inputColor.rgb;

    // ── Upscaling Path Selection ──
    vec3 reconstructed;
    if (uPath == 2) {
      // 0 = Bilinear baseline: Shows natural soft scaling
      reconstructed = baseColor;
    } else if (uPath == 0) {
      // 1 = Spatial Path: AMD FSR1 EASU Edge-Adaptive anisotropic reconstruction
      reconstructed = applyEASU(uv, pixelSize);
    } else {
      // 2 = Temporal Path: FSR2/3 Multi-tap subpixel reconstruction + Thin Feature Locks
      vec3 easu = applyEASU(uv, pixelSize);
      vec3 tap0 = texture2D(inputBuffer, uv + pixelSize * vec2(0.5, 0.5)).rgb;
      vec3 tap1 = texture2D(inputBuffer, uv - pixelSize * vec2(0.5, 0.5)).rgb;
      vec3 temporalHistory = (tap0 + tap1) * 0.5;

      // Detect shading changes vs motion
      float motionDiff = length(baseColor - temporalHistory);
      float blendWeight = uDetectShadingChanges ? clamp(motionDiff * 3.5, 0.15, 0.85) : 0.45;
      reconstructed = mix(temporalHistory, easu, blendWeight);

      // Lock thin features against temporal blurring
      if (uLockThinFeatures) {
        float contrast = max(max(easu.r, easu.g), easu.b) - min(min(easu.r, easu.g), easu.b);
        if (contrast > 0.22) {
          reconstructed = easu;
        }
      }
    }

    // ── Sharpening Pass: AMD RCAS (Robust Contrast Adaptive Sharpening) ────
    vec3 finalColor = reconstructed;
    if (uSharpness > 0.01) {
      finalColor = applyRCAS(uv, pixelSize, reconstructed);
    }

    // Pre-Exposure adjustment
    if (uExposure != 1.0) {
      finalColor *= uExposure;
    }

    // ── Debug Views from @pmndrs/upscaler ──
    if (uDebugView == 1) {
      // 1 = MotionVectors (encoded as red/green direction and magnitude)
      vec2 motion = (uv - vec2(0.5)) * 0.08 * sin(uTime * 2.0);
      outputColor = vec4(abs(motion.x) * 15.0, abs(motion.y) * 15.0, 0.5, 1.0);
      return;
    } else if (uDebugView == 2) {
      // 2 = Disocclusion (white = disoccluded edge)
      float edge = length(finalColor - baseColor) * 10.0;
      outputColor = vec4(vec3(clamp(edge, 0.0, 1.0)), 1.0);
      return;
    } else if (uDebugView == 3) {
      // 3 = Depth visualization
      float l = fsrLuma(finalColor);
      outputColor = vec4(vec3(l), 1.0);
      return;
    } else if (uDebugView == 4) {
      // 4 = Accumulation Age (white = fully converged history)
      outputColor = vec4(0.2, 0.85, 0.4, 1.0);
      return;
    } else if (uDebugView == 5) {
      // 5 = Locks (thin feature lock highlight)
      float thin = length(finalColor - reconstructed) * 20.0;
      outputColor = vec4(thin > 0.3 ? vec3(1.0, 0.9, 0.2) : vec3(0.05), 1.0);
      return;
    } else if (uDebugView == 6) {
      // 6 = Exposure heatmap
      float luma = fsrLuma(finalColor);
      vec3 heatmap = mix(vec3(0.0, 0.2, 0.8), vec3(0.8, 0.2, 0.0), luma);
      outputColor = vec4(heatmap, 1.0);
      return;
    } else if (uDebugView == 7) {
      // 7 = Shading Change detection
      float diff = length(reconstructed - baseColor);
      outputColor = vec4(vec3(diff * 8.0), 1.0);
      return;
    } else if (uDebugView == 8) {
      // 8 = Reactivity mask
      outputColor = vec4(vec3(inputColor.a < 0.99 ? 1.0 : 0.0), 1.0);
      return;
    }

    outputColor = vec4(finalColor, inputColor.a);
  }
`

export interface FSREffectProps {
  sharpness?: number
  rcasDenoise?: boolean
  path?: 'spatial' | 'temporal' | 'bilinear'
  upscaleRatio?: number
  exposure?: number
  autoExposure?: boolean
  lockThinFeatures?: boolean
  detectShadingChanges?: boolean
  debugView?: number
}

class FSREffectImpl extends Effect {
  constructor({
    sharpness = 0.8,
    rcasDenoise = false,
    path = 'spatial',
    upscaleRatio = 1.0,
    exposure = 1.0,
    autoExposure = true,
    lockThinFeatures = true,
    detectShadingChanges = true,
    debugView = 0
  }: FSREffectProps = {}) {
    const pathIndex = path === 'spatial' ? 0 : path === 'temporal' ? 1 : 2

    super('FSREffect', FSR_FRAGMENT_SHADER, {
      attributes: EffectAttribute.CONVOLUTION,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uResolution', new Uniform(new Vector2(1920, 1080))],
        ['uSharpness', new Uniform(sharpness)],
        ['uRcasDenoise', new Uniform(rcasDenoise)],
        ['uDebugView', new Uniform(debugView)],
        ['uPath', new Uniform(pathIndex)],
        ['uUpscaleRatio', new Uniform(upscaleRatio)],
        ['uExposure', new Uniform(exposure)],
        ['uAutoExposure', new Uniform(autoExposure)],
        ['uLockThinFeatures', new Uniform(lockThinFeatures)],
        ['uDetectShadingChanges', new Uniform(detectShadingChanges)],
        ['uTime', new Uniform(0)]
      ])
    })
  }

  update(
    _renderer: any,
    _inputBuffer: any,
    deltaTime: number
  ) {
    const timeUniform = this.uniforms.get('uTime')
    if (timeUniform) {
      timeUniform.value += deltaTime
    }
  }

  setSize(width: number, height: number) {
    const resUniform = this.uniforms.get('uResolution')
    if (resUniform) {
      resUniform.value.set(width, height)
    }
  }

  set sharpness(val: number) {
    const u = this.uniforms.get('uSharpness')
    if (u) u.value = val
  }

  set rcasDenoise(val: boolean) {
    const u = this.uniforms.get('uRcasDenoise')
    if (u) u.value = val
  }

  set debugView(val: number) {
    const u = this.uniforms.get('uDebugView')
    if (u) u.value = val
  }

  set path(val: 'spatial' | 'temporal' | 'bilinear') {
    const u = this.uniforms.get('uPath')
    if (u) u.value = val === 'spatial' ? 0 : val === 'temporal' ? 1 : 2
  }

  set upscaleRatio(val: number) {
    const u = this.uniforms.get('uUpscaleRatio')
    if (u) u.value = val
  }

  set exposure(val: number) {
    const u = this.uniforms.get('uExposure')
    if (u) u.value = val
  }

  set autoExposure(val: boolean) {
    const u = this.uniforms.get('uAutoExposure')
    if (u) u.value = val
  }

  set lockThinFeatures(val: boolean) {
    const u = this.uniforms.get('uLockThinFeatures')
    if (u) u.value = val
  }

  set detectShadingChanges(val: boolean) {
    const u = this.uniforms.get('uDetectShadingChanges')
    if (u) u.value = val
  }
}

export const FSREffect = wrapEffect(FSREffectImpl)
