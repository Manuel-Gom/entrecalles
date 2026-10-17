import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { AvatarAssembly } from './assembler'
import { SLOTS, TINT_SLOTS, normalizeSpec, tintFor, visiblePieces, type AvatarSpec, type Catalog } from './catalog'

const WIDTH = 240
const HEIGHT = 300

interface Rig {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
}

let rig: Rig | null = null
let queue: Promise<unknown> = Promise.resolve()
const cache = new Map<string, string>()

function getRig(): Rig {
  if (rig) return rig
  const canvas = document.createElement('canvas')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(WIDTH, HEIGHT, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.9
  renderer.setClearColor(0x000000, 0)

  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  scene.environmentIntensity = 0.5
  pmrem.dispose()
  const key = new THREE.DirectionalLight(0xfff1dc, 1.5)
  key.position.set(-1.6, 2.4, 3)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xd5eb77, 0.9)
  rim.position.set(2.2, 1.8, -2.4)
  scene.add(rim)
  scene.add(new THREE.HemisphereLight(0xdfeadb, 0x1d2823, 0.3))

  const camera = new THREE.PerspectiveCamera(22, WIDTH / HEIGHT, 0.05, 20)
  rig = { renderer, scene, camera }
  return rig
}

async function draw(spec: AvatarSpec, catalog: Catalog): Promise<string> {
  const { renderer, scene, camera } = getRig()
  const assembly = await AvatarAssembly.create(spec.cuerpo)
  try {
    const wanted = visiblePieces(spec, catalog)
    assembly.setHairColor(spec.colorPelo ?? null)
    for (const slot of TINT_SLOTS) assembly.setPieceColor(slot, tintFor(spec, catalog, slot))
    await Promise.all(SLOTS.map((slot) => assembly.setPiece(slot, wanted[slot] ?? null)))
    scene.add(assembly.root)
    const box = new THREE.Box3().setFromObject(assembly.root, true)
    const height = Math.max(1, box.max.y)
    // busto: de la cabeza al pecho
    const span = height * 0.34
    const target = new THREE.Vector3(0, height * 0.86, 0)
    const distance = span / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    camera.position.set(0.12, target.y + 0.02, distance)
    camera.lookAt(target)
    renderer.render(scene, camera)
    return renderer.domElement.toDataURL('image/webp', 0.85)
  } finally {
    scene.remove(assembly.root)
    assembly.dispose()
  }
}

/** Retrato (data URL) de un aspecto. Se dibuja de uno en uno y se guarda en memoria. */
export function renderThumbnail(spec: AvatarSpec, catalog: Catalog): Promise<string> {
  const normalized = normalizeSpec(spec, catalog)
  const key = JSON.stringify(normalized)
  const hit = cache.get(key)
  if (hit) return Promise.resolve(hit)
  const job = queue.then(async () => {
    const again = cache.get(key)
    if (again) return again
    const url = await draw(normalized, catalog)
    cache.set(key, url)
    return url
  })
  queue = job.catch(() => undefined)
  return job
}

export const cachedThumbnail = (spec: AvatarSpec, catalog: Catalog) => cache.get(JSON.stringify(normalizeSpec(spec, catalog)))

declare global {
  interface Window {
    __renderThumbnail?: typeof renderThumbnail
  }
}
// enganche para las pruebas y para generar los retratos de los PNJ (tools/revision/retratos.mjs)
window.__renderThumbnail = renderThumbnail
