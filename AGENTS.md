# AGENTS.md — краткая карта проекта для ИИ-ассистентов

Читай это вместо исследования кода с нуля. Всё ниже соответствует текущему коду; если меняешь архитектуру — обнови этот файл.

## Что это
**My Music Library** — локальное Windows-приложение (Electron 45) для хранения минусовок: треки + пользовательские атрибуты,
категории, фильтры, плеер, резервные копии. Без сервера, интернета и фреймворков. Интерфейс и тексты — на русском,
пользователь не технический: никакого жаргона в UI, ошибки — человеческим языком.
Репозиторий: https://github.com/Arsipa/MyMusicLibrary (автор — Arsipa, Telegram @arsipa).

## Команды
```bash
npm start              # запуск из исходников (работает с НАСТОЯЩИМИ данными пользователя в %APPDATA%!)
npm test               # сквозной автотест в реальном окне, временная папка данных, скриншоты → test/shots/
npm run screenshots    # скриншоты для README → docs/screenshots/ (демо-библиотека во временной папке)
npm run dist           # установщик → dist/MyMusicLibrary-Setup-<версия>.exe
node --check src/js/x.js   # быстрая проверка синтаксиса
```
Если `node_modules/electron/dist` нет — `node node_modules/electron/install.js` (npm блокирует install-скрипты).
Для проверки своих изменений используй `npm test`, а не `npm start` (не трогай данные пользователя).

## Архитектура
```
desktop/main.js     главный процесс: окно, протокол mml://, все IPC (ipcMain.handle через handle()), тексты ошибок ERROR_TEXT
desktop/storage.js  class Library — вся работа с диском (атомарная запись JSON, импорт, корзина, бэкапы, целостность)
desktop/preload.js  window.api — единственный мост к главному процессу (каждый вызов → {ok, value} | {ok:false, code, message})
src/index.html      разметка + порядок <script> (classic scripts, общий глобальный scope, БЕЗ модулей)
src/js/*.js         интерфейс, см. ниже
src/css/            style.css (основа + большинство компонентов, дописывается в конец), cards.css, player.css, responsive.css
test/e2e.js         сценарий автотеста; test/screenshots.js; test/run-e2e.js (запуск); test/make-media.js (тестовые WAV)
```
Протокол `mml://`: `mml://app/…` — файлы `src/`, `mml://media/<file>` — треки (Range для перемотки), `mml://cover/<file>`.

### Модули интерфейса (глобальные объекты)
| Файл | Объект / функции | Назначение |
|---|---|---|
| changelog.js | `APP_LINKS`, `CHANGELOG` | ссылки и «Что нового» для раздела «О приложении» |
| util.js | `h()`, `appendChildren`, `clear`, `icon()`/`ICONS`, `LIMITS`, `withCounter`, `cleanLine/cleanText`, `parseClipUrl`, `siteName`, цвета (`normHex`, `hexToHsv`, `hsvToHex`, `textOn`), `artFor`, форматтеры | общие помощники |
| ui.js | `UI.openModal/confirm/choose/alert/toast/menu/closeMenu/busy` | окна, меню, уведомления |
| storage.js | `S` (состояние), `Store.save(doc)/load()`, `Lib.*`, `DEFAULT_*`, `mediaUrl/coverUrl` | данные + сохранение |
| attributes.js | `ATTR_TYPES`, `OPTION_COLORS`, `Attr.*` (isEmpty, text, display, field, optionColor), `AttributesManager.open()` | атрибуты |
| categories.js | `Categories.open/picker/count`, `CATEGORY_COLORS` | категории |
| player.js | `Player.play/toggle/stop/forget/isPlaying/onChange(fn)→unsubscribe/mountVideo` | один общий `<video>` на всё приложение |
| filters.js | `Filters.renderBar/renderPanel/match/sort/reset/...` | поиск, фильтры, сортировка, строка категорий со стрелками |
| tracks.js | `Cards.*`, `Tracks.openForm/addFromPaths/remove/restore/purge/replaceFile/...`, `openClip()` | карточки, форма трека, импорт |
| backup.js | `Backup.open(tab)` (окно «Настройки»: копии / корзина / перенос / о приложении), `periodic`, `integrity`, `recoveryScreen` | настройки, бэкапы |
| dropdown.js | `dropdown({options,value,onChange})` | стилизованный select (системных `<select>` в проекте нет — так и держать) |
| colorpicker.js | `colorButton(value, onChange)`, `COLOR_PRESETS` | палитра цвета |
| sortable.js | `makeSortable(list, {item, handle, onMove})`, `dragHandle()`, `moveItem` | перетаскивание за ручку |
| tour.js | `Tour.start()` | обучение (шаги в `buildSteps()`) |
| app.js | `App.init/refresh/renderGrid/openDetail/closeDetail` | главный экран, страница трека, запуск |

## Данные
Папка: `%APPDATA%\My Music Library\Library\` (`data/*.json`, `storage/tracks|covers|trash`, `backups/`). Путь меняется в настройках, хранится в `config.json`.
- `library.json`: `{version, tracks:[...], trash:[{track, deletedAt}]}`. Трек: `id, title, fileName (уникальный id+расширение), originalFileName, mime, size, duration, hasVideo, cover, notes, clipUrl?, categories[], attributes{attrId: value}, status: 'ready'|'draft', createdAt, updatedAt`.
- `attributes.json`: `{attributes:[{id, name, type, required, showOnCard, options:[{id,label,color}], min, max}]}`; типы: text, textarea, select, multiselect, number, scale.
- `categories.json`: `{categories:[{id, name, color}]}`; `settings.json`: sort, volume, autoBackup(false по умолч.), backupEvery(day|week|month), lastAutoBackup, tutorialDone.
- Значения атрибутов хранятся по **id** атрибута/варианта → переименование ничего не ломает.
- Миграции — в `Store.load()` (пример: настройки 1.0 без `backupEvery`). Поля не удалять, только добавлять.

## Правила и подводные камни
- **Надёжность важнее красоты.** JSON пишется только через `Library.writeDoc` (tmp → fsync → rename, копия `.prev`). Повреждённый JSON никогда не перезаписывать — блокируется и показывается экран восстановления.
- Файлы треков **никогда не изменяются на месте** (замена = новый файл): бэкапы используют жёсткие ссылки.
- `h(tag, props, ...children)`: `style: {'--c': '#hex'}` ставит CSS-переменную И автоматически `--fg` (читаемый цвет текста). Для чужих DOM-методов: `el.append(null)` выведет «null» — используй `appendChildren`.
- Новый ввод текста — всегда с лимитом из `LIMITS` (`withCounter(input, max)`) и очисткой `cleanLine/cleanText` при сохранении.
- Внешние ссылки открываются только через IPC: `api.openLink` (белый список GitHub/Telegram) или `api.openUrl` (любой http/https от пользователя). `window.open`/навигация запрещены.
- Класс `.cat-row` занят строками окна категорий — не переиспользовать для другого.
- CSS дописывается в конец `style.css`; цвета — токены из `:root` (`--ink`, `--violet`, `--lavender`, `--lilac`, `--canvas`, `--paper`, `--lime`, `--coral`, `--sun`, `--mint`, `--danger`). Шрифты Unbounded (заголовки) и Manrope встроены.
- Переводы строк: LF (закреплено в `.gitattributes`); `README.txt` — CRLF + BOM (для Блокнота). Правя файлы node-скриптом, учитывай это.
- Автотест: хук `MML_TEST` работает только в незапакованной программе. В тестовом режиме `openUrl/openLink` не открывают браузер. Новую функцию — сразу покрывать проверкой в `test/e2e.js`.
- **Никогда не менять** `build.appId` и `productName` в package.json (по ним установщик удаляет прошлую версию, а программа находит данные).

## Git и релизы
- Ветки: `dev` — работа, `main` — стабильная. Коммиты с подписью `Co-Authored-By: Claude …`.
- Выпуск: поднять `version` в package.json → запись в `CHANGELOG.md` + 2–3 предложения в `src/js/changelog.js` → `npm test` → `npm run screenshots` (если менялся вид) → коммит в dev → `git checkout main && git merge --ff-only dev` → `git tag -a vX.Y.Z` → `npm run dist` → `git push origin main dev vX.Y.Z` → релиз на GitHub.
- `gh` не установлен. Релиз создаётся через REST API токеном из `git credential fill` (host=github.com; токен не выводить): `POST /repos/Arsipa/MyMusicLibrary/releases`, затем загрузка `dist/MyMusicLibrary-Setup-X.Y.Z.exe` и `dist/README.txt` (скопировать из корня) на `uploads.github.com/.../releases/<id>/assets?name=…`. Текст релиза — на русском, с инструкцией «Как обновиться» и строкой «💜 Сделано с любовью для моей любимой девушки — полностью с помощью Claude».
- Документы: `README.md` (GitHub, для людей и разработчиков), `README.txt` (пользователю, очень простым языком), `CHANGELOG.md`.
