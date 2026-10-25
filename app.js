(() => {
  'use strict';
  // V1/V2と同じDB名・ストア名を使用。旧データは表示時に正規化し、編集/保存/バックアップ取込時にV3へ移行する。
  const DB_NAME = 'yokan-techo-db', DB_VERSION = 1, STORE = 'records';
  const PROFILE = [
    ['sweetness','甘さ','控えめ','強い'],['aroma','豆・素材の香り','穏やか','強い'],
    ['richness','濃厚さ','軽い','濃密'],['firmness','かたさ','やわらかい','しっかり'],
    ['smoothness','なめらかさ','粒感あり','なめらか'],['finishLength','余韻','短い','長い']
  ];
  const QUALITY = [
    ['ingredientFlavor','素材の風味','好みでない','とても良い','素材の風味'],
    ['sweetBalance','甘味のバランス','合わない','とても良い','甘味バランス'],
    ['texture','舌触り・食感','好みでない','とても好み','食感'],
    ['aftertaste','後味','好みでない','とても良い','後味'],
    ['repeat','また食べたい','低い','ぜひ','また食べたい'],
    ['overall','総合評価','低い','高い','総合評価']
  ];
  const $ = id => document.getElementById(id);
  const main = $('main'), productDialog = $('productDialog'), tasteDialog = $('tasteDialog'), detailDialog = $('detailDialog');
  const state = {records:[], tab:'techo', future:'wishlist', query:'', sort:'new', photos:[], tastePhotos:[], activeId:null, rankScope:'all', analysisScope:'all', prefThreshold:8, compareScopes:{}};
  const esc = (s='') => String(s ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  const num = value => { if(value === '' || value === null || value === undefined) return null; const n=Number(value); return Number.isFinite(n) && n>=1 && n<=10 ? n : null; };
  const avg = values => {const ns=values.filter(n=>n!==null && Number.isFinite(n));return ns.length ? ns.reduce((a,b)=>a+b,0)/ns.length : null;};
  const fmt = n => n===null || n===undefined ? '—' : Number(n).toFixed(1);
  const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const today = () => { const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);};
  const fmtDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s||'') ? s.replaceAll('-','/') : '日付なし';
  const http = v => {try {const url=new URL(v);return ['http:','https:'].includes(url.protocol) ? url.href : '';} catch {return '';} };
  const safePhotos = arr => Array.isArray(arr) ? arr.filter(p=> typeof p==='string' && /^data:image\/(?:jpeg|png|webp);base64,[\w+/=]+$/i.test(p)).slice(0,3) : [];
  const cleanText = (v,max=3000) => String(v??'').slice(0,max);
  // 製法・素材・食感の3軸に、伝統的な仕立て名を補助タグとして保持する。
  const TAX_OPTIONS = {
    materials:['小豆','白小豆','白いんげん豆','栗','柿','黒糖','抹茶','さつまいも','その他の豆'],
    textures:['なめらか','粒感','もちもち','シャリシャリ','ぷるぷる','しっとり','ほくほく','歯切れ良い'],
    styles:['本煉','小倉','小城羊羹','玉羊羹']
  };
  const TAX_LABELS = {method:'製法',materials:'素材・風味',textures:'食感・仕上げ',styles:'仕立て・呼び名'};
  const TAX_KEYS = ['materials','textures','styles'];
  const splitTags = value => (Array.isArray(value)?value:typeof value==='string'?value.split(/[、,，・／/;；\n]+/):[])
    .map(s=>cleanText(s,40).trim()).filter(Boolean).filter((s,i,arr)=>arr.indexOf(s)===i).slice(0,25);
  const validMethod = x => ['練羊羹','水羊羹','蒸羊羹','芋羊羹','その他'].includes(x) ? x : 'その他';
  function taxonomyFromRecord(r){
    if(r.taxonomy && typeof r.taxonomy==='object'){
      return {method:validMethod(r.taxonomy.method||r.yokanType||'練羊羹'),
        ...Object.fromEntries(TAX_KEYS.map(k=>[k,splitTags(r.taxonomy[k])]))};
    }
    const type=String(r.yokanType||'練羊羹');
    const legacyTags=splitTags(r.flavorTags);
    const materials=legacyTags.filter(t=>!['小倉','本煉','小城羊羹'].includes(t));
    const textures=[];const styles=[];
    if(type==='小城羊羹'){textures.push('シャリシャリ');styles.push('小城羊羹');}
    if(type==='小倉羊羹')styles.push('小倉');
    if(type==='本煉' || type==='本練')styles.push('本煉');
    if(legacyTags.includes('小倉'))styles.push('小倉');
    if(legacyTags.includes('本煉')||legacyTags.includes('本練'))styles.push('本煉');
    return {method:validMethod(['小城羊羹','小倉羊羹','本煉','本練'].includes(type)?'練羊羹':type),materials,textures,styles};
  }
  function hasCategory(record,scope){
    if(scope==='all')return true;
    const i=scope.indexOf(':');if(i<1)return false;
    const axis=scope.slice(0,i),tag=scope.slice(i+1),t=record.taxonomy||taxonomyFromRecord(record);
    return axis==='method'?t.method===tag:TAX_KEYS.includes(axis)&&t[axis].includes(tag);
  }
  function groupList(records=allTasted()){
    const candidates=new Set();
    for(const r of records){const t=r.taxonomy||taxonomyFromRecord(r);
      candidates.add('method:'+t.method);
      for(const axis of TAX_KEYS)for(const tag of t[axis])candidates.add(axis+':'+tag);
    }
    return [...candidates].sort((a,b)=>{
      const order=x=>['method','materials','textures','styles'].indexOf(x.split(':')[0]);
      return order(a)-order(b) || a.localeCompare(b,'ja');
    }).map(value=>({value,label:categoryLabel(value)}));
  }
  function categoryLabel(scope){if(scope==='all')return '全商品平均';const i=scope.indexOf(':');return `${TAX_LABELS[scope.slice(0,i)]||'分類'}：${scope.slice(i+1)}`;}
  function tagsMarkup(axis){return `<fieldset class="tag-field"><legend>${esc(TAX_LABELS[axis])}（複数選択可）</legend><div class="tag-options">${TAX_OPTIONS[axis].map(v=>`<label class="tag-option"><input type="checkbox" data-tax-axis="${axis}" value="${esc(v)}"><span>${esc(v)}</span></label>`).join('')}</div><label class="field extra-tag"><span>その他（「、」区切りで追加）</span><input type="text" data-tax-extra="${axis}" placeholder="自由に追加できます"></label></fieldset>`;}
  function setTaxonomyEditor(tax){const t=tax||{materials:[],textures:[],styles:[]};
    for(const axis of TAX_KEYS){
      document.querySelectorAll(`input[data-tax-axis="${axis}"]`).forEach(input=>{input.checked=(t[axis]||[]).includes(input.value);});
      const known=new Set(TAX_OPTIONS[axis]);
      document.querySelector(`[data-tax-extra="${axis}"]`).value=(t[axis]||[]).filter(s=>!known.has(s)).join('、');
    }
  }
  function readTaxonomyEditor(){const tax={method:$('yokanType').value};
    for(const axis of TAX_KEYS){const selected=[...document.querySelectorAll(`input[data-tax-axis="${axis}"]:checked`)].map(el=>el.value);
      tax[axis]=splitTags([...selected,...splitTags(document.querySelector(`[data-tax-extra="${axis}"]`).value)]);
    }return tax;
  }
  const validStatus = v => ['wishlist','stock','tasted'].includes(v);
  const orderSessions = record => [...record.sessions].sort((a,b)=>(b.tastedDate||'').localeCompare(a.tastedDate||'') || (b.createdAt||'').localeCompare(a.createdAt||''));
  const latest = r => orderSessions(r)[0] || null;
  const productPhoto = r => r.photos?.[0] || latest(r)?.photos?.[0] || '';
  let dbPromise = null;
  function openDB(){
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE)){const s=db.createObjectStore(STORE,{keyPath:'id'});s.createIndex('tastedDate','tastedDate');s.createIndex('shopName','shopName');s.createIndex('yokanType','yokanType');}};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error);
    });return dbPromise;
  }
  async function getAll(){const db=await openDB();return new Promise((resolve,reject)=>{const req=db.transaction(STORE,'readonly').objectStore(STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}
  async function putMany(records){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');for(const r of records)tx.objectStore(STORE).put(r);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('transaction aborted'));});}
  async function drop(key){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
  function normalizedSession(raw, fallbackId){
    const r=raw&&typeof raw==='object'?raw:{};
    return {
      id:cleanText(r.id||fallbackId,150),tastedDate:cleanText(r.tastedDate||'',10),amount:cleanText(r.amount||'',80),
      servingTemp:cleanText(r.servingTemp||'常温',40),sliceThickness:cleanText(r.sliceThickness||'標準',40),pairing:cleanText(r.pairing||'',300),
      comment:cleanText(r.comment||'',3000),visualNote:cleanText(r.visualNote||'',1000),
      quality:Object.fromEntries(QUALITY.map(([k])=>[k,num(r.quality?.[k])])),
      profile:Object.fromEntries(PROFILE.map(([k])=>[k,num(r.profile?.[k])])),
      photos:safePhotos(r.photos),createdAt:cleanText(r.createdAt||'',40)
    };
  }
  function normalizeRecord(raw){
    if(!raw || typeof raw!=='object' || !raw.id || !raw.productName || !raw.shopName) throw Error('invalid record');
    const r={...raw};
    const hadSessions=Array.isArray(r.sessions);
    let sessions=hadSessions?r.sessions.map((s,i)=>normalizedSession(s,`session-${r.id}-${i}`)):[];
    // 古いバックアップの直下 quality/profile/tastedDate/amount は最初の実食履歴へ。
    if(!hadSessions && (r.quality || r.profile || r.tastedDate)) sessions=[normalizedSession({
      id:`legacy-${r.id}`,tastedDate:r.tastedDate,amount:r.amount,servingTemp:r.servingTemp,
      sliceThickness:r.sliceThickness,pairing:r.pairing,comment:r.comment,visualNote:r.visualNote,
      quality:r.quality,profile:r.profile,photos:[],createdAt:r.createdAt
    },`legacy-${r.id}`)];
    return {
      ...r,id:cleanText(r.id,150),productName:cleanText(r.productName,120),shopName:cleanText(r.shopName,120),
      yokanType:cleanText(r.yokanType||'練羊羹',40),flavorTags:cleanText(r.flavorTags||'',150),
      taxonomy:taxonomyFromRecord(r),includeInPreference:r.includeInPreference!==false,
      url:http(r.url||r.productUrl||''),purchasePlace:cleanText(r.purchasePlace||'',200),
      purchaseDate:cleanText(r.purchaseDate||'',10),bestBefore:cleanText(r.bestBefore||'',10),
      memo:cleanText(r.memo||r.productMemo||'',1200),photos:safePhotos(r.photos),sessions,
      status:sessions.length?'tasted':(['stock','wishlist'].includes(r.status)?r.status:'stock'),
      generalEvaluation:r.generalEvaluation||null
    };
  }
  async function reload(){state.records=(await getAll()).map(r=>{try{return normalizeRecord(r);}catch(e){console.warn('Record skipped',e);return null;}}).filter(Boolean);}
  const get = rid => state.records.find(r=>r.id===rid);
  function toast(message){document.querySelector('.toast')?.remove();const node=document.createElement('div');node.className='toast';node.textContent=message;document.body.append(node);setTimeout(()=>node.remove(),2800);}
  const show = modal => {if(!modal.open)modal.showModal();};
  const close = modal => {if(modal.open)modal.close();};
  function gallery(src){return src ? `<img class="product-photo" src="${esc(src)}" alt="商品写真">` : '<div class="product-photo placeholder">ようかん</div>';}
  function empty(message){return `<div class="empty-state"><img src="./icon-180.png" alt=""><h2>${esc(message)}</h2><p>右上の「＋ 記録」から登録できます。</p></div>`;}
  function card(r,insideFuture=false){const s=latest(r);return `<button type="button" class="product-card" data-open="${esc(r.id)}">${gallery(productPhoto(r))}<div class="product-body"><h2 class="product-name">${esc(r.productName)}</h2><p class="product-shop">${esc(r.shopName)}</p><p class="product-meta">${esc(r.taxonomy.method)}${s?` · ${fmtDate(s.tastedDate)} · ${r.sessions.length}回` : insideFuture?` · ${r.status==='stock'?'購入済み':'未購入'}`:''}</p></div></button>`;}
  function renderTecho(){
    const rec=state.records.filter(r=>r.status==='tasted');
    let shown=rec.filter(r=>`${r.productName} ${r.shopName} ${r.flavorTags} ${r.memo}`.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));
    shown.sort((a,b)=>state.sort==='score'?((num(latest(b)?.quality.overall)||0)-(num(latest(a)?.quality.overall)||0)):(latest(b)?.tastedDate||'').localeCompare(latest(a)?.tastedDate||''));
    main.innerHTML=`<section class="mini-stat"><strong>${rec.length}</strong><span>種類の羊羹を記録しました<br>2回目以降も同じ商品へ追加できます</span></section>
      <h2 class="section-title">ようかん手帖</h2><p class="lead">写真と商品名から、食べたときの記憶をたどる。</p>
      <div class="toolbar"><input id="searchBox" type="search" placeholder="商品名・お店を検索" value="${esc(state.query)}"><select id="sortBox" aria-label="表示順"><option value="new" ${state.sort==='new'?'selected':''}>最近食べた順</option><option value="score" ${state.sort==='score'?'selected':''}>最近の高評価順</option></select></div>
      ${shown.length?`<div class="list">${shown.map(r=>card(r)).join('')}</div>`:empty(rec.length?'該当する記録がありません':'最初の羊羹を記録しましょう')}`;
    $('searchBox').addEventListener('input',e=>{state.query=e.target.value;main.querySelectorAll('[data-open]').forEach(node=>{const r=get(node.dataset.open);node.classList.toggle('hidden',!`${r.productName} ${r.shopName} ${r.flavorTags} ${r.memo}`.toLocaleLowerCase().includes(state.query.toLocaleLowerCase()));});});
    $('sortBox').addEventListener('change',e=>{state.sort=e.target.value;renderTecho();});
  }
  function renderFuture(){
    const wish=state.records.filter(r=>r.status==='wishlist').length,stock=state.records.filter(r=>r.status==='stock').length;
    const arr=state.records.filter(r=>r.status===state.future).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||''));
    main.innerHTML=`<h2 class="section-title">これからの羊羹</h2><p class="lead">食べたい気持ちも、買っておいた楽しみも、一緒に記録。</p>
      <div class="future-filter"><button type="button" data-future="wishlist" class="${state.future==='wishlist'?'active':''}">食べたいリスト (${wish})</button><button type="button" data-future="stock" class="${state.future==='stock'?'active':''}">ストック (${stock})</button></div>
      ${arr.length?`<div class="list">${arr.map(r=>`<div class="future-card">${card(r,true)}<div class="action-row"><button type="button" class="secondary-btn small-btn" data-edit="${esc(r.id)}">編集する</button>${r.status==='wishlist'?`<button type="button" class="primary-btn small-btn" data-stock="${esc(r.id)}">購入した → ストックへ</button>`:`<button type="button" class="primary-btn small-btn" data-eat="${esc(r.id)}">食べた → 評価する</button>`}</div></div>`).join('')}</div>`:empty(state.future==='wishlist'?'食べたい羊羹はまだありません':'ストックはまだありません')}`;
  }
  function allTasted(){return state.records.filter(r=>r.sessions.length && r.status==='tasted');}
  // 各商品内でセッション平均→各商品を等重み。欠損は平均の分母に含めない。
  function meanScores(products,fields){const scores={};
    for(const [key] of fields)scores[key]=avg(products.map(r=>avg(r.sessions.map(s=>num(s[fields===QUALITY?'quality':'profile']?.[key])))));
    return scores;
  }
  function historical(scope='all'){
    const products=allTasted().filter(r=>hasCategory(r,scope));
    return {scores:meanScores(products,QUALITY),products:products.length,tastings:products.reduce((n,r)=>n+r.sessions.length,0)};
  }
  function productOverall(r){return avg(r.sessions.map(s=>num(s.quality?.overall)));}
  function preferenceProducts(){return allTasted().filter(r=>r.includeInPreference!==false && productOverall(r)!==null && productOverall(r)>=state.prefThreshold);}
  function renderAnalysis(){
    const hist=historical();
    const products=allTasted();
    const ranked=products.filter(r=>productOverall(r)!==null && hasCategory(r,state.rankScope)).sort((a,b)=>productOverall(b)-productOverall(a) || a.productName.localeCompare(b.productName,'ja'));
    const preferred=preferenceProducts(), prefScores=meanScores(preferred,PROFILE);
    const groupChoices=groupList();
    const rankScopes=[{value:'all',label:'総合（全商品）'},...groupChoices];
    if(!rankScopes.some(o=>o.value===state.rankScope))state.rankScope='all';
    if(!rankScopes.some(o=>o.value===state.analysisScope))state.analysisScope='all';
    const categoryHist=historical(state.analysisScope);
    const excluded=products.filter(r=>r.includeInPreference===false).length;
    main.innerHTML=`<h2 class="section-title">わたしの好み</h2><p class="lead">${hist.products}商品・実食${hist.tastings}回。平均とランキングは、1商品を1票として扱います。</p>
      <section class="guide-card"><h3>全商品平均（個人評価）</h3><p class="helper">変わり種も含む、これまで食べた全商品を等しい重みで集計します。</p>
        <div class="stat-grid">${QUALITY.map(([k,label])=>`<div class="stat-row"><span>${esc(label)}</span><div class="stat-meter"><i style="width:${(hist.scores[k]||0)*10}%"></i></div><strong>${fmt(hist.scores[k])}</strong></div>`).join('')}</div></section>
      <section class="guide-card"><h3>分類ごとの個人評価平均</h3>
        <label class="field"><span>どの種類で平均を出す？</span><select id="analysisScope">${rankScopes.map(o=>`<option value="${esc(o.value)}" ${o.value===state.analysisScope?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>
        <p class="sample-note">${categoryHist.products}商品・実食${categoryHist.tastings}回。${categoryHist.products<3?'サンプルが3商品未満のため参考程度に見てください。':'1商品ずつ等しい重みで集計。'}</p>
        <div class="stat-grid">${QUALITY.map(([k,label])=>`<div class="stat-row"><span>${esc(label)}</span><div class="stat-meter"><i style="width:${(categoryHist.scores[k]||0)*10}%"></i></div><strong>${fmt(categoryHist.scores[k])}</strong></div>`).join('')}</div></section>
      <section class="guide-card"><h3>自分が好きな味わい</h3>
        <p class="helper">高評価をつけた羊羹の「甘さ・香り・濃厚さ」などの特徴を集計。食べた全商品の単純平均とは別です。</p>
        <label class="field compact-field"><span>高評価とする基準</span><select id="prefThreshold"><option value="7" ${state.prefThreshold===7?'selected':''}>総合7点以上</option><option value="8" ${state.prefThreshold===8?'selected':''}>総合8点以上</option><option value="9" ${state.prefThreshold===9?'selected':''}>総合9点以上</option></select></label>
        <p class="sample-note">該当 ${preferred.length}商品 ／ 好み分析から除外 ${excluded}商品。${preferred.length<3?'3商品未満のため傾向は不安定です。':'高評価群の傾向であり、因果関係を示すものではありません。'}</p>
        ${preferred.length?`<div class="stat-grid">${PROFILE.map(([k,label])=>`<div class="stat-row"><span>${esc(label)}</span><div class="stat-meter"><i style="width:${(prefScores[k]||0)*10}%"></i></div><strong>${fmt(prefScores[k])}</strong></div>`).join('')}</div>`:'<p class="lead">条件に合う羊羹はまだありません。</p>'}
        <p class="helper">変わり種などをこの分析に含めたくない場合は、商品の「商品情報を編集」で切り替えられます。全商品平均・ランキングには引き続き含まれます。</p>
      </section>
      <section class="guide-card"><h3>羊羹ランキング</h3>
        <label class="field"><span>総合または種類別ランキング</span><select id="rankingScope">${rankScopes.map(o=>`<option value="${esc(o.value)}" ${o.value===state.rankScope?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>
        <p class="sample-note">${ranked.length}商品 ／ ${esc(categoryLabel(state.rankScope))}。同点は同順位とし、実食回数も表示。</p>
        ${ranked.length?`<ol class="ranking-list">${ranked.map((r,i)=>{const score=productOverall(r);const rank=ranked.filter(x=>productOverall(x)>score).length+1;return `<li><span class="rank-number">${rank}位</span><button class="plain-btn" data-open="${esc(r.id)}">${esc(r.productName)}<small>${esc(r.shopName)}</small></button><span class="rank-score">${fmt(score)}<small>${r.sessions.length}回</small></span></li>`;}).join('')}</ol>`:'<p class="lead">この分類に採点済みの羊羹はありません。</p>'}
      </section>
      <section class="guide-card"><h3>集計について</h3><p>総合ランキングでは種類を問わず比較し、種類別では「製法・素材・食感・仕立て」のいずれでも絞れます。複数の分類に所属する羊羹も1商品として数えます。各商品の複数回の実食は先に平均するため、食べた回数の多さで順位が有利になりません。</p><p>種類別のサンプルが1〜2商品なら比較結果は参考程度です。ランキングは「個人的な好み」であり、客観的な品質ランキングではありません。</p></section>`;
    $('prefThreshold').addEventListener('change',e=>{state.prefThreshold=Number(e.target.value);renderAnalysis();});
    $('analysisScope').addEventListener('change',e=>{state.analysisScope=e.target.value;renderAnalysis();});
    $('rankingScope').addEventListener('change',e=>{state.rankScope=e.target.value;renderAnalysis();});
  }
  function renderGuide(){main.innerHTML=`<h2 class="section-title">使い方</h2><p class="lead">食べたいものから、何度も味わった一本まで。</p>
    <section class="guide-card"><h3>記録の流れ</h3><p>「これからの羊羹」では未購入を食べたいリストに、購入済みをストックに保存。購入したらストックに、食べたら個人評価を登録して手帖へ移動します。すでに食べた商品は「もう一度食べた」から2回目・3回目を追加できます。</p></section>
    <section class="guide-card"><h3>分類のしくみ</h3><p>「製法」は練・蒸・水などから1つ選択。「素材・風味」と「食感・仕上げ」は複数選択できます。「本煉」「小倉」「小城羊羹」は補助の「仕立て・呼び名」に登録できます。</p><p>例：小城羊羹は「練羊羹 ＋ シャリシャリ ＋ 小城羊羹」。製法が同じものとも、シャリシャリ系だけでも比べられます。以前の記録は可能な範囲で自動分類し、いつでも編集可能です。</p></section>
    <section class="guide-card"><h3>平均とランキング</h3><p>レーダーチャートの比較対象を「全商品平均」「同じ製法」「同じ素材」「同じ食感」などから切り替えられます。「好み」タブでは総合ランキングと種類別ランキングの切り替えもできます。</p><p>平均は商品ごとに実食回数の平均を計算してから、商品単位で等重み平均します。好みのプロファイル分析は、指定した高評価商品だけが対象です。変わり種を好み分析から除外しても、全商品平均とランキングには残ります。</p></section>
    <section class="guide-card"><h3>評価の使い分け</h3><p>甘さ・濃厚さ・かたさなどのプロファイルは強さを記録するもの。素材の風味・甘味のバランス・食感・後味・また食べたい・総合評価は好みの10段階評価です。</p><p>公開情報からの参考評価（AIによる推定）は別の系列として表示します。</p></section>
    <section class="guide-card"><h3>一般的な評価を取り込む</h3><p>記録の詳細で「評価依頼をコピー」→ ChatGPTへ貼り付け → 返ってきたJSONを詳細に貼り付けて取り込みます。根拠の確認できない項目は空欄のままとし、推測で埋めません。</p><button class="secondary-btn" id="blankPrompt">空欄テンプレートをコピー</button></section>
    <section class="guide-card"><h3>バックアップ・移行</h3><p>写真を含むJSONを保存できます。旧バージョンのバックアップ（v1/v2/v3）の records をそのまま取り込めます。重複IDは既存の実食履歴を保持して統合します。機種変更前には必ず書き出してください。</p><div class="action-row"><button id="export" class="secondary-btn">JSONバックアップを書き出す</button><label class="photo-picker">JSONを取り込む<input type="file" id="import" accept=".json,application/json"></label></div><p class="helper">ブラウザ内のデータはサイトデータ消去などで失われます。自動クラウド同期ではありません。</p></section>`;
    $('blankPrompt').addEventListener('click',()=>copyPrompt(null));$('export').addEventListener('click',exportBackup);$('import').addEventListener('change',e=>{if(e.target.files?.[0])importBackup(e.target.files[0]);});
  }
  function render(){document.querySelectorAll('.tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===state.tab));if(state.tab==='future')renderFuture();else if(state.tab==='analysis')renderAnalysis();else if(state.tab==='guide')renderGuide();else renderTecho();}
  function nav(tab){state.tab=tab;render();window.scrollTo(0,0);}

  function preview(where,photos){$(where).innerHTML=photos.map((p,i)=>`<div class="photo-chip"><img src="${esc(p)}" alt="写真 ${i+1}"><button type="button" data-remove-photo="${i}" aria-label="写真を削除">×</button></div>`).join('');}
  async function compress(file){
    if(!file.type.startsWith('image/'))throw Error('Unsupported type');
    const uri=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    const image=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=uri;});
    const ratio=Math.min(1,1280/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.80);
  }
  async function photosInput(files,group){const dest=group==='product'?state.photos:state.tastePhotos;const remaining=3-dest.length;if(remaining<=0){toast('写真は最大3枚です');return;}for(const f of [...files].slice(0,remaining)){try{dest.push(await compress(f));}catch(e){console.warn(e);toast('写真を読み込めませんでした');}}preview(group==='product'?'productPhotoPreview':'tastePhotoPreview',dest);}
  function productEditor(record=null,desired='tasted'){
    close(detailDialog);$('productForm').reset();$('productId').value=record?.id||'';
    $('productHeading').textContent=record?'商品情報を編集':'新しい羊羹を登録';
    $('productName').value=record?.productName||'';$('shopName').value=record?.shopName||'';
    $('yokanType').value=record?.taxonomy?.method||'練羊羹';setTaxonomyEditor(record?.taxonomy);
    $('includePreference').checked=record?.includeInPreference!==false;
    $('productUrl').value=record?.url||'';$('purchasePlace').value=record?.purchasePlace||'';
    $('purchaseDate').value=record?.purchaseDate||'';$('bestBefore').value=record?.bestBefore||'';$('productMemo').value=record?.memo||'';
    $('productStatus').value=record?.status||desired;$('productStatus').disabled=Boolean(record?.sessions.length);
    $('productStatus').title=record?.sessions.length?'実食履歴がある商品は手帖に残します':'';
    $('deleteProduct').classList.toggle('hidden',!record);
    state.photos=[...(record?.photos||[])];preview('productPhotoPreview',state.photos);
    show(productDialog);
  }
  async function saveProduct(e){
    e.preventDefault();if(!$('productForm').reportValidity())return;
    const current=get($('productId').value),chosen=$('productStatus').value;
    const needsTaste=chosen==='tasted'&&!current?.sessions.length;
    const rec=normalizeRecord({
      ...(current||{}),id:current?.id||id(),productName:$('productName').value.trim(),shopName:$('shopName').value.trim(),
      yokanType:$('yokanType').value,flavorTags:readTaxonomyEditor().materials.join('、'),
      taxonomy:readTaxonomyEditor(),includeInPreference:$('includePreference').checked,url:$('productUrl').value.trim(),
      purchasePlace:$('purchasePlace').value.trim(),purchaseDate:$('purchaseDate').value,bestBefore:$('bestBefore').value,
      memo:$('productMemo').value.trim(),photos:state.photos,sessions:current?.sessions||[],status:needsTaste?'stock':chosen,
      createdAt:current?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()
    });
    try{await putMany([rec]);await reload();close(productDialog);if(needsTaste)tasteEditor(get(rec.id));else{nav(rec.status==='tasted'?'techo':'future');if(rec.status==='stock')state.future='stock';else if(rec.status==='wishlist')state.future='wishlist';render();toast('保存しました');}}catch(err){console.error(err);toast('保存できませんでした');}
  }
  function sliderMarkup(fields,group){return fields.map(([key,label,low,high])=>`<div class="rating-row"><div class="rating-top"><span class="rating-title">${esc(label)}</span><strong class="rating-number" id="value-${group}-${key}">5</strong></div><div class="range-caption"><span>${esc(low)}</span><span>${esc(high)}</span></div><div class="rating-controls"><button type="button" class="step-btn" data-step="-1" data-group="${group}" data-key="${key}" aria-label="${esc(label)}を1下げる">−</button><input type="range" min="1" max="10" step="1" value="5" data-group="${group}" data-key="${key}" aria-label="${esc(label)}"><button type="button" class="step-btn" data-step="1" data-group="${group}" data-key="${key}" aria-label="${esc(label)}を1上げる">＋</button></div></div>`).join('');}
  function updateRange(input){const g=input.dataset.group,k=input.dataset.key;$(`value-${g}-${k}`).textContent=input.value;input.style.setProperty('--progress',`${(Number(input.value)-1)/9*100}%`);}
  function setRanges(group,fields,data){fields.forEach(([k])=>{const input=tasteDialog.querySelector(`input[type="range"][data-group="${group}"][data-key="${k}"]`);input.value=num(data?.[k])||5;updateRange(input);});}
  function readRanges(group,fields){return Object.fromEntries(fields.map(([k])=>[k,Number(tasteDialog.querySelector(`input[type="range"][data-group="${group}"][data-key="${k}"]`).value)]));}
  function tasteEditor(record,session=null){
    close(detailDialog);$('tasteForm').reset();$('tasteProductId').value=record.id;$('tasteId').value=session?.id||'';
    $('tasteHeading').textContent=session?'実食記録を編集':`${record.productName} を食べた記録`;
    $('tasteSaveButton').textContent=session?'変更を保存する':'この回を保存する';
    $('tastedDate').value=session?.tastedDate||today();$('amount').value=session?.amount||'';
    $('servingTemp').value=session?.servingTemp||'常温';$('sliceThickness').value=session?.sliceThickness||'標準';$('pairing').value=session?.pairing||'';
    $('comment').value=session?.comment||'';$('visualNote').value=session?.visualNote||'';
    state.tastePhotos=[...(session?.photos||[])];preview('tastePhotoPreview',state.tastePhotos);
    setRanges('profile',PROFILE,session?.profile);setRanges('quality',QUALITY,session?.quality);
    $('deleteTaste').classList.toggle('hidden',!session);
    show(tasteDialog);
  }
  async function saveTaste(e){
    e.preventDefault();if(!$('tasteForm').reportValidity())return;
    const rec=get($('tasteProductId').value);if(!rec)return;
    const previous=rec.sessions.find(s=>s.id===$('tasteId').value);
    const s=normalizedSession({id:previous?.id||id(),tastedDate:$('tastedDate').value,amount:$('amount').value.trim(),
      servingTemp:$('servingTemp').value,sliceThickness:$('sliceThickness').value,pairing:$('pairing').value.trim(),
      profile:readRanges('profile',PROFILE),quality:readRanges('quality',QUALITY),
      comment:$('comment').value.trim(),visualNote:$('visualNote').value.trim(),photos:state.tastePhotos,
      createdAt:previous?.createdAt||new Date().toISOString()
    },previous?.id||id());
    const sessions=previous?rec.sessions.map(x=>x.id===previous.id?s:x):[...rec.sessions,s];
    try{await putMany([{...rec,sessions,status:'tasted',updatedAt:new Date().toISOString()}]);await reload();close(tasteDialog);nav('techo');openDetail(rec.id);toast(previous?'評価を更新しました':'実食を追加しました');}catch(err){console.error(err);toast('保存できませんでした');}
  }
  async function deleteTaste(){const rec=get($('tasteProductId').value),sid=$('tasteId').value;if(!rec||!sid)return;if(!confirm('この回の記録を削除しますか？ 他の実食履歴は残ります。'))return;const sessions=rec.sessions.filter(s=>s.id!==sid);try{await putMany([{...rec,sessions,status:sessions.length?'tasted':'stock',updatedAt:new Date().toISOString()}]);await reload();close(tasteDialog);nav(sessions.length?'techo':'future');if(sessions.length)openDetail(rec.id);toast('この回を削除しました');}catch(e){toast('削除できませんでした');}}
  async function deleteProduct(){const rec=get($('productId').value);if(!rec)return;if(!confirm(`「${rec.productName}」と実食履歴${rec.sessions.length}回を完全に削除しますか？`))return;try{await drop(rec.id);await reload();close(productDialog);render();toast('削除しました');}catch(e){toast('削除できませんでした');}}
  function radarPoint(index,value,radius=107){const angle=-Math.PI/2+2*Math.PI*index/6,dist=radius*(value/10);return [180+Math.cos(angle)*dist,170+Math.sin(angle)*dist];}
  function polygon(scores){return QUALITY.map(([key],i)=>radarPoint(i,num(scores?.[key])||0).map(n=>n.toFixed(1)).join(',')).join(' ');}
  function complete(scores){return QUALITY.every(([key])=>num(scores?.[key])!==null);}
  function radarSvg(personal,hist,general){
    const labelPositions=[[180,24,'middle'],[324,85,'end'],[324,266,'end'],[180,322,'middle'],[36,266,'start'],[36,85,'start']];
    return `<svg class="radar-svg" viewBox="0 0 360 346" aria-label="個人評価・これまでの平均のレーダーチャート" role="img">
      ${[2,4,6,8,10].map(level=>`<polygon class="radar-grid" points="${polygon(Object.fromEntries(QUALITY.map(([k])=>[k,level])))}"></polygon>`).join('')}
      ${QUALITY.map((field,i)=>{const [x,y]=radarPoint(i,10);return `<line class="radar-axis" x1="180" y1="170" x2="${x}" y2="${y}"></line>`;}).join('')}
      ${complete(hist.scores)?`<polygon class="radar-poly average" points="${polygon(hist.scores)}"></polygon>`:''}
      ${complete(personal)?`<polygon class="radar-poly personal" points="${polygon(personal)}"></polygon>`:''}
      ${complete(general)?`<polygon class="radar-poly general" points="${polygon(general)}"></polygon>`:''}
      ${QUALITY.map((field,i)=>{const label=field[1],short=field[4];const [x,y,a]=labelPositions[i];return `<text class="radar-label" x="${x}" y="${y}" text-anchor="${a}">${esc(short||label)}</text>`;}).join('')}
    </svg>`;
  }
  // QUALITYは [key, label, low, high, short] の配列。
  function renderScoreTable(personal,hist,general){return `<table class="compare-table"><thead><tr><th>項目</th><th>今回</th><th>比較平均</th>${general?'<th>参考評価</th>':''}</tr></thead><tbody>${QUALITY.map(([key,label])=>`<tr><td>${esc(label)}</td><td>${fmt(num(personal?.[key]))}</td><td>${fmt(hist.scores[key])}</td>${general?`<td>${fmt(num(general[key]))}</td>`:''}</tr>`).join('')}</tbody></table>`;}
  function profileMarkup(profile){return PROFILE.map(([key,label])=>{const score=num(profile?.[key]);return `<div class="profile-row"><span>${esc(label)}</span><span class="profile-track"><i style="width:${score?score*10:0}%"></i></span><span>${score||'—'}</span></div>`;}).join('');}
  function photoStrip(list){return list?.length?`<div class="photo-strip">${list.map(p=>`<img src="${esc(p)}" alt="記録した写真">`).join('')}</div>`:'';}
  function detailItem(label,value,link=false){return `<div class="meta-item"><span>${esc(label)}</span><div>${link && value?`<a href="${esc(value)}" target="_blank" rel="noopener noreferrer">公式・商品ページを開く</a>`:esc(value||'—')}</div></div>`;}
  function generalBlock(r){const ge=r.generalEvaluation;if(!ge)return `<p class="source-note">公開情報からの参考評価は未登録です。必要な場合は「評価依頼をコピー」から取得できます。</p>`;
    const sources=Array.isArray(ge.sources)?ge.sources:[];
    return `<p class="source-note">以下はChatGPTが公開情報を調べて算出した参考値です。実測・世論調査の平均とは異なります。<br>確度：${esc(ge.confidence||'不明')} ${ge.assessedAt?`／調査日：${esc(ge.assessedAt)}`:''}</p>
      ${ge.summary?`<p class="comment-block">${esc(ge.summary)}</p>`:''}${ge.evidenceSummary?`<p class="source-note">根拠：${esc(ge.evidenceSummary)}</p>`:''}
      ${sources.length?`<div class="source-links">${sources.map(s=>{const link=http(s.url);return link?`<div><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(s.label||link)}</a>${s.publishedAt?`（${esc(s.publishedAt)}）`:''}</div>`:'';}).join('')}</div>`:''}`;
  }
  function compareOptions(record){const t=record.taxonomy||taxonomyFromRecord(record);
    const choices=[{value:'all',label:'全商品平均'},{value:'method:'+t.method,label:categoryLabel('method:'+t.method)}];
    for(const axis of TAX_KEYS)for(const tag of t[axis])choices.push({value:axis+':'+tag,label:categoryLabel(axis+':'+tag)});
    return choices;
  }
  function comparisonMarkup(record,scope){
    const s=latest(record),hist=historical(scope),general=record.generalEvaluation?.scores||null;
    return `${radarSvg(s?.quality||{},hist,general)}<div class="legend"><span><i></i>この商品の直近</span><span><i class="avg"></i>${esc(scope==='all'?'全商品平均':'同分類平均')}</span>${general?'<span><i class="general"></i>公開情報の参考評価</span>':''}</div>
      <p class="chart-caption">${esc(categoryLabel(scope))}：${hist.products}商品・実食${hist.tastings}回。各商品内で平均した後、商品間で等重み平均します。現在の商品を含みます。${hist.products<3?'商品数が少ないため平均値は参考程度です。':''}</p>
      ${renderScoreTable(s?.quality||{},hist,general)}${general&&!complete(general)?'<p class="source-note">参考評価に未採点項目があるため、参考評価の多角形は描画していません。</p>':''}`;
  }
  function openDetail(rid){
    const r=get(rid);if(!r)return;state.activeId=r.id;const isTasted=r.sessions.length>0,s=latest(r);
    const options=compareOptions(r);let scope=state.compareScopes[r.id]||options.find(o=>o.value.startsWith('method:'))?.value||'all';
    if(!options.some(o=>o.value===scope))scope='all';
    const actions=isTasted?`<button class="primary-btn small-btn" data-action="edit-latest">最新の評価を編集</button><button class="secondary-btn small-btn" data-action="taste">＋ もう一度食べた</button>`:r.status==='stock'?`<button class="primary-btn small-btn" data-action="taste">食べたので評価する</button>`:`<button class="primary-btn small-btn" data-action="stock">購入した → ストックへ</button>`;
    const allSessions=orderSessions(r);
    $('detailContent').innerHTML=`
      <header class="sheet-head"><div><span class="small-overline">YOKAN DETAIL</span><h2>${esc(r.productName)}</h2><p class="detail-shop">${esc(r.shopName)}</p></div><button class="plain-btn" data-action="close">閉じる</button></header>
      <div class="detail-heading">${productPhoto(r)?`<img class="detail-image" src="${esc(productPhoto(r))}" alt="商品写真">`:''}<div class="action-row"><button class="secondary-btn small-btn" data-action="edit">商品情報を編集</button>${actions}</div>${isTasted?`<p class="sample-note">好み分析：${r.includeInPreference===false?'対象外':'対象'}　<button type="button" class="inline-action" data-action="toggle-preference">${r.includeInPreference===false?'好みの分析に含める':'好みの分析から除外する'}</button></p>`:''}</div>
      <section class="detail-section"><h3>商品情報</h3><div class="meta-grid">${detailItem('製法',r.taxonomy.method)}${detailItem('素材・風味',r.taxonomy.materials.join('、'))}${detailItem('食感・仕上げ',r.taxonomy.textures.join('、'))}${detailItem('仕立て・呼び名',r.taxonomy.styles.join('、'))}${detailItem('購入・入手先',r.purchasePlace)}${detailItem('購入日',fmtDate(r.purchaseDate))}${detailItem('賞味期限',fmtDate(r.bestBefore))}${detailItem('商品URL',r.url,true)}</div>${r.memo?`<p class="comment-block">${esc(r.memo)}</p>`:''}${photoStrip(r.photos)}</section>
      ${isTasted?`
      <section class="detail-section plot-block"><div class="evaluation-heading"><h3>個人的な評価</h3><button type="button" class="secondary-btn small-btn" data-action="edit-latest">評価を編集する</button></div><p class="helper">直近の採点を、全商品平均またはこの商品の分類別平均と比較します。</p>
        <label class="field compact-field"><span>レーダーチャートの比較対象</span><select id="compareScope">${options.map(o=>`<option value="${esc(o.value)}" ${scope===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>
        <div id="comparisonPanel">${comparisonMarkup(r,scope)}</div>${generalBlock(r)}</section>
      <section class="detail-section"><h3>食べた記録 <small>（${r.sessions.length}回）</small></h3>
        ${allSessions.map((sess,i)=>`<article class="session-card"><h4>${fmtDate(sess.tastedDate)}　${i===0?'<span class="pill">最新</span>':''}</h4><div class="session-score">総合評価 ${fmt(num(sess.quality?.overall))} / 10</div><p>量：${esc(sess.amount||'未記録')} ／ 合わせたもの：${esc(sess.pairing||'なし')}</p><p>${esc(sess.servingTemp)} ／ ${esc(sess.sliceThickness)}</p>${sess.comment?`<div class="comment-block">${esc(sess.comment)}</div>`:''}${sess.visualNote?`<p>見た目：${esc(sess.visualNote)}</p>`:''}${photoStrip(sess.photos)}<div class="action-row"><button class="secondary-btn small-btn" data-session="${esc(sess.id)}">この回を編集</button></div></article>`).join('')}</section>
      <section class="detail-section"><h3>直近の味わい</h3><p class="helper">良し悪しでなく特徴の強さを記録</p>${profileMarkup(s.profile)}</section>
      `:`<section class="detail-section"><p class="lead">${r.status==='stock'?'購入済み。食べたら評価を追加して手帖へ移せます。':'気になっている羊羹。購入したらストックに移せます。'}</p></section>`}
      <section class="detail-section"><h3>公開情報からの参考評価</h3><p class="helper">評価依頼の文章をコピーしてChatGPTで調査し、返ってきたJSONをこの商品に取り込めます。</p>
        <button class="secondary-btn" data-action="copy">評価依頼をコピー</button>
        <details class="import-box"><summary>JSONを貼って取り込む</summary><p class="source-note">この商品の店名・商品名が一致するかも確認します。</p><label class="field">ChatGPTの回答<textarea id="generalJSON" rows="9" placeholder='{"schemaVersion":1,"productName":"..."}'></textarea></label><div class="action-row"><button class="primary-btn" data-action="import-general">この商品に取り込む</button>${r.generalEvaluation?'<button class="danger-btn" data-action="delete-general">参考評価を削除</button>':''}</div></details></section>`;
    show(detailDialog);
    $('compareScope')?.addEventListener('change',e=>{
      state.compareScopes[r.id]=e.target.value;
      $('comparisonPanel').innerHTML=comparisonMarkup(get(r.id),e.target.value);
    });
  }
  function normalizeGeneral(raw,r){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('JSONの形式が違います');
    const ge=raw.generalEvaluation||raw;
    const scores=ge.scores;
    if(!scores||typeof scores!=='object')throw Error('scores がありません');
    if(raw.productName&&cleanName(raw.productName)!==cleanName(r.productName))throw Error('商品名が登録と一致しません');
    if(raw.shopName&&cleanName(raw.shopName)!==cleanName(r.shopName))throw Error('店名が登録と一致しません');
    const cleanScores=Object.fromEntries(QUALITY.map(([key])=>[key,num(scores[key])]));
    if(!Object.values(cleanScores).some(v=>v!==null))throw Error('有効な点数がありません');
    return {schemaVersion:1,scores:cleanScores,summary:cleanText(ge.summary,500),evidenceSummary:cleanText(ge.evidenceSummary,1800),
      confidence:['low','medium','high'].includes(ge.confidence)?ge.confidence:'unverified',
      assessedAt:cleanText(ge.assessedAt||raw.assessedAt||'',40),sources:(Array.isArray(ge.sources)?ge.sources:[]).slice(0,8).map(s=>({label:cleanText(s?.label||'出典',120),url:http(s?.url||''),publishedAt:cleanText(s?.publishedAt||'',40)})).filter(s=>s.url),importedAt:new Date().toISOString()};
  }
  function cleanName(value){return String(value||'').normalize('NFKC').replace(/[\s　]/g,'').toLocaleLowerCase('ja');}
  function stripFence(str){return String(str||'').trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i,'$1').trim();}
  function promptFor(r){return `次の商品を、実在する公式の商品情報と公開レビューに基づいて慎重に調査してください。可能ならWeb検索を実行し、情報の日付・出典を確認してください。\n商品名：${r?.productName||'（商品名を入力）'}\n和菓子屋：${r?.shopName||'（店名を入力）'}\n\n目的：個人の好みの評価と比較するため、「公開情報から推定した参考評価」を項目ごとに記録する。公開情報からの推定値は実測の消費者平均値ではありません。\n\n絶対条件：\n- 公式商品ページの事実と、実際に確認できた口コミの傾向と、AI自身の解釈を分けること。\n- 同一商品の特定が不十分・レビューが少ない・ある項目の根拠がない場合は、数字を捏造せず null とする。根拠が薄いから5点に置くことも禁止。\n- レビューの母数がわかればevidenceSummaryに明記する。数値は1〜10の整数かnullのみ。\n- 総合評価は他の項目の機械的平均ではなく、総合的なレビュー傾向を確認できる場合のみ推定する。\n- 公式仕様を根拠に食感や再購入意向を断定しない。\n- 確認したURLと公開年月日を記載。直接確認できない出典は入れない。\n- 必ずJSONオブジェクトのみ返却（コードフェンス・前置きは不要）。\n\nスキーマ：\n{\n "schemaVersion":1,\n "productName":"${r?.productName||'商品名'}",\n "shopName":"${r?.shopName||'店名'}",\n "generalEvaluation":{\n   "scores":{"ingredientFlavor":null,"sweetBalance":null,"texture":null,"aftertaste":null,"repeat":null,"overall":null},\n   "summary":"特徴と口コミ傾向（100字程度）",\n   "evidenceSummary":"何が一次情報か、レビュー母数・確認できた記述・推定の限界",\n   "confidence":"low",\n   "assessedAt":"調査年月日 YYYY-MM-DD",\n   "sources":[{"label":"確認できた一次情報","url":"https://example.com","publishedAt":"YYYY-MM-DD または日付不明"}]\n }\n}\n\n使用可能な scores のキーは上記6個。確度は low / medium / high のいずれか。根拠不十分の場合は null を残す。調査不能ですべてnullになる場合はJSONではなく調査不能と報告してよい。`;}
  async function copyPrompt(record){const text=promptFor(record);try{if(navigator.clipboard && window.isSecureContext){await navigator.clipboard.writeText(text);}else{const ta=document.createElement('textarea');ta.value=text;document.body.appendChild(ta);ta.select();if(!document.execCommand('copy'))throw Error('copy unsupported');ta.remove();}toast('評価依頼をコピーしました');}catch(e){console.error(e);toast('コピーできませんでした');}}
  async function importGeneral(){const r=get(state.activeId);if(!r)return;try{const payload=JSON.parse(stripFence($('generalJSON').value));const ge=normalizeGeneral(payload,r);await putMany([{...r,generalEvaluation:ge,updatedAt:new Date().toISOString()}]);await reload();openDetail(r.id);toast('参考評価を取り込みました');}catch(e){alert(`取り込みできません：${e.message}`);}}
  async function actionStock(rid){const r=get(rid);if(!r)return;try{await putMany([{...r,status:'stock',updatedAt:new Date().toISOString()}]);await reload();close(detailDialog);state.future='stock';nav('future');toast('ストックに移しました');}catch(e){toast('保存できませんでした');}}
  function mergeRecord(old,r){
    if(!old)return r;
    const sessions=new Map(r.sessions.map(s=>[s.id,s]));for(const s of old.sessions)sessions.set(s.id,s);
    const result={...r,...old,sessions:[...sessions.values()]};
    for(const field of ['url','purchasePlace','purchaseDate','bestBefore','memo','flavorTags','photos','generalEvaluation']){
      if(!result[field] || (Array.isArray(result[field])&&!result[field].length))result[field]=r[field];
    }
    if(result.sessions.length)result.status='tasted';else if(old.status==='stock'||r.status==='stock')result.status='stock';else result.status='wishlist';
    return normalizeRecord(result);
  }
  function exportBackup(){const payload={app:'ようかん手帖',version:4,schemaVersion:4,exportedAt:new Date().toISOString(),records:state.records};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`yokan-techo-backup-${today()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);toast('バックアップを書き出しました');}
  async function importBackup(file){try{
    const data=JSON.parse(await file.text());if(!data||!Array.isArray(data.records))throw Error('records 配列がありません');
    const incoming=data.records.map(normalizeRecord);
    if(!confirm(`${incoming.length}商品のバックアップを取り込みます。既存商品とIDが同じ場合、実食履歴を消さずに統合します。よろしいですか？`))return;
    const existing=new Map(state.records.map(r=>[r.id,r]));
    const merged=incoming.map(r=>mergeRecord(existing.get(r.id),r));
    await putMany(merged);await reload();nav('techo');toast(`${incoming.length}商品を取り込みました`);
  }catch(e){console.error(e);alert(`バックアップを取り込めませんでした：${e.message}`);}}
  function handleMainClick(e){
    const btn=e.target.closest('button');if(!btn)return;
    const rid=btn.dataset.open||btn.dataset.edit||btn.dataset.stock||btn.dataset.eat;
    if(btn.dataset.future){state.future=btn.dataset.future;renderFuture();}
    else if(btn.dataset.open)openDetail(rid);
    else if(btn.dataset.edit)productEditor(get(rid));
    else if(btn.dataset.stock)actionStock(rid);
    else if(btn.dataset.eat)tasteEditor(get(rid));
  }
  function handleDetailClick(e){const btn=e.target.closest('button');if(!btn)return;const rid=state.activeId,r=get(rid);if(!r)return;
    if(btn.dataset.session){const s=r.sessions.find(s=>s.id===btn.dataset.session);if(s)tasteEditor(r,s);return;}
    switch(btn.dataset.action){
      case 'close':close(detailDialog);break;
      case 'edit':productEditor(r);break;
      case 'edit-latest':{const session=latest(r);if(session) tasteEditor(r,session);break;}
      case 'taste':tasteEditor(r);break;
      case 'stock':actionStock(rid);break;
      case 'toggle-preference':putMany([{...r,includeInPreference:r.includeInPreference===false,updatedAt:new Date().toISOString()}]).then(reload).then(()=>openDetail(rid)).then(()=>toast('好み分析の対象を更新しました')).catch(e=>{console.error(e);toast('更新できませんでした');});break;
      case 'copy':copyPrompt(r);break;
      case 'import-general':importGeneral();break;
      case 'delete-general':if(confirm('参考評価を削除しますか？'))putMany([{...r,generalEvaluation:null}]).then(reload).then(()=>openDetail(rid));break;
    }
  }
  // iOS Safari: 入力中に視覚ビューポートがキーボードで縮小する場合、
  // エディターだけ高さを合わせる。手動ピンチズームは制限しない。
  // focus/resizeの直後はキーボードアニメーション中のため短く再確認する。
  function setupKeyboardViewport(){
    const editors=[productDialog,tasteDialog];
    const vv=window.visualViewport;
    if(!vv) return;
    let focusScrollTimer;
    let rafId=0;
    let baselineHeight=Math.max(window.innerHeight,vv.height);
    const isTextInput = node => node?.matches?.('input:not([type="range"]):not([type="checkbox"]):not([type="file"]):not([type="hidden"]),textarea,select');
    const activeEditor = () => editors.find(d=>d.open && d.contains(document.activeElement));
    const keepVisible = () => {
      const modal=activeEditor(), target=document.activeElement;
      if(!modal||!isTextInput(target))return;
      const modalBounds=modal.getBoundingClientRect();
      const targetBounds=target.getBoundingClientRect();
      // 不要なスクロールを避けるため、入力欄がキーボードに隠れた時だけ動かす。
      if(targetBounds.bottom>modalBounds.bottom-24 || targetBounds.top<modalBounds.top+64){
        target.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});
      }
    };
    const update=()=>{
      rafId=0;
      if(!activeEditor()) baselineHeight=Math.max(window.innerHeight,vv.height);
      for(const modal of editors){
        if(!modal.open) {modal.style.removeProperty('--editor-view-height');continue;}
        const focused=isTextInput(document.activeElement) && modal.contains(document.activeElement);
        // Safariではキーボード表示で visualViewport.height が小さくなる。
        // 通常時や手動ズーム中は標準の100dvhを維持する。
        const keyboardOpen=focused && vv.scale<=1.03 && vv.height < baselineHeight-110;
        if(keyboardOpen) modal.style.setProperty('--editor-view-height',`${Math.max(260,Math.floor(vv.height))}px`);
        else modal.style.removeProperty('--editor-view-height');
      }
    };
    const schedule=()=>{
      if(rafId) cancelAnimationFrame(rafId);
      rafId=requestAnimationFrame(update);
      if(activeEditor()){
        clearTimeout(focusScrollTimer);
        focusScrollTimer=setTimeout(()=>{update();keepVisible();},180);
      }
    };
    vv.addEventListener('resize',schedule);
    // iOSでSafariのツールバーが動く場合も同じ方法で追従。
    window.addEventListener('resize',schedule);
    editors.forEach(modal=>{
      modal.addEventListener('focusin',event=>{
        if(!isTextInput(event.target))return;
        schedule();
      });
      modal.addEventListener('focusout',()=>{
        clearTimeout(focusScrollTimer);
        setTimeout(schedule,60);
      });
      modal.addEventListener('close',()=>{
        modal.style.removeProperty('--editor-view-height');
        clearTimeout(focusScrollTimer);
      });
    });
  }
  function bind(){
    setupKeyboardViewport();
    $('addBtn').addEventListener('click',()=>productEditor(null,state.tab==='future'?state.future:'tasted'));
    document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.tab)));
    main.addEventListener('click',handleMainClick);$('detailContent').addEventListener('click',handleDetailClick);
    $('productClose').addEventListener('click',()=>close(productDialog));$('tasteClose').addEventListener('click',()=>close(tasteDialog));
    $('productForm').addEventListener('submit',saveProduct);$('tasteForm').addEventListener('submit',saveTaste);
    $('deleteProduct').addEventListener('click',deleteProduct);$('deleteTaste').addEventListener('click',deleteTaste);
    $('taxonomySelectors').innerHTML=TAX_KEYS.map(tagsMarkup).join('');
    $('profileSliders').innerHTML=sliderMarkup(PROFILE,'profile');$('qualitySliders').innerHTML=sliderMarkup(QUALITY,'quality');
    tasteDialog.addEventListener('input',e=>{if(e.target.matches('input[type="range"]'))updateRange(e.target);});
    tasteDialog.addEventListener('click',e=>{const b=e.target.closest('button[data-step]');if(!b)return;const input=tasteDialog.querySelector(`input[type="range"][data-group="${b.dataset.group}"][data-key="${b.dataset.key}"]`);input.value=Math.max(1,Math.min(10,Number(input.value)+Number(b.dataset.step)));updateRange(input);});
    $('productPhotos').addEventListener('change',e=>{photosInput(e.target.files,'product');e.target.value='';});$('tastePhotos').addEventListener('change',e=>{photosInput(e.target.files,'taste');e.target.value='';});
    $('productPhotoPreview').addEventListener('click',e=>{const b=e.target.closest('[data-remove-photo]');if(b){state.photos.splice(Number(b.dataset.removePhoto),1);preview('productPhotoPreview',state.photos);}});
    $('tastePhotoPreview').addEventListener('click',e=>{const b=e.target.closest('[data-remove-photo]');if(b){state.tastePhotos.splice(Number(b.dataset.removePhoto),1);preview('tastePhotoPreview',state.tastePhotos);}});
    [detailDialog,productDialog,tasteDialog].forEach(modal=>modal.addEventListener('click',e=>{if(e.target===modal)close(modal);}));
  }
  async function init(){bind();try{await reload();render();}catch(e){console.error(e);main.innerHTML='<p>保存領域に接続できません。通常のブラウザで開いてください。</p>';return;}
    if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){navigator.serviceWorker.register('./sw.js').catch(console.warn);}
  }
  init();
})();
