export function initContextMenu() {
  const addRowOption = document.getElementById('addRowOption');
  const editOption = document.getElementById('editOption');
  const archiveOption = document.getElementById('archiveOption');
  const deleteOption = document.getElementById('deleteOption');

  if (addRowOption) addRowOption.addEventListener('click', () => {
    if (typeof resetAndUpdateDialog === 'function') resetAndUpdateDialog();
    const dlg = document.getElementById('addRowDialog');
    if (dlg) dlg.showModal();
    if (typeof hideContextMenu === 'function') hideContextMenu();
  });

  if (editOption) editOption.addEventListener('click', () => {
    const dlg = document.getElementById('editRowDialog');
    if (dlg) dlg.showModal();
    const ctx = document.getElementById('contextMenu');
    if (ctx) ctx.style.display = 'none';
  });

  if (archiveOption) archiveOption.addEventListener('click', () => {});
  if (deleteOption) deleteOption.addEventListener('click', () => {});
}
