'use strict';
/*
 * Генеративные обложки «по характеру песни» — для песен без своей картинки.
 * Рисунок простой и абстрактный, но собирается из того, что о песне известно:
 *   - настроение из выбранных вариантов и категорий (грустная → тёмная, «ночная», с дождём/луной;
 *     весёлая → яркая, с солнцем и конфетти; спокойная → мягкие волны; энергичная → зигзаги и всполохи;
 *     романтичная → сердечки и мягкие круги; мрачная/эпичная → острые пики и осколки);
 *   - цвета выбранных вариантов — акцентами на рисунке;
 *   - «Знание песни» — «фаза луны» у главного круга: чем лучше выучена песня, тем он полнее;
 *   - темп (числовой атрибут «Темп»/BPM) — добавляет энергии;
 *   - id песни — чтобы у двух одинаковых по характеру песен рисунки всё равно отличались.
 */

const Cover = (() => {
  const W = 125;
  const H = 100;
  let seq = 0;
  const cache = new Map();

  const MOODS = [
    { id: 'sad', label: 'грустная', re: /грус|печал|меланх|тоск|минор|слёз|слез|тяжел|тяжёл|разлук|одинок|sad|melanch|blue/ },
    { id: 'happy', label: 'весёлая', re: /весел|весёл|радост|позитив|счаст|задор|празд|солн|летн|smile|happy|joy|fun|bright/ },
    { id: 'calm', label: 'спокойная', re: /спокой|медлен|колыбел|мягк|лирич|баллад|тих|умиротв|мечт|calm|slow|soft|lull|chill/ },
    { id: 'energy', label: 'энергичная', re: /энерг|драйв|быстр|бодр|танц|рок|мощн|ритмич|зажиг|громк|energ|dance|rock|fast|power|party/ },
    { id: 'love', label: 'о любви', re: /любов|романт|нежн|страст|сердц|love|roman|tender/ },
    { id: 'dark', label: 'мрачная', re: /мрач|тёмн|темн|страш|эпич|драм|трагич|гнев|злост|dark|epic|drama|angry/ },
  ];

  const PALETTES = {
    sad: [
      ['#141033', '#3a4a8c', '#a9bcff'],
      ['#1b1236', '#5b4b9a', '#c8b3ff'],
      ['#0f1a33', '#2f5d8a', '#8fd3ff'],
      ['#201437', '#4e3d78', '#e4d6ff'],
    ],
    happy: [
      ['#ffc94a', '#ff6b9a', '#fff7d6'],
      ['#d6ff3d', '#7b2ff7', '#ffffff'],
      ['#ff8a5c', '#ffd36b', '#7b2ff7'],
      ['#6ff0c4', '#ffc94a', '#ff6b9a'],
      ['#ffd36b', '#ff6b9a', '#7b2ff7'],
    ],
    calm: [
      ['#c8b3ff', '#8fd3e8', '#ffffff'],
      ['#e4d6ff', '#9d5cff', '#6ff0c4'],
      ['#a8c5ff', '#e9dcff', '#7b2ff7'],
      ['#bfe9e0', '#9d8cff', '#ffffff'],
    ],
    energy: [
      ['#ff2e63', '#7b2ff7', '#d6ff3d'],
      ['#24093f', '#ff6b9a', '#d6ff3d'],
      ['#ff6b00', '#ffc94a', '#24093f'],
      ['#7b2ff7', '#ff2e63', '#ffc94a'],
    ],
    love: [
      ['#ff6b9a', '#ffb3d1', '#7b2ff7'],
      ['#c2185b', '#ff8fb8', '#ffe9f2'],
      ['#ffd1e1', '#ff6b9a', '#9d5cff'],
    ],
    dark: [
      ['#0d0618', '#5a1fb8', '#ff3d6e'],
      ['#140a24', '#3b1366', '#d6ff3d'],
      ['#10091c', '#2b2f5e', '#ffc94a'],
    ],
    neutral: [
      ['#7b2ff7', '#c8b3ff', '#d6ff3d'],
      ['#3b1366', '#ff6b9a', '#ffc94a'],
      ['#9d5cff', '#6ff0c4', '#24093f'],
      ['#5a1fb8', '#ffb3d1', '#e9dcff'],
      ['#24093f', '#9d5cff', '#ff6b9a'],
      ['#b18cff', '#3b1366', '#d6ff3d'],
      ['#6a2bd9', '#ffc94a', '#ffe9f2'],
      ['#d4c2ff', '#7b2ff7', '#ff6b9a'],
    ],
  };

  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const f = (n) => Math.round(n * 10) / 10;
  const pick = (r, list) => list[Math.floor(r() * list.length) % list.length];

  /* ---------- Характер песни ---------- */

  /** { kind, valence -1..1, energy -1..1, colors[], moods[], pct|null, best } */
  function mood(t) {
    const labels = [];
    const colors = [];
    let tempo = null;
    for (const a of Lib.attrs()) {
      const v = t.attributes && t.attributes[a.id];
      if (Attr.isEmpty(a, v)) continue;
      if (a.type === 'select' || a.type === 'multiselect') {
        for (const id of a.type === 'select' ? [v] : v) {
          const o = (a.options || []).find((x) => x.id === id);
          if (!o) continue;
          labels.push(o.label);
          colors.push(Attr.optionColor(a, id));
        }
      } else if (a.type === 'text' && String(v).length < 40) labels.push(String(v));
      else if (a.type === 'number' && /темп|bpm|tempo/i.test(a.name)) tempo = Number(v);
    }
    for (const id of t.categories || []) {
      const c = Lib.cat(id);
      if (c) labels.push(c.name);
    }
    const score = {};
    for (const m of MOODS) score[m.id] = 0;
    for (const l of labels) {
      const s = normalize(l);
      for (const m of MOODS) if (m.re.test(s)) score[m.id]++;
    }
    if (tempo !== null) {
      if (tempo >= 120) score.energy += 0.6;
      if (tempo <= 80) score.calm += 0.6;
    }
    const valence = Math.max(-1, Math.min(1, score.happy + score.love * 0.4 - score.sad - score.dark * 0.7));
    const energy = Math.max(-1, Math.min(1, score.energy + score.happy * 0.3 + score.dark * 0.3 - score.calm - score.sad * 0.3));
    let kind = 'neutral';
    let best = 0;
    for (const m of MOODS) {
      if (score[m.id] > best) {
        best = score[m.id];
        kind = m.id;
      }
    }
    const k = typeof Knowledge !== 'undefined' ? Knowledge.of(t) : null;
    return {
      kind,
      valence,
      energy,
      colors: [...new Set(colors)].slice(0, 6),
      moods: MOODS.filter((m) => score[m.id] >= 1).map((m) => m.label),
      pct: k ? k.pct : null,
      best: (t.performances || []).some((p) => p.best),
    };
  }

  /** Три цвета обложки — ими же подкрашиваются карточка и страница песни */
  function palette(t, m = mood(t)) {
    const r = rng(hashStr(t.id || 'x'));
    const p = pick(r, PALETTES[m.kind]).slice();
    // цвет главного выбранного варианта — акцентом (на тёмных/светлых фонах он и так читается)
    if (m.colors.length && m.kind === 'neutral') p[2] = m.colors[0];
    return p;
  }

  /** Подпись для подсказки: из чего нарисована обложка */
  function describe(t) {
    const m = mood(t);
    const parts = [];
    if (m.moods.length) parts.push('настроение: ' + m.moods.join(', '));
    if (m.pct !== null) parts.push(`полнота круга — уровень ${m.pct}%`);
    if (m.colors.length) parts.push('цветные акценты — выбранные варианты');
    return parts.length ? 'Обложка нарисована по характеру песни — ' + parts.join('; ') : 'Обложка нарисована автоматически. Отметьте характер песни — и рисунок изменится';
  }

  /* ---------- Рисование ---------- */

  /** Главный круг (солнце/луна/пластинка) с «фазой» по знанию песни */
  function orb(ctx, cx, cy, R, color, { glow = false } = {}) {
    const { pct, id } = ctx;
    let out = '';
    if (glow) out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R * 1.45)}" fill="${color}" opacity=".18"/>`;
    if (pct === null || pct >= 100) {
      out += `<circle class="cv-orb" cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}" fill="${color}"/>`;
      if (pct >= 100) out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R + 3.5)}" fill="none" stroke="${color}" stroke-width="1.4" opacity=".7"/>`;
      return out;
    }
    const off = 2 * R * Math.max(0.18, pct / 100);
    const mid = `m${id}-§x${ctx.n++}`;
    out += `<mask id="${mid}"><rect width="${W}" height="${H}" fill="#fff"/><circle cx="${f(cx - off)}" cy="${f(cy - off * 0.25)}" r="${f(R * 1.02)}" fill="#000"/></mask>`;
    out += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}" fill="${color}" opacity=".16"/>`;
    out += `<circle class="cv-orb" cx="${f(cx)}" cy="${f(cy)}" r="${f(R)}" fill="${color}" mask="url(#${mid})"/>`;
    return out;
  }

  function wavePath(y, amp, len, phase, close = true) {
    let d = `M -5 ${f(y)}`;
    for (let x = -5; x <= W + 5; x += 5) d += ` L ${x} ${f(y + Math.sin((x / len) * Math.PI * 2 + phase) * amp)}`;
    return close ? d + ` L ${W + 5} ${H + 5} L -5 ${H + 5} Z` : d;
  }

  function heart(x, y, s, color, op = 1, rot = 0) {
    return `<path transform="translate(${f(x)} ${f(y)}) rotate(${f(rot)}) scale(${f(s)})" d="M0 3.5C-1.8 -1 -7 -.8 -7 3.2c0 3.6 4.6 6.3 7 8.8 2.4-2.5 7-5.2 7-8.8 0-4-5.2-4.2-7 .3z" fill="${color}" opacity="${op}"/>`;
  }

  const MOTIFS = {
    sad: [
      // дождь и луна
      (c) => {
        let s = orb(c, 88 + c.r() * 20, 26, 15, c.p[2], { glow: true });
        for (let i = 0; i < (c.mini ? 10 : 26); i++) {
          const x = c.r() * (W + 30) - 10;
          const y = c.r() * H;
          s += `<line x1="${f(x)}" y1="${f(y)}" x2="${f(x - 6)}" y2="${f(y + 14)}" stroke="${c.p[2]}" stroke-width="1" stroke-linecap="round" opacity="${f(0.25 + c.r() * 0.35)}"/>`;
        }
        s += `<path d="${wavePath(82, 3, 60, c.r() * 6)}" fill="${c.p[1]}" opacity=".75"/>`;
        return s;
      },
      // падающие капли
      (c) => {
        let s = `<path d="${wavePath(70, 2, 80, c.r() * 6)}" fill="${c.p[1]}" opacity=".55"/>`;
        s += orb(c, 30 + c.r() * 20, 30, 13, c.p[2]);
        for (let i = 0; i < (c.mini ? 4 : 9); i++) {
          const x = 15 + c.r() * 100;
          const y = 10 + c.r() * 70;
          const k = 0.6 + c.r() * 0.9;
          s += `<path transform="translate(${f(x)} ${f(y)}) scale(${f(k)})" d="M0 -6C2 -2 4 1 4 3.5a4 4 0 0 1-8 0C-4 1-2-2 0-6z" fill="${c.p[2]}" opacity="${f(0.35 + c.r() * 0.5)}"/>`;
        }
        return s;
      },
      // «синий час»: полосы темнеют книзу
      (c) => {
        let s = '';
        for (let i = 0; i < 5; i++) s += `<rect x="-5" y="${f(48 + i * 11)}" width="${W + 10}" height="12" fill="${c.p[1]}" opacity="${f(0.2 + i * 0.15)}"/>`;
        s += orb(c, 62, 46, 16, c.p[2], { glow: true });
        s += `<rect x="-5" y="60" width="${W + 10}" height="1.4" fill="${c.p[2]}" opacity=".6"/>`;
        return s;
      },
    ],
    happy: [
      // солнце с лучами
      (c) => {
        const cx = 40 + c.r() * 45;
        const cy = 40 + c.r() * 15;
        const n = 10 + Math.round(c.m.energy * 4) + Math.floor(c.r() * 4);
        let s = `<g class="cv-spin" style="transform-origin:${f(cx)}px ${f(cy)}px">`;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + c.r() * 0.1;
          s += `<line x1="${f(cx + Math.cos(a) * 24)}" y1="${f(cy + Math.sin(a) * 24)}" x2="${f(cx + Math.cos(a) * 40)}" y2="${f(cy + Math.sin(a) * 40)}" stroke="${c.p[1]}" stroke-width="4" stroke-linecap="round"/>`;
        }
        s += '</g>' + orb(c, cx, cy, 18, c.p[2]);
        return s;
      },
      // пузыри
      (c) => {
        let s = orb(c, 30 + c.r() * 60, 34, 17, c.p[2]);
        for (let i = 0; i < (c.mini ? 6 : 14); i++) {
          const r = 2 + c.r() * 8;
          s += `<circle cx="${f(c.r() * W)}" cy="${f(30 + c.r() * 70)}" r="${f(r)}" fill="none" stroke="${c.p[1]}" stroke-width="${f(1 + r / 5)}" opacity="${f(0.5 + c.r() * 0.5)}"/>`;
        }
        return s;
      },
      // цветок
      (c) => {
        const cx = 60 + c.r() * 10;
        const cy = 50;
        const n = 6 + Math.floor(c.r() * 4);
        let s = `<g class="cv-spin" style="transform-origin:${cx}px ${cy}px">`;
        for (let i = 0; i < n; i++) s += `<ellipse cx="${cx}" cy="${cy - 22}" rx="10" ry="20" fill="${c.p[1]}" opacity=".85" transform="rotate(${f((360 / n) * i)} ${cx} ${cy})"/>`;
        return s + '</g>' + orb(c, cx, cy, 13, c.p[2]);
      },
    ],
    calm: [
      // волны
      (c) => {
        let s = orb(c, 30 + c.r() * 65, 32, 14, c.p[2], { glow: true });
        for (let i = 0; i < 4; i++) s += `<path d="${wavePath(52 + i * 11, 2.5 + c.r() * 2, 50 + c.r() * 40, c.r() * 6)}" fill="${c.p[1]}" opacity="${f(0.25 + i * 0.18)}"/>`;
        return s;
      },
      // холмы
      (c) => {
        let s = orb(c, 90 - c.r() * 50, 30, 15, c.p[2]);
        s += `<ellipse cx="${f(20 + c.r() * 30)}" cy="105" rx="70" ry="42" fill="${c.p[1]}" opacity=".55"/>`;
        s += `<ellipse cx="${f(80 + c.r() * 30)}" cy="112" rx="75" ry="40" fill="${c.p[1]}" opacity=".85"/>`;
        return s;
      },
      // круги на воде
      (c) => {
        const cx = 40 + c.r() * 45;
        const cy = 55 + c.r() * 15;
        let s = '';
        for (let i = 6; i >= 1; i--) s += `<ellipse cx="${f(cx)}" cy="${f(cy)}" rx="${i * 11}" ry="${i * 4.5}" fill="none" stroke="${c.p[1]}" stroke-width="1.6" opacity="${f(0.15 + (6 - i) * 0.12)}"/>`;
        return s + orb(c, cx, cy - 26, 11, c.p[2]);
      },
    ],
    energy: [
      // зигзаги
      (c) => {
        let s = orb(c, 95, 26, 12, c.p[2]);
        for (let k = 0; k < 3; k++) {
          const y0 = 30 + k * 22 + c.r() * 6;
          const amp = 6 + c.m.energy * 3 + c.r() * 4;
          let d = `M -5 ${f(y0)}`;
          for (let x = -5, i = 0; x <= W + 10; x += 12, i++) d += ` L ${x} ${f(y0 + (i % 2 ? -amp : amp))}`;
          s += `<path d="${d}" fill="none" stroke="${k === 1 ? c.p[2] : c.p[1]}" stroke-width="${5 - k}" stroke-linejoin="round" stroke-linecap="round"/>`;
        }
        return s;
      },
      // взрыв-звезда
      (c) => {
        const cx = 62;
        const cy = 50;
        const n = 12 + Math.floor(c.r() * 6);
        let d = '';
        for (let i = 0; i < n * 2; i++) {
          const a = (i / (n * 2)) * Math.PI * 2;
          const rr = i % 2 ? 22 : 46 + c.r() * 10;
          d += (i ? 'L' : 'M') + f(cx + Math.cos(a) * rr) + ' ' + f(cy + Math.sin(a) * rr);
        }
        return `<path class="cv-spin" style="transform-origin:${cx}px ${cy}px" d="${d}Z" fill="${c.p[1]}"/>` + orb(c, cx, cy, 15, c.p[2]);
      },
      // косые полосы
      (c) => {
        let s = '';
        for (let i = -2; i < 9; i++) s += `<rect x="${i * 18 + c.r() * 4}" y="-30" width="${f(4 + c.r() * 7)}" height="170" fill="${i % 3 ? c.p[1] : c.p[2]}" opacity="${f(0.55 + c.r() * 0.4)}" transform="rotate(28 62 50)"/>`;
        return s + orb(c, 35 + c.r() * 55, 50, 14, c.p[2]);
      },
    ],
    love: [
      (c) => {
        let s = orb(c, 92, 28, 12, c.p[2]);
        s += heart(52, 40, 4.2, c.p[1], 0.95, -10 + c.r() * 20);
        s += heart(85 + c.r() * 10, 68, 2.2, c.p[2], 0.85, c.r() * 30 - 15);
        if (!c.mini) for (let i = 0; i < 4; i++) s += heart(c.r() * W, 10 + c.r() * 80, 0.8 + c.r() * 0.6, c.p[2], 0.55, c.r() * 40 - 20);
        return s;
      },
      (c) => {
        const cx = 62;
        let s = `<circle cx="${cx - 14}" cy="55" r="28" fill="${c.p[1]}" opacity=".75"/><circle cx="${cx + 14}" cy="55" r="28" fill="${c.p[2]}" opacity=".6" style="mix-blend-mode:multiply"/>`;
        s += orb(c, cx, 20 + c.r() * 6, 9, c.p[2]);
        return s;
      },
    ],
    dark: [
      // пики и звёзды
      (c) => {
        let s = '';
        for (let i = 0; i < (c.mini ? 8 : 22); i++) s += `<circle cx="${f(c.r() * W)}" cy="${f(c.r() * 55)}" r="${f(0.4 + c.r() * 1.1)}" fill="#fff" opacity="${f(0.4 + c.r() * 0.6)}"/>`;
        s += orb(c, 25 + c.r() * 75, 30, 11, c.p[2], { glow: true });
        let d = `M -5 ${H + 5}`;
        let x = -5;
        while (x < W + 5) {
          const w = 14 + c.r() * 22;
          d += ` L ${f(x + w / 2)} ${f(45 + c.r() * 30)} L ${f(x + w)} ${f(80 + c.r() * 10)}`;
          x += w;
        }
        s += `<path d="${d} L ${W + 5} ${H + 5} Z" fill="${c.p[1]}"/>`;
        return s;
      },
      // осколки
      (c) => {
        let s = orb(c, 62, 50, 18, c.p[2], { glow: true });
        for (let i = 0; i < (c.mini ? 4 : 9); i++) {
          const x = c.r() * W;
          const y = c.r() * H;
          const k = 8 + c.r() * 18;
          s += `<polygon points="${f(x)},${f(y)} ${f(x + k)},${f(y + k * 0.3)} ${f(x + k * 0.4)},${f(y + k)}" fill="${i % 3 ? c.p[1] : c.p[2]}" opacity="${f(0.45 + c.r() * 0.5)}"/>`;
        }
        return s;
      },
    ],
    neutral: [
      // пластинка
      (c) => {
        const cx = 30 + c.r() * 65;
        let s = '';
        for (let i = 0; i < 8; i++) s += `<circle cx="${f(cx)}" cy="78" r="${46 - i * 4.6}" fill="none" stroke="${c.p[1]}" stroke-width="2" opacity="${f(0.25 + (i % 2) * 0.3)}"/>`;
        return s + orb(c, cx, 78, 12, c.p[2]) + orb(c, 100 - c.r() * 75, 26, 12, c.p[2]);
      },
      // клякса и полоски
      (c) => {
        const x = 30 + c.r() * 50;
        let s = `<path transform="rotate(${f(c.r() * 60 - 30)} 62 60)" d="M${x} 30c22-8 52 4 50 30s-30 44-55 36-40-30-28-48 15-14 33-18z" fill="${c.p[1]}"/>`;
        for (let i = 0; i < 3; i++) s += `<rect x="10" y="${12 + i * 7}" width="${60 - i * 18}" height="3.5" rx="2" fill="${c.p[2]}" opacity="${f(1 - i * 0.3)}"/>`;
        return s + orb(c, 96, 74, 13, c.p[2]);
      },
      // баухаус: дуги и квадраты
      (c) => {
        let s = `<path d="M0 100 A 60 60 0 0 1 60 40 L 60 100 Z" fill="${c.p[1]}"/>`;
        s += `<rect x="${f(68 + c.r() * 10)}" y="${f(14 + c.r() * 10)}" width="30" height="30" fill="${c.p[2]}" opacity=".9" transform="rotate(${f(c.r() * 20)} 90 30)"/>`;
        s += `<path d="M125 100 A 40 40 0 0 0 85 60 L 85 100 Z" fill="${c.p[2]}" opacity=".55"/>`;
        return s + orb(c, 30, 26, 10, c.p[2]);
      },
      // точечная сетка
      (c) => {
        let s = '';
        const step = 9;
        for (let y = 8; y < H; y += step) for (let x = 8; x < W; x += step) if (c.r() > 0.25) s += `<circle cx="${x}" cy="${y}" r="${f(0.8 + c.r() * 1.4)}" fill="${c.p[1]}" opacity=".7"/>`;
        return s + orb(c, 40 + c.r() * 45, 50, 20, c.p[2]);
      },
      // конический веер
      (c) => {
        let s = '';
        const cx = c.r() > 0.5 ? 0 : W;
        for (let i = 0; i < 7; i++) {
          const a1 = (i / 7) * Math.PI * 0.5 + (cx ? Math.PI / 2 : 0);
          const a2 = ((i + 0.5) / 7) * Math.PI * 0.5 + (cx ? Math.PI / 2 : 0);
          s += `<path d="M${cx} 0 L ${f(cx + Math.cos(a1) * 170)} ${f(Math.sin(a1) * 170)} L ${f(cx + Math.cos(a2) * 170)} ${f(Math.sin(a2) * 170)} Z" fill="${c.p[1]}" opacity=".55"/>`;
        }
        return s + orb(c, 62, 62, 16, c.p[2]);
      },
    ],
  };

  /** Цветные акценты выбранных вариантов: маленькие фигурки по краю */
  function accents(c) {
    if (c.mini || !c.m.colors.length) return '';
    let s = '';
    const y = 88;
    c.m.colors.forEach((col, i) => {
      const x = 10 + i * 9;
      const shape = i % 3;
      if (shape === 0) s += `<circle cx="${x}" cy="${y}" r="3.2" fill="${col}" stroke="#fff" stroke-width=".8"/>`;
      else if (shape === 1) s += `<rect x="${x - 3}" y="${y - 3}" width="6" height="6" rx="1.2" fill="${col}" stroke="#fff" stroke-width=".8" transform="rotate(45 ${x} ${y})"/>`;
      else s += `<polygon points="${x},${y - 3.6} ${x + 3.4},${y + 2.6} ${x - 3.4},${y + 2.6}" fill="${col}" stroke="#fff" stroke-width=".8"/>`;
    });
    return `<g class="cv-acc">${s}</g>`;
  }

  /** Вся обложка (SVG-строка). mini — упрощённая для маленьких превью. */
  function svg(t, mini = false) {
    const m = mood(t);
    const p = palette(t, m);
    const key = [t.id, mini ? 1 : 0, m.kind, f(m.valence), f(m.energy), m.colors.join(), m.pct, p.join()].join('|');
    const uniq = (str) => str.split('§').join(String(++seq));
    if (cache.has(key)) return uniq(cache.get(key));
    const id = (hashStr(t.id || 'x') >>> 0).toString(36);
    const r = rng(hashStr((t.id || 'x') + m.kind));
    const c = { r, m, p, mini, pct: m.pct, id, n: 0 };
    const variants = MOTIFS[m.kind];
    const motif = variants[Math.floor(r() * variants.length) % variants.length];
    const gid = `g${id}-§`; // § → уникальный номер для каждой вставки (id внутри SVG общие на весь документ)
    const dark = m.valence < 0 ? Math.min(0.55, -m.valence * 0.35 + (m.kind === 'sad' || m.kind === 'dark' ? 0.15 : 0)) : 0;
    const light = m.valence > 0 ? Math.min(0.4, m.valence * 0.25) : 0;
    const ang = Math.floor(r() * 4) * 45;
    let s = `<svg class="cv cv-${m.kind}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
    s += `<defs><linearGradient id="${gid}" gradientTransform="rotate(${ang + 45} .5 .5)"><stop offset="0" stop-color="${p[0]}"/><stop offset="1" stop-color="${mix(p[0], m.valence < 0 ? '#000000' : '#ffffff', 0.22)}"/></linearGradient>`;
    s += `<radialGradient id="${gid}l" cx=".7" cy=".2" r=".9"><stop offset="0" stop-color="#fff" stop-opacity="${f(light)}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`;
    s += `<linearGradient id="${gid}d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${f(dark)}"/></linearGradient></defs>`;
    s += `<rect width="${W}" height="${H}" fill="url(#${gid})"/>`;
    s += `<g class="cv-m">${motif(c)}</g>`;
    if (light) s += `<rect width="${W}" height="${H}" fill="url(#${gid}l)"/>`;
    if (dark) s += `<rect width="${W}" height="${H}" fill="url(#${gid}d)"/>`;
    s += accents(c);
    s += '</svg>';
    if (cache.size > 600) cache.clear();
    cache.set(key, s);
    return uniq(s);
  }

  function mix(a, b, k) {
    const pa = parseInt(a.slice(1), 16);
    const pb = parseInt(b.slice(1), 16);
    const ch = (sh) => Math.round(((pa >> sh) & 255) * (1 - k) + ((pb >> sh) & 255) * k);
    return '#' + [16, 8, 0].map((sh) => ch(sh).toString(16).padStart(2, '0')).join('');
  }

  return { mood, palette, svg, describe, MOODS };
})();
