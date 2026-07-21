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
      document.documentElement.style.setProperty('--bg',       tg.themeParams.bg_color   || '#0b0a1a');
      document.documentElement.style.setProperty('--ink',      tg.themeParams.text_color || '#f4f0e6');
      const btn = tg.themeParams.button_color;
      if (btn) document.documentElement.style.setProperty('--gold', btn);
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

  // ── DOM refs ─────────────────────────────────────────────
  const $  = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ── Init ─────────────────────────────────────────────────
  function init() {
    $('#dateLabel').textContent  = DATA.dateLabel();
    $('#loadedAt').textContent   = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    renderUser();
    renderTarot();
    renderBiorhythmTile();
    renderEveningTile();
    renderProfile();
    wireEvents();
    if (state.user.startParam === 'mychart') {
      setTimeout(openChartPanel, 50);
    }
  }

  // ── Gadanie (arc portal) ─────────────────────────────────
  function openGadaniePortal() {
    closeAllPanels();
    const portal = $('#arcPortal');
    if (!portal) return;
    portal.hidden = false;
    tileActive('gadanie', true);
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
    const el = $('#heroGlyph');
    const key = elementForCard(c);
    if (el) el.innerHTML = ELEMENT_SVG[key] || ELEMENT_SVG.major;
    $('#heroName').textContent  = c.name;
    $('#heroMood').textContent  = c.mood;
    $('#heroText').textContent  = c.upright;
    const hd = $('#heroDate');
    if (hd) hd.textContent = DATA.dateLabel();
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

  // ── Evening panel ───────────────────────────────────────
  function openEveningPanel() {
    closeAllPanels();
    $('#panelEvening').hidden = false;
    tileActive('evening', true);
    const today = Evening.today();
    if (today) {
      state.mood = today.mood;
      $('#eveningNote').value = today.note || '';
      $$('.mood-btn').forEach(b => b.classList.toggle('is-selected', Number(b.dataset.mood) === today.mood));
      $('#eveningStatus').textContent = 'Сохранено сегодня в ' + new Date(today.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      $('#eveningStatus').classList.add('is-ok');
    } else {
      state.mood = null;
      $('#eveningNote').value = '';
      $$('.mood-btn').forEach(b => b.classList.remove('is-selected'));
      $('#eveningStatus').textContent = '';
      $('#eveningStatus').classList.remove('is-ok');
    }
    haptic('light');
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
      { label: 'Имя',          val: p && p.name ? p.name : null, key: 'name', kind: 'text' },
      { label: 'Дата рождения', val: p && p.birthYear ? `${p.birthDay}.${String(p.birthMonth).padStart(2,'0')}.${p.birthYear}` : null, key: 'birthDate', kind: 'date' },
      { label: 'Время',         val: p && p.birthTime ? p.birthTime : null, key: 'birthTime', kind: 'time' },
      { label: 'Место',         val: p && p.birthPlace ? p.birthPlace : null, key: 'birthPlace', kind: 'text' }
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
        return `<div class="profile-field">
          <label>${f.label}</label>
          <input type="${type}" data-key="${f.key}" value="${escapeHtml(cur(f.key))}" placeholder="${f.label}">
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
    const map = { biorhythm:'tileBiorhythm', evening:'tileEvening', forecast:'tileForecast', profile:'tileProfile', chart:'tileChart', gadanie:'tileGadanie' };
    const el = $('#' + map[name]);
    if (el) el.classList.toggle('is-active', on);
  }
  function closeAllPanels() {
    ['panelBiorhythm','panelEvening','panelForecast','panelProfile','panelChart'].forEach(id => $('#' + id).hidden = true);
    ['biorhythm','evening','forecast','profile','chart'].forEach(n => tileActive(n, false));
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
      navigator.share({ title: 'Карта дня — Планчик', text }).catch(() => {});
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
  function saveCheckin() {
    if (!state.mood) { flashToast('Выбери настроение'); haptic('error'); return; }
    const entry = Evening.save(state.mood, $('#eveningNote').value);
    if (Evening.shareToBot()) {
      flashToast('Сохранено и отправлено в бот');
    } else {
      flashToast('Сохранено локально');
    }
    $('#eveningStatus').textContent = 'Сохранено в ' + new Date(entry.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    $('#eveningStatus').classList.add('is-ok');
    state.checkins = Evening.last30();
    renderEveningTile();
    haptic('success');
  }

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
    $('#btnSaveCheckin').onclick  = saveCheckin;
    $('#btnProfileEdit').onclick = toggleProfileEdit;
    $('#btnProfileSave').onclick = saveProfileToBot;
    $('#btnProfileCopy').onclick = openProfileInBot;

    // Quick tiles
    $('#tileBiorhythm').onclick = tileBiorhythmClick;
    $('#tileEvening').onclick   = openEveningPanel;
    $('#tileGadanie').onclick   = openGadaniePortal;
    $('#tileForecast').onclick  = openForecastPanel;
    $('#tileProfile').onclick   = openProfilePanel;
    $('#tileChart').onclick     = openChartPanel;

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

    // Mood buttons (используем onclick на каждой кнопке, не addEventListener)
    $$('.mood-btn').forEach(b => {
      b.onclick = () => selectMood(b);
    });
  }

  // ── Boot ─────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
