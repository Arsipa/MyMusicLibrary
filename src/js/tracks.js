'use strict';
/* Треки: карточки, добавление, форма атрибутов, редактирование, удаление, корзина. */

/** Открыть ссылку на клип в браузере */
async function openClip(t) {
  const r = await window.api.openUrl(t.clipUrl);
  if (!r.ok) UI.toast('Не получилось открыть ссылку. Проверьте её в карточке песни.', { kind: 'error' });
}

const Cards = (() => {
  function art(t, mini) {
    const a = artFor(t.id);
    const el = h('div.art.art-s' + a.shape + (mini ? '.mini' : ''), {
      style: { '--a1': a.pal[0], '--a2': a.pal[1], '--a3': a.pal[2], '--rot': a.rot + 'deg', '--pos': a.pos + '%' },
    });
    if (t.cover) {
      el.classList.add('has-cover');
      el.appendChild(h('img', { src: coverUrl(t.cover), alt: '', loading: 'lazy', draggable: 'false', on: { error: (e) => e.target.remove() } }));
    } else {
      el.append(h('span.art-shape.s1'), h('span.art-shape.s2'), h('span.art-shape.s3'));
      if (!mini) el.appendChild(h('span.art-letter', { text: (t.title || '?').trim().charAt(0).toUpperCase() }));
    }
    return el;
  }

  function eq() {
    return h('span.eq', null, h('i'), h('i'), h('i'), h('i'), h('i'));
  }

  function snippet(t) {
    let text = (t.notes || '').trim();
    if (!text) {
      const a = Lib.attrs().find((x) => x.type === 'textarea' && !Attr.isEmpty(x, t.attributes[x.id]));
      if (a) text = String(t.attributes[a.id]).trim();
    }
    if (!text) return null;
    text = text.replace(/\s+/g, ' ');
    return text.length > 110 ? text.slice(0, 105).replace(/\s+\S*$/, '') + '…' : text;
  }

  function card(t) {
    const a = artFor(t.id);
    const playing = Player.isPlaying(t.id);
    const current = Player.current() === t.id;
    const missing = S.runtime.missing.has(t.id);
    const artEl = art(t);
    if (current) artEl.appendChild(eq());
    if (t.hasVideo) artEl.appendChild(h('span.art-badge', { icon: 'video', title: 'Есть видео' }));

    const chips = h('div.card-chips');
    let meter = null;
    for (const at of Lib.attrs()) {
      if (!at.showOnCard) continue;
      const v = t.attributes[at.id];
      if (at.type === 'scale') {
        if (meter) continue;
        const val = Attr.isEmpty(at, v) ? 0 : Number(v);
        const n = at.max - at.min + 1;
        const bars = h('div.meter-bars');
        for (let i = 0; i < n; i++) bars.appendChild(h('i' + (at.min + i <= val && val ? '.on' : ''), { style: { '--i': i / Math.max(1, n - 1) } }));
        meter = h('div.card-meter', { title: `${at.name}: ${val ? val + ' из ' + at.max : 'не указано'}` }, h('span.meter-label', { text: at.name }), bars, h('b.meter-val', { text: val ? val : '—' }));
      } else if (at.type === 'select' && !Attr.isEmpty(at, v)) {
        chips.appendChild(h('span.chip', { style: { '--c': Attr.optionColor(at, v) }, text: Attr.optionLabel(at, v) }));
      } else if (at.type === 'multiselect' && !Attr.isEmpty(at, v)) {
        for (const id of v.slice(0, 3)) if (Attr.optionLabel(at, id)) chips.appendChild(h('span.chip', { style: { '--c': Attr.optionColor(at, id) }, text: Attr.optionLabel(at, id) }));
      } else if ((at.type === 'number' || at.type === 'text') && !Attr.isEmpty(at, v)) {
        const s = `${at.name}: ${v}`;
        chips.appendChild(h('span.chip.chip-plain', { text: s.length > 28 ? s.slice(0, 27) + '…' : s }));
      }
    }
    const snip = snippet(t);
    const cats = t.categories.map((id) => Lib.cat(id)).filter(Boolean);

    const el = h(
      'article.card' + (current ? '.current' : '') + (playing ? '.playing' : '') + (missing ? '.missing' : '') + (t.status === 'draft' ? '.draft' : ''),
      {
        dataset: { id: t.id },
        style: { '--tilt': a.tilt + 'deg', '--c1': a.pal[0], '--c2': a.pal[1], '--c3': a.pal[2] },
        tabindex: 0,
        on: {
          click: (e) => {
            if (e.target.closest('button')) return;
            App.openDetail(t.id);
          },
          keydown: (e) => {
            if (e.key === 'Enter' && e.target === el) App.openDetail(t.id);
          },
          contextmenu: (e) => {
            e.preventDefault();
            menuFor(t.id, null, { x: e.clientX, y: e.clientY });
          },
        },
      },
      h(
        'div.card-art',
        null,
        artEl,
        h('button.card-play' + (playing ? '.on' : ''), {
          title: playing ? 'Пауза' : 'Играть',
          html: icon(playing ? 'pause' : 'play'),
          on: { click: () => Player.toggle(t.id) },
        }),
        cats.length ? h('div.card-cats', null, cats.slice(0, 4).map((c) => h('span.card-cat', { style: { '--c': c.color }, title: c.name, text: c.name }))) : null
      ),
      h(
        'div.card-body',
        null,
        missing ? h('div.card-warn', null, h('span', { icon: 'warn' }), 'Файл не найден') : null,
        t.status === 'draft' ? h('div.card-warn.draft', null, h('span', { icon: 'edit' }), 'Не заполнено до конца') : null,
        t.artist ? h('div.card-artist', { text: t.artist, title: t.artist }) : null,
        h('h3.card-title', { text: t.title, title: fullTitle(t) }),
        chips.children.length ? chips : null,
        meter,
        snip ? h('p.card-note', { text: snip }) : null,
        h(
          'div.card-foot',
          null,
          h('span.card-dur', { text: t.duration ? fmtTime(t.duration) : '' }),
          t.clipUrl ? h('button.icon-btn.sm.card-clip', { title: 'Открыть клип: ' + siteName(t.clipUrl), 'aria-label': 'Открыть клип', icon: 'link', on: { click: () => openClip(t) } }) : null,
          h('button.card-open', { on: { click: () => App.openDetail(t.id) } }, 'Подробнее', h('span', { icon: 'back' })),
          h('button.icon-btn.sm.card-more', { title: 'Ещё', icon: 'more', on: { click: (e) => menuFor(t.id, e.currentTarget) } })
        )
      )
    );
    return el;
  }

  function menuFor(id, anchor, point) {
    const t = Lib.track(id);
    if (!t) return;
    UI.menu(
      anchor,
      [
        { label: Player.isPlaying(id) ? 'Пауза' : 'Играть', icon: Player.isPlaying(id) ? 'pause' : 'play', onClick: () => Player.toggle(id) },
        { label: 'Открыть подробно', icon: 'open', onClick: () => App.openDetail(id) },
        { label: t.status === 'draft' ? 'Дозаполнить' : 'Редактировать', icon: 'edit', onClick: () => Tracks.openForm(id, { mode: t.status === 'draft' ? 'new' : 'edit' }) },
        '-',
        { label: 'Удалить', icon: 'trash', danger: true, onClick: () => Tracks.remove(id) },
      ],
      point
    );
  }

  return { card, art, eq, snippet, menuFor };
})();

const Tracks = (() => {
  const basename = (p) => String(p).split(/[\\/]/).pop();

  function probe(fileName) {
    return new Promise((resolve) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      let done = false;
      const fin = (r) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        v.removeAttribute('src');
        v.load();
        resolve(r);
      };
      v.onloadedmetadata = () => fin({ ok: true, duration: isFinite(v.duration) ? Math.round(v.duration) : null, hasVideo: v.videoWidth > 0 });
      v.onerror = () => fin({ ok: false });
      const timer = setTimeout(() => fin({ ok: true, duration: null, hasVideo: false }), 15000);
      v.src = mediaUrl(fileName);
    });
  }

  async function pickAndAdd() {
    const r = await window.api.pickTracks();
    if (!r.ok) return UI.toast(r.message, { kind: 'error' });
    await addFromPaths(r.value);
  }

  async function addFromPaths(paths) {
    if (!paths || !paths.length) return;
    let busy = null; // индикатор показываем только на время копирования, не поверх вопросов
    const added = [];
    const errors = [];
    let skipped = 0;
    try {
      for (let i = 0; i < paths.length; i++) {
        const name = basename(paths[i]);
        // дубликат? спрашиваем ДО копирования и до формы
        const guess = parseFileName(name);
        const dups = duplicatesOf({ id: null, originalFileName: name, title: guess.title, artist: guess.artist });
        if (dups.length) {
          if (busy) {
            busy.done();
            busy = null;
          }
          const answer = await askDuplicate(name, dups);
          if (answer !== 'add') {
            skipped++;
            continue;
          }
        }
        if (!busy) busy = UI.busy('Копирую в библиотеку…');
        busy.set(paths.length > 1 ? `Копирую ${i + 1} из ${paths.length}: ${name}` : `Копирую «${name}»…`);
        const r = await window.api.importTrack(paths[i]);
        if (!r.ok) {
          errors.push(`${name} — ${r.message}`);
          continue;
        }
        const info = r.value;
        const p = await probe(info.fileName);
        if (!p.ok) {
          await window.api.removeTrackFile(info.fileName);
          errors.push(`${name} — файл повреждён или не воспроизводится, поэтому не добавлен`);
          continue;
        }
        const now = new Date().toISOString();
        const names = parseFileName(info.originalFileName);
        const t = {
          id: uid('trk_'),
          title: names.title,
          artist: names.artist || undefined,
          originalFileName: info.originalFileName,
          fileName: info.fileName,
          filePath: 'storage/tracks/' + info.fileName,
          mime: info.mime,
          size: info.size,
          duration: p.duration,
          hasVideo: p.hasVideo,
          cover: null,
          notes: '',
          categories: [],
          attributes: {},
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        };
        S.library.tracks.push(t);
        // сразу записываем черновик — так скопированный файл никогда не окажется «ничьим»
        if (!(await Store.save('library'))) {
          S.library.tracks.pop();
          await window.api.removeTrackFile(info.fileName);
          errors.push(`${name} — не удалось сохранить запись о треке`);
          continue;
        }
        added.push(t);
      }
    } finally {
      if (busy) busy.done();
    }
    App.refresh();
    if (skipped) UI.toast(skipped === 1 ? 'Дубликат не добавлен' : `Не добавлено дубликатов: ${skipped}`);
    if (errors.length) {
      await UI.alert({
        title: added.length ? 'Не все файлы получилось добавить' : 'Файл не добавлен',
        text: added.length ? `Добавлено: ${added.length}. С остальными проблема:` : '',
        list: errors,
      });
    }
    for (let i = 0; i < added.length; i++) {
      const res = await openForm(added[i].id, { mode: 'new', queue: added.length > 1 ? `${i + 1} из ${added.length}` : null });
      if (res === 'stop') break;
    }
  }

  /** Окно «Похоже, это дубликат» — показывает, что уже есть в библиотеке. Возвращает 'add' или null */
  function askDuplicate(fileName, dups) {
    const list = h(
      'div.dup-list',
      null,
      dups.slice(0, 3).map((d) =>
        h(
          'div.dup-item',
          null,
          Cards.art(d, true),
          h(
            'div.dup-main',
            null,
            h('b', { text: fullTitle(d) }),
            h('span', { text: [`добавлена ${fmtDate(d.createdAt, false)}`, d.originalFileName, d.duration ? fmtTime(d.duration) : null].filter(Boolean).join(' · ') })
          )
        )
      ),
      dups.length > 3 ? h('p.muted.small', { text: `и ещё ${dups.length - 3}` }) : null
    );
    return UI.choose({
      title: 'Похоже, эта песня уже есть',
      text: `Файл «${fileName}» похож на ${dups.length > 1 ? 'песни, которые уже лежат' : 'песню, которая уже лежит'} в библиотеке:`,
      icon: 'warn',
      extra: h('div', null, list, h('p.muted.small.dup-hint', { text: 'Если это та же самая минусовка — просто отмените, ничего не скопируется. Если другая версия — добавьте её.' })),
      choices: [
        { id: 'add', label: 'Всё равно добавить', kind: 'primary' },
        { id: 'skip', label: 'Отменить, это дубликат', kind: 'ghost' },
      ],
    });
  }

  /** Похожие треки в библиотеке: тот же исходный файл или то же название (и исполнитель, если он известен у обоих) */
  function duplicatesOf(t) {
    const same = (x) => {
      if (x.originalFileName && x.originalFileName === t.originalFileName) return true;
      if (normalize(x.title) !== normalize(t.title)) return false;
      return !x.artist || !t.artist || normalize(x.artist) === normalize(t.artist);
    };
    return Lib.tracks().filter((x) => x.id !== t.id && x.status !== 'draft' && same(x));
  }

  /**
   * Форма трека. mode: 'new' (новый/черновик — обязательные поля проверяются) или 'edit'.
   * Возвращает Promise: 'saved' | 'later' | 'cancelled' | 'deleted' | 'stop'
   */
  function openForm(id, { mode = 'edit', queue } = {}) {
    return new Promise((resolve) => {
      const t = Lib.track(id);
      if (!t) return resolve('cancelled');
      const isNew = mode === 'new' || t.status === 'draft';
      let dirty = false;
      let pendingCover = t.cover;
      const originalCover = t.cover;
      let result = null;

      const titleInp = h('input.input.input-title', { type: 'text', value: t.title, placeholder: 'Название песни' });
      const titleErr = h('p.field-error', { hidden: true });
      const artistInp = h('input.input.input-artist', { type: 'text', value: t.artist || '', placeholder: 'Кто исполняет или автор' });
      const fields = [];
      const attrsBox = h('div.form-attrs');
      // атрибут можно создать прямо отсюда — его поле сразу появится в форме, введённое раньше не пропадёт
      const addAttrBtn = h(
        'button.btn.btn-soft.sm.add-attr-btn',
        {
          type: 'button',
          on: {
            click: () =>
              AttributesManager.create((a) => {
                attrsBox.querySelector(':scope > .muted')?.remove();
                const row = addFieldRow(a);
                attrsBox.appendChild(row);
                requestAnimationFrame(() => {
                  row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  row.classList.add('just-added');
                });
              }),
          },
        },
        h('span', { icon: 'plus' }),
        'Новый атрибут'
      );
      function addFieldRow(a) {
        const f = Attr.field(a, t.attributes[a.id], { onChange: () => (dirty = true) });
        const err = h('p.field-error', { hidden: true });
        const wasEmpty = Attr.isEmpty(a, t.attributes[a.id]);
        f.err = err;
        const row = h(
          'div.form-field' + (a.type === 'textarea' || a.type === 'scale' ? '.wide' : ''),
          { dataset: { attr: a.id } },
          h('div.field-label', null, h('span', { icon: ATTR_TYPES[a.type].icon }), a.name, a.required ? h('b.req', { text: '*', title: 'Обязательно' }) : null),
          f.el,
          err
        );
        fields.push({ a, f, err, row, wasEmpty });
        return row;
      }
      for (const a of Lib.attrs()) attrsBox.appendChild(addFieldRow(a));
      if (!Lib.attrs().length) attrsBox.appendChild(h('p.muted', { text: 'Характеристик пока нет — создайте первую кнопкой «Новый атрибут».' }));

      const cats = Categories.picker(t.categories);
      const notes = h('textarea.input.textarea', { rows: 3, placeholder: 'Любые мысли: что получается, над чем поработать…' });
      notes.value = t.notes || '';
      const clipInp = h('input.input', { type: 'url', value: t.clipUrl || '', placeholder: 'Например: https://www.youtube.com/watch?v=…', spellcheck: 'false' });
      const clipErr = h('p.field-error', { hidden: true });

      const coverBox = h('div.cover-box');
      const paintCover = () => {
        clear(coverBox);
        const preview = Cards.art({ ...t, cover: pendingCover }, true);
        coverBox.append(
          preview,
          h(
            'div.cover-btns',
            null,
            h('button.btn.btn-soft.sm', { type: 'button', on: { click: pickCover } }, h('span', { icon: 'image' }), pendingCover ? 'Другая картинка' : 'Выбрать обложку'),
            pendingCover ? h('button.btn.btn-ghost.sm', { type: 'button', on: { click: dropCover } }, 'Убрать') : h('span.muted.small', { text: 'Необязательно. Без обложки нарисуем узор.' })
          )
        );
      };
      async function pickCover() {
        const r = await window.api.pickCover();
        if (!r.ok) return UI.toast(r.message, { kind: 'error' });
        if (!r.value) return;
        if (pendingCover && pendingCover !== originalCover) window.api.removeCover(pendingCover);
        pendingCover = r.value.fileName;
        dirty = true;
        paintCover();
      }
      function dropCover() {
        if (pendingCover && pendingCover !== originalCover) window.api.removeCover(pendingCover);
        pendingCover = null;
        dirty = true;
        paintCover();
      }
      paintCover();

      // «Послушать» ⇄ «Пауза» — следим за общим плеером, пока открыта форма
      const listenBtn = h('button.btn.btn-soft.sm.listen-btn', { type: 'button', on: { click: () => Player.toggle(t.id) } });
      const paintListen = () => {
        const playing = Player.isPlaying(t.id);
        listenBtn.innerHTML = icon(playing ? 'pause' : 'play');
        listenBtn.append(playing ? 'Пауза' : 'Послушать');
        listenBtn.classList.toggle('on', playing);
      };
      paintListen();
      const stopListening = Player.onChange(paintListen);

      const fileInfo = h(
        'div.file-strip',
        null,
        h('span.file-ic', { icon: t.hasVideo ? 'video' : 'note' }),
        h(
          'div.file-meta',
          null,
          h('b', { text: t.originalFileName || 'Файл' }),
          h('span', { text: [(t.fileName.split('.').pop() || '').toUpperCase(), fmtSize(t.size), t.duration ? fmtTime(t.duration) : null, t.hasVideo ? 'с видео' : null].filter(Boolean).join(' · ') })
        ),
        listenBtn
      );

      const body = h(
        'div.track-form',
        { on: { input: () => (dirty = true), click: (e) => e.target.closest('.opt, .scale-cell, .cat-chip') && (dirty = true) } },
        fileInfo,
        h(
          'div.form-top',
          null,
          h(
            'div.form-names',
            null,
            h('div.form-field', null, h('div.field-label', null, 'Название', h('b.req', { text: '*' })), withCounter(titleInp, LIMITS.trackTitle), titleErr),
            h('div.form-field', null, h('div.field-label', null, 'Исполнитель', h('span.muted.small.label-note', { text: '— необязательно' })), withCounter(artistInp, LIMITS.artist))
          ),
          coverBox
        ),
        h('h4.form-section', { text: 'Характеристики' }),
        attrsBox,
        h('div.add-attr-line', null, addAttrBtn),
        h('h4.form-section', { text: 'Категории' }),
        cats.el,
        h('h4.form-section', { text: 'Комментарий' }),
        withCounter(notes, LIMITS.notes),
        h('h4.form-section', { text: 'Клип' }),
        h(
          'div.form-field',
          null,
          h('div.field-label', null, h('span', { icon: 'link' }), 'Ссылка на клип или видео', h('span.muted.small.label-note', { text: '— необязательно' })),
          withCounter(clipInp, LIMITS.clipUrl),
          clipErr
        )
      );

      const m = UI.openModal({
        title: isNew ? (queue ? `Новый трек · ${queue}` : 'Новый трек') : 'Редактирование',
        subtitle: isNew ? 'Заполните характеристики. Поля со звёздочкой обязательны.' : null,
        wide: true,
        className: 'form-modal',
        accent: 'add',
        body,
        onClose: (reason) => {
          if (result) return true;
          handleCancel(reason);
          return false;
        },
        actions: isNew
          ? [
              { label: 'Отменить загрузку', kind: 'ghost-danger', onClick: () => cancelUpload() },
              'spacer',
              { label: 'Заполнить позже', kind: 'ghost', onClick: () => later() },
              { label: 'Сохранить трек', kind: 'primary', icon: 'check', onClick: () => submit() },
            ]
          : [
              'spacer',
              { label: 'Отмена', kind: 'ghost', onClick: () => handleCancel('cancel') },
              { label: 'Сохранить', kind: 'primary', icon: 'check', onClick: () => submit() },
            ],
      });

      function finish(res) {
        stopListening();
        result = res;
        m.close('force');
        resolve(res);
      }

      async function handleCancel() {
        if (isNew) {
          const c = await UI.choose({
            title: 'Трек ещё не сохранён',
            text: 'Файл уже скопирован в библиотеку. Можно вернуться к нему позже — он будет ждать в разделе «Не заполнено до конца».',
            icon: 'note',
            choices: [
              { id: 'delete', label: 'Удалить загрузку', kind: 'ghost-danger' },
              { id: 'later', label: 'Заполнить позже', kind: 'ghost' },
              { id: 'back', label: 'Вернуться к форме', kind: 'primary' },
            ],
          });
          if (c === 'delete') return cancelUpload(true);
          if (c === 'later') return later();
          return;
        }
        if (dirty) {
          const ok = await UI.confirm({ title: 'Не сохранять изменения?', text: 'Внесённые правки пропадут.', okLabel: 'Не сохранять', cancelLabel: 'Вернуться', danger: true });
          if (!ok) return;
        }
        if (pendingCover && pendingCover !== originalCover) window.api.removeCover(pendingCover);
        finish('cancelled');
      }

      async function later() {
        // сохраняем то, что успели ввести, но оставляем статус черновика
        collect(false);
        t.status = 'draft';
        await Store.save('library');
        App.refresh();
        UI.toast('Трек сохранён как незаполненный — можно вернуться к нему в любой момент');
        finish(queue ? 'later' : 'later');
      }

      async function cancelUpload(skipConfirm) {
        if (!skipConfirm) {
          const ok = await UI.confirm({
            title: 'Отменить загрузку?',
            text: 'Копия файла будет удалена из библиотеки. Исходный файл на компьютере останется на месте.',
            okLabel: 'Удалить загрузку',
            danger: true,
            icon: 'trash',
          });
          if (!ok) return;
        }
        Player.forget(t.id);
        S.library.tracks = S.library.tracks.filter((x) => x.id !== t.id);
        await Store.save('library');
        await window.api.removeTrackFile(t.fileName);
        if (pendingCover) window.api.removeCover(pendingCover);
        if (originalCover && originalCover !== pendingCover) window.api.removeCover(originalCover);
        App.refresh();
        finish(queue ? 'cancelled' : 'cancelled');
      }

      function collect(validate) {
        let firstBad = null;
        const title = cleanLine(titleInp.value, LIMITS.trackTitle);
        titleErr.hidden = true;
        if (validate && !title) {
          titleErr.textContent = 'Без названия никак :)';
          titleErr.hidden = false;
          firstBad = firstBad || titleInp;
        }
        const clip = parseClipUrl(clipInp.value);
        clipErr.hidden = true;
        clipInp.classList.remove('bad');
        if (validate && clip.error) {
          clipErr.textContent = clip.error;
          clipErr.hidden = false;
          clipInp.classList.add('bad');
          firstBad = firstBad || clipInp;
        }
        const values = {};
        for (const { a, f, err, row, wasEmpty } of fields) {
          const v = f.get();
          err.hidden = true;
          row.classList.remove('bad');
          const empty = Attr.isEmpty(a, v);
          if (validate && a.required && empty && (isNew || !wasEmpty)) {
            err.textContent = 'Это поле нужно заполнить';
            err.hidden = false;
            row.classList.add('bad');
            firstBad = firstBad || row;
          }
          if (validate && a.type === 'number' && f.bad && f.bad()) {
            err.textContent = 'Введите число, например 120 или 2,5';
            err.hidden = false;
            row.classList.add('bad');
            firstBad = firstBad || row;
          }
          if (validate && !empty && a.type === 'number') {
            if (Math.abs(v) > LIMITS.number) {
              err.textContent = 'Слишком большое число';
              err.hidden = false;
              row.classList.add('bad');
              firstBad = firstBad || row;
            } else if ((a.min !== null && a.min !== undefined && v < a.min) || (a.max !== null && a.max !== undefined && v > a.max)) {
              err.textContent = `Нужно число от ${a.min ?? '…'} до ${a.max ?? '…'}`;
              err.hidden = false;
              row.classList.add('bad');
              firstBad = firstBad || row;
            }
          }
          values[a.id] = empty ? undefined : v;
        }
        if (firstBad) {
          firstBad.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return false;
        }
        t.title = title || t.title;
        const artist = cleanLine(artistInp.value, LIMITS.artist);
        if (artist) t.artist = artist;
        else delete t.artist;
        for (const [k, v] of Object.entries(values)) {
          if (v === undefined) delete t.attributes[k];
          else t.attributes[k] = v;
        }
        t.categories = cats.get();
        t.notes = cleanText(notes.value, LIMITS.notes);
        if (!clip.error) {
          if (clip.url) t.clipUrl = clip.url;
          else delete t.clipUrl;
        }
        if (originalCover && originalCover !== pendingCover) window.api.removeCover(originalCover);
        t.cover = pendingCover || null;
        t.updatedAt = new Date().toISOString();
        return true;
      }

      async function submit() {
        if (!collect(true)) {
          UI.toast('Заполните отмеченные поля', { kind: 'error' });
          return;
        }
        const wasDraft = t.status === 'draft';
        t.status = 'ready';
        const ok = await Store.save('library');
        if (!ok) return;
        App.refresh();
        UI.toast(wasDraft ? `«${t.title}» теперь в библиотеке` : 'Сохранено', { kind: 'ok' });
        finish('saved');
      }
    });
  }

  async function remove(id) {
    const t = Lib.track(id);
    if (!t) return;
    const r = await UI.confirm({
      title: `Удалить «${t.title}»?`,
      text: 'Трек переместится в корзину. В течение 30 дней его можно вернуть: «Настройки» → «Корзина».',
      okLabel: 'Удалить',
      danger: true,
      icon: 'trash',
      checkbox: S.runtime.missing.has(id) ? null : { label: 'Сначала сохранить копию файла себе на компьютер' },
    });
    if (!r) return;
    if (r.checked) {
      const c = await window.api.saveTrackCopy('tracks', t.fileName, t.originalFileName || t.title + '.' + t.fileName.split('.').pop());
      if (!c.ok) return UI.toast(c.message, { kind: 'error' });
      if (!c.value) return UI.toast('Удаление отменено: копия не сохранена');
    }
    Player.forget(id);
    const mv = await window.api.trashTrackFile(t.fileName);
    if (!mv.ok) return UI.alert({ title: 'Не получилось удалить', text: mv.message });
    S.library.tracks = S.library.tracks.filter((x) => x.id !== id);
    if (mv.value) S.library.trash.unshift({ track: t, deletedAt: new Date().toISOString() });
    else if (t.cover) window.api.removeCover(t.cover);
    S.runtime.missing.delete(id);
    await Store.save('library');
    App.closeDetail(id);
    App.refresh();
    if (mv.value) UI.toast(`«${t.title}» в корзине`, { action: { label: 'Вернуть', onClick: () => restore(id) } });
    else UI.toast(`«${t.title}» удалён`);
  }

  async function restore(id) {
    const idx = S.library.trash.findIndex((x) => x.track.id === id);
    if (idx < 0) return;
    const entry = S.library.trash[idx];
    const r = await window.api.untrashTrackFile(entry.track.fileName);
    if (!r.ok) return UI.alert({ title: 'Не получилось вернуть трек', text: r.message });
    S.library.trash.splice(idx, 1);
    entry.track.updatedAt = new Date().toISOString();
    S.library.tracks.push(entry.track);
    await Store.save('library');
    App.refresh();
    UI.toast(`«${entry.track.title}» снова в библиотеке`, { kind: 'ok' });
  }

  async function purge(id, silent) {
    const idx = S.library.trash.findIndex((x) => x.track.id === id);
    if (idx < 0) return;
    const entry = S.library.trash[idx];
    if (!silent) {
      const ok = await UI.confirm({
        title: `Удалить «${entry.track.title}» навсегда?`,
        text: 'Файл будет стёрт из библиотеки. Вернуть его можно будет только из резервной копии, если она была сделана раньше.',
        okLabel: 'Удалить навсегда',
        danger: true,
        icon: 'trash',
      });
      if (!ok) return;
    }
    const r = await window.api.purgeTrashFile(entry.track.fileName);
    if (!r.ok) return UI.toast(r.message, { kind: 'error' });
    if (entry.track.cover) window.api.removeCover(entry.track.cover);
    S.library.trash.splice(S.library.trash.indexOf(entry), 1);
    await Store.save('library');
  }

  async function replaceFile(id) {
    const t = Lib.track(id);
    if (!t) return;
    const ok = await UI.confirm({
      title: 'Заменить файл минусовки?',
      text: 'Все характеристики, категории и комментарии останутся. Старый файл будет удалён из библиотеки (он сохранится в резервных копиях, если они были сделаны).',
      okLabel: 'Выбрать новый файл',
      icon: 'replace',
    });
    if (!ok) return;
    const pick = await window.api.pickTracks();
    if (!pick.ok || !pick.value.length) return;
    const busy = UI.busy('Копирую новый файл…');
    let info, p;
    try {
      const r = await window.api.importTrack(pick.value[0]);
      if (!r.ok) {
        busy.done();
        return UI.alert({ title: 'Файл не заменён', text: r.message });
      }
      info = r.value;
      p = await probe(info.fileName);
      if (!p.ok) {
        await window.api.removeTrackFile(info.fileName);
        busy.done();
        return UI.alert({ title: 'Файл не заменён', text: 'Новый файл повреждён или не воспроизводится.' });
      }
    } finally {
      busy.done();
    }
    Player.forget(id);
    const old = t.fileName;
    Object.assign(t, {
      fileName: info.fileName,
      filePath: 'storage/tracks/' + info.fileName,
      originalFileName: info.originalFileName,
      mime: info.mime,
      size: info.size,
      duration: p.duration,
      hasVideo: p.hasVideo,
      updatedAt: new Date().toISOString(),
    });
    if (await Store.save('library')) await window.api.removeTrackFile(old);
    S.runtime.missing.delete(id);
    App.refresh();
    UI.toast('Файл заменён', { kind: 'ok' });
  }

  async function saveCopy(id) {
    const t = Lib.track(id);
    const r = await window.api.saveTrackCopy('tracks', t.fileName, t.originalFileName || t.title + '.' + t.fileName.split('.').pop());
    if (!r.ok) return UI.toast(r.message, { kind: 'error' });
    if (r.value) UI.toast('Копия сохранена', { kind: 'ok' });
  }

  /** Быстрое изменение значения прямо со страницы трека */
  async function setAttr(id, attrId, value) {
    const t = Lib.track(id);
    if (!t) return;
    const a = Lib.attr(attrId);
    if (Attr.isEmpty(a, value)) delete t.attributes[attrId];
    else t.attributes[attrId] = value;
    t.updatedAt = new Date().toISOString();
    await Store.save('library');
    App.refresh();
  }

  /** Файлы без карточек → черновики */
  async function adoptOrphans(orphans) {
    const busy = UI.busy('Возвращаю файлы в библиотеку…');
    try {
      for (const o of orphans) {
        const p = await probe(o.fileName);
        const now = new Date().toISOString();
        S.library.tracks.push({
          id: uid('trk_'),
          title: 'Найденный трек ' + fmtDate(now, false),
          originalFileName: o.fileName,
          fileName: o.fileName,
          filePath: 'storage/tracks/' + o.fileName,
          size: o.size,
          duration: p.duration,
          hasVideo: p.hasVideo,
          cover: null,
          notes: '',
          categories: [],
          attributes: {},
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        });
      }
      await Store.save('library');
    } finally {
      busy.done();
    }
    App.refresh();
  }

  return { pickAndAdd, addFromPaths, openForm, remove, restore, purge, replaceFile, saveCopy, setAttr, adoptOrphans, probe };
})();
