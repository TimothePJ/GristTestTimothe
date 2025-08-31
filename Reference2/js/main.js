import { initProjects } from './features/projects.js';
import { initDocuments } from './features/documents.js';
import { initTable } from './features/table.js';
import { initContextMenu } from './features/contextMenu.js';
import { initDialogs } from './features/dialogs.js';
import { initClipboard } from './features/clipboard.js';
import { initFiles } from './features/files.js';

window.addEventListener('DOMContentLoaded', () => {
  initProjects();
  initDocuments();
  initTable();
  initContextMenu();
  initDialogs();
  initClipboard();
  initFiles();
});
