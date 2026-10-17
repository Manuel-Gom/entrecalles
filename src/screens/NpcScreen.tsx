import { useEffect, useMemo, useState } from 'react'
import { describeSpec, genderOf } from '../avatar/catalog'
import { loadNpcs, npcPortraitUrl, type Npc } from '../avatar/npcs'
import { AvatarView } from '../components/AvatarView'
import { Segmented } from '../components/Controls'
import { Page } from '../components/Layout'
import { Thumb } from '../components/Thumb'
import { paths } from '../router'
import { useCatalog } from '../state/CatalogProvider'

const PAGE_SIZE = 24

function Portrait({ npc }: { npc: Npc }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <Thumb spec={npc.spec} name={npc.nombre} className="npc-thumb" />
  return (
    <div className="thumb npc-thumb" aria-hidden="true">
      <img src={npcPortraitUrl(npc.id)} alt="" loading="lazy" onError={() => setFailed(true)} />
    </div>
  )
}

type GenderFilter = 'todos' | 'hombre' | 'mujer'

/** Catálogo de diseños de PNJ para revisar: filtros, retratos y vista 3D del elegido. */
export function NpcScreen() {
  const { catalog } = useCatalog()
  const [npcs, setNpcs] = useState<Npc[] | null>(null)
  const [error, setError] = useState(false)
  const [gender, setGender] = useState<GenderFilter>('todos')
  const [style, setStyle] = useState('')
  const [age, setAge] = useState('')
  const [query, setQuery] = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    loadNpcs().then(setNpcs).catch(() => setError(true))
  }, [])

  const styles = useMemo(() => [...new Set((npcs ?? []).map((npc) => npc.estilo))].sort(), [npcs])
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase()
    return (npcs ?? []).filter((npc) =>
      (gender === 'todos' || npc.genero === gender)
      && (!style || npc.estilo === style)
      && (!age || npc.edad === age)
      && (!text || `${npc.nombre} ${npc.rol}`.toLowerCase().includes(text)))
  }, [npcs, gender, style, age, query])

  const selected = filtered.find((npc) => npc.id === selectedId) ?? filtered[0] ?? null
  const shown = filtered.slice(0, visible)
  const reset = () => setVisible(PAGE_SIZE)

  return (
    <Page
      plainTitle="Personajes no jugables"
      title={<>Gente de <span className="accent">la ciudad.</span></>}
      lead={npcs ? `${npcs.length} diseños de personajes no jugables. Elige uno para verlo en 3D.` : 'Cargando diseños…'}
      back={{ label: 'Volver al inicio', href: paths.inicio }}
    >
      {error && <p className="alert-banner" role="alert">No se pudo cargar la lista de personajes no jugables.</p>}

      <div className="npc-filters">
        <Segmented
          label="Género"
          value={gender}
          options={[{ value: 'todos', label: 'Todos' }, { value: 'hombre', label: 'Hombres' }, { value: 'mujer', label: 'Mujeres' }]}
          onChange={(value) => { setGender(value); reset() }}
        />
        <label className="npc-field">
          <span className="label">Estilo</span>
          <select value={style} onChange={(event) => { setStyle(event.target.value); reset() }}>
            <option value="">Todos</option>
            {styles.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="npc-field">
          <span className="label">Edad</span>
          <select value={age} onChange={(event) => { setAge(event.target.value); reset() }}>
            <option value="">Todas</option>
            <option value="joven">Joven</option>
            <option value="adulto">Adulto</option>
            <option value="mayor">Mayor</option>
          </select>
        </label>
        <label className="npc-field grow">
          <span className="label">Buscar</span>
          <input type="search" value={query} placeholder="Nombre u oficio" onChange={(event) => { setQuery(event.target.value); reset() }} />
        </label>
      </div>

      <div className="layout-two">
        <section className="layout-main" aria-label="Diseños">
          <p className="label" role="status">{filtered.length} personajes</p>
          <ul className="npc-grid">
            {shown.map((npc) => (
              <li key={npc.id}>
                <button type="button" className="npc-card" aria-pressed={selected?.id === npc.id} onClick={() => setSelectedId(npc.id)}>
                  <Portrait npc={npc} />
                  <span className="npc-name">{npc.nombre}</span>
                  <span className="npc-role">{npc.rol}</span>
                </button>
              </li>
            ))}
          </ul>
          {filtered.length > visible && (
            <button type="button" className="btn btn-ghost" style={{ marginTop: '1.5rem' }} onClick={() => setVisible((value) => value + PAGE_SIZE)}>
              Ver más ({filtered.length - visible} restantes)
            </button>
          )}
        </section>

        <aside className="layout-side side-sticky" aria-label="Personaje elegido">
          {selected ? (
            <>
              <AvatarView spec={selected.spec} label={`Vista 3D de ${selected.nombre}`} tag={`${selected.nombre} · ${selected.rol}`} />
              <div className="card selected-card" style={{ display: 'block' }}>
                <p className="label">{selected.estilo} · {selected.edad} · {genderOf(catalog?.cuerpos.find((body) => body.id === selected.spec.cuerpo)) === 'mujer' ? 'mujer' : 'hombre'}</p>
                <h2>{selected.nombre}</h2>
                <p className="field-hint">{catalog ? describeSpec(selected.spec, catalog) : ''}</p>
              </div>
            </>
          ) : (
            <p className="field-hint">No hay personajes con esos filtros.</p>
          )}
        </aside>
      </div>
    </Page>
  )
}
