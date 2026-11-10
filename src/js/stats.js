'use strict';
/*
 * «Знание песни» — встроенная шкала 1–100, считается сама из всех заполненных шкал песни:
 *   сумма оценок / сумма максимумов. Например, три шкалы 1–5 по 4 → 12/15 → 80. Редактировать нельзя.
 *
 * Страница «Статистика»: по каждой шкале — среднее по всем песням и история в виде «свечей» (как в трейдинге):
 *   за каждый шаг (день/неделя/месяц/год) видно, с какого среднего начали, чем закончили, минимум и максимум.
 * История значений восстанавливается из t.history (изменения шкал), а начальное значение — от даты добавления песни.
 */

const Knowledge = (() => {
  const name = () => 'Уровень';

  /** { pct 1–100, sum, max, n } или null, если ни одна шкала не заполнена */
  function of(t, values = t.attributes) {
    let sum = 0;
    let max = 0;
    let n = 0;
    for (const a of Lib.attrs()) {
      if (a.type !== 'scale' || Attr.isEmpty(a, values[a.id])) continue;
      sum += Number(values[a.id]);
      max += Number(a.max);
      n++;
    }
    if (!n || max <= 0) return null;
    return { pct: Math.min(100, Math.max(1, Math.round((sum / max) * 100))), sum, max, n };
  }

  function hasScales() {
    return Lib.attrs().some((a) => a.type === 'scale');
  }

  /** Блок на странице песни (только для чтения) */
  function block(t) {
    const k = of(t);
    const pct = k ? k.pct : 0;
    return h(
      'div.know' + (k ? '' : '.is-empty'),
      null,
      h('div.know-head', null, h('span.know-ic', { icon: 'trendUp' }), h('b', { text: name() })),
      h('div.know-row', null, h('div.know-bar', null, h('i', { style: { width: pct + '%' } })), h('b.know-val', { text: k ? pct + '%' : '—' })),
      h('p.know-note', { text: k ? `${k.sum} из ${k.max} по ${k.n} ${plural(k.n, 'шкале', 'шкалам', 'шкалам')}` : 'Появится, когда будет заполнена хотя бы одна шкала' })
    );
  }

  /** Маленькая плашка для карточки */
  function chip(t) {
    const k = of(t);
    if (!k) return null;
    return h(
      'div.card-know',
      { title: `${name()}: ${k.pct}%`, style: { '--p': k.pct + '%' } },
      h('span.card-know-label', null, h('span', { icon: 'trendUp' }), name()),
      h('b.card-know-val', { text: k.pct + '%' }),
      h('span.card-know-bar', null, h('i', { style: { width: k.pct + '%' } }))
    );
  }

  return { name, of, hasScales, block, chip };
})();

const Stats = (() => {
  const DAY = 86400000;
  const state = { period: 'month', step: 'day', from: '', to: '' };
  let isOpen = false;
  let resizeTimer = 0;

  const PERIODS = [
    { id: 'week', label: 'Неделя' },
    { id: 'month', label: 'Месяц' },
    { id: 'quarter', label: '3 месяца' },
    { id: 'year', label: 'Год' },
    { id: 'all', label: 'Всё время' },
    { id: 'custom', label: 'Свой период' },
  ];
  const STEPS = [
    { id: 'day', label: 'День' },
    { id: 'week', label: 'Неделя' },
    { id: 'month', label: 'Месяц' },
    { id: 'year', label: 'Год' },
  ];
  const MAX_CANDLES = 400;

  const round1 = (x) => Math.round(x * 10) / 10;
  const fmt1 = (x) => (Math.round(x * 10) / 10).toFixed(1).replace(/\.0$/, '');
  const num = (s) => {
    const v = parseFloat(String(s ?? '').replace(',', '.'));
    return Number.isFinite(v) ? v : null;
  };

  /* ---------- История значений ---------- */

  /** Точки [{ at: ms, v: number|null }] — значение шкалы песни во времени (от даты добавления) */
  function timeline(t, a) {
    const cur = Attr.isEmpty(a, t.attributes[a.id]) ? null : Number(t.attributes[a.id]);
    const hist = Array.isArray(t.history) ? t.history : [];
    const points = [];
    let v = cur;
    for (let i = hist.length - 1; i >= 0; i--) {
      const e = hist[i];
      const c = (e.changes || []).find((x) => (x.key ? x.key === 'attr:' + a.id : x.label === a.name));
      if (!c) continue;
      const at = Date.parse(e.at);
      if (!Number.isFinite(at)) continue;
      points.push({ at, v });
      v = num(c.from);
    }
    const created = Date.parse(t.createdAt) || (points.length ? points[points.length - 1].at : Date.now());
    points.push({ at: Math.min(created, points.length ? points[points.length - 1].at : created), v });
    return points.reverse();
  }

  function valueAt(tl, T) {
    if (!tl.length || T < tl[0].at) return undefined; // песни ещё не было
    let v = tl[0].v;
    for (const p of tl) {
      if (p.at > T) break;
      v = p.v;
    }
    return v;
  }

  /** Модель данных для всех графиков: функции «среднее в момент T» и список моментов изменений */
  function model() {
    const tracks = Lib.tracks().filter((t) => t.status !== 'draft');
    const scales = Lib.attrs().filter((a) => a.type === 'scale');
    const tl = tracks.map((t) => ({ t, by: Object.fromEntries(scales.map((a) => [a.id, timeline(t, a)])) }));
    const events = new Set();
    for (const x of tl) for (const a of scales) for (const p of x.by[a.id]) events.add(p.at);
    const times = [...events].sort((p, q) => p - q);

    const avgAttr = (a) => (T) => {
      let s = 0;
      let n = 0;
      for (const x of tl) {
        const v = valueAt(x.by[a.id], T);
        if (v === null || v === undefined) continue;
        s += v;
        n++;
      }
      return n ? s / n : null;
    };
    const avgKnow = (T) => {
      let s = 0;
      let n = 0;
      for (const x of tl) {
        let sum = 0;
        let max = 0;
        for (const a of scales) {
          const v = valueAt(x.by[a.id], T);
          if (v === null || v === undefined) continue;
          sum += v;
          max += a.max;
        }
        if (!max) continue;
        s += (sum / max) * 100;
        n++;
      }
      return n ? s / n : null;
    };
    const countNow = (a) => tracks.filter((t) => !Attr.isEmpty(a, t.attributes[a.id])).length;
    const knowCount = tracks.filter((t) => Knowledge.of(t)).length;
    const first = tracks.length ? Math.min(...tracks.map((t) => Date.parse(t.createdAt) || Date.now())) : Date.now();
    return { tracks, scales, times, avgAttr, avgKnow, countNow, knowCount, first };
  }

  /* ---------- Период и шаг ---------- */

  function startOf(d, step) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    if (step === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    if (step === 'month') x.setDate(1);
    if (step === 'year') x.setMonth(0, 1);
    return x.getTime();
  }
  function next(ms, step) {
    const x = new Date(ms);
    if (step === 'day') x.setDate(x.getDate() + 1);
    if (step === 'week') x.setDate(x.getDate() + 7);
    if (step === 'month') x.setMonth(x.getMonth() + 1);
    if (step === 'year') x.setFullYear(x.getFullYear() + 1);
    return x.getTime();
  }
  const ymd = (ms) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const parseYmd = (s) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
  };

  function range(first) {
    const now = Date.now();
    const back = (fn) => {
      const d = new Date(now);
      fn(d);
      return d.getTime();
    };
    switch (state.period) {
      case 'week':
        return [now - 7 * DAY, now];
      case 'month':
        return [back((d) => d.setMonth(d.getMonth() - 1)), now];
      case 'quarter':
        return [back((d) => d.setMonth(d.getMonth() - 3)), now];
      case 'year':
        return [back((d) => d.setFullYear(d.getFullYear() - 1)), now];
      case 'custom': {
        let f = parseYmd(state.from);
        let t = parseYmd(state.to);
        if (f === null) f = first;
        t = t === null ? now : Math.min(now, t + DAY - 1);
        if (f > t) [f, t] = [Math.max(first, t - 30 * DAY), t];
        return [f, t];
      }
      default:
        return [Math.min(first, now - DAY), now];
    }
  }

  /** Сколько свечей выйдет при шаге; при слишком мелком шаге берём крупнее */
  function effectiveStep(from, to) {
    const order = STEPS.map((s) => s.id);
    let i = order.indexOf(state.step);
    const count = (st) => {
      let n = 0;
      for (let s = startOf(from, st); s < to && n <= MAX_CANDLES; s = next(s, st)) n++;
      return n;
    };
    while (i < order.length - 1 && count(order[i]) > MAX_CANDLES) i++;
    return order[i];
  }

  /** Свечи: [{ s, e, open, close, high, low }] (null — данных ещё не было) */
  function candles(avg, times, from, to, step) {
    const out = [];
    for (let s = startOf(from, step); s < to; s = next(s, step)) {
      const a = Math.max(s, from);
      const b = Math.min(next(s, step) - 1, to);
      const pts = [a, ...times.filter((x) => x > a && x < b), b].map(avg).filter((v) => v !== null);
      if (!pts.length) {
        out.push({ s, e: b, empty: true });
        continue;
      }
      const open = avg(a) ?? pts[0];
      const close = avg(b) ?? pts[pts.length - 1];
      out.push({ s, e: b, open, close, high: Math.max(...pts), low: Math.min(...pts) });
    }
    return out;
  }

  /* ---------- Рисование ---------- */

  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MONTHS_N = ['янв', 'фев', 'март', 'апр', 'май', 'июнь', 'июль', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  function label(ms, step) {
    const d = new Date(ms);
    if (step === 'year') return String(d.getFullYear());
    if (step === 'month') return `${MONTHS_N[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
    return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }
  function longLabel(c, step) {
    const d = new Date(c.s);
    if (step === 'year') return `${d.getFullYear()} год`;
    if (step === 'month') return d.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
    if (step === 'week') return `неделя с ${fmtDate(new Date(c.s).toISOString(), false)}`;
    return fmtDate(new Date(c.s).toISOString(), false);
  }

  const SVG = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, parent) {
    const el = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
  }

  /**
   * Линейный график: точка — среднее на конец каждого шага (цвет точки: выросло / снизилось / без изменений
   * по сравнению с прошлым шагом), пунктир — среднее в начале периода (всё, что выше, — прогресс).
   * Ось Y приближена к данным, чтобы маленькие изменения были видны. lo/hi — границы шкалы, unit — '%' или ''.
   */
  function drawChart(box, list, { lo, hi, step, unit }) {
    clear(box);
    const W = Math.max(280, box.clientWidth || 640);
    const H = 220;
    const pad = { l: 40, r: 14, t: 16, b: 28 };
    const pw = W - pad.l - pad.r;
    const ph = H - pad.t - pad.b;
    const real = list.filter((c) => !c.empty);
    const tip = h('div.st-tip', { hidden: true });
    const svg = s('svg', { class: 'st-svg', width: W, height: H, viewBox: `0 0 ${W} ${H}` });
    if (!real.length) {
      s('text', { x: W / 2, y: H / 2, class: 'st-nodata', 'text-anchor': 'middle' }, svg).textContent = 'За этот период оценок ещё нет';
      box.append(svg);
      return;
    }
    const start = real[0].open;
    const vals = [start, ...real.map((c) => c.close)];
    let a = Math.min(...vals);
    let b = Math.max(...vals);
    const span = Math.max(b - a, (hi - lo) * 0.12);
    a = Math.max(lo, a - span * 0.35);
    b = Math.min(hi, b + span * 0.35);
    if (b - a < 1e-6) [a, b] = [lo, hi];
    // «круглые» деления оси: 0.5, 1, 2, 5, 10…
    const tick = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 20, 25, 50].find((st) => (b - a) / st <= 5) || 50;
    a = Math.max(lo, Math.floor(a / tick + 1e-9) * tick);
    b = Math.min(hi, Math.ceil(b / tick - 1e-9) * tick);
    if (b - a < tick) b = Math.min(hi, a + tick);
    const y = (v) => pad.t + ph - ((v - a) / (b - a)) * ph;
    const n = list.length;
    const slot = pw / Math.max(1, n);
    const x = (i) => pad.l + slot * (i + 0.5);

    // сетка и подписи
    for (let v = a; v <= b + 1e-9; v += tick) {
      s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'st-gridline' }, svg);
      s('text', { x: pad.l - 8, y: y(v) + 4, class: 'st-ylab', 'text-anchor': 'end' }, svg).textContent = fmt1(v) + unit;
    }
    // линия «начало периода»
    s('line', { x1: pad.l, x2: W - pad.r, y1: y(start), y2: y(start), class: 'st-base' }, svg);
    s('text', { x: pad.l + 6, y: y(start) - 6, class: 'st-base-lab' }, svg).textContent = `начало периода: ${fmt1(start)}${unit}`;

    // линия и заливка (с разрывами там, где оценок ещё не было)
    const segs = [];
    let cur = null;
    list.forEach((c, i) => {
      if (c.empty) {
        cur = null;
        return;
      }
      if (!cur) segs.push((cur = []));
      cur.push([x(i), y(c.close)]);
    });
    const gid = 'stg' + Math.random().toString(36).slice(2, 8);
    const defs = s('defs', null, svg);
    const lg = s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
    s('stop', { offset: 0, class: 'st-area-top' }, lg);
    s('stop', { offset: 1, class: 'st-area-bottom' }, lg);
    const bottom = pad.t + ph;
    for (const seg of segs) {
      const line = seg.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
      if (seg.length > 1) s('path', { d: `${line} L ${seg[seg.length - 1][0].toFixed(1)} ${bottom} L ${seg[0][0].toFixed(1)} ${bottom} Z`, fill: `url(#${gid})`, class: 'st-area' }, svg);
      s('path', { d: line, class: 'st-line' }, svg);
    }

    // точки + наведение
    const guide = s('line', { y1: pad.t, y2: bottom, class: 'st-guide', visibility: 'hidden' }, svg);
    const many = real.length > 45;
    let prev = start;
    list.forEach((c, i) => {
      const g = s('g', { class: 'st-pt' }, svg);
      let d = 0;
      if (!c.empty) {
        d = round1(c.close - prev);
        prev = c.close;
        const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
        g.classList.add('c-' + dir);
        if (!many || dir !== 'flat' || i === n - 1) s('circle', { cx: x(i), cy: y(c.close), r: i === n - 1 ? 5.5 : many ? 3 : 4, class: 'st-dot' }, g);
      }
      const hit = s('rect', { x: pad.l + slot * i, y: pad.t, width: slot, height: ph, class: 'st-hit' }, g);
      hit.addEventListener('mouseenter', () => {
        g.classList.add('hover');
        guide.setAttribute('x1', x(i));
        guide.setAttribute('x2', x(i));
        guide.setAttribute('visibility', 'visible');
        clear(tip);
        tip.append(h('b', { text: longLabel(c, step) }));
        if (c.empty) tip.append(h('span', { text: 'оценок ещё не было' }));
        else {
          appendChildren(tip, [
            h('span', null, 'среднее ', h('b', { text: fmt1(c.close) + unit })),
            d ? h('span.' + (d > 0 ? 'st-up' : 'st-down'), { text: (d > 0 ? '▲ +' : '▼ −') + fmt1(Math.abs(d)) + unit + ' за шаг' }) : h('span.muted', { text: 'без изменений за шаг' }),
          ]);
        }
        tip.hidden = false;
        tip.style.left = Math.min(Math.max(x(i) - 85, 0), W - 180) + 'px';
        tip.style.top = Math.max(0, (c.empty ? pad.t + ph / 2 : y(c.close)) - 14) + 'px';
      });
      hit.addEventListener('mouseleave', () => {
        g.classList.remove('hover');
        guide.setAttribute('visibility', 'hidden');
        tip.hidden = true;
      });
    });
    // подписи по оси X
    const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 70))));
    list.forEach((c, i) => {
      if (i % every) return;
      s('text', { x: x(i), y: H - 8, class: 'st-xlab', 'text-anchor': 'middle' }, svg).textContent = label(c.s, step);
    });
    box.append(svg, tip);
  }

  /** «было → стало» и прогресс за период */
  function summary(list, unit) {
    const real = list.filter((c) => !c.empty);
    if (!real.length) return { pill: h('span.st-prog.flat', { text: 'нет данных' }), line: null };
    const from = real[0].open;
    const to = real[real.length - 1].close;
    const d = round1(to - from);
    const t = 'Изменение среднего за выбранный период';
    const pill =
      d > 0
        ? h('span.st-prog.up', { title: t }, h('span', { icon: 'trendUp' }), 'прогресс +' + fmt1(d) + unit)
        : d < 0
        ? h('span.st-prog.down', { title: t }, h('span', { icon: 'trendDown' }), 'снижение −' + fmt1(-d) + unit)
        : h('span.st-prog.flat', { title: t }, 'без изменений');
    const line = h('div.st-fromto', null, 'за период: было ', h('b', { text: fmt1(from) + unit }), ' → стало ', h('b', { text: fmt1(to) + unit }));
    return { pill, line };
  }

  /* ---------- Страница ---------- */

  function el() {
    return document.getElementById('stats');
  }

  function open() {
    App.closeDetail();
    isOpen = true;
    const box = el();
    box.hidden = false;
    box.scrollTop = 0;
    document.body.classList.add('detail-open', 'stats-open');
    render();
  }

  function close() {
    if (!isOpen) return;
    isOpen = false;
    const box = el();
    box.hidden = true;
    clear(box);
    document.body.classList.remove('detail-open', 'stats-open');
  }

  function segmented(items, value, onPick, cls) {
    return h(
      'div.segmented' + (cls ? '.' + cls : ''),
      { role: 'radiogroup' },
      items.map((it) => h('button' + (it.id === value ? '.on' : ''), { type: 'button', dataset: { id: it.id }, text: it.label, on: { click: () => onPick(it.id) } }))
    );
  }

  function render() {
    if (!isOpen) return;
    const box = el();
    const scroll = box.scrollTop;
    clear(box);
    const m = model();
    const [from, to] = range(m.first);
    const step = effectiveStep(from, to);

    const controls = h(
      'div.st-controls',
      null,
      h(
        'div.st-ctl',
        null,
        h('span.st-ctl-label', { text: 'Период' }),
        segmented(PERIODS, state.period, (id) => {
          state.period = id;
          if (id === 'custom' && !state.from) {
            state.from = ymd(Math.max(m.first, Date.now() - 30 * DAY));
            state.to = ymd(Date.now());
          }
          render();
        }, 'st-period')
      ),
      state.period === 'custom'
        ? h(
            'div.st-ctl.st-dates',
            null,
            dateRangePicker({
              from: state.from,
              to: state.to,
              max: ymd(Date.now()),
              title: 'Выбрать период: первый клик — начало, второй — конец',
              onChange: (f, t) => {
                state.from = f;
                state.to = t;
                render();
              },
            }).el
          )
        : null,
      h(
        'div.st-ctl',
        null,
        h('span.st-ctl-label', { text: 'Шаг' }),
        segmented(STEPS, step, (id) => {
          state.step = id;
          render();
        }, 'st-step')
      ),
      step !== state.step ? h('p.muted.small.st-auto', { text: 'Для такого длинного периода шаг укрупнён, чтобы график оставался читаемым.' }) : null
    );

    const charts = [];
    const grid = h('div.st-grid');
    if (!m.scales.length) {
      grid.appendChild(
        h(
          'div.st-empty',
          null,
          h('span.nothing-ic', { icon: 'chart' }),
          h('h3', { text: 'Пока нечего показать' }),
          h('p.muted', { text: 'Статистика строится по оценкам-шкалам. Создайте атрибут с типом «Оценка по шкале» и отмечайте песни — здесь появятся графики.' }),
          h('button.btn.btn-primary', { on: { click: () => AttributesManager.open() } }, h('span', { icon: 'sliders' }), 'Открыть атрибуты')
        )
      );
    } else {
      const addCard = ({ name, iconName, now, max, unit, count, avg, lo, hi, special }) => {
        const list = candles(avg, m.times, from, to, step);
        const sum = summary(list, unit);
        const chartBox = h('div.st-chart');
        grid.appendChild(
          h(
            'section.st-card' + (special ? '.special' : ''),
            null,
            h(
              'div.st-card-head',
              null,
              h('div.st-name', null, h('span', { icon: iconName }), h('b', { text: name })),
              sum.pill
            ),
            h(
              'div.st-now',
              null,
              h('b.st-val', { text: now === null ? '—' : fmt1(now) + unit }),
              max && now !== null ? h('span.st-max', { text: ' из ' + max }) : null,
              h('span.st-count', { text: count ? `среднее по ${count} ${plural(count, 'песне', 'песням', 'песням')}` : 'ещё нет оценок' })
            ),
            sum.line,
            chartBox
          )
        );
        charts.push(() => drawChart(chartBox, list, { lo, hi, step, unit }));
      };
      addCard({ name: Knowledge.name(), iconName: 'trendUp', now: m.avgKnow(Date.now()), unit: '%', count: m.knowCount, avg: m.avgKnow, lo: 0, hi: 100, special: true });
      for (const a of m.scales) {
        addCard({ name: a.name, iconName: 'star', now: m.avgAttr(a)(Date.now()), max: a.max, unit: '', count: m.countNow(a), avg: m.avgAttr(a), lo: Math.min(a.min, 0), hi: a.max });
      }
    }

    box.append(
      h(
        'div.d-wrap.st-wrap',
        null,
        h('div.d-top', null, h('button.d-back', { on: { click: () => close() } }, h('span', { icon: 'back' }), 'К библиотеке')),
        h('h1.st-title', null, h('span', { icon: 'chart' }), 'Статистика'),
        h('p.st-sub', { text: 'Линия — среднее по всем песням на конец каждого шага. Пунктир — каким среднее было в начале периода: если линия выше пунктира — это прогресс. Зелёная точка — за шаг стало лучше, красная — хуже.' }),
        controls,
        grid
      )
    );
    charts.forEach((fn) => fn());
    box.scrollTop = scroll;
  }

  window.addEventListener('resize', () => {
    if (!isOpen) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(render, 150);
  });

  return { open, close, render, isOpen: () => isOpen, timeline, candles, model, state, _range: range };
})();
