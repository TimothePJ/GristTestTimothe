function formatDate(date) {
  if (!date) return "";
  const d = new Date(date);
  return d.toISOString().split("T")[0];
}

function renderGantt(tasks) {
  const ganttTarget = document.getElementById("gantt");
  ganttTarget.innerHTML = "<p style='color: yellow;'>Chargement du diagramme...</p>";

  if (!tasks.length) {
    ganttTarget.innerHTML += "<p style='color: #ccc;'>Aucune tâche à afficher.</p>";
    return;
  }

  new Gantt("#gantt", tasks);
}

function convertToGanttTasks(records, project, document) {
  return records
    .filter(r =>
      r.NomProjet === project &&
      r.NomDocument === document &&
      !r.Archive &&
      r.Recu && r.DateLimite
    )
    .map(r => ({
      id: String(r.id),
      name: r.Reference,
      start: formatDate(r.Recu),
      end: formatDate(r.DateLimite),
      progress: 0,
      custom_class: r.Bloquant ? "bloquant" : ""
    }))
    .filter(task => new Date(task.start) <= new Date(task.end)); // 👈 on garde uniquement les dates valides
}
  
window.updateGanttChart = function(project, document, records) {
  const tasks = convertToGanttTasks(records, project, document);
  renderGantt(tasks);
};
  