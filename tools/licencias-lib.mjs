// Lógica de la auditoría de licencias (la usan tools/licencias.mjs y las pruebas del catálogo).
import fs from 'node:fs'
import path from 'node:path'

/** Carpeta de registros de paquetes de MPFB. Se puede cambiar con la variable MPFB_PACKS_DIR. */
export function packsDirectory() {
  if (process.env.MPFB_PACKS_DIR) return process.env.MPFB_PACKS_DIR
  if (!process.env.APPDATA) return null
  return path.join(process.env.APPDATA, 'Blender Foundation/Blender/5.2/extensions/.user/blender_org/mpfb/data/packs')
}

/** Piezas usadas por los cuerpos y por el catálogo: nombre → tipo. */
export function usedPieces(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'tools/blender/personajes.json'), 'utf8'))
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'tools/blender/piezas.json'), 'utf8'))
  const used = new Map()
  const add = (type, name) => name && used.set(name, type)
  add('ojos', config.defaults.eyes)
  add('cejas', config.defaults.eyebrows)
  add('pestañas', config.defaults.eyelashes)
  for (const body of config.personajes) {
    add('piel', body.skin)
    add('pelo', body.hair)
    for (const item of body.clothes) add('ropa', item)
  }
  for (const piece of catalog.piezas) add(piece.tipo === 'hair' ? 'pelo' : 'ropa', piece.id)
  return used
}

/** Lee autor y licencia de cada pieza en los registros de los paquetes instalados. */
export function auditar(root, packsDir = packsDirectory()) {
  const used = usedPieces(root)
  const records = {}
  for (const file of fs.readdirSync(packsDir).filter((name) => name.endsWith('.json'))) {
    const pack = file.replace(/\.json$/, '')
    const json = JSON.parse(fs.readFileSync(path.join(packsDir, file), 'utf8'))
    for (const [name, info] of Object.entries(json)) records[name] ??= { pack, ...info }
  }
  const rows = []
  const problems = []
  for (const [name, type] of [...used].sort((a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]))) {
    const info = records[name]
    if (!info) {
      problems.push(`${name}: no figura en ningún paquete instalado`)
      rows.push(`| ${type} | ${name} | ? | ? | ? |`)
      continue
    }
    if (info.license !== 'CC0') problems.push(`${name}: licencia ${info.license} (autor ${info.author})`)
    rows.push(`| ${type} | ${name} | ${info.author || '—'} | ${info.license} | ${info.pack} |`)
  }
  return { used, rows, problems }
}
