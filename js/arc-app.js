// Arkhangel Modern — гадание по одной карте (angel=28).
// Всё на vanilla JS, без зависимостей. Адаптировано под Mini App: монтируется в #arcContent.

(function () {
  'use strict';

  const DECKS = {
    tarot:    { label: 'Таро',          deck: window.DECK_TAROT,    hint: 'Старшие Арканы' },
    lenormand:{ label: 'Ленорман',      deck: window.DECK_LENORMAND, hint: '36 карт' },
    runes:    { label: 'Руны',          deck: window.DECK_RUNES,    hint: 'Elder Futhark' },
    gypsy:    { label: 'Цыганские',     deck: window.DECK_GYPSY,    hint: '36 карт' },
    playing:  { label: 'Игральные',     deck: window.DECK_PLAYING,  hint: 'Колода 36' }
  };

  const state = {
    deck: 'tarot',
    card: null,
    reversed: false,
    question: '',
    history: []
  };

  // root — контейнер arc-app внутри Mini App
  function root() { return document.getElementById('arcApp'); }
  function $  (s) { const r = root(); return r ? r.querySelector(s) : null; }
  function $$ (s) { const r = root(); return r ? Array.from(r.querySelectorAll(s)) : []; }

  // ---------- HTML TEMPLATE (монтируется при открытии тайла) ----------
  const HTML = `
    <div class="arc-hero">
      <span class="arc-hero-eyebrow">одна карта · один ответ</span>
      <h3 class="arc-hero-h">Когда вопрос один — <em>ответ тоже один</em></h3>
      <p class="arc-hero-p">Сосредоточьтесь на том, что вас тревожит, и вытяните одну карту. Таро, руны, ленорман, цыганские или игральные — выберите колоду, которой доверяете.</p>
    </div>

    <div class="arc-block">
      <label class="arc-label" for="arcQuestion">Ваш вопрос (по желанию)</label>
      <textarea id="arcQuestion" class="arc-question" placeholder="Например: стоит ли мне сейчас менять работу?" maxlength="400"></textarea>
    </div>

    <div class="arc-block">
      <div class="arc-label">Колода</div>
      <div id="deckChips" class="arc-deck-chips" role="radiogroup" aria-label="Выбор колоды"></div>
    </div>

    <div class="arc-stage" id="stage">
      <div id="cardStage" role="img" aria-label="Карта рубашкой вверх. Нажмите кнопку, чтобы вытянуть.">
        <div class="arc-card-face arc-card-back">
          <span class="arc-card-back-mark">⚜</span>
        </div>
        <div class="arc-card-face arc-card-front">
          <div id="place"></div>
        </div>
      </div>
    </div>

    <div class="arc-cta-row" role="group" aria-label="Действия">
      <button id="ctaDraw"  class="arc-cta arc-cta-primary" type="button">🂠  Тянуть карту</button>
      <button id="ctaReset" class="arc-cta arc-cta-ghost"   type="button" disabled>↺  Спросить ещё</button>
      <button id="ctaShare" class="arc-cta arc-cta-share"   type="button" style="display:none">⤴  Поделиться</button>
    </div>

    <div id="result" class="arc-result" aria-live="polite">
      <article class="arc-interpretation">
        <div id="interpretation"></div>
      </article>
    </div>

    <div class="arc-history">
      <div class="arc-label" style="display:flex;align-items:center;justify-content:space-between;">
        <span>История раскладов</span>
        <button id="ctaClearHist" class="arc-cta-ghost" style="font-size:11px;padding:4px 10px;border:1px solid var(--line);border-radius:999px;color:var(--ink-mute);">очистить</button>
      </div>
      <ul id="historyList" class="arc-history-list"></ul>
    </div>
  `;

  // ---------- VIEWS ----------
  function renderDeckChips() {
    const wrap = $('#deckChips');
    if (!wrap) return;
    wrap.innerHTML = '';
    Object.entries(DECKS).forEach(([id, info]) => {
      const b = document.createElement('button');
      b.className = 'arc-chip' + (state.deck === id ? ' is-active' : '');
      b.type = 'button';
      b.innerHTML = `<span class="arc-chip-label">${info.label}</span><span class="arc-chip-hint">${info.hint}</span>`;
      b.onclick = () => { state.deck = id; renderDeckChips(); resetReading(); };
      wrap.appendChild(b);
    });
  }

  function resetReading() {
    state.card = null;
    state.reversed = false;
    const result = $('#result'); if (result) result.classList.remove('is-revealed');
    const card = $('#cardStage'); if (card) card.classList.remove('is-revealed', 'is-flipping');
    const place = $('#place'); if (place) place.innerHTML = '';
    const inter = $('#interpretation'); if (inter) inter.innerHTML = '';
    const ctaD = $('#ctaDraw'); if (ctaD) { ctaD.disabled = false; ctaD.textContent = '🂠  Тянуть карту'; }
    const ctaR = $('#ctaReset'); if (ctaR) ctaR.disabled = true;
    const ctaS = $('#ctaShare'); if (ctaS) ctaS.style.display = 'none';
    const stage = $('#stage'); if (stage) stage.classList.add('is-lit');
  }

  function drawCard() {
    if (state.card) return;
    const deck = DECKS[state.deck].deck;
    const idx  = Math.floor(Math.random() * deck.length);
    const card = deck[idx];
    state.card = card;
    state.reversed = Math.random() < 0.30;
    state.history.unshift({ ts: Date.now(), deck: state.deck, cardId: card.id, reversed: state.reversed, question: state.question });
    try { localStorage.setItem('arhHistory', JSON.stringify(state.history.slice(0, 30))); } catch (e) {}
    revealCard();
  }

  function revealCard() {
    const c = state.card;
    if (!c) return;
    const cardEl  = $('#cardStage');
    const placeEl = $('#place');
    const interEl = $('#interpretation');

    placeEl.innerHTML = `
      <div class="arc-card-glyph ${state.reversed ? 'is-reversed' : ''}">
        <div class="arc-card-glyph-symbol">${c.symbol}</div>
        <div class="arc-card-glyph-name">${escapeHtml(c.name)}</div>
      </div>`;

    const pos = state.reversed ? 'reversed' : 'upright';
    const headline = state.reversed ? 'Перевёрнутое положение' : 'Прямое положение';
    interEl.innerHTML = `
      <h3 class="arc-inter-title">${headline}</h3>
      <p class="arc-inter-main">${escapeHtml(c[pos])}</p>
      <p class="arc-inter-shadow"><span class="arc-shadow-label">Тень карты:</span> ${escapeHtml(c.shadow || '')}</p>
      ${state.question ? `<p class="arc-inter-context">В контексте вашего вопроса: <em>«${escapeHtml(state.question)}»</em> — карта указывает, что ${escapeHtml(state.reversed ? c.reversed : c.upright)}</p>` : ''}
    `;

    cardEl.classList.add('is-flipping');
    setTimeout(() => {
      cardEl.classList.add('is-revealed');
      cardEl.classList.remove('is-flipping');
      $('#result').classList.add('is-revealed');
      $('#ctaDraw').disabled = true;
      $('#ctaReset').disabled = false;
      $('#ctaDraw').textContent = '✓  Карта вытянута';
      $('#ctaShare').style.display = 'inline-flex';
      tryVibrate(20);
    }, 700);
  }

  function tryVibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  // ---------- SHARE ----------
  function shareResult() {
    if (!state.card) return;
    const c = state.card;
    const pos = state.reversed ? 'перевёрнутая' : 'прямая';
    const deckName = DECKS[state.deck].label;
    const text = `🂠 ${c.name} (${pos}, ${deckName})\n\n${state.reversed ? c.reversed : c.upright}\n\n— Планчик`;
    if (window.TelegramApp && window.TelegramApp.tg && window.TelegramApp.tg.sendData) {
      window.TelegramApp.tg.sendData(JSON.stringify({ type: 'arc_share', payload: { card: c, reversed: state.reversed, deck: state.deck } }));
      flashToast('Отправлено в бот');
    } else if (navigator.share) {
      navigator.share({ title: 'Моя карта — Планчик', text }).catch(()=>{});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(()=> flashToast('Скопировано в буфер'));
    } else {
      flashToast('Шаринг недоступен');
    }
  }

  // ---------- TOAST (локальный, не путать с app.js) ----------
  let toastT;
  function flashToast(msg) {
    let t = document.getElementById('arcToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'arcToast';
      t.className = 'arc-toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      (root() || document.body).appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('is-shown');
    clearTimeout(toastT);
    toastT = setTimeout(()=> t.classList.remove('is-shown'), 2200);
  }

  // ---------- HISTORY ----------
  function renderHistory() {
    const list = $('#historyList');
    if (!list) return;
    if (!state.history.length) {
      list.innerHTML = '<li class="arc-history-empty">Здесь появятся ваши последние расклады.</li>';
      return;
    }
    list.innerHTML = state.history.slice(0, 6).map(h => {
      const deck = DECKS[h.deck];
      const card = deck.deck.find(c => c.id === h.cardId);
      if (!card) return '';
      return `<li class="arc-history-item">
        <span class="arc-history-glyph">${escapeHtml(card.symbol)}</span>
        <span class="arc-history-body">
          <strong>${escapeHtml(card.name)}</strong>
          <span class="arc-history-meta">${escapeHtml(deck.label)} · ${h.reversed ? 'перевёрнутая' : 'прямая'} · ${new Date(h.ts).toLocaleString('ru-RU')}</span>
        </span>
      </li>`;
    }).join('');
  }

  // ---------- PUBLIC: MOUNT / UNMOUNT ----------
  function mount() {
    // Создаём контейнер если нет
    let host = document.getElementById('arcApp');
    if (!host) {
      host = document.createElement('div');
      host.id = 'arcApp';
      host.className = 'arc-app';
      const content = document.getElementById('arcContent');
      content.appendChild(host);
    }
    host.innerHTML = HTML;

    // history
    try { state.history = JSON.parse(localStorage.getItem('arhHistory') || '[]'); } catch { state.history = []; }

    // вопрос
    state.question = localStorage.getItem('arhQuestion') || '';
    const q = $('#arcQuestion');
    if (q) {
      q.value = state.question;
      q.oninput = e => {
        state.question = e.target.value;
        try { localStorage.setItem('arhQuestion', state.question); } catch (e) {}
      };
    }

    renderDeckChips();
    renderHistory();
    resetReading();

    // events — через .onclick (idempotent, TMA-safe)
    const ctaD = $('#ctaDraw');  if (ctaD) ctaD.onclick = drawCard;
    const ctaR = $('#ctaReset'); if (ctaR) ctaR.onclick = resetReading;
    const ctaS = $('#ctaShare'); if (ctaS) ctaS.onclick = shareResult;
    const ctaC = $('#ctaClearHist'); if (ctaC) ctaC.onclick = async () => {
      if (await arcConfirm('Очистить историю раскладов?')) {
        state.history = [];
        try { localStorage.removeItem('arhHistory'); } catch (e) {}
        renderHistory();
      }
    };
  }

  function unmount() {
    const host = document.getElementById('arcApp');
    if (host) host.innerHTML = '';
  }

  // ---------- CUSTOM CONFIRM (TMA-safe; window.confirm часто режется WebView) ----------
  function arcConfirm(msg) {
    return new Promise((resolve) => {
      const root = document.getElementById('arcApp') || document.body;
      // уникальный id на каждый вызов
      const id = 'arcConfirm_' + Date.now();
      const overlay = document.createElement('div');
      overlay.className = 'arc-confirm';
      overlay.id = id;
      overlay.innerHTML = `
        <div class="arc-confirm-box">
          <p>${escapeHtml(msg)}</p>
          <div class="arc-confirm-actions">
            <button type="button" class="arc-confirm-btn arc-confirm-cancel" data-act="0">Отмена</button>
            <button type="button" class="arc-confirm-btn arc-confirm-ok"     data-act="1">Очистить</button>
          </div>
        </div>`;
      root.appendChild(overlay);
      const cleanup = (val) => { try { overlay.remove(); } catch (e) {} resolve(val); };
      overlay.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (btn) cleanup(btn.dataset.act === '1');
        else if (e.target === overlay) cleanup(false);
      });
      tryVibrate(10);
    });
  }

  // expose
  window.ArcApp = { mount, unmount };
})();
