import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { AvatarAssembly } from './assembler'
import { buildAssembly } from './build'
import { SLOTS, type AvatarSpec, type Catalog } from './catalog'

export type StudioState = 'idle' | 'loading' | 'ready' | 'error' | 'unsupported'

type Listener = (state: StudioState) => void

const LIME = 0xd5eb77

function makeWindowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 256
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#18211d'
    ctx.fillRect(0, 0, 128, 256)
    for (let y = 10; y < 250; y += 22) {
      for (let x = 10; x < 120; x += 20) {
        const lit = ((x * 7 + y * 13) % 5) < 2
        ctx.fillStyle = lit ? '#e8f59a' : '#222d28'
        ctx.globalAlpha = lit ? 0.75 : 1
        ctx.fillRect(x, y, 9, 12)
      }
    }
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  return texture
}

/** Estudio 3D compartido: un único renderer que se coloca dentro del contenedor que lo pida. */
export class AvatarStudio {
  readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer | null = null
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(28, 1, 0.1, 60)
  private readonly pivot = new THREE.Group()
  private readonly clock = new THREE.Clock()
  private host: HTMLElement | null = null
  private observer: ResizeObserver | null = null
  private assembly: AvatarAssembly | null = null
  private modelHeight = 1.75
  private yaw = 0
  private targetYaw = 0
  private reducedMotion = false
  private frame = 0
  private requestToken = 0
  private state: StudioState = 'idle'
  private dragging = false
  private lastPointerX = 0
  private readonly listeners = new Set<Listener>()

  constructor() {
    this.canvas = document.createElement('canvas')
    this.canvas.style.display = 'block'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'
    this.canvas.style.touchAction = 'pan-y'
    this.canvas.style.cursor = 'grab'

    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' })
    } catch {
      this.setState('unsupported')
      return
    }
    const renderer = this.renderer
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.05
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    this.buildScene(renderer)
    this.bindPointer()

    this.canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault()
      this.stop()
      this.setState('unsupported')
    })
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.setState(this.assembly ? 'ready' : 'idle')
      this.requestRender()
    })
  }

  private buildScene(renderer: THREE.WebGLRenderer) {
    const { scene } = this
    scene.background = new THREE.Color(0x0e1311)
    scene.fog = new THREE.Fog(0x0e1311, 9, 22)

    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.55
    pmrem.dispose()

    scene.add(new THREE.HemisphereLight(0xdfeadb, 0x1d2823, 0.5))

    const key = new THREE.DirectionalLight(0xfff1dc, 2.6)
    key.position.set(-2.4, 4.2, 3.4)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.near = 0.5
    key.shadow.camera.far = 12
    key.shadow.camera.left = -2
    key.shadow.camera.right = 2
    key.shadow.camera.top = 3
    key.shadow.camera.bottom = -1
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    key.shadow.radius = 4
    scene.add(key)

    const rim = new THREE.DirectionalLight(LIME, 2.0)
    rim.position.set(2.8, 2.6, -3)
    scene.add(rim)

    const fill = new THREE.DirectionalLight(0x9fcfd0, 0.7)
    fill.position.set(3, 1.5, 2.5)
    scene.add(fill)

    // suelo y plataforma
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(30, 48),
      new THREE.MeshStandardMaterial({ color: 0x131a17, roughness: 0.85 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.position.y = -0.02
    floor.receiveShadow = true
    scene.add(floor)

    const platform = new THREE.Mesh(
      new THREE.CylinderGeometry(1.15, 1.2, 0.06, 64),
      new THREE.MeshStandardMaterial({ color: 0x232d28, roughness: 0.55, metalness: 0.15 }),
    )
    platform.position.y = -0.03
    platform.receiveShadow = true
    scene.add(platform)

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.15, 0.012, 8, 96),
      new THREE.MeshStandardMaterial({ color: LIME, emissive: LIME, emissiveIntensity: 1.1 }),
    )
    ring.rotation.x = Math.PI / 2
    ring.position.y = 0.002
    scene.add(ring)

    // calle al fondo: siluetas de edificios con ventanas
    const windows = makeWindowTexture()
    const rng = (seed: number) => {
      const x = Math.sin(seed * 127.1) * 43758.5453
      return x - Math.floor(x)
    }
    for (let index = 0; index < 14; index += 1) {
      const width = 1.2 + rng(index) * 1.4
      const height = 3 + rng(index + 40) * 5
      const texture = windows.clone()
      texture.needsUpdate = true
      texture.repeat.set(Math.max(1, Math.round(width)), Math.max(1, Math.round(height / 2)))
      const building = new THREE.Mesh(
        new THREE.BoxGeometry(width, height, 1.2),
        new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: 0x9aa86a, emissiveIntensity: 0.35, roughness: 0.9 }),
      )
      const side = index % 2 === 0 ? -1 : 1
      building.position.set(side * (2.9 + Math.floor(index / 2) * 1.5), height / 2 - 0.02, -5.4 - rng(index + 9) * 1.6)
      scene.add(building)
    }
    // luz de neón cálida al fondo (solo ambiente)
    const glow = new THREE.PointLight(0xff8a6b, 5, 6)
    glow.position.set(2.4, 2.4, -3)
    scene.add(glow)

    scene.add(this.pivot)
    this.camera.position.set(0, 1, 5)
  }

  private bindPointer() {
    const { canvas } = this
    canvas.addEventListener('pointerdown', (event) => {
      this.dragging = true
      this.lastPointerX = event.clientX
      canvas.setPointerCapture(event.pointerId)
      canvas.style.cursor = 'grabbing'
    })
    canvas.addEventListener('pointermove', (event) => {
      if (!this.dragging) return
      const dx = event.clientX - this.lastPointerX
      this.lastPointerX = event.clientX
      this.rotate(dx * 0.012, true)
    })
    const end = (event: PointerEvent) => {
      this.dragging = false
      canvas.style.cursor = 'grab'
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    }
    canvas.addEventListener('pointerup', end)
    canvas.addEventListener('pointercancel', end)
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    listener(this.state)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private setState(state: StudioState) {
    this.state = state
    this.listeners.forEach((listener) => listener(state))
  }

  /** Coloca el lienzo dentro de `host`. */
  mount(host: HTMLElement) {
    this.host = host
    host.appendChild(this.canvas)
    this.observer?.disconnect()
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(host)
    this.resize()
    this.start()
  }

  unmount(host: HTMLElement) {
    if (this.host !== host) return
    this.observer?.disconnect()
    this.observer = null
    this.stop()
    if (this.canvas.parentElement === host) host.removeChild(this.canvas)
    this.host = null
  }

  setReducedMotion(reduced: boolean) {
    this.reducedMotion = reduced
    if (reduced) this.assembly?.pose.reset()
    this.start()
  }

  /** Prepara el aspecto completo fuera de escena y lo muestra cuando está listo. */
  async setAvatar(spec: AvatarSpec, catalog: Catalog) {
    if (!this.renderer) return
    const token = ++this.requestToken
    const isCurrent = () => token === this.requestToken
    try {
      this.setState('loading')
      const staging = await buildAssembly(spec, catalog, isCurrent)
      if (!staging) return

      // Todas las piezas están listas: el intercambio ocurre antes del siguiente fotograma.
      const previous = this.assembly
      const box = new THREE.Box3().setFromObject(staging.root, true)
      this.pivot.add(staging.root)
      this.assembly = staging
      if (this.reducedMotion) this.assembly.pose.reset()
      if (previous) {
        this.pivot.remove(previous.root)
        previous.dispose()
      }
      // los modelos ya salen de Blender con los pies en y = 0
      this.modelHeight = Math.max(1, box.max.y)
      this.frameCamera()
      this.setState('ready')
      this.requestRender()
    } catch (error) {
      if (isCurrent()) {
        console.error('No se pudo preparar el personaje completo.', error)
        this.setState('error')
      }
    }
  }

  /** Gira el personaje (radianes). */
  rotate(amount: number, immediate = false) {
    this.targetYaw += amount
    if (immediate || this.reducedMotion) this.yaw = this.targetYaw
    this.requestRender()
  }

  private frameCamera() {
    const aspect = this.camera.aspect
    const fov = THREE.MathUtils.degToRad(this.camera.fov)
    const height = this.modelHeight * 1.22
    const distanceForHeight = height / 2 / Math.tan(fov / 2)
    const horizontalFov = 2 * Math.atan(Math.tan(fov / 2) * aspect)
    const distanceForWidth = 1.5 / 2 / Math.tan(horizontalFov / 2)
    const distance = Math.max(distanceForHeight, distanceForWidth)
    const lookAtY = this.modelHeight * 0.5
    this.camera.position.set(0, lookAtY + this.modelHeight * 0.06, distance)
    this.camera.lookAt(0, lookAtY, 0)
  }

  private resize() {
    if (!this.renderer || !this.host) return
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.frameCamera()
    this.requestRender()
  }

  private start() {
    if (!this.renderer || !this.host) return
    cancelAnimationFrame(this.frame)
    if (this.reducedMotion) {
      this.requestRender()
      return
    }
    this.clock.start()
    const loop = () => {
      this.frame = requestAnimationFrame(loop)
      this.draw()
    }
    loop()
  }

  private stop() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private requestRender() {
    if (!this.reducedMotion) return // el bucle ya dibuja cada fotograma
    cancelAnimationFrame(this.frame)
    this.frame = requestAnimationFrame(() => this.draw())
  }

  private draw() {
    if (!this.renderer) return
    this.yaw += (this.targetYaw - this.yaw) * (this.reducedMotion ? 1 : 0.18)
    this.pivot.rotation.y = this.yaw
    if (!this.reducedMotion) this.assembly?.pose.idle(this.clock.getElapsedTime())
    this.renderer.render(this.scene, this.camera)
  }

  /** Datos para pruebas de memoria. */
  stats() {
    const info = this.renderer?.info
    return {
      model: this.assembly?.cuerpo ?? null,
      pieces: SLOTS.map((slot) => this.assembly?.pieceId(slot) ?? '-').join(','),
      tints: this.assembly?.tints() ?? {},
      state: this.state,
      geometries: info?.memory.geometries ?? 0,
      textures: info?.memory.textures ?? 0,
      calls: info?.render.calls ?? 0,
      triangles: info?.render.triangles ?? 0,
    }
  }
}

let studio: AvatarStudio | null = null

export function getStudio(): AvatarStudio {
  studio ??= new AvatarStudio()
  return studio
}

declare global {
  interface Window {
    __avatarStudio?: () => AvatarStudio
  }
}
window.__avatarStudio = getStudio
