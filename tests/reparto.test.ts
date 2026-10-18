import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Npc } from '../src/avatar/npcs'
import { CAST_SIZE, chooseCast } from '../src/world/cast'

const npcs = JSON.parse(readFileSync('public/data/npcs.json', 'utf8')) as Npc[]

describe('chooseCast', () => {
  const cast = chooseCast(npcs)

  it('reparte a 16 personas distintas', () => {
    expect(cast).toHaveLength(CAST_SIZE)
    expect(new Set(cast.map((member) => member.npc.id)).size).toBe(CAST_SIZE)
  })

  it('es determinista', () => {
    expect(chooseCast(npcs).map((member) => member.npc.id)).toEqual(cast.map((member) => member.npc.id))
  })

  it('cada actividad tiene su cupo', () => {
    const count = (activity: string) => cast.filter((member) => member.activity === activity).length
    expect(count('sentarse')).toBe(3)
    expect(count('correr')).toBe(2)
    expect(count('charlar')).toBe(4)
    expect(count('escaparate')).toBe(2)
    expect(count('esperar')).toBe(2)
    expect(count('pasear')).toBe(3)
  })

  it('las charlas son por parejas', () => {
    const talkers = cast.filter((member) => member.activity === 'charlar')
    const pairs = new Map<number, number>()
    for (const member of talkers) pairs.set(member.pair!, (pairs.get(member.pair!) ?? 0) + 1)
    expect([...pairs.values()]).toEqual([2, 2])
    expect(cast.filter((member) => member.activity !== 'charlar').every((member) => member.pair === undefined)).toBe(true)
  })

  it('quien se sienta suele ser mayor y quien corre no lo es', () => {
    const sitters = cast.filter((member) => member.activity === 'sentarse')
    const runners = cast.filter((member) => member.activity === 'correr')
    expect(sitters.filter((member) => member.npc.edad === 'mayor').length).toBeGreaterThanOrEqual(2)
    expect(runners.every((member) => member.npc.edad !== 'mayor')).toBe(true)
  })

  it('hay variedad de cuerpos: no se repiten mientras haya otros', () => {
    expect(new Set(cast.map((member) => member.npc.spec.cuerpo)).size).toBe(CAST_SIZE)
  })

  it('evita el cuerpo del protagonista', () => {
    const body = npcs[0].spec.cuerpo
    expect(chooseCast(npcs, body).some((member) => member.npc.spec.cuerpo === body)).toBe(false)
  })

  it('con pocos PNJ, reparte los que haya', () => {
    expect(chooseCast(npcs.slice(0, 5))).toHaveLength(5)
    expect(chooseCast([])).toEqual([])
  })
})
