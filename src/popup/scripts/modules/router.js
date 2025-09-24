import { getLocal, setLocal } from './utils.js';

export function createRouter({ defaultPage = 'home', pageSelector, navSelector, dotSelector, prevSelector, nextSelector, storageKey = 'popupPage', afterNavigate } = {}) {
	const pageSections = Array.from(document.querySelectorAll(pageSelector));
	const navButtons = Array.from(document.querySelectorAll(navSelector));
	const dotButtons = Array.from(document.querySelectorAll(dotSelector));
	const prevBtn = document.querySelector(prevSelector);
	const nextBtn = document.querySelector(nextSelector);
	const pageKeys = pageSections.map(s => s.dataset.page);
	let currentIndex = 0;

	function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }

	function indexOfPageKey(key) {
		const idx = pageKeys.indexOf(String(key || ''));
		return idx >= 0 ? idx : 0;
	}

	function updatePaginationUI(idx) {
		dotButtons.forEach((dot) => {
			const isActive = dot.dataset.page === pageKeys[idx];
			dot.classList.toggle('is-active', isActive);
		});
		if (prevBtn) prevBtn.disabled = idx === 0;
		if (nextBtn) nextBtn.disabled = idx === pageKeys.length - 1;
	}

	function updateNavUI(idx) {
		navButtons.forEach((btn) => {
			const isActive = btn.dataset.page === pageKeys[idx];
			btn.classList.toggle('is-active', isActive);
			btn.setAttribute('aria-selected', String(isActive));
		});
	}

	function showPageByIndex(newIndex) {
		currentIndex = clamp(newIndex, 0, pageKeys.length - 1);
		pageSections.forEach((section, i) => { section.hidden = i !== currentIndex; });
		updateNavUI(currentIndex);
		updatePaginationUI(currentIndex);
		setLocal({ [storageKey]: pageKeys[currentIndex] }).catch(() => {});
		if (typeof afterNavigate === 'function') {
			afterNavigate(pageKeys[currentIndex], currentIndex);
		}
	}

	function showPageByKey(key) { showPageByIndex(indexOfPageKey(key)); }

	function init() {
		// Restore last page
		getLocal({ [storageKey]: defaultPage }).then(store => showPageByKey(store[storageKey] || defaultPage));

		// Listeners
		navButtons.forEach((btn) => {
			btn.addEventListener('click', () => { showPageByKey(btn.dataset.page); });
		});
		dotButtons.forEach((dot) => { dot.addEventListener('click', () => showPageByKey(dot.dataset.page)); });
		if (prevBtn) prevBtn.addEventListener('click', () => showPageByIndex(currentIndex - 1));
		if (nextBtn) nextBtn.addEventListener('click', () => showPageByIndex(currentIndex + 1));
		window.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowLeft') showPageByIndex(currentIndex - 1);
			if (e.key === 'ArrowRight') showPageByIndex(currentIndex + 1);
		});

		// Programmatic navigation
		window.addEventListener('UTT_NAVIGATE', (e) => {
			try {
				const page = e?.detail?.page;
				if (page) showPageByKey(page);
			} catch (_) {}
		});
	}

	return { init, showPageByKey };
}


