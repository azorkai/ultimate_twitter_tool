// Ultimate X Tool – Profile Action Button (injected near Edit profile)
// - Uses Shadow DOM to avoid style conflicts
// - Observes SPA route changes and injects once per profile header render

(function initUltimateProfileButton() {
	if (window.__uttProfileBtnInitialized) return;
	window.__uttProfileBtnInitialized = true;

	const HOST_ID = "utt-profile-action";
	// On other users' profiles there is no editProfileButton. We will locate the
	// action bar buttons container (More / Message / Follow) and inject there.
	const SELF_EDIT_SELECTOR = '[data-testid="editProfileButton"]';
	const ACTIONS_CONTAINER_SELECTOR = '[data-testid="userActions"]';
	const DM_BUTTON_SELECTOR = '[data-testid="sendDMFromProfile"]';
	const FOLLOW_CONTAINER_SELECTOR = '[data-testid="placementTracking"]';

	let currentProfileKey = null;

	function getProfileKeyFromLocation() {
		const seg = (location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
		return seg || null;
	}

	function getUrlHandle() {
		const reserved = new Set(["home","explore","notifications","messages","i","settings"]);
		const key = getProfileKeyFromLocation();
		if (!key || reserved.has(key)) return null;
		return key;
	}

	function createHost() {
		const host = document.createElement("div");
		host.id = HOST_ID;
		// Keep layout consistent with Twitter header actions
		host.style.display = "flex";
		host.style.alignItems = "center";
		// Rely on target's own left-margin/gap to space elements
		host.style.marginRight = "0";
		host.style.alignSelf = "center";
		host.style.lineHeight = "0";
		host.style.isolation = "isolate";
		// Ensure hover effects are not hidden by siblings/background
		host.style.position = "relative";
		host.style.zIndex = "999";

		const shadow = host.attachShadow({ mode: "open" });

		const style = document.createElement("style");
		style.textContent = `
			:host { contain: layout paint style; }
			* { box-sizing: border-box; }
			.button {
				--utt-size: 36px;
				--utt-bg: conic-gradient(from 180deg at 50% 50%, #39c1ff, #8a5cff, #39c1ff);
				width: var(--utt-size);
				height: var(--utt-size);
				border-radius: 9999px;
				border: 1px solid rgba(255,255,255,0.14);
				background: radial-gradient(120% 120% at 0% 0%, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 60%),
					linear-gradient(#0b0f14, #0b0f14) padding-box,
					var(--utt-bg) border-box;
				color: #e7e9ea;
				cursor: pointer;
				display: inline-flex;
				align-items: center;
				justify-content: center;
				outline: none;
				box-shadow: 0 0 0 0 rgba(138,92,255,0.6);
				transition: box-shadow 200ms ease, transform 200ms ease, filter 200ms ease;
				margin-bottom: 9px;
			}
			.button:hover { transform: translateY(-1px); filter: saturate(1.2); }
			.button:focus-visible { box-shadow: 0 0 0 3px rgba(56, 124, 255, 0.4); }
			.button:active { transform: translateY(0); }
			.button.is-active {
				border-color: rgba(255, 200, 0, 0.6);
				background: radial-gradient(120% 120% at 0% 0%, rgba(255, 200, 0, 0.1) 0%, rgba(255,255,255,0) 60%),
					linear-gradient(#0b0f14, #0b0f14) padding-box,
					conic-gradient(from 180deg at 50% 50%, #ffd166, #fca311, #ffd166) border-box;
			}

			.icon { width: 18px; height: 18px; display: block; }
			.sheen {
				position: absolute;
				inset: 0;
				border-radius: 12px;
				background: linear-gradient(120deg, transparent 0%, rgba(255,255,255,0.25) 30%, transparent 60%);
				opacity: 0; pointer-events: none;
				transition: opacity 240ms ease;
			}
			.wrapper { position: relative; display: inline-block; }
			.wrapper:hover .sheen { opacity: 1; }
		`;

		const wrapper = document.createElement("span");
		wrapper.className = "wrapper";

		const button = document.createElement("button");
		button.className = "button";
		button.type = "button";
		button.title = "Add to favorites";
		button.setAttribute("aria-label", "Add to favorites");
		button.setAttribute("aria-pressed", "false");

		button.innerHTML = `
			<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">
				<path fill="currentColor" d="M12 2l2.534 5.137 5.666.825-4.1 4 0.967 5.638L12 15.89l-5.067 2.71 0.967-5.638-4.1-4 5.666-.825L12 2z"/>
			</svg>
		`;

		const sheen = document.createElement("span");
		sheen.className = "sheen";

		button.addEventListener("click", async () => {
			const info = getProfileInfo();
			if (!info || !info.handle) return;
			try {
				const result = await (window.UTTFavorites ? window.UTTFavorites.toggle(info) : Promise.resolve({ isFavorite: false }));
				applyFavState(button, result.isFavorite);
				window.dispatchEvent(new CustomEvent("utt:favorites:changed", { detail: { profile: info, isFavorite: result.isFavorite } }));
			} catch (e) {
				// fail silently; UX should not break
			}
		});

		wrapper.appendChild(button);
		wrapper.appendChild(sheen);
		shadow.appendChild(style);
		shadow.appendChild(wrapper);
		return host;
	}

	function getProfileInfo() {
		// Prefer explicit URL handle to avoid stale DOM during SPA transitions
		let handle = getUrlHandle();
		// Fallback: username pill
		const userName = document.querySelector('[data-testid="UserName"]');
		if (!handle && userName) {
			const spans = userName.querySelectorAll('span');
			for (const s of spans) {
				const t = (s.textContent || '').trim();
				if (t.startsWith('@') && t.length > 1) { handle = t.slice(1); break; }
			}
		}
		// Display name
		let displayName = null;
		if (userName) {
			const nameDiv = userName.querySelector('div[dir="ltr"]');
			if (nameDiv) displayName = (nameDiv.textContent || '').trim();
		}
		// Followers count (try variants, parse human formats)
		function parseHumanNumber(text) {
			const t = String(text || '').replace(/[,\s]/g, '').toUpperCase();
			const m = t.match(/([0-9]*\.?[0-9]+)([KMB])?/);
			if (!m) return null;
			let num = parseFloat(m[1]);
			if (isNaN(num)) return null;
			const suf = m[2];
			if (suf === 'K') num *= 1e3; else if (suf === 'M') num *= 1e6; else if (suf === 'B') num *= 1e9;
			return Math.round(num);
		}
		let followerCount = null;
		try {
			const followersLink = document.querySelector('a[href$="/followers"], a[href$="/verified_followers"]');
			if (followersLink) {
				const numSpan = followersLink.querySelector('span');
				const txt = numSpan ? (numSpan.textContent || '') : (followersLink.textContent || '');
				const parsed = parseHumanNumber(txt);
				if (parsed) followerCount = parsed;
			}
		} catch (_) {}
		// User ID attempt via follow button's data-testid
		let userId = null;
		const followBtn = document.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]');
		if (followBtn) {
			const dt = followBtn.getAttribute('data-testid') || '';
			const idx = dt.indexOf('-');
			if (idx > 0) userId = dt.slice(0, idx);
		}
		return { handle, displayName, userId, followerCount };
	}

	function applyFavState(button, isFav) {
		if (isFav) {
			button.classList.add('is-active');
			button.title = 'Remove from favorites';
			button.setAttribute('aria-label', 'Remove from favorites');
			button.setAttribute('aria-pressed', 'true');
		} else {
			button.classList.remove('is-active');
			button.title = 'Add to favorites';
			button.setAttribute('aria-label', 'Add to favorites');
			button.setAttribute('aria-pressed', 'false');
		}
	}

	function resetHostVisual(host) {
		if (!host || !host.shadowRoot) return;
		const btn = host.shadowRoot.querySelector('.button');
		if (!btn) return;
		btn.classList.remove('is-active');
		btn.setAttribute('aria-pressed', 'false');
		btn.setAttribute('aria-label', 'Add to favorites');
		btn.title = 'Add to favorites';
	}

	function removeExistingHosts() {
		try {
			const hosts = document.querySelectorAll(`#${HOST_ID}`);
			hosts.forEach((h) => {
				try { if (h.__utt_ro) h.__utt_ro.disconnect(); } catch (_) {}
				try { h.remove(); } catch (_) {}
			});
		} catch (_) {}
	}

	async function updateFavoriteState(host) {
		try {
			const info = getProfileInfo();
			if (!info || !info.handle || !window.UTTFavorites) return;
			const isFav = await window.UTTFavorites.isFavorite(info.handle);
			const btn = host && host.shadowRoot ? host.shadowRoot.querySelector('.button') : null;
			if (btn) applyFavState(btn, isFav);
		} catch (_) {}
	}

	function syncToTargetLayout(target, host) {
		try {
			const cs = getComputedStyle(target);
			let size = parseFloat(cs.height);
			if (!size || Number.isNaN(size)) {
				size = target.getBoundingClientRect().height;
			}
			// Clamp to a sensible button size range
			size = Math.max(28, Math.min(44, Math.round(size)));
			host.style.setProperty("--utt-size", `${size}px`);
			host.style.height = `${size}px`;
			host.style.width = "auto";
			host.style.flex = "0 0 auto";
			// Vertical alignment: rely on flex centering + equal heights
			host.style.transform = "translateY(0)";
			// Horizontal spacing: prefer parent gap; if yoksa target’in sağ marjinini kullan
			const parent = host.parentElement || target.parentElement;
			if (parent) {
				const cps = getComputedStyle(parent);
				let gap = (cps.columnGap && cps.columnGap !== "normal") ? parseFloat(cps.columnGap) : parseFloat(cps.gap);
				if (!gap || Number.isNaN(gap)) gap = 8;
				const sidePad = 0; // disable left padding as requested
				host.style.marginLeft = "0";
				host.style.marginRight = `${8}px`;
			} else {
				host.style.marginLeft = "0";
				host.style.marginRight = "8px";
			}
		} catch (_) {}
	}

	function waitForStableBox(element, onStable, attempts = 10) {
		let last = 0;
		function frame() {
			const rect = element.getBoundingClientRect();
			const h = Math.round(rect.height);
			if (h >= 24 && Math.abs(h - last) <= 1) {
				onStable();
				return;
			}
			last = h;
			if (attempts-- > 0) requestAnimationFrame(frame); else onStable();
		}
		requestAnimationFrame(frame);
	}

	function isViewingOwnProfile() {
		return !!document.querySelector(SELF_EDIT_SELECTOR);
	}

	function findActionBarAndAnchor(root = document) {
		const follow = root.querySelector(FOLLOW_CONTAINER_SELECTOR);
		const dm = root.querySelector(DM_BUTTON_SELECTOR);
		const more = root.querySelector(ACTIONS_CONTAINER_SELECTOR);

		// Primary: anchor right before Follow in its direct parent container
		if (follow && follow.parentElement) {
			return { container: follow.parentElement, refNode: follow, measureTarget: follow };
		}

		// Fallback: append right after the rightmost of dm/more inside their parent
			const candidates = [dm, more].filter(Boolean);
		if (candidates.length > 0) {
			let rightmost = candidates[0];
			try {
				candidates.forEach((n) => {
					if (!n) return;
					const rN = n.getBoundingClientRect();
					const rR = rightmost.getBoundingClientRect();
					if (rN.left > rR.left) rightmost = n;
				});
			} catch (_) {}
				const container = rightmost.parentElement;
				// place right after rightmost and add breathing space with marginLeft on host
				const refNode = rightmost.nextElementSibling; // insert after rightmost
			return { container, refNode, measureTarget: rightmost };
		}

		return { container: null, refNode: null, measureTarget: null };
	}

	function injectIfNeeded(root = document) {
		if (isViewingOwnProfile()) { removeExistingHosts(); return false; } // do not show on own profile
		const { container, refNode, measureTarget } = findActionBarAndAnchor(root);
		if (!container || !measureTarget) return false;

		const existingAnywhere = document.getElementById(HOST_ID);
		if (existingAnywhere) {
			if (existingAnywhere.parentElement !== container) {
				try { container.insertBefore(existingAnywhere, refNode || null); } catch (_) {}
			}
			// If host already present in this container, just resync layout and state
			waitForStableBox(measureTarget, () => syncToTargetLayout(measureTarget, existingAnywhere));
			updateFavoriteState(existingAnywhere);
			return true;
		}

		const host = createHost();
		try {
			// Make sure container centers children vertically and has no unexpected align
			try { if (container.style) container.style.alignItems = container.style.alignItems || 'center'; } catch (_) {}
			container.insertBefore(host, refNode || null);
			// Measure after layout settles
			waitForStableBox(measureTarget, () => syncToTargetLayout(measureTarget, host));
			// Initialize favorite state asynchronously
			setTimeout(() => updateFavoriteState(host), 0);
			if ("ResizeObserver" in window) {
				const ro = new ResizeObserver(() => syncToTargetLayout(measureTarget, host));
				ro.observe(measureTarget);
				// Keep a reference to avoid GC
				host.__utt_ro = ro;
			}
			return true;
		} catch (_) {
			return false;
		}
	}

	// Initial attempt after idle
	const initial = () => {
		currentProfileKey = getProfileKeyFromLocation();
		injectIfNeeded();
	};
	if ("requestIdleCallback" in window) {
		requestIdleCallback(initial, { timeout: 2000 });
	} else {
		setTimeout(initial, 0);
	}

	// Observe DOM for SPA navigations/rerenders
		const observer = new MutationObserver(() => {
		const key = getProfileKeyFromLocation();
		if (key !== currentProfileKey) {
			currentProfileKey = key;
			// On URL change, re-inject and re-measure from scratch
			// If one or more hosts exist, reset their visual state before updating
				if (isViewingOwnProfile()) { removeExistingHosts(); return; }
				const allHosts = document.querySelectorAll(`#${HOST_ID}`);
				allHosts.forEach((h) => resetHostVisual(h));
				injectIfNeeded();
			return;
		}
			if (!injectIfNeeded()) {
			// If already injected, just resync favorite state to avoid stale yellow button
			const host = document.getElementById(HOST_ID);
			if (host) {
				updateFavoriteState(host);
				// Also re-measure target in case layout changed without URL change
				const { measureTarget } = findActionBarAndAnchor(document);
				if (measureTarget) waitForStableBox(measureTarget, () => syncToTargetLayout(measureTarget, host));
			}
		}
	});
	observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });

	// Fallback: listen to history navigation (back/forward) and pushState
	(function patchHistory() {
		const push = history.pushState;
		history.pushState = function () {
			const ret = push.apply(this, arguments);
			setTimeout(() => {
				const key = getProfileKeyFromLocation();
				if (key !== currentProfileKey) {
					currentProfileKey = key;
					if (isViewingOwnProfile()) { removeExistingHosts(); return; }
					const allHosts = document.querySelectorAll(`#${HOST_ID}`);
					allHosts.forEach((h) => resetHostVisual(h));
					injectIfNeeded();
				}
			}, 0);
			return ret;
		};
		window.addEventListener("popstate", () => {
			const key = getProfileKeyFromLocation();
			if (key !== currentProfileKey) {
				currentProfileKey = key;
				if (isViewingOwnProfile()) { removeExistingHosts(); return; }
				const allHosts = document.querySelectorAll(`#${HOST_ID}`);
				allHosts.forEach((h) => resetHostVisual(h));
				injectIfNeeded();
			}
		});
	})();
})();


