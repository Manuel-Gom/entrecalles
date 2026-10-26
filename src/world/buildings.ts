import * as THREE from 'three'
import type { Seat } from './brain'
import { BuildingInterior, type BuildingSound, type PropLibrary } from './buildingInterior'
import { FURNITURE, GROUND_FLOOR_Y, PORTAL_OPENING, SHOP_OPENING, inBox, planBuilding, type PlanLight } from './buildingPlan'
import type { Box } from './collision'
import { InstancedProp, swingTowards } from './doors'
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
const ACTIVATE_DISTANCE = 14
const RELEASE_DISTANCE = 20
/**
 * Entre dos edificios vecinos, se cambia al otro solo si su puerta está esto más cerca que la del montado: sin margen, al
 * andar entre las dos puertas se montaba y se soltaba uno y otro una y otra vez.
 */
const SWITCH_MARGIN = 3
/** A cuántos metros se abren solas las puertas de la calle. */
const STREET_DOOR_REACH = 2.2

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
  private active: Active | null = null
  /** el último interior soltado, guardado (oculto) por si se vuelve a él enseguida */
  private parked: { building: Building; interior: BuildingInterior } | null = null
  private view = { level: -1, inside: false }
  private combinedObstacles: { source: readonly Box[]; list: Box[] } | null = null
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
    // detrás de cada hueco, un fondo oscuro: mientras el edificio no está montado por dentro, no se ve a través
    const openings: { spot: Spot; width: number; height: number }[] = []
    for (const b of buildings) {
      openings.push({ spot: b.portal, ...PORTAL_OPENING })
      openings.push(b.shop.kind === 'cafe' ? { spot: b.portal, width: 0, height: 0 } : { spot: b.shop.door, ...SHOP_OPENING })
    }
    this.backing = new DoorBackings(openings)
    this.exterior.add(this.backing.mesh)
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
    const i = active.building.index
    this.portals?.setOpen(i, 0)
    if (this.shopSlot[i] >= 0) this.shops?.setOpen(this.shopSlot[i], 0)
    this.backing?.show(i * 2, true)
    this.backing?.show(i * 2 + 1, true)
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

  /** Avanza: elige el edificio montado, abre sus puertas y mueve el ascensor. */
  update(dt: number, x: number, z: number, y: number, sound: (s: BuildingSound) => void) {
    if (!this.ready) return
    const inside = this.inside(x, z)
    if (!inside) {
      const next = this.pick(x, z)
      if (next && next !== this.active?.building && !this.keeps(next, x, z)) this.activate(next)
      else if (!next && this.active && this.doorDistance(this.active.building, x, z) > RELEASE_DISTANCE) this.deactivate()
    }
    const active = this.active
    if (!active) return
    const level = active.interior.levelAt(y)
    if (level !== this.view.level || inside !== this.view.inside) {
      this.view = { level, inside }
      active.interior.setView(level, inside)
    }
    active.interior.update(dt, x, z, y, sound)
    // las puertas de la calle del edificio montado se abren al acercarse (a pie de calle)
    const street = y < GROUND_FLOOR_Y + 1
    const i = active.building.index
    const swing = (prop: InstancedProp | null, slot: number, spot: Spot) => {
      if (!prop || slot < 0) return
      const near = street && Math.hypot(x - spot.x, z - spot.z) < STREET_DOOR_REACH
      const now = prop.openness(slot)
      const next = swingTowards(now, near ? 1 : 0, dt)
      if (now === 0 && next > 0) sound('puerta')
      prop.setOpen(slot, next)
    }
    swing(this.portals, i, active.building.portal)
    swing(this.shops, this.shopSlot[i], active.building.shop.door)
  }

  /** Colisiones para quien está en (x, z) a la altura `y`. */
  obstacles(city: readonly Box[], y: number): readonly Box[] {
    const active = this.active
    if (!active) return city
    const source = active.interior.obstaclesFor(y)
    if (this.combinedObstacles?.source !== source) this.combinedObstacles = { source, list: [...active.cityObstacles, ...source] }
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
    }
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

/** Fondos oscuros detrás de los huecos de las puertas de la calle (una malla instanciada; cada uno se puede ocultar). */
class DoorBackings {
  readonly mesh: THREE.InstancedMesh
  private readonly matrices: THREE.Matrix4[]
  private static readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0)

  constructor(openings: { spot: Spot; width: number; height: number }[]) {
    const geometry = new THREE.PlaneGeometry(1, 1)
    const material = new THREE.MeshStandardMaterial({ color: 0x1d1916, roughness: 1 })
    this.mesh = new THREE.InstancedMesh(geometry, material, openings.length)
    this.mesh.frustumCulled = false
    this.matrices = openings.map(({ spot, width, height }) => {
      if (width === 0) return DoorBackings.hidden.clone()
      // a 30 cm por dentro de la fachada, mirando a la calle
      return placementMatrix(spot.x, 0, spot.z, spot.yaw).multiply(new THREE.Matrix4().makeTranslation(0, GROUND_FLOOR_Y + height / 2, -0.3)).multiply(new THREE.Matrix4().makeScale(width, height, 1))
    })
    this.matrices.forEach((matrix, i) => this.mesh.setMatrixAt(i, matrix))
    this.mesh.instanceMatrix.needsUpdate = true
  }

  show(index: number, shown: boolean) {
    if (index >= this.matrices.length) return
    this.mesh.setMatrixAt(index, shown ? this.matrices[index] : DoorBackings.hidden)
    this.mesh.instanceMatrix.needsUpdate = true
  }

  dispose() {
    this.mesh.geometry.dispose()
    ;(this.mesh.material as THREE.Material).dispose()
    this.mesh.dispose()
  }
}
