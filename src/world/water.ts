import * as THREE from 'three'

export interface AnimatedWater {
  material: THREE.MeshStandardMaterial
  update(time: number): void
}

/** Añade reflejos y ondas ligeras al material, sin una simulación de fluidos. */
export function animateWater(material: THREE.MeshStandardMaterial): AnimatedWater {
  const timeUniform = { value: 0 }
  material.color.set(0x75b6c6)
  material.roughness = 0.2
  material.metalness = 0.12
  material.transparent = true
  material.opacity = 0.82
  material.depthWrite = false
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = timeUniform
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      '#include <common>\nuniform float uWaterTime;',
    )
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float ripple = sin(gl_FragCoord.x * 0.035 + uWaterTime * 1.3) * cos(gl_FragCoord.y * 0.05 - uWaterTime * 1.7);
      float glint = smoothstep(0.72, 0.96, ripple);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.56, 0.86, 0.92), glint * 0.34);
      diffuseColor.rgb += glint * 0.09;`,
    )
  }
  material.customProgramCacheKey = () => 'entrecalles-fountain-water-v1'
  material.needsUpdate = true

  return {
    material,
    update(time) {
      timeUniform.value = time
    },
  }
}
