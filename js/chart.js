// chart.js — натальная карта в Mini App.
// Детерминированный мок-расчёт на основе telegramId + даты рождения.
// В будущем можно заменить на вызов бэкенда astro-natal-bot.

window.NatalChart = (function () {
  const SIGNS = [
    { name: 'Овен',      symbol: '♈', element: 'Огонь', ruler: 'Марс',      start:  80 },
    { name: 'Телец',     symbol: '♉', element: 'Земля', ruler: 'Венера',    start: 110 },
    { name: 'Близнецы',  symbol: '♊', element: 'Воздух', ruler: 'Меркурий', start: 140 },
    { name: 'Рак',       symbol: '♋', element: 'Вода',  ruler: 'Луна',      start: 171 },
    { name: 'Лев',       symbol: '♌', element: 'Огонь', ruler: 'Солнце',    start: 201 },
    { name: 'Дева',      symbol: '♍', element: 'Земля', ruler: 'Меркурий', start: 234 },
    { name: 'Весы',      symbol: '♎', element: 'Воздух', ruler: 'Венера',    start: 265 },
    { name: 'Скорпион',  symbol: '♏', element: 'Вода',  ruler: 'Плутон',    start: 296 },
    { name: 'Стрелец',   symbol: '♐', element: 'Огонь', ruler: 'Юпитер',    start: 326 },
    { name: 'Козерог',   symbol: '♑', element: 'Земля', ruler: 'Сатурн',    start: 356 },
    { name: 'Водолей',   symbol: '♒', element: 'Воздух', ruler: 'Уран',      start:  21 },
    { name: 'Рыбы',      symbol: '♓', element: 'Вода',  ruler: 'Нептун',    start:  51 },
  ];

  const PLANETS = [
    { id: 'Sun',     name: 'Солнце',      symbol: '☉' },
    { id: 'Moon',    name: 'Луна',        symbol: '☽' },
    { id: 'Mercury', name: 'Меркурий',    symbol: '☿' },
    { id: 'Venus',   name: 'Венера',      symbol: '♀' },
    { id: 'Mars',    name: 'Марс',        symbol: '♂' },
    { id: 'Jupiter', name: 'Юпитер',      symbol: '♃' },
    { id: 'Saturn',  name: 'Сатурн',      symbol: '♄' },
    { id: 'Uranus',  name: 'Уран',        symbol: '♅' },
    { id: 'Neptune', name: 'Нептун',      symbol: '♆' },
    { id: 'Pluto',   name: 'Плутон',      symbol: '♇' },
  ];

  const ASPECTS = [
    { name: 'Соединение', angle: 0,   orb: 8,  glyph: '☌' },
    { name: 'Секстиль',   angle: 60,  orb: 6,  glyph: '⚹' },
    { name: 'Квадрат',    angle: 90,  orb: 8,  glyph: '□' },
    { name: 'Трин',       angle: 120, orb: 8,  glyph: '△' },
    { name: 'Оппозиция',  angle: 180, orb: 8,  glyph: '☍' },
  ];

  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0) / 4294967296;
  }

  function signOf(deg) {
    const idx = SIGNS.findIndex((s, i, arr) => {
      const next = arr[(i + 1) % arr.length];
      if (s.start <= next.start) return deg >= s.start && deg < next.start;
      return deg >= s.start || deg < next.start;
    });
    return SIGNS[idx] || SIGNS[0];
  }

  function degToDms(deg) {
    const d = Math.floor(deg);
    const m = Math.floor((deg - d) * 60);
    return `${d}°${String(m).padStart(2, '0')}`;
  }

  function calcPlanets(seed, birthDate) {
    // seed = "tgId:YYYY-MM-DD" — детерминированный хэш
    let base = hash(seed);
    return PLANETS.map((p, i) => {
      // каждая планета — свой оффсет от base
      const v = (base + hash(seed + ':' + p.id + ':' + i)) % 360;
      const deg = v;
      const sign = signOf(deg);
      return { ...p, deg, sign, dms: degToDms(deg), retro: hash(seed + ':R:' + p.id) < 0.25 };
    });
  }

  function calcHouses(seed) {
    // 12 домов — равнодомная система, ASC = 0° первого дома
    const ascDeg = hash(seed + ':ASC') * 360;
    const houses = [];
    for (let i = 0; i < 12; i++) {
      const cusp = (ascDeg + i * 30) % 360;
      const sign = signOf(cusp);
      houses.push({ number: i + 1, cusp, sign, dms: degToDms(cusp) });
    }
    return houses;
  }

  function calcAspects(planets) {
    const aspects = [];
    for (let i = 0; i < planets.length; i++) {
      for (let j = i + 1; j < planets.length; j++) {
        const a = planets[i].deg;
        const b = planets[j].deg;
        let diff = Math.abs(a - b);
        if (diff > 180) diff = 360 - diff;
        for (const asp of ASPECTS) {
          if (Math.abs(diff - asp.angle) <= asp.orb) {
            aspects.push({ p1: planets[i], p2: planets[j], ...asp, orb: Math.abs(diff - asp.angle).toFixed(1) });
            break;
          }
        }
      }
    }
    return aspects;
  }

  function calc(profile) {
    if (!profile || !profile.birthYear) return null;
    const dateKey = `${profile.birthYear}-${String(profile.birthMonth).padStart(2, '0')}-${String(profile.birthDay).padStart(2, '0')}`;
    const seed = (profile.telegramId || profile.tgId || 1) + ':' + dateKey;
    const planets = calcPlanets(seed, dateKey);
    const houses = calcHouses(seed);
    const aspects = calcAspects(planets);
    const sun = planets.find(p => p.id === 'Sun');
    const moon = planets.find(p => p.id === 'Moon');
    const asc = houses[0];
    return {
      dateKey,
      sunSign: sun ? `${sun.symbol} ${sun.sign.name}` : null,
      moonSign: moon ? `${moon.symbol} ${moon.sign.name}` : null,
      ascendant: asc ? `${asc.sign.symbol} ${asc.sign.name}` : null,
      planets,
      houses,
      aspects,
      elements: countElements(planets),
    };
  }

  function countElements(planets) {
    const counts = { Огонь: 0, Земля: 0, Воздух: 0, Вода: 0 };
    for (const p of planets) counts[p.sign.element] = (counts[p.sign.element] || 0) + 1;
    return counts;
  }

  return { calc, signOf, degToDms };
})();
