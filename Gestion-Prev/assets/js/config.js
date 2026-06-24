export const TABLES = {
  timeSegment: "TimeSegment",
  team: "Team",
  projects: "Projets2",
};

export const COLUMN_CANDIDATES = {
  timeSegment: {
    employeeName: ["Name", "Nom", "PrenomNom", "Prenom_Nom"],
    startAt: ["Start_At", "StartAt", "Debut", "DateDebut", "Date_Debut"],
    endAt: ["End_At", "EndAt", "Fin", "DateFin", "Date_Fin"],
    allocationDays: ["Allocation_Days", "AllocationDays", "Jours", "JoursAllocation"],
    effectif: ["Effectif"],
    projectNumber: ["NumeroProjet", "Numero_Projet", "Numero_de_projet", "Numero de projet", "Num\u00e9ro de projet", "Num\u00c3\u00a9ro de projet"],
  },
  team: {
    firstName: ["Prenom", "Pr\u00e9nom", "Pr\u00c3\u00a9nom"],
    lastName: ["Nom"],
    fullName: ["PrenomNom", "Prenom_Nom", "Prenom Nom", "Pr\u00e9nom Nom", "Pr\u00c3\u00a9nom Nom"],
    email: ["Email", "Mail"],
    service: ["Service"],
    role: ["Role", "R\u00f4le", "R\u00c3\u00b4le"],
    external: ["Externe"],
    idTrefle: ["IdTrefle", "IDTrefle", "Id_Trefle"],
  },
  projects: {
    number: ["Numero_de_projet", "Numero de projet", "Num\u00e9ro de projet", "Num\u00c3\u00a9ro de projet", "NumeroProjet", "Numero"],
    name: ["Nom_de_projet", "Nom de projet", "NomProjet", "Nom_Projet", "Projet"],
  },
};

export const CHART_COLORS = [
  "#004990",
  "#ed1b2d",
  "#2d9c73",
  "#f2b705",
  "#6f52ed",
  "#0099a8",
  "#d66b1f",
  "#415a77",
  "#8f2d56",
  "#4f772d",
];
