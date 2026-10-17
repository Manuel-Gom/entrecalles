// Genera el catálogo de personajes no jugables (PNJ) en public/data/npcs.json.
// Combina los cuerpos y piezas de public/models/modular/manifest.json con las reglas de tools/npcs/config.json.
// Es determinista (semilla fija): el mismo catálogo da siempre los mismos PNJ.
//
// Uso: node tools/npcs/generar.mjs
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const config = JSON.parse(fs.readFileSync(path.join(root, 'tools/npcs/config.json'), 'utf8'))
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public/models/modular/manifest.json'), 'utf8'))
const bodyDefs = Object.fromEntries(
  JSON.parse(fs.readFileSync(path.join(root, 'tools/blender/personajes.json'), 'utf8')).personajes.map((body) => [body.id, body]),
)

/* ---------- utilidades ---------- */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand = mulberry32(config.semilla)
const pick = (items) => items[Math.floor(rand() * items.length)]
const chance = (p) => rand() < p
const shuffle = (items) => {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}
function weighted(entries) {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  let r = rand() * total
  for (const [value, weight] of entries) {
    r -= weight
    if (r <= 0) return value
  }
  return entries[entries.length - 1][0]
}

/* ---------- datos de cuerpos y piezas ---------- */
const genderOf = (body) => body.genero ?? 'hombre'
const bodies = manifest.cuerpos.map((body) => {
  const def = bodyDefs[body.id]
  const age = def?.macro?.age ?? 0.5
  const skin = def?.skin ?? ''
  return {
    ...body,
    genero: genderOf(body),
    edad: age <= 0.52 ? 'joven' : age <= 0.75 ? 'adulto' : 'mayor',
    origen: /african/.test(skin) ? 'africano' : /asian/.test(skin) ? 'asiatico' : 'europeo',
  }
})
const piecesFor = (gender, slot) => manifest.piezas.filter((piece) => piece.slot === slot && (piece.para ?? ['hombre', 'mujer']).includes(gender))
const excluded = new Set(config.excluir ?? [])
// etiquetas explícitas por pieza; si no hay, se deducen de las palabras del nombre
function tagsOf(slot, id) {
  const explicit = config.etiquetas[slot]?.[id]
  if (explicit) return explicit
  const name = (manifest.piezas.find((piece) => piece.slot === slot && piece.id === id)?.nombre ?? id).toLowerCase()
  const byWord = (config.etiquetasPorPalabra ?? []).find((rule) => rule.palabras.some((word) => name.includes(word)))
  return byWord?.tags ?? ['Casual']
}
const withTag = (pieces, slot, style) => pieces.filter((piece) => !excluded.has(piece.id) && tagsOf(slot, piece.id).includes(style))
const usage = new Map()
// elige una prenda con más probabilidad cuanto menos se haya usado ya
const pickLeastUsed = (pieces) => weighted(pieces.map((piece) => [piece, 1 / (1 + (usage.get(piece.id) ?? 0)) ** 2]))
const hasSlot = (slot) => manifest.piezas.some((piece) => piece.slot === slot)

const HAIR = {
  negro: '#1b1612', castano: '#4a2f1f', rubioOscuro: '#a67c3d', rubio: '#d2b26a', pelirrojo: '#9b3d1f', gris: '#9a9a9a', blanco: '#e0e0e0',
}
function hairColorFor(body) {
  if (body.edad === 'mayor') return weighted([[HAIR.gris, 5], [HAIR.blanco, 3], [HAIR.negro, 1], [HAIR.castano, 1]])
  if (body.origen !== 'europeo') return weighted([[HAIR.negro, 7], [HAIR.castano, 3], [null, 2]])
  return weighted([[null, 4], [HAIR.negro, 3], [HAIR.castano, 4], [HAIR.rubioOscuro, 2], [HAIR.rubio, 2], [HAIR.pelirrojo, 1]])
}

/* ---------- construcción de un aspecto ---------- */
function buildOutfit(body, style) {
  const gender = body.genero
  const outfits = withTag(piecesFor(gender, 'conjunto'), 'conjunto', style)
  const tops = withTag(piecesFor(gender, 'torso'), 'torso', style)
  const legs = withTag(piecesFor(gender, 'piernas'), 'piernas', style)
  const canSeparate = tops.length > 0 && legs.length > 0
  if (outfits.length > 0 && (!canSeparate || chance(0.5))) return { conjunto: pickLeastUsed(outfits).id, torso: null, piernas: null }
  if (canSeparate) return { conjunto: null, torso: pickLeastUsed(tops).id, piernas: pickLeastUsed(legs).id }
  return null
}

function buildNpc(body, style) {
  const gender = body.genero
  const outfit = buildOutfit(body, style)
  if (!outfit) return null

  const shoes = withTag(piecesFor(gender, 'calzado'), 'calzado', style)
  const calzado = pick(shoes.length ? shoes : piecesFor(gender, 'calzado')).id

  const hats = withTag(piecesFor(gender, 'cabeza'), 'cabeza', style)
  const hatChance = { Casual: 0.14, Urbano: 0.28, Trabajo: 0.22, Clásico: 0.18, Elegante: 0.1, Deportivo: 0.12 }[style] ?? 0.05
  const cabeza = hats.length > 0 && chance(hatChance) ? pick(hats).id : null

  const hairs = piecesFor(gender, 'pelo')
  const bald = gender === 'hombre' && !cabeza && chance(body.edad === 'mayor' ? 0.22 : 0.07)
  const pelo = bald ? null : pick(hairs).id

  const glasses = piecesFor(gender, 'gafas')
  const gafas = glasses.length > 0 && chance({ joven: 0.12, adulto: 0.26, mayor: 0.42 }[body.edad]) ? pick(glasses).id : null
  const beards = piecesFor(gender, 'barba')
  const barba = beards.length > 0 && chance({ joven: 0.14, adulto: 0.34, mayor: 0.36 }[body.edad]) ? pick(beards).id : null

  const palette = config.colores[style] ?? config.colores.Casual
  const tintable = (slot, id) => id && manifest.piezas.find((piece) => piece.slot === slot && piece.id === id)?.tinte
  const colores = {}
  const topColor = pick(palette)
  if (tintable('torso', outfit.torso)) colores.torso = topColor
  if (tintable('piernas', outfit.piernas)) colores.piernas = pick(palette.filter((color) => color !== topColor))
  if (tintable('calzado', calzado)) colores.calzado = pick(palette)
  if (tintable('cabeza', cabeza)) colores.cabeza = pick(palette)

  const spec = {
    cuerpo: body.id,
    pelo,
    colorPelo: pelo || barba ? hairColorFor(body) : null,
    ...outfit,
    calzado,
    cabeza,
    gafas: hasSlot('gafas') ? gafas : null,
    barba: hasSlot('barba') ? barba : null,
  }
  if (Object.keys(colores).length > 0) spec.colores = colores
  return spec
}

/* ---------- generación ---------- */
const signature = (spec) => JSON.stringify(spec)
const lookSignature = (spec) => [spec.cuerpo, spec.pelo, spec.conjunto ?? `${spec.torso}+${spec.piernas}`, spec.calzado, spec.cabeza].join('|')

const usedNames = new Set()
function makeName(gender) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const first = pick(config.nombres[gender])
    const surname = pick(config.apellidos)
    const second = chance(0.25) ? ` ${pick(config.apellidos)}` : ''
    const name = `${first} ${surname}${second}`
    if (!usedNames.has(name)) {
      usedNames.add(name)
      return name
    }
  }
  throw new Error('No hay nombres suficientes')
}

const perGender = Math.ceil(config.total / 2)
const queue = { hombre: [], mujer: [] }
const refill = (gender) => queue[gender].push(...shuffle(bodies.filter((body) => body.genero === gender)))

const npcs = []
const seenSpecs = new Set()
const seenLooks = new Map()
for (let index = 0; index < perGender * 2 && npcs.length < config.total; index += 1) {
  const gender = index % 2 === 0 ? 'hombre' : 'mujer'
  let created = null
  for (let attempt = 0; attempt < 300 && !created; attempt += 1) {
    if (queue[gender].length === 0) refill(gender)
    const body = attempt < 60 ? queue[gender][0] : pick(bodies.filter((item) => item.genero === gender))
    const styles = Object.entries(config.estilos)
      .map(([name, def]) => [name, def.peso[body.edad] ?? 0])
      .filter(([, weight]) => weight > 0)
    const style = weighted(styles)
    const spec = buildNpc(body, style)
    if (!spec) continue
    const key = signature(spec)
    const look = lookSignature(spec)
    // distinto de todos los anteriores y no demasiado parecido al de otro PNJ con el mismo cuerpo
    if (seenSpecs.has(key) || (seenLooks.get(look) ?? 0) > 0) continue
    const limit = config.maxUsosPorPrenda ?? 99
    const pieces = [spec.conjunto, spec.torso, spec.piernas].filter(Boolean)
    if (attempt < 120 && pieces.some((id) => (usage.get(id) ?? 0) >= limit)) continue
    pieces.forEach((id) => usage.set(id, (usage.get(id) ?? 0) + 1))
    seenSpecs.add(key)
    seenLooks.set(look, 1)
    if (attempt < 60) queue[gender].shift()
    const roleList = config.estilos[style].roles
    const role = pick(roleList)[gender === 'hombre' ? 0 : 1]
    created = { nombre: makeName(gender), genero: gender, edad: body.edad, estilo: style, rol: role, spec }
  }
  if (created) npcs.push(created)
}

npcs.forEach((npc, index) => {
  npc.id = `pnj-${String(index + 1).padStart(3, '0')}`
})
const ordered = npcs.map((npc) => ({ id: npc.id, nombre: npc.nombre, genero: npc.genero, edad: npc.edad, estilo: npc.estilo, rol: npc.rol, spec: npc.spec }))
// NPC_SALIDA permite escribir en otro archivo (las pruebas comprueban que el resultado es reproducible)
const output = process.env.NPC_SALIDA ?? path.join(root, 'public/data/npcs.json')
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, JSON.stringify(ordered, null, 1) + '\n')

const count = (key) => ordered.reduce((acc, npc) => ({ ...acc, [npc[key]]: (acc[npc[key]] ?? 0) + 1 }), {})
console.log(`${ordered.length} PNJ generados`)
console.log('género', count('genero'))
console.log('edad', count('edad'))
console.log('estilo', count('estilo'))
console.log('prendas más usadas', [...usage.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8))
console.log('cuerpos', ordered.reduce((acc, npc) => ({ ...acc, [npc.spec.cuerpo]: (acc[npc.spec.cuerpo] ?? 0) + 1 }), {}))
if (ordered.length < config.total) {
  console.error(`Aviso: solo se han podido generar ${ordered.length} de ${config.total}`)
  process.exitCode = 1
}
