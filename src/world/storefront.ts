import * as THREE from 'three'
import type { Vec2 } from './collision'
import type { Spot } from './layout'
import { disposeProp, loadProp, type Prop } from './props'

/** Hasta dónde se abre la puerta (rad) y a qué velocidad. */
const OPEN_ANGLE = 1.55
const OPEN_SPEED = 3.2
/** A cuántos metros de la puerta se abre sola, y a cuántos del punto de llamada se puede entrar. */
const OPEN_DISTANCE = 2.6
const ENTER_REACH = 1.4
/** Dónde se pone quien va a entrar: delante de la puerta, a esta distancia. */
const FRONT_DISTANCE = 0.9

/** La fachada del café (modelo de Blender) colocada sobre el muro, con su puerta que se abre al acercarse. */
export class Storefront {
  readonly group = new THREE.Group()
  /** centro del hueco de la puerta, sobre la fachada */
  readonly door: Vec2
  /** el punto desde el que se llama a la puerta, delante de ella */
  readonly front: Vec2
  readonly outwardYaw: number
  private readonly prop: Prop
  private angle = 0

  private constructor(prop: Prop, spot: Spot) {
    this.prop = prop
    this.door = { x: spot.x, z: spot.z }
    this.outwardYaw = spot.yaw
    this.front = { x: spot.x + Math.sin(spot.yaw) * FRONT_DISTANCE, z: spot.z + Math.cos(spot.yaw) * FRONT_DISTANCE }
    // el módulo se coloca para que el centro de su puerta caiga en el sitio elegido
    const marker = prop.markers.get('PUERTA_CENTRO')
    const local = marker?.position ?? new THREE.Vector3()
    const cos = Math.cos(spot.yaw)
    const sin = Math.sin(spot.yaw)
    prop.root.position.set(spot.x - (local.x * cos + local.z * sin), 0, spot.z - (-local.x * sin + local.z * cos))
    prop.root.rotation.y = spot.yaw
    this.group.add(prop.root)
  }

  static async load(spot: Spot): Promise<Storefront> {
    return new Storefront(await loadProp('fachada_cafe'), spot)
  }

  /** Abre o cierra la puerta según lo cerca que esté el jugador. */
  update(dt: number, playerX: number, playerZ: number) {
    const near = Math.hypot(playerX - this.door.x, playerZ - this.door.z) < OPEN_DISTANCE
    const target = near ? OPEN_ANGLE : 0
    const step = OPEN_SPEED * dt
    this.angle += Math.max(-step, Math.min(step, target - this.angle))
    // la hoja gira alrededor de su bisagra hacia el interior del edificio
    if (this.prop.door) this.prop.door.rotation.y = this.angle
  }

  /** Ángulo actual de la puerta, de 0 (cerrada) a 1 (abierta del todo). */
  get openness(): number {
    return this.angle / OPEN_ANGLE
  }

  canEnter(x: number, z: number): boolean {
    return Math.hypot(x - this.front.x, z - this.front.z) <= ENTER_REACH
  }

  dispose() {
    disposeProp(this.prop)
    this.group.removeFromParent()
  }
}
