// Junta varias capturas en una sola imagen para revisarlas de un vistazo.
// Uso: node tools/revision/montaje.mjs salida.png columnas entrada1.png entrada2.png ...
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

const [out, columns, ...inputs] = process.argv.slice(2)
const cols = Number(columns)
const crop = process.env.RECORTE // p. ej. "3/4": recorta cada captura a esa proporción desde el centro
const imgStyle = crop ? `width:100%;aspect-ratio:${crop};object-fit:cover;display:block` : 'width:100%;display:block'
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},1fr);gap:4px">${inputs
  .map(
    (file) =>
      `<figure style="margin:0;position:relative"><img src="${pathToFileURL(path.resolve(file))}" style="${imgStyle}"><figcaption style="position:absolute;left:6px;top:6px;font:12px monospace;color:#d5eb77;background:#000a;padding:2px 6px">${path.basename(file, '.png')}</figcaption></figure>`,
  )
  .join('')}</body>`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1800, height: 600 } })
const htmlFile = path.join(os.tmpdir(), 'montaje-capturas.html')
fs.writeFileSync(htmlFile, html)
await page.goto(pathToFileURL(htmlFile).href)
await page.waitForLoadState('load')
await page.waitForTimeout(500)
await page.screenshot({ path: out, fullPage: true })
await browser.close()
