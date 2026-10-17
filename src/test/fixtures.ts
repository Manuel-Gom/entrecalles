import type { Catalog } from '../avatar/catalog'

/** Catálogo mínimo para probar las reglas sin depender de los modelos reales. */
export const miniCatalog: Catalog = {
  cuerpos: [
    {
      id: 'ana', nombre: 'Ana', descripcion: 'Mujer de ejemplo', genero: 'mujer',
      defecto: { pelo: 'bob', torso: 'top', piernas: 'falda', calzado: 'botas' },
    },
    {
      id: 'luis', nombre: 'Luis', descripcion: 'Hombre de ejemplo', genero: 'hombre', colorPelo: '#9a9a9a',
      defecto: { pelo: 'corto', conjunto: 'traje', calzado: 'zapatos' },
    },
  ],
  huecos: {
    pelo: 'Peinado', torso: 'Camiseta', piernas: 'Pantalón', conjunto: 'Conjunto', calzado: 'Calzado',
    cabeza: 'Gorra', gafas: 'Gafas', barba: 'Barba',
  },
  piezas: [
    { id: 'corto', slot: 'pelo', nombre: 'Corto' },
    { id: 'bob', slot: 'pelo', nombre: 'Bob', para: ['mujer'] },
    { id: 'top', slot: 'torso', nombre: 'Top', para: ['mujer'], tinte: true, colorDefecto: '#ac5f8b' },
    { id: 'camiseta', slot: 'torso', nombre: 'Camiseta', para: ['hombre'], tinte: true },
    { id: 'polo', slot: 'torso', nombre: 'Polo', para: ['hombre', 'mujer'] },
    { id: 'falda', slot: 'piernas', nombre: 'Falda', para: ['mujer'], tinte: true },
    { id: 'vaqueros', slot: 'piernas', nombre: 'Vaqueros' },
    { id: 'traje', slot: 'conjunto', nombre: 'Traje', para: ['hombre'] },
    { id: 'vestido', slot: 'conjunto', nombre: 'Vestido', para: ['mujer'], tinte: true, colorDefecto: '#741c2b' },
    { id: 'zapatos', slot: 'calzado', nombre: 'Zapatos' },
    { id: 'botas', slot: 'calzado', nombre: 'Botas', para: ['mujer'] },
    { id: 'gorra', slot: 'cabeza', nombre: 'Gorra', oculta: ['pelo'], tinte: true },
    { id: 'gafas1', slot: 'gafas', nombre: 'Gafas' },
    { id: 'perilla', slot: 'barba', nombre: 'Perilla', para: ['hombre'] },
  ],
}
