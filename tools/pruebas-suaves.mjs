// Ejecuta una herramienta de pruebas (Vitest, Playwright) con prioridad baja, para poder seguir usando el equipo mientras
// tanto: lo que uses tú va antes y las pruebas aprovechan la CPU que sobre.
// Uso: node tools/pruebas-suaves.mjs playwright test [opciones de Playwright…]
// En Windows, los procesos que se lanzan desde aquí (el build, vite, Chromium y sus procesos) heredan la prioridad baja.
import { spawn } from 'node:child_process'
import os from 'node:os'

try {
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL)
} catch (error) {
  console.warn(`No se pudo bajar la prioridad (las pruebas irán con la normal): ${error.message}`)
}
const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Uso: node tools/pruebas-suaves.mjs <herramienta> [argumentos…]')
  process.exit(2)
}
// npx es un .cmd en Windows y necesita la consola: el comando va entero, con comillas en lo que lleve espacios
const quote = (arg) => (/[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg)
const child = spawn(['npx', ...args].map(quote).join(' '), { stdio: 'inherit', shell: true })
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
