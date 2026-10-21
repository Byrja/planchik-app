// arc-app.js — портал гаданий: 5 колод, 12 раскладов, общая история.
// TMA-safe: idempotent .onclick, no backdrop-filter на overlay.

(function () {
  'use strict';

  // ── DIAG: показывать ошибки прямо в UI только при ?debug=1 ──
  const ARC_DEBUG = new URLSearchParams(window.location.search).get('debug') === '1';

  function _showErr(e) {
    if (!ARC_DEBUG) return;
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
  if (ARC_DEBUG) {
    window.addEventListener('error', (e) => _showErr(e));
    window.addEventListener('unhandledrejection', (e) => _showErr(e.reason || e));
  }

  // ── Колода и источники ────────────────────────────────────
  const DECKS = {
    tarot:    { label: 'Таро',          deck: () => window.DECK_TAROT,     hint: 'Старшие + Младшие Арканы' },
    lenormand:{ label: 'Ленорман',      deck: () => window.DECK_LENORMAND, hint: '36 карт' },
    runes:    { label: 'Руны',          deck: () => window.DECK_RUNES,     hint: 'Elder Futhark' },
    gypsy:    { label: 'Цыганские',     deck: () => window.DECK_GYPSY,     hint: '36 карт' },
    playing:  { label: 'Игральные',     deck: () => window.DECK_PLAYING,   hint: 'Колода 36' }
  };
  const DECK_IDS = Object.keys(DECKS);

  // ── Все расклады портала ───────────────────────────────
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
      ask: 'Задайте вопрос о ситуации. Три карты покажут суть, движение к ней и итог.',
      title: 'Три карты',
      icon: '⫶',
      positions: ['Суть', 'Что ведёт к этому', 'Итог'],
      variants: [
        { label: 'Ситуация', positions: ['Суть', 'Что ведёт к этому', 'Итог'] },
        { label: 'Время', positions: ['Прошлое', 'Настоящее', 'Будущее'] },
        { label: 'Отношения', positions: ['Вы', 'Партнёр', 'Динамика'] }
      ],
      hint: 'Выберите подходящую схему перед раскладом.'
    },
    yesno: {
      count: 1,
      ask: 'Сформулируйте вопрос, на который можно ответить «да» или «нет».',
      title: 'Да или Нет',
      icon: '⨯',
      hint: 'Карта скажет «да», «нет» или «подожди».'
    },
    coin: {
      count: 10,
      ask: 'Задайте вопрос и бросьте монеты. Орёл подталкивает к действию, решка просит подождать.',
      title: 'Орёл или Решка',
      icon: '◉',
      hint: 'Быстрый оракул на монетах — с красивым скином вместо скучного генератора.'
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
    // ── Новые расклады ──
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


  const SCENARIO_GROUPS = [
    {
      id: 'love',
      icon: '❤️',
      title: 'Любовь',
      text: 'Что чувствует, почему молчит, есть ли будущее.',
      presets: [
        { label: 'Что он/она чувствует?', spread: 'three', variant: 2, deck: 'tarot', question: 'Что он/она сейчас чувствует ко мне?' },
        { label: 'Почему молчит?', spread: 'three', variant: 2, deck: 'lenormand', question: 'Почему он/она молчит и что за этим стоит?' },
        { label: 'Есть ли будущее?', spread: 'love', deck: 'tarot', question: 'Есть ли у этих отношений будущее?' },
        { label: 'Вернётся ли бывший?', spread: 'yesno', deck: 'tarot', question: 'Вернётся ли бывший человек в мою жизнь?' },
        { label: 'Стоит ли писать?', spread: 'yesno', deck: 'tarot', question: 'Стоит ли мне написать первой/первым?' },
        { label: 'Есть ли соперник/соперница?', spread: 'three', variant: 2, deck: 'lenormand', question: 'Есть ли третий человек или скрытое влияние в этих отношениях?' },
        { label: 'Что мешает любви?', spread: 'alchemist', deck: 'tarot', question: 'Что сейчас мешает любви и сближению между нами?' },
        { label: 'Прогноз на 7 дней', spread: 'horseshoe', deck: 'tarot', question: 'Как будут развиваться отношения в ближайшие 7 дней?' },
      ],
    },
    {
      id: 'viral',
      icon: '✨',
      title: 'Быстрые форматы',
      text: 'Короткие вопросы, которыми хочется поделиться.',
      presets: [
        { label: 'Карта на него/неё', spread: 'one', deck: 'tarot', question: 'Какая карта описывает этого человека по отношению ко мне?' },
        { label: 'Твой красный флаг', spread: 'one', deck: 'runes', question: 'Какой мой главный красный флаг сейчас?' },
        { label: 'Кто я в любви?', spread: 'one', deck: 'tarot', question: 'Какой мой архетип в любви сейчас?' },
        { label: 'Что обо мне думают?', spread: 'three', variant: 0, deck: 'gypsy', question: 'Что обо мне думают за спиной?' },
        { label: 'Послание Вселенной', spread: 'one', deck: 'all', question: 'Какое послание мне сейчас важно услышать?' },
        { label: 'Что мешает мне?', spread: 'three', variant: 0, deck: 'lenormand', question: 'Что мне сейчас мешает и как это обойти?' },
      ],
    },
    {
      id: 'money',
      icon: '💰',
      title: 'Деньги / работа',
      text: 'Работа, деньги, проект, риск и точка роста.',
      presets: [
        { label: 'Менять работу?', spread: 'career', deck: 'tarot', question: 'Стоит ли мне сейчас менять работу?' },
        { label: 'Будут ли деньги?', spread: 'horseshoe', deck: 'playing', question: 'Что с деньгами в ближайший месяц?' },
        { label: 'Запускать проект?', spread: 'choice', deck: 'tarot', question: 'Стоит ли мне запускать этот проект сейчас?' },
        { label: 'Какой риск?', spread: 'alchemist', deck: 'lenormand', question: 'Какой главный риск в моей ситуации я не вижу?' },
      ],
    },
    {
      id: 'ask',
      icon: '🔮',
      title: 'Задать вопрос',
      text: 'Выберите быстрый формат — вопрос уже подставится в поле.',
      presets: [
        { label: 'Да или нет', spread: 'yesno', deck: 'tarot', question: 'Мой вопрос: да или нет?' },
        { label: 'Что происходит?', spread: 'three', variant: 0, deck: 'tarot', question: 'Что на самом деле происходит в этой ситуации?' },
        { label: 'Что выбрать?', spread: 'choice', deck: 'tarot', question: 'Какой вариант для меня лучше: A или B?' },
        { label: 'Глубоко разобрать', spread: 'cross', deck: 'tarot', question: 'Разбери мой важный вопрос глубже.' },
      ],
    },
    {
      id: 'day',
      icon: '🌙',
      title: 'Мой день',
      text: 'Совет, шанс, осторожность и короткое послание дня.',
      presets: [
        { label: 'Совет дня', spread: 'one', deck: 'tarot', question: 'Какой главный совет для меня на сегодня?' },
        { label: 'Что не делать?', spread: 'one', deck: 'runes', question: 'Чего мне сегодня лучше не делать?' },
        { label: 'Шанс дня', spread: 'three', variant: 0, deck: 'lenormand', question: 'Какой шанс сегодня стоит заметить?' },
        { label: 'Энергия дня', spread: 'one', deck: 'all', question: 'Какая главная энергия моего дня?' },
      ],
    },
  ];

  function classifyFortuneQuestion(question) {
    const q = String(question || '').toLowerCase().trim();
    const has = (re) => re.test(q);
    if (has(/(люб|отнош|чувств|скуч|молч|бывш|верн[её]т|измен|партн|парен|девуш|муж|жен|напис|свидан|соперниц|соперник|ревн|флирт|поцел|секс|бывшая|бывший)/i)) {
      return { label: 'Любовный вопрос', spread: 'three', variant: 2, deck: 'tarot', question };
    }
    if (has(/(работ|карьер|деньг|финанс|зарплат|проект|бизнес|клиент|увол|офер|сделк|продаж|заработ)/i)) {
      return { label: 'Деньги / работа', spread: 'career', deck: 'tarot', question };
    }
    if (has(/(выбр|вариант| или |остаться|уйти|переезж|покупать|продавать|а или б|a или b)/i)) {
      return { label: 'Выбор', spread: 'choice', deck: 'tarot', question };
    }
    if (has(/(сегодня|завтра|день|недел|месяц|срок|когда)/i)) {
      return { label: 'Ближайшее время', spread: 'horseshoe', deck: 'lenormand', question };
    }
    if (has(/^(стоит|будет|получится|надо|можно|верно|правда|да|нет|писать|ждать|делать)\b/i) || q.endsWith('?')) {
      return { label: 'Да / нет', spread: 'yesno', deck: 'tarot', question };
    }
    return { label: 'Общий вопрос', spread: 'three', variant: 0, deck: 'tarot', question };
  }

  function syncAskBox(question, pickedLabel) {
    const ask = r$('#arcAskInput');
    const picked = r$('#arcAskPicked');
    if (ask && typeof question === 'string') ask.value = question;
    if (picked) {
      picked.textContent = pickedLabel ? `Подобрано: ${pickedLabel}` : 'Введите вопрос и нажмите кнопку — я выберу подходящий расклад.';
    }
  }

  // ── State ────────────────────────────────────────────────
  const state = {
    spread: 'one',     // active spread
    deck: 'tarot',     // active deck
    reversed: false,
    cards: [],         // массив вытянутых карт для текущего расклада
    question: '',
    history: [],
    lastEntryId: null, // id только что вытянутой записи (для заметок)
    aiBalance: {},
    coinCount: 10,
    coins: [],
    coinAttempts: 0,
  };

  const TAROT_AI_LIMIT_FALLBACK = 5;

  function getInitData() {
    return window.Telegram?.WebApp?.initData || '';
  }

  const BOT_STARS_URL = window.ASTRO_BOT_STARS_URL || 'https://t.me/astro_byrbot?start=stars';

  function openStarsTopup() {
    const tg = window.TelegramApp && window.TelegramApp.tg;
    if (tg && tg.openTelegramLink) {
      try { tg.openTelegramLink(BOT_STARS_URL); return; } catch (e) {}
    }
    if (tg && tg.openLink) {
      try { tg.openLink(BOT_STARS_URL); return; } catch (e) {}
    }
    window.open(BOT_STARS_URL, '_blank', 'noopener');
  }

  function wireStarsTopup(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-stars-topup]').forEach((btn) => { btn.onclick = openStarsTopup; });
  }

  async function loadAiBalance() {
    const initData = getInitData();
    if (!initData) return;
    try {
      const res = await GadalkaApi.fetch('/api/ai-balance?initData=' + encodeURIComponent(initData));
      const data = await res.json();
      if (data.ok && Array.isArray(data.balance)) {
        state.aiBalance = Object.fromEntries(data.balance.map(b => [b.feature, b]));
      }
      if (data.ok && data.mana && typeof data.mana.total === 'number') {
        state.manaBalance = data.mana;
      }
    } catch (e) {
      // ignore: UX не ломается, fallback-limit покажем
    }
  }

  function getTarotRemaining() {
    const bal = state.aiBalance.tarot_spread;
    if (bal && typeof bal.remaining === 'number') return bal.remaining;
    return TAROT_AI_LIMIT_FALLBACK;
  }

  function getDailyCardInterpretRemaining() {
    const bal = state.aiBalance.daily_card_interpret;
    if (bal && typeof bal.remaining === 'number') return bal.remaining;
    return 1;
  }

  function updateManaBalance(data) {
    if (data && data.mana && typeof data.mana.total === 'number') state.manaBalance = data.mana;
  }

  function updateDailyCardInterpretBalance(data) {
    updateManaBalance(data);
    if (!data || typeof data.remaining !== 'number') return;
    const bal = state.aiBalance.daily_card_interpret || { feature: 'daily_card_interpret', limit: 1, used: 0, paid: 0 };
    bal.remaining = data.remaining;
    if (typeof data.resetAt === 'number') bal.resetAt = data.resetAt;
    state.aiBalance.daily_card_interpret = bal;
  }

  function consumeTarotBalance() {
    const bal = state.aiBalance.tarot_spread;
    if (bal && typeof bal.remaining === 'number' && typeof bal.used === 'number') {
      bal.remaining = Math.max(0, bal.remaining - 1);
      bal.used += 1;
    }
  }

  function rollbackTarotBalance() {
    const bal = state.aiBalance.tarot_spread;
    if (bal && typeof bal.remaining === 'number' && typeof bal.used === 'number') {
      bal.remaining += 1;
      bal.used = Math.max(0, bal.used - 1);
    }
  }

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

  // ── История (общая для всех раскладов), теперь из backend ──────────────────
  async function loadHistory() {
    try {
      const initData = getInitData();
      if (!initData) {
        try {
          const local = JSON.parse(localStorage.getItem('arcHistoryFallback') || '[]');
          return Array.isArray(local) ? local.filter((item) => item && item.localOnly).slice(0, 1) : [];
        } catch (_) {
          return [];
        }
      }
      const res = await GadalkaApi.fetch('/api/history?type=tarot&initData=' + encodeURIComponent(initData));
      const data = await res.json().catch(() => ({ ok: false, items: [] }));
      if (!data.ok) return [];
      return (data.items || []).map((it) => ({
        id: it.id,
        ts: new Date(it.created_at).getTime(),
        spread: it.payload?.spread || 'one',
        question: it.subtitle || it.payload?.question || '',
        cards: (it.payload?.cards || []).map((c) => ({
          name: c.name || '?',
          reversed: !!c.reversed,
          position: c.position || '',
        })),
        interpretation: it.interpretation || '',
      }));
    } catch {
      return [];
    }
  }

  // ── Рендер истории раскладов ──────────────────────────────
  function renderHistory() {
    const list = r$('#arcHistoryList');
    const empty = r$('#arcHistoryEmpty');
    const guestNotice = r$('#arcGuestNotice');
    if (!list || !empty) return;
    if (guestNotice) guestNotice.hidden = !!getInitData();
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
      return `<li class="arc-history-item" data-idx="${i}" data-history-id="${h.id}">
        <div class="arc-history-meta">
          <span class="arc-history-spread">${SPREAD_LABELS[h.spread] || h.spread}</span>
          <span class="arc-history-date">${dateStr}</span>
        </div>
        ${q}
        <div class="arc-history-cards">${cardsNames}</div>
      </li>`;
    }).join('');

    // открытие расшифровки
    list.querySelectorAll('.arc-history-item').forEach((li) => {
      li.addEventListener('click', async () => {
        const id = Number(li.dataset.historyId);
        const localItem = items[Number(li.dataset.idx)];
        if (localItem && localItem.localOnly) {
          flashToast('Это локальная демо-запись. Откройте бота, чтобы сохранять расклады и расшифровки.');
          return;
        }
        const initData = getInitData();
        try {
          const res = await GadalkaApi.fetch(`/api/history/${id}?initData=${encodeURIComponent(initData)}`);
          const data = await res.json().catch(() => ({ ok: false }));
          if (!data.ok || !data.interpretation) return flashToast('Расшифровка не найдена');
          openInterpretation(data.payload?.cards || [], data.payload?.question || '', data.payload?.spread || 'one', data.payload?.spreadName || SPREAD_LABELS[data.payload?.spread] || 'Расклад', data.interpretation);
        } catch {
          flashToast('Не удалось загрузить расшифровку');
        }
      });
    });
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
    // Кнопка «Все колоды»
    const allBtn = document.createElement('button');
    allBtn.className = 'arc-chip' + (state.deck === 'all' ? ' is-active' : '');
    allBtn.type = 'button';
    allBtn.innerHTML = `<span class="arc-chip-label">Все колоды</span><span class="arc-chip-hint">5 колод · по одной карте из каждой</span>`;
    allBtn.onclick = () => { state.deck = 'all'; resetReading(); renderDeckChips(); updateSpreadHeader(); };
    wrap.appendChild(allBtn);
    // Остальные колоды
    Object.entries(DECKS).forEach(([id, info]) => {
      const b = document.createElement('button');
      b.className = 'arc-chip' + (state.deck === id ? ' is-active' : '');
      b.type = 'button';
      b.innerHTML = `<span class="arc-chip-label">${info.label}</span><span class="arc-chip-hint">${info.hint}</span>`;
      b.onclick = () => { state.deck = id; resetReading(); renderDeckChips(); updateSpreadHeader(); };
      wrap.appendChild(b);
    });
  }

  function updateSpreadHeader() {
    const t = templateSpread();
    const title = r$('.arc-panel-title');
    const sub = r$('.arc-panel-sub');
    const hint = r$('.arc-panel-hint');
    if (state.deck === 'all') {
      if (title) title.textContent = 'Все колоды';
      if (sub) sub.textContent = 'По одной карте из каждой колоды: Таро, Ленорман, Руны, Цыганские, Игральные.';
      if (hint) hint.textContent = '5 карт — 5 систем. Самый полный расклад.';
    } else {
      if (title) title.textContent = t.title;
      if (sub) sub.textContent = t.ask;
      if (hint) { hint.textContent = t.hint || ''; hint.style.display = t.hint ? '' : 'none'; }
    }
  }

  // ── Сбросить расклад ────────────────────────────────────
  function resetReading() {
    state.cards = [];
    state.historyRequestId = null;
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
    // Режим «все колоды»: тянем по одной карте из каждой
    if (state.deck === 'all') {
      const result = [];
      for (const deckId of DECK_IDS) {
        const deckArr = DECKS[deckId].deck() || [];
        if (!deckArr.length) continue;
        const idx = Math.floor(Math.random() * deckArr.length);
        const c = deckArr[idx];
        const allowReversed = !NO_REVERSED.has(deckId);
        const isRev = allowReversed && Math.random() < 0.30;
        result.push({
          ...c,
          deck: deckId,
          deckLabel: DECKS[deckId].label,
          reversed: isRev ? (c.reversed || 'Перевёрнутая карта — обратите внимание на скрытые качества.') : false
        });
      }
      return result;
    }
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

  // ── Шаринг: текст для navigator.share / tg.openTelegramLink ────
  function buildShareText() {
    const isAllDecks = state.deck === 'all';
    const deckName = isAllDecks ? 'Все колоды' : DECKS[state.deck].label;
    if (state.spread === 'coin') {
      if (!state.coins.length) return '';
      const reading = coinOracleReading(state.coins);
      const { heads, tails } = coinStats(state.coins);
      return `◉ Орёл или Решка — ${reading.verdict}
Орёл: ${heads}, решка: ${tails}
${state.coins.map(c => c.label).join(' · ')}

${reading.detail}

— Гадалка`;
    }
    if (state.cards.length === 0) return '';
    const cfg = templateSpread();
    if (state.cards.length === 1) {
      const c = state.cards[0];
      const pos = c.reversed ? 'перевёрнутая' : 'прямая';
      return `🂠 ${c.name} (${pos}, ${deckName})\n\n${c.reversed ? c.reversed : c.upright}\n\n— Гадалка`;
    }
    const lines = [`🂠 Расклад «${cfg.title}» (${deckName})`];
    if (state.question) lines.push(`Вопрос: ${state.question}`);
    state.cards.forEach((c, i) => {
      const pos = c.reversed ? '⤵' : '↗';
      const label = isAllDecks
        ? (c.deckLabel || `Карта ${i+1}`)
        : ((cfg.positions && cfg.positions[i]) || `#${i+1}`);
      lines.push(`\n${label} — ${pos} ${c.name}\n${c.reversed ? c.reversed : c.upright}`);
    });
    lines.push('\n— Гадалка');
    return lines.join('\n');
  }

  // getSpreadName/getSpreadIcon определены выше (в разделе SPREADS)

  const COIN_ORACLE = {
    heads: {
      key: 'heads',
      label: 'Орёл',
      short: 'О',
      aria: 'орёл',
      meaning: 'движение, смелый шаг, внешняя сила помогает',
    },
    tails: {
      key: 'tails',
      label: 'Решка',
      short: 'Р',
      aria: 'решка',
      meaning: 'пауза, внутренний ответ, сначала проверь детали',
    },
  };

  function flipCoins(count) {
    return Array.from({ length: count }, () => Math.random() < 0.5 ? COIN_ORACLE.heads : COIN_ORACLE.tails);
  }

  function coinStats(coins) {
    const heads = coins.filter(c => c.key === 'heads').length;
    const tails = coins.length - heads;
    return { heads, tails, total: coins.length };
  }

  function coinOracleReading(coins) {
    const { heads, tails, total } = coinStats(coins);
    if (!total) return null;
    const delta = heads - tails;
    if (heads === total) {
      return { tone: 'yes', verdict: 'Чистый орёл', detail: 'Редкий бросок: все монеты за движение. Если вопрос про действие — не тяни, но оставь один контрольный шаг перед стартом.' };
    }
    if (tails === total) {
      return { tone: 'no', verdict: 'Чистая решка', detail: 'Монеты тормозят. Сейчас лучше не ломиться: подожди, собери факты, дай ситуации проявиться.' };
    }
    if (delta >= Math.max(2, Math.ceil(total * 0.25))) {
      return { tone: 'yes', verdict: 'Скорее да', detail: `Орёл сильнее: ${heads} против ${tails}. Ответ за действие, но без фанатизма — сначала маленький шаг, потом смотри на реакцию.` };
    }
    if (-delta >= Math.max(2, Math.ceil(total * 0.25))) {
      return { tone: 'no', verdict: 'Скорее нет', detail: `Решка сильнее: ${tails} против ${heads}. Не отказ навсегда, а знак не давить сейчас. Вопрос ещё не дозрел.` };
    }
    return { tone: 'wait', verdict: 'Баланс', detail: `Почти поровну: ${heads} / ${tails}. Ответ зависит от нюанса, который ты пока не назвал. Уточни вопрос или брось меньше монет на конкретный вариант.` };
  }

  function renderCoinMarkup() {
    const countOptions = [1, 3, 5, 7, 10].map(n => `<option value="${n}"${state.coinCount === n ? ' selected' : ''}>${n}</option>`).join('');
    const coins = state.coins.length ? state.coins : Array.from({ length: state.coinCount }, () => null);
    const resultText = state.coins.length
      ? state.coins.map(c => c.label).join(' · ')
      : 'Монеты ждут броска';
    const reading = coinOracleReading(state.coins);
    const coinsHtml = coins.map((c, i) => {
      const face = c || COIN_ORACLE.heads;
      const settled = c ? ' is-settled' : '';
      const side = c ? ` is-${c.key}` : '';
      const label = c ? c.label : 'Монета';
      return `<div class="coin-oracle-coin${settled}${side}" data-coin-idx="${i}" role="img" aria-label="${escapeHtml(label)}">
        <div class="coin-oracle-coin-inner">
          <div class="coin-face coin-face-heads">
            <span class="coin-rim-text">ГАДАЛКА · ОРАКУЛ</span>
            <span class="coin-eagle" aria-hidden="true">✦</span>
            <span class="coin-face-label">Орёл</span>
          </div>
          <div class="coin-face coin-face-tails">
            <span class="coin-rim-text">ЛУНА · ВЫБОР</span>
            <span class="coin-moon" aria-hidden="true">☾</span>
            <span class="coin-face-label">Решка</span>
          </div>
        </div>
      </div>`;
    }).join('');
    return `
      <div class="arc-spread-tabs-wrap">
        <nav class="arc-spread-tabs" id="arcSpreadTabs" aria-label="Сменить расклад">
          ${Object.keys(SPREADS).map(id => {
            const sp = SPREADS[id];
            const active = id === state.spread ? ' is-active' : '';
            return `<button type="button" class="arc-spread-tab${active}" data-spread="${id}"><span class="arc-spread-tab-ico">${sp.icon}</span><span class="arc-spread-tab-label">${escapeHtml(sp.title)}</span></button>`;
          }).join('')}
        </nav>
      </div>
      <div class="arc-panel-title">Орёл или Решка</div>
      <p class="arc-panel-sub">Не скучный генератор, а маленький ритуал выбора. Задай вопрос — монеты покажут перевес.</p>
      <p class="arc-panel-hint">Орёл = действуй. Решка = подожди. Баланс = уточни вопрос.</p>

      <div class="coin-oracle" id="coinOracle">
        <div class="coin-oracle-board" id="coinBoard" data-count="${state.coinCount}">
          ${coinsHtml}
        </div>
        <div class="coin-oracle-strip" id="coinResultStrip">${escapeHtml(resultText)}</div>
        <div class="coin-oracle-controls">
          <button id="coinFlipBtn" class="arc-cta arc-cta-primary" type="button">◉  Бросить монеты</button>
          <label class="coin-count-label">Монет
            <select id="coinCountSelect" class="coin-count-select">${countOptions}</select>
          </label>
          <button id="coinResetBtn" class="arc-cta arc-cta-ghost" type="button"${state.coins.length ? '' : ' disabled'}>↺ Сброс</button>
        </div>
        <div class="coin-attempts">Попыток: <strong>${state.coinAttempts}</strong></div>
        ${reading ? `<article class="coin-reading arc-verdict-${reading.tone}">
          <div class="coin-reading-verdict">${escapeHtml(reading.verdict)}</div>
          <p>${escapeHtml(reading.detail)}</p>
          <div class="coin-reading-stats"><span>Орёл: ${coinStats(state.coins).heads}</span><span>Решка: ${coinStats(state.coins).tails}</span></div>
        </article>` : `<article class="coin-reading is-empty"><p>Сформулируй вопрос. Если рука тянется перебросить — значит ответ уже не нравится.</p></article>`}
      </div>`;
  }

  function mountCoinOracle() {
    const main = root();
    if (!main) return;
    main.innerHTML = renderCoinMarkup();
    $$('.arc-spread-tab', main).forEach(btn => {
      btn.onclick = (e) => { e.preventDefault(); setSpread(btn.dataset.spread); };
    });
    const select = r$('#coinCountSelect');
    if (select) select.onchange = () => {
      state.coinCount = parseInt(select.value, 10) || 10;
      state.coins = [];
      mountCoinOracle();
    };
    const flip = r$('#coinFlipBtn');
    if (flip) flip.onclick = beginCoinFlip;
    const reset = r$('#coinResetBtn');
    if (reset) reset.onclick = () => { state.coins = []; mountCoinOracle(); tryVibrate(8); };
    requestAnimationFrame(() => {
      const active = main.querySelector('.arc-spread-tab.is-active');
      if (active && active.parentElement) {
        try {
          active.parentElement.scrollTo({ left: active.offsetLeft - 24, behavior: 'smooth' });
        } catch (_) {}
      }
    });
  }

  function beginCoinFlip() {
    const board = r$('#coinBoard');
    const btn = r$('#coinFlipBtn');
    if (!board || !btn) return;
    btn.disabled = true;
    btn.textContent = '◉  Бросаю...';
    board.querySelectorAll('.coin-oracle-coin').forEach((coin, i) => {
      coin.classList.remove('is-heads', 'is-tails', 'is-settled');
      coin.classList.add('is-flipping');
      coin.style.animationDelay = `${Math.min(i * 45, 360)}ms`;
    });
    tryVibrate(12);
    const delay = reducedMotion() ? 80 : 980;
    setTimeout(() => {
      state.coins = flipCoins(state.coinCount);
      state.coinAttempts += 1;
      mountCoinOracle();
      tryVibrate(25);
    }, delay);
  }

  function arcRoundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + rr, y, rr);
    ctx.closePath();
  }

  function arcWrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 4) {
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
    if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
      lines[lines.length - 1] = lines[lines.length - 1].replace(/[,.!?…]*$/, '') + '…';
    }
    lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineHeight));
    return y + Math.max(1, lines.length) * lineHeight;
  }

  function arcLoadCanvasImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function createArcStoryCard() {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const cfg = templateSpread();
    const cards = (state.cards || []).slice(0, 5);
    const deckName = state.deck === 'all' ? 'Все колоды' : (DECKS[state.deck]?.label || 'Гадание');

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#21163f');
    bg.addColorStop(0.5, '#080715');
    bg.addColorStop(1, '#2a1430');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(820, 260, 30, 820, 260, 760);
    glow.addColorStop(0, 'rgba(245, 215, 110, 0.32)');
    glow.addColorStop(1, 'rgba(245, 215, 110, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.46;
    ctx.fillStyle = '#f5d76e';
    for (let i = 0; i < 88; i++) {
      const x = (i * 173) % W;
      const y = (i * 281) % H;
      ctx.beginPath(); ctx.arc(x, y, 1.6 + (i % 4), 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f5d76e';
    ctx.font = '700 34px Georgia, serif';
    ctx.fillText('ГАДАЛКА', W / 2, 110);
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 58px Georgia, serif';
    arcWrapText(ctx, cfg.title || 'Расклад', W / 2, 190, 880, 64, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '28px system-ui, -apple-system, sans-serif';
    ctx.fillText(deckName, W / 2, 330);

    if (state.question) {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = '32px system-ui, -apple-system, sans-serif';
      arcWrapText(ctx, `«${state.question}»`, W / 2, 400, 870, 42, 3);
    }

    const count = Math.max(1, Math.min(3, cards.length));
    const cardW = count === 1 ? 430 : 280;
    const cardH = count === 1 ? 640 : 430;
    const gap = 34;
    const totalW = count * cardW + (count - 1) * gap;
    let x = (W - totalW) / 2;
    const y = state.question ? 570 : 500;
    for (let i = 0; i < count; i++) {
      const c = cards[i];
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.62)';
      ctx.shadowBlur = 44;
      ctx.shadowOffsetY = 22;
      arcRoundRect(ctx, x, y, cardW, cardH, 28);
      ctx.fillStyle = '#120f24';
      ctx.fill();
      ctx.restore();
      const imgSrc = cardImage(c);
      const img = imgSrc ? await arcLoadCanvasImage(new URL(imgSrc, location.href).href) : null;
      if (img) {
        ctx.save();
        arcRoundRect(ctx, x + 16, y + 16, cardW - 32, cardH - 32, 22);
        ctx.clip();
        const scale = Math.max((cardW - 32) / img.width, (cardH - 32) / img.height);
        const iw = img.width * scale, ih = img.height * scale;
        if (c.reversed) {
          ctx.translate(x + cardW / 2, y + cardH / 2);
          ctx.rotate(Math.PI);
          ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
        } else {
          ctx.drawImage(img, x + 16 + (cardW - 32 - iw) / 2, y + 16 + (cardH - 32 - ih) / 2, iw, ih);
        }
        ctx.restore();
      } else {
        ctx.fillStyle = '#d4af37';
        ctx.font = `${count === 1 ? 112 : 72}px Georgia, serif`;
        ctx.fillText(c.symbol || '✦', x + cardW / 2, y + cardH / 2);
      }
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(245,215,110,0.72)';
      arcRoundRect(ctx, x, y, cardW, cardH, 28);
      ctx.stroke();
      x += cardW + gap;
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 42px Georgia, serif';
    const names = cards.slice(0, 3).map(c => `${c.name}${c.reversed ? ' ↺' : ''}`).join(' · ');
    let nextY = arcWrapText(ctx, names, W / 2, 1260, 900, 50, 3) + 36;
    const first = cards[0];
    const meaning = first ? (first.reversed || first.upright || '') : '';
    ctx.fillStyle = 'rgba(255,255,255,0.84)';
    ctx.font = '31px system-ui, -apple-system, sans-serif';
    nextY = arcWrapText(ctx, meaning, W / 2, nextY, 850, 42, 5) + 64;

    ctx.fillStyle = 'rgba(245,215,110,0.16)';
    arcRoundRect(ctx, 150, nextY, 780, 92, 46);
    ctx.fill();
    ctx.fillStyle = '#f5d76e';
    ctx.font = '700 30px system-ui, -apple-system, sans-serif';
    ctx.fillText('Открыть свой расклад в Telegram', W / 2, nextY + 58);

    ctx.fillStyle = 'rgba(255,255,255,0.64)';
    ctx.font = '26px system-ui, -apple-system, sans-serif';
    ctx.fillText('@astro_byrbot · карты не принимают решений за вас', W / 2, H - 86);
    return canvas.toDataURL('image/png');
  }

  async function uploadArcStoryCard(dataUrl) {
    const initData = getInitData();
    if (!initData) return null;
    const res = await GadalkaApi.fetch('/api/share-card?initData=' + encodeURIComponent(initData), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageData: dataUrl, spread: state.spread, question: state.question || '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.url) return null;
    return data.url;
  }

  async function shareResult() {
    const text = buildShareText();
    if (!text) return;
    const tg = window.TelegramApp && window.TelegramApp.tg;
    const btn = r$('#ctaShare');
    const oldText = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳  Готовлю сторис'; }
    let dataUrl = '';
    if (tg && typeof tg.shareToStory === 'function') {
      try {
        dataUrl = await createArcStoryCard();
        const storyUrl = await uploadArcStoryCard(dataUrl);
        if (storyUrl) {
          tg.shareToStory(storyUrl, {
            text: text.slice(0, 2048),
            widget_link: { url: 'https://t.me/astro_byrbot', name: 'Открыть Гадалку' },
          });
          flashToast('Открываю публикацию сторис');
          return;
        }
      } catch (e) {
        // fallback below
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = oldText || '⤴  Поделиться'; }
      }
    }
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
      closing = ' Три карты — суть, путь и итог. Смотрите, как энергия движется, а не на отдельные карты.';
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
      const isAllDecks = state.deck === 'all';
      const deckArr = isAllDecks ? (DECKS.tarot.deck() || []) : (DECKS[state.deck].deck() || []);
      const previewCount = Math.min(deckArr.length, 3);
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
      const deckLabel = isAllDecks ? 'Все колоды' : DECKS[state.deck].label;
      const deckHint = isAllDecks ? 'По одной карте из каждой колоды' : DECKS[state.deck].hint;
      stage.innerHTML = `
        <div class="arc-deck-ready" role="img" aria-label="Колода ${deckLabel} готова. ${deckArr.length} карт.">
          <div class="arc-deck-preview-grid" data-count="${previewCount}">${previewHtml}</div>
          <p class="arc-deck-hint"><strong>${deckLabel}</strong> · ${deckHint}. Задайте вопрос и нажмите «Тянуть».</p>
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
      const isAllDecks = state.deck === 'all';
      const cardsHtml = state.cards.map((c, i) => {
        const cfg = templateSpread();
        const label = isAllDecks
          ? (c.deckLabel || '')
          : ((cfg.positions && cfg.positions[i]) || `#${i+1}`);
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
    const cfg = templateSpread();
    const isAllDecks = state.deck === 'all';
    const sections = state.cards.map((c, i) => {
      const label = isAllDecks
        ? (c.deckLabel || `Карта ${i+1}`)
        : ((cfg.positions && cfg.positions[i]) || `#${i+1}`);
      const hint  = (cfg.hints && cfg.hints[i]) || '';
      const headline = c.reversed ? 'Перевёрнутое положение' : 'Прямое положение';
      const img = cardImage(c);
      const visual = img
        ? `<img src="${img}" alt="${escapeHtml(c.name)}" class="arc-inter-img ${c.reversed ? 'is-reversed' : ''}">`
        : `<span class="arc-inter-glyph ${c.reversed ? 'is-reversed' : ''}">${c.symbol || '✦'}</span>`;
      const tags = (c.keywords && c.keywords.length) ? c.keywords.slice(0, 5).map(k => `<span class="arc-tag">${escapeHtml(k)}</span>`).join('') : '';
      return `<div class="arc-inter-section">
        <div class="arc-inter-section-head">
          ${visual}
          <div>
            <h3 class="arc-inter-title">${label}${hint ? ` <span class="arc-inter-hint">— ${hint}</span>` : ''}</h3>
            <p class="arc-inter-card">${escapeHtml(c.name)} · ${headline}</p>
          </div>
        </div>
        ${tags ? `<div class="arc-inter-tags">${tags}</div>` : ''}
        <p class="arc-inter-main">${escapeHtml(c.reversed || c.upright)}</p>
        ${c.shadow ? `<p class="arc-inter-shadow"><span class="arc-shadow-label">Тень:</span> ${escapeHtml(c.shadow)}</p>` : ''}
        <button type="button" class="arc-expand-btn" data-card-idx="${i}" aria-expanded="false">✨ раскрыть смысл</button>
        <div class="arc-expand-slot" data-card-idx="${i}" hidden></div>
      </div>`;
    }).join('');
    // Общий итог — summary всего расклада
    const summary = buildSpreadSummary(state.cards, cfg, q);
    target.innerHTML = sections +
      (summary ? `<div class="arc-reading-summary"><p class="arc-tips-title">Итог расклада</p><p>${summary}</p></div>` : '') +
      (q ? `<p class="arc-inter-context">В контексте вопроса <em>«${escapeHtml(q)}»</em> — карты указывают, что ответ уже формируется. Доверьтесь первому импульсу.</p>` : '');
    // AI-кнопка рисуется в слот #arcAiSlot под основной расшифровкой
    if (typeof renderAiButton === 'function') renderAiButton();
    wireExpandButtons();
  }

  // Inline-разбор одной карты (кнопка «✨ раскрыть смысл»)
  function wireExpandButtons() {
    $$('.arc-expand-btn', r$('#arcInter')).forEach(btn => {
      if (btn.dataset.wired === '1') return;
      btn.dataset.wired = '1';
      btn.onclick = async () => {
        const idx = parseInt(btn.dataset.cardIdx, 10);
        const c = state.cards[idx];
        if (!c) return;
        const slot = btn.parentElement.querySelector(`.arc-expand-slot[data-card-idx="${idx}"]`);
        if (!slot) return;
        const isOpen = btn.getAttribute('aria-expanded') === 'true';
        if (isOpen) {
          slot.hidden = true;
          slot.innerHTML = '';
          btn.setAttribute('aria-expanded', 'false');
          btn.textContent = '✨ раскрыть смысл';
          return;
        }
        // cache lookup (по name+reversed)
        const cacheKey = `arcExpand:${c.name}:${c.reversed ? 'r' : 'u'}`;
        let cached = null;
        try { cached = localStorage.getItem(cacheKey); } catch (e) {}
        if (cached) {
          slot.innerHTML = renderExpandContent(JSON.parse(cached));
          slot.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
          btn.textContent = 'свернуть';
          return;
        }
        if (getDailyCardInterpretRemaining() === 0) {
          slot.innerHTML = `<div class="ai-limit-box arc-ai-limit-box">
            <p>Лимит на сегодня исчерпан. Сброс в полночь UTC.</p>
            <button type="button" class="btn btn-gold" data-stars-topup>Докупить за Stars</button>
          </div>`;
          slot.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
          btn.textContent = 'свернуть';
          wireStarsTopup(slot);
          return;
        }
        btn.disabled = true;
        btn.textContent = '⏳ гадаю...';
        try {
          const initData = window.Telegram && Telegram.WebApp ? Telegram.WebApp.initData : '';
          const res = await GadalkaApi.fetch('/api/arc/card-interpret?initData=' + encodeURIComponent(initData), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: c.name, reversed: !!c.reversed })
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !data.ok) {
            if (res.status === 429 || res.status === 402 || data.error === 'rate_limited' || data.error === 'insufficient_mana') {
              updateDailyCardInterpretBalance(data);
              const msg = data.error === 'insufficient_mana'
                ? (data.message || 'Не хватает маны для AI-расшифровки.')
                : (data.message || 'Лимит на сегодня исчерпан. Сброс в полночь UTC.');
              slot.innerHTML = `<div class="ai-limit-box arc-ai-limit-box">
                <p>${escapeHtml(msg)}</p>
                <button type="button" class="btn btn-gold" data-stars-topup>Пополнить ману за Stars</button>
              </div>`;
              slot.hidden = false;
              btn.setAttribute('aria-expanded', 'true');
              btn.textContent = 'свернуть';
              wireStarsTopup(slot);
              return;
            }
            throw new Error(data.error || 'fail');
          }
          updateDailyCardInterpretBalance(data);
          try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch (e) {}
          slot.innerHTML = renderExpandContent(data);
          slot.hidden = false;
          btn.setAttribute('aria-expanded', 'true');
          btn.textContent = 'свернуть';
        } catch (e) {
          btn.textContent = '⚠️ не получилось';
          setTimeout(() => { btn.textContent = '✨ раскрыть смысл'; }, 2500);
        } finally {
          btn.disabled = false;
        }
      };
    });
  }

  function renderExpandContent(d) {
    return `<div class="arc-expand-card">
      <p class="arc-expand-meaning">${escapeHtml(d.meaning || '')}</p>
      ${d.advice ? `<p class="arc-expand-line"><span class="arc-expand-label">Совет:</span> ${escapeHtml(d.advice)}</p>` : ''}
      ${d.warning ? `<p class="arc-expand-line"><span class="arc-expand-label">Осторожно:</span> ${escapeHtml(d.warning)}</p>` : ''}
    </div>`;
  }

  // ── Шаблон конкретного расклада ─────────────────────────
  function templateSpread() {
    const cfg = getSpreadConfig(state.spread);
    const v = cfg.variants && cfg.activeVariant != null ? cfg.variants[cfg.activeVariant] : null;
    if (v) return { ...cfg, ...v };
    return cfg;
  }

  function currentPositions() {
    return templateSpread().positions || [];
  }

  function applyScenarioPreset(preset, questionOverride) {
    if (!preset || !SPREADS[preset.spread]) return;
    if (preset.deck && (preset.deck === 'all' || DECKS[preset.deck])) state.deck = preset.deck;
    state.question = typeof questionOverride === 'string' ? questionOverride : (preset.question || '');
    try { localStorage.setItem('arhQuestion', state.question); } catch (e) {}
    const cfg = SPREADS[preset.spread];
    if (Array.isArray(cfg.variants) && typeof preset.variant === 'number') {
      cfg.activeVariant = Math.max(0, Math.min(cfg.variants.length - 1, preset.variant));
    }
    setSpread(preset.spread);
    const q = r$('#arcQuestion');
    if (q) q.value = state.question;
    syncAskBox(state.question, preset.label || getSpreadName(preset.spread));
    requestAnimationFrame(() => {
      const target = r$('#arcQuestion') || r$('#arcStage') || r$('#arcSpreadTabs');
      if (target && target.scrollIntoView) {
        try { target.scrollIntoView({ behavior: 'auto', block: 'start' }); } catch (_) {}
      }
    });
    flashToast('Сценарий выбран: ' + (preset.label || getSpreadName(preset.spread)));
  }

  // ── Mount конкретного расклада ─────────────────────────
  function mountSpread() {
    const main = root();
    if (!main) return;
    if (state.spread === 'coin') { mountCoinOracle(); return; }
    const t = templateSpread();
    const cfg = getSpreadConfig(state.spread);
    const hasVariants = Array.isArray(cfg.variants) && cfg.variants.length > 1;
    const variantsHtml = hasVariants ? `
      <div class="arc-block" id="spreadVariantsBlock">
        <div class="arc-label">Схема расклада</div>
        <div class="arc-variant-chips" role="radiogroup" aria-label="Схема расклада">
          ${cfg.variants.map((v, i) => `
            <button type="button" class="arc-variant-chip${i === (cfg.activeVariant || 0) ? ' is-active' : ''}" data-variant="${i}" role="radio" aria-checked="${i === (cfg.activeVariant || 0)}">
              ${escapeHtml(v.label)}
            </button>
          `).join('')}
        </div>
      </div>` : '';
    const scenariosHtml = SCENARIO_GROUPS.map((group) => `
      <section class="arc-scenario-card" data-scenario="${group.id}">
        <div class="arc-scenario-head">
          <span class="arc-scenario-icon" aria-hidden="true">${group.icon}</span>
          <div>
            <div class="arc-scenario-title">${escapeHtml(group.title)}</div>
            <p class="arc-scenario-text">${escapeHtml(group.text)}</p>
          </div>
        </div>
        <div class="arc-scenario-presets">
          ${group.presets.map((preset, idx) => `
            <button type="button" class="arc-scenario-preset" data-scenario="${group.id}" data-preset="${idx}">${escapeHtml(preset.label)}</button>
          `).join('')}
        </div>
      </section>`).join('');
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
      <div class="arc-scenario-block" aria-label="Вопрос Гадалке">
        <div class="arc-scenario-kicker">Напишите вопрос здесь</div>
        <div class="arc-ask-box">
          <textarea id="arcAskInput" class="arc-ask-input" maxlength="400" placeholder="Например: он вернётся? стоит ли менять работу? что мешает деньгам?"></textarea>
          <div class="arc-ask-actions">
            <button type="button" class="arc-ask-pick" id="arcAskPick">🔮 Подобрать расклад</button>
            <span class="arc-ask-picked" id="arcAskPicked">Введите вопрос и нажмите кнопку — я выберу подходящий расклад.</span>
          </div>
        </div>
        <details class="arc-scenario-more">
          <summary>Показать готовые сценарии: любовь, деньги, день</summary>
          <div class="arc-scenario-grid">${scenariosHtml}</div>
        </details>
      </div>

      <div class="arc-spread-tabs-wrap">
        <nav class="arc-spread-tabs" id="arcSpreadTabs" aria-label="Сменить расклад">
          ${tabsHtml}
        </nav>
      </div>
      <div class="arc-panel-title">${escapeHtml(state.deck === 'all' ? 'Все колоды' : t.title)}</div>
      <p class="arc-panel-sub">${escapeHtml(state.deck === 'all' ? 'По одной карте из каждой колоды: Таро, Ленорман, Руны, Цыганские, Игральные.' : t.ask)}</p>
      ${(state.deck === 'all' ? '5 карт — 5 систем. Самый полный расклад.' : t.hint) ? `<p class="arc-panel-hint">${escapeHtml(state.deck === 'all' ? '5 карт — 5 систем. Самый полный расклад.' : t.hint)}</p>` : ''}
      ${variantsHtml}

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

    // wire ask autopicker
    const askPick = r$('#arcAskPick');
    const askInput = r$('#arcAskInput');
    if (askInput) {
      askInput.value = state.question || '';
      askInput.oninput = (e) => {
        state.question = e.target.value;
        try { localStorage.setItem('arhQuestion', state.question); } catch (err) {}
      };
    }
    if (askPick) {
      askPick.onclick = () => {
        const question = (askInput && askInput.value ? askInput.value : state.question || '').trim();
        if (question.length < 3) { flashToast('Напишите вопрос хотя бы в пару слов'); return; }
        applyScenarioPreset(classifyFortuneQuestion(question), question);
      };
    }
    syncAskBox(state.question || '', null);

    // wire scenarios
    $$('.arc-scenario-preset', main).forEach((btn) => {
      btn.onclick = () => {
        const group = SCENARIO_GROUPS.find((g) => g.id === btn.dataset.scenario);
        const preset = group && group.presets[Number(btn.dataset.preset)];
        if (!preset) return;
        applyScenarioPreset(preset);
      };
    });

    // wire variants
    if (hasVariants) {
      let activeVariant = cfg.activeVariant || 0;
      $$('.arc-variant-chip', main).forEach((btn, i) => {
        btn.onclick = () => {
          activeVariant = i;
          $$('.arc-variant-chip', main).forEach((b, idx) => {
            b.classList.toggle('is-active', idx === i);
            b.setAttribute('aria-checked', idx === i ? 'true' : 'false');
          });
          cfg.activeVariant = i;
        };
      });
      cfg.activeVariant = activeVariant;
    }

    // question persisted
    state.question = state.question || localStorage.getItem('arhQuestion') || '';
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
      if (active && active.parentElement) {
        try {
          active.parentElement.scrollTo({ left: active.offsetLeft - 24, behavior: 'smooth' });
        } catch (_) {}
      }
    });
  }

  // ── Действие «Тянуть» ───────────────────────────────────
  function saveGuestDemoToLocalHistory(spreadCfg, cards) {
    const savedEntry = {
      id: `local-${Date.now()}`,
      type: 'tarot',
      spread: state.spread,
      spreadName: spreadCfg.title,
      title: spreadCfg.title,
      subtitle: state.question || `${cards.length} карт`,
      question: state.question,
      cards,
      created_at: new Date().toISOString(),
      localOnly: true,
    };
    state.lastEntryId = savedEntry.id;
    state.history = [savedEntry].slice(0, 1);
    try { localStorage.setItem('arcHistoryFallback', JSON.stringify(state.history)); } catch (_) {}
    renderHistoryList();
    return savedEntry;
  }

  async function doDraw() {
    if (state.cards.length > 0) return;
    if (!getInitData()) {
      const guestHistory = (() => {
        try { return JSON.parse(localStorage.getItem('arcHistoryFallback') || '[]'); }
        catch (_) { return []; }
      })();
      if (Array.isArray(guestHistory) && guestHistory.some((item) => item && item.localOnly)) {
        flashToast('Демо уже использовано. Откройте Гадалку в Telegram, чтобы продолжить и сохранять историю.');
        return;
      }
    }
    const t = templateSpread();
    const count = state.deck === 'all' ? 5 : t.count;
    state.cards = drawN(count);
    state.lastEntryId = null;

    const stage = r$('#arcStage');
    if (stage) stage.classList.add('is-lit');

    // Сохраняем в backend-историю сразу (без AI-расшифровки)
    try {
      const initData = getInitData();
      const spreadCfg = SPREADS[state.spread] || { title: state.spread };
      const cards = state.cards.map(c => ({
        name: c.name,
        position: c.position,
        reversed: !!c.reversed,
        arcana: c.arcana,
        suit: c.suit,
      }));
      // One draw is one logical history action; retries must not duplicate it.
      if (!state.historyRequestId) state.historyRequestId = `tarot-${crypto.randomUUID()}`;
      const res = await GadalkaApi.fetch('/api/history?initData=' + encodeURIComponent(initData), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: 'tarot',
          title: spreadCfg.title,
          subtitle: state.question || `${cards.length} карт`,
          payload: { spread: state.spread, spreadName: spreadCfg.title, cards, question: state.question },
          requestId: state.historyRequestId,
        }),
      });
      const data = await res.json().catch(() => ({ ok: false }));
      if (data.ok && data.id) {
        state.lastEntryId = data.id;
        const savedEntry = {
          id: data.id,
          type: 'tarot',
          spread: state.spread,
          spreadName: spreadCfg.title,
          title: spreadCfg.title,
          subtitle: state.question || `${cards.length} карт`,
          question: state.question,
          cards,
          created_at: new Date().toISOString(),
        };
        state.history = [savedEntry, ...(state.history || []).filter((h) => h.id !== data.id)].slice(0, 30);
        renderHistoryList();
        if (window.dispatchEvent) window.dispatchEvent(new CustomEvent('astro:history-updated'));
      } else if (!initData) {
        saveGuestDemoToLocalHistory(spreadCfg, cards);
      } else {
        flashToast('Расклад готов, но история не сохранилась. Повторите позже.');
      }
    } catch {
      const initData = getInitData();
      const spreadCfg = SPREADS[state.spread] || { title: state.spread };
      const cards = state.cards.map(c => ({
        name: c.name, position: c.position, reversed: !!c.reversed, arcana: c.arcana, suit: c.suit,
      }));
      if (!initData) saveGuestDemoToLocalHistory(spreadCfg, cards);
      else flashToast('Расклад готов, но история не сохранилась. Проверьте сеть и повторите позже.');
    }

    // Анимация: для одной карты flip; для мульти — поочерёдная раздача
    if (state.cards.length === 1) {
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

  function hashString(s) {
    let h = 0;
    const text = String(s || '');
    for (let i = 0; i < text.length; i++) h = ((h << 5) - h + text.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  function aiKey(spread, cards) {
    // ключ кэша: расклад + вопрос + сами карты, иначе разные вопросы могли видеть старый ответ
    const cardKey = cards.map(c => `${c.position || '?'}:${c.name || '?'}:${c.reversed ? 'r' : 'u'}`).join('|');
    return 'arhAi_' + spread + '_' + hashString((state.question || '') + '|' + cardKey);
  }

  function renderAiButton() {
    const slot = r$('#arcAiSlot');
    if (!slot) return;
    if (state.cards.length === 0) { slot.innerHTML = ''; return; }
    // yesno/love/celtic — допустимо, лимит тот же
    const key = aiKey(state.spread, state.cards);
    let cached = null;
    try { cached = localStorage.getItem(key); } catch (e) {}

    const remaining = getTarotRemaining();

    if (cached) {
      // уже разобрано — показываем
      slot.innerHTML = `
        <div class="arc-ai-card is-loaded" id="arcAiCard">
          <div class="arc-ai-head">
            <span class="arc-ai-orb">🔮</span>
            <div>
              <div class="arc-ai-title">Ответ Гадалки по вашему вопросу</div>
              <div class="arc-ai-sub">сохранено · осталось сегодня: ${remaining}/${TAROT_AI_LIMIT_FALLBACK}</div>
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
              <div class="arc-ai-title">Ответ Гадалки по вашему вопросу</div>
              <div class="arc-ai-sub">лимит ${TAROT_AI_LIMIT_FALLBACK}/день исчерпан · сброс в полночь UTC</div>
            </div>
          </div>
        </div>
        <div class="ai-limit-box arc-ai-limit-box">
          <p>Лимит на сегодня исчерпан. Сброс в полночь UTC.</p>
          <button type="button" class="btn btn-gold" data-stars-topup>Докупить за Stars</button>
        </div>`;
      wireStarsTopup(slot);
      return;
    }

    slot.innerHTML = `
      <div class="arc-ai-card is-cta">
        <div class="arc-ai-head">
          <span class="arc-ai-orb">🔮</span>
          <div>
            <div class="arc-ai-title">Ответ Гадалки по вашему вопросу</div>
            <div class="arc-ai-sub">Гадалка · осталось сегодня: ${remaining}/${TAROT_AI_LIMIT_FALLBACK}</div>
          </div>
        </div>
        <p class="arc-ai-pitch">Гадалка свяжет ваш вопрос с выпавшими картами: прямой ответ, скрытый узел и одно действие здесь и сейчас. Любовные и быстрые форматы специально сделаны короткими и шерибельными. Бесплатные ответы ограничены, дальше — Stars.</p>
        <div class="arc-ai-actions">
          <button type="button" class="arc-ai-go" data-action="go">🔮  Получить ответ</button>
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
      // WebView глотает window.confirm; просто удаляем кэш и обновляем UI
      try { localStorage.removeItem(key); } catch (e) {}
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
    consumeTarotBalance();

    try {
      const initData = getInitData();
      const cards = state.cards.map(c => ({
        name: c.name, position: c.position, reversed: !!c.reversed,
        arcana: c.arcana, suit: c.suit,
      }));
      const spreadCfg = SPREADS[state.spread] || { title: state.spread };
      const res = await GadalkaApi.fetch('/api/arc/interpret?initData=' + encodeURIComponent(initData), {
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
        rollbackTarotBalance();
        if (data?.error === 'rate_limited' || data?.error === 'insufficient_mana') {
          updateManaBalance(data);
          if (body) {
            const msg = data.error === 'insufficient_mana'
              ? (data.message || 'Не хватает маны для глубокого разбора.')
              : 'Лимит на сегодня исчерпан. Сброс в полночь UTC.';
            body.innerHTML = `<div class="ai-limit-box arc-ai-limit-box">
              <p>${escapeHtml(msg)}</p>
              <button type="button" class="btn btn-gold" data-stars-topup>Пополнить ману за Stars</button>
            </div>`;
            wireStarsTopup(body);
          }
          card.classList.remove('is-loading');
          return;
        }
        const msg = data?.error === 'llm_failed' ? 'Гадалка временно недоступна. Попробуйте позже.' :
                    data?.message || ('Ошибка ' + res.status);
        if (body) body.innerHTML = '<div class="arc-ai-error">' + escapeHtml(msg) + '</div>';
        card.classList.remove('is-loading');
        return;
      }
      updateManaBalance(data);
      // сохранить в кэш + история
      try { localStorage.setItem(key, data.interpretation); } catch (e) {}
      // записать interpretation в backend history если есть lastEntryId
      if (state.lastEntryId) {
        try {
          const initData = getInitData();
          await GadalkaApi.fetch(`/api/history/${state.lastEntryId}?initData=${encodeURIComponent(initData)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ interpretation: data.interpretation }),
          });
        } catch {}
      }
      // перерисовать кнопку (покажет свёрнутую карточку)
      renderAiButton();
    } catch (e) {
      rollbackTarotBalance();
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
      const word = state.spread === 'coin'
        ? (c === 1 ? 'монета' : (c >= 2 && c <= 4 ? 'монеты' : 'монет'))
        : (c === 1 ? 'карта' : (c >= 2 && c <= 4 ? 'карты' : 'карт'));
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
    if (DECKS[deck] || deck === 'all') {
      state.deck = deck;
      state.cards = [];
      const wrap = r$('#deckChips');
      if (wrap) renderDeckChips();
      resetReading();
      renderCards();
      renderInterpretation();
    }
  }

  async function mount() {
    try {
      state.history = await loadHistory();
      await loadAiBalance();
      // wire nav
      const navLinks = $$('.arc-nav-link');
      navLinks.forEach(a => {
        a.onclick = (e) => { e.preventDefault(); setSpread(a.dataset.spread); };
      });
      // home link
      const home = $('#arcHomeLink');
      if (home) home.onclick = (e) => { e.preventDefault(); setSpread('one'); };
      // init
      setSpread('one');
      bindInfoCards();
      bindMobileNav();
      bindHistory();
    } catch (e) {
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
    if (clear) clear.onclick = async (e) => {
      e.preventDefault();
      const ok = await arcConfirm('Очистить всю историю раскладов?');
      if (!ok) return;
      // удаляем все tarot-записи на backend
      try {
        const initData = getInitData();
        const res = await GadalkaApi.fetch('/api/history?type=tarot&initData=' + encodeURIComponent(initData));
        const data = await res.json().catch(() => ({ ok: false, items: [] }));
        const ids = (data.items || []).map(it => it.id);
        await Promise.all(ids.map(id =>
          GadalkaApi.fetch(`/api/history/${id}?initData=${encodeURIComponent(initData)}`, { method: 'DELETE' })
        ));
      } catch {}
      state.history = [];
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

  function quickAsk(options) {
    const opts = options || {};
    const spread = SPREADS[opts.spread] ? opts.spread : 'three';
    state.question = String(opts.question || '').trim();
    try { localStorage.setItem('arhQuestion', state.question); } catch (e) {}
    state.deck = opts.deck && (opts.deck === 'all' || DECKS[opts.deck]) ? opts.deck : 'tarot';
    setSpread(spread);
    const input = r$('#arcAskInput');
    if (input) input.value = state.question;
    syncAskBox(state.question, getSpreadName(spread));
    setTimeout(() => {
      const draw = r$('#ctaDraw');
      if (draw && !draw.disabled) doDraw();
    }, 80);
  }

  function unmount() {
    const main = root();
    if (main) main.innerHTML = '';
    state.cards = [];
  }

  window.ArcApp = { mount, unmount, setSpread, setDeck, drawN, buildShareText, quickAsk, getState: () => ({ ...state }) };
})();
