(function(){
'use strict';

var $=function(id){return document.getElementById(id)};
var OWN_KEY='gradingCarte.collection.v2';
var SET_CACHE_KEY='gradingCarte.sets.v3.';
var SET_STATS_KEY='gradingCarte.setStats.v1';
var owned=loadOwned();
var setStats=loadSetStats();
var collator=new Intl.Collator('it',{numeric:true,sensitivity:'base'});
var S={game:'poke',sets:[],shownSets:[],set:null,cards:[],filter:'all',loadInfo:null};

function loadOwned(){
  try{
    var x=JSON.parse(localStorage.getItem(OWN_KEY)||'{}');
    return x&&typeof x==='object'&&!Array.isArray(x)?x:{};
  }catch(e){return {}}
}
function saveOwned(){
  try{localStorage.setItem(OWN_KEY,JSON.stringify(owned))}
  catch(e){alert('Non riesco a salvare la collezione: spazio locale esaurito. Esporta un backup e libera spazio nel browser.')}
}
function loadSetStats(){
  try{
    var x=JSON.parse(localStorage.getItem(SET_STATS_KEY)||'{}');
    return x&&typeof x==='object'&&!Array.isArray(x)?x:{};
  }catch(e){return {}}
}
function saveSetStats(){try{localStorage.setItem(SET_STATS_KEY,JSON.stringify(setStats))}catch(e){}}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms)})}
function n(v){var x=Number(v);return Number.isFinite(x)&&x>0?x:null}
function money(v,s){var x=n(v);return x==null?'—':s+x.toFixed(2)}
function keyForSet(game,id){return game+':'+id}
function sessionGet(k){try{return JSON.parse(sessionStorage.getItem(k)||'null')}catch(e){return null}}
function sessionPut(k,v){try{sessionStorage.setItem(k,JSON.stringify(v))}catch(e){}}
async function json(url,timeout){
  var ctl=new AbortController(),tm=setTimeout(function(){ctl.abort()},timeout||18000);
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

function pokePrices(c){
  var cm=c.cardmarket&&c.cardmarket.prices||null,tp=c.tcgplayer&&c.tcgplayer.prices||null;
  var cmRef=cm&&(n(cm.trendPrice)||n(cm.averageSellPrice)||n(cm.avg7));
  var tpRef=null,tpVariant='';
  if(tp){
    var pref=['normal','holofoil','reverseHolofoil','firstEditionNormal','firstEditionHolofoil','unlimited'];
    for(var i=0;i<pref.length&&!tpRef;i++){
      var p=tp[pref[i]];
      if(p&&n(p.market)){tpRef=n(p.market);tpVariant=pref[i]}
    }
    if(!tpRef){
      Object.keys(tp).some(function(k){var p=tp[k];if(p&&n(p.market)){tpRef=n(p.market);tpVariant=k;return true}return false});
    }
  }
  return {
    sortPrice:cmRef,
    displayPrice:cmRef||tpRef,
    currency:cmRef?'€':(tpRef?'$':''),
    priceSource:cmRef?'Cardmarket trend/average':(tpRef?'TCGplayer market '+tpVariant:''),
    cmRef:cmRef,tpRef:tpRef,tpVariant:tpVariant
  };
}
function normalizePoke(c,set){
  var p=pokePrices(c);
  return {
    key:'poke:'+c.id,game:'poke',id:c.id,name:c.name,number:c.number||'',rarity:c.rarity||'',
    image:c.images&&c.images.small||'',imageLarge:c.images&&c.images.large||'',
    setName:set.name,setCode:set.id,price:p.displayPrice,currency:p.currency,sortPrice:p.sortPrice,
    priceSource:p.priceSource,tcgplayer:c.tcgplayer||null,cardmarket:c.cardmarket||null
  };
}
function normalizeYgo(c,p){
  var setPrice=n(p.set_price),vp=c.card_prices&&c.card_prices[0]||{};
  return {
    key:'ygo:'+p.set_code+':'+c.id,game:'ygo',id:String(c.id),name:c.name,number:p.set_code||'',
    rarity:p.set_rarity||'',image:c.card_images&&c.card_images[0]&&c.card_images[0].image_url_small||'',
    imageLarge:c.card_images&&c.card_images[0]&&c.card_images[0].image_url||'',
    setName:p.set_name,setCode:p.set_code||'',price:setPrice,currency:'$',sortPrice:setPrice,
    priceSource:'YGOPRODeck set_price',vendorPrices:vp
  };
}

async function loadSets(){
  $('status').textContent='Carico le espansioni...';
  $('setSelect').innerHTML='<option>Caricamento...</option>';
  $('cards').innerHTML='';
  $('setPanel').style.display='none';
  S.set=null;S.cards=[];S.loadInfo=null;
  var cached=readSetCache(S.game);
  if(cached){
    S.sets=cached;applySetSearch();
    $('status').textContent='Espansioni caricate dalla cache locale.';
    return;
  }
  try{
    if(S.game==='poke'){
      var j=await json('https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate&pageSize=250');
      S.sets=(j.data||[]).map(function(x){
        return {id:x.id,name:x.name,series:x.series||'',code:x.ptcgoCode||x.id,date:x.releaseDate||'',printedTotal:Number(x.printedTotal)||0,total:Number(x.total)||Number(x.printedTotal)||0,logo:x.images&&x.images.logo||''};
      });
    }else{
      var y=await json('https://db.ygoprodeck.com/api/v7/cardsets.php');
      S.sets=(y||[]).map(function(x){
        return {id:x.set_code||x.set_name,name:x.set_name,series:'',code:x.set_code||'',date:x.tcg_date||'',printedTotal:Number(x.num_of_cards)||0,total:Number(x.num_of_cards)||0,logo:''};
      });
    }
    writeSetCache(S.game,S.sets);
    applySetSearch();
    $('status').textContent=S.sets.length+' espansioni disponibili.';
  }catch(e){
    $('status').textContent='Errore nel caricamento delle espansioni: '+(e.name==='AbortError'?'tempo scaduto':e.message)+'. Riprova più tardi.';
  }
}

function compareSets(a,b,mode){
  if(mode==='name')return collator.compare(a.name,b.name);
  if(mode==='code')return collator.compare(a.code||a.id,b.code||b.id);
  if(mode==='price'){
    var sa=setStats[keyForSet(S.game,a.id)],sb=setStats[keyForSet(S.game,b.id)];
    var va=sa&&n(sa.sum),vb=sb&&n(sb.sum);
    if(va==null&&vb==null)return collator.compare(a.name,b.name);
    if(va==null)return 1;if(vb==null)return -1;
    return va-vb;
  }
  return String(a.date||'').localeCompare(String(b.date||''))||collator.compare(a.name,b.name);
}
function applySetSearch(preserveId){
  var q=$('setSearch').value.trim().toLowerCase(),mode=$('setSort').value,dir=$('setDir').value==='desc'?-1:1;
  S.shownSets=S.sets.filter(function(x){
    return !q||x.name.toLowerCase().includes(q)||(x.series||'').toLowerCase().includes(q)||(x.code||'').toLowerCase().includes(q);
  }).sort(function(a,b){
    var base=compareSets(a,b,mode);
    if(mode==='price'){
      var sa=setStats[keyForSet(S.game,a.id)],sb=setStats[keyForSet(S.game,b.id)];
      var va=sa&&n(sa.sum),vb=sb&&n(sb.sum);
      if(va==null||vb==null)return base;
    }
    return base*dir;
  });
  $('setSelect').innerHTML='<option value="">Scegli espansione ('+S.shownSets.length+')</option>'+S.shownSets.map(function(x,i){
    var st=setStats[keyForSet(S.game,x.id)],pv=st&&n(st.sum)?' · '+st.currency+Number(st.sum).toFixed(0):'';
    var extra=(x.code?' · '+x.code:'')+(x.date?' · '+x.date:'')+pv;
    return '<option value="'+i+'" '+(preserveId===x.id?'selected':'')+'>'+esc(x.name+extra)+'</option>';
  }).join('');
}

function naturalNumber(a,b){return collator.compare(String(a.number||''),String(b.number||''))}
async function loadCards(){
  var idx=$('setSelect').value;
  if(idx==='')return;
  S.set=S.shownSets[Number(idx)];
  if(!S.set)return;
  $('setPanel').style.display='';
  $('setTitle').textContent=S.set.name;
  updateSetMeta();
  if(S.set.logo){$('setLogo').src=S.set.logo;$('setLogo').style.display=''}else $('setLogo').style.display='none';
  $('cards').innerHTML='<div class="empty">Carico tutte le carte dell’espansione...</div>';
  $('status').textContent='Caricamento completo di '+S.set.name+'...';
  try{
    var ck='albumcards:v4:'+S.game+':'+S.set.id;
    var cached=sessionGet(ck);
    if(cached&&Array.isArray(cached.cards)){
      S.cards=cached.cards;S.loadInfo=cached.info||null;
    }else{
      if(S.game==='poke')S.cards=await loadPokeCards(S.set);
      else S.cards=await loadYgoCards(S.set);
      sessionPut(ck,{cards:S.cards,info:S.loadInfo});
    }
    $('cardSearch').value='';
    updateSetStats();
    render();
    updateSetMeta();
    var expected=S.loadInfo&&S.loadInfo.expected||S.set.total||0;
    if(expected&&S.cards.length<expected){
      $('status').textContent='⚠ Caricate '+S.cards.length+' carte su '+expected+' dichiarate. La fonte gratuita non ne ha restituite altre; riproverò al prossimo caricamento.';
    }else{
      $('status').textContent=S.cards.length+' carte/stampe caricate per '+S.set.name+'.';
    }
  }catch(e){
    $('cards').innerHTML='<div class="empty">Non riesco a caricare questa espansione.</div>';
    $('status').textContent='Errore: '+(e.name==='AbortError'?'tempo scaduto':e.message)+'.';
  }
}
async function loadPokeCards(set){
  var all=[],seen={},page=1,expected=Number(set.total)||0,emptyPages=0,lastUnique=0;
  while(page<=50){
    var url='https://api.pokemontcg.io/v2/cards?q='+encodeURIComponent('set.id:'+set.id)+'&orderBy=number&pageSize=250&page='+page;
    var j=await json(url);
    var data=j.data||[];
    expected=Math.max(expected,Number(j.totalCount)||0);
    data.forEach(function(c){if(c&&c.id&&!seen[c.id]){seen[c.id]=1;all.push(c)}});
    $('status').textContent='Caricamento '+set.name+': '+all.length+(expected?' / '+expected:'')+'...';
    if(!data.length){emptyPages++;if(emptyPages>=1)break}else emptyPages=0;
    if(expected&&all.length>=expected)break;
    if(all.length===lastUnique&&page>1)break;
    lastUnique=all.length;
    page++;
  }
  S.loadInfo={expected:expected,pages:page,loaded:all.length};
  return all.map(function(c){return normalizePoke(c,set)}).sort(naturalNumber);
}
async function loadYgoCards(set){
  var all=[],url='https://db.ygoprodeck.com/api/v7/cardinfo.php?cardset='+encodeURIComponent(set.name)+'&num=100&offset=0',guard=0;
  while(url&&guard<50){
    var j=await json(url);all=all.concat(j.data||[]);
    $('status').textContent='Caricamento '+set.name+': '+all.length+(set.total?' / '+set.total:'')+'...';
    url=j.meta&&j.meta.next_page||'';guard++;if(url)await sleep(100);
  }
  var out=[];
  all.forEach(function(c){
    (c.card_sets||[]).filter(function(p){return p.set_name===set.name}).forEach(function(p){out.push(normalizeYgo(c,p))});
  });
  var seen={};out=out.filter(function(x){if(seen[x.key])return false;seen[x.key]=1;return true});
  S.loadInfo={expected:Number(set.total)||out.length,pages:guard,loaded:out.length};
  return out.sort(naturalNumber);
}

function has(c){return !!owned[c.key]}
function qty(c){return owned[c.key]&&Number(owned[c.key].qty)||0}
function setQty(c,v){
  v=Math.max(0,Math.floor(Number(v)||0));
  if(!v)delete owned[c.key];
  else owned[c.key]={qty:v,game:c.game,name:c.name,number:c.number,setName:c.setName,setCode:c.setCode,updatedAt:new Date().toISOString()};
  saveOwned();render();
  if(!$('detailBack').classList.contains('hidden'))showDetail(c.key);
}
window.albumToggle=function(k){var c=S.cards.find(function(x){return x.key===k});if(c)setQty(c,has(c)?0:1)};
window.albumQty=function(k,d){var c=S.cards.find(function(x){return x.key===k});if(c)setQty(c,qty(c)+d)};

function compareCards(a,b,mode){
  if(mode==='name')return collator.compare(a.name,b.name)||naturalNumber(a,b);
  if(mode==='price'){
    var pa=n(a.sortPrice),pb=n(b.sortPrice);
    if(pa==null&&pb==null)return naturalNumber(a,b);
    if(pa==null)return 1;if(pb==null)return -1;
    return pa-pb||naturalNumber(a,b);
  }
  return naturalNumber(a,b)||collator.compare(a.name,b.name);
}
function render(){
  if(!S.cards.length){$('cards').innerHTML='<div class="empty">Nessuna carta trovata.</div>';progress();return}
  var term=$('cardSearch').value.trim().toLowerCase(),mode=$('cardSort').value,desc=$('cardDir').value==='desc';
  var list=S.cards.filter(function(c){
    var ok=S.filter==='all'||(S.filter==='owned'&&has(c))||(S.filter==='missing'&&!has(c));
    if(!ok)return false;
    return !term||[c.name,c.number,c.rarity,c.setName].join(' ').toLowerCase().includes(term);
  }).sort(function(a,b){
    var v=compareCards(a,b,mode);
    if(mode==='price'&&(n(a.sortPrice)==null||n(b.sortPrice)==null))return v;
    return desc?-v:v;
  });
  $('cards').innerHTML=list.length?list.map(function(c){
    var own=has(c),q=qty(c),price=c.price!=null?'<div class="priceTag">'+esc(c.currency+Number(c.price).toFixed(2))+'</div><div class="meta">'+esc(c.priceSource||'Prezzo fonte')+'</div>':'<div class="meta">Prezzo non disponibile</div>';
    return '<article class="card '+(own?'owned':'missing')+' '+(c.game==='ygo'?'ygo':'')+'" data-card-key="'+esc(c.key)+'">'+
      '<span class="badge">'+(own?'✓ CE L\'HO':'MANCA')+'</span>'+
      (c.image?'<img loading="lazy" src="'+esc(c.image)+'" alt="'+esc(c.name)+'">':'<div style="aspect-ratio:63/88;background:#0001;border-radius:8px"></div>')+
      '<div class="name">'+esc(c.name)+'</div>'+
      '<div class="meta">'+esc(c.number)+(c.rarity?' · '+esc(c.rarity):'')+'</div>'+price+
      '<button class="'+(own?'sec ':'')+'own-toggle" data-key="'+esc(c.key)+'">'+(own?'Rimuovi dalla collezione':'Segna come posseduta')+'</button>'+
      (own?'<div class="qty"><button class="sec qty-btn" data-key="'+esc(c.key)+'" data-d="-1">−</button><b>'+q+'</b><button class="sec qty-btn" data-key="'+esc(c.key)+'" data-d="1">＋</button></div>':'')+
      '</article>';
  }).join(''):'<div class="empty">Nessuna carta corrisponde ai filtri.</div>';
  progress();
}
function progress(){
  var total=S.cards.length,got=S.cards.reduce(function(x,c){return x+(has(c)?1:0)},0),pct=total?Math.round(got*100/total):0;
  $('stats').textContent=got+' / '+total;
  $('pct').textContent=pct+'%';
  $('bar').style.width=pct+'%';
}
function updateSetStats(){
  if(!S.set||!S.cards.length)return;
  var vals=S.cards.map(function(c){return n(c.sortPrice)}).filter(Boolean);
  var sum=vals.reduce(function(a,b){return a+b},0);
  setStats[keyForSet(S.game,S.set.id)]={
    sum:sum,priced:vals.length,total:S.cards.length,currency:S.game==='poke'?'€':'$',at:new Date().toISOString()
  };
  saveSetStats();
}
function updateSetMeta(){
  if(!S.set)return;
  var parts=[S.game==='poke'?S.set.series:S.set.code,S.set.date,S.set.total?S.set.total+' carte dichiarate':''].filter(Boolean);
  var st=setStats[keyForSet(S.game,S.set.id)];
  if(st&&n(st.sum))parts.push('valore catalogo noto '+st.currency+Number(st.sum).toFixed(2)+' ('+st.priced+'/'+st.total+' con prezzo)');
  $('setMeta').textContent=parts.join(' · ');
}

function detailPokemon(c){
  var cm=c.cardmarket&&c.cardmarket.prices||{},tp=c.tcgplayer&&c.tcgplayer.prices||{};
  var cmRows=[
    ['Low',cm.lowPrice],['EX+',cm.lowPriceExPlus],['Media vendite',cm.averageSellPrice],['Trend',cm.trendPrice],['Media 1g',cm.avg1],['Media 7g',cm.avg7],['Media 30g',cm.avg30],
    ['Reverse low',cm.reverseHoloLow],['Reverse vendite',cm.reverseHoloSell],['Reverse trend',cm.reverseHoloTrend]
  ].filter(function(x){return n(x[1])}).map(function(x){return '<tr><td>'+esc(x[0])+'</td><td><b>'+money(x[1],'€')+'</b></td></tr>'}).join('');
  var tpRows=[];
  Object.keys(tp).forEach(function(k){
    var p=tp[k]||{};
    if(n(p.market)||n(p.low)||n(p.mid)||n(p.high)){
      tpRows.push('<tr><td><b>'+esc(k)+'</b></td><td>'+money(p.low,'$')+'</td><td>'+money(p.mid,'$')+'</td><td><b>'+money(p.market,'$')+'</b></td><td>'+money(p.high,'$')+'</td></tr>');
    }
  });
  return (cmRows?'<h3>Cardmarket · EUR</h3><table><tr><th>Dato</th><th>Valore</th></tr>'+cmRows+'</table>':'')+
    (tpRows.length?'<h3>TCGplayer · USD</h3><table><tr><th>Variante</th><th>Low</th><th>Mid</th><th>Market</th><th>High</th></tr>'+tpRows.join('')+'</table>':'')+
    ((!cmRows&&!tpRows.length)?'<div class="note">Nessun valore disponibile dalle fonti per questa carta.</div>':'');
}
function detailYgo(c){
  var vp=c.vendorPrices||{},rows=[
    ['Prezzo stampa / set',c.price,'$'],['Cardmarket',vp.cardmarket_price,'€'],['TCGplayer',vp.tcgplayer_price,'$'],['eBay',vp.ebay_price,'$'],['Amazon',vp.amazon_price,'$'],['CoolStuffInc',vp.coolstuffinc_price,'$']
  ].filter(function(x){return n(x[1])}).map(function(x){return '<tr><td>'+esc(x[0])+'</td><td><b>'+money(x[1],x[2])+'</b></td></tr>'}).join('');
  return rows?'<h3>Valori disponibili</h3><table><tr><th>Fonte</th><th>Valore</th></tr>'+rows+'</table>':'<div class="note">Nessun valore disponibile dalle fonti per questa stampa.</div>';
}
function showDetail(k){
  var c=S.cards.find(function(x){return x.key===k});if(!c)return;
  var own=has(c),q=qty(c);
  $('detail').innerHTML='<button class="sec close" data-close-detail>✕</button>'+
    '<div class="detailTop">'+
      '<img src="'+esc(c.imageLarge||c.image)+'" alt="'+esc(c.name)+'">'+
      '<div><h2>'+esc(c.name)+'</h2><div class="note">'+esc(c.setName)+' · '+esc(c.number)+(c.rarity?' · '+esc(c.rarity):'')+'</div>'+
      '<div style="margin-top:8px"><b>'+ (own?'✓ Nella tua collezione':'Non ancora nella tua collezione') +'</b>'+(own?' · quantità '+q:'')+'</div>'+
      (c.price!=null?'<div class="priceTag" style="font-size:1.1rem">'+esc(c.currency+Number(c.price).toFixed(2))+'</div><div class="note">'+esc(c.priceSource||'Prezzo fonte')+'</div>':'')+
      '<div class="detailActions"><button data-detail-toggle="'+esc(c.key)+'">'+(own?'Rimuovi dalla collezione':'＋ Aggiungi alla collezione')+'</button>'+
      (own?'<button class="sec" data-detail-qty="'+esc(c.key)+'" data-d="-1">− 1</button><button class="sec" data-detail-qty="'+esc(c.key)+'" data-d="1">＋ 1</button>':'')+'</div></div>'+
    '</div>'+
    (c.game==='poke'?detailPokemon(c):detailYgo(c))+
    '<div class="note" style="margin-top:10px">I valori sono quelli restituiti dalle fonti gratuite disponibili; non vengono inventati né convertiti tra valute.</div>';
  $('detailBack').classList.remove('hidden');
}
function closeDetail(){$('detailBack').classList.add('hidden')}

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
$('setSearch').addEventListener('input',function(){applySetSearch()});
$('setSort').addEventListener('change',function(){applySetSearch(S.set&&S.set.id)});
$('setDir').addEventListener('change',function(){applySetSearch(S.set&&S.set.id)});
$('setSelect').addEventListener('change',loadCards);
$('cardSearch').addEventListener('input',render);
$('cardSort').addEventListener('change',render);
$('cardDir').addEventListener('change',render);
document.querySelectorAll('[data-filter]').forEach(function(b){b.addEventListener('click',function(){
  document.querySelectorAll('[data-filter]').forEach(function(x){x.classList.remove('active')});
  this.classList.add('active');S.filter=this.dataset.filter;render();
})});
$('cards').addEventListener('click',function(e){
  var b=e.target.closest('button');
  if(b){
    var k=b.dataset.key;if(!k)return;
    if(b.classList.contains('own-toggle'))window.albumToggle(k);
    else if(b.classList.contains('qty-btn'))window.albumQty(k,Number(b.dataset.d)||0);
    return;
  }
  var card=e.target.closest('[data-card-key]');if(card)showDetail(card.dataset.cardKey);
});
$('detailBack').addEventListener('click',function(e){
  if(e.target===$('detailBack')||e.target.closest('[data-close-detail]')){closeDetail();return}
  var t=e.target.closest('[data-detail-toggle]');
  if(t){window.albumToggle(t.dataset.detailToggle);return}
  var qbtn=e.target.closest('[data-detail-qty]');
  if(qbtn){window.albumQty(qbtn.dataset.detailQty,Number(qbtn.dataset.d)||0)}
});
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDetail()});
$('exportBtn').onclick=exportCollection;
$('importBtn').onclick=function(){$('importFile').click()};
$('importFile').onchange=function(){if(this.files&&this.files[0])importCollection(this.files[0]);this.value=''};
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw-card-cache.js').catch(function(){});
loadSets();
})();