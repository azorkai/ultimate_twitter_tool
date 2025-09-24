export function initSidebar({ shellSelector, toggleSelector, overlaySelector }) {
	const shell = document.querySelector(shellSelector);
	const toggleSidebarBtn = document.querySelector(toggleSelector);
	const sidebarOverlay = document.querySelector(overlaySelector);

	function setSidebarOpen(open) {
		if (!shell) return;
		shell.setAttribute('data-sidebar-open', String(Boolean(open)));
		if (toggleSidebarBtn) toggleSidebarBtn.setAttribute('aria-expanded', String(Boolean(open)));
		if (sidebarOverlay) sidebarOverlay.hidden = !open;
	}

	if (toggleSidebarBtn) {
		toggleSidebarBtn.addEventListener('click', () => {
			const open = shell?.getAttribute('data-sidebar-open') !== 'true';
			setSidebarOpen(open);
		});
	}
	if (sidebarOverlay) {
		sidebarOverlay.addEventListener('click', () => setSidebarOpen(false));
	}

	return { setSidebarOpen };
}


