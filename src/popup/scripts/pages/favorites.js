import { getLocal, setLocal } from '../modules/utils.js';

const STORAGE_KEY = 'utt:favorites:v1';

function formatFollowers(n) {
	if (typeof n !== 'number' || !isFinite(n)) return '-';
	if (n >= 1e9) return (n/1e9).toFixed(1).replace(/\.0$/, '') + 'B';
	if (n >= 1e6) return (n/1e6).toFixed(1).replace(/\.0$/, '') + 'M';
	if (n >= 1e3) return (n/1e3).toFixed(1).replace(/\.0$/, '') + 'K';
	return String(n);
}

async function loadFavorites() {
	try {
		const store = await getLocal({ [STORAGE_KEY]: {} });
		return store[STORAGE_KEY] || {};
	} catch (_) {
		return {};
	}
}

async function clearFavorites() {
	try {
		await setLocal({ [STORAGE_KEY]: {} });
	} catch (_) {}
}

function renderList(map) {
	const list = document.getElementById('favorites-list');
	const empty = document.getElementById('favorites-empty');
	if (!list || !empty) return;
	list.innerHTML = '';
	const entries = Object.values(map).sort((a,b) => (b.addedAt||0) - (a.addedAt||0));
	empty.hidden = entries.length > 0;
	for (const item of entries) {
		const row = document.createElement('div');
		row.className = 'elev-card';
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.justifyContent = 'space-between';
		row.style.gap = '12px';
		row.style.padding = '10px 12px';
		row.innerHTML = `
			<div style="display:flex; align-items:center; gap:10px;">
				<div class="badge">@${item.handle}</div>
				<div class="muted">${item.displayName ? item.displayName : ''}</div>
			</div>
			<div style="display:flex; align-items:center; gap:8px;">
				<div class="badge" title="Followers">${formatFollowers(item.followers)}</div>
				<a class="btn btn-ghost" target="_blank" rel="noreferrer" href="https://x.com/${item.handle}">Open</a>
			</div>
		`;
		list.appendChild(row);
	}
}

export function initFavoritesPage() {
	const refreshBtn = document.getElementById('refresh-favorites');
	const clearBtn = document.getElementById('clear-favorites');
	if (refreshBtn) refreshBtn.addEventListener('click', async () => renderList(await loadFavorites()));
	if (clearBtn) clearBtn.addEventListener('click', async () => { await clearFavorites(); renderList({}); });

	// Auto-render once when page loads
	loadFavorites().then(renderList);

	// Live update when content script toggles favorites
	window.addEventListener('message', (e) => {
		try {
			if (e?.data?.source === 'UTT' && e?.data?.type === 'UTT_CMD' && e?.data?.name === 'utt:favorites:changed') {
				loadFavorites().then(renderList);
			}
		} catch (_) {}
	});
}


