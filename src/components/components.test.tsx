// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChoiceGroup, SwatchGroup, Tabs, type Choice } from './Choices'
import { RangeField, Segmented, Switch } from './Controls'
import { Dialog } from './Dialog'

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('Dialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"><button id="opener">Abrir</button></div>'
  })

  function open(onClose = vi.fn()) {
    const opener = document.getElementById('opener') as HTMLButtonElement
    opener.focus()
    const view = render(
      <Dialog
        title="¿Eliminar?"
        onClose={onClose}
        actions={
          <>
            <button type="button" data-autofocus>No, volver</button>
            <button type="button">Sí, eliminar</button>
          </>
        }
      >
        <p>Texto</p>
      </Dialog>,
    )
    return { opener, onClose, view }
  }

  it('es un diálogo modal con título accesible y el foco empieza en la opción segura', () => {
    open()
    const dialog = screen.getByRole('dialog', { name: '¿Eliminar?' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement?.textContent).toBe('No, volver')
  })

  it('deja el resto de la página inerte mientras está abierto y la recupera al cerrarse', () => {
    const { view } = open()
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(true)
    view.unmount()
    expect(document.getElementById('root')!.hasAttribute('inert')).toBe(false)
  })

  it('devuelve el foco a quien lo abrió', () => {
    const { opener, view } = open()
    expect(document.activeElement).not.toBe(opener)
    view.unmount()
    expect(document.activeElement).toBe(opener)
  })

  it('Escape lo cierra', async () => {
    const { onClose } = open()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Tab no sale del diálogo (da la vuelta en los dos sentidos)', async () => {
    open()
    const [safe, danger] = within(screen.getByRole('dialog')).getAllByRole('button')
    expect(document.activeElement).toBe(safe)
    await userEvent.tab()
    expect(document.activeElement).toBe(danger)
    await userEvent.tab()
    expect(document.activeElement).toBe(safe)
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(danger)
  })

  it('al pulsar fuera del cuadro se cierra, pero no al pulsar dentro', async () => {
    const { onClose } = open()
    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('dialog').parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

const options: Choice[] = [
  { value: null, label: 'Ninguno' },
  { value: 'a', label: 'Alfa' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
]

function Harness({ initial = 'a', onValue }: { initial?: string | null; onValue?: (value: string | null) => void }) {
  const [value, setValue] = useState<string | null>(initial)
  return <ChoiceGroup label="Peinado" options={options} value={value} onChange={(next) => { setValue(next); onValue?.(next) }} />
}

describe('ChoiceGroup', () => {
  it('es un grupo de radios con la opción elegida marcada', () => {
    render(<Harness />)
    expect(screen.getByRole('radiogroup', { name: 'Peinado' })).toBeTruthy()
    const radios = screen.getAllByRole('radio')
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false'])
  })

  it('solo la opción elegida entra en el orden de tabulación', () => {
    render(<Harness />)
    expect(screen.getAllByRole('radio').map((radio) => radio.tabIndex)).toEqual([-1, 0, -1, -1])
  })

  it('las flechas cambian la opción, dan la vuelta y mueven el foco', async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    const radios = screen.getAllByRole('radio')
    radios[1].focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onValue).toHaveBeenLastCalledWith('b')
    expect(document.activeElement).toBe(radios[2])
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    expect(onValue).toHaveBeenLastCalledWith(null) // vuelve al principio: "Ninguno"
    await userEvent.keyboard('{ArrowLeft}')
    expect(onValue).toHaveBeenLastCalledWith('c')
  })

  it('Inicio y Fin saltan a la primera y a la última', async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    screen.getAllByRole('radio')[1].focus()
    await userEvent.keyboard('{End}')
    expect(onValue).toHaveBeenLastCalledWith('c')
    await userEvent.keyboard('{Home}')
    expect(onValue).toHaveBeenLastCalledWith(null)
  })

  it('el clic elige una opción', async () => {
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Gamma' }))
    expect(onValue).toHaveBeenCalledWith('c')
  })

  it('"Ninguno" no lleva imagen y su icono es decorativo', () => {
    render(<Harness />)
    const none = screen.getByRole('radio', { name: 'Ninguno' })
    expect(none.querySelector('img')).toBeNull()
    expect(none.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('si la miniatura no carga, desaparece y queda el texto', () => {
    render(<ChoiceGroup label="Ropa" options={[{ value: 'x', label: 'Camiseta', image: '/no-existe.png' }]} value="x" onChange={() => {}} />)
    const image = document.querySelector('img') as HTMLImageElement
    expect(image.getAttribute('alt')).toBe('')
    fireEvent.error(image)
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByRole('radio', { name: 'Camiseta' })).toBeTruthy()
  })

  it('asocia la ayuda al grupo', () => {
    render(<ChoiceGroup label="Cuerpo" hint="Descripción" options={options} value="a" onChange={() => {}} />)
    const group = screen.getByRole('radiogroup', { name: 'Cuerpo' })
    expect(document.getElementById(group.getAttribute('aria-describedby')!)?.textContent).toBe('Descripción')
  })
})

describe('SwatchGroup', () => {
  it('cada color tiene nombre accesible y se indica el elegido', () => {
    render(<SwatchGroup label="Color de pelo" value="#111111" onChange={() => {}} options={[{ value: null, label: 'Original' }, { value: '#111111', label: 'Negro', color: '#111111' }, { value: '#eeeeee', label: 'Blanco', color: '#eeeeee' }]} />)
    expect(screen.getByRole('radio', { name: 'Negro' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Original' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('Negro').tagName).toBe('P') // nombre visible del color elegido
  })
})

describe('Tabs y Segmented', () => {
  const tabs = [{ id: 'a', label: 'Cuerpo' }, { id: 'b', label: 'Pelo' }, { id: 'c', label: 'Ropa' }] as const

  it('Tabs: una pestaña seleccionada, flechas y vuelta al principio', async () => {
    const onChange = vi.fn()
    render(<Tabs label="Categorías" idPrefix="t" tabs={[...tabs]} value="a" onChange={onChange} />)
    const list = screen.getByRole('tablist', { name: 'Categorías' })
    expect(list).toBeTruthy()
    expect(screen.getAllByRole('tab').map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false'])
    screen.getByRole('tab', { name: 'Cuerpo' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('c')
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('b') // el valor sigue siendo 'a' (componente controlado): la siguiente es 'b'
  })

  it('Segmented: marca la elegida y cambia con teclado y clic', async () => {
    const onChange = vi.fn()
    render(<Segmented label="Distribución" value="x" onChange={onChange} options={[{ value: 'x', label: 'Clásica' }, { value: 'y', label: 'Flechas' }]} />)
    expect(screen.getByRole('radiogroup', { name: 'Distribución' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'Clásica' }).getAttribute('aria-checked')).toBe('true')
    await userEvent.click(screen.getByRole('radio', { name: 'Flechas' }))
    expect(onChange).toHaveBeenLastCalledWith('y')
    screen.getByRole('radio', { name: 'Clásica' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('y')
  })
})

describe('Switch y RangeField', () => {
  it('Switch es un interruptor accesible que cambia con clic y con espacio', async () => {
    const onChange = vi.fn()
    render(<Switch title="Subtítulos" description="Mostrar los diálogos" checked={false} onChange={onChange} />)
    const toggle = screen.getByRole('switch', { name: /Subtítulos/ })
    expect((toggle as HTMLInputElement).checked).toBe(false)
    await userEvent.click(toggle)
    expect(onChange).toHaveBeenLastCalledWith(true)
    toggle.focus()
    await userEvent.keyboard(' ')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('RangeField expone el valor como número y como texto', async () => {
    const onChange = vi.fn()
    render(<RangeField label="Música" value={65} onChange={onChange} />)
    const slider = screen.getByRole('slider', { name: /Música/ }) as HTMLInputElement
    expect(slider.value).toBe('65')
    expect(slider.getAttribute('aria-valuetext')).toBe('65 por ciento')
    expect(screen.getByText('65%')).toBeTruthy()
    fireEvent.change(slider, { target: { value: '66' } })
    expect(onChange).toHaveBeenLastCalledWith(66)
  })
})
