import * as THREE from 'three'
import { NOISE_GLSL } from './glsl'

export interface AnimatedWater {
  /** `time` en segundos; `sky` es el color del cielo (lo que refleja el agua) y `daylight` va de 0 (noche) a 1 (día). */
  update(time: number, sky: THREE.Color, daylight: number): void
}

/**
 * Alturas (m) de las tres láminas de agua de la fuente y radios de su borde. Salen de tools/blender/crear_props.py:
 * el shader las usa para saber en qué taza está cada punto (espuma en el borde, dónde cae la cascada, etc.).
 */
export const FOUNTAIN_LEVELS = { lower: 0.4, middle: 1.32, top: 1.65 } as const
export const FOUNTAIN_RADII = { lower: 1.4, middle: 0.655, top: 0.265 } as const
/** Radios (m) donde cae el agua: la cascada de la taza de arriba en cada lámina y el anillo de arcos de la taza media. */
export const FOUNTAIN_FALLS = { lower: 0.83, middle: 0.365, arcs: 0.58 } as const

const NOISE = NOISE_GLSL

/** Valores compartidos por todos los materiales de la fuente: el tiempo y el cielo que refleja. */
interface FxUniforms {
  uFxTime: { value: number }
  uFxSky: { value: THREE.Color }
  uFxDay: { value: number }
}

function makeUniforms(): FxUniforms {
  return { uFxTime: { value: 0 }, uFxSky: { value: new THREE.Color(0x9fc3e8) }, uFxDay: { value: 1 } }
}

function setFx(uniforms: FxUniforms, time: number, sky: THREE.Color, daylight: number) {
  uniforms.uFxTime.value = time
  uniforms.uFxSky.value.copy(sky)
  uniforms.uFxDay.value = daylight
}

interface ShaderEdit {
  /** tras `color_fragment` */
  color?: string
  /** tras `roughnessmap_fragment` */
  roughness?: string
  /** tras `normal_fragment_maps` */
  normal?: string
  /** justo antes de `opaque_fragment` */
  output?: string
}

/** Pasa la posición local (la del modelo, sin instanciar) al fragmento y mete los fragmentos de código de `edit`. */
function patch(material: THREE.MeshStandardMaterial, key: string, uniforms: FxUniforms, edit: ShaderEdit) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFxTime = uniforms.uFxTime
    shader.uniforms.uFxSky = uniforms.uFxSky
    shader.uniforms.uFxDay = uniforms.uFxDay
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFxPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFxPos = position;')
    let fragment = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>\nvarying vec3 vFxPos;\nuniform float uFxTime;\nuniform vec3 uFxSky;\nuniform float uFxDay;\n${NOISE}`,
    )
    if (edit.color) fragment = fragment.replace('#include <color_fragment>', `#include <color_fragment>\n${edit.color}`)
    if (edit.roughness) fragment = fragment.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${edit.roughness}`)
    if (edit.normal) fragment = fragment.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${edit.normal}`)
    if (edit.output) fragment = fragment.replace('#include <opaque_fragment>', `${edit.output}\n#include <opaque_fragment>`)
    shader.fragmentShader = fragment
  }
  material.customProgramCacheKey = () => key
  material.needsUpdate = true
}

/** Agua: ondas que se mueven, reflejo del cielo según el ángulo, más fondo en el centro, espuma y círculos donde cae la cascada. */
function animateWater(material: THREE.MeshStandardMaterial, uniforms: FxUniforms) {
  material.color.set(0x75b6c6)
  material.roughness = 0.1
  material.metalness = 0
  material.transparent = true
  material.opacity = 1
  material.depthWrite = false
  const split = (a: number, b: number) => ((a + b) / 2).toFixed(2)
  patch(material, 'entrecalles-fountain-water-v2', uniforms, {
    color: /* glsl */ `
      vec2 fxP = vFxPos.xz;
      float fxR = length(fxP);
      float fxLevel = vFxPos.y;
      bool fxLower = fxLevel < ${split(FOUNTAIN_LEVELS.lower, FOUNTAIN_LEVELS.middle)};
      bool fxTop = fxLevel > ${split(FOUNTAIN_LEVELS.middle, FOUNTAIN_LEVELS.top)};
      float fxRadius = fxLower ? ${FOUNTAIN_RADII.lower.toFixed(3)} : (fxTop ? ${FOUNTAIN_RADII.top.toFixed(3)} : ${FOUNTAIN_RADII.middle.toFixed(3)});
      float fxRim = clamp(fxR / fxRadius, 0.0, 1.0);
      // dónde cae la cascada de la taza de arriba (y los arcos), en cada lámina
      float fxFall = fxLower ? ${FOUNTAIN_FALLS.lower.toFixed(3)} : (fxTop ? -1.0 : ${FOUNTAIN_FALLS.middle.toFixed(3)});
      float fxArcs = (!fxLower && !fxTop) ? ${FOUNTAIN_FALLS.arcs.toFixed(3)} : -1.0;
      float fxNearFall = max(1.0 - smoothstep(0.0, 0.1, abs(fxR - fxFall)), (1.0 - smoothstep(0.0, 0.07, abs(fxR - fxArcs))) * 0.6);
      float fxDeep = smoothstep(1.0, 0.1, fxRim);
      diffuseColor.rgb = mix(vec3(0.075, 0.30, 0.36), vec3(0.008, 0.07, 0.10), fxDeep);
      diffuseColor.a = mix(0.32, 0.86, fxDeep);

      vec2 fxDir = fxP / max(fxR, 0.001);
      float fxRing = cos(fxR * 26.0 - uFxTime * 2.6) * exp(-abs(fxR - fxFall) * 3.0);
      vec2 fxGrad = vec2(0.8, 0.6) * cos(dot(fxP, vec2(0.8, 0.6)) * 9.0 + uFxTime * 1.3) * 0.030
        + vec2(-0.5, 0.85) * cos(dot(fxP, vec2(-0.5, 0.85)) * 14.0 - uFxTime * 1.7) * 0.022
        + vec2(0.2, -0.98) * cos(dot(fxP, vec2(0.2, -0.98)) * 23.0 + uFxTime * 2.3) * 0.014
        + fxDir * fxRing * 0.03 * fxNearFall
        + (vec2(fxNoise(fxP * 32.0 + uFxTime * 2.0), fxNoise(fxP * 32.0 - uFxTime * 1.7 + 7.0)) - 0.5) * 0.07 * fxNearFall;

      float fxFoam = smoothstep(0.93, 1.0, fxRim) * (0.55 + 0.45 * fxNoise(fxP * 20.0 + uFxTime * 0.4));
      fxFoam += fxNearFall * smoothstep(0.35, 0.75, fxNoise(fxP * 26.0 + vec2(uFxTime * 0.9, -uFxTime * 0.6)));
      fxFoam = clamp(fxFoam, 0.0, 1.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.95, 0.95), fxFoam * 0.8);
      diffuseColor.a = mix(diffuseColor.a, 0.95, fxFoam);`,
    normal: /* glsl */ `
      normal = normalize(normal + (viewMatrix * vec4(-fxGrad.x, 0.0, -fxGrad.y, 0.0)).xyz);`,
    output: /* glsl */ `
      float fxCos = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
      float fxFresnel = 0.03 + 0.97 * pow(1.0 - fxCos, 5.0);
      outgoingLight = mix(outgoingLight, uFxSky * (0.3 + 0.7 * uFxDay), fxFresnel * 0.9);
      diffuseColor.a = clamp(max(diffuseColor.a, fxFresnel), 0.0, 1.0);`,
  })
}

/** Cortinas y chorros: hilos de agua que bajan y se cortan, sin una simulación de fluidos. */
function animateJets(material: THREE.MeshStandardMaterial, uniforms: FxUniforms) {
  material.color.set(0xeaf7fb)
  material.transparent = true
  material.opacity = 1
  material.depthWrite = false
  patch(material, 'entrecalles-fountain-jets-v1', uniforms, {
    color: /* glsl */ `
      float fxAngle = atan(vFxPos.z, vFxPos.x);
      float fxStream = fxNoise(vec2(fxAngle * 26.0, vFxPos.y * 5.0 + uFxTime * 3.2));
      float fxStreak = fxNoise(vec2(fxAngle * 60.0 + vFxPos.y * 2.0, vFxPos.y * 11.0 + uFxTime * 6.0));
      diffuseColor.a = clamp(0.12 + 1.1 * fxStream * fxStreak, 0.0, 0.8);`,
  })
}

/** La piedra de la fuente: manchas, humedad y algas bajo la línea del agua y churretones bajo los bordes. */
function weatherStone(material: THREE.MeshStandardMaterial, uniforms: FxUniforms) {
  const line = FOUNTAIN_LEVELS.lower
  patch(material, 'entrecalles-fountain-stone-v1', uniforms, {
    color: /* glsl */ `
      float fxStone = fxNoise(vFxPos.xz * 7.0 + vFxPos.y * 3.0) * 0.5 + fxNoise(vFxPos.xz * 23.0 + vFxPos.y * 11.0) * 0.5;
      diffuseColor.rgb *= 0.84 + 0.3 * fxStone;
      float fxAng = atan(vFxPos.z, vFxPos.x);
      float fxStain = smoothstep(0.55, 0.95, fxNoise(vec2(fxAng * 18.0, vFxPos.y * 1.4)));
      diffuseColor.rgb *= 1.0 - 0.22 * fxStain;
      float fxWet = (1.0 - smoothstep(${(line - 0.12).toFixed(2)}, ${(line + 0.03).toFixed(2)}, vFxPos.y)) * smoothstep(0.1, 0.9, fxStone + 0.25);
      diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb * 0.7, vec3(0.13, 0.2, 0.08), 0.55), fxWet);`,
    roughness: /* glsl */ `
      roughnessFactor = mix(roughnessFactor, 0.32, fxWet);`,
  })
}

/**
 * Viste la fuente con sus efectos según el nombre de cada material del modelo (AguaFuente, ChorroFuente, PiedraFuente,
 * PiedraClara). Devuelve null si el modelo no trae agua.
 */
export function dressFountain(root: THREE.Object3D): AnimatedWater | null {
  const uniforms = makeUniforms()
  let water = false
  root.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      if (material.name === 'AguaFuente') {
        animateWater(material, uniforms)
        water = true
      } else if (material.name === 'ChorroFuente') animateJets(material, uniforms)
      else if (material.name === 'PiedraFuente' || material.name === 'PiedraClara') weatherStone(material, uniforms)
    }
  })
  return water ? { update: (time, sky, daylight) => setFx(uniforms, time, sky, daylight) } : null
}

/** El agua no da sombra: la lámina transparente se dibujaría como si fuera de piedra sobre el fondo del pilón. */
export function skipWaterShadows(group: THREE.Object3D) {
  group.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.some((material) => material.name === 'AguaFuente' || material.name === 'ChorroFuente')) mesh.castShadow = false
  })
}
