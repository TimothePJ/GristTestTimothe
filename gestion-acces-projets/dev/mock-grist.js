const tables = {
  Team: {
    id: [1, 2, 3],
    Prenom: ["Timothe", "Baptiste", "Dimitri"],
    Nom: ["Admin", "Chevau", "Tarze"],
    PrenomNom: ["Timothe Admin", "Baptiste Chevau", "Dimitri Tarze"],
    Email: [
      "timothe.admin@vinci-construction.com",
      "baptiste.chevau@vinci-construction.com",
      "dimitri.tarze@vinci-construction.com",
    ],
    Service: ["Structure", "Synthese", "Topographie"],
    Admin: [true, false, false],
    Moi: [true, ["C"], ["C"]],
    Acces_Lecture_Projets: [
      ["L"],
      ["L", "P1|Structure"],
      ["L", "P2|Structure"],
    ],
  },
  Projets2: {
    id: [1, 2, 3],
    Numero_de_projet: ["252035", "262021", "252038"],
    Nom_de_projet: ["ERA QUAI D'ORSAY", "VENTADOUR", "HOTEL DIEU"],
  },
};

function clone(value) {
  return structuredClone(value);
}

function updateRecord(tableName, recordId, fields) {
  const table = tables[tableName];
  if (!table) throw new Error(`Table ${tableName} introuvable.`);
  const index = table.id.findIndex((id) => Number(id) === Number(recordId));
  if (index < 0) throw new Error(`Ligne ${recordId} introuvable.`);
  Object.entries(fields).forEach(([column, value]) => {
    if (!Array.isArray(table[column])) throw new Error(`Colonne ${tableName}.${column} introuvable.`);
    table[column][index] = clone(value);
  });
}

export const grist = {
  ready() {},
  docApi: {
    async fetchTable(tableName) {
      const table = tables[tableName];
      if (!table) throw new Error(`Table ${tableName} introuvable.`);
      return clone(table);
    },
    async applyUserActions(actions) {
      actions.forEach(([action, tableName, recordId, fields]) => {
        if (action !== "UpdateRecord") throw new Error(`Action ${action} non simulée.`);
        updateRecord(tableName, recordId, fields);
      });
      return null;
    },
  },
};
