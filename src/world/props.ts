import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import type { Box } from './collision'

/**
 * Modelos del mundo hechos en Blender (tools/blender/crear_props.py). Además de la malla traen objetos vacíos con datos:
 *   COL_*   caja de colisión (la escala del vacío es la mitad del tamaño)
 *   SEAT_*  una plaza: mira hacia donde apunta el vacío
 *   LUZ_*   sitio de un punto de luz
 *   y marcadores sueltos (ENTRADA, SALIDA, PUERTA_CENTRO) y la hoja de una puerta (PUERTA_HOJA, con la bisagra como origen).
 */

/** Un marcador: dónde está y cómo está orientado respecto al origen del modelo. */
export interface Marker {
  name: string
  position: THREE.Vector3
  /** hacia dónde mira (rotación sobre Y; la dirección es (sin yaw, cos yaw)) */
  yaw: number
  /** la transformación completa, para las cajas de colisión */
  matrix: THREE.Matrix4
}

export interface Prop {
  root: THREE.Group
  colliders: Marker[]
  seats: Marker[]
  lights: Marker[]
  markers: Map<string, Marker>
  /** hoja de la puerta, si el modelo tiene (su origen es la bisagra) */
  door: THREE.Object3D | null
}

export function markerFromMatrix(name: string, matrix: THREE.Matrix4): Marker {
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  matrix.decompose(position, quaternion, scale)
  const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quaternion)
  return { name, position, yaw: Math.atan2(forward.x, forward.z), matrix: matrix.clone() }
}

/** Una caja de colisión colocada en el mundo (`placement` lleva el modelo a su sitio): su huella en el suelo y su altura. */
export function worldBox(collider: Marker, placement: THREE.Matrix4): { box: Box; minY: number; maxY: number } {
  const matrix = placement.clone().multiply(collider.matrix)
  const corner = new THREE.Vector3()
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        corner.set(x, y, z).applyMatrix4(matrix)
        minX = Math.min(minX, corner.x)
        maxX = Math.max(maxX, corner.x)
        minZ = Math.min(minZ, corner.z)
        maxZ = Math.max(maxZ, corner.z)
        minY = Math.min(minY, corner.y)
        maxY = Math.max(maxY, corner.y)
      }
    }
  }
  return { box: { minX, maxX, minZ, maxZ }, minY, maxY }
}

/** Matriz que coloca un modelo en el mundo: su posición y hacia dónde mira. */
export function placementMatrix(x: number, y: number, z: number, yaw: number): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(1, 1, 1))
}

/** Separa los vacíos de datos del resto del modelo. Es independiente del cargador para poder probarse. */
export function extractProp(root: THREE.Group): Prop {
  root.updateMatrixWorld(true)
  const colliders: Marker[] = []
  const seats: Marker[] = []
  const lights: Marker[] = []
  const markers = new Map<string, Marker>()
  const dataNodes: THREE.Object3D[] = []
  let door: THREE.Object3D | null = null
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (/^PUERTA_HOJA/.test(node.name)) door = node
    if (mesh.isMesh) return
    const marker = () => markerFromMatrix(node.name, node.matrixWorld)
    if (/^COL_/.test(node.name)) colliders.push(marker())
    else if (/^SEAT_/.test(node.name)) seats.push(marker())
    else if (/^LUZ_/.test(node.name)) lights.push(marker())
    else if (/^(ENTRADA|SALIDA|PUERTA_CENTRO)/.test(node.name)) markers.set(node.name.replace(/\d+$/, ''), marker())
    else return
    dataNodes.push(node)
  })
  for (const node of dataNodes) node.removeFromParent()
  return { root, colliders, seats, lights, markers, door }
}

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)
const base = `${import.meta.env.BASE_URL}models/mundo/`

/** Carga un modelo de `public/models/mundo/<nombre>.glb`. */
export async function loadProp(name: string): Promise<Prop> {
  const gltf = await loader.loadAsync(`${base}${name}.glb`)
  const root = gltf.scene
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    // los materiales de cristal (con alfa) no deben escribir en el z-buffer
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (material.transparent) material.depthWrite = false
    }
  })
  return extractProp(root)
}

/** Libera de la tarjeta gráfica todo lo que usa un modelo. */
export function disposeProp(prop: Prop | THREE.Object3D) {
  const root = 'root' in prop ? prop.root : prop
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose()
      material.dispose()
    }
  })
  root.removeFromParent()
}

/** Dibuja el mismo modelo muchas veces con pocas llamadas: una malla instanciada por cada malla del modelo. */
export function instanceProp(prop: Prop, placements: readonly THREE.Matrix4[]): THREE.Group {
  const group = new THREE.Group()
  prop.root.updateMatrixWorld(true)
  const local = new THREE.Matrix4()
  prop.root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const instanced = new THREE.InstancedMesh(mesh.geometry, mesh.material, placements.length)
    placements.forEach((placement, i) => {
      local.multiplyMatrices(placement, mesh.matrixWorld)
      instanced.setMatrixAt(i, local)
    })
    instanced.instanceMatrix.needsUpdate = true
    instanced.castShadow = true
    instanced.receiveShadow = true
    instanced.frustumCulled = false
    group.add(instanced)
  })
  return group
}
