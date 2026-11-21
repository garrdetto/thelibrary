import './styles.css'
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { initEmbedFull } from '../_shared/embed-full.js'
import { App } from './ui/App'

initEmbedFull()

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root')
createRoot(root).render(createElement(App))
