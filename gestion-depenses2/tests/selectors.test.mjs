import assert from "node:assert/strict";
import test from "node:test";

import {
  getAvailableTeamMembers,
  renderProjectOptions,
} from "../assets/js/ui/selectors.js";

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

test("le selecteur expose l'ID canonique au relais de synchronisation", () => {
  const previousDocument = globalThis.document;
  globalThis.document = {
    createElement() {
      return { value: "", textContent: "", dataset: {} };
    },
  };
  const select = {
    innerHTML: "",
    value: "",
    options: [],
    appendChild(option) { this.options.push(option); },
  };

  try {
    renderProjectOptions(select, [{
      id: 42,
      projectNumber: "1111",
      name: "Projet Test",
    }], 42);

    const projectOption = select.options[1];
    assert.equal(projectOption.value, "42");
    assert.equal(projectOption.dataset.projectId, "42");
    assert.equal(projectOption.dataset.projectNumber, "1111");
  } finally {
    globalThis.document = previousDocument;
  }
});
