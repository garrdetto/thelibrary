(function(root){
const V={
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]], sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  mul:(a,s)=>[a[0]*s,a[1]*s,a[2]*s], dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  len:a=>Math.hypot(a[0],a[1],a[2]), norm:a=>{const l=Math.hypot(a[0],a[1],a[2]);return [a[0]/l,a[1]/l,a[2]/l]},
  dist:(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])
};
const D=180/Math.PI;
// rotate point p about axis through o with unit dir k by angle t (Rodrigues)
function rot(p,o,k,t){const v=V.sub(p,o),c=Math.cos(t),s=Math.sin(t);
  return V.add(o,V.add(V.add(V.mul(v,c),V.mul(V.cross(k,v),s)),V.mul(k,V.dot(k,v)*(1-c))));}
function rotVec(v,k,t){return rot(v,[0,0,0],k,t);}
// solve f(x)=0 near x0 with secant iterations
function solve(f,x0,h=1e-3){let a=x0,b=x0+h,fa=f(a),fb=f(b);
  for(let i=0;i<40&&Math.abs(fb)>1e-10;i++){const d=fb-fa;if(Math.abs(d)<1e-14)break;const c=b-fb*(b-a)/d;a=b;fa=fb;b=c;fb=f(b);}return b;}
// orthonormal frame from three points
function frame(a,b,c){const x=V.norm(V.sub(b,a)),z=V.norm(V.cross(x,V.sub(c,a))),y=V.cross(z,x);return [x,y,z];}
function toLocal(p,o,F){const v=V.sub(p,o);return [V.dot(v,F[0]),V.dot(v,F[1]),V.dot(v,F[2])];}
function toWorld(l,o,F){return V.add(o,V.add(V.add(V.mul(F[0],l[0]),V.mul(F[1],l[1])),V.mul(F[2],l[2])));}

const TIRE_R=13.3;

// Build a corner from static hardpoints + adjustments. s=+1 left, -1 right.
// adj: {ufz,urz,ufx,urx (upper inner pivot moves), lfz,lrz,lfx,lrx (lower inner pivot moves), lslug,uslug (BJ pivot moves on knuckle, in),
//       camber (UBJ in/out on knuckle, + = out), caster (UBJ fore/aft, + = aft), tro (outer tie rod height),
//       toe (static toe-out, deg), ucaLen/lcaLen (arm length change along the arm, + = longer),
//       ucaX (whole upper arm slid forward on its cross shaft), tri (inner tie rod end height),
//       wo (wheel center plane moved out along the spindle, in: wheel width/2 − back spacing vs the CAD wheel),
//       umh/lmh (upper/lower ball joint mount moved up the knuckle, in: chassis mounts and arm lengths stay,
//       the arms swing until the wheel is back at ride height, toe reset with the tie rod adjuster)}
function build(hp,s,adj){
  adj=Object.assign({ufz:0,urz:0,ufx:0,urx:0,lfz:0,lrz:0,lfx:0,lrx:0,lslug:0,uslug:0,camber:0,caster:0,tro:0,toe:0,ucaLen:0,lcaLen:0,ucaX:0,tri:0,umh:0,lmh:0,wo:0},adj||{});
  const P=JSON.parse(JSON.stringify(hp));
  // static knuckle (wheel at ride height, as modeled)
  let LBJ=P.LBJ,UBJ=P.UBJ,TRO=P.TRO,WC=V.add(P.WC,[0,s*adj.wo,0]),AX=P.AX?(a=>a[1]*s<0?V.mul(a,-1):a)(V.norm(P.AX)):[0,s,0]; let KR=[P.LBJ,P.UBJ,P.TRO];
  const mid=(a,b)=>V.mul(V.add(a,b),0.5), side=v=>V.norm([0,v[1],v[2]]);   // arm length moves stay in the front-view plane (no hidden caster change)
  // 0) lower arm length: LBJ moves along the arm, knuckle tips about UBJ
  if(adj.lcaLen){const ul=side(V.sub(LBJ,mid(P.LIF,P.LIR))),q0=V.sub(LBJ,UBJ),q1=V.sub(V.add(LBJ,V.mul(ul,adj.lcaLen)),UBJ),ax0=V.cross(q0,q1);
    if(V.len(ax0)>1e-9){const t=Math.acos(Math.min(1,V.dot(V.norm(q0),V.norm(q1)))),kk=V.norm(ax0);
      LBJ=rot(LBJ,UBJ,kk,t);TRO=rot(TRO,UBJ,kk,t);KR=KR.map(q=>rot(q,UBJ,kk,t));WC=rot(WC,UBJ,kk,t);AX=rotVec(AX,kk,t);}}
  // 1) camber/caster shims, upper arm length and upper arm slide: rotate knuckle about LBJ so UBJ heads for its new spot
  const uu=side(V.sub(UBJ,mid(P.UIF,P.UIR)));
  const k0=V.sub(UBJ,LBJ), k1=V.sub(V.add(V.add(UBJ,[-adj.caster+adj.ucaX,s*adj.camber,0]),V.mul(uu,adj.ucaLen)),LBJ);
  const ax=V.cross(k0,k1); if(V.len(ax)>1e-9){const t=Math.acos(Math.min(1,V.dot(V.norm(k0),V.norm(k1))));const kk=V.norm(ax);
    UBJ=rot(UBJ,LBJ,kk,t);TRO=rot(TRO,LBJ,kk,t);KR=KR.map(q=>rot(q,LBJ,kk,t));WC=rot(WC,LBJ,kk,t);AX=rotVec(AX,kk,t);}
  // 2) set static toe by steering the knuckle about the kingpin
  const toeOf=a=>Math.atan2(-a[0],s*a[1])*D;
  const kp=V.norm(V.sub(UBJ,LBJ));
  const tt=solve(t=>toeOf(rotVec(AX,kp,t))-adj.toe,0);
  KR=KR.map(q=>rot(q,LBJ,kp,tt));TRO=rot(TRO,LBJ,kp,tt);WC=rot(WC,LBJ,kp,tt);AX=rotVec(AX,kp,tt);
  // 3) slugs and tie-rod shim move pivots on the knuckle (knuckle pose stays)
  const up=V.norm(V.sub(UBJ,LBJ));
  LBJ=V.add(LBJ,V.mul(up,-adj.lslug)); UBJ=V.add(UBJ,V.mul(up,adj.uslug));
  TRO=V.add(TRO,[0,0,adj.tro]);
  let KB=[KR[0],KR[1],KR[2]];   // knuckle body points; the hub and wheel ride on KR
  // 4) chassis-side moves
  const UIF=V.add(P.UIF,[adj.ufx+adj.ucaX,0,adj.ufz]), UIR=V.add(P.UIR,[adj.urx+adj.ucaX,0,adj.urz]);
  const LIF=V.add(P.LIF,[adj.lfx,0,adj.lfz]), LIR=V.add(P.LIR,[adj.lrx,0,adj.lrz]);
  const TRI=V.add(P.TRI,[0,0,adj.tri]);
  // 5) ball joint mounts moved up (+) or down (−) the knuckle. The chassis mounts and arm lengths stay,
  //    so the knuckle re-seats: the arms swing until the wheel center is back at ride height, and toe is
  //    reset with the tie rod adjuster. Camber and caster come out of the geometry.
  if(adj.umh||adj.lmh){
    const kup=V.norm(V.sub(KR[1],KR[0]));
    const Lk=V.add(LBJ,V.mul(kup,adj.lmh)), Uk=V.add(UBJ,V.mul(kup,adj.umh)), kpn=V.dist(Lk,Uk), k0=V.norm(V.sub(Uk,Lk));
    const kl=V.norm(V.sub(LIR,LIF)), ku=V.norm(V.sub(UIR,UIF));
    KB=[V.add(KR[0],V.mul(kup,adj.lmh)),V.add(KR[1],V.mul(kup,adj.umh)),KR[2]];
    let ps=0;
    const place=th=>{const L=rot(LBJ,LIF,kl,th);ps=solve(q=>V.dist(rot(UBJ,UIF,ku,q),L)-kpn,ps);const U=rot(UBJ,UIF,ku,ps);
      const kp=V.norm(V.sub(U,L)),r=V.cross(k0,kp),ang=Math.acos(Math.min(1,V.dot(k0,kp))),rn=V.len(r)>1e-12?V.norm(r):null;
      const M=q=>{const m=V.add(L,V.sub(q,Lk));return rn?rot(m,L,rn,ang):m;}, ax=rn?rotVec(AX,rn,ang):AX;
      const tt=solve(x=>toeOf(rotVec(ax,kp,x))-adj.toe,0), F=q=>rot(M(q),L,kp,tt);
      return {L,U,TRO:F(TRO),WC:F(WC),AX:rotVec(ax,kp,tt),KR:KR.map(F),KB:KB.map(F)};};
    const th=solve(x=>place(x).WC[2]-WC[2],0), q=place(th);
    LBJ=q.L;UBJ=q.U;TRO=q.TRO;WC=q.WC;AX=q.AX;KR=q.KR;KB=q.KB;
  }
  const c={s,LIF,LIR,UIF,UIR,TRI,LBJ,UBJ,TRO,WC,AX};
  // link lengths recomputed so the static wheel position is held
  c.L={lf:V.dist(LBJ,LIF),lr:V.dist(LBJ,LIR),uf:V.dist(UBJ,UIF),ur:V.dist(UBJ,UIR),kp:V.dist(LBJ,UBJ),tr:V.dist(TRO,TRI)};
  // coilover: upper eye on the chassis, lower eye carried by the lower arm (kept at its spot in the arm's own frame)
  if(P.SHU&&P.SHL){c.shU=P.SHU;c.shLoc=toLocal(P.SHL,P.LIF,frame(P.LIF,P.LIR,P.LBJ));}
  // knuckle-local coordinates of everything carried by the knuckle
  c.F0=frame(LBJ,UBJ,TRO);
  c.loc={WC:toLocal(WC,LBJ,c.F0),AXp:toLocal(V.add(WC,AX),LBJ,c.F0),TRO:toLocal(TRO,LBJ,c.F0),UBJ:toLocal(UBJ,LBJ,c.F0)};
  c.kref=KR.map(q=>toLocal(q,LBJ,c.F0)); c.kbody=KB.map(q=>toLocal(q,LBJ,c.F0));
  return c;
}

// Pose the corner for lower-arm angle th (rad). Returns world points.
function poseAt(c,th,guess,steer){
  const kl=V.norm(V.sub(c.LIR,c.LIF)), ku=V.norm(V.sub(c.UIR,c.UIF));
  const LBJ=rot(c.LBJ,c.LIF,kl,th);
  const ps=solve(p=>V.dist(rot(c.UBJ,c.UIF,ku,p),LBJ)-c.L.kp,guess?guess.ps:0);
  const UBJ=rot(c.UBJ,c.UIF,ku,ps);
  // TRO on circle about the kingpin: rebuild from static local coords then steer about kingpin
  const kp=V.norm(V.sub(UBJ,LBJ));
  // rigid move of knuckle that maps static LBJ,UBJ to new ones (no steer), then solve steer
  const F0=c.F0;
  // initial frame: use static TRO direction carried by minimal rotation
  const a0=V.norm(V.sub(c.UBJ,c.LBJ)), r=V.cross(a0,kp); let TRO1=V.add(LBJ,V.sub(c.TRO,c.LBJ));
  if(V.len(r)>1e-12){const t=Math.acos(Math.min(1,V.dot(a0,kp)));TRO1=rot(V.add(LBJ,V.sub(c.TRO,c.LBJ)),LBJ,V.norm(r),t);}
  const TRI=steer?V.add(c.TRI,[0,steer,0]):c.TRI;      // steering moves the tie rod inner ends sideways
  const st=solve(t=>V.dist(rot(TRO1,LBJ,kp,t),TRI)-c.L.tr,guess?guess.st:0);
  const TRO=rot(TRO1,LBJ,kp,st);
  const F=frame(LBJ,UBJ,TRO);
  const WC=toWorld(c.loc.WC,LBJ,F), AX=V.sub(toWorld(c.loc.AXp,LBJ,F),WC);
  return {th,ps,st,LBJ,UBJ,TRO,WC,AX,F};
}
// pose by wheel-center travel h (in, + = bump) relative to static
function poseH(c,h,guess,steer){
  const z0=c.WC[2];
  let g=guess||{th:0,ps:0,st:0};
  // the tie rod outer sits on a circle that cuts the tie rod sphere twice. From a cold guess a big
  // steer can land on the far root (the knuckle flipped round), so walk the steer in from zero.
  if(steer&&!guess){const N=Math.max(4,Math.ceil(Math.abs(steer)/0.05));for(let i=1;i<=N;i++)g=poseH(c,h,g,steer*i/N);return g;}
  const th=solve(t=>{const p=poseAt(c,t,g,steer);return p.WC[2]-z0-h;},g.th,0.01);
  return poseAt(c,th,g,steer);
}

function angles(c,p){
  const s=c.s, a=V.norm(p.AX), k=V.sub(p.UBJ,p.LBJ);
  const camber=Math.asin(-a[2])*D;           // + = top out
  const toe=Math.atan2(-a[0],s*a[1])*D;       // + = toe out
  const caster=Math.atan2(-k[0],k[2])*D;      // + = upper BJ behind lower
  const kpi=Math.atan2(-s*k[1],k[2])*D;       // + = upper BJ inboard
  // contact patch: lowest point of the wheel (tire radius from wheel center, perpendicular to axis)
  const dn=V.norm(V.sub([0,0,-1],V.mul(a,V.dot([0,0,-1],a))));
  const CP=V.add(p.WC,V.mul(dn,TIRE_R));
  // kingpin ground intercept
  const t=-p.LBJ[2]/k[2]+CP[2]/k[2]; const G=V.add(p.LBJ,V.mul(k,t));
  const scrub=s*(CP[1]-G[1]);                 // + = kingpin ground point inboard of patch
  const trail=G[0]-CP[0];                      // + = kingpin ahead of patch
  return {camber,toe,caster,kpi,scrub,trail,CP};
}
// line where an arm plane (inner pivots + BJ) cuts the plane x = x0 (front view) -> two 2D points (y,z)
function cutX(i1,i2,bj,x0){const n=V.cross(V.sub(i2,i1),V.sub(bj,i1));
  // plane n·(p-i1)=0 with p=(x0,y,z): n1*y+n2*z = n·i1 - n0*x0
  const d=V.dot(n,i1)-n[0]*x0; return {a:n[1],b:n[2],d};}
function cutY(i1,i2,bj,y0){const n=V.cross(V.sub(i2,i1),V.sub(bj,i1));const d=V.dot(n,i1)-n[1]*y0;return {a:n[0],b:n[2],d};}
function meet(l1,l2){const det=l1.a*l2.b-l2.a*l1.b; if(Math.abs(det)<1e-12)return null;
  return [(l1.d*l2.b-l2.d*l1.b)/det,(l1.a*l2.d-l2.a*l1.d)/det];}
// front-view instant center (y,z) and side-view IC (x,z) for a posed corner (body frame, inner pivots fixed)
function ics(c,p){
  const fv=meet(cutX(c.LIF,c.LIR,p.LBJ,p.WC[0]),cutX(c.UIF,c.UIR,p.UBJ,p.WC[0]));
  const sv=meet(cutY(c.LIF,c.LIR,p.LBJ,p.WC[1]),cutY(c.UIF,c.UIR,p.UBJ,p.WC[1]));
  return {fv,sv};
}
// roll center from both corners (body frame), y,z
function rollCenter(cL,pL,cR,pR){
  const aL=angles(cL,pL),aR=angles(cR,pR),iL=ics(cL,pL).fv,iR=ics(cR,pR).fv;
  if(!iL||!iR)return null;
  const line=(P,Q)=>{const a=Q[1]-P[1],b=P[0]-Q[0];return {a,b,d:a*P[0]+b*P[1]};};
  return meet(line([aL.CP[1],aL.CP[2]],iL),line([aR.CP[1],aR.CP[2]],iR));
}
// coilover length at a pose, and its lower eye (null if the hardpoints have no shock points)
function shockEye(c,p){return c.shLoc?toWorld(c.shLoc,c.LIF,frame(c.LIF,c.LIR,p.LBJ)):null;}
function shockLen(c,p){const e=shockEye(c,p);return e?V.dist(e,c.shU):null;}
// anti-dive % for one front corner: SVIC vs contact patch
function antiDive(c,p,hcg,wb,bf){
  const sv=ics(c,p).sv, cp=angles(c,p).CP; if(!sv)return 0;
  const tanT=(sv[1]-cp[2])/(cp[0]-sv[0]);     // SVIC behind and above patch -> positive
  return tanT*(wb/hcg)*bf*100;
}
// Steering self-check: KIN.selfTest() throws on the first failure, returns true otherwise.
// Needs a corner built from real hardpoints, e.g. KIN.selfTest(KIN.build(HP.L,1,{})).
function selfTest(c){
  const ok=(w,t)=>{if(!t)throw new Error('KIN.selfTest: '+w);};
  const near=(a,b,tol,w)=>ok(w+' ('+a+' vs '+b+')',Math.abs(a-b)<=tol);
  const p0=poseH(c,0,null), p0b=poseH(c,0,null,0);
  near(p0.WC[2],p0b.WC[2],1e-9,'steer 0 must match no steer');
  for(const r of [-0.6,-0.2,0.2,0.6]){
    const p=poseH(c,0,null,r), TRI=V.add(c.TRI,[0,r,0]);
    near(V.dist(p.TRO,TRI),c.L.tr,1e-6,'tie rod length held at steer '+r);
    near(V.dist(p.LBJ,p.UBJ),c.L.kp,1e-6,'kingpin length held at steer '+r);
    near(V.dist(p.LBJ,c.LIF),c.L.lf,1e-6,'lower arm length held at steer '+r);
    near(p.WC[2]-c.WC[2],0,1e-6,'poseH holds wheel height at steer '+r);
  }
  // opposite rack travel must steer the wheel the opposite way by the same amount
  const tp=angles(c,poseH(c,0,null,0.4)).toe-angles(c,p0).toe;
  const tm=angles(c,poseH(c,0,null,-0.4)).toe-angles(c,p0).toe;
  near(tp,-tm,0.05+0.05*Math.abs(tp),'steer must be near-symmetric about centre');   // steering arm geometry makes it a little uneven
  ok('rack must actually steer the wheel',Math.abs(tp)>1);
  return true;
}

// ---------- rear: solid axle on four links (two lower links, 3rd link, track bar) ----------
// rp (body frame, as exported): LL/RL lower links, UL 3rd link, TB track bar: [axle end, chassis end];
// SL/SR shocks: [lower eye, upper eye]; WL/WR wheel centers; AX wheel spin axis.
// Axle pose q=[x,y,z,roll,pitch,yaw] of the axle frame (origin between the wheel centers, y along the axle):
// R=Rz(yaw)·Ry(pitch)·Rx(roll). roll + = left side up, yaw + = axle aims left.
const LINKS=['LL','RL','UL','TB'];
function Rq(q){const cr=Math.cos(q[3]),sr=Math.sin(q[3]),cp=Math.cos(q[4]),sp=Math.sin(q[4]),cy=Math.cos(q[5]),sy=Math.sin(q[5]);
  return [[cy*cp,cy*sp*sr-sy*cr,cy*sp*cr+sy*sr],[sy*cp,sy*sp*sr+cy*cr,sy*sp*cr-cy*sr],[-sp,cp*sr,cp*cr]];}
function onAxle(q,R,l){return [0,1,2].map(i=>q[i]+R[i][0]*l[0]+R[i][1]*l[1]+R[i][2]*l[2]);}
function solveLin(M,r){const n=r.length,A=M.map((row,i)=>[...row,r[i]]);
  for(let i=0;i<n;i++){let p=i;for(let j=i+1;j<n;j++)if(Math.abs(A[j][i])>Math.abs(A[p][i]))p=j;[A[i],A[p]]=[A[p],A[i]];
    for(let j=i+1;j<n;j++){const f=A[j][i]/A[i][i];for(let k=i;k<=n;k++)A[j][k]-=f*A[i][k];}}
  const x=new Array(n).fill(0);for(let i=n-1;i>=0;i--){let t=A[i][n];for(let k=i+1;k<n;k++)t-=A[i][k]*x[k];x[i]=t/A[i][i];}return x;}
// x, y, pitch and yaw that hold all four link lengths with the axle center at height z and roll psi
function rearSolve(g,z,psi,q0){const q=(q0||g.q0||g.qc).slice();q[2]=z;q[3]=psi;const J4=[0,1,4,5];
  const res=q=>{const R=Rq(q);return LINKS.map(k=>V.dist(onAxle(q,R,g.A[k]),g.C[k])-g.L[k]);};
  for(let it=0;it<40;it++){const r=res(q);if(Math.max(...r.map(Math.abs))<1e-11)break;
    const J=r.map(()=>[0,0,0,0]);J4.forEach((j,c)=>{const qp=q.slice();qp[j]+=1e-6;res(qp).forEach((v,i)=>J[i][c]=(v-r[i])/1e-6);});
    solveLin(J,r.map(v=>-v)).forEach((d,c)=>q[J4[c]]+=Math.max(-0.5,Math.min(0.5,d)));}
  return q;}
function rearBuild(rp){
  const c0=V.mul(V.add(rp.WL,rp.WR),0.5), a=V.norm(rp.AX);
  const qc=[c0[0],c0[1],c0[2],Math.asin(a[2]),0,Math.atan2(-a[0],a[1])], Rc=Rq(qc);
  const loc=p=>{const d=V.sub(p,c0);return [0,1,2].map(j=>Rc[0][j]*d[0]+Rc[1][j]*d[1]+Rc[2][j]*d[2]);};
  const g={qc,A:{},C:{},L:{},W:{L:loc(rp.WL),R:loc(rp.WR)},S:{L:[loc(rp.SL[0]),rp.SL[1]],R:[loc(rp.SR[0]),rp.SR[1]]},z0:TIRE_R};
  // ride height: axle level, square and centered, wheel centers one tire radius up. The link lengths are set
  // from that pose, the way the car is squared with the link adjusters and centered with the track bar.
  g.q0=[qc[0],0,TIRE_R,0,0,0]; const R0=Rq(g.q0);
  LINKS.forEach(k=>{g.A[k]=loc(rp[k][0]);g.C[k]=rp[k][1].slice();g.L[k]=V.dist(onAxle(g.q0,R0,g.A[k]),g.C[k]);});
  if(rp.JB)g.JB={A:loc(rp.JB[0]),C:rp.JB[1].slice()};   // J-Bar (optional): axle end near the pinion, chassis end on the frame
  return g;}
// move link ends up (+) or down: adj {LLa,LLc,RLa,RLc,ULa,ULc,TBa,TBc} in inches (a = axle end, c = chassis end),
// ULlen: 3rd link longer (+). Lengths are reset so the axle holds its ride height pose; a longer 3rd link
// then rolls the pinion down.
// TBtype 1: J-Bar in place of the track bar (same job: the lateral link). TBflip 1: mirror the lateral link,
// chassis end on the left and axle end on the right.
function rearAdjust(g0,adj){const g=JSON.parse(JSON.stringify(g0)),R=Rq(g0.q0);
  if(adj.TBtype&&g.JB){g.A.TB=g.JB.A.slice();g.C.TB=g.JB.C.slice();}
  if(adj.TBflip){g.A.TB[1]*=-1;g.C.TB[1]*=-1;}
  g.A.UL[1]+=adj.ULya||0;g.C.UL[1]+=adj.ULyc||0;   // slide the 3rd link axle / chassis end toward the left (+), in
  LINKS.forEach(k=>{g.A[k][2]+=adj[k+'a']||0;g.C[k][2]+=adj[k+'c']||0;g.L[k]=V.dist(onAxle(g0.q0,R,g.A[k]),g.C[k]);});
  g.L.UL+=adj.ULlen||0; if(adj.ULlen)g.q0=rearSolve(g,g.z0,0,g0.q0);
  return g;}
// axle pose at bump h (axle center vs body, in) and roll psi (axle vs body, rad, + = left side up)
function rearPose(g,h,psi,guess){
  const z=g.z0+h,q=rearSolve(g,z,psi,guess),R=Rq(q),e=1e-3;
  const dy=(a,b)=>rearSolve(g,z+a,psi+b,q)[1];
  const k=(dy(e,0)-dy(-e,0))/(2*e);                         // lateral axle move per inch of bump
  const rcz=q[2]+(dy(0,e)-dy(0,-e))/(2*e)-h;                // roll center height above the ground
  const P={};LINKS.forEach(x=>P[x]=onAxle(q,R,g.A[x]));
  const W={L:onAxle(q,R,g.W.L),R:onAxle(q,R,g.W.R)},W0=(s)=>onAxle(g.q0,Rq(g.q0),g.W[s]);
  // side view: lower link and 3rd link lines meet at the instant center; anti-squat from the contact patch
  const svic=lo=>{const a=P[lo],b=g.C[lo],c=P.UL,d=g.C.UL,d1=[b[0]-a[0],b[2]-a[2]],d2=[d[0]-c[0],d[2]-c[2]],den=d1[0]*d2[1]-d1[1]*d2[0];
    if(Math.abs(den)<1e-9)return null;const t=((c[0]-a[0])*d2[1]-(c[2]-a[2])*d2[0])/den;return [a[0]+d1[0]*t,a[2]+d1[1]*t];};
  const tanAt=(lo,s)=>{const ic=svic(lo);return ic?(ic[1]-(W[s][2]-TIRE_R))/(ic[0]-W[s][0]):0;};
  const tb=V.sub(P.TB,g.C.TB);
  return {q,R,P,W,h,shift:q[1]-g.q0[1],ratio:-k,rcz,steer:-q[5]*D,pinion:(q[4]-g.q0[4])*D,
    wbL:W.L[0]-W0('L')[0],wbR:W.R[0]-W0('R')[0],tanSV:(tanAt('LL','L')+tanAt('RL','R'))/2,ic:{L:svic('LL'),R:svic('RL')},
    tbAng:Math.atan2(g.C.TB[2]-P.TB[2],Math.hypot(tb[0],tb[1]))*D,
    shock:{L:V.dist(onAxle(q,R,g.S.L[0]),g.S.L[1]),R:V.dist(onAxle(q,R,g.S.R[0]),g.S.R[1])}};
}

root.KIN={Rq,onAxle,solveLin,rearBuild,rearAdjust,rearSolve,rearPose,LINKS,TIRE_R,V,build,poseAt,poseH,angles,ics,rollCenter,antiDive,rot,frame,solve,selfTest,shockLen,shockEye};
})(typeof window!=='undefined'?window:globalThis);
