const safe = document.getElementById('safe-mode');
const maxF = document.getElementById('max-follows');
const saveBtn = document.getElementById('save');
// Ad Blocker elements
const adEnabled = document.getElementById('ad-enabled');
const adPanel = document.getElementById('ad-panel');
const adMode = document.getElementById('ad-mode');
const adCount = document.getElementById('ad-count');
const adLast = document.getElementById('ad-last');
const adSave = document.getElementById('ad-save');
const adRefresh = document.getElementById('ad-refresh');
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
// Ad Blocker logic
const AD_KEYS = {
    enabled: 'adBlockerEnabled',
    panel: 'adBlockerPanelEnabled',
    removeCompletely: 'removeAdsCompletely',
    chillMode: 'chillModeEnabled',
    count: 'blockedAdsCount',
    last: 'lastBlockedTime'
};

async function loadAdSettings() {
    try {
        const store = await chrome.storage.local.get({
            [AD_KEYS.enabled]: true,
            [AD_KEYS.panel]: false,
            [AD_KEYS.removeCompletely]: true,
            [AD_KEYS.chillMode]: false,
            [AD_KEYS.count]: 0,
            [AD_KEYS.last]: null
        });
        if (adEnabled) adEnabled.checked = Boolean(store[AD_KEYS.enabled]);
        if (adPanel) adPanel.checked = Boolean(store[AD_KEYS.panel]);
        if (adMode) {
            const remove = Boolean(store[AD_KEYS.removeCompletely]);
            const chill = Boolean(store[AD_KEYS.chillMode]);
            adMode.value = remove ? 'remove' : (chill ? 'chill' : 'message');
        }
        if (adCount) adCount.textContent = String(store[AD_KEYS.count] || 0);
        if (adLast) adLast.textContent = store[AD_KEYS.last] ? new Date(store[AD_KEYS.last]).toLocaleString() : '—';
    } catch (_) {}
}

function getActiveXTabQuery() {
    return chrome.tabs.query({ url: ['https://x.com/*'] });
}

async function sendToAllXTabs(message) {
    try {
        const tabs = await getActiveXTabQuery();
        await Promise.all((tabs || []).map(t => chrome.tabs.sendMessage(t.id, message).catch(() => {})));
    } catch (_) {}
}

adSave?.addEventListener('click', async () => {
    const enabled = Boolean(adEnabled?.checked);
    const panel = Boolean(adPanel?.checked);
    const mode = String(adMode?.value || 'remove');
    const removeCompletely = mode === 'remove';
    const chillMode = mode === 'chill';
    try {
        await chrome.storage.local.set({
            [AD_KEYS.enabled]: enabled,
            [AD_KEYS.panel]: panel,
            [AD_KEYS.removeCompletely]: removeCompletely,
            [AD_KEYS.chillMode]: chillMode
        });
        await sendToAllXTabs({ type: 'UTT_ADBLOCK', name: 'TOGGLE_ENABLED', enabled });
        await sendToAllXTabs({ type: 'UTT_ADBLOCK', name: 'TOGGLE_PANEL', visible: panel });
        await sendToAllXTabs({ type: 'UTT_ADBLOCK', name: 'UPDATE_SETTINGS', removeCompletely, chillMode });
        if (adSave) { adSave.textContent = 'Saved'; setTimeout(() => adSave.textContent = 'Save', 1000); }
    } catch (_) {}
});

adRefresh?.addEventListener('click', async () => {
    try {
        await sendToAllXTabs({ type: 'UTT_ADBLOCK', name: 'FORCE_REFRESH' });
        // Also refresh stats
        setTimeout(loadAdSettings, 500);
    } catch (_) {}
});

// Initial load and keep stats in sync while options page open
loadAdSettings();
try {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (AD_KEYS.count in changes || AD_KEYS.last in changes) {
            if (adCount && changes[AD_KEYS.count]) adCount.textContent = String(changes[AD_KEYS.count].newValue || 0);
            if (adLast) adLast.textContent = (changes[AD_KEYS.last] && changes[AD_KEYS.last].newValue) ? new Date(changes[AD_KEYS.last].newValue).toLocaleString() : '—';
        }
    });
} catch (_) {}



// Network Debugger (Options)
const ND_KEYS = {
    enabled: 'netDebugEnabled',
    panel: 'netDebugPanelEnabled',
    maxEntries: 'netDebugMaxEntries',
    autoPersist: 'netDebugAutoPersist'
};
const NET_LOG_STORAGE_KEY = 'utt:netlog:v1';

const netEnabled = document.getElementById('net-enabled');
const netPanel = document.getElementById('net-panel');
const netMax = document.getElementById('net-max');
const netPersist = document.getElementById('net-persist');
const netSave = document.getElementById('net-save');
const netExport = document.getElementById('net-export');
const netClear = document.getElementById('net-clear');

async function loadNetSettings() {
    try {
        const store = await chrome.storage.local.get({
            [ND_KEYS.enabled]: false,
            [ND_KEYS.panel]: false,
            [ND_KEYS.maxEntries]: 400,
            [ND_KEYS.autoPersist]: true
        });
        if (netEnabled) netEnabled.checked = Boolean(store[ND_KEYS.enabled]);
        if (netPanel) netPanel.checked = Boolean(store[ND_KEYS.panel]);
        if (netMax) netMax.value = String(store[ND_KEYS.maxEntries] || 400);
        if (netPersist) netPersist.checked = Boolean(store[ND_KEYS.autoPersist]);
    } catch (_) {}
}

async function saveNetSettings() {
    const enabled = Boolean(netEnabled?.checked);
    const panel = Boolean(netPanel?.checked);
    const maxEntries = Number(netMax?.value || 400);
    const autoPersist = Boolean(netPersist?.checked);
    try {
        await chrome.storage.local.set({
            [ND_KEYS.enabled]: enabled,
            [ND_KEYS.panel]: panel,
            [ND_KEYS.maxEntries]: maxEntries,
            [ND_KEYS.autoPersist]: autoPersist
        });
        await sendToAllXTabs({ type: 'UTT_NETDBG', name: 'TOGGLE_ENABLED', enabled });
        await sendToAllXTabs({ type: 'UTT_NETDBG', name: 'TOGGLE_PANEL', visible: panel });
        await sendToAllXTabs({ type: 'UTT_NETDBG', name: 'UPDATE_MAX_ENTRIES', maxEntries });
        if (netSave) { netSave.textContent = 'Saved'; setTimeout(() => netSave.textContent = 'Save', 1000); }
    } catch (_) {}
}

netSave?.addEventListener('click', saveNetSettings);
netExport?.addEventListener('click', async () => {
    try { await chrome.runtime.sendMessage({ type: 'UTT_NETDBG', name: 'EXPORT_LOGS' }); } catch (_) {}
});
netClear?.addEventListener('click', async () => {
    try {
        await chrome.storage.local.set({ [NET_LOG_STORAGE_KEY]: [] });
        await sendToAllXTabs({ type: 'UTT_NETDBG', name: 'CLEAR_LOGS' });
    } catch (_) {}
});

loadNetSettings();

// Messages (DM) sync
const DM_LIST = document.getElementById('dm-list');
const DM_STATUS = document.getElementById('dm-status');
const DM_SYNC = document.getElementById('dm-sync');
const DM_EXPORT = document.getElementById('dm-export');
const DM_NET_OPEN = document.getElementById('open-net-console');
const DM_REFRESH = document.getElementById('dm-refresh');
const DM_SNAPSHOT_KEY = 'utt:dms:lastSnapshot:v1';
const DM_MODAL = document.getElementById('dm-modal');
const DM_MODAL_TITLE = document.getElementById('dm-modal-title');
const DM_MODAL_META = document.getElementById('dm-modal-meta');
const DM_MODAL_THREAD = document.getElementById('dm-modal-thread');
const DM_MODAL_CLOSE = document.getElementById('dm-modal-close');
const DM_MODAL_AVATAR = document.getElementById('dm-modal-avatar');
let DM_USERS = {};

function renderDMs(snapshot) {
    try {
        if (!DM_LIST) return;
        DM_LIST.innerHTML = '';
        const baseList = (snapshot && snapshot.conversations) || [];
        const groups = (snapshot && snapshot.messagesByConv) || {};
        DM_USERS = snapshot && snapshot.users ? (snapshot.users || {}) : {};
        // Merge ids from groups
        const byId = new Map();
        for (const c of baseList) byId.set(String(c.id), { ...c });
        for (const [cid, arr] of Object.entries(groups)) {
            const messages = Array.isArray(arr) ? arr : [];
            const lastTs = messages.length ? Number(messages[messages.length - 1].createdAt || 0) : undefined;
            if (!byId.has(cid)) byId.set(cid, { id: cid, name: '', lastMessageTime: lastTs || Date.now(), participantCount: undefined });
            else if (lastTs) { const ref = byId.get(cid); ref.lastMessageTime = Math.max(Number(ref.lastMessageTime || 0), lastTs); }
        }
        const list = Array.from(byId.values()).sort((a,b) => (Number(b.lastMessageTime||0) - Number(a.lastMessageTime||0)));
        if (!list.length) {
            const p = document.createElement('p'); p.className = 'help'; p.textContent = 'No conversations. Click SYNC to fetch your inbox.'; DM_LIST.appendChild(p);
            return;
        }
        for (const c of list) {
            const el = document.createElement('div'); el.className = 'fav-card dm-card';
            const msgs = Array.isArray(groups[c.id]) ? groups[c.id] : [];
            const lastTwo = msgs.slice(-2);
            const preview = lastTwo.map(m => (m && m.text ? String(m.text).replace(/\s+/g,' ').slice(0,140) : '')).filter(Boolean).join(' · ');
            const other = guessOtherUser(c.id);
            const title = (other && (other.name || other.handle)) || c.name || c.id;
            const avatarHtml = other && other.avatar ? `<img alt="" src="${other.avatar}"/>` : '💬';
            el.innerHTML = `
                <div class="dm-avatar" aria-hidden="true">${avatarHtml}</div>
                <div class="fav-meta" style="gap:6px;">
                    <div class="fav-handle">${title}</div>
                    <div class="dm-preview">${preview || '—'}</div>
                    <div class="dm-meta">Participants: ${c.participantCount ?? '-'} • Last: ${new Date(c.lastMessageTime || Date.now()).toLocaleString()}</div>
                </div>
            `;
            el.addEventListener('click', () => openConversation(c, msgs));
            DM_LIST.appendChild(el);
        }
    } catch (_) {}
}

async function loadDMSnapshot() { try { const store = await chrome.storage.local.get({ [DM_SNAPSHOT_KEY]: null }); return store[DM_SNAPSHOT_KEY] || null; } catch (_) { return null; } }

async function ensureXTab() {
    const tabs = await getActiveXTabQuery();
    if (tabs && tabs.length) return tabs;
    try {
        const created = await chrome.tabs.create({ url: 'https://x.com/messages' });
        // Wait briefly to allow content_scripts to load
        await new Promise(r => setTimeout(r, 1500));
        return [created];
    } catch (_) { return []; }
}

function setSyncUi(state) {
    try {
        if (!DM_SYNC) return;
        if (state === 'busy') { DM_SYNC.disabled = true; DM_SYNC.textContent = 'Syncing…'; }
        else { DM_SYNC.disabled = false; DM_SYNC.textContent = 'SYNC'; }
    } catch (_) {}
}

DM_REFRESH?.addEventListener('click', async () => { try { renderDMs(await loadDMSnapshot()); } catch (_) {} });

loadDMSnapshot().then((snap) => { 
    try { window.__utt_meid = snap && snap.meId ? String(snap.meId) : ''; } catch (_) {}
    renderDMs(snap); 
    try { const m = document.getElementById('dm-modal'); if (m) { m.hidden = true; m.setAttribute('hidden',''); } } catch (_) {} 
});

DM_SYNC?.addEventListener('click', async () => {
    try {
        openInlineDebugLog(); appendDebug('[DM][SYNC] click');
        setSyncUi('busy');
        if (DM_STATUS) DM_STATUS.textContent = 'Preparing to sync…';
        let tabs = await ensureXTab();
        appendDebug(`[DM][SYNC] tabs: ${tabs ? tabs.length : 0}`);
        if (!tabs || !tabs.length) {
            if (DM_STATUS) DM_STATUS.textContent = 'Could not open/find an x.com tab.';
            appendDebug('[DM][SYNC] no tabs');
            setSyncUi('idle');
            return;
        }
        // Ping tabs to ensure content script is alive (retry up to 5 times)
        let alive = [];
        for (let attempt = 0; attempt < 5 && alive.length === 0; attempt++) {
            const pings = await Promise.all(tabs.map(async t => {
                try { return await chrome.tabs.sendMessage(t.id, { type: 'UTT_DM', name: 'PING' }); } catch (_) { return null; }
            }));
            alive = tabs.filter((_,i) => pings[i] && pings[i].ok);
            appendDebug(`[DM][SYNC] ping attempt ${attempt+1}: ${JSON.stringify(pings)}`);
            if (alive.length === 0) await new Promise(r => setTimeout(r, 600));
        }
        const targetTabs = alive.length ? alive : tabs;
        if (DM_STATUS) DM_STATUS.textContent = 'Syncing…';
        const results = await Promise.all(targetTabs.map(async t => {
            try { return await chrome.tabs.sendMessage(t.id, { type: 'UTT_DM', name: 'SYNC' }); } catch (e) { return { ok:false, error:String(e) }; }
        }));
        appendDebug(`[DM][SYNC] results: ${JSON.stringify(results)}`);
        const anyOk = results.some(r => r && r.ok);
        if (DM_STATUS) DM_STATUS.textContent = anyOk ? 'Done.' : 'No response from X tab.';
        // Trigger immediate render
        renderDMs(await loadDMSnapshot());
    } catch (e) {
        if (DM_STATUS) DM_STATUS.textContent = 'Sync failed.';
        appendDebug(`[DM][SYNC] error: ${String(e)}`);
    } finally { setSyncUi('idle'); }
});

// Live update: re-render when snapshot changes
try {
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local') return;
        if (DM_SNAPSHOT_KEY in changes) {
            const snap = changes[DM_SNAPSHOT_KEY].newValue;
            try { window.__utt_meid = snap && snap.meId ? String(snap.meId) : ''; } catch (_) {}
            renderDMs(snap);
        }
    });
} catch (_) {}

function openConversation(conv, msgs) {
    try {
        if (!DM_MODAL || !DM_MODAL_THREAD || !DM_MODAL_TITLE || !DM_MODAL_META) return;
        try { DM_MODAL.hidden = false; DM_MODAL.removeAttribute('hidden'); } catch (_) {}
        const other = guessOtherUser(conv.id);
        const title = (other && (other.name || other.handle)) || conv.name || conv.id;
        DM_MODAL_TITLE.textContent = title;
        DM_MODAL_META.textContent = `Messages: ${Array.isArray(msgs)?msgs.length:0} • Last: ${new Date(conv.lastMessageTime||Date.now()).toLocaleString()}`;
        DM_MODAL_THREAD.innerHTML = '';
        if (DM_MODAL_AVATAR) DM_MODAL_AVATAR.innerHTML = other && other.avatar ? `<img alt="" src="${other.avatar}"/>` : '💬';
        const arr = Array.isArray(msgs) ? msgs : [];
        for (const m of arr.slice(-200)) {
            const bubble = document.createElement('div');
            const isMe = isFromMe(m, conv.id);
            bubble.className = 'bubble' + (isMe ? ' me' : '');
            const senderLabel = resolveSenderLabel(m, conv.id, isMe);
            const senderEl = document.createElement('span'); senderEl.className = 'sender'; senderEl.textContent = senderLabel;
            const textEl = document.createElement('div'); textEl.textContent = m.text || '';
            const time = document.createElement('span'); time.className = 'time'; time.textContent = new Date(m.createdAt || Date.now()).toLocaleString();
            bubble.appendChild(senderEl);
            bubble.appendChild(textEl);
            bubble.appendChild(time);
            DM_MODAL_THREAD.appendChild(bubble);
        }
        DM_MODAL_THREAD.scrollTop = DM_MODAL_THREAD.scrollHeight;
    } catch (_) {}
}

DM_MODAL_CLOSE?.addEventListener('click', () => { const m = document.getElementById('dm-modal'); if (m) m.hidden = true; });
const DM_MODAL_EL = document.getElementById('dm-modal');
DM_MODAL_EL?.addEventListener('click', (e) => { if (e.target === DM_MODAL_EL) { try { DM_MODAL_EL.hidden = true; DM_MODAL_EL.setAttribute('hidden',''); } catch (_) {} } });
document.addEventListener('click', (e) => { if ((e.target && e.target.id === 'dm-modal-close')) { try { DM_MODAL_EL.hidden = true; DM_MODAL_EL.setAttribute('hidden',''); } catch (_) {} } });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { try { DM_MODAL_EL.hidden = true; DM_MODAL_EL.setAttribute('hidden',''); } catch (_) {} } });

function guessOtherUser(convId) {
    try {
        const parts = String(convId || '').split('-');
        if (parts.length === 2) {
            const a = parts[0], b = parts[1];
            const otherId = (DM_USERS[b] && b) || (DM_USERS[a] && a) || null;
            if (otherId && DM_USERS[otherId]) return DM_USERS[otherId];
        }
        return null;
    } catch (_) { return null; }
}

function isFromMe(msg, convId) {
    try {
        const sender = String(msg?.senderId || '');
        if (window.__utt_meid && sender === window.__utt_meid) return true;
        return false;
    } catch (_) { return false; }
}

function resolveSenderLabel(msg, convId, isMe) {
    try {
        if (isMe) return 'You';
        const sender = String(msg?.senderId || '');
        if (DM_USERS && DM_USERS[sender]) {
            const u = DM_USERS[sender];
            return u.name || u.handle || sender;
        }
        return sender || '—';
    } catch (_) { return '—'; }
}

// Lightweight Network Console inside options
DM_NET_OPEN?.addEventListener('click', async () => {
    try {
        openInlineNetConsole();
    } catch (_) {}
});

// Wire debug log open button
const DM_DEBUG_OPEN = document.getElementById('open-debug-log');
DM_DEBUG_OPEN?.addEventListener('click', () => { try { openInlineDebugLog(); } catch (_) {} });

// Danger Zone: clear all data
const DM_CLEAR_ALL = document.getElementById('dm-clear-all');
DM_CLEAR_ALL?.addEventListener('click', async () => {
    try {
        await chrome.storage.local.clear();
        renderDMs({ conversations: [], messagesByConv: {} });
        openInlineDebugLog(); appendDebug('[DM] Cleared all local data');
    } catch (_) {}
});

function openInlineNetConsole() {
    const existing = document.getElementById('utt-net-console');
    if (existing) { existing.remove(); }
    const box = document.createElement('div');
    box.id = 'utt-net-console';
    Object.assign(box.style, {
        position: 'fixed', top: '12px', right: '12px', width: '720px', height: '420px',
        background: 'rgba(0,0,0,0.9)', color: '#e6e9ef', border: '2px solid #5b8cff',
        borderRadius: '10px', zIndex: '999999', display: 'grid', gridTemplateRows: 'auto 1fr', boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
    });
    const head = document.createElement('div');
    head.textContent = 'UTT Network Console';
    Object.assign(head.style, { display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px', padding:'8px', background:'#121723', borderBottom:'1px solid #2a3348', fontWeight:'700', cursor:'move' });
    const actions = document.createElement('div'); actions.style.display='flex'; actions.style.gap='6px';
    const btn = (label) => { const b = document.createElement('button'); b.textContent=label; Object.assign(b.style,{background:'#111827', color:'#e6e9ef', border:'1px solid #374151', padding:'4px 8px', borderRadius:'999px', cursor:'pointer', fontWeight:'700'}); b.onmouseenter=()=>b.style.background='#1f2937'; b.onmouseleave=()=>b.style.background='#111827'; return b; };
    const closeBtn = btn('Close');
    const refreshBtn = btn('Refresh');
    actions.append(refreshBtn, closeBtn);
    head.appendChild(actions);
    const list = document.createElement('div'); list.style.overflow='auto'; list.style.fontFamily='ui-monospace,Menlo,Consolas,monospace'; list.style.fontSize='12px';
    box.append(head, list);
    document.body.appendChild(box);

    function renderRows(rows) {
        list.innerHTML = '';
        for (const e of rows) {
            const row = document.createElement('div');
            Object.assign(row.style, { display:'grid', gridTemplateColumns:'66px 1fr 54px 60px', gap:'6px', alignItems:'center', padding:'4px 8px', borderBottom:'1px solid #243049' });
            const m = document.createElement('div'); m.textContent = String(e.method||'').slice(0,6); m.style.color='#fde68a'; m.style.fontWeight='700';
            const u = document.createElement('div'); u.textContent = String(e.url||'').replace(/^https?:\/\//,'').slice(0,160); u.title = e.url || '';
            const s = document.createElement('div'); s.textContent = String(e.status ?? '-'); s.style.color = (e.status||0)>=400 ? '#fca5a5' : '#86efac'; s.style.fontWeight='700';
            const d = document.createElement('div'); d.textContent = e.durationMs ? `${e.durationMs} ms` : '-'; d.style.color = '#93c5fd'; d.style.textAlign = 'right';
            row.append(m,u,s,d);
            list.appendChild(row);
        }
    }

    async function refresh() {
        try {
            const store = await chrome.storage.local.get({ 'utt:netlog:v1': [] });
            const logs = Array.isArray(store['utt:netlog:v1']) ? store['utt:netlog:v1'] : [];
            renderRows(logs.slice(-500));
        } catch (_) {}
    }

    let dragging=false, sx=0, sy=0, sl=0, st=0;
    head.addEventListener('mousedown', (e)=>{ dragging=true; sx=e.clientX; sy=e.clientY; const r=box.getBoundingClientRect(); sl=r.left; st=r.top; document.body.style.userSelect='none'; });
    document.addEventListener('mousemove', (e)=>{ if(!dragging) return; const dx=e.clientX-sx, dy=e.clientY-sy; box.style.left=(sl+dx)+'px'; box.style.top=(st+dy)+'px'; box.style.right=''; box.style.bottom=''; });
    document.addEventListener('mouseup', ()=>{ dragging=false; document.body.style.userSelect=''; });
    closeBtn.addEventListener('click', ()=> box.remove());
    refreshBtn.addEventListener('click', refresh);

    try {
        chrome.storage.onChanged.addListener((changes, area)=>{ if(area!=='local') return; if('utt:netlog:v1' in changes) refresh(); });
    } catch (_) {}

    refresh();
}

// Inline debug log panel
function openInlineDebugLog() {
    const existing = document.getElementById('utt-debug-log');
    if (existing) { existing.remove(); }
    const box = document.createElement('div');
    box.id = 'utt-debug-log';
    Object.assign(box.style, {
        position: 'fixed', bottom: '12px', right: '12px', width: '640px', height: '260px',
        background: 'rgba(0,0,0,0.88)', color: '#e6e9ef', border: '2px solid #9c6bff',
        borderRadius: '10px', zIndex: '999999', display: 'grid', gridTemplateRows: 'auto 1fr', boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
    });
    const head = document.createElement('div');
    head.textContent = 'UTT Debug Log';
    Object.assign(head.style, { display:'flex', alignItems:'center', justifyContent:'space-between', gap:'8px', padding:'8px', background:'#121723', borderBottom:'1px solid #2a3348', fontWeight:'700' });
    const actions = document.createElement('div'); actions.style.display='flex'; actions.style.gap='6px';
    const btn = (label) => { const b = document.createElement('button'); b.textContent=label; Object.assign(b.style,{background:'#111827', color:'#e6e9ef', border:'1px solid #374151', padding:'4px 8px', borderRadius:'999px', cursor:'pointer', fontWeight:'700'}); b.onmouseenter=()=>b.style.background='#1f2937'; b.onmouseleave=()=>b.style.background='#111827'; return b; };
    const clearBtn = btn('Clear'); const closeBtn = btn('Close'); actions.append(clearBtn, closeBtn);
    head.appendChild(actions);
    const list = document.createElement('div'); list.style.overflow='auto'; list.style.fontFamily='ui-monospace,Menlo,Consolas,monospace'; list.style.fontSize='12px';
    box.append(head, list);
    document.body.appendChild(box);
    clearBtn.addEventListener('click', ()=> list.innerHTML = '');
    closeBtn.addEventListener('click', ()=> box.remove());

    window.__utt_append_debug = (line) => {
        try {
            const row = document.createElement('div'); row.textContent = `[${new Date().toLocaleTimeString()}] ${line}`;
            list.appendChild(row); list.scrollTop = list.scrollHeight;
        } catch (_) {}
    };
}

function appendDebug(line) { try { if (window.__utt_append_debug) window.__utt_append_debug(String(line)); else console.log('[UTT][DEBUG]', line); } catch (_) {} }
