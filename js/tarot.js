// tarot.js — расчёт карты дня (портировано из src/services/tarot-daily.ts)

window.TarotDaily = (function () {
  const D = window.DATA;

  function dailyIndex(tgId, dateStr) {
    return D.hashCode(`${tgId}-${dateStr}`) % D.cardsCount;
  }

  function calc(tgId, dateStr) {
    const idx = dailyIndex(tgId, dateStr);
    return { ...D.CARDS[idx], index: idx };
  }

  function formatShare(c) {
    return `🂠 ${c.name}\n${c.upright}\n\nСовет: ${c.advice}\nНастроение: ${c.mood}\n\n— Планчик`;
  }

  return { calc, formatShare, dailyIndex };
})();
