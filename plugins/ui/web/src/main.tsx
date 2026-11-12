import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/theme.css'
import './styles/global.css'

const root = document.querySelector('#root')
if (root === null) throw new Error('UI 根节点不存在。')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
