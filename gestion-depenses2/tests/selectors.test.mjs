import assert from "node:assert/strict";
import test from "node:test";

import { getAvailableTeamMembers } from "../assets/js/ui/selectors.js";

test("la liste des collaborateurs fusionne les adresses mail d'une meme personne", () => {
  const members = [
    {
      id: 11,
      firstName: "Timothé",
      lastName: "Petitjean",
      role: "Ingenieur",
      email: "timothe.petitjean@vinci-construction.com",
    },
    {
      id: 12,
      firstName: "Timothe",
      lastName: "PETITJEAN",
      role: "Ingenieur",
      email: "timothe.petitjean@vinci-construction.fr",
    },
    {
      id: 13,
      firstName: "Aldjia",
      lastName: "Louda",
      role: "Projeteur",
      email: "aldjia.louda@vinci-construction.com",
    },
  ];

  const availableMembers = getAvailableTeamMembers(members);

  assert.deepEqual(availableMembers.map((member) => member.id), [13, 11]);
});

test("une personne deja affectee masque toutes ses lignes Team", () => {
  const members = [
    { id: 21, firstName: "Timothe", lastName: "Petitjean", role: "Ingenieur" },
    { id: 22, firstName: "Timothe", lastName: "PETITJEAN", role: "Ingenieur" },
    { id: 23, firstName: "Aldjia", lastName: "Louda", role: "Projeteur" },
  ];
  const project = {
    workers: [{ id: 101, name: "Timothe Petitjean" }],
  };

  const availableMembers = getAvailableTeamMembers(members, project);

  assert.deepEqual(availableMembers.map((member) => member.id), [23]);
});
