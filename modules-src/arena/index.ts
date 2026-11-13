import { startArena } from './client/main'

const stage = document.getElementById('stage') as HTMLDivElement

startArena(stage).catch((error: unknown) => {
  console.error(error)
  const box = document.getElementById('error') as HTMLDivElement
  box.textContent = 'This browser could not start the 3D view. Try another browser or turn on hardware acceleration.'
  box.style.display = 'grid'
})
