import './styles.css'
import { initEmbedFull } from '../_shared/embed-full.js'
import { Game } from './game'
import { createEngine } from './render/engine'

initEmbedFull()

async function boot(): Promise<void> {
  const canvas = document.getElementById('stage') as HTMLCanvasElement
  const loading = document.getElementById('loading')
  try {
    const { engine, backend } = await createEngine(canvas)
    new Game(engine, backend)
    loading?.remove()
  } catch (error) {
    console.error(error)
    if (loading) {
      loading.textContent = 'This browser could not start 3D graphics (WebGPU or WebGL2 is needed).'
      loading.classList.add('error')
    }
  }
}

void boot()
