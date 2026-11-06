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
      maxlength: LIMITS.categoryName,
      autofocus: true,
      on: { keydown: (e) => e.key === 'Enter' && add() },
    });
    let color = CATEGORY_COLORS[Lib.cats().length % CATEGORY_COLORS.length];
    const swatches = colorButton(color, (c) => (color = c), { title: 'Цвет новой категории', size: 'lg' });

    const body = h(
      'div',
      null,
      h('div.cat-new', null, swatches.el, nameInp, h('button.btn.btn-primary', { type: 'button', on: { click: () => add() } }, h('span', { icon: 'plus' }), 'Создать')),
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
      const name = cleanLine(nameInp.value, LIMITS.categoryName);
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
          maxlength: LIMITS.categoryName,
          on: {
            change: async () => {
              const v = cleanLine(inp.value, LIMITS.categoryName);
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
        const row = h('div.cat-row', { dataset: { id: c.id }, style: { '--c': c.color } });
        const cp = colorButton(c.color, (col) => {
          c.color = col;
          row.style.setProperty('--c', col);
          saveColors();
        }, { title: 'Цвет категории', size: 'lg' });
        row.append(
          dragHandle(),
          cp.el,
          inp,
          h('span.cat-count', { text: `${n} ${plural(n, 'трек', 'трека', 'треков')}` }),
          h('button.icon-btn.sm.danger', { title: 'Удалить', icon: 'trash', on: { click: () => remove(c) } })
        );
        list.appendChild(row);
      });
    }

    // цвет меняется плавно при перетаскивании по палитре — сохраняем, когда пользователь остановился
    const saveColors = debounce(async () => {
      await Store.save('categories');
      App.refresh();
    }, 250);

    makeSortable(list, {
      item: '.cat-row',
      handle: '.drag-handle',
      onMove: async (from, to) => {
        moveItem(Lib.cats(), from, to);
        render();
        await Store.save('categories');
        App.refresh();
      },
    });

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
      const inp = h('input.input', { type: 'text', placeholder: 'Название категории', maxlength: LIMITS.categoryName, autofocus: true });
      let done = false;
      const finish = (m) => {
        done = true;
        resolve(cleanLine(inp.value, LIMITS.categoryName) || null);
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

  return { open, picker, count };
})();
