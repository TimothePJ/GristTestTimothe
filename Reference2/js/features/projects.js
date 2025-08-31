export function initProjects() {
  const firstDropdown = document.getElementById('firstColumnDropdown');
  if (!firstDropdown) return;
  firstDropdown.addEventListener('change', function () {
    if (typeof populateSecondColumnListbox === 'function') {
      populateSecondColumnListbox(this.value.trim());
    }
    if (typeof updateEmetteurList === 'function') {
      updateEmetteurList();
    }
    const tableBody = document.getElementById('tableBody');
    const tableHeader = document.getElementById('tableHeader');
    if (tableBody) tableBody.innerHTML = '';
    if (tableHeader) tableHeader.innerHTML = '';
  });
}
