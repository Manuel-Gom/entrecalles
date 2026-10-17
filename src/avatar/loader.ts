import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'

const loader = new GLTFLoader()
loader.setMeshoptDecoder(MeshoptDecoder)

interface CacheEntry {
  gltf: Promise<THREE.Group>
  lastUsed: number
}

const cache = new Map<string, CacheEntry>()
const MAX_CACHED = 30
const inUse = new Set<THREE.Object3D>()

const HAIR_LIKE = /hair|short|afro|messy|brow|lash|cap|newsboy|beard|moustache|bigote|bob|braid|ponytail|long/i

/** El exportador marca todos los materiales como transparentes: aquí se dejan opacos
 * (o con recorte, en pelo, cejas y pestañas) para evitar errores de orden al dibujar. */
function fixMaterials(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = false
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      const cutout = HAIR_LIKE.test(material.name) || HAIR_LIKE.test(mesh.name)
      material.transparent = false
      material.depthWrite = true
      material.alphaTest = cutout ? 0.45 : 0
      material.side = cutout ? THREE.DoubleSide : THREE.FrontSide
      material.envMapIntensity = 0.7
      if (/body/i.test(material.name)) {
        material.roughness = Math.min(material.roughness, 0.62)
        material.metalness = 0
      }
      if (/low-poly|high-poly|eyes/i.test(material.name)) {
        material.roughness = 0.12
      }
      material.needsUpdate = true
    }
  })
}

function load(url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => {
        fixMaterials(gltf.scene)
        resolve(gltf.scene)
      },
      undefined,
      (error) => reject(error instanceof Error ? error : new Error(`No se pudo cargar ${url}`)),
    )
  })
}

function disposeScene(root: THREE.Object3D) {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.geometry.dispose()
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) value.dispose()
      }
      material.dispose()
    }
    const skinned = mesh as THREE.SkinnedMesh
    skinned.skeleton?.dispose()
  })
}

function evictOldEntries(keepUrl: string) {
  if (cache.size <= MAX_CACHED) return
  const sorted = [...cache.entries()]
    .filter(([url]) => url !== keepUrl)
    .sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  for (const [url, entry] of sorted) {
    if (cache.size <= MAX_CACHED) break
    cache.delete(url)
    void entry.gltf.then((scene) => {
      // Si un clon sigue en pantalla comparte geometría con este original: se libera al soltarlo
      if (![...inUse].some((clone) => clone.userData.sourceUrl === url)) disposeScene(scene)
    })
  }
}

/** Devuelve una copia lista para montar en la escena. Los datos pesados se comparten con la caché. */
export async function loadAvatarModel(url: string): Promise<THREE.Object3D> {
  let entry = cache.get(url)
  if (!entry) {
    entry = { gltf: load(url), lastUsed: 0 }
    cache.set(url, entry)
    entry.gltf.catch(() => cache.delete(url))
  }
  entry.lastUsed = performance.now()
  const source = await entry.gltf
  const copy = cloneSkinned(source)
  copy.userData.sourceUrl = url
  inUse.add(copy)
  evictOldEntries(url)
  return copy
}

/** Avisa de que una copia ya no se usa (se puede liberar si su original salió de la caché). */
export function releaseAvatarModel(copy: THREE.Object3D) {
  inUse.delete(copy)
  // cada copia tiene su propio esqueleto (con su textura de huesos): siempre se libera
  copy.traverse((object) => {
    const skinned = object as THREE.SkinnedMesh
    if (skinned.isSkinnedMesh) skinned.skeleton.dispose()
  })
  const url = copy.userData.sourceUrl as string | undefined
  if (url && !cache.has(url)) {
    // El original ya no está en la caché: no hay nada más que conserve su memoria
    disposeScene(copy)
  }
}
