
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NUM_FONTS, NUM_STYLES, NUM_PRESETS, NUM_SPOTS, NUM_FONT_IDS, NUM_STYLE_IDS, numFontOf, numFontReady, loadNumFont, drawNumberArt, drawNumberPreview, numberCapped, numberSize, buildNumberMeshes, makeNumberTexture, makeNumberMaterial } from '../shorttrack-numbers.js';
import { buildPrisonSet, buildPrisonInfield, PRISON_CROWD, PRISON_STANDS } from '../prison-speedway.js';
import { batchStatic } from '../../_shared/static-batch.js';
import { ICONIC_FIELD, ICONIC, drawSchemeSide, drawSchemeHood } from '../iconic-schemes.js';
import { createAdaptiveResolution } from '../../_shared/adaptive-resolution.js';
import { loadCustomCars, customGeo, customCarEntries, customCarReady, ensureCustomCar, buildCustomCar, mountCustomNumbers, repaintCustomCar, vehicleGarage } from '../custom-cars.js';
import { carIdOf, numberSpot, carGarage } from '../shared/CustomCars';
import { boundsOf, parseRegions, STOCK_BOUNDS } from '../shared/carRepaint';
import { spoilerTriangles } from '../shared/carClear';
import { buildLiveryGeo, fitDecal, planAtlas, upsamplePlan, applyAtlas, wrapContext } from '../shared/liveryWrap';
import { sanitizeScheme, schemeForPainters } from '../shared/PaintScheme';
import { initPaintDesigner } from '../paint-designer.js';
import { initTrackTest } from '../track-test.js';
import { TRACKS, AI_LEVELS, trackIdOf } from '../next/sim/config';
import { createCar } from '../next/sim/car';
import { TM } from '../truck-model.js';
import { PROTOCOL_VERSION, ROOM_PREFIX, helloAccepted, VERSION_MISMATCH, PHYSICS_MISMATCH } from '../next/net/protocol';
import { place as simPlace, resetCar as simResetCar } from '../next/sim/physics';
import { createWorld, standings as simStandings, simulate as simSimulate, raceControl, updateBoosts, beginRace as simBeginRace, buildGrid, formV, forgetFormV } from '../next/sim/race';

// ===================== UTILS =====================
const TAU=Math.PI*2, clamp=(v,a,b)=>v<a?a:v>b?b:v, lerp=(a,b,t)=>a+(b-a)*t, mod=(a,n)=>((a%n)+n)%n, smooth=t=>t*t*(3-2*t);
const wrapA=a=>{while(a>Math.PI)a-=TAU;while(a<-Math.PI)a+=TAU;return a;};
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function rng(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const SIM={rand:Math.random,now:()=>performance.now()/1000,frozen:false};   // sim randomness and clock; the reference recorder (record.js) seeds and steps them
const store={get(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}};
const _v=new THREE.Vector3(),_n=new THREE.Vector3(),_f=new THREE.Vector3(),_x=new THREE.Vector3(),_m=new THREE.Matrix4(),_o=new THREE.Object3D();

// ===================== TRACK =====================
// The track list, tuning and track math live in sim/ (config.ts, track.ts); one simulation world per page.
const TRACK_ID=trackIdOf(new URLSearchParams(location.search).get('track')),TRACK=TRACKS[TRACK_ID];
// The next engine (Babylon on WebGPU, next/sim/dynamics.ts physics) is the default; ?engine=classic keeps the three.js
// renderer and the classic vehicle model for one release, and &physics=classic keeps only the classic model.
const Q0=new URLSearchParams(location.search),ENGINE=Q0.get('engine')==='classic'?'classic':'next',PHYSICS=ENGINE==='next'&&Q0.get('physics')!=='classic'?'next':'classic';
const WORLD=createWorld(TRACK,()=>SIM.rand(),()=>SIM.now(),PHYSICS),CFG=WORLD.cfg,TR=WORLD.track,DIRT=TR.dirt;
const L=CFG.L,R=CFG.R,W=CFG.W,AP=CFG.APRON,HW=W/2;
const TURN=TR.TURN, P=TR.P, S_LINE=TR.S_LINE, T1=TR.T1, T2=TR.T2;
const center=s=>TR.center(s),toTrack=(x,z)=>TR.toTrack(x,z),bankAt=s=>TR.bankAt(s),grooveLat=s=>TR.grooveLat(s),heightAt=(s,lat)=>TR.heightAt(s,lat);
const LINE_MAX=TR.LINE_MAX;let GROOVE_MAT=null;
function normalAt(s,lat,out){
  // true surface normal from the height field, so cars pitch smoothly through the banking transition
  const c0=center(s),c1=center(s+1),c2=center(s-1),l1=lat+0.5,l2=lat-0.5;
  const ax=c1.x+c1.nx*lat-(c2.x+c2.nx*lat),ay=heightAt(s+1,lat)-heightAt(s-1,lat),az=c1.z+c1.nz*lat-(c2.z+c2.nz*lat);
  const bx=c0.nx,by=heightAt(s,l1)-heightAt(s,l2),bz=c0.nz;
  out.set(by*az-bz*ay,bz*ax-bx*az,bx*ay-by*ax).normalize();if(out.y<0)out.negate();return out;
}

// ===================== RENDERER / SCENE =====================
const wrap=$('wrap'), canvas=$('c');
// The next engine draws this same three.js scene with Babylon on WebGPU (WebGL2 fallback): next/render/presenter.ts.
// If Babylon cannot start at all, the classic three.js renderer draws it instead.
// The renderer, composer and bloom below become stand-ins that the presenter reads each frame.
const GPU=ENGINE==='next'?await import('../next/render/presenter').then(m=>m.createPresenter(canvas)).catch(e=>{console.warn('Next renderer unavailable, using the classic renderer',e);return null;}):null;
const renderer=GPU?{outputColorSpace:'',toneMapping:0,toneMappingExposure:1,autoClear:true,shadowMap:{enabled:true,type:0,autoUpdate:false,needsUpdate:false},
  setPixelRatio:r=>GPU.setPixelRatio(r),getPixelRatio:()=>GPU.getPixelRatio(),setSize:()=>GPU.resize(),setRenderTarget(){},render(){},clearDepth(){}}
  :new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.outputColorSpace=THREE.SRGBColorSpace; renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled=true; renderer.shadowMap.type=THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate=false;
const scene=new THREE.Scene();
scene.fog = new THREE.Fog(0x9a8570, 8000, 15000);
const camera=new THREE.PerspectiveCamera(45,1,0.1,2000);
const pmrem=GPU?{fromScene:()=>({texture:new THREE.Texture()})}:new THREE.PMREMGenerator(renderer);
// ---- SUMMER DAY LOOK: tweak these to taste ----
const DAY={
  sunDir:[78,64,34],        // lower afternoon sun (~37 deg up): longer shadows, warmer light
  sunColor:0xffd49a, sunInt:3.1,
  hemiSky:0xbcd4ff, hemiGround:0x6b5530, hemiInt:0.32, // cool sky fill + warm ground bounce = summer contrast
  envInt:0.5, paintEnv:0.6, // sky reflection strength (was 1.0: this is what washed everything out)
  exposure:0.36,
  fogColor:0xe6cfa4, fogNear:420, fogFar:2300,          // warm golden haze on the horizon
  turbidity:7.0, rayleigh:1.7, mie:0.0045, mieG:0.86,    // deeper blue up high, warm glow near the sun
  cloudTint:0xfff0d8, cloudOpacity:0.42
};
const SUN_OFF=new THREE.Vector3(...DAY.sunDir);
// physically based daytime sky (also used to build the reflection map for paint)
function makeSky(scale){const sk=new Sky();sk.scale.setScalar(scale);const u=sk.material.uniforms;
  u.turbidity.value=DAY.turbidity;u.rayleigh.value=DAY.rayleigh;u.mieCoefficient.value=DAY.mie;u.mieDirectionalG.value=DAY.mieG;u.sunPosition.value.copy(SUN_OFF).normalize();return sk;} // 2. Heavily jacked up turbidity and rayleigh scattering to force deep azure skies and vibrant golden horizons
const skyDay=makeSky(2200);scene.add(skyDay);
const envNight=pmrem.fromScene(new RoomEnvironment(),0.04).texture;
const envDay=(()=>{const es=new THREE.Scene();es.add(makeSky(900));const gnd=new THREE.Mesh(new THREE.CircleGeometry(800,32).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:0x4f5a2c}));gnd.position.y=-5;es.add(gnd);
  const rt=pmrem.fromScene(es,0.02);return rt.texture;})();
let envTex=envDay,ENVK=.15;
scene.environment=envDay;
const hemi=new THREE.HemisphereLight(0xff9a29, 0x402f1a, 0.15); scene.add(hemi);
const sun=new THREE.DirectionalLight(0xfaba66,.8); sun.castShadow=true; sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-55,right:55,top:55,bottom:-55,near:1,far:340}); sun.shadow.bias=-0.0004; sun.shadow.normalBias=0.03;
scene.add(sun,sun.target);
// post-processing: subtle bloom by day, glowing lights at night
const composer=GPU?{addPass(){},render(){},setPixelRatio(){},setSize(){}}:new EffectComposer(renderer,new THREE.WebGLRenderTarget(16,16,{type:THREE.HalfFloatType,samples:4}));
composer.addPass(new RenderPass(scene,camera));

// ⚡ TWEAKED VALUES: Strength dropped from 0.10 to 0.01, Threshold raised from 0.88 to 1.00
const bloom=GPU?{enabled:false,strength:0.02,radius:0.25,threshold:0.8}:new UnrealBloomPass(new THREE.Vector2(16,16),0.02,0.25,.80);composer.addPass(bloom);composer.addPass(new OutputPass());
let useComposer=true;

// ===================== TEXTURES =====================
function canvasTex(w,h,draw,repeat){
  const c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');draw(g,w,h);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=8;
  if(repeat){t.wrapS=t.wrapT=THREE.RepeatWrapping;} return t;
}
function noiseFill(g,w,h,base,amt,n){
  g.fillStyle=base;g.fillRect(0,0,w,h);
  for(let i=0;i<n;i++){const v=Math.random()-0.5;g.fillStyle=v>0?`rgba(255,255,255,${v*amt})`:`rgba(0,0,0,${-v*amt})`;g.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*2,1+Math.random()*2);}
}
function rr(g,x,y,w,h,r){g.beginPath();g.moveTo(x+r,y);g.arcTo(x+w,y,x+w,y+h,r);g.arcTo(x+w,y+h,x,y+h,r);g.arcTo(x,y+h,x,y,r);g.arcTo(x,y,x+w,y,r);g.closePath();}
const TEX={};
TEX.asphalt=canvasTex(512,512,(g,w,h)=>{
  noiseFill(g,w,h,'#2b2b2a',0.3,26000);
  const gr=g.createLinearGradient(0,0,w,0);
  gr.addColorStop(0.06,'rgba(0,0,0,0)');gr.addColorStop(0.1,'rgba(0,0,0,.3)');gr.addColorStop(0.25,'rgba(0,0,0,.22)');gr.addColorStop(0.40,'rgba(0,0,0,0)');
  g.fillStyle=gr;g.fillRect(0,0,w,h);
},true);
TEX.concrete=canvasTex(256,256,(g,w,h)=>noiseFill(g,w,h,'#8e9196',0.25,9000),true);
TEX.grass=canvasTex(512,512,(g,w,h)=>{noiseFill(g,w,h,'#4a7d26',0.3,30000);for(let i=0;i<8;i++){g.fillStyle=i%2?'rgba(255,255,255,.05)':'rgba(0,0,0,.06)';g.fillRect(i*w/8,0,w/8,h);}},true);
TEX.grass.repeat.set(90,90);
TEX.wall=canvasTex(1024,128,(g,w,h)=>{
  g.fillStyle='#e9ecef';g.fillRect(0,0,w,h);
  const ads=[['TORQUE','#d62828','#ffffff'],['OVAL OIL','#1d3557','#ffd60a'],['GRIP','#111111','#2ec46d'],['FASTLANE','#f77f00','#111111']];
  g.textAlign='center';g.textBaseline='middle';
  ads.forEach((a,i)=>{const x=i*w/4+18,bw=w/4-36;g.fillStyle=a[1];g.fillRect(x,22,bw,72);g.fillStyle=a[2];g.font='900 44px Arial Black,Impact,sans-serif';g.fillText(a[0],x+bw/2,60,bw-20);});
  g.fillStyle='rgba(0,0,0,.25)';for(let i=0;i<40;i++)g.fillRect(Math.random()*w,h-12-Math.random()*16,40+Math.random()*90,2+Math.random()*4);
  g.fillStyle='rgba(40,40,45,.55)';for(let i=0;i<=8;i++)g.fillRect(i*w/8-1,0,2,h);
  for(let i=0;i<120;i++){g.fillStyle=`rgba(${Math.random()<0.5?'20,20,20':'200,60,40'},${0.05+Math.random()*0.12})`;g.fillRect(Math.random()*w,20+Math.random()*(h-30),20+Math.random()*120,1+Math.random()*3);}
},true);
TEX.fence=canvasTex(64,64,(g,w,h)=>{g.strokeStyle='rgba(200,205,210,.95)';g.lineWidth=2;g.beginPath();g.moveTo(0,0);g.lineTo(w,h);g.moveTo(w,0);g.lineTo(0,h);g.stroke();},true);
TEX.fence.repeat.set(1,5);
TEX.checker=canvasTex(256,32,(g)=>{for(let i=0;i<16;i++)for(let j=0;j<2;j++){g.fillStyle=(i+j)%2?'#111':'#f4f4f4';g.fillRect(i*16,j*16,16,16);}});
const smokeTex=canvasTex(64,64,(g)=>{const gr=g.createRadialGradient(32,32,2,32,32,30);gr.addColorStop(0,'rgba(255,255,255,.9)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);});
const glowTex=canvasTex(64,64,(g)=>{const gr=g.createRadialGradient(32,32,0,32,32,32);gr.addColorStop(0,'rgba(255,255,240,1)');gr.addColorStop(0.3,'rgba(255,250,220,.5)');gr.addColorStop(1,'rgba(255,250,220,0)');g.fillStyle=gr;g.fillRect(0,0,64,64);});
const tireSideTex=canvasTex(128,128,(g)=>{
  g.fillStyle='#161616';g.fillRect(0,0,128,128);g.fillStyle='#202020';g.beginPath();g.arc(64,64,62,0,TAU);g.fill();
  g.fillStyle='#9aa0a6';g.beginPath();g.arc(64,64,34,0,TAU);g.fill();g.fillStyle='#4d535a';
  for(let i=0;i<5;i++){const a=i/5*TAU;g.beginPath();g.arc(64+Math.cos(a)*14,64+Math.sin(a)*14,4,0,TAU);g.fill();}
  g.fillStyle='#ececec';g.font='bold 11px Arial';g.textAlign='center';g.textBaseline='middle';
  const txt='RACING SLICK  R-34  ',n=txt.length*2;
  for(let i=0;i<n;i++){const a=i/n*TAU;g.save();g.translate(64+Math.cos(a)*48,64+Math.sin(a)*48);g.rotate(a+Math.PI/2);g.fillText(txt[i%txt.length],0,0);g.restore();}
});
tireSideTex.userData.shared=true;
function skyTex(stops){return canvasTex(4,256,(g,w,h)=>{const gr=g.createLinearGradient(0,0,0,h);stops.forEach(([o,c])=>gr.addColorStop(o,c));g.fillStyle=gr;g.fillRect(0,0,w,h);});}
const SKY_DAY=skyTex([[0,'#3d7fd6'],[0.42,'#8fbbe8'],[0.5,'#dbe7f2'],[1,'#dbe7f2']]);
const SKY_NIGHT=canvasTex(2048,1024,(g,w,h)=>{const gr=g.createLinearGradient(0,0,0,h);[[0,'#02040a'],[0.42,'#0b1328'],[0.5,'#26305a'],[1,'#1c2340']].forEach(([o,c])=>gr.addColorStop(o,c));
  g.fillStyle=gr;g.fillRect(0,0,w,h);for(let i=0;i<2600;i++){const y=Math.random()**1.6*h*0.47,a=Math.random();g.fillStyle=`rgba(255,255,${220+Math.random()*35|0},${a*0.9})`;g.fillRect(Math.random()*w,y,a>0.93?2:1,a>0.93?2:1);}});
const sky=new THREE.Mesh(new THREE.SphereGeometry(1400,48,24),new THREE.MeshBasicMaterial({map:SKY_NIGHT,side:THREE.BackSide,fog:false,depthWrite:false}));
sky.visible=false;scene.add(sky);
// cloud deck
const cloudTex=canvasTex(1024,1024,(g,w,h)=>{g.clearRect(0,0,w,h);for(let i=0;i<70;i++){const x=Math.random()*w,y=Math.random()*h,r=20+Math.random()*90;
  for(let k=0;k<5;k++){const cx=x+(Math.random()-0.5)*r*1.6,cy=y+(Math.random()-0.5)*r*0.6,rr2=r*(0.5+Math.random()*0.6);const gr=g.createRadialGradient(cx,cy,0,cx,cy,rr2);
    gr.addColorStop(0,'rgba(255,255,255,.22)');gr.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=gr;g.fillRect(cx-rr2,cy-rr2,rr2*2,rr2*2);}}},true);
cloudTex.repeat.set(3,3);
const clouds=new THREE.Mesh(new THREE.PlaneGeometry(5000,5000).rotateX(Math.PI/2),new THREE.MeshBasicMaterial({map:cloudTex,transparent:true,depthWrite:false,fog:false,opacity:0.5,alphaMap:canvasTex(256,256,(g,w,h)=>{const gr=g.createRadialGradient(128,128,0,128,128,128);gr.addColorStop(0,'#fff');gr.addColorStop(0.35,'#fff');gr.addColorStop(0.7,'#000');gr.addColorStop(1,'#000');g.fillStyle=gr;g.fillRect(0,0,w,h);})}));
clouds.position.y=420;scene.add(clouds);
TEX.asphaltBump=canvasTex(512,512,(g,w,h)=>noiseFill(g,w,h,'#808080',0.9,60000),true);

// ---- realistic procedural surfaces: aggregate asphalt with a rubbered groove, slab concrete, mown turf, matching normal maps ----
function tileNoise(W,H,seed,octs){const r=rng(seed),out=new Float32Array(W*H);
  for(const [cell,amp] of octs){const gw=Math.max(1,W/cell|0),gh=Math.max(1,H/cell|0),g=new Float32Array(gw*gh);for(let i=0;i<g.length;i++)g[i]=r();
    for(let y=0;y<H;y++){const fy=y/cell,iy=Math.floor(fy)%gh,iy2=(iy+1)%gh,ty=fy-Math.floor(fy),sy=ty*ty*(3-2*ty);
      for(let x=0;x<W;x++){const fx=x/cell,ix=Math.floor(fx)%gw,ix2=(ix+1)%gw,tx=fx-Math.floor(fx),sx=tx*tx*(3-2*tx);
        const a=g[iy*gw+ix],b=g[iy*gw+ix2],c=g[iy2*gw+ix],d=g[iy2*gw+ix2],top=a+(b-a)*sx,bot=c+(d-c)*sx;out[y*W+x]+=amp*(top+(bot-top)*sy);}}}
  return out;}
function pixelTex(W,H,fn,srgb){const c=document.createElement('canvas');c.width=W;c.height=H;const g=c.getContext('2d'),im=g.createImageData(W,H),d=im.data;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,v=fn(x,y);d[i]=v[0];d[i+1]=v[1];d[i+2]=v[2];d[i+3]=255;}
  g.putImageData(im,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=16;if(srgb)t.colorSpace=THREE.SRGBColorSpace;return t;}
function normalTex(h,W,H,k){return pixelTex(W,H,(x,y)=>{const l=h[y*W+(x-1+W)%W],r=h[y*W+(x+1)%W],u=h[((y-1+H)%H)*W+x],dn=h[((y+1)%H)*W+x];
  const nx=(l-r)*k,ny=(u-dn)*k,inv=1/Math.hypot(nx,ny,1);return [(nx*inv*0.5+0.5)*255,(ny*inv*0.5+0.5)*255,(inv*0.5+0.5)*255];},false);}
const band=(u,a,b,f)=>clamp(Math.min((u-a)/f,(b-u)/f),0,1);
{
  const N=1024,agg=tileNoise(N,N,11,[[128,0.3],[32,0.25],[8,0.25],[2,0.2]]),hr=rng(5),stones=new Float32Array(N*N);for(let i=0;i<N*N;i++)stones[i]=hr();
  const streak=tileNoise(N,1,23,[[6,0.6],[2,0.4]]),patch=tileNoise(N,N,31,[[256,1]]);
  const asphalt=(x,y,groove)=>{const u=x/N;let v=52+agg[y*N+x]*30;const st=stones[y*N+x];if(st>0.982)v+=30*(st-0.982)/0.018;else if(st<0.01)v-=14;
    if(groove){if(u>0.9&&st>0.6&&st<0.66)v-=22;
      if(Math.abs(u-0.5)<0.0018)v-=14;v+=(patch[y*N+x]>0.72?5:patch[y*N+x]<0.22?-4:0);}
    return [v-2,v-1,v+1];};
  TEX.asphalt=pixelTex(N,N,(x,y)=>asphalt(x,y,true),true);
  TEX.asphaltPlain=pixelTex(512,512,(x,y)=>asphalt(x*2,y*2,false),true);
  TEX.asphaltRough=pixelTex(N,N,(x,y)=>{const g=235-(stones[y*N+x]>0.982?40:0);return [0,g,0];},false);
  const M=512,bump=tileNoise(M,M,17,[[16,0.35],[4,0.35],[1,0.3]]);
  TEX.asphaltNormal=normalTex(bump,M,M,2.2);
  const cAgg=tileNoise(512,512,41,[[64,0.4],[8,0.3],[2,0.3]]),cr=rng(3);
  TEX.concrete=pixelTex(512,512,(x,y)=>{let v=138+cAgg[y*512+x]*26-(cr()<0.02?10:0);if(x%256<3||y%256<3)v-=46;if(Math.abs(cAgg[y*512+x]-0.55)<0.01)v-=12;return [v-2,v,v+3];},true);
  TEX.concreteNormal=normalTex(tileNoise(256,256,43,[[8,0.5],[2,0.5]]),256,256,1.6);
  const gN=tileNoise(N,N,51,[[64,0.35],[8,0.3],[2,0.35]]),gr2=rng(9);
  TEX.grass=pixelTex(N,N,(x,y)=>{const n=gN[y*N+x],blade=gr2(),stripe=(Math.floor(x/(N/8))%2)?8:-6;return [46+n*32+blade*14+stripe*0.4,98+n*44+blade*24+stripe,24+n*14+blade*6];},true);
  TEX.grass.repeat.set(90,90);
  TEX.grassNormal=normalTex(tileNoise(256,256,53,[[4,0.5],[1,0.5]]),256,256,3);TEX.grassNormal.repeat.set(900,900);
  if(TRACK.surface==='dirt'){
    const dN=tileNoise(N,N,71,[[128,0.35],[32,0.3],[8,0.2],[2,0.15]]),rut=tileNoise(N,1,73,[[3,0.6],[1,0.4]]),cl=rng(8),clod=new Float32Array(N*N);for(let i=0;i<N*N;i++)clod[i]=cl();
    TEX.asphalt=pixelTex(N,N,(x,y)=>{const u=x/N,n=dN[y*N+x],dry=smooth(clamp((u-0.55)/0.4,0,1)),rv=(rut[x]-0.5)*14*(1-dry*0.6),k=clod[y*N+x];
      let r=104+n*34+dry*34+rv,g=72+n*26+dry*26+rv*0.8,b=50+n*18+dry*18+rv*0.6;if(k>0.985){r-=26;g-=20;b-=14;}else if(k<0.008){r+=22;g+=18;b+=12;}return [r,g,b];},true);
    TEX.asphaltRough=pixelTex(64,64,()=>[0,255,0],false);
    TEX.asphaltNormal=normalTex(tileNoise(512,512,75,[[32,0.35],[6,0.35],[1,0.3]]),512,512,3.2);
    TEX.concrete=pixelTex(512,512,(x,y)=>{const n=dN[(y*2%N)*N+(x*2%N)];return [84+n*30,62+n*22,44+n*16];},true);
    TEX.concreteNormal=TEX.asphaltNormal;
  }
}

// ===================== TRACK GEOMETRY =====================
function ribbon(fa,fb,s0,s1,segs,rep,mode){
  const n=segs+1,pos=new Float32Array(n*6),uv=new Float32Array(n*4),idx=[];
  for(let i=0;i<n;i++){
    const s=s0+(s1-s0)*i/segs;pos.set(fa(s),i*6);pos.set(fb(s),i*6+3);const v=(s-s0)/rep;
    if(mode==='along'){uv[i*4]=v;uv[i*4+1]=0;uv[i*4+2]=v;uv[i*4+3]=1;}else{uv[i*4]=0;uv[i*4+1]=v;uv[i*4+2]=1;uv[i*4+3]=v;}
    if(i<segs){const k=i*2;idx.push(k,k+1,k+2,k+1,k+3,k+2);}
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();return g;
}
function addMesh(geo,mat,rs=true){const m=new THREE.Mesh(geo,mat);m.receiveShadow=rs;scene.add(m);return m;}
const pt=(lat,yo=0)=>s=>{const c=center(s);return [c.x+c.nx*lat,heightAt(s,lat)+yo,c.z+c.nz*lat];};
const ptY=(lat,yf)=>s=>{const c=center(s);return [c.x+c.nx*lat,yf(s),c.z+c.nz*lat];};
const wallTop=s=>heightAt(s,HW)+1.25;
const SEG=720, DS=THREE.DoubleSide;
const lineMat=c=>new THREE.MeshStandardMaterial({color:c,roughness:.7,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
addMesh(ribbon(pt(-HW),pt(HW),0,P,SEG,10,'across'),new THREE.MeshStandardMaterial({map:TEX.asphalt,roughnessMap:TEX.asphaltRough,roughness:1,normalMap:TEX.asphaltNormal,normalScale:new THREE.Vector2(0.8,0.8),envMapIntensity:0.6}));
addMesh(ribbon(pt(-HW-AP),pt(-HW),0,P,SEG,6,'across'),new THREE.MeshStandardMaterial({map:TEX.concrete,normalMap:TEX.concreteNormal,normalScale:new THREE.Vector2(0.5,0.5),roughness:.9}));
addMesh(ribbon(pt(-HW+0.15,0.015),pt(-HW+0.45,0.015),0,P,SEG,10,'across'),lineMat(0xf2c200));
addMesh(ribbon(pt(HW-0.6,0.015),pt(HW-0.35,0.015),0,P,SEG,10,'across'),lineMat(0xf0f0f0));
addMesh(ribbon(pt(-HW,0.025),pt(HW,0.025),S_LINE-0.7,S_LINE+0.7,2,1.4,'across'),new THREE.MeshStandardMaterial({map:TEX.checker,roughness:.6,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2}));
{const gp=new THREE.Mesh(new THREE.PlaneGeometry(2800,2800).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({map:TEX.grass,normalMap:TEX.grassNormal,normalScale:new THREE.Vector2(0.6,0.6),roughness:1}));gp.position.y=-0.06;gp.receiveShadow=true;scene.add(gp);}
const wallMat=new THREE.MeshStandardMaterial({map:TEX.wall,roughness:.7,side:DS});
addMesh(ribbon(ptY(HW+0.15,()=>0),ptY(HW+0.15,wallTop),0,P,SEG,-24,'along'),wallMat);
addMesh(ribbon(ptY(HW+0.15,wallTop),ptY(HW+3,wallTop),0,P,360,6,'across'),new THREE.MeshStandardMaterial({map:TEX.concrete,roughness:.95,side:DS}));
addMesh(ribbon(ptY(HW+0.25,wallTop),ptY(HW+0.25,s=>wallTop(s)+4.5),0,P,SEG,-0.9,'along'),new THREE.MeshStandardMaterial({map:TEX.fence,transparent:true,alphaTest:0.3,side:DS,roughness:.5,metalness:.4}),false);
addMesh(ribbon(ptY(-HW-AP-0.15,()=>0),ptY(-HW-AP-0.15,()=>1.0),0,P,SEG,24,'along'),new THREE.MeshStandardMaterial({color:0xe6e8ea,roughness:.8,side:DS}));
function trackTube(lat,yf,r,mat){const pts=[];for(let i=0;i<480;i++){const s2=i/480*P,c=center(s2);pts.push(new THREE.Vector3(c.x+c.nx*lat,yf(s2),c.z+c.nz*lat));}
  const m=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts,true),1200,r,10,true),mat);m.receiveShadow=true;scene.add(m);return m;}
{const steel=new THREE.MeshStandardMaterial({color:0xe9ecef,metalness:.35,roughness:.45});
 for(const dy of [0.35,0.7,1.05])trackTube(HW+0.08,s2=>heightAt(s2,HW)+dy,0.07,steel);
 const cable=new THREE.MeshStandardMaterial({color:0x6d7278,metalness:.8,roughness:.4});
 for(const dy of [1.6,2.9,4.3])trackTube(HW+0.32,s2=>wallTop(s2)+dy,0.012,cable);}
{const GW=256,GH=1024,c=document.createElement('canvas');c.width=GW;c.height=GH;const g=c.getContext('2d'),im=g.createImageData(GW,GH),d=im.data;
 const nz=tileNoise(GW,GH,61,[[64,0.4],[8,0.3],[2,0.3]]),col=tileNoise(GW,1,62,[[4,0.6],[1,0.4]]);
 for(let y=0;y<GH;y++)for(let x=0;x<GW;x++){const u=x/GW,base=band(u,0.04,0.96,0.2),lane=Math.max(band(u,0.22,0.39,0.06),band(u,0.61,0.78,0.06));
   const e=Math.abs(u-0.5)*2,fade=1-smooth(clamp((e-0.25)/0.75,0,1)),edgeN=0.85+0.3*nz[((y*7)%GH)*GW+x];
   const a=(fade*fade*0.5*edgeN+lane*fade*0.12)*(0.75+0.25*nz[y*GW+x])*(0.9+0.2*col[x]),i=(y*GW+x)*4;if(DIRT){d[i]=38;d[i+1]=24;d[i+2]=16;d[i+3]=Math.min(255,a*1.25*255);}else{d[i]=12;d[i+1]=12;d[i+2]=14;d[i+3]=Math.min(255,a*255);}}
 g.putImageData(im,0,0);const t=new THREE.CanvasTexture(c);t.wrapS=t.wrapT=THREE.RepeatWrapping;t.anisotropy=16;t.colorSpace=THREE.SRGBColorSpace;
 const gm=new THREE.MeshStandardMaterial({map:t,transparent:true,depthWrite:false,roughness:DIRT?0.95:0.55,metalness:0,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
 addMesh(ribbon(s2=>pt(Math.max(-HW,grooveLat(s2)-3.3),0.008)(s2),s2=>pt(Math.min(HW-0.2,grooveLat(s2)+3.3),0.008)(s2),0,P,SEG,14,'across'),gm);GROOVE_MAT=gm;}
// grandstands wrap the whole bowl
const ROWS=16;
const sY=k=>s=>wallTop(s)+0.75*(k+1);
const PRISON=TRACK.theme==='prison';
const treadA=new THREE.MeshStandardMaterial({color:PRISON?PRISON_STANDS.treadA:0x2f4a78,roughness:.8,side:DS}),treadB=new THREE.MeshStandardMaterial({color:PRISON?PRISON_STANDS.treadB:0x7a2f35,roughness:.8,side:DS}),riserMat=new THREE.MeshStandardMaterial({color:PRISON?PRISON_STANDS.riser:0x8b9097,roughness:.9,side:DS});
for(let k=0;k<ROWS;k++){
  const la=HW+3+k*1.1,lb=la+1.1;
  addMesh(ribbon(ptY(la,sY(k)),ptY(lb,sY(k)),0,P,360,10,'across'),k%4<2?treadA:treadB);
  addMesh(ribbon(ptY(la,s=>sY(k)(s)-0.75),ptY(la,sY(k)),0,P,360,10,'across'),riserMat);
}
const backLat=HW+3+ROWS*1.1;
addMesh(ribbon(ptY(backLat,()=>0),ptY(backLat,s=>sY(ROWS-1)(s)+3),0,P,360,10,'across'),riserMat);
// ---- crowd: seated fans built from torso+arms, head, legs and caps; they stand and cheer via a vertex shader ----
const crowdU={uTime:{value:0},uLift:{value:0.6}};
function crowdMat(){const m=new THREE.MeshStandardMaterial({roughness:.85});
  m.userData.crowd=crowdU;   // ?engine=next re-creates this cheer with a Babylon material plugin (next/render/surface.ts)
  m.onBeforeCompile=sh=>{sh.uniforms.uTime=crowdU.uTime;sh.uniforms.uLift=crowdU.uLift;
    sh.vertexShader='uniform float uTime;uniform float uLift;\n'+sh.vertexShader.replace('#include <begin_vertex>',`#include <begin_vertex>
      float cid=float(gl_InstanceID);float ph=fract(sin(cid*12.9898)*43758.5453);
      float cheer=step(1.0-0.45*uLift,ph)*max(0.0,sin(uTime*(2.2+ph*3.0)+ph*40.0));
      transformed.y+=cheer*0.2;transformed.x+=sin(uTime*1.3+ph*20.0)*0.015;`);};
  return m;}
const crowdParts=[];
function buildCrowd(n){
  crowdParts.forEach(m=>{scene.remove(m);m.geometry.dispose();m.material.dispose();});crowdParts.length=0;
  const upper=mergeGeometries([new THREE.CylinderGeometry(0.16,0.19,0.5,10).translate(0,0.6,0),new THREE.BoxGeometry(0.09,0.42,0.09).translate(0.23,0.58,0.04),new THREE.BoxGeometry(0.09,0.42,0.09).translate(-0.23,0.58,0.04)]);
  const head=mergeGeometries([new THREE.SphereGeometry(0.11,12,10).translate(0,0.98,0),new THREE.CylinderGeometry(0.05,0.06,0.08,8).translate(0,0.87,0)]);
  const legs=mergeGeometries([new THREE.BoxGeometry(0.13,0.13,0.42).translate(0.08,0.36,0.17),new THREE.BoxGeometry(0.13,0.13,0.42).translate(-0.08,0.36,0.17),
    new THREE.BoxGeometry(0.12,0.36,0.12).translate(0.08,0.15,0.36),new THREE.BoxGeometry(0.12,0.36,0.12).translate(-0.08,0.15,0.36)]);
  const cap=mergeGeometries([new THREE.SphereGeometry(0.118,12,6,0,TAU,0,Math.PI/2).translate(0,1.0,0),new THREE.CylinderGeometry(0.09,0.09,0.015,10).scale(1,1,1.3).translate(0,1.0,0.1)]);
  const mk=g=>{const im=new THREE.InstancedMesh(g,crowdMat(),n);im.frustumCulled=false;crowdParts.push(im);scene.add(im);return im;};
  const U=mk(upper),H=mk(head),Lg=mk(legs),C=mk(cap);
  const r=rng(7),col=new THREE.Color();
  const shirts=['#e63946','#f1faee','#a8dadc','#457b9d','#1d3557','#ffb703','#fb8500','#2a9d8f','#e9c46a','#222222','#6a4c93','#ffffff','#d62828','#3a86ff','#8338ec','#ff006e','#06d6a0','#ffd166'];
  const skins=['#f1c27d','#e0ac69','#c68642','#8d5524','#ffdbac','#a1665e','#5c3a21'];
  const pants=['#1f2a44','#2b2b2b','#3d405b','#4a4e69','#5e503f','#2f3e46','#6b705c'];
  if(PRISON){shirts.splice(0,shirts.length,...PRISON_CROWD.shirts);pants.splice(0,pants.length,...PRISON_CROWD.pants);}
  const caps=PRISON?PRISON_CROWD.caps:shirts,capChance=PRISON?PRISON_CROWD.capChance:0.4;
  const seats=[];for(let k=0;k<ROWS;k++){for(let s=0.3;s<P;s+=0.62)seats.push([k,s]);}
  const prob=Math.min(1,n/seats.length);let i=0;
  for(const [k,s] of seats){if(i>=n)break;if(r()>prob)continue;
    const lat=HW+3+k*1.1+0.42+(r()-0.5)*0.06,c=center(s+(r()-0.5)*0.12);
    _o.position.set(c.x+c.nx*lat,sY(k)(s),c.z+c.nz*lat);_o.rotation.set(0,Math.atan2(-c.nx,-c.nz)+(r()-0.5)*0.4,0);const sc=0.9+r()*0.2;_o.scale.set(sc,sc,sc);_o.updateMatrix();
    for(const m of [U,H,Lg,C])m.setMatrixAt(i,_o.matrix);
    U.setColorAt(i,col.set(shirts[Math.floor(r()*shirts.length)]));H.setColorAt(i,col.set(skins[Math.floor(r()*skins.length)]));
    Lg.setColorAt(i,col.set(pants[Math.floor(r()*pants.length)]));
    if(r()<capChance)C.setColorAt(i,col.set(caps[Math.floor(r()*caps.length)]));else{C.setColorAt(i,col.set(0,0,0));}
    i++;}
  for(const m of [U,H,Lg,C]){m.count=i;m.instanceMatrix.needsUpdate=true;m.instanceColor.needsUpdate=true;}
  // fans without caps get their cap shrunk to nothing
  for(let j=0;j<i;j++){C.getColorAt(j,col);if(col.r+col.g+col.b===0){C.getMatrixAt(j,_m);_m.scale(_v.set(0.001,0.001,0.001));C.setMatrixAt(j,_m);}}
  C.instanceMatrix.needsUpdate=true;
}
// fence posts, trees, distant hills, pit road, garages, haulers, press box and scoring pylon
{
  const postMat=new THREE.MeshStandardMaterial({color:0x9aa0a6,metalness:.7,roughness:.35});
  const n=Math.floor(P/4),posts=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06,0.06,4.6,6).translate(0,2.3,0),postMat,n);posts.frustumCulled=false;
  for(let i=0;i<n;i++){const s=i*4,c=center(s);_o.position.set(c.x+c.nx*(HW+0.3),wallTop(s),c.z+c.nz*(HW+0.3));_o.rotation.set(0,0,0);_o.scale.set(1,1,1);_o.updateMatrix();posts.setMatrixAt(i,_o.matrix);}
  scene.add(posts);
  addMesh(ribbon(ptY(HW+0.3,s=>wallTop(s)+4.55),ptY(HW+0.3,s=>wallTop(s)+4.6),0,P,SEG,10,'across'),postMat,false);
  // inner pit-wall cap
  addMesh(ribbon(ptY(-HW-AP-0.35,()=>1.0),ptY(-HW-AP+0.05,()=>1.0),0,P,SEG,6,'across'),new THREE.MeshStandardMaterial({color:0xd8dadc,roughness:.8,side:DS}));
}
const SMALL_INFIELD=R<50,PIT0=-HW-AP-0.4,PIT1=-HW-AP-(SMALL_INFIELD?10:13.5);
if(!TRACK.bareInfield){ // pit road on the front stretch, with stall lines and a team wall
  const pitMat=new THREE.MeshStandardMaterial({map:TEX.asphaltPlain,normalMap:TEX.asphaltNormal,normalScale:new THREE.Vector2(0.7,0.7),roughness:.92});
  addMesh(ribbon(ptY(PIT1,()=>0.01),ptY(PIT0,()=>0.01),-20,L+20,80,10,'across'),pitMat);
  const lm=lineMat(0xffffff);
  for(let s=0;s<=L;s+=7.5)addMesh(ribbon(ptY(PIT1+0.5,()=>0.03),ptY(PIT0-6,()=>0.03),s-0.08,s+0.08,1,1,'across'),lm);
  addMesh(ribbon(ptY(PIT0-6.1,()=>0.03),ptY(PIT0-5.9,()=>0.03),-20,L+20,20,10,'across'),lineMat(0xffcc00));
  addMesh(ribbon(ptY(PIT1-0.2,()=>0),ptY(PIT1-0.2,()=>0.9),-20,L+20,20,24,'along'),new THREE.MeshStandardMaterial({color:0xcfd2d6,roughness:.8,side:DS}));
  // garages
  const garMat=new THREE.MeshStandardMaterial({color:0xb9bec5,roughness:.7}),doorMat=new THREE.MeshStandardMaterial({color:0x3a3f47,roughness:.5,metalness:.4});
  for(let i=0;i<(SMALL_INFIELD?0:9);i++){const s=10+i*18,c=center(s),lat=PIT1-9;const b=new THREE.Mesh(new THREE.BoxGeometry(16,4.5,9),garMat);b.position.set(c.x+c.nx*lat,2.25,c.z+c.nz*lat);b.castShadow=b.receiveShadow=true;scene.add(b);
    for(let d=-1;d<=1;d++){const door=new THREE.Mesh(new THREE.PlaneGeometry(4,3.2),doorMat);door.position.set(c.x+c.nx*(lat+4.51)+d*5,1.6,c.z+c.nz*(lat+4.51));door.rotation.y=Math.atan2(c.nx,c.nz);scene.add(door);}}
  // team haulers
  if(!PRISON){
  const PALX=['#d7263d','#1b998b','#2e86de','#f9c80e','#f86624','#662e9b','#141414','#f4f4f4','#43bccd','#0b6e4f','#ff6f91','#1d3557'];
  const hr=rng(42),nh=SMALL_INFIELD?7:40,trl=new THREE.InstancedMesh(new THREE.BoxGeometry(2.6,4,15).translate(0,2.4,0),new THREE.MeshStandardMaterial({roughness:.4,metalness:.3}),nh),
    cab=new THREE.InstancedMesh(new THREE.BoxGeometry(2.5,3.2,3).translate(0,1.9,9.3),new THREE.MeshStandardMaterial({roughness:.35,metalness:.5}),nh),
    whl=new THREE.InstancedMesh(new THREE.BoxGeometry(2.7,1,13).translate(0,0.5,1.5),new THREE.MeshStandardMaterial({color:0x151515}),nh),tc=new THREE.Color();
  for(let i=0;i<nh;i++){const x=SMALL_INFIELD?-54+i*18:-78+(i%20)*8.2,z=SMALL_INFIELD?-6:i<20?-12:12;_o.position.set(x,0,z);_o.rotation.set(0,SMALL_INFIELD?Math.PI/2:i<20?0:Math.PI,0);_o.scale.set(1,1,1);_o.updateMatrix();
    for(const m of [trl,cab,whl])m.setMatrixAt(i,_o.matrix);tc.set(PALX[Math.floor(hr()*PALX.length)]);trl.setColorAt(i,tc);cab.setColorAt(i,tc.multiplyScalar(0.7));}
  for(const m of [trl,cab,whl]){m.castShadow=true;m.receiveShadow=true;m.frustumCulled=false;scene.add(m);}
  }
}
// press box / suites on top of the front-stretch grandstand
const glassMat=new THREE.MeshStandardMaterial({color:0x1b2a3a,roughness:.08,metalness:.9,emissive:0xffe6b0,emissiveIntensity:0});
{const lat=backLat+3.5,c=center(S_LINE),y0=sY(ROWS-1)(S_LINE)+3;
 const box=new THREE.Mesh(new THREE.BoxGeometry(Math.min(150,L-12),9,7),[new THREE.MeshStandardMaterial({color:0xcfd4da}),new THREE.MeshStandardMaterial({color:0xcfd4da}),new THREE.MeshStandardMaterial({color:0x8a9099}),new THREE.MeshStandardMaterial({color:0x666b73}),new THREE.MeshStandardMaterial({color:0xcfd4da}),glassMat]);
 box.position.set(c.x+c.nx*lat,y0+4.5,c.z+c.nz*lat);box.castShadow=true;scene.add(box);
 const roof=new THREE.Mesh(new THREE.BoxGeometry(Math.min(156,L-6),0.6,10),new THREE.MeshStandardMaterial({color:PRISON?0x30343a:0x1d3557}));roof.position.set(box.position.x,y0+9.3,box.position.z-1);scene.add(roof);
 for(let i=-6;i<=6;i++){if(Math.abs(i*12)>(Math.min(150,L-12))/2-2)continue;const col=new THREE.Mesh(new THREE.BoxGeometry(0.6,y0,0.6),new THREE.MeshStandardMaterial({color:0x7d838b}));col.position.set(box.position.x+i*12,y0/2,box.position.z+2.5);scene.add(col);}}
// scoring pylon in the infield
const pylonCanvas=document.createElement('canvas');pylonCanvas.width=256;pylonCanvas.height=1024;
const pylonTex=new THREE.CanvasTexture(pylonCanvas);pylonTex.colorSpace=THREE.SRGBColorSpace;pylonTex.anisotropy=8;
const pylonMat=new THREE.MeshStandardMaterial({map:pylonTex,emissive:0xffffff,emissiveMap:pylonTex,emissiveIntensity:0.9,roughness:.6});
{const fr=new THREE.MeshStandardMaterial({color:0x1d1f24,metalness:.6,roughness:.4});
 const py=new THREE.Mesh(new THREE.BoxGeometry(5,20,1.6),[fr,fr,fr,fr,pylonMat,pylonMat]);py.position.set(0,14,0);py.castShadow=true;
 const base=new THREE.Mesh(new THREE.CylinderGeometry(0.8,1.2,4,10),fr);base.position.set(0,2,0);if(!TRACK.bareInfield)scene.add(py,base);}
function drawPylon(list){const g=pylonCanvas.getContext('2d'),w=256,h=1024;g.fillStyle='#07090d';g.fillRect(0,0,w,h);
  g.fillStyle='#ffcc00';g.font='900 46px Arial Black,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('POS',w/2,40);
  (list||[]).slice(0,10).forEach((c,i)=>{const y=100+i*92;g.fillStyle=c.lv.primary;g.fillRect(28,y,200,78);g.fillStyle=c.lv.numColor;g.font='900 64px Arial Black,sans-serif';
    g.strokeStyle=c.lv.numOutline;g.lineWidth=5;g.strokeText(c.lv.number,w/2,y+41);g.fillText(c.lv.number,w/2,y+41);});pylonTex.needsUpdate=true;}
drawPylon([]);
// trees and distant hills
const treeParts=[];
function buildTrees(n){
  treeParts.forEach(m=>{scene.remove(m);m.geometry.dispose();m.material.dispose();});treeParts.length=0;
  const foliage=mergeGeometries([new THREE.ConeGeometry(3.2,7,8).translate(0,6,0),new THREE.ConeGeometry(2.5,5.5,8).translate(0,9,0),new THREE.ConeGeometry(1.7,4,8).translate(0,11.6,0)]);
  const F=new THREE.InstancedMesh(foliage,new THREE.MeshStandardMaterial({roughness:.9,flatShading:true}),n),T=new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3,0.45,3,6).translate(0,1.5,0),new THREE.MeshStandardMaterial({color:0x5a3d22,roughness:1}),n);
  const r=rng(99),col=new THREE.Color();
  for(let i=0;i<n;i++){const s=r()*P,lat=backLat+16+r()*150,c=center(s),sc=0.7+r()*0.9;_o.position.set(c.x+c.nx*lat,0,c.z+c.nz*lat);_o.rotation.set(0,r()*TAU,0);_o.scale.set(sc,sc*(0.8+r()*0.5),sc);_o.updateMatrix();
    F.setMatrixAt(i,_o.matrix);T.setMatrixAt(i,_o.matrix);F.setColorAt(i,col.setHSL(0.25+r()*0.08,0.45+r()*0.2,0.18+r()*0.12));}
  for(const m of [F,T]){m.castShadow=true;m.frustumCulled=false;scene.add(m);treeParts.push(m);}
}
{const g=new THREE.CylinderGeometry(850,850,160,160,4,true),p=g.attributes.position;
 for(let i=0;i<p.count;i++){const y=p.getY(i);if(y>-80){const a=Math.atan2(p.getZ(i),p.getX(i));p.setY(i,-80+(y+80)*(0.25+0.5*Math.abs(Math.sin(a*3)*Math.cos(a*7+1))+0.25*Math.sin(a*13)**2));}}
 g.computeVertexNormals();const hills=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x4f6b4a,roughness:1,side:THREE.BackSide}));hills.position.y=70;scene.add(hills);}
// light towers
const towers=[],towerHeadMat=new THREE.MeshStandardMaterial({color:0x222222,emissive:0xffffff,emissiveIntensity:0.15});
{const poleMat=new THREE.MeshStandardMaterial({color:0x777d85,metalness:.6,roughness:.4});
 for(let i=0;i<10;i++){
  const s=i*P/10+8,c=center(s),lat=backLat+5,x=c.x+c.nx*lat,z=c.z+c.nz*lat;
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.7,46,8),poleMat);pole.position.set(x,23,z);scene.add(pole);
  const head=new THREE.Mesh(new THREE.BoxGeometry(8,4,0.8),towerHeadMat);head.position.set(x,46,z);head.rotation.y=Math.atan2(-c.nx,-c.nz);scene.add(head);
  const gl=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:0xfff6e0,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true}));
  gl.scale.set(28,28,1);gl.position.set(x-c.nx*1,46,z-c.nz*1);gl.visible=false;scene.add(gl);towers.push(gl);
 }}
const prisonInfield=PRISON?buildPrisonInfield({scene,glowTex,lights:towers,halfLength:L/2}):null;
if(PRISON)buildPrisonSet({scene,center,P,L,S_LINE,backLat,standTop:s=>sY(ROWS-1)(s)+3,fenceLat:HW+0.3,fenceTop:s=>wallTop(s)+4.6,glowTex,glassMat,lights:towers});
// flag stand over the start/finish line
const flagMat=new THREE.MeshBasicMaterial({color:0xffcc00,side:DS});
{const c=center(S_LINE),fy=wallTop(S_LINE),bx=c.x+c.nx*(HW+0.8),bz=c.z+c.nz*(HW+0.8);
 const pole=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,7,8),new THREE.MeshStandardMaterial({color:0x999999}));pole.position.set(bx,fy+3.5,bz);scene.add(pole);
 const booth=new THREE.Mesh(new THREE.BoxGeometry(2.6,1.4,2.2),new THREE.MeshStandardMaterial({color:0x1d3557}));booth.position.set(bx-c.nx*0.8,fy+7.4,bz-c.nz*0.8);scene.add(booth);
 const flag=new THREE.Mesh(new THREE.PlaneGeometry(1.5,1.0),flagMat);flag.position.set(bx-c.nx*2.2,fy+6.4,bz-c.nz*2.2);flag.rotation.y=Math.PI/2;scene.add(flag);}

const BATCH=new URLSearchParams(location.search).get('batch')!=='0';
if(BATCH)batchStatic(scene,[sky,skyDay,clouds]);

// ===================== EFFECTS =====================
const MARKS=DIRT?14000:7000;
const markMesh=new THREE.InstancedMesh(new THREE.PlaneGeometry(0.3,0.9).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:DIRT?0x2a1a10:0x080808,transparent:true,opacity:DIRT?0.42:0.255,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}),MARKS);
markMesh.count=0;markMesh.frustumCulled=false;scene.add(markMesh);let markIdx=0,markTotal=0;setTimeout(()=>{if(!DIRT)seedMarks(420);},0);
function addMark(c,len=0.9){
  for(const sx of [TRK_HALF,-TRK_HALF]){
    _v.set(sx,0.02,TRK_REAR).applyMatrix4(c.m.root.matrixWorld);_o.position.copy(_v);_o.quaternion.copy(c.m.root.quaternion);_o.scale.set(1,1,len/0.9);_o.updateMatrix();
    markMesh.setMatrixAt(markIdx,_o.matrix);markIdx=(markIdx+1)%MARKS;markTotal=Math.min(MARKS,markTotal+1);
  }
  markMesh.count=markTotal;markMesh.instanceMatrix.needsUpdate=true;
}
// Solid skid marks: each rear tire lays a strip joined to where it was last frame, so the mark is unbroken.
const SKID_SEG=0.5;
function skidMark(c){
  if(!c.skid)c.skid=[null,null];
  [TRK_HALF,-TRK_HALF].forEach((sx,k)=>{
    _v.set(sx,0.02,TRK_REAR).applyMatrix4(c.m.root.matrixWorld);const prev=c.skid[k];
    if(!prev){c.skid[k]=_v.clone();return;}
    const dx=_v.x-prev.x,dz=_v.z-prev.z,dist=Math.hypot(dx,dz);
    if(dist>6){prev.copy(_v);return;}if(dist<SKID_SEG)return;
    const mx=(prev.x+_v.x)/2,mz=(prev.z+_v.z)/2,tp=toTrack(mx,mz),nrm=normalAt(tp.s,tp.lat,_n);
    _f.set(dx,0,dz);_f.addScaledVector(nrm,-_f.dot(nrm)).normalize();_x.crossVectors(nrm,_f);_m.makeBasis(_x,nrm,_f);
    _o.quaternion.setFromRotationMatrix(_m);_o.position.set(mx,(prev.y+_v.y)/2,mz);_o.scale.set(1,1,(dist+0.04)/0.9);_o.updateMatrix();
    markMesh.setMatrixAt(markIdx,_o.matrix);markIdx=(markIdx+1)%MARKS;markTotal=Math.min(MARKS,markTotal+1);prev.copy(_v);});
  markMesh.count=markTotal;markMesh.instanceMatrix.needsUpdate=true;
}
const WEAR={c:document.createElement('canvas'),t:0,up:0,dirty:false};WEAR.c.width=128;WEAR.c.height=4096;WEAR.g=WEAR.c.getContext('2d');
WEAR.tex=new THREE.CanvasTexture(WEAR.c);WEAR.tex.colorSpace=THREE.SRGBColorSpace;WEAR.tex.anisotropy=8;
if(!DIRT)addMesh(ribbon(pt(-HW,0.006),pt(HW,0.006),0,P,SEG,P,'across'),new THREE.MeshStandardMaterial({map:WEAR.tex,transparent:true,depthWrite:false,roughness:0.6,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1}));
function clearWear(){WEAR.g.clearRect(0,0,WEAR.c.width,WEAR.c.height);WEAR.tex.needsUpdate=true;}
// Rubber build-up: every tire pass darkens the surface under it by WEAR_PASS (1%). Passes stack all race.
// Purely visual: nothing in the physics reads this layer, so grip and speed are unaffected.
const WEAR_PASS=0.01,WEAR_TIRE=0.32*CFG.carScale;
function stampWear(c){const g=WEAR.g,cw=WEAR.c.width,ch=WEAR.c.height,y=(1-mod(c.tp.s,P)/P)*ch;
  if(!c.wearPt)c.wearPt=[null,null];
  g.strokeStyle=`rgba(12,12,14,${WEAR_PASS})`;g.lineWidth=Math.max(1,WEAR_TIRE/W*cw);g.lineCap='butt';
  [-0.84,0.84].forEach((off,k)=>{const lat=c.tp.lat+off*CFG.carScale,x=(lat+HW)/W*cw,p0=c.wearPt[k];
    if(p0&&Math.abs(y-p0.y)<0.5&&Math.abs(x-p0.x)<0.5)return;           // hasn't moved a pixel yet: wait, so a spot isn't darkened twice
    c.wearPt[k]={x,y};
    if(!p0||Math.abs(y-p0.y)>ch/2||lat<-HW||lat>HW)return;              // first point, or wrapped past the start of the texture
    g.beginPath();g.moveTo(p0.x,p0.y);g.lineTo(x,y);g.stroke();});
  WEAR.dirty=true;}
function updateWear(dt){if(DIRT)return;WEAR.t+=dt;WEAR.up+=dt;
  if(WEAR.t>=0.03){WEAR.t=0;cars.forEach(c=>{if(c.vis&&c.speed>3)stampWear(c);else c.wearPt=null;});}
  if(WEAR.dirty&&WEAR.up>=0.5){WEAR.up=0;WEAR.dirty=false;WEAR.tex.needsUpdate=true;}}
function resetMarks(){markIdx=0;markTotal=0;markMesh.count=0;clearWear();if(!DIRT)seedMarks(420);}
function seedMarks(n){const r=rng(77);
  for(let i=0;i<n;i++){const turn=r()<0.5?T1:T2,s2=turn-20+r()*(TURN+40),lat=clamp(grooveLat(s2)+(r()-0.5)*3.4,-HW+1,HW-1.5),c=center(s2),nrm=normalAt(s2,lat,_n),len=0.6+r()*2.4;
    _f.set(c.tx,0,c.tz);const yaw=(r()-0.5)*0.35;_f.applyAxisAngle(_v.set(0,1,0),yaw);_f.addScaledVector(nrm,-_f.dot(nrm)).normalize();_x.crossVectors(nrm,_f);_m.makeBasis(_x,nrm,_f);
    _o.quaternion.setFromRotationMatrix(_m);_o.position.set(c.x+c.nx*lat,heightAt(s2,lat)+0.02,c.z+c.nz*lat);_o.scale.set(0.8+r()*0.6,1,len);_o.updateMatrix();
    markMesh.setMatrixAt(markIdx,_o.matrix);markIdx=(markIdx+1)%MARKS;markTotal=Math.min(MARKS,markTotal+1);}
  markMesh.count=markTotal;markMesh.instanceMatrix.needsUpdate=true;}
const SPN=500,spPos=new Float32Array(SPN*3),spCol=new Float32Array(SPN*3),spVel=new Float32Array(SPN*3),spLife=new Float32Array(SPN);
const spGeo=new THREE.BufferGeometry();spGeo.setAttribute('position',new THREE.BufferAttribute(spPos,3));spGeo.setAttribute('color',new THREE.BufferAttribute(spCol,3));
const sparks=new THREE.Points(spGeo,new THREE.PointsMaterial({size:0.22,vertexColors:true,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false}));
sparks.frustumCulled=false;scene.add(sparks);let spI=0;
function spawnSparks(x,y,z,n,vx,vz){for(let k=0;k<n;k++){const i=spI;spI=(spI+1)%SPN;spPos[i*3]=x;spPos[i*3+1]=y;spPos[i*3+2]=z;spVel[i*3]=vx*0.6+(Math.random()-0.5)*8;spVel[i*3+1]=Math.random()*5;spVel[i*3+2]=vz*0.6+(Math.random()-0.5)*8;spLife[i]=0.3+Math.random()*0.5;}}
function updSparks(dt){
  for(let i=0;i<SPN;i++){
    if(spLife[i]<=0){spCol[i*3]=spCol[i*3+1]=spCol[i*3+2]=0;continue;}
    spLife[i]-=dt;spVel[i*3+1]-=12*dt;spPos[i*3]+=spVel[i*3]*dt;spPos[i*3+1]+=spVel[i*3+1]*dt;spPos[i*3+2]+=spVel[i*3+2]*dt;
    const l=Math.max(0,spLife[i])*2;spCol[i*3]=l;spCol[i*3+1]=0.6*l;spCol[i*3+2]=0.15*l;
  }
  spGeo.attributes.position.needsUpdate=true;spGeo.attributes.color.needsUpdate=true;
}
const SMN=100,smoke=[];let smI=0;
for(let i=0;i<SMN;i++){const s=new THREE.Sprite(new THREE.SpriteMaterial({map:smokeTex,transparent:true,depthWrite:false,opacity:0}));s.visible=false;scene.add(s);smoke.push({s,life:0,max:1,vx:0,vy:0,vz:0,size:1,op:0.4});}
function spawnSmoke(x,y,z,vx,vz,dark,size,tint){const p=smoke[smI];smI=(smI+1)%SMN;p.s.position.set(x,y,z);p.vx=vx*0.3+(Math.random()-0.5);p.vz=vz*0.3+(Math.random()-0.5);p.vy=0.8+Math.random();p.life=p.max=1.1+Math.random()*0.8;p.size=size;p.op=dark?0.55:0.38;p.s.material.color.set(tint??(dark?0x2a2a2a:0xdadada));p.s.visible=true;}
function updSmoke(dt){for(const p of smoke){if(p.life<=0){p.s.visible=false;continue;}p.life-=dt;const k=1-p.life/p.max;p.s.position.x+=p.vx*dt;p.s.position.y+=p.vy*dt;p.s.position.z+=p.vz*dt;const sc=p.size*(1+k*3);p.s.scale.set(sc,sc,1);p.s.material.opacity=p.op*(1-k);}}

// ===================== LIVERIES =====================
const PATTERNS=['solid','stripes','twotone','flames','panels','fade','rainbow'];
const PATTERN_NAMES={custom:'AI design',solid:'Solid',stripes:'Racing stripes',twotone:'Two-tone split',flames:'Flames',panels:'Door panels',fade:'Gradient fade',rainbow:'Rainbow'};
// The AI field: every car runs a look-alike of the iconic NASCAR scheme its number is known for
// (iconic-schemes.js: parody names, knockoff logos). lv.scheme names the scheme; the side/hood/atlas painters draw it.
// lv.custom is an AI-designed scheme (shared/PaintScheme.ts, paint-designer.js), worn while lv.pattern is 'custom'.
// FIELD_DESIGNS: the AI field's schemes as recreated by the AI paint designer (admin, /api/shorttrack-paint?field=1),
// keyed by scheme id; a car whose scheme has one wears it instead of the hand-made iconic scheme.
const FIELD_DESIGNS={};
function schemeOf(lv){if(lv.pace)return null;if(lv.pattern==='custom'&&lv.custom)return schemeForPainters(lv.custom);
  if(lv.scheme&&FIELD_DESIGNS[lv.scheme])return schemeForPainters(FIELD_DESIGNS[lv.scheme]);return lv.scheme&&ICONIC[lv.scheme]||null;}
fetch('/api/shorttrack-paint?field=1',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(d=>{
  for(const [k,v] of Object.entries(d&&d.designs||{})){const sc=ICONIC[k]&&sanitizeScheme(v);if(sc)FIELD_DESIGNS[k]=sc;}}).catch(()=>{});
const AI_FIELD=ICONIC_FIELD.map(f=>({name:f.name,number:f.number,primary:f.primary,secondary:f.secondary,accent:f.accent,pattern:'solid',
  numStyle:'block',numFont:'classic',numSlant:!!f.num.slant,numSize:125,numColor:f.num.fill,numOutline:f.num.outline,numAccent:f.num.accent,
  numDoors:true,numRoof:true,numTail:true,scheme:f.scheme}));
const RAINBOW=['#e4252b','#f7931e','#ffd400','#2bb24c','#1b75bc','#7b3fa0'];
function rainbowBands(g,x0,x1,y0,y1){const dy=(y1-y0)/RAINBOW.length;RAINBOW.forEach((c,i)=>{g.fillStyle=c;g.fillRect(x0,y0+i*dy,x1-x0,dy*1.03);});}

const NAMES=['Rusty Vance','Cole Hargrove','Dale Brenner','Jimmy Ashcroft','Tony Kessler','Bobby Lorne','Ricky Dalton','Cal Whitaker','Ward Pruitt','Ned Calloway','Sonny Reyes','Hank Tolliver','Jody Marsh','Kyle Benning','Luke Garrity','Marty Fenn','Dusty Shaw','Ray Corwin','Wes Halloran','Tate Morrow'];
const PAL=['#d7263d','#1b998b','#2e86de','#f9c80e','#f86624','#662e9b','#141414','#f4f4f4','#43bccd','#0b6e4f','#ff6f91','#c0c0c0','#1d3557','#e9c46a','#8ac926','#ff9f1c'];
const HEX=/^#[0-9a-f]{6}$/i;
const DEFAULT_LV={name:'Player',number:'7',primary:'#d7263d',secondary:'#141414',accent:'#f9c80e',pattern:'stripes',numStyle:'block',numFont:'classic',numSlant:true,numSize:125,numColor:'#ffffff',numOutline:'#141414',numAccent:'#f9c80e',numDoors:true,numRoof:true,numTail:true,veh:'truck'};
const PACE_LV={name:'Pace Car',number:'',primary:'#f4f4f4',secondary:'#141414',accent:'#ffb000',pattern:'stripes',numStyle:'block',numColor:'#111111',numOutline:'#ffffff',pace:true};
function hexLum(h){const n=parseInt(h.slice(1),16);return(0.299*(n>>16&255)+0.587*(n>>8&255)+0.114*(n&255))/255;}
const VEHICLES={truck:{name:'Race Truck',desc:'Short-track pickup with a bed wing'},car:{name:'Super Late Model',desc:'Stock car with your paint scheme and numbers'}};
function cleanLv(l){
  l=l||{};const d=DEFAULT_LV,col=(v,f)=>HEX.test(v||'')?v:f,bool=(v,f)=>typeof v==='boolean'?v:f;
  const fd=typeof l.scheme==='string'&&FIELD_DESIGNS[l.scheme];if(fd)l={...l,primary:fd.primary,secondary:fd.secondary,accent:fd.accent,numColor:fd.num.fill,numOutline:fd.num.outline,numAccent:fd.num.accent,numSlant:fd.num.slant};
  const italic=l.numStyle==='italic',size=parseFloat(l.numSize),custom=l.custom?sanitizeScheme(l.custom):null;
  return {name:(String(l.name||'').replace(/[<>]/g,'').slice(0,20).trim()||'Driver'),number:String(l.number??'').replace(/\D/g,'').slice(0,3),
    primary:col(l.primary,d.primary),secondary:col(l.secondary,d.secondary),accent:col(l.accent,d.accent),
    pattern:PATTERNS.includes(l.pattern)||(l.pattern==='custom'&&custom)?l.pattern:'solid',
    numStyle:!italic&&NUM_STYLE_IDS.includes(l.numStyle)?l.numStyle:'block',numFont:NUM_FONT_IDS.includes(l.numFont)?l.numFont:'classic',
    numSlant:bool(l.numSlant,italic),numSize:Number.isFinite(size)?clamp(Math.round(size/5)*5,60,150):125,
    numColor:col(l.numColor,'#ffffff'),numOutline:col(l.numOutline,'#111111'),numAccent:col(l.numAccent,col(l.accent,d.accent)),
    numDoors:bool(l.numDoors,true),numRoof:bool(l.numRoof,true),numTail:bool(l.numTail,true),veh:VEHICLES[l.veh]||carIdOf(String(l.veh||''))?l.veh:'truck',
    ...(Array.isArray(l.sponsor)&&HEX.test(l.sponsor[1]||'')&&HEX.test(l.sponsor[2]||'')?{sponsor:[String(l.sponsor[0]||'').replace(/[<>]/g,'').slice(0,18),l.sponsor[1],l.sponsor[2]]}:{}),
    ...(typeof l.scheme==='string'&&ICONIC[l.scheme]?{scheme:l.scheme}:{}),...(custom?{custom}:{})};
}
function hslHex(h,s,l){h=mod(h,1);const f=n=>{const k=(n+h*12)%12,a=s*Math.min(l,1-l);return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0');};return '#'+f(0)+f(8)+f(4);}
function randomPaint(r){
  const roll=r();if(roll<0.35)return hslHex(r(),0.65+r()*0.35,0.38+r()*0.22);if(roll<0.55){const p=PAL[Math.floor(r()*PAL.length)];return p;}
  if(roll<0.7)return hslHex(r(),0.1+r()*0.25,r()<0.5?0.08+r()*0.12:0.82+r()*0.14);return hslHex(r(),0.5+r()*0.5,0.2+r()*0.6);
}
function randomLivery(r=Math.random,i=0){
  const pick=a=>a[Math.floor(r()*a.length)],far=(a,b)=>{const x=parseInt(a.slice(1),16),y=parseInt(b.slice(1),16);return Math.hypot((x>>16&255)-(y>>16&255),(x>>8&255)-(y>>8&255),(x&255)-(y&255))>110;};
  const p=randomPaint(r);let s=randomPaint(r),k=0;while(!far(p,s)&&k++<12)s=randomPaint(r);let a=randomPaint(r);k=0;while((!far(a,p)||a===s)&&k++<12)a=randomPaint(r);
  const dark=hexLum(p)>0.55,pre0=r()<0.45?pick(NUM_PRESETS):null,pre=pre0&&Math.abs(hexLum(pre0.fill)-hexLum(p))>0.35?pre0:null;
  return {name:NAMES[i%NAMES.length],number:String(1+Math.floor(r()*98)),primary:p,secondary:s,accent:a,pattern:pick(PATTERNS),
    numStyle:pick(NUM_STYLE_IDS),numFont:pick(NUM_FONT_IDS),numSlant:r()<0.35,numSize:100+Math.floor(r()*6)*10,
    numColor:pre?pre.fill:dark?'#111111':'#ffffff',numOutline:pre?pre.outline:dark?'#ffffff':'#111111',numAccent:pre?pre.accent:a,numDoors:true,numRoof:true,numTail:true};
}
const numArtOpts=lv=>({text:lv.number,font:lv.numFont,style:lv.numStyle,slant:lv.numSlant,fill:lv.numColor,outline:lv.numOutline,accent:lv.numAccent});
const chipFont=lv=>{const f=numFontOf(lv.numFont);return `font-family:'${f.family}','Arial Black',sans-serif;font-weight:${f.weight};font-style:${f.italic?'italic':'normal'}`;};
function drawPattern(g,w,h,lv,fl){
  const p1=lv.primary,p2=lv.secondary,a=lv.accent;g.fillStyle=p1;g.fillRect(0,0,w,h);
  const fx=fl?0:w,dir=fl?1:-1;
  switch(lv.pattern){
    case 'stripes':g.fillStyle=p2;g.fillRect(0,h*0.1,w,h*0.15);g.fillRect(0,h*0.75,w,h*0.15);g.fillStyle=a;g.fillRect(0,h*0.27,w,h*0.04);g.fillRect(0,h*0.69,w,h*0.04);break;
    case 'twotone':g.fillStyle=p2;g.fillRect(0,h*0.56,w,h*0.44);g.fillStyle=a;g.fillRect(0,h*0.52,w,h*0.06);break;
    case 'flames':g.fillStyle=p2;g.strokeStyle=a;g.lineWidth=Math.max(2,h*0.025);g.lineJoin='round';
      for(let i=0;i<6;i++){const y=h*(0.18+i*0.13),len=w*(0.3+0.22*Math.abs(Math.sin(i*1.9+1)));g.beginPath();g.moveTo(fx,y-h*0.09);
        g.bezierCurveTo(fx+dir*len*0.4,y-h*0.16,fx+dir*len*0.7,y-h*0.02,fx+dir*len,y);g.bezierCurveTo(fx+dir*len*0.6,y+h*0.03,fx+dir*len*0.3,y+h*0.1,fx,y+h*0.09);g.closePath();g.fill();g.stroke();}
      break;
    case 'panels':for(const x of [0.05,0.71]){g.fillStyle=p2;rr(g,w*x,h*0.12,w*0.24,h*0.76,h*0.12);g.fill();g.strokeStyle=a;g.lineWidth=h*0.03;g.stroke();}break;
    case 'rainbow':rainbowBands(g,0,w,h*0.22,h*0.7);break;
    case 'fade':{const gr=g.createLinearGradient(fx,0,w-fx,0);gr.addColorStop(0,p1);gr.addColorStop(0.4,p1);gr.addColorStop(1,p2);g.fillStyle=gr;g.fillRect(0,0,w,h);g.fillStyle=a;g.fillRect(0,h*0.86,w,h*0.05);}break;
  }
}
function drawNumber(g,text,cx,cy,size,lv,maxW){
  if(!text)return;g.save();g.translate(cx,cy);const st=lv.numStyle;
  if(st==='italic')g.transform(1,0,-0.25,1,0,0);
  g.font=`900 ${size}px "Arial Black",Impact,sans-serif`;g.textAlign='center';g.textBaseline='middle';g.lineJoin='round';
  if(st==='shadow'){g.fillStyle='rgba(0,0,0,.6)';g.fillText(text,size*0.07,size*0.07,maxW);}
  g.strokeStyle=lv.numOutline;g.lineWidth=st==='outline'?size*0.17:size*0.07;g.strokeText(text,0,0,maxW);
  g.fillStyle=lv.numColor;g.fillText(text,0,0,maxW);g.restore();
}
const SPONSORS=[['TORQUE','#d62828','#ffffff'],['OVAL OIL','#1d3557','#ffd60a'],['FASTLANE','#f77f00','#111111'],['REDLINE','#111111','#ff3b3b'],['BOLT','#ffd60a','#111111'],['APEX','#ffffff','#0b6e4f'],
  ['SUMMIT','#2e86de','#ffffff'],['KESTREL','#5f0f40','#ffffff'],['HAULMARK','#2b2d42','#edf2f4'],['BLAZE','#ff5400','#ffffff'],['NORTHSTAR','#003049','#fcbf49'],['IRONHIDE','#495057','#ffd166']];
function sponsorOf(lv){if(lv.sponsor)return lv.sponsor;let h=7;for(const ch of (lv.name||'')+(lv.number||''))h=(h*31+ch.charCodeAt(0))>>>0;return SPONSORS[h%SPONSORS.length];}
function drawSponsor(g,cx,cy,w,h,sp,rot=0){g.save();g.translate(cx,cy);g.rotate(rot);g.fillStyle=sp[1];rr(g,-w/2,-h/2,w,h,Math.min(w,h)*0.18);g.fill();
  g.strokeStyle='rgba(255,255,255,.85)';g.lineWidth=Math.max(1.5,h*0.05);g.stroke();
  g.fillStyle=sp[2];g.font=`900 italic ${Math.round(h*0.62)}px "Arial Black",Impact,sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(sp[0],0,h*0.03,w*0.9);g.restore();}
function sideTex(lv,left){return canvasTex(2048,376,(g,w,h)=>{
  drawPattern(g,w,h,lv,left);
  const u=z=>left?(2.45-z)/4.9*w:(z+2.45)/4.9*w,vy=y=>(1-(y-0.19)/0.9)*h,span=(a,b)=>[Math.min(u(a),u(b)),Math.abs(u(a)-u(b))];
  g.fillStyle='#0b0b0b';for(const z of [1.48,-1.42]){g.beginPath();g.arc(u(z),vy(0.34),0.45/0.9*h,0,TAU);g.fill();}
  g.textAlign='center';g.textBaseline='middle';
  if(lv.pace){g.font='900 130px Arial Black,Impact,sans-serif';g.fillStyle='#111';g.fillText('PACE TRUCK',u(-0.3),vy(0.62),w*0.5);return;}
  const sp=sponsorOf(lv);
  {const [x0,ww]=span(0.86,-0.36);rr(g,x0,vy(0.96),ww,vy(0.31)-vy(0.96),22);g.fillStyle=lv.secondary;g.globalAlpha=0.32;g.fill();g.globalAlpha=1;}
  drawNumber(g,lv.number,u(0.25),vy(0.63),h*0.55,lv,w*0.2);
  drawSponsor(g,u(-1.35),vy(0.66),w*0.16,h*0.26,sp);
  const cols=[['#ffd60a','#111'],['#ffffff','#d62828'],['#111111','#ffffff'],['#2e86de','#fff'],['#ffffff','#1d3557'],['#d62828','#fff'],['#ffffff','#111'],['#0b6e4f','#fff']];
  const labels=['SPEED','TIRES','FUEL','BRAKES','PLUGS','OIL','GEARS','SHOCKS'];
  for(let i=0;i<8;i++){const cx=u(0.97)+(i%2?1:-1)*w*0.011,cy=vy(0.9)+Math.floor(i/2)*h*0.075,bw=w*0.02,bh=h*0.062;
    g.fillStyle=cols[i][0];g.fillRect(cx-bw/2,cy-bh/2,bw,bh);g.fillStyle=cols[i][1];g.font=`bold ${Math.round(bh*0.55)}px Arial`;g.fillText(labels[i],cx,cy+1,bw*0.92);}
  g.strokeStyle='rgba(0,0,0,.4)';g.lineWidth=3;for(const z of [0.87,-0.4]){g.beginPath();g.moveTo(u(z),vy(1.0));g.lineTo(u(z),vy(0.24));g.stroke();}
  g.beginPath();g.moveTo(u(-0.4),vy(0.9));g.lineTo(u(-2.4),vy(0.9));g.stroke();
  if(left){g.fillStyle='#1a1a1a';g.beginPath();g.arc(u(-2.0),vy(0.82),h*0.03,0,TAU);g.fill();g.strokeStyle='#999';g.lineWidth=2;g.stroke();}
});}
function frontTex(lv){return canvasTex(512,256,(g,w,h)=>{g.fillStyle=lv.primary;g.fillRect(0,0,w,h);
  const vy=y=>(1-(y-0.17)/0.85)*h;
  g.fillStyle='#101010';rr(g,w*0.17,vy(0.9),w*0.66,vy(0.5)-vy(0.9),22);g.fill();
  g.strokeStyle='#2c2c2c';g.lineWidth=2;for(let r=0;r<7;r++)for(let c=0;c<16;c++){const x=w*0.2+c*w*0.038+(r%2)*w*0.019,y=vy(0.87)+r*(vy(0.53)-vy(0.87))/7;g.beginPath();g.ellipse(x,y,w*0.015,(vy(0.53)-vy(0.87))/18,0,0,TAU);g.stroke();}
  g.fillStyle=lv.secondary;g.fillRect(0,vy(0.49),w,vy(0.45)-vy(0.49));
  g.fillStyle='#0d0d0d';rr(g,w*0.12,vy(0.4),w*0.76,vy(0.22)-vy(0.4),14);g.fill();
  g.strokeStyle='#262626';for(let x=w*0.15;x<w*0.85;x+=9){g.beginPath();g.moveTo(x,vy(0.38));g.lineTo(x,vy(0.24));g.stroke();}
  for(const s of [1,-1]){g.save();g.translate(w/2,0);g.scale(s,1);g.fillStyle='#e9f4ff';g.beginPath();g.moveTo(w*0.34,vy(0.9));g.lineTo(w*0.49,vy(0.9));g.lineTo(w*0.49,vy(0.84));g.lineTo(w*0.36,vy(0.82));g.closePath();g.fill();
    g.fillStyle='#ffe9a8';g.fillRect(w*0.37,vy(0.36),w*0.07,vy(0.32)-vy(0.36));g.restore();}
  g.fillStyle='#c8ccd2';rr(g,w*0.42,vy(0.74),w*0.16,vy(0.64)-vy(0.74),8);g.fill();g.fillStyle='#111';g.font='900 20px Arial';g.textAlign='center';g.textBaseline='middle';g.fillText('STS',w/2,(vy(0.74)+vy(0.64))/2);});}
function rearTex(lv){return canvasTex(512,256,(g,w,h)=>{g.fillStyle=lv.primary;g.fillRect(0,0,w,h);
  const vy=y=>(1-(y-0.17)/0.9)*h;
  g.fillStyle='#ff3040';rr(g,w*0.03,vy(1.0),w*0.07,vy(0.55)-vy(1.0),8);g.fill();rr(g,w*0.9,vy(1.0),w*0.07,vy(0.55)-vy(1.0),8);g.fill();
  g.strokeStyle='rgba(0,0,0,.35)';g.lineWidth=3;g.strokeRect(w*0.13,vy(1.0),w*0.74,vy(0.45)-vy(1.0));
  drawNumber(g,lv.number,w*0.2,vy(0.53),h*0.06,lv,w*0.075);if(!lv.pace)drawSponsor(g,w/2,vy(0.6),w*0.5,h*0.12,sponsorOf(lv));
  g.fillStyle='#0d0d0d';g.fillRect(0,vy(0.38),w,h-vy(0.38));});}
function roofTex(lv){return canvasTex(512,512,(g,w,h)=>{g.fillStyle=lv.primary;g.fillRect(0,0,w,h);
  if(lv.pattern==='stripes'||lv.pattern==='panels'){g.fillStyle=lv.secondary;g.fillRect(w*0.38,0,w*0.24,h);}
  g.fillStyle='rgba(0,0,0,.55)';g.fillRect(w*0.14,h*0.82,w*0.3,h*0.05);g.fillRect(w*0.56,h*0.82,w*0.3,h*0.05);
  if(lv.pace){g.font='900 110px Arial Black';g.fillStyle='#111';g.textAlign='center';g.textBaseline='middle';g.fillText('PACE',w/2,h*0.45);}
  else{g.fillStyle='rgba(255,255,255,.9)';rr(g,w*0.14,h*0.12,w*0.72,h*0.64,30);g.fill();const tmp={...lv,numOutline:lv.numOutline};drawNumber(g,lv.number,w/2,h*0.45,h*0.52,{...tmp,numColor:lv.numColor==='#ffffff'?lv.primary:lv.numColor},w*0.66);}});}
function cabinTex(lv,left){return canvasTex(1024,256,(g,w,h)=>{g.fillStyle=lv.primary;g.fillRect(0,0,w,h);g.fillStyle='#0c1218';
  const a=left?[0.1,0.56]:[0.44,0.9],b=left?[0.62,0.92]:[0.08,0.38];
  g.beginPath();g.moveTo(w*a[0],h*0.88);g.lineTo(w*a[1],h*0.88);g.lineTo(w*(left?a[1]:a[1]-0.12),h*0.12);g.lineTo(w*(left?a[0]+0.12:a[0]),h*0.12);g.closePath();g.fill();
  rr(g,w*b[0],h*0.14,w*(b[1]-b[0]),h*0.72,18);g.fill();
  if(left){g.strokeStyle='rgba(225,225,230,.92)';g.lineWidth=3;for(let x=w*b[0]+14;x<w*b[1]-6;x+=20){g.beginPath();g.moveTo(x,h*0.18);g.lineTo(x,h*0.82);g.stroke();}
    for(let y=h*0.22;y<h*0.82;y+=20){g.beginPath();g.moveTo(w*b[0]+8,y);g.lineTo(w*b[1]-8,y);g.stroke();}
    g.strokeStyle='rgba(20,20,20,.9)';g.lineWidth=6;g.strokeRect(w*b[0]+4,h*0.16,w*(b[1]-b[0])-8,h*0.68);}
  g.fillStyle='#e8e8e8';g.font='bold 30px system-ui';g.textAlign='center';g.textBaseline='middle';if(!lv.pace)g.fillText(lv.name.toUpperCase(),w*(a[0]+a[1])/2,h*0.95,w*0.4);});}
function windshieldTex(){return canvasTex(512,256,(g,w,h)=>{g.fillStyle='rgba(10,15,21,0.62)';g.fillRect(0,0,w,h);
  g.fillStyle='rgba(12,12,14,1)';g.fillRect(0,0,w,h*0.2);g.fillStyle='#ffffff';g.font='900 italic 34px "Arial Black",sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText('SHOWDOWN SERIES',w/2,h*0.1,w*0.8);
  g.strokeStyle='rgba(200,210,220,.25)';g.lineWidth=3;g.beginPath();g.moveTo(w*0.5,h*0.2);g.lineTo(w*0.5,h);g.stroke();});}
function makeTag(lv){
  const t=canvasTex(256,64,(g,w,h)=>{g.fillStyle='rgba(8,12,20,.72)';rr(g,2,10,w-4,44,10);g.fill();g.fillStyle=lv.primary;rr(g,8,15,52,34,6);g.fill();
    g.fillStyle=lv.numColor;g.font='900 22px Arial Black,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(lv.pace?'PC':lv.number,34,33,46);
    g.fillStyle='#fff';g.font='bold 21px system-ui,sans-serif';g.textAlign='left';g.fillText(lv.name,70,33,178);});
  const s=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false}));s.scale.set(1.2,0.3,1);s.position.y=2.15;s.renderOrder=-1;return s;
}

// ===================== CAR MODEL =====================
// Bodies are lofted from smooth superellipse cross-sections (about 3,400 faces for the shell alone), so they read as
// sculpted sheet metal rather than boxes. Each face picks a material by which way it points (sides carry the livery).
function loftGeo(z0,z1,nz,na,sec,classify,uvf,capF,capR){
  const G=[];for(let i=0;i<=nz;i++){const z=z0+(z1-z0)*i/nz,row=[];for(let j=0;j<na;j++){const p=sec(z,j/na*TAU);row.push([p[0],p[1],z]);}G.push(row);}
  const nrm=(i,j)=>{const a=G[Math.min(i+1,nz)][j],b=G[Math.max(i-1,0)][j],c=G[i][(j+1)%na],d=G[i][(j-1+na)%na];
    const t1x=a[0]-b[0],t1y=a[1]-b[1],t1z=a[2]-b[2],t2x=c[0]-d[0],t2y=c[1]-d[1],t2z=c[2]-d[2];
    const nx=t2y*t1z-t2z*t1y,ny=t2z*t1x-t2x*t1z,nzz=t2x*t1y-t2y*t1x,l=Math.hypot(nx,ny,nzz)||1;return [nx/l,ny/l,nzz/l];};
  const NG=G.map((r,i)=>r.map((_,j)=>nrm(i,j)));
  const pos=[],nor=[],uv=[],gid=[],groups={};
  const push=(p,n,g,id)=>{const t=uvf(g,p[0],p[1],p[2]);pos.push(p[0],p[1],p[2]);nor.push(n[0],n[1],n[2]);uv.push(t[0],t[1]);gid.push(id);return gid.length-1;};
  const tri=(g,a,b,c)=>{(groups[g]||(groups[g]=[])).push(a,b,c);};
  for(let i=0;i<nz;i++)for(let j=0;j<na;j++){
    const ids=[[i,j],[i,(j+1)%na],[i+1,(j+1)%na],[i+1,j]];let sx=0,sy=0,sz=0;
    for(const [a,b] of ids){const n=NG[a][b];sx+=n[0];sy+=n[1];sz+=n[2];}
    const g=classify(sx,sy,sz),v=ids.map(([a,b])=>push(G[a][b],NG[a][b],g,a*na+b));
    tri(g,v[0],v[1],v[3]);tri(g,v[1],v[2],v[3]);
  }
  const cap=(i,g,dir)=>{const ring=G[i];let cx=0,cy=0;ring.forEach(p=>{cx+=p[0];cy+=p[1];});const n=[0,0,dir];
    const c=push([cx/na,cy/na,ring[0][2]],n,g,-1),vs=ring.map(p=>push(p,n,g,-1));
    for(let j=0;j<na;j++){const a=vs[j],b=vs[(j+1)%na];if(dir>0)tri(g,c,a,b);else tri(g,c,b,a);}};
  if(capF!=null)cap(nz,capF,1);if(capR!=null)cap(0,capR,-1);
  const geo=new THREE.BufferGeometry(),index=[];
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(nor,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  for(const g of Object.keys(groups).map(Number).sort((a,b)=>a-b)){geo.addGroup(index.length,groups[g].length,g);index.push(...groups[g]);}
  geo.setIndex(index);geo.userData.gid=Int32Array.from(gid);geo.userData.nGrid=(nz+1)*na;return geo;
}
function smoothNormals(geo){
  const pa=geo.attributes.position.array,no=geo.attributes.normal.array,idx=geo.index.array,gid=geo.userData.gid,NG=geo.userData.nGrid,acc=new Float32Array((NG+gid.length)*3);
  const key=v=>gid[v]>=0?gid[v]:NG+v;
  for(let t=0;t<idx.length;t+=3){const a=idx[t]*3,b=idx[t+1]*3,c=idx[t+2]*3;
    const ux=pa[b]-pa[a],uy=pa[b+1]-pa[a+1],uz=pa[b+2]-pa[a+2],vx=pa[c]-pa[a],vy=pa[c+1]-pa[a+1],vz=pa[c+2]-pa[a+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    for(const v of [idx[t],idx[t+1],idx[t+2]]){const k=key(v)*3;acc[k]+=nx;acc[k+1]+=ny;acc[k+2]+=nz;}}
  for(let v=0;v<gid.length;v++){const k=key(v)*3,l=Math.hypot(acc[k],acc[k+1],acc[k+2])||1;no[v*3]=acc[k]/l;no[v*3+1]=acc[k+1]/l;no[v*3+2]=acc[k+2]/l;}
  geo.attributes.normal.needsUpdate=true;
}
const sePow=(v,p)=>Math.sign(v)*Math.abs(v)**p;
function bodySec(z,th){
  const ef=Math.max(0,z-2.15)/0.3,er=Math.max(0,-z-2.2)/0.25;
  let top;
  if(z>=0.95)top=1.0-0.1*((z-0.95)/1.5)**1.3;
  else top=lerp(1.03,1.07,smooth(clamp((-0.35-z)/0.2,0,1)));
  top-=0.05*ef*ef+0.03*er*er;
  const bot=0.17+0.13*ef*ef+0.1*er*er,hw=0.975*(1-0.035*ef**2-0.04*er**2);
  const yc=(top+bot)/2,hh=(top-bot)/2,cs=Math.cos(th);
  let x=hw*sePow(cs,0.24),y=yc+hh*sePow(Math.sin(th),0.26);
  const up=Math.max(0,(y-yc)/hh);x*=1-0.08*up**3;
  for(const wz of [1.48,-1.42]){const fz=Math.exp(-(((z-wz)/0.56)**6)),fy=Math.exp(-(((y-0.6)/0.24)**6));x*=1+0.055*fz*fy;}
  if(z>0.95&&up>0.8){const ax=Math.abs(x);y+=0.04*(1-smooth(clamp((ax-0.34)/0.07,0,1)))*smooth(clamp((z-1.05)/0.25,0,1))*smooth(clamp((2.3-z)/0.3,0,1));y+=0.012*(1-(x/hw)**2);}
  if(Math.abs(cs)>0.3)for(const wz of [1.48,-1.42]){const rr2=Math.hypot(z-wz,y-0.34);if(rr2<0.46){const k=smooth(clamp((0.46-rr2)/0.03,0,1));x=lerp(x,Math.sign(x)*0.6,k);}}
  return [x,y];
}
const CAB_Z0=-0.45,CAB_Z1=0.95,CAB_BASE=0.98,CAB_H=0.52;
function cabSec(z,th){
  const h=CAB_H*Math.min(clamp((CAB_Z1-z)/0.62,0,1),clamp((z-CAB_Z0)/0.1,0,1)),yc=CAB_BASE+h/2,hh=Math.max(h/2,0.002);
  let x=0.82*sePow(Math.cos(th),0.45),y=yc+hh*sePow(Math.sin(th),0.28);
  const up=Math.max(0,(y-yc)/hh);x*=1-0.2*up;if(up>0.9)y+=0.03*(1-(x/0.66)**2)*Math.min(1,h/0.4);
  return [x,y];
}
function topTex(lv){return canvasTex(512,1280,(g,w,h)=>{g.fillStyle=lv.primary;g.fillRect(0,0,w,h);
  if(lv.pattern==='stripes'||lv.pattern==='panels'){g.fillStyle=lv.secondary;g.fillRect(w*0.36,0,w*0.28,h);g.fillStyle=lv.accent;g.fillRect(w*0.32,0,w*0.035,h);g.fillRect(w*0.645,0,w*0.035,h);}
  if(lv.pattern==='fade'){const gr=g.createLinearGradient(0,0,0,h);gr.addColorStop(0,lv.primary);gr.addColorStop(0.45,lv.primary);gr.addColorStop(1,lv.secondary);g.fillStyle=gr;g.fillRect(0,0,w,h);}
  const vz=z=>(1-(z+2.45)/4.9)*h;
  g.fillStyle='rgba(0,0,0,.62)';for(let i=0;i<6;i++){rr(g,w*0.06,vz(1.15)-i*14,w*0.16,6,2);g.fill();rr(g,w*0.78,vz(1.15)-i*14,w*0.16,6,2);g.fill();}
  if(lv.pace){g.font='900 90px Arial Black';g.fillStyle='#111';g.textAlign='center';g.textBaseline='middle';g.fillText('PACE',w/2,vz(1.7));g.fillText('PACE',w/2,vz(-1.4));}
  else{drawSponsor(g,w/2,vz(1.68),w*0.78,h*0.13,sponsorOf(lv));drawSponsor(g,w/2,vz(-1.45),w*0.84,h*0.16,sponsorOf(lv));drawNumber(g,lv.number,w/2,vz(-0.75),h*0.06,lv,w*0.4);}
  g.fillStyle='#c0c0c0';g.beginPath();g.arc(w*0.3,vz(2.05),9,0,TAU);g.arc(w*0.7,vz(2.05),9,0,TAU);g.fill();
  g.fillStyle='rgba(0,0,0,.5)';g.fillRect(0,vz(-0.42),w,6);g.fillRect(w*0.06,vz(-2.38),w*0.88,5);});}
const GRILLE_TEX=canvasTex(1024,270,(g,w,h)=>{g.fillStyle='#141518';g.fillRect(0,0,w,h);g.strokeStyle='#2c2e33';g.lineWidth=3;
  const R=16;for(let row=0;row*R*1.5<h+R;row++)for(let col=0;col*R*1.75<w+R;col++){const cx=col*R*1.75+(row%2)*R*0.87,cy=row*R*1.5;g.beginPath();for(let k=0;k<6;k++){const a=Math.PI/6+k*Math.PI/3;g.lineTo(cx+Math.cos(a)*R*0.9,cy+Math.sin(a)*R*0.9);}g.closePath();g.stroke();}
  g.font='900 200px "Arial Black",Impact,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillStyle='#0b0c0e';g.fillText('STS',w/2+4,h/2+6);g.strokeStyle='#3b3e44';g.lineWidth=5;g.strokeText('STS',w/2,h/2);g.fillStyle='#17181b';g.fillText('STS',w/2,h/2);
  g.strokeStyle='#45484e';g.lineWidth=8;g.strokeRect(4,4,w-8,h-8);});
GRILLE_TEX.userData.shared=true;
function buildCarLegacy(lv){
  const paints=[],root=new THREE.Group(),body=new THREE.Group();root.add(body);
  const paint=(map,color,vc)=>{const m=new THREE.MeshPhysicalMaterial({map,color:map?0xffffff:color,metalness:0.25,roughness:0.32,clearcoat:1,clearcoatRoughness:0.05,vertexColors:!!vc,envMap:envTex,envMapIntensity:ENVK});paints.push(m);return m;};
  const dark=new THREE.MeshStandardMaterial({color:0x121212,roughness:.75}),metal=new THREE.MeshStandardMaterial({color:0xb8bcc2,metalness:.9,roughness:.25});
  const geo=loftGeo(-2.45,2.45,112,60,bodySec,(x,y,z)=>{const ax=Math.abs(x),ay=Math.abs(y),az=Math.abs(z);if(az>ax*1.1&&az>ay)return z>0?4:5;if(ay>ax)return y>0?2:3;return x>0?0:1;},
    (g,x,y,z)=>g===0?[(2.45-z)/4.9,(y-0.19)/0.9]:g===1?[(z+2.45)/4.9,(y-0.19)/0.9]:g===2?[0.5-x/1.95,(z+2.45)/4.9]:g===4?[0.5+x/1.95,(y-0.17)/0.85]:g===5?[0.5-x/1.95,(y-0.17)/0.9]:[0,0],4,5);
  geo.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count*3).fill(1),3));
  const bodyMesh=new THREE.Mesh(geo,[paint(sideTex(lv,true),0,1),paint(sideTex(lv,false),0,1),paint(topTex(lv),0,1),dark,paint(frontTex(lv),0,1),paint(rearTex(lv),0,1)]);
  bodyMesh.castShadow=true;bodyMesh.receiveShadow=true;body.add(bodyMesh);
  const orig=Float32Array.from(geo.attributes.position.array);
  const glass=new THREE.MeshPhysicalMaterial({color:0x0a0f15,metalness:0.1,roughness:0.04,clearcoat:1,transparent:true,opacity:0.62,envMap:envTex,envMapIntensity:ENVK});paints.push(glass);
  const shield=new THREE.MeshPhysicalMaterial({map:windshieldTex(),metalness:0.1,roughness:0.04,clearcoat:1,transparent:true,envMap:envTex,envMapIntensity:ENVK});paints.push(shield);
  const cg=loftGeo(CAB_Z0,CAB_Z1,56,52,cabSec,(x,y,z)=>{if(Math.abs(x)>0.55*Math.hypot(x,y,z))return x>0?0:1;if(y<0)return 3;if(z>0.3*Math.hypot(x,y,z))return 4;if(z<-0.3*Math.hypot(x,y,z))return 5;return 2;},
    (g,x,y,z)=>g===0?[(CAB_Z1-z)/1.4,(y-CAB_BASE)/CAB_H]:g===1?[(z-CAB_Z0)/1.4,(y-CAB_BASE)/CAB_H]:g===2?[0.5-x/1.3,(z+0.36)/0.7]:g===4?[0.5+x/1.4,(y-CAB_BASE)/CAB_H]:[0,0]);
  const cab=new THREE.Mesh(cg,[paint(cabinTex(lv,true)),paint(cabinTex(lv,false)),paint(roofTex(lv)),dark,shield,glass]);
  // cockpit seen through the glass: driver helmet, seat, wheel and roll cage
  const helmet=new THREE.Mesh(new THREE.SphereGeometry(0.13,20,14),new THREE.MeshPhysicalMaterial({color:lv.accent,clearcoat:1,roughness:.2}));helmet.position.set(0.2,1.22,-0.08);body.add(helmet);
  const visor=new THREE.Mesh(new THREE.SphereGeometry(0.132,20,10,-0.9,1.8,1.2,0.6),new THREE.MeshStandardMaterial({color:0x111111,roughness:.1,metalness:.6}));visor.position.copy(helmet.position);body.add(visor);
  const seat=new THREE.Mesh(new THREE.BoxGeometry(0.46,0.5,0.1),dark);seat.position.set(0.2,1.18,-0.28);body.add(seat);
  const wheelR=new THREE.Mesh(new THREE.TorusGeometry(0.15,0.018,8,24),dark);wheelR.position.set(0.2,1.2,0.28);body.add(wheelR);
  for(const sx of [0.52,-0.52]){const bar=new THREE.Mesh(new THREE.CylinderGeometry(0.02,0.02,1.0,6).rotateX(Math.PI/2),dark);bar.position.set(sx,1.38,0.1);body.add(bar);}cab.castShadow=true;cab.receiveShadow=true;body.add(cab);
  // A-pillar trim, roof rails, spoiler with end plates, splitter, rear diffuser, skirts, mirrors, roof flaps, hood pins, exhaust, antenna
  const spoMat=new THREE.MeshPhysicalMaterial({color:0x1a1a1a,roughness:.15,clearcoat:1,transparent:true,opacity:0.95});
  const spo=new THREE.Mesh(new THREE.BoxGeometry(1.76,0.42,0.03),spoMat);spo.position.set(0,1.27,-2.37);spo.rotation.x=-0.22;body.add(spo);
  for(const sx of [0.8,-0.8]){const ep=new THREE.Mesh(new THREE.BoxGeometry(0.025,0.4,0.42),dark);ep.position.set(sx*1.09,1.24,-2.25);body.add(ep);}
  const spl=new THREE.Mesh(new THREE.BoxGeometry(1.92,0.03,0.55),dark);spl.position.set(0,0.2,2.38);body.add(spl);
  const grille=new THREE.Mesh(new THREE.BoxGeometry(1.14,0.3,0.07),[dark,dark,dark,dark,new THREE.MeshPhysicalMaterial({map:GRILLE_TEX,roughness:.35,metalness:.4,clearcoat:.6}),dark]);grille.position.set(0,0.69,2.43);body.add(grille);
  const lampGlass=new THREE.MeshPhysicalMaterial({color:0x101216,roughness:.05,metalness:.2,clearcoat:1,envMap:envTex,envMapIntensity:ENVK});paints.push(lampGlass);
  const led=new THREE.MeshStandardMaterial({color:0xffffff,emissive:0xe8f4ff,emissiveIntensity:1.6});
  for(const sx of [1,-1]){
    const lamp=new THREE.Mesh(new THREE.BoxGeometry(0.34,0.13,0.06),lampGlass);lamp.position.set(sx*0.75,0.74,2.415);lamp.rotation.z=sx*0.05;body.add(lamp);
    for(let k=0;k<2;k++){const cell=new THREE.Mesh(new THREE.BoxGeometry(0.07,0.045,0.02),led);cell.position.set(sx*(0.68+k*0.1),0.73,2.447);body.add(cell);}
    const strip=new THREE.Mesh(new THREE.BoxGeometry(0.28,0.012,0.02),led);strip.position.set(sx*0.76,0.785,2.447);body.add(strip);
    const can=new THREE.Mesh(new THREE.BoxGeometry(0.26,0.014,0.2),dark);can.position.set(sx*0.84,0.4,2.33);can.rotation.z=sx*0.22;body.add(can);
    const can2=can.clone();can2.position.y=0.31;can2.rotation.z=sx*0.12;body.add(can2);
    const plate=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.12,0.5),dark);plate.position.set(sx*0.95,0.25,2.36);body.add(plate);
    const brail=new THREE.Mesh(new THREE.BoxGeometry(0.05,0.05,1.9),dark);brail.position.set(sx*0.86,1.095,-1.42);body.add(brail);}
  const hoodScoop=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.02,0.18),dark);hoodScoop.position.set(0,1.045,1.3);body.add(hoodScoop);
  for(let i=-3;i<=3;i++){const fin=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.1,0.42),dark);fin.position.set(i*0.2,0.24,-2.2);body.add(fin);}
  for(const sx of [1,-1]){
    const sk=new THREE.Mesh(new THREE.CapsuleGeometry(0.05,1.7,4,8).rotateX(Math.PI/2),dark);sk.position.set(sx*0.9,0.24,0.03);body.add(sk);
    const mir=new THREE.Mesh(new THREE.CapsuleGeometry(0.045,0.1,4,8).rotateX(Math.PI/2),paint(null,lv.secondary));mir.position.set(sx*0.8,1.2,0.62);body.add(mir);
    const flap=new THREE.Mesh(new THREE.BoxGeometry(0.4,0.012,0.13),dark);flap.position.set(sx*0.2,1.525,-0.1);body.add(flap);
    const rail=new THREE.Mesh(new THREE.CapsuleGeometry(0.018,0.62,4,6).rotateX(Math.PI/2),dark);rail.position.set(sx*0.5,1.5,0.0);body.add(rail);
    const pin=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.025,0.03,10),metal);pin.position.set(sx*0.5,0.935,1.9);body.add(pin);}
  for(const ez of [0.15,0.42]){const ex=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.16,14).rotateZ(Math.PI/2),metal);ex.position.set(-0.93,0.26,ez);body.add(ex);}
  const ant=new THREE.Mesh(new THREE.CylinderGeometry(0.004,0.008,0.5,5),dark);ant.position.set(-0.3,1.78,-0.2);ant.rotation.x=-0.35;body.add(ant);
  const brakeMat=new THREE.MeshPhysicalMaterial({color:0x5a0008,emissive:0xff1a26,emissiveIntensity:0.2,roughness:.1,clearcoat:1});
  for(const sx of [0.84,-0.84]){const bl=new THREE.Mesh(new THREE.BoxGeometry(0.13,0.42,0.035),brakeMat);bl.position.set(sx,0.79,-2.45);bl.rotation.y=Math.PI;body.add(bl);}
  // wheels: lathe-turned tires with rounded shoulders, steel rims with lug nuts, lettered sidewalls
  const tire=new THREE.LatheGeometry([[0.22,-0.15],[0.3,-0.155],[0.326,-0.14],[0.338,-0.105],[0.341,-0.05],[0.341,0.05],[0.338,0.105],[0.326,0.14],[0.3,0.155],[0.22,0.15]].map(p=>new THREE.Vector2(p[0],p[1])),40);
  tire.rotateZ(Math.PI/2);
  const tread=new THREE.MeshStandardMaterial({color:0x1b1b1b,roughness:.88}),wall=new THREE.MeshStandardMaterial({map:tireSideTex,roughness:.85,transparent:true,alphaTest:0.5});
  const rimG=new THREE.CylinderGeometry(0.222,0.222,0.27,28).rotateZ(Math.PI/2),rimMat=new THREE.MeshStandardMaterial({color:0x15171a,metalness:.7,roughness:.35});
  const ring=new THREE.RingGeometry(0.222,0.336,40),lug=new THREE.CylinderGeometry(0.016,0.016,0.03,8).rotateZ(Math.PI/2),hub=new THREE.CylinderGeometry(0.06,0.07,0.3,16).rotateZ(Math.PI/2);
  const wheels=[];
  for(const [x,z,front] of [[0.84,1.48,1],[-0.84,1.48,1],[0.84,-1.42,0],[-0.84,-1.42,0]]){
    const pivot=new THREE.Group();pivot.position.set(x,0.34,z);const w=new THREE.Group();pivot.add(w);root.add(pivot);
    const t=new THREE.Mesh(tire,tread);t.castShadow=true;w.add(t);w.add(new THREE.Mesh(rimG,rimMat));w.add(new THREE.Mesh(hub,metal));
    for(const sd of [1,-1]){const rg=new THREE.Mesh(ring,wall);rg.position.x=sd*0.152;rg.rotation.y=sd*Math.PI/2;w.add(rg);
      const nut=new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.04,6).rotateZ(Math.PI/2),metal);nut.position.x=sd*0.15;w.add(nut);
      for(let k=0;k<5;k++){const a=k/5*TAU,sp=new THREE.Mesh(new THREE.BoxGeometry(0.02,0.15,0.045),rimMat);sp.position.set(sd*0.137,Math.cos(a)*0.12,Math.sin(a)*0.12);sp.rotation.x=a;w.add(sp);}}
    wheels.push({pivot,w,front});}
  const bumperF=new THREE.Group(),bumperR=new THREE.Group();body.add(bumperF,bumperR);
  let light=null;
  if(lv.pace){light=new THREE.Mesh(new THREE.CapsuleGeometry(0.07,1.0,4,8).rotateZ(Math.PI/2),new THREE.MeshStandardMaterial({color:0x332200,emissive:0xffa000,emissiveIntensity:2}));light.position.set(0,1.58,-0.05);body.add(light);}
  return {root,body,bodyMesh,orig,wheels,bumperF,bumperR,paints,light,brakeMat};
}
function deformCarLegacy(c,lp,dir,amt){
  const g=c.m.bodyMesh.geometry,pa=g.attributes.position,ca=g.attributes.color,o=c.m.orig;
  const r=0.8+Math.min(0.9,amt*0.035),push=Math.min(0.3,amt*0.015);
  for(let i=0;i<pa.count;i++){
    const x=pa.getX(i),y=pa.getY(i),z=pa.getZ(i),dx=x-lp[0],dy=(y-lp[1])*0.6,dz=z-lp[2],d=Math.sqrt(dx*dx+dy*dy+dz*dz);
    if(d>=r)continue;const k=(1-d/r)**2,ox=o[i*3],oy=o[i*3+1],oz=o[i*3+2];
    const hs=Math.sin(ox*91.7+oy*47.3+oz*13.1)*43758.5453,jit=hs-Math.floor(hs)-0.5;
    let ex=x+dir[0]*push*k*(1+jit*0.8)-ox,ey=y-push*k*(0.2+jit*0.5)-oy,ez=z+dir[2]*push*k*(1+jit*0.8)+jit*push*k*0.25-oz;
    const el=Math.hypot(ex,ey,ez);if(el>0.42){const f=0.42/el;ex*=f;ey*=f;ez*=f;}
    pa.setXYZ(i,ox+ex,oy+ey,oz+ez);const cv=Math.max(0.32,ca.getX(i)-0.42*k*(0.75+jit*0.5));ca.setXYZ(i,cv,cv*0.98,cv*0.96);
  }
  pa.needsUpdate=true;ca.needsUpdate=true;smoothNormals(g);
}


// ===================== RACE TRUCK MODEL (the owner's race-truck design, adapted for racing) =====================
const TM_S=0.98/CFG.carScale;                 // model metres -> vehicle root units (root is scaled by carScale)
const TRUCK_SCALE=0.9;
const TM_GRILLE=TM.makeGrilleTexture(THREE);TM_GRILLE.userData.shared=true;
const TM_X0=-2.8,TM_X1=2.38,TM_Y0=0.17,TM_Y1=1.2,TM_L=TM_X1-TM_X0;
const TRK_REAR=TM.DIM.RA*TM_S*TRUCK_SCALE,TRK_HALF=0.83*TM_S*TRUCK_SCALE;
function tmSideTex(lv,left){const W=1280,H=Math.round(W*(TM_Y1-TM_Y0)/TM_L);return canvasTex(W,H,(g,w,h)=>{
  const u=x=>left?(TM_X1-x)/TM_L*w:(x-TM_X0)/TM_L*w,vy=y=>(1-(y-TM_Y0)/(TM_Y1-TM_Y0))*h,pm=w/TM_L,front=left?0:w,dir=left?1:-1;
  g.textAlign='center';g.textBaseline='middle';
  const p2=lv.secondary,a=lv.accent,sch=schemeOf(lv);
  if(sch){   // metres on this side: x forward, y up (same frame as u()/vy())
    const ax=(left?-1:1)*w/TM_L,dy=-h/(TM_Y1-TM_Y0);
    g.save();g.setTransform(ax,0,0,dy,left?TM_X1*w/TM_L:-TM_X0*w/TM_L,h*TM_Y1/(TM_Y1-TM_Y0));
    drawSchemeSide(g,sch,{xf:TM_X1,xr:TM_X0,yb:0.24,yt:1.04},Math.sign(ax),Math.sign(dy));g.restore();}
  else switch(lv.pattern){
    case 'stripes':g.fillStyle=p2;g.fillRect(0,vy(1.02),w,0.07*pm);g.fillRect(0,vy(0.4),w,0.07*pm);g.fillStyle=a;g.fillRect(0,vy(0.94),w,0.02*pm);g.fillRect(0,vy(0.31),w,0.02*pm);break;
    case 'twotone':g.fillStyle=p2;g.fillRect(0,vy(0.6),w,h-vy(0.6));g.fillStyle=a;g.fillRect(0,vy(0.62),w,0.025*pm);break;
    case 'flames':g.fillStyle=p2;g.strokeStyle=a;g.lineWidth=3;
      for(let i=0;i<5;i++){const y=vy(0.4+i*0.13),len=w*(0.25+0.18*Math.abs(Math.sin(i*1.9+1)));g.beginPath();g.moveTo(front,y-0.05*pm);
        g.bezierCurveTo(front+dir*len*0.4,y-0.09*pm,front+dir*len*0.7,y-0.01*pm,front+dir*len,y);g.bezierCurveTo(front+dir*len*0.6,y+0.02*pm,front+dir*len*0.3,y+0.06*pm,front,y+0.05*pm);g.closePath();g.fill();g.stroke();}break;
    case 'panels':for(const [x0,x1] of [[0.9,-0.6],[-2.0,-2.75]]){g.fillStyle=p2;rr(g,Math.min(u(x0),u(x1)),vy(1.08),Math.abs(u(x0)-u(x1)),vy(0.3)-vy(1.08),0.08*pm);g.fill();g.strokeStyle=a;g.lineWidth=4;g.stroke();}break;
    case 'rainbow':rainbowBands(g,0,w,vy(0.95),vy(0.45));break;
    case 'fade':{const gr=g.createLinearGradient(u(1.0),0,u(-2.8),0);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,p2);g.fillStyle=gr;g.fillRect(0,0,w,h);}break;
  }
  if(lv.pace){g.font=`900 ${0.32*pm}px Arial Black,Impact,sans-serif`;g.fillStyle='#111';g.fillText('PACE TRUCK',u(-0.4),vy(0.66),w*0.5);}
  else{
    if(!sch)drawSponsor(g,u(-2.38),vy(0.7),0.66*pm,0.26*pm,sponsorOf(lv));
    const cols=['#ffd60a','#ffffff','#111111','#2e86de','#ffffff','#d62828','#ffffff','#0b6e4f'],txt=['#111','#d62828','#fff','#fff','#1d3557','#fff','#111','#fff'];
    for(let i=0;i<8;i++){const cx=u(1.05)+(i%2?1:-1)*0.035*pm,cy=vy(0.62)+Math.floor(i/2)*0.075*pm;g.fillStyle=cols[i];g.fillRect(cx-0.03*pm,cy-0.03*pm,0.06*pm,0.06*pm);
      g.fillStyle=txt[i];g.font=`bold ${Math.round(0.02*pm)}px Arial`;g.fillText(['SPEED','TIRES','FUEL','BRAKE','PLUGS','OIL','GEARS','SHOCK'][i],cx,cy,0.055*pm);}
    g.fillStyle='rgba(255,255,255,.95)';g.font=`bold ${Math.round(0.055*pm)}px system-ui,sans-serif`;g.fillText(lv.name.toUpperCase(),u(0.15),vy(1.1),0.9*pm);
  }
  g.globalCompositeOperation='destination-out';
  for(const ax of [TM.DIM.FA,TM.DIM.RA]){g.beginPath();g.arc(u(ax),vy(TM.DIM.AY),(TM.DIM.AR+0.035)*pm,0,TAU);g.fill();}
  g.globalCompositeOperation='source-over';
});}
function tmHoodTex(lv){return canvasTex(512,456,(g,w,h)=>{const pz=w/1.6,vx=x=>(1-(x-1.08)/1.42)*h;
  g.textAlign='center';g.textBaseline='middle';
  const sch=schemeOf(lv);
  if(sch){   // (x forward, y lateral) metres -> canvas: lateral across, forward up
    g.save();g.setTransform(0,-h/1.42,pz,0,w/2,h*(1+1.08/1.42));
    drawSchemeHood(g,sch,{x0:1.08,xf:2.5,half:0.8},(cv,f,wm)=>{g.save();g.setTransform(1,0,0,1,0,0);const lw=wm*pz,lh=lw*cv.height/cv.width;g.drawImage(cv,w/2-lw/2,vx(f)-lh/2,lw,lh);g.restore();});
    g.restore();return;}
  if(lv.pattern==='stripes'||lv.pattern==='panels'){g.fillStyle=lv.secondary;g.fillRect(w/2-0.17*pz,0,0.34*pz,h);g.fillStyle=lv.accent;g.fillRect(w/2-0.2*pz,0,0.025*pz,h);g.fillRect(w/2+0.175*pz,0,0.025*pz,h);}
  if(lv.pace){g.font='900 90px Arial Black';g.fillStyle='#111';g.fillText('PACE',w/2,vx(1.8));}
  else drawSponsor(g,w/2,vx(1.75),1.05*pz,0.3*pz,sponsorOf(lv));});}
function tmRoofTex(){return canvasTex(512,328,(g,w,h)=>{g.textAlign='center';g.textBaseline='middle';
  g.font='900 120px Arial Black';g.fillStyle='#111';g.fillText('PACE',w/2,h/2);});}
const NUM_PX={low:160,med:208,high:256};
function mountNumbers(m,lv){
  if(m.custom){const px=m.crisp?320:NUM_PX[quality]||208;
    // numbers painted into the livery (spots the admin didn't place) need the livery redrawn when they change
    const pl=customLiveryLv(lv,m.custom.rec),sig=[pl.number,pl.numDoors,pl.numRoof,pl.numTail,pl.numStyle,pl.numFont,pl.numSlant,pl.numSize,pl.numColor,pl.numOutline,pl.numAccent].join('|'),ok=!pl.number||numFontReady(lv.numFont);
    if(m.liveryOn&&m.liverySig!==undefined&&(m.liverySig!==sig||(!m.liveryFontOk&&ok)))repaintCustomCar(m,lv,customLivery(lv,m.custom,{crisp:m.crisp}));
    m.liverySig=sig;m.liveryFontOk=ok;
    if(!carGarage(m.custom.rec).numbers)lv={...lv,number:''};
    mountCustomNumbers(m,lv,{art:cv=>drawNumberArt(cv,numArtOpts(lv),px),size:(spot,art)=>numberSize(spot,art,lv.numSize/100),spot:numberSpot,fontOk:numFontReady(lv.numFont),
      material:cv=>{const mat=makeNumberMaterial(THREE,makeNumberTexture(THREE,cv));mat.userData.r0=mat.roughness;mat.userData.cc0=mat.clearcoat;mat.envMap=envTex;mat.envMapIntensity=ENVK;
        if(envTex===envNight){mat.roughness=Math.max(0.5,mat.roughness);mat.clearcoat*=0.3;}return mat;}});return;}
  if(m.car){mountCarLivery(m,lv);return;}
  const N=m.numbers;
  if(N){for(const d of N.meshes){m.tmg.remove(d);d.geometry.dispose();}N.mat.dispose();N.tex.dispose();
    m.deform=m.deform.filter(p=>!N.meshes.some(d=>d.geometry===p.geo));m.paints=m.paints.filter(p=>p!==N.mat);m.numbers=null;}
  if(lv.pace||!lv.number)return;
  const cv=document.createElement('canvas'),art=drawNumberArt(cv,numArtOpts(lv),m.crisp?320:NUM_PX[quality]||208);if(!art)return;
  const tex=makeNumberTexture(THREE,cv),mat=makeNumberMaterial(THREE,tex);
  mat.userData.r0=mat.roughness;mat.userData.cc0=mat.clearcoat;mat.envMap=envTex;mat.envMapIntensity=ENVK;
  if(envTex===envNight){mat.roughness=Math.max(0.5,mat.roughness);mat.clearcoat*=0.3;}
  const meshes=buildNumberMeshes(THREE,TM,{material:mat,art,scale:lv.numSize/100,doors:lv.numDoors,roof:lv.numRoof,tail:lv.numTail});
  if(lv.numTail)for(const d of meshes)tailNumberToCorner(d);
  for(const d of meshes){d.receiveShadow=true;m.tmg.add(d);m.deform.push({geo:d.geometry,orig:Float32Array.from(d.geometry.attributes.position.array)});}
  m.paints.push(mat);m.numbers={meshes,mat,tex,art,fontOk:numFontReady(lv.numFont)};
}
// Rear number: 75% smaller (scale 0.25), sitting in the bottom-left corner of the rear as seen from behind.
// Truck model axes: +x forward, +y up, +z = driver's right, so "left" seen from behind is -z.
const TAIL_NUM={scale:0.25,left:-0.74,bottom:0.44};   // left edge z and bottom edge y, model metres (bumper bar top is y 0.41)
function tailNumberToCorner(d){
  d.updateMatrix();const gm=d.geometry;gm.applyMatrix4(d.matrix);d.position.set(0,0,0);d.rotation.set(0,0,0);d.scale.set(1,1,1);
  gm.computeBoundingBox();const b=gm.boundingBox;
  if((b.min.x+b.max.x)/2>TM.DIM.xr+0.25||b.max.x-b.min.x>0.25)return;   // not the tail decal (doors/roof)
  const k=TAIL_NUM.scale,cy=(b.min.y+b.max.y)/2,cz=(b.min.z+b.max.z)/2,hh=(b.max.y-b.min.y)*k/2,hw=(b.max.z-b.min.z)*k/2;
  const ty=TAIL_NUM.bottom+hh,tz=TAIL_NUM.left+hw,pa=gm.attributes.position;
  for(let i=0;i<pa.count;i++)pa.setXYZ(i,pa.getX(i),ty+(pa.getY(i)-cy)*k,tz+(pa.getZ(i)-cz)*k);
  pa.needsUpdate=true;gm.computeBoundingBox();gm.computeBoundingSphere();
}
function tmGrid(nu,nv,fn){const pos=[],uv=[],idx=[];
  for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){const p=fn(i/nu,j/nv);pos.push(p[0],p[1],p[2]);uv.push(p[3],p[4]);}
  for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){const a=j*(nu+1)+i,b=a+1,c=a+nu+1,d=c+1;idx.push(a,b,c,b,d,c);}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();return geo;}
function tmCabY(x,z){const h=TM.cabTop(x)-TM.CAB.yb;let y=TM.cabTop(x);for(let i=0;i<5;i++){const zw=TM.CAB.wb*(1-TM.CAB.tb*(y-TM.CAB.yb)/0.5),r=Math.min(1,Math.abs(z)/zw);y=TM.CAB.yb+h*Math.pow(Math.max(0,1-r**TM.CAB.n),1/TM.CAB.n);}return y;}
let CAR_ASSET=null,CAR_REGIONS=null;
function parseCarAsset(buf){
  const dv=new DataView(buf);if(buf.byteLength<8||dv.getUint32(0,true)!==0x31435453)throw new Error('car asset');
  const jl=dv.getUint32(4,true),meta=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,8,jl)));let o=8+jl;CAR_REGIONS=meta.regions;
  const take=(T,n)=>{const a=new T(buf,o,n);o+=Math.ceil(n*T.BYTES_PER_ELEMENT/4)*4;return a;};
  return meta.parts.map(p=>{const q=take(Int16Array,p.v*3),n8=take(Int8Array,p.v*3),c8=take(Uint8Array,p.v),uv16=meta.uv?take(Uint16Array,p.v*2):null,idx=take(p.i32?Uint32Array:Uint16Array,p.i);
    const pos=new Float32Array(p.v*3),nor=new Float32Array(p.v*3),col=new Float32Array(p.v*3);
    for(let i=0;i<p.v;i++){for(let k=0;k<3;k++){pos[i*3+k]=p.lo[k]+(q[i*3+k]+32768)/65535*(p.hi[k]-p.lo[k]);nor[i*3+k]=n8[i*3+k]/127;}col[i*3]=col[i*3+1]=col[i*3+2]=c8[i]/255;}
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(pos,3));geo.setAttribute('normal',new THREE.BufferAttribute(nor,3));
    geo.setAttribute('color',new THREE.BufferAttribute(col,3));
    if(uv16){const uv=new Float32Array(p.v*2);for(let i=0;i<uv.length;i++)uv[i]=uv16[i]/65535;geo.setAttribute('uv',new THREE.BufferAttribute(uv,2));}
    geo.setIndex(new THREE.BufferAttribute(idx.slice(),1));for(const [st,ct,mi] of p.groups)geo.addGroup(st,ct,mi);
    if(!p.center)splitSpoiler(geo);
    geo.computeBoundingSphere();return {center:p.center,geo};});
}
// The rear spoiler is clear Lexan: its triangles leave the paint group for their own group (material 6).
function splitSpoiler(geo){
  const idx=geo.index.array,pos=geo.attributes.position.array,paint=geo.groups.find(g=>g.materialIndex===0);if(!paint)return;
  const sp=new Set(spoilerTriangles(pos,idx,boundsOf([pos]),paint.start/3,paint.count/3));if(!sp.size)return;
  const out=[],groups=[];
  for(const g of geo.groups){const st=out.length;for(let t=g.start/3;t<(g.start+g.count)/3;t++)if(!sp.has(t))out.push(idx[t*3],idx[t*3+1],idx[t*3+2]);groups.push([st,out.length-st,g.materialIndex]);}
  const st=out.length;for(const t of sp)out.push(idx[t*3],idx[t*3+1],idx[t*3+2]);groups.push([st,out.length-st,6]);
  geo.setIndex(new THREE.BufferAttribute(new Uint32Array(out),1));geo.clearGroups();for(const [s0,ct,mi] of groups)geo.addGroup(s0,ct,mi);
}
const carAssetReady=fetch(new URL('shorttrack-car.bin',location.href)).then(r=>{if(!r.ok)throw new Error('car asset '+r.status);return r.arrayBuffer();})
  .then(b=>{CAR_ASSET=parseCarAsset(b);return true;}).catch(()=>false);
const CAR_NUM_SPOTS={door:{base:0.3,maxW:1.5,maxH:0.5,x:-0.05,y:0.52},roof:{base:0.36,maxW:1.15,maxH:0.8,x:-0.62},tail:{base:0.17,maxW:0.85,maxH:0.3,y:0.8}};
// The stock car's own geometry in the livery frame (its .bin frame): projection maps for decals and logo
// fitting, and per atlas size the texels whose flat art is wrong at a seam (shared/liveryWrap.ts).
let STOCK_GEO=null;const STOCK_PLANS=new Map();
function stockParts(){const out=[];
  for(const p of CAR_ASSET){const a=p.geo.attributes,src=a.position.array,c=p.center;let pos=src;
    if(c){pos=new Float32Array(src.length);for(let i=0;i<src.length;i+=3){pos[i]=src[i]+c[0];pos[i+1]=src[i+1]+c[1];pos[i+2]=src[i+2]+c[2];}}
    const idx=p.geo.index.array;
    for(const gr of p.geo.groups)out.push({positions:pos,normals:a.normal.array,uvs:a.uv?a.uv.array:null,index:idx.subarray(gr.start,gr.start+gr.count),paint:!c&&gr.materialIndex===0});}
  return out;}
function stockGeo(){if(!STOCK_GEO&&CAR_ASSET&&CAR_REGIONS)STOCK_GEO=buildLiveryGeo(stockParts(),parseRegions(CAR_REGIONS));return STOCK_GEO;}
// Planned at 1024 at most; the crisp 2048 livery steps each planned texel into a 2x2 block (upsamplePlan).
function stockPlan(size){let p=STOCK_PLANS.get(size);
  if(!p&&CAR_ASSET&&CAR_REGIONS){
    if(size>1024&&size%1024===0)p=upsamplePlan(stockPlan(1024),size/1024);
    else p=planAtlas(stockParts().filter(q=>q.paint&&q.uvs),parseRegions(CAR_REGIONS),stockGeo(),STOCK_BOUNDS,size,size);
    STOCK_PLANS.set(size,p);}
  return p||null;}
// The livery in the stock car's atlas. Base paint and decals (logos, lettering, numbers) are drawn in separate
// layers; the stock car (o.plan) is then repainted along its seams from 3D so stripes meet cleanly and logos run
// over the seam in one piece, and custom cars get both layers (t.userData.layers) to bake the same way.
// Side logos and door numbers are moved onto painted panel with the body's own map (o.geo, the stock car's by default).
function carLiveryTex(lv,size,glyphPx,o={}){
  const geo=o.geo!==undefined?o.geo:stockGeo(),plan=o.plan!==undefined?o.plan:(geo?stockPlan(size):null);let layers=null;
  const t=canvasTex(size,size,(g0,w,h)=>{
    g0.fillStyle=lv.primary;g0.fillRect(0,0,w,h);if(!CAR_REGIONS)return;
    const R=Object.fromEntries(CAR_REGIONS.map(r=>[r[0],r]));
    const dc=document.createElement('canvas');dc.width=w;dc.height=h;const gd=dc.getContext('2d',{willReadFrequently:true});
    let g=g0;
    const region=(nm,fn)=>{const [,[rx,ry,rw,rh],,u0,u1,,v0,v1]=R[nm],a=rw*w/(u1-u0),d=rh*h/(v1-v0);
      g.save();g.beginPath();g.rect(rx*w,ry*h,rw*w,rh*h);g.clip();g.setTransform(a,0,0,d,rx*w-u0*a,ry*h-v0*d);fn(Math.sign(a),Math.sign(d));g.restore();};
    const p2=lv.secondary,ac=lv.accent,band=(y0,y1,c)=>{g.fillStyle=c;g.fillRect(-4,y0,8,y1-y0);};
    const centre=(half,edge)=>{g.fillStyle=p2;g.fillRect(-4,-half,8,half*2);g.fillStyle=ac;g.fillRect(-4,-half-edge,8,edge);g.fillRect(-4,half,8,edge);};
    const vcentre=(half,edge)=>{g.fillStyle=p2;g.fillRect(-half,-1,half*2,4);g.fillStyle=ac;g.fillRect(-half-edge,-1,edge,4);g.fillRect(half,-1,edge,4);};
    const sch=schemeOf(lv);
    const E={xf:Math.max(R.L[3],R.L[4]),xr:Math.min(R.L[3],R.L[4]),yb:0.24,yt:0.86};
    // race numbers first, so the side logos are fitted around them
    const S=CAR_NUM_SPOTS,cv=document.createElement('canvas'),art=lv.number?drawNumberArt(cv,numArtOpts(lv),glyphPx):null,blocked={L:[],R:[]},doors={};
    if(art&&lv.numDoors){const [nw,nh]=numberSize(S.door,art,lv.numSize/100);
      for(const side of ['L','R']){const f=fitDecal(geo,side,S.door.x,S.door.y,nw,nh,[],0.5);doors[side]={...f,nw,nh};blocked[side].push({x:f.x,y:f.y,w:nw*f.k+0.08,h:nh*f.k+0.06});}}
    const fitFor=side=>(x,y,wm,hm)=>fitDecal(geo,side,x,y,wm,hm,blocked[side]);
    const paint=layer=>{const base=layer==='base';
      if(sch){
        const Y=s=>E.yb+s*(E.yt-E.yb);
        for(const side of ['L','R'])region(side,(sa,sd)=>drawSchemeSide(g,sch,E,sa,sd,{layer,fit:fitFor(side)}));
        region('T',(sa,sd)=>{
          if(base&&sch.roof){g.fillStyle=sch.roof;g.fillRect(-1.6,-2,2.6,4);}
          if(base&&sch.deck){g.fillStyle=sch.deck;g.fillRect(-4,-2,4-1.6,4);}
          drawSchemeHood(g,sch,{x0:1.0,xf:E.xf,half:1.1},(cv,f,wm)=>{const hm=wm*cv.height/cv.width;g.save();g.translate(f,0);g.scale(sa,sd);g.rotate(Math.PI/2);g.drawImage(cv,-wm/2,-hm/2,wm,hm);g.restore();},{layer});});
        // nose and tail carry the full-length side bands
        if(base)for(const end of ['B','F'])region(end,()=>{for(const op of sch.side)if(op[0]==='band'&&((op[4]??0)<=0.02||(op[5]??1)>=0.98)){
          const y0=op[1]<=0?-1:Y(op[1]),y1=op[2]>=1.15?3:Y(op[2]);g.fillStyle=op[3];g.fillRect(-2,y0,4,y1-y0);}});
      }
      else if(base)for(const side of ['L','R'])region(side,()=>{
        switch(lv.pattern){
          case 'stripes':band(0.76,0.82,p2);band(0.26,0.32,p2);band(0.72,0.735,ac);band(0.345,0.36,ac);break;
          case 'twotone':band(-1,0.5,p2);band(0.5,0.525,ac);break;
          case 'flames':g.fillStyle=p2;g.strokeStyle=ac;g.lineWidth=0.012;
            for(let i=0;i<5;i++){const y=0.3+i*0.11,len=5.3*(0.25+0.18*Math.abs(Math.sin(i*1.9+1))),f=2.6;g.beginPath();g.moveTo(f,y-0.045);
              g.bezierCurveTo(f-len*0.4,y-0.08,f-len*0.7,y-0.01,f-len,y);g.bezierCurveTo(f-len*0.6,y+0.02,f-len*0.3,y+0.055,f,y+0.045);g.closePath();g.fill();g.stroke();}break;
          case 'panels':for(const [x0,x1] of [[-0.85,0.75],[-2.65,-2.05]]){g.fillStyle=p2;rr(g,x0,0.3,x1-x0,0.48,0.07);g.fill();g.strokeStyle=ac;g.lineWidth=0.018;g.stroke();}break;
          case 'rainbow':rainbowBands(g,-4,4,0.78,0.3);break;
          case 'fade':{const gr=g.createLinearGradient(1.0,0,-2.8,0);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,p2);g.fillStyle=gr;g.fillRect(-4,-1,8,4);}break;
        }});
      if(!sch&&base)region('T',()=>{
        if(lv.pattern==='stripes'||lv.pattern==='panels')centre(0.17,0.025);
        else if(lv.pattern==='fade'){const gr=g.createLinearGradient(1.0,0,-2.8,0);gr.addColorStop(0,'rgba(0,0,0,0)');gr.addColorStop(1,p2);g.fillStyle=gr;g.fillRect(-4,-2,8,4);}});
      if(!sch&&base)for(const end of ['B','F'])region(end,()=>{
        if(lv.pattern==='stripes'||lv.pattern==='panels')vcentre(0.17,0.025);
        else if(lv.pattern==='twotone'){band(-1,0.5,p2);band(0.5,0.525,ac);}
        else if(lv.pattern==='fade'&&end==='B'){g.fillStyle=p2;g.fillRect(-2,-1,4,4);}});
      if(base)return;
      if(!lv.pace&&!sch&&!lv.noLogo){const sc=document.createElement('canvas');sc.width=512;sc.height=154;drawSponsor(sc.getContext('2d'),256,77,504,146,sponsorOf(lv));
        const logo=(nm,cx,cy,lw,rot)=>{const f=nm==='T'?{x:cx,y:cy,k:1}:fitDecal(geo,nm,cx,cy,lw,lw*0.3,blocked[nm]);
          region(nm,(sa,sd)=>{g.translate(f.x,f.y);g.scale(sa,sd);if(rot)g.rotate(rot);g.drawImage(sc,-lw*f.k/2,-lw*0.15*f.k,lw*f.k,lw*0.3*f.k);});};
        logo('L',-1.75,0.62,0.95);logo('R',-1.75,0.62,0.95);logo('T',1.65,0,0.9,Math.PI/2);}
      if(!art)return;
      const put=(nm,spot,cx,cy,rot,k=1)=>{const [nw,nh]=numberSize(spot,art,lv.numSize/100);region(nm,(sa,sd)=>{g.translate(cx,cy);g.scale(sa,sd);if(rot)g.rotate(rot);g.drawImage(cv,-nw*k/2,-nh*k/2,nw*k,nh*k);});};
      if(lv.numDoors)for(const side of ['L','R'])put(side,S.door,doors[side].x,doors[side].y,0,doors[side].k);
      if(lv.numRoof)put('T',S.roof,S.roof.x,0,Math.PI/2);
      if(lv.numTail){const [nw0,nh0]=numberSize(S.tail,art,lv.numSize/100),nw=nw0*TAIL_NUM.scale,nh=nh0*TAIL_NUM.scale,[,,,u0,u1,,v0,v1]=R.B;
        region('B',(sa,sd)=>{const pad=0.06,lx=sa>0?Math.min(u0,u1):Math.max(u0,u1),by=sd>0?Math.max(v0,v1):Math.min(v0,v1);
          // in the flipped frame +x is the viewer's right and +y is down, so step in from the left edge and up from the bottom edge
          g.translate(lx+sa*(pad+nw/2),by-sd*(pad+nh/2));g.scale(sa,sd);g.drawImage(cv,-nw/2,-nh/2,nw,nh);});}
    };
    g=g0;paint('base');
    g=gd;paint('decal');
    const wrap=plan||o.layers;
    const B=wrap?g0.getImageData(0,0,w,h):null,D=wrap?gd.getImageData(0,0,w,h):null;
    g0.drawImage(dc,0,0);
    if(o.layers)layers={base:B,decals:D};
    if(plan&&plan.width===w&&plan.height===h){const img=g0.getImageData(0,0,w,h);
      applyAtlas(plan,img,wrapContext({regions:parseRegions(CAR_REGIONS),base:B,decals:D,geo,bounds:STOCK_BOUNDS}));g0.putImageData(img,0,0);}
  });
  if(layers)t.userData.layers=layers;
  t.flipY=false;t.needsUpdate=true;return t;
}
function mountCarLivery(m,lv){
  const tex=carLiveryTex(lv,m.crisp||quality==='high'?2048:1024,m.crisp?320:NUM_PX[quality]||208);
  if(m.liveryTex)m.liveryTex.dispose();m.liveryTex=tex;m.carPaint.map=tex;m.carPaint.needsUpdate=true;m.numbers={fontOk:!lv.number||numFontReady(lv.numFont)};
}
// A custom car's livery: the stock car's atlas with the Garage options the admin allowed. Numbers go on
// as decals where the admin placed a spot and are painted on at the stock spots everywhere else.
function customLiveryLv(lv,rec){const gar=carGarage(rec),N=rec.numbers;
  return {...lv,pattern:gar.schemes?lv.pattern:'solid',scheme:gar.schemes?lv.scheme:undefined,custom:gar.schemes?lv.custom:undefined,noLogo:!gar.logos,
    number:gar.numbers?lv.number:'',numDoors:lv.numDoors&&!N.door,numRoof:lv.numRoof&&!N.roof,numTail:lv.numTail&&!N.tail};}
// `a` is the prepared custom car (custom-cars.js): its own projection map fits the logos and numbers to its
// panels, and both livery layers go back so the bake can wrap them over its seams.
function customLivery(lv,a,o={}){
  if(!CAR_REGIONS)return null;const regions=parseRegions(CAR_REGIONS);if(!regions.length)return null;
  const t=carLiveryTex(customLiveryLv(lv,a.rec),1024,o.crisp?320:NUM_PX[quality]||208,{geo:customGeo(a,regions),plan:null,layers:true}),canvas=t.image,layers=t.userData.layers;t.dispose();
  return {canvas,regions,base:layers&&layers.base,decals:layers&&layers.decals};
}
function buildStockCar(lv,o={}){
  const root=new THREE.Group(),body=new THREE.Group();root.add(body);
  const g=new THREE.Group();g.rotation.y=-Math.PI/2;g.scale.setScalar(TM_S);body.add(g);
  const paint=new THREE.MeshPhysicalMaterial({color:0xffffff,vertexColors:true,roughness:0.3,metalness:0.2,clearcoat:1,clearcoatRoughness:0.08});
  const interior=new THREE.MeshStandardMaterial({vertexColors:true,roughness:0.85,metalness:0.2});
  const glass=new THREE.MeshPhysicalMaterial({color:0x3c4a54,roughness:0.04,metalness:0,clearcoat:1,clearcoatRoughness:0.03,transparent:true,opacity:0.38,depthWrite:false,side:THREE.DoubleSide});
  const lexan=new THREE.MeshPhysicalMaterial({color:0xe8eef2,roughness:0.04,metalness:0,clearcoat:1,clearcoatRoughness:0.03,transparent:true,opacity:0.2,depthWrite:false,side:THREE.DoubleSide});
  const tire=new THREE.MeshStandardMaterial({color:0x161616,roughness:0.92});
  const rim=new THREE.MeshStandardMaterial({color:0x9aa0a8,roughness:0.35,metalness:0.8});
  const tail=new THREE.MeshPhysicalMaterial({color:0x5a0008,emissive:0xff1a26,emissiveIntensity:0.2,roughness:0.1,clearcoat:1});
  const M=[paint,interior,glass,tire,rim,tail,lexan],wheels=[];let bodyMesh=null;
  for(const p of CAR_ASSET){const mesh=new THREE.Mesh(p.geo.clone(),M);mesh.castShadow=true;mesh.receiveShadow=true;
    if(p.center){const pivot=new THREE.Group();pivot.position.fromArray(p.center);g.add(pivot);pivot.add(mesh);wheels.push({pivot,w:mesh,front:p.center[0]>0,spinZ:true});}
    else{g.add(mesh);bodyMesh=mesh;}}
  const paints=[paint,glass,lexan];for(const m of paints){m.envMap=envTex;m.envMapIntensity=ENVK;}
  const bumperF=new THREE.Group(),bumperR=new THREE.Group();body.add(bumperF,bumperR);
  const orig=Float32Array.from(bodyMesh.geometry.attributes.position.array);
  const m={root,body,bodyMesh,orig,deform:[{geo:bodyMesh.geometry,orig,scuff:true}],wheels,bumperF,bumperR,paints,light:null,brakeMat:tail,tm:true,tmg:g,car:true,carPaint:paint,liveryTex:null,modelScale:TM_S,crisp:!!o.crisp,numbers:null};
  mountCarLivery(m,lv);return m;
}
function buildCar(lv,o={}){
  if(!lv.pace&&carIdOf(lv.veh||'')){const a=customCarReady(lv.veh);
    if(a){const m=buildCustomCar(a,lv,{modelScale:TM_S,carAsset:CAR_ASSET,crisp:o.crisp,envTex,envK:ENVK,livery:l=>customLivery(l,a,o)});mountNumbers(m,lv);return m;}
    if(CAR_ASSET)return buildStockCar(lv,o);}
  if(lv.veh==='car'&&!lv.pace&&CAR_ASSET)return buildStockCar(lv,o);
  const root=new THREE.Group(),body=new THREE.Group();root.add(body);
  body.scale.setScalar(TRUCK_SCALE);
  const {group:g,materials:M}=TM.buildTruck(THREE,{grilleTexture:TM_GRILLE});
  g.rotation.y=-Math.PI/2;g.scale.setScalar(TM_S);body.add(g);
  M.paint.color.set(lv.primary);M.bed.color.set(new THREE.Color(lv.primary).multiplyScalar(0.55));
  M.tail.emissive.set(0xff1a26);M.tail.emissiveIntensity=0.2;
  const bodyMesh=g.getObjectByName('Body'),bodyPaint=M.paint.clone();bodyPaint.vertexColors=true;bodyMesh.material=[bodyPaint,M.carbon];
  bodyMesh.geometry.setAttribute('color',new THREE.BufferAttribute(new Float32Array(bodyMesh.geometry.attributes.position.count*3).fill(1),3));
  const decalMat=map=>new THREE.MeshPhysicalMaterial({map,transparent:true,depthWrite:false,roughness:0.3,metalness:0.2,clearcoat:1,clearcoatRoughness:0.08,side:THREE.DoubleSide,polygonOffset:true,polygonOffsetFactor:-4,polygonOffsetUnits:-4});
  const decals=[];
  for(const s of [-1,1]){const left=s<0;
    const geo=tmGrid(84,18,(a,b)=>{const x=TM_X1-a*TM_L;let y=TM_Y0+b*(TM_Y1-TM_Y0);const st=TM.station(x);y=Math.min(y,st.yt-0.012);y=Math.max(y,st.yb+0.012);
      return [x,y,s*(TM.sideZ(x,y)+0.006),left?a:1-a,b];});
    decals.push(new THREE.Mesh(geo,decalMat(tmSideTex(lv,left))));}
  decals.push(new THREE.Mesh(tmGrid(24,30,(a,b)=>{const z=-0.8+a*1.6,x=1.08+b*1.42;return [x,TM.topY(x,z)+0.005,z,a,b];}),decalMat(tmHoodTex(lv))));
  if(lv.pace)decals.push(new THREE.Mesh(tmGrid(24,16,(a,b)=>{const z=-0.6+a*1.2,x=-0.55+b*0.77;return [x,tmCabY(x,z)+0.006,z,a,b];}),decalMat(tmRoofTex())));
  for(const d of decals){d.receiveShadow=true;g.add(d);}
  const deform=[{geo:bodyMesh.geometry,orig:Float32Array.from(bodyMesh.geometry.attributes.position.array),scuff:true},...decals.map(d=>({geo:d.geometry,orig:Float32Array.from(d.geometry.attributes.position.array)}))];
  const wheels=[];
  for(const w of g.children.filter(o=>o.name.startsWith('Wheel_'))){const pivot=new THREE.Group();pivot.position.copy(w.position);g.add(pivot);pivot.add(w);w.position.set(0,0,0);wheels.push({pivot,w,front:w.name.includes('_F'),spinZ:true});}
  if(BATCH){batchStatic(g,[bodyMesh,...decals,...wheels.map(w=>w.pivot)]);for(const {w} of wheels)batchStatic(w);}
  const paints=[bodyPaint,M.paint,M.glass,M.smoke,M.badge,...decals.map(d=>d.material)];
  for(const m of paints){if(m.isMeshPhysicalMaterial){m.envMap=envTex;m.envMapIntensity=ENVK;}}
  let light=null;
  if(lv.pace){light=new THREE.Mesh(new THREE.CapsuleGeometry(0.07,1.0,4,8).rotateZ(Math.PI/2),new THREE.MeshStandardMaterial({color:0x332200,emissive:0xffa000,emissiveIntensity:2}));light.position.set(0,1.5,-0.1);body.add(light);}
  const bumperF=new THREE.Group(),bumperR=new THREE.Group();body.add(bumperF,bumperR);
  const m={root,body,bodyMesh,orig:deform[0].orig,deform,wheels,bumperF,bumperR,paints,light,brakeMat:M.tail,tm:true,tmg:g,modelScale:TM_S*TRUCK_SCALE,crisp:!!o.crisp,numbers:null};
  mountNumbers(m,lv);
  return m;
}
function refreshNumberFonts(){
  const upd=c=>{if(!c)return;const N=c.m.numbers;if(((N&&!N.fontOk)||(c.m.custom&&c.m.liveryFontOk===false))&&numFontReady(c.lv.numFont))mountNumbers(c.m,c.lv);};
  cars.forEach(upd);upd(menuCar);if(mode==='garage')renderGarage();
}
function deformCar(c,lp,dir,amt){
  const s=c.m.modelScale,L=[lp[2]/s,lp[1]/s,-lp[0]/s],D=[dir[2],dir[1],-dir[0]];
  const r=(0.8+Math.min(0.9,amt*0.035))/s,push=Math.min(0.3,amt*0.015)/s,cap=0.42/s;
  for(const part of c.m.deform){const g=part.geo,pa=g.attributes.position,ca=part.scuff?g.attributes.color:null,o=part.orig;
    for(let i=0;i<pa.count;i++){
      const x=pa.getX(i),y=pa.getY(i),z=pa.getZ(i),dx=x-L[0],dy=(y-L[1])*0.6,dz=z-L[2],d=Math.sqrt(dx*dx+dy*dy+dz*dz);
      if(d>=r)continue;const k=(1-d/r)**2,ox=o[i*3],oy=o[i*3+1],oz=o[i*3+2];
      const hs=Math.sin(ox*91.7+oy*47.3+oz*13.1)*43758.5453,jit=hs-Math.floor(hs)-0.5;
      let ex=x+D[0]*push*k*(1+jit*0.8)+jit*push*k*0.25-ox,ey=y-push*k*(0.2+jit*0.5)-oy,ez=z+D[2]*push*k*(1+jit*0.8)-oz;
      const el=Math.hypot(ex,ey,ez);if(el>cap){const f=cap/el;ex*=f;ey*=f;ez*=f;}
      pa.setXYZ(i,ox+ex,oy+ey,oz+ez);
      if(ca){const cv=Math.max(0.32,ca.getX(i)-0.42*k*(0.75+jit*0.5));ca.setXYZ(i,cv,cv*0.98,cv*0.96);}
    }
    pa.needsUpdate=true;if(ca)ca.needsUpdate=true;g.computeVertexNormals();}
}

class Car{
  constructor(id,lv,o={}){
    this.lv=lv;this.m=buildCar(lv,{crisp:!!o.player});this.m.root.scale.setScalar(CFG.carScale);scene.add(this.m.root);
    Object.assign(this,createCar(id,{local:o.local,ai:o.ai,pace:o.pace,player:o.player,stockCar:!!this.m.car}));
    if(!this.isPlayer){this.tag=makeTag(lv);this.m.root.add(this.tag);}
    Object.assign(this,{buf:[],wheelRot:0,aLat:0,aLong:0,prevVf:0,prevH:0,markT:0,smokeT:0,sndT:0,lastSeen:performance.now(),lastState:null});
  }
  place(s,lat){simPlace(WORLD,this,s,lat);this.prevH=this.h;}
  get prog(){return (this.cross-2)*P+this.sp;}
  get speed(){return Math.hypot(this.vx,this.vz);}
  dispose(){scene.remove(this.m.root);this.m.root.traverse(o=>{if(o.geometry)o.geometry.dispose();const ms=o.material?(Array.isArray(o.material)?o.material:[o.material]):[];
    ms.forEach(m=>{if(m.map&&!m.map.userData.shared)m.map.dispose();m.dispose();});});}
}

// ===================== SIMULATION EVENTS =====================
// sim/ (physics.ts, ai.ts, race.ts) steps the cars and reports what happened; the classic renderer draws it,
// plays it and sends it on.
function drainSim(){
  for(const e of WORLD.events){
    if(e.t==='sparks')spawnSparks(e.x,e.y,e.z,e.n,e.vx,e.vz);
    else if(e.t==='impact'){const c=cars.get(e.id);spawnSparks(e.x,e.y,e.z,Math.min(50,Math.floor(e.v*4)),e.vx,e.vz);if(e.v>6)spawnSmoke(e.x,e.y,e.z,e.vx,e.vz,false,1.6);
      if(GPU&&GPU.debris&&e.v>=7){const tp=toTrack(e.x,e.z);GPU.debris.spawn(e.x,e.y,e.z,normalAt(tp.s,tp.lat,_v),e.vx,e.vz,e.v,c&&c.lv?c.lv.primary:undefined);}
      const now=performance.now();if(c&&now-c.sndT>150){c.sndT=now;crashSnd(e.v,camera.position.distanceTo(_v.set(e.x,e.y,e.z)));}}
    else if(e.t==='damage'){const c=cars.get(e.id);if(c)deformCar(c,e.lp,e.dir,e.amt);
      if(NET.online){const msg={t:'d',i:e.id,p:e.lp,n:e.dir,a:+e.amt.toFixed(2),z:e.zone};NET.host?sendAll(msg):sendHost(msg);}}
    else if(e.t==='lap')submitLap(e.ms);
  }
  WORLD.events.length=0;
}
function applyDamageMsg(d){
  const c=cars.get(d.i);if(!c||c.local||!['f','r','l','rt'].includes(d.z))return;
  const a=clamp(+d.a||0,0,100);c.dmg[d.z]=Math.min(100,c.dmg[d.z]+a);
  if(Array.isArray(d.p)&&Array.isArray(d.n))deformCar(c,d.p.map(Number),d.n.map(Number),a);
}
// ===================== RACE STATE =====================
const cars=WORLD.cars;
let player=null,menuCar=null,mode='menu',camMode='chase',camH=0,camSnap=true,lastPhase='idle';
const race=WORLD.race;
let settings={laps:25,ai:11,night:new URLSearchParams(location.search).get('night')==='1',diff:'medium'};
// AI_LEVELS (sim/config.ts) sets each level's corner aim, braking, passing reach, grip and power edge and aggression.
// pace/vary: lap-time target as a multiple of the track baseline (the average of its top 20 Time Attack laps),
// with each car drawn within +/- vary of it, so a Hard field runs right at the record-board average.
// Track baseline: the average of the top 20 Time Attack laps on this track (seconds), or null with too few laps.
// A new board with fewer than 3 laps borrows the classic board's (the next model laps within 3 % of it).
function aiBaseline(){const pick=list=>(list||[]).slice(0,20).map(r=>r.milliseconds).filter(ms=>ms>=TRACK.minLap);
  let l=pick(REC.lists['time-attack']);if(l.length<3)l=pick(REC.classicAttack);
  return l.length>=3?l.reduce((a,b)=>a+b,0)/l.length/1000:null;}
// ag: chance an AI races a car alongside hard (holds its line, door to door) instead of giving it room
// Each vehicle (truck, Super Late Model) keeps its own saved paint scheme; 'sts_livery' remembers the last one used.
const lvKey=v=>'sts_livery_'+v;
function saveLv(){store.set('sts_livery',myLv);store.set(lvKey(myLv.veh),myLv);}
let myLv=(()=>{const last=cleanLv(store.get('sts_livery',DEFAULT_LV)),own=store.get(lvKey(last.veh),null);return own?cleanLv({...own,veh:last.veh}):last;})();if(!myLv.number)myLv.number='7';saveLv();
let quality=store.get('sts_q','med');

const MODE_NAMES={'time-attack':'Time Attack','race':'Solo Race','multiplayer':'Online'};
const RUN_ID=(crypto.randomUUID&&crypto.randomUUID())||'00000000-0000-4000-8000-'+String(Date.now()).slice(-12).padStart(12,'0');
// Record boards: the next vehicle model races on versioned keys (`prison-v2` ...); the classic boards are read-only.
const REC_TRACK=WORLD.model==='next'?TRACK.rec+'-v2':TRACK.rec;
const REC={lists:{},state:{},me:null,warned:false,classicAttack:null};let runLap=0;
async function fetchRecords(mode){
  REC.state[mode]='loading';
  try{const r=await fetch(`/api/racing?records=1&mode=${mode}&track=${REC_TRACK}`,{credentials:'same-origin'});
    if(r.status===401){REC.state[mode]='signedout';return {error:'Sign in on the library to see and set lap records.'};}
    if(!r.ok){REC.state[mode]='error';console.warn('records',mode,r.status,await r.text().catch(()=>''));
      return {error:REC.me?`Lap records are unavailable right now (${r.status}).`:'Sign in on the library to see and set lap records.'};}
    const d=await r.json();REC.lists[mode]=d.records||[];REC.state[mode]='ok';return {records:REC.lists[mode]};}
  catch(e){REC.state[mode]='error';return {error:'Lap records are saved when this module runs on the library.'};}
}
function recRows(list,mine){return '<tr><th>#</th><th>Driver</th><th>Lap</th><th>Date</th></tr>'+(list.length?list.map((r,i)=>`<tr${mine&&r.username===mine?' class="me"':''}><td>${i+1}</td><td>${esc(r.username)}</td><td>${fmtLap(r.milliseconds)}</td><td>${esc(new Date(r.date).toLocaleDateString())}</td></tr>`).join(''):'<tr><td colspan="4">No laps yet. Set the first one.</td></tr>');}
const fmtLap=ms=>{const t=ms/1000,m=Math.floor(t/60);return (m?m+':'+String((t%60).toFixed(3)).padStart(6,'0'):(t).toFixed(3));};
async function showRecords(boxId,mode){
  const box=$(boxId);if(!box)return;box.dataset.mode=mode;
  box.innerHTML='<div class="rectabs" role="tablist">'+Object.keys(MODE_NAMES).map(m=>`<button role="tab" aria-selected="${m===mode}" class="${m===mode?'on':''}" data-rec="${m}">${MODE_NAMES[m]}</button>`).join('')+'</div><table class="rec"></table><p>Loading...</p>';
  const res=await fetchRecords(mode);if(box.dataset.mode!==mode)return;
  box.querySelector('table').innerHTML=res.records?recRows(res.records,REC.me):'';
  box.querySelector('p').textContent=res.error||`Top 20 ${MODE_NAMES[mode]} laps \u00b7 ${TRACK.name}`+(race.mode===mode&&player&&player.bestLap?` \u00b7 your best this session ${fmtLap(player.bestLap*1000)}`:'');
}
function submitLap(ms){
  if(ms<TRACK.minLap||WORLD.model!=='next'||TT.blocksLaps())return;const mode=race.mode;runLap++;const best=(REC.lists[mode]||[])[0];
  fetch('/api/racing',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'lap',run:RUN_ID,lap:runLap,milliseconds:Math.round(ms),mode,track:REC_TRACK})})
    .then(async r=>{
      if(r.status===401||(r.status===403&&!REC.me)){if(!REC.warned){REC.warned=true;toast('Sign in on the library to save your lap records');}return;}
      if(!r.ok){console.warn('lap submit',r.status);return;}
      const attack=mode==='time-attack';
      if(attack&&(!best||ms<best.milliseconds))bigMsg('NEW TRACK RECORD',`${MODE_NAMES[mode]} \u00b7 ${fmtLap(ms)}`,3);
      else if(attack&&((REC.lists[mode]||[]).length<20||ms<REC.lists[mode][REC.lists[mode].length-1].milliseconds))toast(`Top 20 lap: ${fmtLap(ms)}`);
      fetchRecords(mode);try{if(window.parent!==window)window.parent.postMessage({type:'tl-lap',track:REC_TRACK,mode},location.origin);}catch(e){}
    }).catch(()=>{});
}
const standings=()=>simStandings(WORLD);
const nowS=()=>SIM.now();
function onPhase(ph){
  const fc={pace:0xffcc00,caution:0xffcc00,green:0x2ec46d,attack:0x2ec46d};
  flagMat.map=null;flagMat.color.set(fc[ph]??0xffffff);
  if(ph==='checkered'||ph==='done'){flagMat.map=TEX.checker;flagMat.color.set(0xffffff);}
  flagMat.needsUpdate=true;
  if(ph==='green'||ph==='caution'||ph==='checkered')crowdHype=2.2;
  if(ph==='green'){bigMsg('GREEN FLAG!',player&&race.mode!=='time-attack'?'You have the wheel':'',2.5);say('Green, green, green');}
  if(ph==='caution'){bigMsg('CAUTION','Slow down and hold your spot',3);say('Caution is out');}
  if(ph==='checkered')bigMsg('CHECKERED FLAG','',3);
  if(ph==='done')showResults();
}

// ===================== RACE SETUP =====================
// A custom body that finished loading after the race was set up replaces the stand-in stock car in place.
function swapCarModel(c){
  const old=c.m,m=buildCar(c.lv,{crisp:c.isPlayer});m.root.scale.setScalar(CFG.carScale);
  m.root.position.copy(old.root.position);m.root.quaternion.copy(old.root.quaternion);m.root.visible=old.root.visible;
  if(c.tag){old.root.remove(c.tag);m.root.add(c.tag);}
  scene.add(m.root);Car.prototype.dispose.call({m:old});c.m=m;c.stockCar=!!m.car;
}
function clearCars(){cars.forEach(c=>c.dispose());cars.clear();player=null;}
function beginRace(msg){
  clearCars();TT.refresh();if(menuCar)menuCar.m.root.visible=false;
  const attack=!!(msg.set&&msg.set.attack);if(attack)settings.night=!!msg.set.night;else{settings={...settings,...msg.set};delete settings.attack;}setNight(!!settings.night);
  simBeginRace(WORLD,msg.grid,{attack,laps:settings.laps,mode:attack?'time-attack':NET.online?'multiplayer':'race',myId:NET.myId,host:NET.host,make:(e,f)=>new Car(e.id,cleanLv(e.lv),f)});
  lastPhase=race.ph;resetMarks();fetchRecords(race.mode);player=cars.get(NET.myId)||null;
  for(const c of cars.values())if(carIdOf(c.lv.veh||'')&&!customCarReady(c.lv.veh))Promise.all([ensureCustomCar(c.lv.veh),carAssetReady]).then(([a])=>{if(a&&cars.get(c.id)===c)swapCarModel(c);});
  // Pace truck removed: the rolling start is still led by the virtual formation reference (race.formP).
  setNight(!!settings.night);
  camH=player.h;camSnap=true;camMode='chase';
  mode='race';showScreen(null);$('hud').classList.remove('hidden');onPhase(race.ph);
  if(attack)bigMsg('TIME ATTACK',`${TRACK.name} \u00b7 the clock starts when you cross the line`,4);else bigMsg('ROLLING START',`${TRACK.name} \u00b7 autopilot holds the field two wide \u00b7 you take over at the green`,4);
}
// The AI field comes from AI_FIELD (named drivers, fixed numbers, paint schemes and sponsor logos); sim/race.ts
// buildGrid draws the starters, their skill and the grid order exactly as before.
function hostStart(){
  readHostSettings();
  const field=AI_FIELD.map(l=>cleanLv(l)),byNum=new Map(field.map(l=>[l.number,l]));
  const humans=[...NET.players.values()].map(p=>({id:p.id,number:p.lv.number}));
  const grid=buildGrid(()=>SIM.rand(),humans,field.map(l=>l.number),{ai:settings.ai,diff:settings.diff||'medium'},aiBaseline(),CFG.maxCars)
    .map(({number,...e})=>e.ai?{...e,lv:{...byNum.get(number),veh:myLv.veh}}:{...e,lv:NET.players.get(e.id).lv});
  const set={...settings};delete set.attack;const msg={t:'start',set,grid};sendAll(msg);beginRace(msg);
}
function readHostSettings(){settings.laps=+$('sLaps').value||25;settings.ai=clamp(parseInt($('sAI').value)||0,0,19);settings.diff=AI_LEVELS[$('sDiff').value]?$('sDiff').value:'medium';}

// ===================== NETWORK (PeerJS, host-authoritative race control) =====================
const PREFIX=ROOM_PREFIX;
const NET={peer:null,online:false,host:false,myId:'host',code:'',conns:new Map(),hc:null,players:new Map()};
function resetNet(){const peer=NET.peer;Object.assign(NET,{peer:null,online:false,host:false,myId:'host',code:'',conns:new Map(),hc:null,players:new Map()});try{peer&&peer.destroy();}catch(e){}}
function sendAll(msg,except){if(!NET.online||!NET.host)return;for(const [id,c] of NET.conns)if(id!==except&&c.open)try{c.send(msg);}catch(e){}}
function sendHost(msg){if(NET.hc&&NET.hc.open)try{NET.hc.send(msg);}catch(e){}}
function broadcastLobby(){sendAll({t:'lobby',players:[...NET.players.values()],set:settings,racing:race.ph!=='idle',track:TRACK_ID});renderLobby();}
function makeCode(){const A='ABCDEFGHJKLMNPQRSTUVWXYZ';let s='';for(let i=0;i<5;i++)s+=A[Math.floor(Math.random()*A.length)];return s;}
function startTimeAttack(){
  resetNet();NET.host=true;NET.online=false;NET.myId='host';NET.players.set('host',{id:'host',lv:myLv});
  beginRace({t:'start',set:{...settings,attack:true,ai:0},grid:[{id:'host',lv:myLv,ai:false}]});
}
function startHost(online){
  resetNet();NET.host=true;NET.online=online;NET.myId='host';NET.players.set('host',{id:'host',lv:myLv});
  if(!online){goLobby();return;}
  if(typeof Peer==='undefined'){toast('Online play could not load (PeerJS blocked).');NET.online=false;return;}
  toast('Opening a room...');
  const tryOpen=()=>{
    NET.code=makeCode();const peer=new Peer(PREFIX+NET.code,{debug:0});NET.peer=peer;
    peer.on('open',()=>{goLobby();toast('Room '+NET.code+' is open');tlPostRoom(NET.code);});
    peer.on('error',e=>{if(e.type==='unavailable-id'){peer.destroy();tryOpen();}else toast('Network: '+e.type);});
    peer.on('connection',conn=>{conn.on('open',()=>NET.conns.set(conn.peer,conn));conn.on('data',d=>hostRecv(conn,d));conn.on('close',()=>dropPlayer(conn.peer));});
  };
  tryOpen();
}
function doJoin(){
  const code=$('joinCode').value.trim().toUpperCase();
  if(code.length!==5){toast('Enter the 5-letter room code');return;}
  if(typeof Peer==='undefined'){toast('Online play could not load (PeerJS blocked).');return;}
  resetNet();NET.online=true;NET.host=false;toast('Connecting...');
  const peer=new Peer({debug:0});NET.peer=peer;
  peer.on('open',id=>{NET.myId=id;NET.code=code;const conn=peer.connect(PREFIX+code,{serialization:'json',reliable:true});NET.hc=conn;
    conn.on('open',()=>conn.send({t:'hello',lv:myLv,pv:PROTOCOL_VERSION,ph:WORLD.model}));conn.on('data',clientRecv);
    conn.on('close',()=>{if(NET.hc===conn){toast('Lost connection to the host');leaveAll();}});});
  peer.on('error',e=>{toast(e.type==='peer-unavailable'?'No room with that code':'Network: '+e.type);if(e.type==='peer-unavailable')leaveAll();});
}
function hostRecv(conn,d){
  if(!d||typeof d!=='object')return;const id=conn.peer;
  switch(d.t){
    case 'hello':
      if(!helloAccepted(d,WORLD.model)){try{conn.send({t:'version',pv:PROTOCOL_VERSION,ph:WORLD.model});}catch(e){}setTimeout(()=>conn.close(),3000);return;}
      if(NET.players.size>=CFG.maxCars&&!NET.players.has(id)){try{conn.send({t:'full'});}catch(e){}setTimeout(()=>conn.close(),3000);return;}
      NET.conns.set(id,conn);NET.players.set(id,{id,lv:cleanLv(d.lv)});broadcastLobby();chatLine('',NET.players.get(id).lv.name+' joined');break;
    case 's':if(d.s&&d.s.i===id)applyState(d.s);break;
    case 'd':if(d.i===id){applyDamageMsg(d);sendAll(d,id);}break;
    case 'chat':{const p=NET.players.get(id);if(!p)return;const m={t:'chat',n:p.lv.name,m:String(d.m||'').slice(0,120)};sendAll(m);chatLine(m.n,m.m);}break;
  }
}
function dropPlayer(id){
  NET.conns.delete(id);const p=NET.players.get(id);NET.players.delete(id);if(p)chatLine('',p.lv.name+' left');
  const c=cars.get(id);if(c){c.vis=false;if(c.lastState)c.lastState.v=0;}
  if(race.ph==='idle')broadcastLobby();
}
function clientRecv(d){
  if(!d||typeof d!=='object')return;
  switch(d.t){
    case 'lobby':if(d.track&&TRACKS[d.track]&&d.track!==TRACK_ID){const q=new URLSearchParams(location.search);q.set('track',d.track);q.set('room',NET.code);location.search=q.toString();return;}NET.racing=!!d.racing;NET.players=new Map((d.players||[]).map(p=>[p.id,{id:p.id,lv:cleanLv(p.lv)}]));settings=d.set||settings;setNight(!!settings.night);
      if(['menu','garage','multi','track','setup','records'].includes(mode))goLobby();else if(mode==='lobby')renderLobby();break;
    case 'start':beginRace(d);break;
    case 'w':if(Array.isArray(d.c))d.c.forEach(applyState);if(d.r){race.ph=d.r.ph;race.laps=d.r.laps;race.fo=d.r.fo||[];race.gn=!!d.r.gn;race.formP=typeof d.r.fp==='number'?d.r.fp:race.ph==='pace'?race.formP:null;}break;
    case 'd':applyDamageMsg(d);break;
    case 'chat':chatLine(d.n,d.m);break;
    case 'back':NET.racing=false;backToLobby();break;
    case 'full':toast('That race is full or already running');leaveAll();break;
    case 'version':toast(d.ph&&d.ph!==WORLD.model?PHYSICS_MISMATCH:VERSION_MISMATCH);leaveAll();break;
  }
}
function stateOf(c){const d=c.dmg;return {i:c.id,x:+c.x.toFixed(2),z:+c.z.toFixed(2),h:+c.h.toFixed(3),vx:+c.vx.toFixed(2),vz:+c.vz.toFixed(2),st:+c.steer.toFixed(2),th:c.thr,
  sl:+c.slip.toFixed(1),b:c.brk,c:c.cross,sp:+c.sp.toFixed(1),dm:[d.f,d.r,d.l,d.rt].map(Math.round),f:c.fin?1:0,bl:c.bestLap,ll:c.lastLap,v:c.vis?1:0};}
function applyState(st){
  if(!st)return;const c=cars.get(st.i);if(!c||c.local)return;const now=performance.now();
  c.lastState=st;c.lastSeen=now;c.buf.push({t:now,x:+st.x,z:+st.z,h:+st.h});if(c.buf.length>20)c.buf.shift();
  c.vx=+st.vx||0;c.vz=+st.vz||0;c.steer=+st.st||0;c.thr=st.th?1:0;c.brk=st.b?1:0;c.slip=+st.sl||0;c.cross=st.c|0;c.sp=+st.sp||0;c.fin=!!st.f;c.bestLap=st.bl;c.lastLap=st.ll;c.vis=!!st.v;
  if(Array.isArray(st.dm))[c.dmg.f,c.dmg.r,c.dmg.l,c.dmg.rt]=st.dm.map(v=>clamp(+v||0,0,100));
}
function interp(c,now){
  const b=c.buf;if(b.length){
    const rt=now-110;let A=null,B=null;
    for(let i=b.length-1;i>=0;i--)if(b[i].t<=rt){A=b[i];B=b[i+1]||null;break;}
    if(A&&B){const k=(rt-A.t)/(B.t-A.t||1);c.x=lerp(A.x,B.x,k);c.z=lerp(A.z,B.z,k);c.h=A.h+wrapA(B.h-A.h)*k;}
    else if(!A){c.x=b[0].x;c.z=b[0].z;c.h=b[0].h;}
    else{const ex=Math.min(0.25,Math.max(0,(rt-A.t)/1000));c.x=A.x+c.vx*ex;c.z=A.z+c.vz*ex;c.h=A.h;}
    c.tp=toTrack(c.x,c.z);
  }
  if(now-c.lastSeen>4000&&c.id!=='pace'&&!NET.host&&c.buf.length)c.vis=false;
}
let netT=0;
function netTick(dt){
  if(!NET.online||!(mode==='race'||mode==='paused'||mode==='results'))return;
  netT+=dt;if(netT<0.05)return;netT=0;
  if(NET.host){const arr=[];cars.forEach(c=>{if(c.local)arr.push(stateOf(c));else if(c.lastState)arr.push(c.lastState);});
    sendAll({t:'w',c:arr,r:{ph:race.ph,laps:race.laps,fo:race.fo,gn:race.gn,fp:race.formP}});}
  else if(player)sendHost({t:'s',s:stateOf(player)});
}

// ===================== AUDIO (ElevenLabs engine loops, synthesized fallback) =====================
const AU={ctx:null,on:store.get('sts_snd',true)};
function audioInit(){
  if(AU.ctx){if(AU.ctx.state==='suspended')AU.ctx.resume();return;}
  const C=window.AudioContext||window.webkitAudioContext;if(!C)return;const ctx=new C();AU.ctx=ctx;
  const M=ctx.createGain();M.gain.value=AU.on?0.7:0;M.connect(ctx.destination);AU.master=M;
  const nb=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate),nd=nb.getChannelData(0);for(let i=0;i<nd.length;i++)nd[i]=Math.random()*2-1;AU.noise=nb;
  const loop=()=>{const s=ctx.createBufferSource();s.buffer=nb;s.loop=true;s.start();return s;};
  const osc=t=>{const o=ctx.createOscillator();o.type=t;o.start();return o;};
  const filt=(t,f,q)=>{const b=ctx.createBiquadFilter();b.type=t;b.frequency.value=f;b.Q.value=q||1;return b;};
  const gain=v=>{const g=ctx.createGain();g.gain.value=v;return g;};
  AU.e1=osc('sawtooth');AU.e2=osc('square');AU.ef=filt('lowpass',900,3);AU.eg=gain(0);
  AU.e1.connect(AU.ef);AU.e2.connect(gain(0.45)).connect(AU.ef);AU.ef.connect(AU.eg).connect(M);
  AU.tg=gain(0);loop().connect(filt('bandpass',1150,2.5)).connect(AU.tg).connect(M);
  AU.o1=osc('sawtooth');AU.og=gain(0);AU.o1.connect(filt('lowpass',1000,1)).connect(AU.og).connect(M);
  AU.cg=gain(0.02);loop().connect(filt('lowpass',500,0.7)).connect(AU.cg).connect(M);
}
function toggleMute(){AU.on=!AU.on;store.set('sts_snd',AU.on);if(AU.master)AU.master.gain.value=AU.on?0.7:0;toast(AU.on?'Sound on':'Sound muted');if(!AU.on&&window.speechSynthesis)speechSynthesis.cancel();}
function crashSnd(v,dist){
  if(!AU.ctx||!AU.on)return;const vol=Math.min(1,v/14)*Math.min(1,25/(dist+5));if(vol<0.03)return;
  const ctx=AU.ctx,t=ctx.currentTime,src=ctx.createBufferSource();src.buffer=AU.noise;
  const f=ctx.createBiquadFilter();f.type='lowpass';f.frequency.value=900+v*80;const g=ctx.createGain();
  g.gain.setValueAtTime(vol*0.9,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.35+v*0.02);
  src.connect(f).connect(g).connect(AU.master);src.start(t,Math.random());src.stop(t+0.9);
}
const ENGINE_PITCH=17;
const rpmOf=c=>3000+Math.min(1,Math.abs(c.vf)/62)*6400+(c.thr?350:0);
function audioUpdate(){
  if(!AU.ctx)return;const t=AU.ctx.currentTime,inRace=!!player&&mode!=='menu'&&mode!=='garage'&&mode!=='lobby';
  const c=inRace?player:null,rpm=c?rpmOf(c):1050+Math.sin(t*3)*40,f=rpm/ENGINE_PITCH;
  AU.e1.frequency.setTargetAtTime(f,t,0.04);AU.e2.frequency.setTargetAtTime(f/2,t,0.04);
  AU.ef.frequency.setTargetAtTime(c&&c.thr?2400:800,t,0.08);AU.eg.gain.setTargetAtTime(c?(c.thr?0.13:0.08):0.04,t,0.08);
  AU.tg.gain.setTargetAtTime(c?clamp((c.slip-2.5)/12,0,0.3):0,t,0.05);
  AU.cg.gain.setTargetAtTime(inRace?0.05:0.02,t,0.3);
  let near=null,nd=1e9;if(c)cars.forEach(o=>{if(o===c||!o.vis)return;const d=Math.hypot(o.x-camera.position.x,o.z-camera.position.z);if(d<nd){nd=d;near=o;}});
  if(near&&nd<150){const dx=camera.position.x-near.x,dz=camera.position.z-near.z,d=Math.max(1,nd);
    const vs=((near.vx-c.vx)*dx+(near.vz-c.vz)*dz)/d,dop=343/Math.max(200,343-vs);
    AU.o1.frequency.setTargetAtTime(rpmOf(near)/ENGINE_PITCH*dop,t,0.05);AU.og.gain.setTargetAtTime(Math.min(0.12,2.2/(d+8)),t,0.08);}
  else AU.og.gain.setTargetAtTime(0,t,0.1);
}

// ===================== ENVIRONMENT / QUALITY =====================
function setNight(n){
  settings.night=n;sky.visible=n;skyDay.visible=!n;clouds.visible=!n;scene.fog.color.set(n?0x0a0f1e:DAY.fogColor);
  scene.environment=n?null:envDay;envTex=n?envNight:envDay;scene.environmentIntensity=n?1:DAY.envInt;
  hemi.intensity=n?0.4:DAY.hemiInt;hemi.color.set(n?0x8899cc:DAY.hemiSky);hemi.groundColor.set(n?0x402f1a:DAY.hemiGround);
  sun.intensity=n?1.7:DAY.sunInt;sun.color.set(n?0xeef3ff:DAY.sunColor);if(n)SUN_OFF.set(10,130,5);else SUN_OFF.set(...DAY.sunDir);
  skyDay.material.uniforms.sunPosition.value.copy(SUN_OFF).normalize();clouds.material.color.set(DAY.cloudTint);clouds.material.opacity=DAY.cloudOpacity;
  towerHeadMat.emissiveIntensity=n?4:0.15;towers.forEach(t=>t.visible=n);ENVK=n?0.12:DAY.paintEnv;if(GROOVE_MAT)GROOVE_MAT.roughness=DIRT?0.95:n?0.8:0.55;glassMat.emissiveIntensity=n?0.6:0;if(prisonInfield)prisonInfield.setNight(n);
  bloom.enabled=n;bloom.strength=0.25;bloom.threshold=0.85;scene.fog.near=n?1500:DAY.fogNear;scene.fog.far=n?3800:DAY.fogFar;
  const upd=c=>c&&c.m.paints.forEach(m=>{if(m.userData.r0==null){m.userData.r0=m.roughness;m.userData.cc0=m.clearcoat||0;}m.envMap=envTex;m.envMapIntensity=ENVK;m.roughness=n?Math.max(0.5,m.userData.r0):m.userData.r0;m.clearcoat=n?m.userData.cc0*0.3:m.userData.cc0;m.needsUpdate=true;});cars.forEach(upd);upd(menuCar);renderer.toneMappingExposure=n?.7:DAY.exposure;
}
let adaptRes=null;
function applyQuality(){
  const q=quality,dpr=window.devicePixelRatio||1;
  const maxRatio=q==='low'?Math.min(1,dpr)*0.8:q==='med'?Math.min(1.25,dpr):Math.min(2,dpr);
  if(!adaptRes)adaptRes=createAdaptiveResolution({max:maxRatio,min:Math.min(maxRatio,0.75),apply:r=>{renderer.setPixelRatio(r);resize();}});else adaptRes.setMax(maxRatio);renderer.setPixelRatio(maxRatio);
  const sh=q!=='low';if(renderer.shadowMap.enabled!==sh){renderer.shadowMap.enabled=sh;scene.traverse(o=>{if(o.material)(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>m.needsUpdate=true);});}
  const ms=q==='high'?2048:1024;if(sun.shadow.mapSize.x!==ms){sun.shadow.mapSize.set(ms,ms);if(sun.shadow.map){sun.shadow.map.dispose();sun.shadow.map=null;}}
  useComposer=q!=='low';
  buildCrowd(q==='high'?11000:q==='med'?5000:1500);buildTrees(q==='high'?900:q==='med'?450:150);resize();
}

// ===================== CAMERA / MIRROR =====================
const mirrorRT=new THREE.WebGLRenderTarget(512,128,{samples:2});
const mirrorCam=new THREE.PerspectiveCamera(32,4,0.3,700);
mirrorRT.texture.repeat.x=-1;mirrorRT.texture.offset.x=1;   // flip like a real mirror
const ovScene=new THREE.Scene(),ovCam=new THREE.OrthographicCamera(0,1,1,0,-1,1);
const ovQuad=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({map:mirrorRT.texture,depthTest:false,depthWrite:false}));ovScene.add(ovQuad);
const MIRROR={x:0,y:11,w:0,h:0};
if(GPU)GPU.attach({scene,camera,mirrorCam,sun,hemi,skyDay,sky:{turbidity:DAY.turbidity,rayleigh:DAY.rayleigh,mie:DAY.mie,mieG:DAY.mieG,sun:[...DAY.sunDir]},ground:new THREE.Color(0x4f5a2c).toArray(),towers});
function resize(){
  const w=wrap.clientWidth,h=wrap.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
  composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(w,h);
  const MW=Math.round(Math.min(460,w*0.42)),MH=Math.round(MW/4);
  Object.assign(ovCam,{left:0,right:w,top:h,bottom:0});ovCam.updateProjectionMatrix();ovQuad.scale.set(MW,MH,1);ovQuad.position.set(w/2,h-11-MH/2,0);Object.assign(MIRROR,{x:w/2-MW/2,w:MW,h:MH});
  const f=$('mirrorFrame');f.style.width=MW+6+'px';f.style.height=MH+6+'px';
}
function setFov(f){if(Math.abs(camera.fov-f)>0.05){camera.fov=lerp(camera.fov,f,0.12);camera.updateProjectionMatrix();}}
const CAM_ZOOM=0.8,_gp=new THREE.Vector3(),_gl=new THREE.Vector3(),menuLook=new THREE.Vector3();
const GVIEWS={door:{p:[0.2,6.0,1.25],l:[0.1,0,0.75],fit:6.8},roof:{p:[-2.7,0,4.6],l:[-0.15,0,1.35],fit:2.4},rear:{p:[-8.0,1.0,1.45],l:[-2.4,0,0.8],fit:2.6}};
let gView='door',viewShift='',viewAvail=1;
function applyViewShift(){
  let x=0,y=0;const w=wrap.clientWidth,h=wrap.clientHeight;
  if(mode==='garage'){const r=$('scrGarage').getBoundingClientRect(),wr=wrap.getBoundingClientRect();
    if(w>700)x=Math.round(Math.max(0,r.right-wr.left)/2);else y=Math.round(Math.max(0,wr.bottom-r.top)/2);}
  viewAvail=Math.max(0.3,(w-2*x)/w);
  const key=x+','+y+','+w+','+h;if(key===viewShift)return;viewShift=key;
  if(x||y)camera.setViewOffset(w,h,-x,y,w,h);else camera.clearViewOffset();
}
function updCamera(dt){
  const inRace=player&&(mode==='race'||mode==='paused'||mode==='results');
  applyViewShift();
  if(!inRace){const c=menuCar;if(!c)return;const y=heightAt(c.tp.s,c.tp.lat),v=mode==='garage'?GVIEWS[gView]:null;
    if(v){const fx=Math.sin(c.h),fz=Math.cos(c.h),sx=Math.cos(c.h),sz=-Math.sin(c.h);
      _gp.set(c.x+fx*v.p[0]+sx*v.p[1],y+v.p[2],c.z+fz*v.p[0]+sz*v.p[1]);_gl.set(c.x+fx*v.l[0]+sx*v.l[1],y+v.l[2],c.z+fz*v.l[0]+sz*v.l[1]);
      const d=_gp.distanceTo(_gl),need=v.fit/(0.86*viewAvail*2*Math.tan(22.5*Math.PI/180)*camera.aspect);
      if(need>d)_gp.sub(_gl).multiplyScalar(need/d).add(_gl);}
    else{const t=performance.now()/1000*0.22,r=7.5*CAM_ZOOM;_gp.set(c.x+Math.sin(t)*r,y+0.7+1.5*CAM_ZOOM,c.z+Math.cos(t)*r);_gl.set(c.x,y+0.7,c.z);}
    if(camera.position.distanceToSquared(_gp)>900){camera.position.copy(_gp);menuLook.copy(_gl);}
    else{const k=1-Math.exp(-dt*4.5);camera.position.lerp(_gp,k);menuLook.lerp(_gl,k);}
    camera.up.set(0,1,0);camera.lookAt(menuLook);setFov(45);return;}
  const c=player,pos=c.m.root.position;camH+=wrapA(c.h-camH)*(1-Math.exp(-dt*5));
  const fx=Math.sin(camH),fz=Math.cos(camH),spd=Math.abs(c.vf);
  _n.set(0,1,0).applyQuaternion(c.m.root.quaternion);
  if(camMode==='hood'){
    _f.set(0,0,1).applyQuaternion(c.m.root.quaternion);
    camera.position.copy(pos).addScaledVector(_f,0.4*CFG.carScale).addScaledVector(_n,1.3*CFG.carScale);camera.up.copy(_n);
    _v.copy(camera.position).addScaledVector(_f,30).addScaledVector(_n,-0.6);camera.lookAt(_v);setFov(45+spd*0.2);
  }else{
    const dist=(camMode==='far'?13.5:8.2)*CFG.carScale*CAM_ZOOM,hgt=(camMode==='far'?4.8:2.9)*CFG.carScale*CAM_ZOOM;
    _v.set(pos.x-fx*dist,pos.y+hgt,pos.z-fz*dist);
    if(camSnap){camera.position.copy(_v);camSnap=false;}else camera.position.lerp(_v,1-Math.exp(-dt*8));
    camera.up.set(0,1,0);camera.lookAt(pos.x+fx*5,pos.y+1.0,pos.z+fz*5);setFov(45+spd*0.28);
  }
  const mf=Math.sin(c.h),mz=Math.cos(c.h);
  mirrorCam.position.set(pos.x-mf*2.7*CFG.carScale,pos.y,pos.z-mz*2.7*CFG.carScale).addScaledVector(_n,1.2*CFG.carScale);mirrorCam.up.copy(_n);mirrorCam.lookAt(pos.x-mf*45,pos.y+0.6,pos.z-mz*45);
}

// ===================== CAR VISUALS =====================
function carVisual(c,dt){
  const m=c.m;m.root.visible=c.vis;if(!c.vis)return;
  const tp=c.tp,n=normalAt(tp.s,tp.lat,_n),y=heightAt(tp.s,tp.lat);
  m.root.position.set(c.x,y,c.z);
  _f.set(Math.sin(c.h),0,Math.cos(c.h));_f.addScaledVector(n,-_f.dot(n)).normalize();_x.crossVectors(n,_f);_m.makeBasis(_x,n,_f);m.root.quaternion.setFromRotationMatrix(_m);
  m.root.updateMatrixWorld();
  const vf=c.vx*Math.sin(c.h)+c.vz*Math.cos(c.h),idt=1/Math.max(dt,1e-3),k=1-Math.exp(-dt*5);
  c.aLong=lerp(c.aLong,(vf-c.prevVf)*idt,k);c.aLat=lerp(c.aLat,vf*wrapA(c.h-c.prevH)*idt,k);c.prevVf=vf;c.prevH=c.h;c.vf=vf;
  m.body.rotation.z=clamp(c.aLat*0.0035,-0.07,0.07);m.body.rotation.x=clamp(-c.aLong*0.004,-0.04,0.04);
  c.wheelRot+=vf*dt/0.34;for(const w of m.wheels){if(w.spinZ)w.w.rotation.z=-c.wheelRot;else w.w.rotation.x=c.wheelRot;if(w.front)w.pivot.rotation.y=c.steer*0.45;}
  const d=c.dmg;
  m.bumperF.rotation.x=d.f>55?0.12+(d.f-55)*0.006:0;m.bumperF.position.y=d.f>55?0.32-(d.f-55)*0.003:0.32;m.bumperF.visible=d.f<92;
  m.bumperR.rotation.x=d.r>55?-0.12-(d.r-55)*0.006:0;m.bumperR.position.y=d.r>55?0.38-(d.r-55)*0.003:0.38;m.bumperR.visible=d.r<92;
  m.brakeMat.emissiveIntensity=c.brk&&c.vf>0.5?3.5:0.2;
  if(m.light)m.light.material.emissiveIntensity=(performance.now()%600<300)?3:0.3;
  const cd=camera.position.distanceTo(m.root.position);
  if(c.tag)c.tag.visible=cd<70&&cd>16;   // hidden up close so it never covers the view of the car ahead
  if(DIRT&&(mode==='race'||mode==='paused'||mode==='results')){c.markT-=dt;if(c.markT<=0&&c.speed>2.5){addMark(c,Math.min(4,c.speed*0.12+0.3));c.markT=0.12;}}
  if(!DIRT&&(mode==='race'||mode==='paused'||mode==='results')){if(c.slip>4.5&&c.speed>5)skidMark(c);else c.skid=null;}
  if(cd>160||mode==='menu'||mode==='garage'||mode==='lobby')return;
  const sp=c.speed;
  if(DIRT){if(sp>8&&(c.slip>1.5||c.thr)){c.smokeT-=dt;if(c.smokeT<=0){_v.set((Math.random()-0.5)*1.6,0.25,-2.2).applyMatrix4(m.root.matrixWorld);spawnSmoke(_v.x,_v.y,_v.z,c.vx*0.2,c.vz*0.2,false,1.1+Math.min(2,c.slip*0.25),0x9a7656);c.smokeT=c.slip>3?0.03:0.07;}}}
  if(!DIRT&&c.slip>6&&sp>4){c.smokeT-=dt;if(c.smokeT<=0){_v.set(0,0.3,-1.6).applyMatrix4(m.root.matrixWorld);spawnSmoke(_v.x,_v.y,_v.z,c.vx,c.vz,false,1.3);c.smokeT=0.05;}}
  if(d.f>55||d.f+d.r+d.l+d.rt>200){c.smokeT-=dt;if(c.smokeT<=0){_v.set(0,1.0,1.7).applyMatrix4(m.root.matrixWorld);spawnSmoke(_v.x,_v.y,_v.z,c.vx,c.vz,true,1.0);c.smokeT=0.08;}}
}

// ===================== HUD / UI =====================
const E={pos:$('posBig'),lap:$('lapTxt'),times:$('times'),gaps:$('gaps'),board:$('board'),flag:$('flag'),spd:$('spd'),rpm:$('rpm'),dmgTxt:$('dmgTxt'),spot:$('spotter'),big:$('bigmsg'),hud:$('hud'),toast:$('toast'),boost:$('boostTxt')};
const DZ={};for(const z of ['f','r','l','rt'])DZ[z]=E.hud.querySelector('#dmgCar .'+z);
const fmt=t=>t==null?'--.---':(+t).toFixed(3);
function gapStr(d,ref){if(d>=P)return '-'+Math.floor(d/P)+' lap'+(d>=2*P?'s':'');return '+'+(d/ref).toFixed(1)+'s';}
let bigT=0,spotT=0,toastT=0;
function bigMsg(t,sub,dur){E.big.innerHTML=esc(t)+(sub?`<small>${esc(sub)}</small>`:'');E.big.style.opacity=1;clearTimeout(bigT);bigT=setTimeout(()=>E.big.style.opacity=0,dur*1000);}
function toast(m){E.toast.textContent=m;E.toast.style.opacity=1;clearTimeout(toastT);toastT=setTimeout(()=>E.toast.style.opacity=0,2600);}
function say(msg){
  E.spot.textContent=msg;E.spot.style.opacity=1;clearTimeout(spotT);spotT=setTimeout(()=>E.spot.style.opacity=0,1500);
  if(AU.on&&'speechSynthesis' in window){try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(msg);u.rate=1.3;u.pitch=0.9;u.volume=0.8;speechSynthesis.speak(u);}catch(e){}}
}
function flagState(){
  const ph=race.ph;if(ph==='attack')return ['TIME ATTACK','#2ec46d','#08210f'];if(ph==='pace')return ['PACE \u00b7 AUTOPILOT','#ffcc00','#111'];
  if(ph==='caution')return [race.gn?'GREEN NEXT TIME BY':'CAUTION','#ffcc00','#111'];
  if(ph==='checkered'||ph==='done')return ['CHECKERED','checker','#ff3b3b'];
  const lead=standings()[0];if(lead&&lead.cross-2===race.laps-1)return ['WHITE FLAG','#f4f4f4','#111'];
  return ['GREEN','#2ec46d','#08210f'];
}
function hudUpdate(){
  const st=standings(),me=player,i=st.indexOf(me);if(!me)return;
  E.pos.innerHTML=`P${i+1}<span>/${st.length}</span>`;
  E.lap.textContent=race.ph==='attack'?(me.cross<2?'ROLL TO THE LINE':`LAP ${me.cross-1}`):race.ph==='pace'?'ROLLING START \u00b7 AI DRIVING':me.fin?'FINISHED':`LAP ${clamp(me.cross-1,1,race.laps)} / ${race.laps}`;
  E.times.textContent=`Last ${fmt(me.lastLap)} · Best ${fmt(me.bestLap)}`+(me.lapDirty&&me.cross>=2&&race.ph!=='pace'?' · lap not counted':'');
  const ah=st[i-1],bh=st[i+1],ref=Math.max(15,Math.abs(me.vf));
  E.gaps.innerHTML=(ah?`&#9650; ${gapStr(ah.prog-me.prog,ref)} to #${esc(ah.lv.number)}`:'Leading')+'<br>'+(bh?`&#9660; ${gapStr(me.prog-bh.prog,ref)} to #${esc(bh.lv.number)}`:'');
  if(race.ph==='attack'){const L2=REC.lists['time-attack'];E.board.innerHTML=`<div class="row"><b>Top 20 laps \u00b7 ${esc(TRACK.name)}</b></div>`+(L2?L2.length?L2.map((r,k)=>`<div class="row"><span class="p">${k+1}</span><span class="nm">${esc(r.username)}</span><span class="gp">${fmtLap(r.milliseconds)}</span></div>`).join(''):'<div class="row">No laps yet</div>':(()=>{const s=REC.state['time-attack'];return '<div class="row">'+(s==='loading'||s==null?'Loading laps...':s==='signedout'&&!REC.me?'Sign in on the library to save laps':'Lap records unavailable')+'</div>';})());}
  else E.board.innerHTML=st.map((c,k)=>`<div class="row${c===me?' me':''}"><span class="p">${k+1}</span><span class="num" style="background:${c.lv.primary};color:${c.lv.numColor};${chipFont(c.lv)}">${esc(c.lv.number)}</span><span class="nm">${esc(c.lv.name)}</span><span class="gp">${k===0?'Leader':gapStr(st[0].prog-c.prog,30)}</span></div>`).join('');
  const [txt,bg,fg]=flagState();E.flag.textContent=txt;E.flag.style.background=bg==='checker'?'repeating-conic-gradient(#111 0 25%,#eee 0 50%) 0 0/14px 14px':bg;E.flag.style.color=fg;
  if(txt==='WHITE FLAG'&&!race.white){race.white=true;bigMsg('WHITE FLAG','One to go',2);flagMat.color.set(0xffffff);}
  let tot=0;for(const z in DZ){const v=me.dmg[z];tot+=v;DZ[z].style.background=v<8?'#2a3a2f':v<35?'#8a8a2a':v<65?'#d9a400':'#d62828';}
  E.dmgTxt.textContent=tot<8?'Car OK':tot<90?'Light damage':tot<200?'Heavy damage':'Car is junk';
}
function speedHud(){if(!player)return;E.spd.firstChild.nodeValue=Math.round(Math.abs(player.vf)*2.23694);E.boost.textContent=player.boost>1.0005?`Pack boost +${((player.boost-1)*100).toFixed(1)}% top speed`:'';E.rpm.style.width=(clamp((rpmOf(player)-3000)/6750,0,1)*100).toFixed(1)+'%';}
const SPOT={l:false,r:false,t:0};
function spotter(dt){
  const me=player;if(!me||race.ph==='done')return;const sh=Math.sin(me.h),ch=Math.cos(me.h);let L_=false,R_=false;
  cars.forEach(o=>{if(o===me||!o.vis)return;const dx=o.x-me.x,dz=o.z-me.z,along=dx*sh+dz*ch,side=-dx*ch+dz*sh;
    if(Math.abs(along)<5.3*CFG.carScale&&Math.abs(side)<4.5*CFG.carScale&&Math.abs(side)>0.5){if(side>0)R_=true;else L_=true;}});
  SPOT.t-=dt;let msg=null;
  if(R_&&!SPOT.r)msg=L_?'Three wide!':'Car outside';else if(L_&&!SPOT.l)msg=R_?'Three wide!':'Car inside';
  else if((SPOT.l||SPOT.r)&&!L_&&!R_)msg='Clear';else if((L_||R_)&&SPOT.t<=0)msg='Still there';
  SPOT.l=L_;SPOT.r=R_;if(msg){say(msg);SPOT.t=2.5;}
}
function showScreen(id){for(const s of document.querySelectorAll('.scr'))s.classList.toggle('hidden',s.id!==id);}
function showResults(){
  const st=standings();
  $('resTable').innerHTML='<tr><th>Pos</th><th>#</th><th>Driver</th><th>Laps</th><th>Best</th><th></th></tr>'+st.map((c,i)=>`<tr${c===player?' style="background:rgba(255,204,0,.15)"':''}><td>${i+1}</td><td><b style="display:inline-block;min-width:26px;padding:0 3px;text-align:center;border-radius:3px;background:${c.lv.primary};color:${c.lv.numColor};${chipFont(c.lv)}">${esc(c.lv.number)}</b></td><td>${esc(c.lv.name)}</td><td>${clamp(c.cross-2,0,race.laps)}</td><td>${fmt(c.bestLap)}</td><td>${c.fin||race.ph==='attack'?'':'DNF'}</td></tr>`).join('');
  $('againBtn').classList.toggle('hidden',!NET.host);$('againWait').classList.toggle('hidden',NET.host);$('againBtn').textContent=race.ph==='attack'?'New Time Attack session':'Race again';
  E.hud.classList.add('hidden');mode='results';showScreen('scrResults');

}
function renderLobby(){
  $('lobTitle').textContent=(NET.online?'Online lobby':'Solo race')+` \u00b7 ${TRACK.name}`;$('codeBox').classList.toggle('hidden',!NET.online);$('codeTxt').textContent=NET.code;
  $('plist').innerHTML=[...NET.players.values()].map(p=>`<div><b style="display:inline-block;min-width:30px;padding:0 4px;margin-right:6px;border-radius:3px;text-align:center;background:${p.lv.primary};color:${p.lv.numColor};${chipFont(p.lv)}">${esc(p.lv.number)}</b>${esc(p.lv.name)}${p.id==='host'&&NET.online?' <span style="color:var(--dim)">(host)</span>':''}</div>`).join('');
  document.querySelector('[data-steps="lobby"]').innerHTML=NET.host?stepsHtml('multi',4):'';
  $('hostSum').textContent=`${TRACK.name} \u00b7 ${settings.laps} laps \u00b7 ${settings.ai} AI trucks (${settings.diff||'medium'}) \u00b7 ${settings.night?'night':'day'}`;
  $('lobbyStart').classList.toggle('hidden',!NET.host);
  $('hostSet').classList.toggle('hidden',!NET.host);$('waitTxt').classList.toggle('hidden',NET.host);$('chatBox').classList.toggle('hidden',!NET.online);
  $('waitTxt').textContent=NET.racing&&mode==='lobby'?'A race is already running. You will be on the grid for the next one.':`Waiting for the host to start... (${settings.laps} laps, ${settings.night?'night':'day'}, ${settings.diff||'medium'} AI)`;
  $('plabel').textContent=NET.online?`Drivers (${NET.players.size}/${CFG.maxCars}) \u2014 invite as many friends as you like`:'Driver';
}
function goLobby(){mode='lobby';$('sLaps').value=String(settings.laps);$('sAI').value=settings.ai;syncNightToggle();$('sDiff').value=settings.diff||'medium';renderLobby();showScreen('scrLobby');}
function backToLobby(){if(NET.host){NET.racing=false;}clearCars();Object.assign(race,{ph:'idle',fo:[]});E.hud.classList.add('hidden');if(menuCar)menuCar.m.root.visible=true;goLobby();}
function leaveAll(){resetNet();TT.refresh();clearCars();Object.assign(race,{ph:'idle',fo:[]});E.hud.classList.add('hidden');if(menuCar)menuCar.m.root.visible=true;mode='menu';showScreen('scrMain');}
function togglePause(){
  if(mode==='race'){$('endAttackBtn').classList.toggle('hidden',race.ph!=='attack');mode='paused';$('pauseNote').textContent=NET.online?'The online race keeps running while this menu is open.':'';showScreen('scrPause');}
  else if(mode==='paused'){mode='race';showScreen(null);}
}
function chatLine(n,m){const d=document.createElement('div');d.innerHTML=n?`<b>${esc(n)}:</b> ${esc(m)}`:`<i style="color:var(--dim)">${esc(m)}</i>`;$('chatLog').appendChild(d);$('chatLog').scrollTop=1e6;}
function sendChat(){const m=$('chatIn').value.trim();if(!m)return;$('chatIn').value='';if(NET.host){const msg={t:'chat',n:myLv.name,m};sendAll(msg);chatLine(msg.n,m);}else sendHost({t:'chat',m});}

// garage
const G={name:'gName',number:'gNum',pattern:'gPat',primary:'gP1',secondary:'gP2',accent:'gP3',numColor:'gNC',numOutline:'gNO',numAccent:'gNA',numSize:'gSize'};
const PAINT_KEYS=['name','pattern','primary','secondary','accent'];
function fillPatterns(){const has=!!myLv.custom,sig=has?'c:'+myLv.custom.name:'';const el=$('gPat');if(el.dataset.sig===sig&&el.options.length)return;el.dataset.sig=sig;
  el.innerHTML=(has?[`<option value="custom">AI design: ${esc(myLv.custom.name)}</option>`]:[]).concat(PATTERNS.map(s=>`<option value="${s}">${PATTERN_NAMES[s]}</option>`)).join('');el.value=myLv.pattern;}
$('gFont').innerHTML=NUM_FONTS.map(f=>`<option value="${f.id}">${f.name}</option>`).join('');
$('gStyle').innerHTML=NUM_STYLES.map(st=>`<option value="${st.id}">${st.name}</option>`).join('');
$('gPreset').innerHTML='<option value="">Custom colors</option>'+NUM_PRESETS.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
// Pickers: a list with previous/next buttons; Left/Right arrows step the focused one (Up/Down work natively).
function garagePick(id,v){
  if(id==='gPat')return commitGarage({...myLv,pattern:v});
  if(id==='gFont'){commitGarage({...myLv,numFont:v});loadNumFont(v).then(refreshNumberFonts);return;}
  if(id==='gStyle')return commitGarage({...myLv,numStyle:v});
  if(id==='gPreset'){const p=NUM_PRESETS.find(x=>x.id===v);if(p)commitGarage({...myLv,numColor:p.fill,numOutline:p.outline,numAccent:p.accent});}
}
function stepPick(id,dir){const el=$(id);if(el.disabled)return;const opts=[...el.options].filter(o=>o.value||id!=='gPreset');if(!opts.length)return;
  const i=opts.findIndex(o=>o.value===el.value),next=opts[((i<0?(dir>0?-1:0):i)+dir+opts.length)%opts.length];el.value=next.value;garagePick(id,next.value);}
for(const id of ['gFont','gStyle','gPreset'])$(id).addEventListener('change',e=>garagePick(id,e.target.value));
$('scrGarage').addEventListener('keydown',e=>{const el=e.target;if(el.tagName!=='SELECT'||!el.closest('.gpick'))return;
  if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();stepPick(el.id,e.key==='ArrowLeft'?-1:1);}});
const sizeArt=document.createElement('canvas');
function renderGarage(){
  fillPatterns();if(painter)painter.refresh();const n=myLv;$('gNumShow').textContent=n.number?'#'+n.number:'';
  for(const k in G){const el=$(G[k]);if(document.activeElement!==el&&String(el.value)!==String(n[k]))el.value=n[k];}
  $('gSizeOut').textContent=n.numSize+'%';
  for(const [id,v] of [['gFont',n.numFont],['gStyle',n.numStyle]])if(document.activeElement!==$(id)&&$(id).value!==v)$(id).value=v;
  $('scrGarage').querySelector('[data-gslant]').setAttribute('aria-pressed',n.numSlant);
  {const p=NUM_PRESETS.find(x=>x.fill===n.numColor&&x.outline===n.numOutline&&x.accent===n.numAccent);$('gPreset').value=p?p.id:'';}
  for(const b of document.querySelectorAll('[data-gplace]'))b.setAttribute('aria-pressed',!!n[b.dataset.gplace]);
  for(const b of document.querySelectorAll('[data-gview]'))b.setAttribute('aria-pressed',b.dataset.gview===gView);
  const gv=$('gVeh'),vSig=Object.keys(VEHICLES).join();
  if(gv.dataset.sig!==vSig){gv.dataset.sig=vSig;gv.innerHTML=Object.entries(VEHICLES).map(([id,v])=>`<button type="button" data-gveh="${esc(id)}">${esc(v.name)}${v.draft?' (draft)':''}</button>`).join('');}
  for(const b of gv.querySelectorAll('[data-gveh]'))b.setAttribute('aria-pressed',b.dataset.gveh===n.veh);
  $('gTailBtn').textContent=n.veh==='truck'?'Tailgate':'Tail';
  const gar=vehicleGarage(n.veh),custom=!!carIdOf(n.veh||'');
  for(const el of $('scrGarage').querySelectorAll('#gPat,#gP2,#gP3,[data-gstep^="gPat"]'))el.disabled=!gar.schemes;
  for(const el of $('scrGarage').querySelectorAll('[data-gnum],#gNum,#gSize,#gFont,#gStyle,#gPreset,[data-gstep^="gFont"],[data-gstep^="gStyle"],[data-gstep^="gPreset"],[data-gslant],[data-gplace],#gNC,#gNO,#gNA'))el.disabled=!gar.numbers;
  const off=[!gar.schemes&&'paint schemes',!gar.logos&&'sponsor logos',!gar.numbers&&'race numbers'].filter(Boolean);
  $('gCarNote').textContent=custom&&off.length?`This car keeps its own ${off.join(', ').replace(/, ([^,]*)$/,' and $1')}; the main color is yours.`:'';
  $('gCarNote').classList.toggle('hidden',!(custom&&off.length));
  $('gColorNote').textContent=(NUM_STYLES.find(s=>s.id===n.numStyle)||NUM_STYLES[0]).roles;
  const opts=numArtOpts({...n,number:n.number||'00'});
  drawNumberPreview($('gNumPrev'),opts,n.primary);
  const art=drawNumberArt(sizeArt,opts,120),spots=[['numDoors','door','The doors'],['numRoof','roof','The roof'],['numTail','tail',n.veh==='truck'?'The tailgate':'The tail']].filter(([k])=>n[k]);
  const capped=spots.filter(([,s])=>numberCapped(NUM_SPOTS[s],art,n.numSize/100)).map(([,,name])=>name);
  $('gSizeNote').textContent=!spots.length?`Turn on a placement below to show the number on the ${n.veh==='truck'?'truck':'car'}.`
    :capped.length?`${capped.join(' and ')} ${capped.length>1?'are':'is'} as full as ${capped.length>1?'they get':'it gets'}, so the number stops growing there past this size.`
    :'100% is the original number size; 125% is 25% larger.';
}
function fillGarage(){renderGarage();}
let painter=null;
painter=initPaintDesigner({$,signedIn:()=>!!REC.me,enabled:()=>vehicleGarage(myLv.veh).schemes,
  apply:sc=>commitGarage({...myLv,pattern:'custom',custom:sc,primary:sc.primary,secondary:sc.secondary,accent:sc.accent,numColor:sc.num.fill,numOutline:sc.num.outline,numAccent:sc.num.accent,numSlant:sc.num.slant})});
let gT=0,gNumT=0;
function commitGarage(l){
  myLv=cleanLv(l);if(!myLv.number)myLv.number='0';saveLv();renderGarage();
  if(menuCar&&PAINT_KEYS.every(k=>menuCar.lv[k]===myLv[k])&&JSON.stringify(menuCar.lv.custom)===JSON.stringify(myLv.custom)){menuCar.lv=myLv;cancelAnimationFrame(gNumT);gNumT=requestAnimationFrame(()=>mountNumbers(menuCar.m,menuCar.lv));return;}
  clearTimeout(gT);gT=setTimeout(rebuildMenuCar,120);
}
function readGarage(){const l={...myLv};for(const k in G)l[k]=$(G[k]).value;if(REC.me)l.name=REC.me;commitGarage(l);}
function rebuildMenuCar(){if(menuCar)menuCar.dispose();menuCar=new Car('menu',myLv,{player:true});menuCar.place(S_LINE+6,-2);menuCar.m.root.visible=!player;}
for(const k in G)$(G[k]).addEventListener('input',readGarage);
$('scrGarage').addEventListener('click',e=>{
  const b=e.target.closest('button');if(!b)return;const d=b.dataset;
  if(d.gview){gView=d.gview;renderGarage();}
  else if(d.gveh){setVehicle(d.gveh);renderGarage();}
  else if(d.gstep){const [id,dir]=d.gstep.split(':');stepPick(id,Number(dir));}
  else if(d.gslant)commitGarage({...myLv,numSlant:!myLv.numSlant});
  else if(d.gplace)commitGarage({...myLv,[d.gplace]:!myLv[d.gplace]});
  else if(d.gnum==='rand'){let v;do{v=String(1+Math.floor(Math.random()*99));}while(v===myLv.number);commitGarage({...myLv,number:v});}
  else if(d.gnum){const t=myLv.number,v=((parseInt(t||'0',10)+Number(d.gnum))%1000+1000)%1000;let s=String(v);if(t.length>s.length)s=s.padStart(t.length,'0');commitGarage({...myLv,number:s.slice(-3)});}
});
['sLaps','sAI','sDiff'].forEach(id=>$(id).addEventListener('change',()=>{if(!NET.host)return;readHostSettings();broadcastLobby();}));
function syncNightToggle(){const b=$('sNight');b.setAttribute('aria-checked',String(!!settings.night));b.classList.toggle('on',!!settings.night);}
$('sNight').addEventListener('click',()=>{setNight(!settings.night);syncNightToggle();if(NET.host&&NET.online)broadcastLobby();});
const WIZ={flow:'solo',track:TRACK_ID};
const FLOW_STEPS={attack:['Mode','Track','Setup'],solo:['Mode','Track','Setup'],multi:['Mode','Host or join','Track','Setup','Lobby']};
const stepsHtml=(flow,idx)=>FLOW_STEPS[flow].map((n,i)=>`<span class="${i<idx?'done':i===idx?'on':''}">${i+1}. ${n}</span>`).join('');
function goFlow(f){WIZ.flow=f;WIZ.track=TRACK_ID;if(f==='multi'){mode='multi';document.querySelector('[data-steps="multi"]').innerHTML=stepsHtml('multi',1);showScreen('scrMulti');return;}showTrack();}
function renderTrackCards(){$('trackCards').innerHTML=Object.entries(TRACKS).map(([id,t])=>`<button class="tcard${id===WIZ.track?' on':''}" data-track="${id}" aria-pressed="${id===WIZ.track}"><b>${t.name}</b><span>${t.miles} \u00b7 ${t.surface==='dirt'?'Dirt':'Asphalt'} \u00b7 ${t.turnBank}\u00b0 banked turns${t.theme==='prison'?' \u00b7 extra grip':''}</span></button>`).join('');}
function renderVehCards(){$('vehCards').innerHTML=Object.entries(VEHICLES).map(([id,v])=>`<button type="button" class="tcard${id===myLv.veh?' on':''}" data-veh="${esc(id)}" aria-pressed="${id===myLv.veh}"><b>${esc(v.name)}</b><span>${esc(v.desc)}</span><span>${v.draft?'Draft: only you can see it':'Same speed and handling'}</span></button>`).join('');}
function setVehicle(v){if(!VEHICLES[v]||v===myLv.veh)return;saveLv();const own=store.get(lvKey(v),null);
  myLv=cleanLv(own?{...own,veh:v,name:myLv.name}:{...myLv,veh:v});saveLv();if(mode==='garage')renderGarage();const me=NET.players.get(NET.myId);if(me)me.lv=myLv;renderVehCards();
  if(carIdOf(v)&&!customCarReady(v)){Promise.all([ensureCustomCar(v),carAssetReady]).then(([a])=>{if(!a)toast('That car could not load, so the stock car will be used');if(!player)rebuildMenuCar();});return;}
  if(v==='car'&&!CAR_ASSET){carAssetReady.then(ok=>{if(!ok)toast('The car could not load, so the truck will be used');if(!player)rebuildMenuCar();});return;}if(!player)rebuildMenuCar();}
// Admin-made cars join the vehicle list once the catalog arrives; a saved choice that's gone falls back to the truck.
loadCustomCars().then(()=>{
  for(const [id,v] of customCarEntries())VEHICLES[id]=v;
  if(carIdOf(myLv.veh)&&!VEHICLES[myLv.veh]){myLv=cleanLv({...myLv,veh:'truck'});saveLv();}
  renderVehCards();if(mode==='garage')renderGarage();
  if(carIdOf(myLv.veh))Promise.all([ensureCustomCar(myLv.veh),carAssetReady]).then(()=>{if(!player)rebuildMenuCar();});
});
$('vehCards').addEventListener('click',e=>{const t=e.target.closest('[data-veh]');if(t)setVehicle(t.dataset.veh);});
function showTrack(){mode='track';syncNightToggle();$('trackSteps').innerHTML=stepsHtml(WIZ.flow,WIZ.flow==='multi'?2:1);renderTrackCards();renderVehCards();showScreen('scrTrack');}
function showSetup(){mode='setup';const att=WIZ.flow==='attack';$('setupSteps').innerHTML=stepsHtml(WIZ.flow,WIZ.flow==='multi'?3:2);
  $('setupTitle').textContent=att?'Time Attack setup':WIZ.flow==='multi'?'Room setup':'Race setup';$('setupTrack').textContent=`${TRACK.name} \u00b7 ${TRACK.miles} \u00b7 ${DIRT?'dirt':'asphalt'}`;
  $('raceFields').classList.toggle('hidden',att);$('setupNext').innerHTML=att?'START &rarr;':WIZ.flow==='multi'?'OPEN ROOM &rarr;':'START RACE &rarr;';
  $('sLaps').value=String(settings.laps);$('sAI').value=settings.ai;syncNightToggle();$('sDiff').value=settings.diff||'medium';showScreen('scrSetup');}
async function wizardNext(){readHostSettings();
  if(myLv.veh==='car'&&!CAR_ASSET&&!(await carAssetReady))toast('The car could not load, so the truck will be used');
  if(carIdOf(myLv.veh)&&!customCarReady(myLv.veh)){const [a]=await Promise.all([ensureCustomCar(myLv.veh),carAssetReady]);if(!a)toast('That car could not load, so the stock car will be used');}
  if(WIZ.flow==='attack')startTimeAttack();
  else if(WIZ.flow==='solo'){resetNet();NET.host=true;NET.online=false;NET.myId='host';NET.players.set('host',{id:'host',lv:myLv});hostStart();}
  else startHost(true);}
wrap.addEventListener('click',e=>{const t=e.target.closest('[data-track]');if(!t)return;WIZ.track=t.dataset.track;renderTrackCards();});
$('quality').value=quality;$('quality').addEventListener('change',e=>{quality=e.target.value;store.set('sts_q',quality);applyQuality();});

function act(a){
  switch(a){
    case 'solo':startHost(false);break;
    case 'attack':startTimeAttack();break;
    case 'records':mode='records';showScreen('scrRecords');showRecords('recMain','time-attack');break;
    case 'endattack':showResults();break;
    case 'menu':mode='menu';showScreen('scrMain');break;
    case 'multi-host':WIZ.flow='multi';showTrack();break;
    case 'track-back':if(WIZ.flow==='multi')goFlow('multi');else act('menu');break;
    case 'track-next':if(WIZ.track!==TRACK_ID){const q=new URLSearchParams(location.search);q.set('track',WIZ.track);q.set('flow',WIZ.flow);if(settings.night)q.set('night','1');else q.delete('night');q.delete('room');location.search=q.toString();}else showSetup();break;
    case 'setup-back':showTrack();break;
    case 'setup-next':wizardNext();break;
    case 'host':startHost(true);break;
    case 'join':doJoin();break;
    case 'garage':mode='garage';showScreen('scrGarage');fillGarage();break;
    case 'back':readGarage();mode='menu';showScreen('scrMain');break;
    case 'rand':{const nm=myLv.name;myLv=cleanLv({...randomLivery(Math.random,0),name:nm,custom:myLv.custom});fillGarage();readGarage();}break;
    case 'fs':if(document.fullscreenElement)document.exitFullscreen();else wrap.requestFullscreen&&wrap.requestFullscreen().catch(()=>{});break;
    case 'start':hostStart();break;
    case 'chat':sendChat();break;
    case 'leave':leaveAll();break;
    case 'resume':togglePause();break;
    case 'again':if(race.ph==='attack'){startTimeAttack();break;}if(!NET.online){hostStart();break;}sendAll({t:'back'});backToLobby();break;
  }
}
wrap.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;audioInit();const a=b.dataset.act;if(a.startsWith('flow:'))goFlow(a.slice(5));else act(a);});
wrap.addEventListener('click',e=>{const t=e.target.closest('[data-rec]');if(!t)return;const box=t.closest('.recbox');if(box)showRecords(box.id,t.dataset.rec);});
function applyUsername(){if(!REC.me)return;myLv={...myLv,name:REC.me.slice(0,20)};const gn=$('gName');gn.value=myLv.name;gn.disabled=true;gn.title='Your library username is your driver name';
  const me=NET.players.get(NET.myId);if(me)me.lv=myLv;if(mode==='lobby')renderLobby();if(mode==='garage')renderGarage();if(!player)rebuildMenuCar();}
fetchRecords('time-attack');   // the record board is public; its top 20 sets the AI pace baseline (aiBaseline)
if(REC_TRACK!==TRACK.rec)fetch(`/api/racing?records=1&mode=time-attack&track=${TRACK.rec}`).then(r=>r.ok?r.json():null).then(d=>{if(d)REC.classicAttack=d.records||[];}).catch(()=>{});
fetch('/api/racing',{credentials:'same-origin'}).then(r=>r.ok?r.json():null).then(d=>{if(d&&d.username){REC.me=d.username;applyUsername();fetchRecords('time-attack');}}).catch(()=>{});
const TT=initTrackTest({cfg:CFG,trackId:TRACK_ID,trackName:TRACK.name,toast:m=>toast(m),onApply:()=>forgetFormV(WORLD),startTest:()=>goFlow('attack'),resetCar:()=>{if(!player||mode!=='race')return false;simResetCar(WORLD,player);return true;}});

// ===================== INPUT =====================
const keys={};
addEventListener('keydown',e=>{
  const tag=e.target.tagName;
  if(tag==='INPUT'||tag==='SELECT'){if(e.key==='Enter'){if(e.target.id==='chatIn')sendChat();if(e.target.id==='joinCode')doJoin();}return;}
  audioInit();keys[e.code]=true;
  if(mode==='race'||mode==='paused'||mode==='results'){
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();
    if(e.code==='KeyC'&&!e.repeat)camMode=camMode==='chase'?'far':camMode==='far'?'hood':'chase';
    if(e.code==='KeyR'&&!e.repeat&&player&&(player.speed<6||TT.isTesting())&&mode!=='paused')simResetCar(WORLD,player);
    if(e.code==='Escape')togglePause();
  }
  if(e.code==='KeyM'&&!e.repeat)toggleMute();
});
addEventListener('keyup',e=>{keys[e.code]=false;});
// The page never scrolls, and neither does the site around it: arrow keys, space and page keys outside text
// fields, and the mouse wheel anywhere but a panel that still has room to scroll, stop here.
const SCROLL_KEYS=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','PageUp','PageDown','Home','End'];
addEventListener('keydown',e=>{const t=e.target,tag=t.tagName;if(tag==='INPUT'&&!['range','color','button','checkbox'].includes(t.type)||tag==='TEXTAREA'||tag==='SELECT')return;
  if(SCROLL_KEYS.includes(e.code)&&!(tag==='INPUT'&&t.type==='range'&&e.code.startsWith('Arrow')))e.preventDefault();});
addEventListener('wheel',e=>{for(let el=e.target;el&&el!==document.body;el=el.parentElement){
  if(el.scrollHeight>el.clientHeight+1&&/(auto|scroll)/.test(getComputedStyle(el).overflowY)){const down=e.deltaY>0;
    if(down?el.scrollTop+el.clientHeight<el.scrollHeight-1:el.scrollTop>0)return;}}
  e.preventDefault();},{passive:false});
addEventListener('blur',()=>{for(const k in keys)keys[k]=false;});
addEventListener('resize',resize);
function playerCtl(){return {thr:!!(keys.ArrowUp||keys.KeyW),brk:!!(keys.ArrowDown||keys.KeyS),steer:((keys.ArrowLeft||keys.KeyA)?1:0)-((keys.ArrowRight||keys.KeyD)?1:0)};}

// ===================== MAIN LOOP =====================
// ?autopilot=1 hands the player's car to the AI (scripts/shorttrack-play.mjs drives real laps with it)
const AUTOPILOT=new URLSearchParams(location.search).get('autopilot')==='1';
const CLASSIC_STATUS={track:TRACK_ID,frames:0,physics:WORLD.model,get debris(){return GPU&&GPU.debris?GPU.debris.count:0;}};window.__stClassic=CLASSIC_STATUS;
const STEP=1/120;let acc=0,lastT=performance.now(),hudT=0,crowdHype=0.6,pylonT=0;
function simulate(dt){
  // rolling start: the AI drives every car (the player's too) in formation until the green flag drops
  simSimulate(WORLD,dt,()=>AUTOPILOT?null:mode==='paused'?{thr:0,brk:0,steer:0}:playerCtl());
}
function frame(now){
  requestAnimationFrame(frame);CLASSIC_STATUS.frames++;const rawDt=(now-lastT)/1000,dt=Math.min(0.1,rawDt);lastT=now;if(adaptRes&&!document.hidden)adaptRes.update(rawDt);
  const simOn=!SIM.frozen&&(mode==='race'||mode==='results'||(mode==='paused'&&NET.online));
  if(simOn){
    acc+=dt;let n=0;while(acc>=STEP&&n<24){simulate(STEP);acc-=STEP;n++;}if(n>=24)acc=0;drainSim();
    cars.forEach(c=>{if(!c.local)interp(c,now);});
    if(NET.host)raceControl(WORLD,dt);
    updateWear(dt);
    updateBoosts(WORLD,dt);
    if(race.ph!==lastPhase){lastPhase=race.ph;onPhase(race.ph);}
  }
  cars.forEach(c=>carVisual(c,dt));if(menuCar&&menuCar.m.root.visible)carVisual(menuCar,dt);
  updSparks(dt);updSmoke(dt);updCamera(dt);audioUpdate();netTick(dt);
  if(mode==='race'||mode==='paused'){spotter(dt);hudT+=dt;if(hudT>0.1){hudT=0;hudUpdate();}speedHud();}
  if(simOn){pylonT+=dt;if(pylonT>0.5){pylonT=0;drawPylon(standings());}}
  const focus=player&&simOn?player:menuCar;
  if(focus){sun.target.position.set(focus.x,0,focus.z);sun.position.copy(sun.target.position).add(SUN_OFF);sun.target.updateMatrixWorld();}
  crowdU.uTime.value=now/1000;crowdU.uLift.value=lerp(crowdU.uLift.value,crowdHype,1-Math.exp(-dt*2));crowdHype=Math.max(0.6,crowdHype-dt*0.25);
  const mirrorOn=!!player&&(mode==='race'||mode==='paused');
  if(GPU){GPU.frame({quality,exposure:renderer.toneMappingExposure,bloom:{...bloom,enabled:bloom.enabled&&useComposer},shadows:renderer.shadowMap.enabled,shadowSize:sun.shadow.mapSize.x,night:!!settings.night,mirror:mirrorOn?MIRROR:null});return;}
  renderer.shadowMap.needsUpdate=true;renderer.setRenderTarget(null);if(useComposer)composer.render(dt);else renderer.render(scene,camera);
  if(player&&(mode==='race'||mode==='paused')){
    renderer.setRenderTarget(mirrorRT);renderer.render(scene,mirrorCam);renderer.setRenderTarget(null);
    renderer.autoClear=false;renderer.clearDepth();renderer.render(ovScene,ovCam);renderer.autoClear=true;
  }
}

// ===================== REFERENCE RECORDER (?record=1) =====================
// Runs an all-AI race headless and deterministic: SIM.rand is seeded, SIM.now is the sim clock, and one tick is
// simulate(STEP), the per-frame vf refresh carVisual does, raceControl and updateBoosts, i.e. the classic loop at
// 120 fps. The host car is driven by the AI at the level's mid settings. Used for the fixtures in tests/fixtures/ (docs/shorttrack/PLAN.md, Phase 1).
function recordRace(o){
  let t=1000;SIM.rand=rng(o.seed|0);SIM.now=()=>t;
  REC.lists['time-attack']=o.base?Array.from({length:20},()=>({milliseconds:o.base*1000})):[];
  myLv={...myLv,veh:o.veh||'truck'};startHost(false);$('sLaps').value=o.laps;$('sAI').value=o.ai;$('sDiff').value=o.diff;
  hostStart();
  const A=AI_LEVELS[o.diff];Object.assign(player,{isPlayer:false,ai:true,skill:A.sk[0]+A.sk[1]/2,aiDecel:A.dc,passD:A.pass,gripB:A.gb,powB:A.pb,gripB0:A.gb,powB0:A.pb,laneCD:A.lc,aggr:A.ag,lapTgt:o.base?o.base*A.pace:0});
  const BIN=2,nb=Math.ceil(P/BIN),sum=new Float64Array(nb),cnt=new Uint32Array(nb),laps={},states=[],r9=v=>+(+v).toFixed(9);
  const lead=()=>standings()[0],cross=new Map();cars.forEach(c=>cross.set(c.id,c.cross));
  const snap=()=>[...cars.values()].map(c=>[c.id,r9(c.x),r9(c.z),r9(c.h),r9(c.vx),r9(c.vz),r9(c.av),r9(c.steer),c.cross,r9(c.sp),r9(c.dmg.f),r9(c.dmg.r),r9(c.dmg.l),r9(c.dmg.rt),r9(c.boost),r9(c.paceK||1)]);
  let tick=0;const max=120*60*Math.max(4,o.laps*2);
  while(race.ph!=='done'&&tick<max&&!(o.stop&&tick>=o.stop)){
    t+=STEP;simulate(STEP);cars.forEach(c=>{c.vf=c.vx*Math.sin(c.h)+c.vz*Math.cos(c.h);});raceControl(WORLD,STEP);updateBoosts(WORLD,STEP);WORLD.events.length=0;tick++;
    const ld=lead();
    if(o.golden&&tick%o.golden===0&&ld&&ld.cross<=4)states.push([tick,snap()]);
    cars.forEach(c=>{
      if(c.cross!==cross.get(c.id)){if(c.cross>2&&c.lastLap!=null)(laps[c.id]=laps[c.id]||[]).push(r9(c.lastLap));cross.set(c.id,c.cross);}
      if(race.ph==='green'&&c.cross>=3&&!c.fin){const b=Math.min(nb-1,Math.floor(c.sp/BIN));sum[b]+=c.speed;cnt[b]++;}
    });
  }
  if(o.stop){SIM.frozen=true;camSnap=true;camH=player.h;}
  return {meta:{track:TRACK_ID,rec:TRACK.rec,diff:o.diff,seed:o.seed|0,laps:o.laps,ai:o.ai,veh:o.veh||'truck',base:o.base||null,step:STEP,ticks:tick,phase:race.ph,formV:r9(formV(WORLD)),P:r9(P),bin:BIN,golden:o.golden||0,
      fields:'id,x,z,h,vx,vz,av,steer,cross,sp,dmgF,dmgR,dmgL,dmgRt,boost,paceK',order:[...cars.keys()]},
    laps,speed:Array.from(sum,(s,i)=>cnt[i]?+(s/cnt[i]).toFixed(3):null),states};
}
if(new URLSearchParams(location.search).get('record')==='1')window.__stsRecord=recordRace;

// ===================== LIBRARY CHAT INVITES =====================
function tlPostRoom(code){try{if(window.parent!==window)window.parent.postMessage({type:'tl-room',code},location.origin);}catch(e){}}
addEventListener('message',e=>{
  if(e.origin!==location.origin||!e.data||e.data.type!=='tl-host')return;
  if(NET.host&&NET.online&&NET.code&&NET.peer&&NET.peer.open){tlPostRoom(NET.code);return;}
  if(['menu','garage','lobby','multi','track','setup','records'].includes(mode))startHost(true);
});

// ===================== INIT =====================
{const room=new URLSearchParams(location.search).get('room');if(room){$('joinCode').value=room.toUpperCase().replace(/[^A-Z]/g,'').slice(0,5);setTimeout(doJoin,300);}}
rebuildMenuCar();applyQuality();setNight(settings.night);showScreen('scrMain');requestAnimationFrame(frame);
carAssetReady.then(ok=>{if(ok&&myLv.veh==='car'&&!player)rebuildMenuCar();});
NUM_FONTS.forEach(f=>loadNumFont(f.id).then(refreshNumberFonts));
{const q=new URLSearchParams(location.search),fl=q.get('flow');if(FLOW_STEPS[fl]&&!q.get('room')){WIZ.flow=fl;WIZ.track=TRACK_ID;q.delete('flow');history.replaceState(null,'',location.pathname+(q.toString()?'?'+q:''));showSetup();}}
