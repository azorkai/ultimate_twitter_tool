chrome.runtime.onInstalled.addListener(async () => {
	await chrome.storage.sync.set({ safeMode: true, maxFollows: 20, username: '' });
});

// Placeholder for future alarms/queues if needed
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
	if (msg?.ping === 'bg') {
		sendResponse({ pong: 'bg' });
	}
});

