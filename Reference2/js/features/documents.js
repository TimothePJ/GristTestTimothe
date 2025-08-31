export function initDocuments() {
  const secondDropdown = document.getElementById('secondColumnListbox');
  if (!secondDropdown) return;
  secondDropdown.addEventListener('change', function () {
    const val = this.value;
    if (val === 'addTable' && typeof handleAddTable === 'function') return handleAddTable();
    if (val === 'addMultipleTable' && typeof handleAddMultipleTable === 'function') return handleAddMultipleTable();
    if (typeof populateTable === 'function') populateTable();
  });
}
