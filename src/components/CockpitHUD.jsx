import React, { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';

/**
 * CockpitHUD — Minimalist videogame cockpit overlay.
 * Visual language matches SpeedometerHUD (brutalist clip-paths, solid headers, grid displays).
 *
 * Desktop: full 4-panel layout (top / left / right / bottom)
 * Mobile (≤768px): top bar (status only) + bottom bar (thrust+roll) + 3 mini bars
 *
 * Architecture: direct DOM mutation in useFrame — zero React re-renders per frame.
 */

// ── Design tokens (identical to SpeedometerHUD) ───────────────────────────────
const C = {
  bg: '#020c14',
  border: '#00f0ff',
  accent: '#00f0ff',
  accent2: '#ff00cc',
  green: '#00ff88',
  amber: '#ffaa00',
  red: '#ff4400',
  text: '#8ab8cc',
  dim: 'rgba(0,240,255,0.05)',
  dimBorder: 'rgba(0,240,255,0.14)',
  shadow: 'rgba(0,240,255,0.13)',
};

const TOP_H = 36;
const LEFT_W = 112;
const RIGHT_W = 112;
const BOT_H = 46;
const SPD_W = 246; // speedometer widget width + its right margin

// ── Reusable sub-components ───────────────────────────────────────────────────

/** Solid accent header strip — matches SpeedometerHUD's "▶▶ VELOCITY.SYS" style */
const PanelHeader = ({ children }) => (
  <div style={{
    background: C.accent,
    color: '#020c14',
    padding: '4px 10px',
    fontFamily: "'Orbitron', monospace",
    fontWeight: '900',
    fontSize: '8px',
    letterSpacing: '2px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
  }}>
    {children}
  </div>
);

/** Subtle dot-grid background — same as SpeedometerHUD's speed box */
const GridBg = () => (
  <div style={{
    position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
    backgroundImage:
      'linear-gradient(rgba(0,240,255,0.045) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(0,240,255,0.045) 1px, transparent 1px)',
    backgroundSize: '18px 18px',
  }} />
);

/** Scanlines — same as SpeedometerHUD */
const Scanlines = () => (
  <div style={{
    position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 10,
    background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.18) 2px, rgba(0,0,0,0.18) 3px)',
  }} />
);

/** Glow bar row (shield/hull/energy) */
const BarRow = ({ label, barRef, pctRef, barColor = C.accent, initialW = 80, pctColor }) => (
  <div style={{ marginBottom: '7px' }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px', fontSize: '8px' }}>
      <span style={{ color: C.text, letterSpacing: '0.5px' }}>{label}</span>
      <span ref={pctRef} style={{ color: pctColor ?? barColor, fontFamily: "'Orbitron', monospace", fontSize: '8px' }}>
        {initialW}%
      </span>
    </div>
    <div style={{ height: '3px', background: 'rgba(0,240,255,0.06)', overflow: 'hidden', border: `1px solid ${C.dimBorder}` }}>
      <div ref={barRef} style={{
        height: '100%', width: `${initialW}%`,
        background: barColor, boxShadow: `0 0 6px ${barColor}`,
        transition: 'none',
      }} />
    </div>
  </div>
);

/** Big Orbitron readout with grid behind it — matches SpeedometerHUD speed box */
const DisplayBox = ({ children, style }) => (
  <div style={{
    position: 'relative',
    background: 'rgba(0,240,255,0.025)',
    border: `1px solid ${C.dimBorder}`,
    padding: '4px 8px',
    ...style,
  }}>
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      backgroundImage:
        'linear-gradient(rgba(0,240,255,0.05) 1px, transparent 1px),' +
        'linear-gradient(90deg, rgba(0,240,255,0.05) 1px, transparent 1px)',
      backgroundSize: '12px 12px',
    }} />
    <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────

export default function CockpitHUD({ sharedHUD }) {

  // ── Top bar ─────────────────────────────────────────────────────────────────
  const coordXRef = useRef(null);
  const coordYRef = useRef(null);
  const headingRef = useRef(null);
  const pitchRef = useRef(null);
  const topStatusRef = useRef(null);
  const timeRef = useRef(null);

  // ── Left panel ──────────────────────────────────────────────────────────────
  const shieldBarRef = useRef(null);
  const shieldPctRef = useRef(null);
  const hullBarRef = useRef(null);
  const hullPctRef = useRef(null);
  const energyBarRef = useRef(null);
  const energyPctRef = useRef(null);
  const altRef = useRef(null);

  // ── Right panel ─────────────────────────────────────────────────────────────
  const gforceRef = useRef(null);
  const warpBarRef = useRef(null);
  const warpPctRef = useRef(null);
  const driftRef = useRef(null);
  const threatRef = useRef(null);

  // ── Bottom bar ──────────────────────────────────────────────────────────────
  const rollRef = useRef(null);
  const thrustRef = useRef(null);
  const tapeRef = useRef(null);
  const tapeLabelRefs = useRef([]);

  // ── Mobile-only mini bars ───────────────────────────────────────────────────
  const mShieldRef = useRef(null);
  const mHullRef = useRef(null);
  const mEnergyRef = useRef(null);

  // ── Smooth internal state ────────────────────────────────────────────────────
  const sv = useRef({
    heading: 247, pitch: 0, roll: 0, altitude: 12450,
    shield: 82, hull: 94, energy: 71, gforce: 1.0,
    warpCharge: 8, drift: 0, thrust: 45,
    coordX: -247.3, coordY: 891.2,
  });

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
  const f1 = (n) => n.toFixed(1);
  const sign = (n) => n >= 0 ? '+' : '';

  useFrame((_, delta) => {
    const hud = sharedHUD?.current ?? {};
    const mx = hud.mouseX ?? 0;
    const my = hud.mouseY ?? 0;
    const cs = hud.cursorSpeed ?? 0;
    const scv = hud.scrollVelocity ?? 0;
    const s = sv.current;

    // ── Compute targets ─────────────────────────────────────────────────────
    const tHeading = 247 + mx * 36;
    const tPitch = my * -4.8;
    const tRoll = mx * 7.5;
    const tAlt = 12450 - my * 780;
    const tDrift = cs * 17;
    const tGforce = 1.0 + scv * 2.4 + cs * 0.45;
    const tWarp = Math.min(100, s.warpCharge + scv * delta * 38);
    const tEnergy = Math.max(32, 71 - scv * 24 - cs * 2.5);
    const tThrust = 45 + scv * 55;
    const tShield = 82 + Math.sin(Date.now() * 0.00038) * 4.5;
    const tHull = 94 + Math.sin(Date.now() * 0.00022) * 2;
    const tCoordX = -247.3 + mx * 13;
    const tCoordY = 891.2 - my * 9;

    // ── Lerp all ────────────────────────────────────────────────────────────
    s.heading = lerp(s.heading, tHeading, delta * 4);
    s.pitch = lerp(s.pitch, tPitch, delta * 4);
    s.roll = lerp(s.roll, tRoll, delta * 4);
    s.altitude = lerp(s.altitude, tAlt, delta * 1.5);
    s.drift = lerp(s.drift, tDrift, delta * 5);
    s.gforce = lerp(s.gforce, tGforce, delta * 6);
    s.warpCharge = lerp(s.warpCharge, tWarp, delta * 1);
    s.energy = lerp(s.energy, tEnergy, delta * 3);
    s.thrust = lerp(s.thrust, tThrust, delta * 4);
    s.shield = lerp(s.shield, tShield, delta * 0.6);
    s.hull = lerp(s.hull, tHull, delta * 0.4);
    s.coordX = lerp(s.coordX, tCoordX, delta * 2);
    s.coordY = lerp(s.coordY, tCoordY, delta * 2);

    const hdg = ((s.heading % 360) + 360) % 360;
    const shPct = s.shield.toFixed(0);
    const hlPct = s.hull.toFixed(0);
    const enPct = s.energy.toFixed(0);

    // ── Top bar ─────────────────────────────────────────────────────────────
    if (headingRef.current)
      headingRef.current.textContent = `HDG ${f1(hdg).padStart(6, '0')}°`;
    if (pitchRef.current)
      pitchRef.current.textContent = `PCH ${sign(s.pitch)}${f1(s.pitch)}°`;
    if (coordXRef.current)
      coordXRef.current.textContent = `${sign(s.coordX)}${s.coordX.toFixed(1)}`;
    if (coordYRef.current)
      coordYRef.current.textContent = `${sign(s.coordY)}${s.coordY.toFixed(1)}`;
    if (timeRef.current)
      timeRef.current.textContent = new Date().toTimeString().slice(0, 8);

    if (topStatusRef.current) {
      if (scv > 0.5) {
        topStatusRef.current.textContent = '⚡ BOOST';
        topStatusRef.current.style.color = C.accent2;
      } else if (cs > 0.4) {
        topStatusRef.current.textContent = '◎ MANEUVER';
        topStatusRef.current.style.color = C.amber;
      } else {
        topStatusRef.current.textContent = '● CRUISE';
        topStatusRef.current.style.color = C.green;
      }
    }

    // ── Left panel ──────────────────────────────────────────────────────────
    if (shieldBarRef.current) shieldBarRef.current.style.width = `${shPct}%`;
    if (shieldPctRef.current) shieldPctRef.current.textContent = `${shPct}%`;
    if (hullBarRef.current) hullBarRef.current.style.width = `${hlPct}%`;
    if (hullPctRef.current) hullPctRef.current.textContent = `${hlPct}%`;

    if (energyBarRef.current) {
      energyBarRef.current.style.width = `${enPct}%`;
      energyBarRef.current.style.background = s.energy < 42 ? C.red : s.energy < 55 ? C.amber : C.accent;
    }
    if (energyPctRef.current) {
      energyPctRef.current.textContent = `${enPct}%`;
      energyPctRef.current.style.color = s.energy < 42 ? C.red : s.energy < 55 ? C.amber : C.accent;
    }
    if (altRef.current)
      altRef.current.textContent = `${Math.round(s.altitude).toLocaleString()} m`;

    // ── Right panel ─────────────────────────────────────────────────────────
    if (gforceRef.current) {
      gforceRef.current.textContent = `${s.gforce.toFixed(1)}g`;
      gforceRef.current.style.color = s.gforce > 3.2 ? C.red : s.gforce > 2 ? C.amber : C.green;
      gforceRef.current.style.textShadow = `0 0 16px ${s.gforce > 3.2 ? C.red : s.gforce > 2 ? C.amber : C.green}`;
    }
    if (warpBarRef.current) warpBarRef.current.style.width = `${s.warpCharge.toFixed(0)}%`;
    if (warpPctRef.current) warpPctRef.current.textContent = `${s.warpCharge.toFixed(0)}%`;
    if (driftRef.current) driftRef.current.textContent = `${s.drift.toFixed(1)} m/s`;

    if (threatRef.current) {
      const lvl = cs > 1.8 ? 'HIGH' : cs > 0.5 ? 'MOD' : 'LOW';
      threatRef.current.textContent = lvl;
      threatRef.current.style.color = cs > 1.8 ? C.red : cs > 0.5 ? C.amber : C.green;
    }

    // ── Bottom bar ──────────────────────────────────────────────────────────
    if (rollRef.current)
      rollRef.current.textContent = `ROLL ${sign(s.roll)}${f1(s.roll)}°`;
    if (thrustRef.current)
      thrustRef.current.textContent = `THRUST ${s.thrust.toFixed(0)}%`;

    const baseHdg = Math.floor(s.heading / 10) * 10;
    const fineOff = ((s.heading % 10) + 10) % 10;
    tapeLabelRefs.current.forEach((el, i) => {
      if (!el) return;
      const deg = ((baseHdg + (i - 3) * 10) % 360 + 360) % 360;
      el.textContent = String(deg).padStart(3, '0');
    });
    if (tapeRef.current)
      tapeRef.current.style.transform = `translateX(${-(fineOff / 10) * 36}px)`;

    // ── Mobile mini bars ────────────────────────────────────────────────────
    if (mShieldRef.current) mShieldRef.current.style.width = `${shPct}%`;
    if (mHullRef.current) mHullRef.current.style.width = `${hlPct}%`;
    if (mEnergyRef.current) {
      mEnergyRef.current.style.width = `${enPct}%`;
      mEnergyRef.current.style.background = s.energy < 42 ? C.red : s.energy < 55 ? C.amber : C.accent;
    }
  });

  // ── Heading tape (static JSX) ────────────────────────────────────────────────
  const headingTicks = Array.from({ length: 7 }, (_, i) => (
    <div key={i} style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      width: '36px', flexShrink: 0,
    }}>
      <div ref={el => tapeLabelRefs.current[i] = el} style={{
        fontSize: i === 3 ? '10px' : '7px',
        color: i === 3 ? '#ffffff' : C.text,
        fontFamily: "'Orbitron', monospace",
        fontWeight: i === 3 ? '900' : '400',
        letterSpacing: '1px',
        marginBottom: '2px',
      }}>000</div>
      <div style={{
        width: i === 3 ? '2px' : '1px',
        height: i === 3 ? '10px' : '6px',
        background: i === 3 ? C.accent : C.dimBorder,
        boxShadow: i === 3 ? `0 0 4px ${C.accent}` : 'none',
      }} />
    </div>
  ));

  // ── Shared panel base ────────────────────────────────────────────────────────
  const panelBase = {
    background: C.bg,
    position: 'absolute',
    backdropFilter: 'blur(10px)',
    overflow: 'hidden',
  };

  return (
    <Html
      portal={{ current: document.body }}
      prepend={false}
      transform={false}
      zIndexRange={[50, 0]}
    >
      <style>{`
        @keyframes c-blink { 0%,100%{opacity:1} 50%{opacity:0.15} }
        .c-blink { animation: c-blink 1.4s step-end infinite; }

        /* Mobile: hide side panels & decoration, simplify bars */
        @media (max-width: 768px) {
          .hud-panel-left   { display: none !important; }
          .hud-panel-right  { display: none !important; }
          .hud-desktop-only { display: none !important; }
          .hud-bottom-bar   { left: 0 !important; right: 0 !important; }
          .hud-mini-bars    { display: flex !important; }
          .hud-top-nav      { display: none !important; }
          .hud-top-mission  { display: none !important; }
        }
        .hud-mini-bars { display: none; }
      `}</style>

      {/* ══ ROOT OVERLAY ══════════════════════════════════════════════════════ */}
      <div style={{
        position: 'fixed',
        inset: 0,
        pointerEvents: 'none',
        fontFamily: "'Share Tech Mono', monospace",
        color: C.text,
        fontSize: '10px',
        zIndex: 50,
        userSelect: 'none',
        // Compensate for drei Html portal transform
        bottom: '-45vh', height: '90vh',
        right: '-47vw', left: '-47vw', top: '-68vh',
      }}>

        {/* ═══ TOP BAR ══════════════════════════════════════════════════════ */}
        <div style={{
          ...panelBase,
          top: 0, left: 0, right: 0,
          height: `${TOP_H}px`,
          borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center',
          padding: '0 14px', gap: '14px',
          boxShadow: `0 2px 22px ${C.shadow}`,
          background: 'rgba(2, 12, 20, 0.82)',
        }}>

          {/* Logo / Sector */}
          <div style={{
            fontFamily: "'Orbitron', monospace", fontWeight: '900',
            color: C.accent, fontSize: '9px', letterSpacing: '2px', whiteSpace: 'nowrap',
          }}>▶▶ SECTOR-7G</div>

          <div className="hud-desktop-only" style={{ width: '1px', height: '20px', background: C.dimBorder }} />

          {/* Navigation readouts — hidden on mobile */}
          <div className="hud-top-nav" style={{ display: 'flex', gap: '12px', fontSize: '8px', whiteSpace: 'nowrap' }}>
            <span ref={headingRef} style={{ color: C.text }}>HDG 247.0°</span>
            <span ref={pitchRef} style={{ color: C.text }}>PCH +0.0°</span>
            <span style={{ color: C.dimBorder }}>│</span>
            <span style={{ color: C.text, opacity: 0.6 }}>X</span>
            <span ref={coordXRef} style={{ color: C.accent }}>-247.3</span>
            <span style={{ color: C.text, opacity: 0.6 }}>Y</span>
            <span ref={coordYRef} style={{ color: C.accent }}>+891.2</span>
          </div>

          <div style={{ flex: 1 }} />

          {/* Status — always visible */}
          <div ref={topStatusRef} className="c-blink" style={{
            fontFamily: "'Orbitron', monospace", fontWeight: '700',
            fontSize: '8px', letterSpacing: '2px', color: C.green, whiteSpace: 'nowrap',
          }}>● CRUISE</div>

          {/* Mission + Clock — desktop only */}
          <div className="hud-top-mission" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '1px', height: '20px', background: C.dimBorder }} />
            <div style={{ fontSize: '8px', whiteSpace: 'nowrap', color: C.text }}>
              MISSION: <span style={{ color: C.accent }}>DEEP TRAVERSE</span>
            </div>
            <div style={{ width: '1px', height: '20px', background: C.dimBorder }} />
            <div ref={timeRef} style={{
              fontFamily: "'Orbitron', monospace", fontWeight: '700',
              fontSize: '11px', color: C.accent, whiteSpace: 'nowrap',
            }}>00:00:00</div>
          </div>

        </div>

        {/* ═══ LEFT PANEL ═══════════════════════════════════════════════════ */}
        <div className="hud-panel-left" style={{
          ...panelBase,
          top: `${TOP_H}px`,
          left: 0,
          width: `${LEFT_W}px`,
          height: 'auto',
          borderRight: `1px solid ${C.border}`,
          boxShadow: `2px 0 22px ${C.shadow}`,
          // Brutalist corner cut — bottom-right like SpeedometerHUD
          clipPath: 'polygon(0 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%)',
        }}>
          <GridBg />
          <Scanlines />

          {/* Corner fill for clip-path cut */}
          <div style={{
            position: 'absolute', bottom: 0, right: 0, zIndex: 5,
            width: 0, height: 0, borderStyle: 'solid',
            borderWidth: '0 0 18px 18px',
            borderColor: `transparent transparent ${C.border} transparent`,
          }} />

          <div style={{ position: 'relative', zIndex: 2 }}>
            <PanelHeader>■ INTEGRITY<span style={{ fontSize: '6px', fontWeight: '400', opacity: 0.7 }}>● LIVE</span></PanelHeader>

            <div style={{ padding: '0 10px 6px' }}>
              <BarRow label="SHIELD" barRef={shieldBarRef} pctRef={shieldPctRef}
                barColor="#0088ff" pctColor="#4ab0ff" initialW={82} />
              <BarRow label="HULL" barRef={hullBarRef} pctRef={hullPctRef}
                barColor={C.green} initialW={94} />
              <BarRow label="ENERGY" barRef={energyBarRef} pctRef={energyPctRef}
                barColor={C.accent} initialW={71} />
            </div>

            <div style={{ borderTop: `1px solid ${C.dimBorder}`, margin: '0 10px' }} />

            <div style={{ padding: '8px 10px 4px' }}>
              <div style={{ color: C.text, fontSize: '7px', marginBottom: '4px', letterSpacing: '1px' }}>ALTITUDE</div>
              <DisplayBox>
                <div ref={altRef} style={{
                  fontFamily: "'Orbitron', monospace", fontWeight: '900',
                  fontSize: '18px', color: C.accent,
                  textShadow: `0 0 18px ${C.accent}, 0 0 40px ${C.accent}44`,
                  letterSpacing: '-0.5px',
                }}>12,450 m</div>
              </DisplayBox>
            </div>

            <div style={{ padding: '6px 10px 10px', fontSize: '7px' }}>
              <div style={{ color: C.text, marginBottom: '2px' }}>LIFE SUPPORT</div>
              <div style={{ color: C.green }}>● 98.2% NOMINAL</div>
            </div>
          </div>
        </div>

        {/* ═══ RIGHT PANEL ══════════════════════════════════════════════════ */}
        <div className="hud-panel-right" style={{
          ...panelBase,
          top: `${TOP_H}px`,
          right: 0,
          width: `${RIGHT_W}px`,
          height: 'auto',
          borderLeft: `1px solid ${C.border}`,
          boxShadow: `-2px 0 22px ${C.shadow}`,
          // Brutalist corner cut — bottom-left
          clipPath: 'polygon(0 0, 100% 0, 100% 100%, 18px 100%, 0 calc(100% - 18px))',
        }}>
          <GridBg />
          <Scanlines />

          {/* Corner fill */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, zIndex: 5,
            width: 0, height: 0, borderStyle: 'solid',
            borderWidth: '0 18px 18px 0',
            borderColor: `transparent ${C.border} transparent transparent`,
          }} />

          <div style={{ position: 'relative', zIndex: 2 }}>
            <PanelHeader>■ SYSTEMS<span style={{ fontSize: '6px', fontWeight: '400', opacity: 0.7 }}>● ACT</span></PanelHeader>

            {/* Warp charge */}
            <div style={{ padding: '0 10px 6px', fontSize: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span style={{ color: C.text, letterSpacing: '0.5px' }}>WARP CHARGE</span>
                <span ref={warpPctRef} style={{ color: C.accent2, fontFamily: "'Orbitron', monospace", fontSize: '8px' }}>8%</span>
              </div>
              <div style={{ height: '3px', background: 'rgba(255,0,204,0.08)', overflow: 'hidden', border: `1px solid rgba(255,0,204,0.2)` }}>
                <div ref={warpBarRef} style={{
                  height: '100%', width: '8%',
                  background: C.accent2, boxShadow: `0 0 6px ${C.accent2}`, transition: 'none',
                }} />
              </div>
              <div style={{ color: C.text, fontSize: '6px', letterSpacing: '1px', marginTop: '3px', opacity: 0.7 }}>▲ SCROLL TO CHARGE</div>
            </div>

            <div style={{ borderTop: `1px solid ${C.dimBorder}`, margin: '2px 10px 8px' }} />

            {/* G-Force big display */}
            <div style={{ padding: '0 10px 6px' }}>
              <div style={{ color: C.text, fontSize: '7px', marginBottom: '4px', letterSpacing: '1px' }}>G-FORCE</div>
              <DisplayBox>
                <div ref={gforceRef} style={{
                  fontFamily: "'Orbitron', monospace", fontWeight: '900',
                  fontSize: '26px', color: C.green,
                  textShadow: `0 0 18px ${C.green}`,
                  lineHeight: 1, letterSpacing: '-0.5px',
                }}>1.0g</div>
              </DisplayBox>
            </div>

            <div style={{ borderTop: `1px solid ${C.dimBorder}`, margin: '2px 10px 6px' }} />

            {/* Drift + Threat */}
            <div style={{ padding: '0 10px 8px', fontSize: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}>
                <span style={{ color: C.text }}>LAT. DRIFT</span>
                <span ref={driftRef} style={{ color: C.amber }}>0.0 m/s</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: C.text }}>THREAT</span>
                <span ref={threatRef} style={{ color: C.green }}>LOW</span>
              </div>
            </div>

            <div style={{ padding: '6px 10px 10px', fontSize: '7px', borderTop: `1px solid ${C.dimBorder}`, margin: '0 10px' }}>
              <div style={{ marginTop: '6px', color: C.green }}>● SENSORS 360°</div>
            </div>
          </div>
        </div>

        {/* ═══ BOTTOM BAR ═══════════════════════════════════════════════════ */}
        <div className="hud-bottom-bar" style={{
          ...panelBase,
          bottom: 0,
          left: `${LEFT_W}px`,
          right: `${SPD_W}px`,
          height: `${BOT_H}px`,
          borderTop: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center',
          padding: '0 12px', gap: '10px',
          boxShadow: `0 -2px 22px ${C.shadow}`,
          background: 'rgba(2, 12, 20, 0.82)',
        }}>

          {/* Roll */}
          <div ref={rollRef} style={{
            whiteSpace: 'nowrap', fontSize: '8px',
            fontFamily: "'Orbitron', monospace", minWidth: '72px', color: C.text,
          }}>ROLL +0.0°</div>

          <div style={{ width: '1px', height: '28px', background: C.dimBorder }} />

          {/* Thrust */}
          <div ref={thrustRef} style={{
            whiteSpace: 'nowrap',
            fontFamily: "'Orbitron', monospace",
            fontSize: '9px', fontWeight: '700', color: C.accent,
          }}>THRUST 45%</div>

          <div className="hud-desktop-only" style={{ width: '1px', height: '28px', background: C.dimBorder }} />

          {/* Heading tape — desktop only */}
          <div className="hud-desktop-only" style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', overflow: 'hidden',
          }}>
            <div style={{ fontSize: '6px', color: C.text, letterSpacing: '2px', marginBottom: '2px', opacity: 0.45 }}>
              ── HDG TAPE ──
            </div>
            <div style={{ position: 'relative', overflow: 'hidden', width: '100%' }}>
              {/* Center marker */}
              <div style={{
                position: 'absolute', top: 0, left: '50%',
                transform: 'translateX(-50%)',
                width: '2px', height: '100%',
                background: C.accent, boxShadow: `0 0 4px ${C.accent}`, zIndex: 2,
              }} />
              <div ref={tapeRef} style={{ display: 'flex', justifyContent: 'center' }}>
                {headingTicks}
              </div>
            </div>
          </div>

          <div className="hud-desktop-only" style={{ width: '1px', height: '28px', background: C.dimBorder }} />

          {/* Orbs counter — desktop only */}
          <div className="hud-desktop-only" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
            <div style={{ color: C.text, opacity: 0.5, fontSize: '6px', marginBottom: '2px' }}>ORBS</div>
            <div style={{
              fontFamily: "'Orbitron', monospace", fontWeight: '700',
              fontSize: '11px', color: C.accent,
            }}>03</div>
          </div>

        </div>

        {/* ═══ MOBILE MINI STATUS BARS ══════════════════════════════════════ */}
        {/* 3 thin glow bars (shield / hull / energy) shown only on mobile */}
        <div className="hud-mini-bars" style={{
          position: 'absolute',
          bottom: `${BOT_H}px`,
          left: 0, right: 0,
          height: '4px',
          gap: '2px',
          padding: '0',
          alignItems: 'stretch',
        }}>
          <div style={{ flex: 1, background: 'rgba(0,136,255,0.15)', overflow: 'hidden' }}>
            <div ref={mShieldRef} style={{
              height: '100%', width: '82%',
              background: '#0088ff', boxShadow: '0 0 4px #0088ff', transition: 'none',
            }} />
          </div>
          <div style={{ flex: 1, background: 'rgba(0,255,136,0.15)', overflow: 'hidden' }}>
            <div ref={mHullRef} style={{
              height: '100%', width: '94%',
              background: C.green, boxShadow: `0 0 4px ${C.green}`, transition: 'none',
            }} />
          </div>
          <div style={{ flex: 1, background: 'rgba(0,240,255,0.15)', overflow: 'hidden' }}>
            <div ref={mEnergyRef} style={{
              height: '100%', width: '71%',
              background: C.accent, boxShadow: `0 0 4px ${C.accent}`, transition: 'none',
            }} />
          </div>
        </div>

        {/* ═══ CORNER BRACKETS (desktop only) ══════════════════════════════ */}
        <svg className="hud-desktop-only" width="44" height="44" viewBox="0 0 44 44" style={{ position: 'absolute', top: 4, left: 4 }}>
          <polyline points="0,44 0,0 44,0" fill="none" stroke={C.border} strokeWidth="2" opacity="0.7" />
          <circle cx="0" cy="0" r="3" fill={C.accent} opacity="0.6" />
        </svg>
        <svg className="hud-desktop-only" width="44" height="44" viewBox="0 0 44 44" style={{ position: 'absolute', top: 4, right: 4 }}>
          <polyline points="44,44 44,0 0,0" fill="none" stroke={C.border} strokeWidth="2" opacity="0.7" />
          <circle cx="44" cy="0" r="3" fill={C.accent} opacity="0.6" />
        </svg>
        <svg className="hud-desktop-only" width="44" height="44" viewBox="0 0 44 44" style={{ position: 'absolute', bottom: 4, left: 4 }}>
          <polyline points="0,0 0,44 44,44" fill="none" stroke={C.border} strokeWidth="2" opacity="0.7" />
          <circle cx="0" cy="44" r="3" fill={C.accent} opacity="0.6" />
        </svg>
        <svg className="hud-desktop-only" width="44" height="44" viewBox="0 0 44 44" style={{ position: 'absolute', bottom: 4, right: 4 }}>
          <polyline points="44,0 44,44 0,44" fill="none" stroke={C.border} strokeWidth="2" opacity="0.7" />
          <circle cx="44" cy="44" r="3" fill={C.accent} opacity="0.6" />
        </svg>

        {/* Inner junction corners */}
        <svg className="hud-desktop-only" width="22" height="22" viewBox="0 0 22 22"
          style={{ position: 'absolute', top: `${TOP_H}px`, left: `${LEFT_W}px` }}>
          <polyline points="0,22 0,0 22,0" fill="none" stroke={C.border} strokeWidth="1" opacity="0.3" />
        </svg>
        <svg className="hud-desktop-only" width="22" height="22" viewBox="0 0 22 22"
          style={{ position: 'absolute', top: `${TOP_H}px`, right: `${SPD_W}px` }}>
          <polyline points="22,22 22,0 0,0" fill="none" stroke={C.border} strokeWidth="1" opacity="0.3" />
        </svg>
        <svg className="hud-desktop-only" width="22" height="22" viewBox="0 0 22 22"
          style={{ position: 'absolute', bottom: `${BOT_H}px`, left: `${LEFT_W}px` }}>
          <polyline points="0,0 0,22 22,22" fill="none" stroke={C.border} strokeWidth="1" opacity="0.3" />
        </svg>
        <svg className="hud-desktop-only" width="22" height="22" viewBox="0 0 22 22"
          style={{ position: 'absolute', bottom: `${BOT_H}px`, right: `${SPD_W}px` }}>
          <polyline points="22,0 22,22 0,22" fill="none" stroke={C.border} strokeWidth="1" opacity="0.3" />
        </svg>

      </div>
      {/* /ROOT OVERLAY */}
    </Html>
  );
}
