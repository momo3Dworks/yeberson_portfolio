import React, { useEffect, useState, useRef } from 'react'
import { useProgress } from '@react-three/drei'
import { useThree } from '@react-three/fiber'

// ── In-Canvas Shader Pre-compiler ──────────────────────────────
// Forces WebGL GPU pipeline to pre-compile all scene materials & shaders
// before the loader curtains open, guaranteeing zero stutter on initial render.
export const ShaderCompiler: React.FC<{ onCompiled: () => void }> = ({ onCompiled }) => {
  const { gl, scene, camera } = useThree()
  const compiledRef = useRef(false)

  useEffect(() => {
    if (compiledRef.current) return

    // Allow the first fiber reconciliation frame to mount geometry & textures
    const timer = setTimeout(async () => {
      try {
        if ((gl as any).compileAsync) {
          await (gl as any).compileAsync(scene, camera)
        } else if (gl.compile) {
          gl.compile(scene, camera)
        }
      } catch (err) {
        console.warn('[ShaderCompiler] Precompile note:', err)
      }
      compiledRef.current = true
      onCompiled()
    }, 250)

    return () => clearTimeout(timer)
  }, [gl, scene, camera, onCompiled])

  return null
}

interface StudioLoaderProps {
  shadersCompiled: boolean
  onLoaded?: () => void
}

export const StudioLoader: React.FC<StudioLoaderProps> = ({
  shadersCompiled,
  onLoaded
}) => {
  const { active, progress: realAssetProgress, total, loaded } = useProgress()

  // Fake smooth progress that animates independently from 0 to 100
  const [displayProgress, setDisplayProgress] = useState(0)
  const [phaseText, setPhaseText] = useState('Iniciando motor gráfico...')
  const [isExiting, setIsExiting] = useState(false)
  const [isFinished, setIsFinished] = useState(false)

  // Real engine readiness status: assets must be fully loaded AND GPU shaders compiled
  const isEngineReady = (!active || realAssetProgress >= 100) && shadersCompiled

  useEffect(() => {
    let current = 0
    let lastTime = performance.now()
    let animId: number

    const tick = (now: number) => {
      const delta = (now - lastTime) / 1000
      lastTime = now

      if (!isEngineReady) {
        // "Fake Loader" phase: smoothly interpolates up to ~88% while waiting for real assets & shaders
        const target = Math.min(88, 15 + realAssetProgress * 0.72)
        const speed = current < target ? 35 : 8 // Advance smoothly
        current = Math.min(target, current + speed * delta)
      } else {
        // Engine is ready: accelerates fast & smoothly to 100%
        current = Math.min(100, current + 95 * delta)
      }

      setDisplayProgress(Math.floor(current))

      // Informative status phases
      if (current < 25) {
        setPhaseText('Iniciando WebGL & TSL Pipeline...')
      } else if (current < 55) {
        setPhaseText(`Cargando modelos Draco & KTX2 (${loaded}/${Math.max(total, 1)})...`)
      } else if (current < 85) {
        setPhaseText('Compilando shaders PBR, dispersión & FSR...')
      } else if (current < 99) {
        setPhaseText('Sincronizando buffers de post-procesamiento...')
      } else {
        setPhaseText('100% • Experiencia Lista')
      }

      if (current < 100) {
        animId = requestAnimationFrame(tick)
      } else {
        // Once 100% is reached, pause briefly, then trigger elegant exit animation
        setTimeout(() => {
          setIsExiting(true)
          if (onLoaded) onLoaded()
          setTimeout(() => {
            setIsFinished(true)
          }, 650)
        }, 320)
      }
    }

    animId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animId)
  }, [isEngineReady, realAssetProgress, loaded, total, onLoaded])

  if (isFinished) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#06080e',
        transition: 'opacity 0.65s cubic-bezier(0.16, 1, 0.3, 1), filter 0.65s ease, transform 0.65s ease',
        opacity: isExiting ? 0 : 1,
        filter: isExiting ? 'blur(16px)' : 'none',
        transform: isExiting ? 'scale(1.04)' : 'scale(1)',
        pointerEvents: isExiting ? 'none' : 'auto',
        overflow: 'hidden'
      }}
    >
      {/* Ambient background glow */}
      <div
        style={{
          position: 'absolute',
          width: 600,
          height: 600,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(56, 189, 248, 0.14) 0%, rgba(99, 102, 241, 0.08) 45%, transparent 70%)',
          pointerEvents: 'none',
          animation: 'pulse 4s ease-in-out infinite'
        }}
      />

      {/* Main Loader Card */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          background: 'rgba(13, 18, 30, 0.75)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(56, 189, 248, 0.35)',
          borderRadius: 16,
          padding: '36px 44px',
          boxShadow: '0 0 50px rgba(56, 189, 248, 0.18), inset 0 0 20px rgba(56, 189, 248, 0.06)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
          minWidth: 360,
          maxWidth: '90vw',
          textAlign: 'center'
        }}
      >
        {/* Header Titles */}
        <div>
          <div
            style={{
              fontSize: 18,
              fontWeight: 800,
              letterSpacing: 3,
              color: '#f8fafc',
              textTransform: 'uppercase',
              textShadow: '0 0 20px rgba(56, 189, 248, 0.5)'
            }}
          >
            Yeberson Orta
          </div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 2,
              color: '#38bdf8',
              marginTop: 4,
              textTransform: 'uppercase'
            }}
          >
            Creative Developer • 3D Studio
          </div>
        </div>

        {/* Progress Bar Container */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            style={{
              width: '100%',
              height: 6,
              background: 'rgba(255, 255, 255, 0.08)',
              borderRadius: 3,
              overflow: 'hidden',
              position: 'relative',
              boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.5)'
            }}
          >
            <div
              style={{
                width: `${displayProgress}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #38bdf8, #818cf8, #c084fc)',
                boxShadow: '0 0 12px rgba(56, 189, 248, 0.7)',
                transition: 'width 0.15s ease-out',
                position: 'relative'
              }}
            >
              {/* Shimmer light bar */}
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  right: 0,
                  bottom: 0,
                  width: 20,
                  background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent)'
                }}
              />
            </div>
          </div>

          {/* Percentage and State Row */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 11,
              fontFamily: 'monospace',
              color: '#94a3b8'
            }}
          >
            <span style={{ color: '#38bdf8', fontWeight: 600 }}>{phaseText}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
              {displayProgress}%
            </span>
          </div>
        </div>

        {/* Badges / Status indicators */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            fontSize: 10,
            fontFamily: 'monospace',
            color: '#64748b'
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: displayProgress > 40 ? '#22c55e' : '#f59e0b',
                boxShadow: displayProgress > 40 ? '0 0 8px #22c55e' : 'none'
              }}
            />
            Draco/KTX2
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: shadersCompiled ? '#22c55e' : '#f59e0b',
                boxShadow: shadersCompiled ? '0 0 8px #22c55e' : 'none'
              }}
            />
            Shaders GPU
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: displayProgress === 100 ? '#22c55e' : '#38bdf8',
                boxShadow: '0 0 8px #38bdf8'
              }}
            />
            FSR Pipeline
          </span>
        </div>
      </div>
    </div>
  )
}
