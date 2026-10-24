import * as THREE from 'three'

/**
 * Lo que haría el renderer con un material estándar parcheado: pasa los shaders reales de three.js (con sus includes en
 * el orden de verdad, p. ej. map_fragment antes que color_fragment) por su `onBeforeCompile`.
 */
export function compileStandard(material: THREE.Material) {
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  }
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as never)
  return shader
}

/** Variables `fx…` del código añadido que aparecen antes de su declaración (en GLSL, un error de compilación). */
export function usedBeforeDeclared(source: string): string[] {
  const wrong: string[] = []
  for (const match of source.matchAll(/\b(?:float|int|bool|vec[234]|mat[234])\s+(fx\w+)\s*[=;]/g)) {
    if (source.search(new RegExp(`\\b${match[1]}\\b`)) < match.index) wrong.push(match[1])
  }
  return wrong
}
