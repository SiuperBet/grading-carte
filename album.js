(function(){
'use strict';
var $=function(id){return document.getElementById(id)};
var OWN_KEY='gradingCarte.collection.v2';
var SET_CACHE_KEY='gradingCarte.sets.v2.';
var MEM={};
var owned=loadOwned();
var S={game:'poke',sets:[],shownSets:[],set:null,cards:[],filter:'all',search:''};

function loadOwned(){
  try{
    var x=JSON.parse(localStorage.getItem(OWN_KEY)||'{}');
    return x&&typeof x==='object'&&!Array.isArray(x)?x:{};
  }catch(e){return {}}
}
function saveOwned(){
  try{localStorage.setItem(OWN_KEY,JSON.stringify(owned))}catch(e){alert('Non riesco a salvare la collezione: spazio locale esaurito. Esporta un backup e libera spazio nel browser.')}
}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
async function json(url,timeout){
  var ctl=new AbortController(),tm=setTimeout(function(){ctl.abort()},timeout||15000);
  try{
    var r=await fetch(url,{signal:ctl.signal});
    if(!r.ok)throw new Error('HTTP '+r.status);
    return await r.json();
  }finally{clearTimeout(tm)}
}
function readSetCache(game){
  try{
    var x=JSON.parse(localStorage.getItem(SET_CACHE_KEY+game)||'null');
    if(x&&Date.now()-x.at<86400000&&Array.isArray(x.data))return x.data;
  }catch(e){}
  return null;
}
function writeSetCache(game,data){try{localStorage.setItem(SET_CACHE_KEY+game,JSON.stringify({at:Date.now(),data:data}))}catch(e){}}
function sessionGet(k){try{return JSON.parse(sessionStorage.getItem(k)||'null')}catch(e){return null}}
function sessionPut(k,v){try{sessionStorage.setItem(k,JSON.stringify(v))}catch(e){}}

async function loadSets(){
  $('status').textContent='Carico le espansioni...';
  $('setSelect').innerHTML='<option>Caricamento...</option>';
  $('cards').innerHTML='';
  $('setPanel').style.display='none';
  var cached=readSetCache(S.game);
  if(cached){S.sets=cached;applySetSearch();$('status').textContent='Espansioni caricate dalla cache locale.';return}
  try{
    if(S.game==='poke'){
      var j=await json('https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate&pageSize=250');
      S.sets=(j.data||[]).map(function(x){return {id:x.id,name:x.name,series:x.series||'',date:x.releaseDate||'',total:x.total||x.printedTotal||0,logo:x.images&&x.images.logo||''}});
    }else{
      var y=await json('https://db.ygoprodeck.com/api/v7/cardsets.php');
      S.sets=(y||[]).map(function(x){return {id:x.set_code||x.set_name,name:x.set_name,code:x.set_code||'',date:x.tcg_date||'',total:x.num_of_cards||0,logo:''}}).sort(function(a,b){return (b.date||'').localeCompare(a.date||'')||a.name.localeCompare(b.name)});
    }
    writeSetCache(S.game,S.sets);
    applySetSearch();
    $('status').textContent=S.sets.length+' espansioni disponibili.';
  }catch(e){
    $('status').textContent='Errore nel caricamento delle espansioni: '+(e.name==='AbortError'?'tempo scaduto':e.message)+'. Riprova più tardi.';
  }
}

function applySetSearch(){
  var q=$('setSearch').value.trim().toLowerCase();
  S.shownSets=S.sets.filter(function(x){return !q||x.name.toLowerCase().includes(q)||(x.series||'').toLowerCase().includes(q)||(x.code||'').toLowerCase().includes(q)});
  $('setSelect').innerHTML='<option value="">Scegli espansione ('+S.shownSets.length+')</option>'+S.shownSets.map(function(x,i){
    var extra=(x.code?' · '+x.code:'')+(x.date?' · '+x.date:'');
    return '<option value="'+i+'">'+esc(x.name+extra)+'</option>';
  }).join('');
}
function numSort(a,b){
  var na=parseInt(String(a.number).replace(/\D/g,''),10),nb=parseInt(String(b.number).replace(/\D/g,''),10);
  if(isNaN(na))na=99999;if(isNaN(nb))nb=99999;
  return na-nb||String(a.number).localeCompare(String(b.number));
}
async function loadCards(){
  var idx=$('setSelect').value;
  if(idx==='')return;
  S.set=S.shownSets[Number(idx)];
  if(!S.set)return;
  $('setPanel').style.display='';
  $('setTitle').textContent=S.set.name;
  $('setMeta').textContent=[S.game==='poke'?S.set.series:S.set.code,S.set.date,S.set.total?S.set.total+' carte dichiarate':''].filter(Boolean).join(' · ');
  if(S.set.logo){$('setLogo').src=S.set.logo;$('setLogo').style.display=''}else $('setLogo').style.display='none';
  $('cards').innerHTML='<div class="empty">Carico tutte le carte dell’espansione...</div>';
  $('status').textContent='Caricamento '+S.set.name+'...';
  try{
    var ck='albumcards:'+S.game+':'+S.set.id;
    var cached=sessionGet(ck);
    if(cached)S.cards=cached;
    else if(S.game==='poke')S.cards=await loadPokeCards(S.set);
    else S.cards=await loadYgoCards(S.set);
    sessionPut(ck,S.cards);
    S.search='';$('cardSearch').value='';
    render();
    $('status').textContent=S.cards.length+' carte/stampe caricate per '+S.set.name+'.';
  }catch(e){
    $('cards').innerHTML='<div class="empty">Non riesco a caricare questa espansione.</div>';
    $('status').textContent='Errore: '+(e.name==='AbortError'?'tempo scaduto':e.message)+'.';
  }
}
async function loadPokeCards(set){
  var all=[],page=1,total=1;
  while(all.length<total&&page<=10){
    var j=await json('https://api.pokemontcg.io/v2/cards?q=set.id:'+encodeURIComponent(set.id)+'&orderBy=number&pageSize=250&page='+page);
    total=j.totalCount||0;all=all.concat(j.data||[]);page++;
  }
  return all.map(function(c){return {key:'poke:'+c.id,game:'poke',id:c.id,name:c.name,number:c.number||'',rarity:c.rarity||'',image:c.images&&c.images.small||'',setName:set.name,setCode:set.id,price:null,currency:''}}).sort(numSort);
}
async function loadYgoCards(set){
  var all=[],url='https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset='+encodeURIComponent(set.name)+'&num=100&offset=0',guard=0;
  while(url&&guard<20){
    var j=await json(url);all=all.concat(j.data||[]);
    url=j.meta&&j.meta.next_page||'';guard++;if(url)await sleep(100);
  }
  var out=[];
  all.forEach(function(c){
    (c.card_sets||[]).filter(function(p){return p.set_name===set.name}).forEach(function(p){
      out.push({key:'ygo:'+p.set_code+':'+c.id,game:'ygo',id:String(c.id),name:c.name,number:p.set_code||'',rarity:p.set_rarity||'',image:c.card_images&&c.card_images[0]&&c.card_images[0].image_url_small||'',setName:p.set_name,setCode:p.set_code||'',price:Number(p.set_price)>0?Number(p.set_price):null,currency:'$'});
    });
  });
  var seen={};out=out.filter(function(x){if(seen[x.key])return false;seen[x.key]=1;return true});
  return out.sort(numSort);
}
function has(c){return !!owned[c.key]}
function q(c){return owned[c.key]&&Number(owned[c.key].qty)||0}
function setQty(c,n){
  n=Math.max(0,Math.floor(Number(n)||0));
  if(!n)delete owned[c.key];
  else owned[c.key]={qty:n,game:c.game,name:c.name,number:c.number,setName:c.setName,setCode:c.setCode,updatedAt:new Date().toISOString()};
  saveOwned();render();
}
window.albumToggle=function(k){
  var c=S.cards.find(function(x){return x.key===k});if(!c)return;
  setQty(c,has(c)?0:1);
};
window.albumQty=function(k,d){
  var c=S.cards.find(function(x){return x.key===k});if(!c)return;
  setQty(c,q(c)+d);
};
function render(){
  if(!S.cards.length){$('cards').innerHTML='<div class="empty">Nessuna carta trovata.</div>';progress();return}
  var term=$('cardSearch').value.trim().toLowerCase();
  var list=S.cards.filter(function(c){
    var ok=S.filter==='all'||(S.filter==='owned'&&has(c))||(S.filter==='missing'&&!has(c));
    if(!ok)return false;
    return !term||[c.name,c.number,c.rarity].join(' ').toLowerCase().includes(term);
  });
  $('cards').innerHTML=list.length?list.map(function(c){
    var own=has(c),qty=q(c),price=c.price!=null?'<div class="meta">Prezzo fonte: '+esc(c.currency+Number(c.price).toFixed(2))+'</div>':'';
    return '<article class="card '+(own?'owned':'missing')+' '+(c.game==='ygo'?'ygo':'')+'">'+
      '<span class="badge">'+(own?'✓ CE L\'HO':'MANCA')+'</span>'+
      (c.image?'<img loading="lazy" src="'+esc(c.image)+'" alt="'+esc(c.name)+'">':'<div style="aspect-ratio:63/88;background:#0001;border-radius:8px"></div>')+
      '<div class="name">'+esc(c.name)+'</div>'+
      '<div class="meta">'+esc(c.number)+(c.rarity?' · '+esc(c.rarity):'')+'</div>'+price+
      '<button class="'+(own?'sec ':'')+'own-toggle" data-key="'+esc(c.key)+'">'+(own?'Rimuovi dalla collezione':'Segna come posseduta')+'</button>'+
      (own?'<div class="qty"><button class="sec qty-btn" data-key="'+esc(c.key)+'" data-d="-1">−</button><b>'+qty+'</b><button class="sec qty-btn" data-key="'+esc(c.key)+'" data-d="1">＋</button></div>':'')+
      '</article>';
  }).join(''):'<div class="empty">Nessuna carta corrisponde ai filtri.</div>';
  progress();
}
function progress(){
  var total=S.cards.length,got=S.cards.reduce(function(n,c){return n+(has(c)?1:0)},0),pct=total?Math.round(got*100/total):0;
  $('stats').textContent=got+' / '+total;
  $('pct').textContent=pct+'%';
  $('bar').style.width=pct+'%';
}
function exportCollection(){
  var payload={format:'grading-carte-collection',version:2,exportedAt:new Date().toISOString(),owned:owned};
  var blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  var a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='collezione-carte-'+new Date().toISOString().slice(0,10)+'.json';a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href)},1000);
}
async function importCollection(file){
  try{
    var data=JSON.parse(await file.text()),src=data&&data.owned;
    if(!src||typeof src!=='object'||Array.isArray(src))throw new Error('formato non riconosciuto');
    Object.keys(src).forEach(function(k){var v=src[k];if(v&&Number(v.qty)>0)owned[k]=v});
    saveOwned();render();$('status').textContent='Backup importato: '+Object.keys(src).length+' voci lette.';
  }catch(e){$('status').textContent='Importazione non riuscita: '+e.message}
}

$('game').addEventListener('change',function(){S.game=this.value;S.set=null;loadSets()});
$('setSearch').addEventListener('input',applySetSearch);
$('setSelect').addEventListener('change',loadCards);
$('cardSearch').addEventListener('input',render);
document.querySelectorAll('[data-filter]').forEach(function(b){b.addEventListener('click',function(){
  document.querySelectorAll('[data-filter]').forEach(function(x){x.classList.remove('active')});
  this.classList.add('active');S.filter=this.dataset.filter;render();
})});
$('cards').addEventListener('click',function(e){
  var b=e.target.closest('button');if(!b)return;
  var k=b.dataset.key;if(!k)return;
  if(b.classList.contains('own-toggle'))window.albumToggle(k);
  else if(b.classList.contains('qty-btn'))window.albumQty(k,Number(b.dataset.d)||0);
});
$('exportBtn').onclick=exportCollection;
$('importBtn').onclick=function(){$('importFile').click()};
$('importFile').onchange=function(){if(this.files&&this.files[0])importCollection(this.files[0]);this.value=''};
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw-card-cache.js').catch(function(){});
loadSets();
})();