function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, m => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#039;"
  }[m]));
}

function isFilled(v) {
  return v !== null && v !== undefined && v !== "" && v !== "-";
}

function uniqueSorted(list) {
  return [...new Set(list)].filter(isFilled).sort((a, b) => String(a).localeCompare(String(b)));
}
