import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { color as tslColor, float as tslFloat } from 'three/tsl';

/**
 * SpeedLines renders a burst of neon streaks every time speedFactor > threshold.
 * Each burst spawns BURST_COUNT lines; each line lives MAX_AGE seconds.
 * Lines are instanced CylinderGeometry oriented along the ship's forward axis.
 */
export default function SpeedLines({ shipRef, speedFactor }) {
  const MAX_LINES = 140;   // instanced pool size
  const MAX_AGE = 0.55; // seconds each line is visible
  const BURST_COUNT = 35;  // lines spawned per scroll impulse
  const THRESHOLD = 0.9; // speedFactor value that triggers a burst

  const geometry = useMemo(
    () => new THREE.CylinderGeometry(0.015, 0.015, 80, 123, 5, true),
    []
  );
  const material = useMemo(() => {
    const mat = new THREE.MeshBasicNodeMaterial({
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    // Multiply emission ×8 so bloom catches it
    mat.colorNode = tslColor(0xff00ff).mul(tslFloat(8.0));
    return mat;
  }, []);

  const meshRef = useRef();
  // age of each line (-1 = idle/hidden, 0..MAX_AGE = alive)
  const ages = useMemo(() => new Float32Array(MAX_LINES).fill(MAX_AGE), []);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Track previous speedFactor to detect rising edge
  const prevSpeed = useRef(0);

  // Put all instances off-screen on mount
  React.useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < MAX_LINES; i++) {
      dummy.position.set(0, -9999, 0);
      dummy.scale.set(1, 0, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, []);

  const spawnLine = (index) => {
    if (!shipRef?.current || !meshRef.current) return;
    const shipPos = new THREE.Vector3();
    shipRef.current.getWorldPosition(shipPos);

    // Random spread around forward axis
    const spread = 4;
    dummy.position.set(
      shipPos.x + (Math.random() - 0.5) * spread,
      shipPos.y + (Math.random() - 2) * spread,
      shipPos.z - 2 - Math.random() + 17  // slightly ahead of ship
    );

    // Align cylinder (Y-up by default) to world -Z (forward)
    const forward = new THREE.Vector3(0, 0, -1);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), forward);
    dummy.scale.set(2, 2, 2);
    dummy.updateMatrix();
    meshRef.current.setMatrixAt(index, dummy.matrix);
    meshRef.current.instanceMatrix.needsUpdate = true;
    ages[index] = 0;
  };

  useFrame((state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const sf = speedFactor?.current ?? 0;

    // Detect rising edge → fire a burst
    if (sf > THRESHOLD && prevSpeed.current <= THRESHOLD) {
      let spawned = 0;
      for (let i = 0; i < MAX_LINES && spawned < BURST_COUNT; i++) {
        if (ages[i] >= MAX_AGE) {
          spawnLine(i);
          spawned++;
        }
      }
    }
    prevSpeed.current = sf;

    // Update alive lines: fade opacity via Y scale
    for (let i = 0; i < MAX_LINES; i++) {
      if (ages[i] < MAX_AGE) {
        ages[i] += delta;
        const life = Math.max(0, 1 - ages[i] / MAX_AGE); // 1→0

        // Read current matrix and rewrite scale only
        mesh.getMatrixAt(i, dummy.matrix);
        dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
        dummy.scale.set(life * 0.6 + 0.4, life, life * 0.6 + 0.4); // thin out as it fades
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      } else {
        // Hide
        dummy.position.set(0, -9999, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={meshRef} args={[geometry, material, MAX_LINES]} frustumCulled={false} renderOrder={999} />;
}
