// Genera docs/licencias-personajes.md con autor y licencia de cada pieza usada (tools/blender/personajes.json y piezas.json)
// leyendo los registros de paquetes de MPFB. Falla (código 1) si alguna pieza no es CC0 o no figura en ningún paquete.
//
// Uso: node tools/licencias.mjs
import fs from 'node:fs'
import path from 'node:path'
import { auditar, packsDirectory } from './licencias-lib.mjs'

const root = process.cwd()
const packsDir = packsDirectory()
if (!packsDir || !fs.existsSync(packsDir)) {
  console.error('No se encuentran los registros de paquetes de MPFB (variable MPFB_PACKS_DIR o instalación de Blender).')
  process.exit(1)
}
const { used, rows, problems } = auditar(root, packsDir)

const md = `# Licencias de las piezas de los personajes

Generado por \`node tools/licencias.mjs\` a partir de los registros de paquetes de MPFB2. No editar a mano.

| Tipo | Pieza | Autor | Licencia | Paquete |
|---|---|---|---|---|
${rows.join('\n')}

${problems.length ? '## Revisar\n\n' + problems.map((p) => `- ${p}`).join('\n') + '\n' : 'Todas las piezas usadas son CC0: no se exige crédito.\n'}`
fs.writeFileSync(path.join(root, 'docs/licencias-personajes.md'), md)
console.log(`${used.size} piezas revisadas, ${problems.length} problemas`)
if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
