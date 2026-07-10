// Time-Out/assets/js/utils/teamPeople.js
// Pure. Dedupes Team rows into one entry per person (key = normalize(Prenom+Nom)),
// aggregating that person's multiple email rows. No DOM, no Grist.
import { toText } from "./dates.js";

export function normalizeEmail(value) {
  return toText(value).toLowerCase();
}
export function normalizeName(value) {
  return toText(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function pickPrimaryEmail(emails) {
  if (!emails.length) return "";
  const preferred = emails.find((e) => e.includes("@vinci-construction.") && !e.includes("-ext"));
  return preferred || emails[0];
}

// cols = { email, prenom, nom, service }
export function dedupeTeamMembers(teamRows, cols) {
  const byKey = new Map();
  for (const r of teamRows || []) {
    const prenom = toText(r?.[cols.prenom]);
    const nom = toText(r?.[cols.nom]);
    const fullName = `${prenom} ${nom}`.trim();
    const email = normalizeEmail(r?.[cols.email]);
    const personKey = normalizeName(fullName) || email;
    if (!personKey) continue;
    let m = byKey.get(personKey);
    if (!m) {
      m = { personKey, name: fullName || email, service: toText(r?.[cols.service]), emails: [], primaryEmail: "" };
      byKey.set(personKey, m);
    }
    if (email && !m.emails.includes(email)) m.emails.push(email);
    if (!m.service) m.service = toText(r?.[cols.service]);
    if (!m.name) m.name = fullName || email;
  }
  for (const m of byKey.values()) m.primaryEmail = pickPrimaryEmail(m.emails);
  return [...byKey.values()];
}

export function findPersonKeyForEmail(members, email) {
  const e = normalizeEmail(email);
  if (!e) return "";
  const m = (members || []).find((mm) => (mm.emails || []).includes(e));
  return m ? m.personKey : "";
}

// Non-admin: only members of the given service (accent/case-insensitive). Admin: all.
export function filterMembersByService(members, service, isAdmin) {
  if (isAdmin) return members || [];
  const target = normalizeName(service);
  return (members || []).filter((m) => normalizeName(m?.service) === target);
}
