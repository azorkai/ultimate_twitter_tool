(() => {
	// Network Debugger Content Script
	const ND_KEYS = {
		enabled: 'netDebugEnabled',
		panel: 'netDebugPanelEnabled',
		maxEntries: 'netDebugMaxEntries',
		autoPersist: 'netDebugAutoPersist'
	};
	const ND_UI_KEY = 'netDebugOverlayPos';
	const NET_LOG_STORAGE_KEY = 'utt:netlog:v1';

	let settings = { enabled: false, panel: false, maxEntries: 400, autoPersist: true };
	let overlay = null;
	let listEl = null;
	let statsEl = null;
	let capturePaused = false;
	let overlayPos = { left: 12, top: null, bottom: 12, width: 400, height: 320 };
	let resizeObs = null;

	const requestsById = new Map();
	let entries = [];
	let saveScheduled = false;

	function debounceSave() {
		if (saveScheduled) return;
		saveScheduled = true;
		setTimeout(async () => {
			try {
				if (!settings.autoPersist) { saveScheduled = false; return; }
				const data = {}; data[NET_LOG_STORAGE_KEY] = entries;
				await chrome.storage.local.set(data);
			} catch (_) {}
			saveScheduled = false;
		}, 250);
	}

	function ensureInjected() {
		try {
			const id = 'utt-net-hook-script';
			if (document.getElementById(id)) return;
			const s = document.createElement('script');
			s.id = id;
			s.src = chrome.runtime.getURL('src/content/injectors/net-hook.js');
			s.type = 'text/javascript';
			document.documentElement.appendChild(s);
			s.remove();
		} catch (_) {}
	}

	function createOverlay() {
		if (overlay && document.body.contains(overlay)) return overlay;
		if (!document.body) {
			document.addEventListener('DOMContentLoaded', createOverlay, { once: true });
			return null;
		}
		overlay = document.getElementById('utt-net-debugger') || document.createElement('div');
		overlay.id = 'utt-net-debugger';
		overlay.setAttribute('role', 'region');
		overlay.setAttribute('aria-label', 'UTT Network Debugger');
		Object.assign(overlay.style, {
			position: 'fixed', bottom: '12px', left: '12px', width: '400px', height: '320px',
			overflow: 'hidden', resize: 'both', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
			fontSize: '12px', background: 'rgba(0,0,0,0.82)', color: '#f3f4f6', border: '2px solid #ef4444',
			borderRadius: '10px', padding: '8px', zIndex: '2147483646', boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
		});

		if (!overlay.firstChild) {
			const header = document.createElement('div');
			header.style.display = 'flex';
			header.style.alignItems = 'center';
			header.style.justifyContent = 'space-between';
			header.style.gap = '8px';
			header.style.marginBottom = '6px';
			header.style.cursor = 'move';
			header.innerHTML = '<div style="font-weight:700;color:#fecaca">UTT Network Debugger</div>';

			const controls = document.createElement('div');
			controls.style.display = 'flex';
			controls.style.gap = '6px';

			const btn = (label, title) => {
				const b = document.createElement('button');
				b.textContent = label;
				b.title = title || label;
				Object.assign(b.style, {
					background: '#111827', color: '#f3f4f6', border: '1px solid #374151', padding: '4px 8px',
					borderRadius: '999px', cursor: 'pointer', fontWeight: '700'
				});
				b.onmouseenter = () => b.style.background = '#1f2937';
				b.onmouseleave = () => b.style.background = '#111827';
				return b;
			};

			const pauseBtn = btn('Pause', 'Pause/Resume capture (Alt+Shift+N)');
			const clearBtn = btn('Clear', 'Clear logs');
			const exportBtn = btn('Export', 'Export logs to file');

			pauseBtn.addEventListener('click', () => toggleCapture());
			clearBtn.addEventListener('click', async () => { await clearLogs(); });
			exportBtn.addEventListener('click', async () => { await requestExport(); });

			controls.append(pauseBtn, clearBtn, exportBtn);
			header.appendChild(controls);
			overlay.appendChild(header);

			statsEl = document.createElement('div');
			statsEl.style.color = '#fca5a5';
			statsEl.style.marginBottom = '6px';
			overlay.appendChild(statsEl);

			listEl = document.createElement('div');
			Object.assign(listEl.style, { overflow: 'auto', height: '240px', borderTop: '1px dashed #ef4444', paddingTop: '6px' });
			overlay.appendChild(listEl);
		}

		if (!document.body.contains(overlay)) document.body.appendChild(overlay);

		document.addEventListener('keydown', (e) => {
			if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'n') toggleCapture();
		});

		setupDrag(overlay);
		applyOverlayPlacement();
		setupResizeObserver();
		adjustListHeight();
		return overlay;
	}

	function setupResizeObserver() {
		try {
			if (resizeObs) resizeObs.disconnect();
			resizeObs = new ResizeObserver(() => {
				adjustListHeight();
				saveOverlayPosDebounced();
			});
			resizeObs.observe(overlay);
		} catch (_) {}
	}

	function adjustListHeight() {
		try {
			if (!overlay || !listEl) return;
			const children = overlay.children;
			let used = 0;
			for (let i = 0; i < children.length; i++) {
				const el = children[i];
				if (el === listEl) continue;
				used += el.getBoundingClientRect().height;
			}
			const pad = 16; // top+bottom padding ~8+8
			const target = Math.max(80, Math.floor(overlay.getBoundingClientRect().height - used - pad));
			listEl.style.height = `${target}px`;
		} catch (_) {}
	}

	function setupDrag(box) {
		try {
			const headerEl = box.firstChild;
			let dragging = false;
			let startX = 0, startY = 0;
			let startLeft = 0, startTop = 0;
			const onDown = (e) => {
				if (!e) return;
				const tgt = e.target;
				if (tgt && (tgt.tagName === 'BUTTON' || tgt.closest('button'))) return; // don't drag from buttons
				dragging = true;
				startX = e.clientX;
				startY = e.clientY;
				const rect = box.getBoundingClientRect();
				startLeft = rect.left;
				startTop = rect.top;
				box.style.top = `${rect.top}px`;
				box.style.left = `${rect.left}px`;
				box.style.bottom = '';
				document.body.style.userSelect = 'none';
				document.addEventListener('mousemove', onMove);
				document.addEventListener('mouseup', onUp);
			};
			const onMove = (e) => {
				if (!dragging) return;
				const dx = e.clientX - startX;
				const dy = e.clientY - startY;
				const nextL = Math.min(window.innerWidth - box.offsetWidth, Math.max(0, startLeft + dx));
				const nextT = Math.min(window.innerHeight - box.offsetHeight, Math.max(0, startTop + dy));
				box.style.left = `${nextL}px`;
				box.style.top = `${nextT}px`;
			};
			const onUp = () => {
				dragging = false;
				document.body.style.userSelect = '';
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				saveOverlayPosDebounced();
			};
			headerEl.addEventListener('mousedown', onDown);
		} catch (_) {}
	}

	function applyOverlayPlacement() {
		try {
			if (!overlay) return;
			if (overlayPos.left != null) overlay.style.left = `${overlayPos.left}px`;
			if (overlayPos.top != null) { overlay.style.top = `${overlayPos.top}px`; overlay.style.bottom = ''; }
			else { overlay.style.bottom = `${overlayPos.bottom || 12}px`; overlay.style.top = ''; }
			if (overlayPos.width) overlay.style.width = `${overlayPos.width}px`;
			if (overlayPos.height) overlay.style.height = `${overlayPos.height}px`;
		} catch (_) {}
	}

	const saveOverlayPosDebounced = (() => {
		let t = null;
		return () => {
			if (t) clearTimeout(t);
			t = setTimeout(saveOverlayPos, 200);
		};
	})();

	async function saveOverlayPos() {
		try {
			if (!overlay) return;
			const rect = overlay.getBoundingClientRect();
			overlayPos = { left: Math.round(rect.left), top: Math.round(rect.top), bottom: null, width: Math.round(rect.width), height: Math.round(rect.height) };
			const data = {}; data[ND_UI_KEY] = overlayPos; await chrome.storage.local.set(data);
		} catch (_) {}
	}

	function toggleCapture() {
		capturePaused = !capturePaused;
		updateStats();
	}

	function updateStats() {
		try {
			const total = entries.length;
			const errors = entries.filter(e => (e.status || 0) >= 400 || e.phase === 'error').length;
			const avg = (() => {
				const d = entries.map(e => e.durationMs || 0).filter(Boolean);
				if (!d.length) return 0;
				return Math.round(d.reduce((a,b)=>a+b,0)/d.length);
			})();
			if (statsEl) statsEl.textContent = `Captured: ${total} • Errors: ${errors} • Avg: ${avg} ms`;
		} catch (_) {}
	}

	function renderEntry(e) {
		if (!listEl) return;
		const row = document.createElement('div');
		row.style.display = 'grid';
		row.style.gridTemplateColumns = '66px 1fr 54px 60px';
		row.style.gap = '6px';
		row.style.alignItems = 'center';
		row.style.padding = '4px 0';
		row.style.borderBottom = '1px solid rgba(239,68,68,0.15)';
		row.style.cursor = 'pointer';

		const method = document.createElement('div'); method.textContent = (e.method || '').padEnd(3,' ').slice(0,6); method.style.color = '#fde68a'; method.style.fontWeight = '700';
		const url = document.createElement('div'); url.textContent = tryShortenUrl(e.url || ''); url.style.color = '#d1d5db'; url.title = e.url || '';
		const status = document.createElement('div'); status.textContent = String(e.status ?? '-'); status.style.color = (e.status||0) >= 400 ? '#fca5a5' : '#86efac'; status.style.fontWeight = '700';
		const dur = document.createElement('div'); dur.textContent = e.durationMs ? `${e.durationMs} ms` : '-'; dur.style.color = '#93c5fd'; dur.style.textAlign = 'right';

		row.append(method, url, status, dur);
		listEl.appendChild(row);

		let detailsOpen = false;
		let detailsEl = null;
		row.addEventListener('click', () => {
			if (!detailsOpen) {
				detailsEl = buildDetails(e);
				listEl.insertBefore(detailsEl, row.nextSibling);
				detailsOpen = true;
			} else if (detailsEl && detailsEl.parentNode) {
				detailsEl.parentNode.removeChild(detailsEl);
				detailsOpen = false;
			}
		});
		listEl.scrollTop = listEl.scrollHeight;
 	}

	function tryShortenUrl(u) {
		try { const x = new URL(u); const path = x.pathname + (x.search ? x.search.replace(/([?&])([^=&]{1,12})[^=&]*/g, '$1$2=…') : ''); return x.host + path; } catch (_) { return u; }
 	}

	function onNetEvent(data) {
		if (!data) return;
		const ev = data.payload || {};
 		if (ev.phase === 'ready') return; // hook installed
 		if (capturePaused) return;

 		if (ev.phase === 'start') {
 			requestsById.set(ev.id, { ...ev });
 			return;
 		}
 		const start = requestsById.get(ev.id) || {};
		const rec = normalizeRecord({ ...start, ...ev });
 		requestsById.delete(ev.id);

 		entries.push(rec);
 		if (entries.length > Number(settings.maxEntries || 400)) entries.splice(0, entries.length - Number(settings.maxEntries || 400));
 		renderEntry(rec);
 		updateStats();
 		debounceSave();
 	}

 	function normalizeRecord(r) {
		return {
 			id: r.id,
 			kind: r.kind,
 			url: r.url,
 			method: r.method,
 			status: r.status,
 			statusText: r.statusText,
 			durationMs: typeof r.durationMs === 'number' ? Math.max(0, Math.round(r.durationMs)) : undefined,
 			contentType: r.contentType,
 			headers: redactHeaders(r.headers || {}),
			requestHeaders: redactHeaders(r.requestHeaders || {}),
			requestContentType: r.requestContentType,
			requestBodyPreview: sanitizeBodyPreview(r.requestBodyPreview),
			bodyPreview: sanitizeBodyPreview(r.bodyPreview)
 		};
 	}

 	function redactHeaders(h) {
 		try {
 			const out = {};
 			for (const k of Object.keys(h || {})) {
 				const lk = k.toLowerCase();
 				if (lk === 'authorization' || lk === 'cookie' || lk === 'x-csrf-token' || lk === 'x-guest-token') {
 					out[k] = '***';
 				} else {
 					out[k] = String(h[k]).slice(0, 256);
 				}
 			}
 			return out;
 		} catch (_) { return {}; }
 	}

	function sanitizeBodyPreview(b) {
 		if (b == null) return null;
 		if (typeof b === 'string') return b.slice(0, 2048);
		try {
			const clone = JSON.parse(JSON.stringify(b));
			return redactSensitiveInObject(clone);
		} catch (_) { return null; }
 	}

	function redactSensitiveInObject(obj) {
		try {
			const SENSITIVE_KEYS = ['password','passwd','authorization','auth','token','x-csrf-token','cookie','secret','bearer'];
			const walk = (node) => {
				if (!node || typeof node !== 'object') return node;
				if (Array.isArray(node)) { node.forEach(walk); return node; }
				for (const k of Object.keys(node)) {
					const v = node[k];
					if (SENSITIVE_KEYS.includes(String(k).toLowerCase())) {
						node[k] = '***';
					} else if (v && typeof v === 'object') {
						walk(v);
					} else if (typeof v === 'string' && v.length > 256) {
						node[k] = v.slice(0, 256) + '…';
					}
				}
				return node;
			};
			return walk(obj);
		} catch (_) { return obj; }
	}

	function truncate(str, limit) { try { return String(str).length > limit ? String(str).slice(0, limit) + '…' : String(str); } catch (_) { return str; } }

	function stringifyPreview(pre) {
		if (pre == null) return '—';
		const LIMIT = 8192;
		try {
			if (typeof pre === 'string') return truncate(pre, LIMIT);
			return truncate(JSON.stringify(pre, null, 2), LIMIT);
		} catch (_) { try { return truncate(String(pre), LIMIT); } catch (_) { return '—'; } }
	}

	function buildDetails(e) {
		const wrap = document.createElement('div');
		wrap.className = 'nd-details';
		wrap.style.borderLeft = '2px solid rgba(239,68,68,0.35)';
		wrap.style.margin = '4px 0 8px 6px';
		wrap.style.padding = '6px 8px';
		wrap.style.background = 'rgba(239,68,68,0.06)';
		wrap.style.borderRadius = '8px';
		wrap.style.display = 'grid';
		wrap.style.gap = '8px';

		const section = (title) => {
			const s = document.createElement('div');
			const h = document.createElement('div'); h.textContent = title; h.style.fontWeight = '700'; h.style.color = '#fecaca'; h.style.marginBottom = '4px';
			const b = document.createElement('div');
			s.append(h, b);
			return { el: s, body: b };
		};

		const req = section('Request');
		const res = section('Response');

		const metaText = (label, value, color) => {
			const line = document.createElement('div');
			line.style.color = color || '#d1d5db';
			line.style.fontSize = '12px';
			line.textContent = `${label}: ${value}`;
			return line;
		};

		// Request meta
		req.body.append(
			metaText('Method', e.method || '-'),
			metaText('URL', e.url || '-'),
			metaText('Content-Type', e.requestContentType || '-', '#93c5fd')
		);
		// Request headers
		if (e.requestHeaders && Object.keys(e.requestHeaders).length) {
			const pre = document.createElement('pre');
			pre.style.margin = '4px 0'; pre.style.whiteSpace = 'pre-wrap'; pre.style.maxHeight = '100px'; pre.style.overflow = 'auto'; pre.style.background = '#0f1629'; pre.style.border = '1px solid #374151'; pre.style.borderRadius = '6px'; pre.style.padding = '6px 8px'; pre.style.color = '#d1d5db';
			pre.textContent = Object.entries(e.requestHeaders).map(([k,v]) => `${k}: ${v}`).join('\n');
			req.body.append(pre);
		}
		// Request body
		if (e.requestBodyPreview != null) {
			const pre = document.createElement('pre');
			pre.style.margin = '4px 0'; pre.style.whiteSpace = 'pre-wrap'; pre.style.maxHeight = '160px'; pre.style.overflow = 'auto'; pre.style.background = '#0f1629'; pre.style.border = '1px solid #374151'; pre.style.borderRadius = '6px'; pre.style.padding = '6px 8px'; pre.style.color = '#e5e7eb';
			pre.textContent = stringifyPreview(e.requestBodyPreview);
			req.body.append(pre);
		}

		// Response meta
		res.body.append(
			metaText('Status', `${e.status || '-'} ${e.statusText || ''}`.trim(), (e.status||0) >= 400 ? '#fca5a5' : '#86efac'),
			metaText('Content-Type', e.contentType || '-', '#93c5fd')
		);
		// Response headers
		if (e.headers && Object.keys(e.headers).length) {
			const pre = document.createElement('pre');
			pre.style.margin = '4px 0'; pre.style.whiteSpace = 'pre-wrap'; pre.style.maxHeight = '100px'; pre.style.overflow = 'auto'; pre.style.background = '#0f1629'; pre.style.border = '1px solid #374151'; pre.style.borderRadius = '6px'; pre.style.padding = '6px 8px'; pre.style.color = '#d1d5db';
			pre.textContent = Object.entries(e.headers).map(([k,v]) => `${k}: ${v}`).join('\n');
			res.body.append(pre);
		}
		// Response body
		if (e.bodyPreview != null) {
			const pre = document.createElement('pre');
			pre.style.margin = '4px 0'; pre.style.whiteSpace = 'pre-wrap'; pre.style.maxHeight = '200px'; pre.style.overflow = 'auto'; pre.style.background = '#0f1629'; pre.style.border = '1px solid #374151'; pre.style.borderRadius = '6px'; pre.style.padding = '6px 8px'; pre.style.color = '#e5e7eb';
			pre.textContent = stringifyPreview(e.bodyPreview);
			res.body.append(pre);
		}

		// Actions
		const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.gap = '8px';
		const mkBtn = (label) => { const b = document.createElement('button'); b.textContent = label; Object.assign(b.style, { background:'#111827', color:'#f3f4f6', border:'1px solid #374151', padding:'4px 8px', borderRadius:'999px', cursor:'pointer', fontWeight:'700' }); b.onmouseenter=()=>b.style.background='#1f2937'; b.onmouseleave=()=>b.style.background='#111827'; return b; };
		const copyReq = mkBtn('Copy Request');
		const copyRes = mkBtn('Copy Response');
		copyReq.addEventListener('click', async () => {
			try { await navigator.clipboard.writeText(stringifyPreview({ headers: e.requestHeaders, body: e.requestBodyPreview })); } catch (_) {}
		});
		copyRes.addEventListener('click', async () => {
			try { await navigator.clipboard.writeText(stringifyPreview({ headers: e.headers, body: e.bodyPreview })); } catch (_) {}
		});
		actions.append(copyReq, copyRes);

		wrap.append(req.el, res.el, actions);
		return wrap;
	}

	async function loadSettings() {
 		try {
			const store = await chrome.storage.local.get({
 				[ND_KEYS.enabled]: false,
 				[ND_KEYS.panel]: false,
 				[ND_KEYS.maxEntries]: 400,
				[ND_KEYS.autoPersist]: true,
				[NET_LOG_STORAGE_KEY]: [],
				[ND_UI_KEY]: null
 			});
 			settings.enabled = Boolean(store[ND_KEYS.enabled]);
 			settings.panel = Boolean(store[ND_KEYS.panel]);
 			settings.maxEntries = Number(store[ND_KEYS.maxEntries] || 400);
 			settings.autoPersist = Boolean(store[ND_KEYS.autoPersist]);
 			entries = Array.isArray(store[NET_LOG_STORAGE_KEY]) ? store[NET_LOG_STORAGE_KEY] : [];
			if (store[ND_UI_KEY] && typeof store[ND_UI_KEY] === 'object') overlayPos = { ...overlayPos, ...store[ND_UI_KEY] };
 		} catch (_) {}
 	}

 	async function clearLogs() {
 		try {
 			entries = [];
 			if (listEl) listEl.innerHTML = '';
 			updateStats();
 			const data = {}; data[NET_LOG_STORAGE_KEY] = entries; await chrome.storage.local.set(data);
 		} catch (_) {}
 	}

 	async function requestExport() {
 		try {
 			await chrome.runtime.sendMessage({ type: 'UTT_NETDBG', name: 'EXPORT_LOGS' });
 		} catch (_) {}
 	}

	function renderInitial() {
 		if (!settings.panel) return;
 		createOverlay();
 		if (!listEl) return;
 		listEl.innerHTML = '';
 		for (const e of entries.slice(-60)) renderEntry(e);
 		updateStats();
		adjustListHeight();
 	}

 	function applySettings() {
 		if (settings.enabled) ensureInjected();
 		if (settings.panel) createOverlay();
 	}

	// Message bridge
	window.addEventListener('message', (e) => {
		try {
			const d = e?.data;
			if (!d || d.source !== 'UTT_NET' || d.type !== 'NETWORK_EVENT') return;
			// Optional origin check: only accept messages from same origin
			if (typeof e.origin === 'string' && e.origin && e.origin !== location.origin) return;
			onNetEvent(d);
		} catch (_) {}
	}, false);
 	chrome.runtime.onMessage.addListener((msg, _sender, _send) => {
 		try {
 			if (msg?.type !== 'UTT_NETDBG') return;
 			switch (msg.name) {
 				case 'TOGGLE_ENABLED': settings.enabled = Boolean(msg.enabled); if (settings.enabled) ensureInjected(); break;
 				case 'TOGGLE_PANEL': settings.panel = Boolean(msg.visible); if (settings.panel) renderInitial(); else if (overlay) overlay.remove(); break;
 				case 'UPDATE_MAX_ENTRIES': settings.maxEntries = Number(msg.maxEntries || 400); break;
 				case 'CLEAR_LOGS': clearLogs(); break;
 				case 'EXPORT_LOGS': requestExport(); break;
 			}
 		} catch (_) {}
 	});

 	// Init
 	(async () => {
 		await loadSettings();
 		applySettings();
 		renderInitial();
 	})();
})();


