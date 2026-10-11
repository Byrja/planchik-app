// app.js — UI-контроллер Mini App. TMA-safe.

// -- Emergency cache-bust for landing-gate regression ----------
// Если браузер/Telegram WebView закешировал старую версию с landing-gate
// (до того как мы её убрали), этот код принудительно перезагрузит страницу
// с уникальным параметром. Безопасно — срабатывает только если DOM содержит
// маркер старой версии.
(function forceCacheBust() {
  try {
    if (document.querySelector('#landingGate, .landing-gate, [data-legacy-landing]')) {
      const url = new URL(window.location.href);
      url.searchParams.set('v', Date.now().toString());
      window.location.replace(url.toString());
    }
  } catch (_) { /* noop */ }
})();

(function () {
  'use strict';

  // -- Telegram WebApp detection ----------------------------
  const tg = (window.Telegram && window.Telegram.WebApp) ? window.Telegram.WebApp : null;
  window.TelegramApp = { tg };

  // Detect TG Desktop for CSS overrides
  (function detectDesktop() {
    const ua = navigator.userAgent || '';
    if (ua.includes('TelegramDesktop') || ua.includes('Telegram_')) {
      document.body.classList.add('tg-desktop');
    }
  })();

  // Apply Telegram theme variables
  if (tg) {
    try {
      tg.ready();
      tg.expand();
      const tp = tg.themeParams || {};
      const set = (k, v) => { if (v) document.documentElement.style.setProperty(k, v); };
      set('--bg',       tp.bg_color            || '#0b0a1a');
      set('--ink',      tp.text_color          || '#f4f0e6');
      set('--ink-dim',  tp.hint_color          || null);
      set('--bg-2',     tp.secondary_bg_color  || null);
      set('--gold',     tp.button_color        || null);
      set('--gold-2',   tp.link_color          || tp.button_color || null);
      // Header/background — синхронизация с нативной оболочкой Telegram
      try { tg.setHeaderColor(tp.secondary_bg_color || tp.bg_color || '#0b0a1a'); } catch (_) {}
      try { tg.setBackgroundColor(tp.bg_color || '#0b0a1a'); } catch (_) {}
    } catch (e) { /* noop */ }
  }

  // -- State ------------------------------------------------
  const _user = parseUser();
  function enrichProfile(p) {
    if (!p) return null;
    if (_user.id) p.telegramId = _user.id;
    return p;
  }

  // -- Evening shim (no-op: чек-ин выпилен, но код app.js ещё зовёт Evening.*) --
  const Evening = {
    loadProfile() { try { return JSON.parse(localStorage.getItem('arProfile') || 'null'); } catch { return null; } },
    saveProfile(p) { try { localStorage.setItem('arProfile', JSON.stringify(p)); } catch {} },
    last30() { return []; },
    today() { return null; },
    save() { return { ts: Date.now() }; }
  };

  const state = {
    user: _user,
    profile: enrichProfile(Evening.loadProfile()),
    mood: null,
    checkins: Evening.last30(),
    chartAi: { loaded: false, interpretation: '', remaining: 3, cached: false, error: '' },
    backendChart: { loaded: false, loading: false, chart: null, error: '' },
    aiBalance: {},
    manaBalance: null,
    profileSync: { userNotStartedBot: false },
    referralStats: null,
    moonSelectedDate: null,
  };

  const AI_LIMITS_DISPLAY = {
    tarot_spread: 5,
    chart_interpret: 3,
    daily_card_interpret: 1,
  };
  const BOT_PROFILE_START_URL = window.ASTRO_BOT_PROFILE_START_URL || 'https://t.me/astro_byrbot?start=webapp_profile';
  const BOT_STARS_URL = window.ASTRO_BOT_STARS_URL || 'https://t.me/astro_byrbot?start=stars';
  const AI_FEATURE_LABELS = {
    tarot_spread: 'Расклады Таро',
    chart_interpret: 'Разбор карты',
    daily_card_interpret: 'Карта дня',
    tarot_single: 'Карты дня',
    ask_fortune: 'Вопросы гадалке'
  };
  const MANA_PACKS_DISPLAY = [
    { stars: 25, mana: 25, label: '25 маны' },
    { stars: 50, mana: 60, label: '60 маны' },
    { stars: 100, mana: 130, label: '130 маны' },
    { stars: 250, mana: 360, label: '360 маны' },
    { stars: 500, mana: 800, label: '800 маны' },
  ];

  function getInitData() {
    if (tg && tg.initData) return tg.initData;
    return "";
  }

  function stableHash32(value) {
    let hash = 2166136261;
    const input = String(value || '');
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function getForecastDayReversed(d) {
    const card = d && d.card ? d.card : {};
    const key = [
      'weekly-forecast-day',
      state.user && state.user.id ? state.user.id : 'anon',
      d && d.dt ? d.dt : '',
      card.name || '',
      card.glyph || ''
    ].join('|');
    return (stableHash32(key) % 100) < 18;
  }

  async function loadAiBalance() {
    const initData = getInitData();
    if (!initData) return;
    try {
      const res = await fetch(`/api/ai-balance?initData=${encodeURIComponent(initData)}`);
      const data = await res.json();
      if (data.ok) {
        if (Array.isArray(data.balance)) {
          state.aiBalance = Object.fromEntries(data.balance.map(b => [b.feature, b]));
          const chartBal = state.aiBalance.chart_interpret;
          if (chartBal && typeof chartBal.remaining === 'number') {
            state.chartAi.remaining = chartBal.remaining;
          }
        }
        if (data.mana && typeof data.mana.total === 'number') {
          state.manaBalance = data.mana;
        }
        renderStarsEntry();
      }
    } catch (e) {
      // ignore: UX не ломается, fallback-limit покажем
    }
  }

  function getFeatureRemaining(feature) {
    const bal = state.aiBalance[feature];
    if (bal && typeof bal.remaining === 'number') return bal.remaining;
    return AI_LIMITS_DISPLAY[feature] ?? null;
  }

  function getHeroRemaining() {
    return getFeatureRemaining('daily_card_interpret');
  }

  const DAILY_CARD_INTERPRET_COST = 7;
  const HOME_ASK_COST = 7;

  function getDailyCardCacheKey(card = state.dailyCard) {
    if (!card || !card.name) return '';
    return `heroAi:${card.name}:${card.reversed ? 'r' : 'u'}:${DATA.todayKey()}`;
  }

  function hasCachedDailyCardInterpret(card = state.dailyCard) {
    const cacheKey = getDailyCardCacheKey(card);
    if (!cacheKey) return false;
    try {
      const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
      return !!(cached && cached.meaning);
    } catch (_) {
      return false;
    }
  }

  function renderDailyCardPriceLabels(card = state.dailyCard) {
    const isCached = hasCachedDailyCardInterpret(card);
    const teaserBtn = $('#dailyCardDeepBtn');
    if (teaserBtn) teaserBtn.textContent = isCached ? 'Уже расшифровано' : `Глубинный разбор · ${DAILY_CARD_INTERPRET_COST} маны`;
    const heroBtn = $('#btnHeroAi');
    if (heroBtn && !heroBtn.classList.contains('is-loading')) {
      let icon = heroBtn.querySelector('.hero-ai-btn-icon');
      heroBtn.innerHTML = '';
      if (!icon) {
        icon = document.createElement('span');
        icon.className = 'hero-ai-btn-icon';
        icon.setAttribute('aria-hidden', 'true');
      }
      icon.textContent = '✨';
      heroBtn.appendChild(icon);
      heroBtn.append(` ${isCached ? 'Уже расшифровано' : `AI-интерпретация · ${DAILY_CARD_INTERPRET_COST} маны`}`);
    }
  }

  function getHomeAskSelection() {
    const active = document.querySelector('[data-home-spread].is-active');
    const spread = active ? active.dataset.homeSpread : 'three';
    const q = ($('#homeAskInput') && $('#homeAskInput').value || '').trim();
    return { question: q, spread };
  }

  function renderHomeAskMeter() {
    const meter = $('#homeAskMeter');
    const price = $('#homeAskPrice');
    if (price) price.textContent = `${HOME_ASK_COST} маны`;
    if (!meter) return;
    const total = state.manaBalance && typeof state.manaBalance.total === 'number' ? state.manaBalance.total : null;
    if (total === null) {
      meter.textContent = `Цена: ${HOME_ASK_COST} маны · баланс загружается…`;
      meter.classList.remove('is-low');
      return;
    }
    const missing = HOME_ASK_COST - total;
    meter.textContent = missing > 0
      ? `Цена: ${HOME_ASK_COST} маны · у тебя ${total}, не хватает ${missing} — пополни Stars перед отправкой`
      : `Цена: ${HOME_ASK_COST} маны · у тебя ${total}, можно гадать`;
    meter.classList.toggle('is-low', missing > 0);
  }

  function openHomeAskFlow(prefill) {
    const flow = $('#homeAskFlow');
    if (!flow) { openGadaniePortal(); return; }
    flow.hidden = false;
    if (prefill) {
      const input = $('#homeAskInput');
      if (input && !input.value.trim()) input.value = prefill;
    }
    renderHomeAskMeter();
    haptic('light');
    requestAnimationFrame(() => {
      try { flow.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
      const input = $('#homeAskInput');
      if (input) input.focus({ preventScroll: true });
    });
  }

  async function submitHomeAskFlow() {
    const { question, spread } = getHomeAskSelection();
    if (question.length < 3) { flashToast('Напишите вопрос хотя бы в пару слов'); openHomeAskFlow(); return; }
    const total = state.manaBalance && typeof state.manaBalance.total === 'number' ? state.manaBalance.total : null;
    if (total !== null && total < HOME_ASK_COST) {
      renderHomeAskMeter();
      flashToast(`Не хватает маны: нужно ${HOME_ASK_COST}`);
      openStarsTopup();
      return;
    }
    closeAllPanels();
    const portal = $('#arcPortal');
    if (portal) portal.hidden = false;
    tileActive('gadanie', true);
    $$('.bottom-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === 'arc'));
    if (window.ArcApp && window.ArcApp.mount) await window.ArcApp.mount();
    if (window.ArcApp && window.ArcApp.quickAsk) window.ArcApp.quickAsk({ question, spread });
    haptic('medium');
    setTimeout(() => {
      const target = document.getElementById('arcMain') || portal;
      try { target.scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (_) {}
    }, 80);
  }

  function renderStarsEntry() {
    const mana = state.manaBalance;
    const packs = (mana && mana.economy && Array.isArray(mana.economy.packs)) ? mana.economy.packs : MANA_PACKS_DISPLAY;
    const packRange = packs.length ? `${packs[0].mana}–${packs[packs.length - 1].mana} маны` : 'пакеты Stars';
    const total = mana && typeof mana.total === 'number' ? mana.total : null;
    const bonus = mana && typeof mana.bonus === 'number' ? mana.bonus : 0;
    const paid = mana && typeof mana.paid === 'number' ? mana.paid : 0;
    const tileText = mana ? `${total} маны · бонус ${bonus}` : 'получи стартовую ману';
    const meta = $('#starsTileMeta');
    if (meta) meta.textContent = tileText;
    const homeMeta = $('#homeManaMeta');
    if (homeMeta) homeMeta.textContent = mana ? `${total} маны сейчас · ${paid} платной` : 'единая валюта для раскладов и сонника';
    const homeSub = $('#homeManaSub');
    if (homeSub) homeSub.textContent = mana ? 'открыть магазин' : packRange;
    const badge = $('#starsCount');
    if (badge) {
      const totalMana = mana && typeof mana.total === 'number' ? mana.total : 0;
      badge.textContent = totalMana > 99 ? '99+' : String(totalMana);
      badge.hidden = !mana;
    }
    const grid = $('#starsBalanceGrid');
    if (grid) {
      if (mana) {
        grid.innerHTML = `
          <div class="stars-balance-card mana-balance-main"><span class="stars-balance-label">Всего маны</span><strong>${mana.total}</strong><span class="stars-balance-sub">тратится на расклады, сонник и совместимость</span></div>
          <div class="stars-balance-card"><span class="stars-balance-label">Бонусная</span><strong>${mana.bonus}</strong><span class="stars-balance-sub">cap ${mana.bonusCap ?? 15}, сгорает</span></div>
          <div class="stars-balance-card"><span class="stars-balance-label">Платная</span><strong>${mana.paid}</strong><span class="stars-balance-sub">не сгорает</span></div>`;
      } else {
        const features = ['tarot_spread', 'chart_interpret', 'daily_card_interpret'];
        grid.innerHTML = features.map((feature) => {
          const bal = state.aiBalance[feature] || {};
          const remaining = getFeatureRemaining(feature);
          const limit = typeof bal.limit === 'number' ? bal.limit : AI_LIMITS_DISPLAY[feature];
          return `<div class="stars-balance-card"><span class="stars-balance-label">${escapeHtml(AI_FEATURE_LABELS[feature])}</span><strong>${remaining ?? '—'}</strong><span class="stars-balance-sub">из ${limit ?? '—'} сегодня</span></div>`;
        }).join('');
      }
    }
    const list = $('#starsPackList');
    if (list) {
      list.innerHTML = packs.map((pack) => `<button type="button" class="stars-pack-row" data-stars-topup><span><strong>${escapeHtml(pack.label || (pack.mana + ' маны'))}</strong><small>пополнение единого баланса</small></span><b>${pack.stars} ⭐</b></button>`).join('');
      list.querySelectorAll('[data-stars-topup]').forEach((btn) => { btn.onclick = openStarsTopup; });
    }
    renderReferralManaCard();
    const topup = $('#btnStarsTopup');
    if (topup) topup.onclick = openStarsTopup;
    const invite = $('#btnInviteMana');
    if (invite) invite.onclick = shareReferralInvite;
  }

  function getReferralCount() {
    const fromApi = state.referralStats && Number(state.referralStats.count);
    if (Number.isFinite(fromApi) && fromApi >= 0) return fromApi;
    const fromUser = state.user && Number(state.user.referral_count ?? state.user.referralCount);
    if (Number.isFinite(fromUser) && fromUser >= 0) return fromUser;
    return null;
  }

  function renderReferralManaCard() {
    const progress = $('#referralManaProgress');
    if (!progress) return;
    const count = getReferralCount();
    progress.textContent = count === null
      ? 'Ссылка готова в Telegram'
      : `Приглашений: ${count} · следующий друг = +10 маны`;
  }

  function getReferralShareUrl() {
    const id = state.user && Number(state.user.id);
    const botLink = Number.isFinite(id) && id > 0
      ? `https://t.me/astro_byrbot?start=ref_${id}`
      : 'https://t.me/astro_byrbot?start=ref_0';
    const text = '🔮 Идём в Гадалку: тебе — стартовая мана на первые расклады, мне — +10 маны за приглашение. Карта дня, Таро и натальная карта внутри ✨';
    return `https://t.me/share/url?url=${encodeURIComponent(botLink)}&text=${encodeURIComponent(text)}`;
  }

  function shareReferralInvite() {
    const url = getReferralShareUrl();
    if (!url) {
      flashToast('Откройте Mini App из Telegram, чтобы получить ссылку');
      return;
    }
    if (tg && tg.openTelegramLink) {
      try { tg.openTelegramLink(url); return; } catch (e) {}
    }
    if (tg && tg.openLink) {
      try { tg.openLink(url); return; } catch (e) {}
    }
    window.open(url, '_blank', 'noopener');
  }

  function updateManaBalance(data) {
    if (data && data.mana && typeof data.mana.total === 'number') {
      state.manaBalance = data.mana;
      if (data.referral && typeof data.referral.count === 'number') state.referralStats = data.referral;
      renderStarsEntry();
    }
  }

  async function claimDailyManaCheckin() {
    const btn = $('#dailyManaCheckinBtn');
    const saved = $('#dailyJournalSaved');
    const initData = getInitData();
    if (!initData) {
      flashToast('Откройте Mini App из бота, чтобы получить ману');
      return;
    }
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/mana/checkin?initData=' + encodeURIComponent(initData), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'daily_checkin' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.message || data.error || 'fail');
      updateManaBalance(data);
      markDailyCheckin(data.claimed ? 'claimed' : 'already');
      if (saved) saved.textContent = data.claimed ? '+1 мана начислена' : 'мана за сегодня уже получена';
      flashToast(data.message || (data.claimed ? '+1 мана' : 'Уже получено'));
    } catch (e) {
      if (saved) saved.textContent = 'не удалось начислить ману';
      flashToast('Не удалось начислить ману');
    } finally {
      setTimeout(() => {
        if (btn) btn.disabled = false;
        renderDailyJournal(false);
      }, 600);
    }
  }

  function updateFeatureBalance(feature, data) {
    updateManaBalance(data);
    if (!data || typeof data.remaining !== 'number') return;
    const bal = state.aiBalance[feature] || { feature, limit: AI_LIMITS_DISPLAY[feature] || 0, used: 0, paid: 0 };
    bal.remaining = data.remaining;
    if (typeof data.resetAt === 'number') bal.resetAt = data.resetAt;
    state.aiBalance[feature] = bal;
  }

  function renderAiBadge(feature, selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    const remaining = getFeatureRemaining(feature);
    const isLow = typeof remaining === "number" && remaining <= 1;
    el.innerHTML = `<span class="ai-badge ${isLow ? 'is-low' : ''}">Осталось сегодня: ${remaining ?? '—'}</span>`;
    el.hidden = false;
  }

  function renderAiTopup(feature, selector) {
    const el = document.querySelector(selector);
    if (!el) return;
    const bal = state.aiBalance[feature];
    if (!bal || bal.remaining > 0) {
      el.innerHTML = "";
      return;
    }
    el.innerHTML = `<div class="ai-limit-box">
      <p>Лимит на сегодня исчерпан. Сброс в полночь UTC.</p>
      <button type="button" class="btn btn-gold" data-stars-topup>Докупить за Stars</button>
    </div>`;
    const btn = el.querySelector('[data-stars-topup]');
    if (btn) btn.onclick = openStarsTopup;
  }

  function homeGreetingForProfile() {
    const profileName = (state.profile && (state.profile.firstName || (!state.profile.lastName ? state.profile.name : '')) || '')
      .trim()
      .split(/\s+/)[0];
    const hour = new Date().getHours();
    let greeting = 'Добро пожаловать';
    if (hour >= 5 && hour < 12) greeting = 'Доброе утро';
    else if (hour >= 12 && hour < 18) greeting = 'Добрый день';
    else if (hour >= 18 && hour < 23) greeting = 'Добрый вечер';
    else greeting = 'Доброй ночи';
    return profileName ? `${greeting}, ${profileName}` : greeting;
  }

  function renderHomeHeader() {
    const label = $('#dateLabel');
    if (label) label.textContent = homeGreetingForProfile();
  }

  function setProfile(p) {
    state.profile = enrichProfile(p);
    Evening.saveProfile(p);
    renderHomeHeader();
  }

  function isUserNotStartedBot(data) {
    return data && (data.reason === 'user_not_started_bot' || data.error === 'user_not_started_bot');
  }

  function setProfileSyncWarning(on) {
    state.profileSync.userNotStartedBot = !!on;
  }

  // Подтягивает профиль из бэкенда (заполненный в боте) и мержит с localStorage.
  // Бэкенд-профиль приоритетнее: если в боте заполнена дата рождения — она выигрывает.
  async function loadProfileFromBackend() {
    const initData = getInitData();
    if (!initData) return;
    try {
      const res = await fetch('/api/profile?initData=' + encodeURIComponent(initData));
      const data = await res.json().catch(() => ({ ok: false }));
      if (isUserNotStartedBot(data)) {
        setProfileSyncWarning(true);
        return;
      }
      if (!data.ok) return;
      if (!data.profile) {
        setProfileSyncWarning(false);
        return;
      }
      setProfileSyncWarning(false);
      const bp = data.profile; // backend profile
      const lp = Evening.loadProfile() || {}; // localStorage profile
      // Мерж: бэкенд-поля приоритетнее, но localStorage может иметь несохранённые правки
      const merged = { ...lp, ...bp };
      // Конвертируем birthDate (YYYY-MM-DD) в birthYear/birthMonth/birthDay для совместимости
      if (bp.birthDate && typeof bp.birthDate === 'string') {
        const [y, m, d] = bp.birthDate.split('-').map(Number);
        if (y && m && d) {
          merged.birthYear = y;
          merged.birthMonth = m;
          merged.birthDay = d;
        }
      }
      setProfile(merged);
    } catch (e) {
      // молча — нет сети или бэкенд не ответил, работаем с localStorage
    }
  }

  function getWebAppStartParam() {
    const unsafeParam = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
    if (unsafeParam) return unsafeParam;

    // Telegram may preserve WebApp button query params in location.href even when
    // initDataUnsafe.start_param is empty. Also support the official t.me app
    // deep-link param name used by Mini Apps.
    try {
      const params = new URLSearchParams(window.location.search || '');
      return params.get('startapp') || params.get('tgWebAppStartParam') || params.get('start_param') || '';
    } catch (_) {
      return '';
    }
  }

  function parseUser() {
    const startParam = getWebAppStartParam();
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      const u = tg.initDataUnsafe.user;
      return { id: u.id, name: u.first_name || 'друг', username: u.username || null, photo: u.photo_url || null, startParam };
    }
    // Dev fallback (открыли в браузере напрямую)
    return { id: 0, name: 'друг', username: null, photo: null, startParam };
  }

  // -- Compat deep-link -------------------------------------
  // /start compat_<tgId> → startParam = "compat_123" → compatTgId = 123
  function parseCompatStartParam() {
    const sp = (state.user.startParam || '').toLowerCase();
    if (!sp.startsWith('compat_')) return null;
    const n = Number(sp.slice('compat_'.length));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const COMPAT_CATEGORY_LABEL = {
    excellent:   'Исключительная',
    good:        'Хорошая',
    average:     'Неплохая',
    challenging: 'Непростая',
    difficult:   'Сложная',
  };
  const COMPAT_CATEGORY_GLYPH = {
    excellent: '✨', good: '🌟', average: '🌙', challenging: '🌒', difficult: '☁',
  };

  // -- DOM refs ---------------------------------------------
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // -- Init -------------------------------------------------
  async function init() {
    // Mini App всегда открывается внутри Telegram — landing gate убран.
    // tg.initData и tg.initDataUnsafe всегда доступны в WebView.
    renderHomeHeader();
    $('#loadedAt').textContent   = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    renderUser();
    await loadProfileFromBackend(); // подтянуть профиль из бота
    await loadBackendChart(); // подтянуть настоящую сохранённую карту из бэкенда
    renderTarot();
    renderBiorhythmTile();
    renderProfile();
    renderHomeProfileState();
    renderStarsEntry();
    await loadAiBalance();
    await loadMoonToday();
    wireEvents();
    wireBottomTabs();
    wireHeroFlip();
    wireHistoryReadingModal();
    wireHistorySearch();
    await refreshHistoryFromBackend();
    updateHistoryBadge();
    if (state.user.startParam === 'mychart') {
      setTimeout(openChartPanel, 50);
    }

    // Moon card deep-link from /moon: startapp=moon_YYYY-MM-DD
    if (state.user.startParam && state.user.startParam.startsWith('moon_')) {
      const m = /^moon_(\d{4})-(\d{2})-(\d{2})$/.exec(state.user.startParam);
      if (m) {
        state.moonSelectedDate = `${m[1]}-${m[2]}-${m[3]}`;
      }
    }

    // Compat deep-link: /start compat_<tgId>
    const compatTgId = parseCompatStartParam();
    if (compatTgId) {
      setTimeout(() => openCompatPanel(compatTgId), 50);
    }
  }

  // -- Gadanie (arc portal) ---------------------------------
  async function openGadaniePortal() {
    closeAllPanels();
    const portal = $('#arcPortal');
    if (!portal) return;
    portal.hidden = false;
    tileActive('gadanie', true);
    // Синхронизировать bottom-tabs (если юзер пришёл через quick-tile)
    $$('.bottom-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === 'arc'));
    if (window.ArcApp && window.ArcApp.mount) {
      await window.ArcApp.mount();
    }
    haptic('medium');
    // На мобиле ведём сразу к рабочей зоне, без длинного hero/каталога сверху.
    setTimeout(() => {
      const target = document.getElementById('arcMain') || portal;
      try { target.scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (_) {}
    }, 80);
  }

  function closeGadaniePortal() {
    const portal = $('#arcPortal');
    if (!portal) return;
    if (window.ArcApp && window.ArcApp.unmount) window.ArcApp.unmount();
    portal.hidden = true;
    tileActive('gadanie', false);
    // Вернуть подсветку на home в bottom-tabs
    $$('.bottom-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === 'home'));
    haptic('light');
  }

  // -- User chip --------------------------------------------
  function renderUser() {
    const el = $('#userChip');
    if (state.user.photo) {
      el.innerHTML = `<img src="${escapeHtml(state.user.photo)}" alt="">`;
    } else {
      $('#userAvatar').textContent = (state.user.name[0] || '⚜').toUpperCase();
    }
  }

  // -- Tarot Daily ------------------------------------------
  // Стихийные SVG-иконки для glyph (без эмодзи — кросс-платформенно)
  const ELEMENT_SVG = {
    'fire': '<svg viewBox="0 0 32 32" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 28c5 0 8-3.5 8-8 0-3-1.5-5-3-7-1-1.2-1.5-2.5-1.5-4 0-1.5 0.5-2.8 1-3.5-1 0.5-2.5 1.8-3.5 4-1.2 2.7-1 5-1 5s-1.5-1-2-2.5c-0.5 2 0 4 1 5.5-2-0.5-3.5-2-4-3.5-0.5 2 0 5 2 7-2 0-3.5-1.5-4-3 0 4.5 3 10 7 10z" fill="currentColor" fill-opacity="0.3"/></svg>',
    'water': '<svg viewBox="0 0 32 32" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4 C 10 12, 6 18, 6 22 a 10 10 0 0 0 20 0 C 26 18, 22 12, 16 4 z" fill="currentColor" fill-opacity="0.25"/><path d="M10 22 a 3 3 0 0 0 3 3" stroke-opacity="0.6"/></svg>',
    'air': '<svg viewBox="0 0 32 32" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10h14a3 3 0 1 0-3-3"/><path d="M4 16h20a3 3 0 1 1-3 3"/><path d="M4 22h12a3 3 0 1 1-3 3"/></svg>',
    'earth': '<svg viewBox="0 0 32 32" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="16" cy="16" r="11" fill="currentColor" fill-opacity="0.25"/><path d="M5 16h22M16 5c4 3 6 7 6 11s-2 8-6 11c-4-3-6-7-6-11s2-8 6-11z"/></svg>',
    'major': '<svg viewBox="0 0 32 32" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4 L 19 13 L 28 13 L 21 19 L 24 28 L 16 22 L 8 28 L 11 19 L 4 13 L 13 13 Z" fill="currentColor" fill-opacity="0.3"/></svg>'
  };
  function elementForCard(c) {
    if (c.kind === 'major') return 'major';
    if (!c.suit) return 'major';
    const s = c.suit.toLowerCase();
    if (s.includes('wand') || s.includes('жезл')) return 'fire';
    if (s.includes('cup')  || s.includes('кубк')) return 'water';
    if (s.includes('sword')|| s.includes('меч')) return 'air';
    if (s.includes('pent') || s.includes('пентакл')) return 'earth';
    return 'major';
  }
  function renderTarot() {
    const tgId = state.user.id || 1; // dev fallback
    const date = DATA.todayKey();
    const c = TarotDaily.calc(tgId, date);
    // Заполняем лицо flip-карты (новая разметка: #heroTarotCard > .tarot-card-inner)
    state.dailyCard = c; // для AI-расшифровки
    renderDailyCardTeaser(c);
    const imgEl    = $('#heroImg');
    const nameEl   = $('#heroName');
    const moodEl   = $('#heroMood');
    const textEl   = $('#heroText');
    const meanEl   = $('#heroMeaning');
    const revEl    = $('#heroRev');
    const elemEl   = $('#heroElement');
    if (imgEl) {
      // Реальная JPG Rider-Waite-Smith вместо unicode-глифа
      imgEl.src = DATA.imageFor(c);
      imgEl.alt = c.name || 'Карта таро';
    }
    if (nameEl) nameEl.textContent = c.name || '';
    if (moodEl) moodEl.textContent = c.mood || '';
    // «Суть» карты = upright (мистическое описание) — над «Советом дня» (advice)
    if (meanEl) meanEl.textContent = c.upright || c.mood || '';
    if (textEl) textEl.textContent = c.advice || '';
    if (revEl) {
      revEl.hidden = !c.reversed;
    }
    // Стихия-чип для минорных арканов (по `suit`); для старших не показываем
    if (elemEl) {
      if (c.kind === 'minor' && c.suit) {
        const ELEMENT_LABEL = {
          wands:     '🔥 Огонь',
          cups:      '💧 Вода',
          swords:    '💨 Воздух',
          pentacles: '🌍 Земля'
        };
        elemEl.textContent = ELEMENT_LABEL[c.suit] || '';
        elemEl.dataset.element = c.suit;
        elemEl.hidden = false;
      } else {
        elemEl.hidden = true;
      }
    }
    const hd = $('#heroDate');
    if (hd) hd.textContent = DATA.dateLabel();
    // Полная расшифровка (длинный текст по карте; в TarotDaily на data.js)
    const readEl = $('#heroReading');
    const readBlock = $('#heroReadingBlock');
    if (readEl) {
      const longText = c.reading || c.advice || c.upright || '';
      // Конвертим абзацы (\n\n) в <p>; одиночные \n в <br> внутри абзаца
      const html = String(longText)
        .split(/\n\s*\n/)
        .map(p => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('');
      readEl.innerHTML = html;
    }
    if (readBlock) {
      // Каждый раз сбрасываем в закрытое при ре-рендере новой карты
      readBlock.hidden = true;
      const tg = $('#btnReadingToggle');
      if (tg) tg.setAttribute('aria-expanded', 'false');
    }
    // Авто-флип на 400мс (даём глазам поймать рубашку)
    const card = $('#heroTarotCard');
    if (card) {
      card.dataset.state = 'back';
      // Двойной rAF: гарантируем, что back реально отрисовался, потом flip
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setTimeout(() => { card.dataset.state = 'flipped'; }, 350);
      }));
    }
    renderDailyJournal();
  }

  function renderDailyCardTeaser(c) {
    const box = $('#dailyCardTeaser');
    if (!box || !c) return;
    const img = $('#dailyCardTeaserImg');
    const glyph = $('#dailyCardTeaserGlyph');
    if (img) {
      img.src = DATA.imageFor(c);
      img.alt = c.name || 'Карта дня';
      img.hidden = false;
    }
    if (glyph) glyph.hidden = true;
    const title = $('#dailyCardTeaserTitle');
    const meaning = $('#dailyCardTeaserMeaning');
    if (title) title.textContent = c.name || 'Сегодняшний знак';
    if (meaning) meaning.textContent = c.upright || c.advice || c.mood || 'Карта дня готова — открой разбор, чтобы понять её подсказку.';
    renderDailyCardPriceLabels(c);
  }

  function openDailyCardDeepDive() {
    const hero = $('#heroCard');
    const toggle = $('#btnReadingToggle');
    try { hero?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
    if (toggle && toggle.getAttribute('aria-expanded') !== 'true') {
      setTimeout(() => toggle.click(), 180);
    }
    setTimeout(() => { try { $('#btnHeroAi')?.focus({ preventScroll: true }); } catch (_) {} }, 260);
    haptic('light');
  }

  // -- Daily journal / retention ----------------------------
  const DAILY_JOURNAL_KEY = 'dailyJournal:v1';
  const OUTCOME_LABELS = { hit: 'сбылось', partial: 'частично', miss: 'не про меня' };

  function loadDailyJournal() {
    try { return JSON.parse(localStorage.getItem(DAILY_JOURNAL_KEY) || '{}') || {}; } catch { return {}; }
  }

  function saveDailyJournal(data) {
    try { localStorage.setItem(DAILY_JOURNAL_KEY, JSON.stringify(data)); } catch {}
  }

  function todayJournalEntry() {
    const date = DATA.todayKey();
    const data = loadDailyJournal();
    if (!data[date]) data[date] = {};
    const c = state.dailyCard || {};
    data[date] = {
      ...data[date],
      date,
      card: c.name || data[date].card || '',
      mood: c.mood || data[date].mood || '',
      suit: c.suit || data[date].suit || '',
      kind: c.kind || data[date].kind || '',
    };
    saveDailyJournal(data);
    return data[date];
  }

  function setDailyOutcome(outcome) {
    const date = DATA.todayKey();
    const data = loadDailyJournal();
    const c = state.dailyCard || {};
    data[date] = {
      ...(data[date] || {}),
      date,
      outcome,
      card: c.name || '',
      mood: c.mood || '',
      suit: c.suit || '',
      kind: c.kind || '',
      ts: Date.now(),
    };
    saveDailyJournal(data);
    renderDailyJournal();
    flashToast(outcome === 'hit' ? 'Записала: карта попала' : outcome === 'partial' ? 'Записала: частично' : 'Записала: сегодня не попало');
    haptic('selection');
  }

  function setDailyNote(note) {
    const date = DATA.todayKey();
    const data = loadDailyJournal();
    data[date] = { ...(data[date] || todayJournalEntry()), note: String(note || '').slice(0, 420), ts: Date.now() };
    saveDailyJournal(data);
    renderDailyJournal(false);
  }

  function dailyJournalExcerpt(note) {
    const clean = String(note || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= 200) return clean;
    return clean.slice(0, 197).trimEnd() + '…';
  }

  function updateDailyJournalShare(entry = todayJournalEntry()) {
    const btn = $('#dailyJournalShare');
    if (!btn) return;
    const hasNote = !!dailyJournalExcerpt(entry.note);
    btn.hidden = !hasNote;
    btn.disabled = !hasNote;
  }

  function shareDailyJournalNote() {
    const entry = todayJournalEntry();
    const excerpt = dailyJournalExcerpt(entry.note);
    if (!excerpt) {
      flashToast('Сначала сохраните заметку');
      updateDailyJournalShare(entry);
      return;
    }
    const card = entry.card || state.dailyCard?.name || 'Карта дня';
    const mood = entry.mood || state.dailyCard?.mood || 'настрой дня';
    const shareUrl = window.location.origin ? `${window.location.origin}/` : 'https://astro.burlab-api.site/';
    const text = `🔮 Моя карта дня — ${card}\nНастрой: ${mood}\nЗаметка: ${excerpt}\n\nОткрой свою карту дня в Гадалке:`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(text)}`;
    if (tg && tg.openTelegramLink) {
      try { tg.openTelegramLink(url); haptic('light'); return; } catch (e) {}
    }
    if (tg && tg.openLink) {
      try { tg.openLink(url); haptic('light'); return; } catch (e) {}
    }
    window.open(url, '_blank', 'noopener');
  }

  function dateKeyFromOffset(offset) {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - offset);
    return d.toISOString().slice(0, 10);
  }

  function markDailyCheckin(status) {
    const date = DATA.todayKey();
    const data = loadDailyJournal();
    const entry = todayJournalEntry();
    data[date] = { ...entry, checkin: status || 'claimed', checkinTs: Date.now(), ts: Date.now() };
    saveDailyJournal(data);
    renderDailyJournal(false);
  }

  function dailyCheckinStreak(data = loadDailyJournal()) {
    let streak = 0;
    for (let i = 0; i < 60; i += 1) {
      const entry = data[dateKeyFromOffset(i)];
      if (!entry || !entry.checkin) break;
      streak += 1;
    }
    return streak;
  }

  function pluralJournalDays(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'день';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня';
    return 'дней';
  }

  function renderDailyRitual(entry, data) {
    const streak = dailyCheckinStreak(data);
    const checked = !!entry.checkin;
    const streakEl = $('#dailyRitualStreak');
    const subEl = $('#dailyRitualSub');
    const btn = $('#dailyManaCheckinBtn');
    if (streakEl) streakEl.textContent = `Серия: ${streak} ${pluralJournalDays(streak)}`;
    if (subEl) subEl.textContent = checked ? 'Сегодня уже получено' : 'Ежедневная награда для раскладов';
    if (btn) {
      btn.textContent = checked ? 'Получено сегодня' : 'Получить +1 ману';
      btn.classList.toggle('is-done', checked);
    }

  }

  function weeklyJournalSummary(data = loadDailyJournal()) {
    const items = Object.values(data)
      .filter(x => x && x.date)
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 7);
    if (!items.length) return 'Недельная сводка появится после первых отметок.';
    const total = items.length;
    const checkins = items.filter(x => x.checkin).length;
    const streak = dailyCheckinStreak(data);
    const hits = items.filter(x => x.outcome === 'hit').length;
    const partial = items.filter(x => x.outcome === 'partial').length;
    const suits = items.reduce((m, x) => { const k = x.suit || x.kind || 'major'; m[k] = (m[k] || 0) + 1; return m; }, {});
    const top = Object.entries(suits).sort((a, b) => b[1] - a[1])[0];
    const suitLabel = { wands: 'действие и энергия', cups: 'чувства и отношения', swords: 'мысли и решения', pentacles: 'деньги и тело', major: 'важный поворот' }[top?.[0]] || 'личная тема';
    const accuracy = hits + partial ? `${hits} точных · ${partial} частично` : 'пока без итогов';
    return `Итог недели: ${checkins}/${total} отметок, серия ${streak}. ${accuracy}. Главная тема — ${suitLabel}.`;
  }

  function renderDailyJournalHistory() {
    const host = $('#dailyJournalHistory');
    if (!host) return;
    const data = loadDailyJournal();
    const items = Object.values(data)
      .filter(x => x && x.date && (x.note || x.outcome || x.card))
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .slice(0, 12);
    if (!items.length) {
      host.innerHTML = '<div class="daily-journal-empty">Пока нет сохранённых заметок. Сохраните сегодняшнюю — она появится здесь.</div>';
      return;
    }
    host.innerHTML = items.map((x) => {
      const outcome = x.outcome ? `<span class="daily-journal-entry-outcome">${OUTCOME_LABELS[x.outcome] || x.outcome}</span>` : '<span class="daily-journal-entry-outcome is-muted">итог не отмечен</span>';
      const note = x.note ? `<p>${escapeHtml(x.note)}</p>` : '<p class="is-muted">Без заметки</p>';
      return `<article class="daily-journal-entry">
        <div class="daily-journal-entry-head"><strong>${escapeHtml(x.date)}</strong>${outcome}</div>
        <div class="daily-journal-entry-card">${escapeHtml(x.card || 'Карта дня')}</div>
        ${note}
      </article>`;
    }).join('');
  }

  function toggleDailyJournalHistory(forceOpen) {
    const host = $('#dailyJournalHistory');
    if (!host) return;
    const willOpen = typeof forceOpen === 'boolean' ? forceOpen : host.hidden;
    if (willOpen) renderDailyJournalHistory();
    host.hidden = !willOpen;
    if (willOpen) {
      try { host.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (_) {}
    }
  }

  function openDailyJournal() {
    const box = $('#dailyJournal');
    if (!box) return;
    try { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
    toggleDailyJournalHistory(true);
  }

  function renderDailyJournal(updateNote = true) {
    const box = $('#dailyJournal');
    if (!box) return;
    const entry = todayJournalEntry();
    const data = loadDailyJournal();
    const status = $('#dailyJournalStatus');
    if (status) status.textContent = entry.checkin ? '+1 мана получена' : 'можно забрать +1';
    renderDailyRitual(entry, data);
    box.querySelectorAll('[data-daily-outcome]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.dailyOutcome === entry.outcome);
    });
    const note = $('#dailyJournalNote');
    if (note && updateNote) note.value = entry.note || '';
    updateDailyJournalShare(entry);
    const week = $('#dailyJournalWeek');
    if (week) week.textContent = weeklyJournalSummary(data);
    const hist = $('#dailyJournalHistory');
    if (hist && !hist.hidden) renderDailyJournalHistory();
  }

  // -- Biorhythm tile (summary) ----------------------------
  function renderBiorhythmTile() {
    const el = $('#bioToday');
    if (!el) return;
    if (!state.profile || !state.profile.birthYear) {
      el.textContent = 'заполни профиль →';
      el.classList.add('is-cta');
      $('#tileBiorhythm').classList.add('is-empty');
      return;
    }
    el.classList.remove('is-cta');
    $('#tileBiorhythm').classList.remove('is-empty');
    const r = Biorhythm.calc(state.profile.birthYear, state.profile.birthMonth, state.profile.birthDay);
    const avg = Math.round((r.physical.value + r.emotional.value + r.intellectual.value) / 3 * 100);
    const arrow = avg > 0 ? '↗' : avg < 0 ? '↘' : '·';
    el.textContent = `сегодня ${arrow} ${Math.abs(avg)}%`;
  }

  // Умный клик по «Биоритмы» — если профиля нет, сразу ведём заполнять
  function tileBiorhythmClick() {
    if (!state.profile || !state.profile.birthYear) {
      openProfilePanel();
      return;
    }
    openBiorhythmPanel();
  }

  // -- Bio tile (summary) -----------------------------------
  function renderBioTile() {
    const el = $('#bioToday');
    if (!el) return;
    try {
      const profile = JSON.parse(localStorage.getItem('arProfile') || 'null');
      if (profile && profile.birthDate) {
        el.textContent = 'готово';
      } else {
        el.textContent = 'заполните';
      }
    } catch { el.textContent = '—'; }
  }

  // -- Evenin g tile removed --------------------------------
  function _renderEveningRemoved() { /* noop */ }

  // -- Biorhythm panel -------------------------------------
  function openBiorhythmPanel() {
    closeAllPanels();
    const panel = $('#panelBiorhythm');
    panel.hidden = false;
    tileActive('biorhythm', true);

    if (!state.profile || !state.profile.birthYear) {
      $('#bioContent').innerHTML = '<div class="bio-empty"><p>Нужен день рождения для расчёта.</p><button type="button" class="btn btn-primary bio-cta" id="bioCtaOpenProfile">Заполнить профиль →</button></div>';
      const cta = $('#bioCtaOpenProfile');
      if (cta) cta.onclick = openProfilePanel;
      try { panel.scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (_) {}
      return;
    }
    const r = Biorhythm.calc(state.profile.birthYear, state.profile.birthMonth, state.profile.birthDay);
    $('#bioContent').innerHTML = renderBiorhythm(r);
    haptic('light');
  }

  function renderBiorhythm(r) {
    const cycle = (c, label, hint) => {
      const pct = r[c].percent;
      const leftPct = pct >= 0 ? 50 : 50 + pct / 2;
      const widthPct = Math.abs(pct) / 2;
      const advice = r[c].advice;
      return `
        <div class="bio-cycle">
          <div class="bio-cycle-head">
            <span class="bio-cycle-name">${label} <span style="color:var(--ink-mute);font-size:12px;">${hint}</span></span>
            <span class="bio-cycle-value">${r[c].emoji} ${pct > 0 ? '+' : ''}${pct}%</span>
          </div>
          <div class="bio-bar">
            <div class="bio-bar-fill" style="left:${leftPct}%;width:${widthPct}%;"></div>
            <div class="bio-bar-center"></div>
          </div>
          <div class="bio-cycle-head" style="font-size:12px;color:var(--ink-mute);">
            <span>${r[c].phase}</span>
            <span>${advice}</span>
          </div>
        </div>`;
    };

    const recs = r.recommendations.length
      ? `<ul class="bio-recs">${r.recommendations.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>`
      : '';

    return `
      ${cycle('physical',     'Физический',     '23 д.')}
      ${cycle('emotional',    'Эмоциональный',  '28 д.')}
      ${cycle('intellectual', 'Интеллектуальный','33 д.')}
      <div class="bio-overall">${r.overall}</div>
      ${recs}
      <div class="bio-tomorrow">
        Завтра: физ ${r.tomorrow.physical > 0 ? '+' : ''}${r.tomorrow.physical}% ·
        эмо ${r.tomorrow.emotional > 0 ? '+' : ''}${r.tomorrow.emotional}% ·
        инт ${r.tomorrow.intellectual > 0 ? '+' : ''}${r.tomorrow.intellectual}%
        <br>${r.tomorrow.overall}
      </div>`;
  }

  function fmtMoonDate(d) {
    if (!d) return '';
    return `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}`;
  }

  function moonAdvice(entry) {
    const fav = String(entry?.favorable || '').replace(/^[^А-Яа-яA-Za-z]+\s*/, '');
    if (fav) return fav;
    return entry?.moon_day_desc || entry?.moon_phase_desc || 'Доверься интуиции и не спеши с резкими решениями.';
  }

  async function loadMoonToday() {
    try {
      let res = await fetch('/api/moon/today?days=30');
      if (state.moonSelectedDate) {
        res = await fetch('/api/moon/today?date=' + state.moonSelectedDate + '&days=30');
      }
      let data = await res.json().catch(() => ({ ok: false }));
      if ((!res.ok || !data.ok) && data.error === 'not found') {
        res = await fetch('/api/arc/daily?days=30');
        data = await res.json().catch(() => ({ ok: false }));
      }
      if (!data.ok || !data.today) throw new Error(data.error || 'moon');
      state.moon = data;
      renderMoonCard(data);
      renderMoonMonth(data);
    } catch (_) {
      const title = $('#moonCardTitle');
      const advice = $('#moonCardAdvice');
      const meta = $('#moonCardMeta');
      if (title) title.textContent = 'Луна скрылась за облаками';
      if (advice) advice.textContent = 'Открой позже — календарь обновится автоматически.';
      if (meta) meta.textContent = 'API временно недоступен';
    }
  }

  function renderMoonCard(data) {
    const e = data.today || {};
    const title = $('#moonCardTitle');
    const advice = $('#moonCardAdvice');
    const meta = $('#moonCardMeta');
    const tile = $('#moonTileMeta');
    const orb = $('#moonOrb');
    if (title) title.textContent = `${e.moon_phase || 'Фаза Луны'} · ${e.moon_sign_emoji || '♋'} ${e.moon_sign_ru || ''}`.trim();
    if (advice) advice.textContent = moonAdvice(e);
    if (meta) meta.textContent = `${e.moon_day || '—'} лунный день · ${Math.round(e.moon_phase_angle || 0)}° · ${fmtMoonDate(e.date)}`;
    if (tile) tile.textContent = `${e.moon_sign_emoji || '🌙'} ${e.moon_day || '—'} день`;
    if (orb) orb.textContent = (e.moon_phase || '').includes('Полн') ? '○' : ((e.moon_phase || '').includes('Нов') ? '●' : '☾');
  }

  function buildMoonShareText(entry) {
    const e = entry || (state.moon && state.moon.today) || {};
    const sign = `${e.moon_sign_emoji || '🌙'} ${e.moon_sign_ru || ''}`.trim();
    const day = e.moon_day ? `${e.moon_day} лунный день` : 'лунный день';
    const phase = e.moon_phase || 'Лунный ритм';
    const advice = moonAdvice(e);
    return `Сегодня Луна в ${sign}: ${phase}, ${day}. ${advice} — Гадалка`;
  }

  function shareMoonCard() {
    const text = buildMoonShareText();
    const shareUrl = 'https://t.me/astro_byrbot';
    const t = window.TelegramApp && window.TelegramApp.tg;
    if (t && typeof t.shareText === 'function') {
      try { t.shareText(text); haptic('light'); return; } catch (e) {}
    }
    const tgShareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(shareUrl) + '&text=' + encodeURIComponent(text);
    if (t && t.openTelegramLink) {
      try { t.openTelegramLink(tgShareUrl); haptic('light'); return; } catch (e) {}
    }
    if (t && t.openLink) {
      try { t.openLink(tgShareUrl); haptic('light'); return; } catch (e) {}
    }
    if (navigator.share) {
      try { navigator.share({ title: 'Луна сегодня — Гадалка', text, url: shareUrl }).catch(() => {}); haptic('light'); return; } catch (e) {}
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text + '\n' + shareUrl).then(() => flashToast('Лунный совет скопирован'));
    } else {
      flashToast('Шаринг недоступен');
    }
  }

  function renderMoonMonth(data) {
    const host = $('#moonMonthContent');
    if (!host) return;
    const e = data.today || {};
    const phases = Array.isArray(data.moon_phases) ? data.moon_phases.slice(0, 6) : [];
    const signs = Array.isArray(data.moon_sign_changes) ? data.moon_sign_changes.slice(0, 8) : [];
    const week = Array.isArray(data.daily) ? data.daily.slice(0, 7) : [];
    host.innerHTML = `
      <article class="moon-detail-today">
        <div class="moon-detail-orb">${e.moon_sign_emoji || '🌙'}</div>
        <div><div class="moon-detail-kicker">Сегодня · ${fmtMoonDate(e.date)}</div>
        <h3>${escapeHtml(e.moon_phase || 'Лунный день')}</h3>
        <p>${escapeHtml(e.moon_phase_desc || moonAdvice(e))}</p></div>
      </article>
      <div class="moon-mini-grid">
        <div><span>Знак</span><strong>${escapeHtml((e.moon_sign_emoji || '') + ' ' + (e.moon_sign_ru || '—'))}</strong></div>
        <div><span>Лунный день</span><strong>${escapeHtml(String(e.moon_day || '—'))}/29</strong></div>
      </div>
      <h3 class="moon-section-title">Ближайшие фазы</h3>
      <ul class="moon-list">${phases.map(ph => `<li><span>${fmtMoonDate(ph.date)}</span><strong>${escapeHtml(ph.phase_name || '')}</strong></li>`).join('') || '<li><span>—</span><strong>В этом окне точных фаз нет</strong></li>'}</ul>
      <h3 class="moon-section-title">Смена знака</h3>
      <ul class="moon-list">${signs.map(ch => `<li><span>${fmtMoonDate(ch.date)}</span><strong>${escapeHtml((ch.sign_emoji || '') + ' ' + (ch.sign_ru || ''))}</strong></li>`).join('')}</ul>
      <h3 class="moon-section-title">7 дней</h3>
      <ul class="moon-list moon-week">${week.map(d => `<li><span>${fmtMoonDate(d.date)}</span><strong>${escapeHtml((d.moon_sign_emoji || '') + ' ' + (d.moon_phase || ''))}</strong></li>`).join('')}</ul>`;
  }

  function openMoonPanel() {
    closeAllPanels();
    const p = $('#panelMoon');
    if (p) p.hidden = false;
    tileActive('moon', true);
    if (state.moon) renderMoonMonth(state.moon); else loadMoonToday();
    haptic('light');
    try { p && p.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  }

  // -- Forecast panel (7-day astro forecast from backend) --
  function openForecastPanel() {
    closeAllPanels();
    $('#panelForecast').hidden = false;
    tileActive('forecast', true);
    haptic('light');
    const cta = $('#forecastCtaOpenProfile');
    if (cta) cta.onclick = openProfilePanel;
    loadWeekForecast();
    try { $('#panelForecast').scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (_) {}
  }

  function renderForecastCta(list, empty, type) {
    if (empty) empty.hidden = true;
    const cfg = type === 'user_not_started_bot'
      ? {
          title: 'Сначала запусти бота',
          text: 'Так мы сохраним твой профиль и сможем считать персональные прогнозы.',
          label: 'Запустить бота',
          action: openProfileStartBot
        }
      : {
          title: 'Нужен профиль для прогноза',
          text: 'Заполни дату рождения и место — недельный прогноз станет персональным.',
          label: 'Заполнить профиль',
          action: openProfilePanel
        };
    list.hidden = false;
    list.innerHTML = `<li class="forecast-item forecast-text" style="display:block;padding:16px;line-height:1.6">
      <strong>${escapeHtml(cfg.title)}</strong>
      <p style="margin:8px 0 12px;color:var(--ink-mute)">${escapeHtml(cfg.text)}</p>
      <button type="button" class="btn btn-primary" data-forecast-cta>${escapeHtml(cfg.label)}</button>
    </li>`;
    const btn = list.querySelector('[data-forecast-cta]');
    if (btn) btn.onclick = cfg.action;
  }

  async function loadWeekForecast() {
    const list = $('#forecastList');
    const content = $('#forecastContent');
    const empty = content ? content.querySelector('#forecastEmpty') : null;
    if (!list || !content) return;

    // Показываем лоадер
    list.innerHTML = '<li class="forecast-item" style="justify-content:center;color:var(--ink-mute)">⏳ Загружаем прогноз...</li>';
    list.hidden = false;
    if (empty) empty.hidden = true;

    const initData = getInitData();
    if (!initData) {
      renderForecastCta(list, empty, 'user_not_started_bot');
      return;
    }

    try {
      const res = await fetch('/api/forecast/weekly?initData=' + encodeURIComponent(initData));
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) {
        if (data.error === 'profile_incomplete') {
          renderForecastCta(list, empty, 'profile_incomplete');
          return;
        }
        if (data.error === 'user_not_started_bot') {
          renderForecastCta(list, empty, 'user_not_started_bot');
          return;
        }
        list.innerHTML = '<li class="forecast-item" style="justify-content:center;color:var(--ink-mute)">Не удалось загрузить прогноз</li>';
        return;
      }
      // Безопасно рендерим Telegram-HTML (buildWeeklyForecastText): разрешаем только <b>/<i>,
      // а любые сырые <, &, теги из профиля/LLM показываем как текст.
      const html = renderTelegramForecastHtml(data.text || '');
      list.innerHTML = `<li class="forecast-item forecast-text" style="display:block;padding:16px;line-height:1.6">${html}</li>`;
      if (empty) empty.remove();
    } catch (e) {
      list.innerHTML = '<li class="forecast-item" style="justify-content:center;color:var(--ink-mute)">Ошибка сети</li>';
    }
  }

  // -- Profile panel --------------------------------------
  function openProfilePanel() {
    closeAllPanels();
    $('#panelProfile').hidden = false;
    tileActive('profile', true);
    haptic('light');
    renderProfile();
    try { $('#panelProfile').scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (_) {}
  }

  function chartBadgeParts(chart) {
    if (!chart) return [];
    return [
      chart.sunSign ? { label: '☉ Солнце', value: chart.sunSign } : null,
      chart.moonSign ? { label: '☾ Луна', value: chart.moonSign } : null,
      chart.ascendant ? { label: 'ASC', value: chart.ascendant } : null,
    ].filter(Boolean);
  }

  function chartTileSignature(chart) {
    const parts = chartBadgeParts(chart);
    if (!parts.length) return '';
    return parts.map((p) => `${p.label === 'ASC' ? 'ASC ' : ''}${p.value}`).join(' · ');
  }

  function renderProfileChartStatus() {
    const chart = state.backendChart.chart;
    if (!chart) return '';
    const badges = chartBadgeParts(chart).map((p) => `
      <span class="profile-astro-badge"><small>${escapeHtml(p.label)}</small><b>${escapeHtml(p.value)}</b></span>`).join('');
    const meta = [chart.birthDate, chart.birthTime, chart.birthPlace].filter(Boolean).map(escapeHtml).join(' · ');
    return `<div class="profile-astro-status">
      <div class="profile-astro-head"><span>✦</span><strong>Натальная карта создана</strong></div>
      <div class="profile-astro-badges">${badges}</div>
      ${meta ? `<div class="profile-astro-meta">${meta}</div>` : ''}
    </div>`;
  }

  function updateAstroTileMeta() {
    const chart = state.backendChart.chart;
    const chartMeta = $('#chartMeta');
    const profileMeta = $('#profileMeta');
    const p = state.profile;
    const hasProfile = !!(p && p.birthYear);
    if (chart) {
      const signature = chartTileSignature(chart);
      if (chartMeta) chartMeta.textContent = signature || 'карта создана';
      if (profileMeta) profileMeta.textContent = 'заполнен · карта есть';
      $('#tileChart')?.classList.remove('is-empty');
      $('#tileProfile')?.classList.remove('is-empty');
      renderHomeProfileState();
      return;
    }
    if (chartMeta) chartMeta.textContent = hasProfile ? 'создать карту' : 'натальная';
    if (profileMeta) profileMeta.textContent = hasProfile ? 'профиль заполнен' : 'заполнить';
    $('#tileChart')?.classList.toggle('is-empty', !hasProfile);
    $('#tileProfile')?.classList.toggle('is-empty', !hasProfile);
    renderHomeProfileState();
  }

  function renderHomeProfileState() {
    const card = $('#homeProfileState');
    if (!card) return;
    const p = state.profile;
    const hasProfile = !!(p && p.birthYear);
    const chart = state.backendChart.chart;
    const title = $('#homeProfileStateTitle');
    const kicker = $('#homeProfileStateKicker');
    const text = $('#homeProfileStateText');
    const orb = $('#homeProfileStateOrb');
    const badges = $('#homeProfileBadges');
    const primary = $('#homeProfileStatePrimary');
    const secondary = $('#homeProfileStateSecondary');
    card.classList.toggle('is-empty', !hasProfile);
    card.classList.toggle('has-chart', !!chart);

    if (chart) {
      const parts = chartBadgeParts(chart);
      if (kicker) kicker.textContent = 'Карта готова';
      if (title) title.textContent = 'Профиль заполнен';
      if (text) text.textContent = 'Натальная карта уже сохранена — можно открыть разбор или обновить данные профиля.';
      if (orb) orb.textContent = '♃';
      if (badges) {
        badges.hidden = !parts.length;
        badges.innerHTML = parts.map((part) => `<span><small>${escapeHtml(part.label)}</small><b>${escapeHtml(part.value)}</b></span>`).join('');
      }
      if (primary) { primary.textContent = 'Открыть карту'; primary.onclick = openChartPanel; }
      if (secondary) { secondary.hidden = false; secondary.textContent = 'Изменить профиль'; secondary.onclick = openProfilePanel; }
      return;
    }

    if (hasProfile) {
      if (kicker) kicker.textContent = 'Профиль заполнен';
      if (title) title.textContent = 'Осталось создать карту';
      if (text) text.textContent = 'Дата рождения есть. Нажми «Создать карту», чтобы увидеть Солнце, Луну и ASC.';
      if (orb) orb.textContent = '☉';
      if (badges) { badges.hidden = true; badges.innerHTML = ''; }
      if (primary) { primary.textContent = 'Создать карту'; primary.onclick = openChartPanel; }
      if (secondary) { secondary.hidden = false; secondary.textContent = 'Профиль'; secondary.onclick = openProfilePanel; }
      return;
    }

    if (kicker) kicker.textContent = 'Профиль не заполнен';
    if (title) title.textContent = 'Начни с профиля';
    if (text) text.textContent = 'Заполни дату, время и место рождения — после этого появятся натальная карта и персональные прогнозы.';
    if (orb) orb.textContent = '◇';
    if (badges) { badges.hidden = true; badges.innerHTML = ''; }
    if (primary) { primary.textContent = 'Заполнить профиль'; primary.onclick = openProfilePanel; }
    if (secondary) secondary.hidden = true;
  }

  function renderProfile() {
    const p = state.profile;
    const zod = (p && p.birthYear) ? DATA.zodiacOf(p.birthMonth, p.birthDay) : null;
    // Возраст
    let age = null;
    if (p && p.birthYear) {
      const now = new Date();
      age = now.getFullYear() - p.birthYear;
      const hadBirthday = (now.getMonth() + 1 > p.birthMonth) || ((now.getMonth() + 1 === p.birthMonth) && now.getDate() >= p.birthDay);
      if (!hadBirthday) age--;
    }
    const fields = [
      { label: 'Имя',          val: p && (p.firstName || (!p.lastName ? p.name : null)) ? (p.firstName || p.name) : null, key: 'firstName', kind: 'text', placeholder: 'Имя', hint: 'для натальной карты нужно полное ФИО' },
      { label: 'Фамилия',      val: p && p.lastName ? p.lastName : null, key: 'lastName', kind: 'text', placeholder: 'Фамилия' },
      { label: 'Дата рождения', val: p && p.birthYear ? `${p.birthDay}.${String(p.birthMonth).padStart(2,'0')}.${p.birthYear}` : null, key: 'birthDate', kind: 'date', hint: 'для натальной карты нужна полная дата' },
      { label: 'Время',         val: p && p.birthTime ? p.birthTime : null, key: 'birthTime', kind: 'time', hint: 'если не знаешь — поставь 12:00' },
      { label: 'Место',         val: p && p.birthPlace ? p.birthPlace : null, key: 'birthPlace', kind: 'text', placeholder: 'Город, страна' }
    ];
    if (profileEditing) {
      const cur = (key) => {
        if (key === 'birthDate') {
          if (p && p.birthYear) {
            return `${p.birthYear}-${String(p.birthMonth).padStart(2,'0')}-${String(p.birthDay).padStart(2,'0')}`;
          }
          return '';
        }
        return p && p[key] ? String(p[key]) : '';
      };
      const inputHtml = (f) => {
        const type = f.kind === 'date' ? 'date' : (f.kind === 'time' ? 'time' : 'text');
        const ph = f.placeholder ? ` placeholder="${escapeHtml(f.placeholder)}"` : '';
        const hint = f.hint ? `<div class="profile-field-hint">${escapeHtml(f.hint)}</div>` : '';
        return `<div class="profile-field${f.hint ? ' has-hint' : ''}">
          <label>${f.label}</label>
          <input type="${type}" data-key="${f.key}" value="${escapeHtml(cur(f.key))}"${ph}>
          ${hint}
        </div>`;
      };
      $('#profileFields').innerHTML = renderProfileChartStatus() + fields.map(inputHtml).join('');
      // wire change handlers to local state
      $$('#profileFields input').forEach(inp => {
        inp.oninput = () => {
          const key = inp.dataset.key;
          if (!state.profile) state.profile = {};
          if (key === 'birthDate') {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(inp.value);
            if (m) {
              state.profile.birthYear = +m[1];
              state.profile.birthMonth = +m[2];
              state.profile.birthDay = +m[3];
            } else {
              delete state.profile.birthYear;
              delete state.profile.birthMonth;
              delete state.profile.birthDay;
            }
          } else {
            state.profile[key] = inp.value || null;
          }
        };
      });
    } else {
      $('#profileFields').innerHTML = renderProfileChartStatus() + fields.map(f =>
        `<div class="profile-field">
          <label>${f.label}</label>
          <div class="val ${f.val ? '' : 'is-empty'}">${f.val ? escapeHtml(f.val) : 'не заполнено'}</div>
        </div>`
      ).join('');
    }

    const meta = $('#profileMeta');
    if (p && p.birthYear) {
      if (meta) meta.textContent = zod ? `${zod[1]} ${zod[0]} · ${age} ${ruAge(age)}` : 'заполнен';
    } else {
      if (meta) meta.textContent = 'заполнить';
    }
    updateAstroTileMeta();

    const warning = $('#profileSyncWarning');
    if (warning) {
      warning.hidden = !state.profileSync.userNotStartedBot;
      const startBtn = warning.querySelector('[data-action="start-bot"]');
      if (startBtn) startBtn.onclick = openProfileStartBot;
    }

    const editBtn = $('#btnProfileEdit');
    if (editBtn) editBtn.textContent = profileEditing ? 'Отмена' : (p && p.birthYear ? 'Изменить' : 'Заполнить');
    const saveBtn = $('#btnProfileSave');
    if (saveBtn) saveBtn.hidden = !profileEditing;
  }

  let profileEditing = false;
  function toggleProfileEdit() {
    profileEditing = !profileEditing;
    renderProfile();
    haptic('light');
  }

  // Склонение «год/года/лет»
  function ruAge(n) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'год';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'года';
    return 'лет';
  }

  // -- Tile highlight + panel close ------------------------
  function tileActive(name, on) {
    const map = { biorhythm:'tileBiorhythm', forecast:'tileForecast', profile:'tileProfile', chart:'tileChart', compat:'tileCompat', history:'tileJournal', gadanie:'tileGadanie', dream:'tileDream', stars:'tileStars' };
    const el = $('#' + map[name]);
    if (el) el.classList.toggle('is-active', on);
  }
  function closeAllPanels() {
    ['panelBiorhythm','panelForecast','panelProfile','panelChart','panelCompat','panelHistory','panelDream','panelStars'].forEach(id => {
      const el = $('#' + id); if (el) el.hidden = true;
    });
    ['biorhythm','forecast','profile','chart','compat','history','dream','stars'].forEach(n => tileActive(n, false));
    // arc portal
    const ap = $('#arcPortal');
    if (ap && !ap.hidden) {
      if (window.ArcApp && window.ArcApp.unmount) window.ArcApp.unmount();
      ap.hidden = true;
      tileActive('gadanie', false);
    }
  }

  // -- Chart panel ----------------------------------------
  function openChartPanel() {
    closeAllPanels();
    $('#panelChart').hidden = false;
    tileActive('chart', true);
    haptic('light');
    renderChart();
    // панель открывается под fold — скролл к её заголовку (scroll-margin-top на .chart-content)
    try { $('#panelChart').scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (_) {}
  }

  // -- Compat panel (deep-link compat_<tgId> или ручной ввод) --
  let _compatPartnerTgId = null; // хранится для share

  function openCompatPanel(partnerTgId) {
    if (!tg || !tg.initData) {
      flashToast('Открой через Telegram');
      return;
    }
    if (!state.user.id) {
      flashToast('Сначала нажми /start в боте');
      return;
    }
    closeAllPanels();
    const panel = $('#panelCompat');
    panel.hidden = false;
    tileActive('compat', true);
    haptic('light');
    setTimeout(() => panel.scrollIntoView({ behavior: 'auto', block: 'start' }), 50);

    if (partnerTgId) {
      // Deep-link: сразу считаем
      _compatPartnerTgId = partnerTgId;
      loadCompat(partnerTgId);
    } else {
      // Ручной ввод: показываем форму
      showCompatForm();
    }
  }

  function showCompatForm() {
    const root = $('#compatContent');
    if (!root) return;
    const form = root.querySelector('#compatForm');
    const loader = root.querySelector('#compatLoader');
    if (form) form.hidden = false;
    if (loader) loader.hidden = true;
    // Убираем старый результат если был
    const oldResult = root.querySelector('.compat-hero');
    if (oldResult) oldResult.parentElement?.remove();

    const input = root.querySelector('#compatInput');
    const goBtn = root.querySelector('#compatGo');
    const inviteBtn = root.querySelector('#compatInvite');
    if (!input || !goBtn) return;

    if (inviteBtn) {
      inviteBtn.onclick = () => shareCompatInvite();
    }

    const doCompat = () => {
      const val = input.value.trim();
      if (!val) { flashToast('Введите числовой Telegram ID партнёра'); return; }
      let tgId;
      if (val.startsWith('@')) {
        flashToast('Username не подойдёт. Попроси партнёра отправить /id в @astro_byrbot.');
        return;
      } else {
        tgId = Number(val);
        if (!tgId || tgId <= 0) { flashToast('Некорректный ID'); return; }
      }
      _compatPartnerTgId = tgId;
      if (form) form.hidden = true;
      if (loader) loader.hidden = false;
      loadCompat(tgId);
    };

    goBtn.onclick = doCompat;
    input.onkeydown = (e) => { if (e.key === 'Enter') doCompat(); };
  }

  async function loadCompat(partnerTgId) {
    const root = $('#compatContent');
    if (!root) return;
    root.innerHTML = `
      <div class="compat-loader">
        <div class="compat-loader-glyph">⚜</div>
        <p>Считаю совместимость…</p>
      </div>
    `;
    try {
      const initData = encodeURIComponent(tg.initData || '');
      const url = `/api/compat?initData=${initData}&with=${partnerTgId}`;
      const resp = await fetch(url, { method: 'GET' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) {
        renderCompatError(data.error || `HTTP ${resp.status}`, partnerTgId);
        return;
      }
      renderCompat(data, partnerTgId);
    } catch (e) {
      renderCompatError('network_error', partnerTgId);
    }
  }

  function renderCompatError(errCode, partnerTgId) {
    const root = $('#compatContent');
    if (!root) return;
    let msg = 'Не удалось посчитать совместимость.';
    let cta = `<button type="button" class="btn btn-ghost" data-screen="compat">Закрыть</button>`;
    let hint = '';
    if (errCode === 'partner_no_profile') {
      msg = 'У партнёра пока нет заполненного профиля.\nПригласи его в бота: ссылка откроет профиль, а /id поможет вернуться к ручному расчёту.';
      cta = `<button type="button" class="btn btn-primary" id="compatInviteError">↗ Пригласить партнёра</button>`;
      hint = 'Если ссылка не откроется, попроси партнёра написать /id в @astro_byrbot и прислать тебе число.';
    } else if (errCode === 'caller_no_profile') {
      msg = 'Сначала заполни свой профиль — дата и место рождения нужны для расчёта совместимости.';
      cta = `<button type="button" class="btn btn-primary" id="compatOpenProfile">Заполнить профиль</button>`;
    } else if (errCode === 'partner_not_started_bot') {
      msg = 'Этот пользователь ещё не запускал бота.\nПригласи партнёра в @astro_byrbot — после старта он сможет заполнить профиль и прислать /id.';
      cta = `<button type="button" class="btn btn-primary" id="compatInviteError">↗ Пригласить партнёра</button>`;
      hint = 'Ручной fallback: партнёр отправляет /id в боте и присылает тебе числовой ID.';
    } else if (errCode === 'invalid_initData') {
      msg = 'Открой приложение через Telegram.';
    } else if (errCode === 'self_compat_not_allowed') {
      msg = 'Нельзя считать совместимость с самим собой 🙂';
    }
    root.innerHTML = `
      <div class="compat-empty">
        <div class="compat-empty-glyph">☁</div>
        <p>${escapeHtml(msg).replace(/\n/g, '<br>')}</p>
        ${cta}
        ${hint ? `<p class="compat-form-note">${escapeHtml(hint)}</p>` : ''}
      </div>
    `;
    const closeBtn = root.querySelector('[data-screen="compat"]');
    if (closeBtn) closeBtn.onclick = () => closePanel('compat');
    const profileBtn = root.querySelector('#compatOpenProfile');
    if (profileBtn) profileBtn.onclick = () => {
      closePanel('compat');
      profileEditing = true;
      openProfilePanel();
    };
    const inviteBtn = root.querySelector('#compatInviteError');
    if (inviteBtn) inviteBtn.onclick = () => shareCompatInvite();
  }

  function renderCompat(data, partnerTgId) {
    const root = $('#compatContent');
    if (!root) return;
    const { score = 0, category = 'average', breakdown = {}, interpretation = '', topPositive = [], topNegative = [], personA, personB } = data;
    const nameA = personA?.firstName || 'Ты';
    const nameB = personB?.firstName || 'партнёр';
    const dateStr = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const catLabel = COMPAT_CATEGORY_LABEL[category] || 'Совместимость';
    const catGlyph = COMPAT_CATEGORY_GLYPH[category] || '✨';
    const breakdownHtml = ['communication', 'emotions', 'passion', 'stability']
      .map((k) => {
        const v = Math.max(0, Math.min(100, Number(breakdown[k]) || 0));
        const labels = { communication: 'Общение', emotions: 'Эмоции', passion: 'Страсть', stability: 'Стабильность' };
        return `
          <div class="compat-bd-row">
            <div class="compat-bd-label">${labels[k]}</div>
            <div class="compat-bd-bar"><div class="compat-bd-fill" style="width:${v}%"></div></div>
            <div class="compat-bd-val">${v}</div>
          </div>
        `;
      })
      .join('');
    const aspectRow = (a) => {
      const sign = a.score > 0 ? '+' : '';
      return `
        <li class="compat-aspect-row">
          <span class="compat-aspect-name">${escapeHtml(a.name || (a.planet_a + '–' + a.planet_b))}</span>
          <span class="compat-aspect-score ${a.score > 0 ? 'is-pos' : 'is-neg'}">${sign}${a.score}</span>
        </li>
      `;
    };
    const positiveHtml = topPositive.length
      ? `<ul class="compat-aspect-list">${topPositive.map(aspectRow).join('')}</ul>`
      : '<p class="compat-empty-hint">Ярких совпадений не нашлось</p>';
    const negativeHtml = topNegative.length
      ? `<ul class="compat-aspect-list">${topNegative.map(aspectRow).join('')}</ul>`
      : '';
    const birthA = personA?.birthDate ? formatShortDate(personA.birthDate) : '';
    const birthB = personB?.birthDate ? formatShortDate(personB.birthDate) : '';
    root.innerHTML = `
      <div class="compat-hero">
        <div class="compat-score-ring" data-cat="${escapeHtml(category)}" style="--p: ${Math.max(0, Math.min(100, Math.round(score)))}%">
          <div class="compat-score-num">${Math.round(score)}</div>
          <div class="compat-score-of">/ 100</div>
        </div>
        <div class="compat-cat">
          <div class="compat-cat-glyph">${catGlyph}</div>
          <div class="compat-cat-label">${escapeHtml(catLabel)}</div>
        </div>
        <div class="compat-pair">
          <span class="compat-pair-name">${escapeHtml(nameA)}</span>
          ${birthA ? `<span class="compat-pair-date">${escapeHtml(birthA)}</span>` : ''}
          <span class="compat-pair-amp">&</span>
          <span class="compat-pair-name">${escapeHtml(nameB)}</span>
          ${birthB ? `<span class="compat-pair-date">${escapeHtml(birthB)}</span>` : ''}
        </div>
        <div class="compat-date">${escapeHtml(dateStr)}</div>
      </div>

      <div class="compat-section">
        <h3 class="compat-section-title">По сферам</h3>
        <div class="compat-bd">${breakdownHtml}</div>
      </div>

      <div class="compat-section">
        <h3 class="compat-section-title">Что между вами сильно</h3>
        ${positiveHtml}
      </div>

      ${negativeHtml ? `
      <div class="compat-section">
        <h3 class="compat-section-title">Где будет непросто</h3>
        ${negativeHtml}
      </div>
      ` : ''}

      ${interpretation ? `
      <div class="compat-section compat-interpretation">
        <h3 class="compat-section-title">Расклад</h3>
        <div class="compat-interpretation-text">${escapeHtml(interpretation)}</div>
      </div>
      ` : ''}

      <div class="compat-actions">
        <button type="button" class="btn btn-primary" id="btnCompatShare">↗ Поделиться</button>
        <button type="button" class="btn btn-ghost" data-screen="compat">Закрыть</button>
      </div>
    `;
    const shareBtn = root.querySelector('#btnCompatShare');
    if (shareBtn) shareBtn.onclick = () => shareCompat(data, partnerTgId, nameA, nameB);
    const closeBtn = root.querySelector('[data-screen="compat"]');
    if (closeBtn) closeBtn.onclick = () => closePanel('compat');
    setTimeout(() => root.querySelector('.compat-hero')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  }

  function formatShortDate(iso) {
    // ISO: YYYY-MM-DD → "12 марта 1985"
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    if (!y || !m || !d) return iso;
    const months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
    return `${d} ${months[m - 1] || ''} ${y}`;
  }

  function buildCompatShareUrl() {
    return 'https://t.me/astro_byrbot?start=compat_' + (state.user.id || '');
  }

  function openCompatShare(text, shareUrl) {
    const t = window.TelegramApp && window.TelegramApp.tg;
    const tgShareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(shareUrl) + '&text=' + encodeURIComponent(text);
    if (t && t.openTelegramLink) {
      try { t.openTelegramLink(tgShareUrl); haptic('light'); return; } catch (e) {}
    }
    if (navigator.share) {
      try { navigator.share({ title: 'Совместимость — Гадалка', text, url: shareUrl }).catch(() => {}); return; } catch (e) {}
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text + '\n' + shareUrl).then(() => flashToast('Ссылка скопирована'));
    } else {
      flashToast('Шаринг недоступен');
    }
  }

  function shareCompatInvite() {
    if (!state.user.id) { flashToast('Открой приложение через Telegram'); return; }
    openCompatShare('🔮 Хочу посчитать нашу астрологическую совместимость. Открой ссылку, заполни профиль и вернись ко мне 👇', buildCompatShareUrl());
  }

  function shareCompat(data, partnerTgId, nameA, nameB) {
    const { score = 0, category = 'average' } = data || {};
    const catLabel = COMPAT_CATEGORY_LABEL[category] || '';
    const text = `🔮 ${nameA} & ${nameB} — ${catLabel} совместимость: ${Math.round(score)}/100\n\nПосчитай свою 👇`;
    openCompatShare(text, buildCompatShareUrl());
  }

  async function loadBackendChart() {
    const initData = getInitData();
    if (!initData) return;
    state.backendChart.loading = true;
    try {
      const res = await fetch('/api/chart/latest?initData=' + encodeURIComponent(initData));
      const data = await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
      state.backendChart.loaded = true;
      state.backendChart.loading = false;
      if (res.ok && data.ok && data.chart) {
        state.backendChart.chart = normalizeBackendChart(data.chart);
        state.backendChart.error = '';
      } else {
        state.backendChart.chart = null;
        state.backendChart.error = data.message || data.error || 'no_chart';
      }
    } catch (e) {
      state.backendChart.loaded = true;
      state.backendChart.loading = false;
      state.backendChart.chart = null;
      state.backendChart.error = 'network';
    }
  }

  function normalizeBackendChart(record) {
    const data = record && record.chartData ? record.chartData : null;
    if (!data || typeof data !== 'object') return null;
    const signText = (o) => {
      if (!o || typeof o !== 'object') return '';
      const symbol = signSymbol(o.sign || o.sign_ru);
      const sign = o.sign_ru || ruSign(o.sign) || o.sign || '';
      return `${symbol ? symbol + ' ' : ''}${sign}`.trim();
    };
    const planetsObj = data.planets && typeof data.planets === 'object' ? data.planets : {};
    const order = Array.isArray(data.planet_order) ? data.planet_order : Object.keys(planetsObj);
    const planets = order
      .map((id) => normalizeBackendPlanet(id, planetsObj[id]))
      .filter(Boolean);
    const aspects = Array.isArray(data.aspects) ? data.aspects.map(normalizeBackendAspect).filter(Boolean) : [];
    return {
      id: record.id,
      birthDate: record.birthDate,
      birthTime: record.birthTime,
      birthPlace: record.birthPlace,
      createdAt: record.createdAt,
      sunSign: signText(planetsObj.Sun),
      moonSign: signText(planetsObj.Moon),
      ascendant: signText(data.ascendant),
      planets,
      aspects,
      elements: formatBackendElements(data.elements),
    };
  }

  function normalizeBackendPlanet(id, p) {
    if (!p || typeof p !== 'object') return null;
    return {
      id,
      name: p.name_ru || id,
      symbol: p.symbol || '',
      sign: { name: p.sign_ru || ruSign(p.sign) || p.sign || '', symbol: signSymbol(p.sign || p.sign_ru) },
      dms: formatDegree(p.degree),
      retro: !!p.retro,
    };
  }

  function normalizeBackendAspect(a) {
    if (!a || typeof a !== 'object') return null;
    return {
      glyph: a.symbol || '',
      name: a.aspect_ru || a.aspect || '',
      orb: typeof a.orb === 'number' ? a.orb.toFixed(2) : (a.orb || '0'),
      p1: { name: a.planet1_ru || a.planet1 || '' },
      p2: { name: a.planet2_ru || a.planet2 || '' },
    };
  }

  function formatDegree(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return '';
    const d = Math.floor(n);
    const m = Math.round((n - d) * 60);
    return `${d}°${String(m).padStart(2, '0')}`;
  }

  function formatBackendElements(elements) {
    if (!elements || typeof elements !== 'object') return {};
    return {
      Огонь: elements.fire || 0,
      Земля: elements.earth || 0,
      Воздух: elements.air || 0,
      Вода: elements.water || 0,
    };
  }

  function ruSign(sign) {
    const map = { Aries: 'Овен', Taurus: 'Телец', Gemini: 'Близнецы', Cancer: 'Рак', Leo: 'Лев', Virgo: 'Дева', Libra: 'Весы', Scorpio: 'Скорпион', Sagittarius: 'Стрелец', Capricorn: 'Козерог', Aquarius: 'Водолей', Pisces: 'Рыбы' };
    return map[sign] || '';
  }

  function signSymbol(sign) {
    const map = { Aries: '♈', Taurus: '♉', Gemini: '♊', Cancer: '♋', Leo: '♌', Virgo: '♍', Libra: '♎', Scorpio: '♏', Sagittarius: '♐', Capricorn: '♑', Aquarius: '♒', Pisces: '♓', Овен: '♈', Телец: '♉', Близнецы: '♊', Рак: '♋', Лев: '♌', Дева: '♍', Весы: '♎', Скорпион: '♏', Стрелец: '♐', Козерог: '♑', Водолей: '♒', Рыбы: '♓' };
    return map[sign] || '';
  }

  function renderCreateChartCta(root, message) {
    root.innerHTML = `
      <div class="chart-empty">
        <svg viewBox="0 0 32 32" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="16" cy="16" r="11" fill="currentColor" fill-opacity="0.1"/>
          <path d="M16 8v8l5 5"/>
        </svg>
        <p>${escapeHtml(message || 'Заполните дату, точное время и город рождения в профиле — Mini App рассчитает настоящую натальную карту.')}</p>
        <button type="button" class="btn btn-primary" id="chartCtaCreate">Создать карту</button>
        <button type="button" class="btn btn-ghost" id="chartCtaOpenProfile">Заполнить профиль</button>
      </div>`;
    const createBtn = $('#chartCtaCreate');
    if (createBtn) createBtn.onclick = createBackendChart;
    const profileBtn = $('#chartCtaOpenProfile');
    if (profileBtn) profileBtn.onclick = openProfilePanel;
  }

  async function createBackendChart() {
    const initData = getInitData();
    if (!initData) {
      flashToast('Не удалось получить initData. Перезайди в Mini App из бота.');
      return;
    }
    const btn = $('#chartCtaCreate');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Считаю карту…';
    }
    state.backendChart.loading = true;
    renderChart();
    try {
      const res = await fetch('/api/chart/latest?initData=' + encodeURIComponent(initData), { method: 'POST' });
      const data = await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
      state.backendChart.loaded = true;
      state.backendChart.loading = false;
      if (res.ok && data.ok && data.chart) {
        state.backendChart.chart = normalizeBackendChart(data.chart);
        state.backendChart.error = '';
        flashToast('Карта создана');
        haptic('success');
      } else {
        state.backendChart.chart = null;
        state.backendChart.error = data.message || data.error || 'Не удалось создать карту';
        flashToast(state.backendChart.error);
      }
      renderChart();
    } catch (e) {
      state.backendChart.loaded = true;
      state.backendChart.loading = false;
      state.backendChart.chart = null;
      state.backendChart.error = 'Ошибка сети. Попробуй ещё раз.';
      flashToast(state.backendChart.error);
      renderChart();
    }
  }

  function renderChart() {
    const root = $('#chartContent');
    if (!root) return;
    if (state.backendChart.loading) {
      root.innerHTML = '<p class="chart-empty">Загружаю сохранённую карту из бэкенда…</p>';
      updateAstroTileMeta();
      return;
    }
    const chart = state.backendChart.chart;
    if (!chart) {
      renderCreateChartCta(root, state.backendChart.error && state.backendChart.error !== 'no_chart'
        ? state.backendChart.error
        : 'Заполните дату, точное время и город рождения в профиле — Mini App рассчитает настоящую натальную карту с теми же Солнцем, Луной, ASC и аспектами.');
      updateAstroTileMeta();
      return;
    }
    const elements = Object.entries(chart.elements)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
    root.innerHTML = `
      <div class="chart-summary">
        <div class="chart-big">
          <div class="chart-big-item">
            <span class="label">Солнце</span>
            <span class="value">${chart.sunSign}</span>
          </div>
          <div class="chart-big-item">
            <span class="label">Луна</span>
            <span class="value">${chart.moonSign}</span>
          </div>
          <div class="chart-big-item">
            <span class="label">Асцендент</span>
            <span class="value">${chart.ascendant}</span>
          </div>
        </div>
        <p class="chart-meta">${elements}</p>
      </div>
      <h3 class="chart-h3">Планеты</h3>
      <div class="chart-planets" id="chartPlanets"></div>
      <h3 class="chart-h3">Аспекты</h3>
      <div class="chart-aspects" id="chartAspects"></div>
      <div class="chart-ai-wrap">
        <div class="chart-ai-meta" id="chartAiMeta"></div>
        <div class="chart-ai-slot" id="chartAiSlot"></div>
        <div class="chart-ai-topup" id="chartAiTopup"></div>
      </div>
    `;
    renderPlanetTable(chart.planets);
    renderAspects(chart.aspects);
    updateAstroTileMeta();
    renderAiBadge('chart_interpret', '#chartAiMeta');
    renderChartAiButton();
  }

  function renderPlanetTable(planets) {
    const root = $('#chartPlanets');
    if (!root) return;
    const html = planets.map(p => {
      const retro = p.retro ? '℞' : '';
      return `
        <div class="chart-row">
          <span class="chart-row-sym">${p.symbol}</span>
          <span class="chart-row-name">${p.name}</span>
          <span class="chart-row-sign">${p.sign.symbol} ${p.sign.name}</span>
          <span class="chart-row-deg">${p.dms}${retro}</span>
        </div>`;
    }).join('');
    root.innerHTML = html;
  }

  function renderAspects(aspects) {
    const root = $('#chartAspects');
    if (!root) return;
    if (!aspects.length) {
      root.innerHTML = '<p class="chart-empty">Аспектов не найдено.</p>';
      return;
    }
    const html = aspects.slice(0, 16).map(a => `
      <div class="chart-row aspect">
        <span class="chart-row-sym">${a.glyph}</span>
        <span class="chart-row-name">${a.p1.name} · ${a.p2.name}</span>
        <span class="chart-row-deg">${a.name} ±${a.orb}°</span>
      </div>
    `).join('');
    root.innerHTML = html;
  }

  // -- AI-расшифровка натальной карты (глубинный разбор) -------
  // Минимальный markdown-парсер для AI-вывода (копия из arc-app.js).
  // Без зависимостей, без XSS (escapeHtml → белый список).
  function mdLight(src) {
    if (!src) return '';
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const lines = esc(src).split(/\n/);
    const out = [];
    let listBuf = null;
    const flushList = () => { if (listBuf) { out.push('<ul>' + listBuf.join('') + '</ul>'); listBuf = null; } };
    const inline = (s) =>
      s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
       .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
       .replace(/`([^`]+)`/g, '<code>$1</code>');
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()) { flushList(); continue; }
      const h2 = line.match(/^##\s+(.+)/);
      const h3 = line.match(/^###\s+(.+)/);
      const li = line.match(/^[-•]\s+(.+)/);
      if (h2) { flushList(); out.push('<h4 class="chart-ai-h">' + inline(h2[1]) + '</h4>'); continue; }
      if (h3) { flushList(); out.push('<h5 class="chart-ai-h5">' + inline(h3[1]) + '</h5>'); continue; }
      if (li) { listBuf = listBuf || []; listBuf.push('<li>' + inline(li[1]) + '</li>'); continue; }
      let para = line;
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^([-•]|##|###)\s/.test(lines[i + 1])) {
        i++; para += ' ' + lines[i].trim();
      }
      flushList();
      out.push('<p>' + inline(para) + '</p>');
    }
    flushList();
    return out.join('\n');
  }

  const CHART_AI_LIMIT = AI_LIMITS_DISPLAY.chart_interpret;

  function renderChartAiButton() {
    const slot = $('#chartAiSlot');
    if (!slot) return;
    const ai = state.chartAi;

    // 1) уже загружено в сессии — показываем сразу
    if (ai.loaded) {
      slot.innerHTML = `
        <div class="chart-ai-card is-loaded" id="chartAiCard">
          <div class="chart-ai-head">
            <span class="chart-ai-orb">✨</span>
            <div>
              <div class="chart-ai-title">Глубинный разбор карты</div>
              <div class="chart-ai-sub">${ai.cached ? 'сохранено' : 'новая расшифровка'} · осталось сегодня: ${ai.remaining}/${CHART_AI_LIMIT}</div>
            </div>
          </div>
          <div class="chart-ai-body markdown">${mdLight(ai.interpretation)}</div>
          <div class="chart-ai-foot">
            <button type="button" class="chart-ai-toggle" data-action="toggle">свернуть</button>
          </div>
        </div>`;
      wireChartAiCard();
      return;
    }

    // 2) лимит исчерпан
    if (ai.remaining === 0) {
      slot.innerHTML = `
        <div class="chart-ai-card is-locked">
          <div class="chart-ai-head">
            <span class="chart-ai-orb">🔒</span>
            <div>
              <div class="chart-ai-title">Глубинный разбор карты</div>
              <div class="chart-ai-sub">лимит ${CHART_AI_LIMIT}/день исчерпан · сброс в полночь UTC</div>
            </div>
          </div>
        </div>`;
      renderAiTopup('chart_interpret', '#chartAiTopup');
      return;
    }

    // 3) CTA: кнопка
    slot.innerHTML = `
      <div class="chart-ai-card is-cta">
        <div class="chart-ai-head">
          <span class="chart-ai-orb">✨</span>
          <div>
            <div class="chart-ai-title">Глубинный разбор карты</div>
            <div class="chart-ai-sub">разберёт AI по планетам, домам и аспектам · осталось сегодня: ${ai.remaining}/${CHART_AI_LIMIT}</div>
          </div>
        </div>
        <div class="chart-ai-foot">
          <button type="button" class="chart-ai-cta" data-action="load">Получить разбор</button>
        </div>
      </div>`;
    const btn = slot.querySelector('[data-action="load"]');
    if (btn) btn.onclick = loadChartAi;
  }

  function wireChartAiCard() {
    const card = $('#chartAiCard');
    if (!card) return;
    const btn = card.querySelector('[data-action="toggle"]');
    if (!btn) return;
    btn.onclick = () => {
      const body = card.querySelector('.chart-ai-body');
      if (!body) return;
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      btn.textContent = collapsed ? 'свернуть' : 'развернуть';
    };
  }

  async function loadChartAi() {
    const slot = $('#chartAiSlot');
    if (!slot) return;
    // блокируем кнопку — нет двойных кликов
    const btn = slot.querySelector('[data-action="load"]');
    if (btn) btn.disabled = true;

    const initData = getInitData();
    if (!initData) {
      state.chartAi.error = 'Не удалось получить initData. Перезайди в Mini App из бота.';
      renderChartAiError();
      return;
    }

    // loader
    slot.innerHTML = `
      <div class="chart-ai-card is-loading">
        <div class="chart-ai-head">
          <span class="chart-ai-orb chart-ai-orb-spin">✨</span>
          <div>
            <div class="chart-ai-title">Глубинный разбор карты</div>
            <div class="chart-ai-sub">AI разбирает карту · обычно 15–30 сек</div>
          </div>
        </div>
      </div>`;

    try {
      const res = await fetch('/api/chart/interpret?initData=' + encodeURIComponent(initData), { method: 'POST' });
      const data = await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
      if (!res.ok || !data.ok) {
        updateManaBalance(data);
        state.chartAi.remaining = typeof data.remaining === 'number' ? data.remaining : (state.aiBalance.chart_interpret?.remaining ?? CHART_AI_LIMIT);
        if (data.error === 'rate_limited' || state.chartAi.remaining === 0) {
          state.chartAi.remaining = 0;
          renderChartAiButton();
          return;
        }
        if (data.error === 'insufficient_mana') {
          state.chartAi.error = data.message || 'Не хватает маны для глубинного разбора карты.';
          renderChartAiError();
          const err = $('#chartAiSlot');
          if (err) renderAiTopup('chart_interpret', '#chartAiTopup');
          return;
        }
        state.chartAi.error = data.message || data.error || 'Не удалось получить разбор.';
        renderChartAiError();
        return;
      }
      updateManaBalance(data);
      state.chartAi.loaded = true;
      state.chartAi.interpretation = data.interpretation;
      state.chartAi.remaining = typeof data.remaining === 'number' ? data.remaining : (state.aiBalance.chart_interpret?.remaining ?? CHART_AI_LIMIT);
      state.chartAi.cached = !!data.cached;
      renderChartAiButton();
    } catch (e) {
      state.chartAi.error = 'Ошибка сети: ' + (e && e.message ? e.message : String(e));
      renderChartAiError();
    }
  }

  function renderChartAiError() {
    const slot = $('#chartAiSlot');
    if (!slot) return;
    slot.innerHTML = `
      <div class="chart-ai-card is-error">
        <div class="chart-ai-head">
          <span class="chart-ai-orb">⚠️</span>
          <div>
            <div class="chart-ai-title">Глубинный разбор карты</div>
            <div class="chart-ai-sub">${state.chartAi.error}</div>
          </div>
        </div>
        <div class="chart-ai-foot">
          <button type="button" class="chart-ai-cta" data-action="load">Попробовать снова</button>
        </div>
      </div>`;
    const btn = slot.querySelector('[data-action="load"]');
    if (btn) btn.onclick = loadChartAi;
  }

  async function saveProfileToBot() {
    if (!state.profile || !state.profile.birthYear) {
      flashToast('Заполни дату рождения');
      return;
    }
    const p = state.profile;
    const initData = getInitData();
    if (!initData) {
      flashToast('Не удалось получить initData. Перезайди в Mini App из бота.');
      return;
    }
    const fullNameParts = [p.lastName, p.firstName, p.patronymic]
      .map((s) => (s || '').trim())
      .filter(Boolean);
    const fullName = fullNameParts.length > 0 ? fullNameParts.join(' ') : (p.name || undefined);
    const body = {
      name: fullName,
      lastName: p.lastName || undefined,
      firstName: p.firstName || undefined,
      patronymic: p.patronymic || undefined,
      birthDate: `${p.birthYear}-${String(p.birthMonth).padStart(2, '0')}-${String(p.birthDay).padStart(2, '0')}`,
      birthTime: p.birthTime || undefined,
      birthPlace: p.birthPlace || undefined,
      timezone: (p.timezone !== undefined ? p.timezone : (Intl.DateTimeFormat().resolvedOptions().timeZone || undefined)),
      gender: p.gender || undefined,
    };
    // Сохраняем локально до сетевого запроса: если бот ещё не запущен,
    // данные не пропадут после перехода в Telegram и возврата в Mini App.
    Evening.saveProfile(p);
    try {
      const res = await fetch('/api/profile?initData=' + encodeURIComponent(initData), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
      if (!res.ok || !data.ok) {
        if (isUserNotStartedBot(data)) {
          setProfileSyncWarning(true);
          renderProfile();
          flashToast('Сначала запусти бота — профиль останется здесь.');
        } else {
          flashToast(data.error || 'Не удалось сохранить профиль');
        }
        return;
      }
      setProfileSyncWarning(false);
      setProfile(p);
      Evening.saveProfile(p);
      flashToast('Профиль сохранён');
      haptic('success');
      profileEditing = false;
      renderProfile();
      renderBiorhythmTile();
    } catch (e) {
      flashToast('Ошибка сети. Попробуй ещё раз.');
    }
  }

  function openBotLink(url) {
    const tg = window.TelegramApp && window.TelegramApp.tg;
    if (tg && tg.openTelegramLink) {
      try { tg.openTelegramLink(url); haptic('light'); return; } catch (e) {}
    }
    if (tg && tg.openLink) {
      try { tg.openLink(url); haptic('light'); return; } catch (e) {}
    }
    // fallback (dev / desktop browser)
    window.open(url, '_blank', 'noopener');
  }

  function openProfileStartBot() {
    openBotLink(BOT_PROFILE_START_URL);
  }

  function openProfileInBot() {
    openBotLink('https://t.me/astro_byrbot?start=profile');
  }


  function openDreamPanel() {
    closeAllPanels();
    const panel = $('#panelDream');
    if (!panel) return;
    panel.hidden = false;
    tileActive('dream', true);
    haptic('light');
    try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  }

  function dreamModeLabel(mode) {
    return mode === 'deep' ? 'глубокий разбор' : 'короткий разбор';
  }

  function buildDreamShareText(result) {
    const dream = String(result?.dream || '').trim();
    const mood = String(result?.mood || '').trim();
    const interpretation = String(result?.interpretation || '').trim();
    return [
      `🌘 Сонник — ${dreamModeLabel(result?.mode)}`,
      dream ? `Сон: ${dream}` : '',
      mood ? `Настроение: ${mood}` : '',
      interpretation ? `\n${interpretation}` : '',
      '\n— расшифровано в Гадалке 🔮',
    ].filter(Boolean).join('\n');
  }

  async function saveDreambookResult(result, btn) {
    if (result?.historyId) {
      await refreshHistoryFromBackend();
      updateHistoryBadge();
      flashToast('Сон уже сохранён в истории');
      openHistoryPanel();
      return;
    }
    const initData = getInitData();
    if (!initData) return flashToast('Откройте Mini App из Telegram');
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/history?initData=' + encodeURIComponent(initData), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'dream',
          title: `Сонник: ${dreamModeLabel(result.mode)}`,
          subtitle: String(result.dream || '').slice(0, 160),
          payload: {
            mode: result.mode,
            dream: result.dream,
            mood: result.mood || null,
            manaCost: result.manaCost || null,
          },
          interpretation: result.interpretation,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || 'history_save_failed');
      result.historyId = data.id;
      await refreshHistoryFromBackend();
      updateHistoryBadge();
      flashToast('Сон сохранён в истории');
      openHistoryPanel();
    } catch (_) {
      flashToast('Не удалось сохранить сон');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function shareDreambookResult(result) {
    const text = buildDreamShareText(result);
    const shareUrl = 'https://t.me/astro_byrbot';
    if (tg && tg.openTelegramLink) {
      try {
        tg.openTelegramLink('https://t.me/share/url?url=' + encodeURIComponent(shareUrl) + '&text=' + encodeURIComponent(text));
        haptic('light');
        return;
      } catch (_) {}
    }
    if (navigator.share) {
      try { await navigator.share({ title: 'Сонник — Гадалка', text, url: shareUrl }); haptic('light'); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    try { await navigator.clipboard.writeText(text + '\n' + shareUrl); flashToast('Текст для подруги скопирован'); }
    catch (_) { try { window.prompt('Скопируйте трактовку:', text); } catch (_) {} }
  }

  function renderDreambookResult(out, result) {
    if (!out) return;
    out.classList.remove('is-error');
    out.innerHTML = `
      <div class="dream-result-text">${escapeHtml(result.interpretation)}</div>
      <div class="dream-result-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button type="button" class="btn btn-ghost" data-dream-save>💾 Сохранить в историю</button>
        <button type="button" class="btn btn-primary" data-dream-share>💌 Поделиться с подругой</button>
      </div>
      ${result.historyId ? '<div class="dream-result-saved" style="margin-top:8px;opacity:.78;font-size:13px">Уже сохранено: откройте «Историю» на любом устройстве.</div>' : ''}
    `;
    const saveBtn = out.querySelector('[data-dream-save]');
    const shareBtn = out.querySelector('[data-dream-share]');
    if (saveBtn) saveBtn.onclick = () => saveDreambookResult(result, saveBtn);
    if (shareBtn) shareBtn.onclick = () => shareDreambookResult(result);
    if (result.historyId) {
      refreshHistoryFromBackend();
      updateHistoryBadge();
    }
  }

  async function submitDreambook(mode) {
    const text = ($('#dreamText')?.value || '').trim();
    const mood = ($('#dreamMood')?.value || '').trim();
    const out = $('#dreamResult');
    const btn = mode === 'deep' ? $('#btnDreamDeep') : $('#btnDreamShort');
    if (!out) return;
    if (!text || text.length < 8) {
      out.hidden = false;
      out.classList.add('is-error');
      out.textContent = 'Опишите сон хотя бы одним предложением.';
      return;
    }
    const initData = getInitData();
    if (!initData) {
      out.hidden = false;
      out.classList.add('is-error');
      out.textContent = 'Откройте Mini App из Telegram, чтобы использовать сонник.';
      return;
    }
    out.hidden = false;
    out.classList.remove('is-error');
    out.textContent = 'Гадалка листает сонник…';
    if (btn) btn.disabled = true;
    try {
      const res = await fetch('/api/dreambook/interpret?initData=' + encodeURIComponent(initData), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dream: text, mood, mode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (data.error === 'insufficient_mana') {
          updateManaBalance(data);
          out.innerHTML = `<div class="ai-limit-box"><p>${escapeHtml(data.message || 'Недостаточно маны.')}</p><button type="button" class="btn btn-gold" data-stars-topup>Пополнить ману</button></div>`;
          const top = out.querySelector('[data-stars-topup]');
          if (top) top.onclick = openStarsTopup;
          return;
        }
        throw new Error(data.message || data.error || 'dreambook_failed');
      }
      updateManaBalance(data);
      renderDreambookResult(out, {
        dream: text,
        mood,
        mode,
        interpretation: data.interpretation || 'Сонник молчит. Попробуйте переформулировать сон.',
        historyId: data.history_id,
        manaCost: data.manaCost,
      });
      haptic('success');
    } catch (e) {
      out.classList.add('is-error');
      out.textContent = 'Не удалось разобрать сон. Мана вернётся, если списание уже было.';
      haptic('error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function openStarsPanel() {
    closeAllPanels();
    const panel = $('#panelStars');
    if (!panel) return;
    panel.hidden = false;
    tileActive('stars', true);
    renderStarsEntry();
    haptic('light');
    try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
  }

  function openStarsTopup() {
    openBotLink(BOT_STARS_URL);
  }
  function closePanel(name) {
    $('#panel' + name[0].toUpperCase() + name.slice(1)).hidden = true;
    tileActive(name, false);
  }

  // -- Tarot refresh + share --------------------------------
  function refreshTarot() {
    haptic('medium');
    const tgId = state.user.id || 1;
    const date = DATA.todayKey();
    TarotDaily.bumpSalt(tgId, date);
    renderTarot();
    flashToast('Новая карта вытянута');
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
    const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = word;
        if (lines.length >= maxLines) break;
      } else {
        line = test;
      }
    }
    if (line && lines.length < maxLines) lines.push(line);
    if (words.length && lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
      lines[lines.length - 1] = lines[lines.length - 1].replace(/[,.!?…]*$/, '') + '…';
    }
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
    return y + lines.length * lineHeight;
  }

  function loadCanvasImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function dataUrlToFile(dataUrl, filename) {
    const parts = dataUrl.split(',');
    const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/png';
    const bin = atob(parts[1] || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], filename, { type: mime });
  }

  async function createDailyStoryCard(c) {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#231945');
    bg.addColorStop(0.48, '#0b0a1a');
    bg.addColorStop(1, '#1a102b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(260, 250, 20, 260, 250, 720);
    glow.addColorStop(0, 'rgba(245, 215, 110, 0.34)');
    glow.addColorStop(1, 'rgba(245, 215, 110, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.52;
    ctx.fillStyle = '#d4af37';
    for (let i = 0; i < 72; i++) {
      const x = (i * 157) % W;
      const y = (i * 263) % H;
      const r = 1.5 + (i % 5);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5d76e';
    ctx.font = '700 34px Georgia, serif';
    ctx.fillText('КАРТА ДНЯ', W / 2, 132);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '28px system-ui, -apple-system, sans-serif';
    ctx.fillText(DATA.dateLabel(), W / 2, 178);

    const cardX = 255, cardY = 250, cardW = 570, cardH = 850;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.58)';
    ctx.shadowBlur = 56;
    ctx.shadowOffsetY = 28;
    roundRectPath(ctx, cardX, cardY, cardW, cardH, 34);
    ctx.fillStyle = '#120f24';
    ctx.fill();
    ctx.restore();

    const img = await loadCanvasImage(new URL(DATA.imageFor(c), location.href).href);
    if (img) {
      ctx.save();
      roundRectPath(ctx, cardX + 22, cardY + 22, cardW - 44, cardH - 44, 26);
      ctx.clip();
      const scale = Math.max((cardW - 44) / img.width, (cardH - 44) / img.height);
      const iw = img.width * scale, ih = img.height * scale;
      ctx.drawImage(img, cardX + 22 + (cardW - 44 - iw) / 2, cardY + 22 + (cardH - 44 - ih) / 2, iw, ih);
      ctx.restore();
    } else {
      ctx.fillStyle = '#d4af37';
      ctx.font = '120px Georgia, serif';
      ctx.fillText('✦', W / 2, cardY + cardH / 2);
    }
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(245,215,110,0.72)';
    roundRectPath(ctx, cardX, cardY, cardW, cardH, 34);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 64px Georgia, serif';
    ctx.fillText(c.name || 'Карта дня', W / 2, 1215);
    if (c.reversed) {
      ctx.fillStyle = 'rgba(212,175,55,0.18)';
      roundRectPath(ctx, 360, 1240, 360, 56, 28);
      ctx.fill();
      ctx.fillStyle = '#f5d76e';
      ctx.font = '700 26px system-ui, -apple-system, sans-serif';
      ctx.fillText('ПЕРЕВЁРНУТАЯ', W / 2, 1277);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,0.86)';
    ctx.font = '36px Georgia, serif';
    const y1 = wrapCanvasText(ctx, c.upright || c.mood || '', 120, c.reversed ? 1350 : 1318, 840, 50, 4);
    ctx.fillStyle = '#f5d76e';
    ctx.font = '700 30px system-ui, -apple-system, sans-serif';
    ctx.fillText('Совет дня', 120, y1 + 44);
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.font = '32px system-ui, -apple-system, sans-serif';
    wrapCanvasText(ctx, c.advice || '', 120, y1 + 92, 840, 44, 3);

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.62)';
    ctx.font = '28px system-ui, -apple-system, sans-serif';
    ctx.fillText('Гадалка · @astro_byrbot', W / 2, H - 96);
    return canvas.toDataURL('image/png');
  }

  async function shareTarot() {
    const c = TarotDaily.calc(state.user.id || 1, DATA.todayKey());
    const text = TarotDaily.formatShare(c);
    const btn = $('#btnShareTarot');
    const oldText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Готовлю сторис…'; }
    const tg = window.TelegramApp && window.TelegramApp.tg;
    const storyText = `${c.name || 'Карта дня'}\n${c.advice || c.upright || ''}`.slice(0, 2048);
    const initData = getInitData();
    let dataUrl = '';
    if (tg && typeof tg.shareToStory === 'function' && initData) {
      try {
        dataUrl = await createDailyStoryCard(c);
        const res = await fetch('/api/share-card?initData=' + encodeURIComponent(initData), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageData: dataUrl, card: c.name || '', date: DATA.todayKey() }),
        });
        const uploaded = await res.json().catch(() => ({}));
        if (res.ok && uploaded.ok && uploaded.url) {
          tg.shareToStory(uploaded.url, {
            text: storyText,
            widget_link: { url: 'https://t.me/astro_byrbot', name: 'Открыть Гадалку' },
          });
          flashToast('Открываю публикацию сторис');
          haptic('success');
          return;
        }
      } catch (e) {
        // upload/story failed — fallback below
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText || 'В сторис / поделиться'; }
      }
    }

    try {
      if (!dataUrl) dataUrl = await createDailyStoryCard(c);
      const file = dataUrlToFile(dataUrl, `gadalka-${DATA.todayKey()}.png`);
      if (navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
        await navigator.share({ title: 'Карта дня — Гадалка', text, files: [file] });
        flashToast('Карточка готова к отправке');
        haptic('success');
        return;
      }
    } catch (e) {
      // fall through to text share
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = oldText || 'Поделиться карточкой'; }
    }

    if (tg && tg.openTelegramLink) {
      flashToast('Выбери чат для отправки');
      const url = 'https://t.me/share/url?url=' + encodeURIComponent('https://t.me/astro_byrbot') + '&text=' + encodeURIComponent(text);
      tg.openTelegramLink(url);
    } else if (navigator.share) {
      navigator.share({ title: 'Карта дня — Гадалка', text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => flashToast('Скопировано в буфер'));
    } else {
      flashToast('Шаринг недоступен');
    }
    haptic('light');
  }

  // -- Evening save ----------------------------------------
  function selectMood(btn) {
    state.mood = Number(btn.dataset.mood);
    $$('.mood-btn').forEach(b => b.classList.toggle('is-selected', b === btn));
    haptic('selection');
  }
  // saveCheckin удалён: чек-ин выпилен из UI

  // -- Haptics (no-op если TG недоступен) ------------------
  function haptic(kind) {
    if (tg && tg.HapticFeedback) {
      try {
        const map = { light: 'impactLight', medium: 'impactMedium', heavy: 'impactHeavy', success: 'notificationSuccess', error: 'notificationError', selection: 'selectionChanged' };
        const fn = tg.HapticFeedback[map[kind] || 'impactLight'];
        if (fn) fn.call(tg.HapticFeedback);
      } catch (e) { /* noop */ }
    }
  }

  // -- Toast ------------------------------------------------
  let toastT;
  function flashToast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-shown');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('is-shown'), 2200);
  }

  // -- Escape -----------------------------------------------
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function renderTelegramForecastHtml(text) {
    return escapeHtml(String(text || ''))
      .replace(/&lt;b&gt;/g, '<strong>').replace(/&lt;\/b&gt;/g, '</strong>')
      .replace(/&lt;i&gt;/g, '<em>').replace(/&lt;\/i&gt;/g, '</em>')
      .replace(/\n/g, '<br>');
  }

  // -- AI-расшифровка карты дня -------------------------------
  async function handleHeroAiInterpret() {
    const btn = $('#btnHeroAi');
    const slot = $('#heroAiReading');
    if (!btn || !slot) return;
    const c = state.dailyCard;
    if (!c || !c.name) return;

    // toggle: если уже открыт — закрыть
    if (!slot.hidden) {
      slot.hidden = true;
      slot.innerHTML = '';
      btn.classList.remove('is-active');
      return;
    }

    // localStorage cache (по name + orientation, валиден 1 день)
    const cacheKey = getDailyCardCacheKey(c);
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (e) {}
    if (cached && cached.meaning) {
      renderHeroAi(slot, cached);
      btn.classList.add('is-active');
      renderDailyCardPriceLabels(c);
      return;
    }

    const total = state.manaBalance && typeof state.manaBalance.total === 'number' ? state.manaBalance.total : null;
    if (total !== null && total < DAILY_CARD_INTERPRET_COST) {
      renderHeroAiLimit(slot, { error: 'insufficient_mana', message: `Нужно ${DAILY_CARD_INTERPRET_COST} маны. Не хватает ${DAILY_CARD_INTERPRET_COST - total}.` });
      btn.classList.add('is-active');
      openStarsTopup();
      return;
    }

    if (getHeroRemaining() === 0) {
      renderHeroAiLimit(slot);
      btn.classList.add('is-active');
      return;
    }

    // fetch
    btn.disabled = true;
    btn.classList.add('is-loading');
    const orig = btn.querySelector('.hero-ai-btn-icon');
    if (orig) orig.textContent = '⏳';
    try {
      const initData = getInitData();
      const today = DATA.todayKey();
      const res = await fetch('/api/arc/card-interpret?initData=' + encodeURIComponent(initData), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: c.name, reversed: !!c.reversed, date: today })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (res.status === 429 || res.status === 402 || data.error === 'rate_limited' || data.error === 'insufficient_mana') {
          updateFeatureBalance('daily_card_interpret', data);
          renderHeroAiLimit(slot, data);
          btn.classList.add('is-active');
          return;
        }
        throw new Error(data.error || 'fail');
      }
      updateFeatureBalance('daily_card_interpret', data);
      try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch (e) {}
      renderHeroAi(slot, data);
      btn.classList.add('is-active');
      renderDailyCardPriceLabels(c);
    } catch (e) {
      if (orig) orig.textContent = '⚠️';
      setTimeout(() => { if (orig) orig.textContent = '✨'; }, 2500);
    } finally {
      btn.disabled = false;
      btn.classList.remove('is-loading');
      if (orig && orig.textContent === '⏳') orig.textContent = '✨';
    }
  }

  function renderHeroAiLimit(slot, data = {}) {
    const insufficientMana = data && data.error === 'insufficient_mana';
    const text = insufficientMana
      ? escapeHtml(data.message || 'Не хватает маны для AI-расшифровки.')
      : 'Расшифровка карты дня уже использована сегодня. Сброс в полночь UTC.';
    const cta = insufficientMana ? 'Пополнить ману за Stars' : 'Пополнить ману';
    slot.innerHTML = `
      <div class="hero-ai-card ai-limit-box">
        <p>${text}</p>
        <button type="button" class="btn btn-gold" data-stars-topup>${cta}</button>
      </div>`;
    slot.hidden = false;
    const btn = slot.querySelector('[data-stars-topup]');
    if (btn) btn.onclick = openStarsTopup;
  }

  function renderHeroAi(slot, d) {
    slot.innerHTML = `
      <div class="hero-ai-card">
        <div class="hero-ai-header"><span aria-hidden="true">🔮</span> Глубинный разбор</div>
        <p class="hero-ai-meaning">${escapeHtml(d.meaning || '')}</p>
        ${d.advice ? `<p class="hero-ai-line"><span class="hero-ai-label">Совет дня:</span> ${escapeHtml(d.advice)}</p>` : ''}
        ${d.warning ? `<p class="hero-ai-line"><span class="hero-ai-label">Осторожно:</span> ${escapeHtml(d.warning)}</p>` : ''}
      </div>`;
    slot.hidden = false;
  }

  // -- Развёртка дня недели (forecast) -----------------------
  async function openForecastDayDetail(d) {
    haptic('light');
    let panel = $('#forecastDayPanel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'forecastDayPanel';
      panel.className = 'forecast-day-panel overlay-panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      document.body.appendChild(panel);
    }
    const reversed = getForecastDayReversed(d);
    const text = d.card[reversed ? 'reversed' : 'upright'] || '';
    panel.innerHTML = `
      <div class="overlay-backdrop" data-close></div>
      <div class="overlay-card tile-in">
        <button class="overlay-close" data-close aria-label="Закрыть">×</button>
        <div class="forecast-day-header">
          <span class="forecast-day-glyph">${d.card.glyph}</span>
          <div>
            <div class="forecast-day-title">${escapeHtml(d.card.name)}</div>
            <div class="forecast-day-date">${escapeHtml(d.dt)} · ${reversed ? 'перевёрнутая' : 'прямая'}</div>
          </div>
        </div>
        <div class="forecast-day-body">
          <p class="forecast-day-text">${escapeHtml(text)}</p>
          <button class="btn btn-secondary btn-sm" id="forecastAiBtn">✨ AI-расшифровка</button>
          <div class="hero-ai-reading" id="forecastAiSlot" hidden></div>
        </div>
      </div>`;
    panel.hidden = false;
    const close = () => { panel.hidden = true; panel.innerHTML = ''; };
    panel.querySelectorAll('[data-close]').forEach(el => el.onclick = close);
    const aiBtn = panel.querySelector('#forecastAiBtn');
    const aiSlot = panel.querySelector('#forecastAiSlot');
    if (aiBtn && aiSlot) {
      aiBtn.onclick = async () => {
        if (!aiSlot.hidden) { aiSlot.hidden = true; aiSlot.innerHTML = ''; aiBtn.classList.remove('is-active'); return; }
        aiBtn.disabled = true; aiBtn.classList.add('is-loading');
        if (getHeroRemaining() === 0) {
          renderHeroAiLimit(aiSlot);
          aiBtn.classList.add('is-active');
          aiBtn.disabled = false;
          aiBtn.classList.remove('is-loading');
          return;
        }
        try {
          const initData = getInitData();
          const res = await fetch('/api/arc/card-interpret?initData=' + encodeURIComponent(initData), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: d.card.name, reversed })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.ok) {
            if (res.status === 429 || res.status === 402 || data.error === 'rate_limited' || data.error === 'insufficient_mana') {
              updateFeatureBalance('daily_card_interpret', data);
              renderHeroAiLimit(aiSlot, data);
              aiBtn.classList.add('is-active');
              return;
            }
            throw new Error(data.error || 'fail');
          }
          updateFeatureBalance('daily_card_interpret', data);
          renderHeroAi(aiSlot, data);
          aiBtn.classList.add('is-active');
        } catch (e) {
          aiBtn.textContent = '⚠️ не удалось';
          setTimeout(() => aiBtn.textContent = '✨ AI-расшифровка', 2500);
        } finally {
          aiBtn.disabled = false; aiBtn.classList.remove('is-loading');
        }
      };
    }
  }

  // -- Wire events (idempotent через .onclick) --------------
  function wireEvents() {
    const $bind = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };
    $('#btnRefreshTarot').onclick = refreshTarot;
    $('#btnShareTarot').onclick   = shareTarot;
    $$('#dailyJournal [data-daily-outcome]').forEach((btn) => {
      btn.onclick = (e) => { e.stopPropagation(); setDailyOutcome(btn.dataset.dailyOutcome); };
    });
    const dailyNote = $('#dailyJournalNote');
    if (dailyNote) {
      let dailyNoteTimer = null;
      const saved = $('#dailyJournalSaved');
      const saveNow = () => {
        setDailyNote(dailyNote.value);
        if (saved) saved.textContent = 'сохранено';
        flashToast('Заметка сохранена');
      };
      dailyNote.onclick = (e) => e.stopPropagation();
      dailyNote.oninput = () => {
        if (saved) saved.textContent = 'пишу…';
        const shareBtn = $('#dailyJournalShare');
        if (shareBtn) { shareBtn.disabled = true; shareBtn.hidden = true; }
        clearTimeout(dailyNoteTimer);
        dailyNoteTimer = setTimeout(() => {
          setDailyNote(dailyNote.value);
          if (saved) saved.textContent = 'сохранено автоматически';
        }, 600);
      };
      $bind('#dailyJournalSave', (e) => { if (e && e.stopPropagation) e.stopPropagation(); saveNow(); });
      $bind('#dailyJournalShare', (e) => { if (e && e.stopPropagation) e.stopPropagation(); shareDailyJournalNote(); });
      $bind('#dailyManaCheckinBtn', (e) => { if (e && e.stopPropagation) e.stopPropagation(); claimDailyManaCheckin(); });
      $bind('#dailyJournalHistoryBtn', (e) => { if (e && e.stopPropagation) e.stopPropagation(); toggleDailyJournalHistory(); });
    }

    // -- AI-расшифровка карты дня ----------------------------
    const aiBtn = $('#btnHeroAi');
    if (aiBtn) {
      aiBtn.onclick = handleHeroAiInterpret;
    }
    // Toggle «Полная расшифровка» — плавно разворачивает/скрывает блок под кнопкой
    const tg = $('#btnReadingToggle');
    if (tg) {
      tg.onclick = () => {
        const block = $('#heroReadingBlock');
        if (!block) return;
        const willOpen = block.hidden;
        if (willOpen) {
          // Чтобы tile-in анимация отыграла — снимаем hidden, форс-reflow, потом перезапуск анимации
          block.hidden = false;
          block.style.animation = 'none';
          // eslint-disable-next-line no-unused-expressions
          block.offsetHeight; // reflow
          block.style.animation = '';
        } else {
          block.hidden = true;
        }
        tg.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      };
    }
    // Hero-card больше не открывает портал: пользователь нажимал карту дня и улетал в расклад.
    const hero = $('#heroCard');
    if (hero) {
      hero.style.cursor = 'default';
      hero.removeAttribute('role');
      hero.removeAttribute('aria-label');
      hero.onclick = null;
    }

    (function initOnboarding() {
      const overlay = $('#onboarding');
      if (!overlay) return;
      if (localStorage.getItem('onb_seen') !== '1') overlay.hidden = false;
      let step = 1;
      const total = overlay.querySelectorAll('.onb-step').length;
      function show(n) {
        overlay.querySelectorAll('.onb-step').forEach(s => { s.hidden = +s.dataset.step !== n; });
        overlay.querySelectorAll('.onb-dots .dot').forEach((d, i) => d.classList.toggle('is-active', i === n - 1));
        const next = overlay.querySelector('.onb-next');
        if (next) next.textContent = n === total ? 'На главный экран ✦' : 'Далее →';
        step = n;
      }
      function finish(action) {
        localStorage.setItem('onb_seen', '1');
        overlay.hidden = true;
        requestAnimationFrame(() => {
          if (action === 'ask') return openHomeAskFlow();
          if (action === 'dream') return openDreamPanel();
          const hero = $('#heroCard') || $('#dailyCard') || $('#btnReadingToggle');
          if (hero && hero.scrollIntoView) {
            try { hero.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
          }
        });
      }
      $bind('.onb-skip', () => finish('daily'));
      overlay.querySelectorAll('[data-onb-action]').forEach((btn) => {
        btn.addEventListener('click', () => finish(btn.dataset.onbAction || 'daily'));
      });
      $bind('.onb-next', () => {
        if (step < total) show(step + 1);
        else finish('daily');
      });
    })();

    // Тема фиксирована: dark. Переключатель убран (v3.63).
    document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.removeItem('theme'); } catch {}
    // saveCheckin удалён — no-op safety
    $bind('#btnProfileEdit',  toggleProfileEdit);
    $bind('#btnProfileSave',  saveProfileToBot);
    $bind('#btnProfileCopy',  openProfileInBot);
    $bind('#btnProfileStartBot', openProfileStartBot);

    const resyncProfile = async () => {
      if (!state.profileSync.userNotStartedBot) return;
      await loadProfileFromBackend();
      renderProfile();
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resyncProfile();
    });
    window.addEventListener('focus', resyncProfile);
    window.addEventListener('astro:history-updated', () => {
      refreshHistoryFromBackend().catch(() => {});
      updateHistoryBadge();
    });

    // Primary home actions
    $bind('#todayCardBtn',    openDailyCardDeepDive);
    $bind('#dailyCardTeaser', openDailyCardDeepDive);
    $bind('#dailyCardDeepBtn', (e) => { e.stopPropagation(); openDailyCardDeepDive(); });
    $bind('#todayChartBtn',   () => setActiveTab('chart'));
    $bind('#todayCompatBtn',  () => setActiveTab('compat'));
    $bind('#homeAskBtn',      () => openHomeAskFlow());
    $bind('#homeLoveBtn',     () => openHomeAskFlow('Что сейчас происходит в любви и какой шаг мне сделать?'));
    $bind('#homeDayBtn',      () => { try { $('#heroCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {} });
    $bind('#homeDreamBtn',    openDreamPanel);
    $bind('#homeManaCard',    openStarsPanel);
    $bind('#homeAskSubmit',  submitHomeAskFlow);
    $bind('#homeAskOpenCards', openGadaniePortal);
    $$('[data-home-ask-chip]').forEach(btn => { btn.onclick = () => { const input = $('#homeAskInput'); if (input) { input.value = btn.dataset.question || ''; input.focus(); } }; });
    $$('[data-home-spread]').forEach(btn => { btn.onclick = () => { $$('[data-home-spread]').forEach(b => b.classList.toggle('is-active', b === btn)); }; });
    renderHomeAskMeter();

    // Quick tiles
    $bind('#tileBiorhythm',   tileBiorhythmClick);
    // tileEvening удалён: чек-ин выпилен
    $bind('#tileGadanie',     openGadaniePortal);
    $bind('#tileMoon',        openMoonPanel);
    $bind('#btnOpenMoon',     openMoonPanel);
    $bind('#btnShareMoon',    shareMoonCard);
    $bind('#tileForecast',    openForecastPanel);
    $bind('#tileProfile',     () => setActiveTab('profile'));
    $bind('#tileChart',       () => setActiveTab('chart'));
    $bind('#tileCompat',      () => setActiveTab('compat'));
    $bind('#tileJournal',     openDailyJournal);
    $bind('#tileDream',       openDreamPanel);
    $bind('#tileStars',       () => setActiveTab('stars'));
    $bind('#btnStarsTopup',   openStarsTopup);
    $bind('#btnDreamShort',   () => submitDreambook('short'));
    $bind('#btnDreamDeep',    () => submitDreambook('deep'));
    $$('[data-dream-chip]').forEach(btn => { btn.onclick = () => { const t = $('#dreamText'); if (t) { t.value = btn.dataset.dreamChip || ''; t.focus(); } }; });

    // User chip — открывает профиль
    const chip = $('#userChip');
    if (chip) {
      chip.onclick = openProfilePanel;
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      chip.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openProfilePanel(); } };
    }

    // Panel close buttons
    $$('.panel-close').forEach(b => {
      b.onclick = () => closePanel(b.dataset.screen);
    });

    // Arc portal: home link closes any active spread (back to default 'one')
    const home = $('#arcHomeLink');
    if (home) {
      home.onclick = (e) => {
        e.preventDefault();
        if (window.ArcApp && window.ArcApp.setSpread) window.ArcApp.setSpread('one');
      };
    }

    // History (главная) — кнопки "Очистить" / "Открыть гадание" / empty-CTA
    const btnClear = $('#btnHomeHistoryClear');
    if (btnClear) {
      btnClear.onclick = async () => {
        const items = loadHistory();
        if (!items.length) return;
        if (!confirm('Очистить всю историю раскладов?')) return;
        const localIds = items.map(it => it && it.id);
        const backendIds = await fetchBackendHistoryIds();
        await deleteBackendHistoryItems(backendIds.length ? backendIds : localIds);
        try { localStorage.removeItem('arhHistory'); } catch (_) {}
        _historyCache = [];
        _historyExpanded.clear();
        _historyFilter = 'all';
        syncHistoryFilterChips();
        renderHomeHistory();
        updateHistoryBadge();
        haptic && haptic('medium');
      };
    }
    const btnOpen = $('#btnHomeHistoryOpen');
    if (btnOpen) {
      btnOpen.onclick = () => {
        // Переключаемся на таб "arc" (открывает arc-portal)
        setActiveTab('arc');
      };
    }
    const emptyCta = $('#homeHistoryEmptyCta');
    if (emptyCta) {
      emptyCta.onclick = () => setActiveTab('arc');
    }

    // Фильтры истории
    const filters = $('#homeHistoryFilters');
    if (filters) {
      filters.querySelectorAll('.arc-history-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const f = chip.dataset.filter || 'all';
          if (_historyFilter === f) return;
          _historyFilter = f;
          syncHistoryFilterChips();
          renderHomeHistory();
          haptic && haptic('light');
        });
      });
    }

    // Реакция на изменения истории из других вкладок/arc-portal
    window.addEventListener('storage', (e) => {
      if (e.key === 'arhHistory') {
        renderHomeHistory();
        updateHistoryBadge();
      }
    });

    // Mood buttons (используем onclick на каждой кнопке, не addEventListener)
    $$('.mood-btn').forEach(b => {
      b.onclick = () => selectMood(b);
    });
  }

  // -- BOTTOM TAB BAR ----------------------------------------
  // Делим app на 4 экрана: home / arc / history / profile
  // Логика переключения:
  //  - home: закрыть все panels и arc-portal
  //  - arc (Карты): открыть arc-portal
  //  - stars/history/profile: открыть соответствующую панель как единственный активный экран
  //  - chart/compat: поддерживаются для быстрых тайлов и deep-link навигации
  function wireBottomTabs() {
    const app = $('#app');
    if (app) app.classList.add('has-bottom-tabs');

    const tabs = $$('.bottom-tab');
    if (!tabs.length) return;
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const which = tab.dataset.tab;
        if (!which) return;
        setActiveTab(which);
      });
    });
  }


  function setBottomTabActive(which) {
    $$('.bottom-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === which));
  }

  function openHistoryPanel() {
    closeAllPanels();
    const p = $('#panelHistory');
    if (p) {
      p.hidden = false;
      tileActive('history', true);
      renderHomeHistory();
      try { p.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
    }
  }

  function setActiveTab(which) {
    setBottomTabActive(which);
    switch (which) {
      case 'home': {
        closeAllPanels();
        updateHistoryBadge();
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
        break;
      }
      case 'arc': {
        openGadaniePortal();
        break;
      }
      case 'stars': {
        openStarsPanel();
        break;
      }
      case 'history': {
        openHistoryPanel();
        break;
      }
      case 'profile': {
        openProfilePanel();
        break;
      }
      case 'chart': {
        openChartPanel();
        break;
      }
      case 'compat': {
        openCompatPanel(null);
        break;
      }
    }
  }

  function closeAllPanels() {
    ['panelBiorhythm','panelForecast','panelProfile','panelChart','panelCompat','panelHistory','panelDream','panelStars'].forEach(id => {
      const el = $('#' + id); if (el) el.hidden = true;
    });
    ['biorhythm','forecast','profile','chart','compat','history','dream','stars'].forEach(n => tileActive(n, false));
    const ap = $('#arcPortal');
    if (ap && !ap.hidden) {
      if (window.ArcApp && window.ArcApp.unmount) window.ArcApp.unmount();
      ap.hidden = true;
      tileActive('gadanie', false);
    }
  }

  // -- HISTORY (главная) ------------------------------------
  // Рендерит backend-историю tarot из /api/history (та же, что пишет arc-portal).
  // localStorage оставлен только как offline/fallback до первого успешного ответа.
  let _historyCache = null;
  let _historyLoading = false;

  function normalizeBackendHistoryItem(it) {
    const payload = it && it.payload ? it.payload : {};
    const type = it.type || payload.type || 'tarot';
    return {
      id: it.id,
      type,
      ts: new Date(it.created_at || Date.now()).getTime(),
      deck: payload.deck || 'tarot',
      spread: type === 'dream' ? 'dream' : (payload.spread || 'one'),
      question: it.subtitle || payload.question || payload.dream || '',
      dream: payload.dream || '',
      mood: payload.mood || '',
      mode: payload.mode || '',
      cards: (payload.cards || []).map((c) => ({
        id: c.id || c.name || '',
        name: c.name || c.id || '?',
        reversed: !!c.reversed,
        position: c.position || '',
        advice: c.advice || '',
      })),
      summary: it.interpretation || payload.summary || '',
      interpretation: it.interpretation || '',
    };
  }

  function loadHistoryFallback() {
    try { return JSON.parse(localStorage.getItem('arhHistory') || '[]'); } catch { return []; }
  }
  function loadHistory() {
    return Array.isArray(_historyCache) ? _historyCache : loadHistoryFallback();
  }
  function saveHistory(items) {
    _historyCache = items || [];
    try { localStorage.setItem('arhHistory', JSON.stringify(items || [])); } catch (_) {}
  }
  async function deleteBackendHistoryItem(id) {
    const initData = getInitData();
    if (!initData || id === undefined || id === null) return false;
    try {
      const res = await fetch(`/api/history/${encodeURIComponent(id)}?initData=${encodeURIComponent(initData)}`, { method: 'DELETE' });
      return !!(res && res.ok);
    } catch (_) {
      return false;
    }
  }
  async function fetchBackendHistoryIds() {
    const initData = getInitData();
    if (!initData) return [];
    try {
      const res = await fetch('/api/history?initData=' + encodeURIComponent(initData));
      const data = await res.json().catch(() => ({ ok: false, items: [] }));
      if (!data.ok || !Array.isArray(data.items)) return [];
      return data.items.map(it => it && it.id).filter(id => id !== undefined && id !== null);
    } catch (_) {
      return [];
    }
  }
  async function deleteBackendHistoryItems(ids) {
    const uniqueIds = Array.from(new Set((ids || []).filter(id => id !== undefined && id !== null)));
    if (!uniqueIds.length) return;
    await Promise.all(uniqueIds.map(id => deleteBackendHistoryItem(id)));
  }
  async function refreshHistoryFromBackend() {
    const initData = getInitData();
    if (!initData || _historyLoading) return;
    _historyLoading = true;
    try {
      const res = await fetch('/api/history?initData=' + encodeURIComponent(initData));
      const data = await res.json().catch(() => ({ ok: false, items: [] }));
      if (!data.ok) return;
      _historyCache = (data.items || []).map(normalizeBackendHistoryItem);
      renderHomeHistory(false);
      updateHistoryBadge();
    } catch (_) {
      // keep local fallback; history UI stays usable offline
    } finally {
      _historyLoading = false;
    }
  }
  // Search query (для фильтрации истории по тексту)
  let _historyQuery = '';

  const SPREAD_LABELS = {
    one: 'Одна карта', dream: 'Сонник', three: 'Три карты', five: 'Пять карт',
    relation: 'Отношения', day: 'День', celtic: 'Кельтский крест',
    week: 'Неделя', yesno: 'Да/Нет', horseshoe: 'Подкова',
    love: 'Любовь', mind: 'Разум', mirror: 'Зеркало'
  };
  const SPREAD_ICONS = {
    one: '✦', dream: '🌘', three: '✦✦✦', five: '✦✦✦✦✦',
    relation: '♥', day: '☀', celtic: '✠',
    week: '☾', yesno: '?', horseshoe: '⊃',
    love: '♡', mind: '◐', mirror: '◑'
  };
  // Позиции карт в раскладе (для деталей). Ключи — spreadId.
  const SPREAD_POSITIONS = {
    one: ['Карта'],
    three: ['Прошлое', 'Настоящее', 'Будущее'],
    five: ['Ситуация', 'Препятствие', 'Совет', 'Возможность', 'Итог'],
    relation: ['Вы', 'Партнёр', 'Связь'],
    day: ['Утро', 'День', 'Вечер', 'Ночь', 'Итог дня'],
    celtic: ['Ситуация', 'Препятствие', 'Основа', 'Прошлое', 'Возможность', 'Будущее', 'Вы', 'Окружение', 'Надежды/Страхи', 'Итог'],
    week: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'],
    yesno: ['Ответ'],
    horseshoe: ['Прошлое', 'Настоящее', 'Будущее', 'Совет', 'Внешнее', 'Надежды', 'Итог'],
    love: ['Вы', 'Партнёр', 'Чувства', 'Препятствие', 'Итог'],
    mind: ['Сознание', 'Подсознание', 'Совет'],
    mirror: ['Вы', 'Отражение', 'Суть']
  };

  const monthNames = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
  const dayMonth = (d) => `${d.getDate()} ${monthNames[d.getMonth()]}`;
  const timeStr = (d) => `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;

  // Группировка: { 'today': [...], 'yesterday': [...], 'week': [...], 'earlier': [...] }
  function groupHistoryByDate(items) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 86400000;
    const startOfWeek = startOfToday - 6 * 86400000;
    const groups = { today: [], yesterday: [], week: [], earlier: [] };
    items.forEach((it, i) => {
      const ts = it.ts || 0;
      const entry = Object.assign({}, it, { _origIdx: i });
      if (ts >= startOfToday) groups.today.push(entry);
      else if (ts >= startOfYesterday) groups.yesterday.push(entry);
      else if (ts >= startOfWeek) groups.week.push(entry);
      else groups.earlier.push(entry);
    });
    return groups;
  }

  function dayGroupTitle(key) {
    if (key === 'today') return 'Сегодня';
    if (key === 'yesterday') return 'Вчера';
    if (key === 'week') return 'На этой неделе';
    if (key === 'earlier') return 'Раньше';
    return '';
  }

  // Текущий активный фильтр (state для пере-рендера)
  let _historyFilter = 'all';
  let _historyExpanded = new Set(); // idx раскрытых элементов

  function renderHomeHistory(fetchBackend = true) {
    if (fetchBackend && !Array.isArray(_historyCache)) refreshHistoryFromBackend();
    const list = $('#homeHistoryList');
    const empty = $('#homeHistoryEmpty');
    const filters = $('#homeHistoryFilters');
    const counter = $('#homeHistoryCounter');
    const groupsEl = $('#homeHistoryGroups');
    const actions = $('#homeHistoryActions');
    if (!list) return;

    const allItems = loadHistory();
    const total = allItems.length;

    // Счётчик в заголовке — показываем только когда есть история
    if (counter) {
      if (total > 0) {
        counter.textContent = total > 99 ? '99+' : String(total);
        counter.hidden = false;
      } else {
        counter.hidden = true;
      }
    }

    if (!total) {
      if (filters) filters.hidden = true;
      if (groupsEl) { groupsEl.hidden = true; groupsEl.innerHTML = ''; }
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      if (actions) actions.hidden = true;
      return;
    }

    if (empty) empty.hidden = true;
    if (actions) actions.hidden = false;
    if (filters) filters.hidden = false;
    // Search виден только если есть хотя бы 2 расклада (иначе бессмысленно)
    const searchEl = $('#homeHistorySearch');
    if (searchEl) searchEl.hidden = total < 2;

    // Фильтр
    const now = Date.now();
    const startOfToday = new Date(); startOfToday.setHours(0,0,0,0);
    const startOfWeek = startOfToday.getTime() - 6 * 86400000;
    let items = allItems;
    if (_historyFilter === 'today') {
      items = allItems.filter(h => (h.ts || 0) >= startOfToday.getTime());
    } else if (_historyFilter === 'week') {
      items = allItems.filter(h => (h.ts || 0) >= startOfWeek);
    }

    // Поиск по тексту (вопрос / имя карты / нота)
    const q = (_historyQuery || '').trim().toLowerCase();
    if (q) {
      items = items.filter(h => {
        if ((h.question || '').toLowerCase().includes(q)) return true;
        if ((h.note || '').toLowerCase().includes(q)) return true;
        if ((h.dream || '').toLowerCase().includes(q)) return true;
        if ((h.summary || '').toLowerCase().includes(q)) return true;
        if ((h.spread || '').toLowerCase().includes(q)) return true;
        if (Array.isArray(h.cards) && h.cards.some(c =>
          (c.name || '').toLowerCase().includes(q) ||
          (c.id || '').toLowerCase().includes(q)
        )) return true;
        return false;
      });
    }

    // Регруппировка по дате
    const groups = groupHistoryByDate(items);
    const groupKeys = ['today','yesterday','week','earlier'].filter(k => groups[k].length);

    if (!groupKeys.length) {
      // Фильтр/поиск отсёк всё
      const reason = _historyQuery
        ? `Ничего не найдено по запросу «${escapeHtml(_historyQuery)}»`
        : 'Нет раскладов в выбранном диапазоне.';
      groupsEl.innerHTML = `<div class="arc-history-empty" style="padding:18px 8px">
        <div class="arc-history-empty-text">${reason}</div>
        ${_historyQuery ? '<button type="button" class="btn btn-ghost" data-history-clear-search>Сбросить поиск</button>' : ''}
      </div>`;
      groupsEl.hidden = false;
      list.innerHTML = '';
      const clearSearchBtn = groupsEl.querySelector('[data-history-clear-search]');
      if (clearSearchBtn) clearSearchBtn.onclick = () => clearHistorySearch();
      return;
    }

    groupsEl.hidden = false;
    list.innerHTML = '';
    groupsEl.innerHTML = groupKeys.map(key => {
      const items = groups[key];
      const itemsHtml = items.map(h => renderHistoryItem(h, h._origIdx)).join('');
      return `
        <section class="arc-history-group" data-group="${key}">
          <h3 class="arc-history-group-title">
            <span>${dayGroupTitle(key)}</span>
            <span class="arc-history-group-count">${items.length}</span>
          </h3>
          <ul class="arc-history-list">${itemsHtml}</ul>
        </section>`;
    }).join('');

    // Вешаем обработчики кликов на расклады (раскрытие)
    groupsEl.querySelectorAll('.arc-history-item').forEach(el => {
      el.addEventListener('click', (e) => {
        // Не раскрываем если клик по кнопке внутри
        if (e.target.closest('button, a')) return;
        const idx = el.dataset.idx;
        if (idx === undefined) return;
        if (_historyExpanded.has(idx)) {
          _historyExpanded.delete(idx);
          el.classList.remove('is-expanded');
        } else {
          _historyExpanded.add(idx);
          el.classList.add('is-expanded');
        }
        haptic && haptic('light');
      });
    });

    // Кнопка "Открыть расклад полностью" → модал
    groupsEl.querySelectorAll('[data-history-open]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-history-open'));
        if (!Number.isNaN(idx)) openHistoryReading(idx);
      };
    });
  }

  // Сбросить поиск
  function clearHistorySearch() {
    _historyQuery = '';
    const input = $('#homeHistorySearchInput');
    if (input) input.value = '';
    const clr = $('#homeHistorySearchClear');
    if (clr) clr.hidden = true;
    renderHomeHistory();
  }

  // -- HISTORY READING MODAL ---------------------------------
  // idx — индекс в массиве loadHistory() (оригинальный, нефильтрованный)
  let _historyReadingIdx = -1;
  function openHistoryReading(idx) {
    const items = loadHistory();
    const h = items[idx];
    if (!h) return;
    _historyReadingIdx = idx;

    const d = new Date(h.ts || Date.now());
    const yy = d.getFullYear();
    const dateStr = yy === new Date().getFullYear()
      ? `${dayMonth(d)} · ${timeStr(d)}`
      : `${dayMonth(d)} ${yy} · ${timeStr(d)}`;
    const label = SPREAD_LABELS[h.spread] || h.spread || 'расклад';

    const titleEl = $('#historyReadingTitle');
    if (titleEl) titleEl.textContent = label;
    const spreadEl = $('#historyReadingSpread');
    if (spreadEl) spreadEl.textContent = label;
    const dateEl = $('#historyReadingDate');
    if (dateEl) dateEl.textContent = dateStr;

    const qEl = $('#historyReadingQuestion');
    if (qEl) {
      if (h.type === 'dream' || h.spread === 'dream') {
        const moodTxt = h.mood ? ` · настроение: ${h.mood}` : '';
        qEl.textContent = `Сон: «${h.dream || h.question || ''}»${moodTxt}`;
        qEl.hidden = false;
      } else if (h.question) { qEl.textContent = `«${h.question}»`; qEl.hidden = false; }
      else qEl.hidden = true;
    }

    const cards = (h.cards || []);
    const positions = SPREAD_POSITIONS[h.spread] || cards.map((_, i) => `Позиция ${i+1}`);
    const cardsEl = $('#historyReadingCards');
    if (cardsEl) {
      if (h.type === 'dream' || h.spread === 'dream') {
        cardsEl.innerHTML = `<div class="history-modal-card"><div class="history-modal-card-visual"><div class="history-modal-card-glyph">🌘</div></div><div class="history-modal-card-body"><div class="history-modal-card-pos">${escapeHtml(dreamModeLabel(h.mode))}</div><div class="history-modal-card-name">${escapeHtml(h.mood || 'настроение не указано')}</div></div></div>`;
      } else {
      cardsEl.innerHTML = cards.map((c, i) => {
        const v = resolveCardVisual(h.deck, c.id, c.name || c.id);
        const visual = v.kind === 'image'
          ? `<img class="history-modal-card-img${c.reversed ? ' is-rev' : ''}" src="${escapeHtml(v.src)}" alt="${escapeHtml(v.alt)}" loading="lazy">`
          : `<div class="history-modal-card-glyph${c.reversed ? ' is-rev' : ''}">${v.symbol}</div>`;
        return `
          <div class="history-modal-card">
            <div class="history-modal-card-visual">${visual}</div>
            <div class="history-modal-card-body">
              <div class="history-modal-card-pos">${escapeHtml(positions[i] || ('Карта ' + (i+1)))}</div>
              <div class="history-modal-card-name${c.reversed ? ' is-rev' : ''}">
                ${escapeHtml(c.name || c.id || '')}${c.reversed ? ' <span class="rev-mark">перевёрнутая</span>' : ''}
              </div>
              ${c.advice ? `<div class="history-modal-card-advice">${escapeHtml(c.advice)}</div>` : ''}
            </div>
          </div>
        `;
      }).join('');
      }
    }

    // Итог (если есть)
    const sumEl = $('#historyReadingSummary');
    if (sumEl) {
      if (h.summary && h.summary.trim()) { sumEl.textContent = h.summary; sumEl.hidden = false; }
      else sumEl.hidden = true;
    }

    const modal = $('#historyReadingModal');
    if (modal) {
      modal.hidden = false;
      document.body.classList.add('history-modal-open');
      // Скроллим в начало
      const body = modal.querySelector('.history-modal-body');
      if (body) try { body.scrollTo(0, 0); } catch (_) {}
    }
    haptic && haptic('light');
  }

  function closeHistoryReading() {
    const modal = $('#historyReadingModal');
    if (modal) modal.hidden = true;
    document.body.classList.remove('history-modal-open');
    _historyReadingIdx = -1;
  }

  async function deleteCurrentHistoryReading() {
    if (_historyReadingIdx < 0) return;
    if (!confirm('Удалить этот расклад из истории? Действие необратимо.')) return;
    const items = loadHistory();
    if (_historyReadingIdx >= items.length) { closeHistoryReading(); return; }
    const item = items[_historyReadingIdx];
    await deleteBackendHistoryItem(item && item.id);
    items.splice(_historyReadingIdx, 1);
    saveHistory(items);
    _historyExpanded.delete(String(_historyReadingIdx));
    closeHistoryReading();
    renderHomeHistory();
    updateHistoryBadge();
    haptic && haptic('medium');
  }

  async function shareCurrentHistoryReading() {
    if (_historyReadingIdx < 0) return;
    const items = loadHistory();
    const h = items[_historyReadingIdx];
    if (!h) return;
    const label = SPREAD_LABELS[h.spread] || h.spread || 'расклад';
    const d = new Date(h.ts || Date.now());
    const dateStr = `${dayMonth(d)} ${d.getFullYear()}`;
    const cards = (h.cards || []);
    const positions = SPREAD_POSITIONS[h.spread] || cards.map((_, i) => `Карта ${i+1}`);
    let text;
    if (h.type === 'dream' || h.spread === 'dream') {
      text = buildDreamShareText({ dream: h.dream || h.question, mood: h.mood, mode: h.mode, interpretation: h.interpretation || h.summary });
    } else {
      const cardsTxt = cards.map((c, i) => {
        const pos = positions[i] || `Карта ${i+1}`;
        const rev = c.reversed ? ' (перевёрнутая)' : '';
        return `  ${i+1}. ${pos}: ${c.name || c.id || '—'}${rev}`;
      }).join('\n');
      const qTxt = h.question ? `\nВопрос: «${h.question}»\n` : '';
      const noteTxt = (h.note && h.note.trim()) ? `\nЗаметка: ${h.note}\n` : '';
      text = `✦ ${label} — ${dateStr}${qTxt}\nКарты:\n${cardsTxt}${noteTxt}\n— разложено в Астро-бурлаб`;
    }

    // 1) Прямой шеринг в Telegram (мобильный, открывает chooser)
    if (tg && tg.openTelegramLink) {
      try {
        const shareUrl = `https://t.me/share/url?url=${encodeURIComponent('https://t.me/astro_byrbot')}&text=${encodeURIComponent(text)}`;
        tg.openTelegramLink(shareUrl);
        haptic && haptic('light');
        return;
      } catch (_) {}
    }
    // 2) Web Share API (если доступен)
    if (navigator.share) {
      try {
        await navigator.share({ title: `Расклад: ${label}`, text });
        haptic && haptic('light');
        return;
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    // 3) Clipboard fallback
    try {
      await navigator.clipboard.writeText(text);
      toast && toast('Скопировано в буфер обмена');
    } catch (_) {
      // last resort: показать текст в модалке через prompt
      try { window.prompt('Скопируйте текст:', text); } catch (_) {}
    }
  }

  // Привязка обработчиков модала (один раз)
  function wireHistoryReadingModal() {
    const modal = $('#historyReadingModal');
    if (!modal) return;
    modal.querySelectorAll('[data-history-modal-close]').forEach(el => {
      el.onclick = (e) => { e.preventDefault(); closeHistoryReading(); };
    });
    const del = $('#historyReadingDelete');
    if (del) del.onclick = deleteCurrentHistoryReading;
    const share = $('#historyReadingShare');
    if (share) share.onclick = shareCurrentHistoryReading;
    // Закрытие по Esc
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) closeHistoryReading();
    });
  }

  // Привязка поиска (один раз)
  function wireHistorySearch() {
    const input = $('#homeHistorySearchInput');
    const clr = $('#homeHistorySearchClear');
    if (!input) return;
    let t = null;
    input.addEventListener('input', () => {
      if (clr) clr.hidden = !input.value;
      clearTimeout(t);
      t = setTimeout(() => {
        _historyQuery = input.value;
        renderHomeHistory();
      }, 120);
    });
    if (clr) clr.onclick = () => { clearHistorySearch(); input.focus(); };
  }

  // Резолвим мини-визуал карты по (deck, id).
  // Возвращает { kind: 'image' | 'symbol', src?, symbol?, alt }.
  // history сохраняет только {id,name,reversed} — image отсутствует.
  // Поэтому достаём image из глобальных DECK_* массивов (те же данные, что и arc-app.js).
  function resolveCardVisual(deck, id, fallbackName) {
    const arr = (
      deck === 'tarot'     ? window.DECK_TAROT     :
      deck === 'lenormand' ? window.DECK_LENORMAND :
      deck === 'gypsy'     ? window.DECK_GYPSY     :
      deck === 'runes'     ? window.DECK_RUNES     :
      deck === 'playing'   ? window.DECK_PLAYING   : null
    );
    const card = arr && Array.isArray(arr) ? arr.find(c => c.id === id) : null;
    if (card && card.image) {
      return { kind: 'image', src: card.image, alt: card.name || fallbackName || id };
    }
    const sym = (card && card.symbol) || '✦';
    return { kind: 'symbol', symbol: sym, alt: fallbackName || id };
  }

  function renderHistoryItem(h, origIdx) {
    const d = new Date(h.ts || Date.now());
    const dateStr = d.getFullYear() === new Date().getFullYear() ? `${dayMonth(d)} · ${timeStr(d)}` : `${dayMonth(d)} ${d.getFullYear()} · ${timeStr(d)}`;
    const label = SPREAD_LABELS[h.spread] || h.spread || 'расклад';
    const icon = SPREAD_ICONS[h.spread] || '✦';
    const cards = (h.cards || []);
    const isDream = h.type === 'dream' || h.spread === 'dream';
    const previewCards = isDream
      ? `<span class="arc-history-card-chip">🌘 ${escapeHtml(h.mode === 'deep' ? 'глубокий разбор' : 'короткий разбор')}</span>`
      : cards.slice(0, 4).map(c =>
        `<span class="arc-history-card-chip${c.reversed ? ' is-rev' : ''}">${escapeHtml(c.name || c.id || '')}${c.reversed ? ' ⇄' : ''}</span>`
      ).join('') + (cards.length > 4 ? `<span class="arc-history-card-chip arc-history-more">+${cards.length - 4}</span>` : '');
    const q = isDream
      ? `<div class="arc-history-q">Сон: «${escapeHtml(h.dream || h.question || '')}»${h.mood ? ` · ${escapeHtml(h.mood)}` : ''}</div>`
      : (h.question ? `<div class="arc-history-q">«${escapeHtml(h.question)}»</div>` : '');
    const note = (h.note && h.note.trim()) ? `<div class="arc-history-note">✎ ${escapeHtml(h.note)}</div>` : '';

    // Детали: визуал карты (как выпала) + позиция + имя + расшифровка (advice)
    const positions = SPREAD_POSITIONS[h.spread] || cards.map((_, i) => `Позиция ${i+1}`);
    const detailsHtml = isDream ? `
      <div class="arc-history-details">
        <div class="arc-history-note">${escapeHtml(h.summary || 'Разбор сна сохранён.')}</div>
        <div class="arc-history-note">Режим: ${escapeHtml(dreamModeLabel(h.mode))}${h.mood ? ` · настроение: ${escapeHtml(h.mood)}` : ''}</div>
        <button type="button" class="arc-history-open-full" data-history-open="${origIdx}">🌘 Открыть сонник полностью</button>
      </div>
    ` : cards.length > 0 ? `
      <div class="arc-history-details">
        ${cards.map((c, i) => {
          const v = resolveCardVisual(h.deck, c.id, c.name || c.id);
          const visual = v.kind === 'image'
            ? `<img class="arc-history-detail-img${c.reversed ? ' is-rev' : ''}" src="${escapeHtml(v.src)}" alt="${escapeHtml(v.alt)}" loading="lazy">`
            : `<div class="arc-history-detail-glyph${c.reversed ? ' is-rev' : ''}">${v.symbol}</div>`;
          return `
          <div class="arc-history-detail-card">
            <div class="arc-history-detail-visual">${visual}</div>
            <div class="arc-history-detail-body">
              <div class="arc-history-detail-pos">${escapeHtml(positions[i] || ('Карта ' + (i+1)))}</div>
              <div class="arc-history-detail-name${c.reversed ? ' is-rev' : ''}">
                ${escapeHtml(c.name || c.id || '')}${c.reversed ? ' <span class="rev-mark">перевёрнутая</span>' : ''}
              </div>
              ${c.advice ? `<div class="arc-history-detail-advice">${escapeHtml(c.advice)}</div>` : ''}
            </div>
          </div>
        `;}).join('')}
        <button type="button" class="arc-history-open-full" data-history-open="${origIdx}">✦ Открыть расклад полностью</button>
      </div>
    ` : '';

    return `<li class="arc-history-item${_historyExpanded.has(String(origIdx)) ? ' is-expanded' : ''}" data-idx="${origIdx}">
      <div class="arc-history-item-header">
        <span class="arc-history-spread"><span class="arc-history-spread-icon">${escapeHtml(icon)}</span>${escapeHtml(label)}</span>
        <span class="arc-history-date">${dateStr}</span>
      </div>
      ${q}
      ${note}
      <div class="arc-history-cards">${previewCards}</div>
      ${detailsHtml}
    </li>`;
  }

  function updateHistoryBadge() {
    const badge = $('#historyCount');
    if (!badge) return;
    const n = loadHistory().length;
    if (n > 0) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  // Синхронизировать активный класс на чипах фильтра
  function syncHistoryFilterChips() {
    $$('.arc-history-chip').forEach(c => {
      c.classList.toggle('is-active', c.dataset.filter === _historyFilter);
    });
  }

  // -- HERO FLIP CARD ---------------------------------------
  function wireHeroFlip() {
    const card = $('#heroTarotCard');
    if (!card) return;
    // Click-to-toggle flip
    const onToggle = (e) => {
      // Не флипаем по клику на кнопки внутри hero-card-actions
      if (e.target && e.target.closest && e.target.closest('button, a, input, select, textarea')) return;
      const cur = card.dataset.state || 'back';
      card.dataset.state = cur === 'back' ? 'flipped' : 'back';
    };
    card.addEventListener('click', onToggle);
    // Клавиатура (Enter/Space) — у карты tabindex=0
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle(e);
      }
    });
  }

  // -- Boot -------------------------------------------------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
