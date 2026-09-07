// Geocoding + Routing auf Basis freier OSM-Dienste.
// Hinweis: OSRM-Demo-Server ist nur für geringes, persönliches Aufkommen gedacht,
// kein SLA. Für ernsthafte Nutzung später ggf. eigener Server nötig.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving';

async function geocode(query) {
  const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { 'Accept-Language': 'de' } });
  if (!res.ok) throw new Error('Geocoding fehlgeschlagen.');
  const data = await res.json();
  if (!data.length) throw new Error(`Ort "${query}" wurde nicht gefunden.`);
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), label: data[0].display_name };
}

function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Standortabfrage wird von diesem Browser nicht unterstützt.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: 'Aktueller Standort' }),
      err => reject(new Error('Standort konnte nicht ermittelt werden (' + err.message + ').')),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

// Liefert die schnellste Route (Auto-Profil) zwischen zwei Punkten.
// Kein Kurven-Gewicht möglich – reine Basis-Route, wird danach mit unserer
// eigenen Kurvenerkennung analysiert.
async function fetchRoute(start, end) {
  const url = `${OSRM_URL}/${start.lon},${start.lat};${end.lon},${end.lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Routenberechnung fehlgeschlagen.');
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes || !data.routes.length) {
    throw new Error('Keine Route zwischen Start und Ziel gefunden.');
  }
  const r = data.routes[0];
  const points = r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon, time: null }));
  return { points, durationSec: r.duration, distanceM: r.distance };
}
