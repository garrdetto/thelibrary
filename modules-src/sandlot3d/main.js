(()=>{
'use strict';
const $=id=>document.getElementById(id);
const PI=Math.PI,rnd=(a,b)=>a+Math.random()*(b-a),lerp=(a,b,t)=>a+(b-a)*t,cl=(v,a,b)=>Math.max(a,Math.min(b,v)),dist=(a,b,c,d)=>Math.hypot(a-c,b-d),ease=t=>t*t*(3-2*t);
let vt=0,lastReal=null,slow=1;const NOW=()=>vt;
const store={get(k){try{return localStorage.getItem(k)}catch(e){return null}},set(k,v){try{localStorage.setItem(k,v)}catch(e){}}};

/* ================= DATA ================= */
const CH=[['Hoops','Point guard',2,4,5],['Ace','Quarterback',5,3,4],['Turbo','Race driver',3,3,5],['Knockout','Boxer',5,3,3],
['Jailbird','Escape artist',4,3,4],['Sarge','SWAT',4,4,2],['Gumshoe','Detective',2,5,3],['Blaze','Firefighter',5,2,3],
['Bling','Big spender',3,4,3],['Grease','Mechanic',3,4,3],['Timber','Lumberjack',5,3,2],['Reel','Angler',2,5,2],
['Scraps','Drifter',2,3,4],['Tagger','Street artist',2,4,4],['Strummer','Guitarist',2,4,3],['Wheels','Paperboy',2,3,5],
['Hayseed','Farmer',4,3,3],['Old Gus','Old-timer',3,5,1],['Picasso','Painter',2,4,3],['The Boss','Executive',3,4,3],
['Hoodie','Skater',3,3,4],['Pinstripe','Ballplayer',4,4,4],['Farmhand','Rancher',4,3,3],['Doc','Doctor',2,5,3],
['Smokey','Fire captain',4,3,3],['Spartan','Gladiator',5,2,3],['Big Deal','CEO',3,4,2],['Badge','Officer',3,4,4],
['Rocket','Astronaut',4,3,3],['Red','Skater',3,3,4],['Chef','Chef',2,4,3],['Cosmo','Astronaut',3,4,3],
['Hard Hat','Builder',4,3,2],['Hex','Witch',3,4,3]].map((a,i)=>({i,n:a[0],r:a[1],p:a[2],c:a[3],s:a[4],bat:i>=16,src:'sprites/p'+String(i).padStart(2,'0')+'.webp'}));
const spdOf=c=>19+2.2*CH[c].s;

const PARKS=[
 {id:'sandlot',name:'The Sandlot',desc:'Backyard dirt, a plank fence, and the neighbors’ windows. 60-ft bases at sunset.',B:60,L:196,C:236,wallH:6,time:'dusk',wt:0},
 {id:'park',name:'Maple Park',desc:'Town field with chain-link, aluminum bleachers and a shady tree line. 70-ft bases.',B:70,L:203,C:246,wallH:8,time:'day',wt:9},
 {id:'dome',name:'Lakefront Dome',desc:'Modeled on Milwaukee\u2019s American Family Field: fan-shaped roof, glass outfield walls and a left-field slide. 90-ft bases.',B:90,L:228,C:262,wallH:8,time:'day',wt:15},
 {id:'stadium',name:'Thunder Stadium',desc:'Two decks, light towers and a packed house under the lights. 90-ft bases.',B:90,L:208,C:252,wallH:10,time:'night',wt:15}];
const DIFF=[{n:'Rookie',w:.12,s:1.15,wild:.25,cpu:.75},{n:'Pro',w:.095,s:1,wild:.35,cpu:1},{n:'All-Star',w:.075,s:.88,wild:.45,cpu:1.25}];
const TYPES=[{n:'Fastball',mph:92,dur:780,bx:0,by:0},{n:'Slider',mph:83,dur:960,bx:.7,by:.1},{n:'Curveball',mph:75,dur:1120,bx:.2,by:.7},{n:'Changeup',mph:79,dur:1280,bx:0,by:.15}];
const IDEAL=.92;
const BU=[[0,0],[42.43,42.43],[0,84.85],[-42.43,42.43]];
const FIELD=[['pitcher',0,42],['first',38,50],['second',22,80],['short',-22,80],['third',-38,50],['left',-95,168],['center',0,198],['right',95,168]];
const FSLOT=[0,2,3,4,5,6,7,8]; // FIELD idx -> cpu team slot (slot1 = catcher)
const CATCH_U=[0,-4];
/* Home plate geometry (world feet): the plate's back point sits on the origin where the foul lines meet,
   so the 17" front edge is 17" toward the mound. The pitch crosses the zone over the middle of the plate. */
const PLATE_W=17/12,PLATE_D=PLATE_W,ZZ=-PLATE_D/2;
const ZW=PLATE_W/2,ZC=2.45,ZH=1.0,BALL_R=.189,PITCH_SPEED=1.25; // zone: hollow of the knee (~1.45 ft) to midway between belt and shoulders (~3.45 ft) on a 6-ft player
const BATX=3.2,BATZ=ZZ+.1; // batter stands mid-box, about 2.5 ft off the plate

/* ================= THREE SETUP ================= */
const cv=$('gl'),hud=$('hud'),hx=hud.getContext('2d');
const renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(1.75,window.devicePixelRatio||1));
const adaptRes=window.__adaptiveResolution?window.__adaptiveResolution({max:renderer.getPixelRatio(),min:Math.min(renderer.getPixelRatio(),.75),apply:r=>{renderer.setPixelRatio(r);resize()}}):null;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(50,1,.3,9000);
const MAXANI=renderer.capabilities.getMaxAnisotropy();

/* color grading pass: scene -> MSAA target -> graded full-screen quad */
const post=(()=>{const w2=renderer.capabilities.isWebGL2,RT=w2&&THREE.WebGLMultisampleRenderTarget?THREE.WebGLMultisampleRenderTarget:THREE.WebGLRenderTarget;
  const rt=new RT(4,4,{depthBuffer:true});if(w2&&'samples' in rt)rt.samples=4;
  const mat=new THREE.ShaderMaterial({depthTest:false,depthWrite:false,uniforms:{t:{value:rt.texture},tint:{value:new THREE.Vector3(1,1,1)},lift:{value:new THREE.Vector3()},sat:{value:1},con:{value:1},vig:{value:.3},px:{value:new THREE.Vector2(1,1)}},
    vertexShader:'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
    fragmentShader:`uniform sampler2D t;uniform vec3 tint,lift;uniform float sat,con,vig;uniform vec2 px;varying vec2 vUv;
      void main(){vec3 c=texture2D(t,vUv).rgb;
        vec3 b=(texture2D(t,vUv+vec2(px.x,0.)).rgb+texture2D(t,vUv-vec2(px.x,0.)).rgb+texture2D(t,vUv+vec2(0.,px.y)).rgb+texture2D(t,vUv-vec2(0.,px.y)).rgb)*.25;
        c+=max(b-.82,0.)*.6;
        c*=tint;float l=dot(c,vec3(.2126,.7152,.0722));c=mix(vec3(l),c,sat);c=(c-.5)*con+.5;c+=lift*(1.-c);
        c=c/(1.+max(c-.92,0.)*1.4);
        vec2 q=vUv-.5;c*=1.-vig*pow(length(q)*1.35,2.4);
        gl_FragColor=vec4(clamp(c,0.,1.),1.);}`});
  const q=new THREE.Mesh(new THREE.PlaneGeometry(2,2),mat);q.frustumCulled=false;const sc=new THREE.Scene();sc.add(q);
  return{rt,mat,sc,cam:new THREE.OrthographicCamera(-1,1,1,-1,0,1),on:true}})();
const GRADE={dusk:{tint:[1.05,.98,.9],lift:[.03,.01,.04],sat:1.04,con:1.06,vig:.4},day:{tint:[1.02,1,.97],lift:[.015,.015,.025],sat:.95,con:1.05,vig:.28},
  night:{tint:[.95,.98,1.05],lift:[.0,.012,.035],sat:.94,con:1.1,vig:.45},dome:{tint:[1.04,1.0,.95],lift:[.02,.02,.025],sat:.96,con:1.07,vig:.32}};
function setGrade(k){const g=GRADE[k],u=post.mat.uniforms;u.tint.value.set(...g.tint);u.lift.value.set(...g.lift);u.sat.value=g.sat;u.con.value=g.con;u.vig.value=g.vig}
let VW=1,VH=1;
function resize(){VW=cv.clientWidth||innerWidth;VH=cv.clientHeight||innerHeight;renderer.setSize(VW,VH,false);camera.aspect=VW/VH;camera.fov=VW/VH<.8?60:VW/VH<1.2?54:46;camera.updateProjectionMatrix();
  const d=Math.min(2,devicePixelRatio||1);hud.width=VW*d;hud.height=VH*d;hx.setTransform(d,0,0,d,0,0);const pr=renderer.getPixelRatio();post.rt.setSize(Math.round(VW*pr),Math.round(VH*pr));post.mat.uniforms.px.value.set(1/(VW*pr),1/(VH*pr))}
addEventListener('resize',resize);

const mk=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return[c,c.getContext('2d')]};
function ctex(c,rep){const t=new THREE.CanvasTexture(c);t.anisotropy=MAXANI;if(rep){t.wrapS=t.wrapT=THREE.RepeatWrapping}return t}
const blobTex=(()=>{const[c,g]=mk(64,64);const r=g.createRadialGradient(32,32,2,32,32,31);r.addColorStop(0,'rgba(0,0,0,.55)');r.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=r;g.fillRect(0,0,64,64);return ctex(c)})();
const glowTex=(()=>{const[c,g]=mk(128,128);const r=g.createRadialGradient(64,64,2,64,64,63);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.25,'rgba(255,250,225,.55)');r.addColorStop(1,'rgba(255,240,200,0)');g.fillStyle=r;g.fillRect(0,0,128,128);return ctex(c)})();
const ballTex=(()=>{const[c,g]=mk(128,64);g.fillStyle='#fbfaf4';g.fillRect(0,0,128,64);g.strokeStyle='#c8322a';g.lineWidth=2.4;
  for(const o of[0,64]){g.beginPath();for(let x=0;x<=64;x+=2){const y=32+Math.sin((x/64)*PI*2)*16*(o?1:-1);x?g.lineTo(o+x,y):g.moveTo(o+x,y)}g.stroke()}return ctex(c)})();

/* soft studio/sky reflection map so skin, fabric and leather pick up real highlights */
const ENV=(()=>{try{const pm=new THREE.PMREMGenerator(renderer),s=new THREE.Scene();
  const g=new THREE.SphereGeometry(50,32,16),cols=[],c=new THREE.Color(),top=new THREE.Color(0x9cc4ff),hor=new THREE.Color(0xf4ead8),gr=new THREE.Color(0x4a5a3a);
  const p=g.attributes.position;for(let k=0;k<p.count;k++){const y=p.getY(k)/50;if(y>0)c.copy(hor).lerp(top,Math.pow(y,.6));else c.copy(hor).lerp(gr,Math.min(1,-y*3));cols.push(c.r,c.g,c.b)}
  g.setAttribute('color',new THREE.Float32BufferAttribute(cols,3));s.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.BackSide})));
  const key=new THREE.Mesh(new THREE.PlaneGeometry(26,16),new THREE.MeshBasicMaterial({color:0xffffff,side:THREE.DoubleSide}));key.position.set(-20,34,24);key.lookAt(0,0,0);s.add(key);
  const t=pm.fromScene(s,.04).texture;pm.dispose();return t}catch(e){return null}})();
/* procedural normal maps: woven fabric and fine skin texture */
function normalTex(n,hf,rep,str){const[c,g]=mk(n,n),h=new Float32Array(n*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++)h[y*n+x]=hf(x,y);
  const im=g.createImageData(n,n);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const dx=(h[y*n+(x+1)%n]-h[y*n+(x+n-1)%n])*str,dy=(h[((y+1)%n)*n+x]-h[((y+n-1)%n)*n+x])*str,l=Math.hypot(dx,dy,1),o=(y*n+x)*4;
    im.data[o]=(-dx/l*.5+.5)*255;im.data[o+1]=(-dy/l*.5+.5)*255;im.data[o+2]=(1/l*.5+.5)*255;im.data[o+3]=255}g.putImageData(im,0,0);const t=ctex(c,true);t.repeat.set(rep,rep);return t}
const NZ=(()=>{const a=new Float32Array(4096);for(let k=0;k<4096;k++)a[k]=Math.random();return(x,y)=>a[((y&63)*64+(x&63))]})();
const CLOTH_N=normalTex(128,(x,y)=>{const u=x%8,v=y%8,warp=Math.sin(u/8*PI),weft=Math.sin(v/8*PI);return((x>>3)+(y>>3))%2?warp*.8+weft*.3:weft*.8+warp*.3+NZ(x,y)*.15},5,1.6);
const SKIN_N=normalTex(128,(x,y)=>NZ(x,y)*.5+NZ(x>>1,y>>1)*.5,3,.9);
const HAIR_N=normalTex(128,(x,y)=>Math.sin(x*1.9+NZ(x>>2,0)*6)*.6+NZ(x,y>>3)*.4,4,2.2);

const ringGeo=new THREE.RingGeometry(1.05,1.45,28);ringGeo.rotateX(-PI/2);
const blobGeo=new THREE.PlaneGeometry(1,1);blobGeo.rotateX(-PI/2);
/* ================= 3D CHARACTERS: LOOKS ================= */
// [skin, hair, hairStyle, hat, hatColor, shirt, trim, pants, shoes, pattern, flags]
// flags: s=shorts, r=robe/long coat, o=overalls, v=vest, b=beard, c=chain, k=short sleeves
const LOOKS=[
['#8d5b3f','#241812','bun','',0,'#f1efe8','#24356f','#f1efe8','#2b4a8a','num23','sk'],
['#7a4a35','#1c1714','dreads','football','#1f3a7a','#1f3a7a','#c8342a','#eeece6','#1e2a4a','num1',''],
['#7b4f3b','#18120f','curly','',0,'#1f1f24','#c0392b','#1f1f24','#7a2620','stripe',''],
['#e2aa8a','#5a3a26','short','',0,'#2a63b8','#dde6f2','#c8302a','#a82a2a','','sr'],
['#e3a585','#6a4a34','buzz','',0,'#ec7a2c','#d86a20','#ec7a2c','#ececec','',''],
['#d8a07e','#2a2a2a','buzz','swat','#23262e','#262a33','#3c424e','#23262e','#18181c','vest',''],
['#dca07c','#5a3a26','short','fedora','#6e5034','#b8996a','#2a3040','#3a4256','#4a2a1e','','r'],
['#d89a72','#6a4a30','buzz','',0,'#c9a23a','#e8e04a','#b08a2e','#2a2a2a','reflect',''],
['#8a5a3e','#1e1814','dreads','',0,'#c9842a','#f4c542','#44607a','#e8b84a','leopard','c'],
['#dca07c','#6a4a30','messy','',0,'#6e6e72','#3f5f86','#3f5f86','#3a2a22','','o'],
['#d89070','#7a4a2a','short','',0,'#b0302a','#2a1a1a','#4a6886','#6a4528','plaid','b'],
['#e0a888','#8a6a50','buzz','',0,'#5a7aa0','#7a7656','#6a6a48','#3a4a2a','','v'],
['#b89070','#4a3a2a','wild','',0,'#6a6040','#4a4030','#5a4e3a','#4a3a30','torn',''],
['#c8906e','#3a2a22','short','hood','#5a5a62','#5a5a62','#e04a8a','#55565c','#8a6a4a','paint',''],
['#e0a888','#6a4a30','long','',0,'#4f7ab0','#f0f0f0','#3f5f86','#2a2a2a','',''],
['#c88a66','#2a1a14','curly','',0,'#8a5a32','#e8e2d0','#44607a','#2a2a2a','',''],
['#e3a585','#6a4a30','short','cowboy','#d8b878','#d8c8a0','#3a2a1a','#4a3a2a','#4a2a1e','plaid','o'],
['#d8a07e','#a8a8a0','short','beanie','#4a5a3a','#4f5e38','#6a6a5a','#44607a','#6a5040','torn','b'],
['#e8b090','#5a3020','long','beret','#7a2030','#ece6da','#e04a8a','#44607a','#5a3a2a','paint','r'],
['#e8b090','#5a3a26','bob','',0,'#a88e68','#f4f0e8','#4a525a','#2a2a40','','r'],
['#e3a585','#4a3020','short','capback','#6a4a30','#2f6a8c','#2f6a8c','#44607a','#8a8a8a','',''],
['#e3a585','#5a3a26','short','',0,'#f2f2f2','#1f2f5a','#f2f2f2','#1f2f5a','pin12','k'],
['#e3a585','#5a3a26','short','',0,'#7a5a2a','#4a6886','#4a6886','#4a2a1e','plaid','o'],
['#e8b090','#5a3020','long','chef','#f4f4f0','#f4f4f0','#3aa0a0','#44607a','#2a2a2a','','r'],
['#e3a585','#5a3a26','short','fire','#a82a22','#c9a23a','#e8e04a','#b08a2e','#2a2a2a','reflect',''],
['#d8a07e','#4a2a1e','mohawk','',0,'#5a3a26','#9a9a9a','#4a3a2a','#6a4a2a','armor','k'],
['#e8b090','#3a2a1e','short','',0,'#2a3f6a','#f4f4f4','#2a3f6a','#1a1a1a','suit',''],
['#e8b090','#3a2a1e','bob','police','#1f2f4a','#4a6a9a','#1f2f4a','#1f2f4a','#1a1a1a','',''],
['#e8b090','#5a3a26','short','astro','#f2f2f2','#e8e8ea','#c8342a','#e8e8ea','#d8d8dc','astro',''],
['#e3a585','#3a2a1e','short','capback','#6a7a8a','#6a2a2a','#6a2a2a','#44607a','#e8e8e8','',''],
['#e8b090','#5a3020','bob','chef','#f4f4f0','#f4f4f0','#2a2a2a','#f0f0f0','#2a2a2a','buttons',''],
['#e8b090','#5a3a26','short','astro','#f2f2f2','#e8e8ea','#2a63b8','#e8e8ea','#d8d8dc','astro',''],
['#e3a585','#5a3a26','short','hardhat','#f2c230','#4a7ab0','#ff7a1a','#44607a','#6a4528','safety',''],
['#f0b8a0','#4a2a1e','long','witch','#3a2a5a','#3a2a5a','#7a5aa0','#3a2a5a','#2a2030','','r']];
const LEFTY=new Set([2,8,14,18,25,29,33]);
// 3D faces are now sculpted (eyes, brows, nose, lips)
const EYES=['#4a2e1c','#5a3a22','#2f5a7a','#3d6a4a','#6a4a2a','#3a2a1e','#4a6a8a'];

/* ================= RIG MATH ================= */
const V3=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z),UP=V3(0,1,0);
const _a=V3(),_b=V3(),_c=V3(),_d=V3(),_m=new THREE.Matrix4(),_m2=new THREE.Matrix4(),_q=new THREE.Quaternion(),_e=new THREE.Euler(0,0,0,'YXZ'),ONE=V3(1,1,1);
function placeSeg(mesh,a,b,r){_a.subVectors(b,a);const L=_a.length()||1e-4;mesh.position.addVectors(a,b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(UP,_a.multiplyScalar(1/L));mesh.scale.set(r,L,r)}
// two-bone IK: returns joint position in `out`, clamps end to `end`
function ik(A,T,l1,l2,pole,out,end){
  _b.subVectors(T,A);let L=_b.length();const dir=_b.multiplyScalar(1/(L||1));L=cl(L,Math.abs(l1-l2)+.02,l1+l2-.002);
  const a=(l1*l1-l2*l2+L*L)/(2*L),h=Math.sqrt(Math.max(0,l1*l1-a*a));
  _c.copy(pole).addScaledVector(dir,-pole.dot(dir));if(_c.lengthSq()<1e-6)_c.set(0,0,1);_c.normalize();
  out.copy(A).addScaledVector(dir,a).addScaledVector(_c,h);end.copy(A).addScaledVector(dir,L)}
function chestMatrix(p,out){
  _e.set(p.hr[0],p.hr[1],p.hr[2]);_q.setFromEuler(_e);out.compose(_d.set(p.hip[0],p.hip[1],p.hip[2]),_q,ONE);
  _e.set(p.ch[0],p.ch[1],p.ch[2]);_q.setFromEuler(_e);_m2.compose(_a.set(0,.1,0),_q,ONE);return out.multiply(_m2)}
const batDir=(yaw,pit,o)=>o.set(Math.sin(yaw)*Math.cos(pit),Math.sin(pit),Math.cos(yaw)*Math.cos(pit));

/* ================= POSES =================
   Root-local space: character faces +z, its left side is +x. Feet always root space.
   hl/hr = hand targets; hs = 0 chest space, 1 root space (resolved to root before blending). */
function pose(o){return Object.assign({hip:[0,1.9,0],hr:[0,0,0],ch:[0,0,0],hd:[0,0],hl:[.66,-.12,.12],hr_:[-.66,-.12,.12],hs:0,fl:[.3,0,0],fr:[-.3,0,0],fo:[.12,-.12],bat:0,bg:[0,0,0],ba:[0,0],look:1},o)}
function withBat(p,lefthand){ // put both hands on the bat (bottom hand left for a right-handed swing)
  const d=batDir(p.ba[0],p.ba[1],_a);p.hl=[p.bg[0],p.bg[1],p.bg[2]];p.hr_=[p.bg[0]+d.x*.27,p.bg[1]+d.y*.27,p.bg[2]+d.z*.27];p.hs=1;p.bat=1;return p}
const POSE={
  idle:(t)=>pose({hip:[0,1.9+.015*Math.sin(t*2.1),0],ch:[.03+.01*Math.sin(t*2.1),0,0]}),
  ready:(t)=>pose({hip:[0,1.56,-.12],hr:[.28,0,0],ch:[.22,0,0],hl:[.5,-.25,.72],hr_:[-.5,-.25,.72],fl:[.58,0,.05],fr:[-.58,0,.05],fo:[.35,-.35]}),
  set:(t)=>pose({hip:[0,1.74+.01*Math.sin(t*3),-.05],hr:[.12,0,0],ch:[.08,0,0],hl:[.45,-.55,.45],hr_:[-.45,-.55,.45],fl:[.52,0,0],fr:[-.52,0,0],fo:[.25,-.25]}),
  lead:(t)=>pose({hip:[0,1.58,-.1],hr:[.32,0,0],ch:[.18,0,0],hl:[.42,-.62,.5],hr_:[-.42,-.62,.5],fl:[.75,0,0],fr:[-.75,0,0],fo:[.2,-.2]}),
  crouch:(t)=>pose({hip:[0,.98,-.2],hr:[.18,0,0],ch:[.22,0,0],hl:[.35,.25,.95],hr_:[-.45,-.35,.5],fl:[.78,0,.1],fr:[-.78,0,.1],fo:[.55,-.55]}),
  slide:()=>pose({hip:[0,.75,-.3],hr:[-.55,0,0],ch:[-.15,0,0],hl:[.6,1.0,-.3],hr_:[-.6,1.0,-.3],hs:0,fl:[.2,.25,1.7],fr:[-.25,.15,.7],fo:[0,0]}),
  cheer:(t)=>pose({hip:[0,1.9+.18*Math.abs(Math.sin(t*7)),0],ch:[-.1,0,0],hl:[.75,1.55+.15*Math.sin(t*7),.2],hr_:[-.75,1.55+.15*Math.sin(t*7+1),.2]}),
  run:(t,r)=>{const A=r.amp,ph=r.phase,c=Math.cos(ph),s=Math.sin(ph),lean=.08+.22*r.sp;
    return pose({hip:[0,1.8+.09*Math.abs(c),0],hr:[lean*.4,.14*s,0],ch:[lean,-.22*s,0],
      hl:[.56,-.02+.32*Math.max(0,c)*r.sp,.18+.55*c*r.sp],hr_:[-.56,-.02+.32*Math.max(0,-c)*r.sp,.18-.55*c*r.sp],
      fl:[.24,Math.max(0,s)*(.35+.4*A)+Math.max(0,s)*Math.max(0,c)*.5*A,-c*A],fr:[-.24,Math.max(0,-s)*(.35+.4*A)+Math.max(0,-s)*Math.max(0,-c)*.5*A,c*A],fo:[0,0]})},
  // ---- batting (right-handed; lefties are mirrored) ----
  // stance: knees flexed, hands at the rear shoulder (catcher side, -x) and a hand's width in front of the chest,
  // barrel cocked up and back over the rear shoulder so it clears the helmet. Small waggle in the barrel.
  stance:(t)=>withBat(pose({hip:[-.05,1.62+.012*Math.sin(t*2.4),0],hr:[.1,-.12,0],ch:[.1,-.2,0],hd:[.05,0],fl:[.92,0,.05],fr:[-.92,0,0],fo:[1.35,1.45],bg:[-.56,3.0,.46],ba:[-2.28+.1*Math.sin(t*2.8),1.09+.04*Math.sin(t*2.8)]})),
  // load: weight back, front knee lifts, hands drift further back and up
  load:(t)=>withBat(pose({hip:[-.26,1.6,0],hr:[.08,-.34,0],ch:[.1,-.44,0],fl:[.72,.26+.1*Math.sin(cl(t*4,0,PI)),.1],fr:[-.92,0,0],fo:[1.3,1.45],bg:[-.76,3.06,.34],ba:[-2.45,1.0]})),
  // contact: hips open, barrel level through the middle of the zone out over the plate
  contact:()=>withBat(pose({hip:[.3,1.5,0],hr:[.1,.95,0],ch:[.18,1.2,-.12],fl:[1.45,0,.15],fr:[-.85,.14,.05],fo:[1.75,2.2],bg:[.16,2.2,1.0],ba:[-.12,-.14]})),
  follow:()=>withBat(pose({hip:[.42,1.66,0],hr:[0,1.45,0],ch:[.04,1.95,0],fl:[1.45,0,.15],fr:[-.6,.28,.28],fo:[1.75,2.9],bg:[.38,3.55,.1],ba:[2.9,.55]})),
  bunt:()=>withBat(pose({hip:[.05,1.42,0],hr:[.22,1.3,0],ch:[.24,.15,0],fl:[.85,0,.25],fr:[-.55,0,.45],fo:[1.9,2.1],bg:[.95,2.2,.62],ba:[.12,.1]})),
  // ---- pitcher (root faces home plate) ----
  pset:()=>pose({hip:[0,1.9,0],ch:[.05,0,0],hl:[.08,3.05,.55],hr_:[-.08,3.0,.5],hs:1,fl:[.35,0,0],fr:[-.35,0,0]}),
  pkick:()=>pose({hip:[0,1.96,-.15],hr:[0,-1.45,0],ch:[-.06,-1.5,0],hl:[.05,3.05,-.1],hr_:[-.05,3.0,-.15],hs:1,fl:[.12,1.55,.25],fr:[0,0,-.12],fo:[-1.5,-1.5]}),
  pstride:()=>pose({hip:[0,1.45,1.1],hr:[.12,-1.1,0],ch:[0,-1.25,.2],hl:[.65,3.15,2.4],hr_:[-.25,3.95,-1.25],hs:1,fl:[.3,0,2.6],fr:[0,0,-.2],fo:[-.3,-1.5]}),
  prelease:()=>pose({hip:[0,1.42,1.6],hr:[.35,.1,0],ch:[.5,.35,-.12],hl:[.55,2.6,1.6],hr_:[-.45,3.7,2.95],hs:1,fl:[.3,0,2.6],fr:[-.1,.5,.6],fo:[-.2,-.8]}),
  pfollow:()=>pose({hip:[0,1.38,1.9],hr:[.6,.4,0],ch:[.55,.5,0],hl:[.6,2.5,1.5],hr_:[.7,1.55,2.55],hs:1,fl:[.3,0,2.6],fr:[-.4,.9,.85],fo:[0,.3]}),
  pfield:()=>pose({hip:[0,1.58,2.0],hr:[.25,0,0],ch:[.2,0,0],hl:[.5,-.25,.7],hr_:[-.5,-.25,.7],fl:[.55,0,2.6],fr:[-.55,0,2.35],fo:[.3,-.3]}),
  // ---- throwing (root faces target) ----
  tgather:()=>pose({hip:[0,1.8,0],hr:[.1,-.6,0],ch:[.05,-.7,0],hl:[.1,3.0,.45],hr_:[-.05,2.95,.4],hs:1,fl:[.35,0,.1],fr:[-.35,0,-.1]}),
  tcock:()=>pose({hip:[0,1.7,.25],hr:[.05,-1.2,0],ch:[0,-1.3,.15],hl:[.7,3.3,1.2],hr_:[-.3,3.85,-1.1],hs:1,fl:[.3,0,1.1],fr:[-.2,0,-.3],fo:[-.4,-1.4]}),
  trelease:()=>pose({hip:[0,1.62,.7],hr:[.25,.15,0],ch:[.4,.4,-.1],hl:[.55,2.6,.9],hr_:[-.35,3.55,1.5],hs:1,fl:[.3,0,1.1],fr:[-.2,.3,.1]}),
  tfollow:()=>pose({hip:[0,1.6,.85],hr:[.4,.4,0],ch:[.45,.5,0],hl:[.5,2.5,.8],hr_:[.55,1.7,1.25],hs:1,fl:[.3,0,1.1],fr:[-.4,.6,.6]})};
// keyframed one-shots
const SEQ={
  swing:[[0,'load'],[.11,'contact'],[.3,'follow'],[.7,'follow']],
  pitch:[[0,'pset'],[.42,'pkick'],[.95,'pstride'],[1.3,'prelease'],[1.5,'pfollow'],[1.95,'pfield'],[2.6,'pfield']],
  throw:[[0,'tgather'],[.16,'tcock'],[.3,'trelease'],[.5,'tfollow'],[.75,'tfollow']]};
function lerpPose(a,b,t){const o={};for(const k in b){const x=a[k],y=b[k];o[k]=Array.isArray(y)?y.map((v,i)=>lerp(x?x[i]:v,v,t)):typeof y==='number'?lerp(x==null?y:x,y,t):y}return o}
function resolve(p){ // hands to root space
  if(p.hs>=1)return p;chestMatrix(p,_m);
  const L=_a.set(...p.hl).applyMatrix4(_m),R=_b.set(...p.hr_).applyMatrix4(_m);
  p.hl=[lerp(L.x,p.hl[0],p.hs),lerp(L.y,p.hl[1],p.hs),lerp(L.z,p.hl[2],p.hs)];p.hr_=[lerp(R.x,p.hr_[0],p.hs),lerp(R.y,p.hr_[1],p.hs),lerp(R.z,p.hr_[2],p.hs)];p.hs=1;return p}
function seqPose(name,t,ctx){const s=SEQ[name];let i=0;while(i<s.length-1&&t>=s[i+1][0])i++;
  const a=s[i],b=s[Math.min(i+1,s.length-1)];const u=b[0]>a[0]?ease(cl((t-a[0])/(b[0]-a[0]),0,1)):1;
  return lerpPose(resolve(POSE[a[1]](t,ctx)),resolve(POSE[b[1]](t,ctx)),u)}
const seqLen=n=>SEQ[n][SEQ[n].length-1][0];

/* ================= TEXTURES ================= */
function headTexture(L,i){
  // equirect skin map, 512x256: face centred at x=128 (u=.25), eyes ~row 124, mouth ~row 170
  const[c,g]=mk(512,256),sk=new THREE.Color(L[0]);g.fillStyle=L[0];g.fillRect(0,0,512,256);
  const rgba=(col,a)=>`rgba(${col.r*255|0},${col.g*255|0},${col.b*255|0},${a})`,blob=(x,y,rx,ry,col,a)=>{const r=g.createRadialGradient(x,y,0,x,y,Math.max(rx,ry));r.addColorStop(0,rgba(col,a));r.addColorStop(1,rgba(col,0));g.save();g.translate(x,y);g.scale(rx/Math.max(rx,ry),ry/Math.max(rx,ry));g.translate(-x,-y);g.fillStyle=r;g.fillRect(x-Math.max(rx,ry),y-Math.max(rx,ry),Math.max(rx,ry)*2,Math.max(rx,ry)*2);g.restore()};
  // pores / mottling
  for(let k=0;k<2600;k++){const d=Math.random()<.5;g.fillStyle=d?'rgba(80,40,30,.05)':'rgba(255,230,210,.05)';g.fillRect(Math.random()*512,Math.random()*256,2,2)}
  const warm=sk.clone().lerp(new THREE.Color('#c0443a'),.55),shade=sk.clone().multiplyScalar(.72),lip=sk.clone().lerp(new THREE.Color('#9a3a3a'),.45).multiplyScalar(.92);
  blob(100,146,22,14,warm,.22);blob(156,146,22,14,warm,.22);blob(128,150,10,10,warm,.15);   // cheeks + nose tip
  blob(108,122,16,8,shade,.35);blob(148,122,16,8,shade,.35);                                 // eye sockets
  blob(128,192,30,10,shade,.18);                                                               // under-lip / chin crease
  g.fillStyle=rgba(lip,.9);g.beginPath();g.ellipse(128,174,15,4.5,0,0,PI*2);g.fill();
  g.strokeStyle=rgba(shade.clone().multiplyScalar(.6),.6);g.lineWidth=1.4;g.beginPath();g.moveTo(113,174);g.quadraticCurveTo(128,176,143,174);g.stroke();
  // hair: crown + back of head
  g.fillStyle=L[1];const st=L[2];
  if(st!=='bald'){g.fillRect(0,0,512,st==='buzz'?62:74);g.beginPath();g.ellipse(384,80,st==='long'||st==='bob'||st==='wild'?184:132,st==='long'?180:st==='buzz'?60:104,0,0,7);g.fill();
    // soft hairline + sideburns
    const hc=new THREE.Color(L[1]);for(let k=0;k<500;k++){const x=Math.random()*512,y=(st==='buzz'?62:74)+Math.random()*10;g.fillStyle=rgba(hc,.5);g.fillRect(x,y,1.5,3)}
    g.fillStyle=L[1];g.fillRect(50,70,12,58);g.fillRect(194,70,12,58)}
  if(L[10].includes('b')){const hc=new THREE.Color(L[1]);g.fillStyle=rgba(hc,.88);g.beginPath();g.moveTo(50,118);g.quadraticCurveTo(58,205,128,218);g.quadraticCurveTo(198,205,206,118);g.lineTo(190,118);g.quadraticCurveTo(178,172,150,178);g.lineTo(106,178);g.quadraticCurveTo(78,172,66,118);g.fill();
    g.beginPath();g.ellipse(128,166,20,5,0,0,PI*2);g.fill();g.fillStyle=rgba(lip,.9);g.beginPath();g.ellipse(128,174,13,3.5,0,0,PI*2);g.fill();
    for(let k=0;k<900;k++){g.fillStyle=rgba(hc.clone().multiplyScalar(.6),.5);g.fillRect(54+Math.random()*148,120+Math.random()*96,1,2)}}
  return ctex(c)}
/* ================= PLAYER LOOKS & UNIFORMS =================
   Customisation channels for matching team photos.
   PLAYER_LOOK[i]: skin (color), skinMap (optional THREE.Texture for arms/neck), hair (color),
     hairStyle ('short' | 'buzz' | 'long' | 'curly' | 'dreads' | 'bald'),
     facialHair ('none' | 'stubble' | 'mustache' | 'goatee' | 'beard'), eyes, number, sleeves ('long' | 'short'),
     height, build (shoulder width), limbs (muscle mass), head (head size).
   UNIFORMS[team]: jersey, trim, letters, lettersOutline, undershirt, pants, belt, socks, stirrups,
     cleats, cleatTrim, sole, cap, bill, capLogo, helmet, name.
   At runtime: rig.setLook({...}) for one player, setUniform(team,{...}) for a whole side. */
const RIG_S=1.5;          // rig units -> feet: a 1.00-height build stands 6'0" (head is ~1/7.5 of that)
const HAIR_STYLE={bun:'long',dreads:'dreads',curly:'curly',wild:'curly',messy:'short',bob:'long',mohawk:'short',short:'short',buzz:'buzz',long:'long',bald:'bald'};
// [height, shoulder width, limb mass, head size] per roster slot
const BUILD=[[0.95,0.94,0.92,1.00],[1.05,1.05,1.01,1.00],[1.00,0.95,0.96,0.98],[1.00,1.00,0.98,1.00],[1.02,0.96,0.96,1.00],[1.06,1.06,1.02,1.00],[1.02,0.95,0.95,0.98],[1.06,1.04,1.01,1.00],[1.00,0.98,0.96,1.00],[0.98,0.96,0.96,1.00],[1.06,1.07,1.02,1.02],[1.00,0.96,0.96,1.00],[0.95,0.94,0.92,1.04],[0.96,0.94,0.93,1.00],[1.00,0.94,0.93,1.00],[0.94,0.94,0.92,1.04],[1.03,0.98,0.97,1.00],[1.04,0.94,0.93,1.00],[0.95,0.94,0.92,1.02],[0.98,0.94,0.92,1.00],[0.97,0.94,0.95,1.00],[1.03,0.98,0.96,1.00],[1.04,1.00,0.98,1.00],[1.00,0.94,0.93,1.00],[1.06,1.04,1.00,1.00],[1.06,1.07,1.02,0.98],[1.03,0.97,0.96,1.00],[1.00,0.95,0.96,1.00],[1.03,1.09,1.10,1.00],[0.97,0.94,0.95,1.00],[1.00,0.96,0.96,1.00],[1.00,1.06,1.10,1.00],[1.04,1.00,0.98,1.00],[1.00,0.94,0.92,1.00]];
const PLAYER_LOOK=LOOKS.map((L,i)=>({skin:L[0],skinMap:null,hair:L[1],hairStyle:HAIR_STYLE[L[2]]||'short',
  facialHair:L[10].includes('b')?'beard':(['none','none','goatee','none','mustache','none','none','stubble'][(i*5)%8]),
  eyes:EYES[(i*5+3)%EYES.length],number:((i*37)%98)+1,sleeves:i%3===2?'short':'long',
  height:BUILD[i][0],build:BUILD[i][1],limbs:BUILD[i][2],head:BUILD[i][3]}));
const UNIFORMS={
  you:{name:'SLUGGERS',jersey:'#f4f2ec',trim:'#c8342a',letters:'#c8342a',lettersOutline:'#1f2433',undershirt:'#c8342a',pants:'#f4f2ec',belt:'#a5281f',
       socks:'#f4f2ec',stirrups:'#c8342a',cleats:'#1d1e22',cleatTrim:'#c8342a',sole:'#f2f2f0',cap:'#c8342a',bill:'#c8342a',capLogo:'#f4f2ec',helmet:'#c8342a'},
  cpu:{name:'BANDITS',jersey:'#a9aeb5',trim:'#1f3f8a',letters:'#1f3f8a',lettersOutline:'#f4f2ec',undershirt:'#1f3f8a',pants:'#a9aeb5',belt:'#1a2f63',
       socks:'#f4f2ec',stirrups:'#1f3f8a',cleats:'#1d1e22',cleatTrim:'#3d7be0',sole:'#1d1e22',cap:'#1f3f8a',bill:'#1f3f8a',capLogo:'#f4f2ec',helmet:'#1f3f8a'}};
function setUniform(team,patch){Object.assign(UNIFORMS[team],patch||{});Object.values(rigs).forEach(r=>{if(r.team===team)r.dressFor(team)})}

/* ---------- uniform textures ---------- */
// torso UVs: u wraps the body with the chest centre at u=.25 and the spine at u=.75; v runs hem (0) to collar (1)
function jerseyTexture(U,num,name){
  const[c,g]=mk(1024,512),X=u=>u*1024,Y=v=>512*(1-v);
  g.fillStyle=U.jersey;g.fillRect(0,0,1024,512);
  for(let k=0;k<5000;k++){g.fillStyle=Math.random()<.5?'rgba(0,0,0,.03)':'rgba(255,255,255,.035)';g.fillRect(Math.random()*1024,Math.random()*512,2,2)}
  g.fillStyle=U.trim;g.fillRect(0,Y(1),1024,Y(.975)-Y(1));                                   // collar binding
  g.fillRect(X(.25)-16,Y(.975),5,Y(0));g.fillRect(X(.25)+11,Y(.975),5,Y(0));                  // placket piping
  g.fillStyle='rgba(0,0,0,.12)';g.fillRect(X(.25)-2,Y(.975),3,Y(0));
  for(let v=.9;v>.1;v-=.105){g.fillStyle='rgba(255,255,255,.9)';g.beginPath();g.arc(X(.25)+5,Y(v),4.5,0,7);g.fill();g.strokeStyle='rgba(0,0,0,.25)';g.lineWidth=1;g.stroke()}
  const word=(t,u,v,px,max,rot=0,italic=true)=>{g.save();g.translate(X(u),Y(v));g.rotate(rot);g.font=`${italic?'italic ':''}900 ${px}px "Arial Black", Impact, sans-serif`;g.textAlign='center';g.textBaseline='middle';
    g.lineJoin='round';g.lineWidth=px*.16;g.strokeStyle=U.lettersOutline;g.strokeText(t,0,0,max);g.fillStyle=U.letters;g.fillText(t,0,0,max);g.restore()};
  // front: arched team script across the chest, small number low on the left side of the chest
  const n=U.name.length,arcW=300;for(let k=0;k<n;k++){const f=n>1?k/(n-1)-.5:0;word(U.name[k],.25+f*arcW/1024,.7+.035*(1-4*f*f),62,48,f*.35,true)}
  word(String(num),.325,.47,64,90,0,false);
  // back: player's name over a 10-inch number
  word(String(name).toUpperCase(),.75,.86,40,220,0,false);word(String(num),.75,.6,190,250,0,false);
  return ctex(c,true)}
function pantsTexture(U){const[c,g]=mk(128,16);g.fillStyle=U.pants;g.fillRect(0,0,128,16);g.fillStyle=U.trim;g.fillRect(32-4,0,8,16);return ctex(c,true)} // piping down the outer seam (u=.25)
function logoTexture(U,col){const[c,g]=mk(128,128);g.clearRect(0,0,128,128);g.font='italic 900 96px "Arial Black", Impact, sans-serif';g.textAlign='center';g.textBaseline='middle';
  g.lineWidth=10;g.lineJoin='round';g.strokeStyle=U.lettersOutline;g.strokeText(U.name[0],64,68);g.fillStyle=col;g.fillText(U.name[0],64,68);return ctex(c,true)}

/* ================= SHARED MATERIALS & SHAPES ================= */
// physically based materials: fabric gets a weave normal map, metal and leather keep their sheen
const STD=(c,o)=>{o=Object.assign({},o||{});const r=o.roughness??.86,m=o.metalness??0;delete o.roughness;delete o.metalness;
  const mat=new THREE.MeshStandardMaterial(Object.assign({color:c,roughness:r,metalness:m,envMap:ENV,envMapIntensity:m>.3?1:.35},o));
  if(r>.6&&m<.3&&!o.emissive){mat.normalMap=CLOTH_N;mat.normalScale.set(.45,.45)}return mat};
const SKIN=(c,o)=>{const col=new THREE.Color(c);return new THREE.MeshStandardMaterial(Object.assign({color:col,roughness:.6,metalness:0,envMap:ENV,envMapIntensity:.3,normalMap:SKIN_N,normalScale:new THREE.Vector2(.25,.25),
  emissive:col.clone().lerp(new THREE.Color('#ff6a50'),.5),emissiveIntensity:.07},o||{}))}; // faint warm glow fakes light scattering under skin
const HAIR=c=>new THREE.MeshStandardMaterial({color:c,roughness:.55,metalness:0,envMap:ENV,envMapIntensity:.45,normalMap:HAIR_N,normalScale:new THREE.Vector2(.8,.8)});
const GLOSS=c=>new THREE.MeshStandardMaterial({color:c,roughness:.2,metalness:.12,envMap:ENV,envMapIntensity:1.1});
const lathe=(pts,n=26)=>new THREE.LatheGeometry(pts.map(([r,y])=>new THREE.Vector2(r,y)),n);
const bump=(x,c,w)=>{const d=(x-c)/w;return Math.exp(-d*d)};
const curve=(pts,x)=>{if(x<=pts[0][0])return pts[0][1];for(let k=1;k<pts.length;k++)if(x<=pts[k][0]){const[a,b]=pts[k-1],[c,d]=pts[k],t=ease((x-a)/(c-a));return b+(d-b)*t}return pts[pts.length-1][1]};
const sstep=(a,b,x)=>{const t=cl((x-a)/(b-a),0,1);return t*t*(3-2*t)};
// skull shape shared by the head, hair caps, facial hair and headwear that sit on it
function headDeform(g,face){const p=g.attributes.position;
  for(let k=0;k<p.count;k++){let x=p.getX(k),y=p.getY(k),z=p.getZ(k);
    if(y<0){const t=-y;x*=1-.3*Math.pow(t,1.4);z*=z>0?1-.06*t:1-.38*t;if(y<-.55)y*=1+.1*(t-.55)}   // jaw tapers to a chin, neck tucks in behind
    if(z<0&&y>-.3)z*=1.1;                                                                           // back of skull
    if(y>0)x*=1-.06*y;x*=.9;                                                                         // narrower than deep
    if(face){
      if(z>.5&&Math.abs(y+.06)<.24&&Math.abs(x)<.62)z-=.06*Math.cos((y+.06)/.24*PI/2)*Math.cos(Math.min(1,Math.abs(Math.abs(x)-.34)/.28)*PI/2); // eye sockets
      if(z>.6&&y>-.2&&y<.05&&Math.abs(x)>.38)z+=.035;                                                // cheekbones
      if(z>.6&&y<-.6&&Math.abs(x)<.3)z+=.05*(1-Math.abs(x)/.3)}                                       // chin
    p.setXYZ(k,x,y,z)}g.computeVertexNormals()}
// hair cap: a shell over the skull, trimmed to a hairline (high at the forehead, above the ears, low at the nape)
function hairCap(lift,low){const g=new THREE.SphereGeometry(1,48,26,0,PI*2,0,PI*.66),p=g.attributes.position;
  const HL=[[0,.56],[.55,.5],[.95,.2],[1.6,.24],[2.25,-.05],[PI,low??-.36]],hl=a=>{for(let k=1;k<HL.length;k++)if(a<=HL[k][0]){const[a0,y0]=HL[k-1],[a1,y1]=HL[k];return lerp(y0,y1,(a-a0)/(a1-a0))}return HL[HL.length-1][1]};
  for(let k=0;k<p.count;k++){const x=p.getX(k),y=p.getY(k),z=p.getZ(k),h=hl(Math.abs(Math.atan2(x,z)));
    if(y<h){const r=Math.sqrt(Math.max(0,1-h*h)),q=Math.hypot(x,z)||1;p.setXYZ(k,x/q*r,h,z/q*r)}}
  headDeform(g,false);g.scale(lift,lift,lift);return g}
// a shell patch of the skull (sphere angles as in THREE.SphereGeometry), pushed out by `lift`
function skullPatch(lift,phi0,phiL,th0,thL,ws=28,hs=14){const g=new THREE.SphereGeometry(1,ws,hs,phi0,phiL,th0,thL);headDeform(g,false);g.scale(lift,lift,lift);g.computeVertexNormals();return g}

/* ---------- body part geometry ---------- */
// grid of rings: ring(k) -> {y, pts:[[x,z]...]} ; returns an indexed geometry with torso-style UVs
function ringGrid(rings,seg,vOf){
  const K=rings.length,pos=[],uv=[],idx=[];
  for(let k=0;k<K;k++){const r=rings[k];for(let j=0;j<=seg;j++){const[x,z]=r.pts[j];pos.push(x,r.y,z);uv.push(j/seg,vOf(r.y))}}
  for(let k=0;k<K-1;k++)for(let j=0;j<seg;j++){const a=k*(seg+1)+j,b=a+seg+1;idx.push(a,a+1,b,a+1,b+1,b)}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g}
// superellipse section: theta 0 = chest (+z), theta grows toward the player's left (+x); param starts at the right side so u=.25 is the chest
const SEC_TH=j=>j*2*PI-PI/2;
function section(W,D,seg,pw,shape){const pts=[];for(let j=0;j<=seg;j++){const th=SEC_TH(j/seg),s=Math.sin(th),c=Math.cos(th);
  let x=W*Math.sign(s)*Math.pow(Math.abs(s),2/pw),z=D*Math.sign(c)*Math.pow(Math.abs(c),2/pw);if(shape)[x,z]=shape(x,z,th);pts.push([x,z])}return pts}
const TORSO_V=yc=>(yc+.1)/1.54;  // jersey v from chest-space height (abdomen and chest share one texture)
// chest: rib cage, pecs, lats flaring to broad shoulders, trapezius sloping up to the neck. Chest-group space.
function chestGeo(bw){
  const P=[[.2,.355,.262],[.4,.37,.27],[.6,.41,.282],[.8,.455,.3],[.95,.48,.31],[1.07,.495,.3],[1.16,.48,.272],[1.24,.42,.24],[1.31,.31,.205],[1.37,.21,.172],[1.44,.155,.142]];
  const rings=[];for(let k=0;k<=26;k++){const y=lerp(.2,1.44,k/26),W=curve(P.map(q=>[q[0],q[1]]),y)*bw,D=curve(P.map(q=>[q[0],q[2]]),y)*(.88+.12*bw);
    rings.push({y,pts:section(W,D,40,2.35,(x,z,th)=>{const ax=Math.abs(x)/W;
      if(z>0){z+=.03*bump(y,.98,.11)*bump(ax,.46,.3)-.012*bump(y,.6,.2)*bump(ax,0,.18)}            // pecs; sternum/abs line
      else{z-=.016*bump(y,1.0,.13)*bump(ax,.45,.28);z+=.012*bump(x,0,.05)*sstep(.35,.6,y)}           // shoulder blades; spine groove
      return[x,z]})})}
  return ringGrid(rings,40,TORSO_V)}
// pelvis and seat of the pants (hips-group space); glutes behind, hip bones at the sides
function pelvisGeo(bw){
  const P=[[-.44,.18,.15],[-.38,.34,.24],[-.26,.425,.285],[-.12,.445,.3],[0,.42,.292],[.08,.4,.285],[.15,.388,.28]];
  const rings=[];for(let k=0;k<=14;k++){const y=lerp(-.44,.15,k/14),W=curve(P.map(q=>[q[0],q[1]]),y)*bw,D=curve(P.map(q=>[q[0],q[2]]),y);
    rings.push({y,pts:section(W,D,36,2.2,(x,z)=>[x,z<0?z-.045*bump(y,-.2,.13)*bump(Math.abs(x)/W,.45,.4):z])})}
  return ringGrid(rings,36,y=>y)}
function hand(skin,thumbSide){ // wrist at the origin, fingers along +y, palm toward +z
  const g=new THREE.Group(),M=(geo,px,py,pz,rx,rz)=>{const m=new THREE.Mesh(geo,skin);m.position.set(px,py,pz);m.rotation.set(rx||0,0,rz||0);m.castShadow=true;g.add(m);return m};
  const palm=new THREE.BoxGeometry(1,1,1,4,6,3),p=palm.attributes.position;
  for(let k=0;k<p.count;k++){let x=p.getX(k),y=p.getY(k),z=p.getZ(k);const r=Math.hypot(x*1.6,z*2.2);x*=.86+.18*(y+.5);z*=1-.35*Math.pow(Math.abs(x)*2,3);
    const e=Math.hypot(x,y,z)||1;x=lerp(x,x/e*.55,.35);z=lerp(z,z/e*.55,.35);p.setXYZ(k,x,y,z)}
  palm.scale(.17,.19,.075);palm.translate(0,.1,.004);palm.computeVertexNormals();M(palm,0,0,0);
  const seg=(len,r0,r1)=>{const l=lathe([[0,0],[r0,0],[r0*1.02,len*.2],[r1,len*.85],[r1*.7,len*.97],[0,len]],10);l.computeVertexNormals();return l};
  const fl=[.088,.1,.094,.074];g.userData.fingers=[];
  for(let f=0;f<4;f++){const x=(f-1.5)*.04*-thumbSide,base=new THREE.Group();base.position.set(x,.19,.006);base.rotation.x=.55;g.add(base);
    const a=new THREE.Mesh(seg(fl[f],.021,.019),skin);a.castShadow=true;base.add(a);const j=new THREE.Group();j.position.y=fl[f]*.95;j.rotation.x=.7;base.add(j);
    const b=new THREE.Mesh(seg(fl[f]*.82,.019,.016),skin);b.castShadow=true;j.add(b);g.userData.fingers.push(base)}
  const th=new THREE.Group();th.position.set(thumbSide*.07,.06,.03);th.rotation.set(.5,0,-thumbSide*.75);g.add(th);
  const t1=new THREE.Mesh(seg(.075,.026,.022),skin);t1.castShadow=true;th.add(t1);const tj=new THREE.Group();tj.position.y=.07;tj.rotation.x=.35;th.add(tj);
  const t2=new THREE.Mesh(seg(.06,.022,.018),skin);t2.castShadow=true;tj.add(t2);g.userData.fingers.push(th);
  return g}
function fieldersGlove(leather,lace){ // hinged leather mitt over the hand: pocket, four finger stalls, thumb stall, H-web, laced rim
  const g=new THREE.Group(),add=(geo,m,px,py,pz,rx=0,ry=0,rz=0)=>{const o=new THREE.Mesh(geo,m);o.position.set(px,py,pz);o.rotation.set(rx,ry,rz);o.castShadow=true;g.add(o);return o};
  const body=new THREE.SphereGeometry(1,26,18),p=body.attributes.position;
  for(let k=0;k<p.count;k++){let x=p.getX(k),y=p.getY(k),z=p.getZ(k);z*=z>0?.3:.5;x*=.92+.16*y;if(z>0)z-=.12*(1-x*x)*(1-y*y);p.setXYZ(k,x,y,z)}
  body.scale(.19,.23,.2);body.computeVertexNormals();add(body,leather,0,.17,.05);
  const stall=(len,r)=>{const l=lathe([[0,0],[r,0],[r*1.05,len*.3],[r*.95,len*.8],[r*.6,len*.96],[0,len]],12);l.computeVertexNormals();return l};
  for(let f=0;f<4;f++)add(stall(.17-.015*Math.abs(f-1.2),.046),leather,(f-1.5)*.085,.33,.04,.12,0,(f-1.5)*-.1);
  add(stall(.2,.05),leather,.2,.12,.07,.3,0,-1.0);
  const web=new THREE.BoxGeometry(1,1,1,3,3,1);web.scale(.1,.12,.02);add(web,lace,.16,.3,.09,.1,0,-.45);
  const rim=new THREE.TorusGeometry(.2,.012,5,28,PI*1.3);add(rim,lace,0,.19,.12,0,0,-.15*PI);
  return g}
function cleat(m){ // shoe origin under the ankle; toe toward +z
  const g=new THREE.Group(),add=(geo,mat,px=0,py=0,pz=0,rx=0)=>{const o=new THREE.Mesh(geo,mat);o.position.set(px,py,pz);o.rotation.x=rx;o.castShadow=true;o.receiveShadow=true;g.add(o);return o};
  const up=new THREE.SphereGeometry(1,30,16),p=up.attributes.position;
  for(let k=0;k<p.count;k++){let x=p.getX(k),y=p.getY(k),z=p.getZ(k);if(y<0)y*=.25;const toe=sstep(.05,.9,z);y*=1-.5*toe;x*=1-.18*sstep(.5,1,z)+.06*bump(z,.2,.3);
    if(z<-.6)y*=1+.15*(-.6-z);p.setXYZ(k,x,y,z)}
  up.scale(.115,.17,.3);up.translate(0,.06,.15);up.computeVertexNormals();add(up,m.cleats);
  const ol=new THREE.Shape();ol.moveTo(-.1,-.15);ol.quadraticCurveTo(0,-.2,.1,-.15);ol.lineTo(.12,.3);ol.quadraticCurveTo(0,.5,-.12,.3);ol.closePath();
  const sole=new THREE.ExtrudeGeometry(ol,{depth:.04,bevelEnabled:true,bevelSize:.01,bevelThickness:.01,bevelSegments:2});sole.rotateX(PI/2);sole.translate(0,.045,0);add(sole,m.sole);
  const stud=new THREE.ConeGeometry(.018,.05,6);stud.rotateX(PI);for(const[x,z]of[[-.07,-.1],[.07,-.1],[-.08,.12],[.08,.12],[0,.24],[-.07,.28],[.07,.28]])add(stud,m.sole,x,.005,z);
  const lace=new THREE.BoxGeometry(.11,.012,.24);add(lace,m.laces,0,.19,.16,-.42);
  for(const s of[1,-1]){const sw=new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(s*.112,.06,-.08),V3(s*.122,.12,.1),V3(s*.1,.09,.3)]),12,.012,5);add(sw,m.cleatTrim)}
  return g}
// continuous arm or leg skin: rings of radius R(s,theta) placed along the bone chain A->B->C.
// The centre line rounds through the middle joint on a short Bezier, so elbows and knees bend without gaps.
class LimbTube{
  constructor({L1,L2,join,S,R,groups,mats,seg=18}){
    const n=seg,K=S.length;Object.assign(this,{L1,L2,join,S,n,K});
    const R0=this.R=new Float32Array(K*(n+1)),Dd=this.D=new Float32Array(K*(n+1));this.cs=[];this.sn=[];
    for(let j=0;j<=n;j++){const th=j/n*2*PI;this.cs.push(Math.cos(th));this.sn.push(Math.sin(th))}
    for(let k=0;k<K;k++)for(let j=0;j<=n;j++)R0[k*(n+1)+j]=Math.max(0,R(S[k],j/n*2*PI));
    for(let k=0;k<K;k++)for(let j=0;j<=n;j++){const a=Math.max(0,k-1),b=Math.min(K-1,k+1);Dd[k*(n+1)+j]=(R0[b*(n+1)+j]-R0[a*(n+1)+j])/((S[b]-S[a])||1)}
    const N=K*(n+1),pos=new Float32Array(N*3),nor=new Float32Array(N*3),uv=new Float32Array(N*2);
    for(let k=0;k<K;k++)for(let j=0;j<=n;j++){const v=k*(n+1)+j;uv[v*2]=j/n;uv[v*2+1]=k/(K-1)}
    this.idxP=[];this.idxN=[];
    const g=this.geo=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('normal',new THREE.BufferAttribute(nor,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));
    const idx=[];let gs=0,gm=-1;const matAt=s=>{for(const[e,m]of groups)if(s<e-1e-6)return m;return groups[groups.length-1][1]};
    for(let k=0;k<K-1;k++){const m=matAt((S[k]+S[k+1])/2);if(m!==gm){if(gm>=0)g.addGroup(gs,idx.length-gs,gm);gs=idx.length;gm=m}
      for(let j=0;j<n;j++){const a=k*(n+1)+j,b=a+n+1;idx.push(a,a+1,b,a+1,b+1,b)}}
    g.addGroup(gs,idx.length-gs,gm);g.setIndex(idx);this.fwd=idx;this.rev=idx.slice();for(let t=0;t<this.rev.length;t+=3){const x=this.rev[t+1];this.rev[t+1]=this.rev[t+2];this.rev[t+2]=x}this.q=1;
    this.mesh=new THREE.Mesh(g,mats);this.mesh.frustumCulled=false;this.mesh.castShadow=true;this.mesh.receiveShadow=true;
    this.endT=V3();this.endN=V3();this.endB=V3()}
  // q = +1 puts theta=90deg on the side given by tangent x front, -1 on the other; used so theta=90deg is always the outer side
  update(A,B,C,front,q){
    if(q!==this.q){this.q=q;this.geo.index.array.set(q>0?this.fwd:this.rev);this.geo.index.needsUpdate=true}
    const{L1,join:w,S,n,K,R,D,cs,sn}=this,pos=this.geo.attributes.position.array,nor=this.geo.attributes.normal.array;
    const d1=_lt.d1.subVectors(B,A).normalize(),d2=_lt.d2.subVectors(C,B).normalize(),c=_lt.c,t=_lt.t,N=_lt.N,Bn=_lt.B,P0=_lt.p0,P2=_lt.p2;
    N.copy(front).addScaledVector(d1,-front.dot(d1));if(N.lengthSq()<1e-6)N.set(d1.y,-d1.x,0);if(N.lengthSq()<1e-6)N.set(0,0,1);N.normalize();
    P0.copy(B).addScaledVector(d1,-w);P2.copy(B).addScaledVector(d2,w);
    for(let k=0;k<K;k++){const s=S[k];
      if(s<=L1-w){c.copy(A).addScaledVector(d1,s);t.copy(d1)}
      else if(s>=L1+w){c.copy(B).addScaledVector(d2,s-L1);t.copy(d2)}
      else{const u=(s-(L1-w))/(2*w),a=(1-u)*(1-u),b=2*u*(1-u),e=u*u;c.set(P0.x*a+B.x*b+P2.x*e,P0.y*a+B.y*b+P2.y*e,P0.z*a+B.z*b+P2.z*e);t.copy(d1).multiplyScalar(1-u).addScaledVector(d2,u);if(t.lengthSq()<1e-8)t.copy(d2);t.normalize()}
      N.addScaledVector(t,-N.dot(t));if(N.lengthSq()<1e-8)N.set(t.y,-t.x,0);N.normalize();Bn.crossVectors(t,N).multiplyScalar(q);
      for(let j=0;j<=n;j++){const v=k*(n+1)+j,r=R[v],dd=D[v],dx=N.x*cs[j]+Bn.x*sn[j],dy=N.y*cs[j]+Bn.y*sn[j],dz=N.z*cs[j]+Bn.z*sn[j];
        pos[v*3]=c.x+dx*r;pos[v*3+1]=c.y+dy*r;pos[v*3+2]=c.z+dz*r;
        let nx=dx-t.x*dd,ny=dy-t.y*dd,nz=dz-t.z*dd;const l=Math.hypot(nx,ny,nz)||1;nor[v*3]=nx/l;nor[v*3+1]=ny/l;nor[v*3+2]=nz/l}}
    this.endT.copy(t);this.endN.copy(N);this.endB.copy(Bn).multiplyScalar(q);
    this.geo.attributes.position.needsUpdate=true;this.geo.attributes.normal.needsUpdate=true}}
const _lt={d1:V3(),d2:V3(),c:V3(),t:V3(),N:V3(),B:V3(),p0:V3(),p2:V3()};
const ringS=(a,b,step,extra)=>{const s=new Set();for(let x=a;x<b-1e-6;x+=step)s.add(+x.toFixed(4));s.add(b);(extra||[]).forEach(x=>s.add(x));return[...s].sort((p,q)=>p-q)};
const dome=(s,len,r)=>r*Math.sqrt(Math.max(0,1-(s/len)**2));
// muscle profiles: theta 0 = front of the limb, 90deg = outer side. lb scales muscle mass.
function armProfile(lb,sleeve){const L1=LA[0],L2=LA[1],SE=.3;
  return(s,th)=>{const c=Math.cos(th),sn=Math.sin(th),F=Math.max(0,c)**2,Bk=Math.max(0,-c)**2,Lt=Math.max(0,sn)**2,Md=Math.max(0,-sn)**2;let r;
    if(s<0)r=dome(s,.11,.142*lb+(sleeve?.02:0));
    else if(s<=L1){const u=s/L1;r=curve([[0,.142],[.18,.142],[.45,.122],[.78,.1],[1,.088]],u)*lb;
      r+=(.024*bump(u,.06,.2)*Lt+.03*bump(u,.52,.2)*F+.024*bump(u,.4,.22)*Bk)*lb;                      // deltoid cap, biceps, triceps
      if(s<SE)r+=.028+.006*bump(s,SE,.03);else if(s<SE+.045)r+=.033;else r+=.005}                       // loose sleeve, trim band, undershirt
    else if(s<=L1+L2){const v=(s-L1)/L2;r=curve([[0,.088],[.14,.098],[.32,.095],[.62,.078],[.9,.064],[1,.062]],v)*lb;
      r+=(.016*bump(v,.22,.18)*F+.012*bump(v,.2,.2)*Lt)*lb-.012*sstep(.7,1,v)*(Lt+Md)+.004}             // forearm mass, flat wrist
    else r=dome(s-L1-L2,.035,.062*lb+.004);
    return r}}
function legProfile(lb){const L1=LL[0],L2=LL[1],KN=L1+.36;
  return(s,th)=>{const c=Math.cos(th),sn=Math.sin(th),F=Math.max(0,c)**2,Bk=Math.max(0,-c)**2,Lt=Math.max(0,sn)**2,Md=Math.max(0,-sn)**2;let r;
    if(s<0)r=dome(s,.17,.235*lb);
    else if(s<=L1){const u=s/L1;r=curve([[0,.215],[.2,.205],[.5,.185],[.8,.152],[1,.13]],u)*lb;
      r+=(.03*bump(u,.45,.25)*F+.022*bump(u,.55,.25)*Lt+.025*bump(u,.35,.25)*Bk+.016*bump(u,.2,.2)*Md+.016*bump(u,1,.05)*F)*lb}  // quads, vastus, hamstrings, adductors, kneecap
    else if(s<=L1+L2){const v=(s-L1)/L2;r=curve([[0,.13],[.15,.128],[.35,.13],[.6,.105],[.85,.078],[1,.072]],v)*lb;
      r+=(.045*bump(v,.28,.17)*Bk+.014*bump(v,.25,.18)*Md+.012*bump(v,0,.06)*F)*lb-.01*bump(v,.5,.3)*F}  // calf, inner calf, kneecap, flat shin
    else r=dome(s-L1-L2,.035,.072*lb+.006);
    if(s<KN)r+=.028+.03*bump(s,KN-.03,.05);else if(s<L1+L2+.04)r+=.006;                                   // baggy knickers bloused at the calf, stirrups/socks
    return r}}

/* ================= PLAYER RIG ================= */
const GEO={cyl:new THREE.CylinderGeometry(1,1,1,16,1),sph:new THREE.SphereGeometry(1,22,16),
  head:(()=>{const g=new THREE.SphereGeometry(1,48,36);headDeform(g,true);return g})(),
  // 34" bat for a 6-ft player: knob, thin handle, long taper, barrel, rounded end cap (rig units, root scale makes feet)
  bat:(()=>{const g=lathe([[0,-.05],[.07,-.05],[.075,-.02],[.04,.03],[.038,.75],[.048,1.05],[.075,1.45],[.1,1.8],[.108,2.2],[.108,2.48],[.09,2.56],[0,2.59]],16);g.scale(.73,.73,.73);return g})()};
const rigs={};
const BATCH=new URLSearchParams(location.search).get('batch')!=='0'&&typeof window.__batchStatic==='function';
const batchStatic=(root,exclude)=>BATCH?window.__batchStatic(root,exclude):null;
const LA=[.74,.68],LL=[.92,.9]; // arm / leg bone lengths (rig units)
const HEAD_S=[.27*.87,.31*.87,.29*.87];
class Rig{
  constructor(i,team){
    this.i=i;this.L=LOOKS[i];this.look=Object.assign({},PLAYER_LOOK[i]);this.lefty=LEFTY.has(i);this.team=team;
    const lk=this.look,root=this.root=new THREE.Group();scene.add(root);
    this.bh=lk.height;this.bw=lk.build;this.lb=lk.limbs;
    const m=this.mats={skin:SKIN(lk.skin),hair:HAIR(lk.hair),jersey:STD('#ffffff'),sleeve:STD('#ffffff'),trim:STD('#ffffff'),undershirt:STD('#ffffff',{roughness:.7}),
      pants:STD('#ffffff'),pantsPlain:STD('#ffffff'),belt:STD('#ffffff',{roughness:.45}),socks:STD('#ffffff'),stirrups:STD('#ffffff'),
      cleats:STD('#ffffff',{roughness:.4}),cleatTrim:STD('#ffffff',{roughness:.4}),sole:STD('#ffffff',{roughness:.5}),laces:STD('#f4f2ec'),
      cap:STD('#ffffff',{roughness:.8}),bill:STD('#ffffff',{roughness:.75,side:THREE.DoubleSide}),helmet:(()=>{const h=GLOSS('#ffffff');h.side=THREE.DoubleSide;return h})(),
      logo:new THREE.MeshStandardMaterial({transparent:true,roughness:.6,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2}),
      glove:STD('#8a5428',{roughness:.55}),gloveLace:STD('#3a2414',{roughness:.6})};
    for(const k of['jersey','sleeve','undershirt','pants','pantsPlain','socks','stirrups','cap','trim','belt']){m[k].normalMap=null;m[k].roughness=.8} // smooth knit: a weave map reads as quilting at this scale
    const M=(g,mat,cast=true)=>{const x=new THREE.Mesh(g,mat);x.castShadow=cast;x.receiveShadow=true;return x};
    // trunk: pelvis + belt (hips), abdomen skinned between hips and chest, chest with shoulders and traps
    this.hips=new THREE.Group();root.add(this.hips);
    this.pelvis=M(pelvisGeo(this.bw),m.pantsPlain);this.hips.add(this.pelvis);
    const belt=M(ringGrid([.08,.17].map(y=>({y,pts:section(.412*this.bw,.298,36,2.2)})),36,y=>y),m.belt);this.hips.add(belt);
    const buckle=M(new THREE.BoxGeometry(.085,.07,.02),STD('#c9ccd0',{metalness:.8,roughness:.3}));buckle.position.set(0,.125,.305);this.hips.add(buckle);
    this.chest=new THREE.Group();this.chest.position.y=.1;this.hips.add(this.chest);
    this.torso=M(chestGeo(this.bw),m.jersey);this.chest.add(this.torso);
    this.abs=this.buildAbdomen();root.add(this.abs.mesh);
    this.neck=new THREE.Group();this.neck.position.y=1.34;this.chest.add(this.neck);
    const nk=lathe([[0,-.12],[.172,-.12],[.158,0],[.142,.14],[.135,.28],[.13,.38],[0,.4]],20);nk.computeVertexNormals();const neckM=M(nk,m.skin);neckM.rotation.x=-.08;this.neck.add(neckM);
    const collar=M(new THREE.TorusGeometry(.158,.022,8,28),m.trim);collar.rotation.x=PI/2-.12;collar.scale.set(1.05,1,.95);collar.position.y=.035;this.neck.add(collar);
    this.headMat=SKIN('#ffffff');this.paintHead();
    this.head=M(GEO.head,this.headMat);this.head.scale.set(HEAD_S[0]*lk.head,HEAD_S[1]*lk.head,HEAD_S[2]*lk.head);this.head.position.y=.42;this.neck.add(this.head);
    for(const s of[1,-1]){const e=M(GEO.sph,m.skin);e.scale.set(.09,.26,.16);e.position.set(s*.86,-.06,-.06);e.rotation.y=s*.25;this.head.add(e);const lobe=M(GEO.sph,m.skin,false);lobe.scale.set(.6,.35,.5);lobe.position.set(0,-.75,.1);e.add(lobe)}
    this.face(i);batchStatic(this.head);this.buildHair();this.buildHeadwear();
    // limbs: one continuous skinned tube per arm and per leg
    this.arm=[0,1].map(s=>{const sg=s?-1:1,S=ringS(0,LA[0]+LA[1],.05,[-.12,-.09,-.06,-.03,.3,.345,LA[0]+LA[1]+.018,LA[0]+LA[1]+.03,LA[0]+LA[1]+.035]);
      const t=new LimbTube({L1:LA[0],L2:LA[1],join:.12,seg:14,S,R:armProfile(this.lb,true),groups:[[.3,0],[.345,1],[9,2]],mats:[m.sleeve,m.trim,lk.sleeves==='long'?m.undershirt:m.skin]});root.add(t.mesh);t.sg=sg;return t});
    this.leg=[0,1].map(s=>{const sg=s?-1:1,KN=LL[0]+.36,S=ringS(0,LL[0]+LL[1],.055,[-.17,-.13,-.09,-.05,-.02,KN,KN+.35,LL[0]+LL[1]+.02,LL[0]+LL[1]+.032,LL[0]+LL[1]+.035]);
      const t=new LimbTube({L1:LL[0],L2:LL[1],join:.15,seg:16,S,R:legProfile(Math.pow(this.lb,.8)),groups:[[KN,0],[KN+.35,1],[9,2]],mats:[m.pants,m.stirrups,m.socks]});root.add(t.mesh);t.sg=sg;return t});
    this.hand=[0,1].map(s=>{const h=hand(m.skin,s?1:-1);if(s)batchStatic(h);else h.userData.fingers.forEach(f=>batchStatic(f));root.add(h);return h});   // thumb toward the body's front-outer side
    this.ft=[0,1].map(()=>{const f=cleat(m);batchStatic(f);root.add(f);return f});
    this.glove=fieldersGlove(m.glove,m.gloveLace);batchStatic(this.glove);this.hand[0].add(this.glove);this.glove.visible=false;
    this.bat=M(GEO.bat,STD('#c99a5e',{roughness:.45}));root.add(this.bat);this.bat.visible=false;
    // contact shadow + team ring (kept at their old on-field size)
    this.blob=new THREE.Mesh(blobGeo,new THREE.MeshBasicMaterial({map:blobTex,transparent:true,depthWrite:false,opacity:.9}));this.blob.position.y=.05;this.blob.scale.set(2.2,1,2.2);root.add(this.blob);
    this.ring=new THREE.Mesh(ringGeo,new THREE.MeshBasicMaterial({color:team==='you'?0xe0482f:0x3d7be0,transparent:true,opacity:.75,depthWrite:false}));this.ring.position.y=.07;this.ring.scale.setScalar(1.1/RIG_S);root.add(this.ring);
    this.state='idle';this.snap=null;this.fadeT=0;this.fade=.2;this.t0=0;this.one=null;this.yaw=0;this.phase=0;this.speed=0;this.prev=null;this.last=null;
    this.pos=V3();this.reach=null;this.reachW=0;this.lookW=0;this.lookT=V3();this.mirror=false;
    this.dressFor(team);this.setHeadwear('cap');
    root.visible=false;rigs[i]=this}
  // waist: rings blend position and rotation from the hips (bottom) to the chest (top) so twisting swings don't pinch
  buildAbdomen(){
    const bw=this.bw,P=[[-.02,.372,.282],[.15,.352,.266],[.32,.338,.252],[.45,.336,.25],[.6,.338,.252]],ys=[];for(let k=0;k<=12;k++)ys.push(lerp(-.02,.6,k/12));
    const seg=36,rings=ys.map(y=>({y,pts:section(curve(P.map(q=>[q[0],q[1]]),y)*bw,curve(P.map(q=>[q[0],q[2]]),y),seg,2.25)}));
    const g=ringGrid(rings,seg,y=>TORSO_V(y-.1)),mesh=new THREE.Mesh(g,this.mats.jersey);mesh.frustumCulled=false;mesh.castShadow=mesh.receiveShadow=true;
    const rest=g.attributes.position.array.slice(),rn=g.attributes.normal.array.slice();
    return{mesh,rest,rn,ys,seg,w:ys.map(y=>sstep(.08,.5,y))}}
  updateAbdomen(){
    const A=this.abs,pos=A.mesh.geometry.attributes.position.array,nor=A.mesh.geometry.attributes.normal.array,qh=_q.setFromEuler(_e.set(...this.lastHr,'YXZ')).clone(),qc=new THREE.Quaternion().setFromRotationMatrix(_m),q=new THREE.Quaternion(),c=V3(),ch=V3(),cc=V3(),v=V3();
    for(let k=0;k<A.ys.length;k++){const y=A.ys[k],w=A.w[k];ch.set(0,y,0).applyMatrix4(this.hips.matrix);cc.set(0,y-.1,0).applyMatrix4(_m);c.lerpVectors(ch,cc,w);q.copy(qh).slerp(qc,w);
      for(let j=0;j<=A.seg;j++){const o=(k*(A.seg+1)+j)*3;v.set(A.rest[o],0,A.rest[o+2]).applyQuaternion(q);pos[o]=c.x+v.x;pos[o+1]=c.y+v.y;pos[o+2]=c.z+v.z;
        v.set(A.rn[o],A.rn[o+1],A.rn[o+2]).applyQuaternion(q);nor[o]=v.x;nor[o+1]=v.y;nor[o+2]=v.z}}
    A.mesh.geometry.attributes.position.needsUpdate=true;A.mesh.geometry.attributes.normal.needsUpdate=true}
  face(i){ // sculpted features in head space (sizes given relative to a .27 x .31 x .29 head, which the head scale then shrinks)
    const H=this.head,sk=this.mats.skin,W=(x,y,z)=>[x/.27,y/.31,z/.29];
    const add=(g,m,pos,sc,rot,par=H)=>{const o=new THREE.Mesh(g,m);o.position.set(...pos);o.scale.set(...sc);if(rot)o.rotation.set(...rot);o.castShadow=false;o.receiveShadow=true;par.add(o);return o};
    const sclera=STD('#efe9e0',{roughness:.3}),iris=this.mats.iris=new THREE.MeshStandardMaterial({color:this.look.eyes,roughness:.15,envMap:ENV,envMapIntensity:1.2}),
      pupil=new THREE.MeshStandardMaterial({color:'#070504',roughness:.05,envMap:ENV,envMapIntensity:1.5}),lash=new THREE.MeshStandardMaterial({color:'#1a120e',roughness:.8}),
      brow=this.mats.brow=HAIR(this.look.hair),lipC=new THREE.Color(this.look.skin).lerp(new THREE.Color('#a8404a'),.38).multiplyScalar(.9),lip=this.mats.lip=SKIN(lipC,{roughness:.42,normalScale:new THREE.Vector2(.1,.1)});
    const lidTop=new THREE.SphereGeometry(1,20,8,0,PI*2,0,PI*.5),lidBot=new THREE.SphereGeometry(1,20,8,0,PI*2,PI*.5,PI*.5),lashG=new THREE.TorusGeometry(1,.06,4,18,PI);
    const er=.034;
    for(const sd of[1,-1]){
      const eye=new THREE.Group();eye.position.set(sd*.34,-.05,.8);eye.scale.set(...W(er,er,er));H.add(eye);
      add(GEO.sph,sclera,[0,0,0],[1,1,1],null,eye);
      add(GEO.sph,iris,[0,0,.95],[.5,.5,.12],null,eye);add(GEO.sph,pupil,[0,0,1.02],[.22,.22,.06],null,eye);
      add(lidTop,sk,[0,0,0],[1.1,1.1,1.1],[-.2,0,0],eye);add(lidBot,sk,[0,0,0],[1.08,1.08,1.08],[.5,0,0],eye);
      add(lashG,lash,[0,0,0],[1.12,1.12,1.12],[PI/2-.2,0,0],eye);
      add(GEO.sph,brow,[sd*.35,.2,.9],W(.05,.008,.014),[0,sd*.35,sd*-.12]);
    }
    add(GEO.sph,sk,[0,-.1,.95],W(.02,.06,.03),[-.22,0,0]);                    // nose bridge, tip, wings
    add(GEO.sph,sk,[0,-.27,1.0],W(.026,.024,.03));
    for(const sd of[1,-1])add(GEO.sph,sk,[sd*.1,-.3,.93],W(.019,.016,.02));
    add(GEO.sph,lip,[0,-.5,.84],W(.042,.009,.015));add(GEO.sph,lip,[0,-.565,.82],W(.036,.012,.016));   // lips
    add(GEO.sph,lash,[0,-.532,.845],W(.04,.002,.012));
  }
  // hair meshes by style; pieces marked crown hide under a cap or helmet
  buildHair(){
    if(this.hairG){this.head.remove(this.hairG);dropGeo(this.hairG)}const G=this.hairG=new THREE.Group();this.head.add(G);
    const st=this.look.hairStyle,m=this.mats.hair,add=(g,x,y,z,sx,sy,sz,crown)=>{const h=new THREE.Mesh(g,m);h.position.set(x,y,z);h.scale.set(sx,sy,sz);h.castShadow=true;h.userData.crown=!!crown;G.add(h);return h};
    const capLift={short:1.035,buzz:1.012,curly:1.045,long:1.04,dreads:1.03}[st];
    if(capLift){const c=new THREE.Mesh(hairCap(capLift,st==='long'?-.6:undefined),m);c.castShadow=true;c.receiveShadow=true;G.add(c)}
    if(st==='short')for(let k=0;k<7;k++){const a=(k-3)*.22;add(new THREE.ConeGeometry(1,1,6),Math.sin(a)*.32,.98,Math.cos(a)*.32+.12,.13,.2,.13,true).rotation.set(.5,0,-a*.6)}
    if(st==='curly'){for(let k=0;k<16;k++){const a=k/16*PI*2;add(GEO.sph,Math.cos(a)*.74,.42+.18*Math.sin(k*1.7),Math.sin(a)*.66-.12,.28,.26,.28,true)}
      add(GEO.sph,0,.6,-.05,.86,.5,.86,true);for(let k=0;k<11;k++){const a=PI*.2+k/10*PI*.6;add(GEO.sph,Math.cos(a)*.9,-.08+.05*Math.sin(k*2.3),-Math.sin(a)*.72,.2,.2,.2)}}  // a ring of curls below the cap line
    if(st==='long'){const h=add(GEO.cyl,0,-.42,-.45,.92,1.0,.4);h.scale.set(.92,1.05,.42);h.userData.crown=false}
    if(st==='dreads')for(let k=0;k<11;k++){const a=PI*.12+k/10*PI*.76;const d=add(new THREE.CylinderGeometry(1,.8,1,7),Math.cos(a)*.88,-.35,-Math.sin(a)*.66,.075,1.0,.075);d.rotation.x=-.15}
    batchStatic(G,G.children.filter(h=>h.userData.crown));this.buildFacialHair();this.setHeadwear(this.headwear||'cap')}
  buildFacialHair(){
    if(this.beardG){this.head.remove(this.beardG);dropGeo(this.beardG)}const G=this.beardG=new THREE.Group();this.head.add(G);
    const f=this.look.facialHair,m=this.mats.hair;if(f==='none'||f==='stubble')return;
    const add=g=>{const o=new THREE.Mesh(g,m);o.castShadow=true;G.add(o);return o};
    if(f==='beard'){const g=skullPatch(1.04,PI/2-1.35,2.7,PI*.6,PI*.33,32,12),p=g.attributes.position;  // jaw and chin, with the mouth left clear
      for(let k=0;k<p.count;k++){const x=p.getX(k),y=p.getY(k),z=p.getZ(k);if(z>.5&&Math.abs(x)<.28&&y>-.66&&y<-.4)p.setXYZ(k,x*.97,y,z*.9)}g.computeVertexNormals();add(g)}
    if(f==='goatee'){add(skullPatch(1.035,PI/2-.42,.84,PI*.75,PI*.17,16,8))}
    if(f==='beard'||f==='goatee'||f==='mustache'){const tube=new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V3(-.27,-.52,.8),V3(-.12,-.41,.95),V3(0,-.4,.98),V3(.12,-.41,.95),V3(.27,-.52,.8)]),16,.05,6);add(tube)}batchStatic(G)}
  buildHeadwear(){
    const m=this.mats,H=this.head,add=(g,mat,parent)=>{const o=new THREE.Mesh(g,mat);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o};
    // ball cap: six-panel crown, curved bill, top button, front logo
    const cap=this.capG=new THREE.Group();H.add(cap);
    const crown=skullPatch(1.065,0,PI*2,0,PI*.42,32,14),cp=crown.attributes.position;for(let k=0;k<cp.count;k++){const z=cp.getZ(k);if(z<0)cp.setY(k,cp.getY(k)-.16*sstep(0,.9,-z))}crown.computeVertexNormals();add(crown,m.cap,cap); // sits lower at the back
    add(new THREE.SphereGeometry(.08,10,6),m.cap,cap).position.set(0,1.06,0);
    const bill=(r0,r1,ang,drop)=>{const pos=[],idx=[],nA=14,nR=5;for(let a=0;a<=nA;a++)for(let r=0;r<=nR;r++){const ph=lerp(-ang,ang,a/nA),rr=lerp(r0,r1,r/nR),out=(rr-r0)/(r1-r0);
        pos.push(Math.sin(ph)*rr*1.0,drop-.2*out*out-.18*out*(ph*ph),Math.cos(ph)*rr)}
      for(let a=0;a<nA;a++)for(let r=0;r<nR;r++){const i=a*(nR+1)+r;idx.push(i,i+1,i+nR+1,i+1,i+nR+2,i+nR+1)}
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();return g};
    add(bill(.93,1.68,.92,.25),m.bill,cap);
    this.capLogo=add(new THREE.PlaneGeometry(.55,.55),m.logo,cap);this.capLogo.position.set(0,.62,.88);this.capLogo.rotation.x=-.62;this.capLogo.scale.setScalar(.85);
    // batting helmet: glossy shell, ear flap over the ear toward the pitcher (the player's left; mirrored for lefties), short brim
    const hel=this.helmetG=new THREE.Group();H.add(hel);
    const shell=skullPatch(1.18,0,PI*2,0,PI*.5,32,16),sp=shell.attributes.position;for(let k=0;k<sp.count;k++){const z=sp.getZ(k);if(z<.3)sp.setY(k,sp.getY(k)-.3*sstep(.3,-.9,z))}shell.computeVertexNormals();add(shell,m.helmet,hel);
    const flap=skullPatch(1.19,PI-1.0,2.0,PI*.42,PI*.4,16,10),fp=flap.attributes.position;for(let k=0;k<fp.count;k++){const y=fp.getY(k);if(y<-.25)fp.setX(k,fp.getX(k)*(1+.12*(-.25-y)))}flap.computeVertexNormals();add(flap,m.helmet,hel);
    add(bill(1.1,1.5,.95,.12),m.helmet,hel);
    const hl=add(new THREE.PlaneGeometry(.5,.5),m.logo,hel);hl.position.set(0,.55,1.08);hl.rotation.x=-.5;batchStatic(cap);batchStatic(hel)}
  setHeadwear(kind){this.headwear=kind;if(this.capG){this.capG.visible=kind==='cap';this.helmetG.visible=kind==='helmet'}
    if(this.hairG)this.hairG.children.forEach(h=>{if(h.userData.crown)h.visible=kind==='none'})}
  paintHead(){const lk=this.look,L=this.L.slice();L[0]=lk.skin;L[1]=lk.hair;L[2]=lk.hairStyle==='curly'?'curly':lk.hairStyle;L[10]=(lk.facialHair==='beard'||lk.facialHair==='stubble')?'b':'';
    if(this.headMat.map)this.headMat.map.dispose();const t=headTexture(L,this.i);this.headMat.map=t;this.headMat.emissiveMap=t;this.headMat.needsUpdate=true}
  // team uniform: colors and lettering from UNIFORMS[team]
  dressFor(team){
    const U=UNIFORMS[team],m=this.mats;this.team=team;
    if(m.jersey.map)m.jersey.map.dispose();m.jersey.map=jerseyTexture(U,this.look.number,CH[this.i].n);m.jersey.needsUpdate=true;
    if(m.pants.map)m.pants.map.dispose();m.pants.map=pantsTexture(U);m.pants.needsUpdate=true;
    if(m.logo.map)m.logo.map.dispose();m.logo.map=logoTexture(U,U.capLogo);m.logo.needsUpdate=true;
    const set=(k,c)=>m[k].color.set(c);set('sleeve',U.jersey);set('trim',U.trim);set('undershirt',U.undershirt);set('pantsPlain',U.pants);set('belt',U.belt);set('socks',U.socks);set('stirrups',U.stirrups);
    set('cleats',U.cleats);set('cleatTrim',U.cleatTrim);set('sole',U.sole);set('cap',U.cap);set('bill',U.bill);set('helmet',U.helmet);
    const mir=this.mirror;this.mirror=null;this.mirrorState(mir)}
  // per-player look: skin, hair, facial hair, eyes, sleeves (merge any subset)
  setLook(patch){const lk=Object.assign(this.look,patch||{}),m=this.mats;
    m.skin.color.set(lk.skin);m.skin.emissive.set(new THREE.Color(lk.skin).lerp(new THREE.Color('#ff6a50'),.5));m.skin.map=lk.skinMap||null;m.skin.needsUpdate=true;
    m.lip.color.set(new THREE.Color(lk.skin).lerp(new THREE.Color('#a8404a'),.38).multiplyScalar(.9));m.hair.color.set(lk.hair);m.brow.color.set(lk.hair);m.iris.color.set(lk.eyes);
    this.arm.forEach(a=>{a.mesh.material[2]=lk.sleeves==='long'?m.undershirt:m.skin});
    if('hairStyle'in(patch||{})||'facialHair'in(patch||{}))this.buildHair();
    this.paintHead();if('number'in(patch||{}))this.dressFor(this.team)}
  // one-shot sequences: swing, pitch, throw
  play(name,now,o={}){this.one={name,t0:now,len:seqLen(name),minT:o.minT??seqLen(name),hold:o.hold};this.snapshot(now,o.fade??.06)}
  snapshot(now,f){if(this.last){this.snap=this.last;this.fadeT=now;this.fade=f}}
  // drive: called every frame by the game with where the character should be and what it is doing
  drive(now,dt,x,z,o={}){
    const r=this.root;r.visible=true;
    const dx=x-this.pos.x,dz=z-this.pos.z,d=Math.hypot(dx,dz);
    if(this.prev===null||d>30){this.pos.set(x,0,z);this.speed=0;this.prev=1;this.yaw=o.face??this.yaw}
    const v=d/Math.max(dt,1e-3);this.speed=lerp(this.speed,v,1-Math.exp(-dt*10));this.pos.set(x,0,z);
    const ks=K;const moving=this.speed>2.2*ks&&!o.noRun;
    let st=o.state||'idle';if(moving&&!(this.one&&now-this.one.t0<this.one.minT*1000))st='run';
    if(this.one&&((now-this.one.t0)/1000>this.one.len&&!this.one.hold||st==='run'&&now-this.one.t0>=this.one.minT*1000)){this.one=null;this.snapshot(now,.2)}
    if(st!==this.state){if(!this.one)this.snapshot(now,st==='run'||this.state==='run'?.16:.24);this.state=st;this.t0=now}
    let tgt=o.face;if(st==='run'&&d>1e-4)tgt=Math.atan2(dx,dz);
    if(tgt!=null){let df=tgt-this.yaw;df=Math.atan2(Math.sin(df),Math.cos(df));this.yaw+=df*Math.min(1,dt*(st==='run'?9:6))}
    const mir=!!o.mirror;
    r.position.set(x,0,z);r.rotation.y=mir?-this.yaw:this.yaw;
    const sp=cl(this.speed/(24*ks),0,1.2),amp=.35+.55*Math.min(1,sp);
    if(st==='run')this.phase+=d/ks/(2*amp*1.35*RIG_S*this.bh)*PI;   // stride length grows with the player, so feet don't skate
    const t=(now-this.t0)/1000,ctx={phase:this.phase,amp,sp:Math.min(1,sp)};
    let p=this.one?seqPose(this.one.name,(now-this.one.t0)/1000,ctx):resolve(POSE[st](t,ctx));
    if(this.snap){const w=cl((now-this.fadeT)/1000/this.fade,0,1);if(w<1)p=lerpPose(this.snap,p,ease(w));else this.snap=null}
    this.last=p;
    this.mirrorState(mir);
    this.apply(p,o,now);
    const vs=(o.vis||1)*this.bh*RIG_S;r.scale.set(mir?-vs:vs,vs,vs);this.ring.visible=o.ring!==false}
  // mirrored (left-handed) stance flips the model; flip the lettering back so it still reads correctly
  mirrorState(mm){if(mm===this.mirror)return;this.mirror=mm;for(const t of[this.mats.jersey.map,this.mats.logo.map])if(t){t.repeat.x=mm?-1:1;t.offset.x=mm?(t===this.mats.jersey.map?.5:1):0}}
  apply(p,o,now){
    const r=this.root;
    this.hips.position.set(...p.hip);this.hips.rotation.set(p.hr[0],p.hr[1],p.hr[2],'YXZ');this.lastHr=p.hr;
    this.chest.rotation.set(p.ch[0],p.ch[1],p.ch[2],'YXZ');
    let hy=p.hd[1],hp=p.hd[0];
    if(o.look){_d.copy(o.look);r.worldToLocal(_d);const yawBody=p.hr[1]+p.ch[1];
      const ly=Math.atan2(_d.x-p.hip[0],_d.z-p.hip[2])-yawBody,lp=-Math.atan2(_d.y-(p.hip[1]+1.85),Math.hypot(_d.x-p.hip[0],_d.z-p.hip[2]))*.6;
      const yy=Math.atan2(Math.sin(ly),Math.cos(ly));hy=cl(yy,-1.75,1.75);hp=cl(lp,-.5,.5)-p.ch[0]*.6}
    this.neck.rotation.set(hp*.4,hy*.35,0,'YXZ');this.head.rotation.set(hp*.6,hy*.65,0,'YXZ');
    this.hips.updateMatrix();this.chest.updateMatrix();_m.multiplyMatrices(this.hips.matrix,this.chest.matrix);
    this.updateAbdomen();
    // arms: shoulder -> elbow -> wrist, biceps side facing away from the elbow pole
    const HL=V3(...p.hl),HR=V3(...p.hr_);
    if(o.reach){this.reachW=lerp(this.reachW,1,.25);_d.copy(o.reach);r.worldToLocal(_d);HL.lerp(_d,this.reachW)}else this.reachW=lerp(this.reachW,0,.2);
    for(const s of[0,1]){const sg=s?-1:1,S=V3(sg*.45*this.bw,1.15,0).applyMatrix4(_m),T=s?HR:HL;
      const pole=V3(sg*.7,-1,-.7).transformDirection(_m),E=V3(),Te=V3();ik(S,T,LA[0],LA[1],pole,E,Te);
      const A=this.arm[s];A.update(S,E,Te,pole.clone().negate(),-sg);
      const h=this.hand[s];h.position.copy(Te);_mb.makeBasis(A.endB,A.endT,A.endN);h.quaternion.setFromRotationMatrix(_mb);
      h.userData.fingers.forEach(f=>f.visible=!(s===0&&o.glove))}
    // legs: hip -> knee -> ankle, knee leading toward the facing direction
    _e.set(0,p.hr[1],0);_q.setFromEuler(_e);const fwd=V3(0,.2,1).applyQuaternion(_q);
    for(const s of[0,1]){const sg=s?-1:1,Hj=V3(sg*.25*this.bw,-.12,0).applyMatrix4(this.hips.matrix),F=s?p.fr:p.fl,T=V3(F[0],F[1]+.2,F[2]);
      const Kn=V3(),Te=V3();ik(Hj,T,LL[0],LL[1],fwd,Kn,Te);this.leg[s].update(Hj,Kn,Te,fwd,-sg);
      const f=this.ft[s];f.position.set(Te.x,Math.max(0,Te.y-.19),Te.z);f.rotation.set(F[1]>.15?-.35:0,p.hr[1]*.5+(p.fo?p.fo[s]:0)*.5,0,'YXZ')}
    this.bat.visible=p.bat>.5&&!o.noBat;
    if(this.bat.visible){const dvec=batDir(p.ba[0],p.ba[1],_a);this.bat.position.set(p.bg[0]-dvec.x*.1,p.bg[1]-dvec.y*.1,p.bg[2]-dvec.z*.1);this.bat.quaternion.setFromUnitVectors(UP,dvec)}
    this.glove.visible=!!o.glove;
    this.blob.position.set(p.hip[0],.05,p.hip[2])}}
const _mb=new THREE.Matrix4();
function dropGeo(o){o.traverse(n=>{if(n.geometry&&n.geometry!==GEO.sph&&n.geometry!==GEO.cyl)n.geometry.dispose()})}
function rigFor(i,team){const r=rigs[i]||new Rig(i,team);if(r.team!==team)r.dressFor(team);r.ring.material.color.set(team==='you'?0xe0482f:0x3d7be0);return r}

/* ================= WORLD BUILD ================= */
let PK=PARKS[0],K=1,world=null,crowdMat=null,boardTex=null,boardCv=null,sun=null,hemi=null,skyMesh=null,landRing=null;
const fenceU=a=>PK.L+(PK.C-PK.L)*Math.cos(2*a); // a radians from CF line, sim units
const fenceW=a=>fenceU(a)*K;
const W=(x,y)=>[x*K,-y*K]; // sim -> world (x,z)
const BW=i=>{const b=BU[i];return[b[0]*K,-b[1]*K]};

function disposeTree(o){o.traverse(n=>{if(n.geometry)n.geometry.dispose();if(n.material){(Array.isArray(n.material)?n.material:[n.material]).forEach(m=>{if(m.map&&m.map!==blobTex&&m.map!==glowTex)m.map.dispose();m.dispose()})}})}

function buildWorld(pk){
  if(world){scene.remove(world);disposeTree(world)}
  PK=pk;K=pk.B/60;world=new THREE.Group();scene.add(world);
  const T=pk.time;
  const SKY={dusk:{top:0x2c3f7c,mid:0xff9b5e,bot:0x3b2f35,fog:0xd99172,hemiS:0xffd0a6,hemiG:0x3b3426,hI:.62,sunC:0xffb26a,sI:1.05,sun:[-420,150,-620]},
             day:{top:0x2a78d2,mid:0xc4e4ff,bot:0x88a979,fog:0xc8e1f2,hemiS:0xd6ecff,hemiG:0x4d6a33,hI:.72,sunC:0xfff1d6,sI:.95,sun:[-300,520,260]},
             night:{top:0x02071a,mid:0x16264d,bot:0x070b18,fog:0x0b1430,hemiS:0xa8bde6,hemiG:0x1a2a1a,hI:.6,sunC:0xffffff,sI:.95,sun:[60,560,200]}}[T];
  scene.background=new THREE.Color(SKY.fog);
  scene.fog=new THREE.Fog(SKY.fog,T==='night'?1400:1100,4200);
  // sky dome
  const sm=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,uniforms:{top:{value:new THREE.Color(SKY.top)},mid:{value:new THREE.Color(SKY.mid)},bot:{value:new THREE.Color(SKY.bot)}},
    vertexShader:'varying vec3 vP;void main(){vP=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'uniform vec3 top,mid,bot;varying vec3 vP;void main(){float h=vP.y;vec3 c=h>0.?mix(mid,top,pow(clamp(h*1.4,0.,1.),.55)):mix(mid,bot,clamp(-h*5.,0.,1.));gl_FragColor=vec4(c,1.);}'});
  skyMesh=new THREE.Mesh(new THREE.SphereGeometry(6000,32,16),sm);skyMesh.renderOrder=-1;world.add(skyMesh);
  hemi=new THREE.HemisphereLight(SKY.hemiS,SKY.hemiG,SKY.hI);world.add(hemi);
  sun=new THREE.DirectionalLight(SKY.sunC,SKY.sI);sun.position.set(...SKY.sun);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);const sc=sun.shadow.camera;sc.left=-480;sc.right=480;sc.top=480;sc.bottom=-480;sc.near=10;sc.far=2200;sun.shadow.bias=-.0006;
  sun.target.position.set(0,0,-PK.C*K*.45);world.add(sun,sun.target);
  if(T==='dusk'){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0xffc27a,transparent:true,depthWrite:false,fog:false,blending:THREE.AdditiveBlending}));
    s.position.set(-1500,420,-2600);s.scale.set(1500,1500,1);world.add(s);
    const d=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0xffffff,transparent:true,depthWrite:false,fog:false}));d.position.copy(s.position);d.scale.set(260,260,1);world.add(d)}
  if(T==='night'){const n=1400,pos=new Float32Array(n*3);for(let i=0;i<n;i++){const th=Math.random()*PI*2,ph=Math.acos(rnd(.12,1));pos.set([Math.cos(th)*Math.sin(ph)*5000,Math.cos(ph)*5000,Math.sin(th)*Math.sin(ph)*5000],i*3)}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));world.add(new THREE.Points(g,new THREE.PointsMaterial({color:0xffffff,size:7,sizeAttenuation:true,fog:false,transparent:true,opacity:.8})))}
  if(T!=='night')clouds(T);
  hills(T);
  ground(T);
  fieldSurface();
  basesAndChalk();
  wall();
  if(pk.id==='sandlot')sandlotProps();
  if(pk.id==='park')parkProps();
  if(pk.id==='stadium')stadiumProps();
  if(pk.id==='dome')domeProps();
  landRing=new THREE.Mesh(new THREE.RingGeometry(2.2,3,36).rotateX(-PI/2),new THREE.MeshBasicMaterial({color:0xf4bf3a,transparent:true,opacity:.9,depthWrite:false}));
  landRing.visible=false;world.add(landRing);
  batchStatic(world,[skyMesh,landRing]);
  setGrade(pk.id==='dome'?'dome':T);drawBoard();
}

function clouds(T){
  const[c,g]=mk(256,128);for(let i=0;i<26;i++){const x=rnd(40,216),y=rnd(50,90),r=rnd(18,40);const gr=g.createRadialGradient(x,y,1,x,y,r);gr.addColorStop(0,'rgba(255,255,255,.9)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.beginPath();g.arc(x,y,r,0,7);g.fill()}
  const t=ctex(c);const col=T==='dusk'?0xffc9a8:0xffffff;
  for(let i=0;i<14;i++){const a=rnd(-PI*.95,PI*.95)-PI/2,r=rnd(2600,4200);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,color:col,transparent:true,depthWrite:false,fog:false,opacity:rnd(.6,.95)}));
    s.position.set(Math.cos(a)*r,rnd(380,1100),Math.sin(a)*r);const w=rnd(900,1800);s.scale.set(w,w*.45,1);world.add(s)}
}
function hills(T){
  const col={dusk:0x5a4b6a,day:0x7d9fa0,night:0x0c1426}[T],col2={dusk:0x3f3a4c,day:0x5f8a6a,night:0x0a1020}[T];
  for(const[R,hm,c]of[[3600,260,col],[2900,150,col2]]){
    const n=120,pos=[],idx=[];for(let i=0;i<=n;i++){const a=i/n*PI*2;const h=hm*(.45+.35*Math.sin(a*3+R)+.2*Math.sin(a*11+R*.3))+40;pos.push(Math.cos(a)*R,-20,Math.sin(a)*R,Math.cos(a)*R,h,Math.sin(a)*R)}
    for(let i=0;i<n;i++){const a=i*2;idx.push(a,a+1,a+2,a+1,a+3,a+2)}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setIndex(idx);
    world.add(new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:c,side:THREE.DoubleSide})))}
}
function noiseCanvas(w,h,base,spots,amt){const[c,g]=mk(w,h);g.fillStyle=base;g.fillRect(0,0,w,h);for(let i=0;i<amt;i++){g.fillStyle=spots[i%spots.length];g.globalAlpha=rnd(.05,.25);g.fillRect(rnd(0,w),rnd(0,h),rnd(1,3),rnd(1,4))}g.globalAlpha=1;return c}
function ground(T){
  const base={sandlot:'#5f7f35',park:'#4f7f37',stadium:'#41503f',dome:'#5a6458'}[PK.id];
  const c=noiseCanvas(256,256,base,['#7a9a48','#3e5a28','#8b7a4a','#2f4422'],5000);const t=ctex(c,true);t.repeat.set(60,60);
  const m=new THREE.Mesh(new THREE.PlaneGeometry(9000,9000),new THREE.MeshLambertMaterial({map:t}));m.rotation.x=-PI/2;m.position.y=-.15;m.receiveShadow=true;world.add(m);
}

/* field surface: one big painted canvas in world coords */
function fieldSurface(){
  const B=PK.B,X=.8*PK.C*K+70,zmin=-(PK.C*K+40),zmax=95;
  const Wc=2048,Hc=Math.round(2048*(zmax-zmin)/(2*X));
  const[c,g]=mk(Wc,Hc);const sx=Wc/(2*X),sy=Hc/(zmax-zmin);
  const sand=PK.id==='sandlot',stad=PK.id==='stadium'||PK.id==='dome';
  const grass=sand?'#6d9a3c':stad?'#3e8d3a':'#4f963b',grass2=sand?'#7aa547':stad?'#4aa045':'#5aa344',foul=sand?'#6a9238':stad?'#3a8536':'#4b8f39';
  const dirt=sand?'#a8875c':stad?'#b8744a':'#bf8a5a',dirt2=sand?'#957650':stad?'#a8653f':'#ae7b4e';
  g.setTransform(1,0,0,1,0,0);g.fillStyle=foul;g.fillRect(0,0,Wc,Hc);
  g.setTransform(sx,0,0,sy,X*sx,-zmin*sy);
  const fair=(pad=0)=>{g.beginPath();g.moveTo(0,pad*1.4);for(let d=-45;d<=45;d+=1.5){const a=d*PI/180,r=fenceW(a)+pad;g.lineTo(Math.sin(a)*r,-Math.cos(a)*r)}g.closePath()};
  // foul-territory texture
  stripes(g,-X,zmin,2*X,zmax-zmin,16*K,'rgba(255,255,255,.035)',0);
  // fair grass
  g.save();fair(0);g.clip();g.fillStyle=grass;g.fillRect(-X,zmin,2*X,zmax-zmin);
  if(stad){stripes(g,-X,zmin,2*X,zmax-zmin,15,'rgba(255,255,255,.075)',PI/4);stripes(g,-X,zmin,2*X,zmax-zmin,15,'rgba(0,0,0,.06)',-PI/4)}
  else if(!sand){stripes(g,-X,zmin,2*X,zmax-zmin,14,'rgba(255,255,255,.07)',0)}
  else{for(let i=0;i<46;i++){const a=rnd(-.75,.75),r=rnd(70,fenceW(a)-10);g.fillStyle=`rgba(${rnd(150,175)|0},${rnd(130,150)|0},90,${rnd(.18,.45)})`;g.beginPath();g.ellipse(Math.sin(a)*r,-Math.cos(a)*r,rnd(4,14),rnd(3,9),rnd(0,3),0,7);g.fill()}}
  g.restore();
  // warning track
  if(PK.wt){g.save();fair(0);g.clip();g.strokeStyle=dirt2;g.lineWidth=PK.wt*2;g.beginPath();for(let d=-46;d<=46;d+=1){const a=d*PI/180,r=fenceW(a);d>-46?g.lineTo(Math.sin(a)*r,-Math.cos(a)*r):g.moveTo(Math.sin(a)*r,-Math.cos(a)*r)}g.stroke();g.restore()}
  // infield skin
  const s2=B/Math.SQRT2,mz=-.672*B,sc=B/90;
  g.save();fair(4);g.clip();g.fillStyle=dirt;g.beginPath();g.arc(0,mz,B*1.06,0,7);g.fill();g.restore();
  // baseline paths into foul ground
  g.strokeStyle=dirt;g.lineWidth=6*sc;g.lineCap='round';g.beginPath();g.moveTo(0,0);g.lineTo(s2,-s2);g.moveTo(0,0);g.lineTo(-s2,-s2);g.stroke();
  // infield grass
  if(!sand){g.save();g.translate(0,-s2);g.scale(.8,.8);g.beginPath();g.moveTo(0,s2);g.lineTo(s2,0);g.lineTo(0,-s2);g.lineTo(-s2,0);g.closePath();g.restore();
    g.save();g.clip();g.fillStyle=grass2;g.fillRect(-X,zmin,2*X,zmax-zmin);stripes(g,-X,zmin,2*X,zmax-zmin,9*sc,'rgba(255,255,255,.07)',PI/4);stripes(g,-X,zmin,2*X,zmax-zmin,9*sc,'rgba(0,0,0,.06)',-PI/4);g.restore()}
  else{g.fillStyle='rgba(120,150,70,.35)';for(let i=0;i<14;i++){g.beginPath();g.ellipse(rnd(-s2*.6,s2*.6),-s2+rnd(-s2*.5,s2*.5),rnd(3,7),rnd(2,5),rnd(0,3),0,7);g.fill()}}
  // home circle, mound, base cutouts
  g.fillStyle=dirt;g.beginPath();g.arc(0,0,13*sc+2,0,7);g.fill();
  g.fillStyle=dirt2;g.beginPath();g.arc(0,mz,9*sc+1,0,7);g.fill();
  g.fillStyle='rgba(255,255,255,.08)';g.beginPath();g.arc(0,mz,4*sc,0,7);g.fill();
  for(const[x,z]of[[s2,-s2],[0,-2*s2],[-s2,-s2]]){g.fillStyle=dirt;g.beginPath();g.arc(x,z,6*sc+1.5,0,7);g.fill()}
  // dirt noise
  g.save();g.beginPath();g.arc(0,mz,B*1.08,0,7);g.arc(0,0,15*sc,0,7);g.clip();
  for(let i=0;i<7000;i++){g.fillStyle=Math.random()<.5?'rgba(80,45,20,.12)':'rgba(255,230,190,.10)';g.fillRect(rnd(-B*1.1,B*1.1),mz+rnd(-B*1.1,B*1.1),rnd(.2,.6),rnd(.2,.6))}g.restore();
  // chalk
  // ---- chalk (world feet; canvas y = world z, home plate's back point at the origin) ----
  g.strokeStyle='rgba(250,248,240,.95)';g.lineWidth=.25;g.lineCap='butt';g.lineJoin='miter';   // 3" lines
  const hw=PLATE_W/2,bxIn=hw+.5,bxOut=bxIn+4,bzF=ZZ-3,bzB=ZZ+3;   // 4'x6' boxes, 6" off the plate, centred on it
  // foul lines run from the plate's back point along its 12" edges; the chalk starts where each line leaves the batter's box
  const fl=fenceW(PI/4)*Math.SQRT1_2,st=-bzF;
  for(const sd of[1,-1]){g.beginPath();g.moveTo(sd*st,-st);g.lineTo(sd*fl,-fl);g.stroke()}
  g.strokeRect(bxIn,bzF,4,6);g.strokeRect(-bxOut,bzF,4,6);
  // catcher's box: 43" wide, lines run back from the batter's boxes to 8' behind the plate
  const cw=43/24;g.beginPath();g.moveTo(-cw,bzB);g.lineTo(-cw,8);g.lineTo(cw,8);g.lineTo(cw,bzB);g.stroke();
  // runner's lane: 3' wide in foul ground, from halfway down the first-base line to the bag
  const onL=(sd,d,v)=>[sd*d*Math.SQRT1_2+sd*v*Math.SQRT1_2,-d*Math.SQRT1_2+v*Math.SQRT1_2]; // d along the line, v out into foul ground
  {const lw=3*sc;g.beginPath();g.moveTo(...onL(1,B/2,0));g.lineTo(...onL(1,B/2,lw));g.lineTo(...onL(1,B,lw));g.lineTo(...onL(1,B,0));g.stroke()}
  if(!sand){
    // coach's boxes: 20' long, 15' off each line, open on the far side
    for(const sd of[1,-1]){g.beginPath();g.moveTo(...onL(sd,B-14*sc,25*sc));g.lineTo(...onL(sd,B-14*sc,15*sc));g.lineTo(...onL(sd,B+6*sc,15*sc));g.lineTo(...onL(sd,B+6*sc,25*sc));g.stroke()}
    // on-deck circles (5' across) toward each dugout
    for(const x of[-34*sc,34*sc]){g.beginPath();g.arc(x,22*sc,2.5,0,7);g.stroke()}}
  // park name stencil behind home
  if(!sand){g.save();g.translate(0,40*K*.9);g.fillStyle='rgba(255,255,255,.28)';g.font=`900 ${7*K}px Arial Black, Impact, sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(PK.name.toUpperCase(),0,0);g.restore()}
  // grass speckle
  g.setTransform(1,0,0,1,0,0);
  for(let i=0;i<70000;i++){g.fillStyle=Math.random()<.5?'rgba(0,40,0,.12)':'rgba(220,255,180,.07)';g.fillRect(Math.random()*Wc,Math.random()*Hc,1,1+Math.random()*2)}
  const t=ctex(c);
  const m=new THREE.Mesh(new THREE.PlaneGeometry(2*X,zmax-zmin),new THREE.MeshLambertMaterial({map:t}));
  m.rotation.x=-PI/2;m.position.set(0,0,(zmin+zmax)/2);m.receiveShadow=true;world.add(m);
}
function stripes(g,x,y,w,h,bw,col,ang){g.save();g.translate(x+w/2,y+h/2);g.rotate(ang);const R=Math.hypot(w,h);g.fillStyle=col;for(let s=-R;s<R;s+=bw*2)g.fillRect(s,-R,bw,2*R);g.restore()}

function basesAndChalk(){
  const sc=Math.max(.75,PK.B/90),bm=new THREE.MeshLambertMaterial({color:PK.id==='sandlot'?0xe9e2cf:0xffffff});
  // bags: 1st and 3rd sit wholly in fair ground with their outer edge on the foul line and their back corner on the base point;
  // 2nd is centred on its point. All three are squared to the base paths.
  const bs=1.25*sc,bo=bs*Math.SQRT1_2;
  for(let i=1;i<=3;i++){let[x,z]=BW(i);if(i===1)x-=bo;if(i===3)x+=bo;
    const b=new THREE.Mesh(new THREE.BoxGeometry(bs,.3,bs),bm);b.position.set(x,.15,z);b.rotation.y=PI/4;b.castShadow=true;b.receiveShadow=true;world.add(b)}
  // home plate: 17" front edge facing the mound, 8.5" sides, 12" edges meeting at the back point (the origin, where the foul lines meet)
  const hw=PLATE_W/2,sh=new THREE.Shape();sh.moveTo(-hw,PLATE_D);sh.lineTo(hw,PLATE_D);sh.lineTo(hw,hw);sh.lineTo(0,0);sh.lineTo(-hw,hw);sh.closePath();
  const plateGeo=s=>{const g=new THREE.ExtrudeGeometry(s,{depth:.06,bevelEnabled:false});g.rotateX(PI/2);g.scale(1,1,-1);g.translate(0,.08,0);g.computeVertexNormals();return g};
  const hp=new THREE.Mesh(plateGeo(sh),new THREE.MeshLambertMaterial({color:0xffffff,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));world.add(hp);
  const rim=new THREE.Mesh(plateGeo(sh),new THREE.MeshLambertMaterial({color:0x2a2a2a,side:THREE.DoubleSide}));rim.scale.set(1.07,.7,1.07);rim.position.z=.05;world.add(rim);
  // mound: 18' circle; front edge of the 24"x6" rubber is 60'6" from the back point of the plate (scaled with the bases)
  const mz=-.672*PK.B;const mound=new THREE.Mesh(new THREE.CylinderGeometry(4*sc,9*sc+1,.9,32),new THREE.MeshLambertMaterial({color:PK.id==='stadium'?0xa8653f:0x9d7650}));mound.position.set(0,.2,mz+1.5*sc);mound.receiveShadow=true;world.add(mound);
  const rub=new THREE.Mesh(new THREE.BoxGeometry(2*sc,.12,.5*sc),bm);rub.position.set(0,.66,mz-.25*sc);world.add(rub);
}

/* walls */
function ribbon(rf,a0,a1,n,y0,y1,uLen){
  const pos=[],uv=[],idx=[];let acc=0,prev=null;
  for(let i=0;i<=n;i++){const a=lerp(a0,a1,i/n),r=rf(a),x=Math.sin(a)*r,z=-Math.cos(a)*r;if(prev)acc+=Math.hypot(x-prev[0],z-prev[1]);prev=[x,z];
    pos.push(x,y0,z,x,y1,z);uv.push(acc/uLen,0,acc/uLen,1)}
  for(let i=0;i<n;i++){const a=i*2;idx.push(a,a+2,a+1,a+1,a+2,a+3)}
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g}
function wallTexture(){
  const id=PK.id;
  if(id==='sandlot'){const[c,g]=mk(512,128);for(let i=0;i<8;i++){const x=i*64,top=rnd(0,10);g.fillStyle=`hsl(${rnd(24,32)},${rnd(35,48)}%,${rnd(36,46)}%)`;g.beginPath();g.moveTo(x+2,128);g.lineTo(x+2,top+12);g.lineTo(x+32,top);g.lineTo(x+62,top+12);g.lineTo(x+62,128);g.fill();
      g.strokeStyle='rgba(60,30,10,.35)';g.lineWidth=1;for(let k=0;k<5;k++){g.beginPath();g.moveTo(x+rnd(8,56),top+16);g.bezierCurveTo(x+rnd(8,56),50,x+rnd(8,56),90,x+rnd(8,56),128);g.stroke()}
      g.fillStyle='#3a2a1a';g.fillRect(x+30,40,3,3);g.fillRect(x+30,96,3,3)}
    g.fillStyle='#6b4a2a';g.fillRect(0,38,512,7);g.fillRect(0,96,512,7);return ctex(c,true)}
  if(id==='park'){const[c,g]=mk(64,64);g.strokeStyle='rgba(200,210,205,.9)';g.lineWidth=2.2;g.beginPath();g.moveTo(0,0);g.lineTo(64,64);g.moveTo(64,0);g.lineTo(0,64);g.moveTo(32,-32);g.lineTo(96,32);g.moveTo(-32,32);g.lineTo(32,96);g.moveTo(32,96);g.lineTo(96,32);g.moveTo(-32,32);g.lineTo(32,-32);g.stroke();return ctex(c,true)}
  const ads=[['POP’S DINER','#c8342a','#fff'],['BOLT COLA','#1b1b1b','#f4bf3a'],['HANK’S HARDWARE','#f0e6d0','#1e4d8c'],['MAPLE BANK','#1f6b3a','#fff'],['SUNNY ICE','#ffd23f','#c8342a'],['GO GO GRILL','#2a3a8c','#fff'],['RIVERSIDE TIRES','#111','#e0482f'],['LUCKY LANES','#7a2a8c','#ffe08a']];
  const[c,g]=mk(4096,256);g.fillStyle=PK.id==='dome'?'#1b3a6b':'#1d4a2e';g.fillRect(0,0,4096,256);
  ads.forEach((a,i)=>{const x=i*512;g.fillStyle=a[1];g.fillRect(x+10,40,492,180);g.fillStyle=a[2];g.font='900 78px Arial Black, Impact, sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(a[0],x+256,132,460);g.fillStyle='rgba(255,255,255,.08)';g.fillRect(x+10,40,492,40)});
  g.fillStyle='#f4bf3a';g.fillRect(0,0,4096,14);return ctex(c,true)}
function wall(){
  const h=PK.wallH,id=PK.id,t=wallTexture();
  const a0=-PI/4-.012,a1=PI/4+.012;
  let mat;
  if(id==='park'){t.repeat.set(1,h/2.2);mat=new THREE.MeshLambertMaterial({map:t,transparent:true,alphaTest:.35,side:THREE.DoubleSide})}
  else mat=new THREE.MeshLambertMaterial({map:t,side:THREE.DoubleSide,transparent:id==='sandlot',alphaTest:id==='sandlot'?.4:0});
  const uLen=id==='sandlot'?8*4:id==='park'?2.2:40*8;
  const w=new THREE.Mesh(ribbon(fenceW,a0,a1,120,0,h,uLen),mat);w.castShadow=id!=='park';w.receiveShadow=true;world.add(w);
  if(id==='park'){
    const top=new THREE.Mesh(ribbon(a=>fenceW(a),a0,a1,120,h-.35,h+.15,10),new THREE.MeshLambertMaterial({color:0xf4bf3a,side:THREE.DoubleSide}));world.add(top);
    const pm=new THREE.MeshLambertMaterial({color:0x9aa3a0}),pg=new THREE.CylinderGeometry(.18,.18,h+.2,8);
    for(let d=-45;d<=45;d+=3.2){const a=d*PI/180,r=fenceW(a);const p=new THREE.Mesh(pg,pm);p.position.set(Math.sin(a)*r,h/2,-Math.cos(a)*r);world.add(p)}}
  if(id==='stadium'||id==='dome'){const pad=new THREE.Mesh(ribbon(a=>fenceW(a)+1,a0,a1,120,0,h+.4,30),new THREE.MeshLambertMaterial({color:PK.id==='dome'?0x16305a:0x173b24,side:THREE.DoubleSide}));world.add(pad)}
  // foul poles
  const pm=new THREE.MeshLambertMaterial({color:0xf2c230,emissive:PK.time==='night'?0x553f00:0});
  for(const s of[-1,1]){const r=fenceW(PI/4),x=s*r*.7071,z=-r*.7071,ph=h+26*K;
    const p=new THREE.Mesh(new THREE.CylinderGeometry(.35,.45,ph,10),pm);p.position.set(x,ph/2,z);p.castShadow=true;world.add(p);
    const sc=new THREE.Mesh(new THREE.PlaneGeometry(2.4,ph*.7),new THREE.MeshLambertMaterial({color:0xf2c230,transparent:true,opacity:.75,side:THREE.DoubleSide}));sc.position.set(x-s*1.3*.7071,h+ph*.4,z-1.3*.7071);sc.rotation.y=-s*PI/4;world.add(sc)}
  // distance markers
  const marks=[[-PI/4,fenceW(PI/4)],[-PI/8,fenceW(PI/8)],[0,fenceW(0)],[PI/8,fenceW(PI/8)],[PI/4,fenceW(PI/4)]];
  for(const[a,r]of marks){const[c,g]=mk(128,64);g.fillStyle=id==='sandlot'?'#f3ecd9':'#ffffff';g.font='900 46px Arial Black, Impact, sans-serif';g.textAlign='center';g.textBaseline='middle';
    if(id==='sandlot'){g.fillStyle='#f3ecd9';g.globalAlpha=.85}g.fillText(Math.round(r),64,34);
    const m=new THREE.Mesh(new THREE.PlaneGeometry(4.4,2.2),new THREE.MeshBasicMaterial({map:ctex(c),transparent:true,depthWrite:false}));
    const rr=r-.25;m.position.set(Math.sin(a)*rr,h*.55,-Math.cos(a)*rr);m.lookAt(0,h*.55,0);world.add(m)}
}

/* shared props */
function trees(list){
  const n=list.length;if(!n)return;
  const trunk=new THREE.InstancedMesh(new THREE.CylinderGeometry(.6,1,1,7),new THREE.MeshLambertMaterial({color:0x5a3d24}),n);
  const fol=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),new THREE.MeshPhongMaterial({color:0xffffff,flatShading:true}),n*3);
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),c=new THREE.Color();let k=0;
  list.forEach(([x,z,h],i)=>{m.compose(new THREE.Vector3(x,h*.25,z),q,new THREE.Vector3(h*.06,h*.5,h*.06));trunk.setMatrixAt(i,m);
    for(let j=0;j<3;j++){const r=h*rnd(.22,.32);m.compose(new THREE.Vector3(x+rnd(-.15,.15)*h,h*rnd(.55,.8),z+rnd(-.15,.15)*h),q,new THREE.Vector3(r,r*rnd(.8,1.1),r));fol.setMatrixAt(k,m);
      c.setHSL(rnd(.22,.32),rnd(.35,.55),PK.time==='night'?rnd(.08,.14):rnd(.2,.32));fol.setColorAt(k++,c)}});
  trunk.castShadow=fol.castShadow=true;world.add(trunk,fol)}
function stands(path,rows,run,rise,base0,colA,colB,fill,opt={}){
  // path: [{x,z,nx,nz}] inner edge points with outward normals
  const segs=path.length-1,n=segs*rows;
  const box=new THREE.BoxGeometry(1,1,1);box.translate(0,.5,0);
  const im=new THREE.InstancedMesh(box,new THREE.MeshLambertMaterial({color:0xffffff}),n);
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),c=new THREE.Color(),up=new THREE.Vector3(0,1,0);
  const ppl=[];let k=0;
  for(let i=0;i<segs;i++){const A=path[i],Bp=path[i+1];
    for(let r=0;r<rows;r++){const o=(opt.off||0)+r*run+run/2;
      const ax=A.x+A.nx*o,az=A.z+A.nz*o,bx=Bp.x+Bp.nx*o,bz=Bp.z+Bp.nz*o,len=Math.hypot(bx-ax,bz-az)+.6,top=base0+r*rise;
      q.setFromAxisAngle(up,Math.atan2(-(bz-az),bx-ax));
      m.compose(new THREE.Vector3((ax+bx)/2,opt.y0||0,(az+bz)/2),q,new THREE.Vector3(len,top-(opt.y0||0),run));im.setMatrixAt(k,m);c.set(r===0&&opt.front?opt.front:(r%2?colA:colB));im.setColorAt(k++,c);
      if(fill>0)for(let s=1;s<len-.5;s+=2.4){if(Math.random()<fill){const t=s/len;ppl.push([lerp(ax,bx,t)+rnd(-.2,.2),top,lerp(az,bz,t)+rnd(-.2,.2)])}}}}
  im.castShadow=!opt.noShadow;im.receiveShadow=true;world.add(im);
  return ppl}
function crowd(ppl){
  if(!ppl.length)return;const n=ppl.length;
  const bodyG=new THREE.CylinderGeometry(.42,.58,1.7,10);bodyG.scale(1,1,.72);bodyG.translate(0,.85,0);const headG=new THREE.SphereGeometry(.4,12,9);headG.translate(0,2.12,0);
  crowdMat=new THREE.MeshLambertMaterial({color:0xffffff});
  const uni={time:{value:0},cheer:{value:0}};crowdMat.userData.u=uni;
  crowdMat.onBeforeCompile=sh=>{sh.uniforms.time=uni.time;sh.uniforms.cheer=uni.cheer;
    sh.vertexShader='uniform float time;uniform float cheer;\n'+sh.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\n#ifdef USE_INSTANCING\nfloat ph=instanceMatrix[3].x*.37+instanceMatrix[3].z*.71;transformed.y+=cheer*abs(sin(time*9.+ph))*.9+.06*sin(time*1.3+ph);\n#endif')};
  const bodies=new THREE.InstancedMesh(bodyG,crowdMat,n),heads=new THREE.InstancedMesh(headG,crowdMat,n);
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),c=new THREE.Color(),one=new THREE.Vector3(1,1,1);
  const shirts=[0xe0482f,0x3d7be0,0xf4f1e8,0xf4bf3a,0x2c2c34,0x47a35a,0x8c4ad1,0xff8a3d,0x1d5fa8,0xd8d8d8];
  const skins=[0xf1c08f,0xd9a066,0xa86b3c,0x7a4a26,0xffd7b0];
  ppl.forEach((p,i)=>{m.compose(new THREE.Vector3(p[0],p[1],p[2]),q,one);bodies.setMatrixAt(i,m);heads.setMatrixAt(i,m);
    bodies.setColorAt(i,c.set(shirts[(Math.random()*shirts.length)|0]));heads.setColorAt(i,c.set(skins[(Math.random()*skins.length)|0]))});
  world.add(bodies,heads)}
function lineStandPath(d0,sNear,sFar,arcStep){
  const pts=[],r2=Math.SQRT1_2;
  for(let s=sFar;s>=sNear;s-=10)pts.push({x:-r2*s-r2*d0,z:-r2*s+r2*d0,nx:-r2,nz:r2});
  const p3={x:-r2*sNear-r2*d0,z:-r2*sNear+r2*d0},R0=Math.hypot(p3.x,p3.z),t3=Math.atan2(p3.z,p3.x),t1=PI-t3;
  for(let t=t3-arcStep;t>t1+arcStep*.5;t-=arcStep)pts.push({x:Math.cos(t)*R0,z:Math.sin(t)*R0,nx:Math.cos(t),nz:Math.sin(t)});
  for(let s=sNear;s<=sFar;s+=10)pts.push({x:r2*s+r2*d0,z:-r2*s+r2*d0,nx:r2,nz:r2});
  return pts}
function sideStand(side,d0,s0,s1){const r2=Math.SQRT1_2,pts=[];for(let s=s0;s<=s1;s+=8)pts.push({x:side*(r2*s+r2*d0),z:-r2*s+r2*d0,nx:side*r2,nz:r2});return side<0?pts.reverse():pts}
function ofPath(d0,d1,off){const pts=[];for(let d=d0;d<=d1;d+=2.5){const a=d*PI/180,r=fenceW(a)+off;pts.push({x:Math.sin(a)*r,z:-Math.cos(a)*r,nx:Math.sin(a),nz:-Math.cos(a)})}return pts}
function backstop(R,h,arc){
  const[c,g]=mk(64,64);g.strokeStyle='rgba(200,206,204,.85)';g.lineWidth=2;g.beginPath();g.moveTo(0,0);g.lineTo(64,64);g.moveTo(64,0);g.lineTo(0,64);g.stroke();const t=ctex(c,true);
  const geo=ribbon(a=>R,PI-arc,PI+arc,30,0,h,2);t.repeat.set(1,h/2);
  const m=new THREE.Mesh(geo,new THREE.MeshLambertMaterial({map:t,transparent:true,alphaTest:.3,side:THREE.DoubleSide}));world.add(m);
  const pm=new THREE.MeshLambertMaterial({color:0x8d9592});for(let a=PI-arc;a<=PI+arc+.01;a+=arc/3){const p=new THREE.Mesh(new THREE.CylinderGeometry(.22,.22,h,8),pm);p.position.set(Math.sin(a)*R,h/2,-Math.cos(a)*R);world.add(p)}}
function dugout(side,col){const r2=Math.SQRT1_2,s=PK.B*.6,d=22*K;const g=new THREE.Group();
  const roof=new THREE.Mesh(new THREE.BoxGeometry(28*K,1,8),new THREE.MeshLambertMaterial({color:col}));roof.position.y=5;
  const back=new THREE.Mesh(new THREE.BoxGeometry(28*K,5,1),new THREE.MeshLambertMaterial({color:0x2a2f2c}));back.position.set(0,2.5,3.5);
  const bench=new THREE.Mesh(new THREE.BoxGeometry(26*K,1,1.5),new THREE.MeshLambertMaterial({color:0x6b4a2a}));bench.position.set(0,1.2,2.4);
  for(const x of[-1,1]){const w=new THREE.Mesh(new THREE.BoxGeometry(.6,5,8),roof.material);w.position.set(x*14*K,2.5,0);g.add(w)}
  g.add(roof,back,bench);g.position.set(side*(r2*s+r2*d),0,-r2*s+r2*d);g.rotation.y=side*PI/4;g.traverse(n=>{if(n.isMesh){n.castShadow=n.receiveShadow=true}});world.add(g)}
function board(x,y,z,w,h,ry,legs){
  [boardCv]=mk(1024,512);boardTex=ctex(boardCv);
  const grp=new THREE.Group();const face=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({map:boardTex}));face.position.z=.6;
  const back=new THREE.Mesh(new THREE.BoxGeometry(w+2,h+2,1),new THREE.MeshLambertMaterial({color:0x1d2a22}));grp.add(back,face);
  if(legs){const lm=new THREE.MeshLambertMaterial({color:0x3a4440});for(const s of[-1,1]){const l=new THREE.Mesh(new THREE.BoxGeometry(1.4,y,1.4),lm);l.position.set(s*w*.35,-y/2,0);grp.add(l)}}
  grp.position.set(x,y+h/2,z);grp.rotation.y=ry;grp.traverse(n=>{if(n.isMesh)n.castShadow=true});world.add(grp)}
function drawBoard(){
  if(!boardCv)return;const g=boardCv.getContext('2d'),w=1024,h=512;
  const sand=PK.id==='sandlot';
  g.fillStyle=sand?'#2d3b2e':'#0b120e';g.fillRect(0,0,w,h);
  if(sand){g.strokeStyle='#8b6a42';g.lineWidth=18;g.strokeRect(9,9,w-18,h-18)}
  g.fillStyle=sand?'#f3ecd9':'#f4bf3a';g.font='900 54px Arial Black, Impact, sans-serif';g.textAlign='center';g.fillText(PK.name.toUpperCase(),w/2,74);
  const n=Math.max(INN,(S&&S.inn)||1,6),cols=Math.min(n,9),x0=290,cw=(w-x0-170)/cols;
  g.font='700 34px Arial, sans-serif';g.fillStyle='#9fb0a0';
  for(let i=0;i<cols;i++)g.fillText(i+1,x0+cw*(i+.5),140);g.fillText('R',w-130,140);g.fillText('H',w-55,140);
  const rows=[['SLUGGERS','you'],['BANDITS','cpu']];
  rows.forEach((r,j)=>{const y=205+j*72;g.textAlign='left';g.fillStyle=sand?'#f3ecd9':'#ffffff';g.font='900 40px Arial Black, Impact, sans-serif';g.fillText(r[0],34,y);g.textAlign='center';
    const L=S?S.line[r[1]]:[];g.font='700 42px Arial, sans-serif';
    for(let i=0;i<cols;i++){g.fillStyle=sand?'#f3ecd9':'#ffd86a';g.fillText(L[i]!=null?L[i]:'',x0+cw*(i+.5),y)}
    g.fillStyle='#ff7a5a';g.fillText(S?(r[1]==='you'?S.runs:S.cpu):0,w-130,y);g.fillStyle=sand?'#f3ecd9':'#ffd86a';g.fillText(S?S.hits[r[1]]:0,w-55,y)});
  if(S){g.textAlign='left';g.font='800 36px Arial, sans-serif';g.fillStyle='#9fb0a0';const by=440;
    g.fillText('BALL',34,by);g.fillText('STRIKE',260,by);g.fillText('OUT',540,by);
    const dot=(x,on,c)=>{g.fillStyle=on?c:'#24302a';g.beginPath();g.arc(x,by-12,15,0,7);g.fill()};
    for(let i=0;i<3;i++)dot(150+i*36,S.b>i,'#47c26b');for(let i=0;i<2;i++)dot(420+i*36,S.s>i,'#f4bf3a');for(let i=0;i<2;i++)dot(640+i*36,S.outs>i,'#e0482f');
    const bt=team.length&&S.ord?CH[batterId()].n.toUpperCase():'';g.fillStyle='#fff';g.textAlign='right';g.fillText('AT BAT '+bt,w-34,by)}
  boardTex.needsUpdate=true}

function sandlotProps(){
  const ft=fenceW(0);const T=[];
  // houses beyond the fence
  const hc=[0xd9c7a3,0x9fb8c9,0xc98f7a,0xe6dfc8,0xa7b88a,0xd6b36a,0xb9a6c9,0xcfd4d8];
  for(let i=0;i<9;i++){const a=lerp(-.85,.85,i/8),r=fenceW(a)+rnd(70,95);house(Math.sin(a)*r,-Math.cos(a)*r,-a,hc[i%hc.length])}
  for(let i=0;i<34;i++){const a=rnd(-1,1),r=fenceW(a)+rnd(20,150);T.push([Math.sin(a)*r,-Math.cos(a)*r,rnd(26,48)])}
  for(let i=0;i<30;i++){const a=rnd(1.0,2.9)*(Math.random()<.5?-1:1),r=rnd(150,420);T.push([Math.sin(a)*r,-Math.cos(a)*r,rnd(28,50)])}
  trees(T);
  // treehouse oak in left-field foul ground
  const tx=-150,tz=-95;const oak=new THREE.Group();
  const tr=new THREE.Mesh(new THREE.CylinderGeometry(2.2,3.4,30,10),new THREE.MeshLambertMaterial({color:0x5a3d24}));tr.position.y=15;oak.add(tr);
  const fm=new THREE.MeshPhongMaterial({color:0x3f6e2c,flatShading:true});
  for(const[x,y,z,r]of[[0,38,0,16],[10,33,6,11],[-10,34,-4,12],[3,44,-6,11],[-6,30,9,10]]){const f=new THREE.Mesh(new THREE.IcosahedronGeometry(r,1),fm);f.position.set(x,y,z);oak.add(f)}
  const plat=new THREE.Mesh(new THREE.BoxGeometry(14,1,12),new THREE.MeshLambertMaterial({color:0x7a5532}));plat.position.set(4,20,4);oak.add(plat);
  const th=new THREE.Mesh(new THREE.BoxGeometry(9,7,8),new THREE.MeshLambertMaterial({color:0x9a6b3e}));th.position.set(5,24,4);oak.add(th);
  const rf=new THREE.Mesh(new THREE.ConeGeometry(7.5,4.5,4),new THREE.MeshLambertMaterial({color:0x8a2f22}));rf.position.set(5,29.7,4);rf.rotation.y=PI/4;oak.add(rf);
  const win=new THREE.Mesh(new THREE.PlaneGeometry(3,2.4),new THREE.MeshBasicMaterial({color:0xffc861}));win.position.set(5,24.5,8.05);oak.add(win);
  const lad=new THREE.Mesh(new THREE.BoxGeometry(2,20,.3),new THREE.MeshLambertMaterial({color:0x6b4a2a}));lad.position.set(4,10,10.4);oak.add(lad);
  oak.position.set(tx,0,tz);oak.rotation.y=.6;oak.traverse(n=>{if(n.isMesh)n.castShadow=true});world.add(oak);
  backstop(24,12,.9);
  // folding lawn chairs + cooler well off the third-base line, picnic table off the first-base line (all in foul ground)
  const onLine=(sd,d,v)=>[sd*(d+v)*Math.SQRT1_2,(v-d)*Math.SQRT1_2]; // d feet down the line from home, v feet out into foul ground
  [[22,24,0x2f7bc0],[28,25,0xe0482f],[34,24,0x2f7bc0],[40,25,0xf4bf3a]].forEach(([d,v,c])=>{const[x,z]=onLine(-1,d,v);lawnChair(x,z,PI*.75+rnd(-.2,.2),c)});
  {const[x,z]=onLine(-1,31,29);const cool=new THREE.Group(),blue=new THREE.MeshLambertMaterial({color:0x2a64b0}),wht=new THREE.MeshLambertMaterial({color:0xf2f2f2});
    const bx=new THREE.Mesh(new THREE.BoxGeometry(2.2,1.3,1.4),blue);bx.position.y=.65;const lid=new THREE.Mesh(new THREE.BoxGeometry(2.3,.25,1.5),wht);lid.position.y=1.42;
    const hd=new THREE.Mesh(new THREE.TorusGeometry(.45,.06,6,14,PI),wht);hd.position.y=1.55;cool.add(bx,lid,hd);cool.position.set(x,0,z);cool.rotation.y=PI/4;cool.traverse(n=>{if(n.isMesh)n.castShadow=true});world.add(cool)}
  {const[x,z]=onLine(1,34,30);picnicTable(x,z,-PI/4)}
  // a handful of neighborhood kids on a little plank bleacher down the first-base line
  crowd(stands(sideStand(1,28,30,54),3,2.4,1.1,1.0,0x8a6a42,0x7a5a36,.55));
  // hand-painted scoreboard on the fence in left-center
  const a=-.42,r=fenceW(a)+2;board(Math.sin(a)*r,1,-Math.cos(a)*r,30,15,-a,true);
  // power poles
  const pm=new THREE.MeshLambertMaterial({color:0x4b3a2a});for(let i=0;i<6;i++){const a=lerp(-.9,.9,i/5),r=fenceW(a)+125;const p=new THREE.Mesh(new THREE.CylinderGeometry(.6,.8,40,6),pm);p.position.set(Math.sin(a)*r,20,-Math.cos(a)*r);world.add(p);
    const cr=new THREE.Mesh(new THREE.BoxGeometry(8,.6,.6),pm);cr.position.set(Math.sin(a)*r,38,-Math.cos(a)*r);cr.rotation.y=-a;world.add(cr)}
}
function lawnChair(x,z,ry,col){
  const g=new THREE.Group(),al=new THREE.MeshLambertMaterial({color:0xc9ced2}),web=new THREE.MeshLambertMaterial({color:col,side:THREE.DoubleSide}),tube=(len,r=.06)=>new THREE.CylinderGeometry(r,r,len,6);
  const add=(geo,m,px,py,pz,rx=0,rz=0)=>{const o=new THREE.Mesh(geo,m);o.position.set(px,py,pz);o.rotation.set(rx,0,rz);o.castShadow=true;g.add(o);return o};
  for(const sx of[-.95,.95]){add(tube(1.5),al,sx,.75,.55,.35);add(tube(1.5),al,sx,.75,-.55,-.35);add(tube(2.4),al,sx,1.75,-.85,-.32);add(tube(1.3),al,sx,1.55,0,PI/2)}
  add(new THREE.PlaneGeometry(1.9,1.4),web,0,1.25,0,-PI/2+.12);add(new THREE.PlaneGeometry(1.9,1.9),web,0,2.05,-.9,-.32);
  g.position.set(x,0,z);g.rotation.y=ry;world.add(g)}
function picnicTable(x,z,ry){
  const g=new THREE.Group(),w=new THREE.MeshLambertMaterial({color:0x8a5f38}),plank=(sx,sy,sz,px,py,pz,rx=0)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(sx,sy,sz),w);o.position.set(px,py,pz);o.rotation.x=rx;o.castShadow=true;g.add(o)};
  plank(9,.3,3,0,2.6,0);for(const sz of[-2.3,2.3])plank(9,.25,1,0,1.5,sz);
  for(const sx of[-3.4,3.4])for(const sz of[-1,1])plank(.35,3.2,.35,sx,1.3,sz*.95,sz*.55);
  g.position.set(x,0,z);g.rotation.y=ry;world.add(g)}
function house(x,z,ry,col){
  const g=new THREE.Group(),w=rnd(32,40),d=rnd(26,32),h=rnd(13,17);
  const body=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),new THREE.MeshLambertMaterial({color:col}));body.position.y=h/2;g.add(body);
  const roof=new THREE.Mesh(new THREE.CylinderGeometry(0,1,1,4,1),new THREE.MeshPhongMaterial({color:[0x5a3b33,0x3e4652,0x6b3a2a,0x4a4a4a][(Math.random()*4)|0],flatShading:true}));
  roof.rotation.y=PI/4;roof.scale.set(w*.78,rnd(9,13),d*.78);roof.position.y=h+roof.scale.y/2;g.add(roof);
  const ch=new THREE.Mesh(new THREE.BoxGeometry(3,8,3),new THREE.MeshLambertMaterial({color:0x8a4a3a}));ch.position.set(w*.25,h+5,0);g.add(ch);
  const lit=PK.time==='dusk';const wm=new THREE.MeshBasicMaterial({color:lit?0xffd27a:0x9cc8e8});
  for(const sx of[-.3,0,.3])for(const sy of[.35,.72]){if(Math.random()<.2)continue;const wn=new THREE.Mesh(new THREE.PlaneGeometry(4,3.4),Math.random()<.5&&lit?new THREE.MeshBasicMaterial({color:0x6a7a88}):wm);wn.position.set(sx*w,h*sy,d/2+.05);g.add(wn)}
  const door=new THREE.Mesh(new THREE.PlaneGeometry(3.4,7),new THREE.MeshLambertMaterial({color:0x5a2f22}));door.position.set(w*.12,3.5,d/2+.06);g.add(door);
  g.position.set(x,0,z);g.rotation.y=ry;g.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true}});world.add(g)}
function parkProps(){
  const T=[];for(let i=0;i<70;i++){const a=rnd(-1.15,1.15),r=fenceW(a)+rnd(25,170);T.push([Math.sin(a)*r,-Math.cos(a)*r,rnd(30,56)])}
  for(let i=0;i<40;i++){const a=rnd(1.3,3)*(Math.random()<.5?-1:1),r=rnd(190,420);T.push([Math.sin(a)*r,-Math.cos(a)*r,rnd(30,55)])}
  trees(T);backstop(30*K,20,1.05);
  let p=[];for(const s of[-1,1]){p=p.concat(stands(sideStand(s,36*K,28*K,82*K),7,2.6,1.25,1.2,0xc7cdd0,0xaab2b6,.42,{noShadow:false}))}
  crowd(p);dugout(-1,0x1d5fa8);dugout(1,0xc0392b);
  const a=-.3,r=fenceW(a)+16;board(Math.sin(a)*r,10,-Math.cos(a)*r,36,18,-a,true);
  // water tower
  const wt=new THREE.Group(),lm=new THREE.MeshLambertMaterial({color:0x9aa3a8});
  const tank=new THREE.Mesh(new THREE.SphereGeometry(28,20,14),new THREE.MeshLambertMaterial({color:0xdfe6ea}));tank.scale.y=.75;tank.position.y=120;wt.add(tank);
  for(let i=0;i<4;i++){const l=new THREE.Mesh(new THREE.CylinderGeometry(1.4,1.8,110,6),lm);l.position.set(Math.cos(i*PI/2+.6)*18,55,Math.sin(i*PI/2+.6)*18);wt.add(l)}
  wt.position.set(420,0,-700);world.add(wt);
  // light poles (off during the day)
  for(const[x,z]of[[-120,30],[120,30],[-210,-260],[210,-260]]){const pl=new THREE.Mesh(new THREE.CylinderGeometry(.9,1.4,80,8),lm);pl.position.set(x,40,z);pl.castShadow=true;world.add(pl);
    const hd=new THREE.Mesh(new THREE.BoxGeometry(16,8,2),new THREE.MeshLambertMaterial({color:0x5a6266}));hd.position.set(x,82,z);hd.lookAt(0,0,-150);world.add(hd)}
  // parking lot cars
  const cc=[0xc0392b,0x2c3e50,0xecf0f1,0x2980b9,0xf1c40f,0x7f8c8d];for(let i=0;i<10;i++){const car=new THREE.Mesh(new THREE.BoxGeometry(7,4,14),new THREE.MeshLambertMaterial({color:cc[i%6]}));car.position.set(160+i*10,2,90+rnd(-2,2));car.castShadow=true;world.add(car)}
}
function domeProps(){
  const k=K,green=0x1f5f3c,green2=0x27704b,blue=0x1b3a6b;let ppl=[];
  sun.position.set(-520,560,-760);sun.intensity=1.0;
  const path=lineStandPath(40*k,24*k,fenceW(PI/4)*.96,.08);
  ppl=ppl.concat(stands(path,18,3,1.7,6,green,green2,.85,{front:blue}));
  const d2=18*1.7+8,d3=d2+9*1.9+20;
  ppl=ppl.concat(stands(path.filter((q,i)=>i>2&&i<path.length-3),9,3,1.9,d2+8,green,green2,.8,{off:18*3+6,y0:d2,front:blue}));
  ppl=ppl.concat(stands(path.filter((q,i)=>i>5&&i<path.length-6),14,3,2.1,d3+8,green,green2,.72,{off:18*3+9*3+14,y0:d3,front:blue}));
  ppl=ppl.concat(stands(ofPath(-43,-11,5),12,3,1.8,PK.wallH+1,green,green2,.82,{front:blue}),stands(ofPath(11,43,5),12,3,1.8,PK.wallH+1,green,green2,.82,{front:blue}));
  crowd(ppl);
  const be=new THREE.Mesh(ribbon(a=>fenceW(a)+6,-.19,.19,12,0,30,10),new THREE.MeshLambertMaterial({color:0x173226,side:THREE.DoubleSide}));world.add(be);
  dugout(-1,blue);dugout(1,blue);
  backstop(Math.hypot(path[Math.floor(path.length/2)].x,path[Math.floor(path.length/2)].z)-1,24,.6);
  // ---- glass curtain wall behind the outfield ----
  const gR=a=>fenceW(a)+78,ga0=-1.0,ga1=1.0;
  const base=new THREE.Mesh(ribbon(gR,ga0,ga1,60,0,38,20),new THREE.MeshLambertMaterial({color:0x8e9498,side:THREE.DoubleSide}));base.receiveShadow=true;world.add(base);
  const glass=new THREE.Mesh(ribbon(gR,ga0,ga1,60,38,165,14),new THREE.MeshStandardMaterial({color:0xcfe8f7,transparent:true,opacity:.2,roughness:.05,metalness:.5,side:THREE.DoubleSide,depthWrite:false}));world.add(glass);
  const[mc,mg]=mk(64,64);mg.fillStyle='#4b5560';mg.fillRect(0,0,64,5);mg.fillRect(0,0,5,64);mg.fillRect(0,31,64,2);
  const mt=ctex(mc,true);mt.repeat.set(1,127/14);
  const mull=new THREE.Mesh(ribbon(a=>gR(a)-.3,ga0,ga1,60,38,165,14),new THREE.MeshLambertMaterial({map:mt,transparent:true,alphaTest:.5,side:THREE.DoubleSide}));world.add(mull);
  const top=new THREE.Mesh(ribbon(gR,ga0,ga1,60,165,170,20),new THREE.MeshLambertMaterial({color:0x6c757c,side:THREE.DoubleSide}));world.add(top);
  // ---- fan-shaped retractable roof, open: panels stacked over each side ----
  const PZ=95*k/1.5,R0=70,R1=650,h=r=>118+178*Math.sin(PI*cl((r-R0)/(R1-R0),0,1));
  const pos=(a,r)=>new THREE.Vector3(Math.sin(a)*r,h(r),PZ-Math.cos(a)*r);
  const[pc,pg]=mk(256,256);pg.fillStyle='#c7ccd1';pg.fillRect(0,0,256,256);pg.strokeStyle='rgba(60,70,80,.35)';pg.lineWidth=2;for(let x=0;x<256;x+=32){pg.beginPath();pg.moveTo(x,0);pg.lineTo(x,256);pg.stroke()}
  const roofMat=new THREE.MeshStandardMaterial({map:ctex(pc,true),roughness:.55,metalness:.35,side:THREE.DoubleSide});
  const steel=new THREE.MeshStandardMaterial({color:0xe9ecef,roughness:.4,metalness:.5});
  const panel=(a0,a1,lift)=>{const nA=10,nR=30,P=[],U=[],I=[];
    for(let j=0;j<=nR;j++)for(let i=0;i<=nA;i++){const a=lerp(a0,a1,i/nA),r=lerp(R0,R1,j/nR),q=pos(a,r);P.push(q.x,q.y+lift,q.z);U.push(i/nA*4,j/nR*12)}
    for(let j=0;j<nR;j++)for(let i=0;i<nA;i++){const a=j*(nA+1)+i;I.push(a,a+1,a+nA+1,a+1,a+nA+2,a+nA+1)}
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(P,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(U,2));g.setIndex(I);g.computeVertexNormals();
    world.add(new THREE.Mesh(g,roofMat));
    for(const a of[a0,a1]){const pts=[];for(let j=0;j<=24;j++){const q=pos(a,lerp(R0,R1,j/24));q.y+=lift+3;pts.push(q)}
      world.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),48,2.4,8),steel))}};
  const D=PI/180;
  [[-100,-86,0],[-86,-72,8],[-72,-58,16],[58,72,16],[72,86,8],[86,100,0]].forEach(([a,b,l])=>panel(a*D,b*D,l));
  for(const s of[-1,1]){const q=pos(s*100*D,R1);const leg=new THREE.Mesh(new THREE.CylinderGeometry(4,6,q.y,10),steel);leg.position.set(q.x,q.y/2,q.z);world.add(leg)}
  const piv=new THREE.Mesh(new THREE.CylinderGeometry(10,14,120,14),new THREE.MeshLambertMaterial({color:0x8e9498}));piv.position.set(0,60,PZ+60);world.add(piv);
  // ---- left-field chalet and slide ----
  const sa=-.62,sr=fenceW(sa)+62,grp=new THREE.Group();
  const yel=new THREE.MeshStandardMaterial({color:0xf2c230,roughness:.35,metalness:.1}),wood=new THREE.MeshLambertMaterial({color:0x8a5a34}),dk=new THREE.MeshLambertMaterial({color:0x5a3a24});
  const plat=new THREE.Mesh(new THREE.BoxGeometry(34,2.5,26),new THREE.MeshLambertMaterial({color:0x6c757c}));plat.position.y=50;grp.add(plat);
  for(const[x,z]of[[-15,-11],[15,-11],[-15,11],[15,11]]){const l=new THREE.Mesh(new THREE.CylinderGeometry(1,1,50,8),steel);l.position.set(x,25,z);grp.add(l)}
  const cab=new THREE.Mesh(new THREE.BoxGeometry(18,12,14),wood);cab.position.set(-4,57.5,-2);grp.add(cab);
  const roof=new THREE.Mesh(new THREE.CylinderGeometry(11,11,16,3,1),dk);roof.rotation.set(0,0,PI/2);roof.scale.set(.55,1,1);roof.rotation.y=PI/2;roof.position.set(-4,66,-2);grp.add(roof);
  const roofR=new THREE.Mesh(new THREE.ConeGeometry(11.5,7,4),new THREE.MeshLambertMaterial({color:0x8a2f22}));roofR.rotation.y=PI/4;roofR.scale.set(1.05,1,.85);roofR.position.set(-4,67,-2);grp.add(roofR);
  const trim=new THREE.Mesh(new THREE.BoxGeometry(18.4,1,14.4),yel);trim.position.set(-4,63.6,-2);grp.add(trim);
  for(const x of[-9,1]){const w=new THREE.Mesh(new THREE.PlaneGeometry(4,4),new THREE.MeshBasicMaterial({color:0xffe9a8}));w.position.set(x,58,5.05);grp.add(w)}
  const door=new THREE.Mesh(new THREE.PlaneGeometry(4,7),dk);door.position.set(5.05,55,-2);door.rotation.y=PI/2;grp.add(door);
  const sp=[[6,55,-2],[13,53,4],[16,49,12],[10,45,17],[2,42,13],[-2,38,6],[2,35,-2],[11,32,-4]].map(q=>new THREE.Vector3(...q));
  const slide=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(sp),80,1.9,10),yel);grp.add(slide);
  const land=new THREE.Mesh(new THREE.BoxGeometry(10,1.5,8),new THREE.MeshLambertMaterial({color:0x6c757c}));land.position.set(14,30.5,-4);grp.add(land);
  grp.position.set(Math.sin(sa)*sr,0,-Math.cos(sa)*sr);grp.lookAt(0,0,0);grp.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true}});world.add(grp);
  // ---- scoreboard high above center-right field ----
  const r=fenceW(.12)+92;board(Math.sin(.12)*r,72,-Math.cos(.12)*r,124,50,-.12,true);
  const ring=new THREE.Mesh(new THREE.RingGeometry(fenceW(0)+110,fenceW(0)+330,64).rotateX(-PI/2),new THREE.MeshLambertMaterial({color:0x3a3f44}));ring.position.y=-.1;world.add(ring);
}

function stadiumProps(){
  const k=K;let p=[];
  const path=lineStandPath(38*k,24*k,fenceW(PI/4)*.93,.09);
  p=p.concat(stands(path,20,3,1.75,6,0x24456e,0x2b5180,.86));
  p=p.concat(stands(path.filter((q,i)=>i>3&&i<path.length-4),13,3,1.9,20*1.75+20,0x1e3a5e,0x274a74,.8,{off:20*3+10,y0:20*1.75+4}));
  // facade under upper deck
  // outfield bleachers
  const of1=ofPath(-42,-10,5),of2=ofPath(10,42,5);
  p=p.concat(stands(of1,15,3,1.8,PK.wallH+1,0x2d5a3a,0x356a44,.82),stands(of2,15,3,1.8,PK.wallH+1,0x2d5a3a,0x356a44,.82));
  crowd(p);
  // batter's eye
  const be=new THREE.Mesh(ribbon(a=>fenceW(a)+6,-.17,.17,12,0,34,10),new THREE.MeshLambertMaterial({color:0x14301f,side:THREE.DoubleSide}));world.add(be);
  // scoreboard
  const r=fenceW(0)+70;board(0,46,-r,96,48,0,true);
  dugout(-1,0x1d5fa8);dugout(1,0xc0392b);
  // backstop net
  backstop(lineStandPath(38*k,24*k,30,.09)[0]?Math.hypot(path[Math.floor(path.length/2)].x,path[Math.floor(path.length/2)].z)-1:60,26,.6);
  // light towers
  const lm=new THREE.MeshLambertMaterial({color:0x6f777c});
  const towers=[[-1,.62],[1,.62],[-1,.2],[1,.2],[-.45,1.08],[.45,1.08]];
  for(const[s,f]of towers){const x=s*(fenceW(PI/4)*f+60),z=-fenceW(PI/4)*f*.9+20;const h=150;
    const pl=new THREE.Mesh(new THREE.CylinderGeometry(1.4,2.4,h,8),lm);pl.position.set(x,h/2,z);world.add(pl);
    const[c,g]=mk(128,64);g.fillStyle='#222';g.fillRect(0,0,128,64);for(let i=0;i<8;i++)for(let j=0;j<4;j++){g.fillStyle='#fffbe8';g.beginPath();g.arc(8+i*16,8+j*16,6,0,7);g.fill()}
    const hd=new THREE.Mesh(new THREE.PlaneGeometry(34,17),new THREE.MeshBasicMaterial({map:ctex(c),side:THREE.DoubleSide}));hd.position.set(x,h+8,z);hd.lookAt(0,0,-PK.C*K*.4);world.add(hd);
    const gl=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0xfff3d0,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,fog:false}));gl.position.copy(hd.position);gl.scale.set(120,90,1);world.add(gl)}
  // parking + concourse ring
  const ring=new THREE.Mesh(new THREE.RingGeometry(fenceW(0)+80,fenceW(0)+260,64).rotateX(-PI/2),new THREE.MeshLambertMaterial({color:0x2c2f33}));ring.position.y=-.1;world.add(ring);
}

/* ================= GAME STATE ================= */
let D=DIFF[1],INN=3,team=[],cpuTeam=[],S=null,stats={};
let phase='title',wt=0,pitch=null,PS=null,ret={x:0,y:0},aim={x:0,y:0},swingAt=-1e9,stealArm={2:false,3:false,4:false},bunt=false,camStyle=0,ptype=0;
let camMode='orbit',muted=false,cheerUntil=0,trail=[],timers=[],stealRun=null,foul=null,uwind=null;
let ghost=null; // {zx,zy,strike,t}: last pitch's crossing point over the plate
const camPos=new THREE.Vector3(0,120,240),camLook=new THREE.Vector3(0,0,-80);
function after(ms,fn){timers.push({t:NOW()+ms,fn})}
const ballMesh=new THREE.Mesh(new THREE.SphereGeometry(BALL_R,16,12),new THREE.MeshLambertMaterial({map:ballTex,emissive:0x333333}));
const ballShadow=new THREE.Mesh(blobGeo,new THREE.MeshBasicMaterial({map:blobTex,transparent:true,depthWrite:false,opacity:.8}));
scene.add(ballMesh,ballShadow);ballMesh.visible=ballShadow.visible=false;
const trailGeo=new THREE.BufferGeometry();trailGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(60*3),3));
const trailLine=new THREE.Line(trailGeo,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.55}));trailLine.frustumCulled=false;scene.add(trailLine);

// who is doing what this half
const userBats=()=>S.half==='top';
const batTeam=()=>userBats()?team:cpuTeam,fieldTeam=()=>userBats()?cpuTeam:team;
const batterId=()=>batTeam()[S.ord[S.half]%9];
const pitcherId=()=>fieldTeam()[0];
const POS=['P','C','1B','2B','SS','3B','LF','CF','RF'],POSN=['pitcher','catcher','first baseman','second baseman','shortstop','third baseman','left fielder','center fielder','right fielder'];
const HOME=[[0,40.3],[0,-3],[37,50],[22,80],[-22,80],[-37,50],[-95,168],[0,198],[95,168]];
const baseXY=b=>BU[b%4];

/* ================= AUDIO ================= */
let AC=null;
function audio(){if(!AC){try{AC=new(window.AudioContext||window.webkitAudioContext)()}catch(e){}}if(AC&&AC.state==='suspended')AC.resume()}
function noise(dur,f,q,vol,type='bandpass',decay=dur){if(!AC||muted)return;const n=AC.createBufferSource(),len=AC.sampleRate*dur,buf=AC.createBuffer(1,len,AC.sampleRate),d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;n.buffer=buf;
  const fl=AC.createBiquadFilter();fl.type=type;fl.frequency.value=f;fl.Q.value=q;const g=AC.createGain(),t=AC.currentTime;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+Math.min(.01,dur/4));g.gain.exponentialRampToValueAtTime(.001,t+decay);n.connect(fl).connect(g).connect(AC.destination);n.start();n.stop(t+dur)}
const sfx={crack(q){noise(.18,2600,1.2,.9*q+.2);noise(.12,900,1,.5)},pop(){noise(.09,700,1.4,.6,'lowpass')},
  cheer(big){if(!AC||muted)return;const dur=big?3.6:1.8;const n=AC.createBufferSource(),len=AC.sampleRate*dur,buf=AC.createBuffer(1,len,AC.sampleRate),d=buf.getChannelData(0);for(let i=0;i<len;i++)d[i]=Math.random()*2-1;n.buffer=buf;
   const f=AC.createBiquadFilter();f.type='bandpass';f.frequency.value=1100;f.Q.value=.6;const g=AC.createGain(),t=AC.currentTime;g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(big?.5:.25,t+.35);g.gain.linearRampToValueAtTime(0,t+dur);n.connect(f).connect(g).connect(AC.destination);n.start()},
  whiff(){noise(.2,500,.8,.25)},ump(){if(!AC||muted)return;const o=AC.createOscillator(),g=AC.createGain(),t=AC.currentTime;o.type='sawtooth';o.frequency.setValueAtTime(190,t);o.frequency.linearRampToValueAtTime(140,t+.25);g.gain.setValueAtTime(.08,t);g.gain.exponentialRampToValueAtTime(.001,t+.3);o.connect(g).connect(AC.destination);o.start();o.stop(t+.3)}};

/* ================= UI HELPERS ================= */
function say(t){$('ticker').textContent=t||''}
function banner(t,sub,gold){const b=$('banner');b.className='';b.innerHTML=t+(sub?'<small>'+sub+'</small>':'');void b.offsetWidth;b.className='show'+(gold?' gold':'')}
function statLine(st){return st.ab||st.bb?`${st.h}-for-${st.ab}${st.hr?', '+st.hr+' HR':''}${st.rbi?', '+st.rbi+' RBI':''}${st.bb?', '+st.bb+' BB':''}`:'First at-bat'}
function hudUpdate(){
  if(!S)return;$('rYou').textContent=S.runs;$('rCpu').textContent=S.cpu;$('innNo').textContent=S.inn;$('half').textContent=userBats()?'TOP':'BOT';
  $('tYou').classList.toggle('up',userBats());$('tCpu').classList.toggle('up',!userBats());
  ['d1','d2','d3'].forEach((id,i)=>$(id).classList.toggle('on',S.bases[i]>=0));
  document.querySelectorAll('.cnt .b').forEach((e,i)=>e.classList.toggle('on',S.b>i));
  document.querySelectorAll('.cnt .s').forEach((e,i)=>e.classList.toggle('on',S.s>i));
  document.querySelectorAll('.cnt .o').forEach((e,i)=>e.classList.toggle('on',S.outs>i));
  const c=CH[batterId()],st=stats[c.i];$('bImg').src=c.src;$('bName').textContent=c.n;
  $('bRole').textContent=(userBats()?'Batting #':'Bandits #')+((S.ord[S.half]%9)+1)+(userBats()?'':' · vs '+CH[pitcherId()].n);
  $('bBars').innerHTML=[['PWR',c.p],['CON',c.c],['SPD',c.s]].map(([k,v])=>`<span>${k}</span><span class="bar"><i style="width:${v*20}%"></i></span>`).join('');
  $('bLine').textContent=statLine(st);
  btnUpdate();drawBoard()}
function canSteal(b){if(!S||!userBats())return false;const occ=i=>S.bases[i-1]>=0;
  if(b===2)return occ(1)&&(!occ(2)||stealArm[3]);if(b===3)return occ(2)&&(!occ(3)||stealArm[4]);return occ(3)}
function btnUpdate(){
  if(!S)return;const ub=userBats(),live=phase==='windup'||phase==='result'||phase==='uready';
  $('batActs').hidden=!ub||phase==='field';$('pitchActs').hidden=ub||phase==='field';$('throwActs').hidden=ub||phase!=='field';
  for(const b of[2,3,4]){if(!canSteal(b))stealArm[b]=false;const e=$('st'+b);e.disabled=!live||!canSteal(b);e.classList.toggle('armed',stealArm[b])}
  if(stealArm[2]&&S.bases[1]>=0&&!stealArm[3]){stealArm[2]=false;$('st2').classList.remove('armed')}
  if(stealArm[3]&&S.bases[2]>=0&&!stealArm[4]){stealArm[3]=false;$('st3').classList.remove('armed')}
  $('buntB').classList.toggle('armed',bunt);$('buntB').disabled=!(live||phase==='pitch');
  document.querySelectorAll('#pitchActs [data-pt]').forEach(b=>{b.classList.toggle('armed',+b.dataset.pt===ptype);b.disabled=phase!=='uready'});
  document.querySelectorAll('#throwActs [data-tb]').forEach(b=>b.classList.toggle('armed',PS&&+b.dataset.tb===(PS.userTarget||0)));
  $('viewB').firstChild.textContent=camStyle?'Cam: Blimp':'Cam: Broadcast';$('viewB2').firstChild.textContent=camStyle?'Cam: Blimp':'Cam: Broadcast'}

/* ================= INNINGS ================= */
function newGame(){
  S={inn:1,half:'top',outs:0,b:0,s:0,runs:0,cpu:0,bases:[-1,-1,-1],ord:{top:0,bot:0},line:{you:[],cpu:[]},hits:{you:0,cpu:0}};
  stats={};[...team,...cpuTeam].forEach(i=>stats[i]={ab:0,h:0,hr:0,rbi:0,bb:0,sb:0,r:0,k:0});
  Object.values(rigs).forEach(r=>r.root.visible=false);clearDebris();
  team.forEach(i=>rigFor(i,'you'));cpuTeam.forEach(i=>rigFor(i,'cpu'));
  S.line.you[0]=0;
  ['title','final','inning','menu'].forEach(id=>$(id).hidden=true);['bug','batter','ctrl'].forEach(id=>$(id).hidden=false);
  timers=[];startPitch()}
const addRuns=n=>{if(!n)return;const i=S.inn-1;if(userBats()){S.runs+=n;S.line.you[i]=(S.line.you[i]||0)+n}else{S.cpu+=n;S.line.cpu[i]=(S.line.cpu[i]||0)+n}};
function walkoff(){return S.half==='bot'&&S.inn>=INN&&S.cpu>S.runs}
function startPitch(){
  if(walkoff())return gameOverSoon();
  snapAll=true;clearDebris();if(camMode==='orbit'){camPos.copy(catcherCam().p);camLook.copy(catcherCam().l)}
  pitch=null;PS=null;foul=null;stealRun=null;camMode='bat';landRing.visible=false;trail=[];uwind=null;
  if(userBats()){phase='windup';wt=NOW()+rnd(-150,250);say(S.inn===1&&S.outs===0&&S.b+S.s===0?'Drag to aim the bat. Tap the field to swing.':CH[pitcherId()].n+' is set…')}
  else{phase='uready';say('Drag to aim. Tap the field to wind up.')}
  hudUpdate()}
function endPitch(abOver,ms){
  phase='result';if(abOver){S.b=S.s=0;S.ord[S.half]++;bunt=false}
  hudUpdate();
  if(walkoff()){after(ms+300,gameOverSoon);return}
  if(S.outs>=3){after(ms+300,halfOver);return}
  after(ms,startPitch)}
function gameOverSoon(){phase='result';banner('Walk-off!','Bandits win it',false);after(2200,finish)}
function halfOver(){
  phase='result';PS=null;ghost=null;const top=userBats();
  if(top){if(S.line.you[S.inn-1]==null)S.line.you[S.inn-1]=0;
    if(S.inn>=INN&&S.cpu>S.runs){S.line.cpu[S.inn-1]='X';return finish()}
    S.half='bot';S.line.cpu[S.inn-1]=S.line.cpu[S.inn-1]||0}
  else{if(S.inn>=INN&&S.runs!==S.cpu)return finish();S.half='top';S.inn++;S.line.you[S.inn-1]=0}
  S.outs=0;S.b=S.s=0;S.bases=[-1,-1,-1];bunt=false;stealArm={2:false,3:false,4:false};
  if(S.inn>INN)S.bases[1]=batTeam()[(S.ord[S.half]+8)%9];
  camMode='orbit';banner((S.half==='top'?'Top ':'Bottom ')+S.inn,S.half==='top'?'Sluggers at bat':'Take the field. You pitch.',true);
  after(1800,startPitch);hudUpdate()}
function simHalf(){ // quick-sim the Bandits' at-bats from the menu
  if(!S||userBats())return;timers=[];PS=null;pitch=null;
  const log=$('inLog');log.innerHTML='';let outs=S.outs,b=S.bases.map(x=>x>=0?1:0),runs=0,lines=[],guard=0;const m=D.cpu;
  const fields=['to left','to center','to right','up the middle','down the line','to the gap'];
  const outsTxt=['grounds out to short','flies out to center','pops up to second','strikes out swinging','lines out to third','grounds out to first','flies out to right','strikes out looking'];
  while(outs<3&&guard++<30){
    const c=batterId();S.ord.bot++;const ch=CH[c];const pw=.8+ch.p*.1;const r=Math.random();let t,sc=0;
    const pH=.035*m*pw,p3=.012*m,p2=.065*m*pw,p1=.17*m,pW=.075;
    if(r<pH){t=`<b>homers</b> ${fields[(Math.random()*3)|0]}!`;sc=1+b.filter(x=>x).length;b=[0,0,0];S.hits.cpu++}
    else if(r<pH+p3){t='triples '+fields[5];sc=b.filter(x=>x).length;b=[0,0,1];S.hits.cpu++}
    else if(r<pH+p3+p2){t='doubles '+fields[(Math.random()*6)|0];sc=b[2]+b[1];b=[0,1,b[0]];S.hits.cpu++}
    else if(r<pH+p3+p2+p1){t='singles '+fields[(Math.random()*4)|0];sc=b[2];const s2=b[1]&&Math.random()<.55;sc+=s2?1:0;b=[1,b[0],b[1]&&!s2?1:0];S.hits.cpu++}
    else if(r<pH+p3+p2+p1+pW){t='draws a walk';if(b[0]&&b[1]&&b[2])sc=1;b=[1,b[0]||b[1]?1:b[1],b[0]&&b[1]?1:b[2]]}
    else{t=outsTxt[(Math.random()*outsTxt.length)|0];outs++}
    runs+=sc;addRuns(sc);lines.push([c,t,sc,outs]);if(walkoff())break}
  $('inH').innerHTML=`Bottom ${S.inn}<small>Simulated · Sluggers ${S.runs}, Bandits ${S.cpu}</small>`;
  lines.forEach((l,i)=>{const d=document.createElement('div');d.style.animationDelay=(i*.25)+'s';
    d.innerHTML=`<img src="${CH[l[0]].src}" alt=""><span><b>${CH[l[0]].n}</b> ${l[1]}</span><span class="rs">${l[2]?'+'+l[2]+' run'+(l[2]>1?'s':''):l[3]?l[3]+' out':''}</span>`;log.appendChild(d)});
  const over=walkoff()||(S.inn>=INN&&S.runs!==S.cpu);
  $('inGo').textContent=over?'See final':'Top of '+(S.inn+1);$('inning').hidden=false;$('menu').hidden=true;phase='cpu';hudUpdate();
  $('inGo').onclick=()=>{$('inning').hidden=true;if(over)return finish();S.outs=3;halfOver()}}
function finish(){
  phase='over';camMode='orbit';['ctrl','batter'].forEach(id=>$(id).hidden=true);say('');timers=[];
  const res=S.runs>S.cpu?'Sluggers win!':S.runs<S.cpu?'Bandits win':'All tied up';
  let best=+(store.get('ss3dBest')||0),nb='';if(S.runs>best){best=S.runs;store.set('ss3dBest',best);nb=' · New team record'}
  $('fH').innerHTML=`${res}<small>Final ${S.runs}–${S.cpu} at ${PK.name}${nb}</small>`;
  const n=Math.max(S.line.you.length,S.line.cpu.length);let h='<table><tr><th></th>';for(let i=0;i<n;i++)h+=`<th>${i+1}</th>`;h+='<th>R</th><th>H</th></tr>';
  h+='<tr><td>Sluggers</td>'+Array.from({length:n},(_,i)=>`<td>${S.line.you[i]??''}</td>`).join('')+`<td><b>${S.runs}</b></td><td>${S.hits.you}</td></tr>`;
  h+='<tr><td>Bandits</td>'+Array.from({length:n},(_,i)=>`<td>${S.line.cpu[i]??''}</td>`).join('')+`<td><b>${S.cpu}</b></td><td>${S.hits.cpu}</td></tr></table>`;$('fLine').innerHTML=h;
  let bx='<table><tr><th>Sluggers</th><th>Pos</th><th>AB</th><th>R</th><th>H</th><th>HR</th><th>RBI</th><th>BB</th><th>SB</th></tr>';
  team.forEach((i,k)=>{const s=stats[i];bx+=`<tr><td>${CH[i].n}</td><td>${POS[k]}</td><td>${s.ab}</td><td>${s.r}</td><td>${s.h}</td><td>${s.hr}</td><td>${s.rbi}</td><td>${s.bb}</td><td>${s.sb}</td></tr>`});
  $('fBox').innerHTML=bx+'</table>';$('final').hidden=false;if(S.runs>S.cpu)sfx.cheer(true)}

/* ================= PITCHING ================= */
function isStrike(zx,zy){const ox=Math.max(0,Math.abs(zx)*ZW-ZW),oy=Math.max(0,Math.abs(zy)*ZH-ZH);return ox*ox+oy*oy<=BALL_R*BALL_R+1e-9}
function pitchBase(t,zx,zy,mph,dur){return{...t,mph,t0:0,dur:dur/PITCH_SPEED,zx,zy,bx:t.bx*(Math.random()<.5?-1:1),by:t.by,swung:false,missed:false,bunt:false}}
function releasePoint(){const rel=new THREE.Vector3();rigs[pitcherId()].hand[1].getWorldPosition(rel);if(!(rel.y>1))rel.set(-.7,5.3,-.672*PK.B+2.2);return rel}
function launch(now){ // CPU pitcher
  const t=TYPES[(Math.random()*4)|0],inz=Math.random()>D.wild;let zx,zy;
  if(inz){zx=rnd(-.9,.9);zy=rnd(-.9,.9)}else if(Math.random()<.6){zx=(Math.random()<.5?-1:1)*rnd(1.05+BALL_R/ZW,1.75);zy=rnd(-1,1)}else{zx=rnd(-1,1);zy=(Math.random()<.5?-1:1)*rnd(1.05+BALL_R/ZH,1.6)}
  ghost=null;pitch=pitchBase(t,zx,zy,t.mph,t.dur*D.s);pitch.t0=now;pitch.rel=releasePoint();pitch.bunt=bunt;
  const st=[2,3,4].filter(b=>stealArm[b]);stealArm={2:false,3:false,4:false};
  stealRun=st.length?{bases:st,t0:now}:null;phase='pitch';btnUpdate();say('');
  if(stealRun)say(st.length>1?'Double steal! Runners going!':'Runner goes!')}
function userPitchPress(){
  if(phase==='uready'){audio();phase='uwind';uwind={t0:NOW(),m:null};rigs[pitcherId()].play('pitch',NOW(),{minT:2.6,fade:.2});say('Tap again when the marker hits the green.');btnUpdate();return}
  if(phase==='uwind'&&uwind&&uwind.m==null){uwind.m=cl((NOW()-uwind.t0)/900,0,1);btnUpdate()}}
function userLaunch(now){
  const m=uwind.m==null?1:uwind.m,acc=cl(1-Math.abs(m-.72)/.3,0,1);const t=TYPES[ptype],pc=CH[pitcherId()];
  const err=.1+(1-acc)*1.05,g=()=>(Math.random()+Math.random()+Math.random()-1.5)*1.15;
  const zx=cl(aim.x+g()*err,-2,2),zy=cl(aim.y+g()*err,-2,2),mph=Math.round(t.mph*(.95+.06*acc)+(pc.p-3)*1.5);
  ghost=null;pitch=pitchBase(t,zx,zy,mph,t.dur*t.mph/mph);pitch.t0=now;pitch.rel=releasePoint();pitch.user=true;pitch.acc=acc;
  uwind=null;phase='pitch';say(acc>.85?'Painted it!':acc>.5?'':'Missed your spot.');
  cpuBatterPlan(pitch);cpuStealPlan(now);btnUpdate()}
function cpuBatterPlan(p){
  const b=CH[batterId()],inz=isStrike(p.zx,p.zy),edge=Math.max(Math.abs(p.zx),Math.abs(p.zy));
  let sw=inz?.66+(S.s===2?.2:0)-(S.b===3&&S.s<2?.25:0):.26+(S.s===2?.12:0)-(edge>1.5?.18:0);
  if(p.n!=='Fastball')sw+=inz?-.06:.08;
  if(Math.random()>sw){p.cpu={swing:false};return}
  const brk=(p.n==='Fastball'?.1:p.n==='Slider'?.2:p.n==='Curveball'?.24:.22)*(.7+.5*(p.acc??.6));
  let pc=(.55+.07*b.c)*D.cpu*(1-brk)*(inz?1:.55)*(edge>.85&&inz?.85:1)*(1-(p.mph-80)*.008);
  if(Math.random()>pc){p.cpu={swing:true,miss:true,at:IDEAL+rnd(-.08,.08)};return}
  const q=Math.pow(Math.random(),.75+.12*(5-b.c));
  if(Math.random()<.3){p.cpu={swing:true,foul:true,at:IDEAL,q};return}
  const ev=cl((44+62*Math.pow(q,.6)+(p.mph-80)*.15)*(.88+.06*b.p),36,112),la=rnd(-12,34)+(q>.7?6:0),th=rnd(-34,30)*(LEFTY.has(b.i)?-1:1);
  p.cpu={swing:true,at:IDEAL+rnd(-.03,.03),ev,la,th,q}}
function cpuStealPlan(now){
  const b=S.bases;let st=[];
  if(b[0]>=0&&b[1]<0&&S.outs<2&&spdOf(b[0])>=25&&Math.random()<.16)st=[2];
  else if(b[1]>=0&&b[2]<0&&S.outs<2&&spdOf(b[1])>=26&&Math.random()<.07)st=[3];
  if(st.length){stealRun={bases:st,t0:now};say('Runner is going!')}}
function cpuSwingNow(now){
  const p=pitch,c=p.cpu;p.swung=true;swingAt=now;rigs[batterId()].play('swing',now,{minT:.32});
  if(c.miss){p.missed=true;sfx.whiff();say('Swing and a miss!');return}
  sfx.crack(c.q);
  if(c.foul)return doFoul(now,(Math.random()<.5?-1:1)*rnd(48,80),70,'Fouled off.');
  if(Math.abs(c.th)>45)return doFoul(now,c.th,c.ev,'Foul ball.');
  say(`${Math.round(c.ev)} mph off the bat`);startLive(c.ev,c.la,c.th,false,now)}
function pitchPos(u){
  const R=pitch.rel.clone(),E=new THREE.Vector3(pitch.zx*ZW,ZC+pitch.zy*ZH,ZZ);
  const Bv=new THREE.Vector3(pitch.bx*1.15,-pitch.by*1.7,0);const arc=.35+(pitch.dur-700)/1400;
  const p=R.clone().lerp(E.clone().sub(Bv),u).add(Bv.clone().multiplyScalar(u*u));p.y+=arc*Math.sin(PI*Math.min(u,1));return p}
function called(now){
  sfx.pop();let abOver=false,txt='',walk=false;const bid=batterId();
  const inz=isStrike(pitch.zx,pitch.zy);
  if(pitch.missed||inz){S.s++;if(S.s>=3){txt=pitch.missed?'Strike three, swinging!':'Strike three, looking!';S.outs++;stats[bid].ab++;stats[bid].k++;abOver=true;banner('Strikeout',userBats()?null:'Sat him down',!userBats())}else{txt=pitch.missed?'Swing and a miss. Strike '+S.s+'.':'Called strike '+S.s+'.';sfx.ump()}}
  else{S.b++;if(S.b>=4){walk=true;abOver=true;stats[bid].bb++;txt='Ball four. Take your base.'}else txt='Ball '+S.b+'.'}
  say(txt);
  if(walk){const sc=doWalk();if(stealRun){stealRun=null}}
  if(stealRun&&!walk&&S.outs<3){runSteal(now,abOver);return}
  stealRun=null;endPitch(abOver,1300)}
function doWalk(){const b=S.bases,bat=batterId();let sc=0;
  if(b[0]<0)b[0]=bat;else if(b[1]<0){b[1]=b[0];b[0]=bat}else if(b[2]<0){b[2]=b[1];b[1]=b[0];b[0]=bat}else{const s=b[2];b[2]=b[1];b[1]=b[0];b[0]=bat;addRuns(1);stats[s].r++;stats[bat].rbi++;sc=1}return sc}
const TAU=.55;function runDist(t,v){return t<=0?0:v*(t-TAU*(1-Math.exp(-t/TAU)))}
function runTime(L,v){let t=L/v+TAU;for(let i=0;i<8;i++){const g=v*(1-Math.exp(-t/TAU));t-=(runDist(t,v)-L)/Math.max(g,.1)}return t}
const STEAL_LEAD=b=>b===4?9:8,STEAL_JUMP=.15;
function stealD(i,c,ts){const lead=STEAL_LEAD(i+2);return Math.min((i+2)*60,(i+1)*60+lead+runDist(Math.max(0,ts-STEAL_JUMP),spdOf(c)))}
function runSteal(now,abOver){
  phase='steal';const st=stealRun,lead=Math.max(...st.bases),runner=S.bases[lead-2],spd=spdOf(runner);
  const wild=Math.abs(pitch.zx)>1.45||pitch.zy<-1.3;
  const tr=STEAL_JUMP+runTime(60-STEAL_LEAD(lead),spd);
  const target=BU[lead%4],dC=dist(CATCH_U[0],CATCH_U[1],target[0],target[1]),catchT=pitch.dur/1000;
  const pop=catchT+.55+(wild?1.3:0),flight=dC/80,tb=lead===4?catchT+.25+(wild?1.6:0):pop+flight+.15;
  const safe=tr<tb+rnd(-.08,.08);
  st.lead=lead;st.safe=safe;st.throwT0=lead===4?null:pop;st.throwT1=lead===4?null:pop+flight;st.end=Math.max(tr,tb)+.3;st.abOver=abOver;
  camMode='steal'}
function finishSteal(){
  const st=stealRun;const order=st.bases.slice().sort((a,b)=>b-a);
  for(const b of order){const c=S.bases[b-2];if(c<0)continue;S.bases[b-2]=-1;
    if(b===st.lead&&!st.safe){S.outs++;continue}
    if(b===4){addRuns(1);stats[c].r++}else S.bases[b-1]=c;stats[c].sb++}
  const mine=userBats();
  if(st.safe){banner('Safe!',st.lead===4?'Steals home!':'Stolen base!',mine);if(mine)sfx.cheer(st.lead===4)}
  else{banner('Out!',mine?'Caught stealing.':'Gunned down!',!mine)}
  stealRun=null;endPitch(st.abOver,1700)}

/* ================= BATTING ================= */
function swing(){
  if(!S)return;if(!userBats())return userPitchPress();
  if(phase!=='pitch'||!pitch||pitch.swung)return;audio();
  const now=NOW();swingAt=now;pitch.swung=true;const bid=batterId();if(!pitch.bunt)rigs[bid].play('swing',now,{minT:.32});
  const bat=CH[bid],isB=pitch.bunt;
  const p=(now-pitch.t0)/pitch.dur,d=p-IDEAL,dd=dist(ret.x,ret.y,pitch.zx,pitch.zy);
  const w=D.w*(.85+.075*bat.c)*(isB?1.9:1),tol=.85*(.9+.05*bat.c)*(isB?1.25:1);
  if(Math.abs(d)>w||dd>tol){pitch.missed=true;sfx.whiff();say(isB?'Missed the bunt!':Math.abs(d)>w?(d<0?'Way out in front!':'Too late!'):'Missed it. Bat in the wrong spot!');return}
  const q=Math.pow((1-Math.abs(d)/w)*(1-dd/tol),.65);
  let ev,la,th;
  if(isB){ev=rnd(20,32)+q*6;la=rnd(-14,2);th=rnd(-36,36)}
  else{ev=cl((44+62*Math.pow(q,.6)+(pitch.mph-80)*.15)*(.88+.06*bat.p),38,112);la=22+(ret.y-pitch.zy)*24+rnd(-5,5);th=(d/w*42+rnd(-7,7))*(LEFTY.has(bid)?-1:1)}
  sfx.crack(isB?.1:q);
  if(!isB&&q<.12)return doFoul(now,rnd(-1,1)<0?-70:70,ev*.6,'Foul tip! Weak contact.');
  if(Math.abs(th)>45)return doFoul(now,th,ev,'Foul ball!');
  say(isB?'Bunt is down!':`${Math.round(ev)} mph off the bat · ${Math.round(la)}° launch`);
  startLive(ev,la,th,isB,now)}
function doFoul(now,th,ev,txt){
  if(pitch&&pitch.bunt&&S.s===2&&userBats()){phase='result';S.outs++;stats[batterId()].ab++;stats[batterId()].k++;banner('Strikeout','Bunted foul with two strikes');say('Foul bunt on strike three.');stealRun=null;return endPitch(true,1500)}
  phase='foul';if(S.s<2)S.s++;const a=(Math.abs(th)>45?th:th<0?-60:60)*PI/180,back=Math.random()<.35;
  const L=back?[rnd(-30,30),-rnd(30,60)]:[Math.sin(a)*rnd(60,140),Math.cos(a)*rnd(60,140)];
  foul={t0:now,segs:[{t0:0,t1:1.6,a:[0,0],b:L,h:back?rnd(30,55):rnd(25,60),z0:3,z1:0}]};stealRun=null;say(txt);hudUpdate();
  after(1700,startPitch)}

/* ================= LIVE PLAY ENGINE =================
   Sim units: x right, y toward center field, bases 60 apart. Heights in real feet.
   Fielders chase, cover bases and throw; runners read the ball and decide to advance. */
const FSPD=19.5,ARM=85,REACT=.22,REACH=2.4;
const pDist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
function ballStep(b,dt){ // advances a ball state by dt (no fielders)
  if(b.mode==='air'){b.t+=dt;const u=b.t/b.T;
    if(u>=1){b.mode='ground';b.v=b.vLand;b.hop=Math.min(7,b.H*.12)+1;b.ht=0;b.z=0;b.bounced=true;b.x=b.ox+b.dx*b.D;b.y=b.oy+b.dy*b.D;return}
    const s=b.D*u*(1.3-.3*u);b.x=b.ox+b.dx*s;b.y=b.oy+b.dy*s;b.z=b.z0*(1-u)+4*b.H*u*(1-u);
    const a=Math.atan2(b.x,b.y),r=Math.hypot(b.x,b.y),f=fenceU(a);
    if(Math.abs(a)<=PI/4+.02&&r>=f){if(b.z>PK.wallH+.5){b.mode='dead';b.hr=true;b.landX=b.x;b.landY=b.y}else{b.mode='ground';b.v=-Math.max(6,b.vLand*.35);b.hop=2;b.ht=0;b.bounced=true;b.wall=true}}
    return}
  if(b.mode==='ground'){
    if(b.v>0)b.v=Math.max(0,b.v-dt*(b.grounder?(.35*b.v+5):(14+.12*b.v)));else b.v=Math.min(0,b.v+dt*16);
    b.x+=b.dx*b.v*dt;b.y+=b.dy*b.v*dt;b.ht+=dt;b.hop*=Math.exp(-dt*2.2);b.z=Math.abs(Math.sin(b.ht*6))*b.hop+.25;
    const a=Math.atan2(b.x,b.y),r=Math.hypot(b.x,b.y),f=fenceU(a);if(Math.abs(a)<=PI/4+.02&&r>=f-1&&b.v>0){b.v=-b.v*.3;b.wall=true}}}
function newBall(ev,la,th){
  const v=ev*1.467,a=th*PI/180,lr=la*PI/180,g=32.2;
  const b={x:0,y:1.5,z:3,ox:0,oy:1.5,dx:Math.sin(a),dy:Math.cos(a),t:0,mode:'air'};
  if(la<9){b.mode='ground';b.grounder=true;b.v=v*.7;b.hop=Math.max(.5,(la+12)*.12);b.ht=0;b.z=1}
  else{b.D=v*v*Math.sin(2*lr)/g*Math.min(.6,.42*Math.pow(150/v,.8));b.T=2*v*Math.sin(lr)/g*.8;b.H=v*v*Math.sin(lr)**2/(2*g)*.4;b.z0=3;b.vLand=b.D/b.T*.5}
  return b}
function predict(b,T=7,dt=.05){const c=Object.assign({},b),out=[];for(let t=0;t<=T;t+=dt){out.push({t,x:c.x,y:c.y,z:c.z,mode:c.mode});if(c.mode==='dead')break;ballStep(c,dt)}return out}
function startLive(ev,la,th,isBunt,now){
  const bid=batterId(),fT=fieldTeam(),stealing=new Set(stealRun?stealRun.bases.map(b=>b-1):[]);
  const tC=pitch?(now-pitch.t0)/1000:0;
  const P={t:0,t0:now,ball:newBall(ev,la,th),la,ev,bunt:isBunt,outs0:S.outs,outs:S.outs,runs:[],events:[],holder:null,throwQ:null,userTarget:0,userFields:!userBats(),
    fielders:fT.map((id,slot)=>({id,slot,x:HOME[slot][0],y:HOME[slot][1],tx:HOME[slot][0],ty:HOME[slot][1],task:'idle',ready:REACT+(slot===1?.1:slot>=6?.3:0)})),runners:[],settle:0,desc:'',batter:bid,fly:la>=12&&ev>40,thirdOut:null};
  // runners
  const occ=S.bases.map(x=>x>=0);
  S.bases.forEach((id,i)=>{if(id<0)return;const b=i+1;const forced=b===1||(b===2&&occ[0])||(b===3&&occ[0]&&occ[1]);
    let d=b*60+5;if(stealing.has(b))d=Math.min(b*60+55,stealD(b-1,id,tC));
    P.runners.push({id,from:b,to:b,d,spd:spdOf(id),forced,state:'safe',steal:stealing.has(b),tagged:true})});
  P.runners.push({id:bid,from:0,to:1,d:0,spd:spdOf(bid),forced:true,state:'run',bat:true,delay:.28,tagged:true});
  stealRun=null;
  // initial runner intents
  const twoOut=S.outs===2;
  for(const r of P.runners){if(r.bat)continue;
    if(P.fly){r.to=r.from+1;r.state=twoOut?'run':'hold';r.holdD=twoOut?null:Math.max(r.d,r.from*60+(r.steal?r.d-r.from*60:18));r.tagged=false}
    else if(r.forced||twoOut||r.steal){r.to=r.from+1;r.state='run'}}
  PS=P;phase='field';planFielders(P,true);
  if(P.fly){const pr=predict(P.ball,8);const land=pr.find(q=>q.mode!=='air')||pr[pr.length-1];const[x,z]=W(land.x,land.y);landRing.position.set(x,.12,z);landRing.visible=true}
  after(140,()=>{if(phase==='field')camMode='aerial'});btnUpdate()}
function coverMap(P,chaser){
  const c={4:1};const f=P.fielders,busy=new Set([chaser]);const ballRight=P.ball.dx>0;
  const pick=(...slots)=>{for(const s of slots)if(!busy.has(s)){busy.add(s);return s}return -1};
  const ch=f[chaser];
  if(chaser===2){const near=dist(ch.tx,ch.ty,...BU[1])<16;c[1]=near?2:pick(0,3)}else c[1]=pick(2,0,3);
  if(chaser===1)c[4]=pick(0,5);
  c[2]=ballRight?pick(4,3,0):pick(3,4,0);
  c[3]=pick(5,4,0);
  c.cut=pick(ballRight?3:4,ballRight?4:3);
  return c}
function planFielders(P,first){
  const pr=predict(P.ball,8),f=P.fielders;let best=-1,bt=1e9,bp=null;
  for(const fd of f){if(fd.slot===1&&Math.hypot(pr[pr.length-1].x,pr[pr.length-1].y)>35)continue;
    const r0=Math.max(0,fd.ready-P.t);
    for(const q of pr){if(q.mode==='dead')break;if(q.z>7&&q.mode==='air')continue;if(fd.slot===0&&q.mode==='air'&&pDist(fd,q)>14)continue;
      const tr=pDist(fd,q)/FSPD+r0;if(tr<=q.t){const score=q.t+(fd.slot===0&&q.mode!=='air'?.15:0);if(score<bt){bt=score;best=fd.slot;bp=q}break}}}
  if(best<0){const last=pr[pr.length-1];let md=1e9;for(const fd of f){if(fd.slot===1)continue;const d=pDist(fd,last);if(d<md){md=d;best=fd.slot;bp=last}}}
  P.chaser=best;P.chaseAt=bp;f[best].task='chase';f[best].tx=bp.x;f[best].ty=bp.y;
  if(first||!P.cover)P.cover=coverMap(P,best);
  const cv=P.cover;
  for(const fd of f){if(fd.slot===best||fd.task==='hold')continue;
    const b=[1,2,3,4].find(k=>cv[k]===fd.slot);
    if(b){fd.task='cover';fd.base=b;const[bx,by]=BU[b%4];fd.tx=bx+(b===1?-1.5:b===3?1.5:0);fd.ty=by+(b===2?-1.2:b===4?-2:1.2)}
    else if(fd.slot===cv.cut&&Math.hypot(bp.x,bp.y)>130){fd.task='cut';fd.tx=bp.x*.45;fd.ty=bp.y*.45+10}
    else if(fd.slot>=6){fd.task='back';fd.tx=lerp(HOME[fd.slot][0],bp.x,.45);fd.ty=lerp(HOME[fd.slot][1],bp.y,.45)}
    else if(fd.slot===0){fd.task='back';fd.tx=lerp(0,bp.x,.25);fd.ty=lerp(40,bp.y,.25)}
    else{fd.task='idle';fd.tx=fd.x;fd.ty=fd.y}}}
function runnerOn(P,b){return P.runners.find(r=>r.state!=='out'&&r.state!=='scored'&&r.to===b&&Math.abs(r.d-b*60)<1&&r.state==='safe')}
function ballTimeTo(P,b){ // how long until the defense could have the ball at base b
  const[bx,by]=BU[b%4];
  if(P.holder!=null){const h=P.fielders[P.holder];return .3+Math.hypot(h.x-bx,h.y-by)/ARM}
  if(P.throwQ){const q=P.throwQ;return Math.max(0,q.arrive-P.t)+.25+Math.hypot(q.bx-bx,q.by-by)/ARM}
  const ch=P.fielders[P.chaser],bl=P.ball;if(bl.mode==='dead')return 99;
  const tget=P.chaseAt?Math.max(P.chaseAt.t-P.t,pDist(ch,P.chaseAt)/FSPD):pDist(ch,bl)/FSPD+.4;
  const gx=P.chaseAt?P.chaseAt.x:bl.x,gy=P.chaseAt?P.chaseAt.y:bl.y;
  return Math.max(0,tget)+.35+Math.hypot(gx-bx,gy-by)/ARM}
function runnerDecide(P,r){
  if(r.state!=='safe'||r.to>=4)return;const nb=r.to+1;
  if(P.ball.mode==='air'&&!(P.outs>=2))return;
  if(P.caught&&!r.tagged)return;
  const ahead=P.runners.find(o=>o!==r&&o.state!=='out'&&o.state!=='scored'&&(o.to===nb||Math.floor(o.d/60)===nb)&&!(o.state==='run'&&o.to>nb));
  if(ahead)return;
  const runT=(nb*60-r.d)/r.spd+.15,ballT=ballTimeTo(P,nb);
  const aggr=P.outs>=2?.15:.4;
  if(runT<ballT-aggr){r.state='run';r.to=nb;r.forced=false}}
function isForced(P,r){return r.forced}
function outRunner(P,r,how){r.state='out';r.outT=P.t;r.outD=r.d;P.outs++;P.events.push({t:P.t,type:'out',how,id:r.id,bat:!!r.bat,force:how==='force'||how==='batter1'});
  // force removed for runners ahead of a retired batter or trailing runner
  for(const o of P.runners)if(o!==r&&o.state==='run'&&o.from>r.from)o.forced=o.forced&&!(r.bat||r.from<o.from)?false:o.forced;
  if(r.bat&&how!=='fly')for(const o of P.runners)if(!o.bat)o.forced=false;
  if(P.outs>=3&&!P.thirdOut)P.thirdOut={t:P.t,force:how==='force'||how==='batter1'||how==='fly'&&r.bat}}
function decideThrow(P,h){
  const f=P.fielders[h],opts=[];
  const live=P.runners.filter(r=>r.state==='run'||r.state==='back'||r.state==='hold'||(P.caught&&!r.tagged&&r.state!=='out'&&r.state!=='scored'));
  for(const r of live){
    const back=r.state==='back'||(P.caught&&!r.tagged),b=back?r.from:r.to;if(b<1)continue;
    const bd=b*60,rem=back?Math.max(0,r.d-r.from*60):Math.max(0,bd-r.d),rETA=rem/r.spd+(r.delay&&r.delay>P.t?r.delay-P.t:0);
    const force=back||r.forced||(r.bat&&b===1);const[bx,by]=BU[b%4];
    const selfD=Math.hypot(f.x-bx,f.y-by),selfT=selfD/FSPD+.05;
    if(selfD<20&&(selfT<rETA-.05))opts.push({b,r,self:true,m:rETA-selfT,force});
    const cv=P.cover[b];if(cv!=null&&cv>=0&&cv!==h){const rc=P.fielders[cv];const recT=Math.hypot(rc.x-bx,rc.y-by)/FSPD;
      const at=Math.max(.3+selfD/ARM,recT+.05)+(force?0:.15);opts.push({b,r,self:false,m:rETA-at,force,to:cv})}}
  if(P.userFields&&!P.userTarget){f.task='hold';P.awaitThrow=true;say(CH[fieldTeam()[h]].n+' has it. Click a base to throw!');return}
  if(P.userFields&&P.userTarget){const b=P.userTarget;P.userTarget=0;P.awaitThrow=false;btnUpdate();const[bx,by]=BU[b%4];
    const o=opts.find(o=>o.b===b)||{b,self:Math.hypot(f.x-bx,f.y-by)<6,to:P.cover[b]>=0&&P.cover[b]!==h?P.cover[b]:null,m:0};
    if(o.self||o.to==null){f.task='tobase';f.base=b;f.tx=bx;f.ty=by;return}
    return throwTo(P,h,o.to,b)}
  const ok=opts.filter(o=>o.m>.06);
  if(ok.length){const sc=o=>(o.m>.18?o.b*10:0)+Math.min(o.m,.8);ok.sort((a,b)=>sc(b)-sc(a));const o=ok[0];
    if(o.self){f.task='tobase';f.base=o.b;const[bx,by]=BU[o.b%4];f.tx=bx;f.ty=by;return}return throwTo(P,h,o.to,o.b)}
  // no play: get the ball back to the infield
  const deep=Math.hypot(f.x,f.y)>110;
  if(deep){const lead=live.filter(r=>r.state==='run').sort((a,b)=>b.to-a.to)[0];const b=lead?Math.min(4,lead.to+(lead.d>lead.from*60+40?1:0)):2;
    const cv=P.cover[b]>=0&&P.cover[b]!==h?P.cover[b]:P.cover.cut>=0?P.cover.cut:0;
    if(dist(f.x,f.y,...BU[b%4])>175&&P.cover.cut>=0&&P.cover.cut!==h&&cv!==P.cover.cut)return throwTo(P,h,P.cover.cut,null);
    return throwTo(P,h,cv,b)}
  f.task='hold'}
function throwTo(P,h,to,b){
  const f=P.fielders[h],rc=P.fielders[to];if(!rc){f.task='hold';return}
  const[bx,by]=b?BU[b%4]:[rc.x,rc.y];if(b){rc.task='cover';rc.base=b;rc.tx=bx;rc.ty=by}else{rc.task='cut';rc.tx=rc.x;rc.ty=rc.y}
  const rel=P.t+.3,dd=Math.hypot(f.x-bx,f.y-by),arr=rel+dd/ARM;
  P.throwQ={from:h,to,b,rel,arrive:arr,sx:f.x,sy:f.y,bx,by,h:Math.min(10,dd*.05)+1.5,started:false};f.task='throwing';P.holder=null;
  f.faceX=bx;f.faceY=by;f.throwAnim=true}
function receive(P,slot){
  const f=P.fielders[slot],q=P.throwQ;P.throwQ=null;P.holder=slot;f.task='holdwait';f.waitT=P.t+.12;
  sfx.pop();if(q&&q.b)baseTouch(P,slot,q.b)}
function baseTouch(P,slot,b){
  const f=P.fielders[slot];
  for(const r of P.runners){
    if(r.state==='out'||r.state==='scored')continue;
    const back=r.state==='back'||(P.caught&&!r.tagged&&r.state!=='safe');
    if(back&&r.from===b&&r.d>b*60+.5){outRunner(P,r,'doubled');P.desc='Doubled off!';continue}
    if(!back&&r.to===b&&r.d<b*60-.5&&(r.state==='run'||r.state==='hold')){
      const force=r.forced||(r.bat&&b===1);
      if(force||Math.hypot(f.x-BU[b%4][0],f.y-BU[b%4][1])<4){outRunner(P,r,r.bat&&b===1?'batter1':force?'force':'tag');}}}}
function liveTick(P,dt){
  P.t+=dt;const b=P.ball,f=P.fielders;
  // ball
  if(P.holder!=null){const h=f[P.holder];b.mode='held';b.x=h.x;b.y=h.y;b.z=4}
  else if(P.throwQ){const q=P.throwQ;if(P.t>=q.rel){q.started=true;const u=cl((P.t-q.rel)/Math.max(.05,q.arrive-q.rel),0,1);b.mode='thrown';b.x=lerp(q.sx,q.bx,u);b.y=lerp(q.sy,q.by,u);b.z=lerp(5,4,u)+4*q.h*u*(1-u);
      const rc=f[q.to];if(u>=1&&Math.hypot(rc.x-q.bx,rc.y-q.by)<REACH+1)receive(P,q.to);else if(u>=1){b.mode='ground';b.v=0;b.dx=0;b.dy=1;b.hop=0;b.ht=0;P.throwQ=null;planFielders(P,false)}}
    else{const h=f[q.from];b.x=h.x;b.y=h.y;b.z=4.5}}
  else if(b.mode!=='dead')ballStep(b,dt);
  // HR
  if(b.mode==='dead'&&b.hr&&!P.hr){P.hr=true;for(const r of P.runners)if(r.state!=='out'){r.state='run';r.to=4;r.trot=true;r.forced=false;r.hrScored=true;P.runs.push({t:P.t,id:r.id})}P.desc='Home run!';P.hrT=P.t;landRing.visible=false}
  // fielders move
  if(!P.hr)for(const fd of f){if(P.t<fd.ready&&fd.task!=='idle')continue;
    if(fd.task==='throwing'){if(P.t>(P.throwQ&&P.throwQ.from===fd.slot?P.throwQ.rel:0)+.2)fd.task='idle';continue}
    const dx=fd.tx-fd.x,dy=fd.ty-fd.y,d=Math.hypot(dx,dy),sp=(fd.task==='idle'||fd.task==='back'?FSPD*.6:FSPD)*dt;
    if(d>.05){const s=Math.min(1,sp/d);fd.x+=dx*s;fd.y+=dy*s}
    if(fd.task==='chase'&&P.holder==null&&!P.throwQ){
      const bd=Math.hypot(b.x-fd.x,b.y-fd.y);
      if(bd<REACH&&(b.mode==='ground'||b.mode==='air'&&b.z<7.2)){
        if(b.mode==='air'&&!b.bounced){P.caught=true;P.ballCaughtT=P.t;const br=P.runners.find(r=>r.bat);if(br)outRunner(P,br,'fly');P.desc=(P.la>45?'Pop up':'Fly out')+' to the '+POSN[fd.slot]+'.';
          for(const r of P.runners)if(!r.bat&&r.state!=='out'){r.tagged=r.d<=r.from*60+1.5;if(!r.tagged){r.state='back';r.to=r.from}}landRing.visible=false}
        if(P.firstD==null)P.firstD=Math.hypot(fd.x,fd.y);P.holder=fd.slot;fd.task='holdwait';fd.waitT=P.t+(b.mode==='air'?.35:.25);landRing.visible=false}
      else if(Math.floor(P.t/.25)!==Math.floor((P.t-dt)/.25))planFielders(P,false)}
    if(fd.task==='holdwait'&&P.holder===fd.slot&&P.t>=fd.waitT){fd.task='hold';decideThrow(P,fd.slot)}
    if(fd.task==='tobase'&&P.holder===fd.slot&&d<1){fd.task='holdwait';fd.waitT=P.t+.1;baseTouch(P,fd.slot,fd.base)}}
  // runners
  for(const r of P.runners){
    if(r.state==='out'||r.state==='scored')continue;
    if(r.delay&&P.t<r.delay)continue;
    if(r.state==='hold'){const tgt=r.holdD??r.d;if(r.d<tgt)r.d=Math.min(tgt,r.d+r.spd*dt);
      if(b.mode==='ground'&&!P.caught&&b.bounced){r.state='run'}}
    if(r.state==='back'){const home=Math.min(r.to,r.from)*60;r.d=Math.max(home,r.d-r.spd*dt);if(r.d<=home+.01){r.state='safe';r.tagged=true;r.to=Math.min(r.to,r.from)}}
    if(r.state==='run'){
      const lead=P.runners.filter(o=>o!==r&&o.state!=='out'&&o.state!=='scored'&&o.d>r.d).sort((a,c)=>a.d-c.d)[0];
      if(lead&&lead.state!=='run'){const lb=Math.round(lead.d/60);if(r.to>=lb&&Math.abs(lead.d-lb*60)<2){r.to=Math.max(r.from,lb-1);r.forced=false}}
      let cap=r.to*60;if(lead&&lead.state==='run')cap=Math.min(cap,lead.d-2);
      if(cap<r.d&&r.d>r.to*60){r.state='back'}else{r.d=Math.min(cap,r.d+r.spd*(r.trot?.8:1)*dt);
      if(r.d>=r.to*60-.01){if(r.to>=4){r.state='scored';if(!r.hrScored)P.runs.push({t:P.t,id:r.id})}else r.state='safe'}}}
    if(r.state==='safe'&&!P.hr)runnerDecide(P,r)}
  // end of play
  const moving=P.runners.some(r=>r.state==='run'||r.state==='back'||r.state==='hold');
  if(P.hr){if(P.t>P.hrT+2.9)return true;return false}
  if(P.outs>=3)return P.t>(P.thirdOut?P.thirdOut.t:P.t)+1.1;
  if(!moving&&(P.holder!=null)&&!P.throwQ){P.settle+=dt;if(P.settle>.45)return true}else P.settle=0;
  if(P.t>16)return true;return false}
function finishLive(P){window.__lastPlay={t:P.t,outs:P.outs,outs0:P.outs0,runs:P.runs.slice(),third:P.thirdOut,runners:P.runners.map(r=>({id:r.id,from:r.from,to:r.to,st:r.state,d:Math.round(r.d)})),events:P.events};
  const bid=P.batter,st=stats[bid],side=userBats()?'you':'cpu';
  let counted=P.thirdOut?(P.thirdOut.force?[]:P.runs.filter(x=>x.t<=P.thirdOut.t)):P.runs.slice();
  if(!P.hr&&!userBats()&&S.inn>=INN){const need=S.runs-S.cpu+1;if(need>0&&counted.length>need)counted=counted.slice(0,need)}
  const runs=counted.length;
  counted.forEach(x=>stats[x.id].r++);addRuns(runs);
  S.outs=Math.min(3,P.outs);
  const nb=[-1,-1,-1];for(const r of P.runners)if(r.state==='safe'&&r.to>=1&&r.to<=3)nb[r.to-1]=r.id;S.bases=nb;
  const br=P.runners.find(r=>r.bat),reached=br&&(br.state==='safe'||br.state==='scored');
  const fcOut=P.events.some(e=>e.type==='out'&&!e.bat&&(e.force||(P.firstD??999)<95));
  const brOut=br&&br.state==='out'&&!P.caught?Math.min(3,Math.floor((br.outD??0)/60)):0;
  const sac=!reached&&P.bunt&&P.runners.some(r=>!r.bat&&r.state!=='out'&&r.to>r.from);
  const sf=P.caught&&counted.length>0&&!reached;
  if(!sac&&!sf)st.ab++;
  let hitBases=0;if(P.hr)hitBases=4;else if(reached&&!fcOut&&!P.caught)hitBases=br.state==='scored'?4:br.to;else if(brOut&&!fcOut)hitBases=brOut;
  if(hitBases){st.h++;S.hits[side]++}if(hitBases===4)st.hr++;
  if(!P.events.some(e=>e.type==='out'&&e.force&&P.events.filter(x=>x.type==='out').length>1))st.rbi+=runs;
  const outs=P.events.filter(e=>e.type==='out').length;
  let title,sub=null,gold=userBats();
  if(P.hr){title=runs===4?'Grand Slam!':'Home Run!';sub=`${CH[bid].n} · ${Math.round(Math.hypot(P.ball.landX,P.ball.landY)*K)} ft`;gold=true}
  else if(outs>=3&&P.outs0===0&&outs===3){title='Triple Play!';gold=!userBats()}
  else if(outs===2){title='Double Play!';gold=!userBats()}
  else if(brOut&&hitBases){title=['','Single','Double','Triple'][hitBases]+', out stretching'}
  else if(hitBases){title=['','Single!','Double!','Triple!','Inside the park!'][hitBases];if(hitBases===1&&(P.firstD??999)<95)title='Infield single!'}
  else if(sf){title='Sac fly'}else if(sac){title='Sacrifice'}
  else if(reached&&fcOut){title="Fielder's choice"}
  else if(outs){title='Out';gold=!userBats()}else title='Safe';
  if(!P.desc||P.desc==='Home run!')P.desc=title;
  if(runs)sub=(sub?sub+' · ':'')+'+'+runs+' run'+(runs>1?'s':'');
  banner(title,sub,gold);say(P.desc+(runs&&!P.hr?' +'+runs:''));
  if(gold&&(runs||hitBases))sfx.cheer(P.hr||runs>0);if(P.hr)cheerUntil=NOW()+4200;
  landRing.visible=false;PS=null;endPitch(true,P.hr?300:1400)}

/* ================= SCENE POSITIONING ================= */
function segAt(segs,t){let c=null;for(const s of segs)if(t>=s.t0)c=s;if(!c)return null;const u=cl((t-c.t0)/Math.max(.01,c.t1-c.t0),0,1);
  return{x:lerp(c.a[0],c.b[0],u),y:lerp(c.a[1],c.b[1],u),z:lerp(c.z0??0,c.z1??0,u)+4*c.h*u*(1-u)}}
function pathPos(d){d=cl(d,0,240);if(d>=240)return[0,0];const i=Math.floor(d/60),f=(d%60)/60,A=BU[i],B=BU[(i+1)%4];return[lerp(A[0],B[0],f),lerp(A[1],B[1],f)]}
let snapAll=false,pitcherGo=0;const debris=[];const _vs=new THREE.Vector3(),_w=new THREE.Vector3();
function visScale(x,z){if(camMode==='bat')return 1;const d=camera.position.distanceTo(_vs.set(x,2,z));return cl(d/150,1,1.3)}
const faceTo=(x,z,tx,tz)=>Math.atan2(tx-x,tz-z);
function dropBat(rg){const m=new THREE.Mesh(GEO.bat,rg.bat.material);rg.bat.getWorldPosition(m.position);rg.bat.getWorldQuaternion(m.quaternion);rg.bat.getWorldScale(m.scale);m.scale.x=Math.abs(m.scale.x);m.castShadow=true;scene.add(m);
  debris.push({m,v:new THREE.Vector3(rnd(-6,6),rnd(4,8),rnd(-4,4)),w:new THREE.Vector3(rnd(-8,8),rnd(-8,8),rnd(-8,8))})}
function debrisTick(dt){for(const d of debris){if(d.rest)continue;d.v.y-=32*dt;d.m.position.addScaledVector(d.v,dt);d.m.rotation.x+=d.w.x*dt;d.m.rotation.z+=d.w.z*dt;
  if(d.m.position.y<.14){d.m.position.y=.14;d.v.y*=-.35;d.v.x*=.6;d.v.z*=.6;d.w.multiplyScalar(.5);d.m.rotation.x=PI/2;if(Math.abs(d.v.y)<1)d.rest=true}}}
function clearDebris(){debris.forEach(d=>{scene.remove(d.m)});debris.length=0}
function layout(now,dt,ball){
  const all=Object.values(rigs);all.forEach(r=>r.used=false);
  if(window.__gallery){for(let i=0;i<34;i++){const rg=rigFor(i,i%2?'cpu':'you');const row=Math.floor(i/9),col=i%9;rg.drive(now,dt,(col-4)*3.4,-row*5-6,{state:'idle',face:0,ring:false,vis:1,glove:false})}return}
  if(!S||phase==='title'){all.forEach(r=>r.root.visible=false);return}
  const P=PS,snap=snapAll;snapAll=false;
  const mz=-.672*PK.B,ring=camMode!=='bat',lookAt=ball?ball.clone():_w.set(0,3,0).clone(),moundPt=new THREE.Vector3(0,4,mz);
  const batSide=userBats()?'you':'cpu',go=(rg,x,z,o)=>{if(!rg)return;rg.used=true;const hw=rg.team===batSide?'helmet':'cap';if(rg.headwear!==hw)rg.setHeadwear(hw);o.snap=snap;o.vis=visScale(x,z);o.ring=ring;if(snap)rg.prev=null;rg.drive(now,dt,x,z,o)};
  const fT=fieldTeam(),bid=batterId();
  // ---------- fielders ----------
  fT.forEach((c,slot)=>{const rg=rigs[c];const o={glove:true,look:lookAt};
    if(P){const fd=P.fielders[slot],[wx,wz]=W(fd.x,fd.y);
      o.state=fd.task==='idle'||fd.task==='hold'?'ready':'ready';o.face=faceTo(wx,wz,...(ball?[ball.x,ball.z]:[0,0]));
      if(slot===1&&fd.task==='idle')o.state='crouch';
      if(fd.throwAnim){fd.throwAnim=false;rg.play('throw',now,{minT:.7})}
      if(fd.task==='throwing'||P.throwQ&&P.throwQ.from===slot){const q=P.throwQ;if(q){const[bx,bz]=W(q.bx,q.by);o.face=faceTo(wx,wz,bx,bz)}}
      if(ball&&_w.set(wx,ball.y,wz).distanceTo(ball)<9*K&&ball.y<10&&P.holder!==slot)o.reach=ball;
      go(rg,wx,wz,o);return}
    let[x,y]=HOME[slot];
    if(slot===1){if(camMode==='bat'){rg.root.visible=false;rg.used=true;return}
      const[wx]=W(0,0);o.state='crouch';o.face=PI;
      if(phase==='pitch'&&ball&&ball.z>-12)o.reach=ball;
      if(phase==='steal'&&stealRun&&stealRun.throwT0!=null){const ts=(now-pitch.t0)/1000,tg=BU[stealRun.lead%4],[bx,bz]=W(...tg);
        if(ts>stealRun.throwT0-.3){o.face=faceTo(0,3,bx,bz);o.state='idle';if(!stealRun.cThrow){stealRun.cThrow=1;rg.play('throw',now,{minT:.7})}}}
      go(rg,wx,3.2,o);return}
    if(slot===0){o.face=0;
      if(phase==='windup'){if(now>=wt&&pitcherGo!==wt){pitcherGo=wt;rg.play('pitch',wt,{minT:2.6,fade:.25})}o.state='pset';o.noRun=true}
      else if(phase==='uready'){o.state='pset';o.noRun=true}
      else if(phase==='uwind'||phase==='pitch'){o.state='ready';o.noRun=true}
      else o.state='idle'}
    else if(stealRun&&phase==='steal'&&stealRun.lead<4){const cover=stealRun.lead===2?(S.bases[0]>=0&&LEFTY.has(bid)?3:4):5;if(slot===cover){const ts=(now-pitch.t0)/1000,u=cl((ts-.45)/1.3,0,1);x=lerp(x,BU[stealRun.lead%4][0],u);y=lerp(y,BU[stealRun.lead%4][1],u);const[cx,cz]=W(x,y);if(ball&&_w.set(cx,ball.y,cz).distanceTo(ball)<9*K)o.reach=ball}}
    const[wx,wz]=W(x,y);
    if(slot!==0){o.state=(phase==='pitch'||phase==='steal'||phase==='uwind'||phase==='windup'&&now-wt>800)?'ready':'idle';o.face=faceTo(wx,wz,0,0)}
    go(rg,wx,wz,o)});
  // ---------- runners ----------
  if(P){for(const r of P.runners){const rg=rigs[r.id];if(r.state==='out'&&P.t-r.outT>1.2){continue}
      const[x,y]=pathPos(r.d),[wx,wz]=W(x,y);const o={look:ball||moundPt,state:r.state==='hold'||r.state==='safe'?'lead':'idle',face:faceTo(wx,wz,0,mz*.6)};
      if(r.bat){if(!P.batDropped&&P.t>.28&&rg.bat.visible){P.batDropped=1;dropBat(rg)}o.noBat=P.t>.28;
        if(P.t<.3){o.face=PI/2;o.mirror=rg.lefty;o.noRun=true;o.state='stance';go(rg,rg.lefty?BATX:-BATX,BATZ,o);continue}}
      if(r.state==='scored'){if(P.t-(P.runs.find(x=>x.id===r.id)||{t:0}).t>1.6)continue;o.state='cheer'}
      go(rg,wx,wz,o)}}
  else{
    S.bases.forEach((c,i)=>{if(c<0)return;let d=(i+1)*60+4;
      let sl=false;if(stealRun&&stealRun.bases.includes(i+2)){const ts=(now-stealRun.t0)/1000;d=stealD(i,c,ts);sl=(i+2)*60-d<7}
      else if(phase==='pitch'){const ts=(now-pitch.t0)/1000;d+=Math.min(4,ts*6)}
      const[x,y]=pathPos(d),[wx,wz]=W(x,y);
      go(rigs[c],wx,wz,{state:sl?'slide':'lead',noRun:sl,face:sl?faceTo(wx,wz,...W(...BU[(i+2)%4])):faceTo(wx,wz,0,mz*.6),look:ball||moundPt})});
    if(phase!=='cpu'&&phase!=='over'){const rg=rigs[bid],o={face:PI/2,mirror:rg.lefty,noRun:true,look:ball&&phase==='pitch'?ball:moundPt};
      const ub=userBats();o.state=ub&&bunt?'bunt':(phase==='pitch'&&pitch&&!pitch.swung)?'load':'stance';
      go(rg,rg.lefty?BATX:-BATX,BATZ,o)}}
  all.forEach(r=>{if(!r.used)r.root.visible=false})}
function ballTick(now){
  let pos=null;
  if(phase==='pitch'&&pitch){const u=(now-pitch.t0)/pitch.dur;if(u<1.08)pos=pitchPos(u)}
  else if(phase==='steal'&&stealRun){const ts=(now-pitch.t0)/1000;const st=stealRun;
    if(st.throwT0!=null&&ts>=st.throwT0){const tg=BU[st.lead%4];const u=cl((ts-st.throwT0)/(st.throwT1-st.throwT0),0,1);const[a0,a1]=W(...CATCH_U),[b0,b1]=W(...tg);pos=new THREE.Vector3(lerp(a0,b0,u),lerp(4,3.5,u)+4*3*u*(1-u),lerp(a1,b1,u))}
    if(ts>=st.end&&!st.done){st.done=true;finishSteal()}}
  else if(phase==='field'&&PS){const b=PS.ball;if(!(b.mode==='dead'&&PS.t-PS.hrT>1.2)){const[x,z]=W(b.x,b.y);pos=new THREE.Vector3(x,b.z,z);
      if(PS.holder!=null){rigs[fieldTeam()[PS.holder]].glove.getWorldPosition(pos)}}}
  else if(phase==='foul'&&foul){const t=(now-foul.t0)/1000;if(t<1.6){const b=segAt(foul.segs,t);const[x,z]=W(b.x,b.y);pos=new THREE.Vector3(x,b.z*K,z)}}
  if(pos){ballMesh.visible=ballShadow.visible=true;ballMesh.position.copy(pos);ballMesh.rotation.x+=.4;const s=camMode==='bat'?1:visScale(pos.x,pos.z)*1.6;ballMesh.scale.setScalar(s);
    ballShadow.position.set(pos.x,.07,pos.z);ballShadow.scale.set(.9*s,1,.9*s);
    if(phase==='field'||phase==='foul'||phase==='steal'){trail.push(pos.clone());if(trail.length>40)trail.shift()}else trail=[]}
  else{ballMesh.visible=ballShadow.visible=false;if(phase!=='field')trail=[]}
  const arr=trailGeo.attributes.position.array;for(let i=0;i<60;i++){const p=trail[Math.max(0,trail.length-60+i)]||trail[0]||{x:0,y:-50,z:0};arr[i*3]=p.x;arr[i*3+1]=p.y;arr[i*3+2]=p.z}
  trailGeo.attributes.position.needsUpdate=true;trailLine.visible=trail.length>2;
  return pos}

/* ================= CAMERA ================= */
const tmpP=new THREE.Vector3(),tmpL=new THREE.Vector3(),dbg={p:new THREE.Vector3(),l:new THREE.Vector3()};
function catcherCam(){const asp=VW/VH;
  // eye line just above a 6-ft batter's letters, looking out over the plate
  if(asp<.8)return{p:new THREE.Vector3(0,3.2,13.5),l:new THREE.Vector3(0,2.6,-40)};
  if(asp<1.3)return{p:new THREE.Vector3(0,3,11),l:new THREE.Vector3(0,2.5,-40)};
  return{p:new THREE.Vector3(0,2.9,9.6),l:new THREE.Vector3(0,2.4,-40)}}
function camTick(dt,now,ball){
  let k=3.2;
  if(camMode==='bat'){const c=catcherCam();tmpP.copy(c.p);tmpL.copy(c.l);k=4}
  else if(camMode==='aerial'){const b=ball||ballMesh.position;const d=Math.hypot(b.x,b.z);
    if(camStyle===0&&PS&&PS.userFields){ // user on defense: keep the diamond in frame so every base can be clicked
      const lx=b.x*.5,lz=lerp(-PK.B*Math.SQRT1_2,b.z,.5),f=cl(1.25/(VW/VH),1,1.9);tmpP.set(lx*.4,(55+d*.45)*f,(60+d*.33)*f);tmpL.set(lx,0,lz)}
    else if(camStyle===0){tmpP.set(b.x*.42,34+d*.3+b.y*.25,b.z*.42+62+d*.22);tmpL.set(b.x*.85,b.y*.45,b.z*.85)}
    else{tmpP.set(b.x*.55,150+d*.45,b.z*.55+70);tmpL.set(b.x*.8,0,b.z*.8-8)}k=2.6}
  else if(camMode==='debug'){tmpP.copy(dbg.p);tmpL.copy(dbg.l);k=50}
  else if(camMode==='steal'){tmpP.set(0,48*K,62*K);tmpL.set(0,0,-55*K);k=2.4}
  else{const a=now/16000,R=PK.C*K*1.15;tmpP.set(Math.sin(a)*R,90+PK.C*K*.25,Math.cos(a)*R*.8+60);tmpL.set(0,0,-PK.B*1.3);k=1.4}
  const f=1-Math.exp(-dt*k);camPos.lerp(tmpP,f);camLook.lerp(tmpL,f);
  camera.position.copy(camPos);const sh=Math.max(0,1-(now-swingAt)/180);if(sh>0&&PS){camera.position.x+=rnd(-.06,.06)*sh;camera.position.y+=rnd(-.06,.06)*sh}
  camera.lookAt(camLook);skyMesh&&skyMesh.position.copy(camera.position)}

/* ================= HUD CANVAS ================= */
const v3=new THREE.Vector3();
function proj(x,y,z){v3.set(x,y,z).project(camera);return[(v3.x+1)/2*VW,(1-v3.y)/2*VH,v3.z]}
function zoneFrame(){const c=[proj(-ZW,ZC-ZH,ZZ),proj(ZW,ZC-ZH,ZZ),proj(ZW,ZC+ZH,ZZ),proj(-ZW,ZC+ZH,ZZ)];
  hx.strokeStyle='rgba(255,255,255,.4)';hx.lineWidth=1.5;hx.setLineDash([5,5]);hx.beginPath();c.forEach((p,i)=>i?hx.lineTo(p[0],p[1]):hx.moveTo(p[0],p[1]));hx.closePath();hx.stroke();hx.setLineDash([]);
  return{pxU:(c[1][0]-c[0][0])/2,pyU:(c[0][1]-c[3][1])/2,c}}
function hudTick(now){
  hx.clearRect(0,0,VW,VH);baseHits=[];if(!S)return;
  if(camMode!=='bat'){drawTags(now);drawBaseTargets(now);return}
  const ghostOn=ghost&&phase!=='field'&&phase!=='over'&&phase!=='cpu';
  if(!userBats()){
    if(phase==='uready'||phase==='uwind'){
      const{pxU,c}=zoneFrame(),[ax,ay]=proj(aim.x*ZW,ZC+aim.y*ZH,ZZ),r=Math.max(10,.28*pxU);
      if(ghostOn)drawGhost(now);
      hx.strokeStyle='#f4bf3a';hx.lineWidth=3;hx.beginPath();hx.arc(ax,ay,r,0,7);hx.stroke();hx.beginPath();hx.arc(ax,ay,3,0,7);hx.fillStyle='#f4bf3a';hx.fill();
      hx.font='800 12px "Barlow Semi Condensed",sans-serif';hx.textAlign='center';hx.fillText(TYPES[ptype].n.toUpperCase(),ax,ay-r-8);
      pitchMeter(now,c)}
    else if(ghostOn){zoneFrame();drawGhost(now)}
    return}
  if(!(phase==='windup'||phase==='pitch')){if(ghostOn){zoneFrame();drawGhost(now)}return}
  const{pxU,pyU}=zoneFrame();
  if(ghostOn)drawGhost(now);
  const[rx,ry]=proj(ret.x*ZW,ZC+ret.y*ZH,ZZ);const bat=CH[batterId()];
  const tolR=.85*(.9+.05*bat.c)*(bunt?1.25:1)*pxU,sweet=.32*pxU;
  hx.fillStyle='rgba(255,255,255,.07)';hx.beginPath();hx.ellipse(rx,ry,Math.abs(tolR),Math.abs(tolR*pyU/(pxU||1)),0,0,7);hx.fill();
  hx.strokeStyle='rgba(255,255,255,.55)';hx.lineWidth=1.2;hx.stroke();
  hx.strokeStyle='#fff';hx.lineWidth=2.5;hx.beginPath();hx.arc(rx,ry,Math.abs(sweet),0,7);hx.stroke();
  hx.beginPath();hx.moveTo(rx-sweet-6,ry);hx.lineTo(rx-sweet+5,ry);hx.moveTo(rx+sweet-5,ry);hx.lineTo(rx+sweet+6,ry);hx.moveTo(rx,ry-sweet-6);hx.lineTo(rx,ry-sweet+5);hx.moveTo(rx,ry+sweet-5);hx.lineTo(rx,ry+sweet+6);hx.stroke();
  if(bunt){hx.fillStyle='#f4bf3a';hx.font='800 12px "Barlow Semi Condensed",sans-serif';hx.textAlign='center';hx.fillText('BUNT',rx,ry-sweet-10)}
  if(phase==='pitch'&&pitch&&!pitch.swung){const p=(now-pitch.t0)/pitch.dur,w=D.w*(.85+.075*bat.c)*(bunt?1.9:1);const k=Math.max(0,(IDEAL-p)/IDEAL);
    const good=Math.abs(p-IDEAL)<w;hx.strokeStyle=good?'#47e07a':'#f4bf3a';hx.lineWidth=good?4:3;hx.beginPath();hx.arc(rx,ry,Math.abs(sweet)*(1+k*4),0,7);hx.stroke()}}
/* compact vertical release meter, parked just off the right edge of the strike zone */
function pitchMeter(now,c){
  const zr=Math.max(c[1][0],c[2][0]),zt=Math.min(c[2][1],c[3][1]),zb=Math.max(c[0][1],c[1][1]);
  const h=cl(zb-zt,70,140),w=10,x0=Math.min(VW-w-16,zr+22),y0=(zt+zb)/2-h/2;
  const Y=f=>y0+h*(1-f);
  hx.fillStyle='rgba(10,20,14,.82)';hx.beginPath();hx.roundRect?hx.roundRect(x0-4,y0-4,w+8,h+8,7):hx.rect(x0-4,y0-4,w+8,h+8);hx.fill();
  hx.fillStyle='rgba(255,255,255,.12)';hx.fillRect(x0,y0,w,h);
  hx.fillStyle='rgba(244,191,58,.55)';hx.fillRect(x0,Y(.66),w,Y(.54)-Y(.66));hx.fillRect(x0,Y(.88),w,Y(.78)-Y(.88));
  hx.fillStyle='rgba(71,224,122,.9)';hx.fillRect(x0,Y(.78),w,Y(.66)-Y(.78));
  const m=uwind?(uwind.m??cl((now-uwind.t0)/900,0,1)):0,my=Y(m);
  hx.fillStyle='#fff';hx.fillRect(x0-5,my-1.5,w+10,3);
  hx.beginPath();hx.moveTo(x0-6,my-5);hx.lineTo(x0-1,my);hx.lineTo(x0-6,my+5);hx.fill();
  hx.font='800 9px "Barlow Semi Condensed",sans-serif';hx.textAlign='center';hx.fillStyle='rgba(243,236,217,.8)';hx.fillText('REL',x0+w/2,y0+h+16)}
/* ghost ball: where the last pitch actually crossed the plate, held until the next pitch is released */
function drawGhost(now){
  const g=ghost,x=g.zx*ZW,y=ZC+g.zy*ZH,[cx,cy]=proj(x,y,ZZ),[ex]=proj(x+BALL_R,y,ZZ),r=Math.max(6,Math.abs(ex-cx));
  const a=cl((now-g.t)/180,0,1);hx.save();hx.globalAlpha=a;
  hx.fillStyle='rgba(0,0,0,.25)';hx.beginPath();hx.ellipse(cx+2,cy+3,r,r,0,0,7);hx.fill();
  const gr=hx.createRadialGradient(cx-r*.35,cy-r*.35,r*.1,cx,cy,r);gr.addColorStop(0,'rgba(255,255,255,.75)');gr.addColorStop(1,'rgba(235,232,220,.38)');
  hx.fillStyle=gr;hx.beginPath();hx.arc(cx,cy,r,0,7);hx.fill();
  hx.strokeStyle='rgba(200,50,42,.7)';hx.lineWidth=Math.max(1,r*.12);
  hx.beginPath();hx.arc(cx-r*1.15,cy,r*.85,-.75,.75);hx.stroke();hx.beginPath();hx.arc(cx+r*1.15,cy,r*.85,PI-.75,PI+.75);hx.stroke();
  hx.strokeStyle=g.strike?'rgba(244,191,58,.95)':'rgba(255,255,255,.9)';hx.lineWidth=1.5;hx.setLineDash([3,3]);hx.beginPath();hx.arc(cx,cy,r+3,0,7);hx.stroke();hx.setLineDash([]);
  const txt=g.strike?'STRIKE':'BALL',lx=cx+r+8;hx.font='800 11px "Barlow Semi Condensed",sans-serif';hx.textAlign='left';
  const tw=hx.measureText(txt).width+10;hx.fillStyle=g.strike?'rgba(244,191,58,.92)':'rgba(10,20,14,.82)';hx.beginPath();hx.roundRect?hx.roundRect(lx,cy-8,tw,16,8):hx.rect(lx,cy-8,tw,16);hx.fill();
  hx.fillStyle=g.strike?'#2a1c00':'#f3ecd9';hx.fillText(txt,lx+5,cy+4);hx.restore()}
/* clickable base targets while the user's team is in the field */
function drawBaseTargets(now){
  if(phase!=='field'||!PS||!PS.userFields)return;const P=PS,lab=['','1B','2B','3B','HOME'],pulse=.5+.5*Math.sin(now/140);
  const waiting=P.holder!=null&&!P.throwQ&&P.fielders[P.holder].task==='hold';
  const inbound=P.throwQ&&P.throwQ.b,mg=30,top=70,bot=VH-175;
  for(let b=1;b<=4;b++){const[x,z]=bagCenter(b);let[sx,sy,sz]=proj(x,.3,z);const off=sz>1||sx<mg||sx>VW-mg||sy<top||sy>bot;
    if(sz>1){sx=VW-sx;sy=bot}sx=cl(sx,mg,VW-mg);sy=cl(sy,top,bot);
    const r=off?20:24,sel=P.userTarget===b,go=inbound===b;baseHits.push({b,x:sx,y:sy,r});
    hx.save();
    if(waiting||sel||go){hx.strokeStyle=sel||go?'rgba(244,191,58,1)':`rgba(244,191,58,${.45+.5*pulse})`;hx.lineWidth=3;hx.beginPath();hx.arc(sx,sy,r+4+(waiting&&!sel?pulse*5:0),0,7);hx.stroke()}
    hx.fillStyle=sel||go?'rgba(244,191,58,.95)':'rgba(10,20,14,.72)';hx.strokeStyle='rgba(243,236,217,.9)';hx.lineWidth=2;hx.beginPath();hx.arc(sx,sy,r,0,7);hx.fill();hx.stroke();
    hx.font=`800 ${b===4?10:12}px "Barlow Semi Condensed",sans-serif`;hx.textAlign='center';hx.textBaseline='middle';hx.fillStyle=sel||go?'#2a1c00':'#f3ecd9';hx.fillText(lab[b],sx,sy+.5);
    if(off){const a=Math.atan2(sy-VH/2,sx-VW/2);hx.fillStyle='rgba(243,236,217,.9)';hx.beginPath();hx.moveTo(sx+Math.cos(a)*(r+10),sy+Math.sin(a)*(r+10));hx.lineTo(sx+Math.cos(a+.35)*(r+3),sy+Math.sin(a+.35)*(r+3));hx.lineTo(sx+Math.cos(a-.35)*(r+3),sy+Math.sin(a-.35)*(r+3));hx.fill()}
    hx.restore()}
  if(waiting){hx.save();hx.font='800 15px "Barlow Semi Condensed",sans-serif';hx.textAlign='center';const t='CLICK A BASE TO THROW',w=hx.measureText(t).width+28,y=86;
    hx.fillStyle='rgba(10,20,14,.82)';hx.beginPath();hx.roundRect?hx.roundRect(VW/2-w/2,y-15,w,30,15):hx.rect(VW/2-w/2,y-15,w,30);hx.fill();hx.strokeStyle=`rgba(244,191,58,${.5+.5*pulse})`;hx.lineWidth=2;hx.stroke();
    hx.fillStyle='#f4bf3a';hx.textBaseline='middle';hx.fillText(t,VW/2,y+1);hx.restore()}}
function drawTags(now){
  if(!S||camMode==='bat'||!(phase==='field'||phase==='steal'))return;
  hx.font='800 11px "Barlow Semi Condensed",sans-serif';hx.textAlign='center';
  const tag=(c,col,txt)=>{const p=rigs[c];if(!p||!p.root.visible)return;p.head.getWorldPosition(_w);const[x,y,z]=proj(_w.x,_w.y+1.05*p.root.scale.y,_w.z);if(z>1)return;
    const w=hx.measureText(txt).width+10;hx.fillStyle=col;hx.beginPath();hx.roundRect?hx.roundRect(x-w/2,y-14,w,15,7):hx.rect(x-w/2,y-14,w,15);hx.fill();hx.fillStyle='#fff';hx.fillText(txt,x,y-3)};
  if(PS){for(const r of PS.runners)if(r.state!=='out')tag(r.id,userBats()?'rgba(224,72,47,.92)':'rgba(61,123,224,.92)',CH[r.id].n);
    if(PS.userFields){const f=PS.fielders;const h=PS.holder!=null?PS.holder:PS.chaser;if(h!=null)tag(fieldTeam()[h],'rgba(244,191,58,.95)',POS[h]+' '+CH[fieldTeam()[h]].n)}}}

/* ================= MAIN LOOP ================= */
let last=0;
function frame(real){if(lastReal==null)lastReal=real;if(adaptRes&&!document.hidden)adaptRes.update((real-lastReal)/1000);vt+=(real-lastReal)*slow;lastReal=real;const now=vt;try{step(now)}catch(e){console.error(e)}requestAnimationFrame(frame)}
function step(now){
  const dt=Math.min(.05,(now-last)/1000);last=now;
  const due=timers.filter(t=>now>=t.t);if(due.length){timers=timers.filter(t=>now<t.t);due.forEach(t=>t.fn())}
  if(phase==='windup'&&now-wt>1300)launch(now);
  if(phase==='uwind'&&uwind&&now-uwind.t0>1300)userLaunch(now);
  if(phase==='pitch'&&pitch){const p=(now-pitch.t0)/pitch.dur;
    if(p>=1&&!pitch.ghosted&&(!pitch.swung||pitch.missed)){pitch.ghosted=1;ghost={zx:pitch.zx,zy:pitch.zy,strike:isStrike(pitch.zx,pitch.zy),t:now}}
    if(pitch.user&&pitch.cpu&&pitch.cpu.swing&&!pitch.swung&&p>=pitch.cpu.at)cpuSwingNow(now);
    if(phase==='pitch'&&p>1.06)called(now)}
  if(phase==='field'&&PS){const sub=4,h=dt/sub;let done=false;for(let i=0;i<sub&&!done;i++)done=liveTick(PS,h);if(done)finishLive(PS)}
  const b=ballTick(now);layout(now,dt,b);debrisTick(dt);camTick(dt,now,b);
  if(crowdMat){const u=crowdMat.userData.u;u.time.value=now/1000;u.cheer.value=lerp(u.cheer.value,now<cheerUntil?1:0,.08)}
  if(landRing.visible){const s=1+.15*Math.sin(now/120);landRing.scale.set(s,1,s)}
  if(post.on){renderer.setRenderTarget(post.rt);renderer.render(scene,camera);renderer.setRenderTarget(null);renderer.render(post.sc,post.cam)}else renderer.render(scene,camera);hudTick(now)}

/* ================= INPUT ================= */
const ray=new THREE.Raycaster(),ndc=new THREE.Vector2();let drag=null;
function zoneFromPointer(e){const r=cv.getBoundingClientRect();ndc.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(ndc,camera);
  const o=ray.ray.origin,d=ray.ray.direction;if(Math.abs(d.z)<1e-4)return null;const t=(ZZ-o.z)/d.z;return{x:cl((o.x+d.x*t)/ZW,-1.8,1.8),y:cl((o.y+d.y*t-ZC)/ZH,-1.8,1.8)}}
const target=()=>S&&!userBats()?aim:ret;
let tapStart=null;
cv.addEventListener('pointermove',e=>{if(camMode!=='bat'||!S)return;const T=target();if(!userBats()&&phase!=='uready'&&phase!=='uwind')return;
  if(e.pointerType==='mouse'){const z=zoneFromPointer(e);if(z){T.x=z.x;T.y=z.y}}
  else if(drag){const a=zoneFromPointer(drag.e0),b=zoneFromPointer(e);if(a&&b){T.x=cl(drag.rx+(b.x-a.x)*1.15,-1.8,1.8);T.y=cl(drag.ry+(b.y-a.y)*1.15,-1.8,1.8)}}});
cv.addEventListener('pointerdown',e=>{audio();if(!S)return;const T=target();
  if(phase==='field'&&PS&&PS.userFields){const b=pickBaseAt(e.clientX,e.clientY);if(b)userThrow(b);return}
  if(userBats()){if(phase==='pitch'){swing();return}}
  else if(phase==='uwind'){userPitchPress();return}
  if(e.pointerType==='mouse'){if(!userBats()&&phase==='uready')userPitchPress();return}
  tapStart={x:e.clientX,y:e.clientY,t:performance.now()};
  drag={e0:{clientX:e.clientX,clientY:e.clientY},rx:T.x,ry:T.y};try{cv.setPointerCapture(e.pointerId)}catch(_){}});
addEventListener('pointerup',e=>{drag=null;if(tapStart&&S&&!userBats()&&phase==='uready'){const m=Math.hypot(e.clientX-tapStart.x,e.clientY-tapStart.y);if(m<10&&performance.now()-tapStart.t<350)userPitchPress()}tapStart=null});
addEventListener('pointercancel',()=>{drag=null;tapStart=null});
function toggleSteal(b){if(!canSteal(b)||!(phase==='windup'||phase==='result'))return;stealArm[b]=!stealArm[b];
  if(stealArm[b]){if(b===2&&S.bases[1]>=0)stealArm[3]=true;if(b===3&&S.bases[2]>=0)stealArm[4]=true}else{if(b===4)stealArm[3]=stealArm[3]&&S.bases[2]<0;if(b===3)stealArm[2]=stealArm[2]&&S.bases[1]<0}
  btnUpdate();say(stealArm[b]?'Steal is on. Runner breaks with the pitch.':'Steal called off.')}
$('st2').onclick=()=>toggleSteal(2);$('st3').onclick=()=>toggleSteal(3);$('st4').onclick=()=>toggleSteal(4);
$('buntB').onclick=()=>{if(phase==='pitch'&&pitch&&pitch.swung)return;bunt=!bunt;if(pitch&&phase==='pitch')pitch.bunt=bunt;btnUpdate();say(bunt?'Squared to bunt.':'Swinging away.')};
$('viewB').onclick=$('viewB2').onclick=()=>{camStyle=1-camStyle;btnUpdate()};
document.querySelectorAll('#pitchActs [data-pt]').forEach(b=>b.onclick=()=>{if(phase!=='uready')return;ptype=+b.dataset.pt;btnUpdate()});
const BASE_NAME=['','first','second','third','home'];
function userThrow(b){
  const P=PS;if(!P||!P.userFields||phase!=='field'||!(b>=1&&b<=4))return;
  P.userTarget=b;P.pick={b,t:NOW()};
  if(P.holder!=null&&!P.throwQ){const h=P.fielders[P.holder];
    if(h.task==='hold'||h.task==='holdwait'||h.task==='tobase'){h.task='hold';decideThrow(P,P.holder);say('Throw to '+BASE_NAME[b]+'!');return}}
  say('Going to '+BASE_NAME[b]+' as soon as he gloves it.')}
// on-screen base targets for the user's defense (screen positions refreshed by the HUD each frame)
let baseHits=[];
function bagCenter(b){let[x,z]=BW(b%4);const bo=1.25*Math.max(.75,PK.B/90)*Math.SQRT1_2;if(b===1)x-=bo;if(b===3)x+=bo;if(b===4)z=ZZ;return[x,z]}
function pickBaseAt(cx,cy){
  let best=null,bd=1e9;for(const h of baseHits){const d=Math.hypot(h.x-cx,h.y-cy);if(d<bd){bd=d;best=h}}
  if(best&&bd<=Math.max(52,best.r+18))return best.b;
  // fall back to the ground point under the pointer: nearest bag within 14 ft
  const r=cv.getBoundingClientRect();ndc.set((cx-r.left)/r.width*2-1,-((cy-r.top)/r.height)*2+1);ray.setFromCamera(ndc,camera);
  const o=ray.ray.origin,d=ray.ray.direction;if(d.y>-1e-3)return 0;const t=-o.y/d.y,gx=o.x+d.x*t,gz=o.z+d.z*t;
  let b0=0,m=14*K;for(let b=1;b<=4;b++){const[x,z]=bagCenter(b);const dd=Math.hypot(gx-x,gz-z);if(dd<m){m=dd;b0=b}}return b0}
$('mute').onclick=()=>{muted=!muted;$('mute').textContent=muted?'Sound off':'Sound on'};
$('quit').onclick=()=>{$('simB').hidden=!S||userBats();$('menu').hidden=false};$('resume').onclick=()=>{$('menu').hidden=true};
$('simB').onclick=()=>simHalf();
$('toTitle').onclick=()=>{$('menu').hidden=true;showTitle()};
addEventListener('keydown',e=>{if(phase==='title'||!S)return;const k=e.key.toLowerCase();
  if(e.code==='Space'){e.preventDefault();swing()}
  else if(!userBats()&&phase==='field'&&'1234h'.includes(k)){userThrow(k==='h'?4:+k)}
  else if(!userBats()&&phase==='uready'&&'1234'.includes(k)){ptype=+k-1;btnUpdate()}
  else if(k==='2')toggleSteal(2);else if(k==='3')toggleSteal(3);else if(k==='h')toggleSteal(4);else if(k==='b')$('buntB').click();else if(k==='v')$('viewB').click();
  else if(e.key.startsWith('Arrow')){const T=target(),s=.15;if(k==='arrowleft')T.x-=s;if(k==='arrowright')T.x+=s;if(k==='arrowup')T.y+=s;if(k==='arrowdown')T.y-=s;T.x=cl(T.x,-1.8,1.8);T.y=cl(T.y,-1.8,1.8)}});

/* ================= TITLE / DRAFT ================= */
let pick=[];let parkIx=+(store.get('ss3dPark')||0)||0;let diffIx=1;
try{const sv=JSON.parse(store.get('ss3dTeam')||'[]');if(Array.isArray(sv)&&sv.length===9&&sv.every(i=>CH[i]))pick=sv}catch(e){}
function renderRoster(){
  $('roster').innerHTML=CH.map(c=>`<button class="card${pick.includes(c.i)?' sel':''}" data-i="${c.i}" aria-pressed="${pick.includes(c.i)}"><span class="no">${pick.indexOf(c.i)>=0?["P","C","1B","2B","SS","3B","LF","CF","RF"][pick.indexOf(c.i)]:""}</span><img src="${c.src}" alt="" loading="lazy"><span class="nm">${c.n}</span><span class="rl">${c.r}</span><span class="bars"><span>PWR</span><span class="bar"><i style="width:${c.p*20}%"></i></span><span>CON</span><span class="bar"><i style="width:${c.c*20}%"></i></span><span>SPD</span><span class="bar"><i style="width:${c.s*20}%"></i></span></span></button>`).join('');
  $('pickCount').textContent=pick.length+' of 9 · order sets batting and positions (1 pitches, 2 catches, then 1B, 2B, SS, 3B, LF, CF, RF)';const ok=pick.length===9;$('play').disabled=!ok;$('play').textContent=ok?'Play ball':`Pick ${9-pick.length} more`}
$('roster').addEventListener('click',e=>{const b=e.target.closest('.card');if(!b)return;const i=+b.dataset.i;const k=pick.indexOf(i);if(k>=0)pick.splice(k,1);else if(pick.length<9)pick.push(i);renderRoster()});
$('auto').onclick=()=>{const pool=CH.map(c=>c.i).filter(i=>!pick.includes(i)).sort(()=>Math.random()-.5);while(pick.length<9)pick.push(pool.pop());
  // speed at top, power in the middle
  pick.sort((a,b)=>0);renderRoster()};
$('clr').onclick=()=>{pick=[];renderRoster()};
function renderParks(){$('parks').innerHTML=PARKS.map((p,i)=>`<button class="park pk${i}${i===parkIx?' sel':''}" data-i="${i}" aria-pressed="${i===parkIx}"><b>${p.name}</b><span>${p.desc}</span></button>`).join('')}
$('parks').addEventListener('click',e=>{const b=e.target.closest('.park');if(!b)return;parkIx=+b.dataset.i;store.set('ss3dPark',parkIx);renderParks();buildWorld(PARKS[parkIx])});
function seg(id,opts,cur,fn){const el=$(id);el.querySelectorAll('button').forEach(b=>b.remove());opts.forEach((o,i)=>{const b=document.createElement('button');b.textContent=o;b.className=i===cur?'on':'';b.onclick=()=>{fn(i);seg(id,opts,i,fn)};el.appendChild(b)})}
seg('diffSeg',DIFF.map(d=>d.n),diffIx,i=>diffIx=i);
seg('innSeg',['3','6','9'],0,i=>INN=[3,6,9][i]);
$('play').onclick=()=>{audio();if(pick.length<9)return;team=pick.slice();store.set('ss3dTeam',JSON.stringify(team));
  cpuTeam=CH.map(c=>c.i).filter(i=>!team.includes(i)).sort(()=>Math.random()-.5).slice(0,9);D=DIFF[diffIx];
  if(PK!==PARKS[parkIx])buildWorld(PARKS[parkIx]);newGame();banner('Play Ball!',PK.name,true);sfx.cheer(false)};
$('again').onclick=()=>{cpuTeam=CH.map(c=>c.i).filter(i=>!team.includes(i)).sort(()=>Math.random()-.5).slice(0,9);newGame();banner('Play Ball!',PK.name,true)};
$('redraft').onclick=showTitle;
function showTitle(){phase='title';timers=[];S=null;PS=null;pitch=null;stealRun=null;camMode='orbit';say('');
  ['bug','batter','ctrl','final','inning','menu'].forEach(id=>$(id).hidden=true);$('title').hidden=false;renderRoster();renderParks();drawBoard();
  Object.values(rigs).forEach(r=>r.root.visible=false)}

/* ================= BOOT ================= */
resize();buildWorld(PARKS[parkIx]);showTitle();
setTimeout(()=>{$('load').remove()},250);
requestAnimationFrame(frame);
window.__ss={set slow(v){slow=v},PLAYER_LOOK,UNIFORMS,setUniform,setLook:(i,patch)=>rigs[i]?rigs[i].setLook(patch):Object.assign(PLAYER_LOOK[i],patch),get baseHits(){return baseHits},get ghost(){return ghost},userThrow,get now(){return vt},rigs,get team(){return team},get cpuTeam(){return cpuTeam},get wt(){return wt},get phase(){return phase},get S(){return S},get PS(){return PS},get pitch(){return pitch},get stealRun(){return stealRun},
  swing,setRet:(x,y)=>{ret.x=x;ret.y=y},setAim:(x,y)=>{aim.x=x;aim.y=y},cam:m=>{camMode=m},dbgCam:(p,l)=>{dbg.p.set(...p);dbg.l.set(...l);camMode='debug'},
  test:{tick:(n=1,h=1/120)=>{for(let i=0;i<n&&PS;i++){if(liveTick(PS,h)){const P=PS;timers=[];finishLive(P);timers=[];return {done:1,lp:window.__lastPlay}}}return PS?{t:PS.t,holder:PS.holder,await:PS.awaitThrow,tq:PS.throwQ&&PS.throwQ.b}:null},stealCheck:(spdv,dur)=>{const L=52;return{atPlate:+runDist(dur/1000+-STEAL_JUMP,spdv).toFixed(1),runnerArrive:+(STEAL_JUMP+runTime(L,spdv)).toFixed(2),ballArrive:+(dur/1000+.55+88/80+.15).toFixed(2)}},runSync:(ev,la,th,bases,outs)=>{const tm=batTeam();S.bases=bases.map((x,i)=>x?tm[(i+4)%9]:-1);S.outs=outs;S.b=S.s=0;timers=[];pitch=null;stealRun=null;startLive(ev,la,th,false,NOW());let n=0;while(PS&&n++<4000){if(liveTick(PS,1/120)){const P=PS;finishLive(P);break}}timers=[];const lp=window.__lastPlay;return{t:lp.t.toFixed(1),outs:S.outs,bases:S.bases.map(x=>x>=0?1:0),runs:[S.runs,S.cpu],desc:document.getElementById('ticker').textContent,ev:lp.events.map(e=>e.how)}},startLive:(ev,la,th)=>{if(pitch)pitch.swung=true;startLive(ev,la,th,false,NOW())},setBases:b=>{S.bases=b;hudUpdate()},toggleSteal,setOuts:o=>{S.outs=o;hudUpdate()},halfOver,setHalf:h=>{S.half=h;hudUpdate()},userPitchPress,stealD,runTime}};
})();
