const STORAGE_KEY = 'eas-products-v111';
const LEGACY_KEYS = ['eas-products-v110', 'eas-products-v101', 'eas-products-v100', 'eas-products-v090', 'eas-products-v080', 'eas-products-v070', 'eas-products-v061', 'eas-products-v040'];
const SETTINGS_KEY = 'eas-settings-v111';
const LEGACY_SETTINGS_KEYS = ['eas-settings-v110', 'eas-settings-v101', 'eas-settings-v100', 'eas-settings-v090', 'eas-settings-v080', 'eas-settings-v070', 'eas-settings-v061', 'eas-settings-v040'];

const defaults = {
  exchangeRate: 1390,
  exchangeMode: 'conservative',
  manualExchangeRate: 1390,
  latestExchangeRate: 1390,
  exchangeRateDate: '',
  exchangeRateUpdatedAt: '',
  exchangeRateSource: 'Frankfurter',
  conservativeRatePercent: 98,
  feeRate: 13.25,
  adRate: 2,
  returnReserveRate: 2,
  internationalShipping: 25000,
  packingCost: 2000,
  fixedFeeUsd: 0.4,
  targetProfit: 50000,
  targetRoi: 40,
  aiEndpoint: 'https://black-snow-e236.wlstjd88.workers.dev/analyze',
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

const APP_VERSION = '1.1.1';
const app = document.querySelector('#app');
const title = document.querySelector('#page-title');
const photoInput = document.querySelector('#photo-input');
const barcodeImageInput = document.querySelector('#barcode-image-input');

const won = (n) => new Intl.NumberFormat('ko-KR', {
  style: 'currency', currency: 'KRW', maximumFractionDigits: 0,
}).format(Number(n) || 0);
const usd = (n) => new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 2,
}).format(Number(n) || 0);
function persist(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error('localStorage 저장 실패', error);
    alert('기기 저장 공간이 부족해 저장하지 못했습니다. 사진 수를 줄이거나 설정에서 데이터를 백업한 뒤 불필요한 상품을 삭제해 주세요.');
    return false;
  }
}
const save = () => persist(STORAGE_KEY, products);
const saveSettings = () => persist(SETTINGS_KEY, settings);

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  }[char]));
}
function val(id) { return document.querySelector(`#${id}`)?.value ?? ''; }
function num(id) { return Number(val(id)) || 0; }
function uid() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`; }


function normalizeBarcode(value) {
  return String(value || '').replace(/\D/g, '');
}

function barcodeKind(value) {
  const code = normalizeBarcode(value);
  if (code.length === 8) return 'EAN-8';
  if (code.length === 12) return 'UPC-A';
  if (code.length === 13) return 'EAN-13';
  return '';
}

function isValidGtin(value) {
  const code = normalizeBarcode(value);
  if (![8, 12, 13].includes(code.length)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop();
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return ((10 - (sum % 10)) % 10) === check;
}


function cleanAiText(value, max = 120) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
}

function normalizeAiValue(value, max = 120) {
  const cleaned = cleanAiText(value, max);
  return /^(unknown|n\/a|not sure|미상|확인 불가)$/i.test(cleaned) ? '' : cleaned;
}

function aiConditionLabel(condition) {
  return ({ NEW: '새상품 추정', USED: '중고 추정', UNKNOWN: '상태 미확인' })[condition] || '상태 미확인';
}

function aiResultHeadline(ai = {}) {
  if (ai.condition === 'NEW') return '새상품 추정';
  if (ai.condition === 'USED') return '중고상품 추정';
  if (ai.brand || ai.productName || ai.modelNumber) return '상품 식별 완료';
  return '모델 확인 필요';
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function requestAiAnalysisWithRetry(payload, onRetry) {
  const maxAttempts = 2; // 최초 요청 + 조건부 자동 재시도 1회
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await requestAiAnalysis(payload);
    } catch (error) {
      lastError = error;
      if (!error?.retryable || attempt >= maxAttempts) throw error;

      // 429는 서버가 알려준 대기 시간을 우선 사용합니다. 연속 재시도로 무료 한도를 낭비하지 않습니다.
      const baseDelay = error.status === 429
        ? Math.max(1000, Math.min(30000, Number(error.retryAfterMs) || 10000))
        : 3000;
      const delay = baseDelay + Math.floor(Math.random() * 700);
      onRetry?.(attempt + 1, maxAttempts, delay, error);
      await sleep(delay);
    }
  }
  throw lastError;
}

function effectiveExchangeRate() {
  if (settings.exchangeMode === 'manual') return Number(settings.manualExchangeRate) || Number(settings.exchangeRate) || 1390;
  const latest = Number(settings.latestExchangeRate) || Number(settings.exchangeRate) || 1390;
  if (settings.exchangeMode === 'latest') return Math.round(latest);
  return Math.round(latest * ((Number(settings.conservativeRatePercent) || 98) / 100));
}

function applyExchangeMode() {
  settings.exchangeRate = effectiveExchangeRate();
  return settings.exchangeRate;
}

async function fetchLatestExchangeRate({ force = false } = {}) {
  const last = Date.parse(settings.exchangeRateUpdatedAt || '') || 0;
  if (!force && last && Date.now() - last < 12 * 60 * 60 * 1000) return settings.latestExchangeRate;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('https://api.frankfurter.dev/v2/rate/USD/KRW', { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`환율 API 오류 (${response.status})`);
    const data = await response.json();
    const rate = Number(data?.rate);
    if (!Number.isFinite(rate) || rate < 500 || rate > 3000) throw new Error('환율 응답이 올바르지 않습니다.');
    settings.latestExchangeRate = rate;
    settings.exchangeRateDate = String(data.date || '');
    settings.exchangeRateUpdatedAt = new Date().toISOString();
    settings.exchangeRateSource = 'Frankfurter 중앙은행 기준환율';
    applyExchangeMode();
    saveSettings();
    return rate;
  } finally {
    clearTimeout(timeout);
  }
}

function exchangeModeLabel(mode = settings.exchangeMode) {
  return ({ latest: '최신 기준환율', conservative: '보수환율', manual: '직접 입력' })[mode] || '보수환율';
}

function buildSearchKeyword(data = {}) {
  return [data.brand, data.productName, data.color, data.category, data.condition === 'NEW' ? 'New' : '']
    .map((item) => normalizeAiValue(item, 50))
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

class AiRequestError extends Error {
  constructor(code, message, status = 0, retryable = false, retryAfterMs = 0) {
    super(message || code);
    this.name = 'AiRequestError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = Math.max(0, Number(retryAfterMs) || 0);
  }
}

function parseRetryAfterMs(response, raw) {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header * 1000);
  const bodySeconds = Number(raw?.retryAfterSeconds);
  if (Number.isFinite(bodySeconds) && bodySeconds > 0) return Math.ceil(bodySeconds * 1000);
  const text = String(raw?.message || raw?.details || '');
  const match = /retry(?:\s+in|Delay[^0-9]*)?\s*([0-9]+(?:\.[0-9]+)?)\s*s/i.exec(text);
  return match ? Math.ceil(Number(match[1]) * 1000) : 0;
}

async function requestAiAnalysis({ photos, barcode, brand, productName }) {
  const endpoint = String(settings.aiEndpoint || '').trim();
  if (!endpoint) throw new AiRequestError('AI_ENDPOINT_MISSING', 'AI 분석 서버 주소가 없습니다.');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        app: 'EAS', version: APP_VERSION, barcode, brand, productName,
        photos: (photos || []).slice(0, 3),
        requestedFields: ['brand', 'productName', 'modelNumber', 'size', 'category', 'color', 'condition', 'confidence', 'searchKeyword', 'summary'],
      }),
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw new AiRequestError('AI_TIMEOUT', 'AI 응답 시간이 초과되었습니다.', 0, true);
    throw new AiRequestError('AI_NETWORK', 'AI 서버에 연결하지 못했습니다.', 0, true);
  } finally {
    clearTimeout(timeout);
  }

  const contentType = response.headers.get('content-type') || '';
  let raw = null;
  try {
    raw = contentType.includes('application/json') ? await response.json() : { message: await response.text() };
  } catch {
    raw = {};
  }

  if (!response.ok) {
    const serverMessage = normalizeAiValue(raw?.message || raw?.error || raw?.details, 300);
    const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
    const retryAfterMs = parseRetryAfterMs(response, raw);
    throw new AiRequestError(
      `AI_HTTP_${response.status}`,
      serverMessage || `AI 서버 오류 (${response.status})`,
      response.status,
      retryable,
      retryAfterMs,
    );
  }

  const condition = ['NEW', 'USED', 'UNKNOWN'].includes(String(raw.condition || '').toUpperCase())
    ? String(raw.condition).toUpperCase() : 'UNKNOWN';
  const confidence = Math.max(0, Math.min(100, Number(raw.confidence) || 0));
  const result = {
    brand: normalizeAiValue(raw.brand, 60),
    productName: normalizeAiValue(raw.productName || raw.model, 100),
    modelNumber: normalizeAiValue(raw.modelNumber || raw.styleCode || raw.sku, 60),
    size: normalizeAiValue(raw.size, 60),
    category: normalizeAiValue(raw.category, 60),
    color: normalizeAiValue(raw.color, 60),
    condition, confidence,
    searchKeyword: normalizeAiValue(raw.searchKeyword, 180),
    summary: normalizeAiValue(raw.summary, 400),
    analyzedAt: new Date().toISOString(),
  };
  if (!result.searchKeyword) result.searchKeyword = buildSearchKeyword(result);
  return result;
}

function aiErrorPresentation(error) {
  const code = String(error?.code || error?.message || 'AI_UNKNOWN');
  const status = Number(error?.status) || 0;
  if (code === 'AI_ENDPOINT_MISSING') return { title: '서버 주소 확인 필요', detail: '설정의 AI 분석 서버 주소를 확인해 주세요.', retry: false };
  if (code === 'AI_TIMEOUT') return { title: '응답 시간 초과', detail: '사진 수를 줄이거나 잠시 후 다시 시도해 주세요.', retry: true };
  if (code === 'AI_NETWORK') return { title: '연결 실패', detail: '인터넷 연결을 확인한 뒤 다시 시도해 주세요.', retry: true };
  if (status === 429) {
    const seconds = Math.max(1, Math.ceil((Number(error?.retryAfterMs) || 10000) / 1000));
    return { title: 'Gemini 무료 사용량 제한', detail: `요청 한도에 도달했습니다. 약 ${seconds}초 후 다시 시도해 주세요.`, retry: true, cooldownSeconds: seconds };
  }
  if (status === 503 || status === 502) return { title: 'AI 서버 혼잡', detail: 'Gemini 서버가 일시적으로 혼잡합니다. 잠시 후 재시도해 주세요.', retry: true };
  if (status === 400) return { title: '사진 분석 요청 오류', detail: error.message || '사진을 다시 촬영하거나 사진 수를 줄여 주세요.', retry: true };
  return { title: `AI 분석 실패${status ? ` (${status})` : ''}`, detail: error?.message || '잠시 후 다시 시도해 주세요.', retry: Boolean(error?.retryable) };
}
function buyConfidenceLabel(score) {
  if (score >= 80) return '높음';
  if (score >= 55) return '보통';
  return '낮음';
}

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
      <div class="field"><label for="barcode">상품 바코드 (UPC / EAN)</label><div class="input-with-action"><input id="barcode" inputmode="numeric" value="${esc(product.barcode)}" placeholder="8·12·13자리"><button type="button" id="barcode-photo" aria-label="바코드 촬영">▥</button></div><small class="helper" id="barcode-status">카메라로 촬영하거나 숫자를 직접 입력하세요.</small></div>
      <div class="ai-panel">
        <div class="row between"><div><p class="eyebrow">EAS AI ASSISTANT</p><h3>사진으로 상품 정보 분석</h3></div><span class="ai-beta">BETA</span></div>
        <p class="muted tiny">사진은 최대 3장까지 함께 분석합니다. 정면·측면·라벨 사진을 추가하면 모델 추론 정확도가 높아집니다.</p>
        <button type="button" class="primary full" id="ai-analyze">✨ AI 사진 분석</button>
        <div id="ai-result"></div>
      </div>
      <div class="two-col">
        <div class="field"><label for="category">카테고리</label><input id="category" value="${esc(product.category || '')}" placeholder="예: Slides"></div>
        <div class="field"><label for="color">색상</label><input id="color" value="${esc(product.color || '')}" placeholder="예: White / Blue"></div>
      </div>
      <div class="field"><label for="searchKeyword">eBay 검색어</label><div class="input-with-action"><input id="searchKeyword" value="${esc(product.searchKeyword || product.ai?.searchKeyword || '')}" placeholder="AI가 검색어를 제안합니다"><button type="button" id="open-ebay" aria-label="eBay 검색">↗</button></div></div>
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

  function renderPhotoGrid(message = '') {
    const grid = document.querySelector('#photos');
    if (!grid) return;
    const hero = photos[0]
      ? `<div class="photo-hero"><img src="${photos[0]}" alt="대표 상품 사진"><span>대표 사진</span></div>`
      : `<div class="photo-empty"><span>📷</span><b>상품 사진을 촬영해 주세요</b><small>촬영 후 이 영역에 바로 표시됩니다.</small></div>`;
    grid.innerHTML = `${hero}
      <div class="photo-thumbs">
        ${photos.map((src, index) => `<div class="photo"><img src="${src}" alt="상품 사진 ${index + 1}"><button type="button" data-remove-photo="${index}" aria-label="사진 삭제">×</button></div>`).join('')}
        ${photos.length < 6 ? `<button type="button" class="photo-add" id="add-photo"><span>📷</span><b>${photos.length ? '사진 추가' : '사진 촬영'}</b></button>` : ''}
      </div>
      <p class="photo-status ${message ? '' : 'hidden'}" id="photo-status">${esc(message)}</p>`;

    grid.querySelectorAll('[data-remove-photo]').forEach((button) => {
      button.onclick = () => {
        photos.splice(Number(button.dataset.removePhoto), 1);
        renderPhotoGrid();
      };
    });
    const addPhoto = grid.querySelector('#add-photo');
    if (addPhoto) addPhoto.onclick = () => photoInput.click();
  }
  renderPhotoGrid();

  const barcodeField = document.querySelector('#barcode');
  const barcodeStatus = document.querySelector('#barcode-status');
  function validateBarcode(showAlert = false) {
    const code = normalizeBarcode(barcodeField.value);
    barcodeField.value = code;
    if (!code) {
      barcodeStatus.textContent = '카메라로 촬영하거나 숫자를 직접 입력하세요.';
      barcodeStatus.className = 'helper';
      return true;
    }
    const kind = barcodeKind(code);
    const valid = kind && isValidGtin(code);
    barcodeStatus.textContent = valid ? `${kind} 형식 확인 완료` : '8·12·13자리 상품 바코드와 체크 숫자를 확인해 주세요.';
    barcodeStatus.className = valid ? 'helper barcode-ok' : 'helper barcode-error';
    if (!valid && showAlert) alert('올바른 UPC/EAN 상품 바코드인지 확인해 주세요.');
    return Boolean(valid);
  }
  barcodeField.addEventListener('input', () => validateBarcode(false));
  validateBarcode(false);

  const aiResultHolder = document.querySelector('#ai-result');
  function drawAiResult(ai = product.ai) {
    if (!ai) { aiResultHolder.innerHTML = ''; return; }
    aiResultHolder.innerHTML = `<div class="ai-result-card">
      <div class="row between"><strong>${esc(aiResultHeadline(ai))}</strong><span>${Math.round(Number(ai.confidence) || 0)}% 신뢰도</span></div>
      ${ai.summary ? `<p>${esc(ai.summary)}</p>` : ''}
      <small>${ai.analyzedAt ? `분석: ${new Date(ai.analyzedAt).toLocaleString('ko-KR')}` : ''}</small>
    </div>`;
  }
  drawAiResult();
  async function runAiAnalysis() {
    const button = document.querySelector('#ai-analyze');
    if (!photos.length) { alert('AI 분석 전에 상품 사진을 한 장 이상 촬영해 주세요.'); return; }
    button.disabled = true;
    button.textContent = 'AI 분석 중…';
    aiResultHolder.innerHTML = `<div class="inline-hint">사진 ${Math.min(photos.length, 3)}장을 분석하고 있습니다. 잠시만 기다려 주세요.</div>`;
    try {
      const ai = await requestAiAnalysisWithRetry(
        { photos, barcode: val('barcode'), brand: val('brand'), productName: val('productName') },
        (attempt, maxAttempts, delay, retryError) => {
          const seconds = Math.max(1, Math.ceil(delay / 1000));
          button.textContent = `AI 대기 중… (${attempt}/${maxAttempts})`;
          const reason = retryError?.status === 429 ? 'Gemini 요청 한도' : 'AI 서버 응답 불안정';
          aiResultHolder.innerHTML = `<div class="inline-hint"><strong>${esc(reason)}</strong><br>${seconds}초 뒤 한 번만 자동 재시도합니다. 요청 횟수를 아끼기 위해 추가 연속 재시도는 하지 않습니다.</div>`;
        },
      );
      product.ai = ai;
      if (ai.brand && !val('brand').trim()) document.querySelector('#brand').value = ai.brand;
      if (ai.productName && !val('productName').trim()) document.querySelector('#productName').value = ai.productName;
      if (ai.category) document.querySelector('#category').value = ai.category;
      if (ai.color) document.querySelector('#color').value = ai.color;
      if (ai.searchKeyword) document.querySelector('#searchKeyword').value = ai.searchKeyword;
      drawAiResult(ai);
      navigator.vibrate?.(80);
    } catch (error) {
      console.error('AI analysis', error);
      const view = aiErrorPresentation(error);
      const retryLabel = view.cooldownSeconds ? `${view.cooldownSeconds}초 후 다시 분석` : '다시 분석';
      aiResultHolder.innerHTML = `<div class="ai-warning"><strong>${esc(view.title)}</strong><p>${esc(view.detail)}</p>${view.retry ? `<button type="button" class="secondary full" id="ai-retry" ${view.cooldownSeconds ? 'disabled' : ''}>${esc(retryLabel)}</button>` : ''}</div>`;
      const retryButton = document.querySelector('#ai-retry');
      if (retryButton && view.cooldownSeconds) {
        let remaining = view.cooldownSeconds;
        const timer = setInterval(() => {
          remaining -= 1;
          if (remaining <= 0) {
            clearInterval(timer);
            retryButton.disabled = false;
            retryButton.textContent = '다시 분석';
            return;
          }
          retryButton.textContent = `${remaining}초 후 다시 분석`;
        }, 1000);
      }
      retryButton?.addEventListener('click', runAiAnalysis);
    } finally {
      button.disabled = false;
      button.textContent = '✨ AI 사진 분석';
    }
  }
  document.querySelector('#ai-analyze').onclick = runAiAnalysis;
  document.querySelector('#open-ebay').onclick = () => {
    const keyword = val('searchKeyword').trim() || buildSearchKeyword({ brand: val('brand'), productName: val('productName'), color: val('color'), category: val('category'), condition: product.ai?.condition });
    if (!keyword) { alert('검색어를 입력하거나 AI 분석을 먼저 실행해 주세요.'); return; }
    window.open(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(keyword)}&LH_ItemCondition=1000`, '_blank', 'noopener');
  };

  document.querySelector('#barcode-photo').onclick = () => barcodeImageInput.click();
  barcodeImageInput.onchange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    barcodeStatus.textContent = '바코드를 분석하고 있습니다…';
    try {
      let match = '';

      // 지원 브라우저에서는 내장 BarcodeDetector를 먼저 사용합니다.
      if ('BarcodeDetector' in window) {
        const supported = await BarcodeDetector.getSupportedFormats();
        const formats = ['ean_8', 'ean_13', 'upc_a', 'upc_e'].filter((format) => supported.includes(format));
        if (formats.length) {
          const detector = new BarcodeDetector({ formats });
          const bitmap = await createImageBitmap(file);
          const results = await detector.detect(bitmap);
          bitmap.close?.();
          match = results.map((item) => normalizeBarcode(item.rawValue)).find((code) => barcodeKind(code)) || '';
        }
      }

      // iPhone Safari 등 내장 판독기가 없는 환경에서는 ZXing으로 촬영 이미지를 분석합니다.
      if (!match && window.ZXingBrowser?.BrowserMultiFormatReader) {
        const imageUrl = URL.createObjectURL(file);
        try {
          const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
          const result = await reader.decodeFromImageUrl(imageUrl);
          match = normalizeBarcode(result?.getText?.() || result?.text || '');
        } finally {
          URL.revokeObjectURL(imageUrl);
        }
      }

      if (!barcodeKind(match) || !isValidGtin(match)) throw new Error('NOT_FOUND');
      barcodeField.value = match;
      validateBarcode(true);
      barcodeStatus.textContent = `${barcodeKind(match)} 자동 판독 완료`;
      barcodeStatus.className = 'helper barcode-ok';
      navigator.vibrate?.(80);
    } catch (error) {
      console.warn('barcode scan', error);
      const libraryUnavailable = !('BarcodeDetector' in window) && !window.ZXingBrowser?.BrowserMultiFormatReader;
      barcodeStatus.textContent = libraryUnavailable
        ? '바코드 판독 모듈을 불러오지 못했습니다. 인터넷 연결을 확인하거나 숫자를 직접 입력해 주세요.'
        : '바코드를 찾지 못했습니다. 바코드 전체가 선명하게 보이도록 정면에서 다시 촬영해 주세요.';
      barcodeStatus.className = 'helper barcode-error';
      barcodeField.focus();
    }
  };
  photoInput.onchange = async (event) => {
    const selected = [...event.target.files].slice(0, Math.max(0, 6 - photos.length));
    if (!selected.length) return;

    renderPhotoGrid('사진을 처리하고 있습니다…');
    try {
      for (const file of selected) {
        const dataUrl = await preparePhoto(file);
        if (dataUrl) photos.push(dataUrl);
      }
      product.photos = [...photos];
      renderPhotoGrid(photos.length ? '사진이 정상적으로 추가되었습니다.' : '사진을 추가하지 못했습니다.');
    } catch (error) {
      console.error(error);
      renderPhotoGrid('사진을 불러오지 못했습니다. 다시 촬영해 주세요.');
      alert('사진을 불러오지 못했습니다. 다시 촬영하거나 사진 보관함에서 선택해 주세요.');
    } finally {
      event.target.value = '';
    }
  };
  document.querySelector('#cancel').onclick = () => nav(existing ? 'products' : 'dashboard');
  document.querySelector('#product-form').onsubmit = (event) => {
    event.preventDefault();
    if (!num('purchasePrice') || !num('sellingPrice')) {
      alert('매입가와 판매가를 입력해 주세요.');
      return;
    }
    if (val('barcode').trim() && !validateBarcode(true)) return;
    const data = {
      ...product,
      id: existing?.id || product.id,
      brand: val('brand').trim(),
      productName: val('productName').trim(),
      barcode: val('barcode').trim(),
      category: val('category').trim(),
      color: val('color').trim(),
      searchKeyword: val('searchKeyword').trim(),
      ai: product.ai || null,
      purchasePrice: num('purchasePrice'),
      sellingPrice: num('sellingPrice'),
      shipping: num('shipping'),
      packing: num('packing'),
      notes: val('notes').trim(),
      photos,
      exchangeRateUsed: Number(settings.exchangeRate) || 0,
      exchangeRateMode: settings.exchangeMode || 'manual',
      exchangeRateDate: settings.exchangeRateDate || '',
      updatedAt: new Date().toISOString(),
    };
    data.result = calculate({ ...settings, ...data });
    const index = products.findIndex((item) => item.id === data.id);
    if (index >= 0) products[index] = data; else products.push(data);
    if (!save()) return;
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
    <div class="row between"><div><span class="result-label">매입 판정</span><div class="result-decision">${result.decision}</div></div><div class="score-ring"><strong>${result.score}</strong><small>BUY CONFIDENCE</small></div></div>
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
      ${product.photos?.length ? `<div class="detail-photo"><img src="${product.photos[0]}" alt="상품 사진"></div>${product.photos.length > 1 ? `<div class="detail-gallery">${product.photos.map((src, index) => `<button type="button" data-gallery-photo="${index}"><img src="${src}" alt="상품 사진 ${index + 1}"></button>`).join('')}</div>` : ''}` : ''}
      <h2>${esc(name)}</h2>
      <p class="muted">${esc(product.barcode || '바코드 없음')}</p>
      ${product.ai ? `<div class="ai-result-card detail-ai"><div class="row between"><strong>AI ${esc(aiResultHeadline(product.ai))}</strong><span>${Math.round(Number(product.ai.confidence)||0)}%</span></div>${product.ai.summary ? `<p>${esc(product.ai.summary)}</p>` : ''}${product.searchKeyword ? `<button class="text-button" type="button" id="detail-ebay">eBay 새상품 검색 ↗</button>` : ''}</div>` : ''}
      <dl class="detail-list">
        <div><dt>매입가</dt><dd>${won(product.purchasePrice)}</dd></div>
        <div><dt>판매가</dt><dd>${usd(product.sellingPrice)}</dd></div>
        <div><dt>적용 환율</dt><dd>${Number(product.exchangeRateUsed || settings.exchangeRate).toLocaleString('ko-KR')}원${product.exchangeRateDate ? ` · ${esc(product.exchangeRateDate)}` : ''}</dd></div>
        <div><dt>수수료·충당금</dt><dd>${won(product.result.variableFees + product.result.fixedFeeKrw)}</dd></div>
        <div><dt>배송·포장</dt><dd>${won(product.shipping + product.packing)}</dd></div>
        <div><dt>손익분기 판매가</dt><dd>${usd(product.result.breakEven)}</dd></div>
        <div><dt>구매 확신도</dt><dd>${buyConfidenceLabel(product.result.score)} · ${product.result.score}/100</dd></div>
      </dl>
      ${product.notes ? `<div class="note-box">${esc(product.notes)}</div>` : ''}
    </section>
    <div class="actions"><button class="danger" id="delete">삭제</button><button class="primary" id="edit">편집</button></div>`;
  document.querySelectorAll('[data-gallery-photo]').forEach((button) => {
    button.onclick = () => {
      const image = document.querySelector('.detail-photo img');
      if (image) image.src = product.photos[Number(button.dataset.galleryPhoto)];
    };
  });
  document.querySelector('#detail-ebay')?.addEventListener('click', () => window.open(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(product.searchKeyword)}&LH_ItemCondition=1000`, '_blank', 'noopener'));
  document.querySelector('#edit').onclick = () => openEditor(product.id);
  document.querySelector('#delete').onclick = () => {
    if (confirm('이 상품을 삭제할까요?')) {
      products = products.filter((item) => item.id !== product.id);
      if (save()) nav('products');
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
  applyExchangeMode();
  const updatedText = settings.exchangeRateUpdatedAt
    ? new Date(settings.exchangeRateUpdatedAt).toLocaleString('ko-KR')
    : '아직 자동 조회하지 않음';
  const sourceDate = settings.exchangeRateDate ? ` · 기준일 ${esc(settings.exchangeRateDate)}` : '';
  app.innerHTML = `<section class="card exchange-card">
    <div class="row between"><div><p class="eyebrow">USD → KRW</p><h2 class="form-title">환율 설정</h2></div><span class="rate-value">${Number(settings.exchangeRate).toLocaleString('ko-KR')}원</span></div>
    <div class="field"><label for="exchangeMode">계산에 사용할 환율</label><select id="exchangeMode">
      <option value="conservative" ${settings.exchangeMode === 'conservative' ? 'selected' : ''}>보수환율 (최신 기준환율의 ${Number(settings.conservativeRatePercent) || 98}%)</option>
      <option value="latest" ${settings.exchangeMode === 'latest' ? 'selected' : ''}>최신 기준환율</option>
      <option value="manual" ${settings.exchangeMode === 'manual' ? 'selected' : ''}>직접 입력</option>
    </select></div>
    <div class="two-col">
      <div class="field"><label for="latestExchangeRate">최신 기준환율</label><input id="latestExchangeRate" type="number" value="${Number(settings.latestExchangeRate) || ''}" readonly></div>
      <div class="field"><label for="manualExchangeRate">직접 입력 환율</label><input id="manualExchangeRate" type="number" value="${Number(settings.manualExchangeRate) || Number(settings.exchangeRate)}"></div>
    </div>
    <div class="field"><label for="conservativeRatePercent">보수환율 비율 (%)</label><input id="conservativeRatePercent" type="number" min="80" max="100" step="0.1" value="${Number(settings.conservativeRatePercent) || 98}"></div>
    <div class="rate-status" id="rate-status"><strong>${esc(exchangeModeLabel())}: ${Number(settings.exchangeRate).toLocaleString('ko-KR')}원</strong><small>${esc(settings.exchangeRateSource || 'Frankfurter')}${sourceDate}<br>마지막 조회: ${esc(updatedText)}</small></div>
    <button class="secondary full" type="button" id="refresh-rate">↻ 최신 환율 조회</button>
    <small class="helper">자동 환율은 실시간 매매 환율이 아니라 중앙은행 자료 기반의 최신 기준환율입니다. 영업일 기준으로 갱신되며 실제 카드사·은행 환율과 차이가 날 수 있습니다.</small>
  </section>
  <section class="card">
    <div class="two-col"><div class="field"><label for="feeRate">eBay 수수료 (%)</label><input id="feeRate" type="number" step="0.01" value="${settings.feeRate}"></div><div class="field"><label for="adRate">광고율 (%)</label><input id="adRate" type="number" step="0.1" value="${settings.adRate}"></div></div>
    <div class="two-col"><div class="field"><label for="returnReserveRate">반품 충당률 (%)</label><input id="returnReserveRate" type="number" step="0.1" value="${settings.returnReserveRate}"></div><div class="field"><label for="fixedFeeUsd">고정 수수료 (USD)</label><input id="fixedFeeUsd" type="number" step="0.01" value="${settings.fixedFeeUsd}"></div></div>
    <div class="two-col"><div class="field"><label for="internationalShipping">기본 국제배송비 (KRW)</label><input id="internationalShipping" type="number" value="${settings.internationalShipping}"></div><div class="field"><label for="packingCost">기본 포장비 (KRW)</label><input id="packingCost" type="number" value="${settings.packingCost}"></div></div>
    <div class="two-col"><div class="field"><label for="targetProfit">목표 순이익</label><input id="targetProfit" type="number" value="${settings.targetProfit}"></div><div class="field"><label for="targetRoi">목표 ROI (%)</label><input id="targetRoi" type="number" value="${settings.targetRoi}"></div></div>
    <div class="field"><label for="aiEndpoint">AI 분석 서버 주소</label><input id="aiEndpoint" type="url" value="${esc(settings.aiEndpoint || '')}" placeholder="https://your-worker.example.com/analyze"><small class="helper">비밀 API 키는 GitHub Pages 앱에 넣지 말고 서버에만 보관하세요.</small></div>
    <button class="primary full" id="save-settings">설정 저장</button>
  </section>
  <section class="card install-note"><strong>계산 기준</strong><p>자동 환율, 수수료, 광고율, 반품 충당률, 배송비와 포장비를 반영합니다. 상품 저장 시 계산에 사용한 환율도 함께 기록됩니다.</p></section>
  <section class="card install-note"><strong>아이폰 설치 방법</strong><p>Safari에서 배포 주소를 연 뒤 공유 → 홈 화면에 추가를 누르세요. 상품 데이터는 이 기기에 저장됩니다.</p></section>
  <section class="card"><button class="secondary full" id="export-data">데이터 내보내기</button></section>`;

  function previewRate() {
    settings.exchangeMode = val('exchangeMode') || 'conservative';
    settings.manualExchangeRate = num('manualExchangeRate') || settings.manualExchangeRate || 1390;
    settings.conservativeRatePercent = num('conservativeRatePercent') || 98;
    applyExchangeMode();
    const holder = document.querySelector('#rate-status');
    if (holder) holder.querySelector('strong').textContent = `${exchangeModeLabel()}: ${Number(settings.exchangeRate).toLocaleString('ko-KR')}원`;
  }
  ['exchangeMode', 'manualExchangeRate', 'conservativeRatePercent'].forEach((id) => document.querySelector(`#${id}`).addEventListener('input', previewRate));

  document.querySelector('#refresh-rate').onclick = async () => {
    const button = document.querySelector('#refresh-rate');
    button.disabled = true;
    button.textContent = '환율 조회 중…';
    try {
      await fetchLatestExchangeRate({ force: true });
      renderSettings();
    } catch (error) {
      console.error('환율 조회', error);
      const holder = document.querySelector('#rate-status');
      if (holder) holder.innerHTML = `<strong>환율 조회 실패</strong><small>${esc(error?.message || '인터넷 연결을 확인해 주세요.')}<br>마지막 저장 환율 ${Number(settings.exchangeRate).toLocaleString('ko-KR')}원을 계속 사용합니다.</small>`;
      button.disabled = false;
      button.textContent = '↻ 다시 조회';
    }
  };

  document.querySelector('#save-settings').onclick = () => {
    settings.exchangeMode = val('exchangeMode') || 'conservative';
    settings.manualExchangeRate = num('manualExchangeRate') || settings.manualExchangeRate || 1390;
    settings.conservativeRatePercent = num('conservativeRatePercent') || 98;
    ['feeRate', 'adRate', 'returnReserveRate', 'fixedFeeUsd', 'internationalShipping', 'packingCost', 'targetProfit', 'targetRoi'].forEach((key) => { settings[key] = num(key); });
    settings.aiEndpoint = val('aiEndpoint').trim();
    applyExchangeMode();
    saveSettings();
    alert(`설정을 저장했습니다. 적용 환율은 ${Number(settings.exchangeRate).toLocaleString('ko-KR')}원입니다.`);
    renderSettings();
  };
  document.querySelector('#export-data').onclick = () => {
    const blob = new Blob([JSON.stringify({ version: APP_VERSION, exportedAt: new Date().toISOString(), settings, products }, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `EAS-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('파일 읽기 실패'));
    reader.readAsDataURL(file);
  });
}

async function preparePhoto(file) {
  const original = await readFileAsDataUrl(file);
  try {
    return await compressDataUrl(original);
  } catch (error) {
    console.warn('사진 압축 실패, 원본 사용', error);
    return original;
  }
}

function compressDataUrl(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const max = 1280;
        const scale = Math.min(1, max / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
        canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.72));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('이미지 디코딩 실패'));
    image.src = source;
  });
}


if (!settings.exchangeMode) settings.exchangeMode = 'manual';
if (!settings.manualExchangeRate) settings.manualExchangeRate = Number(settings.exchangeRate) || 1390;
if (!settings.latestExchangeRate) settings.latestExchangeRate = Number(settings.exchangeRate) || 1390;
applyExchangeMode();

document.querySelectorAll('.bottom-nav button').forEach((button) => { button.onclick = () => nav(button.dataset.route); });
document.querySelector('#new-product-top').onclick = () => openEditor();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
render();
if (settings.exchangeMode !== 'manual') {
  fetchLatestExchangeRate().then(() => { if (route === 'settings') renderSettings(); }).catch((error) => console.warn('자동 환율 조회 실패', error));
}
