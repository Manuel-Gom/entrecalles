import * as THREE from 'three'
import { makeSeat, type Seat } from './brain'
import type { Box, Vec2 } from './collision'
import type { Blocker, Spot } from './layout'
import { disposeProp, loadProp, placementMatrix, worldBox, type Prop } from './props'
import { makeSeatRoute } from './seating'

/** El interior está lejos de la ciudad, en su propio rincón del mundo (se enseña solo cuando se está dentro). */
export const INTERIOR_ORIGIN = { x: 0, z: 400 }
/** A cuántos metros del punto de salida se puede pulsar "salir". */
const EXIT_REACH = 1.2
/** Distancia a la que se acerca uno a una silla (por detrás) o a un taburete. */
export const CHAIR_APPROACH = 0.8
export const STOOL_APPROACH = 0.55

/** Una sala de un edificio (modelo de Blender) con sus colisiones, plazas y luces, cargada solo mientras se está dentro. */
export class Interior {
  readonly group = new THREE.Group()
  readonly obstacles: Box[] = []
  /** las paredes, que tapan la vista de la cámara */
  readonly blockers: Blocker[] = []
  readonly seats: Seat[] = []
  readonly lights: THREE.PointLight[] = []
  /** dónde aparece el jugador al entrar, mirando hacia dentro */
  readonly entry: Spot
  /** el punto junto a la puerta desde el que se puede salir */
  readonly exit: Vec2
  private readonly prop: Prop

  private constructor(prop: Prop) {
    this.prop = prop
    const placement = placementMatrix(INTERIOR_ORIGIN.x, 0, INTERIOR_ORIGIN.z, 0)
    prop.root.applyMatrix4(placement)
    this.group.add(prop.root)

    const colliderBoxes = new Map<string, Box>()
    for (const collider of prop.colliders) {
      const { box, maxY } = worldBox(collider, placement)
      this.obstacles.push(box)
      colliderBoxes.set(collider.name, box)
      // La sala no tiene techo; el bloqueo de cámara se prolonga para que la cámara no salga por encima de los muros.
      if (/^COL_pared/.test(collider.name)) this.blockers.push({ box, height: maxY + 3.8 })
    }
    for (const marker of prop.seats) {
      const position = marker.position.clone().applyMatrix4(placement)
      // los taburetes y las sillas se alcanzan por detrás: delante tienen la barra o la mesa
      const approach = /taburete/.test(marker.name) ? STOOL_APPROACH : CHAIR_APPROACH
      const seat = makeSeat(position.x, position.z, marker.yaw, 'detras', approach, marker.position.y)
      const colliderName = marker.name.replace(/^SEAT_/, 'COL_')
      seat.collider = colliderBoxes.get(colliderName)
      seat.route = makeSeatRoute(seat, this.obstacles)
      this.seats.push(seat)
    }
    const entry = prop.markers.get('ENTRADA')
    const exit = prop.markers.get('SALIDA')
    const entryPosition = (entry?.position ?? new THREE.Vector3(0, 0, 1)).clone().applyMatrix4(placement)
    const exitPosition = (exit?.position ?? new THREE.Vector3(0, 0, 0.3)).clone().applyMatrix4(placement)
    this.entry = { x: entryPosition.x, z: entryPosition.z, yaw: entry?.yaw ?? 0 }
    this.exit = { x: exitPosition.x, z: exitPosition.z }

    // las luces son puntos del modelo; su intensidad se ajusta aquí
    for (const marker of prop.lights) {
      const light = new THREE.PointLight(0xffdfb0, 14, 0, 2)
      light.position.copy(marker.position).applyMatrix4(placement)
      this.lights.push(light)
      this.group.add(light)
    }
  }

  static async load(): Promise<Interior> {
    return new Interior(await loadProp('cafe_interior'))
  }

  canExit(x: number, z: number): boolean {
    return Math.hypot(x - this.exit.x, z - this.exit.z) <= EXIT_REACH
  }

  dispose() {
    for (const light of this.lights) light.dispose()
    disposeProp(this.prop)
    this.group.removeFromParent()
  }
}
