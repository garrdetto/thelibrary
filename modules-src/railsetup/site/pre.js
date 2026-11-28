(()=>{const CAR=__RAIL_CAR__,f0=window.fetch.bind(window),here=u=>{try{return new URL(typeof u==='string'||u instanceof URL?u:u.url,document.baseURI)}catch(e){return null}},mine=u=>u&&u.origin===location.origin;
let car=null;const progress=n=>{const l=document.getElementById('loading');if(l&&!l.hidden)l.textContent='Loading chassis… '+n+'%'};
function loadCar(){if(car)return car;let got=0;
car=Promise.all(CAR.pieces.map(async u=>{const r=await f0(u);if(!r.ok||!r.body)throw new Error('chassis model '+r.status);const rd=r.body.getReader(),parts=[];
for(;;){const {done,value}=await rd.read();if(done)break;parts.push(value);got+=value.length;progress(Math.min(99,Math.floor(got/CAR.gzBytes*100)));}return new Blob(parts)}))
.then(b=>new Response(new Blob(b).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
.then(b=>{if(b.byteLength!==CAR.bytes)throw new Error('chassis model size');return b});car.catch(()=>{car=null});return car}
window.fetch=function(input,init){const u=here(input);
if(mine(u)&&u.pathname===CAR.path)return loadCar().then(b=>new Response(b,{status:200,headers:{'content-type':'model/gltf-binary'}}));
if(mine(u)&&(u.pathname==='/ping'||u.pathname==='/bye'))return Promise.resolve(new Response(null,{status:204}));
return f0(input,init)};
if(navigator.sendBeacon){const b0=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=(u,d)=>{const x=here(u);return mine(x)&&(x.pathname==='/bye'||x.pathname==='/ping')?true:b0(u,d)}}
})();
