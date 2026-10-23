import type { createGlass } from './create-glass';

export interface GlassSettings {
  ior: number;
  thickness: number;
  reflections: number;
  glassTint: string;
  roughness: number;
  dispersion: number;
  distortion: number;
  backside: boolean;
  backsideThickness?: number;
  anisotropicBlur?: number;
  distortionScale?: number;
  temporalDistortion?: number;
  attenuationDistance?: number;
  attenuationColor?: string;
  clearcoat?: number;
  clearcoatRoughness?: number;
  iridescence?: number;
  side?: 'DoubleSide' | 'FrontSide' | 'BackSide';
  depthWrite?: boolean;
}

/** Pushes the live panel values into the shared glass material. */
export function updateGlass(glass: ReturnType<typeof createGlass>, settings: GlassSettings, time: number) {
  if (settings.ior !== undefined) glass.params.ior.value = settings.ior;
  if (settings.thickness !== undefined) glass.params.thickness.value = settings.thickness;
  if (settings.reflections !== undefined) glass.material.envMapIntensity = settings.reflections;
  if (settings.glassTint) glass.material.color.set(settings.glassTint);
  if (settings.roughness !== undefined) glass.material.roughness = settings.roughness;
  if (settings.dispersion !== undefined) glass.material.dispersion = settings.dispersion;
  if (settings.distortion !== undefined) glass.params.distortion.value = settings.distortion;
  glass.params.time.value = time;
  if (settings.backside !== undefined) glass.config.backside = settings.backside;
  const backThick = settings.backsideThickness ?? settings.thickness;
  if (backThick !== undefined) {
    glass.config.backsideThickness = backThick;
    glass.params.backsideThickness.value = backThick;
  }
  if (settings.anisotropicBlur !== undefined) glass.params.anisotropicBlur.value = settings.anisotropicBlur;
  if (settings.distortionScale !== undefined) glass.params.distortionScale.value = settings.distortionScale;
  if (settings.temporalDistortion !== undefined) glass.params.temporalDistortion.value = settings.temporalDistortion;
  if (settings.attenuationDistance !== undefined) glass.params.attenuationDistance.value = settings.attenuationDistance;
  if (settings.attenuationColor) glass.params.attenuationColor.value.set(settings.attenuationColor);
  if (settings.clearcoat !== undefined) glass.material.clearcoat = settings.clearcoat;
  if (settings.clearcoatRoughness !== undefined) glass.material.clearcoatRoughness = settings.clearcoatRoughness;
  if (settings.iridescence !== undefined) glass.material.iridescence = settings.iridescence;
}
