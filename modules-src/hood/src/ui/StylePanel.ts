/** The exterior designer: presets, cladding top and bottom with a wainscot, trim, windows and shutters, doors and lights, roof and inside walls. */
import {
  CLADDINGS, CLADDING_COST, CLADDING_LABELS, DOOR_STYLES, FOUNDATIONS, OVERHANGS, PAINTS, PITCHES, ROOF_MATERIALS, ROOF_MATERIAL_LABELS, ROOF_STYLES,
  SHUTTERS, STYLE_PRESETS, WAINSCOT_LABELS, WINDOW_GRIDS, type HouseStyle,
} from '../../shared/Style'
import { button, el } from './Ui'

export type StyleTab = 'presets' | 'siding' | 'trim' | 'doors' | 'roof' | 'inside'

const TABS: [StyleTab, string][] = [['presets', 'Looks'], ['siding', 'Siding'], ['trim', 'Trim & windows'], ['doors', 'Doors & lights'], ['roof', 'Roof'], ['inside', 'Inside walls']]

const LABELS: Record<string, string> = {
  none: 'None', panel: 'Raised panel', louvered: 'Louvered', board: 'Board and batten', cross: 'Cross', colonial: 'Colonial grid', prairie: 'Prairie',
  craftsman: 'Craftsman', glass: 'Full glass', farmhouse: 'Farmhouse', modern: 'Modern', hip: 'Hip', gable: 'Gable', flat: 'Flat',
  stone: 'Stone', brick: 'Brick', concrete: 'Concrete',
}

export function paletteRow(label: string, value: number, onPick: (index: number) => void): HTMLElement {
  const row = el('div', { class: 'swatches', role: 'radiogroup', 'aria-label': label })
  PAINTS.forEach((p, i) => {
    const b = el('button', { type: 'button', class: `sw sm${value === i ? ' on' : ''}`, style: `background:${p.color}`, title: p.name, role: 'radio', 'aria-checked': String(value === i), 'aria-label': `${label}: ${p.name}` })
    b.addEventListener('click', () => onPick(i))
    row.append(b)
  })
  return el('div', { class: 'field' }, el('span', {}, `${label} · ${PAINTS[value]?.name ?? ''}`), row)
}

export function choiceRow<T extends string | number>(label: string, options: readonly T[], value: T, names: (option: T) => string, onPick: (option: T) => void): HTMLElement {
  const row = el('div', { class: 'row', role: 'radiogroup', 'aria-label': label })
  for (const option of options) {
    const b = button(names(option), () => onPick(option), `btn${option === value ? ' on' : ''}`)
    b.setAttribute('role', 'radio')
    b.setAttribute('aria-checked', String(option === value))
    row.append(b)
  }
  return el('div', { class: 'field' }, el('span', {}, label), row)
}

function toggle(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el('input', { type: 'checkbox' }) as HTMLInputElement
  input.checked = value
  input.addEventListener('change', () => onChange(input.checked))
  return el('label', { class: 'toggle' }, input, el('span', {}, label))
}

export function renderStylePanel(style: HouseStyle, tab: StyleTab, setTab: (tab: StyleTab) => void, send: (patch: Partial<HouseStyle>) => void): HTMLElement {
  const tabs = el('div', { class: 'tools', role: 'tablist', 'aria-label': 'Exterior designer' }, ...TABS.map(([id, label]) => {
    const b = button(label, () => setTab(id), `btn${tab === id ? ' on' : ''}`)
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-selected', String(tab === id))
    return b
  }))
  const body = el('div', { class: 'designer' })
  const name = (o: string | number) => LABELS[String(o)] ?? String(o)
  switch (tab) {
    case 'presets':
      body.append(el('div', { class: 'items' }, ...STYLE_PRESETS.map(preset => {
        const s = { ...style, ...preset.style }
        const b = el('button', { type: 'button', class: 'item' },
          el('b', {}, preset.name),
          el('span', { class: 'chips' }, ...[s.upperColor, s.wainscot ? s.lowerColor : s.upperColor, s.trimColor, s.roofColor, s.doorColor].map(c => el('i', { style: `background:${PAINTS[c].color}` }))),
          el('small', {}, `${CLADDING_LABELS[s.upper]}${s.wainscot ? ` over ${CLADDING_LABELS[s.lower].toLowerCase()}` : ''} · ${name(s.roofStyle)} roof`))
        b.addEventListener('click', () => send(preset.style))
        return b
      })))
      break
    case 'siding':
      body.append(
        choiceRow('Main siding', CLADDINGS, style.upper, c => `${CLADDING_LABELS[c]} ($${CLADDING_COST[c]})`, v => send({ upper: v })),
        paletteRow('Main siding color', style.upperColor, i => send({ upperColor: i })),
        choiceRow('Lower wainscot height', [0, 1, 2, 3], style.wainscot, i => WAINSCOT_LABELS[i], v => send({ wainscot: v })),
        style.wainscot ? choiceRow('Wainscot material', CLADDINGS, style.lower, c => CLADDING_LABELS[c], v => send({ lower: v })) : el('span'),
        style.wainscot ? paletteRow('Wainscot color', style.lowerColor, i => send({ lowerColor: i })) : el('span'),
        choiceRow('Foundation', FOUNDATIONS, style.foundation, name, v => send({ foundation: v })),
      )
      break
    case 'trim':
      body.append(
        paletteRow('Trim color', style.trimColor, i => send({ trimColor: i })),
        choiceRow('Trim width', [0, 1, 2], style.trimWidth, i => ['Slim', 'Classic', 'Bold'][i], v => send({ trimWidth: v })),
        toggle('Corner boards', style.cornerBoards, v => send({ cornerBoards: v })),
        choiceRow('Window grids', WINDOW_GRIDS, style.windowGrid, name, v => send({ windowGrid: v })),
        choiceRow('Shutters', SHUTTERS, style.shutters, name, v => send({ shutters: v })),
        style.shutters !== 'none' ? paletteRow('Shutter color', style.shutterColor, i => send({ shutterColor: i })) : el('span'),
        toggle('Flower boxes under the windows', style.windowBoxes, v => send({ windowBoxes: v })),
      )
      break
    case 'doors':
      body.append(
        choiceRow('Door style', DOOR_STYLES, style.doorStyle, name, v => send({ doorStyle: v })),
        paletteRow('Door color', style.doorColor, i => send({ doorColor: i })),
        toggle('Lanterns beside outside doors', style.porchLights, v => send({ porchLights: v })),
        el('div', { class: 'hint' }, 'Add canopies over doors and windows with the Canopy tool.'),
      )
      break
    case 'roof':
      body.append(
        choiceRow('Roof shape', ROOF_STYLES, style.roofStyle, name, v => send({ roofStyle: v })),
        choiceRow('Roofing', ROOF_MATERIALS, style.roofMaterial, m => ROOF_MATERIAL_LABELS[m], v => send({ roofMaterial: v })),
        paletteRow('Roof color', style.roofColor, i => send({ roofColor: i })),
        choiceRow('Pitch', PITCHES.map((_, i) => i), style.pitch, i => ['Low', 'Medium', 'Steep'][i], v => send({ pitch: v })),
        choiceRow('Overhang', OVERHANGS.map((_, i) => i), style.overhang, i => ['Tight', 'Standard', 'Deep'][i], v => send({ overhang: v })),
        toggle('Gutters', style.gutters, v => send({ gutters: v })),
      )
      break
    case 'inside':
      body.append(paletteRow('Inside wall color', style.interiorColor, i => send({ interiorColor: i })))
      break
  }
  return el('div', {}, tabs, body)
}
