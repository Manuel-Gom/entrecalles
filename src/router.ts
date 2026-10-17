import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'inicio' }
  | { name: 'personajes' }
  | { name: 'nuevo' }
  | { name: 'editar'; id: string }
  | { name: 'dificultad' }
  | { name: 'ajustes' }
  | { name: 'resumen' }
  | { name: 'pnj' }

export const paths = {
  inicio: '#/',
  personajes: '#/personajes',
  nuevo: '#/personajes/nuevo',
  editar: (id: string) => `#/personajes/${encodeURIComponent(id)}`,
  dificultad: '#/dificultad',
  ajustes: '#/ajustes',
  resumen: '#/resumen',
  pnj: '#/pnj',
} as const

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
  if (parts.length === 0) return { name: 'inicio' }
  if (parts[0] === 'personajes') {
    if (parts.length === 1) return { name: 'personajes' }
    if (parts[1] === 'nuevo') return { name: 'nuevo' }
    return { name: 'editar', id: parts[1] }
  }
  if (parts[0] === 'dificultad') return { name: 'dificultad' }
  if (parts[0] === 'ajustes') return { name: 'ajustes' }
  if (parts[0] === 'resumen') return { name: 'resumen' }
  if (parts[0] === 'pnj') return { name: 'pnj' }
  return { name: 'inicio' }
}

function subscribe(callback: () => void) {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

const snapshot = () => window.location.hash

/** Ruta actual, según el fragmento de la URL: el botón Atrás del navegador y los enlaces funcionan. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, snapshot, () => '')
  return parseHash(hash)
}

export function navigate(path: string) {
  window.location.hash = path
}
