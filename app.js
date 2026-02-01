const ASSET_TYPES = ['Cash', 'Stock', 'Real Estate', 'Bonds', 'Crypto', 'Retirement', 'Other'];
const SECTIONS_KEY = 'networth-sections';
const SNAPSHOTS_KEY = 'networth-snapshots';
const PRICE_CACHE_KEY = 'networth-price-cache';
const PRICE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

function formatCurrency(n) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function loadSections() {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveSections(sections) {
  localStorage.setItem(SECTIONS_KEY, JSON.stringify(sections));
}

function loadSnapshots() {
  try {
    const raw = localStorage.getItem(SNAPSHOTS_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveSnapshots(snapshots) {
  localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
}

function exportData() {
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    sections: loadSections(),
    snapshots: loadSnapshots(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `networth-export-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      const secs = Array.isArray(data.sections) ? data.sections : [];
      const snaps = Array.isArray(data.snapshots) ? data.snapshots : [];
      saveSections(secs);
      saveSnapshots(snaps);
      sections.length = 0;
      sections.push(...secs);
      renderSections();
      renderCurrentPage();
      renderHistory();
      renderTotal();
      alert('Import complete.');
    } catch (err) {
      alert('Invalid file: ' + (err.message || 'Could not parse JSON'));
    }
  };
  reader.readAsText(file);
}

function getPriceCache() {
  try {
    const raw = localStorage.getItem(PRICE_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function setPriceCache(ticker, price, dateKey) {
  const cache = getPriceCache();
  const key = dateKey ? `${ticker.toUpperCase()}_${dateKey}` : ticker.toUpperCase();
  cache[key] = { price, ts: Date.now() };
  localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify(cache));
}

async function fetchStockPriceForDate(ticker, dateStr) {
  const key = (ticker || '').trim().toUpperCase();
  if (!key) return { price: null, error: 'No ticker' };
  const cache = getPriceCache();
  const cacheKey = `${key}_${dateStr}`;
  const cached = cache[cacheKey];
  if (cached?.price != null) return { price: cached.price, error: null };
  const d = new Date(dateStr + 'T12:00:00Z');
  const period1 = Math.floor(d.getTime() / 1000) - 86400 * 7;
  const period2 = Math.floor(d.getTime() / 1000) + 86400;
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?period1=${period1}&period2=${period2}&interval=1d`;
  async function tryFetch(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch failed');
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('Invalid response');
    const quote = result.indicators?.quote?.[0];
    const timestamps = result.timestamp || [];
    if (!quote?.close?.length || !timestamps.length) throw new Error('No price data');
    const targetDate = dateStr.replace(/-/g, '');
    let price = null;
    for (let i = timestamps.length - 1; i >= 0; i--) {
      const ts = new Date(timestamps[i] * 1000);
      const ds = ts.toISOString().slice(0, 10).replace(/-/g, '');
      if (ds <= targetDate && quote.close[i] != null) {
        price = quote.close[i];
        break;
      }
    }
    if (price != null && typeof price === 'number') {
      setPriceCache(key, price, dateStr);
      return { price, error: null };
    }
    throw new Error('No price data for date');
  }
  try {
    return await tryFetch(yahooUrl);
  } catch (e) {
    try {
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(yahooUrl);
      return await tryFetch(proxyUrl);
    } catch (e2) {
      return { price: null, error: e.message || 'Failed to fetch' };
    }
  }
}

async function fetchStockPrice(ticker) {
  const key = (ticker || '').trim().toUpperCase();
  if (!key) return { price: null, error: 'No ticker' };
  const cache = getPriceCache();
  const cached = cache[key];
  if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL_MS) {
    return { price: cached.price, error: null };
  }
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?interval=1d&range=1d`;
  async function tryFetch(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Fetch failed');
    const data = await res.json();
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('Invalid response');
    const meta = result.meta;
    const quote = result.indicators?.quote?.[0];
    let price = meta?.regularMarketPrice ?? meta?.previousClose;
    if (price == null && quote?.close?.length) {
      const closes = quote.close.filter((c) => c != null);
      price = closes[closes.length - 1];
    }
    if (price != null && typeof price === 'number') {
      setPriceCache(key, price);
      return { price, error: null };
    }
    throw new Error('No price data');
  }
  try {
    return await tryFetch(yahooUrl);
  } catch (e) {
    try {
      const proxyUrl = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(yahooUrl);
      return await tryFetch(proxyUrl);
    } catch (e2) {
      return { price: cached?.price ?? null, error: e.message || 'Failed to fetch' };
    }
  }
}

async function addSnapshot(sections, snapshotDate) {
  const secs = JSON.parse(JSON.stringify(sections));
  for (const s of secs) {
    if (s.assetType === 'Stock') {
      const t = (s.stockTicker || '').trim().toUpperCase();
      const sh = s.shares ?? 0;
      if (t && sh) {
        const { price } = await fetchStockPriceForDate(t, snapshotDate);
        s.valueDollars = price != null ? price * sh : (s.valueDollars || 0);
      }
    }
  }
  const total = secs.reduce((sum, s) => {
    const debt = s.assetType === 'Real Estate' ? (s.debtDollars || 0) : 0;
    return sum + (s.valueDollars - debt);
  }, 0);
  const snapshot = {
    date: snapshotDate,
    totalNetWorth: total,
    sections: secs,
    savedAt: new Date().toISOString(),
  };
  const list = loadSnapshots();
  const existing = list.findIndex((s) => s.date === snapshotDate);
  if (existing >= 0) list[existing] = snapshot;
  else list.push(snapshot);
  list.sort((a, b) => a.date.localeCompare(b.date));
  saveSnapshots(list);
}

let sections = loadSections();
let chartInstance = null;

function computeTotal() {
  return sections.reduce((sum, s) => {
    const debt = s.assetType === 'Real Estate' ? (s.debtDollars || 0) : 0;
    return sum + (s.valueDollars - debt);
  }, 0);
}

function getLatestSnapshot() {
  const list = loadSnapshots();
  return list.length ? list[list.length - 1] : null;
}

function getDisplayTotal() {
  if (currentEditSections && currentView.page === 'current') {
    return currentEditSections.reduce((sum, s) => {
      const debt = s.assetType === 'Real Estate' ? (s.debtDollars || 0) : 0;
      return sum + (s.valueDollars - debt);
    }, 0);
  }
  if (snapshotDetailEditSections && currentView.page === 'snapshot') {
    return snapshotDetailEditSections.reduce((sum, s) => {
      const debt = s.assetType === 'Real Estate' ? (s.debtDollars || 0) : 0;
      return sum + (s.valueDollars - debt);
    }, 0);
  }
  if (currentView.page === 'current' || currentView.page === 'snapshot') {
    const snap = currentView.page === 'snapshot'
      ? loadSnapshots().find((s) => s.date === currentView.snapshotDate)
      : getLatestSnapshot();
    return snap ? snap.totalNetWorth : 0;
  }
  return computeTotal();
}

function renderTotal() {
  const total = getDisplayTotal();
  const el = document.getElementById('total-value');
  el.textContent = formatCurrency(total);
  el.className = 'total-value ' + (total >= 0 ? 'positive' : 'negative');
}

let currentView = { page: 'current', snapshotDate: null };

function createSectionCard(section, onUpdate, onRemove, getSections, snapshotDate) {
  const getSecs = getSections || (() => sections);
  const isStock = section.assetType === 'Stock';
  const isRealEstate = section.assetType === 'Real Estate';
  const ticker = section.stockTicker || '';
  const shares = section.shares ?? 0;
  const debt = isRealEstate ? (section.debtDollars || 0) : 0;
  const net = section.valueDollars - debt;

  const stockFieldsHtml = isStock
    ? `
      <label class="field">
        <span class="field-label">Stock Name</span>
        <input type="text" class="input" placeholder="e.g. AAPL" value="${escapeHtml(ticker)}" data-field="stockTicker" />
      </label>
      <label class="field">
        <span class="field-label">Number of Shares</span>
        <input type="number" class="input" min="0" step="0.0001" placeholder="0" value="${shares || ''}" data-field="shares" />
      </label>
      <label class="field field-full">
        <span class="field-label">Value ($)</span>
        <div class="value-computed">
          <span class="value-display">${formatCurrency(section.valueDollars || 0)}</span>
          <span class="value-loading hidden">Loading…</span>
          <button type="button" class="btn-refresh" title="Refresh price">↻</button>
        </div>
      </label>
    `
    : `
      <label class="field">
        <span class="field-label">Value ($)</span>
        <input type="number" class="input" min="0" step="0.01" placeholder="0" value="${section.valueDollars || ''}" data-field="valueDollars" />
      </label>
    `;

  const card = document.createElement('div');
  card.className = 'section-card';
  card.dataset.id = section.id;
  if (snapshotDate) card.dataset.snapshotDate = snapshotDate;
  card.innerHTML = `
    <div class="section-header">
      <input type="text" class="account-name" placeholder="Name" value="${escapeHtml(section.accountName)}" data-field="accountName" />
      <button type="button" class="btn-icon remove-btn" aria-label="Remove section">×</button>
    </div>
    <div class="section-fields">
      <label class="field">
        <span class="field-label">Asset type</span>
        <select class="select" data-field="assetType">
          ${ASSET_TYPES.map((t) => `<option value="${t}" ${section.assetType === t ? 'selected' : ''}>${t}</option>`).join('')}
        </select>
      </label>
      ${stockFieldsHtml}
      ${isRealEstate ? `
      <label class="field">
        <span class="field-label">Debt ($)</span>
        <input type="number" class="input" min="0" step="0.01" placeholder="0" value="${section.debtDollars || ''}" data-field="debtDollars" />
      </label>
      ` : ''}
    </div>
    <div class="section-footer">
      <span class="net-label">Net</span>
      <span class="net-value ${net >= 0 ? 'positive' : 'negative'}">${formatCurrency(net)}</span>
    </div>
  `;

  function updateNet() {
    const s = getSecs().find((x) => x.id === section.id);
    if (!s) return;
    const d = s.assetType === 'Real Estate' ? (s.debtDollars || 0) : 0;
    const n = s.valueDollars - d;
    const el = card.querySelector('.section-footer .net-value');
    if (el) {
      el.textContent = formatCurrency(n);
      el.className = 'net-value ' + (n >= 0 ? 'positive' : 'negative');
    }
  }

  async function refreshStockValue() {
    const s = getSecs().find((x) => x.id === section.id);
    if (!s || s.assetType !== 'Stock') return;
    const t = (s.stockTicker || '').trim().toUpperCase();
    const sh = s.shares ?? 0;
    if (!t || !sh) {
      onUpdate(section.id, { valueDollars: 0 });
      updateNet();
      renderTotal();
      return;
    }
    const dateToUse = card.dataset.snapshotDate
      || document.getElementById('snapshot-date')?.value
      || todayISO();
    const displayEl = card.querySelector('.value-display');
    const loadingEl = card.querySelector('.value-loading');
    const refreshBtn = card.querySelector('.btn-refresh');
    if (displayEl) displayEl.classList.add('hidden');
    if (loadingEl) loadingEl.classList.remove('hidden');
    if (refreshBtn) refreshBtn.disabled = true;

    const { price, error } = await fetchStockPriceForDate(t, dateToUse);
    if (displayEl) displayEl.classList.remove('hidden');
    if (loadingEl) loadingEl.classList.add('hidden');
    if (refreshBtn) refreshBtn.disabled = false;

    const value = price != null ? price * sh : 0;
    onUpdate(section.id, { valueDollars: value });
    if (displayEl) {
      displayEl.textContent = error && price == null ? 'Error' : formatCurrency(value);
      displayEl.title = price != null ? `$${price.toFixed(2)} × ${sh} shares (${dateToUse})` : (error || 'Loading…');
    }
    updateNet();
    renderTotal();
  }

  card.querySelectorAll('[data-field]').forEach((input) => {
    const field = input.dataset.field;
    input.addEventListener('input', () => {
      let val = input.value;
      if (field === 'valueDollars' || field === 'debtDollars') val = parseFloat(val) || 0;
      if (field === 'shares') val = parseFloat(val) ?? 0;
      onUpdate(section.id, { [field]: val });
      if (field === 'stockTicker' || field === 'shares') {
        refreshStockValue();
      } else {
        updateNet();
        renderTotal();
      }
    });
    input.addEventListener('change', () => {
      let val = input.value;
      if (field === 'valueDollars' || field === 'debtDollars') val = parseFloat(val) || 0;
      if (field === 'shares') val = parseFloat(val) ?? 0;
      onUpdate(section.id, { [field]: val });
      if (field === 'stockTicker' || field === 'shares') {
        refreshStockValue();
      } else {
        updateNet();
        renderTotal();
      }
    });
  });

  const typeSelect = card.querySelector('[data-field="assetType"]');
  if (typeSelect) {
    typeSelect.addEventListener('change', (e) => {
      const newType = e.target.value;
      const patch = { assetType: newType };
      if (newType === 'Stock') {
        patch.stockTicker = section.stockTicker || '';
        patch.shares = section.shares ?? 0;
        patch.valueDollars = 0;
      } else {
        patch.stockTicker = '';
        patch.shares = 0;
      }
      if (newType !== 'Real Estate') {
        patch.debtDollars = 0;
      }
      onUpdate(section.id, patch);
      renderSections();
      renderTotal();
    });
  }

  const refreshBtn = card.querySelector('.btn-refresh');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => refreshStockValue());
  }

  card.querySelector('.remove-btn').addEventListener('click', () => onRemove(section.id));

  if (isStock && ticker && shares) {
    refreshStockValue();
  }

  return card;
}

function escapeHtml(s) {
  if (!s) return '';
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function createReadOnlySectionCard(section) {
  const isRealEstate = section.assetType === 'Real Estate';
  const debt = isRealEstate ? (section.debtDollars || 0) : 0;
  const net = (section.valueDollars || 0) - debt;
  const card = document.createElement('div');
  card.className = 'section-card section-card-readonly';
  card.innerHTML = `
    <div class="section-header">
      <span class="account-name-readonly">${escapeHtml(section.accountName || '')}</span>
    </div>
    <div class="section-fields section-fields-readonly">
      <div class="field-readonly">
        <span class="field-label">Asset type</span>
        <span>${escapeHtml(section.assetType || '')}</span>
      </div>
      ${section.assetType === 'Stock' ? `
      <div class="field-readonly">
        <span class="field-label">Stock</span>
        <span>${escapeHtml(section.stockTicker || '')} × ${section.shares ?? 0}</span>
      </div>
      ` : ''}
      <div class="field-readonly">
        <span class="field-label">Value</span>
        <span>${formatCurrency(section.valueDollars || 0)}</span>
      </div>
      ${isRealEstate ? `
      <div class="field-readonly">
        <span class="field-label">Debt</span>
        <span>${formatCurrency(section.debtDollars || 0)}</span>
      </div>
      ` : ''}
    </div>
    <div class="section-footer">
      <span class="net-label">Net</span>
      <span class="net-value ${net >= 0 ? 'positive' : 'negative'}">${formatCurrency(net)}</span>
    </div>
  `;
  return card;
}

let currentEditSections = null;
let snapshotDetailEditSections = null;

function renderCurrentPage() {
  const snap = getLatestSnapshot();
  const wrap = document.getElementById('current-snapshot-wrap');
  const container = document.getElementById('current-snapshot');
  const emptyEl = document.getElementById('current-empty');
  container.innerHTML = '';
  currentEditSections = null;
  if (!snap || !snap.sections?.length) {
    wrap.classList.add('hidden');
    emptyEl.classList.remove('hidden');
  } else {
    wrap.classList.remove('hidden');
    emptyEl.classList.add('hidden');
    snap.sections.forEach((s) => {
      container.appendChild(createReadOnlySectionCard(s));
    });
  }
}

function enterCurrentEditMode(snap, sectionsToUse) {
  currentEditSections = sectionsToUse
    ? sectionsToUse
    : JSON.parse(JSON.stringify(snap.sections || []));
  const container = document.getElementById('current-snapshot');
  const editContainer = document.getElementById('current-snapshot-edit');
  const editBtn = document.getElementById('current-edit-btn');
  container.classList.add('hidden');
  editContainer.classList.remove('hidden');
  editBtn.textContent = 'Done';
  editBtn.onclick = () => doneCurrentEdit(snap.date);
  renderEditableSnapshotSections(editContainer, currentEditSections, snap.date, true);
}

async function doneCurrentEdit(date) {
  if (currentEditSections) {
    await addSnapshot(currentEditSections, date);
    currentEditSections = null;
  }
  renderCurrentPage();
  renderTotal();
}

function removeCurrentSnapshot() {
  const snap = getLatestSnapshot();
  if (!snap || !confirm('Remove this snapshot?')) return;
  const list = loadSnapshots().filter((s) => s.date !== snap.date);
  saveSnapshots(list);
  renderCurrentPage();
  renderTotal();
}

function renderSnapshotDetail(date) {
  const snap = loadSnapshots().find((s) => s.date === date);
  const titleEl = document.getElementById('snapshot-detail-title');
  const contentEl = document.getElementById('snapshot-detail-content');
  const editContainer = document.getElementById('snapshot-detail-edit');
  const editBtn = document.getElementById('snapshot-detail-edit-btn');
  const removeBtn = document.getElementById('snapshot-detail-remove-btn');
  contentEl.innerHTML = '';
  editContainer.innerHTML = '';
  editContainer.classList.add('hidden');
  contentEl.classList.remove('hidden');
  snapshotDetailEditSections = null;
  if (snap) {
    titleEl.textContent = formatDate(date) + ' — ' + formatCurrency(snap.totalNetWorth);
    editBtn.textContent = 'Edit';
    editBtn.onclick = () => enterSnapshotDetailEditMode(snap);
    removeBtn.onclick = () => removeSnapshotDetail(date);
    (snap.sections || []).forEach((s) => {
      contentEl.appendChild(createReadOnlySectionCard(s));
    });
  }
}

function enterSnapshotDetailEditMode(snap) {
  snapshotDetailEditSections = JSON.parse(JSON.stringify(snap.sections || []));
  const contentEl = document.getElementById('snapshot-detail-content');
  const editContainer = document.getElementById('snapshot-detail-edit');
  const editBtn = document.getElementById('snapshot-detail-edit-btn');
  contentEl.classList.add('hidden');
  editContainer.classList.remove('hidden');
  editBtn.textContent = 'Done';
  editBtn.onclick = () => doneSnapshotDetailEdit(snap.date);
  renderEditableSnapshotSections(editContainer, snapshotDetailEditSections, snap.date, false);
}

function renderEditableSnapshotSections(container, secs, date, isCurrent) {
  container.innerHTML = '';
  secs.forEach((sec) => {
    const onRemove = (id) => {
      const idx = secs.findIndex((x) => x.id === id);
      if (idx >= 0) secs.splice(idx, 1);
      if (secs.length === 0) {
        if (isCurrent) doneCurrentEdit(date);
        else doneSnapshotDetailEdit(date);
      } else {
        renderEditableSnapshotSections(container, secs, date, isCurrent);
      }
    };
    const card = createSectionCard(
      sec,
      (id, patch) => {
        const s = secs.find((x) => x.id === id);
        if (s) Object.assign(s, patch, { updatedAt: new Date().toISOString() });
      },
      onRemove,
      () => secs,
      date
    );
    container.appendChild(card);
  });
}

async function doneSnapshotDetailEdit(date) {
  if (snapshotDetailEditSections) {
    await addSnapshot(snapshotDetailEditSections, date);
    snapshotDetailEditSections = null;
  }
  renderSnapshotDetail(date);
  renderTotal();
}

function removeSnapshotDetail(date) {
  if (!confirm('Remove this snapshot?')) return;
  const list = loadSnapshots().filter((s) => s.date !== date);
  saveSnapshots(list);
  showPage('history');
  renderTotal();
}

function goToSnapshotDetail(date) {
  currentView = { page: 'snapshot', snapshotDate: date };
  document.getElementById('current-page').classList.add('hidden');
  document.getElementById('new-page').classList.add('hidden');
  document.getElementById('history-page').classList.add('hidden');
  document.getElementById('snapshot-detail-page').classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
  renderSnapshotDetail(date);
  renderTotal();
}

function renderSections() {
  const list = document.getElementById('sections-list');
  list.innerHTML = '';
  if (sections.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty-state';
    p.textContent = 'No sections yet. Tap "Add section" to add an account.';
    list.appendChild(p);
  } else {
    sections.forEach((section) => {
      const card = createSectionCard(
        section,
        (id, patch) => {
          const s = sections.find((x) => x.id === id);
          if (s) {
            Object.assign(s, patch, { updatedAt: new Date().toISOString() });
            saveSections(sections);
          }
        },
        (id) => {
          sections = sections.filter((s) => s.id !== id);
          saveSections(sections);
          renderSections();
          renderTotal();
        }
      );
      list.appendChild(card);
    });
  }
}

function renderHistory() {
  const snapshots = loadSnapshots();
  const list = document.getElementById('snapshot-list');
  const chartWrap = document.getElementById('chart-wrap');
  list.innerHTML = '';
  const emptyEl = document.getElementById('history-empty');
  const chartClickLayer = document.getElementById('chart-click-layer');
  if (snapshots.length === 0) {
    chartWrap.style.display = 'none';
    list.classList.add('hidden');
    if (emptyEl) emptyEl.classList.remove('hidden');
    if (chartClickLayer) {
    chartClickLayer.onclick = null;
    chartClickLayer.ontouchend = null;
  }
  } else {
    chartWrap.style.display = 'block';
    list.classList.remove('hidden');
    if (emptyEl) emptyEl.classList.add('hidden');
    [...snapshots].reverse().forEach((s) => {
      const li = document.createElement('li');
      li.className = 'snapshot-item snapshot-item-clickable';
      li.dataset.snapshotDate = s.date;
      li.setAttribute('role', 'button');
      li.tabIndex = 0;
      li.innerHTML = `
        <span class="snapshot-date">${formatDate(s.date)}</span>
        <span class="snapshot-value ${s.totalNetWorth >= 0 ? 'positive' : 'negative'}">${formatCurrency(s.totalNetWorth)}</span>
      `;
      list.appendChild(li);
    });
  }

  if (chartInstance) chartInstance.destroy();
  if (snapshots.length > 0 && typeof Chart !== 'undefined') {
    const ctx = document.getElementById('chart');
    if (ctx) {
      chartInstance = new Chart(ctx.getContext('2d'), {
        type: 'line',
        data: {
          labels: snapshots.map((s) => formatDate(s.date)),
          datasets: [{
            label: 'Net worth',
            data: snapshots.map((s) => s.totalNetWorth),
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            fill: true,
            tension: 0.3,
            pointRadius: 6,
            pointHoverRadius: 8,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
          },
          scales: {
            x: {
              grid: { color: '#262626' },
              ticks: { color: '#9ca3af', maxRotation: 45 },
            },
            y: {
              grid: { color: '#262626' },
              ticks: {
                color: '#9ca3af',
                callback: (v) => '$' + (v / 1000).toFixed(0) + 'k',
              },
            },
          },
        },
      });
      const chartClickLayer = document.getElementById('chart-click-layer');
      if (chartClickLayer) {
        const handleChartClick = (e) => {
          const evt = e.touches ? e.touches[0] : e.changedTouches ? e.changedTouches[0] : e;
          if (!evt) return;
          const rect = chartClickLayer.getBoundingClientRect();
          const x = (evt.clientX - rect.left) / rect.width;
          const idx = Math.min(Math.floor(x * snapshots.length), snapshots.length - 1);
          const snap = snapshots[Math.max(0, idx)];
          if (snap) goToSnapshotDetail(snap.date);
        };
        chartClickLayer.onclick = handleChartClick;
        chartClickLayer.ontouchend = (e) => { e.preventDefault(); handleChartClick(e); };
      }
    }
  }
}

document.addEventListener('click', (e) => {
  const item = e.target.closest('[data-snapshot-date]');
  if (item && item.getAttribute('data-snapshot-date') && !document.getElementById('history-page').classList.contains('hidden')) {
    goToSnapshotDetail(item.getAttribute('data-snapshot-date'));
  }
});

function showPage(page) {
  currentView = { page, snapshotDate: null };
  document.getElementById('current-page').classList.add('hidden');
  document.getElementById('new-page').classList.add('hidden');
  document.getElementById('history-page').classList.add('hidden');
  document.getElementById('snapshot-detail-page').classList.add('hidden');
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  if (page === 'current') {
    document.getElementById('current-page').classList.remove('hidden');
    renderCurrentPage();
  } else if (page === 'new') {
    document.getElementById('new-page').classList.remove('hidden');
    renderSections();
  } else if (page === 'history') {
    document.getElementById('history-page').classList.remove('hidden');
    renderHistory();
  }
  renderTotal();
}

document.getElementById('add-section').addEventListener('click', () => {
  const newSection = {
    id: crypto.randomUUID(),
    accountName: '',
    assetType: 'Cash',
    valueDollars: 0,
    debtDollars: 0,
    stockTicker: '',
    shares: 0,
    updatedAt: new Date().toISOString(),
  };
  sections.push(newSection);
  saveSections(sections);
  renderSections();
  renderTotal();
});

document.getElementById('save-snapshot').addEventListener('click', async () => {
  const btn = document.getElementById('save-snapshot');
  const dateInput = document.getElementById('snapshot-date');
  const date = dateInput.value || todayISO();
  const origText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving…';
  try {
    await addSnapshot(sections, date);
    dateInput.value = todayISO();
    if (currentView.page === 'current') renderCurrentPage();
    renderTotal();
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
});

document.getElementById('snapshot-date').value = todayISO();

document.getElementById('snapshot-date-picker')?.addEventListener('click', () => {
  const input = document.getElementById('snapshot-date');
  if (input?.showPicker) input.showPicker();
  else input?.focus();
});

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => showPage(btn.dataset.page));
});

document.getElementById('snapshot-back')?.addEventListener('click', () => showPage('history'));

document.getElementById('export-btn')?.addEventListener('click', exportData);

document.getElementById('import-btn')?.addEventListener('click', () => {
  document.getElementById('import-file')?.click();
});
document.getElementById('import-file')?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) importData(file);
  e.target.value = '';
});

document.getElementById('api-key-btn').addEventListener('click', () => {
  const cache = getPriceCache();
  const keys = Object.keys(cache);
  if (keys.length) {
    if (confirm('Clear price cache? Prices will be fetched again.')) {
      localStorage.removeItem(PRICE_CACHE_KEY);
    }
  } else {
    alert('Stock prices come from Yahoo Finance (no API key needed). Tap ↻ on a stock section to refresh.');
  }
});

renderTotal();
showPage('current');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
