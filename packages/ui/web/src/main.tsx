import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './dsh/theme/base.css'
import './dsh/theme/design-platform.css'
import './dsh/theme/gradient-shadow-text.css'
import './dsh/theme/corner-shape.css'
import './dsh/theme/focus.css'
import './dsh/theme/scrollbar.css'
import './dsh/theme/onboarding.css'
import './dsh/theme/shiki.css'
import './styles/global.css'

const root = document.querySelector('#root')
if (root === null) throw new Error('UI 根节点不存在。')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
