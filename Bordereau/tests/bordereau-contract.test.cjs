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
