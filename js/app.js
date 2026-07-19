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
  const state = {
    user: parseUser(),
    profile: Evening.loadProfile(),
    mood: null,
    checkins: Evening.last30()
  };

  function parseUser() {
    if (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) {
      const u = tg.initDataUnsafe.user;
      return { id: u.id, name: u.first_name || 'друг', username: u.username || null, photo: u.photo_url || null };
    }
    // Dev fallback (открыли в браузере напрямую)
    return { id: 0, name: 'друг', username: null, photo: null };
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
    renderEvening();
    renderProfile();
    wireEvents();
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
  function renderTarot() {
    const tgId = state.user.id || 1; // dev fallback
    const date = DATA.todayKey();
    const c = TarotDaily.calc(tgId, date);
    $('#heroGlyph').textContent = c.glyph;
    $('#heroName').textContent  = c.name;
    $('#heroMood').textContent  = c.mood;
    $('#heroText').textContent  = c.upright;
  }

  // ── Biorhythm tile (summary) ────────────────────────────
  function renderBiorhythmTile() {
    if (!state.profile || !state.profile.birthYear) {
      $('#bioToday').textContent = 'нет данных';
      return;
    }
    const r = Biorhythm.calc(state.profile.birthYear, state.profile.birthMonth, state.profile.birthDay);
    const avg = Math.round((r.physical.value + r.emotional.value + r.intellectual.value) / 3 * 100);
    const arrow = avg > 0 ? '↗' : avg < 0 ? '↘' : '·';
    $('#bioToday').textContent = `сегодня ${arrow} ${Math.abs(avg)}%`;
  }

  // ── Biorhythm panel ─────────────────────────────────────
  function openBiorhythmPanel() {
    closeAllPanels();
    const panel = $('#panelBiorhythm');
    panel.hidden = false;
    tileActive('biorhythm', true);

    if (!state.profile || !state.profile.birthYear) {
      $('#bioContent').innerHTML = '<div class="bio-empty">Нужен день рождения. Открой <strong>Профиль</strong> и заполни.</div>';
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
    const ph = content.querySelector('.forecast-empty');
    if (ph) ph.remove();
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
    const fields = [
      { label: 'Имя',          val: p && p.name ? p.name : null },
      { label: 'Дата рождения', val: p && p.birthYear ? `${p.birthDay}.${String(p.birthMonth).padStart(2,'0')}.${p.birthYear}` : null },
      { label: 'Знак зодиака', val: zod ? `${zod[1]} ${zod[0]}` : null },
      { label: 'Стихия',       val: zod ? zod[3] : null },
      { label: 'Управитель',   val: zod ? zod[4] : null },
      { label: 'Время',         val: p && p.birthTime ? p.birthTime : null },
      { label: 'Место',         val: p && p.birthPlace ? p.birthPlace : null }
    ];
    $('#profileFields').innerHTML = fields.map(f =>
      `<div class="profile-field">
        <label>${f.label}</label>
        <div class="val ${f.val ? '' : 'is-empty'}">${f.val ? escapeHtml(f.val) : 'не заполнено'}</div>
      </div>`
    ).join('');

    const meta = $('#profileMeta');
    if (p && p.birthYear) {
      if (meta) meta.textContent = zod ? `${zod[1]} ${zod[0]}` : 'заполнен';
    } else {
      if (meta) meta.textContent = 'заполнить';
    }
  }

  // ── Tile highlight + panel close ────────────────────────
  function tileActive(name, on) {
    const map = { biorhythm:'tileBiorhythm', evening:'tileEvening', forecast:'tileForecast', profile:'tileProfile', gadanie:'tileGadanie' };
    const el = $('#' + map[name]);
    if (el) el.classList.toggle('is-active', on);
  }
  function closeAllPanels() {
    ['panelBiorhythm','panelEvening','panelForecast','panelProfile'].forEach(id => $('#' + id).hidden = true);
    ['biorhythm','evening','forecast','profile'].forEach(n => tileActive(n, false));
    // arc portal
    const ap = $('#arcPortal');
    if (ap && !ap.hidden) {
      if (window.ArcApp && window.ArcApp.unmount) window.ArcApp.unmount();
      ap.hidden = true;
      tileActive('gadanie', false);
    }
  }
  function closePanel(name) {
    $('#panel' + name[0].toUpperCase() + name.slice(1)).hidden = true;
    tileActive(name, false);
  }

  // ── Tarot refresh + share ────────────────────────────────
  function refreshTarot() {
    haptic('medium');
    renderTarot();
    flashToast('Карта обновлена');
  }
  function shareTarot() {
    const c = TarotDaily.calc(state.user.id || 1, DATA.todayKey());
    const text = TarotDaily.formatShare(c);
    if (tg && tg.sendData) {
      tg.sendData(JSON.stringify({ type: 'tarot', payload: c }));
      flashToast('Отправлено в бот');
    } else if (navigator.share) {
      navigator.share({ title: 'Карта дня — Планчик', text }).catch(()=>{});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(()=> flashToast('Скопировано в буфер'));
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
    $('#btnSaveCheckin').onclick  = saveCheckin;
    $('#btnProfileCopy').onclick  = () => {
      // open bot deeplink: t.me/Fitness_byrbot?start=openapp
      const url = 'https://t.me/Fitness_byrbot?start=openapp';
      if (tg && tg.openLink) {
        tg.openLink(url);
        setTimeout(() => tg.close && tg.close(), 300);
      } else if (tg && tg.openTelegramLink) {
        tg.openTelegramLink(url);
      } else {
        window.open(url, '_blank');
      }
    };

    // Quick tiles
    $('#tileBiorhythm').onclick = openBiorhythmPanel;
    $('#tileEvening').onclick   = openEveningPanel;
    $('#tileGadanie').onclick   = openGadaniePortal;
    $('#tileForecast').onclick  = openForecastPanel;
    $('#tileProfile').onclick   = openProfilePanel;

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
