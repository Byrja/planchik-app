// evening.js — вечерний чек-ин. Хранит в localStorage.
// В проде можно POST-ить в бот через tg.sendData.

window.Evening = (function () {
  const KEY = 'planchik_checkins';
  const PROFILE_KEY = 'planchik_profile';
  const D = window.DATA;

  function todayKey() { return D.todayKey(); }

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); }
    catch (e) { return []; }
  }
  function saveAll(arr) { localStorage.setItem(KEY, JSON.stringify(arr)); }

  function save(mood, note) {
    const arr = loadAll();
    const entry = { date: todayKey(), mood: Number(mood), note: (note || '').trim(), ts: Date.now() };
    // заменяем за сегодня, если есть
    const idx = arr.findIndex(e => e.date === entry.date);
    if (idx >= 0) arr[idx] = entry; else arr.push(entry);
    saveAll(arr.slice(-90)); // хранить 90 дней
    return entry;
  }

  function today() {
    return loadAll().find(e => e.date === todayKey()) || null;
  }

  function last30() {
    return loadAll().slice(-30);
  }

  // Профиль
  function loadProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function saveProfile(p) {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  }

  function shareToBot() {
    const t = today();
    if (!t) return false;
    const tg = window.TelegramApp && window.TelegramApp.tg;
    if (tg && tg.sendData) {
      try {
        tg.sendData(JSON.stringify({ type: 'checkin', payload: { mood: t.mood, note: t.note, ts: t.ts } }));
        return true;
      } catch (e) { /* fallback */ }
    }
    // Fallback: share dialog
    const date = new Date(t.ts);
    const dateStr = date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    const moodEmoji = ['', '😞', '😕', '😐', '🙂', '😄'][t.mood] || '·';
    const text = `${moodEmoji} Чек-ин ${dateStr}: настроение ${t.mood}/5${t.note ? ' · ' + t.note : ''}\n\n— Планчик`;
    if (tg && tg.openTelegramLink) {
      const url = 'https://t.me/share/url?url=' + encodeURIComponent('https://t.me/astro_byrbot') + '&text=' + encodeURIComponent(text);
      tg.openTelegramLink(url);
    } else if (navigator.share) {
      navigator.share({ text }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    return true;
  }

  return { save, today, last30, loadProfile, saveProfile, shareToBot };
})();
