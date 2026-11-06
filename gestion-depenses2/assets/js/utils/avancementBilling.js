// Facturation a l'avancement lue dans T_Avancement (import BaseDRTO).
//
// Une ligne = une affaire x un chapitre x un mois x un service BaseDRTO, et
// avc_Montant est ce qui a ete facture CE mois-la (un increment : les
// corrections arrivent en montants negatifs). Le service BaseDRTO
// (avc_ID_Service) se rattache a un service du widget par la table Service :
// ID_Service -> colonne Service. Plusieurs services BaseDRTO peuvent donner le
// meme service du widget (Structures DUMEZ et Structures PETIT -> Structure) ;
// un service sans valeur dans la colonne Service n'a pas d'equivalent et ses
// lignes sont ignorees.
import { APP_CONFIG } from "../config.js";
import { getMonthKeyFromRawMonth, toText } from "./format.js";

function normalizeServiceName(value) {
  return toText(value)
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

// 24, 24.0 et "24" designent le meme identifiant (service comme affaire).
export function normalizeIdentifier(value) {
  const text = toText(value);
  if (!text) return "";
  const numeric = Number(text.replace(",", "."));
  return Number.isFinite(numeric) ? String(numeric) : text;
}

export function avcDateToMonthKey(value) {
  const text = toText(value);
  const compactMatch = text.match(/^(\d{4})(\d{2})$/);
  if (compactMatch) {
    const monthNumber = Number(compactMatch[2]);
    return monthNumber >= 1 && monthNumber <= 12
      ? `${compactMatch[1]}-${compactMatch[2]}`
      : "";
  }
  // Repli : colonne convertie en date ou en texte "2025-09" cote Grist.
  return getMonthKeyFromRawMonth(value);
}

export function parseAvcAmount(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  const text = toText(value).replace(/\s/g, "").replace(",", ".");
  if (!text) return 0;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : 0;
}

function collectServiceIds(serviceRows, activeService, columns) {
  const expectedService = normalizeServiceName(activeService);
  const ids = new Set();
  if (!expectedService) return ids;

  (serviceRows || []).forEach((row) => {
    if (normalizeServiceName(row?.[columns.service]) !== expectedService) return;
    const id = normalizeIdentifier(row?.[columns.id]);
    if (id) ids.add(id);
  });
  return ids;
}

// Renvoie Map(numero d'affaire -> { "AAAA-MM": montant facture ce mois-la })
// pour le seul service du widget `activeService`.
export function buildBilledAmountsByProject(avancementRows, serviceRows, activeService) {
  const avancementColumns = APP_CONFIG.grist.columns.avancement;
  const serviceIds = collectServiceIds(
    serviceRows,
    activeService,
    APP_CONFIG.grist.columns.services
  );
  const byProject = new Map();
  if (!serviceIds.size) return byProject;

  (avancementRows || []).forEach((row) => {
    if (!serviceIds.has(normalizeIdentifier(row?.[avancementColumns.serviceId]))) return;

    const projectNumber = normalizeIdentifier(row?.[avancementColumns.projectNumber]);
    const monthKey = avcDateToMonthKey(row?.[avancementColumns.date]);
    if (!projectNumber || !monthKey) return;

    const amountsByMonth = byProject.get(projectNumber) || {};
    amountsByMonth[monthKey] =
      (amountsByMonth[monthKey] || 0) + parseAvcAmount(row?.[avancementColumns.amount]);
    byProject.set(projectNumber, amountsByMonth);
  });

  return byProject;
}
