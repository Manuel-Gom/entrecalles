import { useEffect, useState } from 'react'
import type { AvatarSpec } from '../avatar/catalog'
import { useCatalog } from '../state/CatalogProvider'

interface ThumbProps {
  spec: AvatarSpec
  /** retrato ya generado al guardar el personaje */
  stored?: string
  name: string
  className?: string
}

/** Retrato del personaje: el guardado, o uno dibujado con el visor 3D. Es decorativo (el nombre va al lado). */
export function Thumb({ spec, stored, name, className = '' }: ThumbProps) {
  const { catalog } = useCatalog()
  const [generated, setGenerated] = useState<{ key: string; url: string } | null>(null)
  const key = JSON.stringify(spec)

  useEffect(() => {
    if (stored || !catalog) return
    let cancelled = false
    void import('../avatar/thumbnail')
      .then(({ renderThumbnail }) => renderThumbnail(spec, catalog))
      .then((url) => !cancelled && setGenerated({ key, url }))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // el aspecto se compara por contenido (key)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, stored, catalog])

  const src = stored ?? (generated?.key === key ? generated.url : undefined)
  return (
    <div className={`thumb ${className}`} aria-hidden="true">
      {src ? <img src={src} alt="" /> : <span className="thumb-fallback">{name.slice(0, 1).toUpperCase()}</span>}
    </div>
  )
}
