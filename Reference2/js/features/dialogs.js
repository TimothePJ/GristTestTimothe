export function initDialogs() {
  const cancelAddRowButton = document.getElementById('cancelAddRowButton');
  if (cancelAddRowButton) cancelAddRowButton.addEventListener('click', () => {
    const dlg = document.getElementById('addRowDialog');
    if (dlg) dlg.close();
  });

  const addProjectButton = document.getElementById('addProjectButton');
  if (addProjectButton) addProjectButton.addEventListener('click', () => {
    const dlg = document.getElementById('addProjectDialog');
    if (dlg) dlg.showModal();
  });

  const cancelAddDocumentButton = document.getElementById('cancelAddDocumentButton');
  if (cancelAddDocumentButton) cancelAddDocumentButton.addEventListener('click', () => {
    const dlg = document.getElementById('addDocumentDialog');
    if (dlg) dlg.close();
  });

  const cancelAddMultipleDocumentButton = document.getElementById('cancelAddMultipleDocumentButton');
  if (cancelAddMultipleDocumentButton) cancelAddMultipleDocumentButton.addEventListener('click', () => {
    const dlg = document.getElementById('addMultipleDocumentDialog');
    if (dlg) dlg.close();
  });
}
