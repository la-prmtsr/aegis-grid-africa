// The 3D day story: scroll position drives time of day, camera, energy flows and the HUD.
// Plain three.js, pinned to 0.128 so lighting and colours match the approved design.
import * as THREE from 'three';

export function startScene() {
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(max-width: 860px)').matches;
const canvas = document.getElementById('scene');
const R = new THREE.WebGLRenderer({canvas, antialias:true});
R.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.25 : 1.5));
R.shadowMap.enabled = !mobile;
R.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 500);

/* ---------- helpers ---------- */
const C = h => new THREE.Color(h);
const V = (x,y,z) => new THREE.Vector3(x,y,z);
const lam = (c, o={}) => new THREE.MeshLambertMaterial(Object.assign({color:c, flatShading:true}, o));
function mesh(geo, mat, x=0, y=0, z=0, cast=true){
  const m = new THREE.Mesh(geo, mat); m.position.set(x,y,z);
  m.castShadow = cast; m.receiveShadow = true; scene.add(m); return m;
}
const smooth = t => t*t*(3-2*t);
const clamp = (v,a=0,b=1) => Math.min(b, Math.max(a, v));

/* ---------- sky ---------- */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite:false,
  uniforms:{top:{value:C('#9CC9F0')}, bot:{value:C('#FFD9B8')}, sunDir:{value:new THREE.Vector3(1,0,0)}, sunCol:{value:C('#FFB27A')}, glow:{value:0}},
  vertexShader:'varying vec3 vP; void main(){ vP=(modelMatrix*vec4(position,1.0)).xyz; gl_Position=projectionMatrix*viewMatrix*vec4(vP,1.0);}',
  fragmentShader:'uniform vec3 top; uniform vec3 bot; uniform vec3 sunDir; uniform vec3 sunCol; uniform float glow; varying vec3 vP; void main(){ vec3 d=normalize(vP-cameraPosition); float h=clamp(d.y*1.6+0.05,0.0,1.0); vec3 c=mix(bot,top,pow(h,0.8)); float s=max(dot(d,sunDir),0.0); c+=sunCol*(pow(s,6.0)*0.32+pow(s,48.0)*0.55)*glow; gl_FragColor=vec4(c,1.0);}'
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(240, 32, 16), skyMat));
scene.fog = new THREE.Fog(C('#FFD9B8'), 26, 112);

/* stars */
const starGeo = new THREE.BufferGeometry(); const sp = [];
for(let i=0;i<500;i++){ const th=Math.random()*Math.PI*2, ph=Math.random()*1.25; const r=220;
  sp.push(r*Math.sin(ph)*Math.cos(th), r*Math.cos(ph)*0.9+10, r*Math.sin(ph)*Math.sin(th)); }
starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp,3));
const starMat = new THREE.PointsMaterial({color:'#FFFFFF', size:1.6, sizeAttenuation:false, transparent:true, opacity:0, fog:false, depthWrite:false});
scene.add(new THREE.Points(starGeo, starMat));

/* ---------- lights ---------- */
const hemi = new THREE.HemisphereLight(0xffffff, 0xD8C8A8, 0.6); scene.add(hemi);
const sunL = new THREE.DirectionalLight(0xffffff, 0.9);
sunL.castShadow = true; sunL.shadow.mapSize.set(mobile?1024:2048, mobile?1024:2048); sunL.shadow.normalBias = 0.02;
Object.assign(sunL.shadow.camera, {left:-28, right:28, top:28, bottom:-28, near:1, far:220});
sunL.shadow.bias = -0.0008; scene.add(sunL); scene.add(sunL.target);

const glowTex = (()=>{ const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d');
  const r=g.createRadialGradient(64,64,0,64,64,64); r.addColorStop(0,'rgba(255,255,255,1)'); r.addColorStop(.22,'rgba(255,255,255,.75)'); r.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=r; g.fillRect(0,0,128,128); return new THREE.CanvasTexture(c); })();
const sprite = (color, s) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex, color, depthWrite:false, fog:false, transparent:true}));
  m.scale.set(s,s,1); scene.add(m); return m; };
const coreTex = (()=>{ const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d');
  const r=g.createRadialGradient(64,64,40,64,64,62); r.addColorStop(0,'rgba(255,255,255,1)'); r.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=r; g.beginPath(); g.arc(64,64,62,0,Math.PI*2); g.fill(); return new THREE.CanvasTexture(c); })();
const sunDisc = sprite('#FFD8A0', 70);
const sunCore = new THREE.Sprite(new THREE.SpriteMaterial({map:coreTex, color:'#FFF4DC', depthWrite:false, fog:false, transparent:true})); sunCore.scale.set(22,22,1); scene.add(sunCore);
const introStart = performance.now(), WHITE = new THREE.Color('#FFFFFF');
const fwd = new THREE.Vector3(), flatF = new THREE.Vector3(), rightV = new THREE.Vector3(), UP = new THREE.Vector3(0,1,0);
function skyPoint(sx, sh, D){ // place a point on the visible sky, relative to the camera (sx: -1 left … 1 right, sh: 0 horizon … 1 near top)
  cam.getWorldDirection(fwd); const pitch = Math.asin(clamp(fwd.y,-1,1));
  flatF.set(fwd.x,0,fwd.z).normalize(); rightV.crossVectors(flatF, UP).normalize();
  const vHalf = THREE.MathUtils.degToRad(cam.fov/2), hHalf = Math.atan(Math.tan(vHalf)*cam.aspect);
  const topE = pitch + vHalf, room = topE > 0 ? topE - Math.min(0.1, topE*0.25) : topE;
  const elev = sh >= 0 ? sh*room : sh*0.25, az = sx*Math.max(0.05, hHalf - 0.1);
  const dir = flatF.clone().multiplyScalar(Math.cos(az)).addScaledVector(rightV, Math.sin(az)).multiplyScalar(Math.cos(elev)); dir.y = Math.sin(elev);
  return {dir, pos: cam.position.clone().addScaledVector(dir, D), elev};
}
const moon = sprite('#EEF2FF', 22); moon.position.set(-70,85,-120); moon.material.opacity = 0;
const moonPos = V(-40, 60, -30);

/* ---------- world: terrain, roads, buildings, vegetation ---------- */
const curve = pts => new THREE.CatmullRomCurve3(pts.map(p=>V(...p)));
const sstep = (a,b,v) => { const t = clamp((v-a)/(b-a)); return t*t*(3-2*t); };
let seed = 7; const rnd = () => { seed = (seed*16807) % 2147483647; return (seed-1)/2147483646; };
const timeU = {value:0};
function sway(mat, k){
  mat.onBeforeCompile = sh => { sh.uniforms.uTime = timeU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      #ifdef USE_INSTANCING
        float sw = max(position.y - 0.25, 0.0);
        vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
        transformed.x += sin(uTime*1.25 + ip.x*0.37 + ip.y*0.21) * ${k.toFixed(4)} * sw * sw;
        transformed.z += cos(uTime*0.95 + ip.y*0.31) * ${(k*0.7).toFixed(4)} * sw * sw;
      #endif`); };
  mat.customProgramCacheKey = () => 'sway'+k; return mat;
}
function merge(parts){ // parts: [geometry, color|null]
  const pos=[], nor=[], col=[]; const c = new THREE.Color();
  parts.forEach(([g0, hex])=>{ const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position.array, n = g.attributes.normal.array, gc = g.attributes.color;
    for(let i=0;i<p.length;i+=3){ pos.push(p[i],p[i+1],p[i+2]); nor.push(n[i],n[i+1],n[i+2]);
      if(hex) { c.set(hex); col.push(c.r,c.g,c.b); } else col.push(gc.array[i],gc.array[i+1],gc.array[i+2]); } });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor,3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col,3)); g.computeBoundingSphere(); return g;
}
function blob(r, noiseAmp, dark, light, sx=1, sy=1, sz=1, ox=0, oy=0, oz=0){
  const g = new THREE.IcosahedronGeometry(r, 2); const p = g.attributes.position, cols = [];
  const cd = C(dark), cl = C(light), t = new THREE.Color();
  const nr = g.attributes.normal;
  for(let i=0;i<p.count;i++){ let x=p.getX(i), y=p.getY(i), z=p.getZ(i);
    const n = 1 + noiseAmp*(Math.sin(x*5.1+y*3.7)*Math.sin(z*4.3-y*2.9) + 0.5*Math.sin(x*9.3+z*8.1));
    const nx=x/sx, ny=y/sy, nz=z/sz, nl=Math.hypot(nx,ny,nz)||1; nr.setXYZ(i, nx/nl, ny/nl, nz/nl);
    x*=n*sx; y*=n*sy; z*=n*sz; p.setXYZ(i, x+ox, y+oy, z+oz);
    t.copy(cd).lerp(cl, clamp((y/(r*sy)+1)/2*1.15 + 0.08*Math.sin(x*7+z*5)));
    cols.push(t.r,t.g,t.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols,3)); return g;
}

function bake(group){ // merge a group's direct child meshes per material: far fewer draw calls for static parts
  const byMat = new Map(), keep = [];
  group.children.slice().forEach(ch=>{ if(!ch.isMesh || ch.children.length){ keep.push(ch); return; }
    ch.updateMatrix(); let g = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone(); g.applyMatrix4(ch.matrix);
    if(!byMat.has(ch.material)) byMat.set(ch.material, {gs:[], cast:false}); const e = byMat.get(ch.material); e.gs.push(g); e.cast = e.cast || ch.castShadow; group.remove(ch); });
  byMat.forEach((e, mat)=>{ const pos=[], nor=[], uv=[];
    e.gs.forEach(g=>{ pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
      if(g.attributes.uv) uv.push(...g.attributes.uv.array); else for(let i=0;i<g.attributes.position.count;i++) uv.push(0,0); });
    const m = new THREE.BufferGeometry(); m.setAttribute('position', new THREE.Float32BufferAttribute(pos,3)); m.setAttribute('normal', new THREE.Float32BufferAttribute(nor,3)); m.setAttribute('uv', new THREE.Float32BufferAttribute(uv,2));
    const mm = new THREE.Mesh(m, mat); mm.castShadow = e.cast; mm.receiveShadow = true; group.add(mm); });
}

/* height field: flat village, a plateau for the solar farm, rolling hills further out */
const road2 = pts => curve(pts.map(([x,z])=>[x,0,z]));
const mainRoad = road2([[-34,-3.2],[-20,-4.6],[-10,-6.0],[-3,-6.7],[3,-3.5],[8,-0.1],[12,3.1],[17,6.6],[23,10.6],[34,17]]);
const lane = road2([[-1.4,-6.2],[-2.1,-1.6],[-1.9,2.6],[-2.8,6.6],[-4.4,11],[-6.4,18]]);
const roadSamples = mainRoad.getSpacedPoints(400).concat(lane.getSpacedPoints(120));
function H(x,z){
  const ex=(x+11.8)/6.4, ez=(z+14.6)/4.4, e=Math.sqrt(ex*ex+ez*ez);
  let plateau = 2.62*(1-sstep(1.0,1.95,e));
  if(plateau > 0.001){ let md = 1e9; for(const q of roadSamples){ const dd=(q.x-x)*(q.x-x)+(q.z-z)*(q.z-z); if(dd<md) md=dd; } plateau *= sstep(2.2, 4.5, Math.sqrt(md)); }
  const r = Math.hypot(x-2, z-1);
  const hills = sstep(19,46,r)*(4.4 + 3.4*Math.sin(x*0.085+1.1)*Math.sin(z*0.07+0.4) + 2.2*Math.sin((x-z)*0.045+2.3));
  const micro = sstep(15,27,r)*0.28*Math.sin(x*0.5+z*0.3)*Math.sin(z*0.45-x*0.2);
  return Math.max(plateau, Math.max(0, hills) + micro);
}
const grainTex = (()=>{ const c=document.createElement('canvas'); c.width=c.height=256; const g=c.getContext('2d');
  g.fillStyle='#FFFFFF'; g.fillRect(0,0,256,256);
  for(let i=0;i<5200;i++){ const v = 200 + Math.floor(rnd()*55); g.fillStyle=`rgb(${v},${v},${v})`; g.fillRect(rnd()*256, rnd()*256, 1+rnd()*2, 1+rnd()*2); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(46,46); return t; })();
{
  const g = new THREE.PlaneGeometry(200, 200, mobile ? 70 : 105, mobile ? 70 : 105); g.rotateX(-Math.PI/2);
  const p = g.attributes.position, cols = []; const base=C('#93C25A'), lite=C('#B7D873'), dark=C('#74A748'), dry=C('#C6C67E'), top=C('#A9D26A'), t=new THREE.Color();
  for(let i=0;i<p.count;i++){ const x=p.getX(i), z=p.getZ(i), y=H(x,z); p.setY(i,y);
    const n = 0.5+0.5*Math.sin(x*0.21+Math.sin(z*0.17)*2)*Math.cos(z*0.19+x*0.05);
    const n2 = 0.5+0.5*Math.sin(x*0.083-z*0.061+1.7);
    t.copy(dark).lerp(base, sstep(0.1,0.6,n)).lerp(lite, sstep(0.55,0.95,n)*0.8);
    if(y>2.4) t.lerp(top, 0.55);
    t.lerp(dry, sstep(0.72,0.95,n2)*0.55);
    cols.push(t.r,t.g,t.b); }
  const gf = g.toNonIndexed(), fp = gf.attributes.position, fc = [];
  const fields = ['#8CBF54','#9FCB60','#B2D56E','#7DB14A','#C1DC80','#97C65B'].map(C), lawnC = C('#9DCA5F'), plateauC = C('#A6D068'), fc0 = new THREE.Color();
  for(let i=0;i<fp.count;i+=3){ const x=(fp.getX(i)+fp.getX(i+1)+fp.getX(i+2))/3, z=(fp.getZ(i)+fp.getZ(i+1)+fp.getZ(i+2))/3, y=(fp.getY(i)+fp.getY(i+1)+fp.getY(i+2))/3;
    const r = Math.hypot(x-2, z-1);
    const band = 0.5+0.5*Math.sin(x*0.11 + Math.sin(z*0.09)*2.2) * Math.cos(z*0.13 - x*0.04 + 0.7);
    fc0.copy(fields[Math.min(5, Math.floor(band*6))]);
    const village = 1 - sstep(13, 22, r); fc0.lerp(lawnC, village*0.85);
    if(y > 2.3) fc0.lerp(plateauC, 0.7);
    fc0.offsetHSL(0, 0, (Math.sin(x*1.7+z*2.3)*0.5)*0.025);
    for(let k=0;k<3;k++) fc.push(fc0.r, fc0.g, fc0.b); }
  gf.setAttribute('color', new THREE.Float32BufferAttribute(fc,3)); gf.computeVertexNormals();
  const terrain = new THREE.Mesh(gf, new THREE.MeshLambertMaterial({vertexColors:true, flatShading:true})); terrain.receiveShadow = true; scene.add(terrain);
}
/* layered hazy mountain ridges, tinted from the sky every frame */
const ridgeMats = [];
[[92,6.5,0],[118,9.5,1],[150,14,2]].forEach(([R0,amp,li])=>{ const pos=[], idx=[], N=150;
  for(let i=0;i<=N;i++){ const th=i/N*Math.PI*2; const pk = Math.abs(Math.sin(th*3+li*1.7))*0.55 + Math.abs(Math.sin(th*7+li))*0.3 + 0.18*Math.sin(th*13+li*3) + 0.25;
    const x=2+Math.cos(th)*R0, z=1+Math.sin(th)*R0; pos.push(x,-4,z, x, amp*pk, z); if(i<N){ const a=i*2; idx.push(a,a+1,a+2, a+1,a+3,a+2); } }
  const gg=new THREE.BufferGeometry(); gg.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); gg.setIndex(idx);
  const mm=new THREE.MeshBasicMaterial({color:'#C9B8D2', fog:false, side:THREE.DoubleSide}); ridgeMats.push(mm);
  const ridge=new THREE.Mesh(gg,mm); ridge.renderOrder=-1; scene.add(ridge); });
{
}

/* roads: asphalt main road with markings, packed-laterite lanes */
const kioskPath = road2([[9.7,1.9],[8.7,4.0]]);
const roadPts = [];
function ribbon(cv, w, color, lift, segs, opts={}){
  const pos=[], uv=[], idx=[]; const P=new THREE.Vector3(), T=new THREE.Vector3();
  for(let i=0;i<=segs;i++){ const u=i/segs; cv.getPointAt(u,P); cv.getTangentAt(u,T); const sx=-T.z, sz=T.x, L=Math.hypot(sx,sz)||1;
    for(const s of [-1,1]){ const x=P.x+s*sx/L*w/2+(opts.off||0)*sx/L, z=P.z+s*sz/L*w/2+(opts.off||0)*sz/L; pos.push(x, H(x,z)+lift, z); uv.push(s<0?0:1, u*cv.getLength()/2); }
    if(opts.track) roadPts.push([P.x,P.z,w/2]);
    if(i<segs){ const a=i*2; idx.push(a,a+1,a+2, a+1,a+3,a+2); } }
  const g=new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); g.setIndex(idx); g.computeVertexNormals();
  const m=new THREE.Mesh(g, opts.mat || new THREE.MeshLambertMaterial({color})); m.receiveShadow=true; scene.add(m); return m;
}
const dashTex = (()=>{ const c=document.createElement('canvas'); c.width=8; c.height=64; const g=c.getContext('2d'); g.fillStyle='#F5F1E6'; g.fillRect(0,0,8,30);
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; return t; })();
const asphaltTex = (()=>{ const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d'); g.fillStyle='#A9AEB4'; g.fillRect(0,0,128,128);
  for(let i=0;i<1400;i++){ const v=155+Math.floor(rnd()*30); g.fillStyle=`rgb(${v},${v+2},${v+5})`; g.fillRect(rnd()*128,rnd()*128,1,1); }
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(1,0.6); return t; })();
ribbon(mainRoad, 3.3, '#E6E2D9', 0.11, 220);                                    // shoulder
ribbon(mainRoad, 2.3, '#8B9096', 0.125, 220, {track:true, mat:new THREE.MeshLambertMaterial({map:asphaltTex})});
ribbon(mainRoad, 0.07, '#F5F1E6', 0.14, 220, {off: 1.02}); ribbon(mainRoad, 0.07, '#F5F1E6', 0.14, 220, {off:-1.02});
ribbon(mainRoad, 0.09, null, 0.142, 220, {mat:new THREE.MeshBasicMaterial({map:dashTex, transparent:true, alphaTest:0.5, color:'#F5F1E6'})}).material.map.repeat.set(1,1);
ribbon(lane, 1.7, '#E3DFD6', 0.09, 90, {track:true});
ribbon(lane, 1.25, '#B4B8BD', 0.1, 90);
ribbon(kioskPath, 1.3, '#E3DFD6', 0.09, 10, {track:true}); ribbon(kioskPath, 0.95, '#B4B8BD', 0.1, 10);
// laterite forecourt in front of the kiosk
{ const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d'); const r=g.createRadialGradient(64,64,10,64,64,64);
  r.addColorStop(0,'rgba(218,212,201,1)'); r.addColorStop(.62,'rgba(218,212,201,.92)'); r.addColorStop(1,'rgba(218,212,201,0)'); g.fillStyle=r; g.fillRect(0,0,128,128);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(4.2,3.4), new THREE.MeshLambertMaterial({map:new THREE.CanvasTexture(c), transparent:true, depthWrite:false}));
  f.rotation.set(-Math.PI/2,0,0.55); f.position.set(8.1,0.04,5.7); f.receiveShadow=true; scene.add(f); }

/* soft contact shadows */
const blobTex = (()=>{ const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d');
  const r=g.createRadialGradient(64,64,4,64,64,64); r.addColorStop(0,'rgba(20,30,20,.55)'); r.addColorStop(.6,'rgba(20,30,20,.22)'); r.addColorStop(1,'rgba(20,30,20,0)');
  g.fillStyle=r; g.fillRect(0,0,128,128); return new THREE.CanvasTexture(c); })();
const blobMat = new THREE.MeshBasicMaterial({map:blobTex, transparent:true, depthWrite:false});
function contact(x,z,sx,sz,rot=0){ const m=new THREE.Mesh(new THREE.PlaneGeometry(1,1), blobMat); m.rotation.set(-Math.PI/2,0,rot); m.scale.set(sx,sz,1); m.position.set(x,H(x,z)+0.05,z); m.renderOrder=1; scene.add(m); }

/* solar farm on the plateau */
const cellTex = (()=>{ const c=document.createElement('canvas'); c.width=256; c.height=160; const g=c.getContext('2d');
  const gr=g.createLinearGradient(0,0,256,160); gr.addColorStop(0,'#2B4C86'); gr.addColorStop(.55,'#1C3566'); gr.addColorStop(1,'#2A4A80'); g.fillStyle=gr; g.fillRect(0,0,256,160);
  g.strokeStyle='rgba(190,210,240,.55)'; g.lineWidth=1.4; for(let i=1;i<10;i++){ g.beginPath(); g.moveTo(i*25.6,0); g.lineTo(i*25.6,160); g.stroke(); }
  for(let j=1;j<6;j++){ g.beginPath(); g.moveTo(0,j*26.7); g.lineTo(256,j*26.7); g.stroke(); }
  g.strokeStyle='#C9D3DF'; g.lineWidth=6; g.strokeRect(0,0,256,160);
  const t=new THREE.CanvasTexture(c); t.anisotropy=4; return t; })();
const panelMat = new THREE.MeshStandardMaterial({map:cellTex, color:'#FFFFFF', roughness:0.3, metalness:0.15, emissive:'#0B1F45', emissiveIntensity:0.4});
const metalMat = new THREE.MeshStandardMaterial({color:'#B8C2CE', roughness:0.45, metalness:0.5});
const farmCells = []; for(let r=0;r<4;r++) for(let c=0;c<6;c++) farmCells.push([-16.2 + c*1.75, -17 + r*1.6]);
{
  const d = new THREE.Object3D();
  const farm = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.05, 1.0), panelMat, farmCells.length); farm.castShadow = true; farm.receiveShadow = true;
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06,1,0.06), metalMat, farmCells.length*4); legs.castShadow = true;
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(1.7,0.05,0.06), metalMat, farmCells.length*2);
  farmCells.forEach(([x,z],i)=>{ const gy = H(x,z);
    d.position.set(x, gy+0.62, z); d.rotation.set(-0.45,0,0); d.scale.set(1,1,1); d.updateMatrix(); farm.setMatrixAt(i, d.matrix);
    [[-0.68,0.36,0.35],[0.68,0.36,0.35],[-0.68,-0.36,0.85],[0.68,-0.36,0.85]].forEach(([lx,lz,hh],k)=>{ d.position.set(x+lx, gy+hh/2, z+lz); d.rotation.set(0,0,0); d.scale.set(1,hh,1); d.updateMatrix(); legs.setMatrixAt(i*4+k, d.matrix); });
    [[0.36,0.4],[-0.36,0.83]].forEach(([lz,hy],k)=>{ d.position.set(x, gy+hy, z+lz); d.rotation.set(0,0,0); d.scale.set(1,1,1); d.updateMatrix(); rails.setMatrixAt(i*2+k, d.matrix); });
  });
  scene.add(farm, legs, rails);
  // perimeter fence
  const posts = [], N = 38;
  for(let i=0;i<N;i++){ const a=i/N*Math.PI*2; const x=-11.8+Math.cos(a)*6.4*1.08, z=-14.6+Math.sin(a)*4.4*1.15; posts.push([x,z]); }
  const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06,0.9,0.06), metalMat, N);
  const fm = new THREE.InstancedMesh(new THREE.PlaneGeometry(1,0.75), new THREE.MeshLambertMaterial({color:'#C6CFD8', transparent:true, opacity:0.35, side:THREE.DoubleSide, depthWrite:false}), N);
  posts.forEach(([x,z],i)=>{ const y=H(x,z); d.position.set(x,y+0.45,z); d.rotation.set(0,0,0); d.scale.set(1,1,1); d.updateMatrix(); pm.setMatrixAt(i,d.matrix);
    const [x2,z2]=posts[(i+1)%N]; const L=Math.hypot(x2-x,z2-z); d.position.set((x+x2)/2, (y+H(x2,z2))/2+0.45, (z+z2)/2); d.rotation.set(0,-Math.atan2(z2-z,x2-x),0); d.scale.set(L,1,1); d.updateMatrix(); fm.setMatrixAt(i,d.matrix); });
  scene.add(pm, fm);
  // inverter station
  const st = new THREE.Group(); const ix=-6.1, iz=-10.5, iy=Math.max(H(ix-1,iz),H(ix+1,iz),H(ix,iz-0.6),H(ix,iz+0.6)); st.position.set(ix, iy, iz); st.rotation.y = 0.45; scene.add(st);
  const sadd = (geo, mat, x,y,z, cast=true) => { const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z); m.castShadow=cast; m.receiveShadow=true; st.add(m); return m; };
  sadd(new THREE.BoxGeometry(2.7,0.9,1.6), lam('#D9D5CC'), 0,-0.38,0);
  const shell = new THREE.MeshStandardMaterial({color:'#EEF1F4', roughness:0.55, metalness:0.15});
  sadd(new THREE.BoxGeometry(2.3,1.15,1.15), shell, 0,0.65,0);
  sadd(new THREE.BoxGeometry(2.4,0.08,1.25), lam('#D5DAE0'), 0,1.26,0);
  for(let k=0;k<11;k++) sadd(new THREE.BoxGeometry(0.035,1.0,0.02), lam('#CBD2DA'), -1.0+k*0.2, 0.65, 0.585, false);
  const glowStrip = new THREE.MeshBasicMaterial({color:'#4ADE80', fog:false}); sadd(new THREE.BoxGeometry(0.08,0.8,0.03), glowStrip, -0.75,0.66,0.6, false);
  const logoTex = (()=>{ const c=document.createElement('canvas'); c.width=c.height=64; const g=c.getContext('2d'); g.fillStyle='#16A34A'; g.beginPath(); g.arc(32,32,30,0,Math.PI*2); g.fill();
    g.fillStyle='#FFFFFF'; g.beginPath(); g.moveTo(20,44); g.quadraticCurveTo(18,18,46,18); g.quadraticCurveTo(46,44,20,44); g.fill(); return new THREE.CanvasTexture(c); })();
  sadd(new THREE.PlaneGeometry(0.42,0.42), new THREE.MeshBasicMaterial({map:logoTex, transparent:true}), 0.55,0.75,0.6, false);
  const stGlow = sprite('#86EFAC', 1.6); scene.updateMatrixWorld(true); stGlow.position.set(ix-0.6, iy+0.66, iz+0.9); stGlow.material.opacity = 0.55;
}

/* pole-mounted transformer */
const trafoPos = V(-2.6, 3.9, -4.2);
const woodMat = new THREE.MeshLambertMaterial({color:'#7B6A55'});
const insMat = new THREE.MeshStandardMaterial({color:'#E9EEF2', roughness:0.3, metalness:0.05});
function pole(x,z,top=3.6){ const by=H(x,z), h=top-by;
  mesh(new THREE.CylinderGeometry(0.08,0.13,h,8), woodMat, x,by+h/2,z);
  mesh(new THREE.BoxGeometry(1.1,0.08,0.09), woodMat, x,top-0.22,z);
  [-0.45,0,0.45].forEach(o=>mesh(new THREE.CylinderGeometry(0.035,0.05,0.14,8), insMat, x+o, top-0.12, z, false)); }
mesh(new THREE.CylinderGeometry(0.13,0.17,4.8,8), woodMat, -2.6,2.4,-4.4);
mesh(new THREE.BoxGeometry(1.2,0.09,0.1), woodMat, -2.6,4.55,-4.4);
[-0.5,0,0.5].forEach(o=>mesh(new THREE.CylinderGeometry(0.035,0.05,0.16,8), insMat, -2.6+o, 4.67, -4.4, false));
{ const tm = new THREE.MeshStandardMaterial({color:'#98A3B0', roughness:0.4, metalness:0.55});
  mesh(new THREE.CylinderGeometry(0.36,0.36,0.95,20), tm, -2.6,3.72,-4.05);
  mesh(new THREE.CylinderGeometry(0.38,0.38,0.06,20), tm, -2.6,4.22,-4.05);
  [-0.16,0.16].forEach(o=>mesh(new THREE.CylinderGeometry(0.04,0.06,0.22,8), insMat, -2.6+o,4.36,-4.05, false));
  for(let k=0;k<6;k++){ const a=k/6*Math.PI*2; mesh(new THREE.BoxGeometry(0.04,0.7,0.12), tm, -2.6+Math.cos(a)*0.38, 3.7, -4.05+Math.sin(a)*0.38, false).rotation.y = -a; }
  mesh(new THREE.BoxGeometry(0.12,0.5,0.3), tm, -2.6,3.75,-4.32, false); }
const trafoLed = mesh(new THREE.SphereGeometry(0.09,10,8), new THREE.MeshBasicMaterial({color:'#22D3EE', fog:false}), -2.6,3.95,-3.67, false);

/* poles + wires */
pole(-7,-9.5,4.05); pole(1.6,-1.6,3.5); pole(7.4,2.5,3.3);
const wireMat = new THREE.MeshLambertMaterial({color:'#3F4651'});
function wire(pts){ const cv = curve(pts); scene.add(new THREE.Mesh(new THREE.TubeGeometry(cv, 80, 0.024, 5, false), wireMat)); return cv; }
const stTop = Math.max(H(-7.1,-10.5),H(-5.1,-10.5),H(-6.1,-11.1),H(-6.1,-9.9)) + 1.3;   // roof of the grey station
const cFarm  = wire([[-8.9,H(-8.9,-12.3)+0.75,-12.3],[-8.0,stTop+0.25,-11.6],[-6.9,stTop+0.12,-10.9],[-6.1,stTop+0.08,-10.5],[-6.3,stTop+0.45,-9.9],[-7.05,3.85,-9.55],[-5.4,3.05,-7.6],[-3.9,3.2,-5.6],[-2.6,3.95,-4.2]]);
const cHouse = wire([[-2.6,3.95,-4.2],[-0.4,3.0,-2.8],[1.6,3.3,-1.6],[3.2,2.7,-0.6],[4.6,1.7,0.6]]);
wire([[1.6,3.3,-1.6],[4.6,2.9,0.6],[7.4,3.1,2.5]]);
const cP2P   = wire([[4.6,1.7,0.6],[6.0,2.7,1.6],[7.4,3.1,2.5],[8.0,2.6,3.2],[8.4,1.9,3.7]]);
wire([[-2.6,4.6,-4.4],[-8.3,4.15,-6.5],[-14,4.5,-8.4]]); wire([[-2.6,4.6,-4.4],[4,4.1,-6.5],[10,4.4,-8]]);
pole(-14,-8.4,4.6); pole(10,-8,4.6);

/* houses with gable roofs, framed windows, doors, porches */
const houses = [];
const frameMat = new THREE.MeshLambertMaterial({color:'#F4F1EA'});
const doorMat = new THREE.MeshLambertMaterial({color:'#7A5236'});
const plinthMat = new THREE.MeshLambertMaterial({color:'#B9B2A4'});
const lawnMat = (()=>{ const c=document.createElement('canvas'); c.width=c.height=128; const g=c.getContext('2d'); g.fillStyle='rgba(0,0,0,0)'; g.fillRect(0,0,128,128);
  g.fillStyle='#ADD670'; g.beginPath(); g.roundRect ? g.roundRect(6,6,116,116,22) : g.rect(6,6,116,116); g.fill();
  g.strokeStyle='#D9E9B0'; g.lineWidth=5; g.stroke(); return new THREE.MeshLambertMaterial({map:new THREE.CanvasTexture(c), transparent:true, depthWrite:false}); })();
function house(x,z,w,d,h,wall,roof,rot=0,opt={}){
  const g = new THREE.Group(); g.position.set(x,0,z); g.rotation.y = rot; scene.add(g);
  const add = (geo, mat, px,py,pz, cast=true) => { const m=new THREE.Mesh(geo,mat); m.position.set(px,py,pz); m.castShadow=cast; m.receiveShadow=true; g.add(m); return m; };
  const wallM = new THREE.MeshLambertMaterial({color:wall}), roofM = new THREE.MeshLambertMaterial({color:roof});
  // lawn plot around the house
  { const lw = new THREE.Mesh(new THREE.PlaneGeometry(w+2.6, d+3.0), lawnMat); lw.rotation.x=-Math.PI/2; lw.position.set(0,0.012,0.35); lw.receiveShadow=true; g.add(lw); }
  const by = 0.16;
  add(new THREE.BoxGeometry(w+0.18,by,d+0.18), plinthMat, 0,by/2,0);
  add(new THREE.BoxGeometry(w,h,d), wallM, 0,by+h/2,0);
  // hip roof
  roofM.flatShading = true;
  const ov = 0.32, top = by+h, rw = w+ov*2, rd = d+ov*2, rh = Math.min(w,d)*0.5, half = rd/2, a = Math.atan2(rh, half);
  const hip = new THREE.ConeGeometry(Math.SQRT2/2, 1, 4, 1); hip.rotateY(Math.PI/4); hip.scale(rw, rh, rd); hip.translate(0, rh/2, 0);
  add(hip, roofM, 0, top+0.06, 0);
  add(new THREE.BoxGeometry(rw+0.02,0.1,rd+0.02), new THREE.MeshLambertMaterial({color:C(roof).multiplyScalar(0.75)}), 0, top+0.03, 0);
  // windows
  const wm = new THREE.MeshLambertMaterial({color:'#EFD9A2', emissive:'#FFB648', emissiveIntensity:0.6});
  const win = (px,py,pz,ry,ww=0.46,wh=0.5) => { const f=add(new THREE.BoxGeometry(ww+0.1,wh+0.1,0.05), frameMat, px,py,pz,false); f.rotation.y=ry;
    const gl=add(new THREE.BoxGeometry(ww,wh,0.06), wm, px,py,pz,false); gl.rotation.y=ry;
    const sill=add(new THREE.BoxGeometry(ww+0.16,0.05,0.12), frameMat, px+Math.sin(ry)*0.04, py-wh/2-0.06, pz+Math.cos(ry)*0.04,false); sill.rotation.y=ry; };
  const wy = by + h*0.56, fz = d/2+0.01;
  const cols = w > 3 ? [-w*0.33, w*0.12, w*0.36] : [-w*0.28, w*0.28];
  const doorX = w > 3 ? -w*0.1 : 0.02;
  cols.forEach(cx=>{ if(Math.abs(cx-doorX) > 0.45) win(cx, wy, fz, 0); });
  win(w/2+0.01, wy, 0, Math.PI/2); win(-w/2-0.01, wy, 0, -Math.PI/2); win(w*0.25, wy, -fz, Math.PI);
  add(new THREE.BoxGeometry(0.5,0.92,0.06), doorMat, doorX, by+0.46, fz, false);
  add(new THREE.BoxGeometry(0.62,0.04,0.08), frameMat, doorX, by+0.94, fz, false);
  add(new THREE.BoxGeometry(0.8,0.08,0.4), plinthMat, doorX, 0.04, fz+0.25, false);
  if(opt.porch){ add(new THREE.BoxGeometry(1.3,0.06,0.8), roofM, doorX, by+1.18, fz+0.42); [-0.55,0.55].forEach(o=>add(new THREE.CylinderGeometry(0.035,0.035,1.15,8), frameMat, doorX+o, by+0.6, fz+0.75)); }
  if(opt.tank){ const tx = -w/2-0.55, tz = -d/2+0.4;
    [[-0.22,-0.22],[0.22,-0.22],[-0.22,0.22],[0.22,0.22]].forEach(([a1,b1])=>add(new THREE.BoxGeometry(0.05,1.1,0.05), metalMat, tx+a1, 0.55, tz+b1));
    add(new THREE.BoxGeometry(0.6,0.05,0.6), metalMat, tx, 1.12, tz);
    add(new THREE.CylinderGeometry(0.3,0.3,0.62,18), new THREE.MeshLambertMaterial({color: opt.tank}), tx, 1.46, tz);
    add(new THREE.CylinderGeometry(0.12,0.12,0.06,12), new THREE.MeshLambertMaterial({color:'#1F2937'}), tx, 1.8, tz); }
  if(opt.ac){ add(new THREE.BoxGeometry(0.5,0.32,0.22), new THREE.MeshLambertMaterial({color:'#E5E7EB'}), w/2+0.12, by+h*0.8, -d*0.2).rotation.y = Math.PI/2; }
  if(opt.panels){ const pg = new THREE.Group(); g.add(pg); pg.position.set(0, top + rh*0.5 + 0.1, half*0.5); pg.rotation.x = a;
    for(let r=0;r<2;r++) for(let c=0;c<2;c++){ const pm=new THREE.Mesh(new THREE.BoxGeometry(0.82,0.04,0.5), panelMat); pm.position.set(-0.44+c*0.88, 0.04, -0.27+r*0.55); pm.castShadow=true; pg.add(pm); } }
  bake(g);
  contact(x, z, w+1.6, d+1.6, rot);
  { const c=Math.cos(rot), sn=Math.sin(rot), lz=d/2+0.55; const door=[x + doorX*c + lz*sn, z - doorX*sn + lz*c, sn, c];
    houses.push({x, z, r: Math.max(w,d)*0.62 + 0.9, door}); }
  return wm;
}
const kwameWin = house(3,1,3.4,2.6,2.2,'#FBFBF8','#5C7596',-0.3,{panels:true, porch:true, ac:true});
const winMats = [[-5.6,5,2.6,2.2,1.9,'#F1E2CB','#9B5A3C',0.4,{tank:'#1F2937'}],[0.6,7.6,2.4,2,1.8,'#EAF0F4','#6B7787',-0.1,{porch:true}],[12,-2.2,2.8,2.4,2,'#F6EBDD','#4F6E86',0.3,{tank:'#2B4A6F', ac:true}],
 [7,-6.6,2.4,2.2,1.9,'#FFFFFF','#A0674A',-0.5,{porch:true}],[-8.2,1.4,2.2,2,1.8,'#EFE2CF','#5C7596',0.2,{}],[17.4,10.8,2.6,2.2,1.9,'#F7F0E3','#8A5A44',0.6,{tank:'#1F2937'}],
 [-11,8.6,2.6,2.2,1.9,'#F3EFE8','#6B7787',0.5,{porch:true}],[3.4,13.2,2.8,2.2,2,'#FAF3E6','#9B5A3C',-0.2,{tank:'#2B4A6F'}],[14.5,-7.5,2.6,2.2,1.9,'#F0E6D6','#5C7596',-0.4,{}],
 [-15.5,2.5,2.4,2,1.8,'#F6EEE2','#A0674A',0.1,{}],[22,4,2.6,2.2,1.9,'#EEF1F4','#4F6E86',0.8,{porch:true}]].map(a=>house(...a));
const rp = null;
{ const jobs = [];
  houses.forEach(h=>{ if(!h.door) return; const [dx,dz,fx,fz] = h.door; let best=null, bd=1e9;
    roadPts.forEach(p=>{ const vx=p[0]-dx, vz=p[1]-dz; if(vx*fx+vz*fz < -0.2) return; const dd=Math.hypot(vx,vz)-p[2]; if(dd<bd){ bd=dd; best=p; } });
    if(best && bd < 16) jobs.push([[dx,0,dz],[dx+fx*1.3,0,dz+fz*1.3],[(dx+fx*1.3+best[0])/2,0,(dz+fz*1.3+best[1])/2],[best[0],0,best[1]]]); });
  jobs.forEach(pts=>{ const cv = curve(pts); const n = Math.max(12, Math.round(cv.getLength()*3));
    ribbon(cv, 1.3, '#E3DFD6', 0.07, n, {track:true}); ribbon(cv, 0.95, '#B4B8BD', 0.078, n); }); }

/* Seller battery + meter A */
contact(5.15,1.2,1.8,1.4,-0.3);
mesh(new THREE.BoxGeometry(1.5,0.1,0.95), new THREE.MeshLambertMaterial({color:'#CFCAC0'}), 4.95,0.05,1.25, false).rotation.y=-0.3;
const battG = new THREE.Group(); battG.position.set(5.15,0.1,1.2); battG.rotation.y=-0.3; scene.add(battG);
const bCase = new THREE.Mesh(new THREE.BoxGeometry(0.75,1.5,0.5), new THREE.MeshStandardMaterial({color:'#F4F6F8', roughness:0.35, metalness:0.1})); bCase.position.y=0.75; bCase.castShadow=true; battG.add(bCase);
{ const cap = new THREE.Mesh(new THREE.BoxGeometry(0.8,0.06,0.55), new THREE.MeshStandardMaterial({color:'#CBD5E1', roughness:0.4, metalness:0.4})); cap.position.y=1.52; battG.add(cap);
  for(let k=0;k<5;k++){ const v=new THREE.Mesh(new THREE.BoxGeometry(0.06,0.5,0.02), new THREE.MeshLambertMaterial({color:'#CBD5E1'})); v.position.set(0.39,0.75,-0.12+k*0.06); v.rotation.y=Math.PI/2; battG.add(v); } }
const bSlot = new THREE.Mesh(new THREE.BoxGeometry(0.34,1.2,0.02), new THREE.MeshBasicMaterial({color:'#1F2937'})); bSlot.position.set(0,0.75,0.26); battG.add(bSlot);
const bFill = new THREE.Mesh(new THREE.BoxGeometry(0.28,1.12,0.03), new THREE.MeshBasicMaterial({color:'#22C55E', fog:false}));
bFill.geometry.translate(0,0.56,0); bFill.position.set(0,0.19,0.27); battG.add(bFill);
const dodLine = new THREE.Mesh(new THREE.BoxGeometry(0.42,0.025,0.04), new THREE.MeshBasicMaterial({color:'#0E1B2C'})); dodLine.position.set(0,0.19+1.12*0.8,0.275); battG.add(dodLine);
const meterLed = new THREE.MeshBasicMaterial({color:'#94A3B8', fog:false});
const meterA = new THREE.Mesh(new THREE.BoxGeometry(0.34,0.44,0.14), new THREE.MeshStandardMaterial({color:'#E5E7EB', roughness:0.5, metalness:0.1})); meterA.position.set(-0.75,1.35,0.05); meterA.castShadow=true; battG.add(meterA);
{ const scr = new THREE.Mesh(new THREE.BoxGeometry(0.2,0.1,0.02), new THREE.MeshBasicMaterial({color:'#0F2A1C'})); scr.position.set(-0.75,1.3,0.13); battG.add(scr); }
const ledA = new THREE.Mesh(new THREE.SphereGeometry(0.06,10,8), meterLed); ledA.position.set(-0.75,1.47,0.13); battG.add(ledA);

/* Buyer kiosk + meter B + generator */
const kiosk = new THREE.Group(); kiosk.position.set(9,0,4.4); kiosk.rotation.y=-0.55; scene.add(kiosk);
contact(9,4.4,4,3.2,-0.55);
const kb = new THREE.Mesh(new THREE.BoxGeometry(2.3,1.7,1.7), new THREE.MeshLambertMaterial({color:'#F9E1A8'})); kb.position.y=0.85; kb.castShadow=true; kb.receiveShadow=true; kiosk.add(kb);
{ const k = (geo, mat, x,y,z) => { const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z); m.castShadow=true; m.receiveShadow=true; kiosk.add(m); return m; };
  k(new THREE.BoxGeometry(2.6,0.1,2.0), new THREE.MeshLambertMaterial({color:'#9A6B45'}), 0,1.75,0);
  k(new THREE.BoxGeometry(2.36,0.22,0.08), new THREE.MeshLambertMaterial({color:'#B45309'}), 0,0.55,0.88);
  k(new THREE.BoxGeometry(2.4,0.1,0.35), new THREE.MeshLambertMaterial({color:'#8B5E3C'}), 0,0.7,1.0);
  const signTex = (()=>{ const c=document.createElement('canvas'); c.width=512; c.height=96; const g=c.getContext('2d'); g.fillStyle='#0F5132'; g.fillRect(0,0,512,96);
    g.fillStyle='#FDE68A'; g.font='800 46px "Plus Jakarta Sans", system-ui, sans-serif'; g.textAlign='center'; g.fillText('CORNER COLD STORE', 256, 64); const t=new THREE.CanvasTexture(c); t.anisotropy=4; return t; })();
  k(new THREE.BoxGeometry(2.0,0.36,0.05), new THREE.MeshBasicMaterial({map:signTex}), 0,2.0,0.82);
  [[0.75,0.6],[0.95,0.75],[0.55,0.92]].forEach(([x,z],i)=>k(new THREE.BoxGeometry(0.4,0.26,0.3), new THREE.MeshLambertMaterial({color: i%2?'#DC2626':'#F59E0B'}), x+0.15, 0.13+(i===2?0.26:0), z+0.55));
  k(new THREE.BoxGeometry(1.0,0.06,0.3), doorMat, -0.2,0.42,1.75); [-0.6,0.2].forEach(o=>k(new THREE.BoxGeometry(0.06,0.4,0.26), doorMat, o,0.2,1.75)); }
for(let i=0;i<5;i++){ const s=new THREE.Mesh(new THREE.BoxGeometry(0.46,0.05,0.9), new THREE.MeshLambertMaterial({color:i%2?'#FFFFFF':'#16A34A'})); s.position.set(-0.92+i*0.46,1.55,1.25); s.rotation.x=0.35; s.castShadow=true; kiosk.add(s); }
const kWin = new THREE.MeshLambertMaterial({color:'#FFE3A3', emissive:'#FFB648', emissiveIntensity:0.5});
const kw = new THREE.Mesh(new THREE.BoxGeometry(1.4,0.6,0.04), kWin); kw.position.set(0,1.05,0.86); kiosk.add(kw);
const freezer = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.55,0.4), new THREE.MeshStandardMaterial({color:'#F1F5F9', roughness:0.3, metalness:0.15})); freezer.position.set(-0.6,0.28,1.15); freezer.castShadow=true; kiosk.add(freezer);
const fzLid = new THREE.MeshBasicMaterial({color:'#93C5FD'}); const fz = new THREE.Mesh(new THREE.BoxGeometry(0.6,0.03,0.32), fzLid); fz.position.set(-0.6,0.57,1.15); kiosk.add(fz);
const meterB = new THREE.Mesh(new THREE.BoxGeometry(0.14,0.44,0.34), new THREE.MeshStandardMaterial({color:'#E5E7EB', roughness:0.5, metalness:0.1})); meterB.position.set(-1.2,1.2,0.3); kiosk.add(meterB);
const ledBMat = new THREE.MeshBasicMaterial({color:'#94A3B8', fog:false});
const ledB = new THREE.Mesh(new THREE.SphereGeometry(0.06,10,8), ledBMat); ledB.position.set(-1.28,1.32,0.3); kiosk.add(ledB);
const gen = new THREE.Mesh(new THREE.BoxGeometry(0.9,0.62,0.6), new THREE.MeshStandardMaterial({color:'#3F4A5A', roughness:0.6, metalness:0.35})); gen.position.set(1.7,0.31,0.4); gen.castShadow=true; kiosk.add(gen);
{ const gf = new THREE.Mesh(new THREE.BoxGeometry(0.96,0.06,0.66), new THREE.MeshLambertMaterial({color:'#B91C1C'})); gf.position.set(1.7,0.64,0.4); kiosk.add(gf);
  for(let k=0;k<4;k++){ const v=new THREE.Mesh(new THREE.BoxGeometry(0.5,0.03,0.02), new THREE.MeshLambertMaterial({color:'#1F2937'})); v.position.set(1.7,0.2+k*0.09,0.71); kiosk.add(v); } }
const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.05,0.35,8), new THREE.MeshLambertMaterial({color:'#1F2937'})); exhaust.position.set(1.95,0.8,0.4); kiosk.add(exhaust);
scene.updateMatrixWorld(true);
const wp = (obj) => obj.getWorldPosition(new THREE.Vector3());
const pA = wp(ledA), pB = wp(ledB), pEx = wp(exhaust).add(V(0,0.2,0)), pBatt = wp(bCase), pKiosk = wp(kb);

/* clearance data */
const keepClear = [ // close-up camera sightlines (x1,z1,x2,z2,radius)
  [6.6,7.6,4.4,1.2,1.4],[17,22,3.5,1.2,3.4],[17,22,9,4.4,2.6],[17,22,-1,-2,2.4],[13,12.5,3.5,0.5,2.0],[13.5,11.5,8,3.8,1.6],[11.5,10,6.8,2.6,1.6],[9.8,9.6,6.9,2.6,1.5],[15,15,3.5,-0.5,1.2] ];
const segDist = (px,pz,x1,z1,x2,z2) => { const dx=x2-x1, dz=z2-z1, t=clamp(((px-x1)*dx+(pz-z1)*dz)/(dx*dx+dz*dz)); return Math.hypot(px-x1-dx*t, pz-z1-dz*t); };
const fixed = [[9,4.4,2.6],[5.15,1.2,1.2],[-2.6,-4.4,1.0],[1.6,-1.6,0.8],[7.4,2.5,0.8],[-7,-9.5,0.8],[-7.2,-11,1.4],[-14,-8.4,0.8],[10,-8,0.8],[8.2,5.4,2.4],[11.5,9.5,3.2],[9.5,12.5,2.4]];
/* street lamps (glow after dusk) */
const lampHeadMat = new THREE.MeshBasicMaterial({color:'#FFF3C4'});
const lampGlows = [];
[0.3,0.4,0.5,0.6,0.7,0.8].forEach((u,i)=>{ const P=mainRoad.getPointAt(u), T=mainRoad.getTangentAt(u); const s = i%2 ? 1 : -1; const nx=-T.z*s, nz=T.x*s;
  const x=P.x+nx*1.85, z=P.z+nz*1.85; const by=H(x,z);
  if(houses.some(h=>Math.hypot(x-h.x,z-h.z) < h.r+0.4) || fixed.some(f=>Math.hypot(x-f[0],z-f[1]) < f[2]+0.6) || keepClear.some(k=>segDist(x,z,k[0],k[1],k[2],k[3]) < k[4])) return;
  mesh(new THREE.CylinderGeometry(0.04,0.06,2.8,8), metalMat, x, by+1.4, z);
  const arm = mesh(new THREE.BoxGeometry(0.7,0.04,0.04), metalMat, x-nx*0.3, by+2.78, z-nz*0.3, false); arm.rotation.y = -Math.atan2(-nz,-nx);
  mesh(new THREE.BoxGeometry(0.26,0.07,0.14), lampHeadMat, x-nx*0.62, by+2.73, z-nz*0.62, false).rotation.y = arm.rotation.y;
  const gl = sprite('#FFD27A', 2.4); gl.position.set(x-nx*0.62, by+2.6, z-nz*0.62); gl.material.opacity = 0; lampGlows.push(gl);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24), new THREE.MeshBasicMaterial({map:glowTex, color:'#FFD27A', transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending}));
  pool.rotation.x=-Math.PI/2; pool.position.set(x-nx*0.62, H(x-nx*0.62,z-nz*0.62)+0.07, z-nz*0.62); scene.add(pool); lampGlows.push(pool);
  houses.push({x, z, r:0.6}); });

/* vegetation */
function free(x,z,pad){
  const ex=(x+11.8)/(6.4*1.18), ez=(z+14.6)/(4.4*1.25); if(ex*ex+ez*ez < 1) return false;
  for(const h of houses) if(Math.hypot(x-h.x,z-h.z) < h.r+pad) return false;
  for(const f of fixed) if(Math.hypot(x-f[0],z-f[1]) < f[2]+pad) return false;
  for(const p of roadPts) if(Math.hypot(x-p[0],z-p[1]) < p[2]+0.25+pad) return false;
  for(const k of keepClear) if(segDist(x,z,k[0],k[1],k[2],k[3]) < k[4]+pad) return false;
  return true;
}
const leafMat = sway(new THREE.MeshLambertMaterial({vertexColors:true, flatShading:true}), 0.02);
const palmMat = sway(new THREE.MeshLambertMaterial({vertexColors:true, side:THREE.DoubleSide}), 0.006);
const grassMat = sway(new THREE.MeshLambertMaterial({vertexColors:true}), 0.5);
const trunk = (h, r0, r1) => { const g=new THREE.CylinderGeometry(r1,r0,h,7); g.translate(0,h/2,0); return g; };
function lp(r, det, dark, light, sx,sy,sz, ox,oy,oz){ const g=new THREE.IcosahedronGeometry(r, det); const p=g.attributes.position, cols=[], cd=C(dark), cl=C(light), t=new THREE.Color();
  for(let i=0;i<p.count;i++){ const x=p.getX(i), y=p.getY(i), z=p.getZ(i); const j = 1 + 0.07*Math.sin(x*11.3+z*7.1+y*5.3);
    p.setXYZ(i, x*sx*j+ox, y*sy*j+oy, z*sz*j+oz); t.copy(cd).lerp(cl, clamp((y/r+1)/2)); cols.push(t.r,t.g,t.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols,3)); return g; }
const geoRound = merge([[trunk(1.2,0.12,0.08),'#7A5B3E'], [lp(1.0,1,'#3F7A2E','#86C455',1,1.08,1, 0,1.95,0),null]]);
const geoEgg = merge([[trunk(1.0,0.11,0.07),'#7A5B3E'], [lp(0.85,0,'#3F7A2E','#8BC85A',1,1.45,1, 0,2.0,0),null]]);
const geoPine = (()=>{ const a=new THREE.ConeGeometry(0.85,1.5,7); a.translate(0,1.6,0); const b=new THREE.ConeGeometry(0.62,1.2,7); b.translate(0,2.4,0);
  return merge([[trunk(1.0,0.1,0.07),'#6E5136'],[a,'#3E7A3A'],[b,'#4F8E45']]); })();
const geoTree = merge([[trunk(1.3,0.15,0.09),'#7A5B3E'], [blob(0.95,0.09,'#4E7F35','#86B451',1,0.95,1, 0,1.85,0),null], [blob(0.62,0.1,'#4A7A33','#7FAE4B',1,0.95,1, 0.55,1.45,0.2),null], [blob(0.66,0.1,'#527F37','#8BB955',1,0.9,1, -0.5,1.6,-0.25),null]]);
const geoAcacia = (()=>{ const t=trunk(1.9,0.13,0.08); const b1=trunk(0.9,0.07,0.04); b1.rotateZ(0.6); b1.translate(0,1.4,0); const b2=trunk(0.9,0.07,0.04); b2.rotateZ(-0.55); b2.translate(0,1.3,0);
  return merge([[t,'#6E5136'],[b1,'#6E5136'],[b2,'#6E5136'],[blob(1.0,0.08,'#557F33','#93B957',1.7,0.38,1.4, 0,2.35,0),null],[blob(0.6,0.08,'#557F33','#93B957',1.5,0.4,1.3, 0.8,2.15,0.3),null]]); })();
const geoPalm = (()=>{ const parts=[]; let x=0,y=0; for(let i=0;i<6;i++){ const s=new THREE.CylinderGeometry(0.1-i*0.006,0.12-i*0.006,0.62,7); s.rotateZ(-0.06); s.translate(x,y+0.31,0); parts.push([s, i%2?'#8C7A62':'#7D6C55']); x+=0.04+i*0.012; y+=0.6; }
  for(let k=0;k<9;k++){ const fr=new THREE.PlaneGeometry(1.7,0.34,6,1); const p=fr.attributes.position;
    for(let j=0;j<p.count;j++){ const fx=p.getX(j)+0.85; const fy=p.getY(j); p.setXYZ(j, fx, -0.22*fx*fx + 0.12*fx, fy*(1-fx/1.9)); }
    fr.computeVertexNormals(); fr.rotateY(k/9*Math.PI*2 + (k%2)*0.2); fr.translate(x, y+0.05, 0); parts.push([fr, k%2?'#4F8A3A':'#5E9A43']); }
  const nut=new THREE.SphereGeometry(0.11,8,6); nut.translate(x+0.08,y-0.12,0.06); parts.push([nut,'#6B5B2E']);
  return merge(parts); })();
const geoShrub = merge([[lp(0.5,0,'#3F7A2E','#86C455',1.2,0.8,1.1, 0,0.32,0),null],[lp(0.36,0,'#3F7A2E','#8FC85A',1,0.85,1, 0.45,0.25,0.15),null]]);
const geoGrass = (()=>{ const parts=[]; for(let k=0;k<4;k++){ const b=new THREE.ConeGeometry(0.03,0.2+k*0.03,3); b.translate(0,0.17,0); b.rotateZ((k-1.5)*0.22); b.rotateY(k*1.4); b.translate((k-1.5)*0.05,0,(k%2)*0.04); parts.push([b, k%2?'#89B356':'#9FC363']); } return merge(parts); })();
function scatter(geo, mat, n, rMin, rMax, pad, sMin, sMax, tint, cast=true, blobS=0){
  const m = new THREE.InstancedMesh(geo, mat, n); m.castShadow = cast; m.receiveShadow = true;
  const d = new THREE.Object3D(), c = new THREE.Color(); let placed = 0, tries = 0;
  const bl = blobS ? new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1), blobMat, n) : null;
  while(placed < n && tries < n*40){ tries++;
    const a = rnd()*Math.PI*2, r = rMin + Math.sqrt(rnd())*(rMax-rMin); const x = 2 + Math.cos(a)*r, z = 1 + Math.sin(a)*r;
    if(!free(x,z,pad)) continue;
    const s = sMin + rnd()*(sMax-sMin), y = H(x,z);
    d.position.set(x, y-0.02, z); d.rotation.set(0, rnd()*Math.PI*2, 0); d.scale.set(s, s*(0.9+rnd()*0.25), s); d.updateMatrix(); m.setMatrixAt(placed, d.matrix);
    c.set(tint[Math.floor(rnd()*tint.length)]); c.offsetHSL((rnd()-0.5)*0.02, (rnd()-0.5)*0.08, (rnd()-0.5)*0.07); m.setColorAt(placed, c);
    if(bl){ d.position.set(x, y+0.04, z); d.rotation.set(-Math.PI/2,0,0); d.scale.set(blobS*s, blobS*s, 1); d.updateMatrix(); bl.setMatrixAt(placed, d.matrix); }
    placed++; }
  m.count = placed; scene.add(m); if(bl){ bl.count = placed; bl.renderOrder = 1; scene.add(bl); }
  return m;
}
const M = mobile ? 0.45 : 1;
scatter(geoRound, leafMat, Math.round(80*M), 4, 60, 0.9, 0.75, 1.3, ['#FFFFFF','#EEF7E4','#E2F0D0'], true, 3.0);
scatter(geoEgg, leafMat, Math.round(55*M), 4, 60, 0.8, 0.75, 1.25, ['#FFFFFF','#EAF5DC'], true, 2.6);
scatter(geoPine, leafMat, Math.round(45*M), 22, 70, 0.8, 0.9, 1.5, ['#FFFFFF','#E4EEDA'], true, 2.6);
scatter(geoShrub, leafMat, Math.round(120*M), 3, 34, 0.25, 0.6, 1.25, ['#FFFFFF','#FFFFFF','#E8F2DA','#E0B4D6'], true, 1.4);

/* drifting clouds */
const cloudMat = new THREE.MeshLambertMaterial({color:'#FFFFFF', emissive:'#E8EEF7', emissiveIntensity:0.35, transparent:true, opacity:0.92, depthWrite:false});
const clouds = [];
for(let i=0;i<8;i++){ const parts=[]; const n=4+Math.floor(rnd()*3);
  for(let k=0;k<n;k++){ const s=new THREE.SphereGeometry(1.6+rnd()*1.4, 14, 10); s.scale(1,0.62,1); s.translate((k-n/2)*2.1, rnd()*0.6, rnd()*1.2); parts.push([s,'#FFFFFF']); }
  const cm = new THREE.Mesh(merge(parts), cloudMat); cm.position.set(-80+i*22+rnd()*8, 24+rnd()*8, -55-rnd()*35); const sc=1+rnd()*0.8; cm.scale.set(sc,sc,sc); scene.add(cm); clouds.push(cm); }

/* traffic on the main road */
const cars = [];
function car(color, u0, speed, side){
  const g = new THREE.Group(); scene.add(g);
  const add=(geo,mat,x,y,z)=>{ const m=new THREE.Mesh(geo,mat); m.position.set(x,y,z); m.castShadow=true; g.add(m); return m; };
  const paint = new THREE.MeshStandardMaterial({color, roughness:0.35, metalness:0.4});
  add(new THREE.BoxGeometry(1.15,0.3,0.55), paint, 0,0.3,0);
  add(new THREE.BoxGeometry(0.62,0.26,0.5), new THREE.MeshStandardMaterial({color:'#25313F', roughness:0.15, metalness:0.6}), -0.05,0.56,0);
  add(new THREE.BoxGeometry(0.6,0.04,0.52), paint, -0.05,0.7,0);
  const wg = new THREE.CylinderGeometry(0.13,0.13,0.08,12); wg.rotateX(Math.PI/2); const wmat = new THREE.MeshLambertMaterial({color:'#1F2937'});
  [[-0.38,0.29],[0.38,0.29],[-0.38,-0.29],[0.38,-0.29]].forEach(([x,z])=>add(wg,wmat,x,0.14,z));
  const hl = new THREE.MeshBasicMaterial({color:'#FFF7D6'}); [-0.17,0.17].forEach(z=>add(new THREE.BoxGeometry(0.03,0.06,0.1), hl, 0.58,0.32,z));
  const tl = new THREE.MeshBasicMaterial({color:'#B91C1C'}); [-0.18,0.18].forEach(z=>add(new THREE.BoxGeometry(0.03,0.06,0.1), tl, -0.58,0.32,z));
  const beamGlow = sprite('#FFE7A8', 1.6); beamGlow.material.opacity = 0;
  cars.push({g, u:u0, speed, side, beamGlow}); }
car('#E5E7EB', 0.15, 0.010, -0.55); car('#B91C1C', 0.6, -0.008, 0.55); car('#1D4ED8', 0.42, 0.007, -0.55);
const _cp = new THREE.Vector3(), _ct = new THREE.Vector3();
/* glowing energy lines on the ground */
const flowTex = (()=>{ const c=document.createElement('canvas'); c.width=64; c.height=8; const g=c.getContext('2d'); g.fillStyle='rgba(255,255,255,.35)'; g.fillRect(0,0,64,8); g.fillStyle='#FFFFFF'; g.fillRect(0,0,22,8);
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; return t; })();
const glowLines = [];
function glowPath(pts2, color, closed=false){
  const cv = new THREE.CatmullRomCurve3(pts2.map(([x,z])=>V(x, H(x,z)+0.09, z)), closed, 'catmullrom', 0.2);
  const L = cv.getLength(), segs = Math.max(40, Math.round(L*8));
  const core = new THREE.Mesh(new THREE.TubeGeometry(cv, segs, 0.045, 6, closed), new THREE.MeshBasicMaterial({color, transparent:true, opacity:0, fog:false}));
  const tex = flowTex.clone(); tex.needsUpdate = true; tex.repeat.set(L/1.1, 1);
  const dash = new THREE.Mesh(new THREE.TubeGeometry(cv, segs, 0.06, 6, closed), new THREE.MeshBasicMaterial({color:'#FFFFFF', map:tex, transparent:true, opacity:0, depthWrite:false, fog:false}));
  const halo = new THREE.Mesh(new THREE.TubeGeometry(cv, segs, 0.2, 8, closed), new THREE.MeshBasicMaterial({color, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, fog:false}));
  scene.add(halo, core, dash); const gl = {core, dash, halo, tex, k:0}; glowLines.push(gl); return gl; }
function yard(cx, cz, w, d, rot, color){ const pts=[], r=0.7, c=Math.cos(rot), s2=Math.sin(rot);
  [[w/2-r, d/2-r, 0],[-(w/2-r), d/2-r, Math.PI/2],[-(w/2-r), -(d/2-r), Math.PI],[w/2-r, -(d/2-r), Math.PI*1.5]].forEach(([ox,oz,a0])=>{
    for(let k=0;k<=4;k++){ const a=a0+k/4*Math.PI/2; const lx=ox+Math.cos(a)*r, lz=oz+Math.sin(a)*r; pts.push([cx + lx*c + lz*s2, cz - lx*s2 + lz*c]); } });
  return glowPath(pts, color, true); }
const glFarm  = glowPath([[-7.0,-10.3],[-6.2,-8.8],[-5.0,-7.2],[-3.6,-5.6],[-2.7,-4.0]], '#FDBA3B');
const glHome  = glowPath([[-2.5,-3.7],[-1.4,-2.6],[0.0,-1.4],[0.9,-0.2],[1.3,1.0]], '#4ADE80');
const glYardK = yard(3.15, 1.35, 6.0, 5.4, -0.3, '#4ADE80');
const glP2P   = glowPath([[5.9,2.4],[6.4,3.6],[6.7,4.8],[7.0,5.6]], '#4ADE80');
const glYardA = yard(8.6, 5.0, 4.8, 5.0, -0.55, '#FBBF24');
const groundDay = C('#D8C8A8'), groundNight = C('#2E3A63');
const _rc = new THREE.Color(), _rk = C('#5B4E7A');
const world = { tick(t, dt, o, night){
  timeU.value = t;
  ridgeMats.forEach((m,i)=>{ _rc.copy(o.bot).lerp(o.top, 0.12+i*0.05).lerp(_rk, 0.2 - i*0.06); m.color.copy(_rc).multiplyScalar(0.95 + i*0.02); });
  const hero = 1 - sstep(0.25, 0.85, cur);
  glFarm.k = Math.max(o.feed*0.9, hero*0.7) * (1 - sstep(1.3, 1.8, cur) * (1 - o.charge));
  glHome.k = Math.max(o.charge, hero*0.7); glYardK.k = Math.max(o.charge, o.p2p, hero*0.7);
  glP2P.k = Math.max(o.p2p, hero*0.6); glYardA.k = Math.max(o.p2p, o.match*0.8, hero*0.6);
  glowLines.forEach(g=>{ g.k = 0; g.tex.offset.x -= dt*1.4; g.core.material.opacity = g.k; g.dash.material.opacity = g.k*0.9; g.halo.material.opacity = g.k*(0.28 + 0.06*Math.sin(t*2)); g.core.visible = g.dash.visible = g.halo.visible = g.k > 0.01; });
  hemi.intensity *= 1.1;
  hemi.groundColor.copy(groundDay).lerp(groundNight, night); hemi.intensity *= 1 - 0.3*night; sunL.intensity *= 1 - 0.35*night;
  clouds.forEach((c,i)=>{ c.position.x += dt*(0.35+i*0.03); if(c.position.x > 100) c.position.x = -100; });
  cloudMat.opacity = 0.92 - 0.55*night; cloudMat.emissiveIntensity = 0.35*(1-night);
  lampGlows.forEach((g,i)=> g.material.opacity = (i%2 ? 0.5 : 0.85) * clamp(night*1.3 + (o.win>0.5?0.3:0)) );
  lampHeadMat.color.set(night > 0.3 ? '#FFE9A8' : '#E2E8F0');
  cars.forEach(c=>{ c.u = (c.u + c.speed*dt + 1) % 1; const u = 0.04 + c.u*0.92;
    mainRoad.getPointAt(u, _cp); mainRoad.getTangentAt(u, _ct); if(c.speed<0) _ct.negate();
    const nx=-_ct.z, nz=_ct.x; const x=_cp.x+nx*c.side*Math.sign(c.speed), z=_cp.z+nz*c.side*Math.sign(c.speed);
    c.g.position.set(x, H(x,z)+0.04, z); c.g.rotation.y = -Math.atan2(_ct.z, _ct.x);
    c.beamGlow.position.set(x+_ct.x*1.0, H(x,z)+0.3, z+_ct.z*1.0); c.beamGlow.material.opacity = night*0.9; });
} };

/* ---------- particle flows ---------- */
function flow(cv, n, color, size, speed, mode='line', opts={}){
  const mat = new THREE.MeshBasicMaterial(Object.assign({color, fog:false}, opts));
  const m = new THREE.InstancedMesh(new THREE.SphereGeometry(size,8,6), mat, n);
  m.frustumCulled = false; scene.add(m); return {cv, n, m, speed, mode, k:0, d:new THREE.Object3D()};
}
const escrowPos = V(3.5, 6.6, -1.5);
const loraQ = new THREE.Quaternion().setFromUnitVectors(V(0,0,1), pB.clone().sub(pA).normalize());
const F = {
  feed:  flow(cFarm, 28, '#F59E0B', 0.11, 0.09),
  house: flow(cHouse, 26, '#22C55E', 0.11, 0.11),
  waste: flow(curve([[-12,3.4,-14.5],[-12.8,6,-16],[-11.5,9,-18.5],[-13,12.5,-21],[-12,16,-24]]), 40, '#FBBF24', 0.14, 0.06, 'waste'),
  smoke: flow(curve([[pEx.x,pEx.y,pEx.z],[pEx.x+0.3,pEx.y+1.4,pEx.z-0.2],[pEx.x-0.2,pEx.y+3,pEx.z-0.8],[pEx.x+0.6,pEx.y+5,pEx.z-1.6]]), 46, '#4B5563', 0.22, 0.11, 'smoke', {transparent:true, opacity:0.55, fog:true, depthWrite:false}),
  p2p:   flow(cP2P, 26, '#22C55E', 0.12, 0.16),
  lora:  {cv:new THREE.LineCurve3(pA.clone(), pB.clone()), n:8, m:new THREE.InstancedMesh(new THREE.BoxGeometry(0.075,0.075,0.26), new THREE.MeshBasicMaterial({color:'#FFFFFF', fog:false}), 8), speed:0.22, mode:'dash', k:0, d:new THREE.Object3D()},
  esIn:  flow(curve([[pKiosk.x,pKiosk.y+1.2,pKiosk.z],[7,7,1.5],[escrowPos.x,escrowPos.y,escrowPos.z]]), 16, '#F8FAFC', 0.12, 0.3),
  esGrid:flow(curve([[escrowPos.x,escrowPos.y,escrowPos.z],[0.5,8,-3.5],[-2.6,4.4,-4.2]]), 16, '#3B82F6', 0.13, 0.25),
  esKw:  flow(curve([[escrowPos.x,escrowPos.y,escrowPos.z],[5,6,0.2],[pBatt.x,pBatt.y+0.9,pBatt.z]]), 16, '#16A34A', 0.13, 0.25),
  esFee: flow(curve([[escrowPos.x,escrowPos.y,escrowPos.z],[6,6.9,-2.3],[8.2,6.2,-3.2]]), 10, '#F59E0B', 0.11, 0.3),
};
scene.add(F.lora.m); F.lora.m.frustumCulled = false;
function runFlow(f, t){
  for(let i=0;i<f.n;i++){
    const u = (i/f.n + t*f.speed) % 1;
    f.cv.getPointAt(u, f.d.position);
    let s;
    if(f.mode==='dash'){ f.d.quaternion.copy(loraQ); s = Math.min(1, u*10, (1-u)*10); }
    else if(f.mode==='waste'){ f.d.position.x += Math.sin(i*12.9 + t*1.3)*0.9*u; f.d.position.z += Math.cos(i*7.1)*0.7*u; s = (1-u)*1.2; }
    else if(f.mode==='smoke'){ f.d.position.x += Math.sin(i*3.7 + t*0.8)*0.6*u; f.d.position.z += Math.cos(i*5.3)*0.5*u; s = (0.5 + u*2.6)*Math.min(1,(1-u)*3); }
    else s = Math.min(1, u*8, (1-u)*8);
    f.d.scale.setScalar(Math.max(0.0001, s*f.k)); f.d.updateMatrix(); f.m.setMatrixAt(i, f.d.matrix);
  }
  f.m.instanceMatrix.needsUpdate = true;
}

/* rings, beams, glows */
const flat = (inner, outer, color) => { const m = new THREE.Mesh(new THREE.RingGeometry(inner,outer,64), new THREE.MeshBasicMaterial({color, transparent:true, opacity:0, side:THREE.DoubleSide, fog:false, depthWrite:false}));
  m.rotation.x = -Math.PI/2; scene.add(m); return m; };
const ring = flat(0.9,1.0,'#38BDF8'); ring.position.copy(trafoPos);
const radius = flat(5.55,5.7,'#16A34A'); radius.position.set(pKiosk.x,0.06,pKiosk.z);
const radiusPulse = flat(0.92,1.0,'#16A34A'); radiusPulse.position.set(pKiosk.x,0.07,pKiosk.z);
const radiusFill = new THREE.Mesh(new THREE.CircleGeometry(5.6,64), new THREE.MeshBasicMaterial({color:'#22C55E', transparent:true, opacity:0, fog:false, depthWrite:false}));
radiusFill.rotation.x=-Math.PI/2; radiusFill.position.set(pKiosk.x,0.05,pKiosk.z); scene.add(radiusFill);
const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.55,7,24,1,true), new THREE.MeshBasicMaterial({color:'#4ADE80', transparent:true, opacity:0, side:THREE.DoubleSide, fog:false, depthWrite:false}));
beam.position.set(pBatt.x,3.5,pBatt.z); scene.add(beam);
const gA = sprite('#E2E8F0', 1.2); gA.position.copy(pA); const gB = sprite('#E2E8F0', 1.2); gB.position.copy(pB);
const kioskGlow = sprite('#FFC870', 7); kioskGlow.position.set(pKiosk.x, 1.2, pKiosk.z+0.6);
const kwameGlow = sprite('#FFC870', 7); kwameGlow.position.set(3.4, 1.3, 2.6);

/* escrow cube */
const escrow = new THREE.Group(); escrow.position.copy(escrowPos); scene.add(escrow);
const lockBodyMat = new THREE.MeshLambertMaterial({color:'#2563EB', emissive:'#1D4ED8', emissiveIntensity:0.55});
const lockMetal = new THREE.MeshLambertMaterial({color:'#CBD5E1', emissive:'#94A3B8', emissiveIntensity:0.5});
const lockBody = new THREE.Mesh(new THREE.BoxGeometry(1.7,1.35,0.6), lockBodyMat); escrow.add(lockBody);
const lockRim = new THREE.Mesh(new THREE.BoxGeometry(1.82,0.16,0.68), lockMetal); lockRim.position.y = 0.6; escrow.add(lockRim);
const shackle = new THREE.Group(); escrow.add(shackle);
const arch = new THREE.Mesh(new THREE.TorusGeometry(0.52,0.12,10,28,Math.PI), lockMetal); arch.position.y = 1.15; shackle.add(arch);
for(const sx of [-0.52,0.52]){ const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,0.6,10), lockMetal); leg.position.set(sx,0.85,0); shackle.add(leg); }
const keyMat = new THREE.MeshBasicMaterial({color:'#0B1530'});
const keyTop = new THREE.Mesh(new THREE.CircleGeometry(0.16,20), keyMat); keyTop.position.set(0,0.05,0.305); escrow.add(keyTop);
const keySlot = new THREE.Mesh(new THREE.PlaneGeometry(0.11,0.34), keyMat); keySlot.position.set(0,-0.18,0.305); escrow.add(keySlot);
// floating label so first-time visitors know what the lock means
function labelTex(title, sub, bg){ const c=document.createElement('canvas'); c.width=1024; c.height=300; const g=c.getContext('2d');
  const draw=()=>{ g.clearRect(0,0,1024,300); g.globalAlpha=1; g.fillStyle=bg; g.beginPath(); g.roundRect ? g.roundRect(8,8,1008,284,142) : g.rect(8,8,1008,284); g.fill();
    g.fillStyle='#FFFFFF'; g.textAlign='center'; g.font='800 92px "Plus Jakarta Sans", system-ui, sans-serif'; g.fillText(title,512,sub?138:182);
    if(sub){ g.globalAlpha=.9; g.font='600 52px "Plus Jakarta Sans", system-ui, sans-serif'; g.fillText(sub,512,228); } };
  draw(); const t=new THREE.CanvasTexture(c); t.minFilter=THREE.LinearFilter; t.generateMipmaps=false;
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(()=>{ draw(); t.needsUpdate=true; });
  return t; }
function label(title, sub, bg, w, x, y, z){ const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:labelTex(title, sub, bg), depthWrite:false, depthTest:false, fog:false, transparent:true, opacity:0}));
  sp.position.set(x,y,z); return sp; }
const texLocked = labelTex('Escrow · locked', 'smart contract on Base', '#1D4ED8');
const texPaid = labelTex('Released · paid', 'readings matched', '#15803D');
const lockLabel = new THREE.Sprite(new THREE.SpriteMaterial({map:texLocked, depthWrite:false, depthTest:false, fog:false, transparent:true}));
lockLabel.position.set(escrowPos.x, escrowPos.y+1.95, escrowPos.z);
/* sunbeams: soft light shafts falling on the solar farm */
const rayTex = (()=>{ const c=document.createElement('canvas'); c.width=64; c.height=256; const g=c.getContext('2d');
  const h=g.createLinearGradient(0,0,64,0); h.addColorStop(0,'rgba(255,255,255,0)'); h.addColorStop(.5,'rgba(255,255,255,1)'); h.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=h; g.fillRect(0,0,64,256);
  g.globalCompositeOperation='destination-in'; const v=g.createLinearGradient(0,0,0,256); v.addColorStop(0,'rgba(0,0,0,0)'); v.addColorStop(.25,'rgba(0,0,0,.9)'); v.addColorStop(.85,'rgba(0,0,0,.8)'); v.addColorStop(1,'rgba(0,0,0,0)');
  g.fillStyle=v; g.fillRect(0,0,64,256); return new THREE.CanvasTexture(c); })();
const rays = [[-15.4,-16.2,1.6],[-13.2,-15,2.2],[-11.3,-16.6,1.2],[-9.6,-13.8,2.0],[-8.2,-15.6,1.4],[-12.4,-12.8,1.0],[-14.6,-13.4,1.3]].map(([x,z,w],i)=>{
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1,1), new THREE.MeshBasicMaterial({map:rayTex, color:'#FFF1C2', transparent:true, opacity:0, blending:THREE.AdditiveBlending, depthWrite:false, fog:false, side:THREE.DoubleSide}));
  m.matrixAutoUpdate = false; scene.add(m); return {m, target:V(x,3.1,z), w, ph:i*1.7}; });
const rayAxis = new THREE.Vector3(), raySide = new THREE.Vector3(), rayN = new THREE.Vector3(), rayMid = new THREE.Vector3(), rayM = new THREE.Matrix4();
function updateRays(dir, k, t){
  rays.forEach(r=>{ const L = 15; rayAxis.copy(dir).normalize(); rayMid.copy(r.target).addScaledVector(rayAxis, L/2);
    const toCam = cam.position.clone().sub(rayMid).normalize(); raySide.crossVectors(rayAxis, toCam).normalize(); rayN.crossVectors(raySide, rayAxis);
    rayM.makeBasis(raySide.clone().multiplyScalar(r.w), rayAxis.clone().multiplyScalar(L), rayN); rayM.setPosition(rayMid); r.m.matrix.copy(rayM);
    r.m.material.opacity = k * (0.24 + 0.1*Math.sin(t*0.8 + r.ph)); r.m.visible = k > 0.01; });
}
const escrowGlow = sprite('#93C5FD', 6); escrowGlow.position.copy(escrowPos);
const payLabels = [
  label('Utility · 15%', 'grid fee', '#2563EB', 3.8, -2.6, 5.7, -4.2),
  label('Seller · 83%', 'energy + battery wear', '#16A34A', 3.8, pBatt.x+1.4, 2.6, pBatt.z+0.6),
  label('Aegis · 2%', 'platform fee', '#B45309', 3.4, 8.2, 6.9, -3.2),
];
const feeBadge = sprite('#FBBF24', 1.6); feeBadge.position.set(8.2,6.2,-3.2);
const tagLayer = document.createElement('div'); tagLayer.className = 'tags'; tagLayer.setAttribute('aria-hidden','true'); document.body.appendChild(tagLayer);
function setTag(t, title, sub, color){ t.el.innerHTML = '<b>'+title+'</b><span>'+sub+'</span>'; t.el.style.setProperty('--c', color); }
function makeTag(title, sub, color){ const t = {el:document.createElement('div')}; t.el.className='tag3d'; tagLayer.appendChild(t.el); setTag(t, title, sub, color); return t; }
const _tv = new THREE.Vector3();
function placeTag(t, pos, op){
  if(op < 0.02){ if(t.el.style.opacity !== '0') t.el.style.opacity = '0'; return; }
  _tv.copy(pos).project(cam); if(_tv.z > 1){ t.el.style.opacity = '0'; return; }
  const x = (_tv.x*0.5+0.5)*innerWidth, y = (-_tv.y*0.5+0.5)*innerHeight;
  t.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,calc(-100% - 6px))`; t.el.style.opacity = op.toFixed(3);
}
const tLock = makeTag('Escrow · locked','smart contract on Base','#1D4ED8');
const tUtil = null && makeTag('Utility · 15%','grid fee','#2563EB');
const tKw = null && makeTag('Seller · 83%','energy + battery wear','#16A34A');
const tFee = null && makeTag('Aegis · 2%','platform fee','#B45309');
const tLora = null && makeTag('LoRa signal','signed meter readings','#334155');
let tagState = null;
const loraLabel = label('LoRa signal', 'signed meter readings', '#334155', 2.6, (pA.x+pB.x)/2, Math.max(pA.y,pB.y)+1.4, (pA.z+pB.z)/2);

/* ---------- keyframes, one per chapter ---------- */
const DAY = {rays:0, hemiC:'#FFFFFF', disc:'#FFD34D', win:0, kwin:0, kiosk:0.3, stress:0, smoke:0, p2p:0, match:0, lora:0, escrow:0, stars:0, feed:0, waste:0, charge:0};
const NIGHT = {top:'#2B3A67', bot:'#5B6BA8', sunC:'#9DB0EE', I:0.42, hemi:0.55, hemiC:'#B9C7F2', disc:'#FF7A2E', sun:-14, sx:-0.2, sh:-1, win:0, kwin:0.9};
const KF = [
  {...DAY, t:5.75,  sun:3, sx:0.72, sh:0.12, disc:'#FF8A3D', top:'#A7CDEE', bot:'#FFD3AE', sunC:'#FFB27A', I:0.7,  hemi:0.5,  cam:[17,6.5,22],   tgt:[-6.5,2.2,-3],  fov:38, feed:0.15, win:0.7, kwin:0.7, kiosk:0.5},
  {...DAY, t:7.0,   sun:24, sx:0.45, sh:0.55, disc:'#FFB650', top:'#9FCDF3', bot:'#F2F2EC', sunC:'#FFE0B8', I:0.75, hemi:0.5,  cam:[6.6,2.8,7.6],  tgt:[4.4,2.0,1.2],  fov:36, rays:0.3, feed:0.35, waste:0.05, win:0.15, kwin:0.15, kiosk:0.15},
  {...DAY, t:12.0,  sun:74, sx:0.12, sh:0.66, top:'#7DBBF0', bot:'#E4F2FF', sunC:'#FFF6E6', I:0.72, hemi:0.42, cam:[3.5,9,9.5],    tgt:[-9,2.4,-12],   fov:40, rays:1, feed:1, waste:1},
  {...DAY, t:12.5,  sun:78, sx:0.04, sh:0.62, top:'#82BEF1', bot:'#E8F4FF', sunC:'#FFF6E6', I:0.72, hemi:0.42, cam:[13,7.5,12.5],  tgt:[0.5,1.8,-2.5], fov:40, rays:0.5, feed:1, waste:0.2, charge:1},
  {...DAY, t:17.5,  sun:9, sx:-0.12, sh:0.14, disc:'#FF7A2E', top:'#94B3E4', bot:'#FFC48C', sunC:'#FF9C55', I:0.72, hemi:0.45, cam:[16,8.5,15],    tgt:[0,1.8,-2.5],   fov:40, feed:0.15, win:0.8, kwin:0.8, kiosk:0.7, stress:1},
  {...DAY, ...NIGHT, t:19.0,  cam:[13.5,4.4,11.5], tgt:[8,1.1,3.8],  fov:38, smoke:1, kiosk:0.6, stars:0.4},
  {...DAY, ...NIGHT, t:19.033, cam:[6.5,13,14],    tgt:[6.8,0.4,2.6], fov:42, smoke:0.6, kiosk:0.3, match:1, stars:0.5},
  {...DAY, ...NIGHT, t:19.05, cam:[11.5,3.8,10],   tgt:[6.8,1.4,2.6], fov:40, p2p:1, kiosk:1, stars:0.5},
  {...DAY, ...NIGHT, t:21.0,  top:'#26335E', bot:'#4E5D9A', cam:[9.8,5.4,9.6], tgt:[6.9,2,2.6], fov:40, p2p:0.4, lora:1, kiosk:1, stars:0.7},
  {...DAY, ...NIGHT, t:21.017, top:'#26335E', bot:'#4E5D9A', cam:[15,8,15], tgt:[3.5,4.4,-0.5], fov:46, p2p:0.2, escrow:1, kiosk:1, stars:0.7},
  {...DAY, ...NIGHT, t:23.0,  top:'#1E2950', bot:'#48568F', cam:[21,10,24],  tgt:[-1.5,2,-3],    fov:40, kiosk:1, stars:1, win:0.05},
];
const NUM = ['rays','t','sun','sx','sh','I','hemi','fov','feed','waste','charge','win','kwin','kiosk','stress','smoke','p2p','match','lora','escrow','stars'];
const COL = ['top','bot','sunC','hemiC','disc'];
const lerp=(a,b,t)=>a+(b-a)*t;
const cA = {}, cB = {}; COL.forEach(k=>{cA[k]=new THREE.Color(); cB[k]=new THREE.Color();});
function frameAt(k){
  const i = Math.min(KF.length-2, Math.floor(k)), t = smooth(clamp(k-i)), A=KF[i], B=KF[i+1];
  const o = {}; NUM.forEach(key => o[key]=lerp(A[key],B[key],t));
  COL.forEach(key => o[key] = cA[key].set(A[key]).lerp(cB[key].set(B[key]), t));
  o.cam = V(lerp(A.cam[0],B.cam[0],t),lerp(A.cam[1],B.cam[1],t),lerp(A.cam[2],B.cam[2],t));
  o.tgt = V(lerp(A.tgt[0],B.tgt[0],t),lerp(A.tgt[1],B.tgt[1],t),lerp(A.tgt[2],B.tgt[2],t));
  return o;
}

/* ---------- scroll → story position ---------- */
const sections = [...document.querySelectorAll('[data-ch]')];
let target = 0, cur = 0;
function readScroll(){
  const mid = innerHeight*0.55; let f = 0;
  sections.forEach((s,i)=>{ const r = s.getBoundingClientRect(); if(r.top < mid) f = i + clamp((mid - r.top)/r.height); });
  target = clamp(f - 0.5, 0, KF.length-1);
}
addEventListener('scroll', readScroll, {passive:true});
readScroll(); cur = target;

/* ---------- HUD ---------- */
const $ = id => document.getElementById(id);
const panels = [...document.querySelectorAll('.panel')];
const LABELS = ['05:45 Dawn','07:00 Onboarding','12:00 Curtailment','12:30 Smart charge','17:30 Peak load','19:00 Load shedding','19:02 Request','19:03 P2P discharge','21:00 Verification','21:01 Settlement','23:00 Impact'];
const dotsEl = $('dots');
const dots = LABELS.map((l,i)=>{ const b=document.createElement('button'); b.type='button'; b.setAttribute('aria-label', l); b.title=l;
  b.addEventListener('click',()=>$('c'+i).scrollIntoView({behavior: reduce?'auto':'smooth', block:'center'})); dotsEl.appendChild(b); return b; });
const barsEl = $('bars'); const prof=[.18,.32,.5,.7,.86,.95,.9,.74,.52,.3]; const used=[.18,.3,.38,.4,.42,.42,.41,.4,.38,.28];
prof.forEach(()=>{ const d=document.createElement('div'); d.appendChild(document.createElement('i')); barsEl.appendChild(d); });

/* "Without / With Aegis" comparison, active in chapters 5–7 */
let force = null;
const segBtns = [...document.querySelectorAll('.seg button')];
segBtns.forEach(b=>b.addEventListener('click',()=>{ force = b.dataset.mode; }));

const socAt = k => k < 4 ? 20 + 60*smooth(clamp((k-2.1)/0.9)) : 80 - 18*smooth(clamp((k-6.45)/0.9));
let lastP = -1;
function hud(k, o, mode){
  const p = Math.min(10, Math.round(k));
  if(p!==lastP){ panels.forEach((el,i)=>el.classList.toggle('on', i===p)); dots.forEach((el,i)=>el.classList.toggle('on', i===p)); if(p<5||p>7) force=null; lastP=p; }
  let hh = Math.floor(o.t), mm = Math.round((o.t-hh)*60); if(mm===60){hh++; mm=0;}
  $('clock').textContent = String(hh).padStart(2,'0') + ':' + String(mm).padStart(2,'0');
  $('h0solar').firstChild.nodeValue = (0.12 + 0.6*clamp(k)).toFixed(2);
  $('reg').classList.toggle('done', k > 0.85);
  const w = clamp(k-1.15, 0, 0.85)/0.85;
  $('h2waste').firstChild.nodeValue = Math.round(1284*smooth(w)).toLocaleString('en-US');
  [...barsEl.children].forEach((d,i)=>{ const shown = clamp(w*10 - i); d.style.height=(prof[i]*100*Math.max(.08,shown))+'%'; d.firstChild.style.height=(used[i]/prof[i]*100)+'%'; });
  const soc = Math.round(socAt(k));
  $('h3soc').firstChild.nodeValue = Math.min(soc,80); $('h3fill').style.width = Math.min(soc,80)+'%';
  const charged = k > 3.05;
  $('h3state').textContent = charged ? 'Full at 80% limit' : 'Charging';
  $('h3kw').textContent = charged ? '0.0 kW' : '3.2 kW';
  $('h3abs').textContent = (6*smooth(clamp((k-2.1)/0.9))).toFixed(1)+' kWh';
  const load = Math.round(78 + 21*smooth(clamp((k-3.4)/0.6)));
  $('h4load').firstChild.nodeValue = load; $('h4mark').style.left = load+'%';
  $('h4pill').textContent = load > 94 ? 'Overload risk' : 'Peak building'; $('h4pill').className = 'pill ' + (load>94?'bad':'warn');
  const diesel = mode==='without';
  $('h5pm').firstChild.nodeValue = diesel ? '148' : '12'; $('h5pm').style.color = diesel ? 'var(--alert)' : 'var(--green)';
  $('h5pill').textContent = diesel ? 'Generator on' : 'Clean power'; $('h5pill').className = 'pill ' + (diesel?'bad':'ok');
  $('h5sub').textContent = diesel ? 'Diesel exhaust next to the shop' : 'Battery power, nothing burning';
  $('h5db').textContent = diesel ? '92 dB' : '41 dB';
  segBtns.forEach(b=>b.classList.toggle('on', b.dataset.mode===mode));
  const matched = k > 5.85;
  $('h6match').classList.toggle('done', matched); $('h6pill').textContent = matched ? 'Matched' : 'Searching'; $('h6pill').className = 'pill ' + (matched?'ok':'warn');
  const del = smooth(clamp((k-6.45)/0.9));
  $('h7kwh').textContent = (2.41*del).toFixed(2)+' kWh'; $('h7soc').textContent = soc+'%';
  const ver = k > 7.85; $('h8pill').textContent = ver ? 'Verified' : 'Verifying'; $('h8pill').className = 'pill ' + (ver?'ok':'chain');
  const paid = k > 8.85; $('h9pill').textContent = paid ? 'Settled' : 'Pending'; $('h9pill').className = 'pill ' + (paid?'ok':'chain'); $('h9note').classList.toggle('done', paid);
  const imp = smooth(clamp((k-9.35)/0.6));
  $('h10l').firstChild.nodeValue = (3.1*imp).toFixed(1); $('h10co').textContent = (8.3*imp).toFixed(1)+' kg';
  return soc;
}

/* ---------- loop ---------- */
const heroInner = document.querySelector('.hero .inner'), cardsByCh = sections.map(sec=>sec.querySelector('.card')); let lastCard = -2, isMini = false; const railLinks = [...document.querySelectorAll('.rail a[data-from]')];
const veil = $('veil'), hudEl = document.querySelector('.hud'), clockEl = document.querySelector('.clock'), joinEl = $('join');
// Closing section is a solid page: the 3D story eases back as it arrives, and its content is revealed once.
let lastExit = -1, joined = false; document.documentElement.classList.add('reveal-ready');
function resize(){ const w=innerWidth, h=innerHeight; R.setSize(w,h,false); cam.aspect=w/h;
  if(mobile) cam.setViewOffset(w, h, 0, -Math.round(h*0.11), w, h); else cam.clearViewOffset();   // phones: push the scene below the story card
  cam.updateProjectionMatrix(); }
addEventListener('resize', ()=>{ resize(); readScroll(); }); resize();
const clock = new THREE.Clock(); let time = 0;
const red = C('#EF4444'), cyan = C('#38BDF8');
function tick(){
  const dt = Math.min(clock.getDelta(), 0.05); time += reduce ? dt*0.3 : dt;
  cur += (target - cur) * (reduce ? 1 : 1 - Math.exp(-dt*5));
  const o = frameAt(cur);
  // comparison override (chapters 5–7)
  const inCompare = cur > 4.55 && cur < 7.6;
  let mode = o.smoke > 0.5 && o.p2p < 0.5 ? 'without' : 'with';
  if(inCompare && force){ mode = force;
    if(force==='without'){ o.smoke=1; o.p2p=0; o.match=0; o.kiosk=0.6; } else { o.smoke=0; o.p2p=1; o.kiosk=1; } }
  // sky, sun, moon
  skyMat.uniforms.top.value.copy(o.top); skyMat.uniforms.bot.value.copy(o.bot); scene.fog.color.copy(o.bot);
  const a = THREE.MathUtils.degToRad(o.sun);
  const sPos = V(95*Math.cos(a), 95*Math.sin(a)+2, -70);
  const night = clamp(-o.sun/10);
  starMat.opacity = o.stars;
  sunL.position.copy(sPos.clone().multiplyScalar(0.45).lerp(moonPos, night));
  sunL.color.copy(o.sunC); sunL.intensity=o.I; hemi.intensity=o.hemi; hemi.color.copy(o.hemiC);
  veil.style.opacity = 1 - 0.55*night;
  const joinTop = joinEl.getBoundingClientRect().top;
  const away = joinTop < innerHeight*1.1;   // story UI leaves as the fade into the closing section begins
  const exit = clamp((innerHeight - joinTop)/innerHeight);
  if(Math.abs(exit - lastExit) > 0.002){ document.documentElement.style.setProperty('--exit', exit.toFixed(3)); lastExit = exit; }
  if(!joined && joinTop < innerHeight*0.8){ joinEl.classList.add('in'); joined = true; }
  hudEl.classList.toggle('away', away); clockEl.classList.toggle('away', away); tagLayer.style.visibility = away ? 'hidden' : '';
  hudEl.classList.toggle('pre', cur < 0.45); clockEl.classList.toggle('pre', cur < 0.45);
  const mini = scrollY > 60 && !away; if(mini !== isMini){ document.documentElement.classList.toggle('nav-mini', mini); isMini = mini; }
  const here = Math.round(cur); railLinks.forEach(a=>a.classList.toggle('here', here >= +a.dataset.from && here <= +a.dataset.to));
  document.documentElement.style.setProperty('--card-a', (0.2 + 0.16*night).toFixed(3));
  // hero fades out in place; chapter cards take over the same spot
  const heroA = 1 - clamp((cur-0.12)/0.3); heroInner.style.opacity = heroA.toFixed(3); heroInner.style.pointerEvents = heroA < 0.2 ? 'none' : '';
  const ci = away ? -1 : (cur < 0.5 ? 0 : Math.min(10, Math.round(cur)));
  if(ci !== lastCard){ cardsByCh.forEach((c,i)=>{ if(c) c.classList.toggle('on', i===ci); }); lastCard = ci; }
  // camera
  const back = mobile ? 1.25 : 1;
  cam.position.copy(o.tgt.clone().add(o.cam.clone().sub(o.tgt).multiplyScalar(back)));
  cam.position.x += Math.sin(time*0.25)*0.25; cam.fov = o.fov; cam.updateProjectionMatrix(); cam.lookAt(o.tgt); cam.updateMatrixWorld();
  // sun: rises on load, then follows the day across the visible sky
  const intro = reduce ? 1 : smooth(clamp((performance.now()-introStart)/3800));
  const shEff = o.sh - (1-intro)*0.45*(1-clamp(cur*2));
  const sp = skyPoint(o.sx, shEff, 170);
  sunDisc.position.copy(sp.pos); sunCore.position.copy(sp.pos);
  const sunVis = clamp((sp.elev + 0.035)/0.07) * (1-night);
  sunDisc.material.color.copy(o.disc); sunDisc.material.opacity = sunVis*0.8; sunCore.material.opacity = sunVis;
  sunCore.material.color.copy(o.disc).lerp(WHITE, 0.12);
  skyMat.uniforms.sunDir.value.copy(sp.dir); skyMat.uniforms.sunCol.value.copy(o.disc); skyMat.uniforms.glow.value = clamp(shEff+0.35)*(1-night);
  const mp = skyPoint(0.5, 0.72, 170); moon.position.copy(mp.pos); moon.material.opacity = night;
  // lights in buildings
  winMats.forEach(m=>m.emissiveIntensity = o.win);
  kwameWin.emissiveIntensity = o.kwin; kWin.emissiveIntensity = o.kiosk;
  kioskGlow.material.opacity = o.kiosk*night*0.8; kwameGlow.material.opacity = o.kwin*night*0.6;
  fzLid.color.set(o.kiosk > 0.5 ? '#7DD3FC' : '#64748B');
  panelMat.emissiveIntensity = 0.25 + 0.5*clamp(o.sun/70) + 0.25*o.rays;
  world.tick(time, dt, o, night);
  updateRays(sp.dir.clone().add(V(0,0.35,0)).normalize(), o.rays*(1-night), time);
  // flows
  F.feed.k=o.feed; F.waste.k=0; F.house.k=o.charge; F.smoke.k=o.smoke; F.p2p.k=o.p2p; F.lora.k=o.lora;
  const unlock = smooth(clamp((cur-8.8)/0.25));
  F.esIn.k = o.escrow*(1-unlock); F.esGrid.k=F.esKw.k=o.escrow*unlock; F.esFee.k=0;
  for(const f of Object.values(F)) if(f.k>0.001 || f.m.visible){ f.m.visible = f.k>0.001; runFlow(f, time); }
  gen.position.y = 0.31 + o.smoke*0.012*Math.sin(time*70);
  // transformer signal: cyan when charging, red when overloaded
  const pulse = (time*0.6)%1;
  const ringK = Math.max(o.charge, o.stress);
  ring.material.color.copy(o.stress > o.charge ? red : cyan);
  ring.material.opacity = ringK*(1-pulse)*0.8; ring.scale.setScalar(1 + pulse*9);
  trafoLed.material.color.set(o.stress>0.4 ? (Math.sin(time*8)>0 ? '#EF4444' : '#7F1D1D') : (o.charge>0.3 ? '#22D3EE' : '#94A3B8'));
  // matching radius
  radius.material.opacity = o.match*0.9; radiusFill.material.opacity = o.match*0.12;
  const pp = (time*0.5)%1; radiusPulse.scale.setScalar(0.2 + pp*5.6); radiusPulse.material.opacity = o.match*(1-pp)*0.7;
  beam.material.opacity = o.match*0.22;
  // meters + LoRa
  const loraPulse = 0.9 + Math.sin(time*6)*0.35;
  gA.material.opacity = gB.material.opacity = o.lora; gA.scale.setScalar(1.4*loraPulse); gB.scale.setScalar(1.4*loraPulse);
  meterLed.color.set(cur > 0.6 ? '#22C55E' : '#94A3B8'); ledBMat.color.set(cur > 5.8 ? '#22C55E' : '#94A3B8');
  // escrow
  escrow.scale.setScalar(Math.max(0.0001, o.escrow)); escrow.rotation.y = Math.sin(time*0.6)*0.35; escrow.position.y = escrowPos.y + Math.sin(time*1.4)*0.12;
  shackle.position.y = unlock*0.55; shackle.rotation.y = unlock*0.9;
  lockBodyMat.color.set(unlock>0.5 ? '#16A34A' : '#2563EB'); lockBodyMat.emissive.set(unlock>0.5 ? '#15803D' : '#1D4ED8');
  lockLabel.position.y = escrow.position.y + 1.95;
  feeBadge.material.opacity = 0;
  const paid = unlock > 0.5; if(paid !== tagState){ tagState = paid; setTag(tLock, paid?'Released · paid':'Escrow · locked', paid?'readings matched':'smart contract on Base', paid?'#15803D':'#1D4ED8'); }
  placeTag(tLock, lockLabel.position, o.escrow);
  escrowGlow.material.opacity = o.escrow*0.7; escrowGlow.material.color.set(unlock>0.5 ? '#86EFAC' : '#93C5FD');
  // battery
  const soc = hud(cur, o, mode);
  bFill.scale.y = soc/100; bFill.material.color.set(soc>=80 ? '#16A34A' : '#22C55E');
  if(joinTop > 0) R.render(scene, cam);   // closing section covers the screen: skip drawing the hidden scene
  requestAnimationFrame(tick);
}
tick();
}
