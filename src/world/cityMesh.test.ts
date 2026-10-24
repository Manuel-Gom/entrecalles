import * as THREE from 'three'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DASH_CLEAR, buildCityMeshes, roadMarkings, type Mark } from './cityMesh'
import { createGroundMaterials, flatColor } from './ground'
import { BLOCK_CENTERS, BLOCK_PITCH, RING_OUTER, ROAD_WIDTH, SIDEWALK_HEIGHT, STREET_CENTERS, generateCity, groundAt } from './layout'
import { POOL_HEIGHT } from './streetLights'
import { compileStandard, usedBeforeDeclared } from '../test/shader'

const layout = generateCity()

// la fachada se pinta en un canvas: aquí basta uno de mentira
beforeAll(() => {
  const context = new Proxy({}, { get: () => () => {}, set: () => true })
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => context }) })
})
afterAll(() => vi.unstubAllGlobals())

function bounds(mesh: THREE.Mesh) {
  mesh.geometry.computeBoundingBox()
  return mesh.geometry.boundingBox!
}

/** Alturas distintas de la cara de arriba (normal hacia +Y) de una malla. */
function topHeights(mesh: THREE.Mesh) {
  const position = mesh.geometry.getAttribute('position')
  const normal = mesh.geometry.getAttribute('normal')
  const heights = new Set<number>()
  for (let i = 0; i < position.count; i++) if (normal.getY(i) > 0.9) heights.add(Number(position.getY(i).toFixed(3)))
  return [...heights].sort((a, b) => a - b)
}

describe('suelo del barrio', () => {
  it('las aceras son losas con bordillo: su cara de arriba está a SIDEWALK_HEIGHT y los cantos bajan hasta la calzada', () => {
    const { sidewalkMesh, dispose } = buildCityMeshes(layout)
    const box = bounds(sidewalkMesh)
    expect(box.min.y).toBe(0)
    expect(topHeights(sidewalkMesh)).toContain(SIDEWALK_HEIGHT)
    // 9 manzanas, 4 lados de acera cada una, y los bordes de piedra del parque
    const edge = RING_OUTER + BLOCK_CENTERS[BLOCK_CENTERS.length - 1]
    expect(box.max.x).toBeCloseTo(edge)
    expect(box.min.x).toBeCloseTo(-edge)
    dispose()
  })

  it('el césped, los paseos y la acera se escalonan sin tocarse: césped < paseo < acera < borde de piedra', () => {
    const { lawnMesh, pathMesh, sidewalkMesh, dispose } = buildCityMeshes(layout)
    const [lawn] = topHeights(lawnMesh)
    const [path] = topHeights(pathMesh)
    const [sidewalk, edging] = topHeights(sidewalkMesh)
    expect(sidewalk).toBe(SIDEWALK_HEIGHT)
    expect(lawn).toBeLessThan(path)
    expect(path).toBeLessThan(sidewalk)
    expect(sidewalk).toBeLessThan(edging)
    dispose()
  })

  it('el césped y los paseos ocupan exactamente el parque', () => {
    const { lawnMesh, pathMesh, dispose } = buildCityMeshes(layout)
    const { park } = layout
    const lawn = bounds(lawnMesh)
    expect([lawn.min.x, lawn.max.x, lawn.min.z, lawn.max.z]).toEqual([park.minX, park.maxX, park.minZ, park.maxZ])
    const path = bounds(pathMesh)
    expect(path.min.x).toBe(park.minX)
    expect(path.max.z).toBe(park.maxZ)
    dispose()
  })

  it('las coordenadas de textura del suelo son metros del mundo', () => {
    const { lawnMesh, dispose } = buildCityMeshes(layout)
    const position = lawnMesh.geometry.getAttribute('position')
    const uv = lawnMesh.geometry.getAttribute('uv')
    for (let i = 0; i < position.count; i++) {
      expect(uv.getX(i)).toBeCloseTo(position.getX(i))
      expect(uv.getY(i)).toBeCloseTo(position.getZ(i))
    }
    dispose()
  })

  it('en los cantos del bordillo, la v es la altura', () => {
    const { sidewalkMesh, dispose } = buildCityMeshes(layout)
    const position = sidewalkMesh.geometry.getAttribute('position')
    const normal = sidewalkMesh.geometry.getAttribute('normal')
    const uv = sidewalkMesh.geometry.getAttribute('uv')
    let sides = 0
    for (let i = 0; i < position.count; i++) {
      if (Math.abs(normal.getY(i)) > 0.5) continue
      sides++
      expect(uv.getY(i)).toBeCloseTo(position.getY(i))
    }
    expect(sides).toBeGreaterThan(0)
    dispose()
  })

  it('el charco de luz de las farolas queda por encima de todo el suelo', () => {
    const { sidewalkMesh, dispose } = buildCityMeshes(layout)
    expect(POOL_HEIGHT).toBeGreaterThan(Math.max(...topHeights(sidewalkMesh)))
    dispose()
  })

  it('cada superficie del suelo tiene su material, y liberarlo no falla', () => {
    const city = buildCityMeshes(layout)
    expect(city.sidewalkMesh.material).toBe(city.ground.sidewalk)
    expect(city.lawnMesh.material).toBe(city.ground.lawn)
    expect(city.pathMesh.material).toBe(city.ground.path)
    expect(city.ground.textured).toBe(false)
    expect(() => city.dispose()).not.toThrow()
  })
})

describe('marcas viales', () => {
  const marks = roadMarkings(layout)
  const zebras = marks.length - roadMarkings({ crossings: [] }).length
  const overlap = (a: Mark, b: Mark) => Math.min(a.maxX, b.maxX) > Math.max(a.minX, b.minX) + 1e-9 && Math.min(a.maxZ, b.maxZ) > Math.max(a.minZ, b.minZ) + 1e-9

  it('todas están sobre la calzada, nunca sobre la acera ni el parque', () => {
    for (const mark of marks) {
      for (const [x, z] of [[mark.minX, mark.minZ], [mark.maxX, mark.maxZ], [mark.minX, mark.maxZ], [mark.maxX, mark.minZ]]) {
        expect(groundAt(x, z), `marca en (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe('calzada')
      }
    }
  })

  it('ninguna se pisa con otra: ni cebras entre sí ni la raya central con una cebra', () => {
    for (let i = 0; i < marks.length; i++) {
      for (let j = i + 1; j < marks.length; j++) expect(overlap(marks[i], marks[j]), `marcas ${i} y ${j}`).toBe(false)
    }
  })

  it('cada cebra tiene 7 bandas paralelas a la calzada que van de bordillo a bordillo', () => {
    expect(zebras).toBe(layout.crossings.length * 7)
    layout.crossings.forEach((crossing, index) => {
      const bands = marks.slice(marks.length - zebras).slice(index * 7, index * 7 + 7)
      for (const band of bands) {
        const [across, along] = crossing.alongX ? [band.maxX - band.minX, band.maxZ - band.minZ] : [band.maxZ - band.minZ, band.maxX - band.minX]
        // la banda es larga en el sentido de la calle y estrecha en el del cruce
        expect(along).toBeGreaterThan(across * 4)
      }
      const reach = crossing.alongX
        ? [Math.min(...bands.map((b) => b.minX)) - crossing.x, Math.max(...bands.map((b) => b.maxX)) - crossing.x]
        : [Math.min(...bands.map((b) => b.minZ)) - crossing.z, Math.max(...bands.map((b) => b.maxZ)) - crossing.z]
      expect(reach[0]).toBeCloseTo(-reach[1])
      // de bordillo a bordillo, con menos de 1 m libre a cada lado
      expect(reach[1]).toBeGreaterThan(ROAD_WIDTH / 2 - 1)
    })
  })

  it('la raya central no entra en las intersecciones y sigue entre ellas', () => {
    const dashes = marks.slice(0, marks.length - zebras)
    expect(dashes.length).toBeGreaterThan(40)
    for (const dash of dashes) {
      const alongZ = dash.maxZ - dash.minZ > dash.maxX - dash.minX
      const [from, to] = alongZ ? [dash.minZ, dash.maxZ] : [dash.minX, dash.maxX]
      for (const k of STREET_CENTERS) expect(Math.min(Math.abs(from - k), Math.abs(to - k), from < k && to > k ? 0 : Infinity)).toBeGreaterThanOrEqual(DASH_CLEAR - 1e-9)
    }
    // entre dos manzanas, a media calle, sí hay raya
    expect(dashes.some((d) => d.minX < BLOCK_PITCH / 2 && d.maxX > BLOCK_PITCH / 2 && d.minZ < 2 && d.maxZ > -2)).toBe(true)
  })
})

describe('materiales del suelo', () => {
  afterEach(() => vi.restoreAllMocks())

  it('hasta que llegan las texturas se ve el color plano de los vértices', () => {
    const ground = createGroundMaterials()
    for (const material of [ground.sidewalk, ground.lawn, ground.path]) {
      expect(material.vertexColors).toBe(true)
      expect(material.map).toBeNull()
    }
    expect([flatColor('sidewalk'), flatColor('lawn'), flatColor('path')]).toEqual([0xb9b6ae, 0x6f9a52, 0xc8b99a])
    ground.dispose()
  })

  it('los shaders del suelo leen los metros del mundo y mezclan la textura a dos escalas', () => {
    const ground = createGroundMaterials()
    for (const material of [ground.sidewalk, ground.lawn, ground.path]) {
      const shader = compileStandard(material)
      expect(shader.vertexShader).toContain('vMeters = uv')
      expect(shader.fragmentShader).toContain('fxUvB')
      expect(shader.fragmentShader).not.toContain('#include <map_fragment>')
      // en three.js la textura (map_fragment) se lee antes que el color (color_fragment): todo lo que usan los dos
      // tiene que estar declarado antes, o el shader no compila al llegar las texturas y el suelo desaparece
      expect(usedBeforeDeclared(shader.fragmentShader)).toEqual([])
    }
    const keys = [ground.sidewalk, ground.lawn, ground.path].map((m) => m.customProgramCacheKey())
    expect(new Set(keys).size).toBe(3)
    ground.dispose()
  })

  it('al cargar, se ponen mapa de color y de normales, repetidos por metros, y se quita el color de vértices', async () => {
    const urls: string[] = []
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async (url: string) => {
      urls.push(url)
      return new THREE.Texture()
    })
    const ground = createGroundMaterials()
    await ground.load()
    expect(ground.textured).toBe(true)
    expect(urls).toHaveLength(6)
    expect(urls.every((url) => url.endsWith('.webp') && url.includes('textures/suelo/'))).toBe(true)
    const tiles = new Map([[ground.sidewalk, 2.4], [ground.lawn, 1.6], [ground.path, 1.3]])
    for (const material of [ground.sidewalk, ground.lawn, ground.path]) {
      expect(material.vertexColors).toBe(false)
      expect(material.map).not.toBeNull()
      expect(material.normalMap).not.toBeNull()
      expect(material.map!.colorSpace).toBe(THREE.SRGBColorSpace)
      expect(material.normalMap!.colorSpace).toBe(THREE.NoColorSpace)
      expect(material.map!.wrapS).toBe(THREE.RepeatWrapping)
      // una repetición cubre unos metros: la hierba, más fina que las losas
      expect(material.map!.repeat.x).toBeCloseTo(1 / tiles.get(material)!, 5)
      expect(material.normalMap!.repeat.x).toBeCloseTo(material.map!.repeat.x, 5)
    }
    ground.dispose()
  })

  it('en calidad baja el suelo no lleva relieve y lee la textura una sola vez; al subir la calidad, vuelve todo', async () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new THREE.Texture())
    const ground = createGroundMaterials('baja')
    await ground.load()
    const materials = [ground.sidewalk, ground.lawn, ground.path]
    for (const material of materials) {
      expect(material.map).not.toBeNull()
      expect(material.normalMap).toBeNull()
      expect(material.customProgramCacheKey()).toContain('simple')
      expect(compileStandard(material).fragmentShader).toContain('#define FX_ONE_SAMPLE')
      expect(material.map!.anisotropy).toBe(2)
    }
    const versions = materials.map((m) => m.version)
    ground.setQuality('alta')
    materials.forEach((material, index) => {
      expect(material.normalMap).not.toBeNull()
      expect(material.customProgramCacheKey()).not.toContain('simple')
      expect(compileStandard(material).fragmentShader).not.toContain('#define FX_ONE_SAMPLE')
      expect(material.map!.anisotropy).toBe(8)
      expect(material.normalMap!.anisotropy).toBe(8)
      expect(material.version).toBeGreaterThan(versions[index]) // se recompila
    })
    // repetir la misma calidad no recompila
    const again = materials.map((m) => m.version)
    ground.setQuality('alta')
    expect(materials.map((m) => m.version)).toEqual(again)
    ground.dispose()
  })

  it('la calidad se puede cambiar antes de que lleguen las texturas', async () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new THREE.Texture())
    const ground = createGroundMaterials()
    ground.setQuality('baja')
    expect(ground.lawn.map).toBeNull()
    await ground.load()
    expect(ground.lawn.normalMap).toBeNull()
    expect(ground.lawn.map!.anisotropy).toBe(2)
    ground.dispose()
  })

  it('si una textura falla, el suelo se queda con el color plano', async () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockRejectedValue(new Error('404'))
    const ground = createGroundMaterials()
    await expect(ground.load()).rejects.toThrow('404')
    expect(ground.textured).toBe(false)
    expect(ground.lawn.vertexColors).toBe(true)
    expect(ground.lawn.map).toBeNull()
    ground.dispose()
  })

  it('si el mundo ya se cerró, las texturas no se aplican', async () => {
    vi.spyOn(THREE.TextureLoader.prototype, 'loadAsync').mockImplementation(async () => new THREE.Texture())
    const ground = createGroundMaterials()
    await ground.load(() => false)
    expect(ground.textured).toBe(false)
    expect(ground.lawn.map).toBeNull()
    ground.dispose()
  })
})
