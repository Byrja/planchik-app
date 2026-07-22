// app.js — UI-контроллер Mini App. TMA-safe.

(function () {
  'use strict';

  // ── Telegram WebApp detection ────────────────────────────
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

  // ── State ────────────────────────────────────────────────
  const _user = parseUser();
  function enrichProfile(p) {
    if (!p) return null;
    if (_user.id) p.telegramId = _user.id;
    return p;
  }

  // ── Evening shim (no-op: чек-ин выпилен, но код app.js ещё зовёт Evening.*) ──
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
    checkins: Evening.last30()
  };

  function setProfile(p) {
    state.profile = enrichProfile(p);
    Evening.saveProfile(p);
  }

  function parseUser() {
    const startParam = (tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param) || '';
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      const u = tg.initDataUnsafe.user;
      return { id: u.id, name: u.first_name || 'друг', username: u.username || null, photo: u.photo_url || null, startParam };
    }
    // Dev fallback (открыли в браузере напрямую)
    return { id: 0, name: 'друг', username: null, photo: null, startParam };
  }

  // ── Compat deep-link ─────────────────────────────────────
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

  // ── DOM refs ─────────────────────────────────────────────
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ── Init ─────────────────────────────────────────────────
  function init() {
    // Landing gate: показываем, если открыли не из Telegram.
    // В Telegram всегда есть initDataUnsafe.user; в чистом браузере — нет.
    const inTelegram = !!(tg && tg.initDataUnsafe && tg.initDataUnsafe.user);
    const gate = document.getElementById('landingGate');
    if (gate) {
      if (inTelegram) {
        gate.hidden = true;
        document.body.classList.remove('landing-mode');
      } else {
        gate.hidden = false;
        document.body.classList.add('landing-mode');
        // Если доступен tg.openTelegramLink — подменим href на нативный вызов
        const cta = document.getElementById('landingCtaOpen');
        if (cta && tg && tg.openTelegramLink) {
          cta.addEventListener('click', (e) => {
            e.preventDefault();
            try { tg.openTelegramLink(cta.href); } catch (_) { window.location.href = cta.href; }
          });
        }
        // Не инициализируем основной app, если не из Telegram —
        // это сэкономит трафик и избежит ложной «Карты дня» на dev-fallback.
        $('#dateLabel').textContent  = DATA.dateLabel();
        $('#loadedAt').textContent   = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        return;
      }
    }

    $('#dateLabel').textContent  = DATA.dateLabel();
    $('#loadedAt').textContent   = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    renderUser();
    renderTarot();
    renderBiorhythmTile();
    // renderEveningTile(); // removed: чек-ин выпилен
    renderProfile();
    wireEvents();
    wireBottomTabs();
    wireHeroFlip();
    updateHistoryBadge();
    initCardOfDay();
    if (state.user.startParam === 'mychart') {
      setTimeout(openChartPanel, 50);
    }

    // Compat deep-link: /start compat_<tgId>
    const compatTgId = parseCompatStartParam();
    if (compatTgId) {
      setTimeout(() => openCompatPanel(compatTgId), 50);
    }
  }

  // ── Gadanie (arc portal) ─────────────────────────────────
  function openGadaniePortal() {
    closeAllPanels();
    const portal = $('#arcPortal');
    if (!portal) return;
    portal.hidden = false;
    tileActive('gadanie', true);
    // Синхронизировать bottom-tabs (если юзер пришёл через quick-tile)
    $$('.bottom-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === 'arc'));
    if (window.ArcApp && window.ArcApp.mount) {
      window.ArcApp.mount();
    }
    haptic('medium');
    // scroll to top
    setTimeout(() => portal.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
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

  // ── User chip ────────────────────────────────────────────
  function renderUser() {
    const el = $('#userChip');
    if (state.user.photo) {
      el.innerHTML = `<img src="${escapeHtml(state.user.photo)}" alt="">`;
    } else {
      $('#userAvatar').textContent = (state.user.name[0] || '⚜').toUpperCase();
    }
  }

  // ── Tarot Daily ──────────────────────────────────────────
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
  }

  // ── Biorhythm tile (summary) ────────────────────────────
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

  // ── Bio tile (summary) ───────────────────────────────────
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

  // ── Evenin g tile removed ────────────────────────────────
  function _renderEveningRemoved() { /* noop */ }

  // ── Biorhythm panel ─────────────────────────────────────
  function openBiorhythmPanel() {
    closeAllPanels();
    const panel = $('#panelBiorhythm');
    panel.hidden = false;
    tileActive('biorhythm', true);

    if (!state.profile || !state.profile.birthYear) {
      $('#bioContent').innerHTML = '<div class="bio-empty"><p>Нужен день рождения для расчёта.</p><button type="button" class="btn btn-primary bio-cta" id="bioCtaOpenProfile">Заполнить профиль →</button></div>';
      const cta = $('#bioCtaOpenProfile');
      if (cta) cta.onclick = openProfilePanel;
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

  // ── Forecast panel (7-day cards) ──────────────────────
  function openForecastPanel() {
    closeAllPanels();
    $('#panelForecast').hidden = false;
    tileActive('forecast', true);
    haptic('light');
    // CTA в empty-state
    const cta = $('#forecastCtaOpenProfile');
    if (cta) cta.onclick = openProfilePanel;
    renderWeekForecast();
  }

  function renderWeekForecast() {
    const list = $('#forecastList');
    const content = $('#forecastContent');
    if (!list || !content) return;
    const tgId = state.user.id || 1;
    const days = [];
    const today = new Date();
    // 7 дней: сегодня + 6 вперёд
    for (let i = 0; i < 7; i++) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
      const key = DATA.dateKey(d);
      const c = TarotDaily.calc(tgId, key);
      const dt = DATA.dateLabel(d);
      // подсчёт биоритма на этот день, если есть профиль
      let bioLine = null;
      if (state.profile && state.profile.birthYear) {
        const r = Biorhythm.calc(state.profile.birthYear, state.profile.birthMonth, state.profile.birthDay, d);
        const pct = Math.round(((r.physical.value + r.emotional.value + r.intellectual.value) / 3) * 100);
        bioLine = pct;
      }
      days.push({ key, dt, card: c, bioLine });
    }
    const html = days.map((d, i) => {
      const dayShort = i === 0 ? 'Сегодня' : d.dt.split(',')[0];
      return `<li class="forecast-item">
        <span class="forecast-day">${dayShort}</span>
        <span class="forecast-card"><span class="forecast-glyph">${d.card.glyph}</span> ${escapeHtml(d.card.name)}</span>
        <span class="forecast-bio">${d.bioLine !== null ? (d.bioLine > 0 ? '+' : '') + d.bioLine + '%' : '—'}</span>
      </li>`;
    }).join('');
    list.innerHTML = html;
    list.hidden = false;
    // очистим placeholder
    const ph = content.querySelector('#forecastEmpty');
    if (ph) ph.remove();
    // подсветим «сегодня»
    const items = list.querySelectorAll('.forecast-item');
    if (items[0]) items[0].classList.add('is-today');
  }

  // ── Profile panel ───────────────────────────────────────
  function openProfilePanel() {
    closeAllPanels();
    $('#panelProfile').hidden = false;
    tileActive('profile', true);
    haptic('light');
    renderProfile();
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
      { label: 'Имя',          val: p && p.name ? p.name : null, key: 'name', kind: 'text', placeholder: 'Имя', hint: 'для натальной карты нужно полное ФИО' },
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
      $('#profileFields').innerHTML = fields.map(inputHtml).join('');
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
      $('#profileFields').innerHTML = fields.map(f =>
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

  // ── Tile highlight + panel close ────────────────────────
  function tileActive(name, on) {
    const map = { biorhythm:'tileBiorhythm', forecast:'tileForecast', profile:'tileProfile', chart:'tileChart', gadanie:'tileGadanie' };
    const el = $('#' + map[name]);
    if (el) el.classList.toggle('is-active', on);
  }
  function closeAllPanels() {
    ['panelBiorhythm','panelForecast','panelProfile','panelChart'].forEach(id => {
      const el = $('#' + id); if (el) el.hidden = true;
    });
    ['biorhythm','forecast','profile','chart'].forEach(n => tileActive(n, false));
    // arc portal
    const ap = $('#arcPortal');
    if (ap && !ap.hidden) {
      if (window.ArcApp && window.ArcApp.unmount) window.ArcApp.unmount();
      ap.hidden = true;
      tileActive('gadanie', false);
    }
  }

  // ── Chart panel ─────────────────────────────────────────
  function openChartPanel() {
    closeAllPanels();
    $('#panelChart').hidden = false;
    tileActive('chart', true);
    haptic('light');
    renderChart();
  }

  // ── Compat panel (deep-link compat_<tgId>) ──────────────
  let _compatPartnerTgId = null; // хранится для share

  function openCompatPanel(partnerTgId) {
    if (!tg || !tg.initData) {
      // Не открываем без initData — иначе API отдаст 401
      flashToast('Открой через Telegram');
      return;
    }
    if (!state.user.id) {
      flashToast('Сначала нажми /start в боте');
      return;
    }
    _compatPartnerTgId = partnerTgId;
    closeAllPanels();
    const panel = $('#panelCompat');
    panel.hidden = false;
    tileActive('compat', true);
    haptic('light');
    setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    loadCompat(partnerTgId);
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
    if (errCode === 'partner_no_profile') {
      msg = 'У партнёра пока нет заполненного профиля.\nПопроси его нажать /start у бота и заполнить дату рождения.';
    } else if (errCode === 'caller_no_profile') {
      msg = 'Сначала заполни свой профиль — открой «Профиль» на главной.';
    } else if (errCode === 'partner_not_started_bot') {
      msg = 'Этот пользователь ещё не запускал бота.\nПопроси его нажать /start у @astro_byrbot.';
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
      </div>
    `;
    const closeBtn = root.querySelector('[data-screen="compat"]');
    if (closeBtn) closeBtn.onclick = () => closePanel('compat');
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

  function shareCompat(data, partnerTgId, nameA, nameB) {
    const { score = 0, category = 'average' } = data || {};
    const catLabel = COMPAT_CATEGORY_LABEL[category] || '';
    const text = `🔮 ${nameA} & ${nameB} — ${catLabel} совместимость: ${Math.round(score)}/100\n\nПосчитай свою 👇`;
    const shareUrl = 'https://t.me/astro_byrbot?start=compat_' + (state.user.id || '');
    const t = window.TelegramApp && window.TelegramApp.tg;
    const tgShareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(shareUrl) + '&text=' + encodeURIComponent(text);
    if (t && t.openTelegramLink) {
      try { t.openTelegramLink(tgShareUrl); haptic('light'); return; } catch (e) {}
    }
    if (navigator.share) {
      try { navigator.share({ title: 'Совместимость — Гадалка', text, url: shareUrl }).catch(() => {}); return; } catch (e) {}
    }
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text + '\n' + shareUrl).then(() => flashToast('Скопировано в буфер'));
    } else {
      flashToast('Шаринг недоступен');
    }
  }

  function renderChart() {
    const root = $('#chartContent');
    if (!root) return;
    const p = state.profile;
    if (!p || !p.birthYear) {
      root.innerHTML = `
        <div class="chart-empty">
          <svg viewBox="0 0 32 32" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="16" cy="16" r="11" fill="currentColor" fill-opacity="0.1"/>
            <path d="M16 8v8l5 5"/>
          </svg>
          <p>Для натальной карты нужен профиль: имя, дата, время и место рождения.</p>
          <button type="button" class="btn btn-primary" id="chartCtaOpenProfile">Заполнить профиль →</button>
        </div>`;
      const cta = $('#chartCtaOpenProfile');
      if (cta) cta.onclick = openProfilePanel;
      return;
    }
    const chart = NatalChart.calc(p);
    if (!chart) {
      root.innerHTML = '<p class="chart-empty">Не удалось рассчитать карту.</p>';
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
    `;
    renderPlanetTable(chart.planets);
    renderAspects(chart.aspects);
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

  function sendToBot(type, payload) {
    const tg = window.TelegramApp && window.TelegramApp.tg;
    if (tg && tg.sendData) {
      try {
        tg.sendData(JSON.stringify({ type, payload }));
        return true;
      } catch (e) { /* noop */ }
    }
    return false;
  }

  function saveProfileToBot() {
    if (!state.profile || !state.profile.birthYear) {
      flashToast('Заполни дату рождения');
      return;
    }
    const p = state.profile;
    const payload = {
      name: p.name || undefined,
      lastName: p.lastName || undefined,
      birthYear:  p.birthYear,
      birthMonth: p.birthMonth,
      birthDay:   p.birthDay,
      birthTime:  p.birthTime || undefined,
      birthPlace: p.birthPlace || undefined,
      timezone: (p.timezone !== undefined ? p.timezone : (Intl.DateTimeFormat().resolvedOptions().timeZone || undefined)),
    };
    const ok = sendToBot('profile_update', payload);
    if (ok) {
      Evening.saveProfile(p);
      flashToast('Профиль отправлен в бот');
      haptic('success');
      profileEditing = false;
      renderProfile();
    } else {
      flashToast('Не удалось — открой через кнопку «Открыть в боте»');
    }
  }

  function openProfileInBot() {
    const tg = window.TelegramApp && window.TelegramApp.tg;
    const url = 'https://t.me/astro_byrbot?start=profile';
    if (tg && tg.openTelegramLink) {
      try { tg.openTelegramLink(url); haptic('light'); return; } catch (e) {}
    }
    if (tg && tg.openLink) {
      try { tg.openLink(url); haptic('light'); return; } catch (e) {}
    }
    // fallback (dev / desktop browser)
    window.open(url, '_blank', 'noopener');
  }
  function closePanel(name) {
    $('#panel' + name[0].toUpperCase() + name.slice(1)).hidden = true;
    tileActive(name, false);
  }

  // ── Tarot refresh + share ────────────────────────────────
  function refreshTarot() {
    haptic('medium');
    const tgId = state.user.id || 1;
    const date = DATA.todayKey();
    TarotDaily.bumpSalt(tgId, date);
    renderTarot();
    flashToast('Новая карта вытянута');
  }
  function shareTarot() {
    const c = TarotDaily.calc(state.user.id || 1, DATA.todayKey());
    const text = TarotDaily.formatShare(c);
    const tg = window.TelegramApp && window.TelegramApp.tg;
    // 1) Пробуем отправить в бот через sendData
    if (tg && tg.sendData) {
      try {
        tg.sendData(JSON.stringify({ type: 'tarot', payload: { id: c.id, name: c.name, upright: c.upright, mood: c.mood, glyph: c.glyph } }));
        flashToast('Отправлено в бот');
        haptic('light');
        return;
      } catch (e) { /* fallback */ }
    }
    // 2) Fallback: Telegram share dialog / native share
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

  // ── Evening save ────────────────────────────────────────
  function selectMood(btn) {
    state.mood = Number(btn.dataset.mood);
    $$('.mood-btn').forEach(b => b.classList.toggle('is-selected', b === btn));
    haptic('selection');
  }
  // saveCheckin удалён: чек-ин выпилен из UI

  // ── Haptics (no-op если TG недоступен) ──────────────────
  function haptic(kind) {
    if (tg && tg.HapticFeedback) {
      try {
        const map = { light: 'impactLight', medium: 'impactMedium', heavy: 'impactHeavy', success: 'notificationSuccess', error: 'notificationError', selection: 'selectionChanged' };
        const fn = tg.HapticFeedback[map[kind] || 'impactLight'];
        if (fn) fn.call(tg.HapticFeedback);
      } catch (e) { /* noop */ }
    }
  }

  // ── Toast ────────────────────────────────────────────────
  let toastT;
  function flashToast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-shown');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('is-shown'), 2200);
  }

  // ── Escape ───────────────────────────────────────────────
  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ── Wire events (idempotent через .onclick) ──────────────
  function wireEvents() {
    $('#btnRefreshTarot').onclick = refreshTarot;
    $('#btnShareTarot').onclick   = shareTarot;
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
    // Hero-card кликабельна — открывает гадание
    const hero = $('#heroCard');
    if (hero) {
      hero.style.cursor = 'pointer';
      hero.setAttribute('role', 'button');
      hero.setAttribute('aria-label', 'Открыть гадание');
      hero.onclick = (e) => {
        // Не открывать, если клик на кнопке
        if (e.target.closest('button')) return;
        openGadaniePortal();
      };
    }
    const $bind = (sel, fn) => { const el = $(sel); if (el) el.onclick = fn; };

    // ── Onboarding (B1): first-run tour, dismissed once ───
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
        if (next) next.textContent = n === total ? 'Поехали! ✦' : 'Далее →';
        step = n;
      }
      $bind('.onb-skip', () => { localStorage.setItem('onb_seen', '1'); overlay.hidden = true; });
      $bind('.onb-next', () => {
        if (step < total) show(step + 1);
        else { localStorage.setItem('onb_seen', '1'); overlay.hidden = true; }
      });
    })();

    // ── Theme toggle (B2): light/dark, persisted + system pref ──
    (function initTheme() {
      const stored = localStorage.getItem('theme');
      const initial = stored || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
      document.documentElement.setAttribute('data-theme', initial);
      $bind('#themeToggle', () => {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
      });
    })();
    // saveCheckin удалён — no-op safety
    $bind('#btnProfileEdit',  toggleProfileEdit);
    $bind('#btnProfileSave',  saveProfileToBot);
    $bind('#btnProfileCopy',  openProfileInBot);

    // Quick tiles
    $bind('#tileBiorhythm',   tileBiorhythmClick);
    // tileEvening удалён: чек-ин выпилен
    $bind('#tileGadanie',     openGadaniePortal);
    $bind('#tileForecast',    openForecastPanel);
    $bind('#tileProfile',     openProfilePanel);
    $bind('#tileChart',       openChartPanel);

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
      btnClear.onclick = () => {
        if (!loadHistory().length) return;
        if (!confirm('Очистить всю историю раскладов?')) return;
        try { localStorage.removeItem('arhHistory'); } catch (_) {}
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

  // ── BOTTOM TAB BAR ────────────────────────────────────────
  // Делим app на 4 экрана: home / arc / history / profile
  // Логика переключения:
  //  - home: закрыть все panels и arc-portal
  //  - arc (Карты): открыть arc-portal
  //  - history: открыть #panelHistory (новая секция на главной, не зависит от arc-portal)
  //  - profile: открыть #panelProfile
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

  // ════════════════════════════════════════════════════════
  // CARD OF DAY — мини-расклад на главной
  // ════════════════════════════════════════════════════════
  const COD_CACHE_KEY = 'cod_cache_v1';
  const COD_TTL_MS = 1000 * 60 * 60 * 12; // 12 часов

  function initCardOfDay() {
    const section = document.getElementById('cardOfDay');
    if (!section) return;
    section.hidden = false;

    // 1) показать кеш сразу (если есть и не старше 12ч)
    const cached = readCodCache();
    if (cached) renderCod(cached);

    // 2) подтянуть свежее
    fetchCardOfDay().then((data) => {
      if (data) renderCod(data);
    });

    // 3) кнопки (с haptic-feedback)
    const moreBtn = document.getElementById('codMore');
    const refreshBtn = document.getElementById('codRefresh');
    if (moreBtn) {
      moreBtn.addEventListener('click', () => {
        haptic('light');
        // Открываем таб «Карты» — пользователь сделает расклад вручную
        setActiveTab('arc');
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
      });
    }
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        haptic('light');
        // Принудительно обновить (минуя кеш)
        fetchCardOfDay(true).then((data) => { if (data) renderCod(data); });
      });
    }
  }

  function readCodCache() {
    try {
      const raw = localStorage.getItem(COD_CACHE_KEY);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.card) return null;
      if (Date.now() - (obj.ts || 0) > COD_TTL_MS) return null;
      return obj;
    } catch { return null; }
  }

  function writeCodCache(data) {
    try { localStorage.setItem(COD_CACHE_KEY, JSON.stringify({ ts: Date.now(), ...data })); }
    catch {}
  }

  async function fetchCardOfDay(force = false) {
    const section = document.getElementById('cardOfDay');
    if (section) section.classList.add('cod-loading');
    try {
      const initData = (typeof tg !== 'undefined' && tg.initData) ? tg.initData : '';
      const url = `/api/arc/daily?initData=${encodeURIComponent(initData)}${force ? '&_t=' + Date.now() : ''}`;
      const resp = await fetch(url, { method: 'GET' });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok || !data.card) return null;
      writeCodCache(data);
      return data;
    } catch (e) {
      console.warn('[cod] fetch failed:', e);
      return null;
    } finally {
      if (section) section.classList.remove('cod-loading');
    }
  }

  function renderCod(data) {
    const c = data.card;
    if (!c) return;
    const imgEl  = document.getElementById('codCardImg');
    const glyphEl = document.getElementById('codCardGlyph');
    const nameEl = document.getElementById('codName');
    const moodEl = document.getElementById('codMood');
    const upEl   = document.getElementById('codUpright');
    const advEl  = document.getElementById('codAdvice');
    const dateEl = document.getElementById('codDate');
    if (dateEl) dateEl.textContent = data.date || '';

    if (nameEl) nameEl.textContent = c.name || '—';
    if (moodEl) moodEl.textContent = c.mood || '';
    if (upEl)   upEl.textContent   = c.upright || '';
    if (advEl)  advEl.textContent  = '✦ ' + (c.advice || '');

    // Глиф-эмодзи по элементу (fallback — пока нет assets/cards/ar*.jpg)
    const ELEMENT_GLYPH = {
      '✨': '✨', '🔥': '🔥', '💧': '💧', '🌬️': '🌬️', '🌍': '🌍'
    };
    if (glyphEl) {
      glyphEl.textContent = ELEMENT_GLYPH[c.element] || '🎴';
      glyphEl.style.display = 'flex';
    }
  }

  function setActiveTab(which) {
    $$('.bottom-tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === which));
    switch (which) {
      case 'home': {
        closeAllPanels();
        const portal = $('#arcPortal');
        if (portal) portal.hidden = true;
        // При возврате на главную — обновить бейдж истории (могли тянуть в гадании)
        updateHistoryBadge();
        // Скроллим в начало
        try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (_) { window.scrollTo(0, 0); }
        break;
      }
      case 'arc': {
        // Гадание = arc-portal
        openGadaniePortal();
        break;
      }
      case 'history': {
        closeAllPanels();
        const portal = $('#arcPortal');
        if (portal) portal.hidden = true;
        const p = $('#panelHistory');
        if (p) {
          p.hidden = false;
          renderHomeHistory();
          // Скроллим к началу секции истории (на главной она лежит ниже других панелей)
          try { p.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
        }
        break;
      }
      case 'profile': {
        closeAllPanels();
        const portal = $('#arcPortal');
        if (portal) portal.hidden = true;
        const p = $('#panelProfile');
        if (p) p.hidden = false;
        // Скроллим к началу секции профиля
        try { p && p.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
        break;
      }
    }
  }

  function closeAllPanels() {
    $$('.panel').forEach(p => p.hidden = true);
  }

  // ── HISTORY (главная) ────────────────────────────────────
  // Рендерит localStorage-историю раскладов в #homeHistoryList.
  // Источник: тот же localStorage, что и arc-portal использует ('arhHistory').
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem('arhHistory') || '[]'); } catch { return []; }
  }

  const SPREAD_LABELS = {
    one: 'Одна карта', three: 'Три карты', five: 'Пять карт',
    relation: 'Отношения', day: 'День', celtic: 'Кельтский крест',
    week: 'Неделя', yesno: 'Да/Нет', horseshoe: 'Подкова',
    love: 'Любовь', mind: 'Разум', mirror: 'Зеркало'
  };
  const SPREAD_ICONS = {
    one: '✦', three: '✦✦✦', five: '✦✦✦✦✦',
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

  function renderHomeHistory() {
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

    // Регруппировка по дате
    const groups = groupHistoryByDate(items);
    const groupKeys = ['today','yesterday','week','earlier'].filter(k => groups[k].length);

    if (!groupKeys.length) {
      // Фильтр отсёк всё
      groupsEl.innerHTML = `<div class="arc-history-empty" style="padding:18px 8px">
        <div class="arc-history-empty-text">Нет раскладов в выбранном диапазоне.</div>
      </div>`;
      groupsEl.hidden = false;
      list.innerHTML = '';
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
  }

  function renderHistoryItem(h, origIdx) {
    const d = new Date(h.ts || Date.now());
    const dateStr = d.getFullYear() === new Date().getFullYear() ? `${dayMonth(d)} · ${timeStr(d)}` : `${dayMonth(d)} ${d.getFullYear()} · ${timeStr(d)}`;
    const label = SPREAD_LABELS[h.spread] || h.spread || 'расклад';
    const icon = SPREAD_ICONS[h.spread] || '✦';
    const cards = (h.cards || []);
    const previewCards = cards.slice(0, 4).map(c =>
      `<span class="arc-history-card-chip${c.reversed ? ' is-rev' : ''}">${escapeHtml(c.name || c.id || '')}${c.reversed ? ' ⇄' : ''}</span>`
    ).join('') + (cards.length > 4 ? `<span class="arc-history-card-chip arc-history-more">+${cards.length - 4}</span>` : '');
    const q = h.question ? `<div class="arc-history-q">«${escapeHtml(h.question)}»</div>` : '';
    const note = (h.note && h.note.trim()) ? `<div class="arc-history-note">✎ ${escapeHtml(h.note)}</div>` : '';

    // Детали: позиции + полные имена карт
    const positions = SPREAD_POSITIONS[h.spread] || cards.map((_, i) => `Позиция ${i+1}`);
    const detailsHtml = cards.length > 0 ? `
      <div class="arc-history-details">
        ${cards.map((c, i) => `
          <div class="arc-history-detail-card">
            <div class="arc-history-detail-pos">${escapeHtml(positions[i] || ('Карта ' + (i+1)))}</div>
            <div>
              <div class="arc-history-detail-name${c.reversed ? ' is-rev' : ''}">
                ${escapeHtml(c.name || c.id || '')}${c.reversed ? ' <span class="rev-mark">перевёрнутая</span>' : ''}
              </div>
              ${c.advice ? `<div class="arc-history-detail-advice">${escapeHtml(c.advice)}</div>` : ''}
            </div>
          </div>
        `).join('')}
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

  // ── HERO FLIP CARD ───────────────────────────────────────
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

  // ── Boot ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
