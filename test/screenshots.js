'use strict';
/*
 * Скриншоты для README: заполняет временную библиотеку демо-песнями и снимает основные экраны.
 * Запуск: npm run screenshots  →  docs/screenshots/*.png
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const MEDIA = path.join(__dirname, 'media');

const DEMO = [
  { title: 'Ночной трамвай', artist: 'Лиза Север', clip: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', file: 'Кукушка (минус).wav', mood: 'sad', lang: 'ru', k: 8, cats: ['cat_concert', 'cat_fav'], stage: 'Куплеты уверенно, в припеве подтянуть верхнюю ноту.', notes: 'Взять дыхание перед вторым припевом. Темп чуть медленнее оригинала — так легче держать длинные ноты.' },
  { title: 'Summer Rain', artist: 'The Velvet Hours', file: 'Shallow_instrumental.wav', mood: 'happy', lang: 'en', k: 6, cats: ['cat_rehearsal'], stage: 'Текст выучен, работаю над ритмом во втором куплете.', notes: 'Поработать над произношением в бридже, особенно «through» и «thought».' },
  { title: 'Колыбельная для луны', artist: 'Анна Рассвет', file: 'Колыбельная.wav', mood: 'neutral', lang: 'ru', k: 10, cats: ['cat_concert', 'cat_vocal'], stage: 'Готово!', notes: 'Готово к выступлению. Держать piano в последнем куплете.' },
  { title: 'Paper Hearts', artist: 'Mila Grey', file: 'Song.wav', mood: 'sad', lang: 'en', k: 4, cats: ['cat_vocal'], stage: 'Пока только первый куплет.', notes: 'Разобрать мелизмы в конце фраз, записать себя на диктофон и сравнить.' },
  { title: 'Танго на крыше', artist: 'Оркестр «Фонари»', file: 'Кукушка (минус).wav', mood: 'happy', lang: 'ru', k: 7, cats: ['cat_concert'], stage: '', notes: 'Добавить больше драмы во втором куплете, паузу перед финалом не затягивать.' },
  { title: 'Blue Velvet Sky', artist: 'Nora Lane', file: 'Shallow_instrumental.wav', mood: 'neutral', lang: 'en', k: 9, cats: ['cat_fav'], stage: 'Всё выучено.', notes: 'Попробовать на полтона ниже — так звучит теплее.' },
  { title: 'Северное сияние', artist: 'Лиза Север', file: 'Колыбельная.wav', mood: 'sad', lang: 'ru', k: 3, cats: ['cat_rehearsal', 'cat_vocal'], stage: 'Только начала.', notes: 'Новая песня — слушать каждый день по разу, пока не уляжется.' },
  { title: 'Fly Me Higher', artist: 'Skyline Duo', file: 'Song.wav', mood: 'happy', lang: 'en', k: 5, cats: ['cat_rehearsal'], stage: '', notes: '' },
];

module.exports = async (win) => {
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, timeout = 10000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await js(`!!(${expr})`)) return;
      await sleep(100);
    }
    throw new Error('timeout: ' + expr);
  };
  const shot = async (name) => {
    await sleep(700);
    const img = await wc.capturePage();
    const { width } = img.getSize();
    const out = width > 1600 ? img.resize({ width: 1600, quality: 'best' }) : img;
    fs.writeFileSync(path.join(OUT, name + '.png'), out.toPNG());
    console.log('shot', name);
  };
  const hideToasts = () => js(`(() => { const s=document.createElement('style'); s.textContent='.toasts{display:none!important}'; document.head.appendChild(s); return 1; })()`);

  fs.mkdirSync(OUT, { recursive: true });
  try {
    win.setContentSize(1440, 900);
    await waitFor(`document.body.classList.contains('ready')`);
    await hideToasts();

    // 1. Обучение на пустой библиотеке
    await waitFor(`Tour.isActive() && document.querySelector('.tour-next')`);
    await sleep(500);
    await js(`document.querySelector('.tour-next').click(); 1`);
    await sleep(900);
    await shot('tutorial');
    await js(`document.querySelector('.tour-skip').click(); 1`);
    await sleep(600);

    // 2. Пустая библиотека
    await shot('welcome');

    // 3. Демо-библиотека
    const items = DEMO.map((d) => ({ ...d, path: path.join(MEDIA, d.file) }));
    await js(`(async () => {
      const items = ${JSON.stringify(items)};
      const base = Date.now() - items.length * 86400000 * 2;
      for (let i = 0; i < items.length; i++) {
        const d = items[i];
        const r = await window.api.importTrack(d.path);
        const info = r.value;
        const p = await Tracks.probe(info.fileName);
        const at = new Date(base + i * 86400000 * 2).toISOString();
        const attrs = { mood: d.mood, language: d.lang, knowledge: d.k };
        if (d.stage) attrs.learning_stage = d.stage;
        S.library.tracks.push({ id: 'trk_demo' + i, title: d.title, artist: d.artist, originalFileName: d.title + '.mp3', fileName: info.fileName,
          filePath: 'storage/tracks/' + info.fileName, mime: info.mime, size: info.size, duration: p.duration, hasVideo: false,
          cover: null, clipUrl: d.clip || undefined, notes: d.notes, categories: d.cats, attributes: attrs, status: 'ready', createdAt: at, updatedAt: at });
      }
      await Store.save('library');
      App.refresh();
      return 1;
    })()`);
    await sleep(500);
    await js(`(async () => { const v=document.createElement('video'); await Player.play('trk_demo0'); document.querySelector('video.media-el').volume = 0; return 1; })()`);
    await sleep(1800);
    await js(`document.querySelector('video.media-el').pause(); 1`);
    await sleep(300);
    await js(`document.getElementById('app').scrollTop = 0; 1`);
    await shot('library');

    // 4. Фильтры
    await js(`document.querySelector('.filter-btn').click(); 1`);
    await sleep(400);
    await js(`[...document.querySelectorAll('.fp-opt')].find(b=>b.textContent==='Грустная').click(); 1`);
    await sleep(200);
    await js(`[...document.querySelectorAll('.fp-opt')].find(b=>b.textContent==='Русский').click(); 1`);
    await sleep(400);
    await shot('filters');
    await js(`Filters.reset(); document.querySelector('.filter-btn').click(); 1`);
    await sleep(300);

    // 4б. История роста оценок у всех песен (для статистики)
    await js(`(async () => { const now = Date.now(); for (const t of Lib.tracks()) { const k = t.attributes.knowledge; const d0 = new Date(t.createdAt).getTime(); const v0 = Math.max(1, k - 3), v1 = Math.max(v0, k - 1); const at = (f) => new Date(d0 + (now - d0) * f).toISOString(); const ch = (a, b) => [{ key: 'attr:knowledge', label: 'Знание песни', from: a + ' из 10', to: b + ' из 10' }]; t.history = [{ at: t.createdAt, kind: 'added', changes: [] }]; if (v1 > v0) t.history.push({ at: at(0.4), kind: 'edit', changes: ch(v0, v1) }); if (k > v1) t.history.push({ at: at(0.8), kind: 'edit', changes: ch(v1, k) }); } await Store.save('library'); return 1; })()`);
    // 5. Страница трека: история изменений и видео выступления
    await js(`(() => { const t = Lib.track('trk_demo0'); const d0 = new Date(t.createdAt).getTime(); const at = (days) => new Date(d0 + days * 86400000).toISOString();
      t.history = [
        { at: at(0), kind: 'added', changes: [] },
        { at: at(3), kind: 'edit', changes: [{ key: 'attr:knowledge', label: 'Знание песни', from: '4 из 10', to: '6 из 10' }] },
        { at: at(6), kind: 'edit', changes: [{ label: 'Комментарий', from: 'Разобрать текст', to: 'Взять дыхание перед вторым припевом…', edited: true }, { label: 'Категории', from: 'Для концерта', to: 'Для концерта, Любимые' }] },
        { at: at(9), kind: 'edit', changes: [{ key: 'attr:knowledge', label: 'Знание песни', from: '6 из 10', to: '8 из 10' }] },
      ]; return 1; })()`);
    const perfVideo = path.join(MEDIA, 'Клип с видео.webm');
    if (fs.existsSync(perfVideo)) {
      await js(`Performances.add('trk_demo0', [${JSON.stringify(perfVideo)}]); 1`);
      await waitFor(`(Lib.track('trk_demo0').performances || []).length === 1`, 20000);
      await js(`(async () => { const t = Lib.track('trk_demo0'); t.performances[0].title = 'Концерт в ДК, май 2026'; t.performances[0].best = true; t.performances[0].bestAt = new Date().toISOString(); t.performances[0].description = 'Лучшее исполнение: чистый верх в припеве, дыхание на месте.'; const h = t.history.pop(); h.kind = 'perf-best'; h.changes[0].to = 'Концерт в ДК, май 2026'; t.history.push(h); await Store.save('library'); return 1; })()`);
      for (const [file, title, desc] of [['Song.wav', 'Репетиция у педагога', 'Поработать над переходом во второй куплет.'], ['Колыбельная.wav', 'Прогон дома', '']]) {
        await js(`Performances.add('trk_demo0', [${JSON.stringify(path.join(MEDIA, file))}], { kind: 'audio' }); 1`);
        await sleep(1500);
        await js(`(async () => { const t = Lib.track('trk_demo0'); const p = t.performances[t.performances.length - 1]; p.title = ${JSON.stringify(title)}; p.description = ${JSON.stringify(desc)}; await Store.save('library'); App.refresh(); return 1; })()`);
      }
      await js(`document.querySelectorAll('.toast').forEach(t => t.remove()); 1`);
    }
    await js(`App.openDetail('trk_demo0'); 1`);
    await sleep(800);
    await shot('track-page');
    await js(`document.querySelector('.d-cols').scrollIntoView({ block: 'start' }); document.getElementById('detail').scrollTop -= 16; 1`);
    await sleep(900);
    await shot('track-side');
    await js(`document.querySelector('.d-history').scrollIntoView({ block: 'start' }); document.getElementById('detail').scrollTop -= 20; 1`);
    await sleep(900);
    await shot('track-history');
    await js(`App.closeDetail(); 1`);

    // 5б. Праздник: шкала дошла до максимума
    await js(`Celebrate.show(Lib.track('trk_demo2'), Lib.attr('knowledge')); 1`);
    await sleep(1100);
    await shot('celebrate');
    await js(`document.querySelector('.modal.celebrate .modal-actions .btn').click(); 1`);
    await sleep(500);

    // 6. Форма нового трека
    await js(`(async () => {
      const r = await window.api.importTrack(${JSON.stringify(path.join(MEDIA, 'Song.wav'))});
      const info = r.value; const p = await Tracks.probe(info.fileName); const now = new Date().toISOString();
      S.library.tracks.push({ id: 'trk_new', title: 'Звёздная пыль', originalFileName: 'Звёздная пыль (минус).mp3', fileName: info.fileName,
        filePath: 'storage/tracks/' + info.fileName, mime: 'audio/mpeg', size: 4718592, duration: 214, hasVideo: false, cover: null, notes: '',
        categories: [], attributes: {}, status: 'draft', createdAt: now, updatedAt: now });
      await Store.save('library'); App.refresh(); Tracks.openForm('trk_new', { mode: 'new' }); return 1; })()`);
    await waitFor(`document.querySelector('.track-form')`);
    await js(`(() => {
      const f = (a) => document.querySelector('.form-field[data-attr="'+a+'"]');
      [...f('mood').querySelectorAll('.opt')].find(b=>b.textContent.includes('Весёлая')).click();
      [...f('language').querySelectorAll('.opt')].find(b=>b.textContent.includes('Русский')).click();
      [...f('knowledge').querySelectorAll('.scale-cell')][5].click();
      return 1; })()`);
    await shot('add-track');
    await js(`[...document.querySelectorAll('.modal-actions .btn')].find(b=>b.textContent.includes('Отменить загрузку')).click(); 1`);
    await sleep(500);
    await js(`[...document.querySelectorAll('.modal.small .modal-actions .btn')].find(b=>b.textContent.includes('Удалить загрузку')).click(); 1`);
    await sleep(600);

    // 7. Конструктор атрибутов
    await js(`AttributesManager.open(); 1`);
    await sleep(400);
    await js(`[...document.querySelectorAll('.modal-actions .btn')].find(b=>b.textContent.includes('Новый атрибут')).click(); 1`);
    await sleep(400);
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); m.querySelector('input.input').value='Тональность';
      [...m.querySelectorAll('.type-tile')].find(b=>b.dataset.type==='select').click(); return 1; })()`);
    for (const v of ['До мажор', 'Ля минор', 'Ми минор', 'Ре мажор']) {
      await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); m.querySelector('.opt-add input').value=${JSON.stringify(v)}; m.querySelector('.opt-add button').click(); return 1; })()`);
    }
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); m.querySelector('.modal-body').scrollTop = 0; return 1; })()`);
    await shot('attributes');
    await js(`(() => { document.querySelectorAll('.modal-overlay').forEach(o => o.remove()); return 1; })()`);
    await sleep(300);

    // 7б. Статистика
    await js(`document.querySelectorAll('.toast').forEach(t => t.remove()); Stats.open(); 1`);
    await sleep(400);
    await js(`document.querySelector('.st-period button[data-id="month"]').click(); 1`);
    await sleep(500);
    await js(`document.querySelector('#stats .st-controls').scrollIntoView({ block: 'start' }); document.getElementById('stats').scrollTop -= 16; 1`);
    await sleep(600);
    await shot('stats');
    await js(`Stats.close(); 1`);
    // 8. Настройки
    await js(`S.settings.autoBackup = true; S.settings.backupEvery = 'week'; Backup.open(); 1`);
    await sleep(500);
    await js(`[...document.querySelectorAll('.btn')].find(b=>b.textContent.includes('Создать копию сейчас')).click(); 1`);
    await sleep(1500);
    await shot('backups');
    await js(`[...document.querySelectorAll('.tab')].find(b=>b.textContent.includes('О приложении')).click(); 1`);
    await sleep(600);
    await shot('about');
    await js(`document.querySelectorAll('.modal-overlay').forEach(o => o.remove()); 1`);

    // 9. Узкое окно (для проверки адаптивности)
    win.setContentSize(820, 900);
    await sleep(700);
    await shot('narrow');
  } catch (e) {
    console.error('SCREENSHOT ERROR', e);
  }
  setTimeout(() => app.exit(0), 300);
};
