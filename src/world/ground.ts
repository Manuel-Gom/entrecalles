import * as THREE from 'three'
import { NOISE_GLSL } from './glsl'

/**
 * El suelo del barrio con aspecto real: losas de hormigón con juntas, césped con franjas de siega y manchas, y gravilla
 * en los paseos. Las texturas (public/textures/suelo/, de ambientCG, CC0) se repiten por metros del mundo; el shader
 * las mezcla a dos escalas para que no se note el mosaico. Mientras cargan (o si fallan) queda el color plano de los vértices.
 */

export type GroundKind = 'sidewalk' | 'lawn' | 'path'

interface GroundStyle {
  /** lado (m) de lo que cubre una repetición de la textura */
  tile: number
  /** nombre base de los archivos: <nombre>_color.webp y <nombre>_normal.webp */
  files: string
  roughness: number
  /** código GLSL tras `color_fragment`: usa vMeters (metros del mundo) y vGroundNormal */
  color: string
  /** cuánto se aclara la textura (la del césped es oscura) */
  gain: number
}

const STYLES: Record<GroundKind, GroundStyle> = {
  sidewalk: {
    tile: 2.4,
    files: 'hormigon',
    roughness: 0.9,
    gain: 1,
    color: /* glsl */ `
      bool fxTop = vGroundNormal.y > 0.5;
      vec2 fxCell = vMeters / 1.2;
      vec2 fxEdge = min(fract(fxCell), 1.0 - fract(fxCell)) * 1.2;
      // losas de 1,2 m; en el canto del bordillo solo hay juntas verticales
      float fxJoint = 1.0 - smoothstep(0.004, 0.012, fxTop ? min(fxEdge.x, fxEdge.y) : fxEdge.x);
      float fxTone = fxHash(floor(vec2(fxCell.x, fxTop ? fxCell.y : 0.0)));
      diffuseColor.rgb *= (0.9 + 0.16 * fxTone) * (0.92 + 0.14 * fxNoise(vMeters * 0.45));
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.4, fxJoint);`,
  },
  lawn: {
    tile: 1.6,
    files: 'cesped',
    roughness: 0.96,
    gain: 1.35,
    color: /* glsl */ `
      float fxPatch = fxBig;
      diffuseColor.rgb *= mix(vec3(0.92, 1.0, 0.9), vec3(1.1, 1.03, 0.82), fxPatch);
      // franjas de siega, muy suaves
      diffuseColor.rgb *= 1.0 + 0.06 * (mod(floor(vMeters.x / 1.7), 2.0) - 0.5);`,
  },
  path: {
    tile: 1.3,
    files: 'gravilla',
    roughness: 0.95,
    gain: 1,
    color: /* glsl */ `
      diffuseColor.rgb *= vec3(0.9, 0.82, 0.68) * (0.9 + 0.2 * fxNoise(vMeters * 0.5));`,
  },
}

const FLAT_COLORS: Record<GroundKind, number> = { sidewalk: 0xb9b6ae, lawn: 0x6f9a52, path: 0xc8b99a }
const BASE = `${import.meta.env.BASE_URL}textures/suelo/`

/** `options.oneSample` se lee al compilar: al cambiarlo hay que marcar el material con needsUpdate (cambia la clave del programa). */
function patch(material: THREE.MeshStandardMaterial, kind: GroundKind, options: { oneSample: boolean }) {
  const style = STYLES[kind]
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMeters;\nvarying vec3 vGroundNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMeters = uv;\nvGroundNormal = normal;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vMeters;\nvarying vec3 vGroundNormal;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${style.color}`)
      // la textura se lee a dos escalas y orientaciones, repartidas por manchas, para que no se vea el mosaico.
      // `fxBig` se declara aquí y fuera del #ifdef: map_fragment va antes que color_fragment, y los dos lo usan
      .replace(
        '#include <map_fragment>',
        `${options.oneSample ? '#define FX_ONE_SAMPLE' : ''}
        float fxBig = fxNoise(vMeters * 0.15);
        #ifdef USE_MAP
          #ifdef FX_ONE_SAMPLE
            vec4 sampledDiffuseColor = texture2D(map, vMapUv);
          #else
            vec2 fxUvB = mat2(0.8, 0.6, -0.6, 0.8) * vMapUv * 1.17 + vec2(0.23, 0.61);
            float fxMix = smoothstep(0.35, 0.65, fxBig);
            vec4 sampledDiffuseColor = mix(texture2D(map, vMapUv), texture2D(map, fxUvB), fxMix);
          #endif
          diffuseColor *= vec4(sampledDiffuseColor.rgb * ${style.gain.toFixed(2)}, sampledDiffuseColor.a);
        #endif`,
      )
  }
  material.customProgramCacheKey = () => `entrecalles-ground-${kind}-v2${options.oneSample ? '-simple' : ''}`
}

/** Calidad del suelo: en baja, sin relieve y con una sola lectura de la textura (se nota el mosaico, pero cuesta la mitad). */
export const GROUND_QUALITY: Record<GroundQuality, { normalMap: boolean; oneSample: boolean; anisotropy: number }> = {
  baja: { normalMap: false, oneSample: true, anisotropy: 2 },
  media: { normalMap: true, oneSample: false, anisotropy: 4 },
  alta: { normalMap: true, oneSample: false, anisotropy: 8 },
}
export type GroundQuality = 'baja' | 'media' | 'alta'

export interface GroundMaterials {
  sidewalk: THREE.MeshStandardMaterial
  lawn: THREE.MeshStandardMaterial
  path: THREE.MeshStandardMaterial
  /** true cuando las texturas ya están puestas */
  readonly textured: boolean
  /** Carga las texturas y las pone; si falla, se queda el color plano. */
  load(isAlive?: () => boolean): Promise<void>
  /** Ajusta el coste del suelo a la calidad; vale antes y después de que lleguen las texturas. */
  setQuality(quality: GroundQuality): void
  dispose(): void
}

export function createGroundMaterials(quality: GroundQuality = 'media'): GroundMaterials {
  const materials = {} as Record<GroundKind, THREE.MeshStandardMaterial>
  const options = {} as Record<GroundKind, { oneSample: boolean }>
  for (const kind of Object.keys(STYLES) as GroundKind[]) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: STYLES[kind].roughness, metalness: 0 })
    options[kind] = { oneSample: false }
    patch(material, kind, options[kind])
    materials[kind] = material
  }
  const textures: THREE.Texture[] = []
  const loaded = new Map<GroundKind, { map: THREE.Texture; normalMap: THREE.Texture }>()
  let textured = false

  /** Pone las texturas con los ajustes de la calidad actual; solo recompila el material si algo cambia. */
  function apply() {
    const settings = GROUND_QUALITY[quality]
    for (const [kind, { map, normalMap }] of loaded) {
      for (const texture of [map, normalMap]) {
        if (texture.anisotropy === settings.anisotropy) continue
        texture.anisotropy = settings.anisotropy
        texture.needsUpdate = true
      }
      const material = materials[kind]
      const relief = settings.normalMap ? normalMap : null
      if (material.map === map && material.normalMap === relief && options[kind].oneSample === settings.oneSample) continue
      material.map = map
      material.normalMap = relief
      options[kind].oneSample = settings.oneSample
      // con textura el color plano de los vértices sobra: el tono lo pone la propia textura
      material.vertexColors = false
      material.color.set(0xffffff)
      material.needsUpdate = true
    }
  }

  async function load(isAlive: () => boolean = () => true) {
    const loader = new THREE.TextureLoader()
    const loadTexture = async (file: string, color: boolean, tile: number) => {
      const texture = await loader.loadAsync(`${BASE}${file}.webp`)
      textures.push(texture)
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping
      texture.repeat.set(1 / tile, 1 / tile)
      texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
      return texture
    }
    const kinds = Object.keys(STYLES) as GroundKind[]
    const results = await Promise.all(
      kinds.map(async (kind) => {
        const { files, tile } = STYLES[kind]
        return { kind, map: await loadTexture(`${files}_color`, true, tile), normalMap: await loadTexture(`${files}_normal`, false, tile) }
      }),
    )
    if (!isAlive()) return
    for (const { kind, map, normalMap } of results) {
      loaded.set(kind, { map, normalMap })
      materials[kind].normalScale.set(0.9, 0.9)
    }
    apply()
    textured = true
  }

  return {
    ...materials,
    get textured() {
      return textured
    },
    load,
    setQuality(next) {
      quality = next
      apply()
    },
    dispose() {
      for (const kind of Object.keys(materials) as GroundKind[]) materials[kind].dispose()
      for (const texture of textures) texture.dispose()
    },
  }
}

/** Color plano de cada superficie, el que se ve hasta que llegan las texturas (y el que usan los vértices). */
export function flatColor(kind: GroundKind): number {
  return FLAT_COLORS[kind]
}
