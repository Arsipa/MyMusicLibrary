'use strict';
/*
 * Празднование: если у атрибута-шкалы включено «праздновать максимум» и оценка впервые дошла до предела —
 * салют на весь экран и поздравление. Такие «прокачанные» значения помечаются короной.
 */

const Celebrate = (() => {
  const COLORS = ['#d6ff3d', '#ff6b9a', '#ffc94a', '#9d5cff', '#6ff0c4', '#ffffff', '#7b2ff7'];

  /** Значение шкалы на максимуме и атрибут просит празднования — показываем корону */
  function isCrowned(attr, value) {
    return !!(attr && attr.type === 'scale' && attr.celebrate && !Attr.isEmpty(attr, value) && Number(value) >= attr.max);
  }

  function crown(title = 'Максимум!') {
    return h('span.crown', { title, icon: 'crown' });
  }

  /** Какие шкалы с празднованием дошли до максимума между двумя состояниями значений */
  function reached(beforeAttrs, afterAttrs) {
    return Lib.attrs().filter((a) => a.type === 'scale' && a.celebrate && !isCrowned(a, beforeAttrs[a.id]) && isCrowned(a, afterAttrs[a.id]));
  }

  /** Проверить и отпраздновать (по одному окну на каждый достигнутый максимум) */
  async function check(t, beforeAttrs) {
    for (const a of reached(beforeAttrs, t.attributes)) await show(t, a);
  }

  function show(t, attr) {
    return new Promise((resolve) => {
      const stopFireworks = fireworks();
      UI.openModal({
        title: 'Максимум! 🎉',
        className: 'small.celebrate',
        accent: 'add',
        body: h(
          'div.celebrate-body',
          null,
          h('div.celebrate-crown', { icon: 'crown' }),
          h('p.celebrate-big', { text: `${attr.max} из ${attr.max}` }),
          h('p.confirm-text', null, '«', h('b', { text: attr.name }), '» у песни «', h('b', { text: fullTitle(t) }), '» дошла до максимума. Это успех — поздравляю! 💜')
        ),
        onClose: () => {
          stopFireworks();
          resolve();
        },
        actions: ['spacer', { label: 'Ура!', kind: 'primary', icon: 'cheer', onClick: (m) => m.close('ok') }, 'spacer'],
      });
    });
  }

  /** Лучшее выступление загружено — песня выучена и вошла в репертуар */
  function repertoire(t, perf) {
    return new Promise((resolve) => {
      const stopFireworks = fireworks();
      const count = Lib.tracks().filter((x) => (x.performances || []).some((p) => p.best)).length;
      UI.openModal({
        title: 'Эталонище! 🏆',
        className: 'small.celebrate.repertoire',
        accent: 'add',
        body: h(
          'div.celebrate-body',
          null,
          h('div.celebrate-crown.gold', { icon: 'crown' }),
          h('p.celebrate-big', { text: fullTitle(t) }),
          h('p.confirm-text', null, 'Финальное выступление — «', h('b', { text: perf.title }), '». Песня выучена и теперь официально в твоём репертуаре. Горжусь тобой! 💜'),
          h('p.celebrate-count', { text: `Песен в репертуаре: ${count}` })
        ),
        onClose: () => {
          stopFireworks();
          resolve();
        },
        actions: ['spacer', { label: 'Ура!', kind: 'primary', icon: 'cheer', onClick: (m) => m.close('ok') }, 'spacer'],
      });
    });
  }

  /** Салют на canvas поверх всего. Возвращает функцию остановки. */
  function fireworks() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return () => {};
    const canvas = h('canvas.fireworks');
    document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const parts = [];
    let bursts = 0;
    let raf = 0;
    let stopped = false;

    const burst = (x, y) => {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      const n = 46 + Math.floor(Math.random() * 20);
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
        const sp = 2.2 + Math.random() * 3.8;
        parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: 0.011 + Math.random() * 0.012, color: Math.random() < 0.25 ? '#ffffff' : color, size: 2 + Math.random() * 2.5 });
      }
      // конфетти
      for (let i = 0; i < 14; i++) {
        parts.push({ x, y, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 5, life: 1, decay: 0.006, color: COLORS[i % COLORS.length], size: 5, confetti: true, rot: Math.random() * 6 });
      }
    };
    const timer = setInterval(() => {
      if (bursts++ > 7) return clearInterval(timer);
      burst(innerWidth * (0.15 + Math.random() * 0.7), innerHeight * (0.12 + Math.random() * 0.4));
    }, 320);
    burst(innerWidth / 2, innerHeight * 0.3);

    const tick = () => {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.vy += p.confetti ? 0.06 : 0.05;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;
        if (p.life <= 0) {
          parts.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        if (p.confetti) {
          p.rot += 0.15;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillRect(-p.size / 2, -p.size, p.size, p.size * 2);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * p.life + 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (!stopped && (parts.length || bursts <= 8)) raf = requestAnimationFrame(tick);
      else cleanup();
    };
    raf = requestAnimationFrame(tick);

    function cleanup() {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      window.removeEventListener('resize', resize);
      canvas.remove();
    }
    return () => {
      stopped = true;
      canvas.classList.add('leaving');
      setTimeout(cleanup, 300);
    };
  }

  return { isCrowned, crown, reached, check, show, repertoire };
})();
