// biorhythm.js — расчёт биоритмов (портировано из src/services/biorhythm.ts)

window.Biorhythm = (function () {
  const CYCLES = { physical: 23, emotional: 28, intellectual: 33 };

  function calcCycle(days, period) {
    return Math.sin((2 * Math.PI * days) / period);
  }

  function percent(v) { return Math.round(v * 100); }

  function phaseInfo(value) {
    if (value >= 0.9)  return { phase: 'Пик',          emoji: '🔥',  advice: 'Энергия на максимуме. Спорт, важные дела, контракты.' };
    if (value >= 0.5)  return { phase: 'Высокий',      emoji: '📈',  advice: 'Энергия на подъёме. Хорошее время для действий.' };
    if (value >= 0)    return { phase: 'Рост',         emoji: '↗️',  advice: 'Набираете силу. Можно планировать и начинать.' };
    if (value >= -0.5) return { phase: 'Спад',         emoji: '↘️',  advice: 'Энергия снижается. Не форсируйте.' };
    if (value >= -0.9) return { phase: 'Низкий',       emoji: '📉',  advice: 'Берегите себя, отдыхайте, не принимайте важных решений.' };
    return                  { phase: 'Критический', emoji: '⚠️',  advice: 'Опасный день! Никаких нагрузок, только отдых.' };
  }

  function daysToPeak(days, period) {
    const cyclePos = days % period;
    const peakAt = period / 4;
    if (cyclePos < peakAt) return Math.round(peakAt - cyclePos);
    return Math.round(period - cyclePos + peakAt);
  }

  function calc(year, month, day) {
    const birth = new Date(year, month - 1, day);
    const now = new Date();
    const days = (now.getTime() - birth.getTime()) / 86400000;

    const phys = calcCycle(days, CYCLES.physical);
    const emo = calcCycle(days, CYCLES.emotional);
    const intel = calcCycle(days, CYCLES.intellectual);

    const physT = calcCycle(days + 1, CYCLES.physical);
    const emoT = calcCycle(days + 1, CYCLES.emotional);
    const intelT = calcCycle(days + 1, CYCLES.intellectual);

    const avg = (phys + emo + intel) / 3;
    let overall;
    if (avg > 0.5) overall = '🌟 Отличный день! Все системы на подъёме.';
    else if (avg > 0) overall = '✅ Хороший день. Большинство циклов положительны.';
    else if (avg > -0.5) overall = '⚠️ Средний день. Не принимай важных решений.';
    else overall = '🛌 Сложный день. Отдыхай, завтра будет лучше.';

    const avgT = (physT + emoT + intelT) / 3;
    let tomorrowOverall;
    if (avgT > avg) tomorrowOverall = '📈 Завтра лучше. Настройся на подъём.';
    else if (avgT < avg) tomorrowOverall = '📉 Завтра чуть сложнее. Заверши дела сегодня.';
    else tomorrowOverall = '⚖️ Завтра примерно так же.';

    const recs = [];
    if (phys > 0.5) recs.push('💪 Физика на пике — иди в спортзал, тяжёлые дела.');
    else if (phys < -0.5) recs.push('💤 Физика низкая — береги силы.');
    if (emo > 0.5) recs.push('❤️ Эмоции высокие — свидания, важные разговоры.');
    else if (emo < -0.5) recs.push('😔 Эмоции низкие — не вступай в конфликты.');
    if (intel > 0.5) recs.push('🧠 Интеллект на высоте — сложные задачи, учись.');
    else if (intel < -0.5) recs.push('😵 Интеллект низкий — отложи сложные решения.');
    if (phys > 0 && emo > 0 && intel > 0) recs.push('🚀 Все три цикла положительны! Редкий мощный день.');
    if (phys < 0 && emo < 0 && intel < 0) recs.push('⛈ Все три отрицательны. Пережди, завтра лучше.');

    return {
      physical:    { value: phys, percent: percent(phys), phase: phaseInfo(phys).phase, emoji: phaseInfo(phys).emoji, advice: phaseInfo(phys).advice },
      emotional:   { value: emo, percent: percent(emo), phase: phaseInfo(emo).phase, emoji: phaseInfo(emo).emoji, advice: phaseInfo(emo).advice },
      intellectual:{ value: intel, percent: percent(intel), phase: phaseInfo(intel).phase, emoji: phaseInfo(intel).emoji, advice: phaseInfo(intel).advice },
      overall, tomorrow: { physical: percent(physT), emotional: percent(emoT), intellectual: percent(intelT), overall: tomorrowOverall },
      recommendations: recs,
      hasData: true
    };
  }

  return { calc, CYCLES };
})();
