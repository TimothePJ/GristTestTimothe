// Time-Out/assets/js/config.js
export const LEAVE_TYPES = [
  { label: "Congé Payé",      color: "#2563eb" },
  { label: "Congé Non Payé",  color: "#6b7280" },
  { label: "RTT",             color: "#16a34a" },
  { label: "Congé Parental",  color: "#9333ea" },
];

const LEAVE_TYPE_COLORS = new Map(LEAVE_TYPES.map((t) => [t.label, t.color]));

export function leaveTypeColor(label) {
  return LEAVE_TYPE_COLORS.get(String(label || "").trim()) || "#6b7280";
}

export const APP_CONFIG = {
  storageKey: "time-out.state",
  initialWindowDays: 90,
  snapStepDays: 0.5,
  months: ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"],
  periods: {
    AM: { label: "Matin",      startHour: 8,  endHour: 12 },
    PM: { label: "Après-midi", startHour: 13, endHour: 17 },
  },
  grist: {
    tables: { team: "Team", timeOut: "Time-Out" },
    columns: {
      timeOut: {
        owner: "Owner", startDate: "Start_Date", startPeriod: "Start_Period",
        endDate: "End_Date", endPeriod: "End_Period", type: "Type",
      },
      team: {
        email: "Email", prenomNom: "PrenomNom", prenom: "Prenom", nom: "Nom",
        service: "Service", role: "Role", admin: "Admin", moi: "Moi",
      },
    },
  },
};
