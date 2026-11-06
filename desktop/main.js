'use strict';
const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu, screen } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { Readable } = require('stream');
const { Library, LibError, MEDIA_TYPES, IMAGE_TYPES } = require('./storage');

const SRC_DIR = path.join(__dirname, '..', 'src');
const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mml',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  },
]);

// Режим автотестов разработчика (в собранной программе недоступен)
const TEST = !app.isPackaged && process.env.MML_TEST;
if (TEST && process.env.MML_USERDATA) app.setPath('userData', process.env.MML_USERDATA);

// Только один экземпляр: два окна, пишущие в одни и те же файлы, — путь к потере данных.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setName('My Music Library');
const CONFIG_FILE = () => path.join(app.getPath('userData'), 'config.json');

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE(), 'utf8'));
  } catch (_) {
    return {};
  }
}
function writeConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE()), { recursive: true });
  const tmp = CONFIG_FILE() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, CONFIG_FILE());
}

let config = {};
let library;
let win;

function defaultLibraryRoot() {
  return path.join(app.getPath('userData'), 'Library');
}

// ---------- Протокол mml:// — интерфейс и потоковое чтение медиа (с поддержкой перемотки) ----------

function notFound() {
  return new Response('Not found', { status: 404 });
}

async function serveFile(filePath, mime, request, allowRange) {
  let st;
  try {
    st = await fsp.stat(filePath);
    if (!st.isFile()) return notFound();
  } catch (_) {
    return notFound();
  }
  const range = allowRange && request.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (m && !m[1] && m[2]) {
      start = Math.max(0, st.size - parseInt(m[2], 10));
      end = st.size - 1;
    }
    if (start >= st.size || end >= st.size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    }
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      },
    });
  }
  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(st.size),
      'Accept-Ranges': allowRange ? 'bytes' : 'none',
      'Cache-Control': 'no-store',
    },
  });
}

function registerProtocol() {
  protocol.handle('mml', async (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    try {
      if (url.host === 'app') {
        const full = path.resolve(SRC_DIR, rel || 'index.html');
        if (!full.startsWith(path.resolve(SRC_DIR) + path.sep)) return notFound();
        const mime = STATIC_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream';
        return serveFile(full, mime, request, false);
      }
      if (url.host === 'media') {
        const full = library.mediaPath(rel);
        return serveFile(full, MEDIA_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', request, true);
      }
      if (url.host === 'cover') {
        const full = library.coverPath(rel);
        return serveFile(full, IMAGE_TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream', request, false);
      }
    } catch (_) {
      return notFound();
    }
    return notFound();
  });
}

// ---------- Окно ----------

/** Размер окна: сохранённый, если он помещается на экран, иначе — под рабочую область экрана. */
function initialBounds() {
  const saved = config.windowBounds;
  if (saved) {
    const area = screen.getDisplayMatching(saved).workArea;
    const fits = saved.width <= area.width && saved.height <= area.height && saved.x >= area.x - 20 && saved.y >= area.y - 20;
    if (fits) return { bounds: saved, maximize: !!config.windowMaximized };
  }
  const area = screen.getPrimaryDisplay().workArea;
  // на небольших экранах (ноутбуки) сразу разворачиваем окно на весь экран
  const small = area.width < 1700 || area.height < 950;
  const width = Math.min(1440, Math.round(area.width * 0.9));
  const height = Math.min(920, Math.round(area.height * 0.9));
  return {
    bounds: { width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2) },
    maximize: config.windowBounds ? !!config.windowMaximized : small,
  };
}

function createWindow() {
  const { bounds: b, maximize } = initialBounds();
  win = new BrowserWindow({
    width: b.width,
    height: b.height,
    x: b.x,
    y: b.y,
    minWidth: 760,
    minHeight: 560,
    backgroundColor: '#efe7ff',
    title: 'My Music Library',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
      spellcheck: false,
    },
  });
  if (maximize && !TEST) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('mml://app/')) e.preventDefault();
  });
  const saveBounds = () => {
    if (!win || win.isDestroyed()) return;
    config.windowMaximized = win.isMaximized();
    if (!win.isMaximized() && !win.isMinimized()) config.windowBounds = win.getBounds();
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.on('close', () => {
    saveBounds();
    try {
      writeConfig(config);
    } catch (_) {}
  });
  win.loadURL('mml://app/index.html');
  if (TEST) win.webContents.once('did-finish-load', () => require(path.resolve(TEST))(win, () => library));
}

// ---------- IPC ----------

const ERROR_TEXT = {
  not_found: 'Файл не найден. Возможно, его переместили или удалили.',
  unsupported: 'Этот формат не поддерживается. Подойдут MP3, MP4, M4A, WAV, AAC, FLAC, OGG, OPUS, WEBM.',
  unsupported_image: 'Для обложки подойдут картинки JPG, PNG, WEBP или GIF.',
  empty: 'Файл пустой — в нём нет музыки.',
  no_space: 'На диске не хватает свободного места. Освободите немного места и попробуйте снова.',
  access: 'Нет доступа к файлу. Возможно, он открыт в другой программе.',
  copy_mismatch: 'Файл скопировался не полностью. Попробуйте ещё раз.',
  too_big: 'Картинка слишком большая (больше 25 МБ).',
  blocked: 'Сохранение приостановлено, пока библиотека не восстановлена.',
  not_library: 'В этой папке нет библиотеки My Music Library.',
  corrupt: 'Файлы этой копии повреждены и не могут быть прочитаны.',
  invalid: 'Не удалось сохранить: данные выглядят неправильно.',
  bad_name: 'Неверное имя файла.',
  io: 'Не получилось выполнить операцию с файлом.',
  bad_location: 'Эту папку выбрать нельзя: она находится внутри текущей библиотеки или уже занята другими файлами.',
};

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      const code = e instanceof LibError ? e.code : e && e.code === 'ENOSPC' ? 'no_space' : 'io';
      console.error(`[${channel}]`, e);
      return { ok: false, code, message: ERROR_TEXT[code] || ERROR_TEXT.io };
    }
  });
}

function registerIpc() {
  handle('lib:load', async () => {
    const r = await library.loadAll();
    return { ...r, root: library.root, isDefaultRoot: library.root === path.resolve(defaultLibraryRoot()) };
  });
  handle('lib:save', async (name, data) => library.writeDoc(name, data));

  handle('dialog:pick-tracks', async () => {
    const exts = Object.keys(MEDIA_TYPES).map((e) => e.slice(1));
    const r = await dialog.showOpenDialog(win, {
      title: 'Выберите минусовки',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Музыка и видео', extensions: exts },
        { name: 'Все файлы', extensions: ['*'] },
      ],
    });
    return r.canceled ? [] : r.filePaths;
  });
  handle('track:import', async (srcPath) => library.importMedia(srcPath));
  handle('track:exists', async (fileName) => library.fileExists('tracks', fileName));
  handle('track:remove-file', async (fileName) => library.removeFile('tracks', fileName));
  handle('track:trash', async (fileName) => library.moveToTrash(fileName));
  handle('track:untrash', async (fileName) => library.restoreFromTrash(fileName));
  handle('track:purge', async (fileName) => library.removeFile('trash', fileName));
  handle('track:save-copy', async (kind, fileName, suggested) => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Сохранить копию минусовки',
      defaultPath: path.join(app.getPath('music'), suggested || fileName),
    });
    if (r.canceled || !r.filePath) return false;
    await library.copyOut(kind, fileName, r.filePath);
    return true;
  });

  handle('cover:pick', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Выберите обложку',
      properties: ['openFile'],
      filters: [{ name: 'Картинки', extensions: Object.keys(IMAGE_TYPES).map((e) => e.slice(1)) }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return library.importCover(r.filePaths[0]);
  });
  handle('cover:remove', async (fileName) => library.removeFile('covers', fileName));

  handle('integrity:check', async (referenced) => library.integrity(referenced));

  handle('backup:create', async (reason) => library.createBackup(reason || 'manual'));
  handle('backup:list', async () => library.listBackups());
  handle('backup:delete', async (name) => library.deleteBackup(name));
  handle('backup:restore', async (name) => {
    const src = path.join(library.backupsDir, path.basename(name));
    const check = library.inspectSource(src);
    if (!check.ok) throw new LibError(check.reason);
    await library.createBackup('before-restore');
    return library.restoreFrom(src, { linkAllowed: true });
  });
  handle('backup:export', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Куда сохранить копию библиотеки?',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const target = await library.exportTo(r.filePaths[0]);
    shell.showItemInFolder(path.join(target, 'data'));
    return target;
  });
  handle('backup:import', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Выберите папку с копией библиотеки',
      properties: ['openDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const src = r.filePaths[0];
    if (path.resolve(src) === library.root) throw new LibError('not_library');
    const check = library.inspectSource(src);
    if (!check.ok) throw new LibError(check.reason);
    const ok = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Заменить библиотеку', 'Отмена'],
      defaultId: 0,
      cancelId: 1,
      title: 'Загрузка копии',
      message: `В копии ${check.trackCount} трек(ов). Текущая библиотека будет заменена.`,
      detail: 'Перед заменой автоматически создаётся резервная копия текущей библиотеки — её можно будет вернуть.',
    });
    if (ok.response !== 0) return null;
    await library.createBackup('before-import');
    return library.restoreFrom(src, { linkAllowed: false });
  });

  handle('recovery:use-prev', async (name) => library.usePrev(name));
  handle('recovery:start-fresh', async (name) => library.startFresh(name));
  handle('recovery:restore-backup', async (name) => {
    const src = path.join(library.backupsDir, path.basename(name));
    await library.createBackup('before-restore');
    return library.restoreFrom(src, { linkAllowed: true });
  });

  handle('lib:stats', async () => library.stats());
  handle('lib:open-folder', async () => shell.openPath(library.root));
  handle('lib:change-location', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Выберите папку для библиотеки',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const chosen = path.resolve(r.filePaths[0]);
    if (chosen === library.root || chosen.startsWith(library.root + path.sep)) {
      throw new LibError('bad_location');
    }
    // в выбранной папке уже есть библиотека — предлагаем открыть её
    let target;
    if (library.inspectSource(chosen).ok) target = chosen;
    else if (library.inspectSource(path.join(chosen, 'MyMusicLibrary')).ok) target = path.join(chosen, 'MyMusicLibrary');
    if (target) {
      const q = await dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Открыть найденную библиотеку', 'Отмена'],
        cancelId: 1,
        message: 'В этой папке уже есть библиотека. Открыть её вместо текущей?',
        detail: 'Текущая библиотека останется на месте, к ней можно будет вернуться.',
      });
      if (q.response !== 0) return null;
    } else {
      target = path.join(chosen, 'MyMusicLibrary');
      if (fs.existsSync(target) && fs.readdirSync(target).length) throw new LibError('bad_location');
      const size = (await library.stats()).storageSize;
      const { freeSpace } = require('./storage');
      if (freeSpace(chosen) < size + 64 * 1024 * 1024) throw new LibError('no_space');
      await library.copyLibraryTree(library.root, target, false);
      // копируем и резервные копии
      const backups = await library.listBackups();
      for (const b of backups) {
        await library.copyLibraryTree(path.join(library.backupsDir, b.name), path.join(target, 'backups', b.name), false);
        const mf = path.join(library.backupsDir, b.name, 'manifest.json');
        if (fs.existsSync(mf)) await fsp.copyFile(mf, path.join(target, 'backups', b.name, 'manifest.json'));
      }
    }
    config.libraryRoot = target;
    writeConfig(config);
    library.setRoot(target);
    return target;
  });
  handle('lib:reset-location', async () => {
    delete config.libraryRoot;
    writeConfig(config);
    library.setRoot(defaultLibraryRoot());
    return library.root;
  });

  handle('app:info', async () => ({ version: app.getVersion() }));
  // внешние ссылки — только заранее известные адреса, открываются в браузере по умолчанию
  const ALLOWED_LINKS = ['https://github.com/Arsipa/MyMusicLibrary', 'https://t.me/arsipa'];
  // ссылка на клип, которую ввёл пользователь: открываем только обычные http(s)-адреса в браузере по умолчанию
  handle('app:open-url', async (url) => {
    let u;
    try {
      u = new URL(String(url));
    } catch (_) {
      throw new LibError('bad_name');
    }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.href.length > 2000) throw new LibError('bad_name');
    if (TEST) return u.href;
    await shell.openExternal(u.href);
    return u.href;
  });
  handle('app:open-link', async (url) => {
    if (typeof url !== 'string' || !ALLOWED_LINKS.some((a) => url === a || url.startsWith(a + '/'))) throw new LibError('bad_name');
    if (TEST) return url; // автотест не открывает настоящий браузер
    await shell.openExternal(url);
    return url;
  });
}

app.whenReady().then(() => {
  config = readConfig();
  let root = config.libraryRoot || defaultLibraryRoot();
  if (config.libraryRoot && !fs.existsSync(config.libraryRoot)) {
    // папка библиотеки недоступна (например, отключён диск) — не создаём пустую поверх, а сообщаем
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'My Music Library',
      message: 'Папка библиотеки сейчас недоступна.',
      detail: `${config.libraryRoot}\n\nЕсли библиотека на внешнем диске — подключите его и откройте программу снова. Сейчас будет открыта стандартная папка библиотеки.`,
    });
    root = defaultLibraryRoot();
  }
  library = new Library(root);
  Menu.setApplicationMenu(null);
  registerProtocol();
  registerIpc();
  createWindow();
});

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => app.quit());
