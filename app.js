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
      url:http(r.url||r.productUrl||''),manufacturerName:cleanText(r.manufacturerName||'',120),ingredients:splitTags(r.ingredients),purchasePlace:cleanText(r.purchasePlace||'',200),
      purchaseDate:cleanText(r.purchaseDate||'',10),bestBefore:cleanText(r.bestBefore||'',10),
      memo:cleanText(r.memo||r.productMemo||'',1200),photos:safePhotos(r.photos),sessions,
      status:sessions.length?'tasted':(['stock','wishlist'].includes(r.status)?r.status:'stock'),
      generalEvaluation:r.generalEvaluation||null
    };
  }
  async function reload(){state.records=(await getAll()).map(r=>{try{return normalizeRecord(r);}catch(e){console.warn('Record skipped',e);return null;}}).filter(Boolean);}
  const get = rid => state.records.find(r=>r.id===rid);
  function toast(message){document.querySelector('.toast')?.remove();const node=document.createElement('div');node.className='toast';node.textContent=message;document.body.append(node);setTimeout(()=>node.remove(),2800);}
  // 入力フォームはiOS Safariのキーボード/VisualViewport競合を避けるため、
  // 全画面モーダルではなく通常のスクロール可能なページとして開く。
  const isEditor = modal => modal===productDialog || modal===tasteDialog;
  let editorDirty = false;
  function markEditorDirty(event){
    if((productDialog.open && productDialog.contains(event.target)) || (tasteDialog.open && tasteDialog.contains(event.target))) editorDirty=true;
  }
  const show = modal => {
    if(modal.open)return;
    if(isEditor(modal)){
      document.body.classList.add('editor-page-open');
      modal.show(); // 非モーダル: 本文として表示し、スクロールは文書に任せる
      window.scrollTo(0,0);
    } else modal.showModal();
  };
  const close = (modal, force=false) => {
    if(!modal.open)return false;
    if(isEditor(modal) && editorDirty && !force){
      if(!confirm('入力途中の内容が保存されていません。保存せずに閉じますか？'))return false;
    }
    if(isEditor(modal))editorDirty=false;
    modal.close();
    if(isEditor(modal) && !productDialog.open && !tasteDialog.open){
      document.body.classList.remove('editor-page-open');
      window.scrollTo(0,0);
    }
    return true;
  };
  function gallery(src){return src ? `<img class="product-photo" src="${esc(src)}" alt="商品写真" loading="lazy" decoding="async">` : '<div class="product-photo placeholder">ようかん</div>';}
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
    const rankingPositions=new Map();
    let previousRankScore=null, currentRank=0;
    ranked.forEach((r,i)=>{const score=productOverall(r);if(score!==previousRankScore)currentRank=i+1;previousRankScore=score;rankingPositions.set(r.id,currentRank);});
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
        ${ranked.length?`<ol class="ranking-list">${ranked.map((r,i)=>{const score=productOverall(r);const rank=rankingPositions.get(r.id);return `<li><span class="rank-number">${rank}位</span><button class="plain-btn" data-open="${esc(r.id)}">${esc(r.productName)}<small>${esc(r.shopName)}</small></button><span class="rank-score">${fmt(score)}<small>${r.sessions.length}回</small></span></li>`;}).join('')}</ol>`:'<p class="lead">この分類に採点済みの羊羹はありません。</p>'}
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
    <section class="guide-card"><h3>評価の使い分け</h3><p>甘さ・濃厚さ・かたさなどのプロファイルは強さを記録するもの。素材の風味・甘味のバランス・食感・後味・また食べたい・総合評価は好みの10段階評価です。</p><p>公式情報とレビュー傾向は数値化せず、確認できた出典・情報の限界を含めた調査メモとして表示します。</p></section>
    <section class="guide-card"><h3>公式情報とレビュー傾向を取り込む</h3><p>商品詳細の「調査依頼をコピー」から、JSONを使わない見出し付き調査文を生成します。ChatGPTの回答をそのまま取り込めます。旧版のJSONも引き続き利用できます。数値評価は行いません。</p><button class="secondary-btn" id="blankPrompt">空欄テンプレートをコピー</button></section>
    <section class="guide-card"><h3>バックアップ・移行</h3><p>写真を含むJSONを保存できます。旧バージョンのバックアップ（v1/v2/v3）の records をそのまま取り込めます。重複IDは既存の実食履歴を保持して統合します。機種変更前には必ず書き出してください。</p><div class="action-row"><button id="export" class="secondary-btn">JSONバックアップを書き出す</button><label class="photo-picker">JSONを取り込む<input type="file" id="import" accept=".json,application/json"></label></div><p class="helper">ブラウザ内のデータはサイトデータ消去などで失われます。自動クラウド同期ではありません。</p></section>`;
    $('blankPrompt').addEventListener('click',e=>copyPrompt(null,e.currentTarget));$('export').addEventListener('click',exportBackup);$('import').addEventListener('change',e=>{if(e.target.files?.[0])importBackup(e.target.files[0]);});
  }
  function render(){document.querySelectorAll('.tab').forEach(btn=>btn.classList.toggle('active',btn.dataset.tab===state.tab));if(state.tab==='future')renderFuture();else if(state.tab==='analysis')renderAnalysis();else if(state.tab==='guide')renderGuide();else renderTecho();}
  const motionOK = () => !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let navTimer = null;
  function nav(tab){
    if(!['techo','future','analysis','guide'].includes(tab))return;
    clearTimeout(navTimer);
    if(tab===state.tab && !main.classList.contains('view-exit')){render();window.scrollTo(0,0);return;}
    state.tab=tab;
    if(!motionOK()){
      main.classList.remove('view-exit','view-enter');render();window.scrollTo(0,0);return;
    }
    main.classList.remove('view-enter');main.classList.add('view-exit');
    navTimer=setTimeout(()=>{
      navTimer=null;render();window.scrollTo(0,0);
      main.classList.remove('view-exit');
      // DOMを入れ替えた後の短いフェード。画面外へのスライドはしない。
      void main.offsetWidth;
      main.classList.add('view-enter');
    },130);
  }

  function preview(where,photos){$(where).innerHTML=photos.map((p,i)=>`<div class="photo-chip"><img src="${esc(p)}" alt="写真 ${i+1}"><button type="button" data-remove-photo="${i}" aria-label="写真を削除">×</button></div>`).join('');}
  async function compress(file){
    if(!file.type.startsWith('image/'))throw Error('Unsupported type');
    const uri=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    const image=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=reject;i.src=uri;});
    const ratio=Math.min(1,1280/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.80);
  }
  async function photosInput(files,group){const dest=group==='product'?state.photos:state.tastePhotos;const remaining=3-dest.length;if(remaining<=0){toast('写真は最大3枚です');return;}for(const f of [...files].slice(0,remaining)){try{dest.push(await compress(f));}catch(e){console.warn(e);toast('写真を読み込めませんでした');}}preview(group==='product'?'productPhotoPreview':'tastePhotoPreview',dest);editorDirty=true;}
  function productEditor(record=null,desired='tasted'){
    close(detailDialog);$('productForm').reset();$('productId').value=record?.id||'';
    $('productHeading').textContent=record?'商品情報を編集':'新しい羊羹を登録';
    $('productName').value=record?.productName||'';$('shopName').value=record?.shopName||'';
    $('yokanType').value=record?.taxonomy?.method||'練羊羹';setTaxonomyEditor(record?.taxonomy);
    $('includePreference').checked=record?.includeInPreference!==false;
    $('productUrl').value=record?.url||'';$('manufacturerName').value=record?.manufacturerName||'';$('ingredients').value=(record?.ingredients||[]).join('、');$('purchasePlace').value=record?.purchasePlace||'';
    $('purchaseDate').value=record?.purchaseDate||'';$('bestBefore').value=record?.bestBefore||'';$('productMemo').value=record?.memo||'';
    $('productStatus').value=record?.status||desired;$('productStatus').disabled=Boolean(record?.sessions.length);
    $('productStatus').title=record?.sessions.length?'実食履歴がある商品は手帖に残します':'';
    $('deleteProduct').classList.toggle('hidden',!record);
    state.photos=[...(record?.photos||[])];preview('productPhotoPreview',state.photos);
    editorDirty=false;show(productDialog);
  }
  async function saveProduct(e){
    e.preventDefault();if(!$('productForm').reportValidity())return;
    const current=get($('productId').value),chosen=$('productStatus').value;
    const needsTaste=chosen==='tasted'&&!current?.sessions.length;
    const rec=normalizeRecord({
      ...(current||{}),id:current?.id||id(),productName:$('productName').value.trim(),shopName:$('shopName').value.trim(),
      yokanType:$('yokanType').value,flavorTags:readTaxonomyEditor().materials.join('、'),
      taxonomy:readTaxonomyEditor(),includeInPreference:$('includePreference').checked,url:$('productUrl').value.trim(),manufacturerName:$('manufacturerName').value.trim(),ingredients:splitTags($('ingredients').value),
      purchasePlace:$('purchasePlace').value.trim(),purchaseDate:$('purchaseDate').value,bestBefore:$('bestBefore').value,
      memo:$('productMemo').value.trim(),photos:state.photos,sessions:current?.sessions||[],status:needsTaste?'stock':chosen,
      createdAt:current?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()
    });
    try{await putMany([rec]);await reload();close(productDialog,true);if(needsTaste)tasteEditor(get(rec.id));else{nav(rec.status==='tasted'?'techo':'future');if(rec.status==='stock')state.future='stock';else if(rec.status==='wishlist')state.future='wishlist';render();toast('保存しました');}}catch(err){console.error(err);toast('保存できませんでした');}
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
    editorDirty=false;show(tasteDialog);
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
    try{await putMany([{...rec,sessions,status:'tasted',updatedAt:new Date().toISOString()}]);await reload();close(tasteDialog,true);nav('techo');openDetail(rec.id);toast(previous?'評価を更新しました':'実食を追加しました');}catch(err){console.error(err);toast('保存できませんでした');}
  }
  async function deleteTaste(){const rec=get($('tasteProductId').value),sid=$('tasteId').value;if(!rec||!sid)return;if(!confirm('この回の記録を削除しますか？ 他の実食履歴は残ります。'))return;const sessions=rec.sessions.filter(s=>s.id!==sid);try{await putMany([{...rec,sessions,status:sessions.length?'tasted':'stock',updatedAt:new Date().toISOString()}]);await reload();close(tasteDialog,true);nav(sessions.length?'techo':'future');if(sessions.length)openDetail(rec.id);toast('この回を削除しました');}catch(e){toast('削除できませんでした');}}
  async function deleteProduct(){const rec=get($('productId').value);if(!rec)return;if(!confirm(`「${rec.productName}」と実食履歴${rec.sessions.length}回を完全に削除しますか？`))return;try{await drop(rec.id);await reload();close(productDialog,true);render();toast('削除しました');}catch(e){toast('削除できませんでした');}}
  function radarPoint(index,value,radius=107){const angle=-Math.PI/2+2*Math.PI*index/6,dist=radius*(value/10);return [180+Math.cos(angle)*dist,170+Math.sin(angle)*dist];}
  function polygon(scores){return QUALITY.map(([key],i)=>radarPoint(i,num(scores?.[key])||0).map(n=>n.toFixed(1)).join(',')).join(' ');}
  function complete(scores){return QUALITY.every(([key])=>num(scores?.[key])!==null);}
  function radarSvg(personal,hist){
    const labelPositions=[[180,24,'middle'],[324,85,'end'],[324,266,'end'],[180,322,'middle'],[36,266,'start'],[36,85,'start']];
    return `<svg class="radar-svg" viewBox="0 0 360 346" aria-label="個人評価・これまでの平均のレーダーチャート" role="img">
      ${[2,4,6,8,10].map(level=>`<polygon class="radar-grid" points="${polygon(Object.fromEntries(QUALITY.map(([k])=>[k,level])))}"></polygon>`).join('')}
      ${QUALITY.map((field,i)=>{const [x,y]=radarPoint(i,10);return `<line class="radar-axis" x1="180" y1="170" x2="${x}" y2="${y}"></line>`;}).join('')}
      ${complete(hist.scores)?`<polygon class="radar-poly average" points="${polygon(hist.scores)}"></polygon>`:''}
      ${complete(personal)?`<polygon class="radar-poly personal" points="${polygon(personal)}"></polygon>`:''}
      ${QUALITY.map((field,i)=>{const label=field[1],short=field[4];const [x,y,a]=labelPositions[i];return `<text class="radar-label" x="${x}" y="${y}" text-anchor="${a}">${esc(short||label)}</text>`;}).join('')}
    </svg>`;
  }
  // QUALITYは [key, label, low, high, short] の配列。
  function renderScoreTable(personal,hist){return `<table class="compare-table"><thead><tr><th>項目</th><th>今回</th><th>比較平均</th></tr></thead><tbody>${QUALITY.map(([key,label])=>`<tr><td class="score-label">${esc(label)}</td><td class="value-current">${fmt(num(personal?.[key]))}</td><td class="value-average">${fmt(hist.scores[key])}</td></tr>`).join('')}</tbody></table>`;}
  function profileMarkup(profile){return PROFILE.map(([key,label])=>{const score=num(profile?.[key]);return `<div class="profile-row"><span>${esc(label)}</span><span class="profile-track"><i style="width:${score?score*10:0}%"></i></span><span>${score||'—'}</span></div>`;}).join('');}
  function photoStrip(list){return list?.length?`<div class="photo-strip">${list.map(p=>`<img src="${esc(p)}" alt="記録した写真" loading="lazy" decoding="async">`).join('')}</div>`:'';}
  function detailItem(label,value,link=false){return `<div class="meta-item"><span>${esc(label)}</span><div>${link && value?`<a href="${esc(value)}" target="_blank" rel="noopener noreferrer">公式・商品ページを開く</a>`:esc(value||'—')}</div></div>`;}
  // 旧版の曖昧なまとめは、推測で一次情報と口コミに割り振らず別途保持する。
  // 「【公式一次情報】...【公開レビュー】...」などの見出しが明示されている場合だけ抽出する。
  function extractLegacySections(evidence){
    const src=cleanText(evidence||'',7000),heads=/【([^】]+)】/g;let match,prev=null,lastEnd=0;
    const official=[],review=[];let matched=false;
    while((match=heads.exec(src))!==null){
      if(prev){const body=src.slice(lastEnd,match.index).trim();
        if(/公式|一次情報/.test(prev))official.push(body);
        else if(/レビュー|口コミ|母数|解釈|限界/.test(prev))review.push(`${prev}：${body}`);
      }
      prev=match[1];lastEnd=heads.lastIndex;matched=true;
    }
    if(prev){const body=src.slice(lastEnd).trim();
      if(/公式|一次情報/.test(prev))official.push(body);
      else if(/レビュー|口コミ|母数|解釈|限界/.test(prev))review.push(`${prev}：${body}`);
    }
    return {official:official.filter(Boolean).join('\n'),review:review.filter(Boolean).join('\n'),matched};
  }
  function officialReviewParts(ge){
    const old=extractLegacySections(ge?.evidenceSummary);
    const officialInfo=cleanText(ge?.officialInfo??ge?.officialFacts??ge?.official??old.official??'',6000).trim();
    const reviewTrends=cleanText(ge?.reviewTrends??ge?.reviewSummary??ge?.reviews??old.review??'',6000).trim();
    const oldOverview=cleanText(ge?.summary||'',2000).trim();
    const unclassified=old.matched?'':cleanText(ge?.evidenceSummary||'',7000).trim();
    return {officialInfo,reviewTrends,oldOverview,unclassified};
  }
  function normalizeProductInfo(raw){
    if(!raw || typeof raw!=='object' || Array.isArray(raw)) return null;
    const info={
      productName: cleanText(raw.productName||raw.officialProductName||'',120).trim(),
      shopName: cleanText(raw.shopName||raw.officialShopName||'',120).trim(),
      url: http(raw.url||raw.productUrl||''),
      method: validMethod(cleanText(raw.method||'',40).trim() || 'その他'),
      ingredients: splitTags(raw.ingredients).length ? splitTags(raw.ingredients) : splitTags(raw.materials),
      materials: splitTags(raw.materials),
      textures: splitTags(raw.textures),
      styles: splitTags(raw.styles),
      manufacturerName:cleanText(raw.manufacturerName||raw.makerName||'',120).trim()
    };
    const hasAny = info.productName || info.shopName || info.url || info.manufacturerName || info.ingredients.length || (info.method && info.method!=='その他') || info.materials.length || info.textures.length || info.styles.length;
    return hasAny ? info : null;
  }
  function labeledBlocks(text){
    const src=cleanText(text||'',7000).trim();
    if(!src) return [];
    const out=[];
    const re=/【([^】]+)】\s*([\s\S]*?)(?=(?:\n?【[^】]+】)|$)/g;
    let m;
    while((m=re.exec(src))!==null){
      const label=cleanText(m[1],80).trim();
      const body=cleanText(m[2],2500).trim();
      if(label && body) out.push({label,body});
    }
    if(out.length) return out;
    return src.split(/\n+/).map(x=>x.trim()).filter(Boolean).map((body,i)=>({label:'メモ'+(i+1),body}));
  }
  function researchSectionMarkup(title, text, emptyText){
    const items=labeledBlocks(text);
    if(!items.length) return `<div class="research-panel"><h4>${esc(title)}</h4><p class="research-empty">${esc(emptyText)}</p></div>`;
    return `<div class="research-panel"><h4>${esc(title)}</h4><dl class="research-list">${items.map(item=>`<div class="research-row"><dt>${esc(item.label)}</dt><dd>${esc(item.body)}</dd></div>`).join('')}</dl></div>`;
  }
  function productInfoUpdates(record,info){
    if(!info) return [];
    const updates=[];
    const push=(label,from,to,setter)=>{ if(to && from!==to) updates.push({label,from,to,apply:setter}); };
    push('商品名', record.productName, info.productName, rec=>rec.productName=info.productName);
    // shopName is the store used when adding the record. A different maker belongs in manufacturerName.
    push('製造元',record.manufacturerName||'',info.manufacturerName,rec=>rec.manufacturerName=info.manufacturerName);
    push('商品URL', record.url||'', info.url, rec=>rec.url=info.url);
    if(info.ingredients.length){
      const existing=splitTags(record.ingredients),next=[...new Set([...existing,...info.ingredients])];
      if(JSON.stringify(existing)!==JSON.stringify(next))updates.push({label:'原材料',from:existing.join('、')||'未登録',to:next.join('、'),apply:rec=>rec.ingredients=next});
    }
    if(info.method && info.method!=='その他' && record.taxonomy.method!==info.method) updates.push({label:'製法',from:record.taxonomy.method,to:info.method,apply:rec=>rec.taxonomy.method=info.method});
    const mergeAxis=(axis,label,vals)=>{
      if(!vals.length) return;
      const current=record.taxonomy[axis]||[];
      const next=[...new Set([...current,...vals])];
      if(JSON.stringify(current)!==JSON.stringify(next)) updates.push({label,from:current.join('、')||'—',to:next.join('、'),apply:rec=>rec.taxonomy[axis]=next});
    };
    mergeAxis('materials','素材・風味',info.materials.filter(x=>TAX_OPTIONS.materials.includes(x)));
    mergeAxis('textures','食感・仕上げ',info.textures.filter(x=>TAX_OPTIONS.textures.includes(x)));
    mergeAxis('styles','仕立て・呼び名',info.styles);
    return updates;
  }
  function generalBlock(r){
    const ge=r.generalEvaluation;
    if(!ge)return `<p class="source-note">公式情報・レビュー傾向は未登録です。「調査依頼をコピー」から取得して追加できます。</p>`;
    const {officialInfo,reviewTrends,oldOverview,unclassified}=officialReviewParts(ge);
    const sources=(Array.isArray(ge.sources)?ge.sources:ge.sources&&typeof ge.sources==='object'?[ge.sources]:[]);
    return `<div class="research-meta">${ge.assessedAt?`<span>調査日：${esc(ge.assessedAt)}</span>`:''}<span>情報の確度：${esc(ge.confidence||'不明')}</span></div>
      ${researchSectionMarkup('公式情報',officialInfo,'確認できた公式情報はありません。')}
      ${researchSectionMarkup('レビュー傾向',reviewTrends,'独立した実食レビューに基づく傾向は確認できていません。')}
      ${(oldOverview||unclassified)?`<details class="legacy-research"><summary>旧形式の調査メモを開く</summary>${oldOverview?`<p>${esc(oldOverview)}</p>`:''}${unclassified?`<p>${esc(unclassified)}</p>`:''}</details>`:''}
      ${sources.length?`<div class="source-links"><h4>確認した情報源</h4>${sources.map(src=>{const link=http(src?.url);return link?`<div><a href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(src.label||link)}</a>${src.publishedAt?`（${esc(src.publishedAt)}）`:''}</div>`:'';}).join('')}</div>`:''}`;
  }
  function compareOptions(record){const t=record.taxonomy||taxonomyFromRecord(record);
    const choices=[{value:'all',label:'全商品平均'},{value:'method:'+t.method,label:categoryLabel('method:'+t.method)}];
    for(const axis of TAX_KEYS)for(const tag of t[axis])choices.push({value:axis+':'+tag,label:categoryLabel(axis+':'+tag)});
    return choices;
  }
  function comparisonMarkup(record,scope){
    const s=latest(record),hist=historical(scope);
    return `${radarSvg(s?.quality||{},hist)}<div class="legend"><span><i></i>この商品の直近</span><span><i class="avg"></i>${esc(scope==='all'?'全商品平均':'同分類平均')}</span></div>
      <p class="chart-caption">${esc(categoryLabel(scope))}：${hist.products}商品・実食${hist.tastings}回。各商品内で平均した後、商品間で等重み平均します。現在の商品を含みます。${hist.products<3?'商品数が少ないため平均値は参考程度です。':''}</p>
      ${renderScoreTable(s?.quality||{},hist)}`;
  }
  function openDetail(rid){
    const r=get(rid);if(!r)return;state.activeId=r.id;const isTasted=r.sessions.length>0,s=latest(r);
    const options=compareOptions(r);let scope=state.compareScopes[r.id]||options.find(o=>o.value.startsWith('method:'))?.value||'all';
    if(!options.some(o=>o.value===scope))scope='all';
    const actions=isTasted?`<button class="primary-btn small-btn" data-action="edit-latest">最新の評価を編集</button><button class="secondary-btn small-btn" data-action="taste">＋ もう一度食べた</button>`:r.status==='stock'?`<button class="primary-btn small-btn" data-action="taste">食べたので評価する</button>`:`<button class="primary-btn small-btn" data-action="stock">購入した → ストックへ</button>`;
    const allSessions=orderSessions(r);
    $('detailContent').innerHTML=`
      <header class="sheet-head"><div><span class="small-overline">YOKAN DETAIL · v5.7</span><h2>${esc(r.productName)}</h2><p class="detail-shop">${esc(r.shopName)}</p></div><button class="plain-btn" data-action="close">閉じる</button></header>
      <div class="detail-heading">${productPhoto(r)?`<img class="detail-image" src="${esc(productPhoto(r))}" alt="商品写真" decoding="async">`:''}<div class="action-row"><button class="secondary-btn small-btn" data-action="edit">商品情報を編集</button>${actions}</div>${isTasted?`<p class="sample-note">好み分析：${r.includeInPreference===false?'対象外':'対象'}　<button type="button" class="inline-action" data-action="toggle-preference">${r.includeInPreference===false?'好みの分析に含める':'好みの分析から除外する'}</button></p>`:''}</div>
      <section class="detail-section"><h3>商品情報</h3><div class="meta-grid">${detailItem('製法',r.taxonomy.method)}${r.manufacturerName?detailItem('製造元',r.manufacturerName):''}${r.ingredients?.length?detailItem('原材料',r.ingredients.join('、')):''}${detailItem('素材・風味',r.taxonomy.materials.join('、'))}${detailItem('食感・仕上げ',r.taxonomy.textures.join('、'))}${detailItem('仕立て・呼び名',r.taxonomy.styles.join('、'))}${detailItem('購入・入手先',r.purchasePlace)}${detailItem('購入日',fmtDate(r.purchaseDate))}${detailItem('賞味期限',fmtDate(r.bestBefore))}${detailItem('商品URL',r.url,true)}</div>${r.memo?`<p class="comment-block note-block">${esc(r.memo)}</p>`:''}${photoStrip(r.photos)}</section>
      ${isTasted?`
      <section class="detail-section plot-block"><div class="evaluation-heading"><h3>個人的な評価</h3><button type="button" class="secondary-btn small-btn" data-action="edit-latest">評価を編集する</button></div>
        <label class="field compact-field"><span>レーダーチャートの比較対象</span><select id="compareScope">${options.map(o=>`<option value="${esc(o.value)}" ${scope===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}</select></label>
        <div id="comparisonPanel">${comparisonMarkup(r,scope)}</div></section>
      <section class="detail-section"><h3>食べた記録 <small>（${r.sessions.length}回）</small></h3>
        ${allSessions.map((sess,i)=>`<article class="session-card"><h4>${fmtDate(sess.tastedDate)}　${i===0?'<span class="pill">最新</span>':''}</h4><div class="session-score">総合評価 <strong>${fmt(num(sess.quality?.overall))}</strong><span>/ 10</span></div><div class="session-meta-grid"><div><span>量</span><strong>${esc(sess.amount||'未記録')}</strong></div><div><span>合わせたもの</span><strong>${esc(sess.pairing||'なし')}</strong></div><div><span>温度</span><strong>${esc(sess.servingTemp)}</strong></div><div><span>切る厚さ</span><strong>${esc(sess.sliceThickness)}</strong></div></div>${sess.comment?`<div class="comment-block session-comment">${esc(sess.comment)}</div>`:''}${sess.visualNote?`<p class="session-visual"><span>見た目</span>${esc(sess.visualNote)}</p>`:''}${photoStrip(sess.photos)}<div class="action-row"><button class="secondary-btn small-btn" data-session="${esc(sess.id)}">この回を編集</button></div></article>`).join('')}</section>
      <section class="detail-section"><h3>直近の味わい</h3><p class="helper">良し悪しでなく特徴の強さを記録</p>${profileMarkup(s.profile)}</section>
      `:`<section class="detail-section"><p class="lead">${r.status==='stock'?'購入済み。食べたら評価を追加して手帖へ移せます。':'気になっている羊羹。購入したらストックに移せます。'}</p></section>`}
      <section class="detail-section"><h3>公式情報とレビュー傾向</h3>
        ${generalBlock(r)}
        <button class="secondary-btn" data-action="copy" type="button">調査依頼をコピー</button>
        <details class="import-box"><summary>調査結果を貼って取り込む（テキスト／JSON）</summary><p class="source-note">見出し付きテキストをそのまま貼り付けられます。旧JSONも利用できます。商品名・登録店名の一致も確認します。</p><label class="field">ChatGPTの回答<textarea id="generalJSON" rows="9" placeholder="YOKAN_TECHO_FORMAT_V1"></textarea></label><div class="action-row"><button class="primary-btn" data-action="import-general" type="button">この商品に取り込む</button>${r.generalEvaluation?'<button class="danger-btn" data-action="delete-general">調査メモを削除</button>':''}</div><p id="jsonImportStatus" class="import-feedback" role="status" aria-live="polite"></p></details></section>`;
    show(detailDialog);
    $('compareScope')?.addEventListener('change',e=>{
      state.compareScopes[r.id]=e.target.value;
      const panel=$('comparisonPanel');panel.innerHTML=comparisonMarkup(get(r.id),e.target.value);
      if(motionOK()){panel.classList.remove('swap-fade');void panel.offsetWidth;panel.classList.add('swap-fade');}
    });
  }
  function normalizeGeneral(raw,r){
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('JSONの形式が違います');
    const ge=raw.generalEvaluation||raw;
    if(!ge||typeof ge!=='object'||Array.isArray(ge))throw Error('generalEvaluation が正しくありません');
    if(raw.productName&&cleanName(raw.productName)!==cleanName(r.productName))throw Error('商品名が登録と一致しません（本練と本煉など表記を確認してください）');
    if(raw.shopName&&cleanName(raw.shopName)!==cleanName(r.shopName))throw Error('店名が登録と一致しません');
    const notes=officialReviewParts(ge);
    const sources=(Array.isArray(ge.sources)?ge.sources:ge.sources&&typeof ge.sources==='object'?[ge.sources]:[])
      .slice(0,15).map(src=>({label:cleanText(src?.label||'出典',200),url:http(src?.url||''),publishedAt:cleanText(src?.publishedAt||'',80)})).filter(src=>src.url);
    if(!notes.officialInfo&&!notes.reviewTrends&&!notes.oldOverview&&!notes.unclassified&&!sources.length){
      throw Error('公式情報・レビュー傾向・出典がありません。調査結果を貼り付けてください。');
    }
    const productInfo=normalizeProductInfo(raw.productInfo||ge.productInfo||null);
    // Legacy prompts sometimes used productInfo.shopName for manufacturer, not shop/seller.
    // Keep retailer unchanged, and offer manufacturer separately instead.
    if(productInfo && productInfo.shopName && cleanName(productInfo.shopName)!==cleanName(r.shopName)){
      productInfo.manufacturerName ||= productInfo.shopName;
      productInfo.shopName='';
    }
    return {schemaVersion:3,officialInfo:notes.officialInfo,reviewTrends:notes.reviewTrends,
      // 古い数値付きの調査結果を取り込んでも、その値は参考表示に利用しない。
      summary:notes.oldOverview,evidenceSummary:cleanText(ge.evidenceSummary||'',7000),
      legacyScores:ge.scores && typeof ge.scores==='object' && !Array.isArray(ge.scores)?structuredClone(ge.scores):null,
      productInfo,
      confidence:['low','medium','high'].includes(ge.confidence)?ge.confidence:'unverified',
      assessedAt:cleanText(ge.assessedAt||raw.assessedAt||'',40),sources,importedAt:new Date().toISOString()};
  }
  function cleanName(value){return String(value||'').normalize('NFKC').replace(/本練/g,'本煉').replace(/[\s　]/g,'').toLocaleLowerCase('ja');}
  function normalizeSmartQuotes(jsonText){
    // AI回答が “key”: “value” のような組版引用符を使用した場合だけ補正。
    // 正しい半角引用符で囲まれた文字列内の “ ” は本文として保持する。
    let output='', inside=false, closing='';
    for(let i=0;i<jsonText.length;i++){
      const ch=jsonText[i];
      if(!inside){
        if(ch==='"'||ch==='“'||ch==='”'){inside=true;closing=ch==='“'?'”':ch;output+='"';}
        else if(ch==='：')output+=':';
        else if(ch==='，')output+=',';
        else output+=ch;
        continue;
      }
      if(ch==='\\' && i+1<jsonText.length){output+=ch+jsonText[++i];continue;}
      if(ch===closing){inside=false;output+='"';}else output+=ch;
    }
    return output;
  }
  function removeTrailingCommas(jsonText){
    let output='',inside=false,escaped=false;
    for(let i=0;i<jsonText.length;i++){
      const ch=jsonText[i];
      if(inside){output+=ch;if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inside=false;continue;}
      if(ch==='"'){inside=true;output+=ch;continue;}
      if(ch===','){let j=i+1;while(/\s/.test(jsonText[j]||'')&&j<jsonText.length)j++;if(jsonText[j]==='}'||jsonText[j]===']')continue;}
      output+=ch;
    }
    return output;
  }
  function objectCandidates(text){
    const candidates=[], fenced=/```(?:json|javascript)?\s*([\s\S]*?)```/gi;
    let match;while((match=fenced.exec(text))!==null)candidates.push(match[1].trim());
    candidates.push(text.trim());
    // 説明文の中にJSONオブジェクトがある場合、文字列中の{ }を無視して切り出す。
    let start=-1,depth=0,inside=false,closing='',escaped=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(inside){if(escaped){escaped=false;continue;}if(ch==='\\'){escaped=true;continue;}if(ch===closing)inside=false;continue;}
      if(ch==='"'||ch==='“'||ch==='”'){inside=true;closing=ch==='“'?'”':ch;continue;}
      if(ch==='{'){if(depth===0)start=i;depth++;}
      else if(ch==='}'&&depth>0){depth--;if(depth===0){candidates.push(text.slice(start,i+1));start=-1;}}
    }
    return [...new Set(candidates.filter(Boolean))];
  }
  function sourceObjectEnd(text,start){
    let depth=0,inside=false,escaped=false;
    for(let i=start;i<text.length;i++){
      const ch=text[i];
      if(inside){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')inside=false;continue;}
      if(ch==='"'){inside=true;continue;}
      if(ch==='{')depth++;
      if(ch==='}'&&--depth===0)return i+1;
      if(ch!=='}')continue;
    }
    return -1;
  }
  function repairSourceObjects(input){
    // AI生成の「sources": {…}, {…}」を「sources": [{…}, {…}]」へ。
    // 入れ子内の文字列や引用符は変更せず、出典オブジェクト以外には適用しない。
    let text=input,offset=0,re=/"sources"\s*:\s*\{/g,found;
    while((found=re.exec(text))!==null){
      const start=found.index+found[0].lastIndexOf('{');
      let end=sourceObjectEnd(text,start);if(end<0)continue;
      while(true){
        const rest=text.slice(end),sep=/^\s*,\s*\{/.exec(rest);
        if(!sep)break;
        const nextStart=end+sep[0].lastIndexOf('{');
        const nextEnd=sourceObjectEnd(text,nextStart);
        if(nextEnd<0)break;
        end=nextEnd;
      }
      text=text.slice(0,start)+'['+text.slice(start,end)+']'+text.slice(end);
      re.lastIndex=end+2;
      offset++;
    }
    return text;
  }
  function repairProductListFields(input){
    // Restricted to productInfo.{materials,textures,styles}: converts comma-separated
    // strings to arrays and missing styles values to []. Does not infer missing data.
    const match=/"productInfo"\s*:\s*\{/.exec(input);
    if(!match)return input;
    const open=match.index+match[0].lastIndexOf('{'),end=sourceObjectEnd(input,open);
    if(end<0)return input;
    let body=input.slice(open+1,end-1);
    function readStringAt(pos){
      if(body[pos]!== '"')return null;
      let escaped=false;
      for(let j=pos+1;j<body.length;j++){
        const c=body[j];
        if(escaped){escaped=false;continue;}
        if(c==='\\'){escaped=true;continue;}
        if(c==='"')return {text:body.slice(pos,j+1),end:j+1};
      }
      return null;
    }
    // Iterate in reverse to keep original indices stable while editing.
    const hits=[...body.matchAll(/"(materials|textures|styles)"\s*:\s*/g)];
    for(const m of hits.reverse()){
      const start=m.index+m[0].length;
      let pos=start;
      while(/\s/.test(body[pos]||'') && pos<body.length)pos++;
      if(body[pos]==='[')continue; // valid arrays are already supported
      const items=[];
      while(true){
        const item=readStringAt(pos);
        if(!item)break;
        items.push(item.text);pos=item.end;
        while(/\s/.test(body[pos]||'')&&pos<body.length)pos++;
        if(body[pos]!==',')break;
        let following=pos+1;
        while(/\s/.test(body[following]||'')&&following<body.length)following++;
        const next=readStringAt(following);
        if(!next)break;
        let after=next.end;
        while(/\s/.test(body[after]||'')&&after<body.length)after++;
        if(body[after]===':')break; // the next entry is a property, not an array item
        pos=following;
      }
      if(items.length){body=body.slice(0,start)+'['+items.join(',')+']'+body.slice(pos);}
      else if(body[pos]===','||body[pos]==='}'||pos>=body.length){
        body=body.slice(0,start)+'[]'+body.slice(start);
      }
    }
    return input.slice(0,open+1)+body+input.slice(end-1);
  }

  // v5.8: Source lines may be joined by an AI response or copying software.
  // Split only at URL boundaries; do not mistake a pipe in a label for a URL.
  function parseResearchSources(value){
    const input=String(value||'').trim();
    const urls=[...input.matchAll(/https?:\/\/[^\s|<>"“”]+/gi)];
    const sources=[];
    for(let i=0;i<urls.length;i++){
      const match=urls[i];
      const rawUrl=match[0].replace(/[、。,)）]+$/,'');
      const url=http(rawUrl);
      if(!url || sources.some(s=>s.url===url))continue;
      const rest=input.slice(match.index+match[0].length,urls[i+1]?.index ?? input.length)
        .replace(/^[\s|｜・*\-]+/,'').trim();
      const parts=rest.split(/\s*[|｜]\s*/).map(s=>s.trim()).filter(Boolean);
      const candidate=parts.at(-1)||'';
      const matchDate=candidate.match(/\d{4}-\d{2}-\d{2}|日付不明/);
      const publishedAt=matchDate?.[0]||'日付不明';
      const label=parts.filter((v,j)=>j!==parts.length-1 || !matchDate).join(' | ')||'参照ページ';
      sources.push({url,label:cleanText(label,200),publishedAt});
    }
    return sources;
  }
  function taggedPayload(data){
    for(const k of Object.keys(data))data[k]=String(data[k]||'').trim();
    if((data.officialInfo||'').includes('調査した商品と容量を記載'))throw Error('調査依頼のひな型が貼られています。ChatGPTが調査して返した回答を貼り付けてください。');
    if(!data.officialInfo && !data.reviewTrends){
      throw Error('調査本文が見つかりません。officialInfo と reviewTrends の内容を含めて貼り付けてください。');
    }
    return {
      schemaVersion:3,
      productName:data.productName||'',shopName:data.shopName||'',
      productInfo:{productName:data.officialProductName||'',manufacturerName:data.manufacturerName||'',
        url:data.url||'',method:data.method||'',ingredients:data.ingredients||'',
        materials:data.materials||'',textures:data.textures||'',styles:data.styles||''},
      generalEvaluation:{officialInfo:data.officialInfo||'',reviewTrends:data.reviewTrends||'',
        confidence:data.confidence||'low',assessedAt:data.assessedAt||'',sources:parseResearchSources(data.sources)}
    };
  }
  // Accept both v5.7's strict one-label-per-line format and flattened replies
  // whose labels were rewritten as plain English words on the same line.
  // Long Japanese paragraphs stay untouched: only exact English field names
  // at the defined boundaries are treated as separators.
  function parseFlattenedTaggedResearch(src){
    const all=['productName','shopName','officialProductName','manufacturerName','url',
      'method','ingredients','materials','textures','styles',
      'officialInfo','reviewTrends','confidence','assessedAt','sources'];
    const required=['productName','shopName','officialInfo','reviewTrends','confidence','assessedAt','sources'];
    const header=src.match(/^YOKAN_TECHO_FORMAT_V1\b/);
    if(!header)return null;
    const tail=src.slice(header[0].length);
    const end=/\bYOKAN_TECHO_END\b/.exec(tail);
    if(!end)throw Error('調査結果の末尾「YOKAN_TECHO_END」がありません。回答が途中で切れていないか確認してください。');
    const body=tail.slice(0,end.index);
    // Match bare tokens only at whitespace boundaries, never inside URLs.
    const marker=/(^|\s)(?:\[([A-Za-z]+)\]|([A-Za-z]+))(?=\s|[:：=]|$)/g;
    const found=[];let m;
    while((m=marker.exec(body))!==null){
      const key=m[2]||m[3];
      if(!all.includes(key))continue;
      const order=all.indexOf(key);
      if(found.length && order<=found[found.length-1].order)continue;
      const leading=m[1].length;
      // m[0] may consume whitespace after the tag; next segment begins at m.index+m[0].length.
      found.push({key,order,start:m.index+leading,end:marker.lastIndex});
    }
    if(!required.every(k=>found.some(f=>f.key===k)))return null;
    const data={};
    for(let i=0;i<found.length;i++){
      const here=found[i],next=found[i+1];
      data[here.key]=body.slice(here.end,next?.start ?? body.length).trim().replace(/^[:：=]\s*/,'');
    }
    return taggedPayload(data);
  }
  function parseTaggedResearch(raw){
    const src=String(raw||'').replace(/\r\n?/g,'\n').trim()
      .replace(/^```[^\n]*\n/,'').replace(/\n```$/,'').trim();
    if(!src.startsWith('YOKAN_TECHO_FORMAT_V1'))return null;
    // The end marker may follow a source date with a space (no newline).
    if(!/\bYOKAN_TECHO_END\b/.test(src))throw Error('調査結果の末尾「YOKAN_TECHO_END」がありません。回答が途中で切れていないか確認してください。');
    const known=new Set(['productName','shopName','officialProductName','manufacturerName','url',
      'method','ingredients','materials','textures','styles','officialInfo','reviewTrends',
      'confidence','assessedAt','sources']);
    const data={};let key=null;
    for(const line of src.replace(/\bYOKAN_TECHO_END\b/,'\nYOKAN_TECHO_END').split('\n')){
      const candidate=line.trim().match(/^\[([A-Za-z]+)\]$/);
      if(candidate && known.has(candidate[1])){key=candidate[1];data[key]='';continue;}
      if(line.trim()==='YOKAN_TECHO_FORMAT_V1'||line.trim()==='YOKAN_TECHO_END'){
        key=null;continue;
      }
      if(key!==null)data[key]+=(data[key]?'\n':'')+line;
    }
    // Normal multi-line tagged response gets priority; flattened is fallback.
    if(data.officialInfo && data.reviewTrends)return taggedPayload(data);
    const flattened=parseFlattenedTaggedResearch(src);
    if(flattened)return flattened;
    if(data.officialInfo || data.reviewTrends)return taggedPayload(data);
    throw Error('見出しの区切りを認識できませんでした。回答に productName、shopName、officialInfo、reviewTrends、confidence、assessedAt、sources を含めてください。');
  }
  function parseGeneralText(raw){
    const text=String(raw||'').replace(/^\uFEFF/,'').trim();
    if(!text)throw Error('ChatGPTの回答が空です。調査結果を貼り付けてください。');
    // Tagged-text import is preferred; it tolerates Japanese text, quotations and line breaks.
    const tagged=parseTaggedResearch(text);
    if(tagged)return tagged;
    // Legacy JSON and best-effort repair remain available for existing responses.
    let lastError;
    for(const source of objectCandidates(text)){
      const readable=normalizeSmartQuotes(source);
      const basics=removeTrailingCommas(readable);
      const repaired=removeTrailingCommas(repairSourceObjects(repairProductListFields(basics)));
      for(const candidate of [source,readable,basics,repaired]){
        try{const parsed=JSON.parse(candidate);if(parsed && !Array.isArray(parsed) && typeof parsed==='object')return parsed;}
        catch(err){lastError=err;}
      }
    }
    const hint=lastError?String(lastError.message||'').slice(0,160):'JSONオブジェクトを見つけられませんでした';
    throw Error(`取り込み形式を判別できませんでした（${hint}）。新しい「調査依頼をコピー」で作られた「YOKAN_TECHO_FORMAT_V1」から「YOKAN_TECHO_END」まで全文を貼り付けてください。元の入力は保持します。`);
  }
  function promptFor(r){
    const product=String(r?.productName||'（商品名を入力）');
    const shop=String(r?.shopName||'（登録店名を入力）');
    return `次の羊羹について、メーカー・公式販売店の情報と、独立した実食レビューをWebで調査してください。商品名：${product}／登録店名：${shop}。

【調査の品質】
・最優先はメーカー・販売店の公式情報。製造元と販売店は分ける。登録店名「${shop}」は変更しない。
・原材料・製法・容量・期限・特徴は対象の商品・サイズに限定し、不明なら「確認できず」。レビューの味・香り・食感は確認件数と相反する感想、限界を明記する。
・メーカーが宣伝する特徴を実食レビューに混ぜない。確認していないURLは記載しない。日付が不明なら「日付不明」。数値の推定評価は不要。
・調査結果を文章として丁寧に書くが、出力は下記の「取り込み専用テキスト」だけにする。JSONは絶対に出力しない。

【出力形式の厳守】
・先頭は YOKAN_TECHO_FORMAT_V1、末尾は YOKAN_TECHO_END。前後に説明やコードブロックを加えない。
・角括弧は必須：[officialInfo] [reviewTrends] [sources] を省略せず、必ず1行に1見出しとする。見出しと本文を同じ行に連結しない。
・[英語のフィールド名] を単独行に書き、その次の行から内容を書く。記号や引用符のエスケープは不要。未確認の項目は空欄のまま次の見出しへ。
・送信前に必ず確認：角括弧付き見出しが全部存在するか、[officialInfo] と [reviewTrends] の本文があるか、最後の YOKAN_TECHO_END が独立した行か。
・ingredients（原材料表示）、materials（主材料の分類）、textures（公式に明記の食感）、styles（仕立て）は「、」区切りの文字列。配列・波括弧・JSON記号は使用しない。
・[officialInfo] と [reviewTrends] の本文中では【原材料】【食感】【件数】などの日本語小見出しを使ってよい。途中改行してもよい。
・[sources] は「URL | ページ名 | YYYY-MM-DDまたは日付不明」を1行に1件ずつ書く。確認したページだけを書く。
・製法分類は公式に断定できる場合のみ「練羊羹」「水羊羹」「蒸羊羹」「芋羊羹」のいずれか。推定で分類しない。

YOKAN_TECHO_FORMAT_V1
[productName]
${product}
[shopName]
${shop}
[officialProductName]
[manufacturerName]
[url]
[method]
[ingredients]
[materials]
[textures]
[styles]
[officialInfo]
【商品情報】調査した商品と容量を記載
【原材料】公式で確認できた原材料
【製法・特徴】一次情報による説明と不明点
【保存】公式で確認できた保存条件や賞味期間
[reviewTrends]
【確認件数】対象商品について確認した独立実食レビューの件数
【味・甘味】レビュー傾向と相違点
【食感・香り】レビュー傾向と相違点
【限界】件数や時期、根拠の制約
[confidence]
low
[assessedAt]
${today()}
[sources]
YOKAN_TECHO_END

上記は出力のひな型です。サンプル文をそのまま残さず、検索で確認できた内容だけに置き換えること。confidence は high/medium/low のいずれか。件数が不足する場合はその限界を説明する。`;
  }
  function copyStatus(button,message,ok,copyContent=''){
    if(!button)return;
    if(!button.dataset.originalLabel)button.dataset.originalLabel=button.textContent;
    button.textContent=ok?'✓ コピー完了！':button.dataset.originalLabel;
    button.classList.toggle('copy-success',ok);
    let note=button.nextElementSibling;
    if(!note?.classList.contains('copy-feedback')){
      note=document.createElement('div');note.className='copy-feedback';note.setAttribute('role','status');
      button.insertAdjacentElement('afterend',note);
    }
    note.textContent=message;
    if(!ok && copyContent){
      const manual=document.createElement('textarea');manual.className='manual-copy';manual.readOnly=true;
      manual.setAttribute('aria-label','手動でコピーする文章');manual.value=copyContent;
      note.appendChild(manual);
    }
  }
  async function copyPrompt(record,button){
    const text=promptFor(record);
    try{
      if(navigator.clipboard?.writeText && window.isSecureContext){
        await navigator.clipboard.writeText(text);
      }else{
        const ta=document.createElement('textarea');ta.value=text;ta.style.position='fixed';ta.style.left='-9999px';
        document.body.appendChild(ta);
        try{ta.focus();ta.select();if(!document.execCommand('copy'))throw Error('copy unsupported');}finally{ta.remove();}
      }
      copyStatus(button,'v5.8・書式を強化した調査依頼をコピーしました。ChatGPTへ貼り付けてください。',true);
      toast('✓ コピーしました');
    }catch(e){
      console.error(e);
      copyStatus(button,'自動コピーに失敗しました。下の文章を長押ししてコピーできます。',false,text);
      toast('コピーできませんでした');
    }
  }
  async function importGeneral(){
    const r=get(state.activeId);if(!r)return;
    const input=$('generalJSON'),raw=input?.value||'';
    try{
      const payload=parseGeneralText(raw),ge=normalizeGeneral(payload,r);
      const next={...r,generalEvaluation:ge,updatedAt:new Date().toISOString()};
      const updates=productInfoUpdates(r,ge.productInfo);
      if(updates.length){
        const message=`公式情報から商品情報の修正候補が見つかりました。取得した情報に変更しますか？\n\n${updates.map(u=>`・${u.label}\n  ${u.from||'—'} → ${u.to||'—'}`).join('\n')}`;
        if(confirm(message)){
          const draft=structuredClone(next);
          draft.taxonomy={...draft.taxonomy,materials:[...draft.taxonomy.materials],textures:[...draft.taxonomy.textures],styles:[...draft.taxonomy.styles]};
          updates.forEach(u=>u.apply(draft));
          draft.updatedAt=new Date().toISOString();
          await putMany([draft]);
          await reload();openDetail(draft.id);toast('調査メモと商品情報を更新しました');
          const feedback=$('jsonImportStatus');if(feedback)feedback.textContent='✓ 公式情報とレビュー傾向を取り込み、商品情報にも反映しました';
          return;
        }
      }
      await putMany([next]);
      await reload();openDetail(r.id);toast('公式情報とレビュー傾向を取り込みました');
      const feedback=$('jsonImportStatus');if(feedback)feedback.textContent='✓ 公式情報とレビュー傾向を取り込みました';
    }catch(e){
      console.error(e);
      const feedback=$('jsonImportStatus');
      if(feedback)feedback.textContent=`取り込めませんでした：${e.message}`;
      if(input && input.value!==raw)input.value=raw;
    }
  }
  async function actionStock(rid){const r=get(rid);if(!r)return;try{await putMany([{...r,status:'stock',updatedAt:new Date().toISOString()}]);await reload();close(detailDialog);state.future='stock';nav('future');toast('ストックに移しました');}catch(e){toast('保存できませんでした');}}
  function mergeRecord(old,r){
    if(!old)return r;
    const sessions=new Map(r.sessions.map(s=>[s.id,s]));for(const s of old.sessions)sessions.set(s.id,s);
    const result={...r,...old,sessions:[...sessions.values()]};
    for(const field of ['url','manufacturerName','ingredients','purchasePlace','purchaseDate','bestBefore','memo','flavorTags','photos','generalEvaluation']){
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
    if(btn.dataset.future){state.future=btn.dataset.future;renderFuture();if(motionOK()){main.classList.remove('view-enter');void main.offsetWidth;main.classList.add('view-enter');}}
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
      case 'copy':copyPrompt(r,btn);break;
      case 'import-general':importGeneral();break;
      case 'delete-general':if(confirm('公式情報とレビュー傾向を削除しますか？'))putMany([{...r,generalEvaluation:null}]).then(reload).then(()=>openDetail(rid));break;
    }
  }
  // フォームは通常の文書フローでスクロールし、VisualViewportによる
  // ダイアログ高さ変更・入力欄への強制scrollIntoViewは行わない。
  function bind(){
    $('addBtn').addEventListener('click',()=>productEditor(null,state.tab==='future'?state.future:'tasted'));
    document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>nav(b.dataset.tab)));
    main.addEventListener('click',handleMainClick);$('detailContent').addEventListener('click',handleDetailClick);
    $('productClose').addEventListener('click',()=>close(productDialog));$('tasteClose').addEventListener('click',()=>close(tasteDialog));
    $('productForm').addEventListener('submit',saveProduct);$('tasteForm').addEventListener('submit',saveTaste);
    [productDialog,tasteDialog].forEach(modal=>{modal.addEventListener('input',markEditorDirty);modal.addEventListener('change',markEditorDirty);modal.addEventListener('cancel',e=>{e.preventDefault();close(modal);});});
    $('deleteProduct').addEventListener('click',deleteProduct);$('deleteTaste').addEventListener('click',deleteTaste);
    $('taxonomySelectors').innerHTML=TAX_KEYS.map(tagsMarkup).join('');
    $('profileSliders').innerHTML=sliderMarkup(PROFILE,'profile');$('qualitySliders').innerHTML=sliderMarkup(QUALITY,'quality');
    tasteDialog.addEventListener('input',e=>{if(e.target.matches('input[type="range"]'))updateRange(e.target);});
    tasteDialog.addEventListener('click',e=>{const b=e.target.closest('button[data-step]');if(!b)return;const input=tasteDialog.querySelector(`input[type="range"][data-group="${b.dataset.group}"][data-key="${b.dataset.key}"]`);input.value=Math.max(1,Math.min(10,Number(input.value)+Number(b.dataset.step)));updateRange(input);editorDirty=true;});
    $('productPhotos').addEventListener('change',e=>{photosInput(e.target.files,'product');e.target.value='';});$('tastePhotos').addEventListener('change',e=>{photosInput(e.target.files,'taste');e.target.value='';});
    $('productPhotoPreview').addEventListener('click',e=>{const b=e.target.closest('[data-remove-photo]');if(b){state.photos.splice(Number(b.dataset.removePhoto),1);preview('productPhotoPreview',state.photos);editorDirty=true;}});
    $('tastePhotoPreview').addEventListener('click',e=>{const b=e.target.closest('[data-remove-photo]');if(b){state.tastePhotos.splice(Number(b.dataset.removePhoto),1);preview('tastePhotoPreview',state.tastePhotos);editorDirty=true;}});
    // 余白のタップでは編集フォームを閉じない。明示的な閉じるボタンだけが閉じる動線。
    detailDialog.addEventListener('cancel',e=>{e.preventDefault();close(detailDialog);});
  }
  async function init(){bind();try{await reload();render();}catch(e){console.error(e);main.innerHTML='<p>保存領域に接続できません。通常のブラウザで開いてください。</p>';return;}
    if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){navigator.serviceWorker.register('./sw.js').catch(console.warn);}
  }
  init();
})();