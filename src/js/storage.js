'use strict';
/* Состояние приложения и сохранение на диск (через главный процесс, атомарно). */

const DEFAULT_ATTRIBUTES = () => ({
  version: 1,
  attributes: [
    {
      id: 'mood',
      name: 'Характер песни',
      type: 'select',
      required: true,
      showOnCard: true,
      options: [
        { id: 'sad', label: 'Грустная' },
        { id: 'happy', label: 'Весёлая' },
        { id: 'neutral', label: 'Нейтральная' },
      ],
    },
    {
      id: 'language',
      name: 'Язык',
      type: 'select',
      required: true,
      showOnCard: true,
      options: [
        { id: 'ru', label: 'Русский' },
        { id: 'en', label: 'Английский' },
      ],
    },
    { id: 'knowledge', name: 'Знание песни', type: 'scale', required: true, showOnCard: true, min: 1, max: 10, celebrate: true },
    { id: 'learning_stage', name: 'Этап изучения', type: 'textarea', required: false, showOnCard: false },
  ],
});

const DEFAULT_CATEGORIES = () => ({
  version: 1,
  categories: [
    { id: 'cat_concert', name: 'Для концерта', color: '#ff6b9a' },
    { id: 'cat_rehearsal', name: 'Для репетиций', color: '#7b2ff7' },
    { id: 'cat_vocal', name: 'Занятия вокалом', color: '#6ff0c4' },
    { id: 'cat_fav', name: 'Любимые', color: '#ffc94a' },
  ],
});

const DEFAULT_SETTINGS = () => ({
  version: 1,
  sort: { key: 'createdAt', dir: 'desc' },
  volume: 0.9,
  autoBackup: false, // по умолчанию выключено — пользователь включает сам
  backupEvery: 'week', // 'day' | 'week' | 'month'
  lastAutoBackup: null,
  tutorialDone: false,
});

const S = {
  library: { version: 1, tracks: [], trash: [] },
  attributes: DEFAULT_ATTRIBUTES(),
  categories: DEFAULT_CATEGORIES(),
  settings: DEFAULT_SETTINGS(),
  runtime: { missing: new Set(), root: '', saving: 0 },
};

const Store = (() => {
  const queues = {}; // name -> {running, pending}

  function fileOf(doc) {
    return doc + '.json';
  }

  /** Сохранить документ. Последовательно; если пока шла запись пришли ещё изменения — запишем ещё раз. */
  function save(doc) {
    const q = (queues[doc] = queues[doc] || { running: null, pending: false });
    if (q.running) {
      q.pending = true;
      return q.running;
    }
    const run = async () => {
      S.runtime.saving++;
      indicator();
      try {
        do {
          q.pending = false;
          const snapshot = JSON.parse(JSON.stringify(S[doc]));
          const r = await window.api.save(fileOf(doc), snapshot);
          if (!r.ok) {
            UI.toast('Не удалось сохранить изменения: ' + r.message, { kind: 'error', duration: 8000 });
            return false;
          }
        } while (q.pending);
        return true;
      } finally {
        S.runtime.saving--;
        q.running = null;
        indicator();
      }
    };
    q.running = run();
    return q.running;
  }

  function indicator() {
    document.body.classList.toggle('is-saving', S.runtime.saving > 0);
  }

  window.addEventListener('beforeunload', (e) => {
    if (S.runtime.saving > 0) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  function normalizeLibrary(lib) {
    lib.version = lib.version || 1;
    lib.tracks = (lib.tracks || []).filter((t) => t && t.id && t.fileName);
    lib.trash = Array.isArray(lib.trash) ? lib.trash : [];
    for (const t of lib.tracks) {
      t.attributes = t.attributes && typeof t.attributes === 'object' ? t.attributes : {};
      t.categories = Array.isArray(t.categories) ? t.categories : [];
      t.status = t.status === 'draft' ? 'draft' : 'ready';
      t.title = t.title || titleFromFile(t.originalFileName);
      t.notes = t.notes || '';
      t.performances = Array.isArray(t.performances) ? t.performances : [];
      t.history = Array.isArray(t.history) ? t.history : [];
    }
    return lib;
  }

  function normalizeAttributes(doc) {
    doc.attributes = (doc.attributes || []).filter((a) => a && a.id && a.name && ATTR_TYPES[a.type]);
    for (const a of doc.attributes) {
      if (a.type === 'select' || a.type === 'multiselect') a.options = Array.isArray(a.options) ? a.options : [];
      if (a.type === 'scale') {
        a.min = Number.isFinite(a.min) ? a.min : 1;
        a.max = Number.isFinite(a.max) ? a.max : 10;
      }
    }
    return doc;
  }

  /** Загрузка с диска. Возвращает список проблем (повреждённые файлы), если они есть. */
  async function load() {
    const r = await window.api.load();
    if (!r.ok) throw new Error(r.message);
    const { docs, problems, root } = r.value;
    S.runtime.root = root;
    S.runtime.backups = r.value.backups;
    S.runtime.isDefaultRoot = r.value.isDefaultRoot;
    const fresh = [];
    if (docs['library.json']) S.library = normalizeLibrary(docs['library.json']);
    else if (!problems.find((p) => p.name === 'library.json')) fresh.push('library');
    if (docs['attributes.json']) S.attributes = normalizeAttributes(docs['attributes.json']);
    else if (!problems.find((p) => p.name === 'attributes.json')) fresh.push('attributes');
    if (docs['categories.json']) S.categories = docs['categories.json'];
    else if (!problems.find((p) => p.name === 'categories.json')) fresh.push('categories');
    if (docs['settings.json']) {
      const raw = docs['settings.json'];
      // версия 1.0 включала автокопии сама; теперь это решает пользователь
      if (!raw.backupEvery) {
        raw.autoBackup = false;
        raw.backupEvery = 'week';
        fresh.push('settings');
      }
      S.settings = Object.assign(DEFAULT_SETTINGS(), raw);
    }
    else if (!problems.find((p) => p.name === 'settings.json')) fresh.push('settings');
    for (const d of fresh) await save(d);
    return problems;
  }

  return { save, load };
})();

/* Быстрый доступ */
const Lib = {
  tracks: () => S.library.tracks,
  track: (id) => S.library.tracks.find((t) => t.id === id),
  attrs: () => S.attributes.attributes,
  attr: (id) => S.attributes.attributes.find((a) => a.id === id),
  cats: () => S.categories.categories,
  cat: (id) => S.categories.categories.find((c) => c.id === id),
};

function mediaUrl(fileName) {
  return 'mml://media/' + encodeURIComponent(fileName);
}
function coverUrl(fileName) {
  return 'mml://cover/' + encodeURIComponent(fileName);
}
