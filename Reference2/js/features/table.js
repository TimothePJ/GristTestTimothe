export function initTable() {
  const toggle = document.getElementById('hideArchivedToggle');
  if (toggle && typeof populateTable === 'function') {
    toggle.addEventListener('change', populateTable);
  }
}
