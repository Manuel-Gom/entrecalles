import { describe, expect, it } from 'vitest'
import { boxAt, resolveCircle, resolveCircles, segmentEntry, type Circle } from './collision'

const wall = boxAt(0, 0, 4, 2) // x -2..2, z -1..1

describe('resolveCircle', () => {
  it('no toca nada si está lejos', () => {
    expect(resolveCircle({ x: 5, z: 5 }, 0.3, [wall])).toEqual({ x: 5, z: 5 })
  })

  it('empuja el círculo fuera de la caja por el lado por el que entró', () => {
    const out = resolveCircle({ x: 0, z: 1.1 }, 0.3, [wall])
    expect(out.x).toBeCloseTo(0)
    expect(out.z).toBeCloseTo(1.3)
  })

  it('se desliza por la pared: solo corrige el eje que choca', () => {
    const out = resolveCircle({ x: 1.5, z: 1.2 }, 0.3, [wall])
    expect(out.x).toBeCloseTo(1.5)
    expect(out.z).toBeCloseTo(1.3)
  })

  it('en una esquina, sale en diagonal sin quedarse dentro', () => {
    const out = resolveCircle({ x: 2.1, z: 1.1 }, 0.3, [wall])
    expect(Math.hypot(out.x - 2, out.z - 1)).toBeGreaterThanOrEqual(0.3 - 1e-9)
  })

  it('si el centro está dentro de la caja, sale por el lado más cercano', () => {
    const out = resolveCircle({ x: 1.8, z: 0 }, 0.3, [wall])
    expect(out.x).toBeCloseTo(2.3)
  })

  it('en la juntura de dos cajas pegadas no se cuela entre ellas', () => {
    const boxes = [boxAt(0, 0, 2, 2), boxAt(2, 0, 2, 2)] // se tocan en x = 1
    const out = resolveCircle({ x: 1, z: 1.1 }, 0.3, boxes)
    expect(out.z).toBeCloseTo(1.3)
  })

  it('escribe el resultado en el objeto que se le pasa', () => {
    const out = { x: 0, z: 0 }
    expect(resolveCircle({ x: 9, z: 9 }, 0.3, [wall], out)).toBe(out)
    expect(out).toEqual({ x: 9, z: 9 })
  })
})

describe('resolveCircles', () => {
  const others: Circle[] = [{ id: 1, x: 0, z: 0, r: 0.3 }, { id: 2, x: 5, z: 0, r: 0.3 }]

  it('no toca nada si no hay solape', () => {
    expect(resolveCircles({ x: 1, z: 0 }, 0.3, others, 99)).toEqual({ x: 1, z: 0 })
  })

  it('aparta al círculo hasta que se tocan sin solaparse', () => {
    const out = resolveCircles({ x: 0.4, z: 0 }, 0.3, others, 99)
    expect(out.x).toBeCloseTo(0.6)
    expect(out.z).toBeCloseTo(0)
  })

  it('ignora a quien tiene su mismo id (él mismo)', () => {
    expect(resolveCircles({ x: 0.1, z: 0 }, 0.3, others, 1)).toEqual({ x: 0.1, z: 0 })
  })

  it('si están exactamente encima se aparta siempre hacia el mismo lado', () => {
    const a = resolveCircles({ x: 0, z: 0 }, 0.3, others, 99)
    const b = resolveCircles({ x: 0, z: 0 }, 0.3, others, 99)
    expect(a).toEqual(b)
    expect(a.x).toBeCloseTo(0.6)
  })

  it('con varios actores seguidos termina sin solaparse con el último', () => {
    const line: Circle[] = [{ id: 1, x: 0, z: 0, r: 0.3 }, { id: 2, x: 0.7, z: 0, r: 0.3 }]
    const out = resolveCircles({ x: 0.35, z: 0.2 }, 0.3, line, 99)
    expect(Math.hypot(out.x - 0.7, out.z)).toBeGreaterThanOrEqual(0.6 - 1e-9)
  })
})

describe('segmentEntry', () => {
  it('devuelve en qué fracción del segmento entra en la caja', () => {
    expect(segmentEntry(-6, 0, 6, 0, wall)).toBeCloseTo(4 / 12)
  })

  it('devuelve null si no la toca, aunque la recta sí', () => {
    expect(segmentEntry(-6, 3, 6, 3, wall)).toBeNull()
    expect(segmentEntry(-6, 0, -3, 0, wall)).toBeNull()
  })

  it('un segmento paralelo a un eje y fuera de la caja no la toca', () => {
    expect(segmentEntry(5, -5, 5, 5, wall)).toBeNull()
  })

  it('si empieza dentro, entra en 0', () => {
    expect(segmentEntry(0, 0, 6, 0, wall)).toBe(0)
  })
})
