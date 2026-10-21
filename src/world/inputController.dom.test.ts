// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { InputController, controlOwnsKey, type Controls } from './inputController'

const targets = { orbit: () => undefined, zoom: () => undefined }
const created: { dispose(): void; el: HTMLElement[] }[] = []

function setup(controls: Controls) {
  const canvas = document.createElement('canvas')
  const button = document.createElement('button')
  const select = document.createElement('select')
  document.body.append(canvas, button, select)
  const input = new InputController(canvas, controls, targets, () => undefined, () => false, () => null)
  created.push({ dispose: () => input.dispose(), el: [canvas, button, select] })
  return { input, canvas, button, select }
}

function press(target: HTMLElement, code: string) {
  const event = new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}

afterEach(() => {
  for (const item of created.splice(0)) {
    item.dispose()
    item.el.forEach((el) => el.remove())
  }
})

describe('controlOwnsKey', () => {
  it('los botones y enlaces solo reclaman Intro; los selectores también las flechas', () => {
    const button = document.createElement('button')
    const select = document.createElement('select')
    expect(controlOwnsKey(button, 'Enter')).toBe(true)
    expect(controlOwnsKey(button, 'ArrowUp')).toBe(false)
    expect(controlOwnsKey(select, 'ArrowDown')).toBe(true)
    expect(controlOwnsKey(select, 'KeyW')).toBe(false)
    expect(controlOwnsKey(document.createElement('canvas'), 'Enter')).toBe(false)
    expect(controlOwnsKey(null, 'Enter')).toBe(false)
  })
})

describe('InputController con el foco en la interfaz', () => {
  it('con las flechas como controles, Intro sobre un botón lo activa (no se traga la tecla) y sobre el lienzo interactúa', () => {
    const { input, canvas, button } = setup('flechas')
    expect(press(button, 'Enter').defaultPrevented).toBe(false)
    expect(input.poll(0.016).interact).toBe(false)
    expect(press(canvas, 'Enter').defaultPrevented).toBe(true)
    expect(input.poll(0.016).interact).toBe(true)
  })

  it('las flechas sobre un selector lo manejan a él y no mueven al personaje', () => {
    const { input, select } = setup('flechas')
    expect(press(select, 'ArrowUp').defaultPrevented).toBe(false)
    expect(input.poll(0.016).move.moveZ).toBe(0)
  })

  it('W sobre un botón sigue moviendo al personaje (el foco vuelve al botón de pausa al reanudar)', () => {
    const { input, button } = setup('clasico')
    expect(press(button, 'KeyW').defaultPrevented).toBe(true)
    expect(input.poll(0.016).move.moveZ).toBe(1)
  })
})
