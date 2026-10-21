import { ErrorBoundary } from './components/ErrorBoundary'
import { Layout } from './components/Layout'
import { useRoute } from './router'
import { CharactersScreen } from './screens/CharactersScreen'
import { EditorScreen } from './screens/EditorScreen'
import { HomeScreen } from './screens/HomeScreen'
import { NpcScreen } from './screens/NpcScreen'
import { DifficultyScreen, SettingsScreen, SummaryScreen } from './screens/SetupScreens'
import { WorldScreen } from './screens/WorldScreen'
import { CatalogProvider } from './state/CatalogProvider'
import { SaveProvider } from './state/SaveProvider'
import { ToastProvider } from './state/ToastProvider'

function Screen() {
  const route = useRoute()
  // el barrio ocupa toda la pantalla: sin barra superior ni pie
  if (route.name === 'jugar') return <WorldScreen />
  return (
    <Layout route={route}>
      {route.name === 'inicio' && <HomeScreen />}
      {route.name === 'personajes' && <CharactersScreen />}
      {route.name === 'nuevo' && <EditorScreen key="nuevo" />}
      {route.name === 'editar' && <EditorScreen key={route.id} editId={route.id} />}
      {route.name === 'dificultad' && <DifficultyScreen />}
      {route.name === 'ajustes' && <SettingsScreen />}
      {route.name === 'resumen' && <SummaryScreen />}
      {route.name === 'pnj' && <NpcScreen />}
    </Layout>
  )
}

export function App() {
  return (
    <ErrorBoundary>
      <SaveProvider>
        <CatalogProvider>
          <ToastProvider>
            <Screen />
          </ToastProvider>
        </CatalogProvider>
      </SaveProvider>
    </ErrorBoundary>
  )
}
