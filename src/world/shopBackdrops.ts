import * as THREE from 'three'
import type { ShopKind } from './layout'

/**
 * El fondo que se ve por el escaparate de un local mientras su edificio no está montado por dentro: un interior
 * pintado (pared del fondo, paredes de los lados en perspectiva, techo con luces y los muebles de cada tipo de local)
 * en una textura de canvas. Abierto se ilumina (más de noche); cerrado se queda a oscuras.
 */
export type ShopBackdropKind = Exclude<ShopKind, 'cafe'>

const W = 512
const H = 406

interface Palette {
  wall: string
  side: string
  floor: string
}

const PALETTES: Record<ShopBackdropKind, Palette> = {
  tienda: { wall: '#e9e1d2', side: '#d6ccb9', floor: '#b9ab94' },
  farmacia: { wall: '#eef3f0', side: '#d9e2dd', floor: '#c9d0cc' },
  panaderia: { wall: '#f1e2c7', side: '#e0cda9', floor: '#a88761' },
  peluqueria: { wall: '#e8e8ec', side: '#d3d3da', floor: '#9a9aa3' },
}

/** Pinta el interior de un tipo de local (null si no hay canvas, por ejemplo en las pruebas sin navegador). */
export function paintShopBackdrop(kind: ShopBackdropKind): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const g = canvas.getContext('2d')
  if (!g) return null
  const pal = PALETTES[kind]
  // la caja de la sala en perspectiva: el fondo es el rectángulo del centro
  const back = { x0: 70, x1: W - 70, y0: 60, y1: H - 95 }
  g.fillStyle = pal.wall
  g.fillRect(0, 0, W, H)
  const quad = (points: [number, number][], color: string) => {
    g.fillStyle = color
    g.beginPath()
    points.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    g.closePath()
    g.fill()
  }
  quad([[0, 0], [back.x0, back.y0], [back.x0, back.y1], [0, H]], pal.side)
  quad([[W, 0], [back.x1, back.y0], [back.x1, back.y1], [W, H]], pal.side)
  quad([[0, H], [back.x0, back.y1], [back.x1, back.y1], [W, H]], pal.floor)
  quad([[0, 0], [back.x0, back.y0], [back.x1, back.y0], [W, 0]], '#f7f5ef')
  // luces del techo
  g.fillStyle = '#fffbea'
  for (const x of [0.3, 0.5, 0.7]) g.fillRect(W * x - 34, 18, 68, 10)

  const shelf = (x0: number, x1: number, y0: number, y1: number, rows: number, colors: string[]) => {
    g.fillStyle = '#8a7a66'
    g.fillRect(x0, y0, x1 - x0, y1 - y0)
    const step = (y1 - y0) / rows
    for (let r = 0; r < rows; r++) {
      const y = y0 + r * step
      g.fillStyle = '#efe9de'
      g.fillRect(x0 + 4, y + 4, x1 - x0 - 8, step - 8)
      for (let x = x0 + 8, i = r; x < x1 - 14; x += 14, i++) {
        g.fillStyle = colors[i % colors.length]
        g.fillRect(x, y + step - 8 - (10 + ((i * 7) % 9)), 10, 10 + ((i * 7) % 9))
      }
    }
  }
  const counter = (x0: number, x1: number, y0: number, top: string, front: string) => {
    g.fillStyle = front
    g.fillRect(x0, y0, x1 - x0, back.y1 + 40 - y0)
    g.fillStyle = top
    g.fillRect(x0 - 6, y0 - 8, x1 - x0 + 12, 10)
  }
  if (kind === 'tienda') {
    shelf(back.x0 + 10, back.x1 - 10, back.y0 + 20, back.y1, 4, ['#c0392b', '#2e86c1', '#f1c40f', '#27ae60', '#8e44ad', '#e67e22'])
    counter(back.x0 + 20, back.x0 + 150, back.y1 - 30, '#5d4a36', '#7b634a')
  } else if (kind === 'farmacia') {
    shelf(back.x0 + 10, back.x1 - 10, back.y0 + 50, back.y1, 4, ['#ffffff', '#d5f5e3', '#aed6f1', '#fadbd8'])
    // la cruz verde
    g.fillStyle = '#1e9e57'
    g.fillRect(W / 2 - 9, back.y0 + 6, 18, 40)
    g.fillRect(W / 2 - 20, back.y0 + 17, 40, 18)
    counter(W / 2 - 110, W / 2 + 110, back.y1 - 20, '#cfd8d4', '#f3f6f4')
  } else if (kind === 'panaderia') {
    shelf(back.x0 + 10, back.x1 - 10, back.y0 + 20, back.y1 - 60, 3, ['#c68642', '#e0a96d', '#a0522d', '#deb887'])
    // la vitrina con el pan
    counter(W / 2 - 130, W / 2 + 130, back.y1 - 10, '#d8e6ec', '#6e5038')
    g.fillStyle = '#d9a25f'
    for (let x = W / 2 - 115; x < W / 2 + 115; x += 26) g.fillRect(x, back.y1 - 6, 20, 8)
  } else {
    // espejos y sillones
    for (let i = 0; i < 4; i++) {
      const x = back.x0 + 30 + i * ((back.x1 - back.x0 - 60) / 4)
      g.fillStyle = '#b9d3e0'
      g.fillRect(x + 8, back.y0 + 40, 60, 80)
      g.fillStyle = '#2b2b30'
      g.fillRect(x + 14, back.y1 - 70, 48, 50)
      g.fillRect(x + 32, back.y1 - 20, 12, 30)
    }
  }
  return canvas
}

/** El material de un tipo de local, con su interior pintado (o liso si no hay canvas). */
export function shopBackdropMaterial(kind: ShopBackdropKind): THREE.MeshStandardMaterial {
  const canvas = paintShopBackdrop(kind)
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, emissive: 0xffffff, emissiveIntensity: 0 })
  if (canvas) {
    const texture = new THREE.CanvasTexture(canvas)
    texture.colorSpace = THREE.SRGBColorSpace
    material.map = texture
    material.emissiveMap = texture
  } else material.color.set(PALETTES[kind].wall)
  return material
}

/** Lo iluminado que se ve un local: abierto, algo de día y más de noche; cerrado, casi a oscuras. */
export function lightShopBackdrop(material: THREE.MeshStandardMaterial, open: boolean, night: boolean) {
  material.emissiveIntensity = open ? (night ? 0.85 : 0.3) : 0.02
  material.color.setScalar(open ? 1 : 0.18)
}
