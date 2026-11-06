'use strict';
/*
 * Видео моих выступлений: к песне можно прикрепить сколько угодно своих видео (сцена, конкурс, репетиция).
 * Файлы копируются в storage/performances/, в треке: t.performances = [{ id, fileName, originalFileName, title, size, duration, hasVideo, addedAt }].
 * (Клип — это ссылка на оригинал исполнителя, t.clipUrl; выступление — своё видео.)
 */

function perfUrl(fileName) {
  return 'mml://perf/' + encodeURIComponent(fileName);
}

const Performances = (() => {
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
      const timer = setTimeout(() => fin({ ok: true, duration: null, hasVideo: true }), 20000);
      v.src = perfUrl(fileName);
    });
  }

  /** Выбрать файлы и прикрепить к песне */
  async function add(trackId, paths) {
    const t = Lib.track(trackId);
    if (!t) return;
    if (!paths) {
      const r = await window.api.pickPerformances();
      if (!r.ok) return UI.toast(r.message, { kind: 'error' });
      paths = r.value;
    }
    if (!paths.length) return;
    const busy = UI.busy('Копирую видео… Большие видео копируются дольше.');
    const errors = [];
    let added = 0;
    try {
      for (let i = 0; i < paths.length; i++) {
        const name = basename(paths[i]);
        busy.set(paths.length > 1 ? `Копирую видео ${i + 1} из ${paths.length}: ${name}` : `Копирую «${name}»… Большие видео копируются дольше.`);
        const r = await window.api.importPerformance(paths[i]);
        if (!r.ok) {
          errors.push(`${name} — ${r.message}`);
          continue;
        }
        const info = r.value;
        const p = await probe(info.fileName);
        if (!p.ok) {
          await window.api.removePerformance(info.fileName);
          errors.push(`${name} — видео повреждено или записано в формате, который не получается воспроизвести`);
          continue;
        }
        const perf = {
          id: uid('perf_'),
          fileName: info.fileName,
          originalFileName: info.originalFileName,
          title: cleanLine(titleFromFile(info.originalFileName), LIMITS.perfTitle),
          size: info.size,
          duration: p.duration,
          hasVideo: p.hasVideo,
          addedAt: new Date().toISOString(),
        };
        t.performances = Array.isArray(t.performances) ? t.performances : [];
        t.performances.push(perf);
        History.record(t, [{ label: 'Видео', from: '', to: perf.title }], 'perf-add');
        t.updatedAt = new Date().toISOString();
        if (!(await Store.save('library'))) {
          t.performances.pop();
          await window.api.removePerformance(info.fileName);
          errors.push(`${name} — не удалось сохранить`);
          continue;
        }
        added++;
      }
    } finally {
      busy.done();
    }
    App.refresh();
    if (errors.length) UI.alert({ title: added ? 'Не все видео добавлены' : 'Видео не добавлено', list: errors });
    else if (added) UI.toast(added > 1 ? `Добавлено видео: ${added}` : 'Видео выступления добавлено', { kind: 'ok' });
  }

  /** Посмотреть выступление — в отдельном окне со своим плеером (музыка в общем плеере ставится на паузу) */
  async function watch(t, perf) {
    const ex = await window.api.performanceExists(perf.fileName);
    if (!ex.ok || !ex.value) {
      return UI.alert({ title: 'Видео не найдено', text: 'Файл этого выступления пропал из хранилища. Его можно удалить из списка и добавить заново или восстановить библиотеку из резервной копии.' });
    }
    Player.pause();
    const video = h('video.perf-player', { controls: true, autoplay: true, playsinline: true, preload: 'auto' });
    video.src = perfUrl(perf.fileName);
    video.addEventListener('play', () => Player.pause());
    video.addEventListener('error', () => UI.toast('Это видео не получается воспроизвести', { kind: 'error' }));
    UI.openModal({
      title: perf.title,
      subtitle: [fullTitle(t), perf.duration ? fmtTime(perf.duration) : null].filter(Boolean).join(' · '),
      wide: true,
      className: 'perf-modal',
      accent: 'cat',
      body: video,
      onClose: () => {
        video.pause();
        video.removeAttribute('src');
        video.load(); // освобождаем файл
      },
      actions: [],
    });
  }

  function rename(t, perf) {
    const inp = h('input.input', { type: 'text', value: perf.title, placeholder: 'Например: Концерт в ДК, май 2026', autofocus: true });
    const save = async (m) => {
      const v = cleanLine(inp.value, LIMITS.perfTitle);
      if (!v) return inp.focus();
      if (v !== perf.title) {
        History.record(t, [{ label: 'Название видео', from: perf.title, to: v }], 'edit');
        perf.title = v;
        t.updatedAt = new Date().toISOString();
        await Store.save('library');
        App.refresh();
      }
      m.close('force');
    };
    const m = UI.openModal({
      title: 'Название выступления',
      className: 'small',
      body: withCounter(inp, LIMITS.perfTitle),
      actions: ['spacer', { label: 'Отмена', kind: 'ghost', onClick: (mm) => mm.close() }, { label: 'Сохранить', kind: 'primary', icon: 'check', onClick: (mm) => save(mm) }],
    });
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && save(m));
  }

  async function remove(t, perf) {
    const r = await UI.confirm({
      title: `Удалить видео «${perf.title}»?`,
      text: 'Видео будет удалено из библиотеки. Исходный файл на компьютере, если он остался, не пострадает.',
      okLabel: 'Удалить',
      danger: true,
      icon: 'trash',
      checkbox: { label: 'Сначала сохранить копию видео себе на компьютер' },
    });
    if (!r) return;
    if (r.checked) {
      const c = await window.api.saveTrackCopy('performances', perf.fileName, perf.originalFileName || perf.title + '.mp4');
      if (!c.ok) return UI.toast(c.message, { kind: 'error' });
      if (!c.value) return UI.toast('Удаление отменено: копия не сохранена');
    }
    t.performances = t.performances.filter((p) => p.id !== perf.id);
    History.record(t, [{ label: 'Видео', from: perf.title, to: '' }], 'perf-remove');
    t.updatedAt = new Date().toISOString();
    if (await Store.save('library')) await window.api.removePerformance(perf.fileName);
    App.refresh();
    UI.toast('Видео удалено');
  }

  async function saveCopy(perf) {
    const r = await window.api.saveTrackCopy('performances', perf.fileName, perf.originalFileName || perf.title + '.mp4');
    if (!r.ok) return UI.toast(r.message, { kind: 'error' });
    if (r.value) UI.toast('Копия сохранена', { kind: 'ok' });
  }

  /** Блок «Мои выступления» для страницы песни */
  function section(t) {
    const list = Array.isArray(t.performances) ? t.performances : [];
    const grid = h('div.perf-grid');
    for (const p of list) {
      const thumb = h('video.perf-thumb', { muted: true, preload: 'metadata', tabindex: -1 });
      thumb.src = perfUrl(p.fileName) + '#t=1';
      grid.appendChild(
        h(
          'div.perf-tile',
          { dataset: { id: p.id } },
          h(
            'button.perf-shot',
            { type: 'button', title: 'Смотреть', on: { click: () => watch(t, p) } },
            p.hasVideo === false ? h('span.perf-audio', { icon: 'note' }) : thumb,
            h('span.perf-play', { icon: 'play' }),
            p.duration ? h('span.perf-dur', { text: fmtTime(p.duration) }) : null
          ),
          h(
            'div.perf-info',
            null,
            h('b.perf-title', { text: p.title, title: p.title }),
            h('span.perf-meta', { text: `добавлено ${fmtDate(p.addedAt, false)} · ${fmtSize(p.size)}` })
          ),
          h('button.icon-btn.sm.perf-more', {
            title: 'Ещё',
            icon: 'more',
            on: {
              click: (e) =>
                UI.menu(e.currentTarget, [
                  { label: 'Смотреть', icon: 'play', onClick: () => watch(t, p) },
                  { label: 'Переименовать', icon: 'edit', onClick: () => rename(t, p) },
                  { label: 'Сохранить копию…', icon: 'download', onClick: () => saveCopy(p) },
                  '-',
                  { label: 'Удалить видео', icon: 'trash', danger: true, onClick: () => remove(t, p) },
                ]),
            },
          })
        )
      );
    }
    grid.appendChild(
      h(
        'button.perf-add',
        { type: 'button', on: { click: () => add(t.id) } },
        h('span.perf-add-ic', { icon: 'plus' }),
        h('b', { text: list.length ? 'Добавить ещё видео' : 'Добавить видео выступления' }),
        h('span', { text: 'MP4, MOV, WEBM — например, запись с концерта' })
      )
    );
    return h(
      'section.d-panel.d-perf',
      null,
      h('h2.d-h', null, h('span', { icon: 'mic' }), 'Мои выступления', list.length ? h('span.d-h-count', { text: list.length }) : null),
      list.length ? null : h('p.muted.small.perf-empty', { text: 'Здесь можно хранить свои видео с этой песней: с концертов, конкурсов, репетиций. Клип исполнителя — отдельно, ссылкой в карточке песни.' }),
      grid
    );
  }

  return { add, watch, rename, remove, section, probe };
})();
