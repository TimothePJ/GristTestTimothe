import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  EXCELJS_CDN,
  PLANNING_EXPORT_LOGOS,
  createPlanningExportAction,
  downloadWorkbookBuffer,
  loadExcelJs,
  loadPlanningExportLogos,
} from "../assets/js/ui/planningExportAction.js";

function fakeButton(label = "Exporter") {
  const listeners = new Map();
  const attributes = new Map();
  return {
    textContent: label,
    disabled: false,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    removeAttribute(name) {
      attributes.delete(name);
    },
    getAttribute(name) {
      return attributes.has(name) ? attributes.get(name) : null;
    },
    click() {
      listeners.get("click")?.();
    },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const MODEL = { fileName: "Planning Structure - HOTEL DIEU - 2026-11-10.xlsx" };

function actionWith(overrides = {}) {
  const calls = { status: [], downloads: [], built: [] };
  const button = fakeButton();
  const action = createPlanningExportAction({
    button,
    collectModel: async () => MODEL,
    loadLibrary: async () => "ExcelJS",
    loadLogos: async () => [{ base64: "AAA" }],
    buildWorkbook: (ExcelJS, model, options) => {
      calls.built.push({ ExcelJS, model, options });
      return { xlsx: { writeBuffer: async () => "BUFFER" } };
    },
    download: (buffer, fileName) => calls.downloads.push({ buffer, fileName }),
    setStatus: (message) => calls.status.push(message),
    logError: () => {},
    ...overrides,
  });
  return { action, button, calls };
}

test("un clic construit le classeur du modèle et le télécharge sous son nom", async () => {
  const { action, calls } = actionWith();
  const result = await action.run();
  assert.deepEqual(result, { ok: true, fileName: MODEL.fileName });
  assert.equal(calls.built.length, 1);
  assert.equal(calls.built[0].ExcelJS, "ExcelJS");
  assert.equal(calls.built[0].model, MODEL);
  assert.deepEqual(calls.built[0].options, { logos: [{ base64: "AAA" }] });
  assert.deepEqual(calls.downloads, [{ buffer: "BUFFER", fileName: MODEL.fileName }]);
  assert.deepEqual(calls.status, [`Export Excel téléchargé : ${MODEL.fileName}`]);
});

test("pendant l'export le bouton est occupé, un second clic ne relance rien", async () => {
  const gate = deferred();
  let collected = 0;
  const { action, button, calls } = actionWith({
    collectModel: async () => {
      collected += 1;
      await gate.promise;
      return MODEL;
    },
  });
  const first = action.run();
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Export…");
  assert.equal(button.getAttribute("aria-busy"), "true");

  button.click();
  assert.deepEqual(await action.run(), { ok: false, reason: "busy" });
  assert.equal(collected, 1);

  gate.resolve();
  await first;
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Exporter");
  assert.equal(button.getAttribute("aria-busy"), null);
  assert.equal(calls.downloads.length, 1);
});

test("une erreur est dite dans la barre d'état et le bouton redevient utilisable", async () => {
  const { action, button, calls } = actionWith({
    collectModel: async () => {
      throw new Error("choisissez d'abord un projet.");
    },
  });
  const result = await action.run();
  assert.equal(result.ok, false);
  assert.deepEqual(calls.status, ["Export Excel impossible : choisissez d'abord un projet."]);
  assert.equal(calls.downloads.length, 0);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Exporter");
});

test("des logos introuvables n'empêchent pas l'export", async () => {
  const { action, calls } = actionWith({
    loadLogos: async () => {
      throw new Error("404");
    },
  });
  const result = await action.run();
  assert.equal(result.ok, true);
  assert.deepEqual(calls.built[0].options, { logos: [] });
});

test("ExcelJS est chargé une seule fois, depuis cdnjs, avec contrôle d'intégrité", async () => {
  assert.match(EXCELJS_CDN.url, /^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/exceljs\/4\.4\.0\/exceljs\.min\.js$/);
  assert.match(EXCELJS_CDN.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/);

  const appended = [];
  const windowRef = {};
  const documentRef = {
    createElement: (tag) => ({ tagName: tag, setAttribute() {} }),
    head: { appendChild: (node) => appended.push(node) },
  };
  const first = loadExcelJs({ windowRef, documentRef });
  const second = loadExcelJs({ windowRef, documentRef });
  assert.equal(appended.length, 1);
  const script = appended[0];
  assert.equal(script.src, EXCELJS_CDN.url);
  assert.equal(script.integrity, EXCELJS_CDN.integrity);
  assert.equal(script.crossOrigin, "anonymous");
  windowRef.ExcelJS = { Workbook: class {} };
  script.onload();
  assert.equal(await first, windowRef.ExcelJS);
  assert.equal(await second, windowRef.ExcelJS);
  // Déjà présente : plus aucun script ajouté.
  assert.equal(await loadExcelJs({ windowRef, documentRef }), windowRef.ExcelJS);
  assert.equal(appended.length, 1);
});

test("un échec de chargement d'ExcelJS est expliqué et le clic suivant réessaie", async () => {
  const appended = [];
  const windowRef = {};
  const documentRef = {
    createElement: (tag) => ({ tagName: tag, setAttribute() {} }),
    head: { appendChild: (node) => appended.push(node) },
  };
  const attempt = loadExcelJs({ windowRef, documentRef });
  appended[0].onerror();
  await assert.rejects(attempt, /bibliothèque Excel/);
  loadExcelJs({ windowRef, documentRef }).catch(() => {});
  assert.equal(appended.length, 2);
});

// Les tailles déclarées servent à garder les proportions des logos : elles doivent rester
// celles des fichiers du dossier img/.
function imageSize(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  let offset = 2;
  while (offset < bytes.length) {
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    offset += 2 + length;
  }
  throw new Error("taille introuvable");
}

test("les logos déclarés existent et ont les dimensions annoncées", async () => {
  assert.equal(PLANNING_EXPORT_LOGOS.length, 3);
  for (const logo of PLANNING_EXPORT_LOGOS) {
    const bytes = await readFile(new URL(logo.url, new URL("../index.html", import.meta.url)));
    assert.deepEqual(imageSize(bytes), { width: logo.width, height: logo.height }, logo.url);
    assert.equal(logo.extension, logo.url.endsWith(".png") ? "png" : "jpeg");
  }
});

test("les logos sont lus en base64 ; ceux qui manquent sont laissés de côté", async () => {
  const fetchImpl = async (url) => {
    if (url.includes("DRTO")) return { ok: false, status: 404 };
    return { ok: true, arrayBuffer: async () => new Uint8Array([104, 105]).buffer };
  };
  const logos = await loadPlanningExportLogos({ fetchImpl, logError: () => {} });
  assert.equal(logos.length, 2);
  assert.deepEqual(logos.map((logo) => logo.base64), ["aGk=", "aGk="]);
  assert.equal(logos[0].width, PLANNING_EXPORT_LOGOS[0].width);
});

test("le téléchargement passe par un lien temporaire, libéré ensuite", () => {
  const events = [];
  const link = {
    click: () => events.push("click"),
    remove: () => events.push("remove"),
    style: {},
  };
  const documentRef = {
    createElement: () => link,
    body: { appendChild: () => events.push("append") },
  };
  const URLRef = {
    createObjectURL: (blob) => {
      events.push(`url:${blob.type}`);
      return "blob:1";
    },
    revokeObjectURL: (url) => events.push(`revoke:${url}`),
  };
  const timers = [];
  downloadWorkbookBuffer(new Uint8Array([1]).buffer, "Planning.xlsx", {
    documentRef,
    URLRef,
    setTimeoutRef: (callback) => timers.push(callback),
  });
  assert.equal(link.href, "blob:1");
  assert.equal(link.download, "Planning.xlsx");
  assert.deepEqual(events, [
    "url:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "append",
    "click",
    "remove",
  ]);
  timers.forEach((callback) => callback());
  assert.equal(events.at(-1), "revoke:blob:1");
});
