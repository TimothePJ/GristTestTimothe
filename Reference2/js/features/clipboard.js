export function initClipboard() {
  const copyBtn = document.getElementById('copyTableDataButton');
  const copyImgBtn = document.getElementById('copyTableDataButtonImage');
  const downloadBtn = document.getElementById('downloadTableButton');

  if (copyBtn && typeof html2canvas !== 'undefined') {
    copyBtn.addEventListener('click', () => {
      if (typeof copyTableData === 'function') return copyTableData();
      const table = document.getElementById('dataTable');
      if (!table) return;
      let text = '';
      const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText).join('\t');
      text += headers + '\n';
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      rows.forEach(row => {
        const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText);
        text += cols.join('\t') + '\n';
      });
      navigator.clipboard.writeText(text);
    });
  }

  if (copyImgBtn && typeof html2canvas !== 'undefined') {
    copyImgBtn.addEventListener('click', () => {
      const table = document.getElementById('dataTable');
      if (!table) return;
      html2canvas(table).then(canvas => {
        canvas.toBlob(blob => {
          const item = new ClipboardItem({ 'image/png': blob });
          navigator.clipboard.write([item]);
        });
      });
    });
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', () => {
      const table = document.getElementById('dataTable');
      if (!table) return;
      let text = '';
      const headers = Array.from(table.querySelectorAll('thead th')).map(th => th.innerText).join('\t');
      text += headers + '\n';
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      rows.forEach(row => {
        const cols = Array.from(row.querySelectorAll('td')).map(td => td.innerText);
        text += cols.join('\t') + '\n';
      });
      const blob = new Blob([text], { type: 'text/tab-separated-values' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'table.txt';
      a.click();
    });
  }
}
