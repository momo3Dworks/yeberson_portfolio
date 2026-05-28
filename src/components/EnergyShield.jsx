import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import * as tsl from 'three/tsl';

const MAX_HITS = 20;        // Circular buffer slots (user changed to 8)
const SHIELD_RADIUS = 5.0;
const RING_SPEED = 3.93;   // rad/s — crosses full sphere (π rad) in ~0.8s
const TOTAL_LIFE = 0.7;    // seconds — total duration per hit

export default function EnergyShield({ shieldHitsRef }) {

    // Per-hit uniforms: normalized direction (vec3) + timestamp (float)
    const hitUniforms = useMemo(() => {
        const pts = [];
        const times = [];
        for (let i = 0; i < MAX_HITS; i++) {
            pts.push(tsl.uniform(new THREE.Vector3(0, 1, 0)));
            times.push(tsl.uniform(-999.0));
        }
        return { pts, times };
    }, []);

    const elapsedU = useMemo(() => tsl.uniform(0.0), []);

    const material = useMemo(() => {
        const mat = new THREE.MeshBasicNodeMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        // =====================================================================
        // 1. HEXAGONAL GRID
        //    Scale UVs: [18, 9] → ~18 hex columns around the sphere equator
        // =====================================================================
        const hexUV = tsl.uv().mul(tsl.vec2(18.0, 9.0));

        const hexR = tsl.vec2(1.0, 1.7320508); // [1, sqrt(3)] — hex repeat vector
        const hexH = hexR.mul(0.5);

        const hexA = tsl.mod(hexUV, hexR).sub(hexH);
        const hexB = tsl.mod(hexUV.sub(hexH), hexR).sub(hexH);

        // Nearest hex center: pick whichever offset lattice is closer
        const nearestHex = tsl.select(
            tsl.dot(hexA, hexA).lessThan(tsl.dot(hexB, hexB)),
            hexA,
            hexB
        );
        const hexDist = tsl.length(nearestHex); // 0 at center, ~0.5 at edge

        // onLine = 1 on grid lines, 0 inside the hex face
        // Thin lines: smoothstep range [0.42, 0.48] → ~14% of cell width
        const hexLineFactor = tsl.smoothstep(tsl.float(0.42), tsl.float(0.48), hexDist);
        const onLine = tsl.float(1.0).sub(hexLineFactor);

        // =====================================================================
        // 2. RIPPLE WAVES — one expanding ring per hit
        //
        // For a surface point at angular distance `angDist` from the impact:
        //   • Ring arrives at:          t_arrive = angDist / RING_SPEED
        //   • Time since ring passed:   age - t_arrive  (negative = ring hasn't arrived)
        //
        // Leading edge:  bright narrow ring at angDist == ringRadius
        // Trailing hex:  hex lines glow and decay exponentially after ring passes them
        //                creating the "reveal then fade" effect
        // =====================================================================
        const surfaceDir = tsl.normalize(tsl.positionLocal);

        // We accumulate two signals independently:
        //   ringAccum → leading ring brightness (fills hex faces too)
        //   trailAccum → hex-line reveal behind the ring
        let ringAccum = tsl.float(0.0);
        let trailAccum = tsl.float(0.0);

        for (let i = 0; i < MAX_HITS; i++) {
            const age = elapsedU.sub(hitUniforms.times[i]); // seconds since this hit

            // Active gate: 1 while [0, TOTAL_LIFE], 0 otherwise
            const isActive = tsl.step(tsl.float(0.0), age)
                .mul(tsl.float(1.0).sub(tsl.step(tsl.float(TOTAL_LIFE), age)));

            // Angular distance from this surface point to the hit direction
            const hitDir = tsl.normalize(hitUniforms.pts[i]);
            const cosA = tsl.clamp(tsl.dot(surfaceDir, hitDir), -1.0, 1.0);
            const angDist = tsl.acos(cosA); // [0, π]

            // --- Leading ring ---
            const ringRadius = age.mul(tsl.float(RING_SPEED)); // expands from 0 to ~3.93×0.9 ≈ 3.54 rad
            const distToRing = tsl.abs(angDist.sub(ringRadius));
            const ringEdge = tsl.smoothstep(tsl.float(0.22), tsl.float(0.0), distToRing);

            // Overall envelope: start sharp, fade in the final 40% of lifetime
            const envelope = tsl.smoothstep(tsl.float(TOTAL_LIFE), tsl.float(TOTAL_LIFE * 0.6), age);

            ringAccum = ringAccum.add(ringEdge.mul(isActive).mul(envelope));

            // --- Trailing hex reveal ---
            // timeSincePassed: how long ago the ring swept through this exact surface point
            // Negative → ring hasn't arrived yet → no trail
            const timeSincePassed = age.sub(angDist.div(tsl.float(RING_SPEED)));

            // step(0, timeSincePassed) = 1 once the ring has passed; 0 before
            const ringPassed = tsl.step(tsl.float(0.0), timeSincePassed);

            // Exponential decay: fast fade (τ ≈ 0.2s) so trail disappears within ~0.6s
            const trailDecay = tsl.exp(timeSincePassed.negate().mul(tsl.float(5.0)));

            // Only light up the hex grid lines (not the faces)
            const trailContrib = ringPassed.mul(trailDecay).mul(onLine).mul(isActive).mul(envelope);
            trailAccum = trailAccum.add(trailContrib);
        }

        ringAccum = tsl.clamp(ringAccum, 0.0, 1.0);
        trailAccum = tsl.clamp(trailAccum, 0.0, 1.0);

        // =====================================================================
        // 3. COLOR — completely invisible at rest
        // =====================================================================

        // Leading ring: hot white-cyan flash (high emission for Bloom)
        // Reduced emission intensity for subtler pulse effect
        const ringColor = tsl.color("#aaffff").mul(ringAccum).mul(tsl.float(1.2));

        const trailColor = tsl.color("#00bbff").mul(trailAccum).mul(tsl.float(0.9));

        // Small inner core bloom at impact zone (ring origin is brightest)
        const totalEmit = ringColor.add(trailColor);
        mat.colorNode = totalEmit;

        // Opacity — ZERO at rest, driven entirely by ripple
        const ringOpacity = ringAccum.mul(tsl.float(0.90));  // very opaque at wave front
        const trailOpacity = trailAccum.mul(tsl.float(0.55)); // semi-transparent trail
        mat.opacityNode = tsl.clamp(ringOpacity.add(trailOpacity), 0.0, 1.0);

        return mat;
    }, [hitUniforms, elapsedU]);

    // Sync uniforms from the shared CPU hit buffer every frame
    useFrame((state) => {
        elapsedU.value = state.clock.elapsedTime;

        if (shieldHitsRef?.current?.hits) {
            const hits = shieldHitsRef.current.hits;
            // Only read up to however many slots the App created
            const len = Math.min(MAX_HITS, hits.length);
            for (let i = 0; i < len; i++) {
                if (hits[i]) {
                    hitUniforms.pts[i].value.copy(hits[i].localPoint);
                    hitUniforms.times[i].value = hits[i].time;
                }
            }
        }
    });

    return (
        // Lives inside <group ref={shipRef}> → follows the ship exactly
        <mesh position={[0, 0, 0.5]} frustumCulled={false}>
            <sphereGeometry args={[SHIELD_RADIUS, 48, 48]} />
            <primitive object={material} attach="material" />
        </mesh>
    );
}
