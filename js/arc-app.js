// arc-app.js — Архангел клон: 5 раскладов, роутер, общая история.
// TMA-safe: idempotent .onclick, no backdrop-filter на overlay.

(function () {
  'use strict';

  // ── Колода и источники ────────────────────────────────────
  const DECKS = {
    tarot:    { label: 'Таро',          deck: () => window.DECK_TAROT,     hint: 'Старшие + Младшие Арканы' },
    lenormand:{ label: 'Ленорман',      deck: () => window.DECK_LENORMAND, hint: '36 карт' },
    runes:    { label: 'Руны',          deck: () => window.DECK_RUNES,     hint: 'Elder Futhark' },
    gypsy:    { label: 'Цыганские',     deck: () => window.DECK_GYPSY,     hint: '36 карт' },
    playing:  { label: 'Игральные',     deck: () => window.DECK_PLAYING,   hint: 'Колода 36' }
  };

  // Маппинг соответствия колод для расклада «Совместимость»
  // Используется одна колода на двоих, но с двойным набором карт
  const SPREAD_DECK_HINT = {
    one:   'Классическое гадание. Сосредоточьтесь на вопросе — и вытяните карту.',
    three: 'Три карты — это три точки во времени. Не гадайте чаще, чем раз в день.',
    yesno: 'Простой вопрос — простой ответ. Карта скажет «да», «нет» или «подожди».',
    cross: 'Кельтский крест — серьёзный расклад. Не используйте его для бытовых вопросов.',
    love:  'Карта покажет, что вас соединяет, а что разъединяет.'
  };

  // ── State ────────────────────────────────────────────────
  const state = {
    spread: 'one',     // active spread
    deck: 'tarot',     // active deck
    reversed: false,
    cards: [],         // массив вытянутых карт для текущего расклада
    question: '',
    history: []
  };

  // ── Утилиты ──────────────────────────────────────────────
  function $  (s) { return document.querySelector(s); }
  function $$ (s) { return Array.from(document.querySelectorAll(s)); }

  // внутри arc-portal
  function root() { return document.getElementById('arcMain'); }
  function r$  (s) { const r = root(); return r ? r.querySelector(s) : null; }
  function r$$ (s) { const r = root(); return r ? Array.from(r.querySelectorAll(s)) : []; }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function tryVibrate(ms) {
    if (navigator.vibrate) navigator.vibrate(ms);
  }

  // ── История (общая для всех раскладов) ──────────────────
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem('arhHistory') || '[]'); } catch { return []; }
  }
  function saveHistory() {
    try { localStorage.setItem('arhHistory', JSON.stringify(state.history.slice(0, 30))); } catch (e) {}
  }

  // ── Toast ────────────────────────────────────────────────
  let toastT;
  function flashToast(msg) {
    let t = document.getElementById('arcToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'arcToast';
      t.className = 'arc-toast';
      t.setAttribute('role', 'status');
      t.setAttribute('aria-live', 'polite');
      const portal = document.getElementById('arcPortal') || document.body;
      portal.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('is-shown');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('is-shown'), 2200);
  }

  // ── Custom confirm ───────────────────────────────────────
  function arcConfirm(msg, okLabel = 'Очистить', cancelLabel = 'Отмена') {
    return new Promise((resolve) => {
      const portal = document.getElementById('arcPortal') || document.body;
      const overlay = document.createElement('div');
      overlay.className = 'arc-confirm';
      overlay.innerHTML = `
        <div class="arc-confirm-box">
          <p>${escapeHtml(msg)}</p>
          <div class="arc-confirm-actions">
            <button type="button" class="arc-confirm-btn arc-confirm-cancel" data-act="0">${cancelLabel}</button>
            <button type="button" class="arc-confirm-btn arc-confirm-ok"     data-act="1">${okLabel}</button>
          </div>
        </div>`;
      portal.appendChild(overlay);
      const cleanup = (val) => { try { overlay.remove(); } catch (e) {} resolve(val); };
      overlay.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-act]');
        if (btn) cleanup(btn.dataset.act === '1');
        else if (e.target === overlay) cleanup(false);
      });
      tryVibrate(10);
    });
  }

  // ── Рендер чипов выбора колоды ──────────────────────────
  function renderDeckChips() {
    const wrap = r$('#deckChips');
    if (!wrap) return;
    wrap.innerHTML = '';
    Object.entries(DECKS).forEach(([id, info]) => {
      const b = document.createElement('button');
      b.className = 'arc-chip' + (state.deck === id ? ' is-active' : '');
      b.type = 'button';
      b.innerHTML = `<span class="arc-chip-label">${info.label}</span><span class="arc-chip-hint">${info.hint}</span>`;
      b.onclick = () => { state.deck = id; resetReading(); renderDeckChips(); };
      wrap.appendChild(b);
    });
  }

  // ── Сбросить расклад ────────────────────────────────────
  function resetReading() {
    state.cards = [];
    const res = r$('#arcResult'); if (res) res.classList.remove('is-revealed');
    const stage = r$('#arcStage'); if (stage) stage.classList.add('is-lit');
    const btnD = r$('#ctaDraw'); if (btnD) { btnD.disabled = false; btnD.textContent = '🂠  Тянуть карту'; }
    const btnR = r$('#ctaReset'); if (btnR) btnR.disabled = true;
    const btnS = r$('#ctaShare'); if (btnS) btnS.style.display = 'none';
  }

  // ── Тянем N случайных карт (без повторов) ───────────────
  function drawN(n) {
    const deckArr = DECKS[state.deck].deck() || [];
    if (!deckArr.length) return [];
    const copy = deckArr.slice();
    // Fisher-Yates
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n).map(c => ({
      ...c,
      reversed: Math.random() < 0.30
    }));
  }

  // ── Шаринг: текст для navigator.share / tg.sendData ────
  function buildShareText() {
    const deckName = DECKS[state.deck].label;
    if (state.cards.length === 0) return '';
    if (state.cards.length === 1) {
      const c = state.cards[0];
      const pos = c.reversed ? 'перевёрнутая' : 'прямая';
      return `🂠 ${c.name} (${pos}, ${deckName})\n\n${c.reversed ? c.reversed : c.upright}\n\n— Планчик · Архангел`;
    }
    const lines = [`🂠 Расклад «${getSpreadName(state.spread)}» (${deckName})`];
    if (state.question) lines.push(`Вопрос: ${state.question}`);
    state.cards.forEach((c, i) => {
      const pos = c.reversed ? '⤵' : '↗';
      const label = state.spread === 'three' ? ['Прошлое', 'Настоящее', 'Будущее'][i]
                   : state.spread === 'cross' ? CROSS_POSITIONS[i]?.label || `#${i+1}`
                   : state.spread === 'love'  ? (i === 0 ? 'Ты' : 'Он(а)')
                   : `#${i+1}`;
      lines.push(`\n${label} — ${pos} ${c.name}\n${c.reversed ? c.reversed : c.upright}`);
    });
    lines.push('\n— Планчик · Архангел');
    return lines.join('\n');
  }

  function getSpreadName(id) {
    return { one: 'Одна карта', three: 'Три карты', yesno: 'Да или Нет', cross: 'Кельтский крест', love: 'Совместимость' }[id] || id;
  }

  function shareResult() {
    const text = buildShareText();
    if (!text) return;
    if (window.TelegramApp && window.TelegramApp.tg && window.TelegramApp.tg.sendData) {
      window.TelegramApp.tg.sendData(JSON.stringify({ type: 'arc_share', payload: { spread: state.spread, deck: state.deck, cards: state.cards, question: state.question } }));
      flashToast('Отправлено в бот');
    } else if (navigator.share) {
      navigator.share({ title: 'Гадание — Планчик', text }).catch(()=>{});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(()=> flashToast('Скопировано в буфер'));
    } else {
      flashToast('Шаринг недоступен');
    }
  }

  // ── 10 позиций Кельтского креста ────────────────────────
  const CROSS_POSITIONS = [
    { label: '1. Ситуация',         hint: 'что происходит сейчас' },
    { label: '2. Препятствие',       hint: 'что мешает' },
    { label: '3. Корень',            hint: 'основа, фундамент' },
    { label: '4. Прошлое',           hint: 'что ушло' },
    { label: '5. Возможность',       hint: 'что может случиться' },
    { label: '6. Будущее',           hint: 'что придёт' },
    { label: '7. Вы',                hint: 'ваша позиция' },
    { label: '8. Окружение',         hint: 'влияние извне' },
    { label: '9. Надежды и страхи',  hint: 'внутреннее' },
    { label: '10. Итог',             hint: 'конечный результат' }
  ];

  // ── Бинарная интерпретация для Да/Нет ──────────────────
  // Простая: считаем "да" / "нет" / "может быть" по upright + семантике
  const YES_WORDS = ['да', 'успех', 'любовь', 'счастье', 'радость', 'победа', 'солнце', 'звезда', 'благоприятный', 'согласие', 'союз', 'рост', 'изобилие', 'маг', 'император', 'императрица', 'влюблённ', 'колесниц', 'сил', 'колесо', 'справедлив', 'мир'];
  const NO_WORDS  = ['нет', 'конец', 'разруш', 'тюрьм', 'цепь', 'башн', 'дьявол', 'смерть', 'пятёрк', 'десятк мечей', 'тень', 'страх', 'обман', 'разрыв', 'предательство'];

  function yesNoInterpret(c) {
    const t = ((c.upright || '') + ' ' + (c.reversed || '')).toLowerCase();
    if (c.reversed) {
      return { verdict: 'НЕТ', tone: 'no', detail: 'Карта в перевёрнутом положении. Путь закрыт или неблагоприятен.' };
    }
    const isYes = YES_WORDS.some(w => t.includes(w));
    const isNo  = NO_WORDS.some(w => t.includes(w));
    if (isYes && !isNo) return { verdict: 'ДА', tone: 'yes', detail: 'Прямое положение и светлая семантика. Путь открыт.' };
    if (isNo && !isYes) return { verdict: 'НЕТ', tone: 'no', detail: 'Прямое положение, но значение карты — отказ.' };
    return { verdict: 'ПОДОЖДИ', tone: 'wait', detail: 'Прямое положение, но ответ не бинарный. Нужно уточнение или время.' };
  }

  // ── Совместимость: считаем совпадение по шкале 1..10 ────
  // kind: 'major' = старший аркан (для таро) или 'minor' (для всего остального)
  // Определяем major по наличию поля `num` 0..21 (Major Arcana)
  function cardKind(c) {
    if (typeof c.num === 'number' && c.num >= 0 && c.num <= 21) return 'major';
    if (c.id === 'fool' || c.id === 'magician' || /ar0[0-9]|ar1[0-9]|ar2[01]/.test(c.id)) return 'major';
    return 'minor';
  }
  function loveInterpret(a, b) {
    const weight = (c) => (cardKind(c) === 'major' ? 4 : 1) * (c.reversed ? 0.5 : 1);
    let score = weight(a) + weight(b);
    if (cardKind(a) === 'major' && cardKind(b) === 'major') score += 2;
    // бонус за совпадение первой буквы имени (аллитерация как маркер совместимости)
    if (a.name[0] && b.name[0] && a.name[0].toLowerCase() === b.name[0].toLowerCase()) score += 0.5;

    let verdict, detail;
    if (score >= 7)      { verdict = 'Сильная связь';  detail = 'Карты показывают редкое совпадение. Если чувства есть — это стоит беречь.'; }
    else if (score >= 5) { verdict = 'Хорошая база';   detail = 'Есть фундамент для отношений. Работайте над тем, что разъединяет.'; }
    else if (score >= 3) { verdict = 'Нейтрально';     detail = 'Карты не против, но и не за. Решение зависит от контекста за пределами колоды.'; }
    else                 { verdict = 'Сложно';         detail = 'Карты показывают напряжение. Не приговор, но повод задуматься.'; }
    return { score: Math.round(score * 10) / 10, verdict, detail };
  }

  // ── Внутреннее состояние: stage card grid ───────────────
  function renderCards() {
    const stage = r$('#arcStage');
    if (!stage) return;
    const n = state.cards.length;
    if (n === 0) {
      stage.innerHTML = `
        <div id="cardStage" role="img" aria-label="Колода. Нажмите кнопку, чтобы вытянуть.">
          <div class="arc-card-face arc-card-back">
            <span class="arc-card-back-mark">⚜</span>
          </div>
        </div>`;
      return;
    }
    // Мульти-карты: горизонтальная сетка
    if (n === 1) {
      const c = state.cards[0];
      stage.innerHTML = `
        <div id="cardStage" class="is-revealed" role="img" aria-label="Карта ${escapeHtml(c.name)}">
          <div class="arc-card-face arc-card-front">
            <div class="arc-card-glyph ${c.reversed ? 'is-reversed' : ''}">
              <div class="arc-card-glyph-symbol">${c.symbol}</div>
              <div class="arc-card-glyph-name">${escapeHtml(c.name)}</div>
            </div>
          </div>
        </div>`;
    } else {
      const cardsHtml = state.cards.map((c, i) => {
        const label = state.spread === 'three' ? ['Прошлое', 'Настоящее', 'Будущее'][i]
                    : state.spread === 'cross' ? (i+1) + '. ' + (CROSS_POSITIONS[i]?.label.split('. ')[1] || '')
                    : state.spread === 'love'  ? (i === 0 ? 'Ты' : 'Он(а)')
                    : `#${i+1}`;
        return `<div class="arc-mini-card" data-idx="${i}">
          <div class="arc-mini-card-glyph ${c.reversed ? 'is-reversed' : ''}">${c.symbol}</div>
          <div class="arc-mini-card-name">${escapeHtml(c.name)}</div>
          <div class="arc-mini-card-label">${label}</div>
        </div>`;
      }).join('');
      stage.innerHTML = `<div class="arc-cards-grid" data-count="${n}">${cardsHtml}</div>`;
    }
  }

  function renderInterpretation() {
    const target = r$('#arcInter');
    if (!target) return;
    const q = state.question;
    if (state.cards.length === 0) {
      target.innerHTML = '<p style="color:var(--ink-mute);font-style:italic;">Сосредоточьтесь на вопросе и вытяните карты.</p>';
      return;
    }
    if (state.spread === 'yesno') {
      const c = state.cards[0];
      const r = yesNoInterpret(c);
      target.innerHTML = `
        <div class="arc-verdict arc-verdict-${r.tone}">${r.verdict}</div>
        <p class="arc-inter-main">${escapeHtml(c.name)} — ${c.reversed ? 'перевёрнутая' : 'прямая'}.</p>
        <p class="arc-inter-shadow"><span class="arc-shadow-label">Значение:</span> ${escapeHtml(c.reversed ? c.reversed : c.upright)}</p>
        <p class="arc-inter-context">${escapeHtml(r.detail)}</p>`;
      return;
    }
    if (state.spread === 'love') {
      const r = loveInterpret(state.cards[0], state.cards[1]);
      const [a, b] = state.cards;
      target.innerHTML = `
        <div class="arc-verdict arc-verdict-score">${r.verdict} · ${r.score}/10</div>
        <div class="arc-love-grid">
          <div class="arc-love-side">
            <div class="arc-love-label">Ты</div>
            <div class="arc-love-glyph ${a.reversed ? 'is-reversed' : ''}">${a.symbol}</div>
            <div class="arc-love-name">${escapeHtml(a.name)}</div>
            <p class="arc-love-text">${escapeHtml(a.reversed ? a.reversed : a.upright)}</p>
          </div>
          <div class="arc-love-connector">⇌</div>
          <div class="arc-love-side">
            <div class="arc-love-label">Он(а)</div>
            <div class="arc-love-glyph ${b.reversed ? 'is-reversed' : ''}">${b.symbol}</div>
            <div class="arc-love-name">${escapeHtml(b.name)}</div>
            <p class="arc-love-text">${escapeHtml(b.reversed ? b.reversed : b.upright)}</p>
          </div>
        </div>
        <p class="arc-inter-context">${escapeHtml(r.detail)}</p>`;
      return;
    }
    // Общий путь: одна / три / кельтский крест
    const sections = state.cards.map((c, i) => {
      const label = state.spread === 'three' ? ['Прошлое', 'Настоящее', 'Будущее'][i]
                  : state.spread === 'cross' ? CROSS_POSITIONS[i]?.label || `#${i+1}`
                  : state.spread === 'one'   ? 'Карта'
                  : `#${i+1}`;
      const hint = state.spread === 'cross' ? CROSS_POSITIONS[i]?.hint : '';
      const headline = c.reversed ? 'Перевёрнутое положение' : 'Прямое положение';
      return `<div class="arc-inter-section">
        <div class="arc-inter-section-head">
          <span class="arc-inter-glyph ${c.reversed ? 'is-reversed' : ''}">${c.symbol}</span>
          <div>
            <h3 class="arc-inter-title">${label}${hint ? ` <span class="arc-inter-hint">— ${hint}</span>` : ''}</h3>
            <p class="arc-inter-card">${escapeHtml(c.name)} · ${headline}</p>
          </div>
        </div>
        <p class="arc-inter-main">${escapeHtml(c.reversed ? c.reversed : c.upright)}</p>
        ${c.shadow ? `<p class="arc-inter-shadow"><span class="arc-shadow-label">Тень:</span> ${escapeHtml(c.shadow)}</p>` : ''}
      </div>`;
    }).join('');
    target.innerHTML = sections + (q ? `<p class="arc-inter-context">В контексте вопроса <em>«${escapeHtml(q)}»</em> — карты указывают, что ответ уже формируется. Доверьтесь первому импульсу.</p>` : '');
  }

  // ── Шаблон конкретного расклада ─────────────────────────
  function templateSpread() {
    const s = state.spread;
    const hint = SPREAD_DECK_HINT[s] || '';
    if (s === 'one')   return { count: 1, ask: 'Сосредоточьтесь на вопросе и вытяните карту.' };
    if (s === 'three') return { count: 3, ask: 'Задайте вопрос о развитии ситуации. Три карты — это прошлое, настоящее и будущее.' };
    if (s === 'yesno') return { count: 1, ask: 'Сформулируйте вопрос, на который можно ответить «да» или «нет».' };
    if (s === 'cross') return { count: 10, ask: 'Кельтский крест — глубокий расклад. Используйте для важных жизненных вопросов.' };
    if (s === 'love')  return { count: 2, ask: 'Совместимость. Думайте об обоих — о себе и о партнёре.' };
    return { count: 1, ask: '' };
  }

  // ── Mount конкретного расклада ─────────────────────────
  function mountSpread() {
    const main = root();
    if (!main) return;
    const t = templateSpread();
    main.innerHTML = `
      <div class="arc-panel-title">${getSpreadName(state.spread)}</div>
      <p class="arc-panel-sub">${t.ask}</p>

      <div class="arc-block">
        <label class="arc-label" for="arcQuestion">Ваш вопрос (по желанию)</label>
        <textarea id="arcQuestion" class="arc-question" placeholder="Например: стоит ли мне сейчас менять работу?" maxlength="400"></textarea>
      </div>

      <div class="arc-block">
        <div class="arc-label">Колода</div>
        <div id="deckChips" class="arc-deck-chips" role="radiogroup" aria-label="Выбор колоды"></div>
      </div>

      <div class="arc-stage" id="arcStage"></div>

      <div class="arc-cta-row" role="group" aria-label="Действия">
        <button id="ctaDraw"  class="arc-cta arc-cta-primary" type="button">🂠  Тянуть</button>
        <button id="ctaReset" class="arc-cta arc-cta-ghost"   type="button" disabled>↺  Заново</button>
        <button id="ctaShare" class="arc-cta arc-cta-share"   type="button" style="display:none">⤴  Поделиться</button>
      </div>

      <div id="arcResult" class="arc-result" aria-live="polite">
        <article class="arc-interpretation">
          <div id="arcInter"></div>
        </article>
      </div>
    `;

    // question persisted
    state.question = localStorage.getItem('arhQuestion') || '';
    const q = r$('#arcQuestion');
    if (q) {
      q.value = state.question;
      q.oninput = e => { state.question = e.target.value; try { localStorage.setItem('arhQuestion', state.question); } catch (e) {} };
    }

    renderDeckChips();
    renderCards();
    renderInterpretation();
    resetReading();

    // wire CTAs
    const ctaD = r$('#ctaDraw');
    if (ctaD) ctaD.onclick = doDraw;
    const ctaR = r$('#ctaReset');
    if (ctaR) ctaR.onclick = () => { state.cards = []; resetReading(); renderCards(); renderInterpretation(); };
    const ctaS = r$('#ctaShare');
    if (ctaS) ctaS.onclick = shareResult;
  }

  // ── Действие «Тянуть» ───────────────────────────────────
  function doDraw() {
    if (state.cards.length > 0) return;
    const t = templateSpread();
    state.cards = drawN(t.count);
    // history entry
    state.history.unshift({
      ts: Date.now(),
      spread: state.spread,
      deck: state.deck,
      cards: state.cards.map(c => ({ id: c.id, name: c.name, reversed: c.reversed })),
      question: state.question
    });
    saveHistory();

    const stage = r$('#arcStage');
    if (stage) stage.classList.add('is-lit');

    // Анимация: для одной карты flip; для мульти — сразу показать
    if (t.count === 1) {
      const cardEl = document.createElement('div');
      cardEl.id = 'cardStage';
      cardEl.setAttribute('role', 'img');
      const c = state.cards[0];
      cardEl.setAttribute('aria-label', `Карта ${c.name}`);
      cardEl.innerHTML = `
        <div class="arc-card-face arc-card-back"><span class="arc-card-back-mark">⚜</span></div>
        <div class="arc-card-face arc-card-front">
          <div class="arc-card-glyph ${c.reversed ? 'is-reversed' : ''}">
            <div class="arc-card-glyph-symbol">${c.symbol}</div>
            <div class="arc-card-glyph-name">${escapeHtml(c.name)}</div>
          </div>
        </div>`;
      const st = r$('#arcStage');
      st.innerHTML = '';
      st.appendChild(cardEl);
      cardEl.classList.add('is-flipping');
      setTimeout(() => {
        cardEl.classList.add('is-revealed');
        cardEl.classList.remove('is-flipping');
        r$('#arcResult').classList.add('is-revealed');
        r$('#ctaDraw').disabled = true;
        r$('#ctaDraw').textContent = '✓  Готово';
        r$('#ctaReset').disabled = false;
        r$('#ctaShare').style.display = 'inline-flex';
        renderInterpretation();
        tryVibrate(20);
      }, 700);
    } else {
      // мульти — сразу
      renderCards();
      r$('#arcResult').classList.add('is-revealed');
      r$('#ctaDraw').disabled = true;
      r$('#ctaDraw').textContent = '✓  Готово';
      r$('#ctaReset').disabled = false;
      r$('#ctaShare').style.display = 'inline-flex';
      renderInterpretation();
      tryVibrate(20);
    }
  }

  // ── Роутер по раскладам ─────────────────────────────────
  function setSpread(id) {
    if (!['one','three','yesno','cross','love'].includes(id)) return;
    state.spread = id;
    state.cards = [];
    // Подсветка в сайдбаре
    $$('.arc-nav-link').forEach(a => a.classList.toggle('is-active', a.dataset.spread === id));
    mountSpread();
    tryVibrate(10);
    // прокрутить к началу main
    const main = root();
    if (main) main.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── In-view анимация для info-карточек ─────────────────
  function bindInfoCards() {
    if (!('IntersectionObserver' in window)) {
      $$('.arc-info-card').forEach(c => c.classList.add('in-view'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e, i) => {
        if (e.isIntersecting) {
          setTimeout(() => e.target.classList.add('in-view'), i * 80);
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.1 });
    $$('.arc-info-card').forEach(c => io.observe(c));
  }

  // ── Public mount/unmount ─────────────────────────────────
  function setDeck(deck) {
    if (DECKS[deck]) {
      state.deck = deck;
      state.cards = [];
      const wrap = r$('#deckChips');
      if (wrap) renderDeckChips();
      resetReading();
      renderCards();
      renderInterpretation();
    }
  }

  function mount() {
    state.history = loadHistory();
    // wire nav
    $$('.arc-nav-link').forEach(a => {
      a.onclick = (e) => { e.preventDefault(); setSpread(a.dataset.spread); };
    });
    // home link
    const home = $('#arcHomeLink');
    if (home) home.onclick = (e) => { e.preventDefault(); setSpread('one'); };
    // init
    setSpread('one');
    bindInfoCards();
  }

  function unmount() {
    const main = root();
    if (main) main.innerHTML = '';
    state.cards = [];
  }

  window.ArcApp = { mount, unmount, setSpread, setDeck, drawN, buildShareText, getState: () => ({ ...state }) };
})();
