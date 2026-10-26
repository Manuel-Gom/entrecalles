import * as THREE from 'three'
import { NOISE_GLSL } from './glsl'

/**
 * Materiales de lo que el código construye dentro de los edificios (suelos, paredes, techos, rodapiés y barandillas). El
 * dibujo de cada acabado (tablas de parqué, baldosas, azulejos, terrazo) lo hace el shader a partir de los metros del
 * mundo, que van en las coordenadas de textura: no hay imágenes. El color base viene de los vértices.
 */
export type InteriorSurface = 'parquet' | 'baldosa' | 'terrazo' | 'cubierta' | 'pintura' | 'azulejo' | 'madera' | 'metal'

const PATTERNS: Partial<Record<InteriorSurface, string>> = {
  // tablas de 14 cm × 1,1 m, a tresbolillo, con veta y tono propio cada una
  parquet: /* glsl */ `
    float fxRow = floor(vMeters.y / 0.14);
    float fxShift = fxHash(vec2(fxRow, 3.1)) * 1.1;
    float fxAlong = vMeters.x + fxShift;
    float fxCol = floor(fxAlong / 1.1);
    vec2 fxIn = vec2(fract(fxAlong / 1.1) * 1.1, fract(vMeters.y / 0.14) * 0.14);
    float fxEdge = min(min(fxIn.x, 1.1 - fxIn.x), min(fxIn.y, 0.14 - fxIn.y));
    float fxJoint = 1.0 - smoothstep(0.0015, 0.005, fxEdge);
    float fxTone = fxHash(vec2(fxCol, fxRow));
    float fxGrain = fxNoise(vec2(vMeters.x * 2.0, vMeters.y * 45.0 + fxTone * 9.0));
    diffuseColor.rgb *= (0.84 + 0.28 * fxTone) * (0.88 + 0.2 * fxGrain);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.45, fxJoint);`,
  // gres de 33 cm con junta clara
  baldosa: /* glsl */ `
    vec2 fxCell = vMeters / 0.33;
    vec2 fxEdge = min(fract(fxCell), 1.0 - fract(fxCell)) * 0.33;
    float fxJoint = 1.0 - smoothstep(0.0015, 0.004, min(fxEdge.x, fxEdge.y));
    diffuseColor.rgb *= 0.94 + 0.09 * fxHash(floor(fxCell));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.66, 0.65, 0.62), fxJoint);`,
  // terrazo: grano de mármol sobre losas de 40 cm
  terrazo: /* glsl */ `
    vec2 fxCell = vMeters / 0.4;
    vec2 fxEdge = min(fract(fxCell), 1.0 - fract(fxCell)) * 0.4;
    float fxJoint = 1.0 - smoothstep(0.001, 0.003, min(fxEdge.x, fxEdge.y));
    float fxChip = step(0.82, fxHash(floor(vMeters * 70.0)));
    float fxDark = step(0.9, fxHash(floor(vMeters * 55.0) + 7.0));
    diffuseColor.rgb *= 0.95 + 0.08 * fxNoise(vMeters * 3.0);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.93, 0.88), fxChip * 0.6);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.55, fxDark * 0.7);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.75, fxJoint);`,
  // baldosín de azotea de 25 cm, con manchas
  cubierta: /* glsl */ `
    vec2 fxCell = vMeters / 0.25;
    vec2 fxEdge = min(fract(fxCell), 1.0 - fract(fxCell)) * 0.25;
    float fxJoint = 1.0 - smoothstep(0.003, 0.008, min(fxEdge.x, fxEdge.y));
    diffuseColor.rgb *= (0.86 + 0.18 * fxHash(floor(fxCell))) * (0.85 + 0.2 * fxNoise(vMeters * 0.7));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.53, 0.5), fxJoint);`,
  // azulejo de 20 cm con junta blanca (en las paredes: x = a lo largo, y = altura)
  azulejo: /* glsl */ `
    vec2 fxCell = vMeters / 0.2;
    vec2 fxEdge = min(fract(fxCell), 1.0 - fract(fxCell)) * 0.2;
    float fxJoint = 1.0 - smoothstep(0.001, 0.003, min(fxEdge.x, fxEdge.y));
    diffuseColor.rgb *= 0.97 + 0.05 * fxHash(floor(fxCell));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93), fxJoint);`,
  // pintura plástica: casi lisa, con un leve gotelé
  pintura: /* glsl */ `
    diffuseColor.rgb *= 0.975 + 0.035 * fxNoise(vMeters * 9.0) + 0.02 * fxNoise(vMeters * 0.6);`,
}

const ROUGHNESS: Record<InteriorSurface, number> = {
  parquet: 0.55, baldosa: 0.35, terrazo: 0.4, cubierta: 0.9, pintura: 0.92, azulejo: 0.18, madera: 0.6, metal: 0.45,
}

function patch(material: THREE.MeshStandardMaterial, surface: InteriorSurface) {
  const pattern = PATTERNS[surface]
  if (!pattern) return
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMeters;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMeters = uv;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vMeters;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${pattern}`)
  }
  material.customProgramCacheKey = () => `entrecalles-interior-${surface}-v1`
}

export type InteriorMaterials = Record<InteriorSurface, THREE.MeshStandardMaterial> & { dispose(): void }

export function createInteriorMaterials(): InteriorMaterials {
  const materials = {} as Record<InteriorSurface, THREE.MeshStandardMaterial>
  for (const surface of Object.keys(ROUGHNESS) as InteriorSurface[]) {
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: ROUGHNESS[surface], metalness: surface === 'metal' ? 0.6 : 0 })
    patch(material, surface)
    materials[surface] = material
  }
  return {
    ...materials,
    dispose() {
      for (const material of Object.values(materials)) material.dispose()
    },
  }
}

/** Color base de cada acabado de suelo. */
export const FLOOR_COLORS = { parquet: 0xb08158, baldosa: 0xd9d3c7, terrazo: 0xcfc8bb, cubierta: 0xb26f52 } as const
