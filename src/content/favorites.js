// Ultimate X Tool – Favorites storage helper (MV3 content script scope)
// Exposes a small global: window.UTTFavorites

(function initUTTFavorites() {
	if (window.UTTFavorites) return;

	const STORAGE_KEY = "utt:favorites:v1";

	function getAll() {
		return new Promise((resolve) => {
			try {
				chrome.storage.local.get(STORAGE_KEY, (data) => {
					resolve(data && data[STORAGE_KEY] ? data[STORAGE_KEY] : {});
				});
			} catch (_) {
				resolve({});
			}
		});
	}

	function saveAll(map) {
		return new Promise((resolve) => {
			try {
				chrome.storage.local.set({ [STORAGE_KEY]: map }, () => resolve());
			} catch (_) {
				resolve();
			}
		});
	}

	async function isFavorite(handle) {
		if (!handle) return false;
		const key = handle.toLowerCase();
		const map = await getAll();
		return !!map[key];
	}

	async function toggle(profile) {
		const { handle } = profile || {};
		if (!handle) return { isFavorite: false };
		const key = handle.toLowerCase();
		const map = await getAll();
		if (map[key]) {
			delete map[key];
			await saveAll(map);
			return { isFavorite: false, all: map };
		}
		map[key] = {
			handle,
			userId: profile.userId || null,
			displayName: profile.displayName || null,
			followers: typeof profile.followerCount === 'number' ? profile.followerCount : null,
			addedAt: Date.now()
		};
		await saveAll(map);
		return { isFavorite: true, all: map };
	}

	window.UTTFavorites = { STORAGE_KEY, getAll, saveAll, isFavorite, toggle };
})();


