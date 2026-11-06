'use strict';
/* Сквозной автотест: запускает реальное приложение в отдельной папке данных, кликает по интерфейсу, снимает скриншоты. */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const SHOTS = path.join(__dirname, 'shots');
const MEDIA = path.join(__dirname, 'media');
const log = [];
const ok = (cond, msg) => {
  log.push((cond ? 'PASS ' : 'FAIL ') + msg);
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
};

module.exports = async (win, getLib) => {
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    await sleep(450);
    const img = await wc.capturePage();
    fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG());
  };
  const waitFor = async (expr, timeout = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (await js(`!!(${expr})`)) return true;
      await sleep(100);
    }
    throw new Error('timeout: ' + expr);
  };
  // клик по кнопке с текстом внутри селектора
  const click = (sel, text) =>
    js(`(() => { const els=[...document.querySelectorAll(${JSON.stringify(sel)})].filter(e=>e.offsetParent!==null || e.closest('.modal')); const el = ${text ? `els.find(e=>e.textContent.trim().includes(${JSON.stringify(text)}))` : 'els[els.length-1]'}; if(!el) throw new Error('no element ${sel} ${text || ''}'); el.click(); return true; })()`);

  fs.mkdirSync(SHOTS, { recursive: true });
  try {
    // типичный 15" ноутбук: 1920×1080 при масштабе 150% → окно примерно 1280×650 полезной площади
    win.setContentSize(1280, 650);
    await waitFor(`document.body.classList.contains('ready')`);

    // ---- Обучение при первом запуске
    await waitFor(`Tour.isActive() && document.querySelector('.tour-bubble .tour-title')`, 5000);
    ok(true, 'обучение запускается при первом запуске');
    await shot('00a-tour-intro');
    let guard = 0;
    const tourShots = { 1: '00b-tour-add', 4: '00c-tour-click-filters', 5: '00d-tour-filters', 8: '00e-tour-attrs', 9: '00f-tour-close' };
    while ((await js(`Tour.isActive()`)) && guard++ < 30) {
      const info = await js(`Tour.info()`);
      if (!info || info.waiting) {
        await sleep(150);
        continue;
      }
      await sleep(450);
      if (tourShots[info.idx]) await shot(tourShots[info.idx]);
      if (info.click) await js(`Tour.target().click(); 1`);
      else await js(`document.querySelector('.tour-next').click(); 1`);
      await sleep(250);
    }
    await sleep(500);
    ok(!(await js(`Tour.isActive()`)), 'обучение проходится до конца (' + guard + ' шагов)');
    ok(await js(`S.settings.tutorialDone === true && !document.querySelector('.modal') && document.getElementById('filterPanel').hidden`), 'после обучения всё закрыто, отметка сохранена');

    // ---- Помещается ли стартовый экран
    await shot('01-empty-1280x650');
    const fits = async () =>
      js(`(() => { const a=document.getElementById('app'); const f=document.querySelector('.welcome .muted.small').getBoundingClientRect(); return a.scrollHeight <= a.clientHeight + 1 && f.bottom <= innerHeight; })()`);
    ok(await fits(), 'стартовый экран помещается целиком в 1280×650');
    win.setContentSize(1536, 780);
    await sleep(400);
    await shot('01-empty-1536x780');
    ok(await fits(), 'стартовый экран помещается целиком в 1536×780');
    win.setContentSize(1280, 600);
    await sleep(400);
    ok(await fits(), 'стартовый экран помещается даже в 1280×600');
    ok(await js(`!!document.querySelector('.welcome')`), 'пустая библиотека показывает приветствие');
    ok(await js(`S.settings.autoBackup === false`), 'автокопии по умолчанию выключены');
    win.setSize(1400, 900);

    // ---- Добавление: 4 нормальных + битый + неподдерживаемый
    const files = ['Кукушка (минус).wav', 'Shallow_instrumental.wav', 'Колыбельная.wav', 'Song.wav', 'broken.mp3', 'notes.txt'].map((f) => path.join(MEDIA, f));
    await js(`Tracks.addFromPaths(${JSON.stringify(files)}); 0`);
    await waitFor(`document.querySelector('.confirm-list')`, 20000);
    await shot('02-import-errors');
    ok((await js(`document.querySelectorAll('.confirm-list li').length`)) === 2, 'битый и неподдерживаемый файлы отклонены');
    await click('.modal-actions .btn', 'Понятно');
    await waitFor(`document.querySelector('.track-form')`);
    await shot('03-form');

    // пытаемся сохранить без обязательных полей
    await click('.modal-actions .btn', 'Сохранить трек');
    await sleep(300);
    const bad = await js(`document.querySelectorAll('.form-field.bad').length`);
    ok(bad === 3, 'нельзя сохранить без обязательных полей (подсвечено ' + bad + ')');
    await shot('04-form-required');

    const fill = async (mood, lang, knowledge, stage, notes) => {
      await js(`(() => {
        const f = (attr) => document.querySelector('.form-field[data-attr="'+attr+'"]');
        [...f('mood').querySelectorAll('.opt')].find(b=>b.textContent.includes(${JSON.stringify(mood)})).click();
        [...f('language').querySelectorAll('.opt')].find(b=>b.textContent.includes(${JSON.stringify(lang)})).click();
        [...f('knowledge').querySelectorAll('.scale-cell')][${knowledge - 1}].click();
        const ta = f('learning_stage').querySelector('textarea'); ta.value = ${JSON.stringify(stage)};
        const n = document.querySelectorAll('.track-form > textarea'); n[n.length-1].value = ${JSON.stringify(notes)};
        return 1; })()`);
    };
    await fill('Грустная', 'Русский', 7, 'Первый куплет выучен, припев пока нестабильный', 'Работаю над вторым куплетом, необходимо ещё раз разобрать переход ко второму куплету и бридж. Дыхание!');
    await js(`document.querySelector('.cat-chip').click(); 1`);
    await click('.modal-actions .btn', 'Сохранить трек');
    await waitFor(`document.querySelectorAll('.track-form').length === 1 && document.querySelector('.modal-title').textContent.includes('2 из 4')`);

    // второй — «заполнить позже»
    await click('.modal-actions .btn', 'Заполнить позже');
    await waitFor(`document.querySelector('.modal-title') && document.querySelector('.modal-title').textContent.includes('3 из 4')`);
    await fill('Весёлая', 'Английский', 3, '', 'Только начала разбирать');
    await click('.modal-actions .btn', 'Сохранить трек');
    await waitFor(`document.querySelector('.modal-title') && document.querySelector('.modal-title').textContent.includes('4 из 4')`);
    // четвёртый — отменить загрузку
    await click('.modal-actions .btn', 'Отменить загрузку');
    await waitFor(`document.querySelectorAll('.modal').length === 2`);
    await click('.modal.small .modal-actions .btn', 'Удалить загрузку');
    await waitFor(`!document.querySelector('.modal')`);
    await sleep(500);

    let lib = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'library.json'), 'utf8'));
    ok(lib.tracks.length === 3, 'в library.json 3 трека (1 черновик), отменённый удалён: ' + lib.tracks.length);
    ok(lib.tracks.filter((t) => t.status === 'draft').length === 1, 'черновик сохранён');
    const filesOnDisk = fs.readdirSync(getLib().tracksDir);
    ok(filesOnDisk.length === 3, 'на диске 3 файла (без мусора): ' + filesOnDisk.join(','));
    ok(!fs.readdirSync(getLib().dataDir).some((f) => f.endsWith('.tmp')), 'нет временных файлов');
    await shot('05-grid-with-draft');

    // ---- Воспроизведение
    const firstId = await js(`document.querySelector('.card').dataset.id`);
    await js(`document.querySelector('.card .card-play').click(); 1`);
    await sleep(1500);
    ok(await js(`Player.isPlaying(${JSON.stringify(firstId)})`), 'трек играет из карточки');
    const t1 = await js(`document.querySelector('.pl-time').textContent`);
    await shot('06-playing');
    // второй трек — первый должен остановиться (один медиа-элемент)
    const secondId = await js(`document.querySelectorAll('.card')[1].dataset.id`);
    await js(`document.querySelectorAll('.card .card-play')[1].click(); 1`);
    await sleep(800);
    ok((await js(`Player.isPlaying(${JSON.stringify(secondId)}) && !Player.isPlaying(${JSON.stringify(firstId)})`)), 'одновременно играет только один трек');
    // перемотка
    await js(`document.querySelector('.player video, video') ; 1`);
    await js(`(() => { const v = document.querySelector('video.media-el'); v.currentTime = 10; return 1; })()`);
    await sleep(600);
    const ct = await js(`document.querySelector('video.media-el').currentTime`);
    ok(ct >= 9.5, 'перемотка работает (currentTime=' + ct.toFixed(1) + ', time label ' + t1 + ')');

    // ---- Страница трека
    await js(`App.openDetail(${JSON.stringify(firstId)}); 1`);
    await sleep(400);
    await shot('07-detail');
    // быстрая оценка на странице
    await js(`document.querySelectorAll('.scale-display.interactive .scale-dot')[8].click(); 1`);
    await sleep(400);
    lib = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'library.json'), 'utf8'));
    ok(lib.tracks.find((t) => t.id === firstId).attributes.knowledge === 9, 'оценка меняется прямо на странице трека');
    await js(`App.closeDetail(); 1`);

    // ---- Новый атрибут
    await js(`AttributesManager.open(); 1`);
    await sleep(300);
    await shot('08-attributes');
    await click('.modal-actions .btn', 'Новый атрибут');
    await sleep(300);
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); m.querySelector('input.input').value='Тональность'; [...m.querySelectorAll('.type-tile')].find(b=>b.dataset.type==='multiselect').click(); return 1; })()`);
    await sleep(100);
    for (const v of ['До мажор', 'Ля минор', 'Ми минор']) {
      await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); const i=m.querySelector('.opt-add input'); i.value=${JSON.stringify(v)}; m.querySelector('.opt-add button').click(); return 1; })()`);
    }
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); m.querySelectorAll('.toggle input')[1].click(); return 1; })()`);
    await shot('09-attr-editor');
    await click('.modal-actions .btn', 'Сохранить');
    await sleep(400);
    const attrs = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'attributes.json'), 'utf8'));
    ok(attrs.attributes.some((a) => a.name === 'Тональность' && a.options.length === 3), 'новый атрибут сохранён в attributes.json');
    await js(`document.querySelectorAll('.modal').forEach(()=>{}); [...document.querySelectorAll('.modal-x')].pop().click(); 1`);
    await sleep(300);
    // атрибут появился у старого трека
    await js(`App.openDetail(${JSON.stringify(firstId)}); 1`);
    await sleep(300);
    ok(await js(`[...document.querySelectorAll('.d-attr-name')].some(e=>e.textContent.includes('Тональность'))`), 'новый атрибут виден на странице старого трека');
    await js(`App.closeDetail(); 1`);

    // ---- Категории и фильтры
    await js(`Categories.open(); 1`);
    await sleep(300);
    await shot('10-categories');
    await js(`[...document.querySelectorAll('.modal-x')].pop().click(); 1`);
    await js(`document.querySelector('.filter-btn').click(); 1`);
    await sleep(300);
    await js(`[...document.querySelectorAll('.fp-opt')].find(b=>b.textContent==='Грустная').click(); 1`);
    await sleep(300);
    await shot('11-filters');
    ok((await js(`document.querySelectorAll('.card').length`)) === 1, 'фильтр по характеру оставляет 1 трек');
    await js(`Filters.reset(); 1`);
    await js(`(() => { const i=document.querySelector('.search-input'); i.value='колыб'; i.dispatchEvent(new Event('input')); return 1; })()`);
    await sleep(400);
    ok((await js(`document.querySelectorAll('.card').length`)) === 1, 'поиск по названию находит «Колыбельную»');
    await js(`(() => { const i=document.querySelector('.search-input'); i.value='бридж'; i.dispatchEvent(new Event('input')); return 1; })()`);
    await sleep(400);
    ok((await js(`document.querySelectorAll('.card').length`)) === 1, 'поиск по тексту комментария находит трек');
    await js(`Filters.reset(); document.querySelector('.filter-btn').click(); 1`);

    // ---- Стилизованная выпадашка сортировки
    await js(`document.querySelector('.sort-dd').click(); 1`);
    await sleep(350);
    await shot('11b-sort-dropdown');
    ok(!(await js(`!!document.querySelector('select')`)), 'на экране нет системных <select>');
    await js(`[...document.querySelectorAll('.dd-item')].find(b=>b.textContent.includes('Название')).click(); 1`);
    await sleep(300);
    ok(await js(`S.settings.sort.key === 'title' && document.querySelector('.sort-dd .dd-label').textContent === 'Название'`), 'сортировка выбирается из стилизованного списка');
    const titles = await js(`[...document.querySelectorAll('.card-title')].map(e=>e.textContent)`);
    ok(JSON.stringify(titles) === JSON.stringify([...titles].sort((a, b) => b.localeCompare(a, 'ru'))), 'порядок по названию применился: ' + titles.join(', '));

    // ---- Резервная копия, удаление, корзина
    ok(fs.readdirSync(getLib().backupsDir).filter((b) => /_auto$/.test(b) && !b.includes('before')).length === 0, 'без включения автокопии не создаются');
    await js(`Backup.open(); 1`);
    await click('.btn', 'Создать копию сейчас');
    await sleep(1200);
    const backups = fs.readdirSync(getLib().backupsDir);
    ok(backups.some((b) => !b.endsWith('_auto') && !b.endsWith('.part')), 'ручная резервная копия создана: ' + backups.join(','));
    ok(await js(`[...document.querySelectorAll('.segmented button')].every(b=>b.disabled)`), 'выбор частоты неактивен, пока автокопии выключены');
    await js(`document.querySelector('.auto-box .toggle input').click(); 1`);
    await sleep(1200);
    await js(`[...document.querySelectorAll('.segmented button')].find(b=>b.textContent==='Раз в месяц').click(); 1`);
    await sleep(500);
    await shot('12-backups');
    const st = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'settings.json'), 'utf8'));
    ok(st.autoBackup === true && st.backupEvery === 'month', 'включение и частота автокопий сохранены');
    ok(!!st.lastAutoBackup, 'при включении сразу сделана первая автокопия');
    await js(`[...document.querySelectorAll('.modal-x')].pop().click(); 1`);
    await sleep(300);

    await js(`Player.stop(); Tracks.remove(${JSON.stringify(firstId)}); 1`);
    await sleep(300);
    await click('.modal-actions .btn', 'Удалить');
    await sleep(700);
    lib = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'library.json'), 'utf8'));
    ok(!lib.tracks.some((t) => t.id === firstId) && lib.trash.length === 1, 'трек перемещён в корзину');
    ok(fs.readdirSync(getLib().trashDir).length === 1, 'файл трека перемещён в storage/trash');
    await shot('13-deleted-toast');
    await js(`Tracks.restore(${JSON.stringify(firstId)}); 1`);
    await sleep(500);
    lib = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'library.json'), 'utf8'));
    ok(lib.tracks.some((t) => t.id === firstId) && lib.trash.length === 0, 'трек возвращён из корзины');

    // ---- Видео: сгенерируем webm прямо в браузере
    const b64 = await js(`(async () => {
      const c = document.createElement('canvas'); c.width=320; c.height=180; const g=c.getContext('2d');
      const ac = new AudioContext(); const o = ac.createOscillator(); const d = ac.createMediaStreamDestination(); o.connect(d); o.start();
      const stream = new MediaStream([...c.captureStream(25).getVideoTracks(), ...d.stream.getAudioTracks()]);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm' }); const chunks=[]; rec.ondataavailable=e=>chunks.push(e.data);
      let f=0; const iv=setInterval(()=>{ g.fillStyle='hsl('+(f*7%360)+',70%,55%)'; g.fillRect(0,0,320,180); g.fillStyle='#fff'; g.font='40px sans-serif'; g.fillText('Видео '+f,60,100); f++; },40);
      rec.start(); await new Promise(r=>setTimeout(r,2500)); rec.stop(); await new Promise(r=>rec.onstop=r); clearInterval(iv); o.stop(); ac.close();
      const buf = await new Blob(chunks).arrayBuffer(); let s=''; const u=new Uint8Array(buf); for (let i=0;i<u.length;i++) s+=String.fromCharCode(u[i]); return btoa(s);
    })()`);
    const vid = path.join(MEDIA, 'Клип с видео.webm');
    fs.writeFileSync(vid, Buffer.from(b64, 'base64'));
    await js(`Tracks.addFromPaths([${JSON.stringify(vid)}]); 1`);
    await waitFor(`document.querySelector('.track-form')`, 15000);
    await fill('Нейтральная', 'Английский', 5, '', 'Клип для проверки видео');
    await click('.modal-actions .btn', 'Сохранить трек');
    await sleep(600);
    const vidId = await js(`Lib.tracks().find(t=>t.title.includes('Клип')).id`);
    ok(await js(`Lib.track(${JSON.stringify(vidId)}).hasVideo === true`), 'видео-дорожка распознана');
    await js(`App.openDetail(${JSON.stringify(vidId)}); Player.play(${JSON.stringify(vidId)}); 1`);
    await sleep(1200);
    ok(await js(`!!document.querySelector('.d-video video')`), 'видео показывается на странице трека');
    await shot('14-video-detail');
    await js(`App.closeDetail(); 1`);
    await sleep(500);
    ok(await js(`!document.getElementById('videoDock').hidden`), 'видео переезжает в плавающее окно при выходе со страницы');
    await shot('15-video-dock');
    await js(`Player.stop(); 1`);

    // ---- Сохранить ли черновик после перезапуска? Перезагрузим окно
    await js(`location.reload(); 1`).catch(() => {});
    await sleep(800);
    await waitFor(`document.body.classList.contains('ready')`);
    ok((await js(`Lib.tracks().length`)) === 4, 'данные на месте после перезагрузки');
    ok(await js(`!document.getElementById('drafts').hidden`), 'черновик ждёт заполнения после перезапуска');
    await shot('16-after-reload');

    // ---- Сироты: файл без карточки
    fs.copyFileSync(path.join(MEDIA, 'Song.wav'), path.join(getLib().tracksDir, 't_orphan123.wav'));
    fs.writeFileSync(path.join(getLib().tracksDir, 't_half.wav.part'), 'x');
    await js(`Backup.integrity(); 1`);
    await sleep(800);
    ok(await js(`document.querySelectorAll('.banner').length === 1`), 'проверка нашла файл без карточки');
    ok(!fs.existsSync(path.join(getLib().tracksDir, 't_half.wav.part')), 'недокопированный файл убран');
    await shot('17-orphan-banner');

    // ---- Повреждённый JSON → экран восстановления, без перезаписи
    const libFile = path.join(getLib().dataDir, 'library.json');
    fs.writeFileSync(libFile, '{"version":1,"tracks":[{"id":"x", BROKEN');
    await js(`location.reload(); 1`).catch(() => {});
    await sleep(1200);
    await waitFor(`document.querySelector('.recovery')`);
    await shot('18-recovery');
    ok(fs.readFileSync(libFile, 'utf8').includes('BROKEN'), 'повреждённый файл не перезаписан пустыми данными');
    await click('.rec-option', 'последнюю сохранённую');
    await sleep(1500);
    await waitFor(`document.body.classList.contains('ready')`);
    ok((await js(`Lib.tracks().length`)) === 4, 'восстановлено из последней сохранённой версии');
    await shot('19-restored');

    // ---- Узкое окно
    win.setSize(820, 900);
    await sleep(600);
    await shot('20-narrow');
    win.setSize(1400, 900);
  } catch (e) {
    ok(false, 'ИСКЛЮЧЕНИЕ: ' + (e && e.stack));
    await shot('99-error').catch(() => {});
  }
  fs.writeFileSync(path.join(SHOTS, 'result.txt'), log.join('\n'));
  setTimeout(() => app.exit(0), 300);
};
