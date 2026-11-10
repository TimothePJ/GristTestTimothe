// Bouton « Exporter » : rassemble le modèle (fourni par main.js), charge ExcelJS à la demande,
// ajoute les logos, construit le classeur et le fait télécharger. Tout ce qui touche au
// navigateur (script, fetch, lien de téléchargement) est injectable pour les tests.

import { buildPlanningWorkbook } from "../services/planningExcelWriter.js";

// Chargée au premier export seulement (≈ 1 Mo) ; l'empreinte est celle publiée par cdnjs, le
// navigateur refuse un fichier modifié.
export const EXCELJS_CDN = Object.freeze({
  url: "https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js",
  integrity: "sha512-dlPw+ytv/6JyepmelABrgeYgHI0O+frEwgfnPdXDTOIZz+eDgfW07QXG02/O8COfivBdGNINy+Vex+lYmJ5rxw==",
});

// Les logos des exports PDF de la liste de plans (ListeDePlan), dans le même ordre. Chemins
// relatifs à index.html ; dimensions en pixels, pour garder les proportions (un test les vérifie).
export const PLANNING_EXPORT_LOGOS = Object.freeze([
  { url: "../img/VC_Logotype_Digital_RVB.jpg", extension: "jpeg", width: 2057, height: 745 },
  { url: "../img/bloc délégation bleu.png", extension: "png", width: 683, height: 270 },
  { url: "../img/Logo DRTO fr - Bleu.png", extension: "png", width: 799, height: 923 },
].map((logo) => Object.freeze(logo)));

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// Un chargement par fenêtre ; un échec est oublié pour que le clic suivant réessaie.
const excelJsLoads = new WeakMap();

export function loadExcelJs({
  windowRef = globalThis.window,
  documentRef = globalThis.document,
} = {}) {
  if (windowRef?.ExcelJS) return Promise.resolve(windowRef.ExcelJS);
  if (excelJsLoads.has(windowRef)) return excelJsLoads.get(windowRef);

  const loading = new Promise((resolve, reject) => {
    const script = documentRef.createElement("script");
    script.src = EXCELJS_CDN.url;
    script.integrity = EXCELJS_CDN.integrity;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";
    script.async = true;
    script.onload = () => {
      if (windowRef.ExcelJS) resolve(windowRef.ExcelJS);
      else reject(new Error("la bibliothèque Excel est chargée mais inutilisable."));
    };
    script.onerror = () => {
      reject(new Error("la bibliothèque Excel n'a pas pu être chargée (connexion internet ?)."));
    };
    documentRef.head.appendChild(script);
  });
  const tracked = loading.catch((error) => {
    excelJsLoads.delete(windowRef);
    throw error;
  });
  excelJsLoads.set(windowRef, tracked);
  return tracked;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

export async function loadPlanningExportLogos({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  logos = PLANNING_EXPORT_LOGOS,
  logError = console.warn,
} = {}) {
  const results = await Promise.allSettled(logos.map(async (logo) => {
    const response = await fetchImpl(logo.url);
    if (!response?.ok) throw new Error(`${logo.url} : HTTP ${response?.status ?? "?"}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return {
      base64: bytesToBase64(bytes),
      extension: logo.extension,
      width: logo.width,
      height: logo.height,
    };
  }));
  return results.flatMap((result) => {
    if (result.status === "fulfilled") return [result.value];
    logError("Logo de l'export Excel introuvable :", result.reason);
    return [];
  });
}

export function downloadWorkbookBuffer(buffer, fileName, {
  documentRef = globalThis.document,
  URLRef = globalThis.URL,
  setTimeoutRef = globalThis.setTimeout,
} = {}) {
  const blob = new Blob([buffer], { type: XLSX_MIME });
  const url = URLRef.createObjectURL(blob);
  const link = documentRef.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  documentRef.body.appendChild(link);
  link.click();
  link.remove();
  // Libéré un peu plus tard : certains navigateurs lisent l'adresse après le clic.
  setTimeoutRef(() => URLRef.revokeObjectURL(url), 1000);
}

export function createPlanningExportAction({
  button = null,
  collectModel,
  setStatus = () => {},
  loadLibrary = loadExcelJs,
  loadLogos = loadPlanningExportLogos,
  buildWorkbook = buildPlanningWorkbook,
  download = downloadWorkbookBuffer,
  logError = console.error,
} = {}) {
  let busy = false;
  const idleLabel = button?.textContent || "Exporter";

  function setBusy(nextBusy) {
    busy = nextBusy;
    if (!button) return;
    button.disabled = nextBusy;
    button.textContent = nextBusy ? "Export…" : idleLabel;
    if (nextBusy) button.setAttribute("aria-busy", "true");
    else button.removeAttribute("aria-busy");
  }

  async function run() {
    if (busy) return { ok: false, reason: "busy" };
    setBusy(true);
    try {
      const model = await collectModel();
      const [ExcelJS, logos] = await Promise.all([
        loadLibrary(),
        Promise.resolve().then(() => loadLogos()).catch((error) => {
          logError("Logos de l'export Excel illisibles :", error);
          return [];
        }),
      ]);
      const workbook = buildWorkbook(ExcelJS, model, { logos });
      const buffer = await workbook.xlsx.writeBuffer();
      download(buffer, model.fileName);
      setStatus(`Export Excel téléchargé : ${model.fileName}`);
      return { ok: true, fileName: model.fileName };
    } catch (error) {
      logError("Export Excel du planning impossible :", error);
      setStatus(`Export Excel impossible : ${error?.message || error}`);
      return { ok: false, error };
    } finally {
      setBusy(false);
    }
  }

  button?.addEventListener("click", () => {
    void run();
  });
  return { run };
}
