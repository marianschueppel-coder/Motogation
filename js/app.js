const STORAGE_KEY = 'kurvenkarte.routes.v1';

/** @type {Array<{id:string, name:string, path:number[][], stats:object, addedAt:number}>} */
let routes = [];
let selectedId = null;
let sortMode = 'curviness';
let minCurves = 0;

// --- Persistenz (localStorage: reicht für persönliche Nutzung mit
// überschaubar vielen Touren. Falls das Limit mal erreicht wird, ist
// IndexedDB der nächste Schritt.) ---
function loadRoutes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    routes = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error('Konnte gespeicherte Routen nicht laden', e);
    routes = [];
  }
}

function saveRoutes() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
  } catch (e) {
    alert('Speichern fehlgeschlagen (Speicherlimit erreicht?). Ggf. alte Touren löschen.');
  }
}

// --- Karte ---
let map;
try {
  map = L.map('map', { zoomControl: true }).setView([51.96, 7.63], 8); // Münster-Region
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap-Mitwirkende',
    maxZoom: 19
  }).addTo(map);
} catch (e) {
  const box = document.getElementById('fatal-error');
  box.hidden = false;
  box.textContent = 'Karte konnte nicht geladen werden: ' + e.message;
}

const routeLayers = new Map(); // id -> L.Polyline

function curvinessColor(curviness) {
  if (curviness >= 3.5) return '#E91E8C'; // hoch: Pink/Magenta
  if (curviness >= 1.5) return '#8E44AD'; // mittel: Violett
  return '#2E86DE'; // niedrig: kräftiges Blau
}

function drawRoute(route) {
  const color = curvinessColor(route.stats.curviness);
  const outline = L.polyline(route.path, {
    color: '#0B0D0E',
    weight: 7,
    opacity: 0.55
  });
  const line = L.polyline(route.path, {
    color,
    weight: 4,
    opacity: 0.95
  });
  const group = L.featureGroup([outline, line]).addTo(map);
  group.on('click', () => selectRoute(route.id));
  routeLayers.set(route.id, group);
}

function redrawAllRoutes() {
  routeLayers.forEach(layer => map.removeLayer(layer));
  routeLayers.clear();
  routes.forEach(drawRoute);
}

function fitToAllRoutes() {
  const layers = Array.from(routeLayers.values());
  if (layers.length === 0) return;
  const group = L.featureGroup(layers);
  map.fitBounds(group.getBounds(), { padding: [24, 24] });
}

function selectRoute(id) {
  selectedId = id;
  const layer = routeLayers.get(id);
  if (layer) map.fitBounds(layer.getBounds(), { padding: [40, 40] });
  renderList();
}

// --- Import ---
const fileInput = document.getElementById('gpx-input');
fileInput.addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const file of files) {
    try {
      const text = await file.text();
      const parsed = parseGPX(text, file.name);
      const stats = analyzeRoute(parsed.points);
      const path = parsed.points
        .filter((_, i) => i % 3 === 0) // für die Kartenlinie ausdünnen, Analyse lief auf Vollauflösung
        .map(p => [Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6))]);

      const route = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: parsed.name,
        path,
        stats,
        source: 'imported',
        addedAt: Date.now()
      };
      routes.push(route);
      drawRoute(route);
    } catch (err) {
      alert(err.message || `"${file.name}" konnte nicht importiert werden.`);
    }
  }
  saveRoutes();
  fitToAllRoutes();
  renderList();
  fileInput.value = '';
});

// --- Route erstellen (Start/Ziel/Standort) ---
const startInput = document.getElementById('start-input');
const endInput = document.getElementById('end-input');
const useLocationBtn = document.getElementById('use-location-btn');
const buildRouteBtn = document.getElementById('build-route-btn');
const statusEl = document.getElementById('route-builder-status');

let startOverride = null; // gesetzt, wenn Start über Standortabfrage kam

function setStatus(text, isError) {
  statusEl.textContent = text;
  statusEl.className = 'status-text' + (isError ? ' error' : '');
}

useLocationBtn.addEventListener('click', async () => {
  setStatus('Ermittle Standort…', false);
  try {
    const pos = await getCurrentPosition();
    startOverride = pos;
    startInput.value = 'Aktueller Standort';
    setStatus('', false);
  } catch (err) {
    setStatus(err.message, true);
  }
});

startInput.addEventListener('input', () => { startOverride = null; });

buildRouteBtn.addEventListener('click', async () => {
  const startQuery = startInput.value.trim();
  const endQuery = endInput.value.trim();
  if (!startQuery || !endQuery) {
    setStatus('Bitte Start und Ziel angeben.', true);
    return;
  }

  const routeName = `${startQuery} → ${endQuery}`;
  const existing = routes.find(r => r.source === 'generated' && r.name.toLowerCase() === routeName.toLowerCase());
  if (existing) {
    selectRoute(existing.id);
    setStatus('Diese Route ist schon in der Liste (unten ausgewählt).', false);
    return;
  }

  buildRouteBtn.disabled = true;
  try {
    setStatus('Suche Orte…', false);
    const start = startOverride || await geocode(startQuery);
    const end = await geocode(endQuery);

    setStatus('Berechne Route…', false);
    const { points, durationSec } = await fetchRoute(start, end);

    const stats = analyzeRoute(points);
    stats.durationMin = durationSec / 60; // OSRM liefert eigene Fahrzeitschätzung

    const path = points
      .filter((_, i) => i % 2 === 0)
      .map(p => [Number(p.lat.toFixed(6)), Number(p.lon.toFixed(6))]);

    const route = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: routeName,
      path,
      stats,
      source: 'generated',
      addedAt: Date.now()
    };

    routes.push(route);
    drawRoute(route);
    saveRoutes();
    fitToAllRoutes();
    renderList();
    setStatus('Route hinzugefügt – aktuell die schnellste Verbindung, noch nicht kurvenoptimiert.', false);
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    buildRouteBtn.disabled = false;
  }
});

// --- Sortierung & Filter ---
document.getElementById('sort-row').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  sortMode = btn.dataset.sort;
  renderList();
});

document.getElementById('min-curves').addEventListener('input', (e) => {
  minCurves = Number(e.target.value) || 0;
  renderList();
});

function sortedFilteredRoutes() {
  const filtered = routes.filter(r => r.stats.curveCount >= minCurves);
  const sorters = {
    curviness: (a, b) => b.stats.curviness - a.stats.curviness,
    curves: (a, b) => b.stats.curveCount - a.stats.curveCount,
    duration: (a, b) => (a.stats.durationMin ?? Infinity) - (b.stats.durationMin ?? Infinity),
    distance: (a, b) => a.stats.distanceKm - b.stats.distanceKm
  };
  return filtered.sort(sorters[sortMode]);
}

// --- Liste rendern ---
const listEl = document.getElementById('route-list');
const emptyEl = document.getElementById('empty-state');

function renderList() {
  const items = sortedFilteredRoutes();
  listEl.innerHTML = '';
  emptyEl.style.display = routes.length === 0 ? 'block' : 'none';

  items.forEach(route => {
    const li = document.createElement('li');
    li.className = 'route-row' + (route.id === selectedId ? ' selected' : '');

    const bar = document.createElement('div');
    bar.className = 'curve-bar';
    bar.style.background = curvinessColor(route.stats.curviness);

    const info = document.createElement('div');
    info.className = 'route-info';
    info.innerHTML = `
      <p class="route-name">${escapeHtml(route.name)}</p>
      <div class="route-stats">
        <span class="stat"><span class="stat-value">${route.stats.distanceKm.toFixed(0)}</span> km</span>
        <span class="stat"><span class="stat-value">${formatDuration(route.stats.durationMin)}</span></span>
        <span class="stat"><span class="stat-value">${route.stats.curveCount}</span> Kurven</span>
        <span class="stat"><span class="stat-value">${route.stats.curviness.toFixed(1)}</span> Kurven/km</span>
      </div>
    `;

    const del = document.createElement('button');
    del.className = 'route-delete';
    del.setAttribute('aria-label', 'Route löschen');
    del.textContent = '✕';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteRoute(route.id);
    });

    li.addEventListener('click', () => selectRoute(route.id));
    li.append(bar, info, del);
    listEl.appendChild(li);
  });
}

function deleteRoute(id) {
  routes = routes.filter(r => r.id !== id);
  const layer = routeLayers.get(id);
  if (layer) { map.removeLayer(layer); routeLayers.delete(id); }
  saveRoutes();
  renderList();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// --- Start ---
loadRoutes();
redrawAllRoutes();
fitToAllRoutes();
renderList();
