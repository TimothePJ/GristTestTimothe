export function initFiles() {
  const fileInput = document.getElementById('fileInput');
  if (!fileInput) return;
  fileInput.addEventListener('change', (event) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach(file => {
      if (typeof addRowWithFileName === 'function') {
        addRowWithFileName(file.name);
      }
    });
  });
}
