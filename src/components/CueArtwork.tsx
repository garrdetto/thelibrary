import type { CueDesign } from '../lib/cue-design'

export function CueArtwork({ design, id }: { design: CueDesign; id: string }) {
  const shade = `${id}-shade`, clip = `${id}-clip`, pattern = `${id}-pattern`
  const team = ['brewers', 'badgers', 'bucks', 'cubs'].includes(design.preset)
  const patterned = design.preset !== 'plain' && design.preset !== 'custom'
  return <>
    <defs>
      <linearGradient id={shade} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#251b12" stopOpacity=".4"/><stop offset=".4" stopColor="#fff1d0" stopOpacity=".25"/><stop offset="1" stopColor="#251b12" stopOpacity=".45"/></linearGradient>
      <clipPath id={clip}><path d="M -332 -4 L -632 -6 L -632 6 L -332 4 Z"/></clipPath>
      <pattern id={pattern} width="24" height="12" patternUnits="userSpaceOnUse">
        {team ? <><image href={`/images/cues/${design.preset}.png`} x="0" y="-1" width="11" height="11"/><image href={`/images/cues/${design.preset}.png`} x="12" y="4" width="9" height="9"/></> :
          design.preset === 'money' ? <text x="3" y="9" fill="#d6c37a" fontSize="12" fontWeight="bold">$</text> :
          design.preset === 'checker' ? <path d="M0 0h6v6H0zM6 6h6v6H6zM12 0h6v6h-6zM18 6h6v6h-6z" fill="#f3ead6"/> :
          design.preset === 'stripes' ? <path d="M-6 12 6 0h5L-1 12zM6 12 18 0h5L11 12z" fill="#dfc080"/> :
          design.preset === 'diamonds' ? <path d="m6 1 4 5-4 5-4-5zM18 1l4 5-4 5-4-5z" fill="#e9d9ac"/> :
          design.preset === 'circuit' ? <path d="M0 3h7l4 6h13M0 9h4l4-6h16M14 0v3m4 6v3" fill="none" stroke="#8ec5a8" strokeWidth=".8"/> :
          design.preset === 'lightning' ? <path d="M7 0 2 7h4l-1 5 7-8H8l3-4z" fill="#ead076"/> :
          design.preset === 'hearts' ? <path d="M6 10 1 5C-1 0 5-1 6 3 8-1 14 0 11 5z" fill="#d78387"/> :
          <path d="m6 0 2 4 4 1-3 3 1 4-4-2-4 2 1-4-3-3 4-1z" fill="#e4c878"/>}
      </pattern>
    </defs>
    <path d="M-32-2-332-4v8l300-2z" fill={design.shaftColor}/>
    <path d="M-332-4-632-6V6l300-2z" fill={design.buttColor}/>
    {patterned && <path d="M-332-4-632-6V6l300-2z" fill={`url(#${pattern})`}/>}
    {design.preset === 'custom' && design.overlay && <image href={design.overlay} x="-632" y="-6" width="300" height="12" preserveAspectRatio="none" clipPath={`url(#${clip})`}/>}
    <path d="M-32-2-632-6V6l600-4z" fill={`url(#${shade})`} stroke="#493224" strokeWidth=".5"/>
    <path d="M-332-4v8" stroke="#d5c6a1" strokeWidth="2"/>
    <path d="M-39-2h7v4h-7z" fill="#fff9ed"/><path d="M-34-2h3v4h-3z" fill="#73a6a6"/>
  </>
}
