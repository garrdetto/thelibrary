/** DOM helpers and the stylesheet for The Hood's panels, using the library's --lib-* theme tokens. */

const CSS = `
.hd{position:absolute;inset:0;pointer-events:none;font:13px/1.35 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--lib-text,#e9effc);z-index:12}
.hd *{box-sizing:border-box}
.hd [hidden]{display:none!important}
.hd button{font:inherit;color:inherit;cursor:pointer}
.hd .panel{pointer-events:auto;background:color-mix(in srgb,var(--lib-panel,#111829) 92%,transparent);border:1px solid var(--lib-line,rgba(120,170,255,.16));border-radius:12px;box-shadow:0 8px 24px var(--lib-shadow,rgba(0,0,0,.45));backdrop-filter:blur(6px)}
.hd .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.hd .top{position:absolute;top:10px;left:10px;right:10px;display:flex;gap:8px;align-items:flex-start;justify-content:space-between;pointer-events:none}
.hd .top>*{pointer-events:auto}
.hd .card{padding:8px 12px}
.hd .title{font-weight:700;font-size:15px;color:var(--lib-strong,#fff)}
.hd .sub{color:var(--lib-soft,#aab6d3);font-size:12px}
.hd .btn{background:var(--lib-chip,rgba(255,255,255,.05));border:1px solid var(--lib-line,rgba(120,170,255,.16));border-radius:8px;padding:6px 10px;min-height:32px}
.hd .btn:hover{border-color:var(--hood-accent,#e8a33c)}
.hd .btn:focus-visible,.hd .sw:focus-visible,.hd .item:focus-visible{outline:2px solid var(--hood-accent,#e8a33c);outline-offset:2px}
.hd .btn.on{background:var(--hood-accent,#e8a33c);color:#1a1206;border-color:transparent;font-weight:700}
.hd .btn.primary{background:var(--hood-accent,#e8a33c);color:#1a1206;border-color:transparent;font-weight:700}
.hd .btn[disabled]{opacity:.45;cursor:default}
.hd .bottom{position:absolute;left:10px;right:10px;bottom:10px;display:flex;gap:8px;align-items:flex-end;justify-content:space-between;pointer-events:none}
.hd .bottom>*{pointer-events:auto}
.hd .needs{display:grid;grid-template-columns:repeat(2,minmax(120px,1fr));gap:4px 12px;margin-top:6px}
.hd .need{display:grid;grid-template-columns:62px 1fr;gap:6px;align-items:center;font-size:12px}
.hd .bar{height:8px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden}
.hd .bar>i{display:block;height:100%;border-radius:5px;transition:width .4s}
.hd .portraits{display:flex;gap:6px;margin-bottom:6px}
.hd .portrait{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 8px;border-radius:10px;border:1px solid var(--lib-line);background:var(--lib-chip);min-width:64px}
.hd .portrait.on{border-color:var(--hood-accent,#e8a33c);box-shadow:0 0 0 1px var(--hood-accent,#e8a33c) inset}
.hd .dot{width:22px;height:22px;border-radius:50%;border:2px solid rgba(255,255,255,.6)}
.hd .queue{display:flex;gap:4px;flex-wrap:wrap;margin-top:6px}
.hd .chip{font-size:11px;padding:2px 8px;border-radius:999px;background:var(--lib-chip);border:1px solid var(--lib-line)}
.hd .menu{position:absolute;min-width:180px;padding:6px;display:flex;flex-direction:column;gap:4px;z-index:3}
.hd .menu .head{font-weight:700;padding:2px 6px 4px;color:var(--lib-strong)}
.hd .menu .btn{text-align:left}
.hd .label{position:absolute;transform:translate(-50%,-100%);pointer-events:none;text-align:center;white-space:nowrap;text-shadow:0 1px 3px rgba(0,0,0,.8);font-size:12px;font-weight:600;color:#fff}
.hd .label .bubble{display:inline-block;background:#fff;color:#1d1d1d;border-radius:10px;padding:3px 8px;margin-bottom:3px;font-weight:600;text-shadow:none;box-shadow:0 2px 6px rgba(0,0,0,.3)}
.hd .label .act{display:block;font-weight:500;font-size:11px;opacity:.85}
.hd .lotlabel{pointer-events:auto;cursor:pointer;background:color-mix(in srgb,var(--lib-panel,#111829) 85%,transparent);border:1px solid var(--lib-line);border-radius:10px;padding:4px 9px;color:var(--lib-text);text-shadow:none;font-weight:500;transform:translate(-50%,-100%)}
.hd .lotlabel b{color:var(--lib-strong)}
.hd .lotlabel.mine{border-color:var(--hood-accent,#e8a33c)}
.hd .lotlabel.sale{opacity:.85;font-style:italic}
.hd .home{display:inline-block;width:8px;height:8px;border-radius:50%;background:#5bd77d;margin-right:4px}
.hd .away{display:inline-block;width:8px;height:8px;border-radius:50%;background:#7d8790;margin-right:4px}
.hd .dock{padding:8px;max-width:min(760px,calc(100vw - 20px))}
.hd .tools{display:flex;gap:6px;flex-wrap:wrap}
.hd .items{display:grid;grid-template-columns:repeat(auto-fill,minmax(118px,1fr));gap:6px;max-height:190px;overflow:auto;margin-top:6px}
.hd .item{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:6px 8px;border-radius:8px;border:1px solid var(--lib-line);background:var(--lib-chip);text-align:left}
.hd .item.on{border-color:var(--hood-accent,#e8a33c)}
.hd .item small{color:var(--lib-muted,#8d9bba)}
.hd .sw{width:26px;height:26px;border-radius:6px;border:2px solid rgba(255,255,255,.25);padding:0}
.hd .sw.on{border-color:var(--hood-accent,#e8a33c)}
.hd .sw.sm{width:20px;height:20px;border-radius:5px;border-width:2px}
.hd .swatches{display:flex;flex-wrap:wrap;gap:4px}
.hd .designer{max-height:min(240px,38vh);overflow:auto;margin-top:6px;padding-right:4px}
.hd .chips{display:flex;gap:3px;margin:3px 0}
.hd .chips i{width:14px;height:14px;border-radius:3px;display:inline-block;border:1px solid rgba(255,255,255,.25)}
.hd .modal{position:absolute;inset:0;background:rgba(5,8,16,.55);display:flex;align-items:center;justify-content:center;pointer-events:auto;z-index:5}
.hd .dialog{max-width:min(720px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:16px 18px}
.hd .dialog h2{margin:0 0 4px;font-size:18px;color:var(--lib-strong)}
.hd .dialog p{margin:4px 0 10px;color:var(--lib-soft)}
.hd .field{display:flex;flex-direction:column;gap:4px;margin:6px 0}
.hd .field>span{font-size:12px;color:var(--lib-soft)}
.hd input[type=text]{background:var(--lib-panel2,#18213a);border:1px solid var(--lib-line);border-radius:8px;color:var(--lib-text);padding:7px 9px;font:inherit;min-height:34px}
.hd .simcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.hd .simcard{border:1px solid var(--lib-line);border-radius:10px;padding:10px;background:var(--lib-chip)}
.hd .list{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.hd .person{display:flex;gap:6px;align-items:center;justify-content:space-between;padding:6px 8px;border:1px solid var(--lib-line);border-radius:8px}
.hd .side{position:absolute;right:10px;top:64px;width:min(320px,calc(100vw - 20px));padding:12px;max-height:calc(100% - 140px);overflow:auto}
.hd .side.wide{width:min(560px,calc(100vw - 20px))}
.hd .toggle{display:flex;gap:8px;align-items:center;margin:6px 0}
.hd .loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(5,8,16,.6);font-size:16px;font-weight:600;pointer-events:auto;z-index:6;transition:opacity .3s}
.hd .townlabel{font-size:11px;font-weight:600;background:rgba(10,14,24,.72);border-radius:8px;padding:2px 7px;text-shadow:none}
.hd .townlabel.player{border:1px solid var(--hood-accent,#e8a33c)}
.hd .townlabel .act{font-weight:500;opacity:.85}
.hd .feed{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.hd .feed .item2{display:grid;grid-template-columns:52px 1fr;gap:6px;font-size:12px;line-height:1.3}
.hd .feed .time{color:var(--lib-muted,#8d9bba);font-variant-numeric:tabular-nums}
.hd .feed .k-fire{color:#ff8a5a}.hd .feed .k-medical{color:#7fc4ff}.hd .feed .k-crime{color:#b8a4ff}.hd .feed .k-crash{color:#ffd166}.hd .feed .k-service{color:var(--hood-accent,#e8a33c)}
.hd .places{display:grid;grid-template-columns:1fr;gap:4px;margin-top:6px}
.hd .place{display:flex;flex-direction:column;align-items:flex-start;gap:1px;padding:6px 8px;border-radius:8px;border:1px solid var(--lib-line);background:var(--lib-chip);text-align:left}
.hd .place small{color:var(--lib-muted,#8d9bba)}
.hd .ticker{max-width:min(460px,calc(100vw - 20px));padding:6px 10px;font-size:12px}
.hd .ticker b{color:var(--hood-accent,#e8a33c)}
.hd .jobs{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px;margin-top:8px}
.hd .job{border:1px solid var(--lib-line);border-radius:10px;padding:8px 10px;background:var(--lib-chip);display:flex;flex-direction:column;gap:4px}
.hd .job .sw2{width:14px;height:14px;border-radius:4px;display:inline-block;vertical-align:-2px;margin-right:6px}
.hd .tasks{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px;margin-top:6px}
.hd .task{display:flex;flex-direction:column;align-items:flex-start;gap:2px;padding:6px 8px;border-radius:8px;border:1px solid var(--lib-line);background:var(--lib-chip);text-align:left}
.hd .task.call{border-color:#ff8a5a}
.hd .task small{color:var(--lib-muted,#8d9bba)}
.hd .progress{height:6px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden;margin-top:4px}
.hd .progress>i{display:block;height:100%;background:var(--hood-accent,#e8a33c)}
.hd .hint{font-size:12px;color:var(--lib-muted,#8d9bba);margin-top:4px}
.hd .btn.sm{min-height:26px;padding:3px 8px;font-size:12px}
.hd .btn.danger{border-color:rgba(232,83,60,.55);color:#ffb3a6}
.hd .btn.danger:hover{border-color:#e8533c}
.hd .nav{display:flex;align-items:center;flex-wrap:wrap;gap:2px;padding:6px}
.hd .navgroup{display:flex;gap:4px;align-items:center;padding:0 6px;border-left:1px solid var(--lib-line,rgba(120,170,255,.16))}
.hd .navgroup:first-child{border-left:0;padding-left:0}
.hd .navgroup:not(:has(> :not([hidden]))){display:none}
.hd .side.mid{width:min(430px,calc(100vw - 20px))}
.hd .portraits{flex-wrap:wrap;max-width:min(560px,calc(100vw - 40px))}
.hd .portrait{min-width:56px;padding:4px 6px}
.hd .portrait small{font-size:10px;line-height:1}
.hd .chip.stage-baby{background:#ffd6e5;color:#5a2236;border-color:transparent}
.hd .chip.stage-toddler{background:#ffe8b8;color:#5a3d10;border-color:transparent}
.hd .chip.stage-child{background:#c9f0d4;color:#17462a;border-color:transparent}
.hd .chip.stage-teen{background:#cfe1ff;color:#17305a;border-color:transparent}
.hd .chip.stage-adult{opacity:.85}
.hd .chip.baby{background:#fff0c9;color:#5a3d10;border-color:transparent}
.hd .chip.st-work{border-color:#7fc4ff}.hd .chip.st-resort{border-color:#3fb8a8}.hd .chip.st-visiting{border-color:#b8a4ff}
.hd .famrow{border:1px solid var(--lib-line);border-radius:10px;padding:8px 10px;background:var(--lib-chip)}
.hd .famrow.on{border-color:var(--hood-accent,#e8a33c)}
.hd details.tip{margin:6px 0;font-size:12px;color:var(--lib-soft,#aab6d3)}
.hd details.tip summary,.hd details.looks summary{cursor:pointer;font-weight:600;color:var(--lib-text)}
.hd details.tip ul{margin:6px 0 0 16px;padding:0;display:flex;flex-direction:column;gap:4px}
.hd details.looks{margin-top:4px}
.hd .keys{display:grid;grid-template-columns:auto 1fr;gap:6px 10px;align-items:center;margin-top:8px}
.hd kbd{font:600 11px/1 ui-monospace,Menlo,Consolas,monospace;background:var(--lib-chip);border:1px solid var(--lib-line);border-bottom-width:2px;border-radius:5px;padding:3px 6px;white-space:nowrap;justify-self:start}
.hd .menu{min-width:220px;max-width:300px}
.hd .menu .btn[disabled]{opacity:.6;display:flex;flex-direction:column;align-items:flex-start}
.hd .menu .why{font-size:11px;color:var(--lib-muted,#8d9bba);font-weight:400}
.hd .dock{max-width:min(940px,calc(100vw - 20px))}
.hd .buyhead{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.hd input[type=search],.hd select{background:var(--lib-panel2,#18213a);border:1px solid var(--lib-line);border-radius:8px;color:var(--lib-text);padding:6px 9px;font:inherit;min-height:32px}
.hd input[type=search]{flex:1;min-width:180px}
.hd input[type=search]:focus-visible,.hd select:focus-visible,.hd input[type=text]:focus-visible{outline:2px solid var(--hood-accent,#e8a33c);outline-offset:1px}
.hd .toggle.sm{margin:0;font-size:12px}
.hd .cattabs{display:flex;gap:4px;flex-wrap:wrap;padding:6px 0 4px}
.hd .btn.cat{white-space:nowrap;display:inline-flex;gap:5px;align-items:center;padding:4px 9px;min-height:30px}
.hd .btn.cat .count{font-size:10px;opacity:.75;background:rgba(255,255,255,.08);border-radius:999px;padding:1px 6px}
.hd .btn.cat.on .count{background:rgba(0,0,0,.15)}
.hd .buyitems{grid-template-columns:repeat(auto-fill,minmax(172px,1fr));max-height:min(230px,30vh)}
.hd .item.card{gap:4px}
.hd .item.card .name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.hd .item.card .chips{margin:0;flex:none}
.hd .item .meta{display:flex;gap:8px;font-size:11px;color:var(--lib-muted,#8d9bba)}
.hd .item .price{color:var(--lib-strong,#fff);font-weight:600}
.hd .item .price.cant{color:#ff9a8a}
.hd .item.cant{opacity:.6}
.hd .badges{display:flex;flex-wrap:wrap;gap:3px}
.hd .nb{font-size:10px;padding:1px 6px;border-radius:999px;background:rgba(255,255,255,.07);border:1px solid var(--lib-line)}
.hd .nb.age{background:#fff0c9;color:#5a3d10;border-color:transparent}
.hd .nb.muted{opacity:.7}
.hd .buyfoot{margin-top:6px}
@media (max-width:640px){.hd .nav .btn{padding:4px 7px;font-size:12px}.hd .buyitems{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}}
@media (max-width:640px){.hd .needs{grid-template-columns:1fr}.hd .side{top:auto;bottom:10px;max-height:55%}}
@media (prefers-reduced-motion:reduce){.hd .bar>i,.hd .loading{transition:none}}
`

let installed = false

export function installStyles(accent: string): HTMLDivElement {
  if (!installed) {
    const style = document.createElement('style')
    style.textContent = CSS
    document.head.appendChild(style)
    installed = true
  }
  const root = document.createElement('div')
  root.className = 'hd'
  root.style.setProperty('--hood-accent', accent)
  return root
}

type Child = Node | string | null | undefined | false

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue
    if (key === 'class') node.className = String(value)
    else if (key === 'style') node.setAttribute('style', String(value))
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value as EventListener)
    else if (key === 'text') node.textContent = String(value)
    else node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children) if (child !== null && child !== undefined && child !== false) node.append(child)
  return node
}

export function button(label: string, onClick: () => void, cls = 'btn', title?: string): HTMLButtonElement {
  return el('button', { type: 'button', class: cls, onclick: onClick, title, 'aria-label': /[A-Za-z]/.test(label) ? undefined : title }, label)
}

export function needColor(value: number): string {
  if (value > 66) return '#5bd77d'
  if (value > 40) return '#e8c94a'
  if (value > 20) return '#e8913c'
  return '#e8533c'
}

export function money(value: number): string {
  return `$${Math.floor(value).toLocaleString('en-US')}`
}
