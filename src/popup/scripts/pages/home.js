import { getSync, setSync, getLocal, sanitizeHandle, openOptions, getActiveTabId } from '../modules/utils.js';

export function initHomePage() {
	const fetchProfileBtn = document.getElementById('fetch-profile');
	const usernameInput = document.getElementById('username');
	const welcome = document.getElementById('welcome');
	const openOptionsBtn = document.getElementById('open-options');

	// Profile card elements
	const profileCard = document.getElementById('profile-card');
	const elAvatar = document.getElementById('profile-avatar');
	const elName = document.getElementById('profile-name');
	const elHandle = document.getElementById('profile-handle');
	const elFollowers = document.getElementById('stat-followers');
	const elFollowing = document.getElementById('stat-following');
	const elOpenProfile = document.getElementById('open-profile');
	const elBio = document.getElementById('profile-bio');

	async function load() {
		const { username = '' } = await getSync({ username: '' });
		if (usernameInput) usernameInput.value = String(username || '');
		if (welcome) welcome.hidden = Boolean(username);
		if (!username && usernameInput) usernameInput.focus();
	}

	async function saveUsername() {
		if (!usernameInput) return;
		const value = sanitizeHandle(usernameInput.value);
		usernameInput.value = value;
		await setSync({ username: value });
		if (welcome) welcome.hidden = Boolean(value);
	}

	function formatNumber(n) {
		if (typeof n !== 'number' || !Number.isFinite(n)) return '-';
		return new Intl.NumberFormat('en-US').format(n);
	}

	function renderProfile(profile) {
		if (!profileCard) return;
		if (!profile || !profile.username) {
			profileCard.hidden = true;
			return;
		}
		if (elAvatar) {
			if (profile.avatarUrl) {
				elAvatar.src = profile.avatarUrl;
				elAvatar.hidden = false;
			} else {
				elAvatar.hidden = true;
			}
		}
		if (elName) elName.textContent = String(profile.name || profile.username);
		if (elHandle) elHandle.textContent = `@${profile.username}`;
		if (elFollowers) elFollowers.textContent = formatNumber(profile.followers);
		if (elFollowing) elFollowing.textContent = formatNumber(profile.following);
		if (elOpenProfile) {
			elOpenProfile.href = `https://x.com/${profile.username}`;
		}
		if (elBio) {
			if (profile.bio) {
				elBio.textContent = profile.bio;
				elBio.hidden = false;
			} else {
				elBio.hidden = true;
			}
		}
		profileCard.hidden = false;
	}

	if (usernameInput) {
		usernameInput.addEventListener('change', saveUsername);
		usernameInput.addEventListener('blur', saveUsername);
		usernameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveUsername(); } });
	}

	if (fetchProfileBtn) {
		fetchProfileBtn.addEventListener('click', async () => {
			await saveUsername();
			let { username = '' } = await getSync({ username: '' });
			if (!username && usernameInput) username = sanitizeHandle(usernameInput.value);
			if (!username) {
				alert('Please enter your X username first.');
				if (usernameInput) usernameInput.focus();
				return;
			}
			const tabId = await getActiveTabId();
			const url = `https://x.com/${username}`;
			try {
				let targetTabId = tabId;
				if (tabId) {
					await chrome.tabs.update(tabId, { url });
				} else {
					const created = await chrome.tabs.create({ url });
					targetTabId = created?.id || null;
				}
				// Wait for page to be 'complete' then inject scraper to be safe
				if (targetTabId) {
					await new Promise((resolve) => {
						const listener = (updatedTabId, info, tab) => {
							if (updatedTabId === targetTabId && info.status === 'complete') {
								chrome.tabs.onUpdated.removeListener(listener);
								resolve();
							}
						};
						chrome.tabs.onUpdated.addListener(listener);
					});
					try {
						await chrome.scripting.executeScript({
							target: { tabId: targetTabId },
							files: ['src/content/profile-scraper.js']
						});
					} catch (e) { /* ignore */ }
				}
			} catch (_) {}
		});
	}

	if (openOptionsBtn) openOptionsBtn.addEventListener('click', openOptions);

	// Listen for profile data updates from content script
	try {
		chrome.storage.onChanged.addListener((changes, area) => {
			if (area === 'local' && changes.profileData) {
				renderProfile(changes.profileData.newValue);
			}
		});
	} catch (_) {}

	load();

	// Load existing profile data (persistent)
	(async () => {
		const { profileData = null } = await getLocal({ profileData: null });
		renderProfile(profileData);
	})();
}


