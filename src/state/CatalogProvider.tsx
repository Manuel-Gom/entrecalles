import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadCatalog, type Catalog } from '../avatar/catalog'

interface CatalogData {
  catalog: Catalog | null
  error: boolean
}

interface CatalogState extends CatalogData {
  reload: () => void
}

const CatalogContext = createContext<CatalogState>({ catalog: null, error: false, reload: () => {} })

export const useCatalog = () => useContext(CatalogContext)

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CatalogData>({ catalog: null, error: false })
  const [attempt, setAttempt] = useState(0)
  const reload = useCallback(() => {
    setState({ catalog: null, error: false })
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    let cancelled = false
    loadCatalog()
      .then((catalog) => !cancelled && setState({ catalog, error: false }))
      .catch(() => !cancelled && setState({ catalog: null, error: true }))
    return () => {
      cancelled = true
    }
  }, [attempt])

  const value = useMemo(() => ({ ...state, reload }), [state, reload])
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
}
