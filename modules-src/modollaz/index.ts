import './styles.css'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { initEmbedFull } from '../_shared/embed-full.js'
import { App } from './ui/App'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')
initEmbedFull()
createRoot(root).render(createElement(App))
