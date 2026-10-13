import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import './index.css'
import { App } from './App'
import { useProject } from './store/project'
import { useGerar } from './store/gerar'

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root nao encontrado')

// Em dev, o store fica alcancavel pelo console do devtools. Serve para inspecionar
// estado e para carregar fixtures sem arrastar arquivo a mao a cada recarga.
if (import.meta.env.DEV) {
  Reflect.set(window, 'dangaiStore', useProject)
  // O assistente "Gerar recap" tem store propria; o teste por CDP escolhe o
  // episodio por ela, ja que o dialogo nativo nao da para clicar.
  Reflect.set(window, 'gerarStore', useGerar)
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
