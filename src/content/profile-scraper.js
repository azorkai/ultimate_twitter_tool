// Scrape X profile data and persist to chrome.storage.local
// Tries to be robust against minor DOM changes with multiple selectors

(function () {
	const MAX_ATTEMPTS = 60; // ~30s with 500ms interval
	const INTERVAL_MS = 500;

	console.info('[UTT] profile-scraper: script injected on', location.href);

	function parseCount(text) {
		if (!text) return null;
		const raw = String(text).trim();
		const lower = raw.toLowerCase();
		const match = lower.match(/([0-9]+(?:[\.,][0-9]+)?)\s*([km])?/);
		if (!match) {
			const digits = (raw.match(/\d/g) || []).join('');
			return digits ? Number.parseInt(digits, 10) : null;
		}
		const numStr = match[1];
		const suffix = match[2];
		if (suffix === 'm' || suffix === 'k') {
			let base = parseFloat(numStr.replace(',', '.'));
			if (Number.isNaN(base)) return null;
			if (suffix === 'm') return Math.round(base * 1_000_000);
			if (suffix === 'k') return Math.round(base * 1_000);
		}
		// No suffix: treat separators as thousands, strip non-digits
		const digitsOnly = (numStr.match(/\d/g) || []).join('');
		return digitsOnly ? Number.parseInt(digitsOnly, 10) : null;
	}

	function textContent(el) {
		return el ? (el.textContent || '').trim() : '';
	}

	function selectFollowersAnchor(username) {
		const anchors = Array.from(document.querySelectorAll('a[role="link"], a'));
		// Prefer verified_followers first (new X layout), then followers
		const byVerified = anchors.find(a => (a.getAttribute('href') || '').endsWith(`/${username}/verified_followers`));
		if (byVerified) return byVerified;
		const byHref = anchors.find(a => (a.getAttribute('href') || '').endsWith(`/${username}/followers`));
		if (byHref) return byHref;
		// Fallback: link whose text includes "Followers"
		return anchors.find(a => /followers/i.test(textContent(a)));
	}

	function selectFollowingAnchor(username) {
		const anchors = Array.from(document.querySelectorAll('a[role="link"], a'));
		const byHref = anchors.find(a => (a.getAttribute('href') || '').endsWith(`/${username}/following`));
		if (byHref) return byHref;
		return anchors.find(a => /following/i.test(textContent(a)));
	}

	function selectAvatarImg(username) {
		// Prefer data-testid based container
		const testid = document.querySelector(`[data-testid^="UserAvatar-Container-"] img`);
		if (testid) return testid;
		// Fallback: profile photo img near /<username>/photo link
		const link = document.querySelector(`a[href="/${username}/photo"]`);
		if (link) {
			const img = link.querySelector('img');
			if (img?.src) return img;
		}
		// Fallback to common avatar URLs
		const img1 = document.querySelector('img[src*="pbs.twimg.com/profile_images/"]');
		if (img1) return img1;
		// Fallback to background-image style
		const bgDiv = Array.from(document.querySelectorAll('div'))
			.find(d => /background-image:\s*url\(/i.test(d.getAttribute('style') || ''));
		return bgDiv || null;
	}

	function selectNameAndHandle() {
		// Handle is first path segment
		const pathname = location.pathname || '/';
		const parts = pathname.split('/').filter(Boolean);
		const handle = (parts[0] || '').replace(/^[@]+/, '');
		// Prefer data-testid UserName container
		let name = '';
		const userNameBlock = document.querySelector('[data-testid="UserName"]');
		if (userNameBlock) {
			// First visible text inside the block is usually display name
			const nameSpan = userNameBlock.querySelector('div[dir="ltr"] span');
			name = textContent(nameSpan);
		}
		if (!name) {
			const candidate = document.querySelector('[data-testid="UserName"] span, h1, [role="heading"]');
			name = textContent(candidate);
		}
		return { name: name || handle, handle };
	}

	function selectCountsByTestIds(username) {
		const wrap = document.querySelector('[data-testid="UserProfileHeader_Items"]');
		if (!wrap) return { followers: null, following: null };
		let followers = null; let following = null;
		const aFollowing = wrap.querySelector(`a[href="/${username}/following"]`);
		if (aFollowing) following = parseCount(textContent(aFollowing));
		const aFollowers = wrap.querySelector(`a[href="/${username}/verified_followers"], a[href="/${username}/followers"]`);
		if (aFollowers) followers = parseCount(textContent(aFollowers));
		return { followers, following };
	}

	function selectBio() {
		const bioBlock = document.querySelector('[data-testid="UserDescription"]');
		if (!bioBlock) return null;
		let txt = textContent(bioBlock);
		if (!txt) return null;
		// Remove trailing "View more"
		txt = txt.replace(/\s*View more\s*$/i, '').trim();
		return txt || null;
	}

	async function scrapeOnce() {
		const { handle } = selectNameAndHandle();
		if (!handle) return null;
		const byTest = selectCountsByTestIds(handle);
		let followers = byTest.followers;
		let following = byTest.following;
		if (followers == null || following == null) {
			const followersA = selectFollowersAnchor(handle);
			const followingA = selectFollowingAnchor(handle);
			const followersText = followersA ? textContent(followersA) : '';
			const followingText = followingA ? textContent(followingA) : '';
			if (followers == null) followers = parseCount(followersText);
			if (following == null) following = parseCount(followingText);
		}
		const avatarEl = selectAvatarImg(handle);
		let avatarUrl = null;
		if (avatarEl instanceof HTMLImageElement) avatarUrl = avatarEl.src || null;
		else if (avatarEl) {
			const style = avatarEl.getAttribute('style') || '';
			const m = style.match(/background-image:\s*url\(("|')?(?<u>[^)"']+)("|')?\)/i);
			if (m && m.groups && m.groups.u) avatarUrl = m.groups.u;
		}
		const nameHandle = selectNameAndHandle();
		const bio = selectBio();
		const result = {
			username: nameHandle.handle,
			name: nameHandle.name,
			avatarUrl,
			followers: Number.isFinite(followers) ? followers : null,
			following: Number.isFinite(following) ? following : null,
			profileUrl: `https://x.com/${nameHandle.handle}`,
			bio: bio || null,
			updatedAt: Date.now()
		};
		console.info('[UTT] profile-scraper: scrapeOnce()', result);
		return result;
	}

	let lastSerialized = '';

	async function persist(data) {
		try {
			const current = JSON.stringify({
				u: data.username,
				n: data.name,
				a: data.avatarUrl || null,
				fr: data.followers || null,
				fg: data.following || null,
				b: data.bio || null
			});
			if (current === lastSerialized) return;
			lastSerialized = current;
			await chrome.storage.local.set({ profileData: data });
			console.info('[UTT] profile-scraper: saved profileData');
			// Also emit a custom event for pages listening inside the tab (optional)
			window.dispatchEvent(new CustomEvent('utt:profileData', { detail: data }));
		} catch (e) { console.error('[UTT] profile-scraper: persist error', e); }
	}

	function onReady(fn) {
		if (document.readyState === 'complete') { fn(); return; }
		window.addEventListener('load', () => fn(), { once: true });
		document.addEventListener('readystatechange', () => {
			if (document.readyState === 'complete') fn();
		});
	}

	function observeMutations(callback) {
		try {
			const observer = new MutationObserver(() => callback());
			observer.observe(document.documentElement, { childList: true, subtree: true });
			return observer;
		} catch (_) { return null; }
	}

	function watchRouteChanges(callback) {
		const origPush = history.pushState;
		const origReplace = history.replaceState;
		function trigger() { setTimeout(callback, 100); }
		try {
			history.pushState = function () { origPush.apply(this, arguments); trigger(); };
			history.replaceState = function () { origReplace.apply(this, arguments); trigger(); };
		} catch (_) {}
		window.addEventListener('popstate', trigger);
	}

	function waitForSelector(selector, { timeout = 20000 } = {}) {
		return new Promise((resolve) => {
			const start = Date.now();
			if (document.querySelector(selector)) return resolve(true);
			let done = false;
			const observer = new MutationObserver(() => {
				if (document.querySelector(selector)) {
					if (!done) { done = true; observer.disconnect(); resolve(true); }
				}
			});
			observer.observe(document.documentElement, { childList: true, subtree: true });
			const timer = setInterval(() => {
				if (document.querySelector(selector)) {
					if (!done) { done = true; clearInterval(timer); observer.disconnect(); resolve(true); }
				}
				if (Date.now() - start > timeout) {
					if (!done) { done = true; clearInterval(timer); observer.disconnect(); resolve(false); }
				}
			}, 250);
		});
	}

	async function waitForProfileReady(username) {
		const okName = await waitForSelector('[data-testid="UserName"]');
		const okCounts = await waitForSelector(`a[href="/${username}/following"], a[href="/${username}/verified_followers"], a[href="/${username}/followers"]`);
		console.info('[UTT] profile-scraper: waitForProfileReady', { okName, okCounts });
		return okName && okCounts;
	}

	async function run() {
		let attempts = 0;
		const tryScrape = async () => {
			attempts++;
			const data = await scrapeOnce();
			if (!data) return false;
			await persist(data);
			// If followers or avatar not yet present, keep trying until timeout
			return Boolean(data.followers || data.avatarUrl);
		};

		const { handle } = selectNameAndHandle();
		await waitForProfileReady(handle);
		const ok = await tryScrape();
		if (ok) return;

		const start = Date.now();
		const timer = setInterval(async () => {
			if (attempts >= MAX_ATTEMPTS) { clearInterval(timer); console.warn('[UTT] profile-scraper: timeout after', Date.now() - start, 'ms'); return; }
			const done = await tryScrape();
			if (done) { clearInterval(timer); console.info('[UTT] profile-scraper: completed in attempts', attempts); }
		}, INTERVAL_MS);

		// Also react to DOM mutations and route changes for SPA hydration
		const rerun = () => { tryScrape(); };
		observeMutations(rerun);
		watchRouteChanges(() => {
			attempts = 0; // reset attempts on route change
			lastSerialized = '';
			tryScrape();
		});
		onReady(() => tryScrape());
	}

	// Only run on /<handle> paths (exclude notifications, home, explore, etc.)
	const path = location.pathname.split('/').filter(Boolean);
	if (path.length >= 1 && !['home','explore','notifications','messages','i','settings','compose','search'].includes(path[0])) {
		console.info('[UTT] profile-scraper: eligible path, starting run()');
		run();
	} else {
		console.info('[UTT] profile-scraper: path not eligible, skipping');
	}
})();


