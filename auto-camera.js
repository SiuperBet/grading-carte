(function(){
'use strict';

var CV_URL='https://docs.opencv.org/4.x/opencv.js';
var cvPromise=null,liveBusy=false,lastLive=0,stable=0,lastNorm=null,autoLock=false;

function loadCV(){
  if(window.cv&&window.cv.Mat)return Promise.resolve(window.cv);
  if(cvPromise)return cvPromise;
  cvPromise=new Promise(function(resolve,reject){
    var s=document.createElement('script');s.src=CV_URL;s.async=true;
    var tm=setTimeout(function(){reject(new Error('OpenCV non disponibile'))},18000);
    s.onerror=function(){clearTimeout(tm);reject(new Error('Impossibile caricare OpenCV'))};
    s.onload=async function(){
      try{
        if(window.cv&&typeof window.cv.then==='function')window.cv=await window.cv;
        if(window.cv&&window.cv.Mat){clearTimeout(tm);resolve(window.cv);return}
        var tries=0,t=setInterval(function(){
          tries++;if(window.cv&&window.cv.Mat){clearInterval(t);clearTimeout(tm);resolve(window.cv)}
          else if(tries>80){clearInterval(t);clearTimeout(tm);reject(new Error('OpenCV non inizializzato'))}
        },100);
      }catch(e){clearTimeout(tm);reject(e)}
    };
    document.head.appendChild(s);
  });
  return cvPromise;
}
function gameRatio(v){
  var a=String(v||'63,88').split(',').map(Number);
  return (a[0]||63)/(a[1]||88);
}
function orderPts(p){
  var pts=p.slice();
  var sums=pts.map(function(x){return x.x+x.y}),diffs=pts.map(function(x){return x.y-x.x});
  return [
    pts[sums.indexOf(Math.min.apply(null,sums))],
    pts[diffs.indexOf(Math.min.apply(null,diffs))],
    pts[sums.indexOf(Math.max.apply(null,sums))],
    pts[diffs.indexOf(Math.max.apply(null,diffs))]
  ];
}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function quadMetrics(p,w,h,expected){
  var top=dist(p[0],p[1]),bottom=dist(p[3],p[2]),left=dist(p[0],p[3]),right=dist(p[1],p[2]);
  var ww=(top+bottom)/2,hh=(left+right)/2,ratio=Math.min(ww,hh)/Math.max(ww,hh);
  var area=Math.abs(p.reduce(function(s,a,i){var b=p[(i+1)%4];return s+a.x*b.y-a.y*b.x},0))/2;
  var af=area/(w*h),ratioErr=Math.abs(ratio-expected)/expected;
  var cx=p.reduce(function(s,x){return s+x.x},0)/4,cy=p.reduce(function(s,x){return s+x.y},0)/4;
  var centerErr=Math.hypot(cx-w/2,cy-h/2)/Math.hypot(w/2,h/2);
  var score=af*2.2-Math.min(1,ratioErr)*.65-Math.min(1,centerErr)*.22;
  return {areaFraction:af,ratio:ratio,ratioErr:ratioErr,centerErr:centerErr,score:score};
}
function makeWorking(src,max){
  var sw=src.videoWidth||src.naturalWidth||src.width,sh=src.videoHeight||src.naturalHeight||src.height;
  if(!sw||!sh)return null;
  var scale=Math.min(1,(max||520)/Math.max(sw,sh));
  var c=document.createElement('canvas');c.width=Math.max(2,Math.round(sw*scale));c.height=Math.max(2,Math.round(sh*scale));
  c.getContext('2d').drawImage(src,0,0,c.width,c.height);
  return {canvas:c,scale:scale,sw:sw,sh:sh};
}
async function detect(src,game){
  var CV=await loadCV(),wk=makeWorking(src,520);
  if(!wk)return null;
  var mat=CV.imread(wk.canvas),gray=new CV.Mat(),blur=new CV.Mat(),edges=new CV.Mat(),dil=new CV.Mat();
  var contours=new CV.MatVector(),hier=new CV.Mat(),kernel=null,best=null;
  try{
    CV.cvtColor(mat,gray,CV.COLOR_RGBA2GRAY);
    CV.GaussianBlur(gray,blur,new CV.Size(5,5),0,0,CV.BORDER_DEFAULT);
    CV.Canny(blur,edges,45,135,3,false);
    kernel=CV.getStructuringElement(CV.MORPH_RECT,new CV.Size(3,3));
    CV.dilate(edges,dil,kernel,new CV.Point(-1,-1),1);
    CV.findContours(dil,contours,hier,CV.RETR_LIST,CV.CHAIN_APPROX_SIMPLE);
    var expected=gameRatio(game);
    for(var i=0;i<contours.size();i++){
      var cnt=contours.get(i),peri=CV.arcLength(cnt,true),approx=new CV.Mat();
      try{
        CV.approxPolyDP(cnt,approx,.022*peri,true);
        if(approx.rows!==4||!CV.isContourConvex(approx))continue;
        var area=Math.abs(CV.contourArea(approx));
        if(area<wk.canvas.width*wk.canvas.height*.12)continue;
        var p=[];
        for(var r=0;r<4;r++)p.push({x:approx.data32S[r*2],y:approx.data32S[r*2+1]});
        p=orderPts(p);
        var m=quadMetrics(p,wk.canvas.width,wk.canvas.height,expected);
        if(m.areaFraction<.14||m.areaFraction>.96||m.ratio<.48||m.ratio>.9)continue;
        if(!best||m.score>best.metrics.score)best={points:p,metrics:m};
      }finally{approx.delete();cnt.delete()}
    }
    if(!best)return null;
    best.points=best.points.map(function(p){return {x:p.x/wk.scale,y:p.y/wk.scale}});
    best.width=wk.sw;best.height=wk.sh;
    best.confidence=Math.max(0,Math.min(1,(best.metrics.areaFraction-.12)/.5))*Math.max(0,1-best.metrics.ratioErr);
    return best;
  }finally{
    mat.delete();gray.delete();blur.delete();edges.delete();dil.delete();contours.delete();hier.delete();if(kernel)kernel.delete();
  }
}
function normalized(p,w,h){return p.map(function(x){return {x:x.x/w,y:x.y/h}})}
function motion(a,b){
  if(!a||!b)return 1;
  var s=0;for(var i=0;i<4;i++)s+=Math.hypot(a[i].x-b[i].x,a[i].y-b[i].y);
  return s/4;
}
function overlay(){
  return document.getElementById('autoOverlay');
}
function drawOverlay(det,video){
  var o=overlay();if(!o)return;
  var w=video.videoWidth||1,h=video.videoHeight||1;
  if(o.width!==w)o.width=w;if(o.height!==h)o.height=h;
  var c=o.getContext('2d');c.clearRect(0,0,w,h);
  if(!det)return;
  var p=det.points;c.lineWidth=Math.max(5,w/250);c.strokeStyle=det.confidence>.55?'#35e66f':'#ffc640';
  c.fillStyle=det.confidence>.55?'#35e66f':'#ffc640';
  c.beginPath();p.forEach(function(x,i){if(i)c.lineTo(x.x,x.y);else c.moveTo(x.x,x.y)});c.closePath();c.stroke();
  p.forEach(function(x){c.beginPath();c.arc(x.x,x.y,Math.max(8,w/120),0,Math.PI*2);c.fill()});
}
function setGuide(text,ok){
  var e=document.getElementById('autoGuideStatus');if(!e)return;
  e.textContent=text;e.className='autoStatus '+(ok?'ok':'');
}
async function live(video,step){
  if(step>1||liveBusy||Date.now()-lastLive<520)return;
  liveBusy=true;lastLive=Date.now();
  try{
    var game=document.getElementById('gioco')&&document.getElementById('gioco').value||'63,88';
    var d=await detect(video,game);drawOverlay(d,video);
    if(!d){stable=0;lastNorm=null;setGuide('Porta tutta la carta dentro l’inquadratura: cerco automaticamente i 4 bordi.',false);return}
    var nn=normalized(d.points,d.width,d.height),mv=motion(nn,lastNorm);lastNorm=nn;
    var centered=d.metrics.centerErr<.22,shape=d.metrics.ratioErr<.15,big=d.metrics.areaFraction>.28&&d.metrics.areaFraction<.88;
    if(centered&&shape&&big&&mv<.018&&d.confidence>.42)stable++;else stable=Math.max(0,stable-1);
    if(stable>=3)setGuide('✓ Carta rilevata, allineata e stabile'+(document.getElementById('autoShotToggle')&&document.getElementById('autoShotToggle').checked?' · scatto automatico…':''),true);
    else setGuide('Carta rilevata · '+(centered?'centrata':'spostala verso il centro')+' · '+(shape?'prospettiva buona':'raddrizza il telefono')+' · tienila ferma',false);
    if(stable>=4&&!autoLock){
      var toggle=document.getElementById('autoShotToggle');
      if(toggle&&toggle.checked){
        autoLock=true;stable=0;
        setTimeout(function(){var b=document.getElementById('btnShot');if(b)b.click();setTimeout(function(){autoLock=false},1200)},250);
      }
    }
  }catch(e){
    setGuide('Rilevamento automatico non disponibile: puoi continuare con la guida manuale.',false);
  }finally{liveBusy=false}
}
async function cropCanvas(source,game){
  try{
    var CV=await loadCV(),d=await detect(source,game);
    if(!d||d.confidence<.28)return {found:false,url:source.toDataURL('image/jpeg',.9)};
    var src=CV.imread(source),srcTri=null,dstTri=null,M=null,dst=new CV.Mat(),out=document.createElement('canvas');
    try{
      var ratio=gameRatio(game),H=1500,W=Math.round(H*ratio),p=d.points;
      srcTri=CV.matFromArray(4,1,CV.CV_32FC2,[p[0].x,p[0].y,p[1].x,p[1].y,p[2].x,p[2].y,p[3].x,p[3].y]);
      dstTri=CV.matFromArray(4,1,CV.CV_32FC2,[0,0,W-1,0,W-1,H-1,0,H-1]);
      M=CV.getPerspectiveTransform(srcTri,dstTri);
      CV.warpPerspective(src,dst,M,new CV.Size(W,H),CV.INTER_CUBIC,CV.BORDER_REPLICATE,new CV.Scalar());
      out.width=W;out.height=H;CV.imshow(out,dst);
      return {found:true,url:out.toDataURL('image/jpeg',.92),confidence:d.confidence,points:d.points};
    }finally{
      src.delete();dst.delete();if(srcTri)srcTri.delete();if(dstTri)dstTri.delete();if(M)M.delete();
    }
  }catch(e){
    return {found:false,url:source.toDataURL('image/jpeg',.9),error:e.message};
  }
}
async function cornersForCanvas(canvas,game){
  try{
    var d=await detect(canvas,game);
    if(d&&d.confidence>.24)return {points:d.points,confidence:d.confidence,source:'detected'};
  }catch(e){}
  var r=(canvas.width||1)/(canvas.height||1),er=gameRatio(game);
  if(Math.abs(r-er)/er<.08){
    return {points:[{x:1,y:1},{x:canvas.width-2,y:1},{x:canvas.width-2,y:canvas.height-2},{x:1,y:canvas.height-2}],confidence:.65,source:'already-cropped'};
  }
  return null;
}
function grayAt(d,w,x,y){
  x=Math.max(0,Math.min(w-1,x|0));y=Math.max(0,Math.min(d.length/4/w-1,y|0));
  var i=(y*w+x)*4;return .299*d[i]+.587*d[i+1]+.114*d[i+2];
}
function scanVertical(d,w,h,x0,x1,y0,y1){
  var best={x:x0,score:-1},sumAll=0,nx=0;
  for(var x=Math.round(x0);x<=Math.round(x1);x+=2){
    var s=0,n=0;
    for(var y=Math.round(y0);y<=Math.round(y1);y+=4){s+=Math.abs(grayAt(d,w,x+2,y)-grayAt(d,w,x-2,y));n++}
    s/=Math.max(1,n);sumAll+=s;nx++;if(s>best.score)best={x:x,score:s};
  }
  best.ratio=best.score/Math.max(1,sumAll/Math.max(1,nx));return best;
}
function scanHorizontal(d,w,h,y0,y1,x0,x1){
  var best={y:y0,score:-1},sumAll=0,ny=0;
  for(var y=Math.round(y0);y<=Math.round(y1);y+=2){
    var s=0,n=0;
    for(var x=Math.round(x0);x<=Math.round(x1);x+=4){s+=Math.abs(grayAt(d,w,x,y+2)-grayAt(d,w,x,y-2));n++}
    s/=Math.max(1,n);sumAll+=s;ny++;if(s>best.score)best={y:y,score:s};
  }
  best.ratio=best.score/Math.max(1,sumAll/Math.max(1,ny));return best;
}
function detectBorders(canvas,dim,px){
  if(!canvas)return null;
  var W=canvas.width,H=canvas.height,M=4*px,CW=dim.w*px,CH=dim.h*px;
  var d=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,W,H).data;
  var l=scanVertical(d,W,H,M+.025*CW,M+.18*CW,M+.15*CH,M+.85*CH);
  var r=scanVertical(d,W,H,M+.82*CW,M+.975*CW,M+.15*CH,M+.85*CH);
  var t=scanHorizontal(d,W,H,M+.02*CH,M+.16*CH,M+.14*CW,M+.86*CW);
  var b=scanHorizontal(d,W,H,M+.84*CH,M+.98*CH,M+.14*CW,M+.86*CW);
  var conf=(Math.min(l.ratio,r.ratio,t.ratio,b.ratio)-1)/2.2;conf=Math.max(0,Math.min(1,conf));
  return {
    confidence:conf,
    lines:{xo1:M,xi1:l.x,xi2:r.x,xo2:M+CW,yo1:M,yi1:t.y,yi2:b.y,yo2:M+CH}
  };
}
function resetStability(){stable=0;lastNorm=null;autoLock=false;var o=overlay();if(o)o.getContext('2d').clearRect(0,0,o.width,o.height)}

window.AutoCardVision={load:loadCV,live:live,cropCanvas:cropCanvas,cornersForCanvas:cornersForCanvas,detectBorders:detectBorders,reset:resetStability};
})();