'use strict';
/* Создаёт тестовые файлы для автотеста: несколько WAV, «битый» MP3 и текстовый файл. Запуск: node test/make-media.js */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dir = path.join(__dirname, 'media');
fs.mkdirSync(dir, { recursive: true });

function wav(name, sec, freq) {
  const sr = 22050;
  const n = sr * sec;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 8000 * (1 - i / n)), 44 + i * 2);
  fs.writeFileSync(path.join(dir, name), b);
}

wav('Кукушка (минус).wav', 20, 440);
wav('Shallow_instrumental.wav', 35, 330);
wav('Колыбельная.wav', 12, 262);
wav('Song.wav', 8, 520);
fs.writeFileSync(path.join(dir, 'broken.mp3'), crypto.randomBytes(50000));
fs.writeFileSync(path.join(dir, 'notes.txt'), 'hello');
console.log('Тестовые файлы созданы в', dir);
