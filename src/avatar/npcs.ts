import type { AvatarSpec, Genero } from './catalog'

/** Un personaje no jugable (PNJ): una persona de la ciudad con su aspecto fijo. */
export interface Npc {
  id: string
  nombre: string
  genero: Genero
  edad: 'joven' | 'adulto' | 'mayor'
  estilo: string
  rol: string
  spec: AvatarSpec
}

const base = import.meta.env.BASE_URL

let npcPromise: Promise<Npc[]> | null = null

export function loadNpcs(): Promise<Npc[]> {
  npcPromise ??= fetch(`${base}data/npcs.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`No se pudo leer la lista de PNJ (${response.status})`)
      return response.json() as Promise<Npc[]>
    })
    .catch((error) => {
      npcPromise = null
      throw error
    })
  return npcPromise
}

/** Retrato ya generado (public/npcs/retratos/<id>.webp). */
export const npcPortraitUrl = (id: string) => `${base}npcs/retratos/${id}.webp`
