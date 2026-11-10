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
    ok(wc.isAudioMuted(), 'автотест идёт без звука');

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
    await sleep(300);

    // ---- Настройки вместо «Хранилища», обучение убрано с главного экрана
    ok(await js(`!document.getElementById('btnHelp') && !document.getElementById('btnStorage') && document.getElementById('btnSettings').textContent.includes('Настройки')`), 'на главном экране кнопка «Настройки», кнопки «Обучение» нет');
    // ---- «+» после строки категорий открывает категории
    await js(`document.querySelector('.cat-add').click(); 1`);
    await sleep(400);
    ok(await js(`!!document.querySelector('.modal .cat-new input')`), 'кнопка «+» в строке категорий открывает создание категории');
    await js(`(() => { const i=document.querySelector('.modal .cat-new input'); i.value='Для экзамена'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'})); return 1; })()`);
    await sleep(400);
    await js(`[...document.querySelectorAll('.modal-x')].pop().click(); 1`);
    await sleep(300);
    ok(await js(`[...document.querySelectorAll('.cat-strip .cat-pill')].some(b=>b.textContent.includes('Для экзамена'))`), 'новая категория сразу появилась в строке');

    // ---- Много категорий: стрелки прокрутки, до последней можно добраться
    await js(`(async () => { for (const n of ['Джаз', 'Рок-н-ролл', 'Новогодние', 'Детские песни']) Lib.cats().push({ id: uid('cat_'), name: n, color: '#4a7bff' });
      await Store.save('categories'); App.refresh(); return 1; })()`);
    await sleep(400);
    ok(await js(`document.querySelector('.cat-scroll').classList.contains('can-right') && !document.querySelector('.cat-scroll').classList.contains('can-left')`), 'при 9 категориях появилась стрелка «дальше»');
    await shot('00h-cat-arrows');
    for (let i = 0; i < 6; i++) {
      await js(`document.querySelector('.cat-arrow.right').click(); 1`);
      await sleep(350);
    }
    ok(await js(`(() => { const s=document.querySelector('.cat-strip'); const last=[...s.querySelectorAll('.cat-pill')].pop(); const r=last.getBoundingClientRect(), sr=s.getBoundingClientRect(); return r.right <= sr.right + 1 && document.querySelector('.cat-scroll').classList.contains('can-left'); })()`), 'стрелками можно докрутить до последней категории');
    await js(`[...document.querySelectorAll('.cat-strip .cat-pill')].pop().click(); 1`);
    await sleep(300);
    ok(await js(`document.querySelector('.cat-strip').scrollLeft > 0 && [...document.querySelectorAll('.cat-strip .cat-pill')].pop().classList.contains('on')`), 'после выбора категории прокрутка строки не сбрасывается');
    await js(`Filters.reset(); 1`);

    // ---- Палитра цвета и перетаскивание в окне категорий
    await js(`Categories.open(); 1`);
    await sleep(400);
    await js(`document.querySelector('.modal .cat-row .color-btn').click(); 1`);
    await sleep(300);
    ok(await js(`document.querySelectorAll('.cp-pop .cp-preset').length >= 12 && !!document.querySelector('.cp-pop .cp-sv')`), 'палитра открывается: готовые цвета + свободный выбор');
    await js(`(() => { const r=document.querySelector('.cp-sv').getBoundingClientRect(); const o={bubbles:true,clientX:r.left+r.width*0.8,clientY:r.top+r.height*0.3,pointerId:1}; document.querySelector('.cp-sv').dispatchEvent(new PointerEvent('pointerdown',o)); document.querySelector('.cp-sv').dispatchEvent(new PointerEvent('pointerup',o)); return 1; })()`);
    await shot('00i-color-picker');
    await js(`(() => { const i=document.querySelector('.cp-hex'); i.value='#123abc'; i.dispatchEvent(new Event('input')); return 1; })()`);
    await sleep(600);
    let cats = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'categories.json'), 'utf8')).categories;
    ok(cats[0].color === '#123abc', 'свой цвет категории сохраняется: ' + cats[0].color);
    // палитра закрывается сама, если окно на миг потеряло фокус — тогда просто закрываем меню
    await js(`(() => { const b = document.querySelector('.cp-pop .btn'); if (b) b.click(); else UI.closeMenu(); return 1; })()`);
    await sleep(200);
    const order0 = cats.map((c) => c.name);
    // тянем первую категорию вниз на три строки
    await js(`(async () => {
      const rows=[...document.querySelectorAll('.modal .cat-row')]; const hd=rows[0].querySelector('.drag-handle').getBoundingClientRect();
      const target=rows[3].getBoundingClientRect(); const x=hd.left+hd.width/2; let y=hd.top+hd.height/2;
      rows[0].querySelector('.drag-handle').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,clientX:x,clientY:y,pointerId:1}));
      const endY = target.top + target.height*0.8;
      for (let k=1;k<=12;k++){ window.dispatchEvent(new PointerEvent('pointermove',{clientX:x,clientY:y+(endY-y)*k/12,pointerId:1})); await new Promise(r=>setTimeout(r,16)); }
      window.dispatchEvent(new PointerEvent('pointerup',{clientX:x,clientY:endY,pointerId:1})); return 1; })()`);
    await sleep(500);
    cats = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'categories.json'), 'utf8')).categories;
    ok(cats[3].name === order0[0] && cats[0].name === order0[1], 'перетаскивание меняет порядок категорий: ' + cats.slice(0, 4).map((c) => c.name).join(', '));
    // с клавиатуры: фокус на ручке и стрелка вверх
    await js(`(() => { const hd=document.querySelectorAll('.modal .cat-row .drag-handle')[3]; hd.focus(); hd.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})); return 1; })()`);
    await sleep(500);
    cats = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'categories.json'), 'utf8')).categories;
    ok(cats[2].name === order0[0], 'порядок меняется и с клавиатуры (стрелки)');
    await shot('00j-categories-dnd');
    await js(`[...document.querySelectorAll('.modal-x')].pop().click(); 1`);
    await sleep(300);
    ok(await js(`[...document.querySelectorAll('.cat-strip .cat-pill')].slice(1,4).map(b=>b.textContent).join('|').includes(${JSON.stringify(order0[0])})`), 'новый порядок сразу виден на главном экране');
    // ---- О приложении
    await js(`document.getElementById('btnSettings').click(); 1`);
    await sleep(400);
    await js(`[...document.querySelectorAll('.tab')].find(b=>b.textContent.includes('О приложении')).click(); 1`);
    await sleep(500);
    await shot('00g-settings-about');
    const ver = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version;
    ok(await js(`document.querySelector('.about-version').textContent === 'Версия ${ver}'`), 'в «О приложении» показана версия ' + ver);
    ok(await js(`document.querySelector('.about-news h4').textContent.includes('${ver}') && document.querySelector('.about-news p').textContent.length > 40`), 'есть «Что нового» для текущей версии');
    ok(await js(`[...document.querySelectorAll('.about-link')].map(b=>b.dataset.url).join(' ') === 'https://t.me/arsipa https://github.com/Arsipa/MyMusicLibrary'`), 'ссылки на Telegram и GitHub на месте');
    ok((await js(`window.api.openLink('https://t.me/arsipa').then(r=>r.ok)`)) && !(await js(`window.api.openLink('https://evil.example').then(r=>r.ok)`)), 'открываются только разрешённые ссылки');
    await js(`document.querySelector('.about-tour-btn').click(); 1`);
    await waitFor(`Tour.isActive() && !document.querySelector('.modal')`, 4000);
    ok(true, '«Пройти заново» закрывает настройки и запускает обучение');
    await js(`document.querySelector('.tour-skip').click(); 1`);
    await sleep(500);

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
        const n = document.querySelectorAll('.track-form > .field-wrap > textarea'); n[n.length-1].value = ${JSON.stringify(notes)};
        return 1; })()`);
    };
    await fill('Грустная', 'Русский', 7, 'Первый куплет выучен, припев пока нестабильный', 'Работаю над вторым куплетом, необходимо ещё раз разобрать переход ко второму куплету и бридж. Дыхание!');
    await js(`document.querySelector('.cat-chip').click(); 1`);

    // «Послушать» превращается в «Пауза» и обратно
    await js(`document.querySelector('.listen-btn').click(); 1`);
    await sleep(800);
    ok(await js(`document.querySelector('.listen-btn').textContent.trim() === 'Пауза' && document.querySelector('.listen-btn').classList.contains('on')`), 'в форме «Послушать» меняется на «Пауза»');
    await js(`document.querySelector('.listen-btn').click(); 1`);
    await sleep(400);
    ok(await js(`document.querySelector('.listen-btn').textContent.trim() === 'Послушать'`), '…и обратно на «Послушать» после паузы');
    await js(`Player.stop(); 1`);

    // ограничения длины
    ok(await js(`document.querySelector('.input-title').maxLength === LIMITS.trackTitle && LIMITS.trackTitle === 120`), 'название ограничено 120 символами');
    ok(await js(`[...document.querySelectorAll('.track-form .char-count')].some(c => c.textContent.endsWith('/ 1500'))`), 'у комментария есть счётчик «… / 1500»');
    await js(`(() => { const i=document.querySelector('.input-title'); i.value='Кукушка'.padEnd(118,'!'); i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
    ok(await js(`(() => { const c=document.querySelector('.input-title').parentNode.querySelector('.char-count'); return !c.hidden && c.classList.contains('near'); })()`), 'у длинного названия появляется предупреждающий счётчик');
    await js(`(() => { const i=document.querySelector('.input-title'); i.value='  Кукушка  '; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);

    // ссылка на клип: сначала неправильная, потом без https://
    const setClip = (v) => js(`(() => { const i=document.querySelector('.track-form input[type=url]'); i.value=${JSON.stringify(v)}; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
    await setClip('просто какой-то текст');
    await click('.modal-actions .btn', 'Сохранить трек');
    await sleep(400);
    ok(await js(`document.querySelector('.track-form input[type=url]').classList.contains('bad') && !!document.querySelector('.track-form').textContent.includes('не похоже на ссылку')`), 'неправильная ссылка на клип не сохраняется, есть понятная ошибка');
    await shot('04b-clip-error');
    await setClip('youtube.com/watch?v=dQw4w9WgXcQ');
    await click('.modal-actions .btn', 'Сохранить трек');
    await waitFor(`document.querySelectorAll('.track-form').length === 1 && document.querySelector('.modal-title').textContent.includes('2 из 4')`);
    const saved1 = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'library.json'), 'utf8')).tracks.find((t) => t.title === 'Кукушка');
    ok(saved1 && saved1.clipUrl === 'https://youtube.com/watch?v=dQw4w9WgXcQ', 'ссылка без https:// дополнена и сохранена: ' + (saved1 && saved1.clipUrl));
    ok(saved1 && saved1.title === 'Кукушка', 'лишние пробелы в названии убраны');

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
    const kukId = await js(`Lib.tracks().find(t => t.title === 'Кукушка').id`);
    ok(await js(`!!document.querySelector('.card[data-id="${kukId}"] .card-clip')`), 'на карточке песни с клипом есть кнопка-ссылка');
    await js(`App.openDetail(${JSON.stringify(kukId)}); 1`);
    await sleep(400);
    await shot('07b-detail-clip');
    ok(await js(`!!document.querySelector('.d-clip') && document.querySelector('.d-clip').textContent.includes('youtube.com')`), 'на странице песни есть кнопка «Смотреть клип · youtube.com»');
    ok(await js(`window.api.openUrl(Lib.track(${JSON.stringify(kukId)}).clipUrl).then(r => r.ok)`), 'ссылка на клип открывается (в тесте — без браузера)');
    await js(`document.querySelector('.d-clip').click(); 1`);
    await sleep(300);
    ok(!(await js(`[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Не получилось открыть'))`)), 'нажатие на «Смотреть клип» проходит без ошибок');
    await js(`App.openDetail(${JSON.stringify(firstId)}); 1`);
    await sleep(400);
    ok(!(await js(`window.api.openUrl('javascript:alert(1)').then(r => r.ok)`)), 'опасные ссылки (javascript:) не открываются');
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
    // цвет варианта из готовых и перенос «Ми минор» наверх с клавиатуры
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); m.querySelector('.opt-edit-row .color-btn').click(); return 1; })()`);
    await sleep(300);
    await js(`document.querySelector('.cp-preset[data-c="#ff6b9a"]').click(); 1`);
    await sleep(200);
    for (let k = 0; k < 2; k++) {
      await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); const hs=m.querySelectorAll('.opt-edit-row:not(.opt-add) .drag-handle'); const hd=[...hs].find(x=>x.closest('.opt-edit-row').querySelector('input').value==='Ми минор'); hd.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})); return 1; })()`);
      await sleep(200);
    }
    await shot('09-attr-editor');
    await click('.modal-actions .btn', 'Сохранить');
    await sleep(400);
    const attrs = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'attributes.json'), 'utf8'));
    ok(attrs.attributes.some((a) => a.name === 'Тональность' && a.options.length === 3), 'новый атрибут сохранён в attributes.json');
    const ton = attrs.attributes.find((a) => a.name === 'Тональность');
    ok(ton.options[0].label === 'Ми минор' && ton.options.find((o) => o.label === 'До мажор').color === '#ff6b9a' && ton.options.every((o) => /^#[0-9a-f]{6}$/.test(o.color)), 'у вариантов сохраняются свой цвет и порядок: ' + ton.options.map((o) => o.label + ' ' + o.color).join(', '));
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

    // ---- Крестик у уведомлений
    await js(`UI.toast('Проверка крестика', { duration: 60000 }); 1`);
    await sleep(300);
    ok(await js(`!!document.querySelector('.toast .toast-x')`), 'у уведомления есть крестик');
    await js(`[...document.querySelectorAll('.toast')].pop().querySelector('.toast-x').click(); 1`);
    await sleep(400);
    ok(!(await js(`[...document.querySelectorAll('.toast')].some(t => t.textContent.includes('Проверка крестика'))`)), 'крестик сразу закрывает уведомление');

    // ---- Дубликат: спрашиваем до копирования и до формы
    const tracksBefore = fs.readdirSync(getLib().tracksDir).length;
    await js(`Tracks.addFromPaths([${JSON.stringify(path.join(MEDIA, 'Колыбельная.wav'))}]); 1`);
    await waitFor(`document.querySelector('.modal.choose .dup-list')`);
    ok(!(await js(`!!document.querySelector('.track-form')`)), 'при дубликате сначала окно «уже есть», форма не открывается');
    await shot('20b-duplicate');
    ok(await js(`(() => { const b=[...document.querySelectorAll('.modal.choose .modal-actions .btn')]; return b.length === 2 && b.every(x => Math.abs(x.offsetWidth - b[0].offsetWidth) < 2); })()`), 'кнопки окна выбора ровные, одной ширины');
    await click('.modal.choose .modal-actions .btn', 'Отменить, это дубликат');
    await sleep(600);
    ok(fs.readdirSync(getLib().tracksDir).length === tracksBefore && !(await js(`!!document.querySelector('.track-form')`)), 'отменённый дубликат не скопирован, форма не открывалась');
    await js(`Tracks.addFromPaths([${JSON.stringify(path.join(MEDIA, 'Колыбельная.wav'))}]); 1`);
    await waitFor(`document.querySelector('.modal.choose .dup-list')`);
    await click('.modal.choose .modal-actions .btn', 'Всё равно добавить');
    await waitFor(`document.querySelector('.track-form')`, 15000);
    ok(fs.readdirSync(getLib().tracksDir).length === tracksBefore + 1, '«Всё равно добавить» копирует файл и открывает форму');
    {
      await click('.modal-actions .btn', 'Заполнить позже');
      await sleep(500);
      const longDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mml-long-'));
      const longFile = path.join(longDir, 'Очень_длинное_имя_исполнителя_без_единого_пробела_которое_не_помещается_в_окно_никак_вообще - Колыбельная.wav');
      fs.copyFileSync(path.join(MEDIA, 'Колыбельная.wav'), longFile);
      await js(`Tracks.addFromPaths([${JSON.stringify(longFile)}]); 1`);
      await waitFor(`document.querySelector('.modal.choose .dup-list')`);
      await sleep(400);
      await shot('20c-duplicate-long');
      ok(await js(`(() => { const m=document.querySelector('.modal.choose'); const b=m.querySelector('.modal-body'); return b.scrollWidth <= b.clientWidth + 1 && m.scrollWidth <= m.clientWidth + 1; })()`), 'окно дубликата с длинным именем файла не прокручивается вбок');
      await click('.modal.choose .modal-actions .btn', 'Отменить, это дубликат');
      await sleep(500);
      fs.rmSync(longDir, { recursive: true, force: true });
      await js(`(() => { const d=Lib.tracks().filter(t=>t.status==='draft').pop(); return d ? Tracks.openForm(d.id, { mode: 'new' }) && 1 : 1; })()`);
      await waitFor(`document.querySelector('.track-form')`, 8000);
    }

    // ---- Окно «Трек ещё не сохранён»: кнопки столбиком
    await js(`document.querySelector('.form-modal .modal-x').click(); 1`);
    await waitFor(`document.querySelector('.modal.choose')`);
    await shot('20c-cancel-choice');
    ok(await js(`(() => { const b=[...document.querySelectorAll('.modal.choose .modal-actions .btn')]; const w=b[0].offsetWidth; return b.length === 3 && b.every(x => Math.abs(x.offsetWidth - w) < 2) && b[0].textContent.includes('Вернуться'); })()`), 'окно отмены: три ровные кнопки, «Вернуться к форме» — первая');
    await click('.modal.choose .modal-actions .btn', 'Вернуться к форме');
    await sleep(300);

    // ---- Новый атрибут прямо из формы, введённое не теряется
    await js(`(() => { const i=document.querySelector('.input-title'); i.value='Колыбельная (живая версия)'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
    await js(`document.querySelector('.add-attr-btn').click(); 1`);
    await sleep(400);
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); m.querySelector('input.input').value='Темп'; [...m.querySelectorAll('.type-tile')].find(b=>b.dataset.type==='number').click(); return 1; })()`);
    await sleep(200);
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); [...m.querySelectorAll('.modal-actions .btn')].find(b=>b.textContent.includes('Сохранить')).click(); return 1; })()`);
    await sleep(700);
    const tempoId = await js(`(Lib.attrs().find(a => a.name === 'Темп') || {}).id`);
    ok(!!tempoId && (await js(`!!document.querySelector('.track-form .form-field[data-attr="${tempoId}"]')`)), 'атрибут, созданный из формы, сразу появился в ней');
    ok(await js(`document.querySelector('.input-title').value === 'Колыбельная (живая версия)'`), 'введённое в форме не потерялось');
    await shot('20d-attr-from-form');

    // ---- Многострочный атрибут без лимита в 1500
    ok(await js(`document.querySelector('.form-field[data-attr="learning_stage"] textarea').maxLength >= 50000`), 'у многострочного атрибута нет ограничения в 1500 символов');
    await js(`(() => { const f=(a)=>document.querySelector('.form-field[data-attr="'+a+'"]');
      [...f('mood').querySelectorAll('.opt')][0].click(); [...f('language').querySelectorAll('.opt')][0].click(); [...f('knowledge').querySelectorAll('.scale-cell')][4].click();
      f('${tempoId}').querySelector('input').value='96';
      const ta=f('learning_stage').querySelector('textarea'); ta.value='Куплет: ля-ля-ля, длинный текст песни. '.repeat(100); ta.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
    await click('.modal-actions .btn', 'Сохранить трек');
    await sleep(600);
    let saved = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'library.json'), 'utf8')).tracks.find((t) => t.title === 'Колыбельная (живая версия)');
    ok(saved && saved.attributes.learning_stage.length > 3000 && saved.attributes[tempoId] === 96, 'длинный текст (>3000 символов) и новый атрибут сохранены: ' + (saved && saved.attributes.learning_stage.length));

    // ---- Исполнитель отдельно: «Исполнитель - Название.wav» разбирается сам
    const artistFile = path.join(MEDIA, 'Мария Иванова - Осенний вальс.wav');
    fs.copyFileSync(path.join(MEDIA, 'Song.wav'), artistFile);
    await js(`Tracks.addFromPaths([${JSON.stringify(artistFile)}]); 1`);
    await waitFor(`document.querySelector('.track-form')`, 15000);
    ok(await js(`document.querySelector('.input-title').value === 'Осенний вальс' && document.querySelector('.input-artist').value === 'Мария Иванова'`), 'из имени файла исполнитель и название разложены по своим полям');
    await shot('20e-artist-form');
    await js(`(() => { const f=(a)=>document.querySelector('.form-field[data-attr="'+a+'"]');
      [...f('mood').querySelectorAll('.opt')][1].click(); [...f('language').querySelectorAll('.opt')][0].click(); [...f('knowledge').querySelectorAll('.scale-cell')][2].click(); return 1; })()`);
    await click('.modal-actions .btn', 'Сохранить трек');
    await sleep(600);
    saved = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'library.json'), 'utf8')).tracks.find((t) => t.title === 'Осенний вальс');
    ok(saved && saved.artist === 'Мария Иванова', 'исполнитель сохранён отдельным полем');
    const waltzId = saved.id;
    ok(await js(`document.querySelector('.card[data-id="${waltzId}"] .card-artist').textContent === 'Мария Иванова'`), 'исполнитель показан на карточке');
    await js(`(() => { const i=document.querySelector('.search-input'); i.value='иванова'; i.dispatchEvent(new Event('input')); return 1; })()`);
    await sleep(400);
    ok((await js(`[...document.querySelectorAll('.card')].map(c=>c.dataset.id).join()`)) === waltzId, 'поиск находит песню по исполнителю');
    await js(`Filters.reset(); App.openDetail(${JSON.stringify(waltzId)}); 1`);
    await sleep(400);
    ok(await js(`document.querySelector('.d-artist').textContent === 'Мария Иванова'`), 'исполнитель показан на странице песни');
    await js(`App.closeDetail(); 1`);
    ok(await js(`Filters.sort(Lib.tracks()).length > 0 && (() => { S.settings.sort.key='artist'; S.settings.sort.dir='asc'; const r=Filters.sort(Lib.tracks().filter(t=>t.status!=='draft')); S.settings.sort.key='createdAt'; S.settings.sort.dir='desc'; return r[0].artist === 'Мария Иванова'; })()`), 'сортировка по исполнителю работает');
    fs.rmSync(artistFile, { force: true });

    // ---- История изменений песни
    await js(`App.openDetail(${JSON.stringify(waltzId)}); 1`);
    await sleep(400);
    ok(await js(`!!document.querySelector('.d-history') && document.querySelector('.d-history').textContent.includes('Песня добавлена в библиотеку')`), 'на странице песни есть история с записью «добавлена»');
    await js(`document.querySelectorAll('.scale-display.interactive .scale-dot')[7].click(); 1`);
    await sleep(600);
    ok(await js(`(() => { const it=document.querySelector('.d-history .hist-item'); return it && it.textContent.includes('Знание песни') && it.textContent.includes('3 из 10') && it.textContent.includes('8 из 10'); })()`), 'изменение «Знание песни: 3 → 8» записано в историю');
    let wl = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'library.json'), 'utf8')).tracks.find((t) => t.id === waltzId);
    ok(wl.history.length >= 2 && wl.history.some((e) => e.kind === 'added'), 'история сохраняется в library.json');

    // ---- Праздник при максимуме и корона
    ok(await js(`Lib.attr('knowledge').celebrate === true`), 'у «Знание песни» по умолчанию включено празднование');
    await js(`document.querySelectorAll('.scale-display.interactive .scale-dot')[9].click(); 1`);
    await waitFor(`document.querySelector('.modal.celebrate')`, 4000);
    ok(await js(`!!document.querySelector('canvas.fireworks') && document.querySelector('.modal.celebrate').textContent.includes('10 из 10')`), 'на максимуме — салют и поздравление');
    await sleep(700);
    await shot('21-celebrate');
    await click('.modal.celebrate .modal-actions .btn', 'Ура');
    await sleep(600);
    ok(await js(`!!document.querySelector('.d-attr .scale-wrap .crown') && !document.querySelector('canvas.fireworks')`), 'у прокачанного значения появилась корона, салют убран');
    await js(`document.querySelectorAll('.scale-display.interactive .scale-dot')[9].click(); 1`); // снять 10 (повторный клик очищает)
    await sleep(400);
    await js(`document.querySelectorAll('.scale-display.interactive .scale-dot')[9].click(); 1`);
    await sleep(500);
    ok(await js(`!!document.querySelector('.modal.celebrate')`), 'праздник срабатывает каждый раз, когда значение снова доходит до максимума');
    await click('.modal.celebrate .modal-actions .btn', 'Ура');
    await sleep(400);
    await js(`App.closeDetail(); 1`);
    await sleep(300);
    ok(await js(`!!document.querySelector('.card[data-id="${waltzId}"] .meter-val .crown')`), 'корона видна и на карточке');
    // флажок празднования в конструкторе — только у шкалы
    await js(`AttributesManager.create(); 1`);
    await sleep(400);
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); m.querySelector('input.input').value='Качество выступления'; [...m.querySelectorAll('.type-tile')].find(b=>b.dataset.type==='scale').click(); return 1; })()`);
    await sleep(200);
    ok(await js(`!![...document.querySelectorAll('.modal')].pop().querySelector('.celebrate-opt')`), 'у шкалы есть флажок «праздновать максимум»');
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); m.querySelector('.celebrate-opt input').click(); return 1; })()`);
    await shot('22-celebrate-toggle');
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); [...m.querySelectorAll('.type-tile')].find(b=>b.dataset.type==='number').click(); return !m.querySelector('.celebrate-opt'); })()`).then((r) => ok(r, 'у других типов флажка нет'));
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); [...m.querySelectorAll('.type-tile')].find(b=>b.dataset.type==='scale').click(); m.querySelector('.celebrate-opt input').click(); [...m.querySelectorAll('.modal-actions .btn')].find(b=>b.textContent.includes('Сохранить')).click(); return 1; })()`);
    await sleep(600);
    const perfAttr = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'attributes.json'), 'utf8')).attributes.find((a) => a.name === 'Качество выступления');
    ok(perfAttr && perfAttr.celebrate === true, 'флажок празднования сохранён у атрибута');

    // ---- Видео выступлений
    const perfVideo = path.join(MEDIA, 'Клип с видео.webm');
    await js(`App.openDetail(${JSON.stringify(waltzId)}); Performances.add(${JSON.stringify(waltzId)}, [${JSON.stringify(perfVideo)}]); 1`);
    await waitFor(`document.querySelector('.d-perf .perf-tile')`, 20000);
    await sleep(800);
    ok(fs.readdirSync(path.join(getLib().root, 'storage', 'performances')).length === 1, 'видео скопировано в storage/performances');
    ok(await js(`document.querySelector('.d-history .hist-item').textContent.includes('Добавлена запись')`), 'добавление видео записано в историю');
    ok(await js(`!!document.querySelector('.card[data-id="${waltzId}"] .art-badge.perf')`), 'на карточке значок «есть видео выступления»');
    await js(`document.querySelector('.d-perf').scrollIntoView(); 1`);
    await shot('23-performances');
    await js(`Player.play(${JSON.stringify(waltzId)}); 1`);
    await sleep(600);
    await js(`document.querySelector('.perf-shot').click(); 1`);
    await waitFor(`document.querySelector('.perf-modal video.perf-player')`);
    await sleep(1200);
    ok(await js(`!document.querySelector('.perf-modal video').paused && !Player.isPlaying(${JSON.stringify(waltzId)})`), 'видео выступления играет, музыка в общем плеере на паузе');
    await shot('24-perf-player');
    await js(`document.querySelector('.perf-modal .modal-x').click(); 1`);
    await sleep(400);
    // удалить песню → видео в корзину, вернуть → видео на месте
    await js(`Tracks.remove(${JSON.stringify(waltzId)}); 1`);
    await sleep(300);
    await click('.modal-actions .btn', 'Удалить');
    await sleep(800);
    ok(fs.readdirSync(path.join(getLib().root, 'storage', 'performances')).length === 0 && fs.readdirSync(getLib().trashDir).some((f) => f.startsWith('p_')), 'при удалении песни её видео уходят в корзину');
    await js(`Tracks.restore(${JSON.stringify(waltzId)}); 1`);
    await sleep(800);
    ok(fs.readdirSync(path.join(getLib().root, 'storage', 'performances')).length === 1, 'при возврате из корзины видео возвращаются');
    wl = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'library.json'), 'utf8')).tracks.find((t) => t.id === waltzId);
    ok(wl.history.some((e) => e.kind === 'restored'), 'возврат из корзины записан в историю');
    // удалить само видео
    await js(`App.openDetail(${JSON.stringify(waltzId)}); 1`);
    await sleep(400);
    await js(`Performances.remove(Lib.track(${JSON.stringify(waltzId)}), Lib.track(${JSON.stringify(waltzId)}).performances[0]); 1`);
    await sleep(300);
    await click('.modal-actions .btn', 'Удалить');
    await sleep(800);
    ok(fs.readdirSync(path.join(getLib().root, 'storage', 'performances')).length === 0 && (await js(`Lib.track(${JSON.stringify(waltzId)}).performances.length === 0`)), 'видео выступления удаляется');
    const bk = await js(`window.api.createBackup('manual').then(r => r.value)`);
    ok(fs.existsSync(path.join(getLib().backupsDir, bk, 'storage', 'performances')), 'папка с видео входит в резервную копию');
    await js(`App.closeDetail(); Player.stop(); 1`);

    // ---- 1.6.0: аудио-выступление, описание, лучшее выступление
    const wid = JSON.stringify(waltzId);
    const perfDir = path.join(getLib().root, 'storage', 'performances');
    await js(`App.openDetail(${wid}); Performances.add(${wid}, [${JSON.stringify(path.join(MEDIA, 'Song.wav'))}], { kind: 'audio' }); 1`);
    await waitFor(`document.querySelector('.d-perf .perf-tile .perf-shot.is-audio')`, 20000);
    await sleep(500);
    ok(await js(`Lib.track(${wid}).performances[0].hasVideo === false`), 'аудиозапись выступления добавлена (без видео)');
    await js(`document.querySelector('.d-perf .perf-shot').click(); 1`);
    await waitFor(`document.querySelector('.perf-modal audio.perf-audio-player')`);
    ok(true, 'аудиовыступление открывается в проигрывателе');
    await shot('25-perf-audio');
    ok(await js(`(() => { const box=document.querySelector('.perf-listen-art').getBoundingClientRect(), a=document.querySelector('.perf-listen-art .art').getBoundingClientRect(); return Math.abs(box.width-a.width)<2 && Math.abs(box.height-a.height)<2; })()`), 'при прослушивании обложка занимает весь круг');
    await js(`document.querySelector('.perf-modal .modal-x').click(); 1`);
    await sleep(400);
    await js(`document.querySelector('.d-perf .perf-desc-add').click(); 1`);
    await sleep(400);
    await js(`(() => { const m=[...document.querySelectorAll('.modal')].pop(); m.querySelector('textarea').value='Репетиция перед концертом'; [...m.querySelectorAll('.modal-actions .btn')].find(b=>b.textContent.includes('Сохранить')).click(); return 1; })()`);
    await sleep(600);
    ok(await js(`Lib.track(${wid}).performances[0].description === 'Репетиция перед концертом' && document.querySelector('.d-perf .perf-desc').textContent.includes('Репетиция')`), 'описание выступления сохраняется и видно в списке');
    // лучшее выступление: загрузка в отдельный блок → поздравление
    ok(await js(`!!document.querySelector('.d-best.is-empty .perf-add-video')`), 'есть пустой блок «Лучшее выступление» с загрузкой');
    ok(await js(`(() => { const p=document.querySelector('.d-best.is-empty').getBoundingClientRect(); const bs=[...document.querySelectorAll('.d-best.is-empty .best-actions .btn')]; const l=Math.min(...bs.map(b=>b.getBoundingClientRect().left)), r=Math.max(...bs.map(b=>b.getBoundingClientRect().right)); return Math.abs((l+r)/2 - (p.left+p.right)/2) < 6; })()`), 'кнопки финального выступления по центру');
    ok(await js(`[...document.querySelectorAll('.d-best.is-empty .best-actions .btn')].every(b => getComputedStyle(b).backgroundColor === 'rgb(36, 9, 63)')`), 'кнопки финального выступления тёмные — контрастные на золоте');
    await js(`Performances.add(${wid}, [${JSON.stringify(path.join(MEDIA, 'Колыбельная.wav'))}], { kind: 'audio', best: true }); 1`);
    await waitFor(`document.querySelector('.modal.repertoire')`, 20000);
    ok(await js(`!!document.querySelector('canvas.fireworks') && document.querySelector('.modal.repertoire').textContent.includes('репертуар')`), 'загрузка лучшего выступления — салют и поздравление «в репертуаре»');
    await sleep(700);
    await shot('26-repertoire');
    ok(await js(`(() => { const b=[...document.querySelectorAll('.modal.repertoire .modal-actions .btn')].find(x=>x.textContent.includes('Ура')); const i=b.querySelector('.ic').getBoundingClientRect(), r=b.getBoundingClientRect(); return i.width >= 24 && b.querySelector('.ic').innerHTML.includes('22.5') && Math.abs((i.top+i.bottom)/2 - (r.top+r.bottom)/2) <= 2; })()`), 'звёздочка на «Ура!» крупная и по центру');
    await click('.modal.repertoire .modal-actions .btn', 'Ура');
    await sleep(500);
    ok(await js(`!!document.querySelector('.d-best.has .best-ribbon') && document.querySelector('.d-best.has .best-ribbon').textContent === 'Эталонище' && document.querySelector('.d-best .d-h').textContent.includes('Финальное выступление') && document.querySelectorAll('.d-perf .perf-tile').length === 1`), 'лучшее выступление в своём блоке, а не в общем списке');
    ok(await js(`!!document.querySelector('.card[data-id="${waltzId}"] .art-badge.best')`), 'на карточке значок «в репертуаре»');
    ok(fs.readdirSync(perfDir).length === 2, 'файлы выступлений скопированы');
    wl = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'library.json'), 'utf8')).tracks.find((t) => t.id === waltzId);
    ok(wl.history.some((e) => e.kind === 'perf-best'), 'лучшее выступление записано в историю');
    ok(wl.history.some((e) => (e.changes || []).some((c) => c.key === 'attr:knowledge')), 'изменения шкал в истории помечены id атрибута (для статистики)');
    // раскладка: справа комментарий + выступления по высоте левого блока, история — внизу
    for (let i = 0; i < 6; i++) {
      await js(`Performances.add(${wid}, [${JSON.stringify(path.join(MEDIA, 'Song.wav'))}], { kind: 'audio' }); 1`);
      await sleep(900);
    }
    await waitFor(`document.querySelectorAll('.d-perf .perf-tile').length >= 7`, 20000);
    await sleep(500);
    ok(await js(`(() => { const l=document.querySelector('.d-chars').getBoundingClientRect(), r=document.querySelector('.d-side').getBoundingClientRect(); return Math.abs(l.height - r.height) < 2 && Math.abs(l.top - r.top) < 2; })()`), 'правая колонка по высоте равна левому блоку');
    ok(await js(`(() => { const p=document.querySelector('.perf-list'); return p.scrollHeight > p.clientHeight + 10 && getComputedStyle(p).overflowY === 'auto'; })()`), 'много выступлений — внутри прокрутка');
    ok(await js(`(() => { const h=document.querySelector('.d-history'), c=document.querySelector('.d-cols'); return !c.contains(h) && h.getBoundingClientRect().top >= c.getBoundingClientRect().bottom; })()`), 'история перенесена вниз');
    await js(`document.querySelector('.d-cols').scrollIntoView(); 1`);
    await shot('27-detail-layout');
    ok(await js(`(() => { const t=document.querySelector('.d-perf-head .d-h').getBoundingClientRect(), b=document.querySelector('.d-perf-head .perf-add-btns').getBoundingClientRect(); return document.querySelector('.d-perf-head .d-h').textContent.includes('Репетиции') && (t.right <= b.left + 1 || t.bottom <= b.top + 1); })()`), 'заголовок «Репетиции» не наезжает на кнопки');
    ok(await js(`(() => { const p=document.querySelector('.d-best').getBoundingClientRect(), t=document.querySelector('.d-best .best-tile').getBoundingClientRect(); return t.left - p.left >= 24; })()`), 'у финального выступления нормальный отступ слева');
    ok(await js(`(() => { const r=document.querySelector('.best-ribbon').getBoundingClientRect(), t=document.querySelector('.d-best .d-h'); const rg=document.createRange(); rg.selectNodeContents(t); const tr=rg.getBoundingClientRect(); return tr.right <= r.left + 4 || tr.top >= r.bottom; })()`), 'лента «Эталонище» не закрывает заголовок');
    // комментарий — своё маленькое окно, а не вся форма
    if (await js(`!!document.querySelector('.d-notes-add')`)) {
      ok(await js(`document.querySelector('.d-notes-add').textContent === 'Добавить комментарий'`), 'ссылка называется «Добавить комментарий»');
      await js(`document.querySelector('.d-notes-add').click(); 1`);
    } else await js(`document.querySelector('.d-notes-edit').click(); 1`);
    await sleep(400);
    ok(await js(`!!document.querySelector('.notes-modal textarea') && !document.querySelector('.track-form')`), 'комментарий редактируется в отдельном окне, без всей формы');
    await js(`(() => { const m=document.querySelector('.notes-modal'); m.querySelector('textarea').value='Дыхание во втором куплете'; [...m.querySelectorAll('.modal-actions .btn')].find(b=>b.textContent.includes('Сохранить')).click(); return 1; })()`);
    await sleep(600);
    ok(await js(`Lib.track(${wid}).notes === 'Дыхание во втором куплете' && document.querySelector('.d-note-text').textContent.includes('Дыхание')`), 'комментарий сохраняется');
    // копирование исполнителя и названия
    const { clipboard } = require('electron');
    await clipboard.writeText('');
    await js(`document.querySelector('.d-title .copy-btn').click(); 1`);
    await sleep(400);
    ok((await clipboard.readText()) === (await js(`Lib.track(${wid}).title`)), 'кнопка копирует название песни');
    if (await js(`!!document.querySelector('.d-artist .copy-btn')`)) {
      await js(`document.querySelector('.d-artist .copy-btn').click(); 1`);
      await sleep(400);
      ok((await clipboard.readText()) === (await js(`Lib.track(${wid}).artist`)), 'кнопка копирует исполнителя');
    }
    // знание песни
    const know = await js(`(() => { const t=Lib.track(${wid}); let s=0,m=0; for (const a of Lib.attrs()) if (a.type==='scale' && !Attr.isEmpty(a, t.attributes[a.id])) { s+=Number(t.attributes[a.id]); m+=a.max; } return m ? Math.max(1, Math.round(s/m*100)) : null; })()`);
    ok(know !== null && (await js(`document.querySelector('.know .know-val').textContent`)) === know + '%', 'блок «Знание песни» считает сумму шкал / сумму максимумов');
    ok(await js(`(() => { const vals={}; const sc=Lib.attrs().filter(a=>a.type==='scale'); sc.forEach(a=>vals[a.id]=a.max); const full=Knowledge.of({attributes:vals}).pct; sc.forEach(a=>vals[a.id]=Math.round(a.max*0.8)); const k=Knowledge.of({attributes:vals}); return full===100 && k.pct===Math.round(k.sum/k.max*100) && Knowledge.of({attributes:{}})===null; })()`), 'знание песни: все на максимуме = 100, пусто = нет оценки');
    ok(await js(`!document.querySelector('.know input, .know button')`), 'знание песни нельзя изменить вручную');
    ok(await js(`document.querySelector('.know-head b').textContent === 'Уровень' && !document.querySelector('.know .ic-lock, .know-lock') && !document.querySelector('.know').textContent.includes('считается')`), 'встроенная шкала называется «Уровень», без замочка и подписи «считается само»');
    // удаление лучшего выступления
    await js(`Performances.remove(Lib.track(${wid}), Performances.bestOf(Lib.track(${wid}))); 1`);
    await sleep(300);
    await click('.modal-actions .btn', 'Удалить');
    await sleep(700);
    ok(await js(`!Performances.bestOf(Lib.track(${wid})) && !!document.querySelector('.d-best.is-empty')`), 'лучшее выступление удаляется, блок снова пустой');
    // сделать лучшим из списка
    await js(`Performances.setBest(Lib.track(${wid}), Lib.track(${wid}).performances[0], true); 1`);
    await waitFor(`document.querySelector('.modal.repertoire')`);
    await click('.modal.repertoire .modal-actions .btn', 'Ура');
    await sleep(400);
    ok(await js(`Lib.track(${wid}).performances.filter(p=>p.best).length === 1`), 'выступление из списка можно сделать лучшим');

    // ---- Запись с голосом: ссылка и файл
    await js(`Tracks.openForm(${wid}); 1`);
    await sleep(500);
    await js(`document.querySelector('.vocal-mode button[data-mode="link"]').click(); 1`);
    await js(`(() => { const i=document.querySelector('.vocal-link input'); i.value='youtu.be/abc123'; i.dispatchEvent(new Event('input',{bubbles:true})); return 1; })()`);
    await js(`document.querySelector('.form-modal .vocal-field').scrollIntoView(); 1`);
    await shot('28-vocal-form');
    await click('.modal-actions .btn', 'Сохранить');
    await sleep(600);
    ok(await js(`!!Lib.track(${wid}).vocal && Lib.track(${wid}).vocal.url === 'https://youtu.be/abc123'`), 'запись с голосом — ссылкой');
    ok(await js(`!!document.querySelector('.d-links .d-vocal')`), 'на странице песни кнопка «Послушать с голосом»');
    const before = fs.readdirSync(perfDir).length;
    const vinfo = await js(`window.api.importPerformance(${JSON.stringify(path.join(MEDIA, 'Song.wav'))}).then(r => r.value)`);
    await js(`Tracks.openForm(${wid}); 1`);
    await sleep(500);
    await js(`document.querySelector('.vocal-field')._vocal._setFile({ fileName: ${JSON.stringify(vinfo.fileName)}, originalFileName: 'Song (с голосом).wav', size: ${vinfo.size}, duration: 8, hasVideo: false }); 1`);
    await click('.modal-actions .btn', 'Сохранить');
    await sleep(700);
    ok(await js(`Lib.track(${wid}).vocal.fileName === ${JSON.stringify(vinfo.fileName)} && !Lib.track(${wid}).vocal.url`), 'запись с голосом — файлом');
    ok(fs.readdirSync(perfDir).length === before + 1, 'файл записи с голосом хранится в библиотеке');
    await js(`document.querySelector('.d-vocal').click(); 1`);
    await waitFor(`document.querySelector('.perf-modal audio')`);
    ok(true, 'запись с голосом играет во встроенном плеере');
    await js(`document.querySelector('.perf-modal .modal-x').click(); 1`);
    await sleep(300);
    // убрать запись: файл удаляется после сохранения
    await js(`Tracks.openForm(${wid}); 1`);
    await sleep(500);
    await js(`document.querySelector('.vocal-mode button[data-mode="none"]').click(); 1`);
    await click('.modal-actions .btn', 'Сохранить');
    await sleep(800);
    ok(!fs.readdirSync(perfDir).includes(vinfo.fileName) && (await js(`!Lib.track(${wid}).vocal`)), 'убранная запись с голосом удаляется из хранилища');

    // ---- Переход в песню из нижнего плеера
    await js(`Player.play(${wid}); App.closeDetail(); 1`);
    await sleep(500);
    await js(`document.querySelector('.pl-title').click(); 1`);
    await sleep(400);
    ok(await js(`!document.getElementById('detail').hidden && document.querySelector('.d-title').textContent.includes(Lib.track(${wid}).title)`), 'нажатие на название в плеере открывает песню');
    await js(`App.closeDetail(); 1`);
    await sleep(300);
    await js(`document.querySelector('.pl-art').click(); 1`);
    await sleep(400);
    ok(await js(`!document.getElementById('detail').hidden`), 'нажатие на пластинку в плеере открывает песню');
    await js(`App.closeDetail(); Player.stop(); 1`);
    await sleep(300);

    // ---- Категории прямо с карточки
    if (await js(`Lib.cats().length > 0`)) {
      const catsBefore = await js(`Lib.track(${wid}).categories.length`);
      await js(`document.querySelector('.card[data-id="${waltzId}"] .card-cat-add').click(); 1`);
      await sleep(300);
      const free = await js(`document.querySelectorAll('.ctx-menu .ctx-item:not(:disabled) .ctx-dot').length`);
      if (free) await js(`document.querySelector('.ctx-menu .ctx-item:not(:disabled)').click(); 1`);
      else await js(`UI.closeMenu(); 1`);
      await sleep(600);
      const catsAdded = await js(`Lib.track(${wid}).categories.length`);
      ok(free === 0 || catsAdded === catsBefore + 1, 'плюсик на карточке добавляет категорию');
      await js(`document.querySelector('.card[data-id="${waltzId}"]').scrollIntoView({block:'center'}); 1`);
      await shot('29-card-cats');
      ok(await js(`(() => { const c=document.querySelector('.card[data-id="${waltzId}"]'); const a=c.querySelector('.card-cat-add').getBoundingClientRect(), p=c.querySelector('.card-play').getBoundingClientRect(); return a.bottom <= p.top || a.right <= p.left; })()`), 'плюсик категорий не наезжает на кнопку «играть»');
      ok(await js(`(() => { const c=document.querySelector('.card[data-id="${waltzId}"]'); const box=c.querySelector('.card-cats'); return box.lastElementChild.classList.contains('card-cat-add') && box.querySelectorAll('.card-cat:not(.more)').length <= 3; })()`), 'на карточке не больше 3 категорий, плюсик — под ними');
      ok(await js(`(() => { const c=document.querySelector('.card[data-id="${waltzId}"]'); const k=c.querySelector('.card-know'); return !!k && k.previousElementSibling.classList.contains('card-title') && k.textContent.includes('Уровень'); })()`), '«Уровень» на карточке сразу под названием');
      await js(`document.querySelector('.card[data-id="${waltzId}"] .card-cat-x').click(); 1`);
      await sleep(400);
      ok(await js(`!!document.querySelector('.modal') && document.querySelector('.modal').textContent.includes('Убрать категорию')`), 'удаление категории с карточки спрашивает подтверждение');
      ok(await js(`!document.querySelector('.modal .confirm-icon')`), 'в маленьких предупреждениях нет иконки');
      ok(await js(`(() => { const m=document.querySelector('.modal').getBoundingClientRect(), t=document.querySelector('.modal .modal-title'); const r=document.createRange(); r.selectNodeContents(t); const tr=r.getBoundingClientRect(); return Math.abs((tr.left+tr.right)/2 - (m.left+m.right)/2) < 12; })()`), 'заголовок окна стоит по центру');
      await click('.modal-actions .btn', 'Отмена');
      await sleep(400);
      ok((await js(`Lib.track(${wid}).categories.length`)) === catsAdded, 'отмена — категория осталась');
      await js(`document.querySelector('.card[data-id="${waltzId}"] .card-cat-x').click(); 1`);
      await sleep(400);
      await click('.modal-actions .btn', 'Убрать');
      await sleep(600);
      ok((await js(`Lib.track(${wid}).categories.length`)) === catsAdded - 1, 'категория убрана с карточки после подтверждения');
    } else ok(false, 'нет категорий для проверки быстрого добавления');

    // ---- Статистика
    await js(`document.getElementById('btnStats').click(); 1`);
    await waitFor(`!document.getElementById('stats').hidden && document.querySelector('.st-card.special .st-svg')`);
    const scaleCount = await js(`Lib.attrs().filter(a=>a.type==='scale').length`);
    ok((await js(`document.querySelectorAll('.st-card').length`)) === scaleCount + 1, 'на странице статистики — график на каждую шкалу и «знание песни»');
    ok(await js(`document.querySelectorAll('.st-card .st-prog').length === document.querySelectorAll('.st-card').length`), 'у каждого графика есть прогресс за период');
    ok(await js(`/^(\\d+(\\.\\d)?|—)$/.test(document.querySelectorAll('.st-card')[1].querySelector('.st-val').textContent)`), 'среднее округлено до десятых');
    ok(await js(`!!document.querySelector('.st-card.special .st-line') && document.querySelectorAll('.st-card.special .st-dot').length > 0 && !!document.querySelector('.st-card.special .st-base')`), 'рисуется линия среднего с точками и пунктиром начала периода');
    await shot('30-stats');
    for (const step of ['week', 'month', 'year', 'day']) {
      await js(`document.querySelector('.st-step button[data-id="${step}"]').click(); 1`);
      await sleep(200);
    }
    await js(`document.querySelector('.st-period button[data-id="all"]').click(); 1`);
    await sleep(200);
    ok(await js(`document.querySelector('.st-period button.on').dataset.id === 'all' && document.querySelector('.st-step button.on').dataset.id === 'day'`), 'период и шаг переключаются');
    await js(`document.querySelector('.st-period button[data-id="custom"]').click(); 1`);
    await sleep(200);
    ok(await js(`document.querySelectorAll('.st-dates .date-btn').length === 1 && !document.querySelector('#stats input[type=date]')`), 'свой период — одно поле с диапазоном (не системный календарь)');
    await js(`document.querySelector('.st-dates .date-btn').click(); 1`);
    await sleep(300);
    ok(await js(`!!document.querySelector('.dp-pop .dp-day')`), 'открывается календарь');
    await shot('33-datepicker');
    const days = await js(`(() => { const d=[...document.querySelectorAll('.dp-pop .dp-day:not(:disabled)')]; const a=d[Math.min(8, d.length-1)], b=d[1]; a.click(); return [a.dataset.v, b.dataset.v]; })()`);
    await sleep(200);
    ok(await js(`!!document.querySelector('.dp-pop') && !!document.querySelector('.dp-pop .dp-day.edge')`), 'после первого клика календарь ждёт вторую дату');
    await js(`document.querySelector('.dp-pop .dp-day[data-v="${days[1]}"]').click(); 1`);
    await sleep(300);
    ok((await js(`Stats.state.from`)) === [days[0], days[1]].sort()[0] && (await js(`Stats.state.to`)) === [days[0], days[1]].sort()[1] && (await js(`!document.querySelector('.dp-pop')`)), 'вторым кликом выбирается конец периода (порядок не важен)');
    await js(`document.querySelector('.st-dates .date-btn').click(); 1`);
    await sleep(300);
    ok(await js(`document.querySelectorAll('.dp-pop .dp-day.in, .dp-pop .dp-day.edge').length >= 2`), 'выбранный период подсвечен в календаре');
    await shot('34-daterange');
    await js(`UI.closeMenu(); 1`);
    ok(await js(`(() => { const D=86400000, s0=new Date(2026,0,15).getTime(), avg=(T)=>T<s0+D/2?2:3; const c=Stats.candles(avg,[s0+D/2],s0,s0+D-1,'day'); return c.length===1 && c[0].open===2 && c[0].close===3 && c[0].high===3 && c[0].low===2; })()`), 'свеча: открытие, закрытие, минимум и максимум за шаг');
    ok(await js(`(() => { const t={id:'x',createdAt:new Date(0).toISOString(),attributes:{knowledge:8},history:[{at:new Date(1000).toISOString(),kind:'edit',changes:[{key:'attr:knowledge',label:'Знание песни',from:'3 из 10',to:'8 из 10'}]}]}; const tl=Stats.timeline(t, Lib.attr('knowledge')); return tl.length===2 && tl[0].v===3 && tl[1].v===8; })()`), 'история значений шкалы восстанавливается из истории песни');
    await js(`document.querySelector('#stats .d-back').click(); 1`);
    await sleep(300);
    ok(await js(`document.getElementById('stats').hidden`), 'из статистики можно вернуться в библиотеку');

    // ---- Обложки «по характеру песни»
    ok(await js(`document.querySelectorAll('.card .art-gen svg.cv').length > 0`), 'песни без картинки получают рисунок-обложку');
    ok(await js(`(() => { const f=(o)=>Cover.mood({id:'z', attributes:{mood:o}, categories:[]}).kind; return f('sad')==='sad' && f('happy')==='happy' && f('neutral')==='neutral'; })()`), 'настроение обложки берётся из выбранного характера');
    ok(await js(`(() => { const lum=(hex)=>{const n=parseInt(hex.slice(1),16);return ((n>>16)&255)*.3+((n>>8)&255)*.59+(n&255)*.11;}; let sad=0, happy=0; for (let i=0;i<20;i++){ sad+=lum(Cover.palette({id:'s'+i,attributes:{mood:'sad'},categories:[]})[0]); happy+=lum(Cover.palette({id:'h'+i,attributes:{mood:'happy'},categories:[]})[0]); } return sad < happy - 60; })()`), 'грустные обложки заметно темнее весёлых');
    ok(await js(`(() => { const set=new Set(); for (let i=0;i<40;i++) set.add(Cover.svg({id:'v'+i,attributes:{},categories:[]}).replace(/-\\d+/g,'')); return set.size === 40; })()`), 'рисунки у разных песен разные');
    ok(await js(`(() => { const a=Cover.svg({id:'k1',attributes:{mood:'happy',knowledge:3},categories:[]}); const b=Cover.svg({id:'k1',attributes:{mood:'happy',knowledge:10},categories:[]}); return a.includes('<mask') && !b.includes('<mask') && a!==b; })()`), 'полнота круга на обложке зависит от знания песни');
    ok(await js(`(() => { const s=Cover.svg({id:'c1',attributes:{mood:'happy',language:'en'},categories:[]}); return s.includes('cv-acc'); })()`), 'цвета выбранных вариантов попадают на обложку');
    ok(await js(`(() => { const s=Cover.svg({id:'u1',attributes:{},categories:[]}); const d=document.createElement('div'); d.innerHTML=Cover.svg({id:'u1',attributes:{},categories:[]}); return d.querySelector('linearGradient').id !== (s.match(/linearGradient id="([^"]+)"/)||[])[1]; })()`), 'у каждой вставленной обложки свои id внутри SVG');
    await shot('31-covers');

    // ---- Новый вариант списка прямо из формы песни
    await js(`Tracks.openForm(${wid}); 1`);
    await sleep(500);
    const multiId = await js(`(Lib.attrs().find(a=>a.type==='multiselect')||{}).id || ''`);
    ok(!!multiId && (await js(`!!document.querySelector('.form-field[data-attr="${multiId}"] .opt-new')`)), 'у списка с несколькими вариантами в форме есть кнопка «+»');
    ok(await js(`document.querySelector('.form-field[data-attr="${multiId}"] .opt-new').textContent.trim() === ''`), 'на кнопке только плюсик, без слова');
    await js(`document.querySelector('.form-field[data-attr="${multiId}"] .opt-new').click(); 1`);
    await sleep(150);
    await js(`(() => { const i=document.querySelector('.form-field[data-attr="${multiId}"] .opt-new-input'); i.value='Ре минор'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 1; })()`);
    await sleep(600);
    ok(await js(`(() => { const a=Lib.attr('${multiId}'); const o=a.options.find(x=>x.label==='Ре минор'); return !!o && !!document.querySelector('.form-field[data-attr="${multiId}"] .opt.on[data-id="'+o.id+'"]'); })()`), 'новый вариант сохраняется в атрибуте и сразу выбран');
    const attrsDoc = JSON.parse(fs.readFileSync(path.join(getLib().dataDir, 'attributes.json'), 'utf8'));
    ok(attrsDoc.attributes.find((a) => a.id === multiId).options.some((o) => o.label === 'Ре минор'), 'вариант записан в attributes.json');
    // повтор того же названия не создаёт дубликат
    await js(`document.querySelector('.form-field[data-attr="${multiId}"] .opt-new').click(); 1`);
    await js(`(() => { const i=document.querySelector('.form-field[data-attr="${multiId}"] .opt-new-input'); i.value='ре минор'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return 1; })()`);
    await sleep(500);
    ok(await js(`Lib.attr('${multiId}').options.filter(x=>normalize(x.label)==='ре минор').length === 1`), 'одинаковый вариант не дублируется');
    // живое превью обложки в форме меняется вместе с характером
    const prevCover = await js(`document.querySelector('.form-modal .cover-box .art').innerHTML.replace(/-\\d+/g,'')`);
    await js(`(() => { const cur=Lib.track(${wid}).attributes.mood; const b=[...document.querySelectorAll('.form-field[data-attr="mood"] .opt')].find(x=>x.dataset.id!==cur && x.dataset.id!=='neutral'); b.click(); return 1; })()`);
    await sleep(400);
    ok((await js(`document.querySelector('.form-modal .cover-box .art').innerHTML.replace(/-\\d+/g,'')`)) !== prevCover, 'превью обложки в форме меняется при выборе характера');
    await js(`document.querySelector('.form-modal .cover-box').scrollIntoView(); 1`);
    await shot('32-form-cover-option');
    await click('.modal-actions .btn', 'Отмена');
    await sleep(300);
    await click('.modal-actions .btn', 'Не сохранять').catch(() => {});
    await sleep(400);

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
