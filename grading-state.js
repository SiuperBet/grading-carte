(function(){
'use strict';

var DB='gradingCarteDB',STORE='photos',META_KEY='gradingCarte.mainState.v4';
var dbp=null,saving={};

function openDB(){
  if(dbp)return dbp;
  dbp=new Promise(function(resolve,reject){
    var req=indexedDB.open(DB,1);
    req.onupgradeneeded=function(){
      var db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE,{keyPath:'id'});
    };
    req.onsuccess=function(){resolve(req.result)};
    req.onerror=function(){reject(req.error)};
  });
  return dbp;
}
async function putPhoto(id,url){
  if(!url||saving[id]===url)return;
  saving[id]=url;
  try{
    var packed=await compress(url);
    var db=await openDB();
    await new Promise(function(resolve,reject){
      var tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put({id:id,url:packed,at:Date.now()});
      tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error)};
    });
  }catch(e){}finally{saving[id]=null}
}
async function allPhotos(){
  try{
    var db=await openDB();
    return await new Promise(function(resolve,reject){
      var req=db.transaction(STORE,'readonly').objectStore(STORE).getAll();
      req.onsuccess=function(){resolve(req.result||[])};req.onerror=function(){reject(req.error)};
    });
  }catch(e){return []}
}
async function clearPhotos(){
  try{
    var db=await openDB();
    await new Promise(function(resolve,reject){
      var tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).clear();tx.oncomplete=resolve;tx.onerror=function(){reject(tx.error)};
    });
  }catch(e){}
}
function loadImage(url){
  return new Promise(function(resolve,reject){
    var im=new Image();im.onload=function(){resolve(im)};im.onerror=reject;im.src=url;
  });
}
async function compress(url){
  try{
    var im=await loadImage(url),w=im.naturalWidth||im.width,h=im.naturalHeight||im.height;
    var scale=Math.min(1,1800/Math.max(w,h)),c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(w*scale));c.height=Math.max(1,Math.round(h*scale));
    c.getContext('2d').drawImage(im,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',.84);
  }catch(e){return url}
}
function visibleView(){
  var ids=['start','cap','fine','prezzo','riconosci','cent'];
  for(var i=0;i<ids.length;i++){var e=document.getElementById(ids[i]);if(e&&!e.classList.contains('hide'))return ids[i]}
  return 'start';
}
function safeClone(v){try{return JSON.parse(JSON.stringify(v))}catch(e){return null}}
function meta(){
  var o={at:Date.now(),view:visibleView()};
  try{o.i=typeof i==='number'?i:0}catch(e){}
  try{o.pts=safeClone(PTS);o.lines=safeClone(LN);o.dim=safeClone(DIM);o.tb=TB;o.tg=TG}catch(e){}
  ['gioco','pgioco','rgame','pq'].forEach(function(id){var e=document.getElementById(id);if(e)o[id]=e.value});
  return o;
}
function saveMeta(){
  try{localStorage.setItem(META_KEY,JSON.stringify(meta()))}catch(e){}
}
function readMeta(){try{return JSON.parse(localStorage.getItem(META_KEY)||'null')}catch(e){return null}}
function restoreControls(s){
  if(!s)return;
  ['gioco','pgioco','rgame','pq'].forEach(function(id){var e=document.getElementById(id);if(e&&s[id]!=null)e.value=s[id]});
  try{if(Number.isInteger(s.i))i=Math.max(0,Math.min(STEPS.length-1,s.i))}catch(e){}
  try{if(Array.isArray(s.pts)&&s.pts.length===4)PTS=s.pts;if(s.lines&&typeof s.lines==='object')LN=s.lines;if(s.dim)DIM=s.dim;if(Number.isInteger(s.tb))TB=s.tb;if(Number.isInteger(s.tg))TG=s.tg}catch(e){}
}
async function restore(){
  var s=readMeta();restoreControls(s);
  var ph=await allPhotos(),count=0;
  try{
    ph.forEach(function(x){if(x&&Number.isInteger(x.id)&&x.url){foto[x.id]=x.url;count++}});
  }catch(e){}
  var note=document.getElementById('persistNote');
  if(note)note.textContent=count?'✓ Sessione salvata: '+count+' foto recuperate automaticamente.':'✓ Salvataggio automatico attivo.';
  if(count){
    try{
      i=Math.min((s&&Number.isInteger(s.i)?s.i:foto.filter(Boolean).length),STEPS.length-1);
      mostraFine();
      var m=document.getElementById('restoreMsg');
      if(m){m.classList.remove('hide');m.textContent='Ho ripristinato la sessione precedente. Foto, avanzamento e impostazioni restano sul dispositivo anche dopo un aggiornamento della pagina.'}
    }catch(e){}
  }else if(s&&s.view==='prezzo'&&s.pq){
    try{apriPrezzo();document.getElementById('pq').value=s.pq}catch(e){}
  }
}
async function resetSession(){
  if(!confirm('Azzerare foto, misure e avanzamento di questa analisi? La tua collezione NON verrà cancellata.'))return;
  await clearPhotos();localStorage.removeItem(META_KEY);
  location.reload();
}
window.resetGradingSession=resetSession;
window.GradingPersist={savePhoto:putPhoto,saveMeta:saveMeta};

var last=[];
setInterval(function(){
  try{
    if(typeof foto!=='undefined'){
      for(var k=0;k<foto.length;k++){
        var u=foto[k];if(!u)continue;
        var sig=String(u.length)+':'+u.slice(-24);
        if(last[k]!==sig){last[k]=sig;putPhoto(k,u)}
      }
    }
    saveMeta();
  }catch(e){}
},1200);
window.addEventListener('pagehide',saveMeta);
document.addEventListener('change',saveMeta);
document.addEventListener('input',function(e){if(e.target&&['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))saveMeta()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',restore);else restore();
})();