import { createRouter } from './scripts/modules/router.js';
import { initSidebar } from './scripts/modules/sidebar.js';
import { initHomePage } from './scripts/pages/home.js';
import { initFollowPage } from './scripts/pages/follow.js';
import { initEngagePage } from './scripts/pages/engage.js';
import { initFavoritesPage } from './scripts/pages/favorites.js';

const router = createRouter({
	defaultPage: 'home',
	pageSelector: '.page',
	navSelector: '.nav-item',
	dotSelector: '.pagination .dot',
	prevSelector: '#page-prev',
	nextSelector: '#page-next',
	storageKey: 'popupPage',
	afterNavigate: () => {
		// Mobil görünümde gezinme sonrası sidebar'ı kapat
		const shell = document.querySelector('.shell');
		const overlay = document.getElementById('sidebar-overlay');
		if (shell?.getAttribute('data-sidebar-open') === 'true') {
			shell.setAttribute('data-sidebar-open', 'false');
			if (overlay) overlay.hidden = true;
		}
	}
});

initSidebar({
	shellSelector: '.shell',
	toggleSelector: '#toggle-sidebar',
	overlaySelector: '#sidebar-overlay'
});

initHomePage();
initFollowPage();
initEngagePage();
initFavoritesPage();

router.init();

