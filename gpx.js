// Parst GPX-Text in { name, points: [{lat, lon, ele, time}] }
function parseGPX(xmlText, fallbackName) {
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error(`"${fallbackName}" ist keine gültige GPX-Datei.`);
  }

  const nameEl = doc.querySelector('trk > name') || doc.querySelector('metadata > name');
  const name = (nameEl && nameEl.textContent.trim()) || fallbackName.replace(/\.gpx$/i, '');

  const trkpts = Array.from(doc.querySelectorAll('trkpt'));
  const points = trkpts.map(pt => {
    const lat = parseFloat(pt.getAttribute('lat'));
    const lon = parseFloat(pt.getAttribute('lon'));
    const timeEl = pt.querySelector('time');
    const eleEl = pt.querySelector('ele');
    return {
      lat,
      lon,
      time: timeEl ? new Date(timeEl.textContent).getTime() : null,
      ele: eleEl ? parseFloat(eleEl.textContent) : null
    };
  }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (points.length < 2) {
    throw new Error(`"${fallbackName}" enthält zu wenige Trackpunkte.`);
  }

  return { name, points };
}
