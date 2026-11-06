'use strict';
/* Выпадающий список в стиле приложения (вместо системного <select>). */

/**
 * options: [{ value, label, group? }]
 * Возвращает { el, set(value), get() }
 */
function dropdown({ options, value, onChange, title, className = '' }) {
  let current = value;
  const label = h('span.dd-label');
  const btn = h(
    'button.dd-btn' + (className ? '.' + className : ''),
    {
      type: 'button',
      title: title || '',
      'aria-haspopup': 'listbox',
      on: {
        click: () => (isOpen() ? UI.closeMenu() : open()),
        keydown: (e) => {
          if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
            e.preventDefault();
            open();
          }
        },
      },
    },
    label,
    h('span.dd-chev', { icon: 'chevron' })
  );

  function paint() {
    const o = options.find((x) => x.value === current) || options[0];
    label.textContent = o ? o.label : '';
  }

  function isOpen() {
    return btn.classList.contains('open');
  }

  function open() {
    const layer = document.getElementById('menuLayer');
    UI.closeMenu();
    const box = h('div.ctx-menu.dd-menu', { role: 'listbox' });
    let group = null;
    const items = [];
    for (const o of options) {
      if (o.group && o.group !== group) {
        group = o.group;
        box.appendChild(h('div.dd-group', { text: group }));
      }
      const item = h(
        'button.ctx-item.dd-item' + (o.value === current ? '.on' : ''),
        {
          type: 'button',
          role: 'option',
          'aria-selected': o.value === current,
          on: { click: () => choose(o.value) },
        },
        h('span.dd-item-label', { text: o.label }),
        h('span.dd-check', { icon: 'check' })
      );
      items.push(item);
      box.appendChild(item);
    }
    box.addEventListener('keydown', (e) => {
      const i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[Math.min(items.length - 1, i + 1)].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[Math.max(0, i - 1)].focus();
      } else if (e.key === 'Tab') {
        UI.closeMenu();
      }
    });
    layer.appendChild(box);
    layer.classList.add('open');
    btn.classList.add('open');
    layer._onClose = () => btn.classList.remove('open');

    const r = btn.getBoundingClientRect();
    box.style.minWidth = r.width + 'px';
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    let top = r.bottom + 8;
    if (top + bh > window.innerHeight - 10) top = Math.max(10, r.top - bh - 8);
    box.style.left = Math.max(10, Math.min(r.left, window.innerWidth - bw - 10)) + 'px';
    box.style.top = top + 'px';
    box.style.maxHeight = window.innerHeight - 20 + 'px';
    (items.find((x) => x.classList.contains('on')) || items[0]).focus();
  }

  function choose(v) {
    UI.closeMenu();
    btn.focus();
    if (v === current) return;
    current = v;
    paint();
    onChange && onChange(v);
  }

  paint();
  return {
    el: btn,
    set(v) {
      current = v;
      paint();
    },
    get: () => current,
  };
}
