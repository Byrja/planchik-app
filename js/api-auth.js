(function (global) {
  'use strict';

  const pendingPaidRequests = new Map();

  function telegramInitData() {
    const webApp = global.Telegram && global.Telegram.WebApp;
    return (webApp && typeof webApp.initData === 'string') ? webApp.initData : '';
  }

  function newRequestId() {
    return global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : `web-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function sanitizeRequest(input, initDataOverride) {
    const raw = input instanceof Request ? input.url : String(input);
    const base = (global.location && global.location.origin) || 'https://mini-app.invalid';
    const url = new URL(raw, base);
    const queryInitData = url.searchParams.get('initData') || '';
    url.searchParams.delete('initData');
    const initData = typeof initDataOverride === 'string'
      ? initDataOverride
      : (queryInitData || telegramInitData());
    const sameOrigin = !global.location || url.origin === global.location.origin;
    const cleanUrl = sameOrigin ? `${url.pathname}${url.search}${url.hash}` : url.toString();
    return { url: cleanUrl, initData };
  }

  function paidStorageKey(input, options) {
    const request = sanitizeRequest(input);
    const method = String((options && options.method) || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const body = typeof (options && options.body) === 'string' ? options.body : '';
    const value = `${method}\n${request.url}\n${body}`;
    // A 128-bit non-cryptographic fingerprint keeps request bodies out of
    // storage while avoiding the tiny collision space of one 32-bit FNV hash.
    let h1 = 0x9e3779b9;
    let h2 = 0x85ebca6b;
    let h3 = 0xc2b2ae35;
    let h4 = 0x27d4eb2f;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 0x85ebca6b);
      h2 = Math.imul(h2 ^ code, 0xc2b2ae35);
      h3 = Math.imul(h3 ^ code, 0x27d4eb2f);
      h4 = Math.imul(h4 ^ code, 0x165667b1);
    }
    const hex = (n) => (n >>> 0).toString(16).padStart(8, '0');
    return `gadalka:paid-request:${hex(h1)}${hex(h2)}${hex(h3)}${hex(h4)}`;
  }

  function pendingRequestId(key) {
    if (pendingPaidRequests.has(key)) return pendingPaidRequests.get(key);
    try {
      const stored = global.sessionStorage && global.sessionStorage.getItem(key);
      if (stored) {
        pendingPaidRequests.set(key, stored);
        return stored;
      }
    } catch (_) { /* restricted WebView storage */ }
    const id = newRequestId();
    pendingPaidRequests.set(key, id);
    try { if (global.sessionStorage) global.sessionStorage.setItem(key, id); } catch (_) { /* memory fallback */ }
    return id;
  }

  function clearPendingRequest(key, id) {
    if (pendingPaidRequests.get(key) === id) pendingPaidRequests.delete(key);
    try {
      if (global.sessionStorage && global.sessionStorage.getItem(key) === id) global.sessionStorage.removeItem(key);
    } catch (_) { /* restricted WebView storage */ }
  }

  async function apiFetch(input, options, initDataOverride) {
    const request = sanitizeRequest(input, initDataOverride);
    const next = { ...(options || {}) };
    const headers = new Headers(next.headers || (input instanceof Request ? input.headers : undefined));
    if (request.initData) headers.set('Authorization', `tma ${request.initData}`);
    if ((next.method || (input instanceof Request ? input.method : 'GET')).toUpperCase() === 'POST' && !headers.has('x-request-id')) {
      headers.set('x-request-id', newRequestId());
    }
    next.headers = headers;
    return global.fetch(request.url, next);
  }

  async function paidFetch(input, options, initDataOverride) {
    const key = paidStorageKey(input, options);
    const id = pendingRequestId(key);
    const next = { ...(options || {}) };
    const headers = new Headers(next.headers || (input instanceof Request ? input.headers : undefined));
    headers.set('x-request-id', id);
    next.headers = headers;
    try {
      const response = await apiFetch(input, next, initDataOverride);
      let retryableConflict = false;
      if (response.status === 409) {
        try {
          const payload = await response.clone().json();
          retryableConflict = payload && payload.error === 'request_in_progress';
        } catch (_) { /* an unclassified 409 is terminal */ }
      }
      // Keep the id only while the outcome is ambiguous or explicitly in progress.
      // idempotency_conflict is terminal and must release the browser action key.
      const retryable = response.status >= 500 || response.status === 429 || retryableConflict;
      if (!retryable) {
        clearPendingRequest(key, id);
      }
      return response;
    } catch (error) {
      // The outcome is ambiguous. UI retry must reuse this exact id.
      throw error;
    }
  }

  global.GadalkaApi = Object.freeze({
    fetch: apiFetch,
    paidFetch,
    sanitizeRequest,
    requestId: newRequestId,
  });
})(typeof window !== 'undefined' ? window : globalThis);
