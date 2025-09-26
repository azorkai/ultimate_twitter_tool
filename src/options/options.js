const safe = document.getElementById('safe-mode');
const maxF = document.getElementById('max-follows');
const saveBtn = document.getElementById('save');
const tabs = Array.from(document.querySelectorAll('.tab'));
const panels = Array.from(document.querySelectorAll('.panel'));
let userInteracted = false;

// Favorites elements
const favList = document.getElementById('fav-list');
const favEmpty = document.getElementById('fav-empty');
const favRefresh = document.getElementById('fav-refresh');
const favClear = document.getElementById('fav-clear');

function setActiveTab(id) {
    try {
        const tabId = `tab-${id}`;
        const panelId = `panel-${id}`;
        tabs.forEach(t => t.setAttribute('aria-selected', String(t.id === tabId)));
        panels.forEach(p => p.setAttribute('aria-hidden', String(p.id !== panelId)));
        chrome.storage.sync.set({ optionsSelectedTab: id }).catch(() => {});
    } catch (_) {}
}

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        userInteracted = true;
        const id = tab.id.replace('tab-', '');
        setActiveTab(id);
    });
    tab.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const idx = tabs.indexOf(tab);
        const next = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
        tabs[next].focus();
        userInteracted = true;
        const id = tabs[next].id.replace('tab-', '');
        setActiveTab(id);
    });
});

(async () => {
    try {
        const { safeMode = true, maxFollows = 20, optionsSelectedTab = 'follow' } = await chrome.storage.sync.get({ safeMode: true, maxFollows: 20, optionsSelectedTab: 'follow' });
        if (safe) safe.checked = Boolean(safeMode);
        if (maxF) maxF.value = String(maxFollows);
        if (!userInteracted) setActiveTab(optionsSelectedTab);
    } catch (_) {}
})();

// Favorites logic
const STORAGE_KEY = 'utt:favorites:v1';
function formatFollowers(n) {
    if (typeof n !== 'number' || !isFinite(n)) return '-';
    if (n >= 1e9) return (n/1e9).toFixed(1).replace(/\.0$/, '') + 'B';
    if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
}
async function loadFavorites() {
    try { const store = await chrome.storage.local.get({ [STORAGE_KEY]: {} }); return store[STORAGE_KEY] || {}; } catch (_) { return {}; }
}
async function clearFavorites() { try { await chrome.storage.local.set({ [STORAGE_KEY]: {} }); } catch (_) {} }
function initialLetter(item) { const s = String(item.displayName || item.handle || '?').trim(); return s.charAt(0).toUpperCase() || '?'; }
function renderFavs(map) {
    if (!favList || !favEmpty) return;
    favList.innerHTML = '';
    const entries = Object.values(map).sort((a,b) => (b.addedAt||0) - (a.addedAt||0));
    favEmpty.hidden = entries.length > 0;
    for (const item of entries) {
        const el = document.createElement('div');
        el.className = 'fav-card';
        el.innerHTML = `
            <div class="fav-left">
                <div class="fav-avatar" aria-hidden="true">${initialLetter(item)}</div>
                <div class="fav-meta">
                    <div class="fav-handle">@${item.handle}</div>
                    <div class="fav-name">${item.displayName ? item.displayName : ''} <span class="fav-badge" title="Followers">${formatFollowers(item.followers)}</span></div>
                </div>
            </div>
            <div class="fav-actions">
                <a class="btn btn-ghost" target="_blank" rel="noreferrer" href="https://x.com/${item.handle}">Open</a>
            </div>
        `;
        favList.appendChild(el);
    }
}

if (favRefresh) favRefresh.addEventListener('click', async () => renderFavs(await loadFavorites()));
if (favClear) favClear.addEventListener('click', async () => { await clearFavorites(); renderFavs({}); });
loadFavorites().then(renderFavs);

saveBtn?.addEventListener('click', async () => {
    try {
        await chrome.storage.sync.set({ safeMode: Boolean(safe?.checked), maxFollows: Number(maxF?.value || 20) });
        if (saveBtn) {
            saveBtn.textContent = 'Saved';
            setTimeout(() => saveBtn.textContent = 'Save', 1000);
        }
    } catch (_) {}
});


