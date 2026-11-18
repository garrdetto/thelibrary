export type RadioArea = 'Milwaukee' | 'Madison' | 'Green Bay & Fox Valley' | 'Statewide' | 'Around Wisconsin'
export type RadioStation = { id: string; name: string; dial: string; city: string; format: string; area: RadioArea; url: string }

export const radioAreas: RadioArea[] = ['Milwaukee', 'Madison', 'Green Bay & Fox Valley', 'Statewide', 'Around Wisconsin']

const iheart = (id: number) => `https://stream.revma.ihrhls.com/zc${id}`
const triton = (mount: string) => `https://playerservices.streamtheworld.com/api/livestream-redirect/${mount}`
const amperwave = (mount: string) => `https://live.amperwave.net/direct/${mount}`
const woodward = (id: string) => `https://woodward-radio.streamb.live/${id}`

export const radioStations: RadioStation[] = [
  { id: 'wtmj', name: '620 WTMJ', dial: '620 AM', city: 'Milwaukee', format: 'News & talk', area: 'Milwaukee', url: amperwave('goodkarma-wtmjamaac-ibc') },
  { id: 'wkti', name: '94.5 ESPN Milwaukee', dial: '94.5 FM', city: 'Milwaukee', format: 'Sports', area: 'Milwaukee', url: amperwave('goodkarma-wktifmaac-ibc2') },
  { id: 'wklh', name: '96.5 WKLH', dial: '96.5 FM', city: 'Milwaukee', format: 'Classic rock', area: 'Milwaukee', url: amperwave('saga-wklhfmaac-ibc2') },
  { id: 'wrnw', name: 'B97.3', dial: '97.3 FM', city: 'Milwaukee', format: 'Hits', area: 'Milwaukee', url: iheart(2685) },
  { id: 'wjmr', name: '98.3 WJMR', dial: '98.3 FM', city: 'Milwaukee', format: 'Hip hop & R&B', area: 'Milwaukee', url: amperwave('saga-wjmrfmaac-ibc2') },
  { id: 'wmyx', name: '99.1 The Mix', dial: '99.1 FM', city: 'Milwaukee', format: 'Adult contemporary', area: 'Milwaukee', url: amperwave('audacy-wmyxfmaac-imc') },
  { id: 'wkkv', name: 'V100.7', dial: '100.7 FM', city: 'Milwaukee', format: 'Hip hop & R&B', area: 'Milwaukee', url: iheart(2673) },
  { id: 'whqg', name: '102.9 The Hog', dial: '102.9 FM', city: 'Milwaukee', format: 'Rock', area: 'Milwaukee', url: amperwave('saga-whqgfmaac-ibc2') },
  { id: 'wxss', name: '103.7 Kiss FM', dial: '103.7 FM', city: 'Milwaukee', format: 'Top 40', area: 'Milwaukee', url: amperwave('audacy-wxssfmaac-imc') },
  { id: 'wssp', name: '1250 / 105.7 The Fan', dial: '105.7 FM', city: 'Milwaukee', format: 'Sports', area: 'Milwaukee', url: amperwave('audacy-wsspamaac-imc') },
  { id: 'wmil', name: 'FM106.1', dial: '106.1 FM', city: 'Milwaukee', format: 'Country', area: 'Milwaukee', url: iheart(2677) },
  { id: 'wrxs', name: 'Pure Oldies 106.9', dial: '106.9 FM', city: 'Milwaukee', format: 'Oldies', area: 'Milwaukee', url: amperwave('saga-wrxsfmmp3-ibc2') },
  { id: 'writ', name: '95.7 Big FM', dial: '95.7 FM', city: 'Milwaukee', format: '80s & 90s', area: 'Milwaukee', url: iheart(2689) },
  { id: 'wisn', name: 'NewsTalk 1130 WISN', dial: '1130 AM', city: 'Milwaukee', format: 'News & talk', area: 'Milwaukee', url: iheart(4245) },
  { id: 'wuwm', name: '89.7 WUWM', dial: '89.7 FM', city: 'Milwaukee', format: 'NPR news', area: 'Milwaukee', url: 'https://www.tundracast.stream:3040/mount1' },
  { id: 'wyms', name: '88Nine Radio Milwaukee', dial: '88.9 FM', city: 'Milwaukee', format: 'Indie & local music', area: 'Milwaukee', url: 'https://wyms.streamguys1.com/live' },
  { id: 'wmse', name: '91.7 WMSE', dial: '91.7 FM', city: 'Milwaukee', format: 'Independent music', area: 'Milwaukee', url: 'https://wmse.streamguys1.com/wmselivemp3' },
  { id: 'wlip', name: 'NewsRadio 1050 WLIP', dial: '1050 AM', city: 'Kenosha', format: 'News & talk', area: 'Milwaukee', url: amperwave('alphacorporate-wlipamaac-ibc4') },

  { id: 'wiba-fm', name: '101.5 IBA FM', dial: '101.5 FM', city: 'Madison', format: 'Classic rock', area: 'Madison', url: iheart(3466) },
  { id: 'wzee', name: 'Z104', dial: '104.1 FM', city: 'Madison', format: 'Top 40', area: 'Madison', url: iheart(3506) },
  { id: 'wjjo', name: '94.1 WJJO', dial: '94.1 FM', city: 'Madison', format: 'Rock', area: 'Madison', url: triton('WJJOFMAAC.aac') },
  { id: 'wolx', name: '94.9 WOLX', dial: '94.9 FM', city: 'Madison', format: 'Classic hits', area: 'Madison', url: amperwave('audacy-wolxfmaac-imc') },
  { id: 'wmmm', name: '105.5 Triple M', dial: '105.5 FM', city: 'Madison', format: 'Adult alternative', area: 'Madison', url: amperwave('audacy-wmmmfmaac-imc') },
  { id: 'wmad', name: '96.3 Star Country', dial: '96.3 FM', city: 'Madison', format: 'Country', area: 'Madison', url: iheart(3510) },
  { id: 'wwqm', name: 'Q106', dial: '106.3 FM', city: 'Madison', format: 'Country', area: 'Madison', url: triton('WWQMFMAAC.aac') },
  { id: 'wmgn', name: 'Magic 98', dial: '98.1 FM', city: 'Madison', format: 'Classic hits', area: 'Madison', url: triton('WMGNFMAAC.aac') },
  { id: 'wxxm', name: 'Rewind 92.1', dial: '92.1 FM', city: 'Madison', format: 'Hits', area: 'Madison', url: iheart(2665) },
  { id: 'wiba-am', name: 'NewsTalk 1310 WIBA', dial: '1310 AM', city: 'Madison', format: 'News & talk', area: 'Madison', url: iheart(2661) },
  { id: 'wtso', name: 'Fox Sports 1070', dial: '1070 AM', city: 'Madison', format: 'Sports', area: 'Madison', url: iheart(3502) },
  { id: 'wort', name: '89.9 WORT', dial: '89.9 FM', city: 'Madison', format: 'Community radio', area: 'Madison', url: 'https://stream.wortfm.org:8443/high.mp3' },

  { id: 'wixx', name: 'WIXX 101', dial: '101.1 FM', city: 'Green Bay', format: 'Top 40', area: 'Green Bay & Fox Valley', url: triton('WIXXFMAAC.aac') },
  { id: 'wncy', name: 'Y100', dial: '100.3 FM', city: 'Green Bay', format: 'Country', area: 'Green Bay & Fox Valley', url: triton('WNCYFMAAC.aac') },
  { id: 'wtaq', name: 'NewsTalk WTAQ', dial: '97.5 FM', city: 'Green Bay', format: 'News & talk', area: 'Green Bay & Fox Valley', url: triton('WTAQAMAAC.aac') },
  { id: 'wduz', name: '107.5 The Fan', dial: '107.5 FM', city: 'Green Bay', format: 'Sports', area: 'Green Bay & Fox Valley', url: triton('WDUZFMAAC.aac') },
  { id: 'wnfl', name: 'WNFL Sports Talk', dial: '1440 AM', city: 'Green Bay', format: 'Sports', area: 'Green Bay & Fox Valley', url: triton('WNFLAMAAC.aac') },
  { id: 'wqlh', name: 'Star 98', dial: '98.5 FM', city: 'Green Bay', format: 'Hits', area: 'Green Bay & Fox Valley', url: triton('WQLHFMAAC.aac') },
  { id: 'wogb', name: '103.1 WOGB', dial: '103.1 FM', city: 'Green Bay', format: 'Classic hits', area: 'Green Bay & Fox Valley', url: triton('WOGBFMAAC.aac') },
  { id: 'wgee', name: 'Duke FM', dial: '93.5 FM', city: 'Green Bay', format: 'Classic country', area: 'Green Bay & Fox Valley', url: triton('WGEEFMAAC.aac') },
  { id: 'wzor', name: 'Razor 94.7', dial: '94.7 FM', city: 'Green Bay', format: 'Rock', area: 'Green Bay & Fox Valley', url: woodward('SB00039') },
  { id: 'wapl', name: '105.7 WAPL', dial: '105.7 FM', city: 'Appleton', format: 'Rock', area: 'Green Bay & Fox Valley', url: woodward('SB00020') },
  { id: 'wksz', name: '95.9 Kiss FM', dial: '95.9 FM', city: 'Appleton', format: 'Top 40', area: 'Green Bay & Fox Valley', url: woodward('SB00132') },
  { id: 'wfzz', name: '104.3 The Fuse', dial: '104.3 FM', city: 'Appleton', format: 'Hits', area: 'Green Bay & Fox Valley', url: woodward('SB00052') },
  { id: 'wpkr', name: '99.5 PKR', dial: '99.5 FM', city: 'Oshkosh', format: 'Country', area: 'Green Bay & Fox Valley', url: triton('WPKRFMAAC.aac') },

  { id: 'wpr-news', name: 'WPR News', dial: 'Statewide', city: 'Wisconsin Public Radio', format: 'NPR & BBC news, talk', area: 'Statewide', url: 'https://wpr-ice.streamguys1.com/wpr-ideas-mp3-64' },
  { id: 'wpr-music', name: 'WPR Music', dial: 'Statewide', city: 'Wisconsin Public Radio', format: 'Classical, jazz, folk', area: 'Statewide', url: 'https://wpr-ice.streamguys1.com/wpr-music-mp3-96' },

  { id: 'whbz', name: '106.5 The Buzz', dial: '106.5 FM', city: 'Sheboygan', format: 'Rock', area: 'Around Wisconsin', url: triton('WHBZFM.mp3') },
  { id: 'wbfm', name: 'Country B93', dial: '93.7 FM', city: 'Sheboygan', format: 'Country', area: 'Around Wisconsin', url: triton('WBFMFM.mp3') },
  { id: 'wifc', name: '95-5 WIFC', dial: '95.5 FM', city: 'Wausau', format: 'Top 40', area: 'Around Wisconsin', url: triton('WIFCFMAAC.aac') },
  { id: 'wdez', name: 'Country 101.9 WDEZ', dial: '101.9 FM', city: 'Wausau', format: 'Country', area: 'Around Wisconsin', url: triton('WDEZFMAAC.aac') },
  { id: 'wspt', name: '97.9 WSPT', dial: '97.9 FM', city: 'Stevens Point', format: 'Variety', area: 'Around Wisconsin', url: 'https://ice7.securenetsystems.net/CWTO' },
  { id: 'wwsp', name: '90FM WWSP', dial: '89.9 FM', city: 'Stevens Point', format: 'College radio', area: 'Around Wisconsin', url: 'https://a6.asurahosting.com:8210/radio.mp3' },
  { id: 'wial', name: 'i94.1', dial: '94.1 FM', city: 'Eau Claire', format: 'Top 40', area: 'Around Wisconsin', url: triton('WIALFMAAC.aac') },
  { id: 'waxx', name: '104.5 WAXX', dial: '104.5 FM', city: 'Eau Claire', format: 'Country', area: 'Around Wisconsin', url: triton('WAXXFMAAC.aac') },
  { id: 'wmeq', name: 'Classic Rock 92.1', dial: '92.1 FM', city: 'Eau Claire', format: 'Classic rock', area: 'Around Wisconsin', url: iheart(2645) },
  { id: 'wecl', name: '92.9 WECL', dial: '92.9 FM', city: 'Eau Claire', format: 'Rock', area: 'Around Wisconsin', url: triton('WECLFM.mp3') },
  { id: 'wizm', name: 'NewsTalk 1410 WIZM', dial: '1410 AM', city: 'La Crosse', format: 'News & talk', area: 'Around Wisconsin', url: triton('WIZMAMAAC.aac') },
  { id: 'wlge', name: '106.9 The Lodge', dial: '106.9 FM', city: 'Baraboo', format: 'Variety', area: 'Around Wisconsin', url: 'https://ice26.securenetsystems.net/WLGE' },
]

export const findStation = (id: string | undefined) => radioStations.find(station => station.id === id)
