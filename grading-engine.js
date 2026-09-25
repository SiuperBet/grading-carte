(function(){
'use strict';

const SLOT_NAMES=[
  'Fronte','Retro',
  'Angolo alto-sinistra','Angolo alto-destra','Angolo basso-sinistra','Angolo basso-destra',
  'Bordo alto','Bordo basso','Bordo sinistro','Bordo destro',
  'Luce inclinata / superficie fronte','Luce inclinata / superficie retro'
];
const SLOT_GROUP={front:[0],back:[1],corners:[2,3,4,5],edges:[6,7,8,9],surface:[10,11]};
const CENTER_KEY='cardlab.grading.center.';
const REPORT_KEY='cardlab.grading.report.v1';

function $(id){return document.getElementById(id)}
function clamp(v,a,b){return Math.max(a,Math.min(b,v))}
function roundHalf(v){return Math.round(v*2)/2}
function nextFrame(){return new Promise(r=>requestAnimationFrame(()=>r()))}
function loadImage(url){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=url})}
function median(a){if(!a.length)return 0;const b=a.slice().sort((x,y)=>x-y),m=Math.floor(b.length/2);return b.length%2?b[m]:(b[m-1]+b[m])/2}
function avg(a){return a.length?a.reduce((s,v)=>s+v,0)/a.length:0}
function fmt(v,n=1){return Number.isFinite(v)?v.toFixed(n):'—'}

function getCenter(kind){
  try{
    const d=JSON.parse(localStorage.getItem(CENTER_KEY+kind)||'null');
    return d&&Number.isFinite(d.left)&&Number.isFinite(d.top)?d:null;
  }catch(e){return null}
}
function centerSubgrade(m){
  if(!m)return null;
  const dev=Math.max(Math.abs(50-m.left),Math.abs(50-m.top));
  if(dev<=1)return 10;
  if(dev<=2.5)return 9.5;
  if(dev<=5)return 9;
  if(dev<=7.5)return 8.5;
  if(dev<=10)return 8;
  if(dev<=12.5)return 7.5;
  if(dev<=15)return 7;
  if(dev<=18)return 6;
  if(dev<=22)return 5;
  if(dev<=28)return 4;
  if(dev<=35)return 3;
  return 2;
}

async function analyzePhoto(url,index){
  const im=await loadImage(url);
  const max=360,s=Math.min(1,max/Math.max(im.naturalWidth,im.naturalHeight));
  const c=document.createElement('canvas');
  c.width=Math.max(64,Math.round(im.naturalWidth*s));
  c.height=Math.max(64,Math.round(im.naturalHeight*s));
  const x=c.getContext('2d',{willReadFrequently:true});
  x.drawImage(im,0,0,c.width,c.height);
  const d=x.getImageData(0,0,c.width,c.height).data,W=c.width,H=c.height,N=W*H;
  const g=new Float32Array(N);
  let lum=0,lum2=0,glare=0,dark=0,sat=0,white=0;
  for(let i=0,p=0;i<N;i++,p+=4){
    const r=d[p],gg=d[p+1],b=d[p+2],mx=Math.max(r,gg,b),mn=Math.min(r,gg,b);
    const y=.299*r+.587*gg+.114*b;g[i]=y;lum+=y;lum2+=y*y;
    if(r>247&&gg>247&&b>247)glare++;
    if(y<22)dark++;
    if(y>205&&mx-mn<18)white++;
    sat+=(mx?((mx-mn)/mx):0);
  }
  lum/=N;
  const contrast=Math.sqrt(Math.max(0,lum2/N-lum*lum));
  let lapSum=0,lap2=0,strong=0,orient=[0,0,0,0],gradSum=0,grad2=0,n=0;
  for(let yy=1;yy<H-1;yy++){
    for(let xx=1;xx<W-1;xx++){
      const z=yy*W+xx;
      const l=4*g[z]-g[z-1]-g[z+1]-g[z-W]-g[z+W];
      lapSum+=l;lap2+=l*l;
      const gx=g[z+1]-g[z-1],gy=g[z+W]-g[z-W],m=Math.hypot(gx,gy);
      gradSum+=m;grad2+=m*m;n++;
      if(m>46){
        strong++;
        let a=Math.atan2(gy,gx)+Math.PI;
        let bin=Math.floor((a%(Math.PI))*4/Math.PI);if(bin<0)bin=0;if(bin>3)bin=3;
        orient[bin]++;
      }
    }
    if((yy&47)===0)await nextFrame();
  }
  const lm=lapSum/Math.max(1,n);
  const sharp=Math.max(0,lap2/Math.max(1,n)-lm*lm);
  const gradMean=gradSum/Math.max(1,n);
  const gradVar=Math.max(0,grad2/Math.max(1,n)-gradMean*gradMean);
  const edgeDensity=strong/Math.max(1,n);
  const orientCoherence=strong?Math.max(...orient)/strong:0;
  const qualityBrightness=clamp(1-Math.abs(lum-135)/115,0,1);
  const qualitySharp=clamp((Math.log10(sharp+1)-1.35)/1.15,0,1);
  const glareLimit=(index===10||index===11)?.15:.035;
  const qualityGlare=clamp(1-(glare/N)/glareLimit,0,1);
  const quality=100*(.30*qualityBrightness+.50*qualitySharp+.20*qualityGlare);
  return{
    index,width:W,height:H,brightness:lum,contrast,sharpness:sharp,
    glare:glare/N,dark:dark/N,white:white/N,saturation:sat/N,
    edgeDensity,orientCoherence,gradMean,gradVar,quality
  };
}

function relativeScores(list,type){
  if(!list.length)return null;
  const medEdge=median(list.map(x=>x.edgeDensity));
  const medWhite=median(list.map(x=>x.white));
  const medGrad=median(list.map(x=>Math.sqrt(x.gradVar)));
  const scores=list.map(x=>{
    const edgeEx=clamp((x.edgeDensity-medEdge)/Math.max(.015,medEdge*.55),0,1);
    const whiteEx=clamp((x.white-medWhite)/Math.max(.018,medWhite*.8+.012),0,1);
    const gradEx=clamp((Math.sqrt(x.gradVar)-medGrad)/Math.max(4,medGrad*.38),0,1);
    const qPenalty=clamp((58-x.quality)/58,0,.55);
    const defect=type==='corner'
      ? .42*edgeEx+.33*whiteEx+.25*gradEx
      : .48*edgeEx+.22*whiteEx+.30*gradEx;
    let score=9.7-defect*3.6-qPenalty*.9;
    return clamp(roundHalf(score),5,10);
  });
  return {scores,grade:roundHalf(avg(scores)),min:Math.min(...scores)};
}

function oneSurfaceScore(x){
  if(!x)return null;
  const lineSignal=clamp((x.edgeDensity*.75+x.orientCoherence*.25-.10)/.28,0,1);
  const texture=clamp((Math.sqrt(x.gradVar)-16)/52,0,1);
  const photoPenalty=clamp((62-x.quality)/62,0,.45);
  const defect=.55*lineSignal+.45*texture;
  return clamp(roundHalf(9.6-defect*3.0-photoPenalty*.8),4,10);
}
function surfaceScore(frontTilt,backTilt,front,back){
  const a=oneSurfaceScore(frontTilt),b=oneSurfaceScore(backTilt);
  if(a==null||b==null)return null;
  let score=roundHalf((a+b)/2);
  if(front&&front.quality<45)score-=.25;
  if(back&&back.quality<45)score-=.25;
  return clamp(roundHalf(score),4,10);
}

function overallGrade(parts){
  const vals=[parts.centering,parts.corners,parts.edges,parts.surface];
  if(vals.some(v=>!Number.isFinite(v)))return null;
  const weighted=.20*parts.centering+.30*parts.corners+.25*parts.edges+.25*parts.surface;
  const floor=Math.min(...vals);
  return clamp(roundHalf(Math.min(weighted,floor+1)),1,10);
}
function gradeLabel(g){
  if(g==null)return 'Incompleto';
  if(g>=9.5)return 'Gem/Pristine candidate';
  if(g>=9)return 'Mint candidate';
  if(g>=8)return 'Near Mint–Mint';
  if(g>=7)return 'Near Mint';
  if(g>=6)return 'Excellent–NM';
  if(g>=5)return 'Excellent';
  if(g>=4)return 'Very Good–Excellent';
  if(g>=3)return 'Very Good';
  if(g>=2)return 'Good';
  return 'Poor';
}

function missingPhotos(){
  const a=[];
  for(let k=0;k<SLOT_NAMES.length;k++)if(typeof foto==='undefined'||!foto[k])a.push(k);
  return a;
}
function photoCount(){return typeof foto!=='undefined'?foto.filter(Boolean).length:0}

async function run(){
  const out=$('gradeResults'),status=$('gradeStatus');
  if(!out||!status)return;
  status.className='msg';status.textContent='Analizzo le fotografie sul dispositivo…';
  out.innerHTML='';
  const existing=[];
  for(let k=0;k<SLOT_NAMES.length;k++){
    if(typeof foto!=='undefined'&&foto[k]){
      status.textContent='Analizzo '+SLOT_NAMES[k]+'…';
      try{existing.push(await analyzePhoto(foto[k],k))}catch(e){}
      await nextFrame();
    }
  }
  const by={};existing.forEach(x=>by[x.index]=x);
  const frontC=getCenter('front'),backC=getCenter('back');
  let cent=null,frontCentGrade=frontC?centerSubgrade(frontC):null,backCentGrade=backC?centerSubgrade(backC):null;
  if(frontC&&backC)cent=roundHalf(.75*frontCentGrade+.25*backCentGrade);
  const corners=relativeScores(SLOT_GROUP.corners.map(k=>by[k]).filter(Boolean),'corner');
  const edges=relativeScores(SLOT_GROUP.edges.map(k=>by[k]).filter(Boolean),'edge');
  const surface=surfaceScore(by[10],by[11],by[0],by[1]);
  const parts={
    centering:cent,
    corners:corners&&corners.scores.length===4?corners.grade:null,
    edges:edges&&edges.scores.length===4?edges.grade:null,
    surface:surface
  };
  const grade=overallGrade(parts);
  const miss=missingPhotos();
  const avgQ=avg(existing.map(x=>x.quality));
  const completeness=photoCount()/SLOT_NAMES.length;
  const evidence=(Number.isFinite(parts.centering)?1:0)+(Number.isFinite(parts.corners)?1:0)+(Number.isFinite(parts.edges)?1:0)+(Number.isFinite(parts.surface)?1:0);
  const confidence=Math.round(100*clamp(.58*completeness+.27*(avgQ/100)+.15*(evidence/4),0,1));
  const report={at:Date.now(),grade,label:gradeLabel(grade),parts,confidence,photos:photoCount(),missing:miss,quality:existing};
  try{localStorage.setItem(REPORT_KEY,JSON.stringify(report))}catch(e){}

  const card=(title,val,detail)=>`
    <div class="gradeMetric"><div><b>${title}</b><div class="gradeDetail">${detail||''}</div></div>
    <div class="gradeValue">${val==null?'—':fmt(val,1)}</div></div>`;
  const centerDetail=frontC
    ? `Fronte ${frontC.left}/${frontC.right} · ${frontC.top}/${frontC.bottom}${backC?' · retro misurato':''}`
    : 'Misura prima la centratura del fronte';
  let html='<div class="gradeHero">';
  if(grade!=null){
    html+=`<div class="gradeBig">${fmt(grade,1)}<span>/10</span></div><div><b>${gradeLabel(grade)}</b><br><span>Confidenza analisi: ${confidence}%</span></div>`;
  }else{
    html+=`<div class="gradeBig">—</div><div><b>Stima complessiva non ancora affidabile</b><br><span>${photoCount()}/${SLOT_NAMES.length} foto · confidenza dati ${confidence}%</span></div>`;
  }
  html+='</div>';
  html+=card('Centratura',parts.centering,centerDetail);
  html+=card('Angoli',parts.corners,corners?`${corners.scores.length}/4 foto analizzate`:'Servono le 4 foto degli angoli');
  html+=card('Bordi',parts.edges,edges?`${edges.scores.length}/4 foto analizzate`:'Servono le 4 foto dei bordi');
  html+=card('Superficie',parts.surface,(by[10]&&by[11])?'Fronte e retro a luce inclinata analizzati':'Servono entrambe le foto a luce inclinata');
  if(miss.length){
    html+=`<div class="gradeMissing"><b>Per completare il pre-grading mancano ${miss.length} foto:</b><br>${miss.map(k=>SLOT_NAMES[k]).join(' · ')}</div>`;
  }
  html+=`<div class="gradeDisclaimer"><b>Stima Card Lab, non grading ufficiale.</b> Il motore locale può misurare centratura e segnali visivi macroscopici, ma non può certificare autenticità, alterazioni, micrograffi, indentazioni o difetti invisibili nelle foto. Un grado professionale può quindi differire.</div>`;
  out.innerHTML=html;
  status.textContent=grade!=null?'Analisi completata. Controlla i quattro sottopunteggi.':'Analisi parziale completata: aggiungi le foto mancanti per ottenere una stima complessiva.';
}

function open(){
  ['start','cap','fine','cent','prezzo','riconosci'].forEach(id=>{const e=$(id);if(e)e.classList.add('hide')});
  const g=$('grading');if(g)g.classList.remove('hide');
  refreshRequirements();
}
function close(){
  const g=$('grading');if(g)g.classList.add('hide');
  if(typeof mostraFine==='function')mostraFine();
}
function refreshRequirements(){
  const e=$('gradeRequirements');if(!e)return;
  const count=photoCount(),m=missingPhotos();
  const fc=getCenter('front'),bc=getCenter('back');
  e.innerHTML=`<b>Materiale disponibile:</b> ${count}/11 foto · centratura fronte ${fc?'✓':'—'} · retro ${bc?'✓':'—'}<br>
  <span class="gradeDetail">${m.length?'Puoi già fare un’analisi parziale, ma il voto complessivo compare solo quando ci sono centratura fronte/retro, 4 angoli, 4 bordi e superficie fronte/retro.':'Set fotografico completo.'}</span>`;
}
window.CardGrade={open,close,run,refresh:refreshRequirements,getLast:()=>{try{return JSON.parse(localStorage.getItem(REPORT_KEY)||'null')}catch(e){return null}}};
window.apriGrading=open;
window.esciGrading=close;
window.eseguiGrading=run;
})();
