import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';

/**
 * SpeedometerHUD — Brutalist Futuristic Redesign
 *
 * Speed mapping:
 *   Idle:      ~450 km/h (tiny ±2 jitter)
 *   Maneuver:  drops toward 400 km/h (cursorSpeed penalty)
 *   Boost:     random 650–675 km/h per scroll event
 *
 * Architecture: all animation via direct DOM mutation in useFrame.
 * Zero React re-renders per frame.
 */
export default function SpeedometerHUD({ sharedHUD }) {
  // DOM refs
  const containerRef = useRef(null);
  const speedNumRef = useRef(null);
  const machRef = useRef(null);
  const barFillRef = useRef(null);
  const thrustRef = useRef(null);
  const tempRef = useRef(null);
  const statusRef = useRef(null);
  const warnLineRef = useRef(null);

  // Internal state (refs — no setState)
  const displaySpeed = useRef(450);
  const prevScrollVel = useRef(0);
  const glitchTimer = useRef(0);
  const boostTarget = useRef(660);

  useEffect(() => {
    if (!document.getElementById('hud-fonts')) {
      const link = document.createElement('link');
      link.id = 'hud-fonts';
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  const lerp = (a, b, t) => a + (b - a) * Math.min(Math.max(t, 0), 1);

  useFrame((_, delta) => {
    const hud = sharedHUD?.current ?? {};
    const scrollVel = hud.scrollVelocity ?? 0;
    const cursorSpd = hud.cursorSpeed ?? 0;

    // Detect new scroll spike → randomise boost target + trigger glitch
    if (scrollVel > 0.88 && prevScrollVel.current <= 0.88) {
      boostTarget.current = 650 + Math.random() * 25;
      glitchTimer.current = 0.18;
    }
    prevScrollVel.current = scrollVel;

    // ── Compute target speed ─────────────────────────────────────────
    const jitter = (Math.random() - 0.5) * 3;          // ±1.5 ambient vibration
    const maneuverPenalty = Math.min(cursorSpd * 28, 50);       // 0..50 — mouse moves slow you
    const thrustBonus = scrollVel * (boostTarget.current - 450); // 0..225
    const targetSpeed = 450 + jitter - maneuverPenalty + thrustBonus;

    const rate = targetSpeed > displaySpeed.current ? delta * 7 : delta * 2.5;
    displaySpeed.current = lerp(displaySpeed.current, targetSpeed, rate);

    const spd = Math.round(Math.max(380, displaySpeed.current));
    const thrustPct = Math.round(((spd - 380) / (675 - 380)) * 100);
    const tempVal = Math.round(810 + scrollVel * 390 + cursorSpd * 22 + (Math.random() - 0.5) * 14);
    const mach = (spd / 1234).toFixed(2);
    const isGlitch = glitchTimer.current > 0;

    glitchTimer.current = Math.max(0, glitchTimer.current - delta);

    // ── Speed number ──────────────────────────────────────────────────
    if (speedNumRef.current) {
      const dispNum = isGlitch
        ? String(spd + Math.round((Math.random() - 0.5) * 50))
        : String(spd);
      speedNumRef.current.textContent = dispNum;

      const glitchX = isGlitch ? (Math.random() - 0.5) * 10 : 0;
      speedNumRef.current.style.transform = `translateX(${glitchX.toFixed(1)}px)`;

      // Cyan → magenta colour ramp as speed climbs
      const t = Math.max(0, Math.min(1, (spd - 400) / 275));
      const h = Math.round(190 - t * 150);
      speedNumRef.current.style.color = isGlitch ? '#ff00cc' : `hsl(${h}, 100%, 62%)`;
      speedNumRef.current.style.textShadow = isGlitch
        ? '0 0 40px #ff00cc, 0 0 80px #ff00cc'
        : `0 0 28px hsl(${h}, 100%, 60%), 0 0 70px hsl(${h}, 100%, 28%)`;
    }

    // ── Mach readout ──────────────────────────────────────────────────
    if (machRef.current) machRef.current.textContent = `MACH ${mach}`;

    // ── Bar fill (scale: 0–700 km/h, so idle 450 = 64%) ─────────────
    if (barFillRef.current) {
      const fillPct = (spd / 700) * 100;
      barFillRef.current.style.width = `${fillPct.toFixed(1)}%`;
      const t = Math.max(0, Math.min(1, (spd - 400) / 275));
      const h = Math.round(185 - t * 150);
      barFillRef.current.style.background = `linear-gradient(90deg, hsl(${h + 20},100%,40%), hsl(${h - 10},100%,65%))`;
      barFillRef.current.style.boxShadow = `0 0 ${(8 + t * 18).toFixed(0)}px hsl(${h},100%,55%)`;
    }

    // ── Thrust % ──────────────────────────────────────────────────────
    if (thrustRef.current) {
      thrustRef.current.textContent = `THRUST: ${String(Math.max(0, thrustPct)).padStart(3, ' ')}%`;
    }

    // ── Engine temp ───────────────────────────────────────────────────
    if (tempRef.current) {
      tempRef.current.textContent = `ENG.TEMP: ${tempVal}°C`;
      tempRef.current.style.color = tempVal > 1150 ? '#ff4400' : tempVal > 1000 ? '#ffaa00' : '#00ffcc';
    }

    // ── Status label ──────────────────────────────────────────────────
    if (statusRef.current) {
      if (scrollVel > 0.5) {
        statusRef.current.textContent = '⚡ BOOST ACTIVE';
        statusRef.current.style.color = '#ff00cc';
      } else if (cursorSpd > 0.4) {
        statusRef.current.textContent = '◎ MANEUVERING';
        statusRef.current.style.color = '#ffaa00';
      } else {
        statusRef.current.textContent = '● CRUISE MODE';
        statusRef.current.style.color = '#00ff88';
      }
    }

    // ── Warn line flash when boosting ─────────────────────────────────
    if (warnLineRef.current) {
      warnLineRef.current.style.opacity = scrollVel > 0.6 ? '1' : '0';
    }

    // ── Container glow intensity ──────────────────────────────────────
    if (containerRef.current) {
      const g = 10 + scrollVel * 28 + (isGlitch ? 25 : 0);
      const h = isGlitch ? 300 : Math.round(190 - scrollVel * 150);
      const bc = isGlitch ? '#ff00cc' : `hsl(${h},100%,52%)`;
      containerRef.current.style.boxShadow = `0 0 ${g}px ${bc}, 0 0 ${g * 2}px ${bc}44`;
      containerRef.current.style.borderColor = bc;
    }
  });

  return (
    <Html
      portal={{ current: document.body }}
      prepend={false}
      transform={false}
      zIndexRange={[100000, 1111110]}
    >
      <style>{`
        @keyframes spd-blink { 0%,100%{opacity:1} 50%{opacity:0.15} }
        @keyframes spd-scan  { 0%{background-position:0 0} 100%{background-position:0 100%} }
        .spd-blink { animation: spd-blink 1.3s step-end infinite; }
        .spd-scanlines {
          background: repeating-linear-gradient(
            0deg, transparent, transparent 2px,
            rgba(0,0,0,0.22) 2px, rgba(0,0,0,0.22) 3px
          );
          pointer-events: none;
        }
        @media (max-width: 1000px) {
          .spd-mobile-wrap {
            transform: scale(0.6) !important;
            transform-origin: bottom right !important;
            right: -47dvw !important;
            bottom: -22dvh !important;
          }
        }
      `}</style>

      {/* Fixed position wrapper */}
      <div className="spd-mobile-wrap" style={{ position: 'fixed', bottom: '-22vh', right: '-47vw', width: '226px', pointerEvents: 'none', zIndex: 100 }}>

        {/* ══ OUTER SHELL ══════════════════════════════════════════════ */}
        <div
          ref={containerRef}
          style={{
            background: '#020c14',
            border: '2px solid #00f0ff',
            fontFamily: "'Share Tech Mono', monospace",
            color: '#8ab8cc',
            fontSize: '10px',
            position: 'relative',
            /* Brutalist corner cuts */
            clipPath: 'polygon(0 0, calc(100% - 24px) 0, 100% 24px, 100% 100%, 24px 100%, 0 calc(100% - 24px))',
            overflow: 'hidden',
            transition: 'box-shadow 0.06s linear, border-color 0.06s linear',
            zIndex: 999999999,
          }}
        >
          {/* Scanline texture */}
          <div className="spd-scanlines" style={{ position: 'absolute', inset: 0, zIndex: 4, opacity: 0.55 }} />

          {/* Corner fill — top-right */}
          <div style={{
            position: 'absolute', top: 0, right: 0, zIndex: 5,
            width: 0, height: 0,
            borderStyle: 'solid',
            borderWidth: '24px 24px 0 0',
            borderColor: '#00f0ff transparent transparent transparent',
          }} />

          {/* Corner fill — bottom-left */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, zIndex: 5,
            width: 0, height: 0,
            borderStyle: 'solid',
            borderWidth: '0 0 24px 24px',
            borderColor: 'transparent transparent #00f0ff transparent',
          }} />

          {/* ── HEADER ─────────────────────────────────────────────── */}
          <div style={{
            background: '#00f0ff',
            color: '#020c14',
            padding: '5px 14px 5px 10px',
            fontFamily: "'Orbitron', monospace",
            fontWeight: '900',
            fontSize: '9px',
            letterSpacing: '2.5px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            position: 'relative',
            zIndex: 6,
          }}>
            <span>▶▶ VELOCITY.SYS</span>
            <span style={{ fontSize: '7px', letterSpacing: '1px', fontWeight: '400', opacity: 0.8 }}>■ ONLINE</span>
          </div>

          {/* ── SPEED DISPLAY BOX ──────────────────────────────────── */}
          <div style={{
            margin: '10px 12px 6px',
            border: '1px solid rgba(0,240,255,0.18)',
            padding: '8px 10px 6px',
            background: 'rgba(0,240,255,0.025)',
            position: 'relative',
          }}>
            {/* Grid background */}
            <div style={{
              position: 'absolute', inset: 0,
              backgroundImage:
                'linear-gradient(rgba(0,240,255,0.055) 1px, transparent 1px),' +
                'linear-gradient(90deg, rgba(0,240,255,0.055) 1px, transparent 1px)',
              backgroundSize: '18px 18px',
              pointerEvents: 'none',
            }} />

            <div style={{ position: 'relative', zIndex: 1 }}>
              <div style={{ fontSize: '7px', letterSpacing: '3px', color: 'rgba(0,240,255,0.38)', marginBottom: '1px' }}>
                km·h⁻¹ ─────────────
              </div>
              <div
                ref={speedNumRef}
                style={{
                  fontFamily: "'Orbitron', monospace",
                  fontWeight: '900',
                  fontSize: '56px',
                  color: '#00f0ff',
                  lineHeight: 1,
                  letterSpacing: '-2px',
                  textShadow: '0 0 28px #00f0ff',
                  transition: 'color 0.15s, text-shadow 0.15s',
                }}
              >450</div>
              <div
                ref={machRef}
                style={{
                  fontSize: '8px',
                  color: 'rgba(0,240,255,0.42)',
                  letterSpacing: '2px',
                  marginTop: '3px',
                  fontFamily: "'Share Tech Mono', monospace",
                }}
              >MACH 0.36</div>
            </div>
          </div>

          {/* ── BAR INDICATOR ─────────────────────────────────────── */}
          <div style={{ margin: '0 12px 4px' }}>
            <div style={{
              height: '11px',
              background: '#040f1c',
              border: '1px solid rgba(0,240,255,0.14)',
              overflow: 'hidden',
              position: 'relative',
            }}>
              <div
                ref={barFillRef}
                style={{
                  height: '100%',
                  width: '64%',  /* 450/700 */
                  background: 'linear-gradient(90deg,#00aaff,#00f0ff)',
                  boxShadow: '0 0 12px #00f0ff',
                  transition: 'none',
                }}
              />
              {/* Tick marks at 400, 500, 600, 675 km/h */}
              {[57, 71, 86, 96].map((p, i) => (
                <div key={i} style={{
                  position: 'absolute', left: `${p}%`, top: 0,
                  width: '1px', height: '100%',
                  background: 'rgba(0,240,255,0.2)',
                }} />
              ))}
              {/* Warning bar — flashes on boost */}
              <div
                ref={warnLineRef}
                style={{
                  position: 'absolute', right: 0, top: 0,
                  width: '4px', height: '100%',
                  background: '#ff00cc',
                  boxShadow: '0 0 8px #ff00cc',
                  opacity: 0,
                  transition: 'opacity 0.1s',
                }}
              />
            </div>

            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: '7px', color: 'rgba(0,240,255,0.3)',
              marginTop: '2px', letterSpacing: '0.5px',
            }}>
              <span>400</span><span>500</span><span>600</span><span>675</span>
            </div>
          </div>

          {/* ── DIVIDER ───────────────────────────────────────────── */}
          <div style={{ borderTop: '1px solid rgba(0,240,255,0.12)', margin: '4px 12px 7px' }} />

          {/* ── READOUTS ──────────────────────────────────────────── */}
          <div style={{ padding: '0 12px 10px', position: 'relative', zIndex: 6 }}>
            <div ref={thrustRef} style={{ marginBottom: '3px', letterSpacing: '1px', fontSize: '9px' }}>
              THRUST:   45%
            </div>
            <div ref={tempRef} style={{ marginBottom: '8px', letterSpacing: '1px', fontSize: '9px', color: '#00ffcc' }}>
              ENG.TEMP: 847°C
            </div>

            <div style={{ borderTop: '1px solid rgba(0,240,255,0.12)', paddingTop: '6px' }}>
              <div
                ref={statusRef}
                className="spd-blink"
                style={{
                  letterSpacing: '2px',
                  color: '#00ff88',
                  fontSize: '9px',
                  fontFamily: "'Orbitron', monospace",
                  fontWeight: '700',
                }}
              >● CRUISE MODE</div>
            </div>
          </div>

        </div>
        {/* /OUTER SHELL */}
      </div>
    </Html>
  );
}
