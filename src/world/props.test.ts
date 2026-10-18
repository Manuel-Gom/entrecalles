import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { extractProp, instanceProp, markerFromMatrix, placementMatrix, worldBox } from './props'

/** Un modelo inventado con una malla y los vacíos de datos que espera el código. */
function sampleModel() {
  const root = new THREE.Group()
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
  mesh.name = 'cuerpo'
  mesh.position.set(0, 0.5, 0)
  root.add(mesh)
  const empty = (name: string, x: number, y: number, z: number, scale = new THREE.Vector3(1, 1, 1), yaw = 0) => {
    const node = new THREE.Object3D()
    node.name = name
    node.position.set(x, y, z)
    node.scale.copy(scale)
    node.rotation.y = yaw
    root.add(node)
    return node
  }
  empty('COL_caja', 0, 0.5, 0, new THREE.Vector3(0.8, 0.5, 0.25))
  empty('SEAT_0', -0.4, 0.46, 0)
  empty('SEAT_giro', 0.4, 0.46, 0, undefined, Math.PI / 2)
  empty('LUZ_0', 0, 2.4, 1)
  empty('ENTRADA', 0, 0, 1.6)
  empty('SALIDA', 0, 0, 0.35)
  empty('PUERTA_CENTRO', 1.4, 0, -0.1)
  const leaf = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.05), new THREE.MeshStandardMaterial())
  leaf.name = 'PUERTA_HOJA'
  root.add(leaf)
  return root
}

describe('extractProp', () => {
  const prop = extractProp(sampleModel())

  it('separa cada tipo de vacío', () => {
    expect(prop.colliders.map((c) => c.name)).toEqual(['COL_caja'])
    expect(prop.seats.map((c) => c.name)).toEqual(['SEAT_0', 'SEAT_giro'])
    expect(prop.lights.map((c) => c.name)).toEqual(['LUZ_0'])
    expect([...prop.markers.keys()].sort()).toEqual(['ENTRADA', 'PUERTA_CENTRO', 'SALIDA'])
  })

  it('quita los vacíos del modelo para que no estorben al dibujar', () => {
    const names: string[] = []
    prop.root.traverse((node) => names.push(node.name))
    expect(names.filter((name) => /^(COL_|SEAT_|LUZ_|ENTRADA|SALIDA|PUERTA_CENTRO)/.test(name))).toEqual([])
    expect(names).toContain('cuerpo')
  })

  it('encuentra la hoja de la puerta sin quitarla', () => {
    expect(prop.door?.name).toBe('PUERTA_HOJA')
    expect(prop.door?.parent).toBe(prop.root)
  })

  it('guarda dónde está cada marcador', () => {
    expect(prop.seats[0].position.toArray()).toEqual([-0.4, 0.46, 0])
    expect(prop.markers.get('ENTRADA')?.position.z).toBeCloseTo(1.6)
  })

  it('un nodo de nombre repetido con sufijo numérico (COL_mesa001) también cuenta', () => {
    const root = new THREE.Group()
    for (const name of ['COL_mesa', 'COL_mesa001']) {
      const node = new THREE.Object3D()
      node.name = name
      root.add(node)
    }
    expect(extractProp(root).colliders).toHaveLength(2)
  })
})

describe('markerFromMatrix', () => {
  it('saca la posición y hacia dónde mira (yaw) de una transformación', () => {
    const marker = markerFromMatrix('x', placementMatrix(2, 1, 3, Math.PI / 2))
    expect(marker.position.toArray()).toEqual([2, 1, 3])
    expect(marker.yaw).toBeCloseTo(Math.PI / 2)
    expect(markerFromMatrix('x', placementMatrix(0, 0, 0, Math.PI)).yaw).toBeCloseTo(Math.PI)
    expect(markerFromMatrix('x', placementMatrix(0, 0, 0, 0)).yaw).toBeCloseTo(0)
  })
})

describe('worldBox', () => {
  const [collider] = extractProp(sampleModel()).colliders

  it('la escala del vacío es la mitad del tamaño de la caja', () => {
    const { box, minY, maxY } = worldBox(collider, new THREE.Matrix4())
    expect(box).toEqual({ minX: -0.8, maxX: 0.8, minZ: -0.25, maxZ: 0.25 })
    expect(minY).toBeCloseTo(0)
    expect(maxY).toBeCloseTo(1)
  })

  it('al colocar el modelo girado y desplazado, la caja gira y se desplaza con él', () => {
    const { box } = worldBox(collider, placementMatrix(10, 0, 20, Math.PI / 2))
    expect(box.maxX - box.minX).toBeCloseTo(0.5)
    expect(box.maxZ - box.minZ).toBeCloseTo(1.6)
    expect((box.minX + box.maxX) / 2).toBeCloseTo(10)
    expect((box.minZ + box.maxZ) / 2).toBeCloseTo(20)
  })

  it('un giro que no es múltiplo de 90° da la caja que envuelve a la girada', () => {
    const { box } = worldBox(collider, placementMatrix(0, 0, 0, Math.PI / 4))
    expect(box.maxX - box.minX).toBeCloseTo((1.6 + 0.5) * Math.SQRT1_2, 6)
  })
})

describe('placementMatrix', () => {
  it('coloca un punto del modelo: con yaw π, lo de delante (+Z) queda detrás', () => {
    const point = new THREE.Vector3(0, 0, 1).applyMatrix4(placementMatrix(5, 0, 5, Math.PI))
    expect(point.x).toBeCloseTo(5)
    expect(point.z).toBeCloseTo(4)
  })
})

describe('instanceProp', () => {
  it('dibuja el modelo muchas veces con una malla instanciada por cada malla del modelo', () => {
    const prop = extractProp(sampleModel())
    const placements = [placementMatrix(0, 0, 0, 0), placementMatrix(5, 0, 0, Math.PI / 2), placementMatrix(0, 0, 9, 0)]
    const group = instanceProp(prop, placements)
    const meshes = group.children as THREE.InstancedMesh[]
    expect(meshes).toHaveLength(2) // el cuerpo y la hoja
    for (const mesh of meshes) expect(mesh.count).toBe(3)
    // la segunda instancia del cuerpo está 5 m a un lado
    const matrix = new THREE.Matrix4()
    meshes[0].getMatrixAt(1, matrix)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).x).toBeCloseTo(5)
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).y).toBeCloseTo(0.5)
  })
})
