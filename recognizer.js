(function(){
'use strict';

var recResults=[];
var recUrl=null;
var recMatchedSetCode=null;
var recBusy=false;
var TESS_URL='https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';

function rq(id){return document.getElementById(id)}
function resc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function rnorm(s){
  return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
    .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim();
}
function dice(a,b){
  a=rnorm(a);b=rnorm(b);
  if(!a||!b)return 0;
  if(a===b)return 1;
  if(a.length<2||b.length<2)return a===b?1:0;
  var A={},n=0,m=0;
  for(var i=0;i<a.length-1;i++){var x=a.slice(i,i+2);A[x]=(A[x]||0)+1;n++}
  for(var j=0;j<b.length-1;j++){var y=b.slice(j,j+2);if(A[y]){A[y]--;m++}}
  return 2*m/(n+b.length-1);
}
function albumData(){
  try{var x=JSON.parse(localStorage.getItem('gradingCarte.collection.v2')||'{}');return x&&typeof x==='object'?x:{}}catch(e){return {}}
}
function ownedPoke(c){return !!albumData()['poke:'+c.id]}
function ownedYgo(c){
  var a=albumData(),suffix=':'+c.id;
  return Object.keys(a).some(function(k){return k.indexOf('ygo:')===0&&k.endsWith(suffix)})
}
function setStatus(t,bad){
  var e=rq('rstatus');if(!e)return;
  e.classList.remove('hide');e.style.color=bad?'var(--bad)':'';
  e.textContent=t;
}
function loadScript(){
  if(window.Tesseract)return Promise.resolve();
  if(window.__tessLoad)return window.__tessLoad;
  window.__tessLoad=new Promise(function(resolve,reject){
    var s=document.createElement('script');s.src=TESS_URL;s.async=true;
    s.onload=resolve;s.onerror=function(){reject(new Error('Impossibile caricare il motore OCR gratuito'))};
    document.head.appendChild(s);
  });
  return window.__tessLoad;
}
function loadImage(src){
  return new Promise(function(resolve,reject){
    var im=new Image();im.onload=function(){resolve(im)};im.onerror=function(){reject(new Error('Foto non leggibile'))};im.src=src;
  });
}
function cropForOCR(im,from,to){
  var sw=im.naturalWidth||im.width,sh=im.naturalHeight||im.height;
  var y=Math.max(0,Math.floor(sh*from)),h=Math.max(1,Math.floor(sh*(to-from)));
  var maxW=1450,scale=Math.min(2.2,maxW/sw);
  var w=Math.max(700,Math.round(sw*scale)),oh=Math.max(170,Math.round(h*scale));
  var c=document.createElement('canvas');c.width=w;c.height=oh;
  var x=c.getContext('2d',{willReadFrequently:true});
  x.drawImage(im,0,y,sw,h,0,0,w,oh);
  var d=x.getImageData(0,0,w,oh),p=d.data;
  for(var i=0;i<p.length;i+=4){
    var g=.299*p[i]+.587*p[i+1]+.114*p[i+2];
    g=Math.max(0,Math.min(255,(g-128)*1.35+128));
    p[i]=p[i+1]=p[i+2]=g;
  }
  x.putImageData(d,0,0);return c;
}
function titleCandidates(text){
  return String(text||'').split(/\r?\n/).map(function(s){
    return s.replace(/[|{}\[\]<>_=~]/g,' ').replace(/\b(?:HP|PS|PV)\s*\d{1,4}\b/ig,' ')
      .replace(/^\s*[#*•·]+/,'').replace(/\s+/g,' ').trim();
  }).filter(function(s){
    var letters=(s.match(/[A-Za-zÀ-ÿ]/g)||[]).length;
    return s.length>=3&&s.length<=45&&letters>=3&&letters/s.length>.42&&!/^(basic|stage|trainer|energy|pokemon|pokémon)$/i.test(s);
  }).slice(0,6);
}
function parsePokemon(bottom,all){
  var t=(bottom+'\n'+all).replace(/[|I]/g,'/');
  var m=t.match(/\b([A-Z]{0,4}\s*\d{1,4})\s*\/\s*(\d{2,4})\b/i);
  if(m)return {number:m[1].replace(/\s/g,''),total:parseInt(m[2],10)||null,raw:m[0]};
  var s=t.match(/\b(?:TG|GG|SV|SWSH|SM|XY)?\d{2,4}\b/i);
  return {number:s?s[0].replace(/\s/g,''):null,total:null,raw:s?s[0]:''};
}
function parseYgo(bottom,all){
  var t=(bottom+'\n'+all).toUpperCase();
  var pass=t.match(/\b\d{8}\b/);
  var set=t.match(/\b[A-Z0-9]{2,7}-[A-Z0-9]{2,7}\b/);
  return {passcode:pass?pass[0]:null,setCode:set?set[0]:null};
}
async function fjson(url){
  var ctl=new AbortController(),tm=setTimeout(function(){ctl.abort()},16000);
  try{
    var r=await fetch(url,{signal:ctl.signal});if(!r.ok)throw new Error('HTTP '+r.status);return await r.json();
  }finally{clearTimeout(tm)}
}
function pokeScore(c,titles,collector,ocr){
  var best=0;
  titles.forEach(function(t){best=Math.max(best,dice(c.name,t))});
  best=Math.max(best,dice(c.name,ocr)*.8);
  if(collector&&collector.number){
    var n1=String(c.number||'').replace(/^0+/,'').toLowerCase(),n2=String(collector.number).replace(/^0+/,'').toLowerCase();
    if(n1===n2)best+=.65;
  }
  if(collector&&collector.total){
    var st=c.set&&Number(c.set.printedTotal||c.set.total);
    if(st===collector.total)best+=.55;
  }
  return best;
}
async function findPokemon(top,bottom){
  var all=top+'\n'+bottom,titles=titleCandidates(top),col=parsePokemon(bottom,all),arr=[];
  if(col.number){
    var nums=[col.number,String(parseInt(col.number,10)||col.number)].filter(function(x,i,a){return x&&a.indexOf(x)===i});
    for(var i=0;i<nums.length&&!arr.length;i++){
      try{
        var q='number:'+nums[i],j=await fjson('https://api.pokemontcg.io/v2/cards?q='+encodeURIComponent(q)+'&pageSize=100');
        arr=j.data||[];
      }catch(e){}
    }
  }
  if(!arr.length&&titles.length){
    for(var k=0;k<Math.min(3,titles.length)&&!arr.length;k++){
      try{
        var j2=await fjson('https://api.pokemontcg.io/v2/cards?q='+encodeURIComponent('name:'+titles[k]+'*')+'&pageSize=100');
        arr=j2.data||[];
      }catch(e){}
    }
  }
  arr=arr.map(function(c){return {card:c,score:pokeScore(c,titles,col,all)}})
    .sort(function(a,b){return b.score-a.score}).slice(0,18).map(function(x){return x.card});
  return {cards:arr,det:{titles:titles,collector:col}};
}
function ygoScore(c,titles,setCode,ocr){
  var best=0;titles.forEach(function(t){best=Math.max(best,dice(c.name,t))});best=Math.max(best,dice(c.name,ocr)*.8);
  if(setCode&&(c.card_sets||[]).some(function(s){return String(s.set_code||'').toUpperCase()===setCode}))best+=.8;
  return best;
}
async function findYgo(top,bottom){
  var all=top+'\n'+bottom,titles=titleCandidates(top),id=parseYgo(bottom,all),arr=[];
  recMatchedSetCode=id.setCode||null;

  // Il codice stampa è la prova più forte: YGOPRODeck espone un endpoint esatto per setcode.
  if(id.setCode){
    try{
      var si=await fjson('https://db.ygoprodeck.com/api/v7/cardsetsinfo.php?setcode='+encodeURIComponent(id.setCode));
      var exact=Array.isArray(si)?si[0]:si;
      if(exact&&exact.id){
        var cj=await fjson('https://db.ygoprodeck.com/api/v7/cardinfo.php?id='+encodeURIComponent(exact.id));
        arr=cj.data||[];
      }
    }catch(e){}
  }
  if(!arr.length&&id.passcode){
    try{var j=await fjson('https://db.ygoprodeck.com/api/v7/cardinfo.php?id='+encodeURIComponent(id.passcode));arr=j.data||[]}catch(e){}
  }
  if(!arr.length&&titles.length){
    for(var k=0;k<Math.min(3,titles.length)&&!arr.length;k++){
      try{var j2=await fjson('https://db.ygoprodeck.com/api/v7/cardinfo.php?fname='+encodeURIComponent(titles[k]));arr=j2.data||[]}catch(e){}
      if(!arr.length){
        try{var ji=await fjson('https://db.ygoprodeck.com/api/v7/cardinfo.php?fname='+encodeURIComponent(titles[k])+'&language=it');arr=ji.data||[]}catch(e){}
      }
    }
  }
  arr=arr.map(function(c){return {card:c,score:ygoScore(c,titles,id.setCode,all)}})
    .sort(function(a,b){return b.score-a.score}).slice(0,18).map(function(x){return x.card});
  return {cards:arr,det:{titles:titles,id:id}};
}
function renderResults(game,data,top,bottom){
  recResults=data.cards||[];
  var e=rq('rresults');
  if(!recResults.length){
    e.innerHTML='<div class="msg"><b>Nessuna corrispondenza abbastanza utile.</b><br>Puoi correggere sotto il nome/numero letto e lanciare la ricerca normale.</div>';
    fillManual(game,data,top,bottom);return;
  }
  var a=albumData();
  e.innerHTML='<h3 style="margin:12px 0 5px">Possibili corrispondenze</h3>'+
    recResults.map(function(c,i){
      var own=game==='poke'?ownedPoke(c):ownedYgo(c);
      var img=game==='poke'?(c.images&&c.images.small):(c.card_images&&c.card_images[0]&&c.card_images[0].image_url_small);
      var meta;
      if(game==='poke'){
        meta=(c.set&&c.set.name||'')+' · #'+(c.number||'')+(c.rarity?' · '+c.rarity:'');
      }else{
        var matched=(c.card_sets||[]).find(function(s){return recMatchedSetCode&&String(s.set_code||'').toUpperCase()===recMatchedSetCode});
        var ps=matched||(c.card_sets&&c.card_sets[0]);
        meta=ps?ps.set_name+' · '+ps.set_code+(ps.set_rarity?' · '+ps.set_rarity:''):(c.type||'');
        if(matched)meta='✓ STAMPA RICONOSCIUTA · '+meta;
      }
      return '<button class="sec pr" data-rec="'+i+'" style="width:100%;'+(own?'outline:2px solid var(--ok)':'')+'">'+
        (img?'<img src="'+resc(img)+'" loading="lazy">':'')+
        '<span><b>'+resc(c.name)+'</b><br><small>'+resc(meta)+'</small>'+(own?'<br><small style="color:var(--ok);font-weight:800">✓ GIÀ NELL\'ALBUM</small>':'')+'</span></button>';
    }).join('');
  fillManual(game,data,top,bottom);
}
function fillManual(game,data,top,bottom){
  var val='';
  if(game==='poke'){
    var col=data.det&&data.det.collector,t=data.det&&data.det.titles;
    val=(t&&t[0])||(col&&col.number)||'';
  }else{
    var y=data.det&&data.det.id,tt=data.det&&data.det.titles;
    val=(tt&&tt[0])||(y&&(y.passcode||y.setCode))||'';
  }
  rq('rmanual').value=val;
  rq('rocr').value=(top+'\n--- PARTE BASSA ---\n'+bottom).trim();
}
async function recognize(src){
  if(recBusy)return;recBusy=true;recResults=[];rq('rresults').innerHTML='';rq('rocr').value='';
  try{
    recUrl=src;rq('rpreview').src=src;rq('rpreview').style.display='';
    setStatus('Preparo la foto sul telefono...');
    var im=await loadImage(src),top=cropForOCR(im,.00,.28),bottom=cropForOCR(im,.68,1);
    setStatus('Carico il motore OCR gratuito...');
    await loadScript();
    setStatus('Leggo nome e numero dalla carta...');
    var worker=await Tesseract.createWorker('eng');
    try{
      await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
      var a=await worker.recognize(top),b=await worker.recognize(bottom);
      var topText=a&&a.data&&a.data.text||'',bottomText=b&&b.data&&b.data.text||'';
      setStatus('Confronto il testo con il catalogo...');
      var game=rq('rgame').value,data=game==='poke'?await findPokemon(topText,bottomText):await findYgo(topText,bottomText);
      renderResults(game,data,topText,bottomText);
      setStatus(recResults.length?'Trovate '+recResults.length+' possibili corrispondenze. Controlla immagine, espansione e numero prima di confermare.':'Non ho trovato una corrispondenza certa: usa la ricerca manuale assistita qui sotto.',!recResults.length);
    }finally{await worker.terminate()}
  }catch(e){
    setStatus('Riconoscimento non riuscito: '+(e.name==='AbortError'?'servizio catalogo non raggiungibile':e.message)+'. Puoi comunque usare la ricerca manuale.',true);
  }finally{recBusy=false}
}
window.apriRiconoscimento=function(src){
  ['start','fine','cap','cent','prezzo'].forEach(function(id){var x=rq(id);if(x)x.classList.add('hide')});
  rq('riconosci').classList.remove('hide');rq('rresults').innerHTML='';rq('rstatus').classList.add('hide');
  rq('rfront').style.display=(typeof foto!=='undefined'&&foto[0])?'':'none';
  if(src)recognize(src);
}
window.esciRiconoscimento=function(){
  rq('riconosci').classList.add('hide');
  if(typeof mostraFine==='function')mostraFine();else rq('start').classList.remove('hide');
}
window.usaFronteOCR=function(){
  if(typeof foto!=='undefined'&&foto[0])recognize(foto[0]);
}
rq('rfile').addEventListener('change',function(){
  if(this.files&&this.files[0]){
    if(recUrl&&recUrl.indexOf('blob:')===0)URL.revokeObjectURL(recUrl);
    recognize(URL.createObjectURL(this.files[0]));
  }
  this.value='';
});
rq('rgame').addEventListener('change',function(){if(recUrl)recognize(recUrl)});
rq('rresults').addEventListener('click',function(ev){
  var b=ev.target.closest('[data-rec]');if(!b)return;
  var c=recResults[Number(b.dataset.rec)];if(!c)return;
  rq('riconosci').classList.add('hide');rq('prezzo').classList.remove('hide');rq('pcarta').classList.remove('hide');
  if(rq('rgame').value==='poke'){RISPOKE=[c];mostraPoke(0)}
  else{RISYGO=[c];mostraYgo(0)}
});
rq('rmanualBtn').addEventListener('click',function(){
  var q=rq('rmanual').value.trim();if(!q)return;
  rq('riconosci').classList.add('hide');rq('prezzo').classList.remove('hide');
  rq('pgioco').value=rq('rgame').value;rq('pq').value=q;cercaPrezzo();
});
})();