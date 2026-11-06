'use strict';
/*
 * Приветственное обучение: экран затемняется, подсвечивается нужная кнопка,
 * рядом — подсказка. Часть шагов просит нажать на подсвеченное (как в играх),
 * часть — просто прочитать и нажать «Дальше».
 */

const Tour = (() => {
  let active = false;
  let steps = [];
  let idx = 0;
  let els = null;
  let raf = 0;
  let currentTarget = null;
  let waiting = false;
  let openedFilters = false;

  const last = (sel) => {
    const list = [...document.querySelectorAll(sel)].filter((e) => e.getClientRects().length);
    return list[list.length - 1] || null;
  };

  function buildSteps() {
    const hasTracks = Lib.tracks().some((t) => t.status !== 'draft');
    return [
      {
        center: true,
        title: 'Привет! Это твоя музыкальная библиотека',
        text: 'За минуту покажу, где что находится. Подсвеченные кнопки можно будет понажимать — как в игре.',
        next: 'Поехали',
      },
      {
        target: () => document.getElementById('btnAdd'),
        title: 'Добавить трек',
        text: 'Главная кнопка. Нажимаешь, выбираешь минусовку на компьютере и заполняешь карточку песни. А ещё файл можно просто перетащить мышкой в окно программы.',
        hint: 'Сейчас нажимать не нужно — жми «Дальше».',
      },
      {
        target: () => document.querySelector('.search'),
        title: 'Поиск',
        text: 'Печатай название песни или любое слово из заметок — список сразу отфильтруется.',
      },
      {
        target: () => document.querySelector('.cat-strip'),
        title: 'Подборки',
        text: '«Для концерта», «Для репетиций»… Нажми на подборку — останутся только её песни. «Все» — снова показать всё.',
      },
      {
        target: () => document.querySelector('.filter-btn'),
        title: 'Фильтры',
        text: 'Здесь можно отобрать песни по любым характеристикам.',
        click: true,
        hint: 'Нажми на подсвеченную кнопку «Фильтры».',
        done: () => !document.getElementById('filterPanel').hidden,
        after: () => (openedFilters = true),
      },
      {
        target: () => document.getElementById('filterPanel'),
        title: 'Вот так выглядят фильтры',
        text: 'Они собираются сами из характеристик песен. Например: только грустные, на английском, которые ты знаешь на 7–10 из 10.',
        leave: closeFilters,
      },
      {
        target: () => document.querySelector('.sort'),
        title: 'Порядок',
        text: 'Как расставить песни: по дате, по названию или по тому, насколько хорошо ты их знаешь. Стрелка рядом меняет направление.',
      },
      {
        target: () => document.getElementById('btnAttributes'),
        title: 'Атрибуты',
        text: 'Атрибуты — это характеристики песни: характер, язык, знание, этап изучения.',
        click: true,
        hint: 'Нажми на «Атрибуты», чтобы открыть.',
        done: () => !!last('.modal .attr-list'),
      },
      {
        target: () => last('.modal .attr-row'),
        title: 'Это одна из характеристик',
        text: 'Карандаш — изменить, корзина — удалить, стрелки — поменять порядок. Кнопкой «Новый атрибут» можно придумать свою, например «Тональность» или «Темп». Новая характеристика сразу появится у всех песен, старые заполнять заново не придётся.',
      },
      {
        target: () => last('.modal .modal-x'),
        title: 'Закрываем окно',
        text: 'Любое окно закрывается крестиком в углу.',
        click: true,
        hint: 'Нажми на крестик.',
        pad: 4,
        done: () => !document.querySelector('.modal'),
      },
      {
        target: () => document.getElementById('btnCategories'),
        title: 'Категории',
        text: 'Здесь создаются подборки: «к концерту», «на распевку», «любимые». Одна песня может быть сразу в нескольких.',
      },
      {
        target: () => document.getElementById('btnSettings'),
        title: 'Настройки',
        text: 'Резервные копии, корзина с удалёнными песнями и перенос библиотеки на флешку. Автоматические копии сейчас выключены — включишь здесь, если захочешь. А в разделе «О приложении» можно пройти это обучение заново и написать автору.',
      },
      hasTracks
        ? {
            target: () => document.querySelector('.card .card-play'),
            title: 'Слушать',
            text: 'Круглая кнопка на карточке включает песню, внизу появится плеер. А если нажать на саму карточку — откроются все заметки о песне.',
          }
        : {
            target: () => document.querySelector('.welcome .btn-add'),
            title: 'Первая песня',
            text: 'Когда захочется — добавь первую минусовку здесь или кнопкой «Добавить трек» наверху.',
          },
      {
        center: true,
        title: 'Готово!',
        text: 'Библиотека в твоём распоряжении. Всё сохраняется само — ничего не нужно нажимать перед закрытием.',
        next: 'Начать',
      },
    ];
  }

  function closeFilters() {
    if (openedFilters && !document.getElementById('filterPanel').hidden) document.querySelector('.filter-btn').click();
    openedFilters = false;
  }

  function build() {
    const root = h('div.tour');
    const blockers = ['t', 'r', 'b', 'l', 'c'].map((k) => h('div.tour-block.tb-' + k, { on: { click: nudge } }));
    const hole = h('div.tour-hole');
    const bubble = h('div.tour-bubble', { role: 'dialog', 'aria-live': 'polite' });
    root.append(...blockers, hole, bubble);
    document.body.appendChild(root);
    return { root, blockers, hole, bubble };
  }

  function nudge() {
    els.bubble.classList.remove('nudge');
    void els.bubble.offsetWidth;
    els.bubble.classList.add('nudge');
  }

  function start() {
    if (active) return;
    UI.closeMenu();
    App.closeDetail();
    active = true;
    steps = buildSteps();
    idx = 0;
    els = build();
    document.body.classList.add('touring');
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('click', onClick, true);
    show();
    loop();
  }

  function onKey(e) {
    if (!active) return;
    // клавиши не должны случайно закрывать окна или запускать музыку во время обучения
    if (e.key === 'Escape' || e.code === 'Space' || e.key === 'Enter') {
      const inBubble = els.bubble.contains(e.target);
      if (e.key === 'Escape' || !inBubble) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }

  function onClick(e) {
    if (!active || waiting) return;
    const s = steps[idx];
    if (!s || !s.click || !currentTarget) return;
    if (currentTarget.contains(e.target)) {
      // клик проходит дальше к настоящей кнопке, а мы ждём результата
      waiting = true;
      els.bubble.classList.add('hidden');
      waitFor(s.done || (() => true), 3000).then(() => {
        waiting = false;
        if (s.after) s.after();
        go(idx + 1);
      });
    }
  }

  function waitFor(cond, timeout) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        if (cond() || Date.now() - t0 > timeout) setTimeout(resolve, 280); // даём окну доиграть анимацию
        else setTimeout(tick, 80);
      };
      tick();
    });
  }

  function go(i) {
    const s = steps[idx];
    if (s && s.leave) s.leave();
    idx = i;
    if (idx >= steps.length) return finish();
    show();
  }

  async function show() {
    const s = steps[idx];
    currentTarget = null;
    if (!s.center) {
      // ждём, пока нужная кнопка появится (например, окно открывается с анимацией)
      let el = s.target();
      const t0 = Date.now();
      while ((!el || !el.getClientRects().length) && Date.now() - t0 < 2500) {
        await new Promise((r) => setTimeout(r, 80));
        el = s.target();
      }
      if (!el || !el.getClientRects().length) return go(idx + 1); // шага нет на экране — пропускаем
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      currentTarget = el;
    }
    renderBubble(s);
    position();
  }

  function renderBubble(s) {
    const b = els.bubble;
    clear(b);
    b.classList.remove('hidden', 'nudge');
    b.classList.toggle('center', !!s.center);
    const total = steps.length;
    const dots = h('div.tour-dots', null, steps.map((_, i) => h('i' + (i === idx ? '.on' : i < idx ? '.done' : ''))));
    appendChildren(b, [
      h('div.tour-top', null, h('span.tour-step', { text: `${idx + 1} / ${total}` }), dots),
      h('h3.tour-title', { text: s.title }),
      h('p.tour-text', { text: s.text }),
      s.hint ? h('p.tour-hint' + (s.click ? '.click' : ''), null, h('span', { icon: s.click ? 'sparkle' : 'note' }), s.hint) : null,
      h(
        'div.tour-btns',
        null,
        idx < total - 1 ? h('button.tour-skip', { text: 'Пропустить обучение', on: { click: () => finish(true) } }) : null,
        h('span.spacer'),
        idx > 0 && !s.center && !s.click && !steps[idx - 1].click
          ? h('button.btn.btn-ghost.sm.tour-prev', { on: { click: () => go(idx - 1) } }, 'Назад')
          : null,
        s.click ? null : h('button.btn.btn-primary.sm.tour-next', { autofocus: true, on: { click: () => go(idx + 1) } }, s.next || 'Дальше', h('span', { icon: 'arrow' }))
      ),
    ]);
    const nb = b.querySelector('.tour-next');
    if (nb) setTimeout(() => nb.focus(), 50);
    els.root.classList.toggle('mode-click', !!s.click);
    els.root.classList.toggle('mode-center', !!s.center);
  }

  function position() {
    if (!active) return;
    const s = steps[idx];
    const W = window.innerWidth;
    const H = window.innerHeight;
    const b = els.bubble;
    const [bt, br, bb, bl, bc] = els.blockers;
    if (s.center || !currentTarget || !currentTarget.isConnected) {
      Object.assign(els.hole.style, { left: W / 2 + 'px', top: H / 2 + 'px', width: '0px', height: '0px' });
      setRect(bt, 0, 0, W, H);
      [br, bb, bl, bc].forEach((x) => setRect(x, 0, 0, 0, 0));
      b.style.left = Math.max(16, (W - b.offsetWidth) / 2) + 'px';
      b.style.top = Math.max(16, (H - b.offsetHeight) / 2) + 'px';
      return;
    }
    const pad = s.pad ?? 8;
    const r = currentTarget.getBoundingClientRect();
    const x = Math.max(4, r.left - pad);
    const y = Math.max(4, r.top - pad);
    const w = Math.min(W - 4, r.right + pad) - x;
    const hh = Math.min(H - 4, r.bottom + pad) - y;
    Object.assign(els.hole.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px' });
    // всё вокруг подсветки не кликается; сама подсветка — только в шагах «нажми»
    setRect(bt, 0, 0, W, y);
    setRect(bb, 0, y + hh, W, H - y - hh);
    setRect(bl, 0, y, x, hh);
    setRect(br, x + w, y, W - x - w, hh);
    setRect(bc, x, y, s.click ? 0 : w, s.click ? 0 : hh);

    // подсказка: снизу, сверху, справа или слева — где помещается
    const bw = b.offsetWidth;
    const bh = b.offsetHeight;
    const gap = 16;
    let left, top;
    if (y + hh + gap + bh < H - 8) {
      top = y + hh + gap;
      left = x + w / 2 - bw / 2;
    } else if (y - gap - bh > 8) {
      top = y - gap - bh;
      left = x + w / 2 - bw / 2;
    } else if (x + w + gap + bw < W - 8) {
      left = x + w + gap;
      top = y + hh / 2 - bh / 2;
    } else {
      left = x - gap - bw;
      top = y + hh / 2 - bh / 2;
    }
    b.style.left = Math.round(Math.min(Math.max(12, left), W - bw - 12)) + 'px';
    b.style.top = Math.round(Math.min(Math.max(12, top), H - bh - 12)) + 'px';
  }

  function setRect(el, x, y, w, hh) {
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.width = Math.max(0, w) + 'px';
    el.style.height = Math.max(0, hh) + 'px';
  }

  function loop() {
    if (!active) return;
    position();
    raf = requestAnimationFrame(loop);
  }

  function finish(skipped) {
    if (!active) return;
    const s = steps[idx];
    if (s && s.leave) s.leave();
    closeFilters();
    active = false;
    cancelAnimationFrame(raf);
    window.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onClick, true);
    els.root.classList.add('leaving');
    const root = els.root;
    setTimeout(() => root.remove(), 250);
    document.body.classList.remove('touring');
    if (!S.settings.tutorialDone) {
      S.settings.tutorialDone = true;
      Store.save('settings');
    }
    if (skipped) UI.toast('Обучение можно пройти снова: «Настройки» → «О приложении»');
  }

  return {
    start,
    isActive: () => active,
    // для автотестов
    info: () => (active ? { idx, total: steps.length, click: !!(steps[idx] && steps[idx].click), waiting } : null),
    target: () => currentTarget,
  };
})();
