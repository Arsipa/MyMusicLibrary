'use strict';
/* Рисует иконку приложения (виниловая пластинка с нотой) в build/icon.png 512×512. Запуск: npm run icon */
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs>
  <radialGradient id="v" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#3b1366"/><stop offset="1" stop-color="#1a052e"/></radialGradient>
</defs>
<path d="M256 16c120 0 232 70 236 214 4 150-96 266-246 266S18 392 22 250C26 108 136 16 256 16z" fill="#7b2ff7"/>
<circle cx="256" cy="262" r="188" fill="url(#v)"/>
<g fill="none" stroke="#9d5cff" stroke-opacity=".35" stroke-width="5">
  <circle cx="256" cy="262" r="160"/><circle cx="256" cy="262" r="132"/><circle cx="256" cy="262" r="104"/>
</g>
<path d="M150 170a150 150 0 0 1 70-50" stroke="#fff" stroke-opacity=".4" stroke-width="16" stroke-linecap="round" fill="none"/>
<circle cx="256" cy="262" r="70" fill="#d6ff3d"/>
<circle cx="256" cy="262" r="14" fill="#1a052e"/>
<g transform="translate(300 40) rotate(12)">
  <path d="M60 30v150" stroke="#ff6b9a" stroke-width="26" stroke-linecap="round"/>
  <path d="M60 30c40 6 70 30 76 70" stroke="#ff6b9a" stroke-width="26" stroke-linecap="round" fill="none"/>
  <ellipse cx="30" cy="186" rx="42" ry="32" fill="#ff6b9a"/>
</g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.resize({ width: 512, height: 512 }).toPNG());
  console.log('icon written', out);
  app.quit();
});
