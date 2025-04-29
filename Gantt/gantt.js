function formatDate(date) {
  const d = new Date(date);
  return d.toISOString().split('T')[0];
}

function isValidGanttDate(date) {
  if (!date) return false;
  const d = new Date(date);
  const str = d.toISOString().split('T')[0];
  return str !== "1900-01-01" && !isNaN(d);
}

function convertToGanttTasks(records, project, document) {
  return records
    .filter(r =>
      r.NomProjet === project &&
      r.NomDocument === document &&
      !r.Archive &&
      (isValidGanttDate(r.Recu) || isValidGanttDate(r.DateLimite))
    )
    .sort((a, b) => (a.Emetteur || '').localeCompare(b.Emetteur || ''))
    .map(r => {
      const recu = isValidGanttDate(r.Recu) ? new Date(r.Recu) : null;
      const datelimite = isValidGanttDate(r.DateLimite) ? new Date(r.DateLimite) : null;

      let start = recu;
      let end = datelimite || recu;

      if (start && end && start > end) {
        end = start;
      }

      return {
        id: String(r.id),
        emetteur: r.Emetteur || "(Sans émetteur)",
        reference: r.Reference || "(Sans référence)",
        start: start ? start.toISOString().split('T')[0] : null,
        end: end ? end.toISOString().split('T')[0] : null,
        progress: 0,
        custom_class: r.Bloquant ? "bloquant" : ""
      };
    })
    .filter(t => t.start && t.end);
}

function renderTaskList(tasks) {
  const taskList = document.getElementById("task-list");
  taskList.innerHTML = `
    <div class="header">Émetteur</div>
    <div id="task-rows"></div>
  `;

  const taskRows = document.getElementById("task-rows");

  tasks.forEach(task => {
    const row = document.createElement("div");
    row.className = "task-row";
    row.textContent = task.emetteur;
    taskRows.appendChild(row);
  });
}

function renderGantt(tasks) {
  const ganttTarget = document.getElementById("gantt");
  const scrollBar = document.getElementById("gantt-scrollbar-fixed");
  const scrollInner = document.getElementById("gantt-scroll-inner");

  ganttTarget.innerHTML = "";
  const heightPerTask = 55; // hauteur des tâches
  const headerHeight = 59;  // hauteur de l'entête
  const extraPadding = 50;

  const totalHeight = headerHeight + tasks.length * heightPerTask + extraPadding;
  ganttTarget.style.height = totalHeight + "px";
  ganttTarget.style.overflow = "hidden";

  if (!tasks.length) {
    ganttTarget.innerHTML = "<p style='color: #ccc;'>Aucune tâche à afficher.</p>";
    return;
  }

  const gantt = new Gantt("#gantt", tasks.map(t => ({
    id: t.id,
    name: t.reference,
    start: t.start,
    end: t.end,
    progress: t.progress,
    custom_class: t.custom_class
  })), {
    bar_height: 38,
  });

  setTimeout(() => {
    const svg = ganttTarget.querySelector("svg");
    if (svg) {
      // Adapter la largeur du conteneur invisible
      scrollInner.style.width = svg.scrollWidth + "px";

      // Synchroniser le scroll
      scrollBar.addEventListener("scroll", () => {
        svg.style.transform = `translateX(${-scrollBar.scrollLeft}px)`;
      });
    }
  }, 100);
}

window.updateGanttChart = function(project, document, records) {
  console.log("DEBUG - Projet sélectionné:", project);
  console.log("DEBUG - Document sélectionné:", document);
  console.log("DEBUG - Nombre total de records:", records.length);

  const tasks = convertToGanttTasks(records, project, document);
  console.log("DEBUG - Tâches générées:", tasks);

  renderTaskList(tasks);
  renderGantt(tasks);
};

window.testFakeGantt = () => {
  console.log("testFakeGantt lancé !");
  const fakeTasks = [{
    id: "t1",
    emetteur: "ARCHI",
    reference: "TEST_REF",
    start: "2024-06-10",
    end: "2024-06-15",
    progress: 50,
    custom_class: ""
  }];
  renderTaskList(fakeTasks);
  renderGantt(fakeTasks);
};
