import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { MeshBasicNodeMaterial } from 'three/webgpu';

const MAX_PARTICLES = 150; // Maximum number of active smoke particles

export default function SmokeTrails({ fireRefs, cursorSpeed, speedFactor }) {
    // Load the 4 cloud textures
    const tex1 = useTexture('/assets/cloud1.jpg');
    const tex2 = useTexture('/assets/cloud2.jpg');
    const tex3 = useTexture('/assets/cloud3.jpg');
    const tex4 = useTexture('/assets/cloud4.jpg');

    const textures = [tex1, tex2, tex3, tex4];

    // Pre-allocate meshes and metadata
    const particles = useMemo(() => {
        const arr = [];
        const geometry = new THREE.PlaneGeometry(1, 1);

        for (let i = 0; i < MAX_PARTICLES; i++) {
            const tex = textures[i % 4];

            const material = new MeshBasicNodeMaterial({
                map: tex,
                transparent: true,
                depthWrite: false,
                blending: THREE.AdditiveBlending,
                color: new THREE.Color("#ffaa10"), // Naranja brillante
            });

            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            // Evitar que el frustum culling los esconda si el bounding box inicial es erróneo
            mesh.frustumCulled = false;

            // Metadatos para la lógica de partículas
            mesh.userData = {
                active: false,
                life: 0,
                maxLife: 1,
                velocity: new THREE.Vector3(),
                rotSpeed: 0.8,
                currentRot: 0,
                baseScale: 1
            };

            arr.push(mesh);
        }
        return arr;
    }, [textures]);

    const groupRef = useRef();
    const particleIndex = useRef(0);
    const spawnTimer = useRef(0);
    const worldPos = useMemo(() => new THREE.Vector3(), []);

    useFrame((state, delta) => {
        // -- Lógica de Spawning --
        spawnTimer.current += delta;
        // Cursor speed factor (0–1)
        const cursorFactor = Math.min(cursorSpeed.current, 2.0) / 2.0;
        // Scroll impulse factor (0–1) — boosts spawn when scrolling
        const scrollFactor = speedFactor?.current ?? 0;
        const combinedFactor = Math.max(cursorFactor, scrollFactor);
        const spawnRate = THREE.MathUtils.lerp(0.08, 0.015, combinedFactor);

        if (spawnTimer.current > spawnRate) {
            spawnTimer.current = 0;

            // Intentar spawnear un humo por cada propulsor válido
            if (fireRefs && fireRefs.current) {
                fireRefs.current.forEach((fire) => {
                    if (!fire) return;

                    const p = particles[particleIndex.current];
                    if (!p) return;

                    // Obtener la posición en el mundo de este propulsor
                    fire.getWorldPosition(worldPos);

                    // Convertir la posición del mundo al espacio local del grupo de partículas
                    if (groupRef.current) {
                        groupRef.current.worldToLocal(worldPos);
                    }

                    p.position.copy(worldPos);

                    // Pequeña variación aleatoria para que no salgan en línea recta perfecta
                    p.position.x += (Math.random() - 0.5) * 0.5;
                    p.position.y += (Math.random() - 0.5) * 0.5;

                    // Activación de la partícula
                    p.userData.active = true;
                    p.userData.maxLife = 0.8 + Math.random() * 0.6; // Entre 0.8 y 1.4 segundos de vida
                    p.userData.life = p.userData.maxLife;

                    // Velocidad de la partícula (se mueve hacia atrás, es decir, +Z relativo a la nave, 
                    // o Z del mundo ya que la cámara está bastante fija en Z)
                    p.userData.velocity.set(
                        (Math.random() - 0.5) * 1.5, // Drift en X
                        (Math.random() - 0.5) * 1.5, // Drift en Y
                        3.0 + Math.random() * 4.0    // Velocidad hacia atrás en Z
                    );

                    // Rotación aleatoria inicial y velocidad de giro
                    p.userData.currentRot = Math.random() * Math.PI * 2;
                    p.userData.rotSpeed = (Math.random() - 0.5) * 2.0;

                    // Escala inicial
                    p.userData.baseScale = 0.5 + Math.random() * 1.0;
                    p.scale.setScalar(p.userData.baseScale);

                    // Color: blend toward magenta when scroll impulse is active
                    const scrollF = speedFactor?.current ?? 0;
                    const baseColor = new THREE.Color("#ffaa10"); // naranja
                    const boostColor = new THREE.Color("#ff00cc"); // magenta
                    p.material.color.copy(baseColor).lerp(boostColor, scrollF);

                    // Opacidad
                    p.material.opacity = 1.0;
                    p.visible = true;

                    // Avanzar índice
                    particleIndex.current = (particleIndex.current + 1) % MAX_PARTICLES;
                });
            }
        }

        // -- Lógica de Animación/Update --
        particles.forEach(p => {
            if (p.userData.active) {
                p.userData.life -= delta;

                if (p.userData.life <= 0) {
                    p.userData.active = false;
                    p.visible = false;
                } else {
                    // Mover según su velocidad
                    p.position.addScaledVector(p.userData.velocity, delta);

                    // Billboarding: Hacer que el plano siempre mire a la cámara
                    p.quaternion.copy(state.camera.quaternion);

                    // Girar sobre su propio eje Z para mantener el efecto de humo rotando
                    p.userData.currentRot += p.userData.rotSpeed * delta;
                    p.rotateZ(p.userData.currentRot);

                    // El ratio va de 1 (nace) a 0 (muere)
                    const lifeRatio = p.userData.life / p.userData.maxLife;
                    const invRatio = 1.0 - lifeRatio;

                    // Crece a medida que se disipa (hasta 3 veces más grande)
                    const currentScale = p.userData.baseScale + invRatio * 3.0;
                    p.scale.setScalar(currentScale);

                    // Fade out: Empieza rápido y luego decae suavemente
                    p.material.opacity = Math.pow(lifeRatio, 1.5) * 0.6; // Max 60% opacity para additive
                }
            }
        });
    });

    return (
        <group ref={groupRef}>
            {particles.map((p, i) => (
                <primitive key={i} object={p} />
            ))}
        </group>
    );
}
