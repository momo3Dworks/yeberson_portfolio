import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import * as tsl from 'three/tsl';
import { MeshBasicNodeMaterial } from 'three/webgpu';

const COUNT = 600; // Número de partículas
const BOUNDS = 180; // Área de esparcimiento

export default function SpeedParticles({ shipRef, cursorSpeed }) {
    const meshRef = useRef();

    // Uniform para pasarle al GPU la posición real de la nave en el mundo
    const shipWorldPos = useMemo(() => tsl.uniform(new THREE.Vector3()), []);

    // Generar datos aleatorios para cada partícula
    const particlesData = useMemo(() => {
        const data = [];
        for (let i = 0; i < COUNT; i++) {
            data.push({
                position: new THREE.Vector3(
                    (Math.random() - 0.5) * BOUNDS, // X
                    (Math.random() - 0.5) * BOUNDS, // Y
                    (Math.random() - 0.5) * 400 - 100 // Z: esparcidas desde lejos (-300) hasta la cámara (+50)
                ),
                speed: 40 + Math.random() * 80, // Velocidades variadas
                scale: 0.05 + Math.random() * 0.3 // Tamaños variados, la mayoría pequeños
            });
        }
        return data;
    }, []);

    const dummy = useMemo(() => new THREE.Object3D(), []);
    const tempVec3 = useMemo(() => new THREE.Vector3(), []);

    // Material con TSL para calcular la emisión en el GPU según proximidad
    const material = useMemo(() => {
        const mat = new MeshBasicNodeMaterial({
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false
        });

        // TSL: Distancia entre el píxel actual y la posición de la nave
        const dist = tsl.distance(tsl.positionWorld, shipWorldPos);

        // Factor de brillo: si está a < 25 unidades de distancia, empieza a brillar
        const glowFactor = tsl.clamp(tsl.float(25.0).sub(dist), 0.0, 25.0).div(25.0);

        // Hacemos que el brillo suba exponencialmente cuando está muy cerca
        const intenseGlow = tsl.pow(glowFactor, 23.0);

        // Colores base y de emisión
        const baseColor = tsl.color("#333344"); // Color grisáceo/azulado muy tenue para el fondo
        const emitColor = tsl.color("#00eeff").mul(5.0); // Cyan súper brillante con intensidad x5

        // Mezclamos el color base con el color de emisión basándonos en qué tan cerca pasó de la nave
        mat.colorNode = tsl.mix(baseColor, emitColor, intenseGlow);

        return mat;
    }, [shipWorldPos]);

    useFrame((state, delta) => {
        if (!meshRef.current) return;

        // 1. Actualizar el uniform con la posición real de la nave
        if (shipRef && shipRef.current) {
            shipRef.current.getWorldPosition(tempVec3);
            shipWorldPos.value.copy(tempVec3);
        }

        // 2. Modificador de velocidad global si el usuario mueve el cursor rápido
        const speedBoost = 1.0 + (cursorSpeed?.current || 0) * 0.5;

        // 3. Mover las partículas
        particlesData.forEach((p, i) => {
            // Se mueven hacia la cámara (+Z)
            p.position.z += p.speed * speedBoost * delta;

            // Si pasa la cámara (Z > 30), la reseteamos al horizonte (-300)
            if (p.position.z > 30) {
                p.position.z = -300 - Math.random() * 50;
                p.position.x = (Math.random() - 0.5) * BOUNDS;
                p.position.y = (Math.random() - 0.5) * BOUNDS;
            }

            // Actualizar la matriz de instancia para esta partícula
            dummy.position.copy(p.position);

            // Partículas redondas, pero las estiramos ligerisimamente en Z por la velocidad 
            // (puedes quitar el * speedBoost si las quieres 100% esféricas siempre)
            dummy.scale.set(p.scale, p.scale, p.scale * (1.0 + speedBoost * 0.5));

            dummy.updateMatrix();
            meshRef.current.setMatrixAt(i, dummy.matrix);
        });

        // Avisar a Three.js que actualice el buffer de instancias en el GPU
        meshRef.current.instanceMatrix.needsUpdate = true;
    });

    return (
        <instancedMesh ref={meshRef} args={[null, material, COUNT]}>
            <sphereGeometry args={[1, 16, 16]} />
        </instancedMesh>
    );
}
