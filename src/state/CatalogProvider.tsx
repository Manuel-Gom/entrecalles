import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadCatalog, type Catalog } from '../avatar/catalog'

interface CatalogState {
  catalog: Catalog | null
  error: boolean
}

const CatalogContext = createContext<CatalogState>({ catalog: null, error: false })

export const useCatalog = () => useContext(CatalogContext)

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CatalogState>({ catalog: null, error: false })
  useEffect(() => {
    let cancelled = false
    loadCatalog()
      .then((catalog) => !cancelled && setState({ catalog, error: false }))
      .catch(() => !cancelled && setState({ catalog: null, error: true }))
    return () => {
      cancelled = true
    }
  }, [])
  return <CatalogContext.Provider value={state}>{children}</CatalogContext.Provider>
}
