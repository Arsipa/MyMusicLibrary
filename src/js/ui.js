'use strict';
/* Модальные окна, подтверждения, уведомления, контекстные меню. */

const UI = (() => {
  const modalsRoot = () => document.getElementById('modals');
  const stack = [];

  function openModal({ title, subtitle, body, actions, wide, className, onClose, closable = true, accent }) {
    const close = (reason) => {
      if (m.closed) return;
      if (onClose && reason !== 'force' && onClose(reason) === false) return;
      m.closed = true;
      overlay.classList.add('leaving');
      setTimeout(() => overlay.remove(), 180);
      stack.splice(stack.indexOf(m), 1);
    };
    const footer = h('div.modal-actions');
    const overlay = h(
      'div.modal-overlay',
      {
        on: {
          mousedown: (e) => {
            overlay._downOnSelf = e.target === overlay;
          },
          click: (e) => {
            if (closable && e.target === overlay && overlay._downOnSelf) close('backdrop');
          },
        },
      },
      h(
        'div.modal' + (wide ? '.wide' : '') + (className ? '.' + className : ''),
        { role: 'dialog', 'aria-modal': 'true', dataset: accent ? { accent } : undefined },
        h(
          'div.modal-head',
          null,
          h('div.modal-titles', null, h('h2.modal-title', { text: title || '' }), subtitle ? h('p.modal-sub', { text: subtitle }) : null),
          closable ? h('button.icon-btn.modal-x', { title: 'Закрыть', icon: 'close', on: { click: () => close('x') } }) : null
        ),
        h('div.modal-body', null, body),
        footer
      )
    );
    const m = { overlay, close, closed: false, footer, setActions };
    function setActions(list) {
      clear(footer);
      for (const a of list || []) {
        if (a === 'spacer') {
          footer.appendChild(h('span.spacer'));
          continue;
        }
        footer.appendChild(
          h(
            'button.btn' + (a.kind ? '.btn-' + a.kind : ''),
            { on: { click: () => a.onClick && a.onClick(m) }, disabled: a.disabled },
            a.icon ? h('span', { icon: a.icon }) : null,
            a.label
          )
        );
      }
      footer.hidden = !list || !list.length;
    }
    setActions(actions);
    modalsRoot().appendChild(overlay);
    stack.push(m);
    requestAnimationFrame(() => {
      const f = overlay.querySelector('[autofocus]') || overlay.querySelector('input:not([type=checkbox]):not([type=range]), textarea');
      if (f) f.focus();
    });
    return m;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOpen()) {
      e.stopPropagation();
      closeMenu();
      return;
    }
    if (e.key === 'Escape' && stack.length) {
      e.stopPropagation();
      stack[stack.length - 1].close('escape');
    }
  }, true);

  function hasModal() {
    return stack.length > 0;
  }

  /** Подтверждение. Возвращает Promise<{ok, checked} | false> */
  function confirm({ title, text, okLabel = 'Да', cancelLabel = 'Отмена', danger, checkbox, extra, icon: ic }) {
    return new Promise((resolve) => {
      let cb;
      const body = h(
        'div.confirm',
        null,
        text ? h('p.confirm-text', { text }) : null,
        extra || null,
        checkbox
          ? h('label.check', null, (cb = h('input', { type: 'checkbox', checked: !!checkbox.checked })), h('span.check-box', { icon: 'check' }), h('span', { text: checkbox.label }))
          : null
      );
      let done = false;
      const m = openModal({
        title,
        body,
        className: 'small',
        onClose: () => {
          if (!done) resolve(false);
        },
        actions: [
          'spacer',
          { label: cancelLabel, kind: 'ghost', onClick: (mm) => mm.close('cancel') },
          {
            label: okLabel,
            kind: danger ? 'danger' : 'primary',
            onClick: (mm) => {
              done = true;
              resolve({ ok: true, checked: cb ? cb.checked : false });
              mm.close('force');
            },
          },
        ],
      });
      return m;
    });
  }

  /**
   * Выбор из нескольких вариантов. choices: [{id,label,kind,icon}] → Promise<id|null>
   * Кнопки стоят столбиком во всю ширину: главная сверху, опасная — внизу.
   */
  function choose({ title, text, choices, icon: ic, extra }) {
    const rank = (c) => (c.kind === 'primary' ? 0 : c.kind && c.kind.includes('danger') ? 2 : 1);
    const ordered = choices.slice().sort((a, b) => rank(a) - rank(b));
    return new Promise((resolve) => {
      let done = false;
      openModal({
        title,
        className: 'small.choose',
        body: h('div.confirm', null, h('p.confirm-text', { text }), extra || null),
        onClose: () => {
          if (!done) resolve(null);
        },
        actions: [
          ...ordered.map((c) => ({
            icon: c.icon,
            label: c.label,
            kind: c.kind,
            onClick: (mm) => {
              done = true;
              resolve(c.id);
              mm.close('force');
            },
          })),
        ],
      });
    });
  }

  function alert({ title, text, list, icon: ic = 'warn' }) {
    return new Promise((resolve) => {
      openModal({
        title,
        className: 'small',
        onClose: () => resolve(),
        body: h(
          'div.confirm',
          null,
          text ? h('p.confirm-text', { text }) : null,
          list && list.length ? h('ul.confirm-list', null, list.map((t) => h('li', { text: t }))) : null
        ),
        actions: ['spacer', { label: 'Понятно', kind: 'primary', onClick: (m) => m.close('ok') }],
      });
    });
  }

  function toast(text, { kind = 'info', action, duration = 4200 } = {}) {
    const root = document.getElementById('toasts');
    const t = h(
      'div.toast.toast-' + kind,
      null,
      h('span.toast-ic', { icon: kind === 'error' ? 'warn' : kind === 'ok' ? 'check' : 'sparkle' }),
      h('span.toast-text', { text })
    );
    const remove = () => {
      if (t.classList.contains('leaving')) return;
      t.classList.add('leaving');
      setTimeout(() => t.remove(), 250);
    };
    if (action) {
      t.appendChild(
        h('button.toast-btn', {
          text: action.label,
          on: {
            click: () => {
              action.onClick();
              remove();
            },
          },
        })
      );
    }
    t.appendChild(h('button.toast-x', { type: 'button', title: 'Закрыть', 'aria-label': 'Закрыть уведомление', icon: 'close', on: { click: remove } }));
    root.appendChild(t);
    setTimeout(remove, action ? Math.max(duration, 7000) : duration);
  }

  /** Контекстное меню у элемента или в точке. items: [{label, icon, danger, onClick}] */
  function menu(anchor, items, point) {
    const layer = document.getElementById('menuLayer');
    clear(layer);
    const box = h(
      'div.ctx-menu',
      null,
      items.map((it) =>
        it === '-'
          ? h('div.ctx-sep')
          : h(
              'button.ctx-item' + (it.danger ? '.danger' : '') + (it.checked ? '.on' : ''),
              {
                disabled: !!it.disabled,
                on: {
                  click: (e) => {
                    e.stopPropagation();
                    closeMenu();
                    it.onClick();
                  },
                },
              },
              it.color ? h('span.ctx-dot', { style: { '--c': it.color } }) : h('span', { icon: it.icon }),
              h('span.ctx-label', { text: it.label }),
              it.checked ? h('span.ctx-check', { icon: 'check' }) : null
            )
      )
    );
    layer.appendChild(box);
    layer.classList.add('open');
    const r = point ? { left: point.x, right: point.x, top: point.y, bottom: point.y } : anchor.getBoundingClientRect();
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    let x = Math.min(r.right - bw, window.innerWidth - bw - 10);
    if (point) x = Math.min(point.x, window.innerWidth - bw - 10);
    let y = r.bottom + 6;
    if (y + bh > window.innerHeight - 10) y = Math.max(10, r.top - bh - 6);
    box.style.left = Math.max(10, x) + 'px';
    box.style.top = y + 'px';
  }
  function closeMenu() {
    const layer = document.getElementById('menuLayer');
    layer.classList.remove('open');
    clear(layer);
    if (layer._onClose) {
      layer._onClose();
      layer._onClose = null;
    }
  }
  function menuOpen() {
    return document.getElementById('menuLayer').classList.contains('open');
  }
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('.ctx-menu') || e.target.closest('.dd-btn.open') || e.target.closest('.color-btn.open') || e.target.closest('.date-btn.open')) return;
    closeMenu();
  });
  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);

  /** Блокирующий индикатор долгой операции */
  function busy(text) {
    const el = h('div.busy', null, h('div.busy-card', null, h('div.busy-vinyl'), h('p', { text })));
    document.body.appendChild(el);
    return {
      set: (t) => (el.querySelector('p').textContent = t),
      done: () => el.remove(),
    };
  }

  return { openModal, confirm, choose, alert, toast, menu, closeMenu, busy, hasModal };
})();
