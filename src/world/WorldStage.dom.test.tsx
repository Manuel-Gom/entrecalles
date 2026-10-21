// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AvatarSpec, Catalog } from '../avatar/catalog'

const gate = vi.hoisted(() => {
  const state: { release: () => void; fail: (error: Error) => void } = { release: () => undefined, fail: () => undefined }
  const ready = new Promise<void>((resolve, reject) => {
    state.release = resolve
    state.fail = reject
  })
  return { state, ready }
})

const worlds = vi.hoisted(() => [] as { setPaused: ReturnType<typeof vi.fn>; setQuality: ReturnType<typeof vi.fn>; init: { quality: string } }[])

vi.mock('./world', async () => {
  await gate.ready
  class FakeWorld {
    setPaused = vi.fn()
    setQuality = vi.fn()
    dispose = vi.fn()
    subscribe = vi.fn(() => () => undefined)
    init: { quality: string }
    constructor(init: { quality: string }) {
      this.init = init
      worlds.push(this)
    }
  }
  return { World: FakeWorld }
})

import WorldStage from './WorldStage'

const props = {
  spec: { cuerpo: 'x' } as AvatarSpec,
  catalog: {} as Catalog,
  npcs: [],
  controls: 'clasico' as const,
  reducedMotion: false,
  onStatus: () => undefined,
  onFail: () => undefined,
  onPause: () => undefined,
  volumes: { master: 80, music: 65, effects: 80 },
  subtitles: true,
}

afterEach(() => cleanup())

describe('WorldStage', () => {
  it('aplica la pausa y la calidad pedidas mientras se descargaba el código 3D', async () => {
    const view = render(<WorldStage {...props} quality="media" paused={false} />)
    view.rerender(<WorldStage {...props} quality="alta" paused />)
    gate.state.release()
    await vi.waitFor(() => expect(worlds).toHaveLength(1))
    expect(worlds[0].init.quality).toBe('alta')
    expect(worlds[0].setPaused).toHaveBeenLastCalledWith(true)
  })
})
