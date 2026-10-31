/** Post-processing chain installed as the App render pass; Phase 3 adds the TSL passes, today it renders the scene directly. */
import type { App } from '../core/App'
import type { PostConfig, QualitySettings } from '../config'

export interface PostChain {
  readonly enabled: boolean
  render(): void
  dispose(): void
}

export function createPost(app: App, config: PostConfig, quality: QualitySettings): PostChain {
  const enabled = config.enabled && quality.post
  const render = () => app.renderer.render(app.scene, app.camera)
  app.setRenderPass(render)
  return {
    enabled,
    render,
    dispose() {
      app.setRenderPass(null)
    },
  }
}
