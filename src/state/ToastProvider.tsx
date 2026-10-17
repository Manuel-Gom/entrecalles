import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

const ToastContext = createContext<(message: string) => void>(() => {})

export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const notify = useCallback((text: string) => setMessage(text), [])

  useEffect(() => {
    if (!message) return
    const timeout = window.setTimeout(() => setMessage(''), 4000)
    return () => window.clearTimeout(timeout)
  }, [message])

  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div aria-live="polite" role="status">
        {message && <div className="toast">{message}</div>}
      </div>
    </ToastContext.Provider>
  )
}
