chrome.runtime.onInstalled.addListener(async () => {
	await chrome.storage.sync.set({ safeMode: true, maxFollows: 20, username: '' });
});

// Placeholder for future alarms/queues if needed
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg?.ping === 'bg') {
		sendResponse({ pong: 'bg' });
	}
    if (msg?.type === 'UTT_NETDBG' && msg?.name === 'EXPORT_LOGS') {
        exportNetworkLogs().catch(() => {});
    }
});

async function exportNetworkLogs() {
    try {
        const key = 'utt:netlog:v1';
        const store = await chrome.storage.local.get({ [key]: [] });
        const logs = Array.isArray(store[key]) ? store[key] : [];
        const payload = {
            exportedAt: new Date().toISOString(),
            version: 1,
            url: 'https://x.com',
            count: logs.length,
            entries: logs
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
            reader.onerror = () => reject(reader.error);
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
        const filename = `utt-network-logs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        await chrome.downloads.download({
            url: dataUrl,
            filename,
            saveAs: true,
            conflictAction: 'uniquify'
        });
    } catch (e) {
        try { console.warn('[UTT][NETDBG] export failed', e); } catch (_) {}
    }
}

