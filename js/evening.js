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
    const data = { type: 'checkin', payload: today() };
    if (window.TelegramApp && window.TelegramApp.tg && window.TelegramApp.tg.sendData) {
      window.TelegramApp.tg.sendData(JSON.stringify(data));
      return true;
    }
    return false;
  }

  return { save, today, last30, loadProfile, saveProfile, shareToBot };
})();
