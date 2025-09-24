(() => {
	// Development mode detection: unpacked extensions usually have no update_url
    const DEV = (() => { try { return !Boolean(chrome.runtime.getManifest()?.update_url); } catch (_) { return true; } })();
    let DEBUG_ENABLED = false;

	const STATE = {
		running: false,
		executedCount: 0,
		maxFollows: 20,
		safeMode: true,
		paused: false,
		cancelled: false
	};

    function debugLog(...args) {
        try { console.info('[UTT][FB]', ...args); } catch (_) {}
        // Always try overlay for visibility; it internally checks enablement
        try { window.UTTLogger?.log('[FB]', ...args); } catch (_) {}
        if (!(DEV || DEBUG_ENABLED)) return;
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

	async function humanDelay(base = 600, jitter = 500) {
		const delta = Math.floor(Math.random() * jitter);
		await sleepInterruptible(base + delta);
	}

	function isOnFollowersPage() {
		const ok = /x\.com/.test(location.host) && /\/[^\/]+\/verified_followers/.test(location.pathname);
		if (DEV) debugLog('isOnFollowersPage:', ok, location.href);
		return ok;
	}

	function findFollowBackButtons() {
		// Target actionable follow/follow-back on verified followers list; avoid "Who to follow"
		function isWithinWhoToFollow(el) {
			try {
				const aside = el.closest('aside[aria-label]');
				if (!aside) return false;
				const aria = (aside.getAttribute('aria-label') || '').toLowerCase();
				return aria.includes('who to follow');
			} catch (_) { return false; }
		}

		// Build candidate list focusing on main area
		const sel = [
			'main button[data-testid$="-follow"]',
			'main div[role="button"][data-testid$="-follow"]',
			'main button[aria-label*="Follow back"]',
			'main div[role="button"][aria-label*="Follow back"]'
		].join(',');
		let candidates = Array.from(document.querySelectorAll(sel));
		if (!candidates.length) {
			candidates = Array.from(document.querySelectorAll('button[data-testid$="-follow"], div[role="button"][data-testid$="-follow"], button[aria-label], div[role="button"][aria-label]'));
		}
		const result = candidates.filter(btn => {
			if (!isVisible(btn)) return false;
			if (isWithinWhoToFollow(btn)) return false;
			const label = (btn.getAttribute('aria-label') || btn.textContent || '').toLowerCase().trim();
			if (/following|requested|unfollow/.test(label)) return false;
			// Accept follow-back explicit or generic follow action
			const testId = String(btn.getAttribute('data-testid') || '');
			const labelSuggests = label.includes('follow back') || label === 'follow' || label.startsWith('follow ');
			const testIdSuggests = /-follow$/.test(testId);
			return labelSuggests || testIdSuggests;
		});
		if (DEV) debugLog('findFollowBackButtons: candidates', candidates.length, 'filtered', result.length);
		return result;
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
				const ok = el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
				// allow next
			}
			if (DEV) debugLog('clicked follow button', el.getAttribute('data-testid') || el.getAttribute('aria-label') || 'btn');
			return true;
		} catch (_) { return false; }
	}

	async function ensureScroll(index) {
		const items = document.querySelectorAll('article, div[role="listitem"], div[data-testid="cellInnerDiv"]');
		const row = items[index] || items[items.length - 1];
		if (row) row.scrollIntoView({ block: 'center' });
		await humanDelay(300, 300);
		window.scrollBy(0, 200); // small nudge to trigger lazy loading
		await humanDelay(150, 200);
	}

	async function runFollowBack() {
		if (STATE.running) return;
		STATE.running = true;
		STATE.paused = false;
		STATE.cancelled = false;
		try {
			const { safeMode = true, maxFollows = 20 } = await chrome.storage.sync.get({ safeMode: true, maxFollows: 20 });
			STATE.safeMode = safeMode; STATE.maxFollows = maxFollows;
            debugLog('runFollowBack: start', { safeMode: STATE.safeMode, maxFollows: STATE.maxFollows });

			if (!isOnFollowersPage()) {
				debugLog('Not on verified followers page');
				return;
			}

			STATE.executedCount = 0;
			await chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: 0, running: true, paused: false } });
			let attempt = 0;
			while (!STATE.cancelled && STATE.executedCount < STATE.maxFollows && attempt < STATE.maxFollows * 4) {
				attempt++;
				if (STATE.paused) {
					// Wait until unpaused or cancelled
					while (STATE.paused && !STATE.cancelled) {
						await sleepInterruptible(200);
					}
					attempt--; // pause should not consume attempts
					continue;
				}
                debugLog('loop: attempt', attempt, { executed: STATE.executedCount, cancelled: STATE.cancelled, paused: STATE.paused });
                await ensureScroll(attempt);
				if (STATE.cancelled) break;
				let buttons = findFollowBackButtons();
				if (DEV) debugLog('attempt', attempt, 'found buttons:', buttons.length);
				if (!buttons.length) {
					await humanDelay(600, 600);
					window.scrollBy(0, 500);
					buttons = findFollowBackButtons();
                    if (!buttons.length) { debugLog('no buttons after scroll+delay'); continue; }
				}
				if (STATE.cancelled) break;
				const btn = buttons[0];
                debugLog('clicking btn', btn?.getAttribute('aria-label') || btn?.textContent || 'btn');
                clickWithEvents(btn);
				STATE.executedCount++;
				await chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: true, paused: STATE.paused } });
				if (STATE.cancelled) break;
				if (STATE.safeMode) await humanDelay(1200, 900);
			}
			debugLog(`Followed ${STATE.executedCount} users.`);
			await chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: false, paused: false } });
        } catch (err) {
			debugLog('Error', err?.message || err);
		} finally {
			STATE.running = false;
		}
	}

	document.addEventListener('UTT_START_FOLLOW_BACK', () => { try { window.UTTLogger?.enable?.(); } catch (_) {} debugLog('event: UTT_START_FOLLOW_BACK'); runFollowBack(); });
	document.addEventListener('UTT_TOGGLE_PAUSE', async () => {
		try { window.UTTLogger?.enable?.(); } catch (_) {}
		STATE.paused = !STATE.paused;
        debugLog('pause toggled ->', STATE.paused);
		await chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: STATE.running, paused: STATE.paused } });
	});
	document.addEventListener('UTT_STOP', async () => {
		try { window.UTTLogger?.enable?.(); } catch (_) {}
		// Stop: pause and finalize current session
		STATE.paused = false;
		STATE.cancelled = true;
		STATE.running = false;
        debugLog('stop requested');
		await chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: false, paused: false } });
	});
	document.addEventListener('UTT_CANCEL', async () => {
		try { window.UTTLogger?.enable?.(); } catch (_) {}
		STATE.cancelled = true;
		STATE.running = false;
        debugLog('cancel requested');
		await chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: false, paused: false } });
	});

	// Fallback: also listen to runtime messages from popup
	try {
		chrome.runtime.onMessage.addListener((msg) => {
			try { window.UTTLogger?.enable?.(); } catch (_) {}
			if (!msg || msg.type !== 'UTT_CMD') return;
			switch (msg.name) {
				case 'START_FOLLOW_BACK':
					debugLog('msg: START_FOLLOW_BACK');
					runFollowBack();
					break;
				case 'TOGGLE_PAUSE':
					STATE.paused = !STATE.paused;
					debugLog('msg: TOGGLE_PAUSE ->', STATE.paused);
					chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: STATE.running, paused: STATE.paused } });
					break;
				case 'STOP':
					STATE.paused = false;
					STATE.cancelled = true;
					STATE.running = false;
					debugLog('msg: STOP');
					chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: false, paused: false } });
					break;
				case 'CANCEL':
					STATE.cancelled = true;
					STATE.running = false;
					debugLog('msg: CANCEL');
					chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: false, paused: false } });
					break;
				default:
					break;
			}
		});
	} catch (_) {}

	// Storage bridge: listen for followCommand updates as last resort
	try {
		let lastTs = 0;
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== 'local' || !changes.followCommand) return;
			const cmd = changes.followCommand.newValue || {};
			if (!cmd || typeof cmd.ts !== 'number' || cmd.ts === lastTs) return;
			lastTs = cmd.ts;
			switch (cmd.name) {
				case 'UTT_TOGGLE_PAUSE':
					STATE.paused = !STATE.paused;
					debugLog('storage cmd: TOGGLE_PAUSE ->', STATE.paused);
					chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: STATE.running, paused: STATE.paused } });
					break;
				case 'UTT_STOP':
					STATE.paused = false;
					STATE.cancelled = true;
					STATE.running = false;
					debugLog('storage cmd: STOP');
					chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: false, paused: false } });
					break;
				case 'UTT_CANCEL':
					STATE.cancelled = true;
					STATE.running = false;
					debugLog('storage cmd: CANCEL');
					chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: false, paused: false } });
					break;
				default:
					break;
			}
		});
	} catch (_) {}

	// Also listen to postMessage bridge from injected MAIN
	try {
		window.addEventListener('message', (e) => {
			if (!e || !e.data || e.data.source !== 'UTT' || e.data.type !== 'UTT_CMD') return;
			const { name } = e.data;
			switch (name) {
				case 'UTT_TOGGLE_PAUSE':
					STATE.paused = !STATE.paused;
					debugLog('postMessage cmd: TOGGLE_PAUSE ->', STATE.paused);
					chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: STATE.running, paused: STATE.paused } });
					break;
				case 'UTT_STOP':
					STATE.paused = false;
					STATE.cancelled = true;
					STATE.running = false;
					debugLog('postMessage cmd: STOP');
					chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: false, paused: false } });
					break;
				case 'UTT_CANCEL':
					STATE.cancelled = true;
					STATE.running = false;
					debugLog('postMessage cmd: CANCEL');
					chrome.storage.local.set({ followProgress: { total: STATE.maxFollows, done: STATE.executedCount, running: false, paused: false } });
					break;
				default:
					break;
			}
		});
	} catch (_) {}

    // In case the injected event misses due to timing, auto-start when arriving at verified_followers with intent flag
    (async () => {
        try {
            const { autoStartFollowBack = null, debugLogs = false, debugLogsUntil = 0 } = await chrome.storage.local.get({ autoStartFollowBack: null, debugLogs: false, debugLogsUntil: 0 });
            DEBUG_ENABLED = Boolean(debugLogs) || (Number(debugLogsUntil) > Date.now());
			if (autoStartFollowBack && isOnFollowersPage()) {
                // small wait to allow DOM hydrate
				await sleep(800);
				debugLog('auto-start: intent detected');
				runFollowBack();
				try { await chrome.storage.local.set({ autoStartFollowBack: null }); } catch (_) {}
            }
        } catch (_) {}
    })();

    // Announce readiness after we potentially enabled DEBUG via storage
    setTimeout(() => debugLog('verified-followers content script ready'), 0);
    try { window.UTTLogger?.injectOverlay?.(); } catch (_) {}
})();

