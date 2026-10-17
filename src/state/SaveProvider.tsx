import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readSave, writeSave, type Character, type Difficulty, type GameSettings, type SaveData, MAX_CHARACTERS } from './save'

interface SaveApi {
  save: SaveData
  activeCharacter: Character | null
  storageError: boolean
  upsertCharacter: (character: Character) => boolean
  deleteCharacter: (id: string) => void
  selectCharacter: (id: string) => void
  setDifficulty: (difficulty: Difficulty) => void
  updateSettings: <K extends keyof GameSettings>(key: K, value: GameSettings[K]) => void
}

const SaveContext = createContext<SaveApi | null>(null)

export function useSave(): SaveApi {
  const value = useContext(SaveContext)
  if (!value) throw new Error('useSave debe usarse dentro de SaveProvider')
  return value
}

export function SaveProvider({ children }: { children: ReactNode }) {
  const [save, setSave] = useState<SaveData>(readSave)
  const [storageError, setStorageError] = useState(false)

  useEffect(() => {
    setStorageError(!writeSave(save))
  }, [save])

  // ajustes de accesibilidad: se aplican a toda la página
  const { highContrast, reducedMotion, largeText } = save.settings
  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('high-contrast', highContrast)
    root.classList.toggle('reduced-motion', reducedMotion)
    root.classList.toggle('large-text', largeText)
  }, [highContrast, reducedMotion, largeText])

  const api = useMemo<SaveApi>(
    () => ({
      save,
      activeCharacter: save.characters.find((character) => character.id === save.activeId) ?? null,
      storageError,
      upsertCharacter(character) {
        const exists = save.characters.some((item) => item.id === character.id)
        if (!exists && save.characters.length >= MAX_CHARACTERS) return false
        setSave((current) => ({
          ...current,
          characters: exists
            ? current.characters.map((item) => (item.id === character.id ? character : item))
            : [...current.characters, character],
          activeId: character.id,
        }))
        return true
      },
      deleteCharacter(id) {
        setSave((current) => {
          const characters = current.characters.filter((character) => character.id !== id)
          return { ...current, characters, activeId: current.activeId === id ? (characters[0]?.id ?? null) : current.activeId }
        })
      },
      selectCharacter(id) {
        setSave((current) => ({ ...current, activeId: id }))
      },
      setDifficulty(difficulty) {
        setSave((current) => ({ ...current, difficulty }))
      },
      updateSettings(key, value) {
        setSave((current) => ({ ...current, settings: { ...current.settings, [key]: value } }))
      },
    }),
    [save, storageError],
  )

  return <SaveContext.Provider value={api}>{children}</SaveContext.Provider>
}
