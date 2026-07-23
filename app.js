const STORAGE_KEY = 'eas-products-v061';
const LEGACY_KEYS = ['eas-products-v040'];
const SETTINGS_KEY = 'eas-settings-v061';
const LEGACY_SETTINGS_KEYS = ['eas-settings-v040'];

const defaults = {
  exchangeRate: 1390,
  feeRate: 13.25,
  adRate: 2,
  returnReserveRate: 2,
  internationalShipping: 25000,
  packingCost: 2000,
  fixedFeeUsd: 0.4,
  targetProfit: 50000,
  targetRoi: 40,
};

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function migrateValue(primary, legacyKeys, fallback) {
  const current = readJson(primary, null);
  if (current !== null) return current;
  for (const key of legacyKeys) {
    const legacy = readJson(key, null);
    if (legacy !== null) {
      localStorage.setItem(primary, JSON.stringify(legacy));
      return legacy;
    }
  }
  return fallback;
}

let settings = { ...defaults, ...migrateValue(SETTINGS_KEY, LEGACY_SETTINGS_KEYS, {}) };
let products = migrateValue(STORAGE_KEY, LEGACY_KEYS, []);
let route = 'dashboard';
let editingId = null;

const app = document.querySelector('#app');
const title = document.querySelector('#page-title');
const photoInput = document.querySelector('#photo-input');

const won = (n) => new Intl.NumberFormat('ko-KR', {
  style: 'currency', currency: 'KRW', maximumFractionDigits: 0,
}).format(Number(n) || 0);
const usd = (n) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 2,
}).format(Number(n) || 0);
const save = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(products));
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));
}
function val(id) { return document.querySelector(`#${id}`)?.value ?? ''; }
function num(id) { return Number(val(id)) || 0; }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }

function calculate(input) {
  const purchasePrice = Number(input.purchasePrice) || 0;
  const sellingPrice = Number(input.sellingPrice) || 0;
  const shipping = Number(input.shipping) || 0;
  const packing = Number(input.packing) || 0;
  const exchangeRate = Number(input.exchangeRate) || 1;
  const totalPercent = (
    (Number(input.feeRate) || 0)
    + (Number(input.adRate) || 0)
    + (Number(input.returnReserveRate) || 0)
  ) / 100;
  const fixedFeeKrw = (Number(input.fixedFeeUsd) || 0) * exchangeRate;
  const salesKrw = sellingPrice * exchangeRate;
  const variableFees = salesKrw * totalPercent;
  const totalCost = purchasePrice + shipping + packing + fixedFeeKrw + variableFees;
  const profit = salesKrw - totalCost;
  const roi = purchasePrice > 0 ? (profit / purchasePrice) * 100 : 0;
  const margin = salesKrw > 0 ? (profit / salesKrw) * 100 : 0;
  const denominator = exchangeRate * Math.max(0.01, 1 - totalPercent);
  const breakEven = (purchasePrice + shipping + packing + fixedFeeKrw) / denominator;

  let score = 0;
  if (profit > 0) score += Math.min(40, (profit / Math.max(1, Number(input.targetProfit) || settings.targetProfit)) * 40);
  if (roi > 0) score += Math.min(40, (roi / Math.max(1, Number(input.targetRoi) || settings.targetRoi)) * 40);
  if (margin >= 10) score += Math.min(20, margin);
  score = Math.max(0, Math.min(100, Math.round(score)));

  let decision = 'PASS';
  if (profit >= (Number(input.targetProfit) || settings.targetProfit) && roi >= (Number(input.targetRoi) || settings.targetRoi)) decision = 'BUY';
  else if (profit > 0 && roi >= Math.max(15, (Number(input.targetRoi) || settings.targetRoi) * 0.55)) decision = 'CONSIDER';

  return { salesKrw, variableFees, fixedFeeKrw, totalCost, profit, roi, margin, breakEven, score, decision };
}

function nav(nextRoute) {
  route = nextRoute;
  editingId = null;
  document.querySelectorAll('.bottom-nav button').forEach((button) => {
    button.classList.toggle('active', button.dataset.route === nextRoute);
  });
  render();
}

function render() {
  const views = {
    dashboard: renderDashboard,
    products: renderProducts,
    calculator: renderCalculator,
    settings: renderSettings,
    editor: renderEditor,
    detail: renderDetail,
  };
  (views[route] || renderDashboard)();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function empty(message) {
  return `<div class="card empty"><div class="big">📭</div><p>${esc(message)}</p></div>`;
}

function decisionBadge(result) {
  if (!result) return '<span class="decision decision-draft">미계산</span>';
  return `<span class="decision decision-${result.decision.toLowerCase()}">${result.decision}</span>`;
}

function productCard(product) {
  const name = [product.brand, product.productName || product.model].filter(Boolean).join(' ') || '이름 없는 상품';
  return `<article class="card product-card" data-id="${product.id}">
    ${product.photos?.[0] ? `<img class="thumb" src="${product.photos[0]}" alt="">` : '<div class="thumb">📦</div>'}
    <div class="product-body">
      <div class="row between"><h3>${esc(name)}</h3>${decisionBadge(product.result)}</div>
      <p class="muted tiny">${esc(product.barcode || '바코드 없음')} · ${product.result ? usd(product.sellingPrice) : '판매가 미입력'}</p>
      <div class="row between"><span class="profit">${product.result ? won(product.result.profit) : '미계산'}</span><strong>${product.result ? `Score ${product.result.score}` : ''}</strong></div>
    </div>
  </article>`;
}

function bindProductCards() {
  document.querySelectorAll('[data-id]').forEach((element) => {
    element.addEventListener('click', () => {
      editingId = element.dataset.id;
      route = 'detail';
      render();
    });
  });
}

function renderDashboard() {
  title.textContent = '대시보드';
  const evaluated = products.filter((product) => product.result);
  const buyCount = evaluated.filter((product) => product.result.decision === 'BUY').length;
  const totalProfit = evaluated.reduce((sum, product) => sum + product.result.profit, 0);
  const avgScore = evaluated.length ? evaluated.reduce((sum, product) => sum + product.result.score, 0) / evaluated.length : 0;

  app.innerHTML = `
    <section class="grid stats">
      <div class="card stat"><span class="muted">전체 상품</span><strong>${products.length}</strong></div>
      <div class="card stat"><span class="muted">BUY 판정</span><strong>${buyCount}</strong></div>
      <div class="card stat"><span class="muted">예상 순이익</span><strong>${won(totalProfit)}</strong></div>
      <div class="card stat"><span class="muted">평균 점수</span><strong>${avgScore.toFixed(0)}</strong></div>
    </section>
    <section class="hero-card">
      <p class="eyebrow light">SOURCING WORKFLOW</p>
      <h2>현장에서 바로 찍고,<br>매입 여부를 판단하세요.</h2>
      <button class="primary inverse full" id="quick-new">＋ 새 상품 분석</button>
    </section>
    <div class="section-title"><h2>최근 상품</h2><button class="text-button" id="all-products">전체 보기</button></div>
    <section class="grid">${products.slice().reverse().slice(0, 4).map(productCard).join('') || empty('첫 상품을 등록해 보세요.')}</section>`;

  document.querySelector('#quick-new').onclick = () => openEditor();
  document.querySelector('#all-products').onclick = () => nav('products');
  bindProductCards();
}

function renderProducts() {
  title.textContent = '상품';
  app.innerHTML = `
    <div class="search field"><input id="q" type="search" placeholder="브랜드, 상품명, 바코드 검색"></div>
    <div class="filter-row" id="filters">
      <button class="chip active" data-filter="ALL">전체</button>
      <button class="chip" data-filter="BUY">BUY</button>
      <button class="chip" data-filter="CONSIDER">CONSIDER</button>
      <button class="chip" data-filter="PASS">PASS</button>
    </div>
    <section class="grid" id="product-list"></section>`;

  const search = document.querySelector('#q');
  const list = document.querySelector('#product-list');
  let filter = 'ALL';
  function draw() {
    const term = search.value.trim().toLowerCase();
    const rows = products.filter((product) => {
      const matchesText = !term || JSON.stringify(product).toLowerCase().includes(term);
      const matchesFilter = filter === 'ALL' || product.result?.decision === filter;
      return matchesText && matchesFilter;
    });
    list.innerHTML = rows.slice().reverse().map(productCard).join('') || empty('조건에 맞는 상품이 없습니다.');
    bindProductCards();
  }
  search.oninput = draw;
  document.querySelectorAll('[data-filter]').forEach((button) => {
    button.onclick = () => {
      filter = button.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
      draw();
    };
  });
  draw();
}

function openEditor(id = null) {
  editingId = id;
  route = 'editor';
  render();
}

function renderEditor() {
  title.textContent = editingId ? '상품 편집' : '새 상품 분석';
  const existing = products.find((item) => item.id === editingId);
  const product = existing ? structuredClone(existing) : {
    id: uid(), brand: '', productName: '', barcode: '', photos: [], purchasePrice: '', sellingPrice: '',
    shipping: settings.internationalShipping, packing: settings.packingCost, notes: '',
  };
  let photos = [...(product.photos || [])];

  app.innerHTML = `<form id="product-form" novalidate>
    <section class="card">
      <h2 class="form-title">1. 상품 정보</h2>
      <div class="photo-grid" id="photos">
        ${photos.map((src, index) => `<div class="photo"><img src="${src}" alt="상품 사진"><button type="button" data-remove-photo="${index}" aria-label="사진 삭제">×</button></div>`).join('')}
        <button type="button" class="photo-add" id="add-photo"><span>📷</span><b>사진 촬영</b></button>
      </div>
      <div class="field"><label for="brand">브랜드</label><input id="brand" autocomplete="organization" value="${esc(product.brand)}" placeholder="예: Nike"></div>
      <div class="field"><label for="productName">상품명 / 모델</label><input id="productName" value="${esc(product.productName || product.model || '')}" placeholder="예: Air Max 97"></div>
      <div class="field"><label for="barcode">바코드 / UPC</label><div class="input-with-action"><input id="barcode" inputmode="numeric" value="${esc(product.barcode)}" placeholder="숫자를 입력하세요"><button type="button" id="barcode-photo">📷</button></div><small class="helper">현재 버전은 직접 입력 방식입니다.</small></div>
    </section>
    <section class="card">
      <h2 class="form-title">2. 가격 입력</h2>
      <div class="field"><label for="purchasePrice">매입가 (KRW)</label><input id="purchasePrice" type="number" inputmode="numeric" min="0" value="${product.purchasePrice || ''}" placeholder="100000" required></div>
      <div class="field"><label for="sellingPrice">eBay 예상 판매가 (USD)</label><input id="sellingPrice" type="number" inputmode="decimal" min="0" step="0.01" value="${product.sellingPrice || ''}" placeholder="149.99" required></div>
      <div class="two-col">
        <div class="field"><label for="shipping">국제배송비</label><input id="shipping" type="number" inputmode="numeric" min="0" value="${product.shipping ?? settings.internationalShipping}"></div>
        <div class="field"><label for="packing">포장비</label><input id="packing" type="number" inputmode="numeric" min="0" value="${product.packing ?? settings.packingCost}"></div>
      </div>
      <div id="live-result"></div>
    </section>
    <section class="card"><div class="field no-margin"><label for="notes">메모</label><textarea id="notes" placeholder="매장, 사이즈, 특징 등을 기록하세요.">${esc(product.notes)}</textarea></div></section>
    <div class="sticky-actions"><button type="button" class="secondary" id="cancel">취소</button><button class="primary" type="submit">저장</button></div>
  </form>`;

  function currentResult() {
    return calculate({
      ...settings,
      purchasePrice: num('purchasePrice'), sellingPrice: num('sellingPrice'),
      shipping: num('shipping'), packing: num('packing'),
    });
  }
  function drawLive() {
    const holder = document.querySelector('#live-result');
    if (!num('purchasePrice') || !num('sellingPrice')) {
      holder.innerHTML = '<div class="inline-hint">매입가와 판매가를 입력하면 즉시 분석됩니다.</div>';
      return;
    }
    holder.innerHTML = resultCompact(currentResult());
  }
  ['purchasePrice', 'sellingPrice', 'shipping', 'packing'].forEach((id) => document.querySelector(`#${id}`).addEventListener('input', drawLive));
  drawLive();

  function rebindPhotoButtons() {
    document.querySelectorAll('[data-remove-photo]').forEach((button) => {
      button.onclick = () => { photos.splice(Number(button.dataset.removePhoto), 1); renderEditorWithPhotos(); };
    });
  }
  function renderEditorWithPhotos() {
    product.photos = photos;
    const draft = {
      ...product,
      brand: val('brand'), productName: val('productName'), barcode: val('barcode'),
      purchasePrice: num('purchasePrice'), sellingPrice: num('sellingPrice'),
      shipping: num('shipping'), packing: num('packing'), notes: val('notes'), photos,
    };
    const tempId = product.id;
    products = products.filter((item) => item.id !== '__temporary__');
    Object.assign(product, draft, { id: tempId });
    renderEditor();
  }
  rebindPhotoButtons();

  document.querySelector('#add-photo').onclick = () => photoInput.click();
  document.querySelector('#barcode-photo').onclick = () => {
    alert('바코드 사진 인식은 다음 버전에서 연결합니다. 지금은 번호를 직접 입력해 주세요.');
    document.querySelector('#barcode').focus();
  };
  photoInput.onchange = async (event) => {
    const selected = [...event.target.files].slice(0, Math.max(0, 6 - photos.length));
    for (const file of selected) photos.push(await compress(file));
    event.target.value = '';
    product.photos = photos;
    renderEditor();
  };
  document.querySelector('#cancel').onclick = () => nav(existing ? 'products' : 'dashboard');
  document.querySelector('#product-form').onsubmit = (event) => {
    event.preventDefault();
    if (!num('purchasePrice') || !num('sellingPrice')) {
      alert('매입가와 판매가를 입력해 주세요.');
      return;
    }
    const data = {
      ...product,
      id: existing?.id || product.id,
      brand: val('brand').trim(),
      productName: val('productName').trim(),
      barcode: val('barcode').trim(),
      purchasePrice: num('purchasePrice'),
      sellingPrice: num('sellingPrice'),
      shipping: num('shipping'),
      packing: num('packing'),
      notes: val('notes').trim(),
      photos,
      updatedAt: new Date().toISOString(),
    };
    data.result = calculate({ ...settings, ...data });
    const index = products.findIndex((item) => item.id === data.id);
    if (index >= 0) products[index] = data; else products.push(data);
    save();
    editingId = data.id;
    route = 'detail';
    render();
  };
}

function resultCompact(result) {
  return `<div class="analysis-strip">
    <div>${decisionBadge(result)}<strong>${result.score}<small>/100</small></strong></div>
    <div><span>예상 순이익</span><b>${won(result.profit)}</b></div>
    <div><span>ROI</span><b>${result.roi.toFixed(1)}%</b></div>
  </div>`;
}

function resultFull(result) {
  return `<section class="result-hero decision-bg-${result.decision.toLowerCase()}">
    <div class="row between"><div><span class="result-label">매입 판정</span><div class="result-decision">${result.decision}</div></div><div class="score-ring"><strong>${result.score}</strong><small>BUY SCORE</small></div></div>
    <div class="result-grid">
      <div class="result-cell"><span>판매 매출</span><strong>${won(result.salesKrw)}</strong></div>
      <div class="result-cell"><span>예상 순이익</span><strong>${won(result.profit)}</strong></div>
      <div class="result-cell"><span>ROI</span><strong>${result.roi.toFixed(1)}%</strong></div>
      <div class="result-cell"><span>마진율</span><strong>${result.margin.toFixed(1)}%</strong></div>
    </div>
  </section>`;
}

function renderDetail() {
  const product = products.find((item) => item.id === editingId);
  if (!product) { nav('products'); return; }
  title.textContent = '상품 분석';
  const name = [product.brand, product.productName || product.model].filter(Boolean).join(' ') || '이름 없는 상품';
  app.innerHTML = `
    ${resultFull(product.result)}
    <section class="card detail-card">
      ${product.photos?.length ? `<div class="detail-photo"><img src="${product.photos[0]}" alt="상품 사진"></div>` : ''}
      <h2>${esc(name)}</h2>
      <p class="muted">${esc(product.barcode || '바코드 없음')}</p>
      <dl class="detail-list">
        <div><dt>매입가</dt><dd>${won(product.purchasePrice)}</dd></div>
        <div><dt>판매가</dt><dd>${usd(product.sellingPrice)}</dd></div>
        <div><dt>수수료·충당금</dt><dd>${won(product.result.variableFees + product.result.fixedFeeKrw)}</dd></div>
        <div><dt>배송·포장</dt><dd>${won(product.shipping + product.packing)}</dd></div>
        <div><dt>손익분기 판매가</dt><dd>${usd(product.result.breakEven)}</dd></div>
      </dl>
      ${product.notes ? `<div class="note-box">${esc(product.notes)}</div>` : ''}
    </section>
    <div class="actions"><button class="danger" id="delete">삭제</button><button class="primary" id="edit">편집</button></div>`;
  document.querySelector('#edit').onclick = () => openEditor(product.id);
  document.querySelector('#delete').onclick = () => {
    if (confirm('이 상품을 삭제할까요?')) {
      products = products.filter((item) => item.id !== product.id);
      save();
      nav('products');
    }
  };
}

function renderCalculator() {
  title.textContent = '빠른 계산';
  app.innerHTML = `<section class="card">
    <div class="field"><label for="purchasePrice">매입가 (KRW)</label><input id="purchasePrice" type="number" inputmode="numeric" placeholder="100000"></div>
    <div class="field"><label for="sellingPrice">판매가 (USD)</label><input id="sellingPrice" type="number" inputmode="decimal" step="0.01" placeholder="149.99"></div>
    <div class="two-col"><div class="field"><label for="shipping">배송비</label><input id="shipping" type="number" value="${settings.internationalShipping}"></div><div class="field"><label for="packing">포장비</label><input id="packing" type="number" value="${settings.packingCost}"></div></div>
  </section><div id="calc-result"></div>`;
  function draw() {
    const result = calculate({ ...settings, purchasePrice: num('purchasePrice'), sellingPrice: num('sellingPrice'), shipping: num('shipping'), packing: num('packing') });
    document.querySelector('#calc-result').innerHTML = num('purchasePrice') && num('sellingPrice') ? `${resultFull(result)}<section class="card"><dl class="detail-list"><div><dt>총비용</dt><dd>${won(result.totalCost)}</dd></div><div><dt>손익분기 판매가</dt><dd>${usd(result.breakEven)}</dd></div></dl></section>` : '';
  }
  ['purchasePrice', 'sellingPrice', 'shipping', 'packing'].forEach((id) => document.querySelector(`#${id}`).oninput = draw);
}

function renderSettings() {
  title.textContent = '설정';
  app.innerHTML = `<section class="card">
    <div class="field"><label for="exchangeRate">환율 (1 USD → KRW)</label><input id="exchangeRate" type="number" value="${settings.exchangeRate}"></div>
    <div class="two-col"><div class="field"><label for="feeRate">eBay 수수료 (%)</label><input id="feeRate" type="number" step="0.01" value="${settings.feeRate}"></div><div class="field"><label for="adRate">광고율 (%)</label><input id="adRate" type="number" step="0.1" value="${settings.adRate}"></div></div>
    <div class="two-col"><div class="field"><label for="returnReserveRate">반품 충당률 (%)</label><input id="returnReserveRate" type="number" step="0.1" value="${settings.returnReserveRate}"></div><div class="field"><label for="fixedFeeUsd">고정 수수료 (USD)</label><input id="fixedFeeUsd" type="number" step="0.01" value="${settings.fixedFeeUsd}"></div></div>
    <div class="two-col"><div class="field"><label for="targetProfit">목표 순이익</label><input id="targetProfit" type="number" value="${settings.targetProfit}"></div><div class="field"><label for="targetRoi">목표 ROI (%)</label><input id="targetRoi" type="number" value="${settings.targetRoi}"></div></div>
    <button class="primary full" id="save-settings">설정 저장</button>
  </section>
  <section class="card install-note"><strong>아이폰 설치 방법</strong><p>Safari에서 배포 주소를 연 뒤 공유 → 홈 화면에 추가를 누르세요. 상품 데이터는 이 기기에 저장됩니다.</p></section>
  <section class="card"><button class="secondary full" id="export-data">데이터 내보내기</button></section>`;
  document.querySelector('#save-settings').onclick = () => {
    ['exchangeRate', 'feeRate', 'adRate', 'returnReserveRate', 'fixedFeeUsd', 'targetProfit', 'targetRoi'].forEach((key) => { settings[key] = num(key); });
    saveSettings();
    alert('설정을 저장했습니다.');
  };
  document.querySelector('#export-data').onclick = () => {
    const blob = new Blob([JSON.stringify({ version: '0.6.1', exportedAt: new Date().toISOString(), settings, products }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `EAS-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
}

async function compress(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      const max = 1400;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale);
      canvas.height = Math.round(image.height * scale);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.76));
    };
    image.onerror = reject;
    image.src = url;
  });
}

document.querySelectorAll('.bottom-nav button').forEach((button) => { button.onclick = () => nav(button.dataset.route); });
document.querySelector('#new-product-top').onclick = () => openEditor();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
render();
