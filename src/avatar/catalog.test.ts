import { describe, expect, it } from 'vitest'
import { miniCatalog as catalog } from '../test/fixtures'
import {
  CLOTH_COLORS, HAIR_COLORS, bodyThumbUrl, bodyUrl, describeSpec, genderOf, isOptional, normalizeSpec,
  pieceThumbUrl, pieceUrl, piecesFor, tintFor, visiblePieces, type AvatarSpec,
} from './catalog'

const ana = catalog.cuerpos[0]
const luis = catalog.cuerpos[1]

describe('normalizeSpec', () => {
  it('sin datos usa el primer cuerpo y su atuendo por defecto', () => {
    expect(normalizeSpec(undefined, catalog)).toMatchObject({
      cuerpo: 'ana', pelo: 'bob', torso: 'top', piernas: 'falda', calzado: 'botas', conjunto: null, cabeza: null, gafas: null, barba: null,
    })
  })

  it('un cuerpo que no existe se sustituye por el primero', () => {
    expect(normalizeSpec({ cuerpo: 'nadie' }, catalog).cuerpo).toBe('ana')
  })

  it('el valor por defecto de cada cuerpo es el suyo', () => {
    expect(normalizeSpec({ cuerpo: 'luis' }, catalog)).toMatchObject({ cuerpo: 'luis', pelo: 'corto', conjunto: 'traje', torso: null, piernas: null, calzado: 'zapatos' })
  })

  it('null significa "ninguno" y ausente significa "el valor por defecto"', () => {
    expect(normalizeSpec({ cuerpo: 'luis', pelo: null }, catalog).pelo).toBeNull()
    expect(normalizeSpec({ cuerpo: 'luis' }, catalog).pelo).toBe('corto')
  })

  it('un conjunto anula la camiseta y el pantalón', () => {
    const spec = normalizeSpec({ cuerpo: 'ana', conjunto: 'vestido', torso: 'polo', piernas: 'vaqueros' }, catalog)
    expect(spec).toMatchObject({ conjunto: 'vestido', torso: null, piernas: null })
  })

  it('descarta las piezas de otro género', () => {
    const spec = normalizeSpec({ cuerpo: 'ana', conjunto: 'traje', pelo: 'corto', barba: 'perilla' }, catalog)
    expect(spec.conjunto).toBeNull()
    expect(spec.barba).toBeNull()
    expect(spec.pelo).toBe('corto') // el peinado corto vale para los dos
  })

  it('descarta ids que no existen', () => {
    const spec = normalizeSpec({ cuerpo: 'luis', pelo: 'inventado', gafas: 'x' }, catalog)
    expect(spec.pelo).toBeNull()
    expect(spec.gafas).toBeNull()
  })

  it('el calzado y el pantalón son obligatorios (si no hay conjunto)', () => {
    const spec = normalizeSpec({ cuerpo: 'luis', conjunto: null, calzado: null, piernas: null }, catalog)
    expect(spec.calzado).toBe('zapatos')
    expect(spec.piernas).toBe('vaqueros')
  })

  it('un cuerpo femenino no puede quedarse sin camiseta, uno masculino sí', () => {
    expect(normalizeSpec({ cuerpo: 'ana', torso: null }, catalog).torso).toBe('top')
    expect(normalizeSpec({ cuerpo: 'luis', conjunto: null, torso: null }, catalog).torso).toBeNull()
  })

  it('el color de pelo debe ser de la paleta; si no, se ignora', () => {
    expect(normalizeSpec({ cuerpo: 'ana', colorPelo: HAIR_COLORS[1].value }, catalog).colorPelo).toBe(HAIR_COLORS[1].value)
    expect(normalizeSpec({ cuerpo: 'ana', colorPelo: '#123456' }, catalog).colorPelo).toBeNull()
  })

  it('el color de pelo por defecto del cuerpo se aplica salvo que se elija "original" (null)', () => {
    expect(normalizeSpec({ cuerpo: 'luis' }, catalog).colorPelo).toBe('#9a9a9a')
    expect(normalizeSpec({ cuerpo: 'luis', colorPelo: null }, catalog).colorPelo).toBeNull()
  })

  it('conserva solo los colores de telas teñibles y de la paleta', () => {
    const good = CLOTH_COLORS[3].value
    const spec = normalizeSpec({ cuerpo: 'ana', colores: { torso: good, piernas: '#123456', calzado: good } }, catalog)
    expect(spec.colores).toEqual({ torso: good }) // piernas fuera de paleta; el calzado no es teñible
  })

  it('también se tiñen los vestidos y conjuntos teñibles', () => {
    const color = CLOTH_COLORS[6].value
    const spec = normalizeSpec({ cuerpo: 'ana', conjunto: 'vestido', colores: { conjunto: color, torso: color } }, catalog)
    expect(spec.colores).toEqual({ conjunto: color }) // la camiseta ya no se lleva
    expect(tintFor(spec, catalog, 'conjunto')).toBe(color)
    expect(tintFor({ cuerpo: 'ana', conjunto: 'vestido' }, catalog, 'conjunto')).toBe('#741c2b')
  })

  it('no deja colores de una prenda que no se puede teñir', () => {
    const spec = normalizeSpec({ cuerpo: 'luis', conjunto: null, torso: 'polo', colores: { torso: CLOTH_COLORS[0].value } }, catalog)
    expect(spec.torso).toBe('polo')
    expect(spec.colores).toBeUndefined() // el polo no es teñible
  })

  it('es idempotente', () => {
    const inputs: Partial<AvatarSpec>[] = [
      {}, { cuerpo: 'luis' }, { cuerpo: 'ana', conjunto: 'vestido', colorPelo: HAIR_COLORS[0].value },
      { cuerpo: 'luis', pelo: null, torso: 'camiseta', piernas: 'vaqueros', conjunto: null, colores: { torso: CLOTH_COLORS[2].value } },
      { cuerpo: 'ana', cabeza: 'gorra', colores: { cabeza: CLOTH_COLORS[4].value } },
    ]
    for (const input of inputs) {
      const once = normalizeSpec(input, catalog)
      expect(normalizeSpec(once, catalog)).toEqual(once)
    }
  })
})

describe('visiblePieces', () => {
  it('la gorra oculta el peinado pero no la barba ni las gafas', () => {
    const spec = normalizeSpec({ cuerpo: 'luis', cabeza: 'gorra', gafas: 'gafas1', barba: 'perilla' }, catalog)
    expect(visiblePieces(spec, catalog)).toMatchObject({ cabeza: 'gorra', gafas: 'gafas1', barba: 'perilla' })
    expect(visiblePieces(spec, catalog).pelo).toBeUndefined()
  })

  it('sin gorra se ve el peinado', () => {
    expect(visiblePieces(normalizeSpec({ cuerpo: 'luis' }, catalog), catalog).pelo).toBe('corto')
  })

  it('no incluye los huecos vacíos', () => {
    const visible = visiblePieces(normalizeSpec({ cuerpo: 'luis', pelo: null }, catalog), catalog)
    expect(Object.keys(visible)).not.toContain('pelo')
  })
})

describe('utilidades del catálogo', () => {
  it('piecesFor filtra por hueco y por género', () => {
    expect(piecesFor(catalog, ana, 'pelo').map((p) => p.id)).toEqual(['corto', 'bob'])
    expect(piecesFor(catalog, luis, 'pelo').map((p) => p.id)).toEqual(['corto'])
    expect(piecesFor(catalog, luis, 'barba').map((p) => p.id)).toEqual(['perilla'])
    expect(piecesFor(catalog, ana, 'barba')).toEqual([])
  })

  it('genderOf asume hombre si falta el dato', () => {
    expect(genderOf(undefined)).toBe('hombre')
    expect(genderOf({ ...luis, genero: undefined })).toBe('hombre')
    expect(genderOf(ana)).toBe('mujer')
  })

  it('isOptional', () => {
    expect(isOptional('calzado', luis)).toBe(false)
    expect(isOptional('piernas', luis)).toBe(false)
    expect(isOptional('torso', ana)).toBe(false)
    expect(isOptional('torso', luis)).toBe(true)
    expect(isOptional('pelo', ana)).toBe(true)
    expect(isOptional('gafas', ana)).toBe(true)
  })

  it('describeSpec resume la ropa elegida', () => {
    expect(describeSpec({ cuerpo: 'ana' }, catalog)).toBe('Top · Falda · Botas')
    expect(describeSpec({ cuerpo: 'luis' }, catalog)).toBe('Traje · Zapatos')
  })

  it('las rutas de modelos y miniaturas siguen el formato esperado', () => {
    expect(bodyUrl('ana')).toMatch(/models\/modular\/ana\/body\.glb$/)
    expect(pieceUrl('ana', 'pelo', 'bob')).toMatch(/models\/modular\/ana\/pelo\/bob\.glb$/)
    expect(bodyThumbUrl('ana')).toMatch(/miniaturas\/cuerpos\/ana\.png$/)
    expect(pieceThumbUrl('torso', 'top')).toMatch(/miniaturas\/torso\/top\.png$/)
  })
})

describe('tintFor', () => {
  it('usa el color elegido; si no hay, el original de la prenda; si no es teñible, ninguno', () => {
    const chosen = CLOTH_COLORS[5].value
    expect(tintFor({ cuerpo: 'ana', torso: 'top', colores: { torso: chosen } }, catalog, 'torso')).toBe(chosen)
    expect(tintFor({ cuerpo: 'ana', torso: 'top' }, catalog, 'torso')).toBe('#ac5f8b')
    expect(tintFor({ cuerpo: 'ana', piernas: 'falda' }, catalog, 'piernas')).toBeNull() // teñible sin color por defecto
    expect(tintFor({ cuerpo: 'luis', torso: 'polo', colores: { torso: chosen } }, catalog, 'torso')).toBeNull() // no teñible
    expect(tintFor({ cuerpo: 'luis' }, catalog, 'torso')).toBeNull() // sin prenda
  })
})
