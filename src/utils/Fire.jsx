import React, { useRef, useMemo, useImperativeHandle, forwardRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CustomFireMesh } from './CustomFireMesh'

/**
 * Fire Component using @wolffo/three-fire TSL
 */
const Fire = forwardRef(({
    texture,
    scale = [1, 1, 1],
    color = '#fffb00ff',
    speed = 5,
    magnitude = 1.0,
    gain = 1.3,
    lacunarity = 3.2,
    iterations = 10,
    intensity = 100,
    emmisiveIntensity = 15,
    noiseScale = 1.0,
    visible = true,
    ...props
}, ref) => {
    const meshRef = useRef()

    useImperativeHandle(ref, () => meshRef.current)

    const fire = useMemo(() => {
        // Formateamos noiseScale para X,Y,Z y usamos speed para W (velocidad)
        const nsX = Array.isArray(noiseScale) ? noiseScale[0] : noiseScale;
        const nsY = Array.isArray(noiseScale) ? noiseScale[1] : noiseScale;
        const nsZ = Array.isArray(noiseScale) ? noiseScale[2] : noiseScale;

        const f = new CustomFireMesh({
            fireTex: texture,
            color: new THREE.Color(color),
            magnitude: magnitude,
            lacunarity: lacunarity,
            gain: gain,
            iterations: iterations,
            noiseScale: [nsX, nsY * 2.0, nsZ, speed * 0.06], // w is speed
        })

        // Configuración de profundidad para oclusión correcta
        if (f.material) {
            f.material.depthTest = true
            f.material.depthWrite = false
            f.material.transparent = true
        }

        return f
    }, [texture, color, magnitude, lacunarity, gain, iterations, noiseScale, speed])

    useFrame((state) => {
        if (meshRef.current) {
            meshRef.current.update(state.clock.getElapsedTime())

            if (meshRef.current.uniforms && meshRef.current.uniforms.noiseScale) {
                const nsX = Array.isArray(noiseScale) ? noiseScale[0] : noiseScale;
                const nsY = Array.isArray(noiseScale) ? noiseScale[1] : noiseScale;
                const nsZ = Array.isArray(noiseScale) ? noiseScale[2] : noiseScale;
                // Actualizar velocidad dinámicamente sin recrear la malla
                meshRef.current.uniforms.noiseScale.value.set(nsX, nsY * 2.0, nsZ, speed * 0.06);
            }

            // Actualizar intensidad si cambia dinámicamente
            if (meshRef.current.intensity !== undefined) {
                meshRef.current.intensity = intensity
            }
        }
    })

    return (
        <primitive
            ref={meshRef}
            object={fire}
            scale={scale}
            visible={visible}
            {...props}
        />
    )
})

export default Fire