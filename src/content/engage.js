(() => {
    const DEV = (() => { try { return !Boolean(chrome.runtime.getManifest()?.update_url); } catch (_) { return true; } })();
    let DEBUG_ENABLED = false;

    const STATE = {
        running: false,
        executedCount: 0,
        maxActions: 20,
        mode: 'likes', // 'likes' | 'retweets' | 'both'
        cancelled: false,
        paused: false
    };

    let LOGS = [];
    function fmt(msg) {
        try {
            if (typeof msg === 'string') return msg;
            return JSON.stringify(msg);
        } catch (_) { return String(msg); }
    }
    async function writeLogs() {
        try { await chrome.storage.local.set({ engageLog: LOGS.slice(-300) }); } catch (_) {}
    }
    async function log(...args) {
        try { console.info('[UTT][ENGAGE]', ...args); } catch (_) {}
        try { window.UTTLogger?.log('[ENGAGE]', ...args); } catch (_) {}
        const line = `[${new Date().toLocaleTimeString()}] ${args.map(fmt).join(' ')}`;
        LOGS.push(line);
        await writeLogs();
    }

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
    async function sleepInterruptible(totalMs, stepMs = 120) {
        let elapsed = 0;
        while (elapsed < totalMs && !STATE.cancelled) {
            const next = Math.min(stepMs, totalMs - elapsed);
            await sleep(next);
            elapsed += next;
        }
    }
    async function humanDelay(base = 700, jitter = 650) {
        const delta = Math.floor(Math.random() * jitter);
        await sleepInterruptible(base + delta);
    }

    function isOnHomeFeed() {
        const ok = /x\.com/.test(location.host) && (/^\/(home)?$/.test(location.pathname) || location.pathname === '/home');
        log('isOnHomeFeed', ok, location.href);
        return ok;
    }

    function isVisible(el) {
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        const inViewport = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight + 50;
        const style = window.getComputedStyle(el);
        return inViewport && style.visibility !== 'hidden' && style.display !== 'none';
    }

    function clickWithEvents(el) {
        try {
            if (!isVisible(el)) el.scrollIntoView({ block: 'center' });
            const events = ['pointerover','mouseover','mousemove','pointerdown','mousedown','pointerup','mouseup','click'];
            for (const type of events) {
                el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
            }
            return true;
        } catch (_) { return false; }
    }

    function findTweetArticles(limit = 30) {
        const nodes = Array.from(document.querySelectorAll('article[data-testid="tweet"]')); // primary
        if (nodes.length) return nodes.slice(0, limit);
        // fallback: general articles (X often keeps tweets as article)
        return Array.from(document.querySelectorAll('article')).slice(0, limit);
    }

    function isAlreadyLiked(article) {
        try {
            const btn = article.querySelector('button[data-testid="like"][aria-pressed="true"], div[role="button"][data-testid="like"][aria-pressed="true"]');
            if (btn) return true;
            // fallback: heart filled path check by aria-label
            const labelEl = article.querySelector('button[aria-label*="Liked" i], div[role="button"][aria-label*="Liked" i]');
            return Boolean(labelEl);
        } catch (_) { return false; }
    }

    function isAlreadyRetweeted(article) {
        try {
            const btn = article.querySelector('button[data-testid="unretweet"], div[role="button"][data-testid="unretweet"]');
            if (btn) return true;
            const aria = article.querySelector('button[aria-label*="Undo Retweet" i], div[role="button"][aria-label*="Undo Retweet" i]');
            return Boolean(aria);
        } catch (_) { return false; }
    }

    function findLikeButton(article) {
        // Prefer data-testid
        let btn = article.querySelector('button[data-testid="like"], div[role="button"][data-testid="like"]');
        if (btn) return btn;
        // SVG path fallback using user-provided path d attribute may change; rely on role structure
        const candidates = Array.from(article.querySelectorAll('div[role="group"] button, div[role="group"] div[role="button"]'));
        return candidates.find((b) => /like/i.test(b.getAttribute('aria-label') || '')) || null;
    }

    function findRetweetButton(article) {
        let btn = article.querySelector('button[data-testid="retweet"], div[role="button"][data-testid="retweet"]');
        if (btn) return btn;
        const candidates = Array.from(article.querySelectorAll('div[role="group"] button, div[role="group"] div[role="button"]'));
        return candidates.find((b) => /retweet|repost/i.test(b.getAttribute('aria-label') || '')) || null;
    }

    async function ensureScrollToArticle(index) {
        const articles = findTweetArticles();
        const art = articles[index] || articles[articles.length - 1];
        if (art) art.scrollIntoView({ block: 'center' });
        await humanDelay(300, 300);
        window.scrollBy(0, 200);
        await humanDelay(150, 250);
    }

    async function retweetArticle(article) {
        if (isAlreadyRetweeted(article)) return false;
        const btn = findRetweetButton(article);
        if (!btn || !isVisible(btn)) return false;
        clickWithEvents(btn);
        await humanDelay(300, 300);
        // Confirm menu appears; choose Retweet (not Quote)
        const menuRetweet = document.querySelector('div[role="menuitem"][data-testid="retweetConfirm"]')
            || Array.from(document.querySelectorAll('div[role="menuitem"]')).find(m => /retweet|repost/i.test(m.textContent || ''));
        if (menuRetweet) {
            clickWithEvents(menuRetweet);
            await humanDelay(350, 300);
            await log('Retweeted');
            return true;
        }
        return false;
    }

    async function likeArticle(article) {
        if (isAlreadyLiked(article)) return false;
        const btn = findLikeButton(article);
        if (!btn || !isVisible(btn)) return false;
        clickWithEvents(btn);
        await humanDelay(300, 250);
        await log('Liked');
        return true;
    }

    async function engageOnce(article, mode) {
        let did = false;
        if (mode === 'likes') {
            did = await likeArticle(article);
        } else if (mode === 'retweets') {
            did = await retweetArticle(article);
        } else {
            // both: like first, then retweet; order chosen to look natural
            const liked = await likeArticle(article);
            await humanDelay(250, 250);
            const rted = await retweetArticle(article);
            did = liked || rted;
        }
        return did;
    }

    async function setProgress(running) {
        const total = STATE.maxActions;
        const done = STATE.executedCount;
        try { await chrome.storage.local.set({ engageProgress: { total, done, running: Boolean(running), paused: STATE.paused } }); } catch (_) {}
    }

    async function runEngage() {
        if (STATE.running) return;
        STATE.running = true;
        STATE.cancelled = false;
        STATE.paused = false;
        STATE.executedCount = 0;
        try {
            await log('runEngage: start', { mode: STATE.mode, max: STATE.maxActions });
            await setProgress(true);
            if (!isOnHomeFeed()) {
                await log('Not on home feed; abort');
                return;
            }

            let attempt = 0;
            while (!STATE.cancelled && STATE.executedCount < STATE.maxActions && attempt < STATE.maxActions * 6) {
                attempt++;
                if (STATE.paused) {
                    while (STATE.paused && !STATE.cancelled) await sleepInterruptible(200);
                    attempt--; continue;
                }
                await ensureScrollToArticle(attempt);
                const articles = findTweetArticles();
                if (!articles.length) { await log('No articles visible, scrolling'); await humanDelay(700, 600); window.scrollBy(0, 600); continue; }
                const article = articles.find(a => isVisible(a));
                if (!article) { await log('No visible article, delay'); await humanDelay(500, 400); continue; }
                const did = await engageOnce(article, STATE.mode);
                if (did) {
                    STATE.executedCount++;
                    await setProgress(true);
                }
                await humanDelay(900, 900);
            }
            await log('runEngage: done', { actions: STATE.executedCount });
        } catch (e) {
            await log('runEngage: error', e?.message || e);
        } finally {
            STATE.running = false;
            await setProgress(false);
        }
    }

    function handleStartEvent(detail) {
        try { window.UTTLogger?.enable?.(); } catch (_) {}
        if (STATE.running) return;
        const d = detail || {};
        const type = String(d.type || 'likes');
        const max = Number(d.max || 20);
        STATE.mode = ['likes','retweets','both'].includes(type) ? type : 'likes';
        STATE.maxActions = Number.isFinite(max) && max > 0 ? max : 20;
        runEngage();
    }

    document.addEventListener('UTT_START_ENGAGE', (e) => { log('event: UTT_START_ENGAGE'); handleStartEvent(e?.detail); });
    document.addEventListener('UTT_TOGGLE_PAUSE', async () => {
        STATE.paused = !STATE.paused;
        await setProgress(STATE.running);
        await log('pause toggled ->', STATE.paused);
    });
    document.addEventListener('UTT_CANCEL', async () => {
        STATE.cancelled = true;
        STATE.paused = false;
        STATE.running = false;
        await setProgress(false);
        await log('cancel requested');
    });

    // Fallback bridges
    try {
        chrome.runtime.onMessage.addListener((msg) => {
            if (!msg || msg.type !== 'UTT_CMD') return;
            if (msg.name === 'START_ENGAGE') handleStartEvent(msg.detail);
            if (msg.name === 'UTT_TOGGLE_PAUSE') { STATE.paused = !STATE.paused; setProgress(STATE.running); log('msg pause ->', STATE.paused); }
            if (msg.name === 'UTT_CANCEL') { STATE.cancelled = true; STATE.paused = false; STATE.running = false; setProgress(false); log('msg cancel'); }
        });
    } catch (_) {}

    try {
        window.addEventListener('message', (e) => {
            if (!e || !e.data || e.data.source !== 'UTT' || e.data.type !== 'UTT_CMD') return;
            if (e.data.name === 'UTT_START_ENGAGE') handleStartEvent(e.data.detail);
            if (e.data.name === 'UTT_TOGGLE_PAUSE') { STATE.paused = !STATE.paused; setProgress(STATE.running); log('postMessage pause ->', STATE.paused); }
            if (e.data.name === 'UTT_CANCEL') { STATE.cancelled = true; STATE.paused = false; STATE.running = false; setProgress(false); log('postMessage cancel'); }
        });
    } catch (_) {}

    // Storage bridge
    try {
        let lastTs = 0;
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes.engageCommand) return;
            const cmd = changes.engageCommand.newValue || {};
            if (!cmd || typeof cmd.ts !== 'number' || cmd.ts === lastTs) return;
            lastTs = cmd.ts;
            switch (cmd.name) {
                case 'UTT_TOGGLE_PAUSE':
                    STATE.paused = !STATE.paused; setProgress(STATE.running); log('storage pause ->', STATE.paused); break;
                case 'UTT_CANCEL':
                    STATE.cancelled = true; STATE.paused = false; STATE.running = false; setProgress(false); log('storage cancel'); break;
                default: break;
            }
        });
    } catch (_) {}

    // Auto-start when arriving with intent flag
    (async () => {
        try {
            const { autoStartEngage = null, debugLogs = false, debugLogsUntil = 0 } = await chrome.storage.local.get({ autoStartEngage: null, debugLogs: false, debugLogsUntil: 0 });
            DEBUG_ENABLED = Boolean(debugLogs) || (Number(debugLogsUntil) > Date.now());
            if (autoStartEngage && isOnHomeFeed()) {
                await sleep(800);
                log('auto-start engage: intent detected');
                handleStartEvent(autoStartEngage);
                try { await chrome.storage.local.set({ autoStartEngage: null }); } catch (_) {}
            }
        } catch (_) {}
    })();

    setTimeout(() => { log('engage content script ready'); }, 0);
    try { window.UTTLogger?.injectOverlay?.(); } catch (_) {}
})();


