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
function cropBoxForOCR(im,x0,y0,x1,y1,mode){
  var sw=im.naturalWidth||im.width,sh=im.naturalHeight||im.height;
  var sx=Math.max(0,Math.floor(sw*x0)),sy=Math.max(0,Math.floor(sh*y0));
  var cw=Math.max(1,Math.floor(sw*(x1-x0))),ch=Math.max(1,Math.floor(sh*(y1-y0)));
  var targetW=mode==='number'?1000:1400,scale=Math.min(3,targetW/cw);
  var w=Math.max(420,Math.round(cw*scale)),h=Math.max(90,Math.round(ch*scale));
  var cv=document.createElement('canvas');cv.width=w;cv.height=h;
  var ctx=cv.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(im,sx,sy,cw,ch,0,0,w,h);
  var d=ctx.getImageData(0,0,w,h),p=d.data;
  var threshold=mode==='threshold';
  for(var i=0;i<p.length;i+=4){
    var g=.299*p[i]+.587*p[i+1]+.114*p[i+2];
    if(threshold)g=g>145?255:0;
    else g=Math.max(0,Math.min(255,(g-128)*1.65+128));
    p[i]=p[i+1]=p[i+2]=g;
  }
  ctx.putImageData(d,0,0);return cv;
}
function cropForOCR(im,from,to){
  return cropBoxForOCR(im,0,from,1,to,'normal');
}
function cleanOcrLine(s){
  return String(s||'').replace(/[|{}\[\]<>_=~]/g,' ')
    .replace(/\b(?:HP|PS|PV)\s*\d{1,4}\b/ig,' ')
    .replace(/^\s*[#*•·]+/,'').replace(/\s+/g,' ').trim();
}
function titleCandidates(text){
  var bad=/^(basic|stage|trainer|energy|pokemon|pokémon|ability|weakness|resistance|retreat|illustrator)$/i;
  return String(text||'').split(/\r?\n/).map(cleanOcrLine).filter(function(s){
    var words=s.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*/g)||[];
    var letters=(s.match(/[A-Za-zÀ-ÿ]/g)||[]).length;
    var useful=words.some(function(w){return w.replace(/[^A-Za-zÀ-ÿ]/g,'').length>=3});
    return s.length>=4&&s.length<=48&&letters>=4&&letters/s.length>.48&&useful&&!bad.test(s);
  }).sort(function(a,b){
    // I nomi carta stanno quasi sempre nella prima riga utile e sono relativamente brevi.
    var wa=(a.match(/[A-Za-zÀ-ÿ]/g)||[]).length,wb=(b.match(/[A-Za-zÀ-ÿ]/g)||[]).length;
    return (Math.abs(18-wa)-Math.abs(18-wb))||a.length-b.length;
  }).slice(0,8);
}
function fixDigitish(s){
  return String(s||'').replace(/[Oo]/g,'0').replace(/[Il|!]/g,'1').replace(/[Ss]/g,'5').replace(/\s+/g,'');
}
function parsePokemon(bottom,all){
  var raw=(bottom+'\n'+all).replace(/[‐‑–—]/g,'-');
  var lines=raw.split(/\r?\n/).map(function(x){return x.trim()}).filter(Boolean);
  var candidates=[];

  lines.concat([raw]).forEach(function(line){
    // Prima prova numeri veri: evita di trasformare tutto il testo in cifre.
    var re=/\b([A-Z]{0,5}\s*\d{1,4})\s*[\/\\|]\s*(\d{2,4})\b/ig,m;
    while((m=re.exec(line)))candidates.push({number:m[1].replace(/\s/g,''),total:parseInt(m[2],10)||null,raw:m[0],score:3});
    var re2=/\b(\d{1,4})\s*[Il|!]\s*(\d{2,4})\b/g,m2;
    while((m2=re2.exec(line)))candidates.push({number:m2[1],total:parseInt(m2[2],10)||null,raw:m2[0],score:2});
  });

  if(candidates.length){
    candidates.sort(function(a,b){return b.score-a.score});
    return candidates[0];
  }

  // Fallback solo sulla parte bassa: prefissi speciali o numero breve isolato.
  var t=bottom.toUpperCase();
  var sp=t.match(/\b(?:TG|GG|SV|SWSH|SM|XY|RC|SH|DP|BW)?\s*\d{1,4}\b/i);
  if(sp)return {number:sp[0].replace(/\s/g,''),total:null,raw:sp[0],score:1};
  return {number:null,total:null,raw:'',score:0};
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
var POKE_RAW_BASE='https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/';
var pokeSetCache=null;
function numKey(v){
  var s=String(v==null?'':v).trim().toLowerCase();
  if(/^\d+$/.test(s))return String(parseInt(s,10));
  return s.replace(/^0+/,'');
}
async function pokeSets(){
  if(pokeSetCache)return pokeSetCache;
  try{pokeSetCache=await fjson(POKE_RAW_BASE+'sets/en.json')}catch(e){pokeSetCache=[]}
  return pokeSetCache||[];
}
async function catalogByCollector(col,titles){
  if(!col||!col.number||!col.total)return [];
  var sets=await pokeSets();
  var matching=sets.filter(function(s){
    return Number(s.printedTotal)===Number(col.total)||Number(s.total)===Number(col.total);
  }).slice(0,14);
  if(!matching.length)return [];

  var out=[],queue=matching.slice();
  async function worker(){
    while(queue.length){
      var set=queue.shift();
      try{
        var cards=await fjson(POKE_RAW_BASE+'cards/en/'+encodeURIComponent(set.id)+'.json');
        (cards||[]).forEach(function(card){
          if(numKey(card.number)===numKey(col.number)){
            if(!card.set)card.set=set;
            out.push(card);
          }
        });
      }catch(e){}
    }
  }
  await Promise.all([worker(),worker(),worker(),worker()]);
  return out.map(function(card){
    return {card:card,score:pokeScore(card,titles,col,titles.join(' '))+1.2};
  }).sort(function(a,b){return b.score-a.score});
}
async function enrichRawCandidate(raw){
  if(!raw||!window.tcgDexSearchPokemonBriefs||!window.tcgDexFetchLegacyCard)return raw;
  try{
    var briefs=await window.tcgDexSearchPokemonBriefs(raw.name,{page:1,pageSize:30})||[];
    briefs=briefs.filter(function(b){return numKey(b.localId)===numKey(raw.number)});
    var best=null,bestScore=-1;
    for(var i=0;i<Math.min(briefs.length,6);i++){
      try{
        var full=await window.tcgDexFetchLegacyCard(briefs[i].id);
        var sc=dice(full&&full.name,raw.name)*2+dice(full&&full.set&&full.set.name,raw.set&&raw.set.name);
        if(sc>bestScore){bestScore=sc;best=full}
      }catch(e){}
    }
    return best||raw;
  }catch(e){return raw}
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
  var all=top+'\n'+bottom,titles=titleCandidates(top),col=parsePokemon(bottom,all);

  // 1) Numero/totale (es. 10/95) è la prova più forte: cerca prima nel catalogo esatto dei set compatibili.
  var exact=[];
  try{exact=await catalogByCollector(col,titles)}catch(e){}
  if(exact.length){
    var topRaw=exact.slice(0,10),enriched=[];
    for(var i=0;i<topRaw.length;i++){
      var card=await enrichRawCandidate(topRaw[i].card);
      enriched.push({card:card,score:pokeScore(card,titles,col,all)+1.2});
    }
    enriched.sort(function(a,b){return b.score-a.score});
    return {cards:enriched.slice(0,18).map(function(x){return x.card}),det:{titles:titles,collector:col,method:'numero/set'}};
  }

  // 2) Fallback TCGdex: numero oppure nome.
  var briefs=[];
  try{
    if(col.number&&window.tcgDexSearchPokemonBriefs){
      briefs=await window.tcgDexSearchPokemonBriefs('',{number:col.number,page:1,pageSize:100})||[];
    }
    if(!briefs.length&&titles.length&&window.tcgDexSearchPokemonBriefs){
      for(var k=0;k<Math.min(4,titles.length)&&!briefs.length;k++){
        try{briefs=await window.tcgDexSearchPokemonBriefs(titles[k],{page:1,pageSize:100})||[]}catch(e){}
      }
    }
  }catch(e){}

  if(!briefs.length||!window.tcgDexFetchLegacyCard){
    return {cards:[],det:{titles:titles,collector:col,method:'nessuno'}};
  }

  var scored=briefs.map(function(b){
    var best=0;
    titles.forEach(function(t){best=Math.max(best,dice(b.name,t))});
    if(col.number&&numKey(b.localId)===numKey(col.number))best+=.8;
    return {brief:b,score:best};
  }).sort(function(a,b){return b.score-a.score}).slice(0,36);

  var queue=scored.slice(),full=[];
  async function worker(){
    while(queue.length){
      var x=queue.shift();
      try{
        var card=await window.tcgDexFetchLegacyCard(x.brief.id);
        if(card)full.push({card:card,score:pokeScore(card,titles,col,all)});
      }catch(e){}
    }
  }
  await Promise.all([worker(),worker(),worker(),worker(),worker(),worker()]);
  full.sort(function(a,b){return b.score-a.score});
  return {cards:full.slice(0,18).map(function(x){return x.card}),det:{titles:titles,collector:col,method:'tcgdex'}};
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
    var good=(t||[]).find(function(x){
      var words=x.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’.-]*/g)||[];
      return words.some(function(w){return w.replace(/[^A-Za-zÀ-ÿ]/g,'').length>=4});
    });
    val=good||(col&&col.number)||'';
  }else{
    var y=data.det&&data.det.id,tt=data.det&&data.det.titles;
    val=(tt&&tt[0])||(y&&(y.passcode||y.setCode))||'';
  }
  rq('rmanual').value=val;
  var parsed=game==='poke'&&data.det&&data.det.collector;
  rq('rocr').value=[
    'TITOLO:',top,
    '',
    'NUMERO / PARTE BASSA:',bottom,
    '',
    parsed&&parsed.number?'PARSE: '+parsed.number+(parsed.total?'/'+parsed.total:''):'PARSE: nessun numero affidabile'
  ].join('\n').trim();
}
async function recognize(src){
  if(recBusy)return;
  recBusy=true;recResults=[];rq('rresults').innerHTML='';rq('rocr').value='';
  try{
    recUrl=src;rq('rpreview').src=src;rq('rpreview').style.display='';
    setStatus('Preparo le zone importanti della carta…');
    var im=await loadImage(src),game=rq('rgame').value;

    var topA=cropBoxForOCR(im,.02,.015,.98,.17,'normal');
    var topB=cropBoxForOCR(im,.02,.015,.98,.17,'threshold');
    var bottomWide=cropBoxForOCR(im,.02,.76,.98,.995,'number');
    var bottomRight=cropBoxForOCR(im,.48,.80,.995,.995,'number');

    setStatus('Carico il motore OCR gratuito…');
    await loadScript();
    setStatus('Leggo separatamente nome e numero…');
    var worker=await Tesseract.createWorker('eng');
    try{
      await worker.setParameters({tessedit_pageseg_mode:'7',preserve_interword_spaces:'1'});
      var a=await worker.recognize(topA);
      setStatus('Controllo una seconda lettura del titolo…');
      var a2=await worker.recognize(topB);

      await worker.setParameters({
        tessedit_pageseg_mode:'6',
        preserve_interword_spaces:'1',
        tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/\\-|! '
      });
      setStatus('Leggo numero carta e numero del set…');
      var b=await worker.recognize(bottomRight);
      var b2=await worker.recognize(bottomWide);

      var topText=[a&&a.data&&a.data.text||'',a2&&a2.data&&a2.data.text||''].join('\n');
      var bottomText=[b&&b.data&&b.data.text||'',b2&&b2.data&&b2.data.text||''].join('\n');
      var parsed=game==='poke'?parsePokemon(bottomText,topText+'\n'+bottomText):null;
      setStatus(game==='poke'&&parsed&&parsed.number
        ?'Letto '+parsed.number+(parsed.total?'/'+parsed.total:'')+'. Incrocio numero, set e nome…'
        :'Confronto il testo letto con il catalogo…');

      var data=game==='poke'?await findPokemon(topText,bottomText):await findYgo(topText,bottomText);
      renderResults(game,data,topText,bottomText);

      if(recResults.length){
        var extra='';
        if(game==='poke'&&data.det&&data.det.collector&&data.det.collector.number){
          extra=' · numero letto '+data.det.collector.number+(data.det.collector.total?'/'+data.det.collector.total:'');
        }
        setStatus('Trovate '+recResults.length+' possibili corrispondenze'+extra+'. Controlla immagine, espansione e numero.');
      }else{
        setStatus('Non ho trovato una corrispondenza affidabile. Ti mostro solo ciò che ho letto, senza inventare un risultato.',true);
      }
    }finally{await worker.terminate()}
  }catch(e){
    setStatus('Riconoscimento non riuscito: '+(e.name==='AbortError'?'servizio catalogo non raggiungibile':e.message)+'. Puoi usare la ricerca manuale.',true);
  }finally{recBusy=false}
}
window.apriRiconoscimento=function(src){
  ['start','fine','cap','cent','prezzo'].forEach(function(id){var x=rq(id);if(x)x.classList.add('hide')});
  rq('riconosci').classList.remove('hide');rq('rresults').innerHTML='';rq('rstatus').classList.add('hide');
  rq('rfront').style.display=(typeof foto!=='undefined'&&foto[0])?'':'none';
  if(recUrl){rq('rpreview').src=recUrl;rq('rpreview').style.display='';rq('rphotoActions').classList.remove('hide')}
  if(src)recognize(src);
}
window.esciRiconoscimento=function(){
  rq('riconosci').classList.add('hide');
  if(typeof mostraFine==='function')mostraFine();else rq('start').classList.remove('hide');
}
window.usaFronteOCR=function(){
  if(typeof foto!=='undefined'&&foto[0])recognize(foto[0]);
}
function fileToDataURL(file){
  return new Promise(function(resolve,reject){
    var r=new FileReader();
    r.onload=function(){resolve(String(r.result||''))};
    r.onerror=function(){reject(r.error||new Error('Impossibile leggere la foto'))};
    r.readAsDataURL(file);
  });
}
function yieldPaint(){
  return new Promise(function(resolve){requestAnimationFrame(function(){setTimeout(resolve,0)})});
}
function downscaleImage(im,maxDim){
  var sw=im.naturalWidth||im.width,sh=im.naturalHeight||im.height;
  var sc=Math.min(1,(maxDim||1600)/Math.max(sw,sh));
  var c=document.createElement('canvas');
  c.width=Math.max(1,Math.round(sw*sc));c.height=Math.max(1,Math.round(sh*sc));
  c.getContext('2d').drawImage(im,0,0,c.width,c.height);
  return c;
}
function quickCardCrop(source,game){
  var sw=source.width,sh=source.height;
  if(!sw||!sh)return {found:false,canvas:source,confidence:0};

  // Analisi molto piccola: evita blocchi su Samsung Internet.
  var max=320,sc=Math.min(1,max/Math.max(sw,sh));
  var w=Math.max(80,Math.round(sw*sc)),h=Math.max(80,Math.round(sh*sc));
  var c=document.createElement('canvas');c.width=w;c.height=h;
  var ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,w,h);
  var d=ctx.getImageData(0,0,w,h).data,g=new Float32Array(w*h);
  for(var i=0,p=0;i<g.length;i++,p+=4)g[i]=.299*d[p]+.587*d[p+1]+.114*d[p+2];

  var vx=new Float32Array(w),hy=new Float32Array(h);
  var y0=Math.round(h*.04),y1=Math.round(h*.96),x0=Math.round(w*.04),x1=Math.round(w*.96);
  for(var y=y0;y<y1;y+=2){
    var row=y*w;
    for(var x=2;x<w-2;x++)vx[x]+=Math.abs(g[row+x+1]-g[row+x-1]);
  }
  for(var y2=2;y2<h-2;y2++){
    var row2=y2*w;
    for(var x2=x0;x2<x1;x2+=2)hy[y2]+=Math.abs(g[row2+x2+w]-g[row2+x2-w]);
  }
  function smooth(a){
    var b=new Float32Array(a.length);
    for(var i=2;i<a.length-2;i++)b[i]=(a[i-2]+2*a[i-1]+3*a[i]+2*a[i+1]+a[i+2])/9;
    return b;
  }
  vx=smooth(vx);hy=smooth(hy);

  function topPeaks(a,margin,count){
    var arr=[];
    for(var i=margin;i<a.length-margin;i++)arr.push({p:i,s:a[i]});
    arr.sort(function(a,b){return b.s-a.s});
    var out=[],gap=Math.max(4,Math.round(a.length*.025));
    for(var k=0;k<arr.length&&out.length<count;k++){
      var z=arr[k];
      if(out.every(function(o){return Math.abs(o.p-z.p)>=gap}))out.push(z);
    }
    return out;
  }
  var xp=topPeaks(vx,Math.max(3,Math.round(w*.03)),22);
  var yp=topPeaks(hy,Math.max(3,Math.round(h*.03)),22);
  var ratio=game==='ygo'?59/86:63/88,best=null;

  for(var a=0;a<xp.length;a++)for(var b=a+1;b<xp.length;b++){
    var lx=Math.min(xp[a].p,xp[b].p),rx=Math.max(xp[a].p,xp[b].p),rw=rx-lx;
    if(rw<w*.12||rw>w*.72)continue;
    for(var u=0;u<yp.length;u++)for(var v=u+1;v<yp.length;v++){
      var ty=Math.min(yp[u].p,yp[v].p),by=Math.max(yp[u].p,yp[v].p),rh=by-ty;
      if(rh<h*.15||rh>h*.82)continue;
      var rr=rw/rh,ratioErr=Math.abs(rr-ratio)/ratio;
      if(ratioErr>.23)continue;
      var area=(rw*rh)/(w*h);
      if(area<.025||area>.55)continue;
      var cx=(lx+rx)/2,cy=(ty+by)/2;
      var centerErr=Math.hypot((cx-w/2)/w,(cy-h/2)/h);
      var edge=xp[a].s+xp[b].s+yp[u].s+yp[v].s;
      var score=edge*(1-ratioErr*.85)*(1-Math.min(.42,centerErr*.65))*(.82+Math.min(.25,area));
      if(!best||score>best.score)best={x:lx,y:ty,w:rw,h:rh,score:score,edge:edge,ratioErr:ratioErr,area:area};
    }
  }

  if(!best)return {found:false,canvas:source,confidence:0};
  var pad=.018,bx=Math.max(0,best.x-best.w*pad),by=Math.max(0,best.y-best.h*pad);
  var bw=Math.min(w-bx,best.w*(1+2*pad)),bh=Math.min(h-by,best.h*(1+2*pad));
  var ox=bx/sc,oy=by/sc,ow=bw/sc,oh=bh/sc;

  var outH=Math.min(1100,Math.max(500,Math.round(oh)));
  var outW=Math.max(1,Math.round(outH*(ow/oh)));
  var out=document.createElement('canvas');out.width=outW;out.height=outH;
  out.getContext('2d').drawImage(source,ox,oy,ow,oh,0,0,outW,outH);

  var conf=Math.max(0,Math.min(1,(1-best.ratioErr)*(.35+Math.min(.65,best.area*3))));
  return {found:true,canvas:out,confidence:conf,bbox:{x:ox,y:oy,w:ow,h:oh}};
}

var recCropFound=false;
async function prepareImportedPhoto(file,source){
  if(!file)return;
  setStatus(source==='gallery'?'Carico la foto dalla galleria…':'Carico la foto scattata…');
  rq('rresults').innerHTML='';
  rq('rocr').value='';
  rq('rphotoActions').classList.remove('hide');
  try{
    var blobUrl=URL.createObjectURL(file);
    recUrl=blobUrl;
    rq('rpreview').src=blobUrl;
    rq('rpreview').style.display='';
    await yieldPaint();

    var im=await loadImage(blobUrl);
    var work=downscaleImage(im,1200);
    try{URL.revokeObjectURL(blobUrl)}catch(e){}

    setStatus('Cerco la carta nell’immagine…');
    await yieldPaint();
    var game=rq('rgame').value==='ygo'?'ygo':'poke';
    var crop=quickCardCrop(work,game);
    recCropFound=!!(crop&&crop.found);
    var finalCanvas=recCropFound?crop.canvas:work;
    var finalUrl=finalCanvas.toDataURL('image/jpeg',.86);
    recUrl=finalUrl;
    rq('rpreview').src=finalUrl;
    await yieldPaint();

    if(recCropFound){
      setStatus('✓ Carta individuata. Ora scegli cosa fare: riconoscila, apri la centratura oppure salvala come fronte.');
    }else{
      setStatus('Foto caricata. Non ho isolato la carta con sufficiente sicurezza: puoi comunque riconoscerla oppure aprire la centratura manuale.');
    }
  }catch(e){
    setStatus('Non riesco a caricare questa foto: '+(e&&e.message?e.message:'errore sconosciuto'),true);
  }
}
window.handleRecognizerInput=function(input,source){
  var file=input&&input.files&&input.files[0];
  if(file)prepareImportedPhoto(file,source||'gallery');
  // ritarda il reset per compatibilità con Samsung Internet
  setTimeout(function(){try{input.value=''}catch(e){}},250);
}
window.riconosciFotoImportata=async function(){
  if(!recUrl){setStatus('Prima scegli una foto.',true);return}
  var b=rq('rRecognizeBtn');if(b&&b.disabled)return;
  if(b){b.disabled=true;b.textContent='Riconosco…'}
  try{
    await yieldPaint();
    await recognize(recUrl);
  }finally{
    if(b){b.disabled=false;b.textContent='✨ Riconosci e valuta'}
  }
}
window.usaFotoImportataPerCentratura=function(){
  if(!recUrl){setStatus('Prima scegli una foto.',true);return}
  try{
    // La foto importata non deve avviare OpenCV automaticamente.
    window.__galleryCenterOnce=true;
    window.__galleryCropFound=recCropFound;
    var g=document.getElementById('gioco');
    if(g)g.value=rq('rgame').value==='ygo'?'59,86':'63,88';
    rq('riconosci').classList.add('hide');
    if(typeof apriCent==='function')apriCent(recUrl);
  }catch(e){setStatus('Non riesco ad aprire la centratura: '+e.message,true)}
}
window.usaFotoImportataComeFronte=function(){
  if(!recUrl){setStatus('Prima scegli una foto.',true);return}
  try{
    if(typeof foto!=='undefined'){
      foto[0]=recUrl;
      setStatus('✓ Foto impostata come fronte. Il salvataggio locale avviene senza bloccare la pagina.');
      rq('rfront').style.display='';
      setTimeout(function(){
        try{if(window.GradingPersist)GradingPersist.savePhoto(0,recUrl)}catch(e){}
      },300);
    }
  }catch(e){setStatus('Salvataggio fronte non riuscito: '+e.message,true)}
}
rq('rgame').addEventListener('change',function(){
  rq('rresults').innerHTML='';
  if(recUrl)setStatus('Gioco cambiato. Premi “Riconosci e valuta” per analizzare di nuovo la foto.');
});
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