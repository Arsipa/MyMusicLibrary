'use strict';
/* Резервные копии, корзина, проверка целостности, восстановление после сбоев. */

const REASON_LABELS = {
  manual: 'Создана вручную',
  daily: 'Ежедневная автокопия',
  weekly: 'Еженедельная автокопия',
  monthly: 'Ежемесячная автокопия',
  'before-restore': 'Перед восстановлением',
  'before-import': 'Перед загрузкой копии',
  'before-attribute-delete': 'Перед удалением атрибута',
  'before-attribute-change': 'Перед изменением атрибута',
};

const Backup = (() => {
  async function auto(reason) {
    const r = await window.api.createBackup(reason);
    if (!r.ok) UI.toast('Не удалось сделать автоматическую резервную копию: ' + r.message, { kind: 'error' });
    return r.ok;
  }

  const PERIODS = {
    day: { days: 1, reason: 'daily', label: 'Каждый день' },
    week: { days: 7, reason: 'weekly', label: 'Раз в неделю' },
    month: { days: 30, reason: 'monthly', label: 'Раз в месяц' },
  };

  /** Плановая автокопия — только если пользователь её включил и подошёл срок. */
  async function periodic() {
    if (S.settings.autoBackup !== true || !Lib.tracks().length) return;
    const p = PERIODS[S.settings.backupEvery] || PERIODS.week;
    const last = S.settings.lastAutoBackup ? new Date(S.settings.lastAutoBackup) : null;
    if (last) {
      const due = p.days === 1
        ? last.toDateString() !== new Date().toDateString()
        : Date.now() - last.getTime() >= p.days * 864e5 - 2 * 3600e3;
      if (!due) return;
    }
    const r = await window.api.createBackup(p.reason);
    if (r.ok) {
      S.settings.lastAutoBackup = new Date().toISOString();
      Store.save('settings');
    }
  }

  function referenced() {
    const tracks = Lib.tracks().map((t) => t.fileName);
    const trash = S.library.trash.map((x) => x.track.fileName);
    const covers = [...Lib.tracks(), ...S.library.trash.map((x) => x.track)].map((t) => t.cover).filter(Boolean);
    return { tracks, trash, covers };
  }

  /** Проверка целостности: тихая (при запуске) или с отчётом. */
  async function integrity({ report } = {}) {
    const r = await window.api.integrity(referenced());
    if (!r.ok) {
      if (report) UI.alert({ title: 'Проверка не удалась', text: r.message });
      return null;
    }
    const res = r.value;
    let changed = false;
    // файл трека мог остаться в корзине при сбое во время удаления — возвращаем на место
    for (const f of res.missing.slice()) {
      const t = Lib.tracks().find((x) => x.fileName === f);
      const u = await window.api.untrashTrackFile(f);
      if (u.ok) res.missing.splice(res.missing.indexOf(f), 1);
      else if (t) S.runtime.missing.add(t.id);
    }
    S.runtime.missing = new Set(Lib.tracks().filter((t) => res.missing.includes(t.fileName)).map((t) => t.id));
    // записи корзины без файлов — убираем
    if (res.missingTrash.length) {
      S.library.trash = S.library.trash.filter((x) => !res.missingTrash.includes(x.track.fileName));
      changed = true;
    }
    // старше 30 дней — чистим корзину
    const old = S.library.trash.filter((x) => Date.now() - new Date(x.deletedAt).getTime() > 30 * 864e5);
    for (const x of old) await Tracks.purge(x.track.id, true);
    if (changed) await Store.save('library');
    App.setBanners(res);
    if (report) {
      const lines = [];
      if (res.missing.length) lines.push(`Не найдены файлы у ${res.missing.length} ${plural(res.missing.length, 'трека', 'треков', 'треков')} — они отмечены на карточках.`);
      if (res.orphans.length) lines.push(`Найдено ${res.orphans.length} ${plural(res.orphans.length, 'файл', 'файла', 'файлов')} без карточек — их можно вернуть в библиотеку.`);
      if (res.removedPartials) lines.push(`Убраны остатки ${res.removedPartials} недокопированных файлов.`);
      UI.alert({
        title: lines.length ? 'Проверка завершена' : 'Всё в порядке!',
        text: lines.length ? '' : 'Все файлы на месте, библиотека цела.',
        list: lines,
        icon: lines.length ? 'warn' : 'check',
      });
    }
    App.refresh();
    return res;
  }

  /* ---------- Окно «Хранилище» ---------- */
  function open(tab = 'backups') {
    const tabs = [
      ['backups', 'Резервные копии', 'shield'],
      ['trash', 'Корзина', 'trash'],
      ['transfer', 'Перенос и папка', 'folder'],
    ];
    const content = h('div.store-content');
    const tabBar = h('div.tabs');
    const select = (id) => {
      tab = id;
      tabBar.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === id));
      render();
    };
    for (const [id, label, ic] of tabs) {
      tabBar.appendChild(h('button.tab', { dataset: { tab: id }, on: { click: () => select(id) } }, h('span', { icon: ic }), label, id === 'trash' && S.library.trash.length ? h('b.tab-count', { text: S.library.trash.length }) : null));
    }
    const m = UI.openModal({
      title: 'Хранилище',
      subtitle: 'Всё, что защищает вашу библиотеку: копии, корзина и место хранения.',
      wide: true,
      accent: 'store',
      body: h('div', null, tabBar, content),
      actions: [{ label: 'Проверить библиотеку', kind: 'soft', icon: 'heartbeat', onClick: () => integrity({ report: true }) }, 'spacer', { label: 'Готово', kind: 'ghost', onClick: (mm) => mm.close() }],
    });

    async function render() {
      clear(content);
      if (tab === 'backups') await renderBackups();
      else if (tab === 'trash') renderTrash();
      else await renderTransfer();
    }

    async function renderBackups() {
      const auto = toggle('Делать резервные копии автоматически', S.settings.autoBackup === true);
      const freq = h('div.segmented' + (S.settings.autoBackup === true ? '' : '.off'), { role: 'radiogroup' });
      const paintFreq = () => {
        freq.classList.toggle('off', S.settings.autoBackup !== true);
        freq.querySelectorAll('button').forEach((b) => {
          const on = b.dataset.v === (S.settings.backupEvery || 'week');
          b.classList.toggle('on', on);
          b.setAttribute('aria-checked', on);
          b.disabled = S.settings.autoBackup !== true;
        });
      };
      for (const [v, p] of Object.entries(PERIODS)) {
        freq.appendChild(
          h('button', {
            type: 'button',
            role: 'radio',
            dataset: { v },
            text: p.label,
            on: {
              click: async () => {
                S.settings.backupEvery = v;
                paintFreq();
                await Store.save('settings');
                periodic();
              },
            },
          })
        );
      }
      paintFreq();
      auto.el.querySelector('input').addEventListener('change', async () => {
        S.settings.autoBackup = auto.get();
        paintFreq();
        await Store.save('settings');
        if (S.settings.autoBackup) {
          await periodic();
          render();
        }
      });
      const autoNote = h('p.muted.small.auto-note', {
        text: S.settings.lastAutoBackup
          ? 'Последняя автокопия: ' + fmtDate(S.settings.lastAutoBackup) + '. Хранятся 12 последних, старые удаляются сами.'
          : 'Хранятся 12 последних автокопий, старые удаляются сами.',
      });
      const list = h('div.backup-list', null, h('p.muted', { text: 'Загружаю…' }));
      content.append(
        h(
          'div.store-hero',
          null,
          h('div', null, h('h3', { text: 'Резервная копия — это снимок всей библиотеки' }), h('p.muted', { text: 'Музыка, атрибуты, категории и заметки. Копии хранятся в папке библиотеки и почти не занимают лишнего места.' })),
          h('button.btn.btn-primary', { on: { click: create } }, h('span', { icon: 'shield' }), 'Создать копию сейчас')
        ),
        h('div.auto-box', null, auto.el, freq, autoNote),
        list
      );
      const r = await window.api.listBackups();
      clear(list);
      if (!r.ok) return list.appendChild(h('p.form-error', { text: r.message }));
      if (!r.value.length) return list.appendChild(h('p.muted', { text: 'Копий пока нет.' }));
      for (const b of r.value) {
        list.appendChild(
          h(
            'div.backup-row' + (b.auto ? '.auto' : ''),
            null,
            h('span.backup-ic', { icon: b.auto ? 'sparkle' : 'shield' }),
            h('div.backup-main', null, h('b', { text: fmtDate(b.createdAt) }), h('span', { text: [REASON_LABELS[b.reason] || 'Копия', b.trackCount !== undefined ? `${b.trackCount} ${plural(b.trackCount, 'трек', 'трека', 'треков')}` : null].filter(Boolean).join(' · ') })),
            h('button.btn.btn-soft.sm', { on: { click: () => restore(b) } }, h('span', { icon: 'undo' }), 'Восстановить'),
            h('button.icon-btn.sm.danger', { title: 'Удалить копию', icon: 'trash', on: { click: () => del(b) } })
          )
        );
      }
    }

    async function create() {
      const busy = UI.busy('Создаю резервную копию…');
      const r = await window.api.createBackup('manual');
      busy.done();
      if (!r.ok) return UI.alert({ title: 'Копия не создана', text: r.message });
      UI.toast('Резервная копия создана', { kind: 'ok' });
      render();
    }

    async function restore(b) {
      const ok = await UI.confirm({
        title: 'Восстановить библиотеку?',
        text: `Библиотека вернётся к состоянию на ${fmtDate(b.createdAt)}. Текущее состояние сначала автоматически сохранится в отдельную копию — так что передумать можно будет в любой момент.`,
        okLabel: 'Восстановить',
        icon: 'undo',
      });
      if (!ok) return;
      Player.stop();
      const busy = UI.busy('Восстанавливаю библиотеку…');
      const r = await window.api.restoreBackup(b.name);
      busy.done();
      if (!r.ok) return UI.alert({ title: 'Не получилось восстановить', text: r.message });
      location.reload();
    }

    async function del(b) {
      const ok = await UI.confirm({ title: 'Удалить эту копию?', text: `Копия от ${fmtDate(b.createdAt)} будет удалена. Библиотеку это не затронет.`, okLabel: 'Удалить', danger: true, icon: 'trash' });
      if (!ok) return;
      const r = await window.api.deleteBackup(b.name);
      if (!r.ok) UI.toast(r.message, { kind: 'error' });
      render();
    }

    function renderTrash() {
      const items = S.library.trash;
      content.appendChild(h('p.muted', { text: 'Удалённые треки хранятся здесь 30 дней, потом исчезают сами.' }));
      if (!items.length) {
        content.appendChild(h('div.trash-empty', null, h('span', { icon: 'trash' }), h('p', { text: 'Корзина пуста' })));
        return;
      }
      const list = h('div.trash-list');
      for (const x of items) {
        const left = Math.max(0, 30 - Math.floor((Date.now() - new Date(x.deletedAt).getTime()) / 864e5));
        list.appendChild(
          h(
            'div.trash-row',
            null,
            Cards.art(x.track, true),
            h('div.backup-main', null, h('b', { text: x.track.title }), h('span', { text: `Удалён ${fmtDate(x.deletedAt)} · исчезнет через ${left} ${plural(left, 'день', 'дня', 'дней')}` })),
            h(
              'button.btn.btn-soft.sm',
              {
                on: {
                  click: async () => {
                    await Tracks.restore(x.track.id);
                    render();
                  },
                },
              },
              h('span', { icon: 'undo' }),
              'Вернуть'
            ),
            h('button.icon-btn.sm.danger', {
              title: 'Удалить навсегда',
              icon: 'trash',
              on: {
                click: async () => {
                  await Tracks.purge(x.track.id);
                  render();
                },
              },
            })
          )
        );
      }
      content.appendChild(list);
    }

    async function renderTransfer() {
      const st = await window.api.stats();
      const s = st.ok ? st.value : {};
      content.append(
        h(
          'div.transfer-grid',
          null,
          tile('download', 'Сохранить всю библиотеку', 'Полная копия с музыкой в выбранную папку — например, на флешку или внешний диск.', 'Выбрать папку…', exportLib),
          tile('upload', 'Загрузить библиотеку из копии', 'Открыть копию, сохранённую раньше. Текущая библиотека будет заменена (её копия сохранится).', 'Выбрать копию…', importLib)
        ),
        h(
          'div.where',
          null,
          h('h4', { text: 'Где хранится библиотека' }),
          h('code.path', { text: s.root || S.runtime.root }),
          h('p.muted.small', { text: `Музыка занимает ${fmtSize(s.storageSize)}, резервные копии — до ${fmtSize(s.backupsSize)}. Свободно на диске: ${fmtSize(s.free)}.` }),
          h(
            'div.where-btns',
            null,
            h('button.btn.btn-soft.sm', { on: { click: () => window.api.openFolder() } }, h('span', { icon: 'folder' }), 'Открыть папку'),
            h('button.btn.btn-soft.sm', { on: { click: changeLocation } }, h('span', { icon: 'replace' }), 'Перенести в другую папку…'),
            S.runtime.isDefaultRoot ? null : h('button.btn.btn-ghost.sm', { on: { click: resetLocation } }, 'Вернуть стандартную папку')
          ),
          h('p.muted.small', { text: 'Пожалуйста, не меняйте файлы в этой папке вручную — всё делается через программу.' })
        )
      );
    }

    function tile(ic, title, text, btn, fn) {
      return h('div.transfer-tile', null, h('span.transfer-ic', { icon: ic }), h('h4', { text: title }), h('p.muted.small', { text }), h('button.btn.btn-primary.sm', { on: { click: fn } }, btn));
    }

    async function exportLib() {
      const busy = UI.busy('Сохраняю библиотеку… Это может занять время, если музыки много.');
      const r = await window.api.exportLibrary();
      busy.done();
      if (!r.ok) return UI.alert({ title: 'Не получилось сохранить', text: r.message });
      if (r.value) UI.toast('Библиотека сохранена — папка открыта', { kind: 'ok' });
    }

    async function importLib() {
      Player.stop();
      const busy = UI.busy('Загружаю библиотеку из копии…');
      const r = await window.api.importLibrary();
      busy.done();
      if (!r.ok) return UI.alert({ title: 'Не получилось загрузить', text: r.message });
      if (r.value) location.reload();
    }

    async function changeLocation() {
      const ok = await UI.confirm({
        title: 'Перенести библиотеку?',
        text: 'Выберите новую папку. Вся музыка и данные будут скопированы туда, а прежняя папка останется нетронутой (её можно будет удалить вручную, когда убедитесь, что всё на месте). Если в выбранной папке уже есть библиотека — откроется она.',
        okLabel: 'Выбрать папку',
        icon: 'folder',
      });
      if (!ok) return;
      Player.stop();
      const busy = UI.busy('Переношу библиотеку…');
      const r = await window.api.changeLocation();
      busy.done();
      if (!r.ok) return UI.alert({ title: 'Не получилось перенести', text: r.message });
      if (r.value) location.reload();
    }

    async function resetLocation() {
      const ok = await UI.confirm({ title: 'Вернуть стандартную папку?', text: 'Программа снова откроет библиотеку из стандартной папки. Текущая папка останется на месте.', okLabel: 'Вернуть', icon: 'folder' });
      if (!ok) return;
      await window.api.resetLocation();
      location.reload();
    }

    select(tab);
    return m;
  }

  /* ---------- Экран восстановления после повреждения данных ---------- */
  function recoveryScreen(problems) {
    return new Promise(async (resolve) => {
      const names = {
        'library.json': 'список треков',
        'attributes.json': 'список атрибутов',
        'categories.json': 'список категорий',
        'settings.json': 'настройки',
      };
      const backupsR = await window.api.listBackups();
      const backups = backupsR.ok ? backupsR.value : [];
      const body = h('div.recovery');
      body.appendChild(
        h(
          'p.confirm-text',
          { text: 'Похоже, программа была закрыта в неудачный момент или файлы библиотеки повреждены. Ничего не перезаписано — давайте аккуратно всё вернём.' }
        )
      );
      for (const p of problems) {
        body.appendChild(
          h(
            'div.rec-problem',
            null,
            h('span', { icon: 'warn' }),
            h('div', null, h('b', { text: `Не читается ${names[p.name] || p.name}` }), h('span.muted.small', { text: p.kind === 'missing' ? 'Файл пропал.' : 'Файл повреждён.' }))
          )
        );
      }
      const canPrev = problems.every((p) => p.prev);
      const opts = h('div.rec-options');
      if (canPrev) {
        opts.appendChild(
          option('sparkle', 'Вернуть последнюю сохранённую версию', 'Самый свежий вариант: потеряется разве что одно последнее изменение.', async () => {
            for (const p of problems) {
              const r = await window.api.recoveryUsePrev(p.name);
              if (!r.ok) return UI.alert({ title: 'Не получилось', text: r.message });
            }
            done();
          })
        );
      }
      for (const b of backups.slice(0, 6)) {
        opts.appendChild(
          option('shield', `Восстановить из копии от ${fmtDate(b.createdAt)}`, REASON_LABELS[b.reason] || 'Резервная копия', async () => {
            const busy = UI.busy('Восстанавливаю…');
            const r = await window.api.recoveryRestoreBackup(b.name);
            busy.done();
            if (!r.ok) return UI.alert({ title: 'Не получилось', text: r.message });
            done();
          })
        );
      }
      opts.appendChild(
        option('plus', 'Начать с чистого листа', 'Повреждённые файлы будут отложены в сторону (не удалены), а программа начнёт с пустого списка.', async () => {
          const ok = await UI.confirm({ title: 'Точно начать заново?', text: 'Повреждённые файлы сохранятся в папке данных с пометкой «corrupted». Музыкальные файлы останутся на диске, и проверка библиотеки предложит вернуть их.', okLabel: 'Начать заново', danger: true });
          if (!ok) return;
          for (const p of problems) await window.api.recoveryStartFresh(p.name);
          done();
        }, true)
      );
      body.appendChild(opts);
      let m;
      function done() {
        m.close('force');
        resolve();
      }
      m = UI.openModal({ title: 'Нужно восстановить библиотеку', wide: true, closable: false, accent: 'store', body, actions: [] });
    });

    function option(ic, title, text, fn, danger) {
      return h('button.rec-option' + (danger ? '.danger' : ''), { on: { click: fn } }, h('span.rec-ic', { icon: ic }), h('div', null, h('b', { text: title }), h('span', { text })));
    }
  }

  return { auto, periodic, integrity, open, recoveryScreen };
})();
