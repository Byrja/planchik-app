// arc-app.js — Архангел клон: 5 раскладов, роутер, общая история.
// TMA-safe: idempotent .onclick, no backdrop-filter на overlay.

(function () {
  'use strict';

  // ── DIAG: показывать ошибки прямо в UI (для TG WebView где нет консоли) ──
  function _showErr(e) {
    try {
      const msg = (e && (e.message || e.error && e.error.message)) || String(e);
      const stack = (e && e.error && e.error.stack) || (e && e.stack) || '';
      let bar = document.getElementById('arcErrorBar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'arcErrorBar';
        bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#c0392b;color:#fff;padding:10px;font:12px monospace;white-space:pre-wrap;max-height:50vh;overflow:auto;';
        document.body && document.body.appendChild(bar);
      }
      bar.textContent = '⚠️ ' + msg + '\n' + stack.split('\n').slice(0,3).join('\n');
    } catch (_) {}
  }
  window.addEventListener('error', (e) => _showErr(e));
  window.addEventListener('unhandledrejection', (e) => _showErr(e.reason || e));

  // ── Колода и источники ────────────────────────────────────
  const DECKS = {
    tarot:    { label: 'Таро',          deck: () => window.DECK_TAROT,     hint: 'Старшие + Младшие Арканы' },
    lenormand:{ label: 'Ленорман',      deck: () => window.DECK_LENORMAND, hint: '36 карт' },
    runes:    { label: 'Руны',          deck: () => window.DECK_RUNES,     hint: 'Elder Futhark' },
    gypsy:    { label: 'Цыганские',     deck: () => window.DECK_GYPSY,     hint: '36 карт' },
    playing:  { label: 'Игральные',     deck: () => window.DECK_PLAYING,   hint: 'Колода 36' }
  };

  // ── Все расклады Архангела ──────────────────────────────
  // Каждый: { count, ask, positions? (для кросс-раскладов), help? }
  // positions — массив меток для каждой карты
  const SPREADS = {
    one: {
      count: 1,
      ask: 'Сосредоточьтесь на вопросе и вытяните карту.',
      title: 'Одна карта',
      icon: '✦',
      hint: 'Классика. Один вопрос — один ответ.'
    },
    three: {
      count: 3,
      ask: 'Задайте вопрос о развитии ситуации. Три карты — прошлое, настоящее и будущее.',
      title: 'Три карты',
      icon: '⫶',
      positions: ['Прошлое', 'Настоящее', 'Будущее'],
      hint: 'Не гадайте чаще, чем раз в день.'
    },
    yesno: {
      count: 1,
      ask: 'Сформулируйте вопрос, на который можно ответить «да» или «нет».',
      title: 'Да или Нет',
      icon: '⨯',
      hint: 'Карта скажет «да», «нет» или «подожди».'
    },
    cross: {
      count: 10,
      ask: 'Кельтский крест — глубокий расклад. Используйте для важных жизненных вопросов.',
      title: 'Кельтский крест',
      icon: '✚',
      positions: [
        'Ситуация', 'Препятствие', 'Корень', 'Прошлое', 'Возможность',
        'Будущее', 'Вы', 'Окружение', 'Надежды и страхи', 'Итог'
      ],
      hints: [
        'что происходит сейчас', 'что мешает', 'основа, фундамент', 'что ушло', 'что может случиться',
        'что придёт', 'ваша позиция', 'влияние извне', 'внутреннее', 'конечный результат'
      ],
      hint: 'Не используйте для бытовых вопросов.'
    },
    love: {
      count: 2,
      ask: 'Совместимость. Думайте об обоих — о себе и о партнёре.',
      title: 'Совместимость',
      icon: '♥',
      positions: ['Ты', 'Он(а)'],
      hint: 'Карта покажет, что соединяет, а что разъединяет.'
    },
    // ── Новые расклады (из каталога Архангела) ──
    horseshoe: {
      count: 7,
      ask: 'Подкова — универсальный расклад на 7 карт. Подходит для любого важного вопроса.',
      title: 'Подкова',
      icon: '⌒',
      positions: ['Прошлое', 'Настоящее', 'Скрытые влияния', 'Препятствие', 'Возможность', 'Совет', 'Итог'],
      hint: 'Самая популярная схема после «трёх карт».'
    },
    alchemist: {
      count: 6,
      ask: 'Расклад Алхимика — классика, приписывают Нострадамусу. Глубокий анализ ситуации.',
      title: 'Алхимик',
      icon: '⚗',
      positions: ['Ситуация', 'Что помогает', 'Что мешает', 'Скрытое', 'Совет', 'Итог'],
      hint: 'Шесть карт раскрывают то, что лежит на поверхности и под ней.'
    },
    choice: {
      count: 7,
      ask: 'Расклад на выбор. Если вы между двумя вариантами — этот расклад для вас.',
      title: 'Выбор',
      icon: '⚖',
      positions: ['Вы сейчас', 'Путь A (если пойдёте)', 'Путь B (если пойдёте)', 'Что ведёт к A', 'Что ведёт к B', 'Совет', 'Итог'],
      hint: 'Думайте о двух конкретных вариантах.'
    },
    career: {
      count: 7,
      ask: 'Расклад на карьеру и бизнес. Для тех, кто думает о новой работе или своём деле.',
      title: 'Карьера',
      icon: '💼',
      positions: ['Сейчас в работе', 'Что помогает', 'Что мешает', 'Потенциал', 'Новая возможность', 'Совет', 'Итог'],
      hint: 'Семь карт охватывают всё поле карьеры.'
    },
    health: {
      count: 5,
      ask: 'Здоровье и настроение. Этот расклад — не медицинская диагностика, а подсказка, на что обратить внимание.',
      title: 'Здоровье',
      icon: '🌿',
      positions: ['Тело', 'Эмоции', 'Энергия', 'Что помогает', 'Что восстановить'],
      hint: 'Не заменяет врача.'
    },
    psyche: {
      count: 4,
      ask: 'Психологический портрет. Карты покажут скрытые черты характера.',
      title: 'Психопортрет',
      icon: '👁',
      positions: ['Как вы видите себя', 'Как вас видят другие', 'Что скрыто', 'Потенциал'],
      hint: 'О вас — со стороны.'
    },
    destiny: {
      count: 8,
      ask: 'Судьба и будущие события. Серьёзный расклад на 8 карт.',
      title: 'Судьба',
      icon: '✴',
      positions: ['Фундамент', 'Движущая сила', 'Внутренний ресурс', 'Ближайшее будущее', 'Препятствие', 'Помощь', 'Цель', 'Итог'],
      hint: 'Расклад на долгосрочную перспективу.'
    }
  };

  function getSpreadConfig(id) {
    return SPREADS[id] || SPREADS.one;
  }
  function getSpreadName(id) {
    const s = SPREADS[id];
    return s ? s.title : id;
  }
  function getSpreadIcon(id) {
    const s = SPREADS[id];
    return s ? s.icon : '✦';
  }

  // ── State ────────────────────────────────────────────────
  const state = {
    spread: 'one',     // active spread
    deck: 'tarot',     // active deck
    reversed: false,
    cards: [],         // массив вытянутых карт для текущего расклада
    question: '',
    history: [],
    lastEntryId: null  // id только что вытянутой записи (для заметок)
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

  // ── Рендер истории раскладов ──────────────────────────────
  function renderHistory() {
    const list = r$('#arcHistoryList');
    const empty = r$('#arcHistoryEmpty');
    if (!list || !empty) return;
    const items = state.history || [];
    if (!items.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    const SPREAD_LABELS = {
      one: 'Одна карта', three: 'Три карты', yesno: 'Да/Нет', love: 'Совместимость',
      horseshoe: 'Подкова', alchemist: 'Алхимик', choice: 'Выбор', career: 'Карьера',
      health: 'Здоровье', psyche: 'Психопортрет', destiny: 'Судьба', cross: 'Кельтский крест'
    };
    list.innerHTML = items.map((h, i) => {
      const date = new Date(h.ts);
      const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
      const cardsNames = (h.cards || []).slice(0, 4).map(c => {
        const rev = c.reversed ? '↺' : '';
        return `<span class="arc-history-card-chip">${escapeHtml(c.name)}${rev}</span>`;
      }).join('') + ((h.cards || []).length > 4 ? `<span class="arc-history-card-chip arc-history-more">+${(h.cards || []).length - 4}</span>` : '');
      const q = h.question ? `<div class="arc-history-q">«${escapeHtml(h.question)}»</div>` : '';
      return `<li class="arc-history-item" data-idx="${i}">
        <div class="arc-history-meta">
          <span class="arc-history-spread">${SPREAD_LABELS[h.spread] || h.spread}</span>
          <span class="arc-history-date">${dateStr}</span>
        </div>
        ${q}
        <div class="arc-history-cards">${cardsNames}</div>
      </li>`;
    }).join('');
  }

  function showHistory() {
    const panel = r$('#arcHistory');
    if (!panel) return;
    renderHistory();
    panel.hidden = false;
    // Скроллим к панели на мобилке
    try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) {}
  }

  function hideHistory() {
    const panel = r$('#arcHistory');
    if (panel) panel.hidden = true;
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
  // Колоды без понятия «перевёрнутое положение» (руны читаются как лежат;
  // игральные карты в раскладах интерпретируются по номиналу, а не по стороне).
  const NO_REVERSED = new Set(['runes', 'playing']);

  function drawN(n) {
    const deckArr = DECKS[state.deck].deck() || [];
    if (!deckArr.length) return [];
    const copy = deckArr.slice();
    // Fisher-Yates
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    const allowReversed = !NO_REVERSED.has(state.deck);
    return copy.slice(0, n).map(c => {
      const isRev = allowReversed && Math.random() < 0.30;
      return {
        ...c,
        reversed: isRev ? (c.reversed || 'Перевёрнутая карта — обратите внимание на скрытые качества.') : false
      };
    });
  }

  // ── Шаринг: текст для navigator.share / tg.sendData ────
  function buildShareText() {
    const deckName = DECKS[state.deck].label;
    if (state.cards.length === 0) return '';
    const cfg = getSpreadConfig(state.spread);
    if (state.cards.length === 1) {
      const c = state.cards[0];
      const pos = c.reversed ? 'перевёрнутая' : 'прямая';
      return `🂠 ${c.name} (${pos}, ${deckName})\n\n${c.reversed ? c.reversed : c.upright}\n\n— Гадалка · Архангел`;
    }
    const lines = [`🂠 Расклад «${cfg.title}» (${deckName})`];
    if (state.question) lines.push(`Вопрос: ${state.question}`);
    state.cards.forEach((c, i) => {
      const pos = c.reversed ? '⤵' : '↗';
      const label = (cfg.positions && cfg.positions[i]) || `#${i+1}`;
      lines.push(`\n${label} — ${pos} ${c.name}\n${c.reversed ? c.reversed : c.upright}`);
    });
    lines.push('\n— Гадалка · Архангел');
    return lines.join('\n');
  }

  // getSpreadName/getSpreadIcon определены выше (в разделе SPREADS)

  function shareResult() {
    const text = buildShareText();
    if (!text) return;
    const tg = window.TelegramApp && window.TelegramApp.tg;
    // 1) Пробуем отправить структурированные данные в бот
    if (tg && tg.sendData) {
      try {
        const payload = {
          type: 'arc_share',
          payload: {
            spread: state.spread,
            deck: state.deck,
            question: state.question,
            cards: state.cards.map(c => ({ id: c.id, name: c.name, reversed: c.reversed }))
          }
        };
        tg.sendData(JSON.stringify(payload));
        flashToast('Сохранено в боте');
        return;
      } catch (e) { /* fallback */ }
    }
    // 2) Fallback: Telegram share dialog
    if (tg && tg.openTelegramLink) {
      flashToast('Выбери чат для отправки');
      const url = 'https://t.me/share/url?url=' + encodeURIComponent('https://t.me/astro_byrbot') + '&text=' + encodeURIComponent(text);
      tg.openTelegramLink(url);
    } else if (navigator.share) {
      navigator.share({ title: 'Гадание — Гадалка', text }).catch(()=>{});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => flashToast('Скопировано в буфер'));
    } else {
      flashToast('Шаринг недоступен');
    }
  }

  // ── Внутреннее состояние: stage card grid ───────────────
  // Простая: считаем "да" / "нет" / "может быть" по upright + семантике
  const YES_WORDS = ['да', 'успех', 'любовь', 'счастье', 'радость', 'победа', 'солнце', 'звезда', 'благоприятный', 'согласие', 'союз', 'рост', 'изобилие', 'маг', 'император', 'императрица', 'влюблённ', 'колесниц', 'сил', 'колесо', 'справедлив', 'мир'];
  const NO_WORDS  = ['нет', 'конец', 'разруш', 'тюрьм', 'цепь', 'башн', 'дьявол', 'смерть', 'пятёрк', 'десятк мечей', 'тень', 'страх', 'обман', 'разрыв', 'предательство'];

  function yesNoInterpret(c) {
    const t = ((c.upright || '') + ' ' + (c.reversed || '')).toLowerCase();
    // Спецкарты: не бинарные, требуют контекста
    const AMBIGUOUS = ['judgement', 'hermit', 'hanged', 'moon', 'tower', 'fool', 'wheel'];
    if (AMBIGUOUS.some(k => (c.id || '').toLowerCase().includes(k))) {
      return { verdict: 'ЗАВИСИТ', tone: 'wait', detail: 'Эта карта не даёт прямого ответа. Она требует вашего решения и контекста, которого у карт нет.' };
    }
    if (c.reversed) {
      return { verdict: 'НЕТ', tone: 'no', detail: 'Карта в перевёрнутом положении. Путь закрыт или неблагоприятен.' };
    }
    const isYes = YES_WORDS.some(w => t.includes(w));
    const isNo  = NO_WORDS.some(w => t.includes(w));
    if (isYes && !isNo) return { verdict: 'ДА', tone: 'yes', detail: 'Прямое положение и светлая семантика. Путь открыт.' };
    if (isNo && !isYes) return { verdict: 'НЕТ', tone: 'no', detail: 'Прямое положение, но значение карты — отказ.' };
    return { verdict: 'ПОДОЖДИ', tone: 'wait', detail: 'Прямое положение, но ответ не бинарный. Нужно уточнение или время.' };
  }

  // Короткий практический совет для yes/no
  function yesNoAdvice(cardName, reversed) {
    if (reversed) return `Не спешите. ${cardName} перевёрнута — даже если формально путь открыт, в нём есть подвох. Перечитайте вопрос: возможно, вы спрашиваете не о том, о чём на самом деле хотите знать.`;
    return `${cardName} прямо — путь свободен. Но «да» карт — это «да» в текущих координатах. Если изменится контекст (люди, время, ваше состояние), ответ может сдвинуться.`;
  }

  // Толкование пары карт: учитывает их символику и взаимодействие
  function renderPairReading(a, b) {
    const both = `${a.name} + ${b.name}`;
    if (a.reversed && b.reversed) return `${both} — обе карты в тени. Это не приговор, но знак: что-то внутри вас обоих сейчас спит или сопротивляется. Вопрос не «получится ли», а «готовы ли вы оба проснуться».`;
    if (a.reversed && !b.reversed) return `${a.name} перевёрнута, ${b.name} — прямая. Связь есть, но один из вас сейчас в миноре, и это видно. Поддержка нужна в обе стороны.`;
    if (!a.reversed && b.reversed) return `${a.name} прямая, ${b.name} перевёрнута. Вы в форме — но партнёр сейчас не в ресурсе. Это не про несовместимость, а про время.`;
    return `${both} в прямом положении. Связь светлая, оба в моменте. Карты не обещают вечность, но обещают, что сейчас — то самое время, когда эта встреча работает.`;
  }

  // Итог расклада: 1-2 предложения по семантике всех карт
  function buildSpreadSummary(cards, cfg, question) {
    if (!cards || cards.length === 0) return '';
    // Считаем «светлые» и «теневые» карты
    let light = 0, shadow = 0;
    for (const c of cards) {
      if (c.reversed) shadow++;
      else light++;
    }
    const total = cards.length;
    const lightRatio = light / total;

    // Если вопрос содержит ключевые слова — контекстный summary
    const q = (question || '').toLowerCase();
    const contextChips = [];
    if (/работ|карьер|бизнес|проект|деньг|зарплат/.test(q)) contextChips.push('work');
    if (/любов|отношен|партнёр|муж|жен|чувств|встреч/.test(q)) contextChips.push('love');
    if (/здоровь|тело|энерг|бол|устал|спать/.test(q)) contextChips.push('health');
    if (/день|сегодня|завтра|недел|месяц/.test(q)) contextChips.push('time');

    let opening;
    if (lightRatio >= 0.75) opening = `Расклад светлый: ${light} из ${total} карт в прямом положении.`;
    else if (lightRatio <= 0.25) opening = `Расклад теневой: ${shadow} из ${total} карт перевёрнуты. Это не катастрофа, но знак остановиться.`;
    else if (lightRatio >= 0.5) opening = `Расклад смешанный, перевес в светлую сторону: ${light} против ${shadow}.`;
    else opening = `Расклад смешанный, перевес в тень: ${shadow} против ${light}.`;

    // Контекстная подсказка
    let contextPart = '';
    if (contextChips.includes('work')) {
      contextPart = ' Карта про работу, и ответ не в действии, а в том, как вы к нему относитесь.';
    } else if (contextChips.includes('love')) {
      contextPart = ' Карта про отношения — здесь ключ не в логике, а в том, что вы оба чувствуете, но не говорите.';
    } else if (contextChips.includes('health')) {
      contextPart = ' Карта о теле — не как о диагнозе, а как о сигнале: что вы давно игнорируете?';
    } else if (contextChips.includes('time')) {
      contextPart = ' Карта о времени — расклад на ближайшее будущее говорит: события уже в пути.';
    }

    // Завершение по конфигурации расклада
    let closing = '';
    if (cfg.title === 'Кельтский крест') {
      closing = ' Кельтский крест не про быстрый ответ — он про панораму. Позиция «итог» — самая важная.';
    } else if (cfg.title === 'Подкова') {
      closing = ' Подкова — рабочая лошадка среди раскладов. Итог в последней карте, а первые три — фундамент.';
    } else if (cfg.title === 'Три карты') {
      closing = ' Прошлое-Настоящее-Будущее — динамика. Смотрите, как энергия движется, а не на отдельные карты.';
    } else if (cfg.title === 'Судьба') {
      closing = ' Судьба — расклад на длинный горизонт. Не пытайтесь примерить его на завтра.';
    } else if (cfg.title === 'Выбор') {
      closing = ' В раскладе на выбор смотрите на карты A и B как на два голоса. Не на «правильный/неправильный», а на «как вам будет в каждом».'; 
    } else {
      closing = ' Доверьтесь первой реакции — перечитывание расклада только размывает.';
    }

    return opening + contextPart + closing;
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
  function cardImage(c) {
    if (c && c.image) return c.image;
    return null;
  }
  function renderCards() {
    const stage = r$('#arcStage');
    if (!stage) return;
    const n = state.cards.length;
    if (n === 0) {
      // Показываем полезное превью колоды — 3 реальные открытые карты из колоды
      const deckArr = DECKS[state.deck].deck() || [];
      const previewCount = Math.min(deckArr.length, 3);
      // Берём детерминированный срез (первые N) — стабильное превью, не «прыгает» при каждом рендере
      const preview = deckArr.slice(0, previewCount);
      const previewHtml = preview.map((c, i) => {
        const visual = c.image
          ? `<img src="${c.image}" alt="${escapeHtml(c.name)}" class="arc-preview-img" loading="lazy">`
          : `<div class="arc-preview-glyph">${c.symbol || '✦'}</div>`;
        return `<div class="arc-preview-card" data-idx="${i}">
          ${visual}
          <div class="arc-preview-name">${escapeHtml(c.name)}</div>
        </div>`;
      }).join('');
      stage.innerHTML = `
        <div class="arc-deck-ready" role="img" aria-label="Колода ${DECKS[state.deck].label} готова. ${deckArr.length} карт.">
          <div class="arc-deck-preview-grid" data-count="${previewCount}">${previewHtml}</div>
          <p class="arc-deck-hint"><strong>${DECKS[state.deck].label}</strong> · ${DECKS[state.deck].hint}. Задайте вопрос и нажмите «Тянуть».</p>
        </div>`;
      return;
    }
    // Мульти-карты: горизонтальная сетка
    if (n === 1) {
      const c = state.cards[0];
      const imgSrc = cardImage(c);
      stage.innerHTML = `
        <div id="cardStage" class="is-revealed" role="img" aria-label="Карта ${escapeHtml(c.name)}">
          <div class="arc-card-face arc-card-front">
            ${imgSrc
              ? `<img src="${imgSrc}" alt="${escapeHtml(c.name)}" class="arc-card-img ${c.reversed ? 'is-reversed' : ''}">`
              : `<div class="arc-card-glyph ${c.reversed ? 'is-reversed' : ''}">
                   <div class="arc-card-glyph-symbol">${c.symbol}</div>
                   <div class="arc-card-glyph-name">${escapeHtml(c.name)}</div>
                 </div>`
            }
          </div>
        </div>`;
    } else {
      const cardsHtml = state.cards.map((c, i) => {
        const cfg = getSpreadConfig(state.spread);
        const label = (cfg.positions && cfg.positions[i]) || `#${i+1}`;
        const imgSrc = cardImage(c);
        const visual = imgSrc
          ? `<img src="${imgSrc}" alt="${escapeHtml(c.name)}" class="arc-mini-card-img ${c.reversed ? 'is-reversed' : ''}">`
          : `<div class="arc-mini-card-glyph ${c.reversed ? 'is-reversed' : ''}">${c.symbol || '✦'}</div>`;
        return `<div class="arc-mini-card" data-idx="${i}">
          ${visual}
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
        <p class="arc-inter-context">${escapeHtml(r.detail)}</p>
        <div class="arc-reading-tips">
          <p class="arc-tips-title">Совет</p>
          <p>${escapeHtml(yesNoAdvice(c.name, c.reversed))}</p>
        </div>`;
      return;
    }
    if (state.spread === 'love') {
      const r = loveInterpret(state.cards[0], state.cards[1]);
      const [a, b] = state.cards;
      const visA = cardImage(a)
        ? `<img src="${cardImage(a)}" alt="${escapeHtml(a.name)}" class="arc-love-img ${a.reversed ? 'is-reversed' : ''}">`
        : `<div class="arc-love-glyph ${a.reversed ? 'is-reversed' : ''}">${a.symbol}</div>`;
      const visB = cardImage(b)
        ? `<img src="${cardImage(b)}" alt="${escapeHtml(b.name)}" class="arc-love-img ${b.reversed ? 'is-reversed' : ''}">`
        : `<div class="arc-love-glyph ${b.reversed ? 'is-reversed' : ''}">${b.symbol}</div>`;
      const pairReading = renderPairReading(a, b);
      target.innerHTML = `
        <div class="arc-verdict arc-verdict-score">${r.verdict} · ${r.score}/10</div>
        <div class="arc-love-grid">
          <div class="arc-love-side">
            <div class="arc-love-label">Ты</div>
            ${visA}
            <div class="arc-love-name">${escapeHtml(a.name)}</div>
            <p class="arc-love-text">${escapeHtml(a.reversed || a.upright)}</p>
          </div>
          <div class="arc-love-connector">⇌</div>
          <div class="arc-love-side">
            <div class="arc-love-label">Он(а)</div>
            ${visB}
            <div class="arc-love-name">${escapeHtml(b.name)}</div>
            <p class="arc-love-text">${escapeHtml(b.reversed || b.upright)}</p>
          </div>
        </div>
        <div class="arc-reading-pair">
          <p class="arc-tips-title">Связь между картами</p>
          <p>${pairReading}</p>
        </div>
        <p class="arc-inter-context">${escapeHtml(r.detail)}</p>`;
      return;
    }
    // Общий путь: одна / три / кельтский крест / подкова / алхимик / выбор / карьера / здоровье / психея / судьба
    const cfg = getSpreadConfig(state.spread);
    const sections = state.cards.map((c, i) => {
      const label = (cfg.positions && cfg.positions[i]) || `#${i+1}`;
      const hint  = (cfg.hints && cfg.hints[i]) || '';
      const headline = c.reversed ? 'Перевёрнутое положение' : 'Прямое положение';
      const img = cardImage(c);
      const visual = img
        ? `<img src="${img}" alt="${escapeHtml(c.name)}" class="arc-inter-img ${c.reversed ? 'is-reversed' : ''}">`
        : `<span class="arc-inter-glyph ${c.reversed ? 'is-reversed' : ''}">${c.symbol || '✦'}</span>`;
      return `<div class="arc-inter-section">
        <div class="arc-inter-section-head">
          ${visual}
          <div>
            <h3 class="arc-inter-title">${label}${hint ? ` <span class="arc-inter-hint">— ${hint}</span>` : ''}</h3>
            <p class="arc-inter-card">${escapeHtml(c.name)} · ${headline}</p>
          </div>
        </div>
        <p class="arc-inter-main">${escapeHtml(c.reversed || c.upright)}</p>
        ${c.shadow ? `<p class="arc-inter-shadow"><span class="arc-shadow-label">Тень:</span> ${escapeHtml(c.shadow)}</p>` : ''}
      </div>`;
    }).join('');
    // Общий итог — summary всего расклада
    const summary = buildSpreadSummary(state.cards, cfg, q);
    target.innerHTML = sections +
      (summary ? `<div class="arc-reading-summary"><p class="arc-tips-title">Итог расклада</p><p>${summary}</p></div>` : '') +
      (q ? `<p class="arc-inter-context">В контексте вопроса <em>«${escapeHtml(q)}»</em> — карты указывают, что ответ уже формируется. Доверьтесь первому импульсу.</p>` : '');
    // AI-кнопка рисуется в слот #arcAiSlot под основной расшифровкой
    if (typeof renderAiButton === 'function') renderAiButton();
  }

  // ── Шаблон конкретного расклада ─────────────────────────
  function templateSpread() {
    return getSpreadConfig(state.spread);
  }

  // ── Mount конкретного расклада ─────────────────────────
  function mountSpread() {
    const main = root();
    if (!main) return;
    const t = templateSpread();
    // Горизонтальный таб-бар раскладов (sticky на мобиле, inline на десктопе)
    const tabsHtml = Object.keys(SPREADS).map(id => {
      const s = SPREADS[id];
      const active = id === state.spread ? ' is-active' : '';
      return `<button type="button" class="arc-spread-tab${active}" data-spread="${id}">
        <span class="arc-spread-tab-ico">${s.icon}</span>
        <span class="arc-spread-tab-label">${escapeHtml(s.title)}</span>
      </button>`;
    }).join('');
    main.innerHTML = `
      <div class="arc-spread-tabs-wrap">
        <nav class="arc-spread-tabs" id="arcSpreadTabs" aria-label="Сменить расклад">
          ${tabsHtml}
        </nav>
      </div>
      <div class="arc-panel-title">${escapeHtml(t.title)}</div>
      <p class="arc-panel-sub">${escapeHtml(t.ask)}</p>
      ${t.hint ? `<p class="arc-panel-hint">${escapeHtml(t.hint)}</p>` : ''}

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
        <div id="arcAiSlot"></div>
        <div id="arcNoteSlot"></div>
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
    if (ctaD) ctaD.onclick = beginDrawRitual;
    const ctaR = r$('#ctaReset');
    if (ctaR) ctaR.onclick = () => { state.cards = []; resetReading(); renderCards(); renderInterpretation(); };
    const ctaS = r$('#ctaShare');
    if (ctaS) ctaS.onclick = shareResult;

    // wire spread tabs
    $$('.arc-spread-tab', main).forEach(btn => {
      btn.onclick = (e) => { e.preventDefault(); setSpread(btn.dataset.spread); };
    });
    // прокрутить активный таб в зону видимости (мобила)
    requestAnimationFrame(() => {
      const active = main.querySelector('.arc-spread-tab.is-active');
      if (active && active.scrollIntoView) {
        try { active.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' }); } catch (_) {}
      }
    });
  }

  // ── Действие «Тянуть» ───────────────────────────────────
  function doDraw() {
    if (state.cards.length > 0) return;
    const t = templateSpread();
    state.cards = drawN(t.count);
    const entryId = 'h_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    state.lastEntryId = entryId;
    // history entry
    state.history.unshift({
      id: entryId,
      ts: Date.now(),
      spread: state.spread,
      deck: state.deck,
      cards: state.cards.map(c => ({ id: c.id, name: c.name, reversed: c.reversed })),
      question: state.question,
      note: ''
    });
    saveHistory();

    const stage = r$('#arcStage');
    if (stage) stage.classList.add('is-lit');

    // Анимация: для одной карты flip; для мульти — поочерёдная раздача
    if (t.count === 1) {
      const cardEl = document.createElement('div');
      cardEl.id = 'cardStage';
      cardEl.setAttribute('role', 'img');
      const c = state.cards[0];
      cardEl.setAttribute('aria-label', `Карта ${c.name}`);
      const imgSrc = cardImage(c);
      const frontContent = imgSrc
        ? `<img src="${imgSrc}" alt="${escapeHtml(c.name)}" class="arc-card-img ${c.reversed ? 'is-reversed' : ''}">`
        : `<div class="arc-card-glyph ${c.reversed ? 'is-reversed' : ''}">
             <div class="arc-card-glyph-symbol">${c.symbol}</div>
             <div class="arc-card-glyph-name">${escapeHtml(c.name)}</div>
           </div>`;
      // 3D-flip не используем (backface-visibility глючит на iOS WebKit).
      // Вместо этого: back на 700мс → crossfade на front.
      cardEl.innerHTML = `
        <div class="arc-card-face arc-card-back"><span class="arc-card-back-mark">⚜</span></div>
        <div class="arc-card-face arc-card-front arc-card-front--hidden">${frontContent}</div>`;
      const st = r$('#arcStage');
      st.innerHTML = '';
      st.appendChild(cardEl);
      cardEl.classList.add('is-flipping');
      setTimeout(() => {
        // Скрываем back, показываем front — надёжно, без 3D-transform.
        const back = cardEl.querySelector('.arc-card-back');
        const front = cardEl.querySelector('.arc-card-front');
        if (back) back.style.display = 'none';
        if (front) front.classList.remove('arc-card-front--hidden');
        r$('#arcResult').classList.add('is-revealed');
        r$('#ctaDraw').disabled = true;
        r$('#ctaDraw').textContent = '✓  Готово';
        r$('#ctaReset').disabled = false;
        r$('#ctaShare').style.display = 'inline-flex';
        renderInterpretation();
        renderNotePanel();
        tryVibrate(20);
      }, 700);
    } else {
      // мульти — поочерёдная раздача: каждая карта появляется с задержкой
      renderCards();
      const st = r$('#arcStage');
      if (st) {
        const miniCards = st.querySelectorAll('.arc-mini-card');
        miniCards.forEach((mc, i) => {
          mc.classList.add('arc-dealing');
          mc.style.opacity = '0';
          mc.style.transform = 'translateY(20px) scale(0.85)';
          setTimeout(() => {
            mc.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
            mc.style.opacity = '1';
            mc.style.transform = '';
          }, 100 + i * 180);
        });
      }
      // Интерпретация появляется после раздачи всех карт
      const totalDelay = 100 + t.count * 180 + 200;
      setTimeout(() => {
        r$('#arcResult').classList.add('is-revealed');
        r$('#ctaDraw').disabled = true;
        r$('#ctaDraw').textContent = '✓  Готово';
        r$('#ctaReset').disabled = false;
        r$('#ctaShare').style.display = 'inline-flex';
        renderInterpretation();
        renderNotePanel();
        tryVibrate(20);
      }, totalDelay);
    }
  }

  // ── Панель заметки к только что вытянутому раскладу ──
  function renderNotePanel() {
    const slot = r$('#arcNoteSlot');
    if (!slot) return;
    const id = state.lastEntryId;
    if (!id) { slot.innerHTML = ''; return; }
    const entry = state.history.find(h => h.id === id);
    if (!entry) { slot.innerHTML = ''; return; }
    const note = entry.note || '';
    const has = note.trim().length > 0;
    slot.innerHTML = `
      <div class="arc-note-panel${has ? ' has-note' : ''}">
        <div class="arc-note-head">
          <span class="arc-note-label">✎ Заметка «Почему я тянул эту карту?»</span>
        </div>
        <textarea class="arc-note-text" id="arcNoteText" maxlength="600" placeholder="Контекст, что было на душе, чего ждал…">${escapeHtml(note)}</textarea>
        <div class="arc-note-foot">
          <span class="arc-note-count" id="arcNoteCount">${note.length}/600</span>
          <span class="arc-note-saved" id="arcNoteSaved" hidden>✓ сохранено</span>
        </div>
      </div>`;
    const ta = slot.querySelector('#arcNoteText');
    const cnt = slot.querySelector('#arcNoteCount');
    const saved = slot.querySelector('#arcNoteSaved');
    let saveTimer = null;
    ta.addEventListener('input', () => {
      const v = ta.value;
      cnt.textContent = `${v.length}/600`;
      saved.hidden = true;
      slot.firstElementChild.classList.toggle('has-note', v.trim().length > 0);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const e2 = state.history.find(h => h.id === id);
        if (e2) {
          e2.note = v;
          saveHistory();
          saved.hidden = false;
          setTimeout(() => { saved.hidden = true; }, 1500);
        }
      }, 600); // debounce 600ms
    });
  }

  // ── Ритуал фокуса перед тягой ──────────────────────────
  // Двухфазный клик: 1-й показывает focus-оверлей, 2-й — реально тянет.
  // Превращает «нажми кнопку» в маленький ритуал с breathing-анимацией.
  function beginDrawRitual() {
    if (state.cards.length > 0) return; // уже вытянуто
    if (reducedMotion()) { doDraw(); return; } // reduced-motion — без задержек

    // Удалить старый оверлей, если есть
    const old = document.getElementById('arcFocusOverlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'arcFocusOverlay';
    overlay.className = 'arc-focus-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Сосредоточьтесь на вопросе');
    const cfg = getSpreadConfig(state.spread);
    overlay.innerHTML = `
      <div class="arc-focus-inner">
        <div class="arc-focus-ring" aria-hidden="true"></div>
        <div class="arc-focus-ring arc-focus-ring-2" aria-hidden="true"></div>
        <div class="arc-focus-eye">${cfg.icon || '✦'}</div>
        <h3 class="arc-focus-title">Сосредоточьтесь на вопросе</h3>
        <p class="arc-focus-sub">Вдохните. Выдохните.<br>Когда будете готовы — нажмите «Тянуть».</p>
        <div class="arc-focus-actions">
          <button type="button" class="arc-cta arc-cta-primary arc-focus-draw" id="arcFocusDraw">🂠  Тянуть</button>
          <button type="button" class="arc-cta arc-cta-ghost arc-focus-cancel" id="arcFocusCancel">Отойти</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    requestAnimationFrame(() => overlay.classList.add('is-open'));
    tryVibrate(8);

    const draw = overlay.querySelector('#arcFocusDraw');
    const cancel = overlay.querySelector('#arcFocusCancel');
    const close = () => {
      overlay.classList.remove('is-open');
      setTimeout(() => overlay.remove(), 250);
    };
    draw.onclick = () => { close(); doDraw(); tryVibrate(15); };
    cancel.onclick = close;
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); }
    });
  }

  // ── AI-расшифровка (глубинный разбор от гадалки) ────────────
  // Минимальный markdown-парсер для AI-вывода. Поддерживает:
  //   ## / ### заголовки, **bold**, *italic*, - список, абзацы, переносы строк.
  // Без зависимостей, без XSS (escapeHtml сначала, потом разметка по белому списку).
  function mdLight(src) {
    if (!src) return '';
    const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    // сначала экранируем HTML, потом парсим markdown
    const lines = esc(src).split(/\n/);
    const out = [];
    let listBuf = null;   // буфер строк <ul>
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
      if (h2) { flushList(); out.push('<h4 class="arc-ai-h">' + inline(h2[1]) + '</h4>'); continue; }
      if (h3) { flushList(); out.push('<h5 class="arc-ai-h5">' + inline(h3[1]) + '</h5>'); continue; }
      if (li) { listBuf = listBuf || []; listBuf.push('<li>' + inline(li[1]) + '</li>'); continue; }
      // обычный параграф — накапливаем строки пока не пустая
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

  function aiKey(spread, cards) {
    // ключ кэша: расклад + позиции (без имени карты — она уже видна)
    return 'arhAi_' + spread + '_' + cards.map(c => (c.position || '?') + ':' + (c.reversed ? 'r' : 'u')).join('|');
  }
  function aiDailyCount() {
    try {
      const raw = localStorage.getItem('arhAiDaily');
      const obj = raw ? JSON.parse(raw) : { date: '', count: 0 };
      const today = new Date().toISOString().slice(0, 10);
      if (obj.date !== today) return { date: today, count: 0, obj: { date: today, count: 0 } };
      return { date: today, count: obj.count || 0, obj };
    } catch (e) { return { date: '', count: 0, obj: { date: '', count: 0 } }; }
  }
  function aiDailyInc(obj) {
    try { localStorage.setItem('arhAiDaily', JSON.stringify(obj)); } catch (e) {}
  }
  // публичный лимит — 5/день (сервер тоже лимитирует; тут — UX-гейт + кэш)
  const AI_DAILY_LIMIT = 5;

  function renderAiButton() {
    const slot = r$('#arcAiSlot');
    if (!slot) return;
    if (state.cards.length === 0) { slot.innerHTML = ''; return; }
    // yesno/love/celtic — допустимо, лимит тот же
    const key = aiKey(state.spread, state.cards);
    let cached = null;
    try { cached = localStorage.getItem(key); } catch (e) {}

    const daily = aiDailyCount();
    const remaining = Math.max(0, AI_DAILY_LIMIT - daily.count);

    if (cached) {
      // уже разобрано — показываем
      slot.innerHTML = `
        <div class="arc-ai-card is-loaded" id="arcAiCard">
          <div class="arc-ai-head">
            <span class="arc-ai-orb">🔮</span>
            <div>
              <div class="arc-ai-title">Глубинный разбор от гадалки</div>
              <div class="arc-ai-sub">сохранено · осталось сегодня: ${remaining}/${AI_DAILY_LIMIT}</div>
            </div>
          </div>
          <div class="arc-ai-body arc-ai-md">${mdLight(cached)}</div>
          <div class="arc-ai-foot">
            <button type="button" class="arc-ai-toggle" data-action="toggle">свернуть</button>
            <button type="button" class="arc-ai-redo" data-action="redo">↻ пересоздать</button>
          </div>
        </div>`;
      wireAiCard(slot, key, /*alreadyCached*/ true);
      return;
    }

    if (remaining === 0) {
      slot.innerHTML = `
        <div class="arc-ai-card is-locked">
          <div class="arc-ai-head">
            <span class="arc-ai-orb">🔮</span>
            <div>
              <div class="arc-ai-title">Глубинный разбор от гадалки</div>
              <div class="arc-ai-sub">лимит ${AI_DAILY_LIMIT}/день исчерпан · сброс в полночь UTC</div>
            </div>
          </div>
        </div>`;
      return;
    }

    slot.innerHTML = `
      <div class="arc-ai-card is-cta">
        <div class="arc-ai-head">
          <span class="arc-ai-orb">🔮</span>
          <div>
            <div class="arc-ai-title">Глубинный разбор от гадалки</div>
            <div class="arc-ai-sub">ИИ-прорицатель · осталось сегодня: ${remaining}/${AI_DAILY_LIMIT}</div>
          </div>
        </div>
        <p class="arc-ai-pitch">Психологическая и символическая интерпретация вашего расклада. Не общая астрология, а личный разбор — что лежит в основе, где узел, и что делать.</p>
        <div class="arc-ai-actions">
          <button type="button" class="arc-ai-go" data-action="go">🔮  Получить разбор</button>
        </div>
      </div>`;
    wireAiCard(slot, key, /*alreadyCached*/ false);
  }

  function wireAiCard(slot, key, alreadyCached) {
    const go = slot.querySelector('[data-action="go"]');
    const toggle = slot.querySelector('[data-action="toggle"]');
    const redo = slot.querySelector('[data-action="redo"]');
    const card = slot.querySelector('#arcAiCard') || slot.querySelector('.arc-ai-card');

    if (go) go.onclick = () => doAiInterpret(key);
    if (redo) redo.onclick = () => {
      if (!confirm('Удалить сохранённый разбор и сгенерировать новый? Это сожжёт один из лимитов на сегодня.')) return;
      try { localStorage.removeItem(key); } catch (e) {}
      const daily = aiDailyCount();
      // удаление из кэша не возвращает лимит, но юзер уже знает
      renderAiButton();
    };
    if (toggle) toggle.onclick = () => {
      if (!card) return;
      const body = card.querySelector('.arc-ai-body');
      if (!body) return;
      const collapsed = body.style.display === 'none';
      body.style.display = collapsed ? '' : 'none';
      toggle.textContent = collapsed ? 'свернуть' : 'развернуть';
    };
  }

  async function doAiInterpret(key) {
    const slot = r$('#arcAiSlot');
    if (!slot) return;
    const card = slot.querySelector('.arc-ai-card');
    if (!card) return;
    // показать loader
    card.classList.add('is-loading');
    card.classList.remove('is-cta');
    const body = card.querySelector('.arc-ai-body');
    card.querySelector('.arc-ai-actions')?.remove();
    if (!body) {
      const b = document.createElement('div');
      b.className = 'arc-ai-body markdown';
      b.innerHTML = '<div class="arc-ai-spinner"></div><div class="arc-ai-loading-text">Гадалка смотрит в карты…</div>';
      card.appendChild(b);
    } else {
      body.innerHTML = '<div class="arc-ai-spinner"></div><div class="arc-ai-loading-text">Гадалка смотрит в карты…</div>';
      body.style.display = '';
    }
    // увеличить счётчик сразу (optimistic), откатим при ошибке
    const daily = aiDailyCount();
    const obj = daily.obj;
    obj.count = (obj.count || 0) + 1;
    aiDailyInc(obj);

    try {
      const initData = window.Telegram?.WebApp?.initData || '';
      const cards = state.cards.map(c => ({
        name: c.name, position: c.position, reversed: !!c.reversed,
        arcana: c.arcana, suit: c.suit,
      }));
      const spreadCfg = SPREADS[state.spread] || { title: state.spread };
      const res = await fetch('/api/arc/interpret?initData=' + encodeURIComponent(initData), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          spread: state.spread,
          spreadName: spreadCfg.title,
          cards,
          question: state.question || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        // откатить счётчик
        obj.count = Math.max(0, (obj.count || 1) - 1);
        aiDailyInc(obj);
        const msg = data?.error === 'rate_limited' ? 'Лимит на сегодня исчерпан. Сброс в полночь UTC.' :
                    data?.error === 'llm_failed' ? 'Гадалка временно недоступна. Попробуйте позже.' :
                    data?.message || ('Ошибка ' + res.status);
        if (body) body.innerHTML = '<div class="arc-ai-error">' + escapeHtml(msg) + '</div>';
        card.classList.remove('is-loading');
        return;
      }
      // сохранить в кэш + история
      try { localStorage.setItem(key, data.interpretation); } catch (e) {}
      // записать в arhHistory[i].aiInterp если есть lastEntryId
      try {
        if (state.lastEntryId) {
          const hist = JSON.parse(localStorage.getItem('arhHistory') || '[]');
          const idx = hist.findIndex(h => h.id === state.lastEntryId);
          if (idx >= 0) {
            hist[idx].aiInterp = data.interpretation;
            localStorage.setItem('arhHistory', JSON.stringify(hist));
          }
        }
      } catch (e) {}
      // перерисовать кнопку (покажет свёрнутую карточку)
      renderAiButton();
    } catch (e) {
      obj.count = Math.max(0, (obj.count || 1) - 1);
      aiDailyInc(obj);
      if (body) body.innerHTML = '<div class="arc-ai-error">Нет связи с гадалкой. Попробуйте позже.</div>';
      card.classList.remove('is-loading');
    }
  }

  function reducedMotion() {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ── Роутер по раскладам ─────────────────────────────────
  function setSpread(id) {
    if (!SPREADS[id]) return;
    const cfg = SPREADS[id];
    const changing = state.spread !== id;
    state.spread = id;
    state.cards = [];
    // Обновляем заголовок и подзаголовок в hero портала
    const title = $('#arcTitle');
    if (title) {
      // Берём только первое предложение из ask для hero, hint — мелким курсивом
      const ask = (cfg.ask || '').trim();
      const firstSentence = (ask.split(/[.!?]/)[0] || ask).trim() || ask;
      title.innerHTML = escapeHtml(firstSentence) + (cfg.hint ? ' <em>' + escapeHtml(cfg.hint) + '</em>' : '');
    }
    const eyebrow = document.querySelector('.arc-hero-eyebrow');
    if (eyebrow) {
      const c = cfg.count;
      const word = c === 1 ? 'карта' : (c >= 2 && c <= 4 ? 'карты' : 'карт');
      eyebrow.textContent = cfg.title ? `${cfg.title.toLowerCase()} · ${c} ${word}` : `${c} ${word}`;
    }
    // Подсветка в сайдбаре и mobile-nav
    $$('.arc-nav-link').forEach(a => a.classList.toggle('is-active', a.dataset.spread === id));
    syncMobileNavLabel();
    // Если меняем расклад — полный reset (новая колода, новая сцена)
    if (changing) {
      mountSpread();
      // сбрасываем stage и re-enable кнопку, чтобы не застряла в «✓ Готово»
      const stage = r$('#arcStage');
      if (stage) stage.classList.add('is-lit');
      const btnD = r$('#ctaDraw');
      if (btnD) { btnD.disabled = false; btnD.textContent = '🂠  Тянуть'; }
      const btnR = r$('#ctaReset');
      if (btnR) btnR.disabled = true;
      const btnS = r$('#ctaShare');
      if (btnS) btnS.style.display = 'none';
      const res = r$('#arcResult');
      if (res) res.classList.remove('is-revealed');
    } else {
      mountSpread();
    }
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
    try {
      console.log('[ArcApp] mount() start');
      state.history = loadHistory();
      console.log('[ArcApp] history loaded:', state.history.length);
      // wire nav
      const navLinks = $$('.arc-nav-link');
      console.log('[ArcApp] nav links found:', navLinks.length);
      navLinks.forEach(a => {
        a.onclick = (e) => { e.preventDefault(); setSpread(a.dataset.spread); };
      });
      // home link
      const home = $('#arcHomeLink');
      if (home) home.onclick = (e) => { e.preventDefault(); setSpread('one'); };
      // init
      setSpread('one');
      console.log('[ArcApp] setSpread done');
      bindInfoCards();
      bindMobileNav();
      bindHistory();
      console.log('[ArcApp] mount() OK');
    } catch (e) {
      console.error('[ArcApp] mount FAILED', e);
      _showErr({ message: 'mount() failed: ' + e.message, stack: e.stack });
    }
  }

  // ── История — wire кнопки ────────────────────────────────
  function bindHistory() {
    const btn = r$('#arcHistoryBtn');
    const close = r$('#arcHistoryClose');
    const clear = r$('#arcHistoryClear');
    if (btn) btn.onclick = (e) => { e.preventDefault(); showHistory(); };
    if (close) close.onclick = (e) => { e.preventDefault(); hideHistory(); };
    if (clear) clear.onclick = (e) => {
      e.preventDefault();
      if (!confirm('Очистить всю историю раскладов?')) return;
      state.history = [];
      try { localStorage.removeItem('arhHistory'); } catch (err) {}
      renderHistory();
    };
  }

  // ── Mobile sticky spread picker ─────────────────────────
  function bindMobileNav() {
    const btn   = $('#arcMobileNavBtn');
    const popup = $('#arcMobileNavPopup');
    const list  = $('#arcMobileNavList');
    const lbl   = $('#arcMobileNavLabel');
    if (!btn || !popup || !list) return;
    // Собираем список раскладов из сайдбара (один источник истины)
    list.innerHTML = $$('#arcNav li').map(li => {
      const a = li.querySelector('a');
      if (!a) return '';
      const spread = a.dataset.spread;
      const ico = (a.querySelector('.ico') || {}).textContent || '✦';
      const meta = a.querySelector('.arc-nav-meta');
      const metaHtml = meta ? `<span class="arc-nav-meta">${meta.textContent}</span>` : '';
      // вытащим текст без ico и meta
      let label = '';
      a.childNodes.forEach(n => {
        if (n.nodeType === 3) label += n.textContent;
      });
      label = label.trim();
      return `<li><a href="#" data-spread="${spread}" class="arc-nav-link"><span class="ico">${ico}</span> ${label} ${metaHtml}</a></li>`;
    }).join('');
    // wire внутри popup
    list.querySelectorAll('a').forEach(a => {
      a.onclick = (e) => {
        e.preventDefault();
        setSpread(a.dataset.spread);
        closePopup();
      };
    });
    // toggle popup
    btn.onclick = (e) => {
      e.stopPropagation();
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      if (isOpen) closePopup(); else openPopup();
    };
    // закрыть при клике вне
    document.addEventListener('click', (e) => {
      if (popup.hidden) return;
      if (!popup.contains(e.target) && !btn.contains(e.target)) closePopup();
    });
    // закрыть по Esc
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !popup.hidden) closePopup();
    });
    function openPopup() {
      popup.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
    }
    function closePopup() {
      popup.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    }
  }
  // обновляем label в mobile-nav когда меняется spread
  function syncMobileNavLabel() {
    const lbl = $('#arcMobileNavLabel');
    if (!lbl) return;
    const cfg = getSpreadConfig(state.spread);
    lbl.textContent = cfg.title;
    // подсветка в popup
    const list = $('#arcMobileNavList');
    if (list) {
      list.querySelectorAll('a').forEach(a => a.classList.toggle('is-active', a.dataset.spread === state.spread));
    }
  }

  function unmount() {
    const main = root();
    if (main) main.innerHTML = '';
    state.cards = [];
  }

  window.ArcApp = { mount, unmount, setSpread, setDeck, drawN, buildShareText, getState: () => ({ ...state }) };
})();
