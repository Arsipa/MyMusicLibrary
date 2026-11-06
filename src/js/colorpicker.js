'use strict';
/*
 * Выбор цвета: компактная кнопка-кружок, по нажатию — палитра.
 * Сверху готовые цвета, ниже — свободный выбор (поле оттенка/яркости + полоса цвета) и поле для кода цвета.
 */

const COLOR_PRESETS = [
  '#7b2ff7', '#9d5cff', '#c04bd9', '#ff6b9a', '#e0325f', '#ff8a4c', '#f0a92a', '#ffc94a',
  '#d6ff3d', '#3fc79a', '#6ff0c4', '#2bb8c9', '#4a7bff', '#5d4480', '#24093f', '#9a93a8',
];

/**
 * Кнопка выбора цвета. onChange(hex) вызывается при каждом изменении (в том числе во время перетаскивания).
 * Возвращает { el, set(hex), get() }
 */
function colorButton(value, onChange, { title = 'Выбрать цвет', size = '' } = {}) {
  let current = normHex(value) || COLOR_PRESETS[0];
  const el = h('button.color-btn' + (size ? '.' + size : ''), {
    type: 'button',
    title,
    'aria-label': title,
    style: { '--c': current },
    on: {
      click: (e) => {
        e.stopPropagation();
        if (el.classList.contains('open')) return UI.closeMenu();
        openColorPicker(el, current, (hex) => {
          current = hex;
          el.style.setProperty('--c', hex);
          onChange && onChange(hex);
        });
      },
    },
  });
  return {
    el,
    set(hex) {
      current = normHex(hex) || current;
      el.style.setProperty('--c', current);
    },
    get: () => current,
  };
}

function openColorPicker(anchor, value, onChange) {
  const layer = document.getElementById('menuLayer');
  UI.closeMenu();
  let { h: hue, s, v } = hexToHsv(value);
  let hex = normHex(value);

  const sv = h('div.cp-sv', null, h('span.cp-sv-knob'));
  const hueBar = h('div.cp-hue', null, h('span.cp-hue-knob'));
  const preview = h('span.cp-preview');
  const hexInp = h('input.cp-hex', { type: 'text', maxlength: 7, spellcheck: 'false', 'aria-label': 'Код цвета' });
  const presets = h(
    'div.cp-presets',
    null,
    COLOR_PRESETS.map((c) =>
      h('button.cp-preset', {
        type: 'button',
        title: c,
        dataset: { c },
        style: { '--c': c },
        on: {
          click: () => {
            ({ h: hue, s, v } = hexToHsv(c));
            set(c);
            UI.closeMenu();
          },
        },
      })
    )
  );

  const box = h(
    'div.ctx-menu.cp-pop',
    { role: 'dialog', 'aria-label': 'Выбор цвета' },
    h('div.cp-title', { text: 'Готовые цвета' }),
    presets,
    h('div.cp-title', { text: 'Свой цвет' }),
    sv,
    hueBar,
    h('div.cp-row', null, preview, hexInp, h('button.btn.btn-primary.sm', { type: 'button', on: { click: () => UI.closeMenu() } }, 'Готово'))
  );

  function paint() {
    sv.style.setProperty('--hue', `hsl(${hue}, 100%, 50%)`);
    sv.firstChild.style.left = s * 100 + '%';
    sv.firstChild.style.top = (1 - v) * 100 + '%';
    hueBar.firstChild.style.left = (hue / 360) * 100 + '%';
    preview.style.background = hex;
    if (document.activeElement !== hexInp) hexInp.value = hex;
    presets.querySelectorAll('.cp-preset').forEach((p) => p.classList.toggle('on', p.dataset.c === hex));
  }
  function set(next) {
    hex = next;
    paint();
    onChange(hex);
  }

  function drag(el, fn) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch (_) {}
      const move = (ev) => {
        const r = el.getBoundingClientRect();
        fn(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)));
      };
      move(e);
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }
  drag(sv, (x, y) => {
    s = x;
    v = 1 - y;
    set(hsvToHex(hue, s, v));
  });
  drag(hueBar, (x) => {
    hue = Math.min(359.9, x * 360);
    set(hsvToHex(hue, s, v));
  });
  hexInp.addEventListener('input', () => {
    const n = normHex(hexInp.value);
    if (n) {
      ({ h: hue, s, v } = hexToHsv(n));
      set(n);
    }
  });
  hexInp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') UI.closeMenu();
  });

  layer.appendChild(box);
  layer.classList.add('open');
  anchor.classList.add('open');
  layer._onClose = () => anchor.classList.remove('open');
  paint();

  // рядом с кнопкой, не вылезая за край окна
  const r = anchor.getBoundingClientRect();
  const bw = box.offsetWidth;
  const bh = box.offsetHeight;
  let top = r.bottom + 8;
  if (top + bh > window.innerHeight - 10) top = Math.max(10, r.top - bh - 8);
  box.style.left = Math.max(10, Math.min(r.left - 10, window.innerWidth - bw - 10)) + 'px';
  box.style.top = top + 'px';
}
