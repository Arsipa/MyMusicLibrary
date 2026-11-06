'use strict';
/*
 * Перетаскивание элементов списка за «ручку» (значок с точками).
 * Мышью: схватить ручку и тянуть. С клавиатуры: фокус на ручке и стрелки ↑ / ↓.
 *
 * makeSortable(container, { item: '.row', handle: '.drag-handle', onMove(from, to) })
 * onMove вызывается один раз — когда элемент отпустили на новом месте.
 */

function makeSortable(container, { item, handle, onMove }) {
  const items = () => [...container.children].filter((c) => c.matches(item));

  container.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const hd = e.target.closest(handle);
    if (!hd || !container.contains(hd)) return;
    const el = hd.closest(item);
    if (!el || el.parentNode !== container) return;
    e.preventDefault();
    UI.closeMenu();

    const from = items().indexOf(el);
    let startY = e.clientY;
    const scroller = container.closest('.modal-body');
    let scrollStart = scroller ? scroller.scrollTop : 0;
    el.classList.add('dragging');
    document.body.classList.add('sorting');

    const move = (ev) => {
      // автопрокрутка, если тянем к краю окна со списком
      if (scroller) {
        const r = scroller.getBoundingClientRect();
        if (ev.clientY < r.top + 36) scroller.scrollTop -= 10;
        else if (ev.clientY > r.bottom - 36) scroller.scrollTop += 10;
      }
      const scrollDelta = scroller ? scroller.scrollTop - scrollStart : 0;
      const dy = ev.clientY - startY + scrollDelta;
      el.style.transform = `translateY(${dy}px)`;

      const r = el.getBoundingClientRect();
      const center = r.top + r.height / 2;
      const list = items();
      const idx = list.indexOf(el);
      const prev = list[idx - 1];
      const next = list[idx + 1];
      let target = null;
      let before = true;
      if (prev) {
        const pr = prev.getBoundingClientRect();
        if (center < pr.top + pr.height / 2) target = prev;
      }
      if (!target && next) {
        const nr = next.getBoundingClientRect();
        if (center > nr.top + nr.height / 2) {
          target = next;
          before = false;
        }
      }
      if (!target) return;
      // переставляем в DOM и плавно сдвигаем соседа (FLIP), а схваченный элемент остаётся под курсором
      const tFirst = target.getBoundingClientRect().top;
      const elFirst = el.offsetTop;
      if (before) container.insertBefore(el, target);
      else container.insertBefore(el, target.nextSibling);
      const shift = el.offsetTop - elFirst;
      startY += shift;
      el.style.transform = `translateY(${ev.clientY - startY + scrollDelta}px)`;
      const tLast = target.getBoundingClientRect().top;
      target.style.transition = 'none';
      target.style.transform = `translateY(${tFirst - tLast}px)`;
      requestAnimationFrame(() => {
        target.style.transition = 'transform 0.18s ease';
        target.style.transform = '';
      });
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.classList.remove('dragging');
      el.style.transform = '';
      document.body.classList.remove('sorting');
      items().forEach((x) => {
        x.style.transition = '';
        x.style.transform = '';
      });
      const to = items().indexOf(el);
      if (to !== from && to >= 0) onMove(from, to);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  container.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const hd = e.target.closest(handle);
    if (!hd) return;
    const el = hd.closest(item);
    const list = items();
    const from = list.indexOf(el);
    const to = from + (e.key === 'ArrowUp' ? -1 : 1);
    if (from < 0 || to < 0 || to >= list.length) return;
    e.preventDefault();
    onMove(from, to);
    // после перерисовки возвращаем фокус на ручку того же элемента
    requestAnimationFrame(() => {
      const h2 = items()[to] && items()[to].querySelector(handle);
      if (h2) h2.focus();
    });
  });
}

/** Ручка для перетаскивания */
function dragHandle(label = 'Перетащите, чтобы поменять порядок') {
  return h('button.drag-handle', { type: 'button', title: label + ' (или стрелки ↑ ↓)', 'aria-label': label, icon: 'grip' });
}

/** Переставить элемент массива */
function moveItem(arr, from, to) {
  const [x] = arr.splice(from, 1);
  arr.splice(to, 0, x);
  return arr;
}
