'use strict';
/* Поиск, фильтры (строятся автоматически по атрибутам), категории и сортировка. */

const Filters = (() => {
  const state = {
    search: '',
    cats: new Set(),
    attrs: {}, // attrId -> {kind:'options', values:Set} | {kind:'range', min, max} | {kind:'filled', value:'yes'|'no'}
    panelOpen: false,
  };

  const bar = () => document.getElementById('filterbar');
  const panel = () => document.getElementById('filterPanel');
  let searchInp;

  function activeCount() {
    return state.cats.size + Object.keys(state.attrs).length;
  }

  function changed() {
    renderBar();
    if (state.panelOpen) renderPanel();
    App.renderGrid();
  }

  function renderBar() {
    const b = bar();
    if (!searchInp) {
      searchInp = h('input.search-input', {
        type: 'search',
        placeholder: 'Найти песню, заметку, этап…',
        maxlength: LIMITS.search,
        on: {
          input: debounce(() => {
            state.search = searchInp.value;
            App.renderGrid();
          }, 120),
        },
      });
    }
    const keepFocus = document.activeElement === searchInp;
    clear(b);
    const opts = sortOptions();
    if (!opts.some((o) => o.value === S.settings.sort.key)) S.settings.sort.key = 'createdAt';
    const sortSel = dropdown({
      options: opts,
      value: S.settings.sort.key,
      title: 'Как расставить песни',
      className: 'sort-dd',
      onChange: (v) => {
        S.settings.sort.key = v;
        Store.save('settings');
        App.renderGrid();
      },
    }).el;

    const cnt = Object.keys(state.attrs).length;
    const strip = h(
      'div.cat-strip',
      null,
      h(
        'button.cat-pill' + (state.cats.size === 0 ? '.on' : ''),
        {
          on: {
            click: () => {
              state.cats.clear();
              changed();
            },
          },
        },
        'Все'
      ),
      Lib.cats().map((c) =>
        h(
          'button.cat-pill' + (state.cats.has(c.id) ? '.on' : ''),
          {
            style: { '--c': c.color },
            on: {
              click: () => {
                state.cats.has(c.id) ? state.cats.delete(c.id) : state.cats.add(c.id);
                changed();
              },
            },
          },
          h('span.cat-pill-dot'),
          c.name,
          h('small', { text: Categories.count(c.id) })
        )
      )
    );
    // если категорий больше, чем помещается, — стрелки по краям и прокрутка колёсиком мыши
    const scrollBy = (dir) => strip.scrollBy({ left: dir * Math.max(160, strip.clientWidth * 0.7), behavior: 'smooth' });
    const catScroll = h(
      'div.cat-scroll',
      null,
      h('button.cat-arrow.left', { type: 'button', title: 'Предыдущие категории', 'aria-label': 'Предыдущие категории', icon: 'chevLeft', on: { click: () => scrollBy(-1) } }),
      strip,
      h('button.cat-arrow.right', { type: 'button', title: 'Следующие категории', 'aria-label': 'Следующие категории', icon: 'chevRight', on: { click: () => scrollBy(1) } })
    );
    strip.addEventListener(
      'scroll',
      () => {
        state.catScroll = strip.scrollLeft;
        updateArrows();
      },
      { passive: true }
    );
    strip.addEventListener(
      'wheel',
      (e) => {
        const max = strip.scrollWidth - strip.clientWidth;
        if (max <= 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
        e.preventDefault();
        strip.scrollLeft += e.deltaY;
      },
      { passive: false }
    );
    b.append(
      h('label.search', null, h('span', { icon: 'search' }), searchInp),
      h(
        'div.cat-line',
        null,
        catScroll,
        // та же функция, что у кнопки «Категории» наверху, — но там, где на неё смотрят
        h('button.cat-add', { title: 'Создать категорию', 'aria-label': 'Создать категорию', icon: 'plus', on: { click: () => Categories.open() } })
      ),
      h(
        'button.filter-btn' + (state.panelOpen ? '.open' : '') + (cnt ? '.has' : ''),
        {
          on: {
            click: () => {
              state.panelOpen = !state.panelOpen;
              renderBar();
              renderPanel();
            },
          },
        },
        h('span', { icon: 'filter' }),
        'Фильтры',
        cnt ? h('b.filter-count', { text: cnt }) : null
      ),
      h(
        'div.sort',
        null,
        sortSel,
        h('button.icon-btn.sort-dir', {
          title: S.settings.sort.dir === 'asc' ? 'По возрастанию' : 'По убыванию',
          icon: S.settings.sort.dir === 'asc' ? 'sortUp' : 'sortDown',
          on: {
            click: () => {
              S.settings.sort.dir = S.settings.sort.dir === 'asc' ? 'desc' : 'asc';
              Store.save('settings');
              renderBar();
              App.renderGrid();
            },
          },
        })
      )
    );
    if (keepFocus) searchInp.focus();
    strip.scrollLeft = state.catScroll || 0;
    requestAnimationFrame(updateArrows);
  }

  /** Показать/спрятать стрелки строки категорий в зависимости от того, есть ли что прокручивать */
  function updateArrows() {
    const wrap = document.querySelector('.cat-scroll');
    if (!wrap) return;
    const strip = wrap.querySelector('.cat-strip');
    const max = strip.scrollWidth - strip.clientWidth;
    wrap.classList.toggle('can-left', strip.scrollLeft > 2);
    wrap.classList.toggle('can-right', strip.scrollLeft < max - 2);
  }
  window.addEventListener('resize', () => requestAnimationFrame(updateArrows));

  function sortOptions() {
    const g1 = 'Основное';
    const g2 = 'По характеристикам';
    const list = [
      { value: 'createdAt', label: 'Дата добавления', group: g1 },
      { value: 'updatedAt', label: 'Дата изменения', group: g1 },
      { value: 'title', label: 'Название', group: g1 },
      { value: 'duration', label: 'Длительность', group: g1 },
    ];
    for (const a of Lib.attrs()) {
      if (a.type === 'number' || a.type === 'scale' || a.type === 'select') list.push({ value: 'attr:' + a.id, label: a.name, group: g2 });
    }
    return list;
  }

  function renderPanel() {
    const p = panel();
    p.hidden = !state.panelOpen;
    if (!state.panelOpen) return;
    clear(p);
    const groups = h('div.fp-groups');
    for (const a of Lib.attrs()) {
      const g = group(a);
      if (g) groups.appendChild(g);
    }
    if (!groups.children.length) groups.appendChild(h('p.muted', { text: 'Создайте атрибуты — и по ним можно будет фильтровать.' }));
    p.append(
      groups,
      h(
        'div.fp-foot',
        null,
        h('span.muted.small', { text: 'Внутри одного атрибута — «любой из», между атрибутами — «и».' }),
        h('span.spacer'),
        h('button.btn.btn-ghost.sm', { on: { click: reset } }, h('span', { icon: 'undo' }), 'Сбросить всё'),
        h(
          'button.btn.btn-soft.sm',
          {
            on: {
              click: () => {
                state.panelOpen = false;
                renderBar();
                renderPanel();
              },
            },
          },
          'Свернуть'
        )
      )
    );
  }

  function group(a) {
    const f = state.attrs[a.id];
    const head = h('div.fp-head', null, h('span', { icon: ATTR_TYPES[a.type].icon }), h('b', { text: a.name }));
    if (f) {
      head.appendChild(
        h('button.fp-clear', {
          text: 'сбросить',
          on: {
            click: () => {
              delete state.attrs[a.id];
              changed();
            },
          },
        })
      );
    }
    if (a.type === 'select' || a.type === 'multiselect') {
      const vals = f ? f.values : new Set();
      return h(
        'div.fp-group',
        null,
        head,
        h(
          'div.fp-opts',
          null,
          (a.options || []).map((o, i) =>
            h(
              'button.fp-opt' + (vals.has(o.id) ? '.on' : ''),
              {
                style: { '--c': Attr.optionColor(a, o.id) },
                on: {
                  click: () => {
                    const s = new Set(vals);
                    s.has(o.id) ? s.delete(o.id) : s.add(o.id);
                    if (s.size) state.attrs[a.id] = { kind: 'options', values: s };
                    else delete state.attrs[a.id];
                    changed();
                  },
                },
              },
              o.label
            )
          ),
          h(
            'button.fp-opt.none' + (vals.has('__none') ? '.on' : ''),
            {
              title: 'Треки, у которых не выбрано',
              on: {
                click: () => {
                  const s = new Set(vals);
                  s.has('__none') ? s.delete('__none') : s.add('__none');
                  if (s.size) state.attrs[a.id] = { kind: 'options', values: s };
                  else delete state.attrs[a.id];
                  changed();
                },
              },
            },
            'не указано'
          )
        )
      );
    }
    if (a.type === 'number' || a.type === 'scale') {
      const bounds = numericBounds(a);
      if (!bounds) return h('div.fp-group', null, head, h('p.muted.small', { text: 'Пока нет значений.' }));
      const cur = f || { min: bounds.min, max: bounds.max };
      return h('div.fp-group', null, head, rangeSlider(bounds, cur, a.type === 'scale' ? 1 : bounds.step, (mn, mx) => {
        if (mn <= bounds.min && mx >= bounds.max) delete state.attrs[a.id];
        else state.attrs[a.id] = { kind: 'range', min: mn, max: mx };
        App.renderGrid();
        renderBar();
        // обновим только заголовок группы, слайдер не перерисовываем, чтобы не потерять перетаскивание
      }));
    }
    // текстовые: заполнено / не заполнено (сам текст ищется через поиск)
    const v = f ? f.value : null;
    const mk = (val, label) =>
      h('button.fp-opt' + (v === val ? '.on' : ''), {
        text: label,
        on: {
          click: () => {
            if (v === val) delete state.attrs[a.id];
            else state.attrs[a.id] = { kind: 'filled', value: val };
            changed();
          },
        },
      });
    return h('div.fp-group', null, head, h('div.fp-opts', null, mk('yes', 'заполнено'), mk('no', 'пусто')));
  }

  function numericBounds(a) {
    if (a.type === 'scale') return { min: a.min, max: a.max, step: 1 };
    const vals = Lib.tracks()
      .map((t) => t.attributes[a.id])
      .filter((v) => !Attr.isEmpty(a, v))
      .map(Number);
    let mn = a.min ?? (vals.length ? Math.min(...vals) : null);
    let mx = a.max ?? (vals.length ? Math.max(...vals) : null);
    if (mn === null || mx === null) return null;
    if (mn === mx) mx = mn + 1;
    const allInt = vals.every(Number.isInteger) && Number.isInteger(mn) && Number.isInteger(mx);
    return { min: mn, max: mx, step: allInt ? 1 : (mx - mn) / 100 };
  }

  function rangeSlider(bounds, cur, step, onChange) {
    const lo = h('input.rs-input', { type: 'range', min: bounds.min, max: bounds.max, step, value: cur.min });
    const hi = h('input.rs-input', { type: 'range', min: bounds.min, max: bounds.max, step, value: cur.max });
    const label = h('span.rs-label');
    const wrap = h('div.range-slider', null, h('div.rs-track', null, h('div.rs-fill')), lo, hi);
    const paint = () => {
      let a = Number(lo.value);
      let b = Number(hi.value);
      if (a > b) [a, b] = [b, a];
      const span = bounds.max - bounds.min || 1;
      wrap.style.setProperty('--a', ((a - bounds.min) / span) * 100 + '%');
      wrap.style.setProperty('--b', ((b - bounds.min) / span) * 100 + '%');
      const fmt = (x) => String(Math.round(x * 100) / 100).replace('.', ',');
      label.textContent = a === b ? fmt(a) : `от ${fmt(a)} до ${fmt(b)}`;
      return [a, b];
    };
    const emit = debounce(() => {
      const [a, b] = paint();
      onChange(a, b);
    }, 60);
    lo.addEventListener('input', () => {
      paint();
      emit();
    });
    hi.addEventListener('input', () => {
      paint();
      emit();
    });
    paint();
    return h('div.rs', null, wrap, label);
  }

  /** Подходит ли трек под текущие фильтры */
  function match(t) {
    if (state.cats.size && !t.categories.some((id) => state.cats.has(id))) return false;
    for (const [id, f] of Object.entries(state.attrs)) {
      const a = Lib.attr(id);
      if (!a) continue;
      const v = t.attributes[id];
      const empty = Attr.isEmpty(a, v);
      if (f.kind === 'options') {
        let ok = false;
        if (f.values.has('__none') && empty) ok = true;
        if (!empty) {
          const arr = Array.isArray(v) ? v : [v];
          if (arr.some((x) => f.values.has(x))) ok = true;
        }
        if (!ok) return false;
      } else if (f.kind === 'range') {
        if (empty) return false;
        const n = Number(v);
        if (n < f.min - 1e-9 || n > f.max + 1e-9) return false;
      } else if (f.kind === 'filled') {
        if ((f.value === 'yes') === empty) return false;
      }
    }
    const q = normalize(state.search).trim();
    if (q) {
      const hay = normalize(
        [t.title, t.originalFileName, t.notes, ...Lib.attrs().map((a) => Attr.text(a, t.attributes[a.id])), ...t.categories.map((id) => (Lib.cat(id) || {}).name)].join(' \u0001 ')
      );
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  }

  function sort(list) {
    const { key, dir } = S.settings.sort;
    const sign = dir === 'asc' ? 1 : -1;
    const coll = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });
    let getter;
    let isText = false;
    if (key === 'title') {
      getter = (t) => t.title;
      isText = true;
    } else if (key === 'createdAt' || key === 'updatedAt') getter = (t) => t[key] || '';
    else if (key === 'duration') getter = (t) => t.duration ?? null;
    else if (key.startsWith('attr:')) {
      const a = Lib.attr(key.slice(5));
      if (a && a.type === 'select') getter = (t) => {
        const i = a.options.findIndex((o) => o.id === t.attributes[a.id]);
        return i < 0 ? null : i;
      };
      else getter = (t) => (a && !Attr.isEmpty(a, t.attributes[a.id]) ? Number(t.attributes[a.id]) : null);
    } else getter = (t) => t.createdAt;
    return list.slice().sort((x, y) => {
      const a = getter(x);
      const b = getter(y);
      if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1; // пустые — в конец
      if (b === null || b === undefined) return -1;
      const c = isText ? coll.compare(a, b) : a < b ? -1 : a > b ? 1 : 0;
      return c * sign || coll.compare(x.title, y.title);
    });
  }

  function reset() {
    state.cats.clear();
    state.attrs = {};
    state.search = '';
    if (searchInp) searchInp.value = '';
    changed();
  }

  function isActive() {
    return activeCount() > 0 || state.search.trim() !== '';
  }

  /** Плашки активных фильтров над сеткой */
  function activePills() {
    const out = [];
    for (const id of state.cats) {
      const c = Lib.cat(id);
      if (c)
        out.push(
          pill(c.name, () => {
            state.cats.delete(id);
            changed();
          }, c.color)
        );
    }
    for (const [id, f] of Object.entries(state.attrs)) {
      const a = Lib.attr(id);
      if (!a) continue;
      let text = a.name + ': ';
      if (f.kind === 'options') text += [...f.values].map((v) => (v === '__none' ? 'не указано' : Attr.optionLabel(a, v))).filter(Boolean).join(' или ');
      else if (f.kind === 'range') text += f.min === f.max ? f.min : `${f.min}–${f.max}`;
      else text += f.value === 'yes' ? 'заполнено' : 'пусто';
      out.push(
        pill(text, () => {
          delete state.attrs[id];
          changed();
        })
      );
    }
    if (state.search.trim())
      out.push(
        pill('«' + state.search.trim() + '»', () => {
          state.search = '';
          searchInp.value = '';
          changed();
        })
      );
    return out;
  }
  function pill(text, onRemove, color) {
    return h('button.active-pill', { style: color ? { '--c': color } : undefined, title: 'Убрать фильтр', on: { click: onRemove } }, h('span', { text }), h('span', { icon: 'close' }));
  }

  function dropAttr(id) {
    delete state.attrs[id];
    if (S.settings.sort.key === 'attr:' + id && !Lib.attr(id)) S.settings.sort.key = 'createdAt';
  }
  function dropCategory(id) {
    state.cats.delete(id);
  }

  function focusSearch() {
    searchInp && searchInp.focus();
  }

  return { renderBar, renderPanel, match, sort, reset, isActive, activePills, dropAttr, dropCategory, focusSearch };
})();
