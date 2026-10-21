(function (global) {
  'use strict';

  function telegramInitData() {
    const webApp = global.Telegram && global.Telegram.WebApp;
    return (webApp && typeof webApp.initData === 'string') ? webApp.initData : '';
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

  async function apiFetch(input, options, initDataOverride) {
    const request = sanitizeRequest(input, initDataOverride);
    const next = { ...(options || {}) };
    const headers = new Headers(next.headers || (input instanceof Request ? input.headers : undefined));
    if (request.initData) headers.set('Authorization', `tma ${request.initData}`);
    next.headers = headers;
    return global.fetch(request.url, next);
  }

  global.GadalkaApi = Object.freeze({ fetch: apiFetch, sanitizeRequest });
})(typeof window !== 'undefined' ? window : globalThis);
