// UTT DM Sync Content Script
// Fetches user's DM inbox using authenticated in-page headers and X API

(() => {
    const KEYS = {
        panel: 'dmSyncPanelEnabled',
        lastSnapshot: 'utt:dms:lastSnapshot:v1'
    };

    let csrf = null;
    let auth = null;
    let guest = null;
    let lastDmInboxUrl = null;
    let meId = null;

    function dsSerialize(v) { try { if (typeof v === 'string') return v; return JSON.stringify(v); } catch (_) { return String(v); } }
    function dsLog() {
        try {
            const line = Array.from(arguments).map(dsSerialize).join(' ');
            try { console.log('[UTT][DM]', ...arguments); } catch (_) {}
            try { chrome.runtime?.sendMessage({ type: 'UTT_DM', name: 'LOG', line }).catch(() => {}); } catch (_) {}
        } catch (_) {}
    }

    function extractHeadersFromDOM() {
        try {
            // Try to read from current document cookies/local storage
            const cookie = document.cookie || '';
            const m = /ct0=([^;]+)/.exec(cookie);
            csrf = m ? decodeURIComponent(m[1]) : null;
            const tw = /twid=([^;]+)/.exec(cookie);
            if (tw) {
                const val = decodeURIComponent(tw[1] || '');
                const um = /u=(\d+)/.exec(val);
                if (um) meId = um[1];
            }
        } catch (_) {}
        try {
            // Heuristic: Find last Authorization header from performance entries (if available)
            // If not available, keep previous cached values (populated via header echo)
            auth = window.__utt_cached_auth || auth;
            guest = window.__utt_cached_guest || guest;
        } catch (_) {}
        try {
            dsLog('headers', { hasCsrf: Boolean(csrf), csrfLen: csrf ? String(csrf).length : 0, hasAuth: Boolean(auth), authPreview: auth ? String(auth).slice(0, 12) + '…' : null, hasGuest: Boolean(guest), guestLen: guest ? String(guest).length : 0 });
        } catch (_) {}
    }

    function buildCommonHeaders() {
        const h = {
            'accept': 'application/json, text/plain, */*',
            'x-twitter-active-user': 'yes',
            'x-client-uuid': cryptoRandomId(),
            'x-twitter-auth-type': 'OAuth2Session',
            'x-twitter-client-language': navigator.language || 'en'
        };
        if (csrf) h['x-csrf-token'] = csrf;
        if (auth) h['authorization'] = auth;
        if (guest) h['x-guest-token'] = guest;
        return h;
    }

    function cryptoRandomId() { try { return [...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join(''); } catch (_) { return String(Math.random()).slice(2); } }

    async function fetchDMInbox(cursor = null) {
        ensureHookInjected();
        extractHeadersFromDOM();
        const params = new URLSearchParams({
            count: '50',
            include_conversation_info: 'true',
            include_quality: 'true'
        });
        if (cursor) params.set('cursor', cursor);
        const url = `https://x.com/i/api/2/dm/inbox.json?${params.toString()}`;
        dsLog('fetch inbox2', url);
        let res = await fetch(url, { headers: buildCommonHeaders(), credentials: 'include', mode: 'cors' });
        try { dsLog('inbox2 status', res.status, res.headers.get('content-type')); } catch (_) {}
        if (res.status === 404) {
            // Fallback to GraphQL DmInbox captured from logs or wait for it on /messages
            let gqlUrl = await getLastDmInboxGraphqlUrl();
            if (gqlUrl) {
                dsLog('fallback: using graphql', gqlUrl);
                res = await fetch(gqlUrl, { headers: buildCommonHeaders(), credentials: 'include', mode: 'cors' });
            } else {
                // Ensure we are on messages; then wait for hook to observe GraphQL call
                try { if (!location.pathname.startsWith('/messages')) { dsLog('navigate to /messages'); location.href = 'https://x.com/messages'; } } catch (_) {}
                try { stimulateMessagesPage(); } catch (_) {}
                // If already on messages, wait up to 6s for an incoming DmInbox request
                dsLog('waiting graphql DmInbox up to 10s');
                const waited = await waitForDmInboxGraphql(10000);
                if (waited) {
                    dsLog('waited url', waited);
                    res = await fetch(waited, { headers: buildCommonHeaders(), credentials: 'include', mode: 'cors' });
                } else {
                    dsLog('wait timeout, no DmInbox url');
                    const err = new Error('NAVIGATED_MESSAGES');
                    err.code = 'NAVIGATED_MESSAGES';
                    throw err;
                }
            }
        }
        if (!res.ok) { dsLog('final status not ok', res.status); throw new Error(`DM inbox failed ${res.status}`); }
        let data = null;
        try { data = await res.json(); } catch (e) { dsLog('json parse error', String(e)); throw e; }
        try {
            const keys = Object.keys(data || {});
            dsLog('json top keys', keys);
            dsLog('paths', { inbox_initial_state: Boolean(data?.inbox_initial_state), conversations: Boolean(data?.conversations) });
        } catch (_) {}
        return data;
    }

    async function getLastDmInboxGraphqlUrl() {
        try {
            if (lastDmInboxUrl) return lastDmInboxUrl;
            const store = await chrome.storage.local.get({ 'utt:netlog:v1': [], 'utt:lastDmInboxUrl': null });
            if (store['utt:lastDmInboxUrl']) return store['utt:lastDmInboxUrl'];
            const logs = Array.isArray(store['utt:netlog:v1']) ? store['utt:netlog:v1'] : [];
            for (let i = logs.length - 1; i >= 0; i--) {
                const e = logs[i];
                const u = String(e?.url || '');
                if (u.includes('/i/api/graphql/')) {
                    const lo = u.toLowerCase();
                    if (lo.includes('dminbox') || lo.includes('dm_inbox') || (lo.includes('dm') && lo.includes('inbox'))) {
                    lastDmInboxUrl = u;
                    return lastDmInboxUrl;
                    }
                }
            }
        } catch (_) {}
        return null;
    }

    function ensureHookInjected() {
        try {
            const id = 'utt-net-hook-script';
            if (document.getElementById(id)) return;
            const s = document.createElement('script');
            s.id = id;
            s.src = chrome.runtime.getURL('src/content/injectors/net-hook.js');
            s.type = 'text/javascript';
            document.documentElement.appendChild(s);
            s.remove();
            dsLog('net-hook injected');
        } catch (_) {}
    }

    function waitForDmInboxGraphql(timeoutMs) {
        return new Promise((resolve) => {
            if (lastDmInboxUrl) { resolve(lastDmInboxUrl); return; }
            const start = Date.now();
            const timer = setInterval(() => {
                if (lastDmInboxUrl) { clearInterval(timer); resolve(lastDmInboxUrl); return; }
                if (Date.now() - start > Number(timeoutMs || 6000)) { clearInterval(timer); resolve(null); }
            }, 200);
        });
    }

    // Listen to network events to capture GraphQL DmInbox URL in real time
    window.addEventListener('message', (e) => {
        try {
            const d = e?.data; if (!d || d.source !== 'UTT_NET' || d.type !== 'NETWORK_EVENT') return;
            const p = d.payload || {};
            const u = String(p?.url || '');
            if (u.includes('/i/api/graphql/')) {
                const lo = u.toLowerCase();
                if (lo.includes('dminbox') || lo.includes('dm_inbox') || (lo.includes('dm') && lo.includes('inbox'))) {
                lastDmInboxUrl = u;
                try { chrome.storage.local.set({ 'utt:lastDmInboxUrl': lastDmInboxUrl }); } catch (_) {}
                dsLog('observed graphql DmInbox', u);
                }
            }
        } catch (_) {}
    }, false);

    function stimulateMessagesPage() {
        try {
            const clickEl = document.querySelector('a[href="/messages"], [data-testid="AppTabBar_DirectMessage_Link"], nav a[role="link"][href="/messages"]');
            if (clickEl) clickEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        } catch (_) {}
        try { window.dispatchEvent(new Event('scroll')); } catch (_) {}
        try { const list = document.querySelector('[aria-label="Conversations"],[data-testid="inbox-conversation-list"]'); if (list) list.dispatchEvent(new Event('mouseover', { bubbles: true })); } catch (_) {}
    }

    function normalizeInbox(data) {
        try {
            const toArray = (v) => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);

            let raw = [];
            let foundAt = 'unknown';
            // Common shapes
            if (data?.inbox_initial_state?.conversations) { raw = toArray(data.inbox_initial_state.conversations); foundAt = 'inbox_initial_state.conversations'; dsLog('normalize: from inbox_initial_state.conversations', raw.length); }
            else if (data?.conversations) { raw = toArray(data.conversations); foundAt = 'conversations'; dsLog('normalize: from conversations', raw.length); }
            else {
                // Fallback: deep search for a property that looks like conversations
                raw = deepFindConversations(data);
                if (raw && raw.length) foundAt = 'deep.conversations';
                dsLog('normalize: deepFind size', Array.isArray(raw) ? raw.length : (raw && typeof raw === 'object' ? Object.keys(raw).length : 0));
            }

            const conversations = [];
            const messagesByConv = {};
            for (const c of toArray(raw)) {
                const cid = c?.conversation_id || c?.id;
                if (!cid) continue;
                const lastTs = Number(c?.sort_timestamp || c?.last_activity_at || c?.last_read_event_id) || Date.now();
                conversations.push({
                    id: cid,
                    name: c?.name || c?.displayName || '',
                    lastMessageTime: lastTs,
                    participantCount: Array.isArray(c?.participants) ? c.participants.length : (Array.isArray(c?.participant_ids) ? c.participant_ids.length : undefined)
                });
            }
            // Deep extract messages grouped by conversation
            try {
                const msgs = deepExtractMessages(data);
                for (const m of msgs) {
                    if (!m.conversationId) continue;
                    if (!messagesByConv[m.conversationId]) messagesByConv[m.conversationId] = [];
                    messagesByConv[m.conversationId].push(m);
                }
                for (const cid of Object.keys(messagesByConv)) {
                    messagesByConv[cid].sort((a,b) => (a.createdAt||0) - (b.createdAt||0));
                }
                dsLog('normalize: messages groups', Object.keys(messagesByConv).length);
            } catch (_) {}
            if (conversations.length === 0) {
                const ids = deepCollectIds(data);
                dsLog('normalize: ids from deep scan', ids.length);
                for (const cid of ids) conversations.push({ id: cid, name: '', lastMessageTime: Date.now(), participantCount: undefined });
                if (ids.length) foundAt = 'deep.ids';
            }
            dsLog('normalize: conversations out', conversations.length);
            return { conversations, messagesByConv, meta: { foundAt, count: conversations.length } };
        } catch (e) { return { conversations: [] }; }
    }

    function deepFindConversations(root) {
        const seen = new Set();
        const queue = [root];
        const toArray = (v) => Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.values(v) : []);
        while (queue.length) {
            const node = queue.shift();
            if (!node || typeof node !== 'object') continue;
            if (seen.has(node)) continue; seen.add(node);
            for (const [k, v] of Object.entries(node)) {
                if (!v) continue;
                const key = String(k).toLowerCase();
                if (key.includes('conversation')) {
                    const arr = toArray(v);
                    if (arr.length && typeof arr[0] === 'object' && ('conversation_id' in arr[0] || 'id' in arr[0])) return arr;
                }
                if (Array.isArray(v)) queue.push(...v);
                else if (typeof v === 'object') queue.push(v);
            }
        }
        return [];
    }

    function deepCollectIds(root) {
        const seen = new Set();
        const out = new Set();
        const queue = [root];
        while (queue.length) {
            const node = queue.shift();
            if (!node || typeof node !== 'object') continue;
            if (seen.has(node)) continue; seen.add(node);
            for (const [k,v] of Object.entries(node)) {
                if (k === 'conversation_id' || k === 'conversationId') {
                    const id = String(v || '').trim();
                    if (id) out.add(id);
                }
                if (Array.isArray(v)) queue.push(...v);
                else if (typeof v === 'object') queue.push(v);
            }
        }
        return Array.from(out);
    }

    function deepExtractMessages(root) {
        const out = [];
        const parents = new WeakMap();
        const stack = [root];
        const seen = new Set();
        while (stack.length) {
            const node = stack.pop();
            if (!node || typeof node !== 'object') continue;
            if (seen.has(node)) continue; seen.add(node);
            // Detect "message" shape
            const msg = node.message || node.message_create || node.event || null;
            const data = msg && (msg.message_data || msg.data || null);
            if (data && (typeof data.text === 'string' || data.text?.length)) {
                const convId = findNearestConversationId(node, parents);
                const senderId = deepFindString(node, ['sender_id','senderId','from_user_id','user_id']) || '';
                const createdAt = Number(node.time || node.timestamp_ms || Date.parse(node.created_at || '')) || Date.now();
                out.push({ conversationId: convId, senderId, text: String(data.text || ''), createdAt });
            }
            for (const [k,v] of Object.entries(node)) {
                if (v && typeof v === 'object') { parents.set(v, node); stack.push(v); }
            }
        }
        return out;
    }

    function findNearestConversationId(node, parents) {
        let cur = node; let depth = 0;
        while (cur && depth < 6) {
            if (typeof cur.conversation_id === 'string') return cur.conversation_id;
            if (typeof cur.conversationId === 'string') return cur.conversationId;
            cur = parents.get(cur); depth++;
        }
        return null;
    }

    function deepFindString(node, keys) {
        try {
            const stack = [node]; const seen = new Set();
            while (stack.length) {
                const cur = stack.pop();
                if (!cur || typeof cur !== 'object') continue;
                if (seen.has(cur)) continue; seen.add(cur);
                for (const k of Object.keys(cur)) {
                    if (keys.includes(k)) { const val = cur[k]; if (val != null) return String(val); }
                    const v = cur[k];
                    if (v && typeof v === 'object') stack.push(v);
                }
            }
        } catch (_) {}
        return '';
    }

    async function fetchV11AndExtract() {
        try {
            const params = new URLSearchParams({
                nsfw_filtering_enabled: 'false',
                filter_low_quality: 'true',
                include_quality: 'all',
                dm_users: 'true',
                include_groups: 'true',
                include_inbox_timelines: 'true'
            });
            const url = `https://x.com/i/api/1.1/dm/inbox_initial_state.json?${params.toString()}`;
            dsLog('fetch v1.1 inbox_initial_state', url);
            const res = await fetch(url, { headers: buildCommonHeaders(), credentials: 'include', mode: 'cors' });
            dsLog('v1.1 status', res.status);
            if (!res.ok) return null;
            const data = await res.json();
            // Extract conversations and messages from v1.1 shape
            const convs = [];
            const messagesByConv = {};
            const users = {};
            try {
                const convMap = data?.inbox_initial_state?.conversations || {};
                for (const [cid, c] of Object.entries(convMap)) {
                    const last = Number(c?.sort_timestamp || c?.last_activity_at) || Date.now();
                    convs.push({ id: cid, name: c?.name || '', lastMessageTime: last, participantCount: Array.isArray(c?.participants) ? c.participants.length : undefined });
                }
            } catch (_) {}
            try {
                const entries = data?.inbox_initial_state?.entries || [];
                for (const entry of entries) {
                    const js = entry?.message || entry?.message_create || entry?.content || null;
                    const md = js && (js.message_data || js.data || null);
                    if (!md) continue;
                    // Find conversationId from entry.conversation_id or nested path
                    const cid = entry?.conversation_id || entry?.conversationId || (entry?.message?.conversation_id) || null;
                    const senderId = deepFindString(entry, ['sender_id','senderId','from_user_id','user_id']);
                    const createdAt = Number(entry?.time || entry?.timestamp_ms || Date.parse(entry?.created_at || '')) || Date.now();
                    const text = typeof md.text === 'string' ? md.text : (md.text?.length ? String(md.text) : '');
                    const convId = cid || null;
                    if (!convId) continue;
                    if (!messagesByConv[convId]) messagesByConv[convId] = [];
                    messagesByConv[convId].push({ conversationId: convId, senderId, text, createdAt });
                }
            } catch (_) {}
            try { Object.assign(users, deepCollectUsers(data)); } catch (_) {}
            // Sort
            for (const cid of Object.keys(messagesByConv)) messagesByConv[cid].sort((a,b)=> (a.createdAt||0)-(b.createdAt||0));
            dsLog('v1.1 extracted', { convs: convs.length, groups: Object.keys(messagesByConv).length });
            return { conversations: convs, messagesByConv, users };
        } catch (_) { return null; }
    }

    function deepCollectUsers(root) {
        const out = {};
        const stack = [root]; const seen = new Set();
        while (stack.length) {
            const node = stack.pop();
            if (!node || typeof node !== 'object') continue;
            if (seen.has(node)) continue; seen.add(node);
            // Typical shapes: users: { [id]: { id|id_str, name, screen_name, profile_image_url_https } }
            if (node.profile_image_url_https && (node.id_str || node.id) && (node.screen_name || node.name)) {
                const id = String(node.id_str || node.id);
                out[id] = {
                    id,
                    name: String(node.name || ''),
                    handle: String(node.screen_name || ''),
                    avatar: String(node.profile_image_url_https || node.profile_image_url || '')
                };
            }
            for (const v of Object.values(node)) if (v && typeof v === 'object') stack.push(v);
        }
        return out;
    }

    // Listen for network debugger events to capture Authorization/Guest tokens
    window.addEventListener('message', (e) => {
        try {
            const d = e?.data;
            if (!d || d.source !== 'UTT_NET' || d.type !== 'NETWORK_EVENT') return;
            const p = d.payload || {};
            if (p?.requestHeaders) {
                const h = p.requestHeaders;
                if (h['authorization']) window.__utt_cached_auth = h['authorization'];
                if (h['x-guest-token']) window.__utt_cached_guest = h['x-guest-token'];
            }
        } catch (_) {}
    }, false);

    chrome.runtime.onMessage.addListener((msg, _sender, send) => {
        (async () => {
            try {
                if (msg?.type !== 'UTT_DM') return;
                if (msg.name === 'PING') {
                    extractHeadersFromDOM();
                    send({ ok: true, ready: true });
                    return;
                }
                if (msg.name === 'SYNC') {
                    const data = await fetchDMInbox();
                    let snapshot = normalizeInbox(data);
                    // If messages are empty, try v1.1 augmentation
                    try {
                        const msgCount = snapshot && snapshot.messagesByConv ? Object.values(snapshot.messagesByConv).reduce((a,b)=>a+(Array.isArray(b)?b.length:0),0) : 0;
                        if (!msgCount) {
                            const aug = await fetchV11AndExtract();
                    if (aug && aug.messagesByConv) {
                                snapshot.messagesByConv = aug.messagesByConv;
                                if ((!snapshot.conversations || !snapshot.conversations.length) && aug.conversations && aug.conversations.length) {
                                    snapshot.conversations = aug.conversations;
                                }
                        if (aug.users) snapshot.users = aug.users;
                                if (snapshot.meta) snapshot.meta.v11Augmented = true; else snapshot.meta = { v11Augmented: true };
                            }
                        }
                    } catch (_) {}
                    if (meId) snapshot.meId = meId;
                    await chrome.storage.local.set({ [KEYS.lastSnapshot]: snapshot });
                    send({ ok: true, snapshot });
                    return;
                }
                if (msg.name === 'HEADERS_STATUS') {
                    extractHeadersFromDOM();
                    const status = {
                        hasCsrf: Boolean(csrf),
                        csrfLen: csrf ? String(csrf).length : 0,
                        hasAuth: Boolean(auth),
                        authPreview: auth ? String(auth).slice(0, 12) + '…' : null,
                        hasGuest: Boolean(guest),
                        guestLen: guest ? String(guest).length : 0
                    };
                    send({ ok: true, status });
                    return;
                }
                if (msg.name === 'GET_SNAPSHOT') {
                    const store = await chrome.storage.local.get({ [KEYS.lastSnapshot]: null });
                    send({ ok: true, snapshot: store[KEYS.lastSnapshot] });
                    return;
                }
            } catch (e) {
                send({ ok: false, error: String(e?.message || e) });
            }
        })();
        return true;
    });
})();


