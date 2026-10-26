// Reglages du lissage des taches : lecture et ecriture du JSON de la colonne
// texte `Projets2.Lissage` (spec §5.1 a §5.3).
//
// Module PUR, sans DOM ni Grist : il ne fait que transformer du texte. Format de
// la cellule :
//   {"version":1,"services":{"<Service>":{"maxTotal":4,"maxParType":{"COFFRAGE":2},
//     "debut":"2026-06","parMois":{"2027-03":{"maxTotal":6,"maxParType":{"ARMATURES":6}}}}}}
// Une entree par service ; un service sans aucun maximum n'a pas d'entree.
//   - debut (facultatif) : premier mois ou le lissage peut placer une tache
//     (AAAA-MM) ; absent = le mois en cours ;
//   - parMois (facultatif) : pour un mois precis, un maximum general et/ou par
//     type qui remplace celui de tous les mois (une valeur absente reprend
//     celle de tous les mois).
// Dans le code on manipule `{ maxTotal, maxByType, startMonth?, maxByMonth? }`
// (forme attendue par smoothTasks de top/taskSmoothing.js) : startMonth n'est
// present que s'il est fixe, maxByMonth que s'il a au moins un mois, et chaque
// mois de maxByMonth vaut `{ maxTotal, maxByType }`.
//
// Lecture TOLERANTE : cellule vide, JSON illisible, valeur non entiere ou < 1 ->
// ignorees avec un console.warn, jamais d'exception.

import { TYPE_ORDER } from "./taskLabels.js";

const FORMAT_VERSION = 1;

export const MAX_INPUT_ERROR = "Entrez un nombre entier supérieur ou égal à 1, ou laissez vide.";

function emptySettings() {
  return { maxTotal: null, maxByType: {} };
}

// Un maximum valide est un nombre entier >= 1 (la chaine "3" est refusee).
function isValidMax(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

// Cle de mois valide : AAAA-MM, mois de 01 a 12.
export function isMonthKey(value) {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

// Maximums d'une entree { maxTotal, maxParType } -> { maxTotal, maxByType } ;
// `where` precise les avertissements (« » pour tous les mois, « de mars 2027 »...).
function readMaxima(entry, where) {
  const maxima = emptySettings();
  if (entry.maxTotal != null) {
    if (isValidMax(entry.maxTotal)) maxima.maxTotal = entry.maxTotal;
    else console.warn(`Lissage : maximum général${where} ignoré (entier >= 1 attendu).`);
  }

  const perType = entry.maxParType;
  if (perType && typeof perType === "object") {
    for (const [type, value] of Object.entries(perType)) {
      if (!TYPE_ORDER.includes(type)) {
        console.warn(`Lissage : type inconnu « ${type} »${where} ignoré.`);
      } else if (isValidMax(value)) {
        maxima.maxByType[type] = value;
      } else {
        console.warn(`Lissage : maximum du type « ${type} »${where} ignoré (entier >= 1 attendu).`);
      }
    }
  }
  return maxima;
}

function hasMaxima(maxima) {
  return Boolean(maxima) && (maxima.maxTotal != null || Object.keys(maxima.maxByType || {}).length > 0);
}

// Entree « parMois » de la cellule -> maxByMonth (mois valides, avec au moins
// un maximum valide).
function readMonthMaxima(parMois) {
  const byMonth = {};
  if (!parMois || typeof parMois !== "object" || Array.isArray(parMois)) return byMonth;
  for (const [month, entry] of Object.entries(parMois)) {
    if (!isMonthKey(month)) {
      console.warn(`Lissage : mois « ${month} » ignoré (AAAA-MM attendu).`);
      continue;
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      console.warn(`Lissage : maximums du mois ${month} ignorés.`);
      continue;
    }
    const maxima = readMaxima(entry, ` du mois ${month}`);
    if (hasMaxima(maxima)) byMonth[month] = maxima;
  }
  return byMonth;
}

// Lit la cellule brute et renvoie l'objet `services`, ou {} si la cellule est
// vide ou illisible (avertissement dans ce second cas seulement).
function readServices(rawCell) {
  if (rawCell == null || rawCell === "") return {};
  let parsed;
  try {
    parsed = typeof rawCell === "string" ? JSON.parse(rawCell) : rawCell;
  } catch (_e) {
    console.warn("Lissage : cellule illisible, ignorée.");
    return {};
  }
  const services = parsed && typeof parsed === "object" ? parsed.services : null;
  if (!services || typeof services !== "object" || Array.isArray(services)) {
    console.warn("Lissage : cellule sans « services », ignorée.");
    return {};
  }
  return services;
}

// Réglages du service demandé, au format { maxTotal, maxByType }.
export function getServiceSettings(rawCell, service) {
  const settings = emptySettings();
  const services = readServices(rawCell);
  const entry = Object.prototype.hasOwnProperty.call(services, service) ? services[service] : null;
  if (!entry || typeof entry !== "object") return settings;

  Object.assign(settings, readMaxima(entry, ""));
  if (entry.debut != null) {
    if (isMonthKey(entry.debut)) settings.startMonth = entry.debut;
    else console.warn("Lissage : mois de départ ignoré (AAAA-MM attendu).");
  }
  const maxByMonth = readMonthMaxima(entry.parMois);
  if (Object.keys(maxByMonth).length) settings.maxByMonth = maxByMonth;
  return settings;
}

// Vrai dès qu'un maximum existe : général, par type, ou d'un mois précis. Un
// mois de départ seul ne lisse rien.
export function hasAnyMax(settings) {
  if (!settings) return false;
  return hasMaxima(settings) || Object.values(settings.maxByMonth || {}).some(hasMaxima);
}

// Maximums d'un mois -> entree « parMois » de la cellule (seulement les valeurs
// fixees).
function writeMonthMaxima(maxima) {
  const entry = {};
  if (maxima.maxTotal != null) entry.maxTotal = maxima.maxTotal;
  if (Object.keys(maxima.maxByType || {}).length) entry.maxParType = { ...maxima.maxByType };
  return entry;
}

// Nouvelle valeur de la cellule : l'entrée du service est ajoutée, remplacée ou
// retirée ; celles des autres services sont conservées. "" quand plus aucun
// service n'a de réglage. Une cellule d'entrée illisible repart d'une base propre.
export function serializeSmoothingCell(rawCell, service, settings) {
  const services = { ...readServices(rawCell) };

  if (hasAnyMax(settings)) {
    const entry = {};
    if (settings.maxTotal != null) entry.maxTotal = settings.maxTotal;
    entry.maxParType = { ...(settings.maxByType || {}) };
    if (settings.startMonth) entry.debut = settings.startMonth;
    const months = Object.keys(settings.maxByMonth || {})
      .filter((month) => hasMaxima(settings.maxByMonth[month]))
      .sort();
    if (months.length) {
      entry.parMois = {};
      months.forEach((month) => {
        entry.parMois[month] = writeMonthMaxima(settings.maxByMonth[month]);
      });
    }
    services[service] = entry;
  } else {
    delete services[service];
  }

  if (!Object.keys(services).length) return "";
  return JSON.stringify({ version: FORMAT_VERSION, services });
}

// Interprète la saisie d'un champ « maximum » : vide = pas de maximum ; sinon
// un entier >= 1 (la virgule décimale « 2,5 » est donc refusée).
export function parseMaxInput(text) {
  const trimmed = String(text ?? "").trim();
  if (trimmed === "") return { ok: true, value: null };
  if (!/^\d+$/.test(trimmed)) return { ok: false, message: MAX_INPUT_ERROR };
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 1) return { ok: false, message: MAX_INPUT_ERROR };
  return { ok: true, value };
}
