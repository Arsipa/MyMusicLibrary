'use strict';
/*
 * Запись песни «с плюсом» (с голосом) — чтобы было на что ориентироваться.
 * На выбор: музыкальный файл (копируется в storage/performances/) или ссылка.
 *   t.vocal = { fileName, originalFileName, size, duration, hasVideo }  или  t.vocal = { url }
 */

const Vocal = (() => {
  async function play(t) {
    const v = t.vocal;
    if (!v) return;
    if (v.url) {
      const r = await window.api.openUrl(v.url);
      if (!r.ok) UI.toast('Не получилось открыть ссылку. Проверьте её в карточке песни.', { kind: 'error' });
      return;
    }
    const ex = await window.api.performanceExists(v.fileName);
    if (!ex.ok || !ex.value) {
      return UI.alert({ title: 'Запись не найдена', text: 'Файл записи с голосом пропал из хранилища. Выберите его заново в карточке песни («Редактировать») или восстановите библиотеку из резервной копии.' });
    }
    Performances.openPlayer({
      t,
      title: 'Запись с голосом',
      subtitle: [fullTitle(t), v.duration ? fmtTime(v.duration) : null].filter(Boolean).join(' · '),
      src: perfUrl(v.fileName),
      video: !!v.hasVideo,
    });
  }

  /**
   * Поле формы трека. Новый файл копируется сразу, а старый удаляется только после сохранения.
   * Возвращает { el, collect(validate) → { vocal } | { error }, commit(saved), discard(trackDeleted) }
   */
  function field(t) {
    const orig = t.vocal ? { ...t.vocal } : null;
    let mode = orig ? (orig.url ? 'link' : 'file') : 'none';
    let file = orig && orig.fileName ? { ...orig } : null;
    const imported = new Set(); // файлы, скопированные за время работы формы
    const onChange = () => box.dispatchEvent(new Event('input', { bubbles: true }));

    const linkInp = h('input.input', { type: 'url', value: (orig && orig.url) || '', placeholder: 'Например: https://music.yandex.ru/… или https://youtu.be/…', spellcheck: 'false' });
    const linkErr = h('p.field-error', { hidden: true });
    const linkBox = h('div.vocal-link', null, withCounter(linkInp, LIMITS.clipUrl), linkErr);
    const fileBox = h('div.vocal-file');
    const seg = h('div.segmented.vocal-mode', { role: 'radiogroup' });
    const box = h('div.vocal-field', null, seg, fileBox, linkBox);

    async function pick() {
      const r = await window.api.pickPerformances('vocal', false);
      if (!r.ok) return UI.toast(r.message, { kind: 'error' });
      if (!r.value || !r.value.length) return;
      const busy = UI.busy('Копирую запись…');
      let res;
      try {
        res = await Performances.importOne(r.value[0]);
      } finally {
        busy.done();
      }
      if (res.error) return UI.alert({ title: 'Запись не добавлена', text: res.error });
      if (file && imported.has(file.fileName)) {
        window.api.removePerformance(file.fileName);
        imported.delete(file.fileName);
      }
      file = { fileName: res.info.fileName, originalFileName: res.info.originalFileName, size: res.info.size, duration: res.probe.duration, hasVideo: !!res.probe.hasVideo };
      imported.add(file.fileName);
      onChange();
      paint();
    }

    function paint() {
      clear(seg);
      for (const [id, label] of [
        ['none', 'Нет'],
        ['file', 'Файл'],
        ['link', 'Ссылка'],
      ]) {
        seg.appendChild(
          h('button' + (mode === id ? '.on' : ''), {
            type: 'button',
            dataset: { mode: id },
            text: label,
            on: {
              click: () => {
                if (mode === id) return;
                mode = id;
                onChange();
                paint();
                if (id === 'link') linkInp.focus();
              },
            },
          })
        );
      }
      linkBox.hidden = mode !== 'link';
      fileBox.hidden = mode !== 'file';
      clear(fileBox);
      if (mode === 'file') {
        if (file) {
          fileBox.append(
            h(
              'div.file-strip.vocal-strip',
              null,
              h('span.file-ic', { icon: 'mic' }),
              h('div.file-meta', null, h('b', { text: file.originalFileName || 'Запись' }), h('span', { text: [fmtSize(file.size), file.duration ? fmtTime(file.duration) : null].filter(Boolean).join(' · ') })),
              h(
                'button.btn.btn-soft.sm',
                {
                  type: 'button',
                  on: {
                    click: () =>
                      Performances.openPlayer({ t, title: 'Запись с голосом', subtitle: file.originalFileName, src: perfUrl(file.fileName), video: file.hasVideo }),
                  },
                },
                h('span', { icon: 'play' }),
                'Послушать'
              ),
              h('button.btn.btn-soft.sm.vocal-other', { type: 'button', on: { click: pick } }, h('span', { icon: 'replace' }), 'Другой файл')
            )
          );
        } else {
          fileBox.append(
            h('button.btn.btn-soft.sm.vocal-pick', { type: 'button', on: { click: pick } }, h('span', { icon: 'upload' }), 'Выбрать файл'),
            h('span.muted.small', { text: ' MP3, M4A, WAV, MP4 и другие' })
          );
        }
      }
    }
    paint();

    const api = {
      el: box,
      /** Для тестов: подставить файл без окна выбора */
      _setFile(f) {
        file = f;
        imported.add(f.fileName);
        mode = 'file';
        paint();
      },
      collect(validate) {
        linkErr.hidden = true;
        linkInp.classList.remove('bad');
        if (mode === 'link') {
          const u = parseClipUrl(linkInp.value);
          if (u.error) {
            if (validate) {
              linkErr.textContent = u.error;
              linkErr.hidden = false;
              linkInp.classList.add('bad');
            }
            return { error: u.error, input: linkInp };
          }
          return { vocal: u.url ? { url: u.url } : null };
        }
        if (mode === 'file') return { vocal: file ? { ...file } : null };
        return { vocal: null };
      },
      /** После сохранения: удаляем то, что больше не используется (старый файл, лишние выбранные) */
      commit(saved) {
        const keep = saved && saved.fileName;
        for (const f of imported) if (f !== keep) window.api.removePerformance(f);
        if (orig && orig.fileName && orig.fileName !== keep) window.api.removePerformance(orig.fileName);
        imported.clear();
      },
      /** Отмена формы: убираем новые файлы; trackDeleted — песня удаляется целиком */
      discard(trackDeleted) {
        for (const f of imported) window.api.removePerformance(f);
        imported.clear();
        if (trackDeleted && orig && orig.fileName) window.api.removePerformance(orig.fileName);
      },
    };
    box._vocal = api; // для автотеста
    return api;
  }

  return { play, field };
})();
