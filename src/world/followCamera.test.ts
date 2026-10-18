import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { boxAt } from './collision'
import { FollowCamera } from './followCamera'

const target = new THREE.Vector3(0, 0, 0)
const place = (camera: FollowCamera, blockers: { box: ReturnType<typeof boxAt>; height: number }[] = [], instant = true) => {
  const threeCamera = new THREE.PerspectiveCamera()
  camera.update(threeCamera, target, blockers, 1 / 60, instant)
  return threeCamera
}

describe('FollowCamera', () => {
  it('con yaw 0 se coloca detrás (en +z), a la distancia pedida y por encima de la cabeza', () => {
    const camera = new FollowCamera(0)
    camera.pitch = 0.3
    camera.distance = 5
    const c = place(camera)
    expect(c.position.z).toBeGreaterThan(4)
    expect(Math.abs(c.position.x)).toBeLessThan(1e-9)
    expect(c.position.y).toBeGreaterThan(1.45)
    expect(c.position.distanceTo(new THREE.Vector3(0, 1.45, 0))).toBeCloseTo(5, 5)
  })

  it('mira al personaje', () => {
    const c = place(new FollowCamera(1.2))
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(c.quaternion)
    const toTarget = new THREE.Vector3(0, 1.45, 0).sub(c.position).normalize()
    expect(forward.dot(toTarget)).toBeGreaterThan(0.999)
  })

  it('limita la inclinación y el zoom', () => {
    const camera = new FollowCamera(0)
    camera.orbit(0, 10)
    expect(camera.pitch).toBeLessThanOrEqual(1.25)
    camera.orbit(0, -10)
    expect(camera.pitch).toBeGreaterThanOrEqual(-1.2)
    camera.zoom(100)
    expect(camera.distance).toBe(8)
    camera.zoom(-100)
    expect(camera.distance).toBe(2.2)
  })

  it('un edificio alto detrás acerca la cámara', () => {
    const camera = new FollowCamera(0)
    camera.distance = 6
    const wall = [{ box: boxAt(0, 3, 20, 1), height: 20 }] // z 2.5..3.5
    const c = place(camera, wall)
    expect(c.position.z).toBeLessThan(2.5)
  })

  it('mantiene la cámara antes de una pared cercana en vez de forzarla al otro lado', () => {
    const camera = new FollowCamera(0)
    camera.distance = 6
    const wall = [{ box: boxAt(0, 0.55, 20, 0.1), height: 20 }]
    const c = place(camera, wall)
    expect(c.position.z).toBeLessThan(wall[0].box.minZ)
  })

  it('un edificio bajo no la acerca si la cámara pasa por encima', () => {
    const camera = new FollowCamera(0)
    camera.distance = 6
    camera.pitch = 1.0
    const low = [{ box: boxAt(0, 2, 20, 1), height: 0.5 }]
    const c = place(camera, low)
    expect(c.position.distanceTo(new THREE.Vector3(0, 1.45, 0))).toBeCloseTo(6, 5)
  })

  it('se acerca de golpe y se aleja despacio', () => {
    const camera = new FollowCamera(0)
    camera.distance = 6
    const wall = [{ box: boxAt(0, 3, 20, 1), height: 20 }]
    place(camera, wall)
    const near = place(camera, wall, false).position.z
    const away = place(camera, [], false).position.z
    expect(away).toBeGreaterThan(near)
    expect(away).toBeLessThan(5.9) // todavía no ha vuelto del todo
  })
})
