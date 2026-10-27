import * as THREE from 'three'
import type { Seat } from './brain'
import { BuildingInterior, collectPush, type BuildingSound, type DoorPush, type PropLibrary } from './buildingInterior'
import { isShopOpen } from './schedule'
import { lightShopBackdrop, shopBackdropMaterial, type ShopBackdropKind } from './shopBackdrops'
import { FURNITURE, GROUND_FLOOR_Y, PORTAL_OPENING, SHOP_OPENING, inBox, planBuilding, type PlanLight } from './buildingPlan'
import type { Box } from './collision'
import { DoorOpener, InstancedProp, type DoorFrame, type Walker } from './doors'
import { createInteriorMaterials } from './interiorMaterials'
import type { Blocker, Building, CityLayout, ShopKind, Spot } from './layout'
import { disposeProp, instanceProp, loadProp, placementMatrix, type Prop } from './props'

/** Modelos de Blender de los edificios (tools/blender/crear_interiores.py), además de los muebles de FURNITURE. */
const FIXTURES = [
  'puerta_interior', 'puerta_piso', 'ventana', 'escalera', 'ascensor', 'ascensor_puerta', 'portal', 'fachada_local',
  'rotulo_tienda', 'rotulo_farmacia', 'rotulo_panaderia', 'rotulo_peluqueria',
] as const
const SIGNED: Exclude<ShopKind, 'cafe'>[] = ['tienda', 'farmacia', 'panaderia', 'peluqueria']
/** Los modelos que se dibujan instanciados por dentro (sus hojas se abren solas): su variante del shader es otra. */
const INSTANCED_INSIDE = ['puerta_interior', 'puerta_piso', 'ascensor_puerta'] as const
/** Un edificio se monta por dentro al acercarse a menos de esto de una de sus puertas, y se suelta al alejarse más de lo otro. */
const ACTIVATE_DISTANCE = 20
const RELEASE_DISTANCE = 26
/**
 * Entre dos edificios vecinos, se cambia al otro solo si su puerta está esto más cerca que la del montado: sin margen, al
 * andar entre las dos puertas se montaba y se soltaba uno y otro una y otra vez.
 */
const SWITCH_MARGIN = 3
/** A cuántos metros (de frente y andando despacio) se empieza a empujar una puerta de la calle; corriendo, antes. */
const STREET_DOOR_REACH = 0.6
const NOBODY: readonly Walker[] = []
/** Un hueco en la lista de quien empuja: el protagonista cuando no cuenta (está en otra planta). */
const FAR: Walker = { x: 1e6, z: 1e6, vx: 0, vz: 0 }

/** La caja que tapa el hueco de una puerta cerrada con llave (las puertas van alineadas con los ejes). */
function doorBox(frame: DoorFrame): Box {
  const alongX = Math.abs(frame.nz) > Math.abs(frame.nx)
  const half = frame.halfWidth + 0.05
  return alongX
    ? { minX: frame.x - half, maxX: frame.x + half, minZ: frame.z - 0.08, maxZ: frame.z + 0.08 }
    : { minX: frame.x - 0.08, maxX: frame.x + 0.08, minZ: frame.z - half, maxZ: frame.z + half }
}

/** Una puerta de la calle: el portal o la del local de un edificio. */
interface StreetDoor {
  building: number
  prop: InstancedProp
  slot: number
  frame: DoorFrame
  opener: DoorOpener
  /** su fondo oscuro (ver DoorBackings) */
  backing: number
}

interface Active {
  building: Building
  interior: BuildingInterior
  /** colisiones y bloqueos de cámara de la ciudad sin la caja de este edificio */
  cityObstacles: Box[]
  cityBlockers: Blocker[]
}

/**
 * Los edificios en los que se puede entrar. Por fuera, en todos: el portal y el escaparate del local (con su rótulo) en
 * los huecos de la fachada, con un fondo oscuro detrás. Por dentro, solo en el más cercano: se monta su interior y,
 * mientras tanto, el barrio usa sus colisiones, su altura (escalera, ascensor) y sus plazas.
 */
export class BuildingManager {
  /** puertas y rótulos de las fachadas: van con la calle */
  readonly exterior = new THREE.Group()
  /** el interior del edificio activo: va aparte (la calle se sigue viendo desde dentro) */
  readonly interiors = new THREE.Group()
  /**
   * Una copia oculta de cada modelo y material de dentro. No se dibuja nunca, pero compilar la escena (al cargar y cada
   * vez que cambian las luces, ver updateLighting en world.ts) también compila sus materiales: así, al montar un edificio
   * o subir a una planta con muebles nuevos no hay que compilar nada en el momento (eran parones de segundos).
   */
  readonly warmup = new THREE.Group()
  ready = false
  private readonly layout: CityLayout
  private readonly props = new Map<string, Prop>()
  private readonly materials = createInteriorMaterials()
  private portals: InstancedProp | null = null
  private shops: InstancedProp | null = null
  private readonly warmupProps: InstancedProp[] = []
  private readonly warmupPlane = new THREE.PlaneGeometry(1, 1)
  /** índice de la copia del escaparate de cada edificio (−1 si no tiene: el del café) */
  private readonly shopSlot: number[] = []
  private backing: DoorBackings | null = null
  private readonly streetDoors: StreetDoor[] = []
  /** la puerta que empuja ahora cada uno (0 el protagonista, 1… los vecinos de `update`), para el brazo */
  readonly pushes: (DoorPush | undefined)[] = []
  /** la hora del día (0-24): los locales cerrados no abren desde la calle */
  hour = 12
  /** la hoja cerrada con llave del local del edificio montado, que no se puede atravesar desde fuera */
  private lockBox: Box | null = null
  private active: Active | null = null
  /** el último interior soltado, guardado (oculto) por si se vuelve a él enseguida */
  private parked: { building: Building; interior: BuildingInterior } | null = null
  private view = { level: -1, inside: false }
  private combinedObstacles: { source: readonly Box[]; lock: Box | null; list: Box[] } | null = null
  private combinedBlockers: { source: readonly Blocker[]; list: Blocker[] } | null = null
  private disposed = false

  constructor(layout: CityLayout) {
    this.layout = layout
  }

  /** Carga los modelos (los que fallen se quedan sin dibujar) y pone las puertas en las fachadas. */
  async load(isAlive: () => boolean = () => true) {
    const names = [...Object.keys(FURNITURE), ...FIXTURES]
    const results = await Promise.allSettled(names.map(async (name) => ({ name, prop: await loadProp(name) })))
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('No se pudo cargar un modelo de los edificios.', result.reason)
        continue
      }
      if (!isAlive() || this.disposed) {
        disposeProp(result.value.prop)
        continue
      }
      this.props.set(result.value.name, result.value.prop)
    }
    if (!isAlive() || this.disposed) return
    this.dressMaterials()
    this.buildFacades()
    this.buildWarmup()
    this.ready = true
  }

  private buildWarmup() {
    const { warmup } = this
    warmup.visible = false
    // no se dibuja ni se mueve: que tampoco se recalculen sus matrices en cada fotograma
    warmup.matrixAutoUpdate = false
    warmup.matrixWorldAutoUpdate = false
    for (const prop of this.props.values()) warmup.add(prop.root.clone())
    const origin = [new THREE.Matrix4()]
    for (const name of INSTANCED_INSIDE) {
      const prop = this.props.get(name)
      if (!prop) continue
      const instanced = new InstancedProp(prop, origin, false)
      this.warmupProps.push(instanced)
      warmup.add(instanced.group)
    }
    for (const material of Object.values(this.materials)) {
      if (material instanceof THREE.Material) warmup.add(new THREE.Mesh(this.warmupPlane, material))
    }
    this.interiors.add(warmup)
  }

  /** Las bombillas y pantallas de los modelos brillan (el resto, tal cual llegan de Blender). */
  private dressMaterials() {
    for (const prop of this.props.values()) {
      prop.root.traverse((object) => {
        const mesh = object as THREE.Mesh
        if (!mesh.isMesh) return
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (!(material instanceof THREE.MeshStandardMaterial)) continue
          if (material.name === 'Bombilla') {
            material.emissive.set(0xffe0b0)
            material.emissiveIntensity = 1.3
          } else if (material.name.startsWith('Rotulo')) {
            material.emissive.copy(material.color)
            material.emissiveIntensity = 0.35
          }
        }
      })
    }
  }

  /**
   * Portales, escaparates y rótulos de todos los edificios. Están metidos en el hueco de la fachada y no dan una sombra
   * que se note: no se dibujan otra vez en el mapa de sombras (eran ~60 llamadas de dibujo más en cada actualización).
   */
  private buildFacades() {
    const buildings = this.layout.buildings
    const portal = this.props.get('portal')
    if (portal) {
      this.portals = new InstancedProp(portal, buildings.map((b) => placementMatrix(b.portal.x, 0, b.portal.z, b.portal.yaw)), false)
      this.exterior.add(this.portals.group)
    }
    const withShop = buildings.filter((b) => b.shop.kind !== 'cafe')
    for (const b of buildings) this.shopSlot.push(withShop.indexOf(b))
    const front = this.props.get('fachada_local')
    if (front) {
      this.shops = new InstancedProp(front, withShop.map((b) => placementMatrix(b.shop.door.x, 0, b.shop.door.z, b.shop.door.yaw)), false)
      this.exterior.add(this.shops.group)
    }
    for (const kind of SIGNED) {
      const sign = this.props.get(`rotulo_${kind}`)
      const spots = withShop.filter((b) => b.shop.kind === kind).map((b) => b.shop.door)
      if (!sign || !spots.length) continue
      const signs = instanceProp(sign, spots.map((s) => placementMatrix(s.x, 0, s.z, s.yaw)))
      signs.traverse((object) => (object.castShadow = false))
      this.exterior.add(signs)
    }
    // detrás de cada hueco, un fondo (oscuro en el portal, pintado en el local): mientras el edificio no está montado
    // por dentro, no se ve a través
    const openings: { spot: Spot; width: number; height: number; kind?: ShopBackdropKind }[] = []
    for (const b of buildings) {
      openings.push({ spot: b.portal, ...PORTAL_OPENING })
      openings.push(b.shop.kind === 'cafe' ? { spot: b.portal, width: 0, height: 0 } : { spot: b.shop.door, ...SHOP_OPENING, kind: b.shop.kind })
    }
    this.backing = new DoorBackings(openings)
    this.exterior.add(this.backing.group)
    for (const b of buildings) {
      const doors = [
        { prop: this.portals, slot: b.index, backing: b.index * 2 },
        { prop: this.shops, slot: this.shopSlot[b.index], backing: b.index * 2 + 1 },
      ]
      for (const { prop, slot, backing } of doors) {
        const frame = prop && slot >= 0 ? prop.doorFrame(slot) : null
        if (prop && frame) this.streetDoors.push({ building: b.index, prop, slot, frame, opener: new DoorOpener(), backing })
      }
    }
  }

  /** El edificio que debería estar montado: en el que se está, o el de la puerta más cercana. */
  private pick(x: number, z: number): Building | null {
    let best: Building | null = null
    let bestDistance = ACTIVATE_DISTANCE
    for (const building of this.layout.buildings) {
      if (inBox(building.box, x, z)) return building
      const distance = this.doorDistance(building, x, z)
      if (distance < bestDistance) {
        best = building
        bestDistance = distance
      }
    }
    return best
  }

  private doorDistance(building: Building, x: number, z: number) {
    const portal = Math.hypot(x - building.portal.x, z - building.portal.z)
    if (building.shop.kind === 'cafe') return portal
    return Math.min(portal, Math.hypot(x - building.shop.door.x, z - building.shop.door.z))
  }

  /** ¿Se queda montado el edificio activo aunque `next` sea el más cercano? (ver SWITCH_MARGIN) */
  private keeps(next: Building, x: number, z: number) {
    const active = this.active
    if (!active || inBox(next.box, x, z)) return false
    return this.doorDistance(active.building, x, z) < this.doorDistance(next, x, z) + SWITCH_MARGIN
  }

  private activate(building: Building) {
    // el guardado se recoge antes de soltar el activo (que pasa a ser el guardado)
    const parked = this.parked?.building === building ? this.parked.interior : null
    if (parked) this.parked = null
    this.deactivate()
    let interior: BuildingInterior
    if (parked) {
      interior = parked
      interior.group.visible = true
    } else {
      interior = new BuildingInterior(planBuilding(building), this.props as PropLibrary, this.materials)
      this.interiors.add(interior.group)
    }
    this.active = {
      building,
      interior,
      cityObstacles: this.layout.obstacles.filter((box) => box !== building.box),
      cityBlockers: this.layout.blockers.filter((blocker) => blocker.box !== building.box),
    }
    this.view = { level: -1, inside: false }
    this.combinedObstacles = null
    this.combinedBlockers = null
    this.backing?.show(building.index * 2, false)
    this.backing?.show(building.index * 2 + 1, false)
  }

  private deactivate() {
    const active = this.active
    if (!active) return
    // sus puertas de la calle terminan de cerrarse solas (ver update); el fondo oscuro vuelve con cada una ya cerrada
    for (const door of this.streetDoors) if (door.building === active.building.index && door.opener.idle) this.backing?.show(door.backing, true)
    // se guarda oculto (y se suelta el que estuviera guardado): volver a él enseguida no cuesta nada
    this.parked?.interior.dispose()
    active.interior.group.visible = false
    this.parked = { building: active.building, interior: active.interior }
    this.active = null
  }

  /** ¿Está (x, z) dentro del edificio montado? */
  inside(x: number, z: number): boolean {
    return this.active !== null && inBox(this.active.building.box, x, z)
  }

  /** Avanza: elige el edificio montado, mueve las puertas que empuja quien anda (`walker`, a la altura `y`) y el ascensor. */
  update(dt: number, walker: Walker, y: number, sound: (s: BuildingSound) => void, others: readonly Walker[] = NOBODY) {
    this.pushes.length = 0
    this.lockBox = null
    if (!this.ready) return
    this.backing?.light(this.hour)
    const { x, z } = walker
    const inside = this.inside(x, z)
    if (!inside) {
      const next = this.pick(x, z)
      if (next && next !== this.active?.building && !this.keeps(next, x, z)) this.activate(next)
      else if (!next && this.active && this.doorDistance(this.active.building, x, z) > RELEASE_DISTANCE) this.deactivate()
    }
    const active = this.active
    if (active) {
      const level = active.interior.levelAt(y)
      if (level !== this.view.level || inside !== this.view.inside) {
        this.view = { level, inside }
        active.interior.setView(level, inside)
      }
      active.interior.update(dt, walker, y, sound)
    }
    // las puertas de la calle: el protagonista empuja las del edificio montado si va a pie de calle (por fuera o por
    // dentro), y los vecinos las de cualquiera; las demás terminan de cerrarse y luego se quedan quietas. El índice de
    // cada uno en la lista es el de `pushes` (0 el protagonista, 1… los vecinos)
    const street = y < GROUND_FLOOR_Y + 1
    const withPlayer = [street ? walker : FAR, ...others]
    const withoutPlayer = [FAR, ...others]
    if (active) this.interiorPush(active.interior.push)
    for (const door of this.streetDoors) {
      const mine = door.building === active?.building.index
      const near = others.some((other) => Math.abs(other.x - door.frame.x) < 3 && Math.abs(other.z - door.frame.z) < 3)
      if (!mine && !near && door.opener.idle) continue
      // un local cerrado no se abre desde la calle (sí desde dentro, para no quedarse encerrado)
      const locked = door.backing % 2 === 1 && !isShopOpen(this.layout.buildings[door.building].shop.kind, this.hour)
      const started = door.opener.update(dt, door.frame, mine ? withPlayer : withoutPlayer, STREET_DOOR_REACH, locked)
      // los vecinos solo se oyen cerca
      if (started && (door.opener.pusher === 0 || Math.hypot(walker.x - door.frame.x, walker.z - door.frame.z) < 12)) sound('puerta')
      door.prop.setOpen(door.slot, door.opener.open, door.opener.side)
      collectPush(this.pushes, door.opener, door.prop, door.slot)
      if (!mine && door.opener.idle) this.backing?.show(door.backing, true)
      if (mine && locked && door.opener.open === 0 && !inside) this.lockBox = doorBox(door.frame)
    }
  }

  /** La puerta que empuja ahora el protagonista (para el brazo), o null. */
  get push(): DoorPush | null {
    return this.pushes[0] ?? null
  }

  /** El edificio montado (−1 ninguno). */
  get activeIndex(): number {
    return this.active?.building.index ?? -1
  }

  private interiorPush(push: DoorPush | null) {
    if (push) this.pushes[0] = push
  }

  /** Colisiones para quien está en (x, z) a la altura `y`. */
  obstacles(city: readonly Box[], y: number): readonly Box[] {
    const active = this.active
    if (!active) return city
    const source = active.interior.obstaclesFor(y)
    const lock = this.lockBox
    if (this.combinedObstacles?.source !== source || this.combinedObstacles.lock !== lock) {
      this.combinedObstacles = { source, lock, list: [...active.cityObstacles, ...source, ...(lock ? [lock] : [])] }
    }
    return this.combinedObstacles.list
  }

  /** Lo que tapa a la cámara: dentro del edificio, sus muros; fuera, la ciudad. */
  blockers(city: readonly Blocker[], x: number, z: number, y: number): readonly Blocker[] {
    const active = this.active
    if (!active || !this.inside(x, z)) return city
    const source = active.interior.blockersFor(y)
    if (this.combinedBlockers?.source !== source) this.combinedBlockers = { source, list: [...active.cityBlockers, ...source] }
    return this.combinedBlockers.list
  }

  /** Altura del suelo dentro del edificio montado, o null fuera de él. */
  height(x: number, z: number, y: number): number | null {
    return this.active && this.inside(x, z) ? this.active.interior.heightAt(x, z, y) : null
  }

  seats(x: number, z: number, y: number): readonly Seat[] | null {
    return this.active && this.inside(x, z) ? this.active.interior.seatsFor(y) : null
  }

  surface(x: number, z: number, y: number) {
    return this.active && this.inside(x, z) ? this.active.interior.surfaceAt(x, z, y) : null
  }

  /** Puntos de luz de la planta en la que se está (o de la baja, mirando desde la puerta). */
  lights(y: number): readonly PlanLight[] {
    return this.active ? this.active.interior.lightsFor(y) : []
  }

  /** Distancia a la puerta más cercana del edificio montado (0 dentro; Infinity si no hay ninguno). */
  distanceToDoor(x: number, z: number): number {
    if (!this.active) return Infinity
    return this.inside(x, z) ? 0 : this.doorDistance(this.active.building, x, z)
  }

  get elevator() {
    return this.active?.interior.elevator ?? null
  }

  get floors() {
    return this.active?.building.floors ?? 0
  }

  /** Datos para las pruebas y el diagnóstico. */
  stats() {
    return {
      ready: this.ready,
      models: this.props.size,
      active: this.active ? { index: this.active.building.index, floors: this.active.building.floors, shop: this.active.building.shop.kind } : null,
      level: this.view.level,
      inside: this.view.inside,
      /** las puertas de la calle que se están moviendo o abiertas: de qué edificio, cuánto, hacia dónde y el brazo */
      doors: this.streetDoors
        .filter((door) => !door.opener.idle)
        .map((door) => ({ building: door.building, x: door.frame.x, z: door.frame.z, open: door.opener.open, side: door.opener.side, push: door.opener.push })),
      push: this.push,
      elevator: this.active?.interior.elevator?.stats() ?? null,
    }
  }

  /** Las puertas de la calle de un edificio (portal y local): dónde está el centro del hueco y hacia dónde mira. */
  doorsOf(building: number): DoorFrame[] {
    return this.streetDoors.filter((door) => door.building === building).map((door) => door.frame)
  }

  dispose() {
    this.disposed = true
    this.deactivate()
    this.parked?.interior.dispose()
    this.parked = null
    for (const prop of this.warmupProps) prop.dispose()
    this.warmupPlane.dispose()
    this.warmup.clear()
    this.portals?.dispose()
    this.shops?.dispose()
    this.backing?.dispose()
    for (const prop of this.props.values()) disposeProp(prop)
    this.props.clear()
    this.materials.dispose()
    this.exterior.removeFromParent()
    this.interiors.removeFromParent()
  }
}

/**
 * Fondos detrás de los huecos de las puertas de la calle, para que no se vea a través mientras el edificio no está
 * montado: oscuro en los portales y un interior pintado en los locales (`shopBackdrops.ts`), que se ilumina si está
 * abierto. Una malla instanciada por material; cada fondo se puede ocultar.
 */
class DoorBackings {
  readonly group = new THREE.Group()
  private readonly matrices: THREE.Matrix4[]
  /** en qué malla y en qué copia está cada fondo */
  private readonly slots: { mesh: THREE.InstancedMesh; instance: number }[] = []
  private readonly shopMaterials = new Map<ShopBackdropKind, THREE.MeshStandardMaterial>()
  private readonly geometry = new THREE.PlaneGeometry(1, 1)
  private lit = ''
  private static readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(openings: { spot: Spot; width: number; height: number; kind?: ShopBackdropKind }[]) {
    this.matrices = openings.map(({ spot, width, height }) => {
      if (width === 0) return DoorBackings.hidden.clone()
      // a 30 cm por dentro de la fachada, mirando a la calle
      return placementMatrix(spot.x, 0, spot.z, spot.yaw).multiply(new THREE.Matrix4().makeTranslation(0, GROUND_FLOOR_Y + height / 2, -0.3)).multiply(new THREE.Matrix4().makeScale(width, height, 1))
    })
    const groups = new Map<string, number[]>()
    openings.forEach((opening, i) => groups.set(opening.kind ?? 'portal', [...(groups.get(opening.kind ?? 'portal') ?? []), i]))
    for (const [key, indices] of groups) {
      let material: THREE.MeshStandardMaterial
      if (key === 'portal') material = new THREE.MeshStandardMaterial({ color: 0x1d1916, roughness: 1 })
      else {
        material = shopBackdropMaterial(key as ShopBackdropKind)
        this.shopMaterials.set(key as ShopBackdropKind, material)
      }
      const mesh = new THREE.InstancedMesh(this.geometry, material, indices.length)
      mesh.frustumCulled = false
      indices.forEach((index, instance) => {
        this.slots[index] = { mesh, instance }
        mesh.setMatrixAt(instance, this.matrices[index])
      })
      mesh.instanceMatrix.needsUpdate = true
      this.group.add(mesh)
    }
  }

  show(index: number, shown: boolean) {
    const slot = this.slots[index]
    if (!slot) return
    slot.mesh.setMatrixAt(slot.instance, shown ? this.matrices[index] : DoorBackings.hidden)
    slot.mesh.instanceMatrix.needsUpdate = true
  }

  /** Enciende o apaga los locales pintados según la hora (solo cambia algo al abrir, cerrar o anochecer). */
  light(hour: number) {
    const night = hour < 7.5 || hour >= 20.5
    const key = [...this.shopMaterials.keys()].map((kind) => (isShopOpen(kind, hour) ? 1 : 0)).join('') + (night ? 'n' : 'd')
    if (key === this.lit) return
    this.lit = key
    for (const [kind, material] of this.shopMaterials) lightShopBackdrop(material, isShopOpen(kind, hour), night)
  }

  dispose() {
    this.geometry.dispose()
    for (const mesh of this.group.children as THREE.InstancedMesh[]) {
      const material = mesh.material as THREE.MeshStandardMaterial
      material.map?.dispose()
      material.dispose()
      mesh.dispose()
    }
  }
}
