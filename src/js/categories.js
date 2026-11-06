'use strict';
/* Категории — ручная группировка треков (независимо от атрибутов). */

const CATEGORY_COLORS = ['#ff6b9a', '#7b2ff7', '#6ff0c4', '#ffc94a', '#4a7bff', '#d6ff3d', '#ff8a4c', '#c04bd9', '#2bb8c9', '#24093f'];

const Categories = (() => {
  function count(id) {
    return Lib.tracks().filter((t) => t.categories.includes(id)).length;
  }

  function open() {
    const list = h('div.cat-list');
    const nameInp = h('input.input', {
      type: 'text',
      placeholder: 'Например: Для концерта',
      maxlength: 50,
      autofocus: true,
      on: { keydown: (e) => e.key === 'Enter' && add() },
    });
    let color = CATEGORY_COLORS[Lib.cats().length % CATEGORY_COLORS.length];
    const swatches = colorPicker(color, (c) => (color = c));

    const body = h(
      'div',
      null,
      h('div.cat-new', null, nameInp, swatches.el, h('button.btn.btn-primary', { type: 'button', on: { click: () => add() } }, h('span', { icon: 'plus' }), 'Создать')),
      list
    );
    UI.openModal({
      title: 'Категории',
      subtitle: 'Собирайте треки в подборки: «к концерту», «на распевку», «любимые». Один трек может быть в нескольких категориях.',
      wide: true,
      accent: 'cat',
      body,
      actions: ['spacer', { label: 'Готово', kind: 'ghost', onClick: (m) => m.close('done') }],
    });

    async function add() {
      const name = nameInp.value.trim();
      if (!name) return nameInp.focus();
      if (Lib.cats().some((c) => normalize(c.name) === normalize(name))) {
        UI.toast('Такая категория уже есть', { kind: 'error' });
        return;
      }
      Lib.cats().push({ id: uid('cat_'), name, color });
      await Store.save('categories');
      nameInp.value = '';
      color = CATEGORY_COLORS[Lib.cats().length % CATEGORY_COLORS.length];
      swatches.set(color);
      render();
      App.refresh();
    }

    function render() {
      clear(list);
      if (!Lib.cats().length) list.appendChild(h('p.muted', { text: 'Категорий пока нет.' }));
      Lib.cats().forEach((c, i) => {
        const n = count(c.id);
        const inp = h('input.input.cat-name', {
          type: 'text',
          value: c.name,
          maxlength: 50,
          on: {
            change: async () => {
              const v = inp.value.trim();
              if (!v || Lib.cats().some((x) => x.id !== c.id && normalize(x.name) === normalize(v))) {
                inp.value = c.name;
                UI.toast(v ? 'Такая категория уже есть' : 'Название не может быть пустым', { kind: 'error' });
                return;
              }
              c.name = v;
              await Store.save('categories');
              App.refresh();
            },
          },
        });
        const cp = colorPicker(c.color, async (col) => {
          c.color = col;
          await Store.save('categories');
          App.refresh();
          render();
        }, true);
        list.appendChild(
          h(
            'div.cat-row',
            { style: { '--c': c.color } },
            h('span.cat-blob'),
            inp,
            cp.el,
            h('span.cat-count', { text: `${n} ${plural(n, 'трек', 'трека', 'треков')}` }),
            h('button.icon-btn.sm', { title: 'Выше', icon: 'up', disabled: i === 0, on: { click: () => move(i, -1) } }),
            h('button.icon-btn.sm.danger', { title: 'Удалить', icon: 'trash', on: { click: () => remove(c) } })
          )
        );
      });
    }

    async function move(i, d) {
      const arr = Lib.cats();
      arr.splice(i + d, 0, arr.splice(i, 1)[0]);
      await Store.save('categories');
      render();
      App.refresh();
    }

    async function remove(c) {
      const n = count(c.id);
      const ok = await UI.confirm({
        title: `Удалить категорию «${c.name}»?`,
        text: n ? `Сами треки останутся в библиотеке — они просто перестанут относиться к этой категории (${n} ${plural(n, 'трек', 'трека', 'треков')}).` : 'В категории нет треков.',
        okLabel: 'Удалить',
        danger: true,
        icon: 'tag',
      });
      if (!ok) return;
      S.categories.categories = Lib.cats().filter((x) => x.id !== c.id);
      for (const t of Lib.tracks()) t.categories = t.categories.filter((id) => id !== c.id);
      await Store.save('categories');
      if (n) await Store.save('library');
      Filters.dropCategory(c.id);
      render();
      App.refresh();
    }

    render();
  }

  /** Переключатели категорий для формы трека */
  function picker(selected) {
    const sel = new Set(selected || []);
    const box = h('div.cat-picker');
    const paint = () => {
      clear(box);
      for (const c of Lib.cats()) {
        box.appendChild(
          h(
            'button.cat-chip' + (sel.has(c.id) ? '.on' : ''),
            {
              type: 'button',
              style: { '--c': c.color },
              on: {
                click: () => {
                  sel.has(c.id) ? sel.delete(c.id) : sel.add(c.id);
                  paint();
                },
              },
            },
            h('span.cat-chip-dot'),
            c.name
          )
        );
      }
      box.appendChild(
        h(
          'button.cat-chip.add',
          {
            type: 'button',
            on: {
              click: async () => {
                const name = await promptName();
                if (!name) return;
                let c = Lib.cats().find((x) => normalize(x.name) === normalize(name));
                if (!c) {
                  c = { id: uid('cat_'), name, color: CATEGORY_COLORS[Lib.cats().length % CATEGORY_COLORS.length] };
                  Lib.cats().push(c);
                  await Store.save('categories');
                  App.refresh();
                }
                sel.add(c.id);
                paint();
              },
            },
          },
          h('span', { icon: 'plus' }),
          'Новая'
        )
      );
    };
    paint();
    return { el: box, get: () => [...sel].filter((id) => Lib.cat(id)) };
  }

  function promptName() {
    return new Promise((resolve) => {
      const inp = h('input.input', { type: 'text', placeholder: 'Название категории', maxlength: 50, autofocus: true });
      let done = false;
      const finish = (m) => {
        done = true;
        resolve(inp.value.trim() || null);
        m.close('force');
      };
      const m = UI.openModal({
        title: 'Новая категория',
        className: 'small',
        body: inp,
        onClose: () => !done && resolve(null),
        actions: ['spacer', { label: 'Отмена', kind: 'ghost', onClick: (mm) => mm.close() }, { label: 'Создать', kind: 'primary', onClick: (mm) => finish(mm) }],
      });
      inp.addEventListener('keydown', (e) => e.key === 'Enter' && finish(m));
    });
  }

  function colorPicker(current, onPick, compact) {
    const el = h('div.swatches' + (compact ? '.compact' : ''));
    const set = (c) => {
      current = c;
      el.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.c === c));
    };
    for (const c of CATEGORY_COLORS) {
      el.appendChild(
        h('button.swatch', {
          type: 'button',
          dataset: { c },
          title: 'Цвет',
          style: { '--c': c },
          on: {
            click: () => {
              set(c);
              onPick(c);
            },
          },
        })
      );
    }
    set(current);
    return { el, set };
  }

  return { open, picker, count };
})();
