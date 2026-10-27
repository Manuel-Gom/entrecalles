import type { Npc } from '../avatar/npcs'
import type { Activity } from './brain'

export interface CastMember {
  npc: Npc
  activity: Activity
  /** pareja de charla (mismo número = charlan entre sí) */
  pair?: number
}

/** Cuántos PNJ por actividad en el barrio. */
const QUOTA: [Activity, number][] = [
  ['sentarse', 3],
  ['correr', 2],
  ['charlar', 4],
  ['escaparate', 2],
  ['esperar', 2],
  ['pasear', 3],
  ['trabajar', 4],
]

export const CAST_SIZE = QUOTA.reduce((sum, [, count]) => sum + count, 0)

/** Cuánto encaja un PNJ con una actividad (más es mejor). */
function fit(npc: Npc, activity: Activity): number {
  switch (activity) {
    case 'sentarse':
      return npc.edad === 'mayor' ? 3 : npc.edad === 'adulto' ? 1 : 0
    case 'correr':
      return (npc.estilo === 'Deportivo' ? 3 : 0) + (npc.edad === 'joven' ? 1 : 0) - (npc.edad === 'mayor' ? 3 : 0)
    case 'charlar':
      return npc.edad === 'joven' ? 1 : 0
    case 'escaparate':
      return npc.estilo === 'Elegante' || npc.estilo === 'Verano' || npc.estilo === 'Urbano' ? 2 : 0
    case 'esperar':
      return npc.estilo === 'Trabajo' || npc.estilo === 'Casual' ? 1 : 0
    case 'trabajar':
      return (npc.estilo === 'Trabajo' ? 2 : 0) + (npc.edad === 'adulto' ? 1 : 0)
    default:
      return 0
  }
}

/**
 * Elige al reparto del barrio: personas distintas (un cuerpo cada una mientras se pueda) y repartidas por actividades
 * según su edad y estilo. Es determinista: el mismo listado da siempre el mismo reparto.
 */
export function chooseCast(npcs: readonly Npc[], avoidBody?: string): CastMember[] {
  const usedBodies = new Set<string>(avoidBody ? [avoidBody] : [])
  const taken = new Set<string>()
  const cast: CastMember[] = []
  let pair = 0
  // primero las actividades más exigentes con quién las hace
  for (const [activity, count] of QUOTA) {
    for (let i = 0; i < count; i++) {
      const candidates = npcs.filter((npc) => !taken.has(npc.id))
      let best: Npc | undefined
      let bestScore = -Infinity
      for (const npc of candidates) {
        // un cuerpo nuevo pesa más que el encaje, para que se vea variedad; el desempate es el orden del listado
        const score = fit(npc, activity) + (usedBodies.has(npc.spec.cuerpo) ? -2 : 1.5)
        if (score > bestScore) {
          best = npc
          bestScore = score
        }
      }
      if (!best) continue
      taken.add(best.id)
      usedBodies.add(best.spec.cuerpo)
      cast.push({ npc: best, activity, pair: activity === 'charlar' ? Math.floor(pair++ / 2) : undefined })
    }
  }
  return cast
}
