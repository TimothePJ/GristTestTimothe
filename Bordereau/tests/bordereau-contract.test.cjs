const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "bordereau.html"), "utf8");
const script = fs.readFileSync(path.join(root, "bordereau.js"), "utf8");

test("le noyau d'identite est charge avant le widget", () => {
  assert.ok(html.indexOf("bordereau-core.js") >= 0);
  assert.ok(html.indexOf("bordereau-core.js") < html.indexOf("bordereau.js?v="));
});

test("le tableau place l'indice avant le type document", () => {
  assert.match(html, /<th>Indice<\/th>\s*<th>Type document<\/th>/);
  assert.match(script, /type-document-column/);
});

test("une nouvelle ligne Envois enregistre Type_Document", () => {
  assert.match(script, /Type_Document:\s*textValue\(plan\.Type_document\)/);
});

test("le PDF exporte Type_Document", () => {
  assert.match(script, /r\.Type_Document/);
  assert.match(script, /"Indice",\s*"Type document"/);
});

test("les evenements de tableau ne dependent plus des index de colonnes", () => {
  assert.doesNotMatch(script, /cellIndex/);
});

test("le catalogue projets est surveille independamment des envois", () => {
  const refreshStart = script.indexOf("async function refreshBordereauFromRecords");
  const refreshEnd = script.indexOf("window.GristServiceContext.watchContextTable", refreshStart);
  const refreshSource = script.slice(refreshStart, refreshEnd);

  assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
  assert.doesNotMatch(refreshSource, /fetchTable\(PROJET_TABLE/);
  assert.doesNotMatch(refreshSource, /populateProjectDropdown/);
  assert.match(
    script,
    /watchContextTable\(PROJET_TABLE,\s*async\s*\(projectRows\)\s*=>\s*\{\s*populateProjectDropdown\(projectRows\)/
  );
  assert.match(script, /whenReady\(\)/);
  assert.match(script, /getAllowedProjects\(\)/);
});

test("la lecture Envois exige Type_Document sans rejeter une table vide", () => {
  assert.match(
    script,
    /fetchTable\(BORDEREAU_TABLE,\s*\{\s*requiredColumns:\s*\[TYPE_DOCUMENT_COLUMN\]/
  );
  assert.match(script, /isTableColumnDefinitelyMissing\(/);
});

test("un ancien rafraichissement ne peut pas remplacer le contexte courant", () => {
  assert.match(script, /let bordereauRefreshSequence\s*=\s*0/);
  assert.match(script, /refreshSequence\s*=\s*\+\+bordereauRefreshSequence/);
  assert.match(script, /contextGeneration\s*===\s*currentGeneration/);
  assert.ok((script.match(/if \(!isCurrentRefresh\(\)\) return;/g) || []).length >= 2);
});
