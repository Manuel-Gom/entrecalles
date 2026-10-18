import * as THREE from 'three'
import { BLOCK_CENTERS, BLOCK_HALF, RING_OUTER, SIDEWALK_HEIGHT, STREET_CENTERS, WORLD_HALF, type CityLayout } from './layout'

/** Acumula cajas y cuadriláteros con color por vértice para fusionarlos en una sola malla (una sola llamada de dibujo). */
class GeometryBuilder {
  private readonly positions: number[] = []
  private readonly normals: number[] = []
  private readonly uvs: number[] = []
  private readonly colors: number[] = []
  private readonly indices: number[] = []
  private readonly color = new THREE.Color()

  private push(corners: number[][], normal: number[], rgb: THREE.Color, uv: number[][]) {
    const start = this.positions.length / 3
    corners.forEach((corner, i) => {
      this.positions.push(corner[0], corner[1], corner[2])
      this.normals.push(normal[0], normal[1], normal[2])
      this.uvs.push(uv[i][0], uv[i][1])
      this.colors.push(rgb.r, rgb.g, rgb.b)
    })
    this.indices.push(start, start + 1, start + 2, start, start + 2, start + 3)
  }

  /** Cuadrilátero horizontal mirando hacia arriba. */
  floor(minX: number, minZ: number, maxX: number, maxZ: number, y: number, hex: number) {
    this.color.set(hex)
    this.push(
      [[minX, y, maxZ], [maxX, y, maxZ], [maxX, y, minZ], [minX, y, minZ]],
      [0, 1, 0],
      this.color,
      [[0, 0], [0, 0], [0, 0], [0, 0]],
    )
  }

  /** Caja alineada con los ejes. Con `windows`, las paredes llevan coordenadas de textura en metros. */
  box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, hex: number, windows = false) {
    this.color.set(hex)
    const tileW = 3
    const tileH = 3.2
    const faces: { corners: number[][]; normal: number[]; wall: boolean; u: (c: number[]) => number }[] = [
      { corners: [[minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ]], normal: [0, 0, 1], wall: true, u: (c) => c[0] },
      { corners: [[maxX, minY, minZ], [minX, minY, minZ], [minX, maxY, minZ], [maxX, maxY, minZ]], normal: [0, 0, -1], wall: true, u: (c) => -c[0] },
      { corners: [[maxX, minY, maxZ], [maxX, minY, minZ], [maxX, maxY, minZ], [maxX, maxY, maxZ]], normal: [1, 0, 0], wall: true, u: (c) => -c[2] },
      { corners: [[minX, minY, minZ], [minX, minY, maxZ], [minX, maxY, maxZ], [minX, maxY, minZ]], normal: [-1, 0, 0], wall: true, u: (c) => c[2] },
      { corners: [[minX, maxY, maxZ], [maxX, maxY, maxZ], [maxX, maxY, minZ], [minX, maxY, minZ]], normal: [0, 1, 0], wall: false, u: () => 0 },
    ]
    for (const face of faces) {
      const uv = face.corners.map((c) => (windows && face.wall ? [face.u(c) / tileW, c[1] / tileH] : [0, 0]))
      this.push(face.corners, face.normal, this.color, uv)
    }
  }

  /** Copia una geometría ya hecha (esferas de las copas) con color plano. */
  mesh(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, hex: number) {
    this.color.set(hex)
    const flat = geometry.index ? geometry.toNonIndexed() : geometry
    const position = flat.getAttribute('position')
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix)
    const p = new THREE.Vector3()
    const n = new THREE.Vector3()
    const start = this.positions.length / 3
    for (let i = 0; i < position.count; i++) {
      p.fromBufferAttribute(position, i).applyMatrix4(matrix)
      n.fromBufferAttribute(flat.getAttribute('normal'), i).applyMatrix3(normalMatrix).normalize()
      this.positions.push(p.x, p.y, p.z)
      this.normals.push(n.x, n.y, n.z)
      this.uvs.push(0, 0)
      this.colors.push(this.color.r, this.color.g, this.color.b)
      this.indices.push(start + i)
    }
    if (flat !== geometry) flat.dispose()
  }

  build(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3))
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3))
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2))
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3))
    geometry.setIndex(this.indices)
    geometry.computeBoundingSphere()
    return geometry
  }
}

function makeFacadeTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 128, 128)
    // marco, cristal y un reflejo
    ctx.fillStyle = '#d9d4cb'
    ctx.fillRect(30, 22, 68, 80)
    ctx.fillStyle = '#55707f'
    ctx.fillRect(35, 27, 58, 70)
    ctx.fillStyle = '#7d9bab'
    ctx.fillRect(35, 27, 58, 24)
    ctx.fillStyle = '#d9d4cb'
    ctx.fillRect(62, 27, 4, 70)
    // alféizar
    ctx.fillStyle = '#bdb7ac'
    ctx.fillRect(26, 102, 76, 6)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  return texture
}

export interface CityMeshes {
  group: THREE.Group
  /** bancos de relleno hechos con cajas: se ocultan cuando llegan los modelos de Blender */
  benchMesh: THREE.Mesh
  dispose(): void
}

const ASPHALT = 0x3b3f42
const SIDEWALK_COLOR = 0xb9b6ae
const MARKING = 0xe8e4d6
const GRASS = 0x6f9a52

/** Construye el barrio: dos mallas fusionadas (edificios con ventanas y mobiliario urbano) más el terreno. */
export function buildCityMeshes(layout: CityLayout): CityMeshes {
  const props = new GeometryBuilder()
  const walls = new GeometryBuilder()
  const benches = new GeometryBuilder()

  // calzada
  props.floor(-WORLD_HALF, -WORLD_HALF, WORLD_HALF, WORLD_HALF, 0, ASPHALT)

  // aceras: un anillo alrededor de cada manzana
  const y = SIDEWALK_HEIGHT
  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) {
      const outer = RING_OUTER
      props.floor(cx - outer, cz - outer, cx + outer, cz - BLOCK_HALF, y, SIDEWALK_COLOR)
      props.floor(cx - outer, cz + BLOCK_HALF, cx + outer, cz + outer, y, SIDEWALK_COLOR)
      props.floor(cx - outer, cz - BLOCK_HALF, cx - BLOCK_HALF, cz + BLOCK_HALF, y, SIDEWALK_COLOR)
      props.floor(cx + BLOCK_HALF, cz - BLOCK_HALF, cx + outer, cz + BLOCK_HALF, y, SIDEWALK_COLOR)
    }
  }

  // rayas discontinuas en el centro de las calles, fuera de los cruces
  for (const c of STREET_CENTERS) {
    for (let t = -WORLD_HALF + 3; t < WORLD_HALF - 2; t += 4) {
      const nearCrossing = STREET_CENTERS.some((k) => Math.abs(t + 0.75 - k) < 6.5)
      if (nearCrossing) continue
      props.floor(c - 0.08, t, c + 0.08, t + 1.5, 0.012, MARKING)
      props.floor(t, c - 0.08, t + 1.5, c + 0.08, 0.012, MARKING)
    }
  }

  // pasos de peatones donde los anillos de manzanas vecinas se unen
  for (const node of layout.nav) {
    for (const otherId of node.links) {
      const other = layout.nav[otherId]
      if (otherId < node.id) continue
      const dx = other.x - node.x
      const dz = other.z - node.z
      const length = Math.hypot(dx, dz)
      if (length < 5) continue // lados de una acera, no cruces
      const mx = (node.x + other.x) / 2
      const mz = (node.z + other.z) / 2
      const alongX = Math.abs(dx) > Math.abs(dz)
      for (let k = -2; k <= 2; k++) {
        const offset = k * 0.9
        if (alongX) props.floor(mx - 2.3, mz + offset - 0.25, mx + 2.3, mz + offset + 0.25, 0.012, MARKING)
        else props.floor(mx + offset - 0.25, mz - 2.3, mx + offset + 0.25, mz + 2.3, 0.012, MARKING)
      }
    }
  }

  // parque
  const park = layout.park
  props.floor(park.minX, park.minZ, park.maxX, park.maxZ, 0.03, GRASS)
  props.floor(-1.2, -park.maxZ, 1.2, park.maxZ, 0.035, 0xc8b99a) // paseo norte-sur
  props.floor(-park.maxX, -1.2, park.maxX, 1.2, 0.035, 0xc8b99a) // paseo este-oeste
  props.box(-1.7, 0, -1.7, 1.7, 0.45, 1.7, 0x9a9a95) // fuente
  props.floor(-1.45, -1.45, 1.45, 1.45, 0.38, 0x5fa3c4)
  props.box(-0.2, 0, -0.2, 0.2, 1.3, 0.2, 0x8c8c88)

  // edificios: paredes con ventanas y azotea
  for (const building of layout.buildings) {
    const { box, height, color } = building
    walls.box(box.minX, 0, box.minZ, box.maxX, height, box.maxZ, color, true)
    // cornisa sencilla
    props.box(box.minX - 0.1, height, box.minZ - 0.1, box.maxX + 0.1, height + 0.35, box.maxZ + 0.1, 0x8d877d)
  }

  // bancos de relleno (los de verdad son un modelo de Blender: public/models/mundo/banco.glb)
  for (const bench of layout.benches) {
    const dirX = Math.sin(bench.yaw)
    const dirZ = Math.cos(bench.yaw)
    const alongX = Math.abs(dirZ) > 0.5
    const half = 0.8
    const depth = 0.25
    const seatMinX = bench.x - (alongX ? half : depth)
    const seatMaxX = bench.x + (alongX ? half : depth)
    const seatMinZ = bench.z - (alongX ? depth : half)
    const seatMaxZ = bench.z + (alongX ? depth : half)
    benches.box(seatMinX, 0.42, seatMinZ, seatMaxX, 0.48, seatMaxZ, 0x8a6a45)
    // respaldo detrás (en sentido contrario a hacia donde se mira)
    const backX = bench.x - dirX * (depth - 0.03)
    const backZ = bench.z - dirZ * (depth - 0.03)
    benches.box(
      backX - (alongX ? half : 0.03), 0.48, backZ - (alongX ? 0.03 : half),
      backX + (alongX ? half : 0.03), 0.9, backZ + (alongX ? 0.03 : half),
      0x7c5e3c,
    )
    for (const side of [-1, 1]) {
      const lx = bench.x + (alongX ? side * (half - 0.1) : 0)
      const lz = bench.z + (alongX ? 0 : side * (half - 0.1))
      benches.box(lx - (alongX ? 0.04 : depth - 0.03), 0, lz - (alongX ? depth - 0.03 : 0.04), lx + (alongX ? 0.04 : depth - 0.03), 0.42, lz + (alongX ? depth - 0.03 : 0.04), 0x2e3033)
    }
  }

  // farolas
  for (const lamp of layout.lamps) {
    props.box(lamp.x - 0.06, 0, lamp.z - 0.06, lamp.x + 0.06, 4.5, lamp.z + 0.06, 0x2c2f33)
    props.box(lamp.x - 0.3, 4.5, lamp.z - 0.12, lamp.x + 0.3, 4.65, lamp.z + 0.12, 0x2c2f33)
  }

  // árboles
  const canopy = new THREE.IcosahedronGeometry(1, 1)
  const greens = [0x4f8a3c, 0x5c9644, 0x467a36, 0x6aa04a]
  const matrix = new THREE.Matrix4()
  layout.trees.forEach((tree, index) => {
    const s = tree.scale
    props.box(tree.x - 0.12 * s, 0, tree.z - 0.12 * s, tree.x + 0.12 * s, 2.3 * s, tree.z + 0.12 * s, 0x5a4330)
    matrix.compose(new THREE.Vector3(tree.x, 3.1 * s, tree.z), new THREE.Quaternion(), new THREE.Vector3(1.4 * s, 1.3 * s, 1.4 * s))
    props.mesh(canopy, matrix, greens[index % greens.length])
  })
  canopy.dispose()

  const texture = makeFacadeTexture()
  const benchGeometry = benches.build()
  const propGeometry = props.build()
  const wallGeometry = walls.build()
  const propMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
  const wallMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: texture, roughness: 0.9, metalness: 0 })

  const group = new THREE.Group()
  const propMesh = new THREE.Mesh(propGeometry, propMaterial)
  const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial)
  propMesh.receiveShadow = wallMesh.receiveShadow = true
  propMesh.castShadow = wallMesh.castShadow = true
  const benchMesh = new THREE.Mesh(benchGeometry, propMaterial)
  benchMesh.castShadow = benchMesh.receiveShadow = true
  group.add(propMesh, wallMesh, benchMesh)

  // terreno lejano, por debajo de todo
  const farGround = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x7c8a6a, roughness: 1 }),
  )
  farGround.position.y = -0.05
  farGround.receiveShadow = true
  group.add(farGround)

  return {
    group,
    benchMesh,
    dispose() {
      benchGeometry.dispose()
      propGeometry.dispose()
      wallGeometry.dispose()
      farGround.geometry.dispose()
      ;(farGround.material as THREE.Material).dispose()
      propMaterial.dispose()
      wallMaterial.dispose()
      texture.dispose()
    },
  }
}
