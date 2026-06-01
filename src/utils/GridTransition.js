import * as THREE from 'three';
import * as TSL from 'three/tsl';

/**
 * Applies a holographic grid transition effect to a material.
 * @param {THREE.MeshStandardNodeMaterial} material - The material to apply the effect to.
 * @param {Object} options - Configuration options.
 * @returns {TSL.Uniform} - The progress uniform (0.0 to 1.0).
 */
export const applyGridTransition = (material, options = {}) => {
  const {
    color = '#00ffff',
    gridScale = 20,
    thickness = 0.02,
    sweepAxis = 'z',
    sweepDirection = 1,
    sweepBounds = [-100, 100]
  } = options;

  // We use a uniform node that can be animated from outside
  const progress = TSL.uniform(0);

  const uv = TSL.uv();
  const worldPos = TSL.positionWorld;

  const p = uv.mul(gridScale);

  // Square grid pattern
  const gridX = TSL.abs(TSL.fract(p.x).sub(0.5));
  const gridY = TSL.abs(TSL.fract(p.y).sub(0.5));
  const grid = TSL.step(0.5 - thickness, TSL.max(gridX, gridY));

  // Discard logic based on progress and sweep
  const noise = TSL.mx_noise_float(worldPos.mul(5.0));

  const axisPos = sweepAxis === 'z' ? worldPos.z : (sweepAxis === 'y' ? worldPos.y : worldPos.x);

  // Normalize axis position between 0 and 1 using sweepBounds
  let normalizedAxis = axisPos.sub(sweepBounds[0]).div(sweepBounds[1] - sweepBounds[0]);
  if (sweepDirection === -1) {
    normalizedAxis = TSL.float(1.0).sub(normalizedAxis);
  }

  // Calculate sweep progress: progress goes 0 to 1
  // We want the sweep front to move across normalizedAxis.
  const sweepProgress = progress.mul(3.5).sub(normalizedAxis).sub(1.5);

  // Threshold logic
  const mask = noise.add(grid.mul(0.2)).add(sweepProgress);
  const baseOpacity = material.opacityNode || TSL.float(material.opacity ?? 1.0);

  // Critical fix: Ensure no discard at progress 0 and handle existing transparency better
  const maskResult = TSL.select(mask.lessThan(0.0), TSL.float(0.0), TSL.float(1.0));

  // We use a more conservative alphaTest or just rely on opacity discard
  material.opacityNode = baseOpacity.mul(maskResult);

  // Only use alphaTest if the object is supposed to be fully opaque at start
  // or if we are deep into the transition.
  material.alphaTest = 0.1;
  material.transparent = true;

  // Grid emission effect
  const gridIntensity = TSL.smoothstep(0.0, 0.3, progress).mul(TSL.smoothstep(1.0, 0.7, progress));
  const gridEmission = TSL.color(color).mul(grid).mul(gridIntensity).mul(5.0);

  if (material.emissiveNode) {
    material.emissiveNode = material.emissiveNode.add(gridEmission);
  } else {
    material.emissiveNode = gridEmission;
  }

  return progress;
};
