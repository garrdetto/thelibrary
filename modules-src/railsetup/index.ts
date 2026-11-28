import './site.css'
import { initEmbedFull } from '../_shared/embed-full.js'
import { startSite } from './site/app'

if (new URLSearchParams(location.search).has('page')) document.documentElement.classList.add('rs-page')
initEmbedFull()
startSite()
