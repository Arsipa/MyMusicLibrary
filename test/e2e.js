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
    await js(`document.querySelector('.cp-pop .btn').click(); 1`);
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
