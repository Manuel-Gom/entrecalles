import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

/* ---------- interruptor ---------- */
export function Switch({ title, description, checked, onChange }: { title: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="switch-row">
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input className="switch-input" type="checkbox" role="switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track" aria-hidden="true" />
    </label>
  )
}

/* ---------- deslizador ---------- */
export function RangeField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="range-row">
      <span>{label}</span>
      <input
        className="range"
        type="range"
        min={0}
        max={100}
        value={value}
        style={{ '--fill': `${value}%` } as CSSProperties}
        aria-valuetext={`${value} por ciento`}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value}%</output>
    </label>
  )
}

/* ---------- grupo de opciones con una sola elegida (radio) y flechas ---------- */
export function useRadioKeys(count: number, current: number, select: (index: number) => void) {
  const refs = useRef<(HTMLElement | null)[]>([])
  const onKeyDown = (event: KeyboardEvent) => {
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown' ? (current + 1) % count
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? (current - 1 + count) % count
          : event.key === 'Home' ? 0
            : event.key === 'End' ? count - 1
              : -1
    if (next < 0) return
    event.preventDefault()
    select(next)
    refs.current[next]?.focus()
  }
  return { refs, onKeyDown }
}

export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  const index = options.findIndex((option) => option.value === value)
  const { refs, onKeyDown } = useRadioKeys(options.length, index, (next) => onChange(options[next].value))
  return (
    <div className="segmented" role="radiogroup" aria-label={label} onKeyDown={onKeyDown}>
      {options.map((option, position) => (
        <button
          type="button"
          role="radio"
          key={option.value}
          ref={(element) => { refs.current[position] = element }}
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>
}
