export async function getSync(defaults = {}) {
	try {
		return await chrome.storage.sync.get(defaults);
	} catch (_) {
		return { ...defaults };
	}
}

export async function setSync(values) {
	try {
		await chrome.storage.sync.set(values);
	} catch (_) {}
}

export async function getLocal(defaults = {}) {
	try {
		return await chrome.storage.local.get(defaults);
	} catch (_) {
		return { ...defaults };
	}
}

export async function setLocal(values) {
	try {
		await chrome.storage.local.set(values);
	} catch (_) {}
}

export function sanitizeHandle(handle) {
	const trimmed = String(handle || '').trim();
	const noAt = trimmed.replace(/^@+/, '');
	const cleaned = noAt.replace(/[^a-zA-Z0-9_]/g, '');
	return cleaned.slice(0, 15);
}

export async function openOptions() {
	try {
		await chrome.runtime.openOptionsPage();
	} catch (_) {}
}

export async function getActiveTabId() {
	try {
		const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
		return tab?.id || null;
	} catch (_) {
		return null;
	}
}

export async function injectCustomEvent(tabId, eventName, detail) {
	if (!tabId) return;
	try {
		await chrome.scripting.executeScript({
			target: { tabId },
            world: 'MAIN',
			func: (name, data) => {
                try { window.UTTLogger?.enable?.(); } catch (_) {}
                try { window.UTTLogger?.log(`[POPUP→PAGE] ${name}`); } catch (_) {}
                try {
                    document.dispatchEvent(new CustomEvent(name, { detail: data, bubbles: true, composed: true }));
                } catch (_) {
                    // Fallback to window
                    try { window.dispatchEvent(new CustomEvent(name, { detail: data })); } catch (_) {}
                }
                try {
                    window.postMessage({ source: 'UTT', type: 'UTT_CMD', name, detail: data }, '*');
                } catch (_) {}
			},
			args: [eventName, detail]
		});
	} catch (e) {
		console.error('Injection failed', e);
	}
}

export async function sendCommandToTab(tabId, name, detail) {
    if (!tabId) return;
    try {
        await chrome.tabs.sendMessage(tabId, { type: 'UTT_CMD', name, detail });
    } catch (e) {
        console.error('sendMessage failed', e);
    }
}


