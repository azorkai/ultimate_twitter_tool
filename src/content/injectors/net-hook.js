// UTT Network Hook Injector
// Runs in page context: intercepts fetch and XHR to capture request/response metadata
// Exposes events via window.postMessage({ source: 'UTT_NET', type: 'NETWORK_EVENT', payload })

(() => {
  try {
    if (window.__UTT_NET_HOOKED__) return;
    Object.defineProperty(window, '__UTT_NET_HOOKED__', { value: true, configurable: false, enumerable: false, writable: false });

    const ORIGIN = location.origin;
    const shouldTrack = (url) => {
      try {
        const u = new URL(url, ORIGIN);
        return u.hostname.endsWith('x.com') || u.hostname.endsWith('twitter.com');
      } catch (_) { return false; }
    };

    const now = () => Date.now();
    const genId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

    const post = (event) => {
      try {
        window.postMessage({ source: 'UTT_NET', type: 'NETWORK_EVENT', payload: event }, '*');
      } catch (_) {}
    };

    // Fetch hook
    const originalFetch = window.fetch;
    window.fetch = async function(input, init) {
      const id = genId();
      const startedAt = now();
      let method = 'GET';
      let url = '';
      let requestHeaders = undefined;
      let requestBodyPreview = undefined;
      let requestContentType = undefined;
      try {
        if (typeof input === 'string') { url = input; }
        else if (input && typeof input.url === 'string') { url = input.url; }
        if (init && init.method) method = String(init.method).toUpperCase();
        else if (input && input.method) method = String(input.method).toUpperCase();
      } catch (_) {}

      const track = shouldTrack(url);
      if (track) {
        try {
          requestHeaders = tryReadHeaders(init?.headers || input?.headers);
          requestContentType = getHeaderFromObject(requestHeaders, 'content-type');
          requestBodyPreview = await readRequestBodyPreview(input, init, requestContentType);
          // Surface headers to page context for dm-sync to learn tokens
          if (requestHeaders) {
            try {
              if (requestHeaders['authorization']) window.__utt_cached_auth = requestHeaders['authorization'];
              if (requestHeaders['x-guest-token']) window.__utt_cached_guest = requestHeaders['x-guest-token'];
            } catch (_) {}
          }
        } catch (_) {}
        post({ id, phase: 'start', kind: 'fetch', url, method, startedAt, requestHeaders, requestBodyPreview, requestContentType });
      }

      let resp, error;
      try {
        resp = await originalFetch.apply(this, arguments);
      } catch (e) {
        error = e;
      }

      if (track) {
        const endedAt = now();
        if (resp) {
          const cloned = resp.clone();
          const contentType = cloned.headers.get('content-type') || '';
          let bodyPreview = null;
          try {
            bodyPreview = await readBodyPreview(cloned, contentType);
          } catch (_) {}
          post({ id, phase: 'end', kind: 'fetch', url, method, endedAt, status: resp.status, statusText: resp.statusText, headers: headersToObject(cloned.headers), contentType, bodyPreview, durationMs: endedAt - startedAt });
        } else {
          post({ id, phase: 'error', kind: 'fetch', url, method, endedAt, error: safeErr(error), durationMs: endedAt - startedAt });
        }
      }

      if (error) throw error;
      return resp;
    };

    // XHR hook
    const OriginalXHR = window.XMLHttpRequest;
    function WrappedXHR() {
      const xhr = new OriginalXHR();
      const id = genId();
      let url = '';
      let method = 'GET';
      let startedAt = 0;
      let track = false;
      const reqHeaders = {};

      const open = xhr.open;
      xhr.open = function(m, u) {
        try { method = String(m || 'GET').toUpperCase(); url = String(u || ''); track = shouldTrack(url); } catch (_) {}
        return open.apply(xhr, arguments);
      };

      const setRequestHeader = xhr.setRequestHeader;
      xhr.setRequestHeader = function(name, value) {
        try { if (name) reqHeaders[String(name).toLowerCase()] = String(value); } catch (_) {}
        return setRequestHeader.apply(xhr, arguments);
      };

      const send = xhr.send;
      xhr.send = function() {
        startedAt = now();
        if (track) {
          let requestBodyPreview = undefined;
          try { requestBodyPreview = formatReqBody(arguments[0], reqHeaders['content-type']); } catch (_) {}
          post({ id, phase: 'start', kind: 'xhr', url, method, startedAt, requestHeaders: { ...reqHeaders }, requestBodyPreview, requestContentType: reqHeaders['content-type'] });
        }
        xhr.addEventListener('loadend', () => {
          if (!track) return;
          const endedAt = now();
          let responseHeaders = {};
          try { responseHeaders = parseRawHeaders(xhr.getAllResponseHeaders()); } catch (_) {}
          const contentType = xhr.getResponseHeader('content-type') || '';
          let bodyPreview = null;
          try { bodyPreview = previewFromText(String(xhr.response || ''), contentType); } catch (_) {}
          post({ id, phase: 'end', kind: 'xhr', url, method, endedAt, status: xhr.status, statusText: xhr.statusText, headers: responseHeaders, contentType, bodyPreview, durationMs: endedAt - startedAt });
        });
        return send.apply(xhr, arguments);
      };

      return xhr;
    }
    window.XMLHttpRequest = WrappedXHR;

    function tryReadHeaders(h) {
      try {
        if (!h) return undefined;
        if (Array.isArray(h)) return Object.fromEntries(h);
        if (h instanceof Headers) return headersToObject(h);
        if (typeof h === 'object') return { ...h };
      } catch (_) {}
      return undefined;
    }

    function headersToObject(headers) {
      const o = {};
      try { for (const [k, v] of headers.entries()) o[k] = v; } catch (_) {}
      return o;
    }

    function parseRawHeaders(raw) {
      const map = {};
      try {
        raw.trim().split(/\r?\n/).forEach(line => {
          const idx = line.indexOf(':');
          if (idx > 0) map[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
        });
      } catch (_) {}
      return map;
    }

    function previewFromText(text, contentType) {
      const limit = 2048;
      if ((contentType || '').includes('application/json')) {
        try { return JSON.parse(text); } catch (_) { return text.slice(0, limit); }
      }
      if ((contentType || '').startsWith('text/')) return text.slice(0, limit);
      return null; // skip binary
    }

    async function readBodyPreview(resp, contentType) {
      const type = (contentType || '').toLowerCase();
      if (type.includes('application/json')) {
        try { return await resp.json(); } catch (_) { return null; }
      }
      if (type.startsWith('text/')) {
        try { const t = await resp.text(); return t.slice(0, 2048); } catch (_) { return null; }
      }
      return null;
    }

    function getHeaderFromObject(h, name) {
      try {
        if (!h) return undefined;
        const val = h[name] || h[name?.toLowerCase?.()] || h[String(name).toLowerCase?.()] || h[String(name)];
        return val;
      } catch (_) { return undefined; }
    }

    async function readRequestBodyPreview(input, init, reqContentType) {
      try {
        if (init && 'body' in (init || {})) {
          return formatReqBody(init.body, reqContentType);
        }
        if (input && typeof input === 'object' && typeof input.clone === 'function' && typeof input.text === 'function') {
          try {
            const clone = input.clone();
            const t = await clone.text();
            return previewFromText(t, reqContentType || getHeaderFromObject(tryReadHeaders(input.headers), 'content-type') || '');
          } catch (_) { return undefined; }
        }
      } catch (_) {}
      return undefined;
    }

    function formatReqBody(body, reqContentType) {
      const limit = 2048;
      const type = String(reqContentType || '').toLowerCase();
      try {
        if (body == null) return undefined;
        if (typeof body === 'string') return previewFromText(body, type);
        if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return body.toString().slice(0, limit);
        if (typeof FormData !== 'undefined' && body instanceof FormData) {
          const arr = [];
          body.forEach((v, k) => arr.push([k, String(v).slice(0, 200)]));
          return { form: arr.slice(0, 100) };
        }
        if (type.includes('application/json')) {
          try { return typeof body === 'object' ? body : JSON.parse(String(body)); } catch (_) { return String(body).slice(0, limit); }
        }
        // Blob/ArrayBuffer/DataView/TypedArray
        if (typeof Blob !== 'undefined' && body instanceof Blob) { return `Blob(${body.size} bytes)`; }
        if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) { return `ArrayBuffer(${body.byteLength} bytes)`; }
        if (typeof DataView !== 'undefined' && body instanceof DataView) { return `DataView(${body.byteLength} bytes)`; }
        if (ArrayBuffer.isView && ArrayBuffer.isView(body)) { return `TypedArray(${body.byteLength || body.length} bytes)`; }
      } catch (_) {}
      try { return String(body).slice(0, limit); } catch (_) { return undefined; }
    }

    function safeErr(e) { try { return { name: e?.name, message: String(e?.message || e), stack: e?.stack }; } catch (_) { return { message: 'error' }; } }

    // Signal ready
    post({ phase: 'ready', kind: 'hook' });
  } catch (_) {}
})();


