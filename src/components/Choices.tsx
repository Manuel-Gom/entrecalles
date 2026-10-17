import { useState } from 'react'
import { useRadioKeys } from './Controls'

export interface Choice {
  /** null = "ninguno" */
  value: string | null
  label: string
  /** miniatura (ruta de imagen). Si no carga, se ve solo el texto. */
  image?: string
  /** color (para muestras de color) */
  color?: string
}

function ChoiceImage({ src, none }: { src?: string; none?: boolean }) {
  const [failed, setFailed] = useState(false)
  if (none) return <span className="choice-img none" aria-hidden="true">⌀</span>
  if (!src || failed) return null
  return (
    <span className="choice-img" aria-hidden="true">
      <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
    </span>
  )
}

interface ChoiceGroupProps {
  label: string
  hint?: string
  options: Choice[]
  value: string | null
  onChange: (value: string | null) => void
  /** miniaturas altas (para cuerpos y prendas de cuerpo entero) */
  tall?: boolean
}

/** Grupo de opciones con miniatura (radio): una sola elegida, flechas para moverse. */
export function ChoiceGroup({ label, hint, options, value, onChange, tall }: ChoiceGroupProps) {
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  const { refs, onKeyDown } = useRadioKeys(options.length, index, (next) => onChange(options[next].value))
  const hintId = hint ? `hint-${label.replace(/\W+/g, '-')}` : undefined

  return (
    <fieldset className="choice-group">
      <legend className="label">{label}</legend>
      <div className="choice-grid" role="radiogroup" aria-label={label} aria-describedby={hintId} onKeyDown={onKeyDown}>
        {options.map((option, position) => (
          <button
            type="button"
            role="radio"
            key={option.value ?? 'ninguno'}
            ref={(element) => { refs.current[position] = element }}
            aria-checked={option.value === value}
            tabIndex={position === index ? 0 : -1}
            className={`choice${tall ? ' choice-tall' : ''}`}
            onClick={() => onChange(option.value)}
          >
            <ChoiceImage src={option.image} none={option.value === null} />
            <span className="choice-text">{option.label}</span>
          </button>
        ))}
      </div>
      {hint && <p className="field-hint" id={hintId}>{hint}</p>}
    </fieldset>
  )
}

/** Muestras de color (radio). */
export function SwatchGroup({ label, options, value, onChange }: { label: string; options: Choice[]; value: string | null; onChange: (value: string | null) => void }) {
  const index = Math.max(0, options.findIndex((option) => option.value === value))
  const { refs, onKeyDown } = useRadioKeys(options.length, index, (next) => onChange(options[next].value))
  const current = options.find((option) => option.value === value)

  return (
    <fieldset className="choice-group">
      <legend className="label">{label}</legend>
      <div className="swatch-grid" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
        {options.map((option, position) => (
          <button
            type="button"
            role="radio"
            key={option.value ?? 'original'}
            ref={(element) => { refs.current[position] = element }}
            aria-checked={option.value === value}
            aria-label={option.label}
            title={option.label}
            tabIndex={position === index ? 0 : -1}
            className={`swatch${option.color ? '' : ' swatch-original'}`}
            style={option.color ? ({ '--c': option.color } as React.CSSProperties) : undefined}
            onClick={() => onChange(option.value)}
          />
        ))}
      </div>
      <p className="swatch-name">{current?.label}</p>
    </fieldset>
  )
}

export function Tabs<T extends string>({ label, tabs, value, onChange, idPrefix }: { label: string; tabs: { id: T; label: string }[]; value: T; onChange: (id: T) => void; idPrefix: string }) {
  const index = tabs.findIndex((tab) => tab.id === value)
  const { refs, onKeyDown } = useRadioKeys(tabs.length, index, (next) => onChange(tabs[next].id))
  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab, position) => (
        <button
          type="button"
          role="tab"
          key={tab.id}
          id={`${idPrefix}-tab-${tab.id}`}
          ref={(element) => { refs.current[position] = element }}
          aria-selected={tab.id === value}
          aria-controls={`${idPrefix}-panel`}
          tabIndex={tab.id === value ? 0 : -1}
          className="tab"
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
