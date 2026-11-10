'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('api', {
  load: call('lib:load'),
  save: call('lib:save'),
  pickTracks: call('dialog:pick-tracks'),
  importTrack: call('track:import'),
  trackExists: call('track:exists'),
  removeTrackFile: call('track:remove-file'),
  trashTrackFile: call('track:trash'), // (fileName, kind = 'tracks' | 'performances')
  untrashTrackFile: call('track:untrash'),
  purgeTrashFile: call('track:purge'),
  saveTrackCopy: call('track:save-copy'),
  pickPerformances: call('perf:pick'),
  importPerformance: call('perf:import'),
  removePerformance: call('perf:remove'),
  performanceExists: call('perf:exists'),
  pickCover: call('cover:pick'),
  removeCover: call('cover:remove'),
  integrity: call('integrity:check'),
  createBackup: call('backup:create'),
  listBackups: call('backup:list'),
  deleteBackup: call('backup:delete'),
  restoreBackup: call('backup:restore'),
  revealBackup: call('backup:reveal'),
  pickBackupDest: call('backup:pick-dest'),
  saveBackupTo: call('backup:save-to'),
  exportLibrary: call('backup:export'),
  importLibrary: call('backup:import'),
  recoveryUsePrev: call('recovery:use-prev'),
  recoveryStartFresh: call('recovery:start-fresh'),
  recoveryRestoreBackup: call('recovery:restore-backup'),
  stats: call('lib:stats'),
  openFolder: call('lib:open-folder'),
  changeLocation: call('lib:change-location'),
  resetLocation: call('lib:reset-location'),
  info: call('app:info'),
  openLink: call('app:open-link'),
  openUrl: call('app:open-url'),
  copyText: call('app:copy'),
  pathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch (_) {
      return '';
    }
  },
});
