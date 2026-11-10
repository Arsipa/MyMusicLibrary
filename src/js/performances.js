'use strict';
/*
 * Записи песни: к песне можно прикрепить сколько угодно своих записей — видео или аудио (в интерфейсе — «Репетиции»).
 * Файлы копируются в storage/performances/, в треке:
 *   t.performances = [{ id, fileName, originalFileName, title, description?, size, duration, hasVideo, addedAt, best?, bestAt? }].
 * Одна запись может быть «финальным выступлением» (best: true) — это знак, что песня выучена и вошла в репертуар («эталонище»).
 * (Клип — это ссылка на оригинал исполнителя, t.clipUrl; выступление — своя запись.)
 * Здесь же — общий проигрыватель записи в окне (им же играет «запись с голосом» t.vocal).
 */

function perfUrl(fileName) {
  return 'mml://perf/' + encodeURIComponent(fileName);
}

const Performances = (() => {
  const basename = (p) => String(p).split(/[\\/]/).pop();
  const list = (t) => (Array.isArray(t.performances) ? t.performances : []);
  const bestOf = (t) => list(t).find((p) => p.best) || null;
  const kindWord = (p) => (p.hasVideo === false ? 'аудио' : 'видео');

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

  /** Скопировать один файл в хранилище и проверить, что он играет. Возвращает { info, probe } или { error } */
  async function importOne(path) {
    const name = basename(path);
    const r = await window.api.importPerformance(path);
    if (!r.ok) return { error: `${name} — ${r.message}` };
    const info = r.value;
    const p = await probe(info.fileName);
    if (!p.ok) {
      await window.api.removePerformance(info.fileName);
      return { error: `${name} — запись повреждена или в формате, который не получается воспроизвести` };
    }
    return { info, probe: p };
  }

  /**
   * Выбрать файлы и прикрепить к песне.
   * kind: 'video' | 'audio' (какой фильтр показать в окне выбора); best: сразу сделать лучшим выступлением.
   */
  async function add(trackId, paths, { kind = 'video', best = false } = {}) {
    const t = Lib.track(trackId);
    if (!t) return;
    if (!paths) {
      const r = await window.api.pickPerformances(kind, !best);
      if (!r.ok) return UI.toast(r.message, { kind: 'error' });
      paths = r.value;
    }
    if (!paths || !paths.length) return;
    if (best) paths = paths.slice(0, 1);
    const busy = UI.busy('Копирую запись… Большие видео копируются дольше.');
    const errors = [];
    let added = 0;
    let bestPerf = null;
    try {
      for (let i = 0; i < paths.length; i++) {
        const name = basename(paths[i]);
        busy.set(paths.length > 1 ? `Копирую запись ${i + 1} из ${paths.length}: ${name}` : `Копирую «${name}»… Большие видео копируются дольше.`);
        const res = await importOne(paths[i]);
        if (res.error) {
          errors.push(res.error);
          continue;
        }
        const { info, probe: p } = res;
        const now = new Date().toISOString();
        const perf = {
          id: uid('perf_'),
          fileName: info.fileName,
          originalFileName: info.originalFileName,
          title: cleanLine(titleFromFile(info.originalFileName), LIMITS.perfTitle),
          description: '',
          size: info.size,
          duration: p.duration,
          hasVideo: p.hasVideo,
          addedAt: now,
        };
        t.performances = list(t);
        const prevBest = best ? bestOf(t) : null;
        if (best) {
          if (prevBest) {
            delete prevBest.best;
            delete prevBest.bestAt;
          }
          perf.best = true;
          perf.bestAt = now;
        }
        t.performances.push(perf);
        History.record(t, [{ label: p.hasVideo === false ? 'Аудио' : 'Видео', from: '', to: perf.title }], best ? 'perf-best' : 'perf-add');
        t.updatedAt = now;
        if (!(await Store.save('library'))) {
          t.performances.pop();
          if (prevBest) prevBest.best = true;
          await window.api.removePerformance(info.fileName);
          errors.push(`${name} — не удалось сохранить`);
          continue;
        }
        if (best) bestPerf = perf;
        added++;
      }
    } finally {
      busy.done();
    }
    App.refresh();
    if (errors.length) await UI.alert({ title: added ? 'Не все записи добавлены' : 'Запись не добавлена', list: errors });
    else if (added && !bestPerf) UI.toast(added > 1 ? `Добавлено записей: ${added}` : 'Запись добавлена', { kind: 'ok' });
    if (bestPerf) await Celebrate.repertoire(t, bestPerf);
  }

  /**
   * Проигрыватель записи в отдельном окне (музыка в общем плеере ставится на паузу).
   * Для аудио — красивая «пластинка» с обложкой песни и обычный ползунок.
   */
  function openPlayer({ t, title, subtitle, src, video, description, best }) {
    Player.pause();
    const media = h(video ? 'video.perf-player' : 'audio.perf-audio-player', { controls: true, autoplay: true, preload: 'auto' });
    media.src = src;
    media.addEventListener('play', () => Player.pause());
    media.addEventListener('error', () => UI.toast('Эту запись не получается воспроизвести', { kind: 'error' }));
    const body = h(
      'div.perf-watch' + (video ? '' : '.audio') + (best ? '.best' : ''),
      null,
      video ? media : h('div.perf-listen', null, h('div.perf-listen-art', null, Cards.art(t), h('span.perf-listen-ic', { icon: 'headphones' })), media),
      description ? h('p.perf-watch-desc', { text: description }) : null
    );
    UI.openModal({
      title,
      subtitle,
      wide: !!video,
      className: 'perf-modal' + (best ? '.best-modal' : ''),
      accent: 'cat',
      body,
      onClose: () => {
        media.pause();
        media.removeAttribute('src');
        media.load(); // освобождаем файл
      },
      actions: [],
    });
  }

  async function watch(t, perf) {
    const ex = await window.api.performanceExists(perf.fileName);
    if (!ex.ok || !ex.value) {
      return UI.alert({ title: 'Запись не найдена', text: 'Файл этого выступления пропал из хранилища. Его можно удалить из списка и добавить заново или восстановить библиотеку из резервной копии.' });
    }
    openPlayer({
      t,
      title: perf.title,
      subtitle: [fullTitle(t), perf.best ? 'финальное выступление' : null, perf.duration ? fmtTime(perf.duration) : null].filter(Boolean).join(' · '),
      src: perfUrl(perf.fileName),
      video: perf.hasVideo !== false,
      description: perf.description,
      best: perf.best,
    });
  }

  /** Название и описание выступления */
  function edit(t, perf, { focusDesc = false } = {}) {
    const inp = h('input.input', { type: 'text', value: perf.title, placeholder: 'Например: Концерт в ДК, май 2026' });
    const desc = h('textarea.input.textarea', { rows: 4, placeholder: 'Что получилось, над чем ещё поработать…' });
    desc.value = perf.description || '';
    const save = async (m) => {
      const v = cleanLine(inp.value, LIMITS.perfTitle);
      if (!v) return inp.focus();
      const d = cleanText(desc.value, LIMITS.perfDesc);
      const changes = [];
      if (v !== perf.title) changes.push({ label: 'Название записи', from: perf.title, to: v });
      if (d !== (perf.description || '')) changes.push({ label: `Описание «${v}»`, from: perf.description ? 'было' : '', to: d ? 'изменено' : '', edited: !!(perf.description && d) });
      if (changes.length) {
        History.record(t, changes, 'edit');
        perf.title = v;
        perf.description = d;
        t.updatedAt = new Date().toISOString();
        await Store.save('library');
        App.refresh();
      }
      m.close('force');
    };
    const m = UI.openModal({
      title: 'Название и описание',
      subtitle: perf.best ? 'Финальное выступление' : null,
      className: 'small',
      body: h(
        'div.perf-edit',
        null,
        h('div.form-field', null, h('div.field-label', null, 'Название'), withCounter(inp, LIMITS.perfTitle)),
        h('div.form-field', null, h('div.field-label', null, 'Описание', h('span.muted.small.label-note', { text: '— необязательно' })), withCounter(desc, LIMITS.perfDesc))
      ),
      actions: ['spacer', { label: 'Отмена', kind: 'ghost', onClick: (mm) => mm.close() }, { label: 'Сохранить', kind: 'primary', icon: 'check', onClick: (mm) => save(mm) }],
    });
    inp.addEventListener('keydown', (e) => e.key === 'Enter' && save(m));
    requestAnimationFrame(() => (focusDesc ? desc : inp).focus());
  }

  /** Сделать выступление лучшим (или убрать отметку) */
  async function setBest(t, perf, on) {
    const prev = bestOf(t);
    if (on && prev === perf) return;
    if (prev) {
      delete prev.best;
      delete prev.bestAt;
    }
    if (on) {
      perf.best = true;
      perf.bestAt = new Date().toISOString();
      History.record(t, [{ label: 'Финальное выступление', from: prev ? prev.title : '', to: perf.title }], 'perf-best');
    } else {
      History.record(t, [{ label: 'Финальное выступление', from: perf.title, to: '' }], 'edit');
    }
    t.updatedAt = new Date().toISOString();
    await Store.save('library');
    App.refresh();
    if (on) await Celebrate.repertoire(t, perf);
    else UI.toast('Запись вернулась в репетиции');
  }

  async function remove(t, perf) {
    const r = await UI.confirm({
      title: `Удалить запись «${perf.title}»?`,
      text: perf.best
        ? 'Это финальное выступление песни. Запись будет удалена из библиотеки. Исходный файл на компьютере, если он остался, не пострадает.'
        : 'Запись будет удалена из библиотеки. Исходный файл на компьютере, если он остался, не пострадает.',
      okLabel: 'Удалить',
      danger: true,
      icon: 'trash',
      checkbox: { label: 'Сначала сохранить копию записи себе на компьютер' },
    });
    if (!r) return;
    if (r.checked) {
      const c = await window.api.saveTrackCopy('performances', perf.fileName, perf.originalFileName || perf.title + '.' + perf.fileName.split('.').pop());
      if (!c.ok) return UI.toast(c.message, { kind: 'error' });
      if (!c.value) return UI.toast('Удаление отменено: копия не сохранена');
    }
    t.performances = list(t).filter((p) => p.id !== perf.id);
    History.record(t, [{ label: kindWord(perf) === 'аудио' ? 'Аудио' : 'Видео', from: perf.title, to: '' }], 'perf-remove');
    t.updatedAt = new Date().toISOString();
    if (await Store.save('library')) await window.api.removePerformance(perf.fileName);
    App.refresh();
    UI.toast('Запись удалена');
  }

  async function saveCopy(perf) {
    const r = await window.api.saveTrackCopy('performances', perf.fileName, perf.originalFileName || perf.title + '.' + perf.fileName.split('.').pop());
    if (!r.ok) return UI.toast(r.message, { kind: 'error' });
    if (r.value) UI.toast('Копия сохранена', { kind: 'ok' });
  }

  function menu(t, p, anchor) {
    UI.menu(anchor, [
      { label: p.hasVideo === false ? 'Слушать' : 'Смотреть', icon: 'play', onClick: () => watch(t, p) },
      { label: 'Название и описание', icon: 'edit', onClick: () => edit(t, p) },
      p.best ? { label: 'Вернуть в репетиции', icon: 'undo', onClick: () => setBest(t, p, false) } : { label: 'Сделать финальным выступлением', icon: 'crown', onClick: () => setBest(t, p, true) },
      { label: 'Сохранить копию…', icon: 'download', onClick: () => saveCopy(p) },
      '-',
      { label: 'Удалить запись', icon: 'trash', danger: true, onClick: () => remove(t, p) },
    ]);
  }

  /** Превью: кадр из видео или «пластинка» для аудио */
  function shot(t, p) {
    let inner;
    if (p.hasVideo === false) inner = h('span.perf-audio', null, h('span.perf-audio-disc'), h('span', { icon: 'headphones' }));
    else {
      inner = h('video.perf-thumb', { muted: true, preload: 'metadata', tabindex: -1 });
      inner.src = perfUrl(p.fileName) + '#t=1';
    }
    return h(
      'button.perf-shot' + (p.hasVideo === false ? '.is-audio' : ''),
      { type: 'button', title: p.hasVideo === false ? 'Слушать' : 'Смотреть', on: { click: () => watch(t, p) } },
      inner,
      h('span.perf-play', { icon: 'play' }),
      p.duration ? h('span.perf-dur', { text: fmtTime(p.duration) }) : null
    );
  }

  function descLine(t, p) {
    return p.description
      ? h('p.perf-desc', { text: p.description, title: 'Изменить описание', on: { click: () => edit(t, p, { focusDesc: true }) } })
      : h('button.link-btn.perf-desc-add', { type: 'button', on: { click: () => edit(t, p, { focusDesc: true }) } }, h('span', { icon: 'plus' }), 'Добавить описание');
  }

  function addButtons(t, opts = {}) {
    return h(
      'div.perf-add-btns',
      null,
      h('button.btn.btn-soft.sm.perf-add-video', { type: 'button', on: { click: () => add(t.id, null, { kind: 'video', ...opts }) } }, h('span', { icon: 'video' }), 'Видео'),
      h('button.btn.btn-soft.sm.perf-add-audio', { type: 'button', on: { click: () => add(t.id, null, { kind: 'audio', ...opts }) } }, h('span', { icon: 'headphones' }), 'Аудио')
    );
  }

  /** Блок «Репетиции» для страницы песни (без финального выступления — у него свой блок) */
  function section(t) {
    const items = list(t).filter((p) => !p.best);
    const rows = h('div.perf-list');
    for (const p of items.slice().reverse()) {
      rows.appendChild(
        h(
          'div.perf-tile',
          { dataset: { id: p.id } },
          shot(t, p),
          h(
            'div.perf-info',
            null,
            h('b.perf-title', { text: p.title, title: p.title }),
            h('span.perf-meta', { text: [kindWord(p), `добавлено ${fmtDate(p.addedAt, false)}`, fmtSize(p.size)].join(' · ') }),
            descLine(t, p)
          ),
          h('button.icon-btn.sm.perf-more', { title: 'Ещё', icon: 'more', on: { click: (e) => menu(t, p, e.currentTarget) } })
        )
      );
    }
    if (!items.length) {
      rows.appendChild(
        h(
          'div.perf-empty',
          null,
          h('span.perf-empty-ic', { icon: 'mic' }),
          h('p', { text: 'Здесь можно хранить свои записи с этой песней — видео или аудио: репетиции, прогоны, занятия. Клип исполнителя — отдельно, ссылкой в карточке песни.' })
        )
      );
    }
    return h(
      'section.d-panel.d-perf',
      null,
      h('div.d-perf-head', null, h('h2.d-h', null, h('span', { icon: 'mic' }), h('span.d-h-text', { text: 'Репетиции' }), items.length ? h('span.d-h-count', { text: items.length }) : null), addButtons(t)),
      rows
    );
  }

  /** Блок «Финальное выступление» — особая, «идеальная» запись: песня выучена и вошла в репертуар */
  function bestSection(t) {
    const p = bestOf(t);
    const head = () => h('div.best-head', null, h('h2.d-h', null, h('span.best-crown', { icon: 'crown' }), 'Финальное выступление'));
    if (!p) {
      const others = list(t);
      return h(
        'section.d-panel.d-best.is-empty',
        null,
        head(),
        h('p.best-hint', { text: 'Когда песня выучена — загрузите сюда финальную, самую удачную запись. Это знак, что песня вошла в репертуар ✨' }),
        h(
          'div.best-actions',
          null,
          addButtons(t, { best: true }),
          others.length
            ? h(
                'button.btn.btn-soft.sm.best-pick',
                {
                  type: 'button',
                  on: {
                    click: (e) =>
                      UI.menu(
                        e.currentTarget,
                        others.map((o) => ({ label: o.title, icon: o.hasVideo === false ? 'headphones' : 'video', onClick: () => setBest(t, o, true) }))
                      ),
                  },
                },
                h('span', { icon: 'mic' }),
                'Выбрать из репетиций',
                h('span.best-pick-chev', { icon: 'chevron' })
              )
            : null
        )
      );
    }
    return h(
      'section.d-panel.d-best.has',
      { dataset: { id: p.id } },
      h('span.best-ribbon', { text: 'Эталонище' }),
      head(),
      h(
        'div.best-tile',
        null,
        shot(t, p),
        h(
          'div.perf-info',
          null,
          h('b.perf-title', { text: p.title, title: p.title }),
          h('span.perf-meta', { text: [kindWord(p), p.bestAt ? `финальное с ${fmtDate(p.bestAt, false)}` : null].filter(Boolean).join(' · ') }),
          descLine(t, p)
        ),
        h('button.icon-btn.sm.perf-more', { title: 'Ещё', icon: 'more', on: { click: (e) => menu(t, p, e.currentTarget) } })
      )
    );
  }

  return { add, watch, edit, rename: edit, setBest, remove, section, bestSection, probe, importOne, openPlayer, bestOf };
})();
