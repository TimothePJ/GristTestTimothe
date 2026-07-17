import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeTeamMembers, findPersonKeyForEmail, normalizeName } from "../assets/js/utils/teamPeople.js";

const COLS = { email: "Email", prenom: "Prenom", nom: "Nom", prenomNom: "PrenomNom", service: "Service" };

test("two rows, same Prenom/Nom, different emails → one member with two emails", () => {
  const rows = [
    { Prenom: "Maria", Nom: "Fernandes", Email: "maria.fernandes@vinci-construction.com", PrenomNom: "Maria Fernandes", Service: "Structure" },
    { Prenom: "Maria", Nom: "Fernandes", Email: "Maria.FERNANDESDASILVA@vinci-construction.com", PrenomNom: "", Service: "Structure" },
  ];
  const members = dedupeTeamMembers(rows, COLS);
  assert.equal(members.length, 1);
  const m = members[0];
  assert.equal(m.personKey, normalizeName("Maria Fernandes"));
  assert.equal(m.name, "Maria Fernandes");
  assert.deepEqual(m.emails, ["maria.fernandes@vinci-construction.com", "maria.fernandesdasilva@vinci-construction.com"]);
  assert.equal(m.primaryEmail, "maria.fernandes@vinci-construction.com"); // non-ext vinci
});

test("wrong/blank PrenomNom is ignored — name comes from Prenom+Nom", () => {
  const rows = [{ Prenom: "Omid", Nom: "Mokhtarivafer", Email: "omid.mokhtarivafer@vinci-construction.com", PrenomNom: "Laurent Orven", Service: "Structure" }];
  const m = dedupeTeamMembers(rows, COLS)[0];
  assert.equal(m.name, "Omid Mokhtarivafer");
  assert.equal(m.personKey, normalizeName("Omid Mokhtarivafer"));
});

test("primaryEmail falls back to first when all are -ext / partner", () => {
  const rows = [
    { Prenom: "Thadone", Nom: "Viraphan", Email: "thadone.viraphan-ext@vinci-construction.com", Service: "Structure" },
    { Prenom: "Thadone", Nom: "Viraphan", Email: "thadone.viraphan-ext@vc-partner.net", Service: "Structure" },
  ];
  const m = dedupeTeamMembers(rows, COLS)[0];
  assert.equal(m.emails.length, 2);
  assert.equal(m.primaryEmail, "thadone.viraphan-ext@vinci-construction.com"); // first
});

test("findPersonKeyForEmail matches any of a person's emails, case-insensitively", () => {
  const members = dedupeTeamMembers([
    { Prenom: "Maria", Nom: "Fernandes", Email: "maria.fernandes@vinci-construction.com", Service: "S" },
    { Prenom: "Maria", Nom: "Fernandes", Email: "Maria.FERNANDESDASILVA@vinci-construction.com", Service: "S" },
  ], COLS);
  const key = normalizeName("Maria Fernandes");
  assert.equal(findPersonKeyForEmail(members, "MARIA.fernandesdasilva@vinci-construction.com"), key);
  assert.equal(findPersonKeyForEmail(members, "unknown@x.com"), "");
});
