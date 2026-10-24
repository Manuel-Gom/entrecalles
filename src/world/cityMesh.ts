import * as THREE from 'three'
import { createGroundMaterials, flatColor, type GroundMaterials } from './ground'
import {
  BLOCK_CENTERS, BLOCK_HALF, BLOCK_PITCH, CROSSING_HALF_WIDTH, LAWN_HEIGHT, PATH_HALF_WIDTH, PATH_HEIGHT, RING_OUTER, RING_WALK, ROAD_WIDTH, SIDEWALK_HEIGHT,
  STREET_CENTERS, WORLD_HALF, type CityLayout,
} from './layout'

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

  /** Cuadrilátero horizontal mirando hacia arriba. Con `meters`, las coordenadas de textura son los metros del mundo. */
  floor(minX: number, minZ: number, maxX: number, maxZ: number, y: number, hex: number, meters = false) {
    this.color.set(hex)
    const uv = meters ? [[minX, maxZ], [maxX, maxZ], [maxX, minZ], [minX, minZ]] : [[0, 0], [0, 0], [0, 0], [0, 0]]
    this.push(
      [[minX, y, maxZ], [maxX, y, maxZ], [maxX, y, minZ], [minX, y, minZ]],
      [0, 1, 0],
      this.color,
      uv,
    )
  }

  /**
   * Losa del suelo desde la calzada hasta `top`: la cara de arriba y los cuatro cantos (el bordillo). Las coordenadas de
   * textura son metros del mundo: (x, z) arriba y (a lo largo, altura) en los cantos.
   */
  slab(minX: number, minZ: number, maxX: number, maxZ: number, top: number, hex: number) {
    this.floor(minX, minZ, maxX, maxZ, top, hex, true)
    this.color.set(hex)
    const sides: { corners: number[][]; normal: number[]; along: (c: number[]) => number }[] = [
      { corners: [[minX, 0, maxZ], [maxX, 0, maxZ], [maxX, top, maxZ], [minX, top, maxZ]], normal: [0, 0, 1], along: (c) => c[0] },
      { corners: [[maxX, 0, minZ], [minX, 0, minZ], [minX, top, minZ], [maxX, top, minZ]], normal: [0, 0, -1], along: (c) => -c[0] },
      { corners: [[maxX, 0, maxZ], [maxX, 0, minZ], [maxX, top, minZ], [maxX, top, maxZ]], normal: [1, 0, 0], along: (c) => -c[2] },
      { corners: [[minX, 0, minZ], [minX, 0, maxZ], [minX, top, maxZ], [minX, top, minZ]], normal: [-1, 0, 0], along: (c) => c[2] },
    ]
    for (const side of sides) this.push(side.corners, side.normal, this.color, side.corners.map((c) => [side.along(c), c[1]]))
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
  fountainMesh: THREE.Mesh
  treeMesh: THREE.Mesh
  lampMesh: THREE.Mesh
  /** aceras con bordillo, césped y paseos del parque, cada uno con su material */
  sidewalkMesh: THREE.Mesh
  lawnMesh: THREE.Mesh
  pathMesh: THREE.Mesh
  /** las texturas del suelo: `ground.load()` las pone cuando llegan */
  ground: GroundMaterials
  dispose(): void
}

const ASPHALT = 0x3b3f42
const MARKING = 0xe8e4d6
/** borde de piedra del césped junto a los paseos: ancho y altura (m) */
const EDGING_WIDTH = 0.12
const EDGING_HEIGHT = 0.065

const MARKING_HEIGHT = 0.012
/** Raya central: tramos de DASH_LENGTH cada DASH_PITCH y de DASH_WIDTH de ancho (m). */
const DASH_LENGTH = 1.5
const DASH_PITCH = 4
const DASH_WIDTH = 0.16
/** Bandas de la cebra: grosor, hueco entre bandas y margen hasta el bordillo (m). */
const ZEBRA_BAND = 0.5
const ZEBRA_GAP = 0.5
const ZEBRA_MARGIN = 0.4
/**
 * La raya central se corta a esta distancia del centro de cada cruce de calles: deja libre la intersección y los pasos
 * de peatones que hay a cada lado (están en la línea de las esquinas, RING_WALK, con su media anchura), más un margen.
 */
export const DASH_CLEAR = BLOCK_PITCH / 2 - RING_WALK + CROSSING_HALF_WIDTH + 0.6

export interface Mark {
  minX: number
  minZ: number
  maxX: number
  maxZ: number
}

/**
 * Las marcas pintadas en la calzada, como rectángulos en planta. La raya central no entra en los cruces ni en los pasos
 * de peatones; las bandas de cada cebra van paralelas a la calzada y se suceden de bordillo a bordillo.
 */
export function roadMarkings(layout: Pick<CityLayout, 'crossings'>): Mark[] {
  const marks: Mark[] = []
  for (const c of STREET_CENTERS) {
    for (let t = -WORLD_HALF + 3; t + DASH_LENGTH < WORLD_HALF - 2; t += DASH_PITCH) {
      const nearCrossing = STREET_CENTERS.some((k) => Math.abs(t + DASH_LENGTH / 2 - k) < DASH_CLEAR + DASH_LENGTH / 2)
      if (nearCrossing) continue
      marks.push({ minX: c - DASH_WIDTH / 2, minZ: t, maxX: c + DASH_WIDTH / 2, maxZ: t + DASH_LENGTH }) // calle norte-sur
      marks.push({ minX: t, minZ: c - DASH_WIDTH / 2, maxX: t + DASH_LENGTH, maxZ: c + DASH_WIDTH / 2 }) // calle este-oeste
    }
  }
  const bands = Math.floor((ROAD_WIDTH - 2 * ZEBRA_MARGIN + ZEBRA_GAP) / (ZEBRA_BAND + ZEBRA_GAP))
  const span = bands * ZEBRA_BAND + (bands - 1) * ZEBRA_GAP
  for (const crossing of layout.crossings) {
    for (let i = 0; i < bands; i++) {
      // a lo largo del cruce (de una acera a la otra) y a lo largo de la calle (el largo de cada banda)
      const from = -span / 2 + i * (ZEBRA_BAND + ZEBRA_GAP)
      if (crossing.alongX) {
        marks.push({ minX: crossing.x + from, maxX: crossing.x + from + ZEBRA_BAND, minZ: crossing.z - CROSSING_HALF_WIDTH, maxZ: crossing.z + CROSSING_HALF_WIDTH })
      } else {
        marks.push({ minX: crossing.x - CROSSING_HALF_WIDTH, maxX: crossing.x + CROSSING_HALF_WIDTH, minZ: crossing.z + from, maxZ: crossing.z + from + ZEBRA_BAND })
      }
    }
  }
  return marks
}

/** Construye el barrio: mallas fusionadas de edificios y relleno, más los modelos de Blender que se pueden sustituir. */
export function buildCityMeshes(layout: CityLayout): CityMeshes {
  const props = new GeometryBuilder()
  const walls = new GeometryBuilder()
  const benches = new GeometryBuilder()
  const fountain = new GeometryBuilder()
  const trees = new GeometryBuilder()
  const lamps = new GeometryBuilder()
  const sidewalks = new GeometryBuilder()
  const lawn = new GeometryBuilder()
  const paths = new GeometryBuilder()
  const sidewalkColor = flatColor('sidewalk')

  // calzada
  props.floor(-WORLD_HALF, -WORLD_HALF, WORLD_HALF, WORLD_HALF, 0, ASPHALT)

  // aceras: un anillo alrededor de cada manzana, con su bordillo
  const y = SIDEWALK_HEIGHT
  for (const cx of BLOCK_CENTERS) {
    for (const cz of BLOCK_CENTERS) {
      const outer = RING_OUTER
      sidewalks.slab(cx - outer, cz - outer, cx + outer, cz - BLOCK_HALF, y, sidewalkColor)
      sidewalks.slab(cx - outer, cz + BLOCK_HALF, cx + outer, cz + outer, y, sidewalkColor)
      sidewalks.slab(cx - outer, cz - BLOCK_HALF, cx - BLOCK_HALF, cz + BLOCK_HALF, y, sidewalkColor)
      sidewalks.slab(cx + BLOCK_HALF, cz - BLOCK_HALF, cx + outer, cz + BLOCK_HALF, y, sidewalkColor)
    }
  }

  // marcas viales: raya discontinua en el centro y pasos de peatones de cebra
  for (const mark of roadMarkings(layout)) props.floor(mark.minX, mark.minZ, mark.maxX, mark.maxZ, MARKING_HEIGHT, MARKING)

  // parque: césped, dos paseos de gravilla que se cruzan en la fuente y un borde de piedra que los separa del césped
  const park = layout.park
  lawn.floor(park.minX, park.minZ, park.maxX, park.maxZ, LAWN_HEIGHT, flatColor('lawn'), true)
  const pathColor = flatColor('path')
  paths.floor(-PATH_HALF_WIDTH, -park.maxZ, PATH_HALF_WIDTH, park.maxZ, PATH_HEIGHT, pathColor, true) // paseo norte-sur
  paths.floor(-park.maxX, -PATH_HALF_WIDTH, park.maxX, PATH_HALF_WIDTH, PATH_HEIGHT, pathColor, true) // paseo este-oeste
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const inner = PATH_HALF_WIDTH + EDGING_WIDTH
      const spans = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)]
      // a lo largo del paseo norte-sur y del este-oeste (este empieza más allá del primero para no solaparse en el cruce)
      const [ax0, ax1] = spans(sx * PATH_HALF_WIDTH, sx * inner)
      const [az0, az1] = spans(sz * PATH_HALF_WIDTH, sz * park.maxZ)
      sidewalks.slab(ax0, az0, ax1, az1, EDGING_HEIGHT, sidewalkColor)
      const [bx0, bx1] = spans(sx * inner, sx * park.maxX)
      const [bz0, bz1] = spans(sz * PATH_HALF_WIDTH, sz * inner)
      sidewalks.slab(bx0, bz0, bx1, bz1, EDGING_HEIGHT, sidewalkColor)
    }
  }
  fountain.box(-1.7, 0, -1.7, 1.7, 0.45, 1.7, 0x9a9a95)
  fountain.floor(-1.45, -1.45, 1.45, 1.45, 0.38, 0x5fa3c4)
  fountain.box(-0.2, 0, -0.2, 0.2, 1.3, 0.2, 0x8c8c88)

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
    lamps.box(lamp.x - 0.06, 0, lamp.z - 0.06, lamp.x + 0.06, 4.5, lamp.z + 0.06, 0x2c2f33)
    lamps.box(lamp.x - 0.3, 4.5, lamp.z - 0.12, lamp.x + 0.3, 4.65, lamp.z + 0.12, 0x2c2f33)
  }

  // árboles
  const canopy = new THREE.IcosahedronGeometry(1, 1)
  const greens = [0x4f8a3c, 0x5c9644, 0x467a36, 0x6aa04a]
  const matrix = new THREE.Matrix4()
  layout.trees.forEach((tree, index) => {
    const s = tree.scale
    trees.box(tree.x - 0.12 * s, 0, tree.z - 0.12 * s, tree.x + 0.12 * s, 2.3 * s, tree.z + 0.12 * s, 0x5a4330)
    matrix.compose(new THREE.Vector3(tree.x, 3.1 * s, tree.z), new THREE.Quaternion(), new THREE.Vector3(1.4 * s, 1.3 * s, 1.4 * s))
    trees.mesh(canopy, matrix, greens[index % greens.length])
  })
  canopy.dispose()

  const texture = makeFacadeTexture()
  const ground = createGroundMaterials()
  const benchGeometry = benches.build()
  const propGeometry = props.build()
  const wallGeometry = walls.build()
  const fountainGeometry = fountain.build()
  const treeGeometry = trees.build()
  const lampGeometry = lamps.build()
  const sidewalkGeometry = sidewalks.build()
  const lawnGeometry = lawn.build()
  const pathGeometry = paths.build()
  const propMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 })
  const wallMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, map: texture, roughness: 0.9, metalness: 0 })

  const group = new THREE.Group()
  const propMesh = new THREE.Mesh(propGeometry, propMaterial)
  const wallMesh = new THREE.Mesh(wallGeometry, wallMaterial)
  const sidewalkMesh = new THREE.Mesh(sidewalkGeometry, ground.sidewalk)
  const lawnMesh = new THREE.Mesh(lawnGeometry, ground.lawn)
  const pathMesh = new THREE.Mesh(pathGeometry, ground.path)
  propMesh.receiveShadow = wallMesh.receiveShadow = true
  propMesh.castShadow = wallMesh.castShadow = true
  sidewalkMesh.receiveShadow = lawnMesh.receiveShadow = pathMesh.receiveShadow = true
  // el bordillo (5 cm) no da una sombra que se vea: no se dibuja otra vez en el mapa de sombras
  const benchMesh = new THREE.Mesh(benchGeometry, propMaterial)
  const fountainMesh = new THREE.Mesh(fountainGeometry, propMaterial)
  const treeMesh = new THREE.Mesh(treeGeometry, propMaterial)
  const lampMesh = new THREE.Mesh(lampGeometry, propMaterial)
  for (const mesh of [benchMesh, fountainMesh, treeMesh, lampMesh]) mesh.castShadow = mesh.receiveShadow = true
  group.add(propMesh, wallMesh, sidewalkMesh, lawnMesh, pathMesh, benchMesh, fountainMesh, treeMesh, lampMesh)

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
    fountainMesh,
    treeMesh,
    lampMesh,
    sidewalkMesh,
    lawnMesh,
    pathMesh,
    ground,
    dispose() {
      benchGeometry.dispose()
      propGeometry.dispose()
      wallGeometry.dispose()
      fountainGeometry.dispose()
      treeGeometry.dispose()
      lampGeometry.dispose()
      sidewalkGeometry.dispose()
      lawnGeometry.dispose()
      pathGeometry.dispose()
      farGround.geometry.dispose()
      ;(farGround.material as THREE.Material).dispose()
      propMaterial.dispose()
      wallMaterial.dispose()
      ground.dispose()
      texture.dispose()
    },
  }
}
