import { useEffect, useMemo, useState } from 'react'
import {
  CLOTH_COLORS, HAIR_COLORS, TINT_SLOTS, bodyThumbUrl, genderOf, isOptional, normalizeSpec, pieceThumbUrl, piecesFor,
  type AvatarSpec, type Catalog, type CatalogBody, type Genero, type Slot, type TintSlot,
} from '../avatar/catalog'
import { AvatarView } from '../components/AvatarView'
import { ChoiceGroup, SwatchGroup, Tabs, type Choice } from '../components/Choices'
import { Segmented } from '../components/Controls'
import { Page } from '../components/Layout'
import { navigate, paths } from '../router'
import { NAME_MAX, newId, type Character } from '../state/save'
import { useCatalog } from '../state/CatalogProvider'
import { useSave } from '../state/SaveProvider'
import { useToast } from '../state/ToastProvider'

type EditorTab = 'cuerpo' | 'pelo' | 'ropa' | 'complementos' | 'rostro' | 'colores'
const TABS: { id: EditorTab; label: string }[] = [
  { id: 'cuerpo', label: 'Cuerpo' },
  { id: 'pelo', label: 'Pelo' },
  { id: 'ropa', label: 'Ropa' },
  { id: 'complementos', label: 'Calzado y gorra' },
  { id: 'rostro', label: 'Barba y gafas' },
  { id: 'colores', label: 'Colores' },
]

const TINT_LABELS: Record<TintSlot, string> = {
  torso: 'Color de la camiseta o jersey',
  piernas: 'Color del pantalón',
  conjunto: 'Color del vestido o conjunto',
  calzado: 'Color del calzado',
  cabeza: 'Color de la gorra o sombrero',
}

const randomFrom = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]

function randomSpec(catalog: Catalog): AvatarSpec {
  const body = randomFrom(catalog.cuerpos)
  const pick = (slot: Slot, canBeNone: boolean) => {
    const ids = piecesFor(catalog, body, slot).map((piece) => piece.id)
    if (ids.length === 0) return null
    return canBeNone && Math.random() < 0.25 ? null : randomFrom(ids)
  }
  const outfits = piecesFor(catalog, body, 'conjunto')
  const useOutfit = outfits.length > 0 && Math.random() < 0.4
  return normalizeSpec({
    cuerpo: body.id,
    pelo: pick('pelo', true),
    conjunto: useOutfit ? pick('conjunto', false) : null,
    torso: useOutfit ? null : pick('torso', isOptional('torso', body)),
    piernas: useOutfit ? null : pick('piernas', false),
    calzado: pick('calzado', false),
    cabeza: pick('cabeza', true),
    gafas: Math.random() < 0.3 ? pick('gafas', false) : null,
    barba: Math.random() < 0.3 ? pick('barba', false) : null,
    colorPelo: Math.random() < 0.5 ? randomFrom(HAIR_COLORS).value : null,
    colores: Object.fromEntries(TINT_SLOTS.map((slot) => [slot, randomFrom(CLOTH_COLORS).value])),
  }, catalog)
}

function Appearance({ catalog, spec, onChange }: { catalog: Catalog; spec: AvatarSpec; onChange: (spec: AvatarSpec) => void }) {
  const [tab, setTab] = useState<EditorTab>('cuerpo')
  const current = normalizeSpec(spec, catalog)
  const body = catalog.cuerpos.find((item) => item.id === current.cuerpo) as CatalogBody
  const [gender, setGender] = useState<Genero>(genderOf(body))
  const update = (changes: Partial<AvatarSpec>) => onChange(normalizeSpec({ ...current, ...changes }, catalog))

  const piece = (slot: Slot): Choice[] => [
    ...(isOptional(slot, body) ? [{ value: null, label: 'Ninguno' }] : []),
    ...piecesFor(catalog, body, slot).map((item) => ({
      value: item.id,
      label: item.nombre,
      image: item.miniatura ? pieceThumbUrl(slot, item.id) : undefined,
    })),
  ]

  const bodies = catalog.cuerpos.filter((item) => genderOf(item) === gender)
  const hasWomen = catalog.cuerpos.some((item) => genderOf(item) === 'mujer')
  const hasOutfits = piecesFor(catalog, body, 'conjunto').length > 0
  const hasFace = piecesFor(catalog, body, 'barba').length + piecesFor(catalog, body, 'gafas').length > 0
  const tabs = TABS.filter((item) => item.id !== 'rostro' || hasFace)
  const activeTab = tabs.some((item) => item.id === tab) ? tab : 'cuerpo'

  return (
    <>
      <Tabs label="Categorías de aspecto" idPrefix="editor" tabs={tabs} value={activeTab} onChange={setTab} />
      <div role="tabpanel" id="editor-panel" aria-labelledby={`editor-tab-${activeTab}`}>
        {activeTab === 'cuerpo' && (
          <>
            {hasWomen && (
              <div style={{ marginBottom: '1.25rem' }}>
                <Segmented
                  label="Tipo de cuerpo"
                  value={gender}
                  options={[{ value: 'hombre', label: 'Hombres' }, { value: 'mujer', label: 'Mujeres' }]}
                  onChange={setGender}
                />
              </div>
            )}
            <ChoiceGroup
              label="Cuerpo"
              tall
              hint={genderOf(body) === gender ? body.descripcion : undefined}
              value={genderOf(body) === gender ? current.cuerpo : null}
              options={bodies.map((item) => ({ value: item.id, label: item.nombre, image: item.miniatura ? bodyThumbUrl(item.id) : undefined }))}
              onChange={(id) => id && onChange(normalizeSpec({ cuerpo: id }, catalog))}
            />
          </>
        )}
        {activeTab === 'pelo' && (
          <>
            <ChoiceGroup label="Peinado" options={piece('pelo')} value={current.pelo ?? null} onChange={(id) => update({ pelo: id })} />
          </>
        )}
        {activeTab === 'ropa' && (
          <>
            {hasOutfits && (
              <ChoiceGroup
                label="Conjunto completo"
                hint="Un conjunto sustituye a la camiseta y al pantalón."
                tall
                options={piece('conjunto')}
                value={current.conjunto ?? null}
                onChange={(id) => update({ conjunto: id })}
              />
            )}
            {!current.conjunto && (
              <>
                <ChoiceGroup label="Camiseta o jersey" options={piece('torso')} value={current.torso ?? null} onChange={(id) => update({ conjunto: null, torso: id })} />
                <ChoiceGroup label="Pantalón" options={piece('piernas')} value={current.piernas ?? null} onChange={(id) => update({ conjunto: null, piernas: id })} />
              </>
            )}
          </>
        )}
        {activeTab === 'rostro' && (
          <>
            {piecesFor(catalog, body, 'barba').length > 0 && (
              <ChoiceGroup label="Barba y bigote" options={piece('barba')} value={current.barba ?? null} onChange={(id) => update({ barba: id })} />
            )}
            {piecesFor(catalog, body, 'gafas').length > 0 && (
              <ChoiceGroup label="Gafas" options={piece('gafas')} value={current.gafas ?? null} onChange={(id) => update({ gafas: id })} />
            )}
          </>
        )}
        {activeTab === 'colores' && (
          <>
            {current.pelo && (
              <SwatchGroup
                label="Color de pelo"
                value={current.colorPelo ?? null}
                options={[{ value: null, label: 'Original' }, ...HAIR_COLORS.map((color) => ({ value: color.value, label: color.label, color: color.value }))]}
                onChange={(value) => update({ colorPelo: value })}
              />
            )}
            {TINT_SLOTS.map((slot) => {
              const worn = catalog.piezas.find((item) => item.slot === slot && item.id === current[slot])
              if (!worn?.tinte) return null
              return (
                <SwatchGroup
                  key={slot}
                  label={TINT_LABELS[slot]}
                  value={current.colores?.[slot] ?? null}
                  options={[{ value: null, label: 'Original' }, ...CLOTH_COLORS.map((color) => ({ value: color.value, label: color.label, color: color.value }))]}
                  onChange={(value) => update({ colores: { ...current.colores, [slot]: value ?? undefined } })}
                />
              )
            })}
            {!current.pelo && TINT_SLOTS.every((slot) => !catalog.piezas.find((item) => item.slot === slot && item.id === current[slot])?.tinte) && (
              <p className="field-hint">Las piezas elegidas no se pueden teñir. Prueba con otra camiseta, pantalón o gorra.</p>
            )}
          </>
        )}
        {activeTab === 'complementos' && (
          <>
            <ChoiceGroup label="Calzado" options={piece('calzado')} value={current.calzado ?? null} onChange={(id) => update({ calzado: id })} />
            <ChoiceGroup label="Gorra o sombrero" hint="Con gorra o sombrero no se ve el peinado." options={piece('cabeza')} value={current.cabeza ?? null} onChange={(id) => update({ cabeza: id })} />
          </>
        )}
      </div>

      <div className="tools">
        <button type="button" className="text-btn" onClick={() => { const next = randomSpec(catalog); setGender(genderOf(catalog.cuerpos.find((item) => item.id === next.cuerpo))); onChange(next) }}>
          <span aria-hidden="true">⟲</span> Aleatorio
        </button>
        <button type="button" className="text-btn" onClick={() => onChange(normalizeSpec({ cuerpo: current.cuerpo }, catalog))}>Restablecer</button>
      </div>
    </>
  )
}

export function EditorScreen({ editId }: { editId?: string }) {
  const { save, upsertCharacter } = useSave()
  const { catalog, error } = useCatalog()
  const notify = useToast()
  const existing = editId ? save.characters.find((character) => character.id === editId) : undefined
  const [draft, setDraft] = useState<Character | null>(null)
  const [nameError, setNameError] = useState(false)
  const [saving, setSaving] = useState(false)

  // un personaje que no existe (enlace antiguo o ya borrado)
  useEffect(() => {
    if (editId && !existing) {
      notify('No se encuentra ese personaje.')
      navigate(paths.personajes)
    }
  }, [editId, existing, notify])

  // el borrador se crea cuando el catálogo está listo
  useEffect(() => {
    if (draft || !catalog) return
    if (existing) setDraft({ ...existing, spec: normalizeSpec(existing.spec, catalog) })
    else if (!editId) setDraft({ id: newId(), name: '', spec: normalizeSpec({}, catalog) })
  }, [draft, catalog, existing, editId])

  const isNew = !editId
  const title = useMemo(() => (isNew ? <>Crea a tu <span className="accent">protagonista.</span></> : <>Ajusta cada <span className="accent">detalle.</span></>), [isNew])

  const onSave = async () => {
    if (!draft || !catalog) return
    const name = draft.name.trim().slice(0, NAME_MAX)
    if (!name) {
      setNameError(true)
      document.getElementById('nombre')?.focus()
      return
    }
    setSaving(true)
    const spec = normalizeSpec(draft.spec, catalog)
    let thumb: string | undefined
    try {
      const { renderThumbnail } = await import('../avatar/thumbnail')
      thumb = await Promise.race([
        renderThumbnail(spec, catalog),
        new Promise<undefined>((resolve) => window.setTimeout(() => resolve(undefined), 6000)),
      ])
    } catch {
      thumb = undefined
    }
    const ok = upsertCharacter({ id: draft.id, name, spec, thumb })
    setSaving(false)
    if (!ok) {
      notify('Has llegado al límite de personajes guardados.')
      return
    }
    notify(isNew ? `${name} se ha guardado y es tu protagonista.` : `${name} se ha actualizado.`)
    navigate(paths.personajes)
  }

  return (
    <Page
      plainTitle={isNew ? 'Crear personaje' : 'Editar personaje'}
      title={title}
      lead="Una identidad propia, hecha a tu imagen."
      back={{ label: 'Volver a personajes', href: paths.personajes }}
    >
      {error && <p className="alert-banner" role="alert">No se pudo cargar el catálogo de personajes. Recarga la página.</p>}
      {draft && catalog ? (
        <div className="editor">
          <section className="card editor-panel" aria-label="Opciones de apariencia">
            <label className="field-label label" htmlFor="nombre">
              <span>Nombre del personaje</span>
              <span>Obligatorio · {NAME_MAX} máx.</span>
            </label>
            <input
              id="nombre"
              className="text-input"
              value={draft.name}
              maxLength={NAME_MAX}
              placeholder="¿Cómo se llama?"
              autoComplete="off"
              aria-invalid={nameError}
              aria-describedby={nameError ? 'nombre-error' : undefined}
              onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setNameError(false) }}
            />
            {nameError && <p className="field-error" id="nombre-error" role="alert">Escribe un nombre para guardar el personaje.</p>}
            <Appearance catalog={catalog} spec={draft.spec} onChange={(spec) => setDraft({ ...draft, spec })} />
          </section>

          <aside className="editor-side" aria-label="Vista previa">
            <AvatarView spec={draft.spec} label={`Vista 3D de ${draft.name || 'tu personaje'}`} tag="Vista 3D" />
            <div className="editor-actions">
              <button type="button" className="btn" onClick={onSave} disabled={saving}>
                {saving ? 'Guardando…' : <>Guardar personaje <span aria-hidden="true">✓</span></>}
              </button>
              <a className="btn btn-ghost" href={paths.personajes}>Cancelar</a>
            </div>
          </aside>
        </div>
      ) : (
        !error && <p className="field-hint" role="status">Cargando personajes…</p>
      )}
    </Page>
  )
}
