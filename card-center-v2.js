(function(){
'use strict';

const state={
  source:null,sourceUrl:null,sourceKind:'front',game:'poke',points:[null,null,null,null],selected:0,
  rectified:null,rectifiedUrl:null,lines:{l:null,r:null,t:null,b:null},lineSel:'l',
  prevView:null,editingVersion:0,fingerprint:null,autoBusy:false
};

function el(id){return document.getElementById(id)}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function loadImage(url){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=url})}
function canvasFromImage(im,maxDim){
  const sw=im.naturalWidth||im.width,sh=im.naturalHeight||im.height;
  const s=Math.min(1,(maxDim||1400)/Math.max(sw,sh));
  const c=document.createElement('canvas');c.width=Math.max(1,Math.round(sw*s));c.height=Math.max(1,Math.round(sh*s));
  const x=c.getContext('2d');x.imageSmoothingEnabled=true;x.imageSmoothingQuality='high';x.drawImage(im,0,0,c.width,c.height);
  return c;
}
function canvasUrl(c,q){return c.toDataURL('image/jpeg',q==null?.92:q)}
function gameDims(){
  const v=el('cc2game')?el('cc2game').value:'poke';
  return v==='ygo'?{w:59,h:86}:{w:63,h:88};
}
function sourceToCanvasPoint(cv,e){
  const r=cv.getBoundingClientRect();
  return {x:(e.clientX-r.left)*state.source.width/r.width,y:(e.clientY-r.top)*state.source.height/r.height};
}
function rectToCanvasPoint(cv,e){
  const r=cv.getBoundingClientRect();
  return {x:(e.clientX-r.left)*state.rectified.width/r.width,y:(e.clientY-r.top)*state.rectified.height/r.height};
}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function convex(p){
  if(!p.every(Boolean))return false;
  let s=0;
  for(let i=0;i<4;i++){
    const a=p[i],b=p[(i+1)%4],c=p[(i+2)%4];
    const z=(b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x);
    if(Math.abs(z)<1e-6)return false;
    const sg=z>0?1:-1;if(!s)s=sg;else if(s!==sg)return false;
  }
  return true;
}
function fingerprint(c){
  const t=document.createElement('canvas');t.width=12;t.height=12;const x=t.getContext('2d',{willReadFrequently:true});
  x.drawImage(c,0,0,12,12);const d=x.getImageData(0,0,12,12).data;let s='';
  for(let i=0;i<d.length;i+=16){const g=Math.round((.299*d[i]+.587*d[i+1]+.114*d[i+2])/16).toString(16);s+=g}
  return s;
}
function storageKey(){return 'cardlab.center.v2.'+state.fingerprint+'.'+state.game}
function saveState(){
  if(!state.fingerprint)return;
  try{
    const d=gameDims(),W=state.rectified&&state.rectified.width,H=state.rectified&&state.rectified.height;
    localStorage.setItem(storageKey(),JSON.stringify({
      points:state.points.map(p=>p?{x:p.x/state.source.width,y:p.y/state.source.height}:null),
      lines:W&&H?{l:state.lines.l/W,r:state.lines.r/W,t:state.lines.t/H,b:state.lines.b/H}:null,
      game:state.game,ts:Date.now()
    }));
  }catch(e){}
}
function restoreState(){
  try{
    const raw=localStorage.getItem(storageKey());if(!raw)return null;
    const d=JSON.parse(raw);if(!d||!Array.isArray(d.points))return null;
    return d;
  }catch(e){return null}
}

function install(){
  const host=el('cent');if(!host)return;
  if(!el('cc2style')){
    const st=document.createElement('style');st.id='cc2style';st.textContent=`
#cent .cc2msg{background:#16181d;border:1px solid #3b3f48;border-radius:12px;padding:12px;margin:10px 0;line-height:1.35}
#cent .cc2status{padding:9px 11px;border-radius:10px;background:#10141a;margin:8px 0;color:#cbd2dc}
#cent .cc2status.ok{color:#bff5c9;border:1px solid #275b33}.cc2status.warn{color:#ffd79a;border:1px solid #72551e}
#cent .cc2stage{display:none}.cc2stage.on{display:block}
#cent .cc2canvas{display:block;width:100%;height:auto;max-height:62vh;object-fit:contain;background:#08090b;border-radius:12px;touch-action:none}
#cent .cc2wrap{background:#08090b;border-radius:14px;padding:7px;margin-top:8px}
#cent .cc2corners,#cent .cc2lines{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:9px 0}
#cent .cc2corners button,#cent .cc2lines button{margin:0}
#cent .cc2sel{outline:2px solid #2f65ff}
#cent .cc2lens{display:none;width:150px;height:150px;margin:8px auto 0;border:2px solid #36e16f;border-radius:14px;background:#000}
#cent .cc2row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}#cent .cc2row button{flex:1;min-width:42%}
#cent .cc2result{font-size:1.12rem;font-weight:800;line-height:1.5;padding:12px;border-radius:12px;background:#111820;margin:10px 0}
#cent .cc2help{font-size:.9rem;opacity:.82}
`;document.head.appendChild(st);
  }
  host.innerHTML=`
<h2 style="margin:4px 0">Allineamento e centratura</h2>
<div class="cc2msg"><b>Nuovo flusso.</b> La foto originale non viene mai ritagliata. Prima confermi i 4 angoli fisici della carta; solo dopo creo una copia raddrizzata. Nella seconda fase il bordo esterno è già noto e devi controllare solo le 4 linee interne usate per la centratura.</div>
<div class="cc2row"><label style="flex:1">Tipo carta<select id="cc2game" style="width:100%;margin-top:5px"><option value="poke">Pokémon 63×88</option><option value="ygo">Yu-Gi-Oh! 59×86</option></select></label></div>

<section id="cc2A" class="cc2stage on">
  <h3>1 · Angoli fisici della carta</h3>
  <div id="cc2Astatus" class="cc2status">Carico la foto…</div>
  <div class="cc2corners" id="cc2cornerBtns"></div>
  <div class="cc2wrap"><canvas id="cc2canvasA" class="cc2canvas"></canvas><canvas id="cc2lensA" class="cc2lens" width="360" height="360"></canvas></div>
  <div class="cc2help">Tocca un angolo e trascinalo sul bordo fisico reale. La foto resta sempre intera. La lente sotto serve solo per la precisione.</div>
  <div class="cc2row"><button class="sec" id="cc2Auto">◎ Rileva automaticamente</button><button class="sec" id="cc2Clear">Azzera 4 punti</button></div>
  <button id="cc2Warp" disabled>Raddrizza e passa alla centratura</button>
</section>

<section id="cc2B" class="cc2stage">
  <h3>2 · Centratura</h3>
  <div class="cc2msg">La carta è già raddrizzata: il <b>bordo esterno coincide con il bordo dell'immagine</b>. Ora controlla solo dove finisce il bordo esterno stampato e inizia il contenuto della carta.</div>
  <div id="cc2Bstatus" class="cc2status"></div>
  <div class="cc2lines" id="cc2lineBtns"></div>
  <div class="cc2wrap"><canvas id="cc2canvasB" class="cc2canvas"></canvas><canvas id="cc2lensB" class="cc2lens" width="360" height="360"></canvas></div>
  <div id="cc2Result" class="cc2result"></div>
  <div class="cc2row"><button class="sec" id="cc2BackA">← Correggi angoli</button><button class="sec" id="cc2AutoLines">◎ Rileva 4 linee</button></div>
  <button id="cc2UseOCR">Usa carta raddrizzata per riconoscimento</button>
</section>
<button class="sec" id="cc2Exit">Indietro</button>
`;
  bind();
}

function visibleView(){
  for(const id of ['riconosci','fine','prezzo','cap','start']){
    const x=el(id);if(x&&!x.classList.contains('hide'))return id;
  }
  return 'fine';
}
function hideViews(){
  ['start','fine','cap','prezzo','riconosci'].forEach(id=>{const x=el(id);if(x)x.classList.add('hide')});
}
function showOnly(stage){
  el('cc2A').classList.toggle('on',stage==='A');el('cc2B').classList.toggle('on',stage==='B');
}
function setStatus(id,msg,kind){const x=el(id);x.textContent=msg;x.className='cc2status'+(kind?' '+kind:'')}

async function open(url,opts){
  install();
  if(!url){alert('Prima carica o scatta una foto della carta.');return}
  state.prevView=visibleView();state.sourceUrl=url;state.sourceKind=opts&&opts.kind||'front';
  hideViews();el('cent').classList.remove('hide');showOnly('A');
  state.points=[null,null,null,null];state.selected=0;state.rectified=null;state.rectifiedUrl=null;state.lines={l:null,r:null,t:null,b:null};
  state.game=(opts&&opts.game)||((el('rgame')&&el('rgame').value==='ygo')?'ygo':'poke');
  el('cc2game').value=state.game;
  setStatus('cc2Astatus','Carico la foto completa…');
  try{
    const im=await loadImage(url);state.source=canvasFromImage(im,1400);state.fingerprint=fingerprint(state.source);
    const saved=restoreState();
    if(saved&&saved.points&&saved.points.length===4){
      state.points=saved.points.map(p=>p?{x:p.x*state.source.width,y:p.y*state.source.height}:null);
      setStatus('cc2Astatus','Ho ripristinato i 4 angoli salvati per questa foto. Controllali prima di continuare.','ok');
    }else{
      setStatus('cc2Astatus','Foto pronta. Puoi toccare i 4 angoli subito; il rilevamento automatico parte senza bloccare il lavoro.');
    }
    setupCanvasA();renderA();renderCornerButtons();
    const version=++state.editingVersion;
    setTimeout(()=>{if(version===state.editingVersion)autoDetect(false)},180);
  }catch(e){setStatus('cc2Astatus','Non riesco a caricare la foto: '+e.message,'warn')}
}

function setupCanvasA(){
  const cv=el('cc2canvasA'),ratio=state.source.width/state.source.height,maxW=900,maxH=1200;
  let W=maxW,H=Math.round(W/ratio);if(H>maxH){H=maxH;W=Math.round(H*ratio)}
  cv.width=Math.max(200,W);cv.height=Math.max(200,H);
}
function renderA(){
  const cv=el('cc2canvasA'),x=cv.getContext('2d');x.clearRect(0,0,cv.width,cv.height);x.drawImage(state.source,0,0,cv.width,cv.height);
  const sx=cv.width/state.source.width,sy=cv.height/state.source.height,p=state.points;
  x.lineWidth=3;x.strokeStyle='#2ee66b';x.fillStyle='#2ee66b';
  if(p.filter(Boolean).length>=2){
    x.beginPath();let first=true;p.forEach(q=>{if(!q)return;const X=q.x*sx,Y=q.y*sy;if(first){x.moveTo(X,Y);first=false}else x.lineTo(X,Y)});if(p.every(Boolean))x.closePath();x.stroke();
  }
  p.forEach((q,i)=>{if(!q)return;const X=q.x*sx,Y=q.y*sy;x.fillStyle=i===state.selected?'#ffd322':'#2ee66b';x.beginPath();x.arc(X,Y,8,0,Math.PI*2);x.fill();x.font='bold 18px sans-serif';x.strokeStyle='#000';x.lineWidth=4;x.strokeText(String(i+1),X+10,Y-10);x.fillStyle='#fff';x.fillText(String(i+1),X+10,Y-10)});
  el('cc2Warp').disabled=!(p.every(Boolean)&&convex(p));
}
function renderCornerButtons(){
  const names=['1 alto sinistra','2 alto destra','3 basso destra','4 basso sinistra'];
  el('cc2cornerBtns').innerHTML=names.map((n,i)=>'<button type="button" class="sec '+(i===state.selected?'cc2sel':'')+'" data-i="'+i+'">'+(state.points[i]?'✓ ':'')+n+'</button>').join('');
  el('cc2cornerBtns').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.selected=+b.dataset.i;renderCornerButtons();renderA()});
}
function drawLensA(p){
  if(!p)return;const l=el('cc2lensA'),x=l.getContext('2d'),S=Math.max(45,Math.min(state.source.width,state.source.height)*.09);
  const sx=clamp(p.x-S/2,0,Math.max(0,state.source.width-S)),sy=clamp(p.y-S/2,0,Math.max(0,state.source.height-S));
  x.clearRect(0,0,l.width,l.height);x.drawImage(state.source,sx,sy,S,S,0,0,l.width,l.height);x.strokeStyle='#2ee66b';x.lineWidth=2;x.beginPath();x.moveTo(l.width/2,0);x.lineTo(l.width/2,l.height);x.moveTo(0,l.height/2);x.lineTo(l.width,l.height/2);x.stroke();l.style.display='block';
}
function hideLensA(){el('cc2lensA').style.display='none'}

async function autoDetect(force){
  if(state.autoBusy||!state.source)return;
  state.autoBusy=true;const version=state.editingVersion;
  if(force)setStatus('cc2Astatus','Cerco un quadrilatero completo compatibile con la carta…');
  try{
    if(!window.AutoCardVision||!AutoCardVision.detectCard){if(force)setStatus('cc2Astatus','Rilevamento automatico non disponibile: usa i 4 punti manuali.','warn');return}
    const small=document.createElement('canvas');const s=Math.min(1,520/Math.max(state.source.width,state.source.height));
    small.width=Math.round(state.source.width*s);small.height=Math.round(state.source.height*s);small.getContext('2d').drawImage(state.source,0,0,small.width,small.height);
    const g=gameDims(),res=await AutoCardVision.detectCard(small,g.w+','+g.h);
    if(version!==state.editingVersion&&!force)return;
    const af=res&&res.metrics&&Number(res.metrics.areaFraction),re=res&&res.metrics&&Number(res.metrics.ratioErr);
    if(res&&res.points&&(res.confidence||0)>=.58&&Number.isFinite(af)&&af>=.18&&af<=.88&&Number.isFinite(re)&&re<=.12){
      state.points=res.points.map(p=>({x:p.x/s,y:p.y/s}));state.editingVersion++;saveState();renderCornerButtons();renderA();
      setStatus('cc2Astatus','✓ Angoli proposti automaticamente. Controlla che i 4 punti siano sul bordo fisico; puoi trascinarli prima di raddrizzare.','ok');
    }else if(force){
      setStatus('cc2Astatus','Non ho trovato un quadrilatero abbastanza affidabile. Nessun punto automatico è stato applicato: posiziona i 4 angoli manualmente.','warn');
    }
  }catch(e){if(force)setStatus('cc2Astatus','Rilevamento automatico non riuscito. Usa i 4 punti manuali.','warn')}
  finally{state.autoBusy=false}
}

function bindA(){
  const cv=el('cc2canvasA');let dragging=false;
  cv.onpointerdown=e=>{
    cv.setPointerCapture(e.pointerId);const p=sourceToCanvasPoint(cv,e);
    let near=-1,best=Infinity;state.points.forEach((q,i)=>{if(q){const d=dist(q,p);if(d<best){best=d;near=i}}});
    const threshold=Math.max(state.source.width,state.source.height)*.045;
    if(near>=0&&best<threshold)state.selected=near;
    state.points[state.selected]=p;state.editingVersion++;dragging=true;renderCornerButtons();renderA();drawLensA(p)
  };
  cv.onpointermove=e=>{if(!dragging)return;const p=sourceToCanvasPoint(cv,e);state.points[state.selected]=p;renderA();drawLensA(p)};
  const up=()=>{if(!dragging)return;dragging=false;hideLensA();saveState();renderCornerButtons();renderA()};
  cv.onpointerup=up;cv.onpointercancel=up;
}

function orderPoints(p){return p} // UI already enforces TL,TR,BR,BL
function fallbackWarp(src,pts,W,H){
  const out=document.createElement('canvas');out.width=W;out.height=H;const x=out.getContext('2d');x.fillStyle='#111';x.fillRect(0,0,W,H);
  function affineTri(s,d){
    const x0=s[0].x,y0=s[0].y,x1=s[1].x,y1=s[1].y,x2=s[2].x,y2=s[2].y;
    const u0=d[0].x,v0=d[0].y,u1=d[1].x,v1=d[1].y,u2=d[2].x,v2=d[2].y,det=x0*(y1-y2)+x1*(y2-y0)+x2*(y0-y1);if(Math.abs(det)<1e-6)return null;
    return {a:(u0*(y1-y2)+u1*(y2-y0)+u2*(y0-y1))/det,c:(u0*(x2-x1)+u1*(x0-x2)+u2*(x1-x0))/det,e:(u0*(x1*y2-x2*y1)+u1*(x2*y0-x0*y2)+u2*(x0*y1-x1*y0))/det,b:(v0*(y1-y2)+v1*(y2-y0)+v2*(y0-y1))/det,d:(v0*(x2-x1)+v1*(x0-x2)+v2*(x1-x0))/det,f:(v0*(x1*y2-x2*y1)+v1*(x2*y0-x0*y2)+v2*(x0*y1-x1*y0))/det};
  }
  function draw(s,d){const m=affineTri(s,d);if(!m)return;x.save();x.beginPath();x.moveTo(d[0].x,d[0].y);x.lineTo(d[1].x,d[1].y);x.lineTo(d[2].x,d[2].y);x.closePath();x.clip();x.setTransform(m.a,m.b,m.c,m.d,m.e,m.f);x.drawImage(src,0,0);x.restore()}
  const d=[{x:0,y:0},{x:W-1,y:0},{x:W-1,y:H-1},{x:0,y:H-1}];draw([pts[0],pts[1],pts[2]],[d[0],d[1],d[2]]);draw([pts[0],pts[2],pts[3]],[d[0],d[2],d[3]]);return out;
}
async function warp(){
  if(!(state.points.every(Boolean)&&convex(state.points)))return;
  setStatus('cc2Astatus','Raddrizzo la carta…');el('cc2Warp').disabled=true;
  const d=gameDims(),H=880,W=Math.round(H*d.w/d.h);
  try{
    let out=null;
    if(window.AutoCardVision&&AutoCardVision.warpFromPoints){
      try{out=await AutoCardVision.warpFromPoints(state.source,orderPoints(state.points),W,H)}catch(e){}
    }
    if(!out||!out.canvas)out={canvas:fallbackWarp(state.source,state.points,W,H)};
    state.rectified=out.canvas;state.rectifiedUrl=canvasUrl(state.rectified,.94);
    state.lines=autoInnerLines(state.rectified);state.lineSel='l';setupCanvasB();renderB();renderLineButtons();showOnly('B');updateResult();
    const saved=restoreState();
    if(saved&&saved.lines){
      state.lines={l:saved.lines.l*W,r:saved.lines.r*W,t:saved.lines.t*H,b:saved.lines.b*H};renderB();updateResult();
      setStatus('cc2Bstatus','Carta raddrizzata. Ho ripristinato anche le linee di centratura salvate: controllale.','ok');
    }else setStatus('cc2Bstatus','✓ Carta raddrizzata. Le 4 linee blu sono una proposta automatica: correggile se necessario.','ok');
    saveState();
    window.dispatchEvent(new CustomEvent('cardcenter:aligned',{detail:{url:state.rectifiedUrl,sourceUrl:state.sourceUrl,game:state.game}}));
  }catch(e){setStatus('cc2Astatus','Raddrizzamento non riuscito: '+e.message,'warn')}
  finally{el('cc2Warp').disabled=false}
}
function setupCanvasB(){
  const cv=el('cc2canvasB');cv.width=state.rectified.width;cv.height=state.rectified.height;
}
function autoInnerLines(c){
  const W=c.width,H=c.height,x=c.getContext('2d',{willReadFrequently:true}),d=x.getImageData(0,0,W,H).data,g=new Float32Array(W*H);
  for(let i=0,p=0;i<g.length;i++,p+=4)g[i]=.299*d[p]+.587*d[p+1]+.114*d[p+2];
  function vscore(xx){let a=[];for(let y=Math.round(H*.10);y<H*.90;y+=3){const z=y*W+xx;a.push(Math.abs(g[z+1]-g[z-1]))}a.sort((a,b)=>a-b);return a.slice(Math.floor(a.length*.35)).reduce((s,v)=>s+v,0)}
  function hscore(yy){let a=[];for(let xx=Math.round(W*.10);xx<W*.90;xx+=3){const z=yy*W+xx;a.push(Math.abs(g[z+W]-g[z-W]))}a.sort((a,b)=>a-b);return a.slice(Math.floor(a.length*.35)).reduce((s,v)=>s+v,0)}
  function best(from,to,fn){let bi=from,bs=-1;for(let i=from;i<=to;i++){const s=fn(i);if(s>bs){bs=s;bi=i}}return bi}
  return {
    l:best(Math.round(W*.025),Math.round(W*.20),vscore),
    r:best(Math.round(W*.80),Math.round(W*.975),vscore),
    t:best(Math.round(H*.025),Math.round(H*.18),hscore),
    b:best(Math.round(H*.82),Math.round(H*.975),hscore)
  };
}
function renderB(){
  const cv=el('cc2canvasB'),x=cv.getContext('2d');x.clearRect(0,0,cv.width,cv.height);x.drawImage(state.rectified,0,0);
  x.lineWidth=4;x.strokeStyle='#2188ff';
  [['l','x'],['r','x'],['t','y'],['b','y']].forEach(([k,a])=>{const v=state.lines[k];if(v==null)return;x.strokeStyle=k===state.lineSel?'#ffd322':'#2188ff';x.beginPath();if(a==='x'){x.moveTo(v,0);x.lineTo(v,cv.height)}else{x.moveTo(0,v);x.lineTo(cv.width,v)}x.stroke()});
}
function renderLineButtons(){
  const n={l:'Sinistra',r:'Destra',t:'Alto',b:'Basso'};
  el('cc2lineBtns').innerHTML=['l','r','t','b'].map(k=>'<button type="button" class="sec '+(k===state.lineSel?'cc2sel':'')+'" data-k="'+k+'">✓ '+n[k]+'</button>').join('');
  el('cc2lineBtns').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.lineSel=b.dataset.k;renderLineButtons();renderB()})
}
function drawLensB(p){
  const l=el('cc2lensB'),x=l.getContext('2d'),W=state.rectified.width,H=state.rectified.height,S=120;
  const sx=clamp(p.x-S/2,0,W-S),sy=clamp(p.y-S/2,0,H-S);x.clearRect(0,0,l.width,l.height);x.drawImage(state.rectified,sx,sy,S,S,0,0,l.width,l.height);
  x.strokeStyle='#2188ff';x.lineWidth=2;x.beginPath();x.moveTo(l.width/2,0);x.lineTo(l.width/2,l.height);x.moveTo(0,l.height/2);x.lineTo(l.width,l.height/2);x.stroke();l.style.display='block';
}
function hideLensB(){el('cc2lensB').style.display='none'}
function updateResult(){
  const W=state.rectified.width,H=state.rectified.height,l=state.lines.l,r=W-state.lines.r,t=state.lines.t,b=H-state.lines.b;
  const pct=(a,z)=>{const q=Math.round(a/(a+z)*100);return q+'/'+(100-q)};
  el('cc2Result').innerHTML='Sinistra / Destra: <b>'+pct(l,r)+'</b><br>Alto / Basso: <b>'+pct(t,b)+'</b><br><span class="cc2help">Le linee blu sono modificabili: il risultato cambia subito mentre le sposti.</span>';
  saveState();
}
function bindB(){
  const cv=el('cc2canvasB');let drag=false;
  cv.onpointerdown=e=>{cv.setPointerCapture(e.pointerId);drag=true;placeLine(rectToCanvasPoint(cv,e));drawLensB(rectToCanvasPoint(cv,e))};
  cv.onpointermove=e=>{if(!drag)return;const p=rectToCanvasPoint(cv,e);placeLine(p);drawLensB(p)};
  const up=()=>{drag=false;hideLensB();updateResult()};cv.onpointerup=up;cv.onpointercancel=up;
}
function placeLine(p){
  const k=state.lineSel,W=state.rectified.width,H=state.rectified.height;
  if(k==='l')state.lines.l=clamp(p.x,W*.01,W*.35);
  if(k==='r')state.lines.r=clamp(p.x,W*.65,W*.99);
  if(k==='t')state.lines.t=clamp(p.y,H*.01,H*.35);
  if(k==='b')state.lines.b=clamp(p.y,H*.65,H*.99);
  renderB();updateResult();
}
function useForOCR(){
  if(!state.rectifiedUrl)return;
  window.dispatchEvent(new CustomEvent('cardcenter:useocr',{detail:{url:state.rectifiedUrl,sourceUrl:state.sourceUrl,game:state.game}}));
  close();
  if(typeof window.apriRiconoscimento==='function')setTimeout(()=>window.apriRiconoscimento(state.rectifiedUrl),0);
}
function close(){
  const p=state.prevView||'fine';el('cent').classList.add('hide');const x=el(p);if(x)x.classList.remove('hide');
}
function bind(){
  bindA();bindB();
  el('cc2game').onchange=()=>{state.game=el('cc2game').value;state.points=[null,null,null,null];state.rectified=null;state.lines={l:null,r:null,t:null,b:null};state.editingVersion++;renderCornerButtons();renderA();setStatus('cc2Astatus','Tipo carta cambiato: riposiziona i 4 angoli oppure usa il rilevamento automatico.');}
  el('cc2Auto').onclick=()=>autoDetect(true);
  el('cc2Clear').onclick=()=>{state.points=[null,null,null,null];state.selected=0;state.editingVersion++;renderCornerButtons();renderA();setStatus('cc2Astatus','Punti azzerati. Tocca i quattro angoli fisici della carta.')};
  el('cc2Warp').onclick=warp;
  el('cc2BackA').onclick=()=>{showOnly('A');renderA()};
  el('cc2AutoLines').onclick=()=>{state.lines=autoInnerLines(state.rectified);renderB();updateResult();setStatus('cc2Bstatus','Linee ricalcolate automaticamente. Controllale visivamente.','ok')};
  el('cc2UseOCR').onclick=useForOCR;
  el('cc2Exit').onclick=close;
}

window.CardCenterV2={open:open,close:close,getState:()=>state};
window.apriCent=function(url){open(url,{game:(el('rgame')&&el('rgame').value==='ygo')?'ygo':'poke'})};
window.esciCent=close;

install();
})();