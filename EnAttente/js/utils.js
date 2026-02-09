function makeDocLabel(nomDocument, numeroDocument) {
  const nm = String(nomDocument || '').trim();
  let show = null;

  if (numeroDocument != null) {
    const s = String(numeroDocument).trim();
    show = (s === '' || s === '-' || s === '_') ? null : s;
  }
  // numero PUIS nom (comme dans Reference2)
  return (show !== null) ? `${show} ${nm}` : nm;
}

function normalizeNumero(num) {
  if (num === '' || num === '-' || num === '_') return null;
  const n = (num == null ? null : Number(num));
  // Reference2 considère 0 / NaN comme "pas de numéro"
  return (!Number.isFinite(n) || n === 0) ? null : n;
}

function uniqProjects(records) {
  const set = new Set();
  (records || []).forEach(r => {
    if (r && r.NomProjet) set.add(String(r.NomProjet));
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
