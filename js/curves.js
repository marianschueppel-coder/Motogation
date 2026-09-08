// Geo-Hilfsfunktionen und Kurvenerkennung auf Basis von Richtungsänderungen (Bearing)

function toRad(deg) { return deg * Math.PI / 180; }
function toDeg(rad) { return rad * 180 / Math.PI; }

function haversineDistance(a, b) {
  const R = 6371000; // Meter
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function bearing(a, b) {
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// -180..180
function angleDiff(a, b) {
  let d = b - a;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

// Dünnt sehr dicht aufgezeichnete Punkte aus, damit GPS-Jitter (z.B. an Ampeln)
// nicht als Kurve gezählt wird.
function resample(points, minDist = 12) {
  if (points.length === 0) return [];
  const result = [points[0]];
  let last = points[0];
  for (let i = 1; i < points.length; i++) {
    if (haversineDistance(last, points[i]) >= minDist) {
      result.push(points[i]);
      last = points[i];
    }
  }
  if (result[result.length - 1] !== points[points.length - 1]) {
    result.push(points[points.length - 1]);
  }
  return result;
}

// Erkennt zusammenhängende Kurvensegmente: solange sich die Richtung kontinuierlich
// in dieselbe Richtung ändert, gilt das als eine Kurve. Erst ab einem kumulierten
// Winkel >= curveThreshold zählt es wirklich als Kurve (filtert normales Lenken
// auf leicht geschwungenen Straßen raus).
function detectCurves(points, { noiseThreshold = 3, curveThreshold = 20 } = {}) {
  const pts = resample(points);
  if (pts.length < 3) return [];

  const curves = [];
  let turnSum = 0;
  let dir = 0;
  let startIdx = null;

  const closeCurrent = (endIdx) => {
    if (startIdx !== null && Math.abs(turnSum) >= curveThreshold) {
      curves.push({ startIdx, endIdx, angle: turnSum });
    }
    startIdx = null;
    turnSum = 0;
    dir = 0;
  };

  for (let i = 1; i < pts.length - 1; i++) {
    const b1 = bearing(pts[i - 1], pts[i]);
    const b2 = bearing(pts[i], pts[i + 1]);
    const delta = angleDiff(b1, b2);

    if (Math.abs(delta) < noiseThreshold) {
      closeCurrent(i);
      continue;
    }

    const d = Math.sign(delta);
    if (dir !== 0 && d !== dir) {
      closeCurrent(i);
      startIdx = i;
      turnSum = delta;
      dir = d;
    } else {
      if (startIdx === null) startIdx = i;
      turnSum += delta;
      dir = d;
    }
  }
  closeCurrent(pts.length - 1);

  return curves;
}

function classifyCurve(angle) {
  const a = Math.abs(angle);
  if (a >= 90) return 'scharf';
  if (a >= 45) return 'mittel';
  return 'leicht';
}

function formatDuration(minutes) {
  if (!Number.isFinite(minutes)) return '–';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// Analysiert eine geparste Route und liefert alle Kennzahlen für Anzeige/Filter.
function analyzeRoute(points) {
  let distanceM = 0;
  for (let i = 1; i < points.length; i++) {
    distanceM += haversineDistance(points[i - 1], points[i]);
  }
  const distanceKm = distanceM / 1000;

  const hasTime = points[0].time != null && points[points.length - 1].time != null;
  const durationMin = hasTime
    ? (points[points.length - 1].time - points[0].time) / 60000
    : null;

  const curves = detectCurves(points);
  const curveCount = curves.length;
  const curviness = distanceKm > 0 ? curveCount / distanceKm : 0; // Kurven pro km

  const counts = { leicht: 0, mittel: 0, scharf: 0 };
  curves.forEach(c => counts[classifyCurve(c.angle)]++);

  return {
    distanceKm,
    durationMin,
    curveCount,
    curviness,
    curveBreakdown: counts,
    curves
  };
}
