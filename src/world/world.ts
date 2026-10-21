import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { AvatarAssembly } from '../avatar/assembler'
import { buildAssembly } from '../avatar/build'
import { normalizeSpec, type AvatarSpec, type Catalog } from '../avatar/catalog'
import type { Npc } from '../avatar/npcs'
import { NPC_RADIUS, NpcBrain, TalkPair, seatsFor, ACTIVITY_LABELS, type Activity, type Seat } from './brain'
import type { Box, Circle } from './collision'
import type { Spot } from './layout'
import { chooseCast } from './cast'
import { buildCityMeshes, type CityMeshes } from './cityMesh'
import { FollowCamera } from './followCamera'
import { InputController, type Controls, type GamepadInfo, type InputDevice } from './inputController'
import { generateCity, makeRng, type CityLayout } from './layout'
import { Locomotor } from './locomotor'
import { FrameStats, formatDiagnostics } from './perf'
import { AudioEngine, attenuation, panFor, stepVolume, surfaceAt, type AudioState, type Volumes } from './audio'
import { PairDialogue } from './dialogue'
import { Interior } from './interior'
import { Storefront } from './storefront'
import { disposeProp, instanceProp, loadProp, placementMatrix, type Prop } from './props'
import { LAMP_HEIGHT, LAMP_LIGHT, LampAssigner, REAL_LAMPS, buildFacadeGlows, buildLightPools, disposeLightPools, facadeGlows, lampHead, lampYaw, nearestLamps } from './streetLights'
import { SeatSession, findSeat, makeSeatRoute } from './seating'
import { PLAYER_ID, PLAYER_RADIUS, nearestAngle, newPlayer, stepPlayer, type PlayerInput, type PlayerState } from './player'
import { advanceGameClock, celestialPosition, celestialState, formatGameClock, lunarPhase, skyColors, type CelestialState, type MoonPhase } from './dayNight'
import { animateWater, type AnimatedWater } from './water'

export type Quality = 'baja' | 'media' | 'alta'
export type WorldState = 'cargando' | 'listo' | 'error' | 'sin-3d'
export type { Controls, GamepadInfo, InputDevice }
/** Lo que haría ahora la tecla de interactuar. */
export type Prompt = 'sentarse' | 'levantarse' | 'entrar' | 'salir'

export interface WorldInit {
  host: HTMLElement
  catalog: Catalog
  spec: AvatarSpec
  npcs: Npc[]
  controls: Controls
  reducedMotion: boolean
  quality: Quality
  /** el mando pidió pausar (el estado de pausa lo lleva la interfaz) */
  onPause?: () => void
  /** volúmenes de los ajustes (0-100) */
  volumes: Volumes
  /** mostrar lo que dicen los vecinos como texto */
  subtitles: boolean
}

/** Lo que se está diciendo cerca del protagonista. */
export interface Subtitle {
  speaker: string
  text: string
}

export interface WorldStatus {
  state: WorldState
  npcsLoaded: number
  npcsTotal: number
  fps: number
  /** con qué se está jugando ahora */
  device: InputDevice
  gamepad: GamepadInfo | null
  /** lo que haría la tecla de interactuar ahora mismo, si algo */
  prompt: Prompt | null
  /** la línea de la charla más cercana, si los subtítulos están activados */
  subtitle: Subtitle | null
  /** estado del sonido: 'suspended' hasta que el navegador deja sonar (tras una tecla o un clic) */
  audio: AudioState
  /** hora del barrio (cada segundo real equivale a un minuto de juego) */
  gameTime: string
  /** texto con FPS, tirones, resolución, calidad y tarjeta gráfica, para copiar */
  diagnostics: string
}

type Listener = (status: WorldStatus) => void

interface Actor {
  assembly: AvatarAssembly
  locomotor: Locomotor
  group: THREE.Group
  /** hacia dónde miraba en el fotograma anterior y velocidad de giro suavizada (rad/s, positivo = hacia su izquierda) */
  prevYaw: number
  turn: number
}

interface NpcActor extends Actor {
  id: string
  name: string
  brain: NpcBrain
  /** la pareja con la que charla, si la tiene, y si ahora le toca hablar a él */
  pair?: TalkPair
  pairIndex: number
  speaking: boolean
}

/** Una pareja que charla: sus dos vecinos y lo que se dicen. */
interface Chat {
  dialogue: PairDialogue
  members: NpcActor[]
}

/** Hasta qué distancia (m) se leen los subtítulos y se oye el murmullo de una charla. */
const CHAT_RANGE = 11

const GROUND = 0.025
const NPC_ANIMATE_DISTANCE = 48
const NPC_HIDE_DISTANCE = 80
const SKY = 0xbcd2e4
const MOON_MODELS: Record<MoonPhase, string> = {
  nueva: 'luna_nueva',
  creciente: 'luna_creciente',
  llena: 'luna_llena',
  menguante: 'luna_menguante',
}
/** Duración de cada mitad del fundido al entrar o salir de un edificio (s). */
const FADE_SECONDS = 0.28
const INTERIOR_BACKGROUND = 0xd9c7a3

interface Transition {
  action: 'entrar' | 'salir'
  phase: 'out' | 'in'
  /** progreso de la fase actual, 0-1 */
  t: number
}

const QUALITY: Record<Quality, { pixelRatio: number; shadows: boolean; shadowSize: number }> = {
  baja: { pixelRatio: 0.85, shadows: false, shadowSize: 1024 },
  media: { pixelRatio: 1, shadows: true, shadowSize: 1024 },
  alta: { pixelRatio: 2, shadows: true, shadowSize: 2048 },
}

/** Qué luces hay en la escena: el sol (con su sombra), la luna y las luces reales de las farolas. */
interface LightingState {
  sun: boolean
  moon: boolean
  lamps: boolean
}

/** El barrio jugable: escena, jugador, PNJ y bucle. Se crea al entrar en la pantalla y se libera al salir. */
export class World {
  readonly layout: CityLayout
  private readonly host: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private renderer: THREE.WebGLRenderer | null = null
  private readonly scene = new THREE.Scene()
  private readonly camera = new THREE.PerspectiveCamera(55, 1, 0.1, 260)
  private readonly follow: FollowCamera
  private readonly sun = new THREE.DirectionalLight(0xfff0d8, 2.6)
  private readonly moon = new THREE.DirectionalLight(0xc5d4f2, 0.25)
  private readonly lampLights: THREE.PointLight[] = []
  private lampAssigner = new LampAssigner(0)
  private wantedLamps: number[] = []
  private lightPools: THREE.InstancedMesh | null = null
  private facadeGlow: THREE.InstancedMesh | null = null
  /** qué luces hay en la escena; va por detrás del reloj mientras se preparan los materiales del cambio */
  private lighting: LightingState = { sun: true, moon: false, lamps: false }
  private lightingPreparing = false
  private readonly lampMaterials: THREE.MeshStandardMaterial[] = []
  private city: CityMeshes | null = null
  /** todo lo de la calle (ciudad, bancos, fachada y vecinos): se oculta al entrar en un edificio */
  private readonly exterior = new THREE.Group()
  private hemi: THREE.HemisphereLight | null = null
  private storefront: Storefront | null = null
  private interior: Interior | null = null
  private interiorLoading: Promise<void> | null = null
  private inside = false
  private transition: Transition | null = null
  private fade: HTMLDivElement | null = null
  private benchProp: Prop | null = null
  private benchGroup: THREE.Group | null = null
  private readonly sceneryProps: Prop[] = []
  private readonly sceneryLoaded = new Set<'fuente' | 'arbol' | 'farola' | 'sol' | 'luna'>()
  private sunModel: Prop | null = null
  private readonly moonModels = new Map<MoonPhase, Prop>()
  private moonPhase: MoonPhase = 'llena'
  private water: AnimatedWater | null = null
  private celestial: CelestialState = celestialState(new Date())
  private gameClock = new Date()
  private lampRefresh = 0
  private environment: THREE.Texture | null = null
  private observer: ResizeObserver | null = null
  private frame = 0
  private lastTime = 0
  /** duración del último fotograma (s): la cámara se suaviza con el tiempo real, no con 60 Hz fijos */
  private frameDt = 1 / 60
  private disposed = false
  private paused = false
  private state: WorldState = 'cargando'
  private quality: Quality
  private readonly listeners = new Set<Listener>()

  private readonly player: PlayerState
  private playerActor: Actor | null = null
  private animSpeed = 0
  /** todos los actores como círculos en el suelo: el del jugador primero, luego los PNJ en su orden */
  private readonly circles: Circle[] = [{ id: PLAYER_ID, x: 0, z: 0, r: PLAYER_RADIUS }]
  private readonly occupiedSpots = new Set<Spot>()
  private readonly npcActors: NpcActor[] = []
  private npcsTotal = 0
  private time = 0
  private fpsFrames = 0
  private fpsTime = 0
  private fps = 0

  private input: InputController | null = null
  /** última entrada de movimiento leída (teclado y mando) y acción de interactuar pendiente */
  private move: PlayerInput = { moveX: 0, moveZ: 0, run: false }
  private interactPending = false
  /** las plazas de los bancos, compartidas con los PNJ para que nadie se siente donde ya hay alguien */
  private readonly seats: Seat[]
  private seating: SeatSession | null = null
  private prompt: Prompt | null = null
  private readonly audio: AudioEngine
  private readonly chats = new Map<TalkPair, Chat>()
  private subtitle: Subtitle | null = null
  private readonly unlockAudio = () => this.audio.unlock()
  private readonly frameStats = new FrameStats()
  private gpuName: string | null = null
  private readonly init: WorldInit
  private cameraSnap = true
  /** Solo para pruebas y revisión visual: entrada fija en lugar del teclado, y punto al que mira la cámara. */
  inputOverride: PlayerInput | null = null
  focusOverride: { x: number; z: number } | null = null
  cameraClip = true
  /** Solo para pruebas: false oculta la luz pintada de las farolas (charcos y resplandores), para comparar cuánto iluminan. */
  showLightPools = true
  /** Solo para revisión visual: fuerza al protagonista a estar sentado o hablando. */
  playerPoseOverride: { sit: number; talk: number } | null = null

  constructor(init: WorldInit) {
    this.init = init
    this.host = init.host
    this.quality = init.quality
    this.layout = generateCity()
    this.seats = seatsFor(this.layout)
    this.audio = new AudioEngine(init.volumes)
    const { spawn } = this.layout
    this.player = newPlayer(spawn.x, spawn.z, spawn.yaw)
    // la cámara empieza detrás del personaje
    this.follow = new FollowCamera(spawn.yaw + Math.PI)

    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline:none'
    this.canvas.tabIndex = 0
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' })
    } catch {
      this.setState('sin-3d')
      return
    }
    try {
      this.buildScene(this.renderer)
      this.applyQuality()
      this.host.appendChild(this.canvas)
      // capa negra para el fundido al cruzar una puerta
      this.fade = document.createElement('div')
      this.fade.style.cssText = 'position:absolute;inset:0;background:#000;opacity:0;pointer-events:none'
      this.host.appendChild(this.fade)
      this.input = new InputController(
        this.canvas,
        init.controls,
        { orbit: (yaw, pitch) => this.follow.orbit(yaw, pitch), zoom: (delta) => this.follow.zoom(delta) },
        () => this.emit(),
        () => this.paused,
      )

      // el navegador solo deja sonar tras un gesto del usuario: se intenta ya (el clic de "Comenzar aventura" cuenta) y en cada tecla o clic
      this.audio.unlock()
      for (const type of ['keydown', 'pointerdown'] as const) window.addEventListener(type, this.unlockAudio, true)
      this.observer = new ResizeObserver(() => this.resize())
      this.observer.observe(this.host)
      this.resize()

      this.canvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault()
        this.stop()
        this.setState('sin-3d')
      })
      this.start()
    } catch (error) {
      // un fallo a medio montar: se libera lo ya creado (contexto WebGL, escuchas, lienzo) y quien creó el barrio avisa
      this.dispose()
      throw error
    }
    void this.loadPlayer()
  }

  /* ---------- escena ---------- */

  private buildScene(renderer: THREE.WebGLRenderer) {
    const { scene } = this
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.shadowMap.type = THREE.PCFSoftShadowMap

    scene.background = new THREE.Color(SKY)
    scene.fog = new THREE.Fog(SKY, 80, 190)
    const pmrem = new THREE.PMREMGenerator(renderer)
    this.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environment = this.environment
    scene.environmentIntensity = 0.5
    pmrem.dispose()

    this.hemi = new THREE.HemisphereLight(0xdbe9ff, 0x6f6a5c, 0.9)
    scene.add(this.hemi)
    this.sun.castShadow = true
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 150
    this.sun.shadow.camera.left = -34
    this.sun.shadow.camera.right = 34
    this.sun.shadow.camera.top = 34
    this.sun.shadow.camera.bottom = -34
    this.sun.shadow.bias = -0.0005
    this.sun.shadow.normalBias = 0.03
    this.moon.castShadow = false
    scene.add(this.sun, this.sun.target, this.moon, this.moon.target)

    this.city = buildCityMeshes(this.layout)
    this.exterior.add(this.city.group)
    // un charco de luz bajo cada farola: lo que deja ver iluminadas las calles lejanas de noche
    this.lightPools = buildLightPools(this.layout.lamps)
    this.exterior.add(this.lightPools)
    // y un resplandor en la fachada de detrás: las paredes iluminadas se ven desde lejos
    this.facadeGlow = buildFacadeGlows(facadeGlows(this.layout.lamps, this.layout.buildings))
    this.exterior.add(this.facadeGlow)
    scene.add(this.exterior)
    this.updateCelestial(this.gameClock)
  }

  /** Tantas luces reales como pida la calidad, en las farolas más cercanas (ver streetLights.ts). */
  private syncLampLights() {
    const count = REAL_LAMPS[this.quality]
    while (this.lampLights.length < count) {
      const light = new THREE.PointLight(LAMP_LIGHT.color, LAMP_LIGHT.intensity, LAMP_LIGHT.distance, LAMP_LIGHT.decay)
      light.visible = false
      this.exterior.add(light)
      this.lampLights.push(light)
    }
    while (this.lampLights.length > count) this.lampLights.pop()?.removeFromParent()
    // las luces nuevas toman la visibilidad del estado actual (si ya es de noche, encendidas)
    this.applyLighting()
    this.lampAssigner = new LampAssigner(count)
    this.lampRefresh = 0
    this.updateNightLighting(0)
  }

  private applyQuality() {
    const { renderer } = this
    if (!renderer) return
    const settings = QUALITY[this.quality]
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio))
    const shadowsChanged = renderer.shadowMap.enabled !== settings.shadows
    renderer.shadowMap.enabled = settings.shadows
    this.sun.castShadow = settings.shadows
    if (this.sun.shadow.mapSize.x !== settings.shadowSize) {
      this.sun.shadow.mapSize.set(settings.shadowSize, settings.shadowSize)
      this.sun.shadow.map?.dispose()
      this.sun.shadow.map = null
    }
    if (shadowsChanged) {
      this.scene.traverse((object) => {
        const material = (object as THREE.Mesh).material
        if (Array.isArray(material)) material.forEach((m) => (m.needsUpdate = true))
        else if (material) material.needsUpdate = true
      })
    }
    this.syncLampLights()
    this.resize()
  }

  setQuality(quality: Quality) {
    this.quality = quality
    this.applyQuality()
  }

  private resize() {
    if (!this.renderer) return
    const width = Math.max(1, this.host.clientWidth)
    const height = Math.max(1, this.host.clientHeight)
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  /* ---------- personajes ---------- */

  private async loadPlayer() {
    try {
      const assembly = await buildAssembly(normalizeSpec(this.init.spec, this.init.catalog), this.init.catalog, () => !this.disposed)
      if (!assembly) return
      if (this.disposed) {
        assembly.dispose()
        return
      }
      this.playerActor = this.addActor(assembly, 0.37)
      this.placeActor(this.playerActor, this.player.x, this.player.z, this.player.yaw)
      this.gameClock = new Date()
      this.updateCelestial(this.gameClock)
      this.setState('listo')
      void this.loadScenery()
      void this.loadCast()
    } catch (error) {
      console.error('No se pudo preparar al protagonista.', error)
      this.setState('error')
    }
  }

  /** Los modelos de Blender sustituyen el mobiliario de relleno generado por el código. */
  private async loadScenery() {
    const failed = (what: string) => (error: unknown) => console.error(`No se pudo cargar ${what}; se queda el de relleno.`, error)
    await Promise.all([
      loadProp('banco')
        .then((prop) => {
          if (this.disposed) return disposeProp(prop)
          this.benchProp = prop
          this.benchGroup = instanceProp(prop, this.layout.benches.map((bench) => placementMatrix(bench.x, 0, bench.z, bench.yaw)))
          this.exterior.add(this.benchGroup)
          if (this.city) this.city.benchMesh.visible = false
        })
        .catch(failed('los bancos')),
      Storefront.load(this.layout.storefront)
        .then((storefront) => {
          if (this.disposed) return storefront.dispose()
          this.storefront = storefront
          this.exterior.add(storefront.group)
        })
        .catch(failed('la fachada del café')),
      loadProp('fuente')
        .then((prop) => {
          if (this.disposed) return disposeProp(prop)
          prop.root.traverse((object) => {
            const mesh = object as THREE.Mesh
            if (!mesh.isMesh) return
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            for (const material of materials) {
              if (material.name === 'AguaFuente' && material instanceof THREE.MeshStandardMaterial) this.water = animateWater(material)
            }
          })
          this.sceneryProps.push(prop)
          this.sceneryLoaded.add('fuente')
          this.exterior.add(instanceProp(prop, [placementMatrix(0, 0, 0, 0)]))
          if (this.city) this.city.fountainMesh.visible = false
        })
        .catch(failed('la fuente del parque')),
      loadProp('arbol')
        .then((prop) => {
          if (this.disposed) return disposeProp(prop)
          this.sceneryProps.push(prop)
          this.sceneryLoaded.add('arbol')
          this.exterior.add(instanceProp(prop, this.layout.trees.map((tree, index) => placementMatrix(tree.x, 0, tree.z, index * 2.399963))))
          if (this.city) this.city.treeMesh.visible = false
        })
        .catch(failed('los árboles')),
      loadProp('farola')
        .then((prop) => {
          if (this.disposed) return disposeProp(prop)
          prop.root.traverse((object) => {
            const mesh = object as THREE.Mesh
            if (!mesh.isMesh) return
            const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
            for (const material of materials) {
              if (material.name !== 'CristalLechoso' || !(material instanceof THREE.MeshStandardMaterial)) continue
              material.emissive.set(0xffbf70)
              material.emissiveIntensity = 0
              this.lampMaterials.push(material)
            }
          })
          this.sceneryProps.push(prop)
          this.sceneryLoaded.add('farola')
          this.exterior.add(instanceProp(prop, this.layout.lamps.map((lamp, index) => placementMatrix(lamp.x, 0, lamp.z, lampYaw(index)))))
          if (this.city) this.city.lampMesh.visible = false
        })
        .catch(failed('las farolas')),
      loadProp('sol')
        .then((prop) => {
          if (this.disposed) return disposeProp(prop)
          this.sunModel = prop
          prop.root.scale.setScalar(0.9)
          prop.root.traverse((object) => {
            const mesh = object as THREE.Mesh
            const materials = mesh.isMesh ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []
            for (const material of materials) {
              if (material instanceof THREE.MeshStandardMaterial) {
                material.emissive.set(0xffa72e)
                material.emissiveIntensity = 0.28
              }
            }
          })
          this.sceneryProps.push(prop)
          this.sceneryLoaded.add('sol')
          this.exterior.add(prop.root)
        })
        .catch(failed('el modelo del sol')),
      Promise.all(
        (Object.entries(MOON_MODELS) as [MoonPhase, string][]).map(([phase, name]) =>
          loadProp(name)
            .then((prop) => {
              if (this.disposed) return disposeProp(prop)
              prop.root.scale.setScalar(1.55)
              prop.root.visible = phase === this.moonPhase
              prop.root.traverse((object) => {
                const mesh = object as THREE.Mesh
                const materials = mesh.isMesh ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : []
                for (const material of materials) {
                  if (!(material instanceof THREE.MeshStandardMaterial)) continue
                  if (material.name === 'RegolitoIluminado') {
                    material.emissive.set(0xbac9df)
                    material.emissiveIntensity = 1.65
                  } else if (material.name === 'CráteresIluminados') {
                    material.emissive.set(0x76859a)
                    material.emissiveIntensity = 0.95
                  } else {
                    material.emissive.set(0x111722)
                    material.emissiveIntensity = 0.12
                  }
                }
              })
              this.sceneryProps.push(prop)
              this.moonModels.set(phase, prop)
              this.exterior.add(prop.root)
            })
            .catch(failed(`el modelo de luna ${phase}`)),
        ),
      ).then(() => {
        if (this.moonModels.size === Object.keys(MOON_MODELS).length) this.sceneryLoaded.add('luna')
      }),
    ])
  }

  private addActor(assembly: AvatarAssembly, seed: number, parent: THREE.Object3D = this.scene): Actor {
    const group = new THREE.Group()
    group.add(assembly.root)
    parent.add(group)
    return { assembly, locomotor: new Locomotor(assembly, seed), group, prevYaw: 0, turn: 0 }
  }

  private placeActor(actor: Actor, x: number, z: number, yaw: number) {
    actor.group.position.set(x, GROUND, z)
    actor.group.rotation.y = yaw
  }

  /** Velocidad de giro suavizada de un actor (para inclinarse en las curvas). */
  private turnRate(actor: Actor, yaw: number, dt: number): number {
    if (dt > 0) {
      const raw = (nearestAngle(yaw, actor.prevYaw) - actor.prevYaw) / dt
      actor.turn += (Math.max(-6, Math.min(6, raw)) - actor.turn) * (1 - Math.exp(-8 * dt))
    }
    actor.prevYaw = yaw
    return actor.turn
  }

  /** Los PNJ se cargan de dos en dos para no bloquear el navegador. */
  private async loadCast() {
    const { catalog, npcs } = this.init
    // las pruebas de extremo a extremo limitan cuántos PNJ se cargan (el 3D por software es lento)
    const cast = chooseCast(npcs, this.init.spec.cuerpo).slice(0, window.__WORLD_NPC_LIMIT__ ?? Infinity)
    this.npcsTotal = cast.length
    this.emit()
    const rng = makeRng(77)
    const seats = this.seats
    const pairs = new Map<number, { pair: TalkPair; members: number }>()
    const queue = cast.map((member, index) => ({ member, index }))
    const spawn = this.layout.spawn

    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        if (this.disposed) return
        const { member, index } = job
        try {
          const assembly = await buildAssembly(normalizeSpec(member.npc.spec, catalog), catalog, () => !this.disposed)
          if (!assembly) return
          if (this.disposed) {
            assembly.dispose()
            return
          }
          // sale de un nodo cualquiera que no esté encima del protagonista
          let start = this.layout.nav[Math.floor(rng() * this.layout.nav.length)]
          for (let i = 0; i < 10 && Math.hypot(start.x - spawn.x, start.z - spawn.z) < 8; i++) {
            start = this.layout.nav[Math.floor(rng() * this.layout.nav.length)]
          }
          let pair: TalkPair | undefined
          let pairIndex = 0
          if (member.pair !== undefined) {
            const entry = pairs.get(member.pair) ?? { pair: new TalkPair(this.layout, makeRng(900 + member.pair)), members: 0 }
            pairs.set(member.pair, entry)
            pair = entry.pair
            pairIndex = entry.members++
          }
          const brain = new NpcBrain(this.layout, {
            id: index,
            occupied: this.occupiedSpots,
            seed: 1000 + index * 17,
            primary: member.activity,
            start: { x: start.x, z: start.z },
            seats,
            pair,
            pairIndex,
          })
          const actor = this.addActor(assembly, index * 0.713 + 1, this.exterior)
          this.placeActor(actor, brain.x, brain.z, brain.yaw)
          const npcActor: NpcActor = { ...actor, id: member.npc.id, name: member.npc.nombre, brain, pair, pairIndex, speaking: false }
          this.npcActors.push(npcActor)
          if (pair) {
            const chat = this.chats.get(pair) ?? { dialogue: new PairDialogue(5000 + (member.pair ?? 0) * 31), members: [] }
            chat.members[pairIndex] = npcActor
            this.chats.set(pair, chat)
          }
          this.circles.push({ id: index, x: brain.x, z: brain.z, r: NPC_RADIUS })
          this.emit()
        } catch (error) {
          console.error(`No se pudo cargar a ${member.npc.nombre}.`, error)
          this.npcsTotal = Math.max(0, this.npcsTotal - 1)
          this.emit()
        }
      }
    }
    await Promise.all([worker(), worker()])
  }

  /* ---------- bucle ---------- */

  private start() {
    this.lastTime = performance.now()
    const loop = (now: number) => {
      this.frame = requestAnimationFrame(loop)
      const raw = now - this.lastTime
      const dt = Math.min(0.05, Math.max(0, raw / 1000))
      this.lastTime = now
      // el mando se lee también en pausa, para poder reanudar con su botón
      const actions = this.input?.poll(dt)
      if (actions?.pause) this.init.onPause?.()
      if (this.paused) return
      if (actions) {
        this.move = actions.move
        if (actions.interact) this.interactPending = true
      }
      this.frameStats.record(raw)
      this.frameDt = dt || 1 / 60
      this.update(dt)
      this.render()
      this.measureFps(dt)
    }
    this.frame = requestAnimationFrame(loop)
  }

  private stop() {
    cancelAnimationFrame(this.frame)
    this.frame = 0
  }

  private measureFps(dt: number) {
    this.fpsFrames++
    this.fpsTime += dt
    if (this.fpsTime >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTime)
      this.fpsFrames = 0
      this.fpsTime = 0
      this.emit()
    }
  }

  /** Avanza la simulación `dt` segundos (sin dibujar). */
  update(dt: number) {
    this.time += dt
    this.gameClock = advanceGameClock(this.gameClock, dt)
    const { player } = this
    this.advanceTransition(dt)
    this.storefront?.update(dt, player.x, player.z)
    this.updateInteraction(dt)
    // con la pose forzada (revisión visual), sentado o cruzando una puerta, el protagonista no se mueve por su cuenta
    if (this.playerPoseOverride || this.seating || this.transition) {
      player.speed = 0
      player.vx = player.vz = 0
    } else stepPlayer(player, this.inputOverride ?? this.move, this.follow.yaw, dt, this.activeObstacles, this.inside ? [] : this.circles)
    this.circles[0].x = player.x
    this.circles[0].z = player.z
    this.animSpeed += (player.speed - this.animSpeed) * (1 - Math.exp(-14 * dt))
    const actor = this.playerActor
    if (actor) {
      this.placeActor(actor, player.x, player.z, player.yaw)
      actor.locomotor.update(dt, {
        speed: this.animSpeed < 0.05 ? 0 : this.animSpeed,
        sit: this.seating?.sit ?? this.playerPoseOverride?.sit ?? 0,
        seatHeight: this.seating?.seat.height,
        talk: this.playerPoseOverride?.talk ?? 0,
        time: this.time,
        turn: this.turnRate(actor, player.yaw, dt),
      })
      if (actor.locomotor.strikes > 0 && !this.seating && !this.transition) {
        const running = this.animSpeed > 3
        for (let i = 0; i < actor.locomotor.strikes; i++) {
          this.audio.step(surfaceAt(player.x, player.z, this.inside), running, stepVolume(this.animSpeed))
        }
      }
    }
    this.updateChats(dt)
    this.updateCelestial(this.gameClock)
    this.updateNightLighting(dt)

    for (const [i, npc] of this.npcActors.entries()) {
      npc.brain.update(dt, this.time, this.circles)
      this.circles[i + 1].x = npc.brain.x
      this.circles[i + 1].z = npc.brain.z
      const distance = Math.hypot(npc.brain.x - player.x, npc.brain.z - player.z)
      npc.group.visible = !this.inside && distance < NPC_HIDE_DISTANCE
      this.placeActor(npc, npc.brain.x, npc.brain.z, npc.brain.yaw)
      if (distance < NPC_ANIMATE_DISTANCE) {
        npc.locomotor.update(dt, {
          speed: npc.brain.speed,
          sit: npc.brain.sit,
          seatHeight: npc.brain.seatHeight,
          // en una charla, quien escucha gesticula menos que quien habla
          talk: npc.pair && !npc.speaking ? npc.brain.talk * 0.3 : npc.brain.talk,
          time: this.time,
          turn: this.turnRate(npc, npc.brain.yaw, dt),
        })
        if (npc.locomotor.strikes > 0 && !this.inside) {
          const dx = npc.brain.x - player.x
          const dz = npc.brain.z - player.z
          const volume = attenuation(Math.hypot(dx, dz)) * stepVolume(npc.brain.speed) * 0.8
          for (let i = 0; i < npc.locomotor.strikes; i++) {
            this.audio.step(surfaceAt(npc.brain.x, npc.brain.z, false), npc.brain.speed > 3, volume, panFor(dx, dz, this.follow.yaw))
          }
        }
      }
    }
  }

  /** Pulsa "interactuar" por código (pruebas). */
  interact() {
    this.interactPending = true
  }

  /** Lo que se dicen las parejas que charlan: la más cercana al protagonista se subtitula y se oye como un murmullo. */
  private updateChats(dt: number) {
    const { player } = this
    let nearest: { chat: Chat; distance: number; line: ReturnType<PairDialogue['update']> } | null = null
    for (const chat of this.chats.values()) {
      const [a, b] = chat.members
      const talking = Boolean(a && b && a.brain.doing && b.brain.doing && a.brain.talk > 0.9 && b.brain.talk > 0.9)
      const line = chat.dialogue.update(dt, talking)
      for (const member of chat.members) if (member) member.speaking = Boolean(line && line.speaker === member.pairIndex)
      if (!line || !a || !b) continue
      const distance = Math.hypot((a.brain.x + b.brain.x) / 2 - player.x, (a.brain.z + b.brain.z) / 2 - player.z)
      if (!nearest || distance < nearest.distance) nearest = { chat, distance, line }
    }
    const audible = !this.inside && nearest !== null && nearest.distance < CHAT_RANGE ? nearest : null
    if (audible) {
      const [a, b] = audible.chat.members
      const dx = (a.brain.x + b.brain.x) / 2 - player.x
      const dz = (a.brain.z + b.brain.z) / 2 - player.z
      this.audio.setBabble(attenuation(audible.distance, CHAT_RANGE), panFor(dx, dz, this.follow.yaw))
    } else this.audio.setBabble(0, 0)

    let next: Subtitle | null = null
    if (audible && this.init.subtitles && audible.line) {
      const speaker = audible.chat.members[audible.line.speaker]
      next = { speaker: speaker?.name.split(' ')[0] ?? '', text: audible.line.text }
    }
    if (next?.text !== this.subtitle?.text || next?.speaker !== this.subtitle?.speaker) {
      this.subtitle = next
      this.emit()
    }
  }

  /** Datos del lugar en el que se está: la calle o el interior de un edificio. */
  private get activeObstacles(): readonly Box[] {
    return this.inside && this.interior ? this.interior.obstacles : this.layout.obstacles
  }

  private get activeSeats(): readonly Seat[] {
    return this.inside && this.interior ? this.interior.seats : this.seats
  }

  /** Lo que haría ahora la tecla de interactuar, según dónde está el protagonista. */
  private promptNow(): Prompt | null {
    if (this.transition || this.playerPoseOverride) return null
    if (this.seating) return this.seating.phase === 'sentado' ? 'levantarse' : null
    const { player } = this
    if (this.inside) {
      if (this.interior?.canExit(player.x, player.z)) return 'salir'
    } else if (this.storefront?.canEnter(player.x, player.z)) {
      return 'entrar'
    }
    return findSeat(this.activeSeats, player.x, player.z) ? 'sentarse' : null
  }

  /** Interactuar: sentarse y levantarse en bancos y sillas, entrar y salir de un edificio. */
  private updateInteraction(dt: number) {
    const { player } = this
    const wantsInteract = this.interactPending
    this.interactPending = false
    const move = this.inputOverride ?? this.move
    if (this.seating) {
      const session = this.seating
      const stood = wantsInteract ? session.standUp() : Math.hypot(move.moveX, move.moveZ) > 0.5 && session.pushToStand()
      if (stood) this.audio.event('levantarse')
      session.update(dt)
      player.x = session.x
      player.z = session.z
      player.yaw = session.yaw
      player.vx = player.vz = 0
      if (session.done) {
        this.seating = null
      }
    } else if (wantsInteract) {
      const action = this.promptNow()
      if (action === 'entrar') this.startTransition('entrar')
      else if (action === 'salir') this.startTransition('salir')
      else if (action === 'sentarse') {
        const seat = findSeat(this.activeSeats, player.x, player.z)
        if (seat) {
          const from = { x: player.x, z: player.z }
          const route = this.interior ? makeSeatRoute(seat, this.interior.obstacles, seat.collider, from) : undefined
          this.seating = new SeatSession(seat, player.yaw, from, route)
          this.audio.event('sentarse')
          player.vx = player.vz = 0
        }
      }
    }
    const next = this.promptNow()
    if (next !== this.prompt) {
      this.prompt = next
      this.emit()
    }
  }

  /* ---------- puertas: fundido, carga del interior y cambio de escena ---------- */

  private startTransition(action: Transition['action']) {
    if (this.transition) return
    this.transition = { action, phase: 'out', t: 0 }
    this.audio.event('puerta')
    // el interior se carga mientras se funde a negro
    if (action === 'entrar' && !this.interior && !this.interiorLoading) {
      this.interiorLoading = Interior.load()
        .then((interior) => {
          if (this.disposed) return interior.dispose()
          this.interior = interior
        })
        .catch((error) => {
          console.error('No se pudo cargar el interior.', error)
          this.transition = null
          this.setFade(0)
        })
        .finally(() => {
          this.interiorLoading = null
        })
    }
  }

  private setFade(opacity: number) {
    if (this.fade) this.fade.style.opacity = String(opacity)
  }

  private advanceTransition(dt: number) {
    const transition = this.transition
    if (!transition) return
    // con movimiento reducido no hay fundido: el cambio es inmediato
    const speed = this.init.reducedMotion ? Infinity : dt / FADE_SECONDS
    transition.t = Math.min(1, transition.t + speed)
    if (transition.phase === 'out') {
      this.setFade(transition.t)
      if (transition.t < 1) return
      // espera a que el interior esté cargado (pantalla negra)
      if (transition.action === 'entrar' && !this.interior) return
      if (transition.action === 'entrar') this.performEnter()
      else this.performExit()
      transition.phase = 'in'
      transition.t = 0
    } else {
      this.setFade(1 - transition.t)
      if (transition.t >= 1) this.transition = null
    }
  }

  private updateCelestial(date: Date) {
    this.celestial = celestialState(date)
    this.moonPhase = lunarPhase(date).phase
    if (this.inside) return

    const colors = skyColors(this.celestial.daylight, this.celestial.sunAltitude)
    const sky = this.scene.background
    if (sky instanceof THREE.Color) sky.setHex(colors.sky)
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.setHex(colors.sky)
      this.scene.fog.near = 80
      this.scene.fog.far = 190
    }
    if (this.hemi) {
      this.hemi.color.setHex(colors.sky)
      this.hemi.groundColor.setHex(colors.ground)
      // de noche queda algo de luz de cielo y luna: las siluetas lejanas se leen sin que deje de ser de noche (de día, igual que antes)
      this.hemi.intensity = 0.28 + this.celestial.daylight * 0.62
    }
    this.scene.environmentIntensity = 0.16 + this.celestial.daylight * 0.34
    // aquí solo la intensidad; cuántas luces hay (sol, luna, farolas) lo decide updateLighting
    this.sun.intensity = this.celestial.daylight * 2.6
    this.sun.color.setHex(this.celestial.sunAltitude < 0.12 ? 0xffc18a : 0xfff0d8)
    const moonAboveHorizon = this.celestial.moonDirection.y > -0.04
    // la luna solo se nota de noche: se desvanece del todo antes de quitarla de la escena, para que no se note el cambio
    this.moon.intensity = moonAboveHorizon ? Math.max(0, 1 - this.celestial.daylight * 2) * 0.52 : 0
    this.applyLighting()
    if (this.sunModel) this.sunModel.root.visible = this.celestial.sunAltitude > -0.08
    for (const [phase, prop] of this.moonModels) prop.root.visible = moonAboveHorizon && phase === this.moonPhase
  }

  /** Pone en la escena las luces del estado aplicado (o del que se está preparando). */
  private applyLighting(state = this.lighting) {
    if (this.inside) return
    this.sun.visible = state.sun
    this.moon.visible = state.moon
    for (const light of this.lampLights) light.visible = state.lamps
  }

  /**
   * Cambiar cuántas luces hay (sale la luna, se pone el sol, se encienden las farolas) obliga a recompilar todos los
   * materiales: más de un segundo de parón en el primer fotograma. Jugando, el nuevo estado se compila antes en segundo
   * plano y se aplica cuando está listo; sin tiempo de por medio (reloj fijado, cambio de calidad) se aplica ya.
   */
  private updateLighting(immediate: boolean) {
    if (this.inside) return
    const want: LightingState = {
      sun: this.celestial.sunAltitude > -0.08,
      moon: this.celestial.moonDirection.y > -0.04 && this.celestial.daylight < 0.5,
      lamps: this.celestial.night,
    }
    if (want.sun === this.lighting.sun && want.moon === this.lighting.moon && want.lamps === this.lighting.lamps) return
    const renderer = this.renderer
    if (immediate || !renderer) {
      this.lighting = want
      this.applyLighting()
      return
    }
    if (this.lightingPreparing) return
    this.lightingPreparing = true
    this.applyLighting(want)
    // compile() deja compilando (en paralelo, si el navegador lo permite) los materiales con las luces del nuevo estado
    const pending = renderer.compile(this.scene, this.camera)
    this.applyLighting()
    // No se usa compileAsync: falla sin remedio si un material se libera mientras espera (al salir del barrio o del café)
    let tries = 0
    const check = () => {
      if (this.disposed) return
      for (const material of pending) {
        const program = (renderer.properties.get(material) as { currentProgram?: { isReady(): boolean } }).currentProgram
        if (!program || program.isReady()) pending.delete(material)
      }
      // con un tope: si algo no llega a estar listo, se cambia igual (como mucho, un tirón como el de antes)
      if (pending.size > 0 && ++tries < 120) {
        window.setTimeout(check, 25)
        return
      }
      this.lightingPreparing = false
      this.lighting = want
      this.applyLighting()
    }
    window.setTimeout(check, 25)
  }

  private updateNightLighting(dt: number) {
    this.water?.update(this.time)
    const night = this.celestial.night
    for (const material of this.lampMaterials) material.emissiveIntensity = night ? 1.6 : 0
    // la luz pintada no cambia cuántas luces hay: se enciende al momento
    if (this.lightPools) this.lightPools.visible = night && this.showLightPools
    if (this.facadeGlow) this.facadeGlow.visible = night && this.showLightPools
    this.updateLighting(dt === 0)
    if (!this.lighting.lamps) {
      this.lampAssigner.update(0, [], true)
      this.lampRefresh = 0
      return
    }

    this.lampRefresh -= dt
    if (this.lampRefresh <= 0) {
      this.lampRefresh = 0.45
      this.wantedLamps = nearestLamps(this.layout.lamps, this.player.x, this.player.z, this.lampLights.length)
    }
    // sin tiempo de por medio (al fijar el reloj o cambiar la calidad) se colocan de golpe; andando, con un fundido
    this.lampAssigner.update(dt, this.wantedLamps, dt === 0)
    // de noche todas las luces siguen en la escena aunque no tengan farola (a intensidad 0): cambiar cuántas hay recompila
    this.lampAssigner.slots.forEach((slot, index) => {
      const light = this.lampLights[index]
      light.intensity = LAMP_LIGHT.intensity * slot.level
      if (slot.lamp === null) return
      const head = lampHead(this.layout.lamps[slot.lamp], slot.lamp)
      light.position.set(head.x, LAMP_HEIGHT, head.z)
    })
  }

  /** Fuerza una fecha local fija para capturas y pruebas; null vuelve al reloj del ordenador. */
  setClockOverride(isoDate: string | null) {
    if (isoDate === null) {
      this.gameClock = new Date()
    } else {
      const timestamp = Date.parse(isoDate)
      if (!Number.isFinite(timestamp)) throw new RangeError(`Fecha de reloj no válida: ${isoDate}`)
      this.gameClock = new Date(timestamp)
    }
    this.updateCelestial(this.gameClock)
    this.updateNightLighting(0)
    this.emit()
  }

  /** Cambia la escena al interior: se oculta la calle, se enciende la sala y el protagonista aparece dentro. */
  private performEnter() {
    const interior = this.interior
    if (!interior) return
    this.inside = true
    this.exterior.visible = false
    this.scene.add(interior.group)
    this.sun.visible = false
    this.moon.visible = false
    if (this.hemi) this.hemi.intensity = 0.55
    this.scene.environmentIntensity = 0.3
    this.scene.background = new THREE.Color(INTERIOR_BACKGROUND)
    this.scene.fog = null
    const { player } = this
    player.x = interior.entry.x
    player.z = interior.entry.z
    player.yaw = interior.entry.yaw
    player.vx = player.vz = 0
    this.follow.yaw = interior.entry.yaw + Math.PI
    this.follow.maxDistance = 3.8
    this.audio.setEnvironment('interior')
    this.audio.setBabble(0, 0)
    this.cameraSnap = true
  }

  /** Vuelve a la calle: el interior se libera y el protagonista sale por la puerta, de cara a la calle. */
  private performExit() {
    const storefront = this.storefront
    this.inside = false
    this.exterior.visible = true
    this.scene.background = new THREE.Color(SKY)
    this.scene.fog = new THREE.Fog(SKY, 80, 190)
    this.updateCelestial(this.gameClock)
    this.interior?.dispose()
    this.interior = null
    const { player } = this
    const yaw = storefront?.outwardYaw ?? 0
    const door = storefront?.door ?? this.layout.storefront
    player.x = door.x + Math.sin(yaw) * 1.4
    player.z = door.z + Math.cos(yaw) * 1.4
    player.yaw = yaw
    player.vx = player.vz = 0
    this.follow.yaw = yaw + Math.PI
    this.follow.maxDistance = Infinity
    this.audio.setEnvironment('calle')
    this.cameraSnap = true
  }

  /** Avanza la simulación `seconds` segundos de golpe, para las pruebas. */
  advance(seconds: number) {
    const step = 1 / 20
    for (let t = 0; t < seconds; t += step) this.update(step)
  }

  private render() {
    const { renderer } = this
    if (!renderer) return
    const focus = this.focusOverride ?? this.player
    const ground = new THREE.Vector3(focus.x, GROUND, focus.z)
    const blockers = this.inside && this.interior ? this.interior.blockers : this.layout.blockers
    this.follow.update(this.camera, ground, this.cameraClip ? blockers : [], this.frameDt, this.cameraSnap || this.init.reducedMotion)
    this.cameraSnap = false

    // La luz sigue al jugador, con la posición redondeada a texeles para estabilizar las sombras.
    const texel = 68 / this.sun.shadow.mapSize.x
    const sx = Math.round(this.player.x / texel) * texel
    const sz = Math.round(this.player.z / texel) * texel
    this.sun.target.position.set(sx, 0, sz)
    this.sun.position.set(sx + this.celestial.sunDirection.x * 80, this.celestial.sunDirection.y * 80, sz + this.celestial.sunDirection.z * 80)
    this.moon.target.position.set(sx, 0, sz)
    this.moon.position.set(sx + this.celestial.moonDirection.x * 80, this.celestial.moonDirection.y * 80, sz + this.celestial.moonDirection.z * 80)
    const sunPosition = celestialPosition(this.celestial.sunDirection, { x: sx, z: sz }, 120)
    const moonPosition = celestialPosition(this.celestial.moonDirection, { x: sx, z: sz }, 120)
    if (this.sunModel) {
      this.sunModel.root.position.set(sunPosition.x, sunPosition.y, sunPosition.z)
      this.sunModel.root.lookAt(this.camera.position)
    }
    for (const prop of this.moonModels.values()) {
      prop.root.position.set(moonPosition.x, moonPosition.y, moonPosition.z)
      prop.root.lookAt(this.camera.position)
    }
    this.sun.target.updateMatrixWorld()
    this.moon.target.updateMatrixWorld()
    renderer.render(this.scene, this.camera)
  }

  /* ---------- estado y utilidades ---------- */

  setPaused(paused: boolean) {
    this.paused = paused
    if (paused) this.audio.suspend()
    else this.audio.resume()
    if (paused) {
      this.input?.releaseAll()
      this.move = { moveX: 0, moveZ: 0, run: false }
      this.player.vx = 0
      this.player.vz = 0
    } else {
      this.lastTime = performance.now()
    }
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    listener(this.status())
    return () => void this.listeners.delete(listener)
  }

  private status(): WorldStatus {
    return {
      state: this.state,
      npcsLoaded: this.npcActors.length,
      npcsTotal: this.npcsTotal,
      fps: this.fps,
      device: this.input?.device ?? 'teclado',
      gamepad: this.input?.gamepad ?? null,
      prompt: this.prompt,
      subtitle: this.subtitle,
      audio: this.audio.state,
      gameTime: formatGameClock(this.gameClock),
      diagnostics: this.diagnosticsText(),
    }
  }

  private emit() {
    const status = this.status()
    for (const listener of this.listeners) listener(status)
  }

  private setState(state: WorldState) {
    this.state = state
    this.emit()
  }

  /** Texto de diagnóstico con lo medido desde que empezó (o desde `resetDiagnostics`). */
  diagnosticsText(): string {
    const renderer = this.renderer
    if (!renderer) return 'Sin vista 3D.'
    if (this.gpuName === null) {
      const gl = renderer.getContext()
      const extension = gl.getExtension('WEBGL_debug_renderer_info')
      this.gpuName = extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : 'desconocida'
    }
    const pad = this.input?.gamepad
    return formatDiagnostics({
      summary: this.frameStats.summary(),
      quality: this.quality,
      width: renderer.domElement.width,
      height: renderer.domElement.height,
      pixelRatio: renderer.getPixelRatio(),
      device: this.input?.device === 'mando' && pad ? `mando ${pad.name}` : 'teclado y ratón',
      gpu: this.gpuName,
      triangles: renderer.info.render.triangles,
      calls: renderer.info.render.calls,
      npcs: this.npcActors.length,
    })
  }

  resetDiagnostics() {
    this.frameStats.reset()
  }

  /** Lo medido desde el último reinicio, como datos (para la herramienta de rendimiento). */
  performance() {
    const renderer = this.renderer
    return {
      ...this.frameStats.summary(),
      quality: this.quality,
      width: renderer?.domElement.width ?? 0,
      height: renderer?.domElement.height ?? 0,
      pixelRatio: renderer?.getPixelRatio() ?? 0,
      triangles: renderer?.info.render.triangles ?? 0,
      calls: renderer?.info.render.calls ?? 0,
      npcs: this.npcActors.length,
      gpu: this.gpuName,
    }
  }

  /** Datos para las pruebas. */
  stats() {
    const info = this.renderer?.info
    const animation = this.player.speed < 0.15 ? 'quieto' : this.player.speed < 3 ? 'anda' : 'corre'
    const activities: Record<string, number> = {}
    for (const npc of this.npcActors) activities[npc.brain.activity] = (activities[npc.brain.activity] ?? 0) + 1
    return {
      state: this.state,
      time: this.time,
      gameTime: formatGameClock(this.gameClock),
      clock: {
        hour: this.celestial.hour,
        night: this.celestial.night,
        daylight: this.celestial.daylight,
        sunAltitude: (this.celestial.sunAltitude * 180) / Math.PI,
        sunAzimuth: (this.celestial.sunAzimuth * 180) / Math.PI,
        moonPhase: this.moonPhase,
        moonIllumination: lunarPhase(this.gameClock).illumination,
      },
      streetLights: {
        active: this.lampLights.filter((light) => light.visible).length,
        /** farolas que tienen ahora una luz real */
        lamps: this.lampAssigner.slots.flatMap((slot) => (slot.lamp === null ? [] : [slot.lamp])),
        intensity: this.lampLights[0]?.intensity ?? 0,
        range: this.lampLights[0]?.distance ?? 0,
        decay: this.lampLights[0]?.decay ?? 0,
        pools: this.lightPools?.count ?? 0,
        poolsVisible: this.lightPools?.visible ?? false,
        facadeGlows: this.facadeGlow?.count ?? 0,
      },
      waterAnimated: this.water !== null,
      quality: this.quality,
      fps: this.fps,
      device: this.input?.device ?? 'teclado',
      gamepad: this.input?.gamepad ?? null,
      player: { x: this.player.x, z: this.player.z, yaw: this.player.yaw, speed: this.player.speed, animation, seated: this.seating?.phase === 'sentado', dims: this.playerActor?.locomotor.dims ?? null },
      prompt: this.prompt,
      subtitle: this.subtitle,
      audio: {
        state: this.audio.state,
        environment: this.audio.environment,
        ...this.audio.counters,
      },
      chats: [...this.chats.values()].map((chat) => ({
        members: chat.members.map((m) => m?.name ?? null),
        talking: chat.members.length === 2 && chat.members.every((m) => m.speaking || m.brain.talk > 0.9),
        conversations: chat.dialogue.started,
      })),
      mode: this.inside ? 'interior' : 'calle',
      scenery: {
        benches: this.benchGroup !== null,
        storefront: this.storefront !== null,
        fountain: this.sceneryLoaded.has('fuente'),
        trees: this.sceneryLoaded.has('arbol'),
        lamps: this.sceneryLoaded.has('farola'),
        sun: this.sceneryLoaded.has('sol'),
        moon: this.sceneryLoaded.has('luna'),
      },
      transitioning: this.transition !== null,
      door: this.storefront ? { openness: this.storefront.openness, x: this.storefront.door.x, z: this.storefront.door.z } : null,
      cameraYaw: this.follow.yaw,
      npcs: {
        total: this.npcsTotal,
        loaded: this.npcActors.length,
        sitting: this.npcActors.filter((npc) => npc.brain.sit > 0.9).length,
        activities,
        list: this.npcActors.map((npc) => ({
          id: npc.id,
          name: npc.name,
          activity: npc.brain.activity,
          label: ACTIVITY_LABELS[npc.brain.activity as Activity],
          x: npc.brain.x,
          z: npc.brain.z,
          speed: npc.brain.speed,
          sit: npc.brain.sit,
          completed: npc.brain.completed,
          doing: npc.brain.doing,
        })),
      },
      geometries: info?.memory.geometries ?? 0,
      textures: info?.memory.textures ?? 0,
      calls: info?.render.calls ?? 0,
      triangles: info?.render.triangles ?? 0,
    }
  }

  /** Posición en el mundo de algunos huesos del protagonista (revisión visual). */
  playerBones(names: string[]): Record<string, number[]> {
    const result: Record<string, number[]> = {}
    const position = new THREE.Vector3()
    for (const name of names) {
      const bone = this.playerActor?.assembly.bone(name)
      if (bone) result[name] = bone.getWorldPosition(position).toArray().map((value) => Math.round(value * 1000) / 1000)
    }
    return result
  }

  /** Dibuja un fotograma ahora mismo (con el bucle en pausa, para las capturas). */
  renderNow() {
    this.render()
  }

  /** Coloca la cámara (pruebas y capturas). */
  orbitCamera(yaw: number, pitch: number, distance: number) {
    this.follow.yaw = yaw
    this.follow.pitch = pitch
    this.follow.distance = distance
    this.cameraSnap = true
  }

  /** Coloca al jugador (pruebas). */
  teleport(x: number, z: number, yaw = this.player.yaw) {
    this.player.x = x
    this.player.z = z
    this.player.yaw = yaw
    this.player.vx = this.player.vz = 0
    this.cameraSnap = true
  }

  /** Suelta todo lo que ocupa memoria y el contexto de la tarjeta gráfica. */
  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.stop()
    this.input?.dispose()
    for (const type of ['keydown', 'pointerdown'] as const) window.removeEventListener(type, this.unlockAudio, true)
    this.audio.dispose()
    this.seating?.release()
    this.storefront?.dispose()
    this.interior?.dispose()
    if (this.benchProp) disposeProp(this.benchProp)
    for (const prop of this.sceneryProps) disposeProp(prop)
    this.sceneryProps.length = 0
    this.sceneryLoaded.clear()
    this.benchGroup?.removeFromParent()
    this.fade?.remove()
    this.observer?.disconnect()
    this.listeners.clear()
    for (const actor of [this.playerActor, ...this.npcActors]) {
      if (!actor) continue
      this.scene.remove(actor.group)
      actor.assembly.dispose()
    }
    this.npcActors.length = 0
    this.playerActor = null
    this.city?.dispose()
    if (this.lightPools) disposeLightPools(this.lightPools)
    this.lightPools = null
    if (this.facadeGlow) disposeLightPools(this.facadeGlow)
    this.facadeGlow = null
    this.environment?.dispose()
    this.sun.shadow.map?.dispose()
    this.renderer?.dispose()
    this.renderer?.forceContextLoss()
    this.canvas.remove()
    this.renderer = null
  }
}

declare global {
  interface Window {
    __world?: () => World | null
    __WORLD_NPC_LIMIT__?: number
  }
}
