'use strict';
/* Главный экран, страница трека, запуск приложения. */

const App = (() => {
  let detailId = null;
  let banners = { missing: [], orphans: [] };

  /* ---------- Сетка ---------- */
  function renderGrid() {
    const grid = document.getElementById('grid');
    const empty = document.getElementById('empty');
    const head = document.getElementById('libHead');
    const ready = Lib.tracks().filter((t) => t.status !== 'draft');
    const visible = Filters.sort(ready.filter(Filters.match));

    clear(head);
    if (ready.length) {
      const pills = Filters.activePills();
      appendChildren(head, [
        h('h2.lib-count', null, h('span.big', { text: visible.length }), h('span', { text: Filters.isActive() ? ` из ${ready.length} ${plural(ready.length, 'песни', 'песен', 'песен')}` : ` ${plural(visible.length, 'песня', 'песни', 'песен')} в библиотеке` })),
        pills.length ? h('div.active-pills', null, pills, h('button.link-btn', { text: 'сбросить всё', on: { click: () => Filters.reset() } })) : null
      ]);
    }

    const frag = document.createDocumentFragment();
    for (const t of visible) frag.appendChild(Cards.card(t));
    clear(grid).appendChild(frag);

    empty.hidden = visible.length > 0;
    if (!visible.length) renderEmpty(empty, ready.length === 0);
  }

  function renderEmpty(el, libraryEmpty) {
    clear(el);
    if (libraryEmpty) {
      const drafts = Lib.tracks().filter((t) => t.status === 'draft').length;
      el.append(
        h(
          'div.welcome',
          null,
          h(
            'div.welcome-art',
            { html: welcomeSvg() }
          ),
          h('h2.welcome-title', null, 'Здесь будет звучать', h('br'), h('em', { text: 'твоя музыка' })),
          h('p.welcome-text', { text: drafts ? 'Закончи заполнять добавленные треки (они чуть выше) — и они появятся здесь.' : 'Добавь первую минусовку: выбери файл на компьютере или просто перетащи его в это окно.' }),
          h('button.btn-add.big', { on: { click: () => Tracks.pickAndAdd() } }, h('span.btn-add-icon', { icon: 'plus' }), h('span.btn-add-label', { html: 'Добавить<br>первый трек' })),
          h('p.muted.small', { text: 'MP3, MP4, M4A, WAV, AAC, FLAC, OGG и другие' })
        )
      );
    } else {
      el.append(
        h(
          'div.nothing',
          null,
          h('span.nothing-ic', { icon: 'search' }),
          h('h3', { text: 'Ничего не нашлось' }),
          h('p.muted', { text: 'Попробуйте ослабить фильтры или изменить запрос.' }),
          h('button.btn.btn-soft', { on: { click: () => Filters.reset() } }, h('span', { icon: 'undo' }), 'Сбросить фильтры')
        )
      );
    }
  }

  function welcomeSvg() {
    return `<svg viewBox="0 0 320 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs><radialGradient id="wg" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#d6ff3d"/><stop offset=".2" stop-color="#d6ff3d"/><stop offset=".22" stop-color="#24093f"/><stop offset="1" stop-color="#3b1366"/></radialGradient></defs>
      <path d="M40 150c-20-60 30-120 100-118s140 40 140 98-60 90-130 86S56 196 40 150z" fill="#c8b3ff" opacity=".55"/>
      <g class="w-vinyl"><circle cx="150" cy="115" r="78" fill="url(#wg)"/><circle cx="150" cy="115" r="62" fill="none" stroke="#9d5cff" stroke-opacity=".35" stroke-width="1.5"/><circle cx="150" cy="115" r="48" fill="none" stroke="#9d5cff" stroke-opacity=".3" stroke-width="1.5"/><circle cx="150" cy="115" r="4" fill="#24093f"/><path d="M110 70a60 60 0 0 1 30-14" stroke="#fff" stroke-opacity=".35" stroke-width="5" stroke-linecap="round" fill="none"/></g>
      <g class="w-note n1"><path d="M250 40v42" stroke="#7b2ff7" stroke-width="6" stroke-linecap="round"/><path d="M250 40c10 2 18 8 20 18" stroke="#7b2ff7" stroke-width="6" stroke-linecap="round" fill="none"/><ellipse cx="242" cy="84" rx="11" ry="8" fill="#7b2ff7"/></g>
      <g class="w-note n2"><path d="M58 52v34M84 46v34M58 52l26-6" stroke="#ff6b9a" stroke-width="5.5" stroke-linecap="round" fill="none"/><ellipse cx="51" cy="88" rx="9" ry="7" fill="#ff6b9a"/><ellipse cx="77" cy="82" rx="9" ry="7" fill="#ff6b9a"/></g>
      <path class="w-spark" d="M270 150c1 9 5 13 14 14-9 1-13 5-14 14-1-9-5-13-14-14 9-1 13-5 14-14z" fill="#ffc94a"/>
      <path class="w-spark s2" d="M40 180c.7 6 3.3 8.6 9.3 9.3-6 .7-8.6 3.3-9.3 9.3-.7-6-3.3-8.6-9.3-9.3 6-.7 8.6-3.3 9.3-9.3z" fill="#7b2ff7"/>
    </svg>`;
  }

  /* ---------- Незаполненные треки ---------- */
  function renderDrafts() {
    const box = document.getElementById('drafts');
    const drafts = Lib.tracks().filter((t) => t.status === 'draft');
    box.hidden = !drafts.length;
    clear(box);
    if (!drafts.length) return;
    box.append(
      h('div.drafts-head', null, h('span', { icon: 'edit' }), h('b', { text: 'Ждут заполнения' }), h('span.muted.small', { text: `${drafts.length} ${plural(drafts.length, 'трек', 'трека', 'треков')} ещё не заполнены до конца` })),
      h(
        'div.drafts-list',
        null,
        drafts.map((t) =>
          h(
            'div.draft-item',
            null,
            Cards.art(t, true),
            h('span.draft-title', { text: t.title, title: t.originalFileName }),
            h('button.btn.btn-primary.sm', { on: { click: () => Tracks.openForm(t.id, { mode: 'new' }) } }, 'Дозаполнить')
          )
        )
      )
    );
  }

  /* ---------- Плашки о проблемах ---------- */
  function setBanners(res) {
    banners = { missing: res.missing || [], orphans: res.orphans || [] };
    renderBanners();
  }
  function renderBanners() {
    const box = document.getElementById('banners');
    clear(box);
    const missing = Lib.tracks().filter((t) => S.runtime.missing.has(t.id));
    if (missing.length) {
      box.appendChild(
        h(
          'div.banner.warn',
          null,
          h('span', { icon: 'warn' }),
          h('span', { text: `У ${missing.length} ${plural(missing.length, 'трека', 'треков', 'треков')} не найден музыкальный файл. Откройте такой трек, чтобы указать файл заново, или восстановите библиотеку из копии.` }),
          h('button.btn.btn-soft.sm', { on: { click: () => openDetail(missing[0].id) } }, 'Показать')
        )
      );
    }
    if (banners.orphans.length) {
      box.appendChild(
        h(
          'div.banner',
          null,
          h('span', { icon: 'sparkle' }),
          h('span', { text: `В хранилище нашлось ${banners.orphans.length} ${plural(banners.orphans.length, 'файл', 'файла', 'файлов')} без карточек (например, после сбоя во время добавления).` }),
          h(
            'button.btn.btn-primary.sm',
            {
              on: {
                click: async () => {
                  const o = banners.orphans;
                  banners.orphans = [];
                  await Tracks.adoptOrphans(o);
                  UI.toast('Файлы возвращены — заполните их карточки', { kind: 'ok' });
                },
              },
            },
            'Вернуть в библиотеку'
          )
        )
      );
    }
  }

  /* ---------- Страница трека ---------- */
  function openDetail(id) {
    detailId = id;
    renderDetail();
    const el = document.getElementById('detail');
    el.hidden = false;
    el.scrollTop = 0;
    document.body.classList.add('detail-open');
  }

  function closeDetail(onlyId) {
    if (onlyId && onlyId !== detailId) return;
    detailId = null;
    const el = document.getElementById('detail');
    el.hidden = true;
    clear(el);
    document.body.classList.remove('detail-open');
    Player.unmountVideo();
  }

  function renderDetail() {
    const el = document.getElementById('detail');
    const t = detailId && Lib.track(detailId);
    if (!t) return closeDetail();
    const a = artFor(t.id);
    const playing = Player.isPlaying(t.id);
    const missing = S.runtime.missing.has(t.id);
    const scroll = el.scrollTop;
    clear(el);

    const attrList = h('div.d-attrs');
    for (const at of Lib.attrs()) {
      attrList.appendChild(
        h(
          'div.d-attr.t-' + at.type,
          null,
          h('div.d-attr-name', null, h('span', { icon: ATTR_TYPES[at.type].icon }), at.name),
          h('div.d-attr-val', null, Attr.display(at, t.attributes[at.id], at.type === 'scale' ? { onScaleChange: (v) => Tracks.setAttr(t.id, at.id, Number(t.attributes[at.id]) === v ? null : v) } : {}))
        )
      );
    }
    if (!Lib.attrs().length) attrList.appendChild(h('p.muted', { text: 'Атрибутов пока нет.' }));

    const cats = t.categories.map((id) => Lib.cat(id)).filter(Boolean);
    const videoStage = t.hasVideo ? h('div.d-video') : null;

    el.append(
      h(
        'div.d-wrap',
        { style: { '--c1': a.pal[0], '--c2': a.pal[1], '--c3': a.pal[2] } },
        h(
          'div.d-top',
          null,
          h('button.d-back', { on: { click: () => closeDetail() } }, h('span', { icon: 'back' }), 'К библиотеке'),
          h('span.spacer'),
          h('button.btn.btn-soft', { on: { click: () => Tracks.openForm(t.id, { mode: t.status === 'draft' ? 'new' : 'edit' }) } }, h('span', { icon: 'edit' }), 'Редактировать'),
          h(
            'button.icon-btn',
            {
              title: 'Ещё',
              icon: 'more',
              on: {
                click: (e) =>
                  UI.menu(e.currentTarget, [
                    { label: 'Заменить файл минусовки', icon: 'replace', onClick: () => Tracks.replaceFile(t.id) },
                    ...(missing ? [] : [{ label: 'Сохранить копию файла…', icon: 'download', onClick: () => Tracks.saveCopy(t.id) }]),
                    '-',
                    { label: 'Удалить трек', icon: 'trash', danger: true, onClick: () => Tracks.remove(t.id) },
                  ]),
              },
            }
          )
        ),
        h(
          'div.d-hero',
          null,
          h(
            'div.d-art-wrap',
            null,
            videoStage || Cards.art(t),
            !videoStage && Player.current() === t.id ? Cards.eq() : null,
            h('button.d-play' + (playing ? '.on' : ''), { title: playing ? 'Пауза' : 'Играть', html: icon(playing ? 'pause' : 'play'), on: { click: () => Player.toggle(t.id) } })
          ),
          h(
            'div.d-head',
            null,
            cats.length ? h('div.d-cats', null, cats.map((c) => h('span.cat-pill.on', { style: { '--c': c.color } }, h('span.cat-pill-dot'), c.name))) : null,
            h('h1.d-title', { text: t.title }),
            h(
              'div.d-file',
              null,
              h('span', { icon: t.hasVideo ? 'video' : 'note' }),
              h('span', { text: [t.originalFileName, t.duration ? fmtTime(t.duration) : null, fmtSize(t.size)].filter(Boolean).join(' · ') })
            ),
            t.clipUrl
              ? h(
                  'button.d-clip',
                  { title: t.clipUrl, on: { click: () => openClip(t) } },
                  h('span.d-clip-ic', { icon: 'video' }),
                  h('span.d-clip-text', null, h('b', { text: 'Смотреть клип' }), h('span', { text: siteName(t.clipUrl) })),
                  h('span', { icon: 'open' })
                )
              : null,
            missing
              ? h('div.note-warn', null, h('span', { icon: 'warn' }), 'Музыкальный файл не найден. ', h('button.link-btn', { text: 'Указать файл заново', on: { click: () => Tracks.replaceFile(t.id) } }))
              : null,
            t.status === 'draft'
              ? h('div.note-warn', null, h('span', { icon: 'edit' }), 'Трек заполнен не до конца. ', h('button.link-btn', { text: 'Дозаполнить', on: { click: () => Tracks.openForm(t.id, { mode: 'new' }) } }))
              : null,
            h('div.d-dates', null, h('span', null, 'Добавлен ', h('b', { text: fmtDate(t.createdAt) })), h('span', null, 'Изменён ', h('b', { text: fmtDate(t.updatedAt) })))
          )
        ),
        h(
          'div.d-cols',
          null,
          h('section.d-panel', null, h('h2.d-h', { text: 'Характеристики' }), attrList),
          h(
            'section.d-panel.d-notes',
            null,
            h('h2.d-h', { text: 'Комментарий' }),
            t.notes ? h('p.d-note-text', { text: t.notes }) : h('p.muted', null, 'Пока пусто. ', h('button.link-btn', { text: 'Добавить заметку', on: { click: () => Tracks.openForm(t.id, { mode: t.status === 'draft' ? 'new' : 'edit' }) } }))
          )
        )
      )
    );
    if (videoStage) {
      if (Player.current() === t.id) Player.mountVideo(videoStage);
      else {
        Player.unmountVideo();
        videoStage.appendChild(Cards.art(t));
        videoStage.appendChild(h('span.d-video-hint', null, h('span', { icon: 'video' }), 'Нажмите «играть», чтобы смотреть видео'));
      }
    } else Player.unmountVideo();
    el.scrollTop = scroll;
  }

  /* ---------- Общая перерисовка ---------- */
  function refresh() {
    Filters.renderBar();
    Filters.renderPanel();
    renderDrafts();
    renderGrid();
    renderBanners();
    if (detailId) renderDetail();
    Player.refresh();
  }

  // При смене состояния плеера обновляем только кнопки, а не весь экран
  const lightRefresh = () => {
    document.querySelectorAll('.card').forEach((c) => {
      const id = c.dataset.id;
      const playing = Player.isPlaying(id);
      const current = Player.current() === id;
      c.classList.toggle('playing', playing);
      c.classList.toggle('current', current);
      const btn = c.querySelector('.card-play');
      if (btn) {
        btn.innerHTML = icon(playing ? 'pause' : 'play');
        btn.classList.toggle('on', playing);
      }
      const art = c.querySelector('.art');
      const eq = art && art.querySelector('.eq');
      if (current && !eq) art.appendChild(Cards.eq());
      if (!current && eq) eq.remove();
    });
    if (detailId) {
      const btn = document.querySelector('.d-play');
      const playing = Player.isPlaying(detailId);
      if (btn) {
        btn.innerHTML = icon(playing ? 'pause' : 'play');
        btn.classList.toggle('on', playing);
      }
      const t = Lib.track(detailId);
      const stage = document.querySelector('.d-video');
      if (t && t.hasVideo && stage && Player.current() === detailId && !stage.querySelector('video')) renderDetail();
      if (t && !t.hasVideo && stage) renderDetail();
      const wrap = document.querySelector('.d-art-wrap');
      if (wrap && !stage) {
        const has = wrap.querySelector('.eq');
        if (Player.current() === detailId && !has) wrap.insertBefore(Cards.eq(), wrap.querySelector('.d-play'));
        if (Player.current() !== detailId && has) has.remove();
      }
    }
  };

  /* ---------- Перетаскивание файлов ---------- */
  function setupDrop() {
    const hint = document.getElementById('dropHint');
    let depth = 0;
    const hasFiles = (e) => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      hint.hidden = false;
    });
    window.addEventListener('dragleave', (e) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) hint.hidden = true;
    });
    window.addEventListener('dragover', (e) => {
      if (hasFiles(e)) e.preventDefault();
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      hint.hidden = true;
      if (UI.hasModal()) return;
      const paths = [...(e.dataTransfer.files || [])].map((f) => window.api.pathForFile(f)).filter(Boolean);
      if (paths.length) Tracks.addFromPaths(paths);
    });
  }

  /* ---------- Запуск ---------- */
  async function init() {
    hydrateIcons();
    document.getElementById('btnAdd').addEventListener('click', () => Tracks.pickAndAdd());
    document.getElementById('btnAttributes').addEventListener('click', () => AttributesManager.open());
    document.getElementById('btnCategories').addEventListener('click', () => Categories.open());
    document.getElementById('btnSettings').addEventListener('click', () => Backup.open());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && detailId && !UI.hasModal()) closeDetail();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && !UI.hasModal()) {
        e.preventDefault();
        closeDetail();
        Filters.focusSearch();
      }
    });
    setupDrop();
    const appEl = document.getElementById('app');
    appEl.addEventListener('scroll', () => appEl.classList.toggle('scrolled', appEl.scrollTop > 60), { passive: true });

    let problems;
    try {
      problems = await Store.load();
    } catch (e) {
      await UI.alert({ title: 'Не удалось открыть библиотеку', text: String(e.message || e) });
      return;
    }
    if (problems.length) {
      await Backup.recoveryScreen(problems);
      location.reload();
      return;
    }
    Player.init();
    Player.onChange(lightRefresh);
    refresh();
    document.body.classList.add('ready');
    if (!S.settings.tutorialDone) setTimeout(() => Tour.start(), 700);
    // фоновые задачи после показа интерфейса
    setTimeout(async () => {
      await Backup.integrity();
      await Backup.periodic();
    }, 400);
  }

  return { init, refresh, renderGrid, openDetail, closeDetail, setBanners };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
