(function(){
'use strict';

const state={
  source:null,sourceUrl:null,sourceKind:'front',game:'poke',points:[null,null,null,null],selected:0,
  rectified:null,rectifiedUrl:null,lines:{l:null,r:null,t:null,b:null},lineSel:'l',
  prevView:null,editingVersion:0,fingerprint:null,autoBusy:false,lensMode:'context',lensHideTimer:null,lastPointer:null
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
#cent .cc2stage{display:none}#cent .cc2stage.on{display:block}
#cent .cc2canvas{display:block;width:100%;height:auto;max-height:62vh;object-fit:contain;background:#08090b;border-radius:12px;touch-action:none}
#cent .cc2wrap{background:#08090b;border-radius:14px;padding:7px;margin-top:8px}
#cent .cc2corners,#cent .cc2lines{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:9px 0}
#cent .cc2corners button,#cent .cc2lines button{margin:0}
#cent .cc2sel{outline:2px solid #2f65ff}
#cent .cc2lens{display:none;position:fixed;width:min(48vw,210px);height:auto;aspect-ratio:1/1;margin:0;border:3px solid #36e16f;border-radius:18px;background:#000;box-shadow:0 8px 28px #000b;z-index:99999;pointer-events:none;touch-action:none}
#cent .cc2row{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}#cent .cc2row button{flex:1;min-width:42%}
#cent .cc2result{font-size:1.12rem;font-weight:800;line-height:1.5;padding:12px;border-radius:12px;background:#111820;margin:10px 0}
#cent .cc2help{font-size:.9rem;opacity:.82}#cent .cc2lensModes{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:8px 0}#cent .cc2lensModes button{margin:0;padding:9px 5px;font-size:.88rem}#cent .cc2lensModes .active{outline:2px solid #2f65ff;background:#343b49}
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
  <div class="cc2wrap"><canvas id="cc2canvasA" class="cc2canvas"></canvas><canvas id="cc2lensA" class="cc2lens" width="720" height="720"></canvas></div>
  <div class="cc2lensModes"><button type="button" class="sec active" data-z="context">Contesto</button><button type="button" class="sec" data-z="medium">Medio</button><button type="button" class="sec" data-z="precision">Precisione</button></div>
  <div class="cc2help"><b>Angoli arrotondati:</b> trascina il punto: la lente compare accanto al dito e lo segue. Metti il centro dove i due bordi rettilinei, prolungati idealmente, si incontrerebbero. Usa “Contesto” per vedere entrambi i lati.</div>
  <div class="cc2row"><button class="sec" id="cc2Auto">◎ Rileva automaticamente</button><button class="sec" id="cc2Clear">Azzera 4 punti</button></div>
  <button id="cc2Warp" disabled>Raddrizza e passa alla centratura</button>
</section>

<section id="cc2B" class="cc2stage">
  <h3>2 · Centratura</h3>
  <div class="cc2msg">La carta è già raddrizzata: il <b>bordo esterno coincide con il bordo dell'immagine</b>. Sposta ogni linea fino al <b>limite reale tra il bordo stampato (es. giallo) e il contenuto della carta</b>. Il mirino può arrivare fino al vero bordo dell'immagine.</div>
  <div id="cc2Bstatus" class="cc2status"></div>
  <div class="cc2lines" id="cc2lineBtns"></div>
  <div class="cc2wrap"><canvas id="cc2canvasB" class="cc2canvas"></canvas><canvas id="cc2lensB" class="cc2lens" width="720" height="720"></canvas></div>
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
  state.points=[null,null,null,null];state.selected=0;state.lensMode='context';state.rectified=null;state.rectifiedUrl=null;state.lines={l:null,r:null,t:null,b:null};
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
    state.editingVersion++;
    setStatus('cc2Astatus',saved&&saved.points?'Angoli salvati ripristinati. Controllali oppure usa il rilevamento automatico.':'Foto pronta. Tocca i 4 angoli oppure premi “Rileva automaticamente”.');
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
  el('cc2cornerBtns').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.selected=+b.dataset.i;renderCornerButtons();renderA();var l=el('cc2lensA');if(state.points[state.selected]&&l&&l.style.display==='block')drawLensA(state.points[state.selected])});
}
function cancelLensHide(){
  if(state.lensHideTimer){clearTimeout(state.lensHideTimer);state.lensHideTimer=null}
}
function scheduleLensHide(id,delay){
  cancelLensHide();
  state.lensHideTimer=setTimeout(function(){
    var l=el(id);if(l)l.style.display='none';
    state.lensHideTimer=null;
  },delay==null?650:delay);
}
function positionLensNearPointer(l,e){
  if(!l||!e)return;
  cancelLensHide();
  state.lastPointer={x:e.clientX,y:e.clientY};

  // Misura reale dopo averla resa visibile.
  l.style.display='block';
  l.style.visibility='hidden';
  l.style.left='0px';l.style.top='0px';
  var r=l.getBoundingClientRect();
  var lw=r.width||200,lh=r.height||200;
  var vw=window.innerWidth||document.documentElement.clientWidth||360;
  var vh=window.innerHeight||document.documentElement.clientHeight||640;
  var gap=24,edge=8;

  // Vicino al dito, ma sul lato opposto rispetto alla metà dello schermo.
  var left=e.clientX<vw/2 ? e.clientX+gap : e.clientX-lw-gap;

  // Preferisci sopra al dito; se non c'è spazio passa sotto.
  var top=e.clientY-lh-gap;
  if(top<edge)top=e.clientY+gap;
  if(top+lh>vh-edge)top=Math.max(edge,vh-lh-edge);

  left=clamp(left,edge,Math.max(edge,vw-lw-edge));
  top=clamp(top,edge,Math.max(edge,vh-lh-edge));

  l.style.left=Math.round(left)+'px';
  l.style.top=Math.round(top)+'px';
  l.style.visibility='visible';
}
function lensCropSize(){
  var base=Math.min(state.source.width,state.source.height);
  if(state.lensMode==='precision')return Math.max(60,base*.085);
  if(state.lensMode==='medium')return Math.max(100,base*.145);
  return Math.max(150,base*.24);
}
function renderLensModes(){
  document.querySelectorAll('#cent .cc2lensModes button').forEach(function(b){
    b.classList.toggle('active',b.dataset.z===state.lensMode);
  });
}
function drawGuideRay(ctx,from,to,sx,sy,S,lw,lh){
  if(!from||!to)return;
  var dx=to.x-from.x,dy=to.y-from.y,len=Math.hypot(dx,dy)||1;
  dx/=len;dy/=len;
  // estendi la direzione del lato in entrambe le direzioni dentro la lente
  var L=Math.max(lw,lh)*1.5;
  var cx=(from.x-sx)/S*lw,cy=(from.y-sy)/S*lh;
  ctx.beginPath();ctx.moveTo(cx-dx*L,cy-dy*L);ctx.lineTo(cx+dx*L,cy+dy*L);ctx.stroke();
}
function drawLensA(p){
  if(!p)return;
  const l=el('cc2lensA'),x=l.getContext('2d'),S=lensCropSize();
  // Il punto deve restare SEMPRE al centro. Non spostiamo la finestra ai bordi:
  // disegniamo invece eventuale spazio vuoto fuori dalla foto.
  const sx=p.x-S/2,sy=p.y-S/2;
  const srcX=Math.max(0,sx),srcY=Math.max(0,sy);
  const srcR=Math.min(state.source.width,sx+S),srcB=Math.min(state.source.height,sy+S);
  const srcW=Math.max(0,srcR-srcX),srcH=Math.max(0,srcB-srcY);
  const dstX=(srcX-sx)/S*l.width,dstY=(srcY-sy)/S*l.height;
  const dstW=srcW/S*l.width,dstH=srcH/S*l.height;

  x.fillStyle='#07090c';x.fillRect(0,0,l.width,l.height);
  if(srcW>0&&srcH>0)x.drawImage(state.source,srcX,srcY,srcW,srcH,dstX,dstY,dstW,dstH);

  // Guide nella direzione dei due lati adiacenti: aiutano sugli angoli arrotondati.
  const prev=(state.selected+3)%4,next=(state.selected+1)%4;
  x.save();x.strokeStyle='rgba(255,211,34,.95)';x.lineWidth=3;x.setLineDash([14,10]);
  if(state.points[prev])drawGuideRay(x,p,state.points[prev],sx,sy,S,l.width,l.height);
  if(state.points[next])drawGuideRay(x,p,state.points[next],sx,sy,S,l.width,l.height);
  x.restore();

  // Croce centrale: coincide sempre col punto selezionato.
  x.strokeStyle='#2ee66b';x.lineWidth=3;x.setLineDash([]);
  x.beginPath();x.moveTo(l.width/2,0);x.lineTo(l.width/2,l.height);x.moveTo(0,l.height/2);x.lineTo(l.width,l.height/2);x.stroke();
  x.fillStyle='#ffd322';x.beginPath();x.arc(l.width/2,l.height/2,7,0,Math.PI*2);x.fill();
}
function hideLensA(){cancelLensHide();el('cc2lensA').style.display='none'}


function nextFrame(){
  return new Promise(function(resolve){
    if(window.requestAnimationFrame)requestAnimationFrame(function(){resolve()});
    else setTimeout(resolve,0);
  });
}
function colorDistance(a,b){
  var dr=a[0]-b[0],dg=a[1]-b[1],db=a[2]-b[2];
  return Math.sqrt(dr*dr+dg*dg+db*db);
}
async function lightDetectCorners(source,game,onProgress){
  var max=260,s=Math.min(1,max/Math.max(source.width,source.height));
  var cv=document.createElement('canvas');
  cv.width=Math.max(120,Math.round(source.width*s));
  cv.height=Math.max(120,Math.round(source.height*s));
  var cx=cv.getContext('2d',{willReadFrequently:true});
  cx.drawImage(source,0,0,cv.width,cv.height);
  var W=cv.width,H=cv.height,img=cx.getImageData(0,0,W,H).data;
  var gray=new Float32Array(W*H),mag=new Float32Array(W*H);

  for(var i=0,p=0;i<gray.length;i++,p+=4)gray[i]=.299*img[p]+.587*img[p+1]+.114*img[p+2];
  for(var y=1;y<H-1;y++){
    for(var x=1;x<W-1;x++){
      var z=y*W+x;
      var gx=-gray[z-W-1]-2*gray[z-1]-gray[z+W-1]+gray[z-W+1]+2*gray[z+1]+gray[z+W+1];
      var gy=-gray[z-W-1]-2*gray[z-W]-gray[z-W+1]+gray[z+W-1]+2*gray[z+W]+gray[z+W+1];
      mag[z]=Math.hypot(gx,gy);
    }
    if((y&31)===0)await nextFrame();
  }

  function rgb(x,y){
    x=Math.max(0,Math.min(W-1,Math.round(x)));
    y=Math.max(0,Math.min(H-1,Math.round(y)));
    var q=(y*W+x)*4;return [img[q],img[q+1],img[q+2]];
  }
  // Sfondo: media robusta di quattro piccole aree agli angoli.
  var bgSamples=[],pw=Math.max(5,Math.round(W*.07)),ph=Math.max(5,Math.round(H*.07));
  [[0,0],[W-pw,0],[0,H-ph],[W-pw,H-ph]].forEach(function(o){
    for(var yy=o[1];yy<o[1]+ph;yy+=2)for(var xx=o[0];xx<o[0]+pw;xx+=2)bgSamples.push(rgb(xx,yy));
  });
  var bg=[0,0,0];
  bgSamples.forEach(function(v){bg[0]+=v[0];bg[1]+=v[1];bg[2]+=v[2]});
  bg=bg.map(function(v){return v/Math.max(1,bgSamples.length)});
  var noise=0;
  bgSamples.forEach(function(v){noise+=colorDistance(v,bg)});
  noise/=Math.max(1,bgSamples.length);
  var bgScale=Math.max(24,noise*2.6);

  // --- Motore primario V3: cerca il PRIMO passaggio sfondo -> carta.
  // In questo modo un bordo interno molto contrastato non può vincere sul perimetro esterno.
  var distMap=new Float32Array(W*H);
  for(var yy0=0;yy0<H;yy0++){
    for(var xx0=0;xx0<W;xx0++){
      var qq=(yy0*W+xx0)*4,dr=img[qq]-bg[0],dg=img[qq+1]-bg[1],db=img[qq+2]-bg[2];
      distMap[yy0*W+xx0]=Math.sqrt(dr*dr+dg*dg+db*db);
    }
  }
  var outerThr=Math.max(30,Math.min(105,bgScale*1.18));

  function localDist(x,y){
    x=Math.round(x);y=Math.round(y);
    var sum=0,n=0;
    for(var dy=-1;dy<=1;dy++)for(var dx=-1;dx<=1;dx++){
      var px=x+dx,py=y+dy;
      if(px>=0&&px<W&&py>=0&&py<H){sum+=distMap[py*W+px];n++}
    }
    return n?sum/n:0;
  }
  function stableCardX(x,y,dir){
    var good=0;
    for(var k=0;k<5;k++){
      var xx=x+dir*k;
      if(xx<1||xx>W-2)break;
      if(localDist(xx,y)>outerThr)good++;
    }
    return good>=4;
  }
  function stableCardY(x,y,dir){
    var good=0;
    for(var k=0;k<5;k++){
      var yy=y+dir*k;
      if(yy<1||yy>H-2)break;
      if(localDist(x,yy)>outerThr)good++;
    }
    return good>=4;
  }

  async function scanOuterEntries(){
    var L=[],R=[],T=[],B=[];
    var y0=Math.round(H*.16),y1=Math.round(H*.84),ys=Math.max(3,Math.round(H/38));
    for(var y=y0;y<=y1;y+=ys){
      var foundL=null,foundR=null;
      for(var x=2;x<Math.round(W*.52);x++){
        if(stableCardX(x,y,1)){foundL=x;break}
      }
      for(var xr=W-3;xr>Math.round(W*.48);xr--){
        if(stableCardX(xr,y,-1)){foundR=xr;break}
      }
      if(foundL!=null)L.push({x:foundL,y:y});
      if(foundR!=null)R.push({x:foundR,y:y});
      if((L.length+R.length)%10===0)await nextFrame();
    }

    var x0=Math.round(W*.16),x1=Math.round(W*.84),xs=Math.max(3,Math.round(W/30));
    for(var x2=x0;x2<=x1;x2+=xs){
      var foundT=null,foundB=null;
      for(var yt=2;yt<Math.round(H*.52);yt++){
        if(stableCardY(x2,yt,1)){foundT=yt;break}
      }
      for(var yb=H-3;yb>Math.round(H*.48);yb--){
        if(stableCardY(x2,yb,-1)){foundB=yb;break}
      }
      if(foundT!=null)T.push({x:x2,y:foundT});
      if(foundB!=null)B.push({x:x2,y:foundB});
      if((T.length+B.length)%10===0)await nextFrame();
    }
    return {L:L,R:R,T:T,B:B};
  }

  function median(a){
    if(!a.length)return 0;
    var b=a.slice().sort(function(x,y){return x-y}),m=Math.floor(b.length/2);
    return b.length%2?b[m]:(b[m-1]+b[m])/2;
  }
  function fitXofY(points){
    if(points.length<6)return null;
    function fit(arr){
      var sy=0,sx=0,syy=0,syx=0,n=arr.length;
      arr.forEach(function(p){sy+=p.y;sx+=p.x;syy+=p.y*p.y;syx+=p.y*p.x});
      var den=n*syy-sy*sy;
      var a=Math.abs(den)<1e-6?0:(n*syx-sy*sx)/den;
      var b=(sx-a*sy)/n;
      return {a:a,b:b};
    }
    var f1=fit(points);
    var res=points.map(function(p){return Math.abs(p.x-(f1.a*p.y+f1.b))});
    var med=median(res),lim=Math.max(2.2,med*2.8);
    var keep=points.filter(function(p){return Math.abs(p.x-(f1.a*p.y+f1.b))<=lim});
    var f2=fit(keep.length>=6?keep:points);
    f2.n=keep.length;f2.residual=median((keep.length?keep:points).map(function(p){return Math.abs(p.x-(f2.a*p.y+f2.b))}));
    return f2;
  }
  function fitYofX(points){
    if(points.length<6)return null;
    function fit(arr){
      var sx=0,sy=0,sxx=0,sxy=0,n=arr.length;
      arr.forEach(function(p){sx+=p.x;sy+=p.y;sxx+=p.x*p.x;sxy+=p.x*p.y});
      var den=n*sxx-sx*sx;
      var a=Math.abs(den)<1e-6?0:(n*sxy-sx*sy)/den;
      var b=(sy-a*sx)/n;
      return {a:a,b:b};
    }
    var f1=fit(points);
    var res=points.map(function(p){return Math.abs(p.y-(f1.a*p.x+f1.b))});
    var med=median(res),lim=Math.max(2.2,med*2.8);
    var keep=points.filter(function(p){return Math.abs(p.y-(f1.a*p.x+f1.b))<=lim});
    var f2=fit(keep.length>=6?keep:points);
    f2.n=keep.length;f2.residual=median((keep.length?keep:points).map(function(p){return Math.abs(p.y-(f2.a*p.x+f2.b))}));
    return f2;
  }
  function intersectXY(v,h){
    var den=1-h.a*v.a;
    if(Math.abs(den)<1e-5)return null;
    var y=(h.a*v.b+h.b)/den;
    return {x:v.a*y+v.b,y:y};
  }
  function quadArea(q){
    var ss=0;
    for(var ii=0;ii<4;ii++){var aa=q[ii],bb=q[(ii+1)%4];ss+=aa.x*bb.y-bb.x*aa.y}
    return Math.abs(ss)/2;
  }
  function lineLen(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}

  async function detectOuterByBackground(){
    if(onProgress)onProgress('Cerco il perimetro esterno…');
    var e=await scanOuterEntries();
    var lf=fitXofY(e.L),rf=fitXofY(e.R),tf=fitYofX(e.T),bf=fitYofX(e.B);
    if(!lf||!rf||!tf||!bf)return null;

    var q=[intersectXY(lf,tf),intersectXY(rf,tf),intersectXY(rf,bf),intersectXY(lf,bf)];
    if(q.some(function(p){return !p||!isFinite(p.x)||!isFinite(p.y)}))return null;
    if(q.some(function(p){return p.x<-W*.03||p.x>W*1.03||p.y<-H*.03||p.y>H*1.03}))return null;

    var area=quadArea(q)/(W*H);
    var top=lineLen(q[0],q[1]),bot=lineLen(q[3],q[2]),left=lineLen(q[0],q[3]),right=lineLen(q[1],q[2]);
    var ratio=((top+bot)/2)/Math.max(1,(left+right)/2);
    var expected=game==='ygo'?59/86:63/88;
    var ratioErr=Math.abs(Math.log(Math.max(.01,ratio/expected)));
    var support=Math.min(1,(Math.min(e.L.length,e.R.length)/18))*Math.min(1,(Math.min(e.T.length,e.B.length)/14));
    var residual=(lf.residual+rf.residual+tf.residual+bf.residual)/4;

    if(area<.24||area>.91||ratioErr>.31||support<.38||residual>8)return null;

    var outOk=0,inOk=0,total=0,cxq=(q[0].x+q[1].x+q[2].x+q[3].x)/4,cyq=(q[0].y+q[1].y+q[2].y+q[3].y)/4;
    for(var si=0;si<4;si++){
      var a=q[si],b=q[(si+1)%4],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
      var nx=-dy/len,ny=dx/len,mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      if(Math.hypot(mid.x+nx*5-cxq,mid.y+ny*5-cyq)<Math.hypot(mid.x-nx*5-cxq,mid.y-ny*5-cyq)){nx=-nx;ny=-ny}
      for(var kk=2;kk<=10;kk+=2){
        var tt=.08+.84*(kk-2)/8,px=a.x+dx*tt,py=a.y+dy*tt;
        var od=localDist(px+nx*4,py+ny*4),id=localDist(px-nx*5,py-ny*5);
        if(od<outerThr*1.05)outOk++;
        if(id>outerThr*.88)inOk++;
        total++;
      }
    }
    var outerScore=total?outOk/total:0,innerScore=total?inOk/total:0;
    if(outerScore<.52||innerScore<.52)return null;

    var confidence=.36*support+.26*Math.max(0,1-residual/8)+.20*outerScore+.18*innerScore;
    confidence*=Math.max(.45,1-ratioErr/.31);

    return {
      points:q.map(function(p){return{x:p.x/s,y:p.y/s}}),
      confidence:Math.max(0,Math.min(1,confidence)),
      metrics:{method:'outer-scan',area:area,ratio:ratio,support:support,residual:residual,outside:outerScore,inside:innerScore}
    };
  }

  var outerCandidate=await detectOuterByBackground();
  if(outerCandidate&&outerCandidate.confidence>=.48){
    if(onProgress)onProgress('Perimetro esterno trovato.');
    return outerCandidate;
  }

  function bgDist(x,y){return colorDistance(rgb(x,y),bg)}
  function rectCorners(mx,my,h,deg){
    var ratio=game==='ygo'?59/86:63/88,w=h*ratio,t=deg*Math.PI/180;
    var ux={x:Math.cos(t),y:Math.sin(t)},uy={x:-Math.sin(t),y:Math.cos(t)};
    return [
      {x:mx-ux.x*w/2-uy.x*h/2,y:my-ux.y*w/2-uy.y*h/2},
      {x:mx+ux.x*w/2-uy.x*h/2,y:my+ux.y*w/2-uy.y*h/2},
      {x:mx+ux.x*w/2+uy.x*h/2,y:my+ux.y*w/2+uy.y*h/2},
      {x:mx-ux.x*w/2+uy.x*h/2,y:my-ux.y*w/2+uy.y*h/2}
    ];
  }
  function evaluate(q,mx,my){
    for(var i=0;i<4;i++){
      if(q[i].x<2||q[i].x>W-3||q[i].y<2||q[i].y>H-3)return null;
    }
    var sideScores=[],outsideScores=[],insideScores=[],contrastScores=[];
    for(var si=0;si<4;si++){
      var a=q[si],b=q[(si+1)%4],dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
      var tx=dx/len,ty=dy/len,nx=-ty,ny=tx;
      var midx=(a.x+b.x)/2,midy=(a.y+b.y)/2;
      // nx,ny deve puntare verso l'esterno.
      if(Math.hypot(midx+nx*5-mx,midy+ny*5-my)<Math.hypot(midx-nx*5-mx,midy-ny*5-my)){nx=-nx;ny=-ny}
      var strong=0,edge=0,outside=0,inside=0,contrast=0,n=16,off=Math.max(3,Math.min(6,len*.025));
      for(var k=0;k<n;k++){
        var t=.06+.88*k/(n-1),px=a.x+dx*t,py=a.y+dy*t,best=0;
        for(var o=-1;o<=1;o++){
          var ex=Math.round(px+nx*o),ey=Math.round(py+ny*o);
          if(ex<1||ex>=W-1||ey<1||ey>=H-1)continue;
          best=Math.max(best,mag[ey*W+ex]);
        }
        edge+=best;
        if(best>=Math.max(45,bgScale*1.15))strong++;
        var ox=px+nx*off,oy=py+ny*off,ix=px-nx*off,iy=py-ny*off;
        var od=bgDist(ox,oy),id=bgDist(ix,iy);
        outside+=Math.max(0,1-od/(bgScale*2.2));
        inside+=Math.max(0,Math.min(1,(id-bgScale*.55)/(bgScale*2.0)));
        contrast+=Math.min(1,colorDistance(rgb(ix,iy),rgb(ox,oy))/95);
      }
      sideScores.push((strong/n)*.55+Math.min(1,(edge/n)/160)*.45);
      outsideScores.push(outside/n);insideScores.push(inside/n);contrastScores.push(contrast/n);
    }
    var minSide=Math.min.apply(null,sideScores);
    var avgSide=sideScores.reduce(function(a,v){return a+v},0)/4;
    var out=outsideScores.reduce(function(a,v){return a+v},0)/4;
    var inn=insideScores.reduce(function(a,v){return a+v},0)/4;
    var con=contrastScores.reduce(function(a,v){return a+v},0)/4;
    var area=Math.abs((q[0].x*q[1].y-q[1].x*q[0].y)+(q[1].x*q[2].y-q[2].x*q[1].y)+(q[2].x*q[3].y-q[3].x*q[2].y)+(q[3].x*q[0].y-q[0].x*q[3].y))/2/(W*H);
    var areaScore=Math.min(1,area/.58);
    var score=.16*minSide+.12*avgSide+.34*out+.18*inn+.08*con+.12*areaScore;
    if(out<.42)score*=.55;
    if(area<.34)score*=.72;
    if(minSide<.30)score*=.65;
    return {score:score,outside:out,inside:inn,minSide:minSide,area:area};
  }
  function values(a,b,n){
    var r=[];if(n<=1)return[a];
    for(var i=0;i<n;i++)r.push(a+(b-a)*i/(n-1));return r;
  }
  async function search(spec,label){
    var best=null,count=0,total=spec.hs.length*spec.angles.length*spec.xs.length*spec.ys.length;
    for(var hi=0;hi<spec.hs.length;hi++)for(var ai=0;ai<spec.angles.length;ai++)for(var xi=0;xi<spec.xs.length;xi++)for(var yi=0;yi<spec.ys.length;yi++){
      var q=rectCorners(spec.xs[xi],spec.ys[yi],spec.hs[hi],spec.angles[ai]),ev=evaluate(q,spec.xs[xi],spec.ys[yi]);
      if(ev&&(!best||ev.score>best.ev.score))best={q:q,ev:ev,h:spec.hs[hi],a:spec.angles[ai],x:spec.xs[xi],y:spec.ys[yi]};
      count++;
      if(count%90===0){
        if(onProgress)onProgress(label+' '+Math.round(count/total*100)+'%');
        await nextFrame();
      }
    }
    return best;
  }

  var coarse=await search({
    hs:values(H*.58,H*.94,8),
    angles:values(-10,10,7),
    xs:values(W*.36,W*.64,5),
    ys:values(H*.34,H*.66,5)
  },'Ricerca');
  if(!coarse)return null;

  var fine=await search({
    hs:values(coarse.h*.95,coarse.h*1.05,5),
    angles:values(coarse.a-2.5,coarse.a+2.5,5),
    xs:values(coarse.x-W*.028,coarse.x+W*.028,5),
    ys:values(coarse.y-H*.028,coarse.y+H*.028,5)
  },'Rifinitura');
  var best=fine||coarse;
  if(!best||best.ev.score<.43||best.ev.minSide<.34)return null;
  return {
    points:best.q.map(function(p){return {x:p.x/s,y:p.y/s}}),
    confidence:Math.max(0,Math.min(1,(best.ev.score-.40)/.36)),
    metrics:best.ev
  };
}

async function autoDetect(force){
  if(state.autoBusy||!state.source)return;
  state.autoBusy=true;
  var btn=el('cc2Auto'),old=btn?btn.textContent:'';
  if(btn){btn.disabled=true;btn.textContent='Analizzo…'}
  var version=state.editingVersion;
  if(force)setStatus('cc2Astatus','Rilevamento leggero in corso… puoi ancora scorrere la pagina.');
  try{
    var res=await lightDetectCorners(state.source,state.game,function(t){
      if(force)setStatus('cc2Astatus',t+' · nessun blocco della pagina');
    });
    if(version!==state.editingVersion&&!force)return;
    if(res&&res.points&&(res.confidence||0)>=.16){
      state.points=res.points;
      state.editingVersion++;
      saveState();renderCornerButtons();renderA();
      var pct=Math.round((res.confidence||0)*100);
      setStatus('cc2Astatus','✓ Angoli proposti ('+pct+'%). Controlla visivamente tutti e 4 i punti prima di raddrizzare.','ok');
    }else if(force){
      setStatus('cc2Astatus','Non trovo un bordo sufficientemente affidabile senza rischiare punti sbagliati. Posiziona i 4 angoli manualmente.','warn');
    }
  }catch(e){
    if(force)setStatus('cc2Astatus','Rilevamento rapido non riuscito: '+e.message+'. Puoi continuare manualmente.','warn');
  }finally{
    state.autoBusy=false;
    if(btn){btn.disabled=false;btn.textContent=old||'◎ Rileva automaticamente'}
  }
}

function bindA(){
  const cv=el('cc2canvasA');let dragging=false;
  cv.onpointerdown=e=>{
    cv.setPointerCapture(e.pointerId);const p=sourceToCanvasPoint(cv,e);
    let near=-1,best=Infinity;state.points.forEach((q,i)=>{if(q){const d=dist(q,p);if(d<best){best=d;near=i}}});
    const threshold=Math.max(state.source.width,state.source.height)*.045;
    if(near>=0&&best<threshold)state.selected=near;
    state.points[state.selected]=p;state.editingVersion++;dragging=true;
    renderCornerButtons();renderA();drawLensA(p);positionLensNearPointer(el('cc2lensA'),e);
  };
  cv.onpointermove=e=>{
    if(!dragging)return;
    const p=sourceToCanvasPoint(cv,e);state.points[state.selected]=p;
    renderA();drawLensA(p);positionLensNearPointer(el('cc2lensA'),e);
  };
  const up=e=>{
    if(!dragging)return;
    dragging=false;saveState();renderCornerButtons();renderA();
    if(state.points[state.selected])drawLensA(state.points[state.selected]);
    if(e)positionLensNearPointer(el('cc2lensA'),e);
    scheduleLensHide('cc2lensA',750);
  };
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
  hideLensA();
  setStatus('cc2Astatus','Raddrizzo la carta…');
  el('cc2Warp').disabled=true;
  const d=gameDims(),H=880,W=Math.round(H*d.w/d.h);
  try{
    // V2 mobile: niente OpenCV qui. Il vecchio warp bloccava il thread su Android.
    // Canvas a due triangoli è immediato e usa solo API native del browser.
    await nextFrame();
    const outCanvas=fallbackWarp(state.source,orderPoints(state.points),W,H);
    await nextFrame();

    state.rectified=outCanvas;
    state.rectifiedUrl=canvasUrl(state.rectified,.94);

    setStatus('cc2Astatus','Carta raddrizzata. Preparo le linee di centratura…');
    await nextFrame();

    state.lines=await autoInnerLines(state.rectified,function(msg){setStatus('cc2Astatus',msg)});
    state.lineSel='l';
    setupCanvasB();renderB();renderLineButtons();showOnly('B');updateResult();

    const saved=restoreState();
    if(saved&&saved.lines){
      state.lines={l:saved.lines.l*W,r:saved.lines.r*W,t:saved.lines.t*H,b:saved.lines.b*H};
      renderB();updateResult();
      setStatus('cc2Bstatus','Carta raddrizzata. Ho ripristinato anche le linee di centratura salvate: controllale.','ok');
    }else{
      setStatus('cc2Bstatus','✓ Carta raddrizzata. Le 4 linee blu sono una proposta automatica: correggile se necessario.','ok');
    }
    saveState();
    window.dispatchEvent(new CustomEvent('cardcenter:aligned',{detail:{url:state.rectifiedUrl,sourceUrl:state.sourceUrl,game:state.game}}));
  }catch(e){
    setStatus('cc2Astatus','Raddrizzamento non riuscito: '+e.message,'warn');
  }finally{
    el('cc2Warp').disabled=false;
  }
}
function setupCanvasB(){
  const cv=el('cc2canvasB');cv.width=state.rectified.width;cv.height=state.rectified.height;
}
async function autoInnerLines(c,onProgress){
  const W=c.width,H=c.height,x=c.getContext('2d',{willReadFrequently:true});
  const d=x.getImageData(0,0,W,H).data,g=new Float32Array(W*H);

  // Conversione a blocchi: evita un unico loop lungo sul thread UI.
  for(let y=0;y<H;y++){
    let base=y*W,p=base*4;
    for(let xx=0;xx<W;xx++,p+=4)g[base+xx]=.299*d[p]+.587*d[p+1]+.114*d[p+2];
    if((y&31)===0){
      if(onProgress)onProgress('Analizzo la carta… '+Math.round(y/H*55)+'%');
      await nextFrame();
    }
  }

  function vscore(xx){
    let a=[];
    for(let y=Math.round(H*.10);y<H*.90;y+=3){
      const z=y*W+xx;a.push(Math.abs(g[z+1]-g[z-1]));
    }
    a.sort((a,b)=>a-b);
    return a.slice(Math.floor(a.length*.35)).reduce((s,v)=>s+v,0);
  }
  function hscore(yy){
    let a=[];
    for(let xx=Math.round(W*.10);xx<W*.90;xx+=3){
      const z=yy*W+xx;a.push(Math.abs(g[z+W]-g[z-W]));
    }
    a.sort((a,b)=>a-b);
    return a.slice(Math.floor(a.length*.35)).reduce((s,v)=>s+v,0);
  }
  async function best(from,to,fn,label,startPct,endPct){
    let bi=from,bs=-1,count=0,total=Math.max(1,to-from+1);
    for(let i=from;i<=to;i++){
      const s=fn(i);if(s>bs){bs=s;bi=i}
      count++;
      if((count&15)===0){
        if(onProgress)onProgress(label+' '+Math.round(startPct+(endPct-startPct)*count/total)+'%');
        await nextFrame();
      }
    }
    return bi;
  }

  const l=await best(Math.round(W*.025),Math.round(W*.20),vscore,'Cerco linee',55,66);
  const r=await best(Math.round(W*.80),Math.round(W*.975),vscore,'Cerco linee',66,77);
  const t=await best(Math.round(H*.025),Math.round(H*.18),hscore,'Cerco linee',77,88);
  const b=await best(Math.round(H*.82),Math.round(H*.975),hscore,'Cerco linee',88,100);

  return {l:l,r:r,t:t,b:b};
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
  const l=el('cc2lensB'),x=l.getContext('2d'),W=state.rectified.width,H=state.rectified.height;
  // Più contesto nella fase 2: serve vedere chiaramente bordo giallo + contenuto.
  const S=Math.max(96,Math.min(W,H)*.15);

  // Il punto selezionato resta SEMPRE al centro anche vicino ai bordi.
  // Non spostiamo il ritaglio verso l'interno: fuori dalla carta mostriamo nero.
  const sx=p.x-S/2,sy=p.y-S/2;
  const srcX=Math.max(0,sx),srcY=Math.max(0,sy);
  const srcR=Math.min(W,sx+S),srcB=Math.min(H,sy+S);
  const srcW=Math.max(0,srcR-srcX),srcH=Math.max(0,srcB-srcY);
  const dstX=(srcX-sx)/S*l.width,dstY=(srcY-sy)/S*l.height;
  const dstW=srcW/S*l.width,dstH=srcH/S*l.height;

  x.fillStyle='#07090c';x.fillRect(0,0,l.width,l.height);
  if(srcW>0&&srcH>0)x.drawImage(state.rectified,srcX,srcY,srcW,srcH,dstX,dstY,dstW,dstH);

  x.strokeStyle='#2188ff';x.lineWidth=3;x.beginPath();
  x.moveTo(l.width/2,0);x.lineTo(l.width/2,l.height);
  x.moveTo(0,l.height/2);x.lineTo(l.width,l.height/2);x.stroke();

  x.fillStyle='#ffd322';x.beginPath();x.arc(l.width/2,l.height/2,7,0,Math.PI*2);x.fill();
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
  cv.onpointerdown=e=>{
    cv.setPointerCapture(e.pointerId);drag=true;
    const p=rectToCanvasPoint(cv,e);placeLine(p);drawLensB(p);positionLensNearPointer(el('cc2lensB'),e);
  };
  cv.onpointermove=e=>{
    if(!drag)return;
    const p=rectToCanvasPoint(cv,e);placeLine(p);drawLensB(p);positionLensNearPointer(el('cc2lensB'),e);
  };
  const up=e=>{
    if(!drag)return;
    drag=false;updateResult();
    if(e)positionLensNearPointer(el('cc2lensB'),e);
    scheduleLensHide('cc2lensB',650);
  };
  cv.onpointerup=up;cv.onpointercancel=up;
}
function placeLine(p){
  const k=state.lineSel,W=state.rectified.width,H=state.rectified.height;
  // Nessun margine artificiale: la linea può arrivare davvero fino al bordo della carta.
  // Manteniamo solo la metà corretta per evitare di scambiare sinistra/destra o alto/basso.
  if(k==='l')state.lines.l=clamp(p.x,0,W*.499);
  if(k==='r')state.lines.r=clamp(p.x,W*.501,W);
  if(k==='t')state.lines.t=clamp(p.y,0,H*.499);
  if(k==='b')state.lines.b=clamp(p.y,H*.501,H);
  renderB();updateResult();
}
function useForOCR(){
  if(!state.rectifiedUrl)return;
  window.dispatchEvent(new CustomEvent('cardcenter:useocr',{detail:{url:state.rectifiedUrl,sourceUrl:state.sourceUrl,game:state.game}}));
  close();
}
function close(){
  hideLensA();hideLensB();
  const p=state.prevView||'fine';el('cent').classList.add('hide');const x=el(p);if(x)x.classList.remove('hide');
}
function bind(){
  bindA();bindB();
  document.querySelectorAll('#cent .cc2lensModes button').forEach(function(b){
    b.onclick=function(){
      state.lensMode=b.dataset.z||'context';
      renderLensModes();
      var l=el('cc2lensA');if(state.points[state.selected]&&l&&l.style.display==='block')drawLensA(state.points[state.selected]);
    };
  });
  renderLensModes();
  el('cc2game').onchange=()=>{state.game=el('cc2game').value;state.points=[null,null,null,null];state.rectified=null;state.lines={l:null,r:null,t:null,b:null};state.editingVersion++;renderCornerButtons();renderA();setStatus('cc2Astatus','Tipo carta cambiato: riposiziona i 4 angoli oppure usa il rilevamento automatico.');}
  el('cc2Auto').onclick=()=>autoDetect(true);
  el('cc2Clear').onclick=()=>{state.points=[null,null,null,null];state.selected=0;state.editingVersion++;renderCornerButtons();renderA();setStatus('cc2Astatus','Punti azzerati. Tocca i quattro angoli fisici della carta.')};
  el('cc2Warp').onclick=warp;
  el('cc2BackA').onclick=()=>{hideLensB();showOnly('A');renderA()};
  el('cc2AutoLines').onclick=async()=>{
    const b=el('cc2AutoLines');if(b.disabled)return;
    b.disabled=true;const old=b.textContent;b.textContent='Analizzo…';
    try{
      state.lines=await autoInnerLines(state.rectified,function(msg){setStatus('cc2Bstatus',msg)});
      renderB();updateResult();
      setStatus('cc2Bstatus','Linee ricalcolate automaticamente. Controllale visivamente.','ok');
    }finally{
      b.disabled=false;b.textContent=old;
    }
  };
  el('cc2UseOCR').onclick=useForOCR;
  el('cc2Exit').onclick=close;
}

window.CardCenterV2={open:open,close:close,getState:()=>state};
window.apriCent=function(url){open(url,{game:(el('rgame')&&el('rgame').value==='ygo')?'ygo':'poke'})};
window.esciCent=close;

install();
})();