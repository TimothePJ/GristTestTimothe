// Grist Options
function getGristOptions() {
  return [
    {
      name: "startDate",
      title: "Date de début",
      optional: false,
      type: "Date,DateTime",
      description: "Date de début de l'événement",
      allowMultiple: false
    },
    {
      name: "endDate",
      title: "Date de fin",
      optional: true,
      type: "Date,DateTime",
      description: "Date de fin de l'événement",
      allowMultiple: false
    },
    {
      name: "title",
      title: "Sujet",
      optional: false,
      type: "Text",
      description: "Sujet de l'événement",
      allowMultiple: false
    },
    {
      name: "user",
      title: "Utilisateur",
      optional: true,
      type: "Text,Reference,Choice",
      description: "Utilisateur pour le regroupement",
      allowMultiple: false
    },
    {
      name: "type",
      title: "Type",
      optional: true,
      type: "Choice,Text",
      description: "Type pour la couleur",
      allowMultiple: false
    },
    {
      name: "project",
      title: "Projet",
      optional: true,
      type: "Text,Reference,Choice",
      description: "Projet associé",
      allowMultiple: false
    }
  ];
}

let timeline;
let items = new vis.DataSet();
let groups = new vis.DataSet();
let allRecords = [];

// Configuration
const container = document.getElementById('visualization');
const options = {
  locale: 'fr',
  orientation: 'top',
  stack: true,
  selectable: true,
  editable: {
    add: false,         // handled by Grist
    remove: false,      // handled by Grist
    updateGroup: false,
    updateTime: false   // Disable dragging
  },
  groupHeightMode: 'auto',
  margin: {
    item: 5,
    axis: 5
  },
  onMove: function (item, callback) {
    // Handle move/resize in Grist
    updateGristRecord(item);
    callback(item);
  }
};

// Initialize Grist
grist.ready({
  requiredAccess: 'read table',
  columns: getGristOptions(),
  allowSelectBy: true
});

grist.onRecords(function (records, mappings) {
  const mappedRecords = grist.mapColumnNames(records, mappings);
  if (mappedRecords) {
    allRecords = mappedRecords;
    updateFilterOptions();
    applyFilters();
  }
});

// Filter Elements
const filterProject = document.getElementById('filter-project');
const filterSubjectMultiselect = document.getElementById('filter-subject-multiselect');
const checkboxesContainer = document.getElementById('checkboxes');

// Handle multiselect toggle
let expanded = false;
filterSubjectMultiselect.addEventListener('click', function(e) {
    // If clicking on checkboxes, don't close
    if (e.target.closest('#checkboxes')) return;
    
    if (!expanded) {
        checkboxesContainer.style.display = "block";
        expanded = true;
    } else {
        checkboxesContainer.style.display = "none";
        expanded = false;
    }
});

// Close when clicking outside
document.addEventListener('click', function(e) {
    if (!filterSubjectMultiselect.contains(e.target)) {
        checkboxesContainer.style.display = "none";
        expanded = false;
    }
});

filterProject.addEventListener('change', () => {
    updateSubjectOptions();
    applyFilters();
});

function updateFilterOptions() {
    const projects = new Set();
    allRecords.forEach(record => {
        const p = record.project;
        if (p !== undefined && p !== null && p !== '') {
            projects.add(String(p));
        }
    });
    populateSelect(filterProject, projects);
    
    // Initialize subject options
    updateSubjectOptions();
}

function updateSubjectOptions() {
    const selectedProject = filterProject.value;
    const subjects = new Set();

    // Only add default subjects if no project is selected
    if (!selectedProject) {
        subjects.add("Développement");
        subjects.add("Gestion de service");
        subjects.add("Congés/Maladie/RTT/Férié");
        subjects.add("Formation/stages(reçues)");
        subjects.add("Journée École");
    }

    allRecords.forEach(record => {
        const p = record.project ? String(record.project) : "";
        // If a project is selected, only include subjects from that project
        if (selectedProject && p !== selectedProject) return;

        const t = record.title;
        if (t !== undefined && t !== null && t !== '') {
            subjects.add(String(t));
        }
    });

    populateCheckboxes(checkboxesContainer, subjects);
}

function populateSelect(selectElement, values) {
    const currentValue = selectElement.value;
    const defaultText = selectElement.options[0].text;
    
    // Clear existing options (except the first one)
    selectElement.innerHTML = `<option value="">${defaultText}</option>`;

    Array.from(values).sort().forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        selectElement.appendChild(option);
    });

    // Restore selection if possible
    if (values.has(currentValue)) {
        selectElement.value = currentValue;
    }
}

function populateCheckboxes(container, values) {
    // Get currently checked values to preserve state
    const currentChecked = Array.from(container.querySelectorAll('input:checked')).map(cb => cb.value);
    
    container.innerHTML = '';

    Array.from(values).sort().forEach(value => {
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = value;
        
        if (currentChecked.includes(value)) {
            input.checked = true;
        }

        input.addEventListener('change', applyFilters);
        
        label.appendChild(input);
        label.appendChild(document.createTextNode(value));
        container.appendChild(label);
    });
}

function applyFilters() {
    const projectFilter = filterProject.value;
    
    // Get selected subjects
    const subjectCheckboxes = checkboxesContainer.querySelectorAll('input:checked');
    const selectedSubjects = Array.from(subjectCheckboxes).map(cb => cb.value);

    const filteredRecords = allRecords.filter(record => {
        const p = record.project ? String(record.project) : "";
        const t = record.title ? String(record.title) : "";

        const matchProject = !projectFilter || p === projectFilter;
        const matchSubject = selectedSubjects.length === 0 || selectedSubjects.includes(t);
        
        return matchProject && matchSubject;
    });

    updateTimeline(filteredRecords);
}

grist.on('message', (e) => {
    // Handle cursor updates if needed, though onRecords might handle selection highlighting if we wanted.
    // Here we focus on click -> select.
});

// Update Timeline Data
function updateTimeline(records) {
  const newItems = [];
  const newGroups = new Set();
  const groupMap = new Map();

  records.forEach(record => {
    // Handle User/Group
    let groupId = 'unassigned';
    let groupContent = 'Non assigné';

    if (record.user) {
      groupId = String(record.user); // Use the value as ID
      groupContent = record.user;
    }

    if (!groupMap.has(groupId)) {
        groupMap.set(groupId, groupContent);
    }

    // Handle Dates
    let start = new Date(record.startDate);
    let end = record.endDate ? new Date(record.endDate) : null;
    
    // Valid check
    if (isNaN(start.getTime())) return;
    
    if (!end || isNaN(end.getTime())) {
        // Default to 1 hour if no end date
        end = new Date(start.getTime() + 60 * 60 * 1000);
    }
    
    // Handle Color/Style
    let style = '';
    
    // Apply specific colors for certain chapters (titles)
    const yellowChapters = [
        "Développement",
        "Gestion de service",
        "Congés/Maladie/RTT/Férié",
        "Formation/stages(reçues)",
        "Journée École"
    ];

    if (record.title && yellowChapters.includes(record.title)) {
        style = 'background-color: #FFD700; color: black; border-color: #FFD700;';
    }

    newItems.push({
      id: record.id,
      content: record.title || 'Sans titre',
      start: start,
      end: end,
      group: groupId,
      type: 'range', // or 'point'
      style: style
    });
  });

  // Update Groups
  const groupData = Array.from(groupMap.entries()).map(([id, content]) => ({
    id: id,
    content: content
  }));
  
  // Update DataSets
  groups.clear();
  groups.add(groupData);
  
  items.clear();
  items.add(newItems);

  // Initialize Timeline if not exists
  if (!timeline) {
    timeline = new vis.Timeline(container, items, groups, options);
    
    // Event Handlers
    timeline.on('select', function (properties) {
        if (properties.items.length > 0) {
            const selectedId = properties.items[0];
            grist.setCursorPos({rowId: selectedId});
        }
    });

    timeline.on('rangechange', function (properties) {
        updateDateRangeDisplay();
    });
    
    updateDateRangeDisplay();
  } else {
    // timeline.fit(); // Avoid resetting view on every update
  }
}

// Navigation Logic
document.getElementById('btn-prev').onclick = () => {
    moveWindow(-0.2);
};
document.getElementById('btn-next').onclick = () => {
    moveWindow(0.2);
};
document.getElementById('btn-today').onclick = () => {
    timeline.moveTo(new Date());
};

function moveWindow(percentage) {
    if (!timeline) return;
    const range = timeline.getWindow();
    const interval = range.end - range.start;
    
    timeline.setWindow({
        start: range.start.valueOf() - interval * percentage,
        end: range.end.valueOf() - interval * percentage,
    });
}

// Zoom Logic
document.querySelectorAll('.zoom-buttons button').forEach(btn => {
    btn.onclick = (e) => {
        // Remove active class
        document.querySelectorAll('.zoom-buttons button').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        
        const zoom = e.target.dataset.zoom;
        const now = new Date();
        let start, end;
        
        if (zoom === 'day') {
            start = new Date(now.setHours(0,0,0,0));
            end = new Date(now.setHours(23,59,59,999));
        } else if (zoom === 'week') {
            const first = now.getDate() - now.getDay();
            start = new Date(now.setDate(first));
            end = new Date(now.setDate(first + 6));
        } else if (zoom === 'month') {
             start = new Date(now.getFullYear(), now.getMonth(), 1);
             end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        }
        
        if (start && end) {
            timeline.setWindow(start, end);
        }
    };
});

function updateDateRangeDisplay() {
    if (!timeline) return;
    const range = timeline.getWindow();
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const text = `${range.start.toLocaleDateString('fr-FR', options)} - ${range.end.toLocaleDateString('fr-FR', options)}`;
    document.getElementById('current-date-range').textContent = text;
}

// Update Grist Record (when dragged/resized)
async function updateGristRecord(item) {
    const table = await grist.getTable();
    
    // We need to convert Dates back to what Grist expects (seconds or Date objects)
    // Using Date.getTime() / 1000 for seconds if Grist expects seconds.
    // However, Grist JS API usually handles Date objects in update.
    
    try {
        await table.update({
            id: item.id,
            fields: {
                startDate: item.start.getTime() / 1000,
                endDate: item.end.getTime() / 1000
            }
        });
    } catch (err) {
        console.error("Failed to update record", err);
    }
}
