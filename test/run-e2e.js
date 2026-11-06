'use strict';
/* Запускает сценарий в реальном окне Electron с отдельной временной папкой данных.
   npm test — автотест (test/e2e.js), npm run screenshots — скриншоты для README (test/screenshots.js) */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const scenario = process.argv[2] || 'e2e';
if (!fs.existsSync(path.join(__dirname, 'media', 'Song.wav'))) require('./make-media');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mml-test-'));
const electron = require('electron'); // путь к electron.exe
const r = spawnSync(electron, [root], {
  stdio: 'inherit',
  env: { ...process.env, MML_TEST: path.join(__dirname, scenario + '.js'), MML_USERDATA: userData },
  timeout: 5 * 60 * 1000,
});
fs.rmSync(userData, { recursive: true, force: true });
if (scenario !== 'e2e') process.exit(r.status || 0);
const result = fs.readFileSync(path.join(__dirname, 'shots', 'result.txt'), 'utf8');
const failed = result.split('\n').filter((l) => l.startsWith('FAIL'));
console.log(`\n${result.split('\n').length - failed.length} проверок прошло, ${failed.length} не прошло. Скриншоты: test/shots/`);
process.exit(failed.length || r.status ? 1 : 0);
