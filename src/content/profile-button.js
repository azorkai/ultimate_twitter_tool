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
				border-radius: 12px;
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
		// Handle from username pill
		let handle = null;
		const userName = document.querySelector('[data-testid="UserName"]');
		if (userName) {
			const spans = userName.querySelectorAll('span');
			for (const s of spans) {
				const t = (s.textContent || '').trim();
				if (t.startsWith('@') && t.length > 1) { handle = t.slice(1); break; }
			}
		}
		if (!handle) {
			const seg = (location.pathname.split('/').filter(Boolean)[0] || '').trim();
			if (seg && !['home','explore','notifications','messages','i','settings'].includes(seg)) handle = seg;
		}
		// Display name
		let displayName = null;
		if (userName) {
			const nameDiv = userName.querySelector('div[dir="ltr"]');
			if (nameDiv) displayName = (nameDiv.textContent || '').trim();
		}
		// User ID attempt via follow button's data-testid
		let userId = null;
		const followBtn = document.querySelector('[data-testid$="-follow"], [data-testid$="-unfollow"]');
		if (followBtn) {
			const dt = followBtn.getAttribute('data-testid') || '';
			const idx = dt.indexOf('-');
			if (idx > 0) userId = dt.slice(0, idx);
		}
		return { handle, displayName, userId };
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
			// Pixel-perfect vertical centering relative to target
			// Align baseline horizontally by mirroring target's vertical padding/border
			host.style.marginTop = cs.marginTop;
			host.style.marginBottom = cs.marginBottom;
			host.style.paddingTop = cs.paddingTop;
			host.style.paddingBottom = cs.paddingBottom;
			// Reset transform in case it was set earlier
			host.style.transform = "translateY(0)";
		} catch (_) {}
	}

	function isViewingOwnProfile() {
		return !!document.querySelector(SELF_EDIT_SELECTOR);
	}

	function findTargetForOthers(root = document) {
		// Prefer DM button (center) as anchor; fallback to actions container
		return (
			root.querySelector(DM_BUTTON_SELECTOR) ||
			root.querySelector('[data-testid="userActions"]') ||
			root.querySelector(FOLLOW_CONTAINER_SELECTOR)
		);
	}

	function injectIfNeeded(root = document) {
		if (isViewingOwnProfile()) return false; // do not show on own profile
		const target = findTargetForOthers(root);
		if (!target) return false;

		const parent = target.parentElement; // Insert as a sibling (left side)
		if (!parent) return false;

		if (parent.querySelector(`#${HOST_ID}`)) return true; // already injected

		const host = createHost();
		try {
			// If parent is a flex container with row-reverse or gaps, preserve spacing.
			const csParent = getComputedStyle(parent);
			if (csParent.display.includes("flex")) {
				host.style.marginRight = csParent.columnGap && csParent.columnGap !== "normal" ? csParent.columnGap : csParent.gap;
			}
			parent.insertBefore(host, target);
			// Match the height/spacing of the target control precisely
			syncToTargetLayout(target, host);
			// Initialize favorite state asynchronously
			setTimeout(async () => {
				const info = getProfileInfo();
				if (info && info.handle && window.UTTFavorites) {
					const isFav = await window.UTTFavorites.isFavorite(info.handle);
					const btn = host.shadowRoot && host.shadowRoot.querySelector('.button');
					if (btn) applyFavState(btn, isFav);
				}
			}, 0);
			if ("ResizeObserver" in window) {
				const ro = new ResizeObserver(() => syncToTargetLayout(target, host));
				ro.observe(target);
				// Keep a reference to avoid GC
				host.__utt_ro = ro;
			}
			return true;
		} catch (_) {
			return false;
		}
	}

	// Initial attempt after idle
	const initial = () => injectIfNeeded();
	if ("requestIdleCallback" in window) {
		requestIdleCallback(initial, { timeout: 2000 });
	} else {
		setTimeout(initial, 0);
	}

	// Observe DOM for SPA navigations/rerenders
	const observer = new MutationObserver(() => {
		injectIfNeeded();
	});
	observer.observe(document.body, { childList: true, subtree: true });
})();


