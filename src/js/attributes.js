'use strict';
/* Система пользовательских атрибутов: типы, поля ввода, отображение значений, конструктор. */

const ATTR_TYPES = {
  text: { label: 'Короткий текст', icon: 'text', hint: 'Пара слов: автор, тональность…' },
  textarea: { label: 'Многострочный текст', icon: 'paragraph', hint: 'Заметки любой длины' },
  select: { label: 'Выпадающий список', icon: 'list', hint: 'Один вариант из списка' },
  multiselect: { label: 'Множественный выбор', icon: 'checks', hint: 'Несколько вариантов сразу' },
  number: { label: 'Число', icon: 'hash', hint: 'Темп, год, номер…' },
  scale: { label: 'Оценка по шкале', icon: 'star', hint: 'Например, от 1 до 10' },
};

const OPTION_COLORS = ['#7b2ff7', '#ff6b9a', '#3fc79a', '#f0a92a', '#4a7bff', '#c04bd9', '#ff8a4c', '#2bb8c9'];

const Attr = {
  isEmpty(attr, v) {
    if (v === undefined || v === null) return true;
    if (attr.type === 'multiselect') return !Array.isArray(v) || v.length === 0;
    if (attr.type === 'number' || attr.type === 'scale') return v === '' || !Number.isFinite(Number(v));
    if (attr.type === 'select') return !(attr.options || []).some((o) => o.id === v);
    return String(v).trim() === '';
  },

  optionLabel(attr, id) {
    const o = (attr.options || []).find((x) => x.id === id);
    return o ? o.label : null;
  },

  optionColor(attr, id) {
    const opts = attr.options || [];
    const idx = opts.findIndex((x) => x.id === id);
    if (idx >= 0 && opts[idx].color) return opts[idx].color;
    return OPTION_COLORS[(idx < 0 ? 0 : idx) % OPTION_COLORS.length];
  },

  /** Текстовое представление значения (для поиска и краткого показа). */
  text(attr, v) {
    if (Attr.isEmpty(attr, v)) return '';
    if (attr.type === 'select') return Attr.optionLabel(attr, v) || '';
    if (attr.type === 'multiselect') return v.map((id) => Attr.optionLabel(attr, id)).filter(Boolean).join(', ');
    if (attr.type === 'scale') return `${v} из ${attr.max}`;
    return String(v);
  },

  /** Красивое отображение значения на странице трека. */
  display(attr, v, { onScaleChange } = {}) {
    if (attr.type === 'scale') {
      const min = attr.min ?? 1;
      const max = attr.max ?? 10;
      const val = Attr.isEmpty(attr, v) ? null : Number(v);
      const wrap = h('div.scale-display' + (onScaleChange ? '.interactive' : ''));
      for (let i = min; i <= max; i++) {
        wrap.appendChild(
          h('button.scale-dot' + (val !== null && i <= val ? '.on' : ''), {
            text: i,
            title: onScaleChange ? `Поставить ${i}` : '',
            tabindex: onScaleChange ? 0 : -1,
            style: { '--i': (i - min) / Math.max(1, max - min) },
            on: onScaleChange ? { click: () => onScaleChange(i) } : undefined,
          })
        );
      }
      return h('div.scale-wrap', null, wrap, h('span.scale-num', { text: val === null ? '—' : `${val}/${max}` }));
    }
    if (Attr.isEmpty(attr, v)) return h('span.val-empty', { text: 'не заполнено' });
    if (attr.type === 'select') {
      return h('span.chip.chip-solid', { style: { '--c': Attr.optionColor(attr, v) }, text: Attr.optionLabel(attr, v) });
    }
    if (attr.type === 'multiselect') {
      return h(
        'div.chips',
        null,
        v.filter((id) => Attr.optionLabel(attr, id)).map((id) => h('span.chip.chip-solid', { style: { '--c': Attr.optionColor(attr, id) }, text: Attr.optionLabel(attr, id) }))
      );
    }
    if (attr.type === 'textarea') return h('p.val-long', { text: v });
    return h('span.val-text', { text: String(v) });
  },

  /** Поле ввода. Возвращает {el, get(), focus()} */
  field(attr, value, { onChange } = {}) {
    const changed = () => onChange && onChange();
    switch (attr.type) {
      case 'text': {
        const inp = h('input.input', { type: 'text', value: value ?? '', on: { input: changed } });
        return { el: withCounter(inp, LIMITS.attrText), get: () => cleanLine(inp.value, LIMITS.attrText), focus: () => inp.focus() };
      }
      case 'textarea': {
        const ta = h('textarea.input.textarea', { rows: 4, on: { input: changed } });
        ta.value = value ?? '';
        return { el: withCounter(ta, LIMITS.attrTextarea), get: () => cleanText(ta.value, LIMITS.attrTextarea), focus: () => ta.focus() };
      }
      case 'select':
      case 'multiselect': {
        const multi = attr.type === 'multiselect';
        let sel = multi ? new Set(Array.isArray(value) ? value : []) : value ?? null;
        const box = h('div.option-picker' + (multi ? '.multi' : ''));
        const paint = () => {
          box.querySelectorAll('.opt').forEach((b) => {
            const on = multi ? sel.has(b.dataset.id) : sel === b.dataset.id;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', on);
          });
        };
        (attr.options || []).forEach((o, i) => {
          box.appendChild(
            h(
              'button.opt',
              {
                type: 'button',
                dataset: { id: o.id },
                style: { '--c': Attr.optionColor(attr, o.id) },
                on: {
                  click: () => {
                    if (multi) sel.has(o.id) ? sel.delete(o.id) : sel.add(o.id);
                    else sel = sel === o.id ? null : o.id;
                    paint();
                    changed();
                  },
                },
              },
              h('span.opt-dot'),
              o.label
            )
          );
        });
        if (!(attr.options || []).length) box.appendChild(h('span.val-empty', { text: 'В этом списке пока нет вариантов — добавьте их в «Атрибутах».' }));
        paint();
        return {
          el: box,
          get: () => (multi ? [...sel].filter((id) => attr.options.some((o) => o.id === id)) : sel),
          focus: () => box.querySelector('.opt') && box.querySelector('.opt').focus(),
        };
      }
      case 'number': {
        const inp = h('input.input.input-num', {
          type: 'number',
          step: 'any',
          min: attr.min ?? undefined,
          max: attr.max ?? undefined,
          on: { input: changed },
        });
        inp.value = value ?? '';
        return {
          el: inp,
          get: () => (inp.value === '' ? null : Number(inp.value)),
          bad: () => inp.validity.badInput,
          focus: () => inp.focus(),
        };
      }
      case 'scale': {
        const min = attr.min ?? 1;
        const max = attr.max ?? 10;
        let val = Attr.isEmpty(attr, value) ? null : Number(value);
        const box = h('div.scale-picker');
        const num = h('span.scale-picker-num');
        const paint = () => {
          box.querySelectorAll('.scale-cell').forEach((b) => b.classList.toggle('on', val !== null && Number(b.dataset.v) <= val));
          num.textContent = val === null ? '—' : String(val);
        };
        for (let i = min; i <= max; i++) {
          box.appendChild(
            h('button.scale-cell', {
              type: 'button',
              text: i,
              dataset: { v: i },
              style: { '--i': (i - min) / Math.max(1, max - min) },
              on: {
                click: () => {
                  val = val === i ? null : i;
                  paint();
                  changed();
                },
              },
            })
          );
        }
        paint();
        return { el: h('div.scale-field', null, box, num), get: () => val, focus: () => box.firstChild && box.firstChild.focus() };
      }
    }
    return { el: h('span'), get: () => null, focus() {} };
  },
};

/* ---------- Конструктор атрибутов ---------- */

const AttributesManager = (() => {
  function usage(attrId) {
    return Lib.tracks().filter((t) => !Attr.isEmpty(Lib.attr(attrId), t.attributes[attrId])).length;
  }

  function open() {
    const listBox = h('div.attr-list');
    const m = UI.openModal({
      title: 'Атрибуты',
      subtitle: 'Характеристики, которые вы задаёте каждой песне. Новые атрибуты сразу появляются у всех треков.',
      wide: true,
      accent: 'attr',
      body: listBox,
      actions: [
        { label: 'Новый атрибут', kind: 'primary', icon: 'plus', onClick: () => edit(null, render) },
        'spacer',
        { label: 'Готово', kind: 'ghost', onClick: (mm) => mm.close('done') },
      ],
    });

    function render() {
      clear(listBox);
      const attrs = Lib.attrs();
      if (!attrs.length) listBox.appendChild(h('p.muted', { text: 'Атрибутов пока нет. Создайте первый!' }));
      attrs.forEach((a, i) => {
        const used = usage(a.id);
        listBox.appendChild(
          h(
            'div.attr-row',
            { dataset: { id: a.id } },
            dragHandle(),
            h('span.attr-type-ic', { icon: ATTR_TYPES[a.type].icon }),
            h(
              'div.attr-row-main',
              null,
              h('b', { text: a.name }),
              h(
                'span.attr-row-meta',
                null,
                ATTR_TYPES[a.type].label,
                a.type === 'select' || a.type === 'multiselect' ? ` · ${a.options.length} ${plural(a.options.length, 'вариант', 'варианта', 'вариантов')}` : '',
                a.type === 'scale' ? ` · от ${a.min} до ${a.max}` : '',
                ` · заполнено у ${used} ${plural(used, 'трека', 'треков', 'треков')}`
              )
            ),
            a.required ? h('span.badge.badge-req', { text: 'обязательный' }) : null,
            a.showOnCard ? h('span.badge', { text: 'на карточке' }) : null,
            h(
              'div.row-btns',
              null,
              h('button.icon-btn.sm', { title: 'Изменить', icon: 'edit', on: { click: () => edit(a, render) } }),
              h('button.icon-btn.sm.danger', { title: 'Удалить', icon: 'trash', on: { click: () => remove(a, render) } })
            )
          )
        );
      });
    }

    makeSortable(listBox, {
      item: '.attr-row',
      handle: '.drag-handle',
      onMove: async (from, to) => {
        moveItem(Lib.attrs(), from, to);
        render();
        await Store.save('attributes');
        App.refresh();
      },
    });
    render();
    return m;
  }

  async function remove(a, after) {
    const used = usage(a.id);
    const r = await UI.confirm({
      title: `Удалить атрибут «${a.name}»?`,
      text: used
        ? `Он заполнен у ${used} ${plural(used, 'трека', 'треков', 'треков')}. Эти значения тоже будут удалены. Перед удалением автоматически создастся резервная копия.`
        : 'Атрибут нигде не заполнен, удалить его безопасно.',
      okLabel: 'Удалить',
      danger: true,
      icon: 'trash',
    });
    if (!r) return;
    if (used) await Backup.auto('before-attribute-delete');
    S.attributes.attributes = Lib.attrs().filter((x) => x.id !== a.id);
    for (const t of Lib.tracks()) delete t.attributes[a.id];
    for (const tr of S.library.trash) if (tr.track) delete tr.track.attributes[a.id];
    await Store.save('attributes');
    await Store.save('library');
    Filters.dropAttr(a.id);
    after();
    App.refresh();
    UI.toast(`Атрибут «${a.name}» удалён`);
  }

  function edit(existing, after) {
    const draft = existing
      ? deepClone(existing)
      : { id: uid('a_'), name: '', type: 'select', required: false, showOnCard: false, options: [], min: 1, max: 10 };
    if (!draft.options) draft.options = [];
    const originalType = existing ? existing.type : null;

    const nameInp = h('input.input', { type: 'text', value: draft.name, placeholder: 'Например: Тональность', maxlength: LIMITS.attrName, autofocus: true });
    const typeGrid = h('div.type-grid');
    const specific = h('div.attr-specific');
    const reqToggle = toggle('Обязательно заполнять при добавлении трека', draft.required);
    const cardToggle = toggle('Показывать на карточке трека', draft.showOnCard);
    const err = h('p.form-error', { hidden: true });

    for (const [type, info] of Object.entries(ATTR_TYPES)) {
      typeGrid.appendChild(
        h(
          'button.type-tile',
          {
            type: 'button',
            dataset: { type },
            on: {
              click: () => {
                draft.type = type;
                paintTypes();
                renderSpecific();
              },
            },
          },
          h('span.type-tile-ic', { icon: info.icon }),
          h('b', { text: info.label }),
          h('small', { text: info.hint })
        )
      );
    }
    function paintTypes() {
      typeGrid.querySelectorAll('.type-tile').forEach((b) => b.classList.toggle('on', b.dataset.type === draft.type));
    }

    let minInp, maxInp;
    function renderSpecific() {
      clear(specific);
      if (draft.type === 'select' || draft.type === 'multiselect') {
        const list = h('div.opt-editor');
        // у каждого варианта свой сохранённый цвет (раньше цвет зависел от порядка)
        draft.options.forEach((o, i) => (o.color = o.color || OPTION_COLORS[i % OPTION_COLORS.length]));
        makeSortable(list, {
          item: '.opt-edit-row:not(.opt-add)',
          handle: '.drag-handle',
          onMove: (from, to) => {
            moveItem(draft.options, from, to);
            paint();
          },
        });
        const paint = () => {
          clear(list);
          draft.options.forEach((o, i) => {
            const inp = h('input.input', {
              type: 'text',
              value: o.label,
              placeholder: 'Вариант',
              maxlength: LIMITS.optionLabel,
              on: { input: () => (o.label = inp.value) },
            });
            list.appendChild(
              h(
                'div.opt-edit-row',
                null,
                dragHandle(),
                colorButton(o.color, (c) => (o.color = c), { title: 'Цвет варианта' }).el,
                inp,
                h('button.icon-btn.sm.danger', {
                  type: 'button',
                  title: 'Убрать вариант',
                  icon: 'close',
                  on: {
                    click: () => {
                      draft.options.splice(i, 1);
                      paint();
                    },
                  },
                })
              )
            );
          });
          const addInp = h('input.input', {
            type: 'text',
            placeholder: 'Новый вариант — и Enter',
            maxlength: LIMITS.optionLabel,
            on: {
              keydown: (e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addOpt();
                }
              },
            },
          });
          const addOpt = () => {
            const v = cleanLine(addInp.value, LIMITS.optionLabel);
            if (!v) return;
            draft.options.push({ id: uid('o_'), label: v, color: OPTION_COLORS[draft.options.length % OPTION_COLORS.length] });
            paint();
            list.querySelector('.opt-add input').focus();
          };
          list.appendChild(h('div.opt-edit-row.opt-add', null, h('span.drag-spacer'), h('span.opt-dot.ghost'), addInp, h('button.btn.btn-soft.sm', { type: 'button', text: 'Добавить', on: { click: addOpt } })));
        };
        paint();
        specific.appendChild(h('label.field-label', { text: 'Варианты' }));
        specific.appendChild(list);
      } else if (draft.type === 'number' || draft.type === 'scale') {
        const isScale = draft.type === 'scale';
        minInp = h('input.input.input-num', { type: 'number', value: draft.min ?? (isScale ? 1 : ''), placeholder: 'нет' });
        maxInp = h('input.input.input-num', { type: 'number', value: draft.max ?? (isScale ? 10 : ''), placeholder: 'нет' });
        specific.appendChild(
          h(
            'div.minmax',
            null,
            h('label.field', null, h('span.field-label', { text: 'Минимум' }), minInp),
            h('label.field', null, h('span.field-label', { text: 'Максимум' }), maxInp),
            h('p.muted.small', { text: isScale ? 'Шкала — это ряд кружочков от минимума до максимума (не больше 20 делений).' : 'Можно оставить пустым, если ограничений нет.' })
          )
        );
      }
    }

    paintTypes();
    renderSpecific();

    const body = h(
      'div.attr-editor',
      null,
      h('label.field', null, h('span.field-label', { text: 'Название' }), nameInp),
      h('span.field-label', { text: 'Тип' }),
      typeGrid,
      specific,
      h('div.toggles', null, reqToggle.el, cardToggle.el),
      err
    );

    const m = UI.openModal({
      title: existing ? 'Изменить атрибут' : 'Новый атрибут',
      wide: true,
      accent: 'attr',
      body,
      actions: ['spacer', { label: 'Отмена', kind: 'ghost', onClick: (mm) => mm.close('cancel') }, { label: 'Сохранить', kind: 'primary', icon: 'check', onClick: () => submit() }],
    });

    function fail(text) {
      err.textContent = text;
      err.hidden = false;
    }

    async function submit() {
      err.hidden = true;
      draft.name = cleanLine(nameInp.value, LIMITS.attrName);
      draft.required = reqToggle.get();
      draft.showOnCard = cardToggle.get();
      if (!draft.name) return fail('Дайте атрибуту название.');
      if (Lib.attrs().some((a) => a.id !== draft.id && normalize(a.name) === normalize(draft.name))) return fail('Атрибут с таким названием уже есть.');
      if (draft.type === 'select' || draft.type === 'multiselect') {
        draft.options = draft.options.map((o) => ({ ...o, label: cleanLine(o.label, LIMITS.optionLabel) })).filter((o) => o.label);
        if (!draft.options.length) return fail('Добавьте хотя бы один вариант.');
        const labels = draft.options.map((o) => normalize(o.label));
        if (new Set(labels).size !== labels.length) return fail('Варианты не должны повторяться.');
      } else {
        delete draft.options;
      }
      if (draft.type === 'number' || draft.type === 'scale') {
        const mn = minInp.value === '' ? null : Number(minInp.value);
        const mx = maxInp.value === '' ? null : Number(maxInp.value);
        if (draft.type === 'scale') {
          if (mn === null || mx === null) return fail('У шкалы должны быть минимум и максимум.');
          if (!Number.isInteger(mn) || !Number.isInteger(mx)) return fail('Границы шкалы должны быть целыми числами.');
          if (mx - mn < 1 || mx - mn > 19) return fail('В шкале должно быть от 2 до 20 делений.');
        }
        if (mn !== null && mx !== null && mn >= mx) return fail('Минимум должен быть меньше максимума.');
        draft.min = mn;
        draft.max = mx;
      } else {
        delete draft.min;
        delete draft.max;
      }

      // Последствия для уже заполненных значений
      const affected = [];
      if (existing) {
        const typeChanged = originalType !== draft.type;
        const compatible =
          (['select', 'multiselect'].includes(originalType) && ['select', 'multiselect'].includes(draft.type)) ||
          (['text', 'textarea'].includes(originalType) && ['text', 'textarea'].includes(draft.type)) ||
          (['number', 'scale'].includes(originalType) && ['number', 'scale'].includes(draft.type));
        for (const t of Lib.tracks()) {
          const v = t.attributes[draft.id];
          if (Attr.isEmpty(existing, v)) continue;
          const nv = convertValue(existing, draft, v, typeChanged && !compatible);
          if (JSON.stringify(nv) !== JSON.stringify(v)) affected.push({ t, nv });
        }
        if (affected.length) {
          const ok = await UI.confirm({
            title: 'Это затронет уже заполненные треки',
            text: `У ${affected.length} ${plural(affected.length, 'трека', 'треков', 'треков')} значение этого атрибута изменится или очистится (например, если вариант удалён или значение вышло за границы). Продолжить?`,
            okLabel: 'Да, применить',
            icon: 'warn',
          });
          if (!ok) return;
          await Backup.auto('before-attribute-change');
        }
      }

      const list = Lib.attrs();
      const idx = list.findIndex((a) => a.id === draft.id);
      if (idx >= 0) list[idx] = draft;
      else list.push(draft);
      for (const { t, nv } of affected) {
        if (Attr.isEmpty(draft, nv)) delete t.attributes[draft.id];
        else t.attributes[draft.id] = nv;
      }
      await Store.save('attributes');
      if (affected.length) await Store.save('library');
      Filters.dropAttr(draft.id);
      m.close('force');
      after && after();
      App.refresh();
      UI.toast(existing ? 'Атрибут обновлён' : `Атрибут «${draft.name}» создан — он уже есть у всех треков`, { kind: 'ok' });
    }
  }

  function convertValue(from, to, v, incompatible) {
    if (incompatible) {
      // текст ↔ число: пытаемся сохранить смысл
      if (['number', 'scale'].includes(to.type)) {
        const n = Number(String(Attr.text(from, v)).replace(',', '.'));
        return withinBounds(to, n) ? n : null;
      }
      if (['text', 'textarea'].includes(to.type)) return Attr.text(from, v);
      if (['select', 'multiselect'].includes(to.type)) {
        const label = normalize(Attr.text(from, v));
        const o = to.options.find((x) => normalize(x.label) === label);
        return o ? (to.type === 'multiselect' ? [o.id] : o.id) : null;
      }
      return null;
    }
    if (to.type === 'select') {
      const id = Array.isArray(v) ? v.find((x) => to.options.some((o) => o.id === x)) : v;
      return to.options.some((o) => o.id === id) ? id : null;
    }
    if (to.type === 'multiselect') {
      const arr = Array.isArray(v) ? v : [v];
      return arr.filter((x) => to.options.some((o) => o.id === x));
    }
    if (to.type === 'number' || to.type === 'scale') {
      let n = Number(v);
      if (to.type === 'scale') n = Math.round(n);
      return withinBounds(to, n) ? n : null;
    }
    return v;
  }

  function withinBounds(a, n) {
    if (!Number.isFinite(n)) return false;
    if (a.min !== null && a.min !== undefined && n < a.min) return false;
    if (a.max !== null && a.max !== undefined && n > a.max) return false;
    return true;
  }

  return { open };
})();

function toggle(label, on) {
  const inp = h('input', { type: 'checkbox', checked: !!on });
  const el = h('label.toggle', null, inp, h('span.toggle-track', null, h('span.toggle-knob')), h('span', { text: label }));
  return { el, get: () => inp.checked };
}
