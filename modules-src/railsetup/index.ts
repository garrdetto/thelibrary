import './styles.css'
import { initEmbedFull } from '../_shared/embed-full.js'
import { App } from './ui/app'

if (new URLSearchParams(location.search).has('page')) document.documentElement.classList.add('rs-page')
initEmbedFull()
new App()
