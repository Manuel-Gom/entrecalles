// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AvatarSpec, Catalog } from '../avatar/catalog'

vi.mock('./world', () => {
  throw new Error('sin red')
})

import WorldStage from './WorldStage'

afterEach(() => cleanup())

describe('WorldStage sin el código 3D', () => {
  it('avisa del fallo en lugar de dejar la pantalla cargando para siempre', async () => {
    const onFail = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <WorldStage
        spec={{ cuerpo: 'x' } as AvatarSpec}
        catalog={{} as Catalog}
        npcs={[]}
        controls="clasico"
        reducedMotion={false}
        quality="media"
        paused={false}
        onStatus={() => undefined}
        onFail={onFail}
        onPause={() => undefined}
        volumes={{ master: 80, music: 65, effects: 80 }}
        subtitles
      />,
    )
    await vi.waitFor(() => expect(onFail).toHaveBeenCalledTimes(1))
    error.mockRestore()
  })
})
