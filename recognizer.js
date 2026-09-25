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
    if(mode==='threshold')g=g>145?255:0;
    else if(mode==='thresholdInv')g=g>145?0:255;
    else g=Math.max(0,Math.min(255,(g-128)*1.75+128));
    p[i]=p[i+1]=p[i+2]=g;
  }
  ctx.putImageData(d,0,0);return cv;
}
function cropForOCR(im,from,to){
  return cropBoxForOCR(im,0,from,1,to,'normal');
}
function wholeForOCR(im){
  var sw=im.naturalWidth||im.width,sh=im.naturalHeight||im.height,scale=Math.min(1,900/Math.max(sw,sh));
  var cv=document.createElement('canvas');cv.width=Math.max(320,Math.round(sw*scale));cv.height=Math.max(320,Math.round(sh*scale));
  var ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(im,0,0,cv.width,cv.height);
  var d=ctx.getImageData(0,0,cv.width,cv.height),p=d.data;
  for(var i=0;i<p.length;i+=4){
    var g=.299*p[i]+.587*p[i+1]+.114*p[i+2];
    g=Math.max(0,Math.min(255,(g-128)*1.45+128));
    p[i]=p[i+1]=p[i+2]=g;
  }
  ctx.putImageData(d,0,0);return cv;
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
function attackCandidates(text){
  var bad=/^(ability|weakness|resistance|retreat|stage|basic|pokemon|pokémon|illustrator|team magma|team aqua)$/i;
  var out=[];
  String(text||'').split(/\r?\n/).forEach(function(line){
    line=cleanOcrLine(line).replace(/\s+(?:\d{1,3}[+x×-]?|[+x×])\s*$/i,'').trim();
    var words=line.match(/[A-Za-z][A-Za-z'’.-]*/g)||[];
    if(line.length>=4&&line.length<=34&&words.length>=1&&words.length<=5&&!bad.test(line)){
      var letters=(line.match(/[A-Za-z]/g)||[]).length;
      if(letters>=4&&letters/line.length>.55)out.push(line);
    }
  });
  return out.filter(function(x,i,a){return a.indexOf(x)===i}).slice(0,12);
}
function parseYear(text){
  var years=(String(text||'').match(/\b(?:19\d{2}|20\d{2})\b/g)||[]).map(Number)
    .filter(function(y){return y>=1996&&y<=new Date().getFullYear()+1});
  return years.length?years[years.length-1]:null;
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

  // OCR del numero: corregge confusioni tipiche O/0, I/1, S/5.
  var fixed=String(bottom||'').toUpperCase()
    .replace(/[OQ]/g,'0').replace(/[IL|!]/g,'1').replace(/S/g,'5')
    .replace(/\\/g,'/');
  var loose=fixed.match(/(?:^|\s)(\d{1,4})\s*[/]\s*(\d{2,4})(?:\s|$)/);
  if(loose){
    var nn=parseInt(loose[1],10),tt=parseInt(loose[2],10);
    if(nn>=0&&tt>=20&&tt<=500&&nn<=tt)return {number:String(nn),total:tt,raw:loose[0].trim(),score:2.8};
  }

  // Se la slash è sparita completamente, prova una ricostruzione SOLO su una sequenza breve
  // proveniente dalla zona numero, non sull'intera carta.
  var digitRuns=(fixed.match(/\b\d{3,6}\b/g)||[]);
  var splitBest=null;
  digitRuns.forEach(function(run){
    for(var cut=1;cut<=Math.min(3,run.length-2);cut++){
      var a=parseInt(run.slice(0,cut),10),b=parseInt(run.slice(cut),10);
      if(a>=0&&b>=20&&b<=500&&a<=b){
        var score=0;
        if(run.slice(cut)[0]!=='0')score+=1;
        if(b>=40&&b<=250)score+=1;
        if(a>=1&&a<=250)score+=.5;
        if(!splitBest||score>splitBest.score)splitBest={number:String(a),total:b,raw:run,score:1.7+score*.1};
      }
    }
  });
  if(splitBest)return splitBest;

  var t=fixed;
  var sp=t.match(/\b(?:TG|GG|SV|SWSH|SM|XY|RC|SH|DP|BW)\s*\d{1,4}\b/i);
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
function attackScore(card,attacks,titles){
  var best=0;
  (card.attacks||[]).forEach(function(a){
    attacks.forEach(function(t){best=Math.max(best,dice(a.name,t)*1.35)});
  });
  titles.forEach(function(t){best=Math.max(best,dice(card.name,t))});
  return best;
}
async function catalogByAttacks(attacks,year,titles,col){
  if(!attacks||!attacks.length)return [];
  var sets=await pokeSets();

  if(year){
    sets=sets.filter(function(s){return String(s.releaseDate||'').slice(0,4)===String(year)});
  }else if(col&&col.total){
    sets=sets.filter(function(s){return Number(s.printedTotal)===Number(col.total)||Number(s.total)===Number(col.total)});
  }else{
    return [];
  }

  // Evita una scansione enorme: un anno Pokémon ha pochi set.
  sets=sets.slice(0,18);
  var out=[],queue=sets.slice();
  async function worker(){
    while(queue.length){
      var set=queue.shift();
      try{
        var cards=await fjson(POKE_RAW_BASE+'cards/en/'+encodeURIComponent(set.id)+'.json');
        (cards||[]).forEach(function(card){
          card=Object.assign({},card);
          card.set=set;
          var sc=attackScore(card,attacks,titles);
          if(col&&col.number&&numKey(card.number)===numKey(col.number))sc+=1.0;
          if(sc>=.72)out.push({card:card,score:sc});
        });
      }catch(e){}
    }
  }
  await Promise.all([worker(),worker(),worker(),worker()]);
  out.sort(function(a,b){return b.score-a.score});
  return out.slice(0,16);
}
async function findPokemon(top,bottom,middle,footer){
  var all=[top,middle,bottom,footer].join('\n');
  var titles=titleCandidates(top);
  var col=parsePokemon(bottom+'\n'+footer,all);
  var attacks=attackCandidates(middle);
  var year=parseYear(footer+'\n'+bottom+'\n'+all);

  // 1) Numero/totale è la prova più forte.
  var exact=[];
  try{exact=await catalogByCollector(col,titles)}catch(e){}
  if(exact.length){
    var topRaw=exact.slice(0,12),enriched=[];
    for(var i=0;i<topRaw.length;i++){
      var rawCard=topRaw[i].card,card=await enrichRawCandidate(rawCard);
      var sc=pokeScore(card,titles,col,all)+1.2+attackScore(rawCard,attacks,titles);
      var relYear=rawCard.set&&String(rawCard.set.releaseDate||'').slice(0,4);
      if(year&&relYear===String(year))sc+=.45;
      enriched.push({card:card,score:sc});
    }
    enriched.sort(function(a,b){return b.score-a.score});
    var bestExact=enriched.length?enriched[0].score:0;
    enriched=enriched.filter(function(x,i){return i<5&&x.score>=bestExact-.38});
    return {cards:enriched.map(function(x){return x.card}),det:{titles:titles,collector:col,attacks:attacks,year:year,method:'numero/set'}};
  }

  // 2) Se il titolo è illeggibile, usa attacchi + anno (o totale set).
  var byAtk=[];
  try{byAtk=await catalogByAttacks(attacks,year,titles,col)}catch(e){}
  if(byAtk.length){
    var enrichedAtk=[];
    for(var j=0;j<Math.min(10,byAtk.length);j++){
      var ec=await enrichRawCandidate(byAtk[j].card);
      enrichedAtk.push({card:ec,score:byAtk[j].score});
    }
    enrichedAtk.sort(function(a,b){return b.score-a.score});
    return {cards:enrichedAtk.map(function(x){return x.card}),det:{titles:titles,collector:col,attacks:attacks,year:year,method:'attacchi/anno'}};
  }

  // 3) Fallback TCGdex per numero oppure nome.
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
    return {cards:[],det:{titles:titles,collector:col,attacks:attacks,year:year,method:'nessuno'}};
  }

  var scored=briefs.map(function(b){
    var best=0;
    titles.forEach(function(t){best=Math.max(best,dice(b.name,t))});
    if(col.number&&numKey(b.localId)===numKey(col.number))best+=.8;
    return {brief:b,score:best};
  }).filter(function(x){
    return x.score>=.50||(col.number&&numKey(x.brief.localId)===numKey(col.number));
  }).sort(function(a,b){return b.score-a.score}).slice(0,24);

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
  var bestFull=full.length?full[0].score:0;
  full=full.filter(function(x,i){
    if(i>=8)return false;
    if(col.number&&numKey(x.card.number)===numKey(col.number))return true;
    return x.score>=.62&&x.score>=bestFull-.24;
  });
  return {cards:full.map(function(x){return x.card}),det:{titles:titles,collector:col,attacks:attacks,year:year,method:'tcgdex'}};
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
    // src è la sorgente OCR. NON deve sostituire recUrl, che resta sempre la foto completa importata.
    var ocrSource=src||recUrl;
    if(!ocrSource)throw new Error('Foto non disponibile');
    if(!recUrl)recUrl=ocrSource;
    if(rq('rpreviewWrap').style.display==='none'||!rq('rpreview').src){
      rq('rpreview').src=recUrl;rq('rpreviewWrap').style.display='';
    }
    setStatus('Preparo nome, attacchi e numero della carta…');
    var im=await loadImage(ocrSource),game=rq('rgame').value;

    var topA=cropBoxForOCR(im,.015,.01,.985,.18,'normal');
    var middle=cropBoxForOCR(im,.02,.48,.98,.84,'normal');
    var numA=cropBoxForOCR(im,.66,.88,.998,.998,'number');
    var numB=cropBoxForOCR(im,.66,.88,.998,.998,'threshold');
    var numC=cropBoxForOCR(im,.66,.88,.998,.998,'thresholdInv');
    var footer=cropBoxForOCR(im,.02,.86,.98,.998,'normal');

    setStatus('Carico il motore OCR gratuito…');
    await loadScript();
    var worker=await Tesseract.createWorker('eng');
    try{
      await worker.setParameters({tessedit_pageseg_mode:'7',preserve_interword_spaces:'1'});
      setStatus('Leggo il nome…');
      var a=await worker.recognize(topA);

      await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
      setStatus('Leggo gli attacchi…');
      var m=await worker.recognize(middle);

      await worker.setParameters({
        tessedit_pageseg_mode:'7',
        preserve_interword_spaces:'1',
        tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\-|! '
      });
      setStatus('Leggo il numero della carta con più controlli…');
      var n1=await worker.recognize(numA);
      var n2=await worker.recognize(numB);
      var n3=await worker.recognize(numC);

      await worker.setParameters({
        tessedit_pageseg_mode:'6',
        preserve_interword_spaces:'1',
        tessedit_char_whitelist:'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/\\-|!©., '
      });
      setStatus('Leggo anno e dati in fondo…');
      var ft=await worker.recognize(footer);

      var topText=a&&a.data&&a.data.text||'';
      var middleText=m&&m.data&&m.data.text||'';
      var bottomText=[n1&&n1.data&&n1.data.text||'',n2&&n2.data&&n2.data.text||'',n3&&n3.data&&n3.data.text||''].join('\n');
      var footerText=ft&&ft.data&&ft.data.text||'';

      var parsed=game==='poke'?parsePokemon(bottomText+'\n'+footerText,[topText,middleText,bottomText,footerText].join('\n')):null;
      var attacks=game==='poke'?attackCandidates(middleText):[];
      var year=game==='poke'?parseYear(footerText):null;

      if(game==='poke'){
        var bits=[];
        if(parsed&&parsed.number)bits.push('numero '+parsed.number+(parsed.total?'/'+parsed.total:''));
        if(attacks.length)bits.push('attacchi: '+attacks.slice(0,2).join(', '));
        if(year)bits.push('anno '+year);
        setStatus(bits.length?'Ho letto '+bits.join(' · ')+'. Incrocio i dati…':'Incrocio le parti leggibili con il catalogo…');
      }else setStatus('Confronto i dati letti con il catalogo…');

      var data=game==='poke'
        ?await findPokemon(topText,bottomText,middleText,footerText)
        :await findYgo(topText,bottomText+'\n'+footerText);

      renderResults(game,data,topText,[middleText,bottomText,footerText].join('\n'));

      // Secondo tentativo Pokémon: se le zone mirate falliscono, leggi l'intera carta.
      // È più lento, quindi parte solo sui fallimenti.
      if(!recResults.length&&game==='poke'){
        setStatus('Prima lettura insufficiente. Faccio un secondo controllo sull’intera carta…');
        await worker.setParameters({tessedit_pageseg_mode:'6',preserve_interword_spaces:'1'});
        var full=await worker.recognize(wholeForOCR(im));
        var fullText=full&&full.data&&full.data.text||'';
        var data2=await findPokemon(fullText,fullText,fullText,fullText);
        renderResults(game,data2,fullText,fullText);
        if(recResults.length)data=data2;
      }

      if(recResults.length){
        var method=data.det&&data.det.method?' · metodo '+data.det.method:'';
        setStatus('Trovate '+recResults.length+' possibili corrispondenze'+method+'. Controlla immagine, espansione e numero.');
      }else{
        setStatus('Non ho trovato una corrispondenza affidabile nemmeno con la seconda lettura completa. Non seleziono automaticamente una carta sbagliata.',true);
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
  if(recUrl){rq('rpreview').src=recUrl;rq('rpreviewWrap').style.display='';rq('rphotoActions').classList.remove('hide');setTimeout(drawRecognizerDetection,50)}
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
function fitXofY(points){
  if(!points||points.length<3)return null;
  var sy=0,sx=0,syy=0,syx=0,n=points.length;
  points.forEach(function(p){sy+=p.y;sx+=p.x;syy+=p.y*p.y;syx+=p.y*p.x});
  var den=n*syy-sy*sy;if(Math.abs(den)<1e-6)return null;
  var a=(n*syx-sy*sx)/den,b=(sx-a*sy)/n;
  return {a:a,b:b,n:n};
}
function fitYofX(points){
  if(!points||points.length<3)return null;
  var sx=0,sy=0,sxx=0,sxy=0,n=points.length;
  points.forEach(function(p){sx+=p.x;sy+=p.y;sxx+=p.x*p.x;sxy+=p.x*p.y});
  var den=n*sxx-sx*sx;if(Math.abs(den)<1e-6)return null;
  var a=(n*sxy-sx*sy)/den,b=(sy-a*sx)/n;
  return {a:a,b:b,n:n};
}
function intersectVH(v,h){
  // x = v.a*y + v.b ; y = h.a*x + h.b
  var den=1-v.a*h.a;if(Math.abs(den)<1e-6)return null;
  var x=(v.a*h.b+v.b)/den,y=h.a*x+h.b;
  return {x:x,y:y};
}
function polyArea(p){
  var a=0;for(var i=0;i<p.length;i++){var q=p[(i+1)%p.length];a+=p[i].x*q.y-p[i].y*q.x}
  return Math.abs(a)/2;
}
function expandQuad(points,f,w,h){
  var cx=points.reduce(function(s,p){return s+p.x},0)/4,cy=points.reduce(function(s,p){return s+p.y},0)/4;
  return points.map(function(p){
    return {x:Math.max(0,Math.min(w-1,cx+(p.x-cx)*f)),y:Math.max(0,Math.min(h-1,cy+(p.y-cy)*f))};
  });
}
function quickCardDetect(source,game){
  var sw=source.width,sh=source.height;
  if(!sw||!sh)return {found:false,points:null,confidence:0,width:sw,height:sh};

  // Ricerca un rettangolo carta completo, non quattro linee indipendenti.
  // Lavora su una miniatura per restare fluido su smartphone.
  var max=320,sc=Math.min(1,max/Math.max(sw,sh));
  var w=Math.max(100,Math.round(sw*sc)),h=Math.max(100,Math.round(sh*sc));
  var cv=document.createElement('canvas');cv.width=w;cv.height=h;
  var ctx=cv.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,w,h);
  var rgba=ctx.getImageData(0,0,w,h).data,gray=new Float32Array(w*h),mag=new Float32Array(w*h);
  for(var i=0,p=0;i<gray.length;i++,p+=4)gray[i]=.299*rgba[p]+.587*rgba[p+1]+.114*rgba[p+2];
  for(var y=1;y<h-1;y++)for(var x=1;x<w-1;x++){
    var z=y*w+x;
    var gx=-gray[z-w-1]-2*gray[z-1]-gray[z+w-1]+gray[z-w+1]+2*gray[z+1]+gray[z+w+1];
    var gy=-gray[z-w-1]-2*gray[z-w]-gray[z-w+1]+gray[z+w-1]+2*gray[z+w]+gray[z+w+1];
    mag[z]=Math.hypot(gx,gy);
  }
  function rgbAt(x,y){
    x=Math.max(0,Math.min(w-1,Math.round(x)));y=Math.max(0,Math.min(h-1,Math.round(y)));
    var p=(y*w+x)*4;return [rgba[p],rgba[p+1],rgba[p+2]];
  }
  function cd(a,b){var r=a[0]-b[0],g=a[1]-b[1],bb=a[2]-b[2];return Math.sqrt(r*r+g*g+bb*bb)}
  function corners(cx,cy,H,deg){
    var ratio=game==='ygo'?59/86:63/88,W=H*ratio,t=deg*Math.PI/180;
    var ux={x:Math.cos(t),y:Math.sin(t)},uy={x:-Math.sin(t),y:Math.cos(t)};
    return [
      {x:cx-ux.x*W/2-uy.x*H/2,y:cy-ux.y*W/2-uy.y*H/2},
      {x:cx+ux.x*W/2-uy.x*H/2,y:cy+ux.y*W/2-uy.y*H/2},
      {x:cx+ux.x*W/2+uy.x*H/2,y:cy+ux.y*W/2+uy.y*H/2},
      {x:cx-ux.x*W/2+uy.x*H/2,y:cy-ux.y*W/2+uy.y*H/2}
    ];
  }
  function sideStat(a,b,cx,cy){
    var dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,tx=dx/len,ty=dy/len,nx=-ty,ny=tx;
    var mx=(a.x+b.x)/2,my=(a.y+b.y)/2;
    if(Math.hypot(mx+nx*5-cx,my+ny*5-cy)<Math.hypot(mx-nx*5-cx,my-ny*5-cy)){nx=-nx;ny=-ny}
    var edge=0,strong=0,contrast=0,inTex=0,outTex=0,n=14,off=Math.max(3,Math.min(6,len*.02));
    for(var k=0;k<n;k++){
      var t=.06+.88*k/(n-1),px=a.x+dx*t,py=a.y+dy*t,best=0;
      for(var o=-2;o<=2;o++){
        var xx=Math.round(px+nx*o),yy=Math.round(py+ny*o);
        if(xx<1||xx>=w-1||yy<1||yy>=h-1)continue;
        best=Math.max(best,mag[yy*w+xx]);
      }
      edge+=best;if(best>=55)strong++;
      var ix=Math.round(px-nx*off),iy=Math.round(py-ny*off);
      var ox=Math.round(px+nx*off),oy=Math.round(py+ny*off);
      if(ix>=1&&ix<w-1&&iy>=1&&iy<h-1&&ox>=1&&ox<w-1&&oy>=1&&oy<h-1){
        contrast+=cd(rgbAt(ix,iy),rgbAt(ox,oy));
        inTex+=mag[iy*w+ix];outTex+=mag[oy*w+ox];
      }
    }
    return {edge:edge/n,strong:strong/n,contrast:contrast/n,texDelta:(outTex-inTex)/n};
  }
  function evalRect(q,cx,cy){
    if(q.some(function(p){return p.x<2||p.x>w-3||p.y<2||p.y>h-3}))return null;
    var ss=[0,1,2,3].map(function(i){return sideStat(q[i],q[(i+1)%4],cx,cy)});
    var minStrong=Math.min.apply(null,ss.map(function(s){return s.strong}));
    if(minStrong<.34)return null;
    var edge=ss.reduce(function(a,s){return a+s.edge},0)/4;
    var contrast=ss.reduce(function(a,s){return a+s.contrast},0)/4;
    var tex=ss.reduce(function(a,s){return a+s.texDelta},0)/4;
    var minTex=Math.min.apply(null,ss.map(function(s){return s.texDelta}));
    var area=polyArea(q)/(w*h);
    var physical=Math.max(0,Math.min(1,(tex+8)/46));
    var score=.29*minStrong+.20*Math.min(1,edge/150)+.16*Math.min(1,contrast/95)+
              .25*physical+.10*Math.min(1,area/.60);
    if(minTex<-18)score*=.70;
    var margin=Math.min.apply(null,q.map(function(p){return Math.min(p.x,w-p.x,p.y,h-p.y)}))/Math.min(w,h);
    if(margin<.008)score*=.76;
    return {score:score,area:area,minStrong:minStrong,physical:physical,contrast:contrast,edge:edge};
  }
  function search(params){
    var best=null;
    for(var hi=0;hi<params.hs.length;hi++){
      var H=params.hs[hi],W=H*(game==='ygo'?59/86:63/88);if(W>w*.96)continue;
      for(var ti=0;ti<params.angles.length;ti++){
        var deg=params.angles[ti];
        for(var xi=0;xi<params.cxs.length;xi++)for(var yi=0;yi<params.cys.length;yi++){
          var cx=params.cxs[xi],cy=params.cys[yi],q=corners(cx,cy,H,deg),ev=evalRect(q,cx,cy);
          if(ev&&(!best||ev.score>best.ev.score))best={q:q,cx:cx,cy:cy,H:H,deg:deg,ev:ev};
        }
      }
    }
    return best;
  }
  function lin(a,b,n){var out=[];if(n<=1)return[a];for(var i=0;i<n;i++)out.push(a+(b-a)*i/(n-1));return out}

  var coarse=search({
    hs:lin(h*.48,h*.91,10),
    angles:lin(-8,8,9),
    cxs:lin(w*.28,w*.72,7),
    cys:lin(h*.28,h*.72,7)
  });
  if(!coarse)return {found:false,points:null,confidence:0,width:sw,height:sh};

  var fine=search({
    hs:lin(coarse.H*.94,coarse.H*1.06,5),
    angles:lin(coarse.deg-2,coarse.deg+2,5),
    cxs:lin(coarse.cx-w*.035,coarse.cx+w*.035,5),
    cys:lin(coarse.cy-h*.035,coarse.cy+h*.035,5)
  })||coarse;

  var conf=Math.max(0,Math.min(1,(fine.ev.score-.42)/.42));
  var full=fine.q.map(function(p){return {x:p.x/sc,y:p.y/sc}});
  var verified=conf>=.72&&fine.ev.minStrong>=.58&&fine.ev.physical>=.52;
  return {
    found:true,points:full,width:sw,height:sh,confidence:conf,
    outerVerified:verified,consensus:false,rectSearch:true
  };
}
function detectedCropCanvas(source,det,padFactor){
  if(!det||!det.found||!det.points)return source;
  var xs=det.points.map(function(p){return p.x}),ys=det.points.map(function(p){return p.y});
  var minX=Math.min.apply(null,xs),maxX=Math.max.apply(null,xs),minY=Math.min.apply(null,ys),maxY=Math.max.apply(null,ys);
  var bw=maxX-minX,bh=maxY-minY,pad=padFactor==null?.035:padFactor;
  minX=Math.max(0,minX-bw*pad);maxX=Math.min(source.width,maxX+bw*pad);
  minY=Math.max(0,minY-bh*pad);maxY=Math.min(source.height,maxY+bh*pad);
  var ow=maxX-minX,oh=maxY-minY,out=document.createElement('canvas');
  var s=Math.min(1,1300/Math.max(ow,oh));out.width=Math.max(1,Math.round(ow*s));out.height=Math.max(1,Math.round(oh*s));
  out.getContext('2d').drawImage(source,minX,minY,ow,oh,0,0,out.width,out.height);
  return out;
}
function drawRecognizerDetection(){
  var wrap=rq('rpreviewWrap'),img=rq('rpreview'),cv=rq('rDetectOverlay');
  if(!wrap||!img||!cv||!recDetection||!recDetection.found||!recDetection.points||!img.naturalWidth)return;
  var W=wrap.clientWidth,H=wrap.clientHeight;cv.width=Math.max(1,Math.round(W*devicePixelRatio));cv.height=Math.max(1,Math.round(H*devicePixelRatio));
  cv.style.width=W+'px';cv.style.height=H+'px';
  var ctx=cv.getContext('2d');ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);ctx.clearRect(0,0,W,H);
  var nw=img.naturalWidth,nh=img.naturalHeight,scale=Math.min(W/nw,H/nh),dw=nw*scale,dh=nh*scale,ox=(W-dw)/2,oy=(H-dh)/2;
  var p=recDetection.points.map(function(q){return {x:ox+q.x*scale,y:oy+q.y*scale}});
  var ok=!!recDetection.outerVerified;
  ctx.lineWidth=3;ctx.strokeStyle=ok?'#39e477':'#ffb020';ctx.fillStyle=ok?'#39e477':'#ffb020';
  ctx.beginPath();p.forEach(function(q,i){if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y)});ctx.closePath();ctx.stroke();
  p.forEach(function(q){ctx.beginPath();ctx.arc(q.x,q.y,5,0,Math.PI*2);ctx.fill()});
}

var recCropFound=false,recDetection=null,recOriginalCanvas=null,recOcrUrl=null;
function detPointError(a,b){
  if(!a||!b||!a.points||!b.points||a.points.length!==4||b.points.length!==4)return 1;
  var diag=Math.hypot(a.width||1,a.height||1),sum=0;
  for(var i=0;i<4;i++)sum+=Math.hypot(a.points[i].x-b.points[i].x,a.points[i].y-b.points[i].y);
  return sum/4/Math.max(1,diag);
}
function detAreaFraction(d){
  if(!d||!d.points||!d.width||!d.height)return 0;
  return polyArea(d.points)/(d.width*d.height);
}
function cvDetectionOk(d){
  if(!d||!d.points||d.points.length!==4)return false;
  var af=d.metrics&&Number(d.metrics.areaFraction)||detAreaFraction(d);
  var re=d.metrics&&Number(d.metrics.ratioErr);
  if(!Number.isFinite(re))re=1;
  if((d.confidence||0)<.42||af<.16||af>.86||re>.15)return false;
  var m=Math.min.apply(null,d.points.map(function(p){return Math.min(p.x,p.y,d.width-p.x,d.height-p.y)}));
  return m>Math.min(d.width,d.height)*.004;
}
async function secondVisionCheck(canvas,game){
  if(!window.AutoCardVision||!AutoCardVision.detectCard)return null;
  try{
    var timeout=new Promise(function(resolve){setTimeout(function(){resolve(null)},5500)});
    var work=AutoCardVision.detectCard(canvas,game==='ygo'?'59,86':'63,88').catch(function(){return null});
    return await Promise.race([work,timeout]);
  }catch(e){return null}
}
function chooseDetection(custom,cvd,w,h){
  var cOk=custom&&custom.found, vOk=cvDetectionOk(cvd);
  if(!cOk&&!vOk)return null;
  if(cOk){custom.width=w;custom.height=h}
  if(vOk){cvd.width=w;cvd.height=h}

  if(cOk&&vOk){
    var err=detPointError(custom,cvd);
    var ac=detAreaFraction(custom),av=detAreaFraction(cvd);
    if(err<=.045&&Math.abs(ac-av)<=.10){
      // Due algoritmi indipendenti concordano: media dei punti per ridurre piccoli errori.
      var pts=custom.points.map(function(p,i){return {x:(p.x+cvd.points[i].x)/2,y:(p.y+cvd.points[i].y)/2}});
      return {
        found:true,points:pts,width:w,height:h,
        confidence:Math.max(.72,Math.min(1,((custom.confidence||0)+(cvd.confidence||0))/2+.12)),
        outerVerified:true,consensus:true
      };
    }

    // Se non concordano non dichiarare mai il bordo "verificato".
    // Mostra come proposta il candidato più plausibile, preferendo OpenCV se ha forma migliore.
    var cr=custom.confidence||0,vr=cvd.confidence||0;
    var pick=(vr>cr+.08)?cvd:custom;
    return {
      found:true,points:pick.points,width:w,height:h,
      confidence:Math.min(.67,Math.max(cr,vr)),outerVerified:false,consensus:false
    };
  }
  var one=vOk?cvd:custom;
  return {found:true,points:one.points,width:w,height:h,confidence:Math.min(.64,one.confidence||.45),outerVerified:false,consensus:false};
}

async function prepareImportedPhoto(file,source){
  if(!file)return;
  setStatus(source==='gallery'?'Carico la foto dalla galleria…':'Carico la foto scattata…');
  rq('rresults').innerHTML='';rq('rocr').value='';rq('rphotoActions').classList.remove('hide');
  rq('rDetectLegend').classList.add('hide');
  recDetection=null;recCropFound=false;recOcrUrl=null;
  try{
    var blobUrl=URL.createObjectURL(file),im=await loadImage(blobUrl);
    recOriginalCanvas=downscaleImage(im,1600);
    try{URL.revokeObjectURL(blobUrl)}catch(e){}

    // Nuovo flusso V2: acquisizione = foto completa normalizzata. Nessun ritaglio automatico qui.
    recUrl=recOriginalCanvas.toDataURL('image/jpeg',.90);
    recOcrUrl=null;

    try{
      if(typeof foto!=='undefined'){
        foto[0]=recUrl;
        if(typeof i==='number'&&i===0)i=1;
        setTimeout(function(){
          try{
            if(window.GradingPersist){
              GradingPersist.savePhoto(0,recUrl);
              GradingPersist.saveMeta();
            }
          }catch(e){}
        },180);
      }
    }catch(e){}

    rq('rpreview').src=recUrl;rq('rpreviewWrap').style.display='';
    var ov=rq('rDetectOverlay');if(ov){var oc=ov.getContext('2d');oc.clearRect(0,0,ov.width,ov.height)}
    await yieldPaint();

    setStatus('✓ Foto acquisita senza tagli. Per la massima precisione usa “Apri centratura”: il nuovo flusso conferma i 4 angoli, raddrizza la carta e misura la centratura senza modificare l’originale.');
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
  if(!recOcrUrl){
    setStatus('Prima allinea la carta: conferma i 4 angoli e raddrizzala. Poi il riconoscimento userà solo la copia allineata.');
    try{
      rq('riconosci').classList.add('hide');
      if(window.CardCenterV2&&CardCenterV2.open){
        CardCenterV2.open(recUrl,{game:rq('rgame').value==='ygo'?'ygo':'poke',kind:'front'});
      }else if(typeof apriCent==='function')apriCent(recUrl);
    }catch(e){setStatus('Non riesco ad aprire l’allineamento: '+e.message,true)}
    return;
  }
  var b=rq('rRecognizeBtn');if(b&&b.disabled)return;
  if(b){b.disabled=true;b.textContent='Riconosco…'}
  try{
    await yieldPaint();
    await recognize(recOcrUrl);
  }finally{
    if(b){b.disabled=false;b.textContent='✨ Riconosci e valuta'}
  }
}
window.usaFotoImportataPerCentratura=function(){
  if(!recUrl){setStatus('Prima scegli una foto.',true);return}
  try{
    rq('riconosci').classList.add('hide');
    if(window.CardCenterV2&&CardCenterV2.open){
      CardCenterV2.open(recUrl,{game:rq('rgame').value==='ygo'?'ygo':'poke',kind:'front'});
    }else if(typeof apriCent==='function')apriCent(recUrl);
  }catch(e){setStatus('Non riesco ad aprire la centratura: '+e.message,true)}
}
window.usaFotoImportataComeFronte=function(){
  if(!recUrl){setStatus('Prima scegli una foto.',true);return}
  try{
    if(typeof foto!=='undefined'){
      foto[0]=recUrl;
      setStatus('✓ Questa foto è già il fronte della sessione ed è stata salvata automaticamente.');
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
window.addEventListener('cardcenter:aligned',function(ev){
  var d=ev&&ev.detail;if(!d||!d.url)return;
  recOcrUrl=d.url;
  setStatus('✓ Carta raddrizzata pronta. Il prossimo riconoscimento userà questa copia allineata, mentre la foto originale resta salvata.');
});
window.addEventListener('cardcenter:useocr',function(ev){
  var d=ev&&ev.detail;if(!d||!d.url)return;
  recOcrUrl=d.url;
  rq('riconosci').classList.remove('hide');
  setTimeout(function(){recognize(recOcrUrl)},0);
});
window.addEventListener('resize',function(){if(recDetection&&recDetection.found)setTimeout(drawRecognizerDetection,30)});
})();
