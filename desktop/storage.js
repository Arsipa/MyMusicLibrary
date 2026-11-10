'use strict';
/**
 * Локальное хранилище библиотеки.
 *
 * Структура папки библиотеки (она же — структура резервной копии и экспорта):
 *   data/library.json      — треки и корзина
 *   data/attributes.json   — пользовательские атрибуты
 *   data/categories.json   — категории
 *   data/settings.json     — настройки интерфейса
 *   storage/tracks/        — сами минусовки (имя = уникальный id)
 *   storage/covers/        — обложки
 *   storage/trash/         — файлы удалённых треков (можно вернуть)
 *   backups/               — резервные копии (каждая — полная копия структуры выше)
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');

const MEDIA_TYPES = {
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.weba': 'audio/webm',
};
const IMAGE_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const DOCS = ['library.json', 'attributes.json', 'categories.json', 'settings.json'];
const STORAGE_SUBDIRS = ['tracks', 'covers', 'trash', 'performances'];
const AUTO_BACKUPS_KEEP = 12;
const SPACE_RESERVE = 64 * 1024 * 1024; // оставляем запас 64 МБ

class LibError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function newId(prefix) {
  return prefix + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

/** Безопасное имя файла внутри известной папки (защита от ../ и прочих фокусов). */
function safeJoin(dir, name) {
  if (typeof name !== 'string' || !name || name !== path.basename(name) || name.startsWith('.')) {
    throw new LibError('bad_name');
  }
  const full = path.resolve(dir, name);
  if (path.dirname(full) !== path.resolve(dir)) throw new LibError('bad_name');
  return full;
}

function validateDoc(name, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  if (name === 'library.json') return Array.isArray(data.tracks);
  if (name === 'attributes.json') return Array.isArray(data.attributes);
  if (name === 'categories.json') return Array.isArray(data.categories);
  return true;
}

function renameWithRetry(from, to) {
  let lastErr;
  for (let i = 0; i < 8; i++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      lastErr = e;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) break;
      sleepSync(40 * (i + 1)); // антивирус/индексатор мог ненадолго занять файл
    }
  }
  throw lastErr;
}

/** Атомарная запись: временный файл → fsync → замена основного. Предыдущая версия хранится в .prev */
function atomicWriteFile(file, content) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, content);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(file)) {
    try {
      fs.copyFileSync(file, file + '.prev');
    } catch (_) { /* .prev — лишь подстраховка */ }
  }
  renameWithRetry(tmp, file);
}

async function dirSize(dir) {
  let total = 0;
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch (_) {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else {
      try {
        total += (await fsp.stat(p)).size;
      } catch (_) {}
    }
  }
  return total;
}

function freeSpace(dir) {
  try {
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch (_) {
    return Infinity; // не удалось определить — не блокируем
  }
}

function mapFsError(e) {
  if (e instanceof LibError) return e;
  switch (e && e.code) {
    case 'ENOSPC':
      return new LibError('no_space');
    case 'ENOENT':
      return new LibError('not_found');
    case 'EACCES':
    case 'EPERM':
    case 'EBUSY':
      return new LibError('access');
    default:
      return new LibError('io', e && e.message);
  }
}

/** Копирование файла: сначала пробуем жёсткую ссылку (мгновенно и без лишнего места), иначе — копия. */
async function linkOrCopy(src, dest, allowLink) {
  if (allowLink) {
    try {
      await fsp.link(src, dest);
      return;
    } catch (_) {}
  }
  await fsp.copyFile(src, dest);
}

async function listFiles(dir) {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch (_) {
    return [];
  }
}

class Library {
  constructor(root) {
    this.setRoot(root);
  }

  setRoot(root) {
    this.root = path.resolve(root);
    this.dataDir = path.join(this.root, 'data');
    this.storageDir = path.join(this.root, 'storage');
    this.tracksDir = path.join(this.storageDir, 'tracks');
    this.coversDir = path.join(this.storageDir, 'covers');
    this.trashDir = path.join(this.storageDir, 'trash');
    this.perfDir = path.join(this.storageDir, 'performances'); // видео выступлений
    this.backupsDir = path.join(this.root, 'backups');
    this.blocked = new Set(); // документы, запись в которые запрещена до восстановления
  }

  ensureDirs() {
    for (const d of [this.dataDir, this.tracksDir, this.coversDir, this.trashDir, this.perfDir, this.backupsDir]) {
      fs.mkdirSync(d, { recursive: true });
    }
  }

  // ---------- JSON ----------

  readDoc(name) {
    const file = path.join(this.dataDir, name);
    let raw;
    try {
      raw = fs.readFileSync(file, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return { status: 'missing' };
      return { status: 'corrupt', error: e.message };
    }
    try {
      const data = JSON.parse(raw.replace(/^﻿/, ''));
      if (!validateDoc(name, data)) return { status: 'corrupt', error: 'invalid structure' };
      return { status: 'ok', data };
    } catch (e) {
      return { status: 'corrupt', error: e.message };
    }
  }

  writeDoc(name, data) {
    if (!DOCS.includes(name)) throw new LibError('bad_name');
    if (this.blocked.has(name)) throw new LibError('blocked');
    if (!validateDoc(name, data)) throw new LibError('invalid');
    this.ensureDirs();
    atomicWriteFile(path.join(this.dataDir, name), JSON.stringify(data, null, 2));
  }

  prevAvailable(name) {
    const prev = path.join(this.dataDir, name + '.prev');
    try {
      const data = JSON.parse(fs.readFileSync(prev, 'utf8'));
      return validateDoc(name, data);
    } catch (_) {
      return false;
    }
  }

  async loadAll() {
    this.ensureDirs();
    // остатки прерванной записи
    for (const f of await listFiles(this.dataDir)) {
      if (f.endsWith('.tmp')) fs.rmSync(path.join(this.dataDir, f), { force: true });
    }
    const docs = {};
    const problems = [];
    const backups = await this.listBackups();
    for (const name of DOCS) {
      const r = this.readDoc(name);
      if (r.status === 'ok') {
        docs[name] = r.data;
      } else if (r.status === 'missing') {
        // пустая библиотека создаётся только если нет признаков, что данные были
        const suspicious = name === 'library.json' && (this.prevAvailable(name) || backups.length > 0);
        if (suspicious) {
          this.blocked.add(name);
          problems.push({ name, kind: 'missing', prev: this.prevAvailable(name) });
        }
        docs[name] = null;
      } else {
        this.blocked.add(name);
        problems.push({ name, kind: 'corrupt', prev: this.prevAvailable(name), error: r.error });
        docs[name] = null;
      }
    }
    return { docs, problems, backups };
  }

  usePrev(name) {
    if (!DOCS.includes(name)) throw new LibError('bad_name');
    const file = path.join(this.dataDir, name);
    const raw = fs.readFileSync(file + '.prev', 'utf8');
    const data = JSON.parse(raw);
    if (!validateDoc(name, data)) throw new LibError('invalid');
    if (fs.existsSync(file)) fs.copyFileSync(file, file + `.corrupted-${stamp()}`);
    atomicWriteFile(file, raw);
    this.blocked.delete(name);
    return data;
  }

  startFresh(name) {
    if (!DOCS.includes(name)) throw new LibError('bad_name');
    const file = path.join(this.dataDir, name);
    if (fs.existsSync(file)) renameWithRetry(file, file + `.corrupted-${stamp()}`);
    this.blocked.delete(name);
  }

  // ---------- Треки ----------

  dirOf(kind) {
    return { tracks: this.tracksDir, covers: this.coversDir, trash: this.trashDir, performances: this.perfDir }[kind];
  }

  /** Копирует файл в хранилище: kind = 'tracks' (минусовки) или 'performances' (видео выступлений) */
  async importMedia(srcPath, kind = 'tracks') {
    const targetDir = kind === 'performances' ? this.perfDir : this.tracksDir;
    let st;
    try {
      st = await fsp.stat(srcPath);
    } catch (_) {
      throw new LibError('not_found');
    }
    if (!st.isFile()) throw new LibError('not_found');
    const ext = path.extname(srcPath).toLowerCase();
    if (!MEDIA_TYPES[ext]) throw new LibError('unsupported');
    if (st.size === 0) throw new LibError('empty');
    this.ensureDirs();
    if (freeSpace(targetDir) < st.size + SPACE_RESERVE) throw new LibError('no_space');

    const id = newId(kind === 'performances' ? 'p_' : 't_');
    const fileName = id + ext;
    const dest = path.join(targetDir, fileName);
    const part = dest + '.part';
    try {
      await fsp.copyFile(srcPath, part);
      const copied = await fsp.stat(part);
      if (copied.size !== st.size) throw new LibError('copy_mismatch');
      renameWithRetry(part, dest);
    } catch (e) {
      await fsp.rm(part, { force: true }).catch(() => {});
      throw mapFsError(e);
    }
    return {
      fileName,
      originalFileName: path.basename(srcPath),
      size: st.size,
      ext,
      mime: MEDIA_TYPES[ext],
    };
  }

  async importCover(srcPath) {
    const ext = path.extname(srcPath).toLowerCase();
    if (!IMAGE_TYPES[ext]) throw new LibError('unsupported_image');
    let st;
    try {
      st = await fsp.stat(srcPath);
    } catch (_) {
      throw new LibError('not_found');
    }
    if (st.size > 25 * 1024 * 1024) throw new LibError('too_big');
    if (freeSpace(this.coversDir) < st.size + SPACE_RESERVE) throw new LibError('no_space');
    this.ensureDirs();
    const fileName = newId('c_') + ext;
    try {
      await fsp.copyFile(srcPath, path.join(this.coversDir, fileName));
    } catch (e) {
      throw mapFsError(e);
    }
    return { fileName };
  }

  mediaPath(fileName) {
    return safeJoin(this.tracksDir, fileName);
  }
  coverPath(fileName) {
    return safeJoin(this.coversDir, fileName);
  }
  perfPath(fileName) {
    return safeJoin(this.perfDir, fileName);
  }

  async fileExists(kind, fileName) {
    const dir = this.dirOf(kind);
    if (!dir) return false;
    try {
      const st = await fsp.stat(safeJoin(dir, fileName));
      return st.isFile() && st.size > 0;
    } catch (_) {
      return false;
    }
  }

  async removeFile(kind, fileName) {
    const dir = this.dirOf(kind);
    if (!dir) throw new LibError('bad_name');
    await fsp.rm(safeJoin(dir, fileName), { force: true });
  }

  async moveToTrash(fileName, kind = 'tracks') {
    this.ensureDirs();
    const src = safeJoin(kind === 'performances' ? this.perfDir : this.tracksDir, fileName);
    const dest = safeJoin(this.trashDir, fileName);
    if (!fs.existsSync(src)) return false;
    renameWithRetry(src, dest);
    return true;
  }

  async restoreFromTrash(fileName, kind = 'tracks') {
    const src = safeJoin(this.trashDir, fileName);
    const dest = safeJoin(kind === 'performances' ? this.perfDir : this.tracksDir, fileName);
    if (!fs.existsSync(src)) throw new LibError('not_found');
    renameWithRetry(src, dest);
  }

  async copyOut(kind, fileName, destPath) {
    const dir = this.dirOf(kind) || this.tracksDir;
    const src = safeJoin(dir, fileName);
    const st = await fsp.stat(src);
    if (freeSpace(path.dirname(destPath)) < st.size + 1024 * 1024) throw new LibError('no_space');
    try {
      await fsp.copyFile(src, destPath);
    } catch (e) {
      throw mapFsError(e);
    }
  }

  // ---------- Проверка целостности ----------

  async integrity(referenced) {
    const refTracks = new Set(referenced.tracks || []);
    const refTrash = new Set(referenced.trash || []);
    const refCovers = new Set(referenced.covers || []);
    const refPerf = new Set(referenced.performances || []);
    const result = { missing: [], missingTrash: [], missingPerf: [], orphans: [], removedPartials: 0 };

    const trackFiles = await listFiles(this.tracksDir);
    for (const f of trackFiles) {
      if (f.endsWith('.part')) {
        await fsp.rm(path.join(this.tracksDir, f), { force: true });
        result.removedPartials++;
        continue;
      }
      if (!refTracks.has(f) && MEDIA_TYPES[path.extname(f).toLowerCase()]) {
        const st = await fsp.stat(path.join(this.tracksDir, f));
        result.orphans.push({ fileName: f, size: st.size });
      }
    }
    const have = new Set(trackFiles);
    for (const f of refTracks) if (!have.has(f)) result.missing.push(f);
    // видео выступлений: убираем недокопированные остатки, отмечаем пропавшие (лишние не трогаем — это пользовательские видео)
    const perfFiles = await listFiles(this.perfDir);
    for (const f of perfFiles) {
      if (f.endsWith('.part')) {
        await fsp.rm(path.join(this.perfDir, f), { force: true });
        result.removedPartials++;
      }
    }
    const havePerf = new Set(perfFiles);
    for (const f of refPerf) if (!havePerf.has(f)) result.missingPerf.push(f);
    const trashFiles = new Set(await listFiles(this.trashDir));
    for (const f of refTrash) if (!trashFiles.has(f)) result.missingTrash.push(f);
    // лишние обложки удаляем тихо: это не музыка и не пользовательские данные
    for (const f of await listFiles(this.coversDir)) {
      if (!refCovers.has(f)) {
        const st = await fsp.stat(path.join(this.coversDir, f)).catch(() => null);
        // не трогаем обложки, добавленные в последние сутки (форма могла быть ещё открыта)
        if (st && Date.now() - st.mtimeMs > 24 * 3600 * 1000) {
          await fsp.rm(path.join(this.coversDir, f), { force: true });
        }
      }
    }
    return result;
  }

  // ---------- Резервные копии ----------

  async copyLibraryTree(fromRoot, toRoot, allowLink) {
    await fsp.mkdir(path.join(toRoot, 'data'), { recursive: true });
    for (const name of DOCS) {
      const src = path.join(fromRoot, 'data', name);
      if (fs.existsSync(src)) await fsp.copyFile(src, path.join(toRoot, 'data', name));
    }
    for (const sub of STORAGE_SUBDIRS) {
      const srcDir = path.join(fromRoot, 'storage', sub);
      const destDir = path.join(toRoot, 'storage', sub);
      await fsp.mkdir(destDir, { recursive: true });
      for (const f of await listFiles(srcDir)) {
        if (f.endsWith('.part')) continue;
        await linkOrCopy(path.join(srcDir, f), path.join(destDir, f), allowLink);
      }
    }
  }

  async createBackup(reason = 'manual') {
    this.ensureDirs();
    const auto = reason !== 'manual';
    const name = `backup_${stamp()}${auto ? '_auto' : ''}`;
    const finalDir = path.join(this.backupsDir, name);
    const partDir = finalDir + '.part';
    try {
      await this.copyLibraryTree(this.root, partDir, true);
      let trackCount = 0;
      try {
        const lib = JSON.parse(fs.readFileSync(path.join(partDir, 'data', 'library.json'), 'utf8'));
        trackCount = (lib.tracks || []).length;
      } catch (_) {}
      fs.writeFileSync(
        path.join(partDir, 'manifest.json'),
        JSON.stringify({ createdAt: new Date().toISOString(), reason, trackCount }, null, 2)
      );
      renameWithRetry(partDir, finalDir);
    } catch (e) {
      await fsp.rm(partDir, { recursive: true, force: true }).catch(() => {});
      throw mapFsError(e);
    }
    if (auto) await this.pruneAutoBackups();
    return name;
  }

  async pruneAutoBackups() {
    const list = (await this.listBackups()).filter((b) => b.auto);
    for (const b of list.slice(AUTO_BACKUPS_KEEP)) {
      await fsp.rm(path.join(this.backupsDir, b.name), { recursive: true, force: true }).catch(() => {});
    }
  }

  async listBackups() {
    let entries = [];
    try {
      entries = await fsp.readdir(this.backupsDir, { withFileTypes: true });
    } catch (_) {
      return [];
    }
    const out = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.endsWith('.part')) continue;
      const dir = path.join(this.backupsDir, e.name);
      if (!fs.existsSync(path.join(dir, 'data', 'library.json'))) continue;
      let manifest = {};
      try {
        manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      } catch (_) {
        const st = fs.statSync(dir);
        manifest = { createdAt: st.mtime.toISOString(), reason: 'manual' };
      }
      out.push({
        name: e.name,
        createdAt: manifest.createdAt,
        reason: manifest.reason || 'manual',
        auto: (manifest.reason || 'manual') !== 'manual',
        trackCount: manifest.trackCount,
      });
    }
    out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return out;
  }

  async deleteBackup(name) {
    const dir = safeJoin(this.backupsDir, name);
    await fsp.rm(dir, { recursive: true, force: true });
  }

  /** Проверяет, что папка похожа на библиотеку/резервную копию. */
  inspectSource(dir) {
    const libFile = path.join(dir, 'data', 'library.json');
    if (!fs.existsSync(libFile)) return { ok: false, reason: 'not_library' };
    try {
      const lib = JSON.parse(fs.readFileSync(libFile, 'utf8'));
      if (!validateDoc('library.json', lib)) return { ok: false, reason: 'corrupt' };
      return { ok: true, trackCount: lib.tracks.length };
    } catch (_) {
      return { ok: false, reason: 'corrupt' };
    }
  }

  /** Полное восстановление библиотеки из папки (резервной копии или экспорта). */
  async restoreFrom(srcRoot, { linkAllowed }) {
    const check = this.inspectSource(srcRoot);
    if (!check.ok) throw new LibError(check.reason);
    // проверяем, что все JSON источника читаются, ещё до любых изменений
    const incoming = {};
    for (const name of DOCS) {
      const f = path.join(srcRoot, 'data', name);
      if (!fs.existsSync(f)) continue;
      const raw = fs.readFileSync(f, 'utf8');
      const data = JSON.parse(raw.replace(/^﻿/, ''));
      if (!validateDoc(name, data)) throw new LibError('corrupt');
      incoming[name] = raw.replace(/^﻿/, '');
    }
    // место: считаем только недостающие файлы
    let need = 0;
    for (const sub of STORAGE_SUBDIRS) {
      const have = new Set(await listFiles(path.join(this.storageDir, sub)));
      for (const f of await listFiles(path.join(srcRoot, 'storage', sub))) {
        if (!have.has(f)) need += (await fsp.stat(path.join(srcRoot, 'storage', sub, f))).size;
      }
    }
    if (!linkAllowed && freeSpace(this.root) < need + SPACE_RESERVE) throw new LibError('no_space');

    this.ensureDirs();
    try {
      for (const sub of STORAGE_SUBDIRS) {
        const srcDir = path.join(srcRoot, 'storage', sub);
        const destDir = path.join(this.storageDir, sub);
        const srcFiles = (await listFiles(srcDir)).filter((f) => !f.endsWith('.part'));
        const srcSet = new Set(srcFiles);
        for (const f of srcFiles) {
          const dest = path.join(destDir, f);
          const srcSt = await fsp.stat(path.join(srcDir, f));
          const destSt = await fsp.stat(dest).catch(() => null);
          if (destSt && destSt.size === srcSt.size) continue;
          const tmp = dest + '.part';
          await fsp.rm(tmp, { force: true });
          await linkOrCopy(path.join(srcDir, f), tmp, linkAllowed);
          await fsp.rm(dest, { force: true });
          renameWithRetry(tmp, dest);
        }
        // файлы, которых нет в копии, удаляются: перед восстановлением они сохранены в авто-копии
        for (const f of await listFiles(destDir)) {
          if (!srcSet.has(f)) await fsp.rm(path.join(destDir, f), { force: true });
        }
      }
      for (const [name, raw] of Object.entries(incoming)) {
        atomicWriteFile(path.join(this.dataDir, name), raw);
        this.blocked.delete(name);
      }
    } catch (e) {
      throw mapFsError(e);
    }
    return check;
  }

  async exportTo(destParent) {
    const target = path.join(destParent, `MyMusicLibrary_копия_${stamp()}`);
    const size = await dirSize(path.join(this.root, 'storage'));
    if (freeSpace(destParent) < size + SPACE_RESERVE) throw new LibError('no_space');
    try {
      await this.copyLibraryTree(this.root, target, false);
      fs.writeFileSync(
        path.join(target, 'manifest.json'),
        JSON.stringify({ createdAt: new Date().toISOString(), reason: 'export' }, null, 2)
      );
    } catch (e) {
      await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
      throw mapFsError(e);
    }
    return target;
  }

  /** Путь к папке резервной копии (только внутри backups/) */
  backupPath(name) {
    const dir = path.join(this.backupsDir, path.basename(String(name || '')));
    if (!path.basename(String(name || '')) || !fs.existsSync(path.join(dir, 'data', 'library.json'))) throw new LibError('not_found');
    return dir;
  }

  /** Сохранить резервную копию в выбранную папку — настоящими файлами, её потом можно открыть через «Перенос» */
  async exportBackup(name, destParent) {
    const src = this.backupPath(name);
    let target = path.join(destParent, `MyMusicLibrary_${path.basename(src)}`);
    for (let i = 2; fs.existsSync(target); i++) target = path.join(destParent, `MyMusicLibrary_${path.basename(src)}_${i}`);
    const size = await dirSize(src);
    if (freeSpace(destParent) < size + SPACE_RESERVE) throw new LibError('no_space');
    try {
      await this.copyLibraryTree(src, target, false);
      const man = path.join(src, 'manifest.json');
      if (fs.existsSync(man)) await fsp.copyFile(man, path.join(target, 'manifest.json'));
    } catch (e) {
      await fsp.rm(target, { recursive: true, force: true }).catch(() => {});
      throw mapFsError(e);
    }
    return target;
  }

  async stats() {
    return {
      root: this.root,
      storageSize: await dirSize(this.storageDir),
      backupsSize: await dirSize(this.backupsDir),
      free: freeSpace(this.root),
    };
  }
}

module.exports = { Library, LibError, MEDIA_TYPES, IMAGE_TYPES, DOCS, freeSpace, dirSize, stamp };
