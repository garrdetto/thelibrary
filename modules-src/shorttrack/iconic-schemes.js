// Iconic NASCAR look-alike paint schemes for the Short Track Showdown AI field.
// Each car number carries the best-known scheme that number ran in the Cup Series, with
// parody driver names and knockoff sponsor logos (no real trademarks are reproduced).
//
// Side art is written in a normalized frame: t runs 0 (front bumper) -> 1 (rear bumper),
// s runs 0 (rocker) -> 1 (beltline). The same ops draw on the race-truck side decals and on
// the Super Late Model texture atlas, so a scheme looks the same on either vehicle.
//   ['band', s0, s1, color, t0?, t1?]           horizontal band
//   ['poly', [[t,s],...], color]                 filled polygon
//   ['streak', t0,s0, t1,s1, w0,w1, color]       tapered stripe from (t0,s0) to (t1,s1); w = thickness in s
//   ['logo', t, s, widthMetres, logoKey]         knockoff sponsor logo (keys in LOGOS)
// Hood art (forward metres f, lateral metres l; the hood runs from about f 1.05 to the nose):
//   hood: {color, nose:[color,depth], stripes:[[halfWidth,color],...], logo:[key,widthMetres,f]}
// roof / deck: colors for the stock car's roof and rear deck (default: body color).

export const LOGOS={
  goodfix:{kind:'box',text:'GOODFIX',sub:'SERVICE PLUS',bg:'#0d0d0d',fg:'#ffffff',sfg:'#c8102e',edge:'#1e4fb4',aspect:0.42},
  dupaint:{kind:'oval',text:'DUPAINT',bg:'#e4252b',fg:'#ffffff',edge:'#ffffff',aspect:0.42},
  spt:{kind:'oval',text:'SPT',bg:'#e4252b',fg:'#ffffff',edge:'#ffffff',aspect:0.5},
  brewmaster:{kind:'script',text:'Budwize',fg:'#ffffff',edge:'#111111',aspect:0.32},
  upx:{kind:'shield',text:'UPX',bg:'#4b2e1e',fg:'#f2b10e',edge:'#f2b10e',aspect:0.9},
  lowez:{kind:'house',text:"LOWE'Z",bg:'#0b4ea2',fg:'#ffffff',edge:'#ffffff',aspect:0.5},
  homedepo:{kind:'box',text:'THE HOME',sub:'DEPO',bg:'#f96302',fg:'#ffffff',sfg:'#ffffff',edge:'#ffffff',aspect:0.62,stroke:'#111111'},
  draught:{kind:'oval',text:'MILLAR',sub:'GENUINE DRAUGHT',bg:'#111111',fg:'#c9a227',sfg:'#e4252b',edge:'#c9a227',aspect:0.48},
  valvolube:{kind:'v',text:'VALVOLUBE',bg:'#0a3d91',fg:'#ffffff',edge:'#e31837',aspect:0.32},
  bigbun:{kind:'arches',text:'BIG BUN',bg:'#da291c',fg:'#ffc72c',edge:'#ffc72c',aspect:0.62},
  kelloggz:{kind:'script',text:"Kelloggz",fg:'#d71920',edge:'#ffffff',bg:'#ffffff',aspect:0.34,pad:true},
  coorz:{kind:'box',text:'COORZ',sub:'MOUNTAIN BREW',bg:'#ffffff',fg:'#c8102e',sfg:'#8a6d2f',edge:'#c5a253',aspect:0.42},
  fedez:{kind:'split',text:'Fed',text2:'Ez',fg:'#4d148c',fg2:'#ff6600',bg:'#ffffff',aspect:0.36},
  dewolt:{kind:'box',text:'DEWOLT',bg:'#111111',fg:'#febd17',edge:'#febd17',aspect:0.3},
  interstake:{kind:'box',text:'INTERSTAKE',sub:'BATTERIES',bg:'#ffffff',fg:'#00843d',sfg:'#111111',edge:'#111111',aspect:0.36},
  havolube:{kind:'star',text:'HAVOLUBE',bg:'#ffffff',fg:'#111111',star:'#d71920',edge:'#d71920',aspect:0.5},
  motorkraft:{kind:'oval',text:'MOTORKRAFT',bg:'#1b3f8b',fg:'#ffffff',edge:'#ffffff',aspect:0.34},
  aflaq:{kind:'box',text:'AFLAQ!',bg:'#00539b',fg:'#ffffff',edge:'#ffffff',aspect:0.36},
  shellzoil:{kind:'shell',text:'SHELLZOIL',bg:'#ffd500',fg:'#e0201b',edge:'#e0201b',aspect:0.5},
  nappa:{kind:'box',text:'NAPPA',sub:'AUTO PARTS',bg:'#ffd100',fg:'#003da5',sfg:'#003da5',edge:'#003da5',aspect:0.42},
  kodiak:{kind:'box',text:'KODIAK',sub:'FILM',bg:'#d10a11',fg:'#ffcc00',sfg:'#ffffff',edge:'#ffcc00',aspect:0.42},
  goduddy:{kind:'split',text:'Go',text2:'Duddy',fg:'#111111',fg2:'#111111',bg:'#7bd12f',aspect:0.34,edge:'#ffffff'},
  goodfix29:{kind:'box',text:'GOODFIX',sub:'SERVICE PLUS',bg:'#ffffff',fg:'#111111',sfg:'#c8102e',edge:'#111111',aspect:0.42},
};

// name, number, scheme. Numbers are unique, so every car keeps the scheme its number is known for.
export const ICONIC_FIELD=[
  {name:'Dale Bumphardt',number:'3',scheme:'bumphardt3',num:{fill:'#ffffff',outline:'#c8102e',accent:'#8a8d91',slant:true},
    primary:'#0d0d0d',secondary:'#8a8d91',accent:'#c8102e',
    side:[['band',0.6,0.625,'#8a8d91'],['band',0.625,0.655,'#c8102e'],['streak',0.03,0.3,0.32,0.3,0.05,0.0,'#c8102e'],['logo',0.79,0.48,0.95,'goodfix']],
    hood:{color:'#0d0d0d',logo:['goodfix',1.05,1.75]}},
  {name:'Jeff Hair-don',number:'24',scheme:'rainbow24',num:{fill:'#ffd400',outline:'#e4252b',accent:'#ffffff',slant:true},
    primary:'#1b3fa8',secondary:'#e4252b',accent:'#ffd400',
    side:[['streak',0.02,0.2,0.92,0.68,0.1,0.0,'#e4252b'],['streak',0.02,0.3,0.86,0.75,0.08,0.0,'#f7931e'],['streak',0.02,0.38,0.8,0.82,0.07,0.0,'#ffd400'],
      ['streak',0.02,0.13,0.88,0.58,0.06,0.0,'#2bb24c'],['streak',0.02,0.07,0.84,0.48,0.05,0.0,'#39a9e0'],['logo',0.84,0.3,0.7,'dupaint']],
    hood:{color:'#1b3fa8',logo:['dupaint',1.0,1.75]}},
  {name:'Richard Pretty',number:'43',scheme:'petty43',num:{fill:'#ffffff',outline:'#e4252b',accent:'#0b5fa5'},
    primary:'#3fa9e5',secondary:'#ff3b30',accent:'#ffffff',
    side:[['band',0,0.48,'#ff3b30'],['band',0.48,0.51,'#ffffff'],['logo',0.8,0.7,0.72,'spt']],
    hood:{color:'#3fa9e5',nose:['#ff3b30',0.45],logo:['spt',0.95,1.7]},deck:'#ff3b30'},
  {name:'Dale Earnvotes Jr.',number:'8',scheme:'bud8',num:{fill:'#ffffff',outline:'#111111',accent:'#c8102e'},
    primary:'#c8102e',secondary:'#ffffff',accent:'#111111',
    side:[['band',0,0.14,'#111111'],['band',0.14,0.17,'#ffffff'],['logo',0.8,0.58,1.05,'brewmaster']],
    hood:{color:'#c8102e',stripes:[[0.04,'#ffffff']],logo:['brewmaster',1.25,1.85]}},
  {name:'Dale Deliverett',number:'88',scheme:'upx88',num:{fill:'#f2b10e',outline:'#ffffff',accent:'#4b2e1e'},
    primary:'#4b2e1e',secondary:'#f2b10e',accent:'#ffffff',
    side:[['streak',0.0,0.18,1.0,0.7,0.09,0.09,'#f2b10e'],['streak',0.0,0.12,1.0,0.64,0.025,0.025,'#ffffff'],['logo',0.86,0.32,0.5,'upx']],
    hood:{color:'#4b2e1e',stripes:[[0.2,'#f2b10e'],[0.17,'#4b2e1e']],logo:['upx',0.55,1.8]}},
  {name:'Jimmie Yawnson',number:'48',scheme:'lowez48',num:{fill:'#ffffff',outline:'#0d2a5c',accent:'#b9bec5'},
    primary:'#0b4ea2',secondary:'#b9bec5',accent:'#ffffff',
    side:[['poly',[[0,0],[0,0.3],[0.35,0.36],[0.7,0.52],[1,0.62],[1,0]],'#b9bec5'],['streak',0,0.31,1,0.64,0.035,0.035,'#ffffff'],['logo',0.82,0.78,0.75,'lowez']],
    hood:{color:'#0b4ea2',logo:['lowez',1.0,1.75]}},
  {name:"Tony Stewin'",number:'20',scheme:'depo20',num:{fill:'#ffffff',outline:'#111111',accent:'#f96302'},
    primary:'#f96302',secondary:'#111111',accent:'#ffffff',
    side:[['band',0,0.12,'#111111'],['band',0.12,0.15,'#ffffff'],['logo',0.81,0.56,0.62,'homedepo']],
    hood:{color:'#f96302',logo:['homedepo',0.8,1.75]}},
  {name:'Rusty Walrus',number:'2',scheme:'draught2',num:{fill:'#ffffff',outline:'#c9a227',accent:'#111111'},
    primary:'#111111',secondary:'#c9a227',accent:'#ffffff',
    side:[['band',0.3,0.36,'#c9a227'],['band',0.38,0.4,'#ffffff'],['band',0.72,0.75,'#c9a227'],['logo',0.8,0.56,0.85,'draught']],
    hood:{color:'#111111',stripes:[[0.32,'#c9a227'],[0.29,'#111111']],logo:['draught',1.0,1.75]}},
  {name:"Mark Marryin'",number:'6',scheme:'valvo6',num:{fill:'#0a3d91',outline:'#ffffff',accent:'#e31837'},
    primary:'#ffffff',secondary:'#0a3d91',accent:'#e31837',
    side:[['band',0,0.34,'#0a3d91'],['band',0.34,0.38,'#e31837'],['poly',[[0.02,0.38],[0.2,0.38],[0.11,0.86]],'#0a3d91'],['poly',[[0.07,0.38],[0.15,0.38],[0.11,0.62]],'#e31837'],['logo',0.8,0.6,0.95,'valvolube']],
    hood:{color:'#0a3d91',logo:['valvolube',1.0,1.75]}},
  {name:'Bill Smelliott',number:'94',scheme:'bigbun94',num:{fill:'#ffc72c',outline:'#7a0d07',accent:'#ffffff'},
    primary:'#da291c',secondary:'#ffc72c',accent:'#ffffff',
    side:[['band',0,0.2,'#ffc72c'],['band',0.2,0.23,'#ffffff'],['logo',0.8,0.6,0.62,'bigbun']],
    hood:{color:'#da291c',logo:['bigbun',0.9,1.75]}},
  {name:'Terry La-Brrr-nte',number:'5',scheme:'kelloggz5',num:{fill:'#d71920',outline:'#ffffff',accent:'#111111'},
    primary:'#ffd200',secondary:'#d71920',accent:'#ffffff',
    side:[['band',0,0.4,'#d71920'],['band',0.4,0.44,'#ffffff'],['logo',0.8,0.68,0.9,'kelloggz']],
    hood:{color:'#ffd200',nose:['#d71920',0.35],logo:['kelloggz',1.1,1.75]}},
  {name:'Awful Bill Elliyacht',number:'9',scheme:'coorz9',num:{fill:'#ffffff',outline:'#c5a253',accent:'#111111'},
    primary:'#c8102e',secondary:'#c5a253',accent:'#ffffff',
    side:[['band',0.44,0.48,'#c5a253'],['band',0.48,0.53,'#ffffff'],['band',0.53,0.57,'#c5a253'],['logo',0.8,0.25,0.75,'coorz']],
    hood:{color:'#c8102e',logo:['coorz',0.95,1.75]}},
  {name:'Denny Hamlost',number:'11',scheme:'fedez11',num:{fill:'#ffffff',outline:'#ff6600',accent:'#4d148c'},
    primary:'#4d148c',secondary:'#ffffff',accent:'#ff6600',
    side:[['band',0.56,1.2,'#ffffff'],['band',0.53,0.56,'#ff6600'],['logo',0.8,0.78,0.8,'fedez']],
    hood:{color:'#ffffff',logo:['fedez',1.15,1.75]},roof:'#ffffff'},
  {name:'Bratt Kenseth',number:'17',scheme:'dewolt17',num:{fill:'#111111',outline:'#ffffff',accent:'#febd17'},
    primary:'#febd17',secondary:'#111111',accent:'#ffffff',
    side:[['band',0,0.3,'#111111'],['poly',[[0.55,0.3],[0.62,0.3],[0.7,0.62],[0.63,0.62]],'#111111'],['poly',[[0.66,0.3],[0.73,0.3],[0.81,0.62],[0.74,0.62]],'#111111'],['logo',0.84,0.8,0.75,'dewolt']],
    hood:{color:'#febd17',logo:['dewolt',1.05,1.75]}},
  {name:'Bobby Labattery',number:'18',scheme:'interstake18',num:{fill:'#ffffff',outline:'#111111',accent:'#00843d'},
    primary:'#00843d',secondary:'#111111',accent:'#ffffff',
    side:[['band',0,0.18,'#111111'],['band',0.18,0.22,'#ffffff'],['logo',0.8,0.6,0.9,'interstake']],
    hood:{color:'#00843d',logo:['interstake',1.05,1.75]}},
  {name:'Davey Allisnot',number:'28',scheme:'havolube28',num:{fill:'#ffffff',outline:'#d71920',accent:'#111111'},
    primary:'#111111',secondary:'#d71920',accent:'#ffffff',
    side:[['band',0.36,0.4,'#ffffff'],['band',0.4,0.5,'#d71920'],['band',0.5,0.53,'#ffffff'],['logo',0.8,0.74,0.62,'havolube']],
    hood:{color:'#111111',logo:['havolube',0.85,1.75]}},
  {name:'David Pearsnip',number:'21',scheme:'woodbros21',num:{fill:'#ffffff',outline:'#c9a227',accent:'#8b0d16'},
    primary:'#b3121c',secondary:'#ffffff',accent:'#c9a227',
    side:[['band',0,0.52,'#ffffff'],['band',0.52,0.56,'#c9a227'],['logo',0.8,0.25,0.85,'motorkraft']],
    hood:{color:'#b3121c',logo:['motorkraft',1.0,1.75]}},
  {name:'Carl Backwards',number:'99',scheme:'aflaq99',num:{fill:'#00539b',outline:'#ffffff',accent:'#7fb8e6'},
    primary:'#ffffff',secondary:'#00539b',accent:'#7fb8e6',
    side:[['poly',[[0,0],[0,0.55],[0.3,0.4],[0.7,0.25],[1,0.2],[1,0]],'#00539b'],['streak',0,0.6,1,0.25,0.04,0.02,'#7fb8e6'],['logo',0.8,0.6,0.72,'aflaq']],
    hood:{color:'#00539b',logo:['aflaq',0.95,1.75]}},
  {name:'Joey Loafano',number:'22',scheme:'shellzoil22',num:{fill:'#e0201b',outline:'#ffffff',accent:'#111111'},
    primary:'#ffd500',secondary:'#e0201b',accent:'#ffffff',
    side:[['poly',[[0,0],[0,0.25],[0.4,0.3],[0.75,0.55],[1,0.72],[1,0]],'#e0201b'],['logo',0.82,0.8,0.7,'shellzoil']],
    hood:{color:'#ffd500',nose:['#e0201b',0.3],logo:['shellzoil',0.85,1.7]}},
  {name:'Michael Waltripped',number:'15',scheme:'nappa15',num:{fill:'#ffd100',outline:'#001f5b',accent:'#ffffff'},
    primary:'#003da5',secondary:'#ffd100',accent:'#ffffff',
    side:[['band',0,0.22,'#ffd100'],['band',0.22,0.25,'#ffffff'],['logo',0.8,0.62,0.75,'nappa']],
    hood:{color:'#003da5',logo:['nappa',0.95,1.75]}},
  {name:'Kevin Harshvick',number:'29',scheme:'goodfix29',num:{fill:'#111111',outline:'#c8102e',accent:'#ffffff',slant:true},
    primary:'#ffffff',secondary:'#111111',accent:'#c8102e',
    side:[['band',0.66,1.2,'#111111'],['band',0.62,0.66,'#c8102e'],['streak',0,0.2,1,0.2,0.05,0.05,'#111111'],['logo',0.8,0.4,0.85,'goodfix29']],
    hood:{color:'#111111',logo:['goodfix',1.0,1.75]},roof:'#111111'},
  {name:"Sterling Mumblin'",number:'4',scheme:'kodiak4',num:{fill:'#d10a11',outline:'#111111',accent:'#ffcc00'},
    primary:'#ffcc00',secondary:'#d10a11',accent:'#111111',
    side:[['band',0,0.3,'#d10a11'],['band',0.3,0.33,'#111111'],['logo',0.8,0.65,0.72,'kodiak']],
    hood:{color:'#ffcc00',logo:['kodiak',0.95,1.75]}},
  {name:'Danica Pat-Wreck',number:'10',scheme:'goduddy10',num:{fill:'#ffffff',outline:'#111111',accent:'#ff6a00'},
    primary:'#7bd12f',secondary:'#111111',accent:'#ff6a00',
    side:[['poly',[[0.25,0],[0.45,0.5],[1,0.75],[1,0]],'#111111'],['streak',0.22,0.0,1,0.82,0.03,0.03,'#ff6a00'],['logo',0.22,0.7,0.8,'goduddy']],
    hood:{color:'#7bd12f',logo:['goduddy',1.1,1.75]}},
];
export const ICONIC=Object.fromEntries(ICONIC_FIELD.map(f=>[f.scheme,f]));

function rr(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
const FONT='"Arial Black",Impact,sans-serif';
function fitText(g,text,size,maxW,weight='900',style='italic',family=FONT){
  let s=size;g.font=`${style} ${weight} ${s}px ${family}`;
  while(s>8&&g.measureText(text).width>maxW){s-=2;g.font=`${style} ${weight} ${s}px ${family}`;}
  return s;
}
const logoCache=new Map();
// Renders a knockoff sponsor logo into its own canvas (W x W*aspect, transparent background).
export function logoCanvas(key){
  const L=LOGOS[key];if(!L)return null;let cv=logoCache.get(key);if(cv)return cv;
  const W=640,H=Math.round(W*L.aspect);cv=document.createElement('canvas');cv.width=W;cv.height=H;
  const g=cv.getContext('2d');g.textAlign='center';g.textBaseline='middle';g.lineJoin='round';
  const edge=L.edge||'#ffffff',lw=Math.max(6,H*0.06);
  const mainText=(y,h,maxW)=>{const s=fitText(g,L.text,h,maxW);if(L.stroke){g.lineWidth=s*0.16;g.strokeStyle=L.stroke;g.strokeText(L.text,W/2,y);}g.fillStyle=L.fg;g.fillText(L.text,W/2,y);};
  const subText=(y,h,maxW)=>{if(!L.sub)return;fitText(g,L.sub,h,maxW,'900','normal');g.fillStyle=L.sfg||L.fg;if(L.stroke){g.lineWidth=h*0.14;g.strokeStyle=L.stroke;g.strokeText(L.sub,W/2,y);}g.fillText(L.sub,W/2,y);};
  switch(L.kind){
    case 'box':rr(g,lw,lw,W-2*lw,H-2*lw,H*0.14);g.fillStyle=L.bg;g.fill();g.lineWidth=lw;g.strokeStyle=edge;g.stroke();
      if(L.sub){mainText(H*0.4,H*0.42,W*0.86);subText(H*0.76,H*0.2,W*0.8);}else mainText(H*0.52,H*0.62,W*0.86);break;
    case 'oval':g.beginPath();g.ellipse(W/2,H/2,W/2-lw,H/2-lw,0,0,Math.PI*2);g.fillStyle=L.bg;g.fill();g.lineWidth=lw;g.strokeStyle=edge;g.stroke();
      if(L.sub){mainText(H*0.42,H*0.36,W*0.66);subText(H*0.7,H*0.15,W*0.62);}else mainText(H*0.53,H*0.56,W*0.7);break;
    case 'script':{if(L.pad){rr(g,lw,lw,W-2*lw,H-2*lw,H*0.45);g.fillStyle=L.bg;g.fill();}
      const s=fitText(g,L.text,H*0.78,W*0.88,'bold','italic','"Brush Script MT","Segoe Script","Georgia",serif');
      if(!L.pad){g.lineWidth=s*0.12;g.strokeStyle=edge;g.strokeText(L.text,W/2,H*0.52);}g.fillStyle=L.fg;g.fillText(L.text,W/2,H*0.52);break;}
    case 'shield':{g.beginPath();g.moveTo(W*0.2,H*0.06);g.lineTo(W*0.8,H*0.06);g.lineTo(W*0.8,H*0.55);g.quadraticCurveTo(W*0.78,H*0.85,W*0.5,H*0.96);g.quadraticCurveTo(W*0.22,H*0.85,W*0.2,H*0.55);g.closePath();
      g.fillStyle=L.bg;g.fill();g.lineWidth=lw;g.strokeStyle=edge;g.stroke();fitText(g,L.text,H*0.34,W*0.5);g.fillStyle=L.fg;g.fillText(L.text,W/2,H*0.5);break;}
    case 'house':{rr(g,lw,H*0.3,W-2*lw,H*0.66,H*0.08);g.fillStyle=L.bg;g.fill();g.lineWidth=lw;g.strokeStyle=edge;g.stroke();
      g.beginPath();g.moveTo(W*0.3,H*0.32);g.lineTo(W*0.5,H*0.05);g.lineTo(W*0.7,H*0.32);g.closePath();g.fillStyle=L.bg;g.fill();g.stroke();
      fitText(g,L.text,H*0.44,W*0.86);g.fillStyle=L.fg;g.fillText(L.text,W/2,H*0.64);break;}
    case 'v':{rr(g,lw,lw,W-2*lw,H-2*lw,H*0.2);g.fillStyle=L.bg;g.fill();g.lineWidth=lw;g.strokeStyle='#ffffff';g.stroke();
      g.beginPath();g.moveTo(W*0.05,H*0.18);g.lineTo(W*0.12,H*0.18);g.lineTo(W*0.155,H*0.62);g.lineTo(W*0.19,H*0.18);g.lineTo(W*0.26,H*0.18);g.lineTo(W*0.19,H*0.84);g.lineTo(W*0.12,H*0.84);g.closePath();g.fillStyle=edge;g.fill();
      const s=fitText(g,L.text,H*0.56,W*0.66);g.fillStyle=L.fg;g.textAlign='left';g.fillText(L.text,W*0.29,H*0.53);g.textAlign='center';void s;break;}
    case 'arches':{rr(g,lw,lw,W-2*lw,H-2*lw,H*0.14);g.fillStyle=L.bg;g.fill();g.lineWidth=lw;g.strokeStyle=edge;g.stroke();
      g.strokeStyle=L.fg;g.lineWidth=H*0.09;g.lineCap='butt';const y0=H*0.6,aw=W*0.13,ah=H*0.42;
      for(const cx of [W/2-aw,W/2+aw]){g.beginPath();g.moveTo(cx-aw,y0);g.bezierCurveTo(cx-aw,y0-ah*1.3,cx+aw,y0-ah*1.3,cx+aw,y0);g.stroke();}
      fitText(g,L.text,H*0.2,W*0.8);g.fillStyle=L.fg;g.fillText(L.text,W/2,H*0.8);break;}
    case 'split':{rr(g,lw,lw,W-2*lw,H-2*lw,H*0.22);g.fillStyle=L.bg;g.fill();if(L.edge){g.lineWidth=lw;g.strokeStyle=L.edge;g.stroke();}
      const full=L.text+L.text2,s=fitText(g,full,H*0.66,W*0.84,'900','normal');void s;const w1=g.measureText(L.text).width,wt=g.measureText(full).width,x0=W/2-wt/2;
      g.textAlign='left';g.fillStyle=L.fg;g.fillText(L.text,x0,H*0.53);g.fillStyle=L.fg2;g.fillText(L.text2,x0+w1,H*0.53);g.textAlign='center';break;}
    case 'star':{g.beginPath();g.arc(H*0.5,H*0.5,H*0.45,0,Math.PI*2);g.fillStyle=L.bg;g.fill();g.lineWidth=lw;g.strokeStyle=edge;g.stroke();
      g.beginPath();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,r=i%2?H*0.15:H*0.36;g.lineTo(H*0.5+Math.cos(a)*r,H*0.5+Math.sin(a)*r);}g.closePath();g.fillStyle=L.star;g.fill();
      rr(g,H*0.95,H*0.24,W-H*0.95-lw,H*0.52,H*0.1);g.fillStyle=L.bg;g.fill();g.stroke();
      fitText(g,L.text,H*0.34,W-H*1.1,'900','normal');g.fillStyle=L.fg;g.fillText(L.text,(H*0.95+W-lw)/2,H*0.51);break;}
    case 'shell':{g.beginPath();g.arc(H*0.5,H*0.56,H*0.42,Math.PI,0);g.lineTo(H*0.62,H*0.98);g.lineTo(H*0.38,H*0.98);g.closePath();g.fillStyle=L.bg;g.fill();g.lineWidth=lw;g.strokeStyle=edge;g.stroke();
      for(let i=-3;i<=3;i++){g.beginPath();g.moveTo(H*0.5,H*0.92);g.lineTo(H*0.5+Math.sin(i*0.42)*H*0.4,H*0.56-Math.cos(i*0.42)*H*0.4);g.stroke();}
      rr(g,H*0.98,H*0.24,W-H*0.98-lw,H*0.52,H*0.12);g.fillStyle=L.bg;g.fill();g.stroke();
      fitText(g,L.text,H*0.34,W-H*1.15);g.fillStyle=L.fg;g.fillText(L.text,(H*0.98+W-lw)/2,H*0.51);break;}
  }
  logoCache.set(key,cv);return cv;
}

// Side art. The canvas transform is already in metres (x forward, y up) for this side; sa/sd are the signs of
// that transform, used to draw logos the right way round. E = {xf, xr, yb, yt}: front/rear x and the rocker/beltline y.
export function drawSchemeSide(g,sch,E,sa,sd){
  const X=t=>E.xf-t*(E.xf-E.xr),Y=s=>E.yb+s*(E.yt-E.yb),wide=0.6;
  const X0=t=>t<=0?E.xf+wide:t>=1?E.xr-wide:X(t),Y0=s=>s<=0?E.yb-wide:s>=1.15?E.yt+wide:Y(s);
  for(const op of sch.side||[]){
    switch(op[0]){
      case 'band':{const [,s0,s1,c,t0=0,t1=1]=op;g.fillStyle=c;g.beginPath();g.moveTo(X0(t0),Y0(s0));g.lineTo(X0(t1),Y0(s0));g.lineTo(X0(t1),Y0(s1));g.lineTo(X0(t0),Y0(s1));g.closePath();g.fill();break;}
      case 'poly':{g.fillStyle=op[2];g.beginPath();op[1].forEach(([t,s],i)=>i?g.lineTo(X0(t),Y0(s)):g.moveTo(X0(t),Y0(s)));g.closePath();g.fill();break;}
      case 'streak':{const [,t0,s0,t1,s1,w0,w1,c]=op;g.fillStyle=c;g.beginPath();
        g.moveTo(X0(t0),Y0(s0-w0/2));g.lineTo(X0(t1),Y0(s1-w1/2));g.lineTo(X0(t1),Y0(s1+w1/2));g.lineTo(X0(t0),Y0(s0+w0/2));g.closePath();g.fill();break;}
      case 'logo':{const [,t,s,wm,key]=op,cv=logoCanvas(key);if(!cv)break;const hm=wm*cv.height/cv.width;
        g.save();g.translate(X(t),Y(s));g.scale(sa,sd);g.drawImage(cv,-wm/2,-hm/2,wm,hm);g.restore();break;}
    }
  }
}
// Hood art. The transform maps (x = forward metres, y = lateral metres); E = {x0, xf, half}: hood back edge, nose, half width.
// putLogo(canvas, forwardMetres, widthMetres) places a logo the right way round for this surface.
export function drawSchemeHood(g,sch,E,putLogo){
  const H=sch.hood||{},w=E.half+0.4;
  g.fillStyle=H.color||sch.primary;g.fillRect(E.x0,-w,E.xf-E.x0+0.6,2*w);
  if(H.nose){g.fillStyle=H.nose[0];g.fillRect(E.xf-H.nose[1],-w,H.nose[1]+0.6,2*w);}
  for(const [hw,c] of H.stripes||[]){g.fillStyle=c;g.fillRect(E.x0-0.1,-hw,E.xf-E.x0+0.8,2*hw);}
  if(H.logo){const cv=logoCanvas(H.logo[0]);if(cv)putLogo(cv,H.logo[2]??(E.x0+E.xf)/2,H.logo[1]);}
}
