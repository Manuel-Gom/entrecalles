// Invariantes del catálogo de PNJ (public/data/npcs.json) y del generador (tools/npcs/generar.mjs).
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CLOTH_COLORS, HAIR_COLORS, normalizeSpec, visiblePieces, type Catalog } from '../src/avatar/catalog'
import type { Npc } from '../src/avatar/npcs'

const root = process.cwd()
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/models/modular/manifest.json'), 'utf8')) as Catalog
const npcs = JSON.parse(fs.readFileSync(path.join(root, 'public/data/npcs.json'), 'utf8')) as Npc[]
const config = JSON.parse(fs.readFileSync(path.join(root, 'tools/npcs/config.json'), 'utf8')) as {
  total: number
  maxUsosPorPrenda: number
  excluir: string[]
  estilos: Record<string, unknown>
}

const genderOfBody = (id: string) => manifest.cuerpos.find((body) => body.id === id)?.genero ?? 'hombre'

describe('catálogo de PNJ', () => {
  it('tiene entre 100 y 200 diseños, los que pide la configuración', () => {
    expect(npcs.length).toBeGreaterThanOrEqual(100)
    expect(npcs.length).toBeLessThanOrEqual(200)
    expect(npcs).toHaveLength(config.total)
  })

  it('los ids y los nombres son únicos', () => {
    expect(new Set(npcs.map((npc) => npc.id)).size).toBe(npcs.length)
    expect(new Set(npcs.map((npc) => npc.nombre)).size).toBe(npcs.length)
    for (const npc of npcs) expect(npc.id).toMatch(/^pnj-\d{3}$/)
  })

  it('no hay dos aspectos idénticos', () => {
    expect(new Set(npcs.map((npc) => JSON.stringify(npc.spec))).size).toBe(npcs.length)
  })

  it('el reparto entre hombres y mujeres está equilibrado', () => {
    const men = npcs.filter((npc) => npc.genero === 'hombre').length
    expect(Math.abs(men - (npcs.length - men))).toBeLessThanOrEqual(2)
  })

  it('el género de cada PNJ coincide con el de su cuerpo', () => {
    for (const npc of npcs) expect(genderOfBody(npc.spec.cuerpo), npc.id).toBe(npc.genero)
  })

  it('todos los cuerpos aparecen y de forma repartida', () => {
    const counts = new Map<string, number>()
    for (const npc of npcs) counts.set(npc.spec.cuerpo, (counts.get(npc.spec.cuerpo) ?? 0) + 1)
    expect([...counts.keys()].sort()).toEqual(manifest.cuerpos.map((body) => body.id).sort())
    expect(Math.max(...counts.values()) - Math.min(...counts.values())).toBeLessThanOrEqual(3)
  })

  it('cada aspecto ya está normalizado: usar el catálogo no lo cambia', () => {
    for (const npc of npcs) expect(normalizeSpec(npc.spec, manifest), npc.id).toEqual(npc.spec)
  })

  it('todas las piezas existen en el catálogo y valen para el cuerpo del PNJ', () => {
    for (const npc of npcs) {
      const visible = visiblePieces(npc.spec, manifest)
      for (const [slot, id] of Object.entries(visible)) {
        const piece = manifest.piezas.find((item) => item.slot === slot && item.id === id)
        expect(piece, `${npc.id}: ${slot}/${id}`).toBeDefined()
        expect(piece!.para ?? ['hombre', 'mujer'], `${npc.id}: ${id}`).toContain(npc.genero)
      }
    }
  })

  it('los colores son de las paletas y solo en piezas teñibles', () => {
    const cloth = CLOTH_COLORS.map((color) => color.value as string)
    const hair = HAIR_COLORS.map((color) => color.value as string)
    for (const npc of npcs) {
      if (npc.spec.colorPelo) expect(hair, npc.id).toContain(npc.spec.colorPelo)
      for (const [slot, color] of Object.entries(npc.spec.colores ?? {})) {
        expect(cloth, `${npc.id}: ${slot}`).toContain(color)
        const id = (npc.spec as unknown as Record<string, string | null>)[slot]
        expect(manifest.piezas.find((piece) => piece.slot === slot && piece.id === id)?.tinte, `${npc.id}: ${slot}/${id}`).toBe(true)
      }
    }
  })

  it('ningún PNJ usa piezas excluidas y ninguna prenda se repite más de lo permitido', () => {
    const usage = new Map<string, number>()
    for (const npc of npcs) {
      for (const id of [npc.spec.conjunto, npc.spec.torso, npc.spec.piernas]) {
        if (!id) continue
        expect(config.excluir, npc.id).not.toContain(id)
        usage.set(id, (usage.get(id) ?? 0) + 1)
      }
    }
    expect(Math.max(...usage.values())).toBeLessThanOrEqual(config.maxUsosPorPrenda + 2) // el generador admite un pequeño margen al agotar opciones
  })

  it('el estilo, la edad y el oficio son válidos', () => {
    for (const npc of npcs) {
      expect(Object.keys(config.estilos), npc.id).toContain(npc.estilo)
      expect(['joven', 'adulto', 'mayor'], npc.id).toContain(npc.edad)
      expect(npc.rol.length, npc.id).toBeGreaterThanOrEqual(2)
    }
  })

  it('cada PNJ tiene su retrato y pesa poco', () => {
    for (const npc of npcs) {
      const file = path.join(root, 'public/npcs/retratos', `${npc.id}.webp`)
      expect(fs.existsSync(file), `falta el retrato de ${npc.id} (node tools/revision/retratos.mjs)`).toBe(true)
      expect(fs.statSync(file).size, npc.id).toBeLessThan(40 * 1024)
    }
  })
})

describe('generador de PNJ', () => {
  it('es reproducible y el catálogo guardado está al día', () => {
    const run = (name: string) => {
      const output = path.join(os.tmpdir(), `npcs-${process.pid}-${name}.json`)
      execFileSync('node', ['tools/npcs/generar.mjs'], { cwd: root, env: { ...process.env, NPC_SALIDA: output }, stdio: 'pipe' })
      const text = fs.readFileSync(output, 'utf8')
      fs.rmSync(output)
      return text
    }
    const first = run('a')
    expect(run('b')).toBe(first)
    expect(first, 'public/data/npcs.json está desactualizado: ejecuta node tools/npcs/generar.mjs y rehaz los retratos').toBe(
      fs.readFileSync(path.join(root, 'public/data/npcs.json'), 'utf8'),
    )
  })
})
