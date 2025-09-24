import { getSync, setSync, getActiveTabId, injectCustomEvent, setLocal, getLocal, sendCommandToTab } from '../modules/utils.js';

export function initFollowPage() {
	const safeModeInput = document.getElementById('safe-mode');
	const maxFollowsSelect = document.getElementById('max-follows');
	const startBtn = document.getElementById('start-follow-back');
	const pauseBtn = document.getElementById('pause-follow-back');
	const stopBtn = null; // removed from UI
	const cancelBtn = document.getElementById('cancel-follow-back');
	const progressFill = document.getElementById('fb-progress-fill');
	const progressText = document.getElementById('fb-progress-text');
	const statusText = document.getElementById('fb-status-text');

	async function load() {
		const { safeMode = true, maxFollows = 20 } = await getSync({ safeMode: true, maxFollows: 20 });
		if (safeModeInput) safeModeInput.checked = Boolean(safeMode);
		if (maxFollowsSelect) maxFollowsSelect.value = String(maxFollows);
	}

	async function save() {
		await setSync({ safeMode: Boolean(safeModeInput?.checked), maxFollows: Number(maxFollowsSelect?.value || 20) });
	}

	if (safeModeInput) safeModeInput.addEventListener('change', save);
	if (maxFollowsSelect) maxFollowsSelect.addEventListener('change', save);

	if (startBtn) {
		startBtn.addEventListener('click', async () => {
			await save();
			const { username = '' } = await getSync({ username: '' });
			if (!username) {
				alert('Please set your X username in Home tab first.');
				return;
			}
			// mark intent and enable temporary debug logs for 2 minutes
			await setLocal({ autoStartFollowBack: { ts: Date.now(), username }, debugLogsUntil: Date.now() + 2 * 60 * 1000, debugLogs: true });
			let targetTabId = await getActiveTabId();
			const url = `https://x.com/${username}/verified_followers`;
				try {
				if (targetTabId) {
					await chrome.tabs.update(targetTabId, { url });
				} else {
					const created = await chrome.tabs.create({ url });
					targetTabId = created?.id || null;
				}
				if (targetTabId) {
					await new Promise((resolve) => {
						const listener = (updatedTabId, info) => {
							if (updatedTabId === targetTabId && info.status === 'complete') {
								chrome.tabs.onUpdated.removeListener(listener);
								resolve();
							}
						};
						chrome.tabs.onUpdated.addListener(listener);
					});
						// Dispatch start event after page is loaded so content script is ready
						await injectCustomEvent(targetTabId, 'UTT_START_FOLLOW_BACK');
						// Remember target tab for follow-back controls
						await setLocal({ followTabId: targetTabId });
				}
			} catch (_) {}
		});
	}

	// Controls: pause/resume/cancel (prefer stored followTabId; also fallback to active tab)
	async function getTargetTabIds() {
		const { followTabId = null } = await getLocal({ followTabId: null });
		const activeId = await getActiveTabId();
		const ids = new Set();
		if (followTabId) ids.add(followTabId);
		if (activeId) ids.add(activeId);
		return Array.from(ids);
	}

	async function broadcastEvent(name) {
		const ids = await getTargetTabIds();
		if (!ids.length) {
			console.info('[UTT][POPUP] No target tab for', name);
		}
		// Try both: custom event in MAIN world + direct message
		await Promise.all(ids.flatMap(id => [
			injectCustomEvent(id, name),
			sendCommandToTab(id, name, {})
		]));
		// Also set storage command as last-resort bridge
		try { await setLocal({ followCommand: { name, ts: Date.now() } }); } catch (_) {}
	}

	if (pauseBtn) pauseBtn.addEventListener('click', async () => {
		console.info('[UTT][POPUP] Pause/Resume clicked');
		await broadcastEvent('UTT_TOGGLE_PAUSE');
	});
	// stop removed
	if (cancelBtn) cancelBtn.addEventListener('click', async () => {
		console.info('[UTT][POPUP] Cancel clicked');
		await broadcastEvent('UTT_CANCEL');
	});

	// Progress updates from content script
	try {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area !== 'local') return;
			if (changes.followProgress) {
				const { total = 0, done = 0, running = false, paused = false } = changes.followProgress.newValue || {};
				const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
				if (progressFill) progressFill.style.width = pct + '%';
				if (progressText) progressText.textContent = `${done} / ${total}`;
				if (statusText) statusText.textContent = paused ? 'Paused' : (running ? 'Idle' : 'Idle');
				if (pauseBtn) {
					pauseBtn.textContent = paused ? 'Resume' : 'Pause';
					pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
				}
			}
		});
	} catch (_) {}

	load();
}


