// tarot.js — расчёт карты дня (портировано из src/services/tarot-daily.ts)
// Карта фиксирована на (tgId, дата, salt). Salt хранится в localStorage
// до конца дня: reload вернёт ту же вытянутую карту, "Новая карта" даст
// новый salt → новую карту.

window.TarotDaily = (function () {
  const D = window.DATA;
  const SALT_KEY = "tarot_salt_";

  function daySalt(tgId, dateStr) {
    const key = SALT_KEY + dateStr;
    try {
      let s = localStorage.getItem(key);
      if (s == null) {
        // первый раз за день: фиксируем псевдо-случайный соль,
        // зависящий от tgId+date+соль-от-btoa-uuid
        s = String(Math.floor(Math.random() * 1e9));
        localStorage.setItem(key, s);
        // ставим TTL — очистить на следующий день
        const tomorrow = new Date(dateStr + "T00:00:00Z");
        tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
        try { localStorage.setItem(key + "_exp", String(tomorrow.getTime())); } catch (_) {}
      } else {
        // чистим просроченные ключи (на всякий)
        try {
          const exp = parseInt(localStorage.getItem(key + "_exp") || "0", 10);
          if (exp && Date.now() > exp) {
            localStorage.removeItem(key);
            localStorage.removeItem(key + "_exp");
            return daySalt(tgId, dateStr);
          }
        } catch (_) {}
      }
      return s;
    } catch (_) {
      // localStorage недоступен — fallback: 0
      return "0";
    }
  }

  function bumpSalt(tgId, dateStr) {
    const key = SALT_KEY + dateStr;
    try {
      const s = String(Math.floor(Math.random() * 1e9));
      localStorage.setItem(key, s);
      const tomorrow = new Date(dateStr + "T00:00:00Z");
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      localStorage.setItem(key + "_exp", String(tomorrow.getTime()));
    } catch (_) {}
  }

  function dailyIndex(tgId, dateStr) {
    const salt = daySalt(tgId, dateStr);
    return D.hashCode(`${tgId}-${dateStr}-${salt}`) % D.cardsCount;
  }

  function calc(tgId, dateStr) {
    const idx = dailyIndex(tgId, dateStr);
    return { ...D.CARDS[idx], index: idx };
  }

  function formatShare(c) {
    return `🂠 ${c.name}\n${c.upright}\n\nСовет: ${c.advice}\nНастроение: ${c.mood}\n\n— Планчик`;
  }

  return { calc, formatShare, dailyIndex, bumpSalt };
})();
