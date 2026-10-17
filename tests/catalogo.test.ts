// Integridad del catálogo de modelos generado con Blender: nada falta, nada sobra y todo cumple las reglas.
// Se ejecuta con `npm run test:catalogo` (y dentro de `npm run verificar`).
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { TINT_SLOTS, normalizeSpec, piecesFor, type Catalog, type Slot } from '../src/avatar/catalog'
import { auditar, packsDirectory } from '../tools/licencias-lib.mjs'

const root = process.cwd()
const modular = path.join(root, 'public/models/modular')
const manifest = JSON.parse(fs.readFileSync(path.join(modular, 'manifest.json'), 'utf8')) as Catalog
const piezasJson = JSON.parse(fs.readFileSync(path.join(root, 'tools/blender/piezas.json'), 'utf8')) as {
  cuerpos: string[]
  piezas: { id: string; slot: Slot; nombre: string; para?: string[] }[]
}

const MB = 1024 * 1024
const LIMITE = { cuerpo: 0.8 * MB, pieza: 0.6 * MB, miniatura: 40 * 1024, total: 340 * MB }
// los huesos que usa src/avatar/pose.ts
const HUESOS_POSE = ['spine_02', 'spine_03', 'neck_01', 'head', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'hand_l', 'hand_r']

const glb = (cuerpo: string, slot?: string, id?: string) => (slot ? path.join(modular, cuerpo, slot, `${id}.glb`) : path.join(modular, cuerpo, 'body.glb'))
const thumb = (...parts: string[]) => path.join(modular, 'miniaturas', ...parts)
const generos = (piece: { para?: string[] }) => piece.para ?? ['hombre', 'mujer']

/** Lee solo la cabecera JSON de un GLB. */
function readGlb(file: string) {
  const fd = fs.openSync(file, 'r')
  try {
    const head = Buffer.alloc(20)
    fs.readSync(fd, head, 0, 20, 0)
    expect(head.readUInt32LE(0), `${file}: no es un GLB`).toBe(0x46546c67)
    const length = head.readUInt32LE(12)
    const body = Buffer.alloc(length)
    fs.readSync(fd, body, 0, length, 20)
    return JSON.parse(body.toString('utf8')) as {
      extensionsRequired?: string[]
      nodes: { name?: string; mesh?: number }[]
      skins?: { joints: number[] }[]
      meshes: unknown[]
    }
  } finally {
    fs.closeSync(fd)
  }
}

function listGlbs(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    return entry.isDirectory() ? listGlbs(full) : entry.name.endsWith('.glb') ? [full] : []
  })
}

describe('manifest.json', () => {
  it('coincide con tools/blender/piezas.json (ids, huecos, nombres y géneros)', () => {
    expect(manifest.cuerpos.map((body) => body.id)).toEqual(piezasJson.cuerpos)
    expect(manifest.piezas.map((p) => [p.slot, p.id, p.nombre, [...generos(p)].sort()]))
      .toEqual(piezasJson.piezas.map((p) => [p.slot, p.id, p.nombre, [...generos(p)].sort()]))
  })

  it('los ids son únicos (por hueco) y los huecos existen', () => {
    const keys = manifest.piezas.map((p) => `${p.slot}/${p.id}`)
    expect(new Set(keys).size).toBe(keys.length)
    for (const piece of manifest.piezas) expect(Object.keys(manifest.huecos), piece.id).toContain(piece.slot)
    const bodyIds = manifest.cuerpos.map((body) => body.id)
    expect(new Set(bodyIds).size).toBe(bodyIds.length)
  })

  it('los huecos que oculta una pieza existen', () => {
    for (const piece of manifest.piezas) for (const hidden of piece.oculta ?? []) expect(Object.keys(manifest.huecos), piece.id).toContain(hidden)
  })

  it('solo se tiñen los huecos de tela y los colores por defecto son hexadecimales de piezas teñibles', () => {
    for (const piece of manifest.piezas) {
      if (piece.tinte) expect(TINT_SLOTS as readonly string[], `${piece.id} es teñible pero su hueco no`).toContain(piece.slot)
      if (piece.colorDefecto) {
        expect(piece.tinte, `${piece.id} tiene colorDefecto sin ser teñible`).toBe(true)
        expect(piece.colorDefecto).toMatch(/^#[0-9a-f]{6}$/i)
      }
    }
  })

  it('hay cuerpos y piezas de los dos géneros', () => {
    for (const genero of ['hombre', 'mujer'] as const) {
      expect(manifest.cuerpos.filter((b) => (b.genero ?? 'hombre') === genero).length, genero).toBeGreaterThanOrEqual(10)
      for (const slot of ['pelo', 'calzado'] as const) expect(piecesFor(manifest, { ...manifest.cuerpos[0], genero }, slot).length, `${slot} ${genero}`).toBeGreaterThan(3)
    }
  })
})

describe('archivos de modelos', () => {
  it('cada cuerpo tiene su body.glb y cada pieza compatible su .glb, sin archivos de más', () => {
    const expected = new Set<string>()
    for (const body of manifest.cuerpos) {
      expected.add(glb(body.id))
      for (const piece of manifest.piezas) if (generos(piece).includes(body.genero ?? 'hombre')) expected.add(glb(body.id, piece.slot, piece.id))
    }
    const found = new Set(listGlbs(modular))
    expect([...expected].filter((file) => !found.has(file)).map((f) => path.relative(modular, f))).toEqual([])
    expect([...found].filter((file) => !expected.has(file)).map((f) => path.relative(modular, f))).toEqual([])
  })

  it('respetan los tamaños máximos', () => {
    let total = 0
    const tooBig: string[] = []
    for (const file of listGlbs(modular)) {
      const size = fs.statSync(file).size
      total += size
      const limit = path.basename(file) === 'body.glb' ? LIMITE.cuerpo : LIMITE.pieza
      if (size > limit) tooBig.push(`${path.relative(modular, file)} ${(size / MB).toFixed(2)} MB`)
    }
    expect(tooBig).toEqual([])
    const miniaturas = fs.readdirSync(path.join(modular, 'miniaturas'), { recursive: true, withFileTypes: true })
    for (const entry of miniaturas) if (entry.isFile()) total += fs.statSync(path.join(entry.parentPath, entry.name)).size
    expect(total, `el catálogo pesa ${(total / MB).toFixed(0)} MB`).toBeLessThanOrEqual(LIMITE.total)
  })

  it('todos los cuerpos usan compresión meshopt, textura WebP y llevan el esqueleto que espera la pose', () => {
    for (const body of manifest.cuerpos) {
      const json = readGlb(glb(body.id))
      expect(json.extensionsRequired, body.id).toEqual(expect.arrayContaining(['EXT_meshopt_compression', 'EXT_texture_webp']))
      expect(json.skins?.length, `${body.id}: sin esqueleto`).toBeGreaterThan(0)
      const bones = json.skins![0].joints.map((index) => json.nodes[index].name)
      expect(bones.length, `${body.id}: huesos`).toBe(53)
      expect(bones).toEqual(expect.arrayContaining(HUESOS_POSE))
    }
  })

  it('cada pieza lleva malla con esqueleto y el mismo número de huesos que el cuerpo', () => {
    // se revisa un cuerpo masculino y uno femenino (todas sus piezas)
    for (const body of [manifest.cuerpos.find((b) => (b.genero ?? 'hombre') === 'hombre')!, manifest.cuerpos.find((b) => b.genero === 'mujer')!]) {
      const bodyBones = readGlb(glb(body.id)).skins![0].joints.length
      for (const piece of manifest.piezas) {
        if (!generos(piece).includes(body.genero ?? 'hombre')) continue
        const json = readGlb(glb(body.id, piece.slot, piece.id))
        expect(json.meshes.length, `${body.id}/${piece.slot}/${piece.id}`).toBeGreaterThan(0)
        expect(json.skins?.[0].joints.length, `${body.id}/${piece.slot}/${piece.id}: huesos`).toBe(bodyBones)
      }
    }
  })
})

describe('miniaturas', () => {
  it('cada cuerpo y pieza marcados con miniatura tienen su PNG, y no hay PNG sobrantes', () => {
    const expected = new Set<string>()
    for (const body of manifest.cuerpos) if (body.miniatura) expected.add(thumb('cuerpos', `${body.id}.png`))
    for (const piece of manifest.piezas) if (piece.miniatura) expected.add(thumb(piece.slot, `${piece.id}.png`))
    const found = new Set(
      fs.readdirSync(path.join(modular, 'miniaturas'), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.png'))
        .map((entry) => path.join(entry.parentPath, entry.name)),
    )
    expect([...expected].filter((file) => !found.has(file)).map((f) => path.relative(modular, f))).toEqual([])
    expect([...found].filter((file) => !expected.has(file)).map((f) => path.relative(modular, f))).toEqual([])
  })

  it('todo tiene miniatura y ninguna es demasiado pesada', () => {
    expect(manifest.cuerpos.filter((b) => !b.miniatura).map((b) => b.id)).toEqual([])
    expect(manifest.piezas.filter((p) => !p.miniatura).map((p) => `${p.slot}/${p.id}`)).toEqual([])
    const heavy: string[] = []
    for (const entry of fs.readdirSync(path.join(modular, 'miniaturas'), { recursive: true, withFileTypes: true })) {
      if (entry.isFile() && fs.statSync(path.join(entry.parentPath, entry.name)).size > LIMITE.miniatura) heavy.push(entry.name)
    }
    expect(heavy).toEqual([])
  })
})

describe('atuendos por defecto', () => {
  it.each(manifest.cuerpos.map((body) => [body.id]))('%s: el atuendo por defecto es válido y completo', (id) => {
    const body = manifest.cuerpos.find((item) => item.id === id)!
    const spec = normalizeSpec({ cuerpo: id }, manifest)
    expect(spec.cuerpo).toBe(id)
    expect(spec.calzado, 'sin calzado').toBeTruthy()
    expect(Boolean(spec.conjunto || (spec.piernas && (spec.torso || (body.genero ?? 'hombre') === 'hombre'))), 'sin ropa suficiente').toBe(true)
    if (body.genero === 'mujer') expect(Boolean(spec.conjunto || spec.torso), 'mujer sin camiseta ni conjunto').toBe(true)
    // todo lo que lleva existe como archivo para ese cuerpo
    for (const slot of ['pelo', 'torso', 'piernas', 'conjunto', 'calzado', 'cabeza', 'gafas', 'barba'] as const) {
      if (spec[slot]) expect(fs.existsSync(glb(id, slot, spec[slot]!)), `${id}/${slot}/${spec[slot]}`).toBe(true)
    }
    // lo declarado en `defecto` no se pierde al normalizar
    for (const [slot, piece] of Object.entries(body.defecto)) expect((spec as Record<string, unknown>)[slot], `${id}: ${slot}`).toBe(piece)
  })
})

describe('licencias', () => {
  const packs = packsDirectory()
  it.skipIf(!packs || !fs.existsSync(packs))('todas las piezas usadas son CC0', () => {
    const { problems } = auditar(root, packs!)
    expect(problems).toEqual([])
  })
})
