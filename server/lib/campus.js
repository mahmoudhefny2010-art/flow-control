// Campus map model: MIU campus buildings, walking graph, services locations.
// Coordinates are in a 1000x640 viewBox used by the SVG map in the client.
const buildings = [
  { id: 'gate', name: 'Main Gate', x: 500, y: 590, type: 'gate' },
  { id: 'admin', name: 'Main Admin Building', x: 500, y: 470, type: 'academic' },
  { id: 'reg', name: 'Registration Hall', x: 330, y: 430, type: 'academic' },
  { id: 'library', name: 'Library', x: 670, y: 420, type: 'academic' },
  { id: 'it', name: 'IT Center', x: 180, y: 300, type: 'academic' },
  { id: 'student', name: 'Student Center', x: 500, y: 280, type: 'services' },
  { id: 'clinic', name: 'Medical Clinic', x: 800, y: 270, type: 'services' },
  { id: 'career', name: 'Career Center', x: 300, y: 150, type: 'services' },
  { id: 'sports', name: 'Sports Complex', x: 820, y: 120, type: 'sports' },
  { id: 'cafe', name: 'Cafeteria', x: 500, y: 110, type: 'services' },
  { id: 'parking', name: 'Parking', x: 120, y: 480, type: 'parking' },
];

// Walking edges (in viewBox units; 1 unit ~ 1.5 m)
const paths = [
  ['gate', 'admin'],
  ['gate', 'parking'],
  ['parking', 'it'],
  ['it', 'student'],
  ['admin', 'reg'],
  ['admin', 'library'],
  ['admin', 'student'],
  ['student', 'cafe'],
  ['student', 'career'],
  ['student', 'clinic'],
  ['reg', 'it'],
  ['library', 'clinic'],
  ['clinic', 'sports'],
  ['cafe', 'sports'],
  ['career', 'cafe'],
];

function distance(a, b) {
  const A = buildings.find((x) => x.id === a);
  const B = buildings.find((x) => x.id === b);
  if (!A || !B) return 0;
  const dx = A.x - B.x;
  const dy = A.y - B.y;
  return Math.round(Math.sqrt(dx * dx + dy * dy) * 1.5); // meters
}

function walkingMinutes(a, b) {
  // average walking speed 80 m/min
  return Math.max(1, Math.round(distance(a, b) / 80));
}

function neighbors(from) {
  return paths
    .filter((p) => p.includes(from))
    .map((p) => (p[0] === from ? p[1] : p[0]))
    .map((to) => ({ to, minutes: walkingMinutes(from, to), meters: distance(from, to) }));
}

// Shortest path (Dijkstra) between two buildings
function route(from, to) {
  const dist = {}; const prev = {}; const visited = new Set();
  buildings.forEach((b) => { dist[b.id] = Infinity; });
  dist[from] = 0;
  while (true) {
    let u = null; let best = Infinity;
    for (const b of buildings) {
      if (!visited.has(b.id) && dist[b.id] < best) { best = dist[b.id]; u = b.id; }
    }
    if (u === null) break;
    if (u === to) break;
    visited.add(u);
    for (const n of neighbors(u)) {
      const alt = dist[u] + n.meters;
      if (alt < dist[n.to]) { dist[n.to] = alt; prev[n.to] = u; }
    }
  }
  if (dist[to] === Infinity) return null;
  const path = [to];
  let cur = to;
  while (prev[cur]) { path.unshift(prev[cur]); cur = prev[cur]; }
  return {
    from, to,
    path,
    meters: dist[to],
    minutes: Math.max(1, Math.round(dist[to] / 80)),
  };
}

module.exports = { buildings, paths, distance, walkingMinutes, neighbors, route };
