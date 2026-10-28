export interface TarotSectionConfig {
  /** Identificador único de la sección */
  id: string
  /** Título principal de la carta del Tarot presentada */
  title: string
  /** Subtítulo descriptivo o especialidad */
  subtitle?: string
  /** Número o índice visual de la carta (0: Creative Dev, 1: Creative Director, etc.) */
  cardIndex: number
  /** Frame inicial en la animación 'AllCards' */
  startFrame: number
  /** Frame final donde hace snap en la animación 'AllCards' */
  endFrame: number
  /** Descripción o detalles adicionales para el HUD / UI */
  description?: string
}

/**
 * Array de secciones del Tarot vinculadas a los rangos de frames de 'AllCards' (hands_skills.glb).
 * La animación en Blender fue concebida a 30 FPS.
 *
 * Navegación:
 * - Paso 0 (Inicio / Reposo): Frame 1 (Acción 'AllCards' en reposo)
 * - Paso 1: Frame 1 -> Frame 62 (Carta #1: "VI - CREATIVE DEVELOPER")
 * - Paso 2: Frame 62 -> Frame 122 (Carta #2: "V - CREATIVE DIRECTOR")
 *
 * Puedes agregar fácilmente nuevas cartas / secciones aquí a medida que termines más frames en Blender!
 */
export const TAROT_SECTIONS: TarotSectionConfig[] = [
  {
    id: 'creative-developer',
    title: 'VI - CREATIVE DEVELOPER',
    subtitle: 'WebGPU • Three.js • Shaders & Real-time 3D',
    cardIndex: 0,
    startFrame: 1,
    endFrame: 62,
    description: 'Presentación de Carta Tarot #1: Especialista en desarrollo interactivo y gráficos WebGPU'
  },
  {
    id: 'creative-director',
    title: 'V - CREATIVE DIRECTOR',
    subtitle: 'Art Direction • 3D Design • Visual Strategy',
    cardIndex: 1,
    startFrame: 62,
    endFrame: 122,
    description: 'Presentación de Carta Tarot #2: Dirección creativa y conceptos visuales de alto impacto'
  },
  {
    id: 'animation-scripting',
    title: 'IV - 3D ANIMATION & SCRIPTING',
    subtitle: '3D Animator • Motion Graphics • Writing and Scripts',
    cardIndex: 2,
    startFrame: 122,
    endFrame: 183,
    description: 'Presentación de Carta Tarot #3: Animador 3D y Direción de Script'
  },

]

/** FPS base con el que fue exportada la animación glTF desde Blender (1 muestra cada 0.0166s = 60 FPS) */
export const BLENDER_EXPORT_FPS = 60

/** FPS por defecto para cálculos de tiempo en la animación */
export const ANIMATION_FPS = BLENDER_EXPORT_FPS

/** Convierte un número de frame a segundos en la línea de tiempo */
export function frameToSeconds(frame: number, fps: number = BLENDER_EXPORT_FPS): number {
  return frame / fps
}

/** Convierte segundos a número de frame aproximado */
export function secondsToFrame(seconds: number, fps: number = BLENDER_EXPORT_FPS): number {
  return Math.round(seconds * fps)
}

/**
 * Cuantiza un tiempo continuo (segundos) a pasos discretos de FPS.
 * Útil para dar a la animación un acabado visual auténtico a 30 FPS (estilo stop-motion o cinemático)
 * evitando la micro-interpolación a 60/120 Hz del navegador.
 */
export function quantizeTimeToFps(time: number, targetFps: number = 30): number {
  if (targetFps <= 0) return time
  return Math.floor(time * targetFps + 1e-5) / targetFps
}

/** Calcula la duración teórica de una sección en segundos a una velocidad dada */
export function getSectionDuration(
  section: TarotSectionConfig,
  fps: number = ANIMATION_FPS,
  speed: number = 1.0
): number {
  const frameCount = Math.abs(section.endFrame - section.startFrame)
  const baseSeconds = frameCount / fps
  return speed > 0 ? baseSeconds / speed : baseSeconds
}
