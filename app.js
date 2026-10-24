(() => {
  'use strict';

  const DB_NAME = 'yokan-techo-db';
  const DB_VERSION = 1;
  const STORE = 'records';

  const PROFILE_FIELDS = [
    { key: 'sweetness', label: '甘さ', low: '控えめ', high: '強い', default: 5 },
    { key: 'aroma', label: '豆・素材の香り', low: '穏やか', high: '強い', default: 5 },
    { key: 'richness', label: '濃厚さ', low: '軽い', high: '濃密', default: 5 },
    { key: 'firmness', label: 'かたさ', low: 'やわらかい', high: 'しっかり', default: 5 },
    { key: 'smoothness', label: 'なめらかさ', low: '粒感あり', high: 'なめらか', default: 5 },
    { key: 'finishLength', label: '余韻', low: '短い', high: '長い', default: 5 },
  ];

  const QUALITY_FIELDS = [
    { key: 'ingredientFlavor', label: '素材の風味', low: '好みでない', high: 'とても良い', default: 5 },
    { key: 'sweetBalance', label: '甘味のバランス', low: '合わない', high: 'とても良い', default: 5 },
    { key: 'texture', label: '舌触り・食感', low: '好みでない', high: 'とても好み', default: 5 },
    { key: 'aftertaste', label: '後味', low: '好みでない', high: 'とても良い', default: 5 },
    { key: 'repeat', label: 'また食べたい', low: '低い', high: 'ぜひ', default: 5 },
    { key: 'overall', label: '総合評価', low: '1', high: '10', default: 5 },
  ];

  const state = {
    records: [],
    activeView: 'records',
    selectedId: null,
    editingPhotos: [],
    filters: { query: '', type: 'all', sort: 'date-desc' },
  };

  const el = (id) => document.getElementById(id);
  const mainView = el('mainView');
  const dialog = el('editorDialog');
  const form = el('recordForm');

  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('tastedDate', 'tastedDate');
          store.createIndex('shopName', 'shopName');
          store.createIndex('yokanType', 'yokanType');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function dbGetAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async function dbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  const esc = (value = '') => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  function todayISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return '日付未記録';
    const d = new Date(`${value}T00:00:00`);
    if (Number.isNaN(d.getTime())) return value;
    return new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  }

  function createId() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function showToast(message) {
    document.querySelector('.toast')?.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  function sliderMarkup(field, group, value = field.default) {
    return `
      <div class="rating-row">
        <div class="rating-head">
          <span class="rating-title">${esc(field.label)}</span>
          <span class="rating-value" id="value-${group}-${field.key}">${value}</span>
        </div>
        <div class="range-wrap">
          <span class="range-label">${esc(field.low)}</span>
          <input type="range" min="1" max="10" step="1" value="${value}" data-rating-group="${group}" data-rating-key="${field.key}" aria-label="${esc(field.label)}" />
          <span class="range-label">${esc(field.high)}</span>
        </div>
      </div>`;
  }

  function initSliders() {
    el('profileSliders').innerHTML = PROFILE_FIELDS.map(f => sliderMarkup(f, 'profile')).join('');
    el('qualitySliders').innerHTML = QUALITY_FIELDS.map(f => sliderMarkup(f, 'quality')).join('');
    dialog.addEventListener('input', (e) => {
      const target = e.target;
      if (target.matches('input[type="range"][data-rating-key]')) {
        const { ratingGroup, ratingKey } = target.dataset;
        const out = el(`value-${ratingGroup}-${ratingKey}`);
        if (out) out.textContent = target.value;
      }
    });
  }

  function readRatingGroup(group) {
    const obj = {};
    dialog.querySelectorAll(`input[type="range"][data-rating-group="${group}"]`).forEach(input => {
      obj[input.dataset.ratingKey] = Number(input.value);
    });
    return obj;
  }

  function setRatingGroup(group, fields, values = {}) {
    fields.forEach(field => {
      const input = dialog.querySelector(`input[data-rating-group="${group}"][data-rating-key="${field.key}"]`);
      if (!input) return;
      input.value = values[field.key] ?? field.default;
      el(`value-${group}-${field.key}`).textContent = input.value;
    });
  }

  async function compressImage(file) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });

    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .82);
  }

  function renderPhotoPreview() {
    const wrap = el('photoPreview');
    wrap.innerHTML = state.editingPhotos.map((src, idx) => `
      <div class="photo-chip">
        <img src="${src}" alt="記録写真 ${idx + 1}" />
        <button class="photo-remove" type="button" data-photo-remove="${idx}" aria-label="写真を削除">×</button>
      </div>`).join('');
  }

  async function onPhotoInput(files) {
    const remaining = Math.max(0, 3 - state.editingPhotos.length);
    const picked = [...files].slice(0, remaining);
    if (!picked.length) {
      if (remaining === 0) showToast('写真は最大3枚です');
      return;
    }
    for (const file of picked) {
      if (!file.type.startsWith('image/')) continue;
      try {
        state.editingPhotos.push(await compressImage(file));
      } catch (err) {
        console.error(err);
        showToast('写真を読み込めませんでした');
      }
    }
    renderPhotoPreview();
    el('photoInput').value = '';
  }

  function resetForm() {
    form.reset();
    el('recordId').value = '';
    el('tastedDate').value = todayISO();
    el('yokanType').value = '練羊羹';
    el('servingTemp').value = '常温';
    el('sliceThickness').value = '標準';
    state.editingPhotos = [];
    renderPhotoPreview();
    setRatingGroup('profile', PROFILE_FIELDS);
    setRatingGroup('quality', QUALITY_FIELDS);
    el('deleteBtn').classList.add('hidden');
    el('editorTitle').textContent = '羊羹を記録';
  }

  function fillForm(record) {
    resetForm();
    el('recordId').value = record.id;
    el('productName').value = record.productName || '';
    el('shopName').value = record.shopName || '';
    el('tastedDate').value = record.tastedDate || todayISO();
    el('purchasePlace').value = record.purchasePlace || '';
    el('yokanType').value = record.yokanType || '練羊羹';
    el('flavorTags').value = record.flavorTags || '';
    el('servingTemp').value = record.servingTemp || '常温';
    el('sliceThickness').value = record.sliceThickness || '標準';
    el('pairing').value = record.pairing || '';
    el('comment').value = record.comment || '';
    el('visualNote').value = record.visualNote || '';
    state.editingPhotos = [...(record.photos || [])];
    renderPhotoPreview();
    setRatingGroup('profile', PROFILE_FIELDS, record.profile || {});
    setRatingGroup('quality', QUALITY_FIELDS, record.quality || {});
    el('deleteBtn').classList.remove('hidden');
    el('editorTitle').textContent = '記録を編集';
  }

  function openEditor(record = null) {
    if (record) fillForm(record); else resetForm();
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    requestAnimationFrame(() => el('productName').focus());
  }

  function closeEditor() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function collectFormRecord() {
    const id = el('recordId').value || createId();
    const existing = state.records.find(r => r.id === id);
    return {
      id,
      productName: el('productName').value.trim(),
      shopName: el('shopName').value.trim(),
      tastedDate: el('tastedDate').value || todayISO(),
      purchasePlace: el('purchasePlace').value.trim(),
      yokanType: el('yokanType').value,
      flavorTags: el('flavorTags').value.trim(),
      servingTemp: el('servingTemp').value,
      sliceThickness: el('sliceThickness').value,
      pairing: el('pairing').value.trim(),
      profile: readRatingGroup('profile'),
      quality: readRatingGroup('quality'),
      photos: [...state.editingPhotos],
      comment: el('comment').value.trim(),
      visualNote: el('visualNote').value.trim(),
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  async function reloadRecords() {
    state.records = await dbGetAll();
  }

  function sortedRecords() {
    const sort = state.filters.sort;
    return [...state.records].sort((a, b) => {
      if (sort === 'date-asc') return (a.tastedDate || '').localeCompare(b.tastedDate || '');
      if (sort === 'score-desc') return (b.quality?.overall || 0) - (a.quality?.overall || 0);
      if (sort === 'score-asc') return (a.quality?.overall || 0) - (b.quality?.overall || 0);
      return (b.tastedDate || '').localeCompare(a.tastedDate || '');
    });
  }

  function recordMatchesFilters(r) {
    const q = state.filters.query.trim().toLocaleLowerCase('ja');
    const matchesQ = !q || [r.productName, r.shopName, r.flavorTags, r.comment, r.purchasePlace]
      .filter(Boolean).join(' ').toLocaleLowerCase('ja').includes(q);
    const matchesType = state.filters.type === 'all' || r.yokanType === state.filters.type;
    return matchesQ && matchesType;
  }

  function applyRecordFiltersDom() {
    let visible = 0;
    mainView.querySelectorAll('.record-card').forEach(card => {
      const r = state.records.find(x => x.id === card.dataset.recordId);
      const show = r && recordMatchesFilters(r);
      card.classList.toggle('hidden', !show);
      if (show) visible += 1;
    });
    const noMatch = el('noMatch');
    if (noMatch) noMatch.classList.toggle('hidden', visible > 0);
  }

  function recordCard(r) {
    const photo = r.photos?.[0];
    return `
      <article class="record-card" data-record-id="${esc(r.id)}" tabindex="0" role="button" aria-label="${esc(r.productName)}の記録を開く">
        ${photo ? `<img class="record-thumb" src="${photo}" alt="${esc(r.productName)}" />` : `<div class="record-thumb placeholder">羊羹</div>`}
        <div class="record-body">
          <div class="record-meta">
            <span class="record-type">${esc(r.yokanType || '羊羹')}</span>
            <span>${esc(formatDate(r.tastedDate))}</span>
          </div>
          <h2 class="record-title">${esc(r.productName)}</h2>
          <p class="record-shop">${esc(r.shopName)}</p>
          <div class="score-line"><span class="score-number">${r.quality?.overall ?? '—'}</span><span class="score-denom">/ 10 総合</span></div>
          ${r.comment ? `<p class="record-comment">${esc(r.comment)}</p>` : ''}
        </div>
      </article>`;
  }

  function renderRecords() {
    state.selectedId = null;
    const records = sortedRecords();
    const avg = state.records.length
      ? (state.records.reduce((sum, r) => sum + Number(r.quality?.overall || 0), 0) / state.records.length).toFixed(1)
      : '—';
    const types = ['all', ...new Set(state.records.map(r => r.yokanType).filter(Boolean))];

    mainView.innerHTML = `
      <section class="hero-stat">
        <div class="stat-block">
          <p class="stat-kicker">これまでの記録</p>
          <p class="stat-value">${state.records.length}<span style="font-size:14px;font-weight:400"> 本</span></p>
          <p class="stat-label">食べるほど、自分の好みが蓄積されます。</p>
        </div>
        <div class="stat-block">
          <p class="stat-kicker">平均総合評価</p>
          <p class="stat-value">${avg}</p>
          <p class="stat-label">10点満点</p>
        </div>
      </section>
      <section class="toolbar">
        <div class="search-wrap"><input id="searchInput" type="search" placeholder="商品名・店名・コメントを検索" value="${esc(state.filters.query)}" /></div>
        <div class="filter-row">
          <select id="typeFilter" aria-label="種類で絞り込み">
            ${types.map(t => `<option value="${esc(t)}" ${state.filters.type === t ? 'selected' : ''}>${t === 'all' ? 'すべての種類' : esc(t)}</option>`).join('')}
          </select>
          <select id="sortFilter" aria-label="並び順">
            <option value="date-desc" ${state.filters.sort === 'date-desc' ? 'selected' : ''}>新しい順</option>
            <option value="date-asc" ${state.filters.sort === 'date-asc' ? 'selected' : ''}>古い順</option>
            <option value="score-desc" ${state.filters.sort === 'score-desc' ? 'selected' : ''}>評価が高い順</option>
            <option value="score-asc" ${state.filters.sort === 'score-asc' ? 'selected' : ''}>評価が低い順</option>
          </select>
        </div>
      </section>
      ${state.records.length === 0
        ? document.getElementById('emptyTemplate').innerHTML
        : `<section class="record-list">${records.map(recordCard).join('')}</section><section id="noMatch" class="empty-state hidden"><h2>該当する記録がありません</h2><p>検索語や種類を変更してみてください。</p></section>`}
    `;

    el('searchInput')?.addEventListener('input', e => { state.filters.query = e.target.value; applyRecordFiltersDom(); });
    el('typeFilter')?.addEventListener('change', e => { state.filters.type = e.target.value; applyRecordFiltersDom(); });
    el('sortFilter')?.addEventListener('change', e => { state.filters.sort = e.target.value; renderRecords(); });
    mainView.querySelector('[data-empty-add]')?.addEventListener('click', () => openEditor());
    mainView.querySelectorAll('.record-card').forEach(card => {
      const open = () => openDetail(card.dataset.recordId);
      card.addEventListener('click', open);
      card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
    });
    applyRecordFiltersDom();
  }

  function profileBar(field, value) {
    const n = Number(value || 0);
    return `<div class="profile-row"><span class="profile-label">${esc(field.label)}</span><span class="profile-track"><span class="profile-fill" style="width:${Math.max(0,Math.min(100,n*10))}%"></span></span><span class="profile-num">${n}</span></div>`;
  }

  function qualityBox(field, value) {
    return `<div class="score-box"><span class="label">${esc(field.label)}</span><strong>${Number(value || 0)}</strong><span class="score-denom"> /10</span></div>`;
  }

  function openDetail(id) {
    const r = state.records.find(x => x.id === id);
    if (!r) return;
    state.selectedId = id;
    const photos = r.photos || [];
    mainView.innerHTML = `
      <section class="detail-page">
        <button class="detail-back" id="backToList" type="button">← 手帖へ戻る</button>
        ${photos[0] ? `<img class="detail-photo" src="${photos[0]}" alt="${esc(r.productName)}" />` : `<div class="detail-photo placeholder">羊羹</div>`}
        <div class="detail-title-wrap">
          <div class="detail-topline"><span>${esc(r.yokanType)}</span><span>・</span><span>${esc(formatDate(r.tastedDate))}</span></div>
          <h2>${esc(r.productName)}</h2>
          <p>${esc(r.shopName)}</p>
          <div class="detail-actions"><button class="secondary-btn" id="editRecordBtn" type="button">編集する</button></div>
        </div>
        <section class="detail-section">
          <h3>基本情報</h3>
          <dl class="detail-grid">
            ${detailItem('主な風味・素材', r.flavorTags || '—')}
            ${detailItem('食べた温度', r.servingTemp || '—')}
            ${detailItem('切る厚さ', r.sliceThickness || '—')}
            ${detailItem('合わせた飲み物', r.pairing || '—')}
            ${detailItem('購入・入手した場所', r.purchasePlace || '—')}
          </dl>
        </section>
        <section class="detail-section">
          <h3>個人的な評価</h3>
          <div class="score-grid">${QUALITY_FIELDS.map(f => qualityBox(f, r.quality?.[f.key])).join('')}</div>
        </section>
        <section class="detail-section">
          <h3>味わいプロファイル</h3>
          <div class="profile-bars">${PROFILE_FIELDS.map(f => profileBar(f, r.profile?.[f.key])).join('')}</div>
        </section>
        ${r.comment ? `<section class="detail-section"><h3>コメント</h3><div class="comment-block">${esc(r.comment)}</div></section>` : ''}
        ${r.visualNote ? `<section class="detail-section"><h3>断面・見た目メモ</h3><div class="comment-block">${esc(r.visualNote)}</div></section>` : ''}
        ${photos.length > 1 ? `<section class="detail-section"><h3>写真</h3><div class="photo-strip">${photos.map((p,i) => `<img src="${p}" alt="記録写真 ${i+1}" />`).join('')}</div></section>` : ''}
      </section>`;
    el('backToList').addEventListener('click', renderRecords);
    el('editRecordBtn').addEventListener('click', () => openEditor(r));
  }

  function detailItem(label, value) {
    return `<div class="detail-item"><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`;
  }

  function averageField(group, key) {
    if (!state.records.length) return null;
    const vals = state.records.map(r => Number(r[group]?.[key])).filter(v => Number.isFinite(v) && v > 0);
    if (!vals.length) return null;
    return vals.reduce((a,b) => a+b,0) / vals.length;
  }

  function renderAnalysis() {
    state.selectedId = null;
    if (!state.records.length) {
      mainView.innerHTML = `<section class="analysis-header"><h2>好みの傾向</h2><p>2〜3本以上記録すると、自分が好む羊羹の輪郭が見えやすくなります。</p></section>${document.getElementById('emptyTemplate').innerHTML}`;
      mainView.querySelector('[data-empty-add]')?.addEventListener('click', () => openEditor());
      return;
    }
    const averages = PROFILE_FIELDS.map(f => ({ ...f, value: averageField('profile', f.key) }));
    const top = [...state.records].sort((a,b) => (b.quality?.overall||0)-(a.quality?.overall||0)).slice(0,3);
    const typeCounts = Object.entries(state.records.reduce((acc,r) => { acc[r.yokanType] = (acc[r.yokanType] || 0) + 1; return acc; }, {})).sort((a,b)=>b[1]-a[1]);
    const avgOverall = averageField('quality','overall');

    mainView.innerHTML = `
      <section class="analysis-header"><h2>好みの傾向</h2><p>${state.records.length}本の記録から集計。平均値は「良い羊羹の基準」ではなく、あなたが食べてきた羊羹の傾向です。</p></section>
      <section class="analysis-card">
        <h3>味わいの平均プロファイル</h3>
        <div class="preference-list">
          ${averages.map(x => `<div class="preference-row"><span>${esc(x.label)}</span><span class="meter"><span style="width:${(x.value||0)*10}%"></span></span><span class="pref-value">${x.value?.toFixed(1) ?? '—'}</span></div>`).join('')}
        </div>
      </section>
      <section class="analysis-card">
        <h3>記録の内訳</h3>
        <div class="type-counts">${typeCounts.map(([type,count]) => `<span class="type-pill">${esc(type)} ${count}</span>`).join('')}</div>
        <p>総合評価の平均：<strong>${avgOverall?.toFixed(1) ?? '—'}</strong> / 10</p>
      </section>
      <section class="analysis-card">
        <h3>総合評価 上位</h3>
        ${top.map((r,i)=>`<p>${i+1}. <strong>${esc(r.productName)}</strong> — ${esc(r.shopName)}　${r.quality?.overall ?? '—'}/10</p>`).join('')}
      </section>
      <section class="analysis-card">
        <h3>読み方</h3>
        <p>「甘さ・濃厚さが高い＝好き」とは限りません。上位評価の記録が増えてきたら、その記録だけを見比べて、好みの範囲を探すのがおすすめです。</p>
      </section>`;
  }

  function exportBackup() {
    const payload = {
      app: '羊羹手帖',
      version: 1,
      exportedAt: new Date().toISOString(),
      records: state.records
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yokan-techo-backup-${todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function importBackup(file) {
    try {
      const payload = JSON.parse(await file.text());
      if (!payload || !Array.isArray(payload.records)) throw new Error('invalid backup');
      const ok = confirm(`${payload.records.length}件の記録を読み込みます。同じIDの記録は上書きされます。よろしいですか？`);
      if (!ok) return;
      for (const record of payload.records) {
        if (!record?.id || !record?.productName || !record?.shopName) continue;
        await dbPut(record);
      }
      await reloadRecords();
      showToast('バックアップを読み込みました');
      renderGuide();
    } catch (err) {
      console.error(err);
      showToast('バックアップを読み込めませんでした');
    }
  }

  function renderGuide() {
    state.selectedId = null;
    mainView.innerHTML = `
      <section class="guide-page">
        <h2>評価の見方</h2>
        <p>同じ10段階でも「特徴」と「評価」を分けます。ここを混ぜないことが、比較しやすい記録のコツです。</p>
        <section class="guide-card">
          <h3>味わいプロファイル</h3>
          <p>数値が高いほど優れている、という意味ではありません。羊羹がどちら側の特徴を持つかを記録します。</p>
          ${PROFILE_FIELDS.map(f => `<p><strong>${esc(f.label)}</strong></p><div class="guide-scale"><span>${esc(f.low)} 1</span><span class="line"></span><span>10 ${esc(f.high)}</span></div>`).join('')}
        </section>
        <section class="guide-card">
          <h3>個人的な評価</h3>
          <p>こちらは高いほど「自分にとって良い」です。特に総合評価は、他の点数の平均ではなく、その日の自分の満足度として独立してつけます。</p>
          <ul class="guide-list">
            <li><strong>素材の風味：</strong>小豆・栗・黒糖など、その商品の主役が魅力的に感じられたか。</li>
            <li><strong>甘味のバランス：</strong>甘さの強弱ではなく、素材や食感との釣り合い。</li>
            <li><strong>舌触り・食感：</strong>なめらかさ、粒感、歯切れ、密度を含めた好み。</li>
            <li><strong>後味：</strong>食べ終わった後の甘味・香り・雑味を含む印象。</li>
            <li><strong>また食べたい：</strong>再購入意向。価格は採点から分け、必要ならコメントに残す。</li>
            <li><strong>総合評価：</strong>その日の最終的な好み。平均点に合わせる必要はありません。</li>
          </ul>
        </section>
        <section class="guide-card">
          <h3>比較するときの条件</h3>
          <p>温度や切る厚さで甘味・香り・食感の感じ方が変わります。できるだけ同条件で比べるか、違う場合は「食べた温度」「切る厚さ」を残してください。</p>
        </section>
        <section class="guide-card">
          <h3>データ管理</h3>
          <p>記録と写真はこのブラウザ内に保存されます。機種変更やサイトデータ削除に備え、定期的にJSONバックアップを保存してください。</p>
          <div class="detail-actions">
            <button id="exportBtn" class="secondary-btn" type="button">バックアップを書き出す</button>
            <label class="photo-picker"><input id="importInput" type="file" accept="application/json,.json" /><span>バックアップを読み込む</span></label>
          </div>
        </section>
      </section>`;
    el('exportBtn')?.addEventListener('click', exportBackup);
    el('importInput')?.addEventListener('change', e => { const f = e.target.files?.[0]; if (f) importBackup(f); });
  }

  function setActiveView(view) {
    state.activeView = view;
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
    if (view === 'analysis') renderAnalysis();
    else if (view === 'guide') renderGuide();
    else renderRecords();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const record = collectFormRecord();
    try {
      await dbPut(record);
      await reloadRecords();
      closeEditor();
      showToast('記録しました');
      if (state.activeView === 'records') openDetail(record.id);
      else setActiveView(state.activeView);
    } catch (err) {
      console.error(err);
      showToast('保存できませんでした');
    }
  }

  async function handleDelete() {
    const id = el('recordId').value;
    if (!id) return;
    const record = state.records.find(r => r.id === id);
    const ok = confirm(`「${record?.productName || 'この記録'}」を削除しますか？`);
    if (!ok) return;
    try {
      await dbDelete(id);
      await reloadRecords();
      closeEditor();
      showToast('削除しました');
      setActiveView('records');
    } catch (err) {
      console.error(err);
      showToast('削除できませんでした');
    }
  }

  function bindGlobalEvents() {
    el('addBtn').addEventListener('click', () => openEditor());
    el('closeEditorBtn').addEventListener('click', closeEditor);
    el('photoInput').addEventListener('change', e => onPhotoInput(e.target.files));
    el('photoPreview').addEventListener('click', e => {
      const btn = e.target.closest('[data-photo-remove]');
      if (!btn) return;
      state.editingPhotos.splice(Number(btn.dataset.photoRemove), 1);
      renderPhotoPreview();
    });
    el('deleteBtn').addEventListener('click', handleDelete);
    form.addEventListener('submit', handleSubmit);
    document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => setActiveView(btn.dataset.view)));
    dialog.addEventListener('click', e => {
      if (e.target === dialog) closeEditor();
    });
  }

  async function init() {
    initSliders();
    bindGlobalEvents();
    try {
      await reloadRecords();
    } catch (err) {
      console.error(err);
      mainView.innerHTML = `<section class="empty-state"><h2>保存領域を開けませんでした</h2><p>Safariのプライベートブラウズ等では保存できない場合があります。</p></section>`;
      return;
    }
    renderRecords();
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(console.error);
    }
  }

  init();
})();
