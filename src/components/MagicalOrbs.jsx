import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import * as tsl from 'three/tsl';

const MAX_ORBS = 8;
const MAX_TRAIL_PARTICLES = 350;

// Spawning bounds for the corridor close to the ship (so they fly past elegantly)
const CORRIDOR_WIDTH = 30;
const CORRIDOR_HEIGHT = 30;

export default function MagicalOrbs({ shipRef, shieldHitsRef, cursorSpeed }) {
    const orbsMeshRef = useRef();
    const trailsMeshRef = useRef();

    const trailIndex = useRef(0);
    const dummy = useMemo(() => new THREE.Object3D(), []);

    // Reusable temp objects for per-frame hit direction computation (no GC pressure)
    const _relPos = useMemo(() => new THREE.Vector3(), []);
    const _invQuat = useMemo(() => new THREE.Quaternion(), []);

    // 1. Pre-allocate orbs state/metadata spread across space on startup
    const orbsData = useMemo(() => {
        const arr = [];
        const colors = [
            new THREE.Color("#ff00bb"), // Neon Hot Pink
            new THREE.Color("#00f3ff"), // Electric Cyan
            new THREE.Color("#00ff9d"), // Magic Mint Green
            new THREE.Color("#ffaa00"), // Amber Gold
            new THREE.Color("#b500ff")  // Cyber Purple
        ];

        for (let i = 0; i < MAX_ORBS; i++) {
            // Distribute initial Z so they start flying immediately at different depths
            const initZ = -250 + (i / MAX_ORBS) * 260; // Spread from -250 to +10

            const baseX = (Math.random() - 0.5) * CORRIDOR_WIDTH;
            const baseY = (Math.random() - 0.5) * CORRIDOR_HEIGHT;

            arr.push({
                position: new THREE.Vector3(baseX, baseY, initZ),
                speed: 55.0 + Math.random() * 55.0, // Speed 55 to 90 units/sec
                baseX: baseX,
                baseY: baseY,
                angle: Math.random() * Math.PI * 2,
                orbitalSpeed: (Math.random() > 0.5 ? 1 : -1) * (4.0 + Math.random() * 5.0), // Swirl speed
                amplitude: 1.0 + Math.random() * 1.5, // Spiral width
                phaseOffset: Math.random() * 100.0,
                color: new THREE.Color().copy(colors[i % colors.length])
            });
        }
        return arr;
    }, []);

    // 2. Pre-allocate trail particles state/metadata
    const trailData = useMemo(() => {
        const arr = [];
        for (let i = 0; i < MAX_TRAIL_PARTICLES; i++) {
            arr.push({
                active: false,
                position: new THREE.Vector3(),
                velocity: new THREE.Vector3(),
                life: 0,
                maxLife: 1.0,
                scale: 0,
                baseScale: 0.1,
                color: new THREE.Color()
            });
        }
        return arr;
    }, []);

    // 3. WebGPU TSL glowing material for the active magical orbs
    const orbMaterial = useMemo(() => {
        const mat = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const uvNode = tsl.uv();
        const dist = tsl.distance(uvNode, tsl.vec2(0.5));

        // Soft circular mask
        const glow = tsl.clamp(tsl.float(1.0).sub(dist.mul(2.0)), 0.0, 1.0);

        // Soft outer glowing halo
        const haloGlow = tsl.pow(glow, 1.4);

        // Sharp white-hot center core
        const coreGlow = tsl.pow(glow, 4.0);

        // Fetch color from the instanced mesh instance attribute
        const baseColor = tsl.attribute('instanceColor', 'vec3');
        const whiteCore = tsl.color("#ffffff");

        // Blend outer color with glowing white-hot core
        const finalColor = tsl.mix(baseColor.mul(haloGlow), whiteCore.mul(coreGlow), tsl.float(0.75));

        // Multiply by 5.5 to boost emission and trigger post-processing Bloom nicely
        mat.colorNode = finalColor.mul(8.5);
        return mat;
    }, []);

    // 4. WebGPU TSL glowing material for the trail particles (sparkles/fairy dust)
    const trailMaterial = useMemo(() => {
        const mat = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        });

        const uvNode = tsl.uv();
        const dist = tsl.distance(uvNode, tsl.vec2(0.5));

        const glow = tsl.clamp(tsl.float(1.0).sub(dist.mul(2.0)), 0.0, 1.0);

        // Trail sparks fade out quickly, soft glows
        const haloGlow = tsl.pow(glow, 1.8);
        const coreGlow = tsl.pow(glow, 5.0);

        const baseColor = tsl.attribute('instanceColor', 'vec3');
        const sparkColor = tsl.color("#ffffff");

        const finalColor = tsl.mix(baseColor.mul(haloGlow), sparkColor.mul(coreGlow), tsl.float(0.5));

        // Multiply by 3.5 for a lovely sparkling emission
        mat.colorNode = finalColor.mul(3.5);
        return mat;
    }, []);

    // 5. Helper function to spawn trail particles (fairy dust) at current orb position
    const spawnTrailParticle = (pos, color) => {
        const t = trailData[trailIndex.current];
        t.active = true;
        t.position.copy(pos);

        // Add soft 3D expansion drift around where it was spawned
        t.velocity.set(
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5,
            (Math.random() - 0.5) * 1.5
        );

        t.maxLife = 0.45 + Math.random() * 0.4; // 0.45s to 0.85s lifetime
        t.life = t.maxLife;
        t.baseScale = 0.08 + Math.random() * 0.16; // Small sparkles
        t.scale = t.baseScale;
        t.color.copy(color);

        trailIndex.current = (trailIndex.current + 1) % MAX_TRAIL_PARTICLES;
    };

    // Initialize instance colors on mount to register attributes for WebGPU
    React.useEffect(() => {
        const defaultColor = new THREE.Color("#ffffff");
        if (orbsMeshRef.current) {
            for (let i = 0; i < MAX_ORBS; i++) {
                orbsMeshRef.current.setColorAt(i, defaultColor);
            }
            if (orbsMeshRef.current.instanceColor) {
                orbsMeshRef.current.instanceColor.needsUpdate = true;
            }
        }
        if (trailsMeshRef.current) {
            for (let i = 0; i < MAX_TRAIL_PARTICLES; i++) {
                trailsMeshRef.current.setColorAt(i, defaultColor);
            }
            if (trailsMeshRef.current.instanceColor) {
                trailsMeshRef.current.instanceColor.needsUpdate = true;
            }
        }
    }, []);

    useFrame((state, delta) => {
        // Multiplier for space speed when cursor accelerates
        const speedBoost = 1.0 + (cursorSpeed?.current || 0) * 0.4;

        const colors = [
            new THREE.Color("#ff00bb"), // Neon Hot Pink
            new THREE.Color("#00f3ff"), // Electric Cyan
            new THREE.Color("#00ff9d"), // Magic Mint Green
            new THREE.Color("#ffaa00"), // Amber Gold
            new THREE.Color("#b500ff")  // Cyber Purple
        ];

        // -- Orbs Animation & Spawn Trails --
        orbsData.forEach((orb) => {
            // Move forward towards camera (+Z)
            orb.position.z += orb.speed * speedBoost * delta;

            // Swirling organic helical pattern (orbiting its base trajectory)
            orb.angle += orb.orbitalSpeed * delta;

            // Dynamic sine/cos oscillations for that chaotic, organic fairy flutter
            const flutterX = Math.sin(state.clock.elapsedTime * 6.0 + orb.phaseOffset) * 0.25;
            const flutterY = Math.cos(state.clock.elapsedTime * 5.0 + orb.phaseOffset) * 0.25;

            orb.position.x = orb.baseX + Math.cos(orb.angle) * orb.amplitude + flutterX;
            orb.position.y = orb.baseY + Math.sin(orb.angle) * orb.amplitude + flutterY;

            // --- COLLISION DETECTION WITH THE SHIP ---
            if (shipRef && shipRef.current) {
                const shipPos = shipRef.current.position;

                // Bounding Box check:
                // Ship is approx 6.4 units wide (wingspan), 3.0 units high, 8.0 units long
                const dx = Math.abs(orb.position.x - shipPos.x);
                const dy = Math.abs(orb.position.y - shipPos.y);
                const dz = Math.abs(orb.position.z - shipPos.z);

                if (dx < 3.2 && dy < 1.5 && dz < 4.0) {
                    // BOOM! Splatter explosion of magic sparks in all directions!
                    for (let j = 0; j < 14; j++) {
                        const t = trailData[trailIndex.current];
                        t.active = true;
                        t.position.copy(orb.position);

                        // Splatter explosion velocity: flies outwards in a beautiful sphere
                        const theta = Math.random() * Math.PI * 2;
                        const phi = Math.acos((Math.random() - 0.5) * 2.0);
                        const speed = 7.0 + Math.random() * 9.0; // Fast splatter speed!

                        t.velocity.set(
                            Math.sin(phi) * Math.cos(theta) * speed,
                            Math.sin(phi) * Math.sin(theta) * speed,
                            Math.cos(phi) * speed - 12.0 // flies backwards relative to the flying direction
                        );

                        t.maxLife = 0.4 + Math.random() * 0.4;
                        t.life = t.maxLife;
                        t.baseScale = 0.16 + Math.random() * 0.16; // Larger, premium collision sparks!
                        t.scale = t.baseScale;
                        t.color.copy(orb.color);

                        trailIndex.current = (trailIndex.current + 1) % MAX_TRAIL_PARTICLES;
                    }

                    // ---- Notify the Energy Shield about this hit ----
                    if (shieldHitsRef?.current) {
                        // Compute the hit direction in ship-local space
                        // (so the shield sphere shader can place the ripple correctly)
                        _relPos.subVectors(orb.position, shipPos);
                        _invQuat.copy(shipRef.current.quaternion).invert();
                        _relPos.applyQuaternion(_invQuat).normalize();

                        const buf = shieldHitsRef.current;
                        const idx = buf.hitIndex % 4;
                        buf.hits[idx].localPoint.copy(_relPos);
                        buf.hits[idx].time = state.clock.elapsedTime;
                        buf.hitIndex++;
                    }

                    // Reset orb immediately to the horizon!
                    orb.position.z = -250 - Math.random() * 50;
                    orb.baseX = (Math.random() - 0.5) * CORRIDOR_WIDTH;
                    orb.baseY = (Math.random() - 0.5) * CORRIDOR_HEIGHT;
                    orb.speed = 55.0 + Math.random() * 35.0;
                    orb.angle = Math.random() * Math.PI * 2;
                    orb.orbitalSpeed = (Math.random() > 0.5 ? 1 : -1) * (4.0 + Math.random() * 5.0);
                    orb.amplitude = 1.0 + Math.random() * 1.5;
                    orb.color.copy(colors[Math.floor(Math.random() * colors.length)]);

                    return; // Skip spawning normal trail for this frame since it exploded
                }
            }

            // If it passes the camera (Z > 30), recycle it back to the horizon
            if (orb.position.z > 30) {
                orb.position.z = -250 - Math.random() * 50;
                orb.baseX = (Math.random() - 0.5) * CORRIDOR_WIDTH;
                orb.baseY = (Math.random() - 0.5) * CORRIDOR_HEIGHT;
                orb.speed = 55.0 + Math.random() * 35.0;
                orb.angle = Math.random() * Math.PI * 2;
                orb.orbitalSpeed = (Math.random() > 0.5 ? 1 : -1) * (4.0 + Math.random() * 5.0);
                orb.amplitude = 1.0 + Math.random() * 1.5;
                orb.color.copy(colors[Math.floor(Math.random() * colors.length)]);
            }

            // Spawn a trail particle at the orb's new position
            spawnTrailParticle(orb.position, orb.color);
        });

        // -- Trail Particles Animation --
        trailData.forEach((t) => {
            if (!t.active) return;

            t.life -= delta;
            if (t.life <= 0) {
                t.active = false;
                return;
            }

            // Drift slowly in space (forming a beautiful static trail since the orb moves forward fast)
            t.position.addScaledVector(t.velocity, delta);

            // Scale shrinks over time
            const ratio = t.life / t.maxLife;
            t.scale = t.baseScale * ratio;
        });

        // -- Update Instanced Mesh Matrices & Colors --
        // Update Orbs Mesh
        if (orbsMeshRef.current) {
            orbsData.forEach((orb, i) => {
                dummy.position.copy(orb.position);
                dummy.quaternion.copy(state.camera.quaternion);

                // Pulsating magic scale for a zippy, living appearance
                const pulse = 1.0 + Math.sin(state.clock.elapsedTime * 14.0 + i) * 0.15;
                const scaleVal = 0.9 * pulse;
                dummy.scale.setScalar(scaleVal);

                dummy.updateMatrix();
                orbsMeshRef.current.setMatrixAt(i, dummy.matrix);
                orbsMeshRef.current.setColorAt(i, orb.color);
            });
            orbsMeshRef.current.instanceMatrix.needsUpdate = true;
            if (orbsMeshRef.current.instanceColor) {
                orbsMeshRef.current.instanceColor.needsUpdate = true;
            }
        }

        // Update Trails Mesh
        if (trailsMeshRef.current) {
            trailData.forEach((t, i) => {
                if (t.active) {
                    dummy.position.copy(t.position);
                    dummy.quaternion.copy(state.camera.quaternion);
                    dummy.scale.setScalar(t.scale);

                    dummy.updateMatrix();
                    trailsMeshRef.current.setMatrixAt(i, dummy.matrix);
                    trailsMeshRef.current.setColorAt(i, t.color);
                } else {
                    dummy.scale.setScalar(0.0);
                    dummy.updateMatrix();
                    trailsMeshRef.current.setMatrixAt(i, dummy.matrix);
                }
            });
            trailsMeshRef.current.instanceMatrix.needsUpdate = true;
            if (trailsMeshRef.current.instanceColor) {
                trailsMeshRef.current.instanceColor.needsUpdate = true;
            }
        }
    });

    return (
        <group>
            {/* 1. Magical Orbs (Hadas) */}
            <instancedMesh ref={orbsMeshRef} args={[null, orbMaterial, MAX_ORBS]} frustumCulled={false}>
                <planeGeometry args={[1, 1]} />
            </instancedMesh>

            {/* 2. Fairy Dust Trails */}
            <instancedMesh ref={trailsMeshRef} args={[null, trailMaterial, MAX_TRAIL_PARTICLES]} frustumCulled={false}>
                <planeGeometry args={[1, 1]} />
            </instancedMesh>
        </group>
    );
}
