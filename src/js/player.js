'use strict';
/* Глобальный плеер: один медиа-элемент на всё приложение — две песни одновременно не заиграют. */

const Player = (() => {
  const media = document.createElement('video');
  media.preload = 'metadata';
  media.playsInline = true;
  media.className = 'media-el';
  media.preservesPitch = true;

  let currentId = null;
  let loop = false;
  let rate = 1;
  let videoHidden = false;
  let videoHost = null; // контейнер на странице трека, куда «пересажено» видео
  const listeners = new Set();

  const bar = () => document.getElementById('player');
  const dock = () => document.getElementById('videoDock');
  let els = {};

  function emit() {
    listeners.forEach((fn) => fn());
    document.body.classList.toggle('has-player', !!currentId);
  }

  function build() {
    const root = bar();
    clear(root);
    els.art = h('div.pl-art');
    els.title = h('b.pl-title');
    els.sub = h('span.pl-sub');
    els.play = h('button.pl-play', { title: 'Играть / пауза (пробел)', on: { click: () => toggle() } });
    els.seek = h('input.pl-seek', { type: 'range', min: 0, max: 1000, value: 0, step: 1 });
    els.cur = h('span.pl-time', { text: '0:00' });
    els.dur = h('span.pl-time', { text: '–:––' });
    els.loop = h('button.pl-btn.pl-loop', { title: 'Повторять по кругу', icon: 'loop', on: { click: () => setLoop(!loop) } });
    els.rate = h('button.pl-btn.pl-rate', { title: 'Скорость (тон не меняется)', on: { click: (e) => rateMenu(e.currentTarget) } });
    els.vol = h('input.pl-vol', { type: 'range', min: 0, max: 100, value: Math.round((S.settings.volume ?? 0.9) * 100) });
    els.mute = h('button.pl-btn', { title: 'Без звука', on: { click: () => (media.muted = !media.muted) } });
    els.video = h('button.pl-btn.pl-video', { title: 'Показать / скрыть видео', icon: 'video', on: { click: () => toggleVideo() } });
    els.open = h('button.pl-btn', { title: 'Открыть страницу трека', icon: 'open', on: { click: () => currentId && App.openDetail(currentId) } });
    els.close = h('button.pl-btn', { title: 'Остановить и закрыть', icon: 'close', on: { click: () => stop() } });

    let seeking = false;
    els.seek.addEventListener('input', () => {
      seeking = true;
      paintSeek();
      if (isFinite(media.duration)) els.cur.textContent = fmtTime((els.seek.value / 1000) * media.duration);
    });
    els.seek.addEventListener('change', () => {
      if (isFinite(media.duration)) media.currentTime = (els.seek.value / 1000) * media.duration;
      seeking = false;
    });
    els.vol.addEventListener('input', () => {
      media.volume = els.vol.value / 100;
      media.muted = false;
      paintVol();
    });
    els.vol.addEventListener('change', () => {
      S.settings.volume = media.volume;
      Store.save('settings');
    });
    media.addEventListener('timeupdate', () => {
      if (!seeking && isFinite(media.duration)) {
        els.seek.value = Math.round((media.currentTime / media.duration) * 1000) || 0;
        els.cur.textContent = fmtTime(media.currentTime);
        paintSeek();
      }
    });

    root.append(
      h('div.pl-left', null, els.art, h('div.pl-info', null, els.title, els.sub)),
      h(
        'div.pl-center',
        null,
        h(
          'div.pl-controls',
          null,
          h('button.pl-btn', { title: 'Назад на 10 секунд (←)', icon: 'rew', on: { click: () => skip(-10) } }),
          els.play,
          h('button.pl-btn', { title: 'Вперёд на 10 секунд (→)', icon: 'fwd', on: { click: () => skip(10) } })
        ),
        h('div.pl-progress', null, els.cur, els.seek, els.dur)
      ),
      h('div.pl-right', null, els.loop, els.rate, els.video, h('div.pl-volume', null, els.mute, els.vol), els.open, els.close)
    );
    paintVol();
  }

  function paintSeek() {
    els.seek.style.setProperty('--p', els.seek.value / 10 + '%');
  }
  function paintVol() {
    els.vol.style.setProperty('--p', (media.muted ? 0 : media.volume * 100) + '%');
    els.mute.innerHTML = icon(media.muted || media.volume === 0 ? 'mute' : 'volume');
  }

  function paint() {
    const t = currentId && Lib.track(currentId);
    bar().hidden = !t;
    if (!t) return;
    els.title.textContent = t.title;
    els.sub.textContent = cardSubtitle(t) || t.originalFileName || '';
    els.play.innerHTML = icon(media.paused ? 'play' : 'pause');
    els.play.classList.toggle('playing', !media.paused);
    els.loop.classList.toggle('on', loop);
    els.rate.textContent = rate === 1 ? '1×' : String(rate).replace('.', ',') + '×';
    els.rate.classList.toggle('on', rate !== 1);
    els.video.hidden = !t.hasVideo;
    els.video.classList.toggle('on', t.hasVideo && !videoHidden);
    els.dur.textContent = fmtTime(isFinite(media.duration) ? media.duration : t.duration);
    clear(els.art);
    els.art.appendChild(Cards.art(t, true));
    els.art.classList.toggle('spinning', !media.paused);
    placeVideo();
  }

  function cardSubtitle(t) {
    return Lib.attrs()
      .filter((a) => a.showOnCard && (a.type === 'select' || a.type === 'multiselect'))
      .map((a) => Attr.text(a, t.attributes[a.id]))
      .filter(Boolean)
      .join(' · ');
  }

  function placeVideo() {
    const t = currentId && Lib.track(currentId);
    const d = dock();
    if (t && t.hasVideo && videoHost && videoHost.isConnected) {
      if (media.parentNode !== videoHost) videoHost.appendChild(media);
      d.hidden = true;
      return;
    }
    if (media.parentNode !== d) {
      clear(d);
      d.append(
        h('div.dock-head', null, h('span', { icon: 'video' }), h('b', { text: 'Видео' }), h('button.icon-btn.sm', { title: 'Скрыть видео', icon: 'close', on: { click: () => toggleVideo(true) } })),
        media
      );
    }
    const dt = d.querySelector('.dock-head b');
    if (dt && t) dt.textContent = t.title;
    d.hidden = !(t && t.hasVideo && !videoHidden);
  }

  function toggleVideo(forceHide) {
    videoHidden = forceHide === true ? true : !videoHidden;
    paint();
  }

  async function play(id) {
    const t = Lib.track(id);
    if (!t) return;
    if (currentId === id && media.src) {
      try {
        await media.play();
      } catch (_) {}
      return;
    }
    const r = await window.api.trackExists(t.fileName);
    if (!r.ok || !r.value) {
      S.runtime.missing.add(t.id);
      App.refresh();
      UI.alert({
        title: 'Файл не найден',
        text: `Минусовка «${t.title}» пропала из хранилища. Откройте страницу трека и укажите файл заново или восстановите библиотеку из резервной копии.`,
      });
      return;
    }
    S.runtime.missing.delete(t.id);
    release();
    currentId = id;
    videoHidden = false;
    media.src = mediaUrl(t.fileName);
    media.loop = loop;
    media.playbackRate = rate;
    media.volume = S.settings.volume ?? 0.9;
    paint();
    emit();
    try {
      await media.play();
    } catch (e) {
      if (e && e.name !== 'AbortError') console.warn(e);
    }
  }

  function toggle(id) {
    if (id && id !== currentId) return play(id);
    if (!currentId) return;
    if (media.paused) media.play().catch(() => {});
    else media.pause();
  }

  function release() {
    media.pause();
    media.removeAttribute('src');
    media.load(); // освобождаем файл и буферы
  }

  function stop() {
    release();
    currentId = null;
    videoHost = null;
    paint();
    dock().hidden = true;
    emit();
  }

  /** Вызывается при удалении/замене файла трека */
  function forget(id) {
    if (currentId === id) stop();
  }

  function skip(sec) {
    if (!currentId || !isFinite(media.duration)) return;
    media.currentTime = Math.max(0, Math.min(media.duration - 0.05, media.currentTime + sec));
  }

  function setLoop(v) {
    loop = v;
    media.loop = v;
    paint();
  }

  function rateMenu(anchor) {
    const rates = [0.5, 0.75, 0.85, 0.9, 1, 1.1, 1.25];
    UI.menu(
      anchor,
      rates.map((r) => ({
        label: r === 1 ? 'Обычная скорость' : String(r).replace('.', ',') + '×',
        checked: r === rate,
        icon: 'speed',
        onClick: () => {
          rate = r;
          media.playbackRate = r;
          paint();
        },
      }))
    );
  }

  ['play', 'pause', 'ended', 'loadedmetadata', 'durationchange'].forEach((ev) =>
    media.addEventListener(ev, () => {
      paint();
      emit();
    })
  );
  media.addEventListener('loadedmetadata', () => {
    const t = currentId && Lib.track(currentId);
    if (!t) return;
    const hasVideo = media.videoWidth > 0;
    const dur = Math.round(media.duration);
    if (t.hasVideo !== hasVideo || (isFinite(dur) && t.duration !== dur)) {
      t.hasVideo = hasVideo;
      if (isFinite(dur)) t.duration = dur;
      Store.save('library');
      paint();
    }
  });
  media.addEventListener('volumechange', () => els.vol && paintVol());
  media.addEventListener('error', () => {
    if (!currentId || !media.getAttribute('src')) return;
    const t = Lib.track(currentId);
    const code = media.error && media.error.code;
    const text =
      code === 4
        ? 'Этот файл не получается воспроизвести: возможно, он повреждён или записан в необычном формате. Попробуйте заменить файл на странице трека.'
        : 'Во время воспроизведения что-то пошло не так. Попробуйте ещё раз.';
    UI.alert({ title: `Не играет «${t ? t.title : ''}»`, text });
    stop();
  });

  document.addEventListener('keydown', (e) => {
    if (!currentId || UI.hasModal()) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (e.code === 'Space' && tag !== 'button') {
      e.preventDefault();
      toggle();
    } else if (e.key === 'ArrowLeft') skip(-5);
    else if (e.key === 'ArrowRight') skip(5);
  });

  return {
    init: build,
    play,
    toggle,
    stop,
    forget,
    current: () => currentId,
    isPlaying: (id) => currentId === id && !media.paused,
    onChange: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    mountVideo(host) {
      videoHost = host;
      placeVideo();
    },
    unmountVideo() {
      videoHost = null;
      placeVideo();
    },
    refresh: paint,
  };
})();
