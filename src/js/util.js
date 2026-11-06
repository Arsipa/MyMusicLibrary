'use strict';
/* Общие помощники: создание элементов, форматирование, иконки. */

function h(tag, props, ...children) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement((m && m[1]) || 'div');
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === '.') el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
          // для любого «фирменного» цвета сразу подбираем читаемый цвет текста поверх него
          if (sk === '--c' && typeof sv === 'string' && sv.startsWith('#')) el.style.setProperty('--fg', textOn(sv));
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'icon') el.innerHTML = icon(v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

function uid(prefix = 'id_') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}

function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) return '–:––';
  sec = Math.floor(sec);
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  if (m >= 60) return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}`;
  return `${m}:${s}`;
}

function fmtDate(iso, withTime = true) {
  if (!iso) return '—';
  const d = new Date(iso);
  const opts = { day: 'numeric', month: 'long', year: 'numeric' };
  if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleString('ru-RU', opts);
}

function fmtSize(bytes) {
  if (!isFinite(bytes)) return '—';
  if (bytes < 1024) return bytes + ' Б';
  const u = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let i = -1;
  do {
    bytes /= 1024;
    i++;
  } while (bytes >= 1024 && i < u.length - 1);
  return bytes.toFixed(bytes < 10 ? 1 : 0).replace('.', ',') + ' ' + u[i];
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function hashStr(s) {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) {
    x ^= s.charCodeAt(i);
    x = Math.imul(x, 16777619);
  }
  return x >>> 0;
}

function titleFromFile(name) {
  return (
    String(name || '')
      .replace(/\.[^.]+$/, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s*[\(\[]?(минус|minus|instrumental|karaoke|караоке)[\)\]]?\s*/gi, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .slice(0, 120) || 'Без названия'
  );
}

/**
 * «Исполнитель - Название (минус).mp3» → { artist, title }. Если дефиса нет — исполнитель пустой.
 */
function parseFileName(name) {
  const full = titleFromFile(name);
  const m = /^(.{1,100}?)\s+[-–—]\s+(.+)$/.exec(full);
  if (m && m[2].trim()) return { artist: m[1].trim(), title: m[2].trim().slice(0, 120) };
  return { artist: '', title: full };
}

/** «Исполнитель — Название» для подписей */
function fullTitle(t) {
  return t.artist ? `${t.artist} — ${t.title}` : t.title;
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
}

/* ---------- Ограничения длины полей ---------- */
/*
 * Подобраны под реальное использование:
 *  - название: «Исполнитель — Песня (live, акустическая версия)» ≈ 60–80 символов, берём с запасом;
 *  - комментарий и многострочные поля: заметки к репетиции на несколько абзацев (≈ полстраницы);
 *  - названия атрибутов, вариантов и категорий должны помещаться на кнопках и метках.
 */
const LIMITS = {
  trackTitle: 120,
  artist: 100,
  perfTitle: 80,
  notes: 1500,
  attrText: 120,
  attrTextarea: 50000, // многострочные атрибуты — например, полный текст песни; предел только от случайной вставки мегабайтов
  attrName: 40,
  optionLabel: 40,
  categoryName: 40,
  clipUrl: 500,
  search: 100,
  number: 1e9,
};

/**
 * Поле со счётчиком символов. Для однострочных полей (и при quiet) счётчик появляется только ближе к пределу.
 * Многострочное поле само растёт по мере ввода (до разумной высоты, дальше — прокрутка).
 */
function withCounter(input, max, { quiet = false } = {}) {
  input.maxLength = max;
  const counter = h('span.char-count');
  const multi = input.tagName === 'TEXTAREA';
  const update = () => {
    const n = input.value.length;
    counter.textContent = `${n} / ${max}`;
    counter.classList.toggle('near', n >= max * 0.9);
    counter.hidden = (!multi || quiet) && n < max * (quiet ? 0.9 : 0.7);
    if (multi && input.isConnected) {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight + 4, 460) + 'px';
    }
  };
  input.addEventListener('input', update);
  update();
  if (multi) requestAnimationFrame(update);
  return h('div.field-wrap' + (multi ? '.multi' : ''), null, input, counter);
}

/** Однострочный текст: без переносов и управляющих символов, без лишних пробелов, не длиннее max. */
function cleanLine(s, max) {
  return String(s || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}
/** Многострочный текст: сохраняем переносы строк, убираем прочие управляющие символы. */
function cleanText(s, max) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .slice(0, max);
}

/**
 * Ссылка на клип: принимаем адреса http(s), «youtube.com/…» без https:// дополняем сами.
 * Возвращает { url } , { url: null } для пустого поля или { error }.
 */
function parseClipUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return { url: null };
  if (s.length > LIMITS.clipUrl) return { error: `Ссылка слишком длинная (больше ${LIMITS.clipUrl} символов).` };
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  let u;
  try {
    u = new URL(s);
  } catch (_) {
    return { error: 'Это не похоже на ссылку. Скопируйте адрес клипа из браузера целиком.' };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Подойдут только обычные ссылки на сайты (http или https).' };
  if (!u.hostname.includes('.') || /\s/.test(s)) return { error: 'Это не похоже на ссылку. Скопируйте адрес клипа из браузера целиком.' };
  return { url: u.href };
}

/** Короткое имя сайта для подписи: youtube.com, vk.com… */
function siteName(url) {
  try {
    return new URL(url).hostname.replace(/^(www|m)\./, '');
  } catch (_) {
    return '';
  }
}

/* ---------- Цвета ---------- */
function normHex(s) {
  let x = String(s || '').trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(x)) x = x.split('').map((c) => c + c).join('');
  return /^[0-9a-f]{6}$/.test(x) ? '#' + x : null;
}
function hexToRgb(hex) {
  const x = normHex(hex) || '#7b2ff7';
  return [1, 3, 5].map((i) => parseInt(x.slice(i, i + 2), 16));
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
function hexToHsv(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  let hh = 0;
  if (d) {
    if (mx === r) hh = ((g - b) / d) % 6;
    else if (mx === g) hh = (b - r) / d + 2;
    else hh = (r - g) / d + 4;
    hh *= 60;
    if (hh < 0) hh += 360;
  }
  return { h: hh, s: mx ? d / mx : 0, v: mx };
}
function hsvToHex(hh, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
/** Тёмный или белый текст — что лучше читается на этом цвете */
function textOn(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.36 ? '#24093f' : '#ffffff';
}

/* ---------- Иконки (свои, нарисованные под приложение) ---------- */
const ICONS = {
  plus: '<path d="M12 4.5v15M4.5 12h15" stroke-width="3" stroke-linecap="round"/>',
  play: '<path d="M8 5.2c0-1 1.1-1.6 1.9-1.1l10 6.4c.8.5.8 1.6 0 2.1l-10 6.4c-.8.5-1.9-.1-1.9-1.1V5.2z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6" y="4.5" width="4.4" height="15" rx="1.6" fill="currentColor" stroke="none"/><rect x="13.6" y="4.5" width="4.4" height="15" rx="1.6" fill="currentColor" stroke="none"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9" stroke-width="2.2" stroke-linecap="round"/><circle cx="15" cy="7" r="2.6" stroke-width="2.2"/><circle cx="9" cy="17" r="2.6" stroke-width="2.2"/>',
  tag: '<path d="M3.5 12.2V5a1.5 1.5 0 0 1 1.5-1.5h7.2c.4 0 .8.2 1.1.4l7.4 7.4a1.5 1.5 0 0 1 0 2.1l-7.2 7.2a1.5 1.5 0 0 1-2.1 0l-7.4-7.4a1.5 1.5 0 0 1-.5-1z" stroke-width="2.1" stroke-linejoin="round"/><circle cx="8.2" cy="8.2" r="1.7" fill="currentColor" stroke="none"/>',
  shield: '<path d="M12 3.2 4.8 6v5.6c0 4.4 3 8 7.2 9.2 4.2-1.2 7.2-4.8 7.2-9.2V6L12 3.2z" stroke-width="2.1" stroke-linejoin="round"/><path d="m8.7 12 2.3 2.3 4.4-4.6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="10.5" cy="10.5" r="6" stroke-width="2.4"/><path d="m15 15 5 5" stroke-width="2.6" stroke-linecap="round"/>',
  close: '<path d="m6 6 12 12M18 6 6 18" stroke-width="2.6" stroke-linecap="round"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" stroke-width="2.1" stroke-linejoin="round"/><path d="m13.5 6.5 4 4" stroke-width="2.1"/>',
  trash: '<path d="M4.5 7h15M10 3.8h4M6.5 7l.9 11.4A2 2 0 0 0 9.4 20.2h5.2a2 2 0 0 0 2-1.8L17.5 7" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 11v5M14 11v5" stroke-width="2" stroke-linecap="round"/>',
  more: '<circle cx="5.5" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="2" fill="currentColor" stroke="none"/>',
  back: '<path d="M14.5 5 7.5 12l7 7" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  loop: '<path d="M17 3.5 20 6.5l-3 3M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20M7 20.5 4 17.5l3-3M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
  rew: '<path d="M11.5 6.5 5 12l6.5 5.5V6.5zM19.5 6.5 13 12l6.5 5.5V6.5z" fill="currentColor" stroke="none"/>',
  fwd: '<path d="M12.5 6.5 19 12l-6.5 5.5V6.5zM4.5 6.5 11 12l-6.5 5.5V6.5z" fill="currentColor" stroke="none"/>',
  volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" stroke-width="2" stroke-linecap="round"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="m16 9.5 5 5M21 9.5l-5 5" stroke-width="2" stroke-linecap="round"/>',
  note: '<path d="M9 18V5.5l11-2.5v12.5" stroke-width="2.1" stroke-linejoin="round"/><circle cx="6.5" cy="18" r="2.8" fill="currentColor" stroke="none"/><circle cx="17.5" cy="15.5" r="2.8" fill="currentColor" stroke="none"/>',
  filter: '<path d="M4 5h16l-6.2 7.6V19l-3.6-1.8v-4.6z" stroke-width="2.1" stroke-linejoin="round"/>',
  sortUp: '<path d="M7 19V5M3.5 8.5 7 5l3.5 3.5M13 7h7M13 12h5M13 17h3" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
  sortDown: '<path d="M7 5v14M3.5 15.5 7 19l3.5-3.5M13 7h3M13 12h5M13 17h7" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>',
  warn: '<path d="M12 3.5 2.8 19.5h18.4z" stroke-width="2.1" stroke-linejoin="round"/><path d="M12 10v4.5" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="3" stroke-width="2.1"/><path d="m16 10.5 5-3v9l-5-3" stroke-width="2.1" stroke-linejoin="round"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke-width="2.1"/><circle cx="9" cy="10" r="1.8" fill="currentColor" stroke="none"/><path d="m4.5 17.5 5-4.5 3.5 3 3-2.5 4 3.5" stroke-width="2" stroke-linejoin="round"/>',
  undo: '<path d="M8 5 4 9l4 4" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M4.5 9H14a5.5 5.5 0 0 1 0 11h-3" stroke-width="2.3" stroke-linecap="round"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  upload: '<path d="M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" stroke-width="2.1" stroke-linejoin="round"/>',
  replace: '<path d="M4 9a8 8 0 0 1 14.5-3.5M20 4v4h-4M20 15a8 8 0 0 1-14.5 3.5M4 20v-4h4" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
  open: '<path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14v4a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 5 18V9a1.5 1.5 0 0 1 1.5-1.5h4" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>',
  heartbeat: '<path d="M3 12h4l2-5 4 10 2-5h6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  up: '<path d="m6 14 6-6 6 6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="m6 10 6 6 6-6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  text: '<path d="M5 6.5h14M12 6.5V19" stroke-width="2.4" stroke-linecap="round"/>',
  paragraph: '<path d="M4 6h16M4 10.5h16M4 15h16M4 19.5h9" stroke-width="2.1" stroke-linecap="round"/>',
  list: '<circle cx="5" cy="7" r="1.6" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="1.6" fill="currentColor" stroke="none"/><path d="M9.5 7H20M9.5 12H20M9.5 17H20" stroke-width="2.1" stroke-linecap="round"/>',
  checks: '<rect x="3.5" y="4" width="6.5" height="6.5" rx="1.8" stroke-width="2"/><rect x="3.5" y="13.5" width="6.5" height="6.5" rx="1.8" stroke-width="2"/><path d="m5.2 7.3 1.4 1.4 2.4-2.6M13.5 7.3H20M13.5 16.8H20" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  hash: '<path d="M9.5 3.5 7.5 20.5M16.5 3.5l-2 17M4.5 9h16M3.5 15h16" stroke-width="2.1" stroke-linecap="round"/>',
  star: '<path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" stroke-width="2" stroke-linejoin="round"/>',
  speed: '<path d="M4.5 16a8 8 0 1 1 15 0" stroke-width="2.2" stroke-linecap="round"/><path d="m12 15.5 4-5.5" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="15.5" r="1.6" fill="currentColor" stroke="none"/>',
  crown: '<path d="M4 17.5 3 7.5l5 4 4-6.5 4 6.5 5-4-1 10z" fill="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5 20.5h14" stroke-width="2.2" stroke-linecap="round"/>',
  mic: '<rect x="8.5" y="3" width="7" height="11.5" rx="3.5" stroke-width="2.1"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.5M8.5 21h7" stroke-width="2.1" stroke-linecap="round"/>',
  clock: '<circle cx="12" cy="12" r="8.6" stroke-width="2.1"/><path d="M12 7.5V12l3 2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" stroke-width="2.2" stroke-linecap="round"/>',
  grip: '<circle cx="9" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="6" r="1.7" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="9" cy="18" r="1.7" fill="currentColor" stroke="none"/><circle cx="15" cy="18" r="1.7" fill="currentColor" stroke="none"/>',
  chevLeft: '<path d="m14.5 6-6 6 6 6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  chevRight: '<path d="m9.5 6 6 6-6 6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  pipette: '<path d="m13.5 6.5 4 4M15 5l1.6-1.6a2.1 2.1 0 0 1 3 3L18 8l1 1-2 2-6-6 2-2zM12.5 9.5 5 17v2.5h2.5l7.5-7.5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  gear: '<path d="M10.3 3.6h3.4l.5 2.4 1.7.9 2.3-.9 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.9-1.7.9-.5 2.4h-3.4l-.5-2.4-1.7-.9-2.3.9-1.7-2.9 1.8-1.6v-2L3.9 8.9l1.7-2.9 2.3.9 1.7-.9z" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.8" stroke-width="2"/>',
  telegram: '<path d="M20.5 4.5 3.6 11.1c-.8.3-.8 1.4 0 1.7l4.1 1.4 1.6 5c.2.7 1.1.9 1.6.4l2.3-2.2 4.3 3.1c.6.4 1.4.1 1.6-.6l2.7-13.3c.2-.9-.6-1.5-1.3-1.1z" stroke-width="1.9" stroke-linejoin="round"/><path d="m7.8 14.2 9.4-6.4-6.6 7.6" stroke-width="1.9" stroke-linejoin="round"/>',
  github: '<path d="M9 19.5c-4 1.2-4-2-5.6-2.5M14.6 21v-3.4c0-1 .1-1.4-.5-2 2.6-.3 5.4-1.3 5.4-5.8a4.5 4.5 0 0 0-1.2-3.1 4.2 4.2 0 0 0-.1-3.1s-1-.3-3.2 1.2a11 11 0 0 0-5.8 0C7 3.3 6 3.6 6 3.6a4.2 4.2 0 0 0-.1 3.1 4.5 4.5 0 0 0-1.2 3.1c0 4.5 2.8 5.5 5.4 5.8-.6.6-.6 1.1-.5 2V21" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  help: '<circle cx="12" cy="12" r="8.6" stroke-width="2.1"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="16.9" r="1.2" fill="currentColor" stroke="none"/>',
  arrow: '<path d="M5 12h13.5M13 6.5l5.5 5.5-5.5 5.5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  chevron: '<path d="m7 9.5 5 5 5-5" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  sparkle: '<path d="M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7z" fill="currentColor" stroke="none"/>',
};

function icon(name, cls = '') {
  const body = ICONS[name] || '';
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">${body}</svg>`;
}

function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    if (!el.dataset.iconDone) {
      el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
      el.dataset.iconDone = '1';
    }
  });
}

/* Генеративная «обложка» трека: стабильные цвета по id */
const ART_PALETTES = [
  ['#7b2ff7', '#c8b3ff', '#d6ff3d'],
  ['#3b1366', '#ff6b9a', '#ffc94a'],
  ['#9d5cff', '#6ff0c4', '#24093f'],
  ['#5a1fb8', '#ffb3d1', '#e9dcff'],
  ['#24093f', '#9d5cff', '#ff6b9a'],
  ['#b18cff', '#3b1366', '#d6ff3d'],
  ['#6a2bd9', '#ffc94a', '#ffe9f2'],
  ['#d4c2ff', '#7b2ff7', '#ff6b9a'],
];

function artFor(id) {
  const x = hashStr(id || 'x');
  const pal = ART_PALETTES[x % ART_PALETTES.length];
  return {
    pal,
    shape: (x >>> 4) % 4,
    rot: ((x >>> 8) % 40) - 20,
    tilt: (((x >>> 12) % 5) - 2) * 0.6,
    pos: 20 + ((x >>> 16) % 60),
  };
}
