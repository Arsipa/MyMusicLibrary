'use strict';
/*
 * История изменений песни: когда добавлена, что и как менялось.
 * Хранится в самом треке: t.history = [{ at, kind, changes: [{ label, from, to }] }] — от старых к новым.
 * Значения сохраняются текстом «как было видно на экране», поэтому история не ломается,
 * если потом переименовать атрибут или вариант.
 */

const History = (() => {
  const MAX_ENTRIES = 300;
  const SHORT = 70;

  const KIND_TEXT = {
    added: 'Песня добавлена в библиотеку',
    restored: 'Песня возвращена из корзины',
    file: 'Заменён файл минусовки',
    'perf-add': 'Добавлена запись',
    'perf-remove': 'Удалена запись',
    'perf-best': 'Финальное выступление — эталонище!',
  };

  function short(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    return s.length > SHORT ? s.slice(0, SHORT - 1) + '…' : s;
  }

  /** Снимок всего, что видно пользователю, в виде текста: { ключ: { label, text } } */
  function snapshot(t) {
    const snap = {
      title: { label: 'Название', text: t.title || '' },
      artist: { label: 'Исполнитель', text: t.artist || '' },
      categories: {
        label: 'Категории',
        text: t.categories
          .map((id) => (Lib.cat(id) || {}).name)
          .filter(Boolean)
          .join(', '),
      },
      notes: { label: 'Комментарий', text: t.notes || '', long: true },
      clip: { label: 'Ссылка на клип', text: t.clipUrl || '' },
      vocal: { label: 'Запись с голосом', text: t.vocal ? (t.vocal.url ? t.vocal.url : 'файл «' + (t.vocal.originalFileName || 'запись') + '»') : '' },
      cover: { label: 'Обложка', text: t.cover ? 'своя картинка' : '' },
    };
    for (const a of Lib.attrs()) {
      snap['attr:' + a.id] = { label: a.name, text: Attr.text(a, t.attributes[a.id]), long: a.type === 'textarea' };
    }
    return snap;
  }

  function diff(before, after) {
    const changes = [];
    for (const [key, now] of Object.entries(after)) {
      const was = before[key] || { text: '' };
      if ((was.text || '') === (now.text || '')) continue;
      // key — чтобы статистика понимала, какая это шкала, даже если атрибут потом переименуют
      const id = key.startsWith('attr:') ? { key } : {};
      if (now.long && was.text && now.text) changes.push({ ...id, label: now.label, from: short(was.text), to: short(now.text), edited: true });
      else changes.push({ ...id, label: now.label, from: short(was.text), to: short(now.text) });
    }
    return changes;
  }

  /** Записать событие. Пустые правки (ничего не поменялось) не записываются — кроме служебных событий. */
  function record(t, changes, kind = 'edit') {
    if (kind === 'edit' && (!changes || !changes.length)) return false;
    t.history = Array.isArray(t.history) ? t.history : [];
    t.history.push({ at: new Date().toISOString(), kind, changes: changes || [] });
    if (t.history.length > MAX_ENTRIES) t.history.splice(0, t.history.length - MAX_ENTRIES);
    return true;
  }

  /** Для старых песен, у которых истории ещё не было, — «добавлена» берём из даты создания */
  function entries(t) {
    const list = (Array.isArray(t.history) ? t.history : []).slice();
    if (!list.some((e) => e.kind === 'added')) list.unshift({ at: t.createdAt, kind: 'added', changes: [] });
    return list.reverse(); // новые сверху
  }

  function changeLine(c) {
    const line = h('li.hist-change', null, h('b', { text: c.label }));
    if (c.edited) line.append(h('span.hist-note', { text: 'изменён(о)' }));
    else if (!c.from) line.append(h('span.hist-arrow', { text: 'добавлено:' }), h('span.hist-to', { text: c.to }));
    else if (!c.to) line.append(h('span.hist-from.gone', { text: c.from }), h('span.hist-note', { text: 'убрано' }));
    else line.append(h('span.hist-from', { text: c.from }), h('span.hist-arrow', { icon: 'arrow' }), h('span.hist-to', { text: c.to }));
    return line;
  }

  /** Блок «История» для страницы песни */
  function section(t) {
    const all = entries(t);
    const list = h('ol.hist-list');
    let shown = 0;
    const PAGE = 8;
    const more = h('button.link-btn.hist-more', {
      on: {
        click: () => {
          renderMore(all.length);
        },
      },
    });
    function renderMore(limit) {
      for (; shown < Math.min(limit, all.length); shown++) {
        const e = all[shown];
        const head = KIND_TEXT[e.kind] || null;
        list.appendChild(
          h(
            'li.hist-item.k-' + e.kind,
            null,
            h('span.hist-dot'),
            h(
              'div.hist-body',
              null,
              h('time.hist-date', { text: fmtDate(e.at), datetime: e.at }),
              head ? h('div.hist-head', { text: head }) : null,
              e.changes && e.changes.length ? h('ul.hist-changes', null, e.changes.map(changeLine)) : null
            )
          )
        );
      }
      more.hidden = shown >= all.length;
      more.textContent = `Показать всю историю (${all.length})`;
    }
    renderMore(PAGE);
    return h('section.d-panel.d-history', null, h('h2.d-h', null, h('span', { icon: 'clock' }), 'История'), list, more);
  }

  return { snapshot, diff, record, section, entries };
})();
