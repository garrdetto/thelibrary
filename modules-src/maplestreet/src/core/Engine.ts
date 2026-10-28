/**
 * Rendering pipeline: WebGPURenderer (auto-falls back to WebGL2 when the
 * browser has no WebGPU), PCF soft shadows, ACES tone mapping and a TSL
 * post-processing chain with GTAO ambient occlusion.
 *
 * Append ?webgl to the URL to force the WebGL2 backend, ?noao to skip AO.
 */
import * as THREE from 'three/webgpu';

/** Filled in once the AO pipeline exists: an MRT override for materials without normals. */
const flatNormalMRT: { node: unknown } = { node: null };

/**
 * Points, lines and sprites have no vertex normals; when the scene pass writes
 * a normal buffer for GTAO they get a constant one instead of a shader error.
 */
export function noNormalsMRT<T extends THREE.Material>(m: T): T {
  if (flatNormalMRT.node) (m as unknown as { mrtNode: unknown }).mrtNode = flatNormalMRT.node;
  return m;
}

export class Engine {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 5000);
  renderer!: THREE.WebGPURenderer;
  backendName = 'unknown';
  aoEnabled = false;
  private post: { render(): void } | null = null;

  static async create(container: HTMLElement): Promise<Engine> {
    const e = new Engine();
    await e.init(container);
    return e;
  }

  private async init(container: HTMLElement) {
    const params = new URLSearchParams(location.search);
    const renderer = new THREE.WebGPURenderer({ antialias: true, forceWebGL: params.has('webgl') });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    await renderer.init();
    this.renderer = renderer;
    const backend = (renderer as unknown as { backend?: { isWebGPUBackend?: boolean } }).backend;
    this.backendName = backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';

    if (!params.has('noao')) await this.setupPostProcessing();

    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  /**
   * scene pass (color + view normals via MRT) -> GTAO -> multiply, as in the
   * r172 webgpu_postprocessing_ao example. Resolved dynamically so
   * a CDN hiccup on the addon only disables AO instead of the whole module.
   */
  private async setupPostProcessing() {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tsl: any = await import('three/tsl');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { ao }: any = await import('three/addons/tsl/display/GTAONode.js');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const PostProcessing: any = (THREE as any).PostProcessing ?? (THREE as any).RenderPipeline;
      if (!ao || !PostProcessing) throw new Error('GTAO / PostProcessing not available');

      const post = new PostProcessing(this.renderer);
      const scenePass = tsl.pass(this.scene, this.camera);
      scenePass.setMRT(tsl.mrt({ output: tsl.output, normal: tsl.normalView }));
      flatNormalMRT.node = tsl.mrt({ normal: tsl.vec3(0, 0, 1) });
      const color = scenePass.getTextureNode('output');
      const depth = scenePass.getTextureNode('depth');
      const normal = scenePass.getTextureNode('normal');

      const aoPass = ao(depth, normal, this.camera);
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 0.6;
      aoPass.distanceFallOff.value = 1.0;
      post.outputNode = tsl.vec4(color.rgb.mul(aoPass.getTextureNode().r), color.a);
      this.post = post;
      this.aoEnabled = true;
    } catch (err) {
      console.warn('[Engine] AO post-processing disabled:', err);
      this.post = null;
    }
  }

  render() {
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
