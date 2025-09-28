import { getSync, setSync, getActiveTabId, injectCustomEvent, openOptions, setLocal, getLocal, sendCommandToTab } from '../modules/utils.js';

export function initEngagePage() {
	const engageType = document.getElementById('engage-type');
	const maxEngage = document.getElementById('max-engage');
	const openFeedBtn = document.getElementById('open-engage-feed');
	const startEngageBtn = document.getElementById('start-engage');
	const cancelEngageBtn = document.getElementById('cancel-engage');
	const progressFill = document.getElementById('eng-progress-fill');
	const progressText = document.getElementById('eng-progress-text');
	const statusText = document.getElementById('eng-status-text');
	const logBox = document.getElementById('eng-log');

	async function load() {
		const { engage = { type: 'likes', max: 20 } } = await getSync({ engage: { type: 'likes', max: 20 } });
		if (engageType) engageType.value = engage.type;
		if (maxEngage) maxEngage.value = String(engage.max);
	}

	async function save() {
		const engage = { type: String(engageType?.value || 'likes'), max: Number(maxEngage?.value || 20) };
		await setSync({ engage });
	}

	if (engageType) engageType.addEventListener('change', save);
	if (maxEngage) maxEngage.addEventListener('change', save);

	if (openFeedBtn) {
		openFeedBtn.addEventListener('click', async () => {
			const url = 'https://x.com/home';
			await chrome.tabs.create({ url });
		});
	}

	if (startEngageBtn) {
		startEngageBtn.addEventListener('click', async () => {
			await save();
			const { engage = { type: 'likes', max: 20 } } = await getSync({ engage: { type: 'likes', max: 20 } });
			try {
				await chrome.storage.local.set({ autoStartEngage: { type: engage.type, max: engage.max, ts: Date.now() } });
			} catch (_) {}
			let tabId = await getActiveTabId();
			const url = 'https://x.com/home';
			try {
				if (tabId) {
					await chrome.tabs.update(tabId, { url });
				} else {
					const created = await chrome.tabs.create({ url });
					tabId = created?.id || null;
				}
			} catch (_) {
				try { const created = await chrome.tabs.create({ url }); tabId = created?.id || tabId; } catch (_) {}
			}
			if (tabId) {
				await setLocal({ engageTabId: tabId, debugLogs: true, debugLogsUntil: Date.now() + 2 * 60 * 1000 });
			}
		});
	}

	// Controls: cancel (prefer stored engageTabId; also fallback to active tab)
	async function getTargetTabIds() {
		const { engageTabId = null } = await getLocal({ engageTabId: null });
		const activeId = await getActiveTabId();
		const ids = new Set();
		if (engageTabId) ids.add(engageTabId);
		if (activeId) ids.add(activeId);
		return Array.from(ids);
	}

	async function broadcastEvent(name) {
		const ids = await getTargetTabIds();
		await Promise.all(ids.flatMap(id => [
			injectCustomEvent(id, name),
			sendCommandToTab(id, name, {})
		]));
		try { await setLocal({ engageCommand: { name, ts: Date.now() } }); } catch (_) {}
	}

	if (cancelEngageBtn) {
		cancelEngageBtn.addEventListener('click', async () => {
			await broadcastEvent('UTT_CANCEL');
		});
	}

	// Progress + logs from content script
	try {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== 'local') return;
			if (changes.engageProgress) {
				const { total = 0, done = 0, running = false, paused = false } = changes.engageProgress.newValue || {};
				const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
				if (progressFill) progressFill.style.width = pct + '%';
				if (progressText) progressText.textContent = `${done} / ${total}`;
				if (statusText) statusText.textContent = paused ? 'Paused' : (running ? 'Running' : 'Idle');
			}
			if (changes.engageLog && logBox) {
				const lines = changes.engageLog.newValue || [];
				logBox.innerHTML = '';
				for (const line of lines.slice(-200)) {
					const div = document.createElement('div');
					div.textContent = line;
					logBox.appendChild(div);
				}
				logBox.scrollTop = logBox.scrollHeight;
			}
		});
	} catch (_) {}

	load();
}


