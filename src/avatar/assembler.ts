import * as THREE from 'three'
import { bodyUrl, pieceUrl, type Slot, type TintSlot } from './catalog'
import { loadAvatarModel, releaseAvatarModel } from './loader'
import { applyNaturalPose, type AvatarPose } from './pose'

interface MountedPiece {
  id: string
  copy: THREE.Object3D
  meshes: THREE.SkinnedMesh[]
  skeletons: THREE.Skeleton[]
}

/** Teñido del pelo: conserva la luz y la sombra de la textura y le da el color elegido.
 * `tint` es el color medio que se quiere ver. */
function applyHairTint(material: THREE.MeshStandardMaterial, tint: THREE.Color) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uHairTint = { value: tint }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHairTint;')
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          float hairLum = dot( sampledDiffuseColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
          diffuseColor.rgb = uHairTint * clamp( hairLum / 0.08, 0.35, 2.4 );
          diffuseColor.a *= sampledDiffuseColor.a;
        #endif`,
      )
  }
  material.customProgramCacheKey = () => 'hair-tint'
  material.needsUpdate = true
}

/** Libera de la tarjeta gráfica lo que usaba una pieza; si se vuelve a usar, se sube de nuevo. */
function freeGpu(mesh: THREE.Mesh, ownMaterial: boolean) {
  mesh.geometry.dispose()
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) value.dispose()
    }
    if (ownMaterial) material.dispose()
  }
}

/** Un cuerpo con sus piezas de pelo, ropa y calzado enlazadas al mismo esqueleto. */
export class AvatarAssembly {
  readonly pose: AvatarPose
  private readonly bones = new Map<string, THREE.Bone>()
  private readonly pieces = new Map<Slot, MountedPiece>()
  private readonly meshParent: THREE.Object3D
  private hairColor: THREE.Color | null = null
  private readonly clothColors = new Map<Slot, THREE.Color>()
  private readonly hairTintColor = new THREE.Color()

  readonly cuerpo: string
  readonly root: THREE.Object3D

  private constructor(cuerpo: string, root: THREE.Object3D) {
    this.cuerpo = cuerpo
    this.root = root
    root.traverse((object) => {
      if ((object as THREE.Bone).isBone) this.bones.set(object.name, object as THREE.Bone)
    })
    let parent: THREE.Object3D = root
    root.traverse((object) => {
      if ((object as THREE.SkinnedMesh).isSkinnedMesh && parent === root) parent = object.parent ?? root
    })
    this.meshParent = parent
    this.pose = applyNaturalPose(root)
  }

  static async create(cuerpo: string): Promise<AvatarAssembly> {
    const root = await loadAvatarModel(bodyUrl(cuerpo))
    return new AvatarAssembly(cuerpo, root)
  }

  pieceId(slot: Slot) {
    return this.pieces.get(slot)?.id ?? null
  }

  /** Color aplicado a cada pieza teñida (hexadecimal), para las pruebas. Las piezas sin teñir no aparecen. */
  tints(): Record<string, string> {
    const result: Record<string, string> = {}
    for (const [slot, piece] of this.pieces) {
      const mesh = piece.meshes[0]
      if (mesh?.userData.originalMaterial === undefined) continue
      const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
      result[slot] = slot === 'pelo' || slot === 'barba' ? `#${this.hairColor?.getHexString() ?? ''}` : `#${material.color.getHexString()}`
    }
    return result
  }

  /** Cambia (o quita) la pieza de un hueco. */
  async setPiece(slot: Slot, id: string | null, isCurrent: () => boolean = () => true) {
    const current = this.pieces.get(slot)
    if ((current?.id ?? null) === id) return
    let next: MountedPiece | null = null
    if (id) {
      const copy = await loadAvatarModel(pieceUrl(this.cuerpo, slot, id))
      if (!isCurrent()) {
        releaseAvatarModel(copy)
        return
      }
      next = this.mount(slot, id, copy)
    }
    if (current) this.unmount(current)
    if (next) this.pieces.set(slot, next)
    else this.pieces.delete(slot)
  }

  private mount(slot: Slot, id: string, copy: THREE.Object3D): MountedPiece {
    const meshes: THREE.SkinnedMesh[] = []
    copy.traverse((object) => {
      if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh)
    })
    const skeletons: THREE.Skeleton[] = []
    for (const mesh of meshes) {
      const bones = mesh.skeleton.bones.map((bone) => this.bones.get(bone.name) ?? bone)
      const skeleton = new THREE.Skeleton(bones, mesh.skeleton.boneInverses.map((matrix) => matrix.clone()))
      mesh.skeleton.dispose()
      mesh.bind(skeleton, mesh.bindMatrix)
      skeletons.push(skeleton)
      this.meshParent.add(mesh)
      if (slot === 'pelo' || slot === 'barba') this.tintHair(mesh)
      else this.tintCloth(mesh, this.clothColors.get(slot) ?? null)
    }
    return { id, copy, meshes, skeletons }
  }

  private unmount(piece: MountedPiece) {
    for (const mesh of piece.meshes) {
      mesh.removeFromParent()
      // si el pelo estaba teñido, el material es una copia propia que hay que liberar
      freeGpu(mesh, mesh.userData.originalMaterial !== undefined)
    }
    piece.skeletons.forEach((skeleton) => skeleton.dispose())
    releaseAvatarModel(piece.copy)
  }

  private tintHair(mesh: THREE.SkinnedMesh) {
    if (!this.hairColor) return
    mesh.userData.originalMaterial ??= mesh.material
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
    const own = material.clone()
    this.hairTintColor.copy(this.hairColor)
    applyHairTint(own, this.hairTintColor)
    mesh.material = own
  }

  private tintCloth(mesh: THREE.SkinnedMesh, color: THREE.Color | null) {
    const tinted = mesh.userData.originalMaterial !== undefined
    if (color) {
      if (!tinted) {
        mesh.userData.originalMaterial = mesh.material
        const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial
        mesh.material = material.clone()
      }
      ;(mesh.material as THREE.MeshStandardMaterial).color.copy(color)
    } else if (tinted) {
      const own = mesh.material as THREE.Material
      mesh.material = mesh.userData.originalMaterial as THREE.Material
      mesh.userData.originalMaterial = undefined
      own.dispose()
    }
  }

  /** Cambia el color de tela de una pieza teñible (null = el original). */
  setPieceColor(slot: TintSlot, hex: string | null) {
    if (hex) this.clothColors.set(slot, new THREE.Color(hex))
    else this.clothColors.delete(slot)
    const piece = this.pieces.get(slot)
    if (!piece) return
    for (const mesh of piece.meshes) this.tintCloth(mesh, this.clothColors.get(slot) ?? null)
  }

  /** Cambia el color del pelo (null = el de la textura original). */
  setHairColor(hex: string | null) {
    this.hairColor = hex ? new THREE.Color(hex) : null
    // la barba y el bigote llevan el mismo color que el pelo
    for (const mesh of ['pelo', 'barba'].flatMap((slot) => this.pieces.get(slot as Slot)?.meshes ?? [])) {
      const tinted = mesh.userData.originalMaterial !== undefined
      if (this.hairColor) {
        this.hairTintColor.copy(this.hairColor)
        if (!tinted) this.tintHair(mesh)
      } else if (tinted) {
        const own = mesh.material as THREE.Material
        mesh.material = mesh.userData.originalMaterial as THREE.Material
        mesh.userData.originalMaterial = undefined
        own.dispose()
      }
    }
  }

  dispose() {
    for (const piece of this.pieces.values()) this.unmount(piece)
    this.pieces.clear()
    this.root.traverse((object) => {
      const mesh = object as THREE.SkinnedMesh
      if (mesh.isMesh) freeGpu(mesh, false)
    })
    releaseAvatarModel(this.root)
  }
}
