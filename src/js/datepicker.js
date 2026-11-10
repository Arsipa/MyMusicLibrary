'use strict';
/*
 * Выбор периода в стиле приложения (вместо системного календаря): одна кнопка «с … по …»,
 * по нажатию — календарь. Первый клик — начало периода, второй — конец (порядок неважен, даты поменяются местами).
 * Значения — строки 'ГГГГ-ММ-ДД'. Даты вне min/max недоступны.
 */

const DATE_MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const DATE_MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function ymdOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseYmdDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
/** «1 — 11 ноября 2026», «28 октября — 11 ноября 2026», «1 декабря 2025 — 11 ноября 2026» */
function fmtRange(from, to) {
  const a = parseYmdDate(from);
  const b = parseYmdDate(to);
  if (!a || !b) return 'выбрать период';
  const full = (d) => `${d.getDate()} ${DATE_MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
  if (from === to) return full(a);
  if (a.getFullYear() !== b.getFullYear()) return `${full(a)} — ${full(b)}`;
  if (a.getMonth() !== b.getMonth()) return `${a.getDate()} ${DATE_MONTHS_GEN[a.getMonth()]} — ${full(b)}`;
  return `${a.getDate()} — ${full(b)}`;
}

/** Кнопка выбора периода. onChange(from, to). Возвращает { el, set(from, to), get() } */
function dateRangePicker({ from, to, min, max, onChange, title = 'Выбрать период' } = {}) {
  let cur = { from: from || '', to: to || '' };
  const label = h('span.date-btn-text', { text: fmtRange(cur.from, cur.to) });
  const el = h(
    'button.date-btn',
    {
      type: 'button',
      title,
      on: {
        click: (e) => {
          e.stopPropagation();
          if (el.classList.contains('open')) return UI.closeMenu();
          openRangeCalendar(el, cur, { min, max }, (f, t) => {
            cur = { from: f, to: t };
            label.textContent = fmtRange(f, t);
            onChange && onChange(f, t);
          });
        },
      },
    },
    h('span.date-btn-ic', { icon: 'calendar' }),
    label,
    h('span.date-btn-chev', { icon: 'chevron' })
  );
  return {
    el,
    set(f, t) {
      cur = { from: f || '', to: t || '' };
      label.textContent = fmtRange(cur.from, cur.to);
    },
    get: () => ({ ...cur }),
  };
}

function openRangeCalendar(anchor, value, { min, max }, onPick) {
  const layer = document.getElementById('menuLayer');
  UI.closeMenu();
  const today = ymdOf(new Date());
  const maxD = parseYmdDate(max);
  const minD = parseYmdDate(min);
  let start = value.from || '';
  let end = value.to || '';
  let picking = false; // выбран только первый день, ждём второй
  let hover = '';
  const base = parseYmdDate(end) || maxD || new Date();
  let view = new Date(base.getFullYear(), base.getMonth(), 1);

  const title = h('b.dp-title');
  const hint = h('p.dp-hint');
  const grid = h('div.dp-grid', { on: { mouseleave: () => ((hover = ''), paintRange()) } });
  const prev = h('button.dp-nav', { type: 'button', title: 'Предыдущий месяц', 'aria-label': 'Предыдущий месяц', icon: 'back', on: { click: () => move(-1) } });
  const next = h('button.dp-nav.next', { type: 'button', title: 'Следующий месяц', 'aria-label': 'Следующий месяц', icon: 'back', on: { click: () => move(1) } });
  const box = h(
    'div.ctx-menu.dp-pop',
    { role: 'dialog', 'aria-label': 'Выбор периода' },
    h('div.dp-head', null, prev, title, next),
    h('div.dp-week', null, ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => h('span', { text: d }))),
    grid,
    h('div.dp-foot', null, hint)
  );

  function move(delta) {
    view = new Date(view.getFullYear(), view.getMonth() + delta, 1);
    paint();
  }
  function pick(v) {
    if (!picking) {
      start = v;
      end = '';
      picking = true;
      paintRange();
      return;
    }
    let a = start;
    let b = v;
    if (b < a) [a, b] = [b, a];
    picking = false;
    onPick(a, b);
    UI.closeMenu();
  }
  function paintRange() {
    let a = start;
    let b = picking ? hover || start : end;
    if (b && a && b < a) [a, b] = [b, a];
    grid.querySelectorAll('.dp-day').forEach((d) => {
      const v = d.dataset.v;
      d.classList.toggle('in', !!(a && b && v > a && v < b));
      d.classList.toggle('edge', v === a || v === b);
      d.classList.toggle('from', v === a && a !== b);
      d.classList.toggle('to', v === b && a !== b);
    });
    hint.textContent = picking ? 'Теперь выберите последний день периода' : 'Выберите первый день периода';
  }
  function paint() {
    title.textContent = `${DATE_MONTHS[view.getMonth()]} ${view.getFullYear()}`;
    clear(grid);
    const first = (view.getDay() + 6) % 7; // понедельник — первый
    const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate();
    for (let i = 0; i < first; i++) grid.appendChild(h('span.dp-gap'));
    for (let d = 1; d <= days; d++) {
      const v = ymdOf(new Date(view.getFullYear(), view.getMonth(), d));
      const off = (min && v < min) || (max && v > max);
      grid.appendChild(
        h('button.dp-day' + (v === today ? '.today' : ''), {
          type: 'button',
          text: d,
          disabled: !!off,
          dataset: { v },
          on: {
            click: () => pick(v),
            mouseenter: () => {
              if (!picking) return;
              hover = v;
              paintRange();
            },
          },
        })
      );
    }
    prev.disabled = !!(minD && new Date(view.getFullYear(), view.getMonth(), 0) < minD);
    next.disabled = !!(maxD && new Date(view.getFullYear(), view.getMonth() + 1, 1) > maxD);
    paintRange();
  }

  layer.appendChild(box);
  layer.classList.add('open');
  anchor.classList.add('open');
  layer._onClose = () => anchor.classList.remove('open');
  paint();

  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth;
  const bh = box.offsetHeight;
  let top = r.bottom + 8;
  if (top + bh > window.innerHeight - 10) top = Math.max(10, r.top - bh - 8);
  box.style.left = Math.max(10, Math.min(r.left, window.innerWidth - bw - 10)) + 'px';
  box.style.top = top + 'px';
}
