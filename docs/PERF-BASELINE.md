# Performance baseline

Measured 2026-10-31 by `node scripts/perf-baseline.mjs` against `pnpm dev` (commit `ad6f64c`).
Headless Playwright Chromium 153.0.8010.12, software WebGL (SwiftShader), viewport 1280×800, cache disabled, one fresh context per module.
Each module is opened from the hub as a visitor would, left for 10 s, then every animation frame is recorded for 20 s.

These are the numbers every later phase must beat. Re-measure with `node scripts/perf-baseline.mjs --compare` on the same machine class; absolute FPS under software WebGL is far below a real GPU, so compare runs, not machines.

| Module | id | First frame (ms) | Avg FPS | 1% low FPS | JS heap (MB) | Draw calls (renderer.info) | GPU draws / frame | Transferred (KB) | JS (KB) | three.js | Page errors |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| Sandlot Sluggers 3D | `sandlot3d` | 4,028 | 3.9 | 1.9 | 18.7 | 1 | 348 | 14,923 | 8,840 | r128 | 0 |
| Maple Street | `maplestreet` | 3,464 (fcp) | 59.9 | 51.2 | 17.4 | — | — | 11,206 | 9,814 | r172 | 1 |
| Sandlot Sluggers | `sandlot` | 3,734 (canvas2d) | 5.2 | 0.2 | 16.0 | — | — | 10,514 | 8,747 | — | 0 |
| Short Track Showdown | `shorttrack` | 10,490 | 0.3 | 0.1 | 23.9 | 1 | 459 | 11,123 | 9,042 | r160 | 0 |
| BotWreck 3D | `botwreck` | 4,914 | 5.0 | 2.3 | 19.6 | 66 | 92 | 10,113 | 9,049 | r160 | 0 |
| 8-Ball Pool | `pool` | — | 59.7 | 37.8 | 14.2 | — | — | 9,732 | 8,721 | — | 0 |
| Max Secure Circuit | `racing` | — | 59.7 | 37.8 | 14.2 | — | — | 10,240 | 9,228 | — | 0 |
| Thrill Park | `park` | — | 59.8 | 44.8 | 14.9 | — | — | 11,485 | 10,473 | — | 0 |
| Oval Speedway | `oval` | — | 59.9 | 47.7 | 14.3 | — | — | 10,240 | 9,228 | — | 0 |
| Chess | `chess` | 4,316 (fcp) | 59.8 | 42.2 | 15.0 | — | — | 9,849 | 8,747 | — | 0 |
| Checkers | `checkers` | 3,982 (fcp) | 59.6 | 34.2 | 14.8 | — | — | 9,834 | 8,747 | — | 0 |
| 2048 | `2048` | 4,103 (fcp) | 60.0 | 55.0 | 14.7 | — | — | 9,787 | 8,723 | — | 0 |
| Chopper Cave | `helicopter` | 4,216 (canvas2d) | 25.3 | 0.7 | 14.9 | — | — | 9,796 | 8,723 | — | 0 |

## Columns

- First frame: milliseconds from opening the module (hub navigation, or the hub-card click for pool) to its first WebGL/WebGPU draw call; `(canvas2d)` marks the first 2D canvas draw and `(fcp)` the iframe first contentful paint for embedded modules that draw neither. `—` means the landing screen draws no canvas (for example a sign-in prompt or menu).
- Avg FPS: frames recorded divided by the sample window. 1% low FPS: 1000 divided by the mean of the slowest 1% of frame intervals.
- JS heap: `JSHeapUsedSize` from the Chrome DevTools Protocol at the end of the sample (hub page and module iframe share one heap).
- Draw calls (renderer.info): `renderer.info.render.calls` sampled every frame and averaged, summed over every three.js renderer found through the `__THREE_DEVTOOLS__` hook. three.js resets it on each `render()` call, so a module that renders several passes per frame reports only its last pass here.
- GPU draws / frame: every WebGL `draw*` and WebGPU `draw*` call counted by wrapping the context prototypes, averaged per frame; this covers all passes and non-three.js renderers. `—` means nothing drew on the GPU during the sample.
- Transferred / JS: encoded bytes over the network for the whole run, all resources and scripts only. `pnpm dev` serves unminified sources, so these are larger than production but comparable run to run.
- Page errors: uncaught exceptions during the run.

<!-- perf-data
{"meta":{"date":"2026-10-31","commit":"ad6f64c","browser":"153.0.8010.12","warmupMs":10000,"sampleMs":20000},"results":[{"id":"sandlot3d","title":"Sandlot Sluggers 3D","ok":true,"ttffMs":4027.5999023437034,"ttffSource":"webgl","avgFps":3.8932783694034123,"lowFps":1.874765654293221,"frames":69,"drawCalls":1,"gpuDraws":347.6231884057971,"three":"128","heapBytes":19632732,"totalBytes":15281539,"jsBytes":9052277,"errors":0},{"id":"maplestreet","title":"Maple Street","ok":true,"ttffMs":3463.900146484375,"ttffSource":"fcp","avgFps":59.90209657338007,"lowFps":51.15089514065973,"frames":1199,"drawCalls":null,"gpuDraws":null,"three":"172","heapBytes":18280304,"totalBytes":11474992,"jsBytes":10049655,"errors":1},{"id":"sandlot","title":"Sandlot Sluggers","ok":true,"ttffMs":3733.89990234375,"ttffSource":"canvas2d","avgFps":5.162622612287042,"lowFps":0.16667500041668748,"frames":99,"drawCalls":null,"gpuDraws":null,"three":null,"heapBytes":16738404,"totalBytes":10766091,"jsBytes":8956781,"errors":0},{"id":"shorttrack","title":"Short Track Showdown","ok":true,"ttffMs":10489.89990234375,"ttffSource":"webgl","avgFps":0.2833643853472277,"lowFps":0.11194447554013214,"frames":5,"drawCalls":1,"gpuDraws":459.4,"three":"160","heapBytes":25035808,"totalBytes":11389902,"jsBytes":9258948,"errors":0},{"id":"botwreck","title":"BotWreck 3D","ok":true,"ttffMs":4913.899999999907,"ttffSource":"webgl","avgFps":4.987480406326975,"lowFps":2.3073373327180358,"frames":99,"drawCalls":66.42424242424242,"gpuDraws":92.42424242424242,"three":"160","heapBytes":20594228,"totalBytes":10356090,"jsBytes":9266360,"errors":0},{"id":"pool","title":"8-Ball Pool","ok":true,"ttffMs":null,"ttffSource":"none","avgFps":59.651897150520945,"lowFps":37.783375314859036,"frames":1193,"drawCalls":null,"gpuDraws":null,"three":null,"heapBytes":14910216,"totalBytes":9965931,"jsBytes":8930404,"errors":0},{"id":"racing","title":"Max Secure Circuit","ok":true,"ttffMs":null,"ttffSource":"none","avgFps":59.65219567121231,"lowFps":37.759597230961226,"frames":1193,"drawCalls":null,"gpuDraws":null,"three":null,"heapBytes":14895140,"totalBytes":10486057,"jsBytes":9449925,"errors":0},{"id":"park","title":"Thrill Park","ok":true,"ttffMs":null,"ttffSource":"none","avgFps":59.80239209568383,"lowFps":44.82629809487795,"frames":1197,"drawCalls":null,"gpuDraws":null,"three":null,"heapBytes":15664164,"totalBytes":11760914,"jsBytes":10724724,"errors":0},{"id":"oval","title":"Oval Speedway","ok":true,"ttffMs":null,"ttffSource":"none","avgFps":59.852370824471414,"lowFps":47.71371769383456,"frames":1197,"drawCalls":null,"gpuDraws":null,"three":null,"heapBytes":15041732,"totalBytes":10486059,"jsBytes":9449925,"errors":0},{"id":"chess","title":"Chess","ok":true,"ttffMs":4315.800048828125,"ttffSource":"fcp","avgFps":59.75228324784186,"lowFps":42.194092827001576,"frames":1195,"drawCalls":null,"gpuDraws":null,"three":null,"heapBytes":15756868,"totalBytes":10085135,"jsBytes":8956837,"errors":0},{"id":"checkers","title":"Checkers","ok":true,"ttffMs":3982.300048828125,"ttffSource":"fcp","avgFps":59.55210809458276,"lowFps":34.20752565564254,"frames":1191,"drawCalls":null,"gpuDraws":null,"three":null,"heapBytes":15527336,"totalBytes":10069579,"jsBytes":8956805,"errors":0},{"id":"2048","title":"2048","ok":true,"ttffMs":4103.10009765625,"ttffSource":"fcp","avgFps":59.95245840110096,"lowFps":54.99541704857314,"frames":1199,"drawCalls":null,"gpuDraws":null,"three":null,"heapBytes":15432008,"totalBytes":10022361,"jsBytes":8932036,"errors":0},{"id":"helicopter","title":"Chopper Cave","ok":true,"ttffMs":4216.400048828218,"ttffSource":"canvas2d","avgFps":25.28053656649039,"lowFps":0.6593696426216533,"frames":491,"drawCalls":null,"gpuDraws":null,"three":null,"heapBytes":15641336,"totalBytes":10031122,"jsBytes":8932036,"errors":0}]}
-->
