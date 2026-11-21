// Stillwave Trace: offline live aircraft map for the ADS-B page.
// MapLibre GL + PMTiles (Protomaps basemap, OpenStreetMap data) served by this box; no internet needed.
import * as maplibregl from '/maplib/maplibre-gl.mjs';

const LAX = [-118.4081, 33.9425];
// 1.3.7: closest zoom = the LA basin view (city names, major roads). Was 15.5 (LA street level from the pmc layers).
export const MAX_ZOOM = 12;        // 1.3.8: the view can zoom two levels past 10 (approved preview)...
export const DATA_MAX_ZOOM = 10;   // ...but only zoom 10 map data is ever loaded: z11/z12 enlarge the z10 tiles (overzoom)
const TRAIL_SECS = 120, TRAIL_MAX = 150, STALE_FADE = 15, STALE_DROP = 60;
const NM = 1852;
const ALT_COLORS = ['#5f7a68', '#1c6b3c', '#26904f', '#33b866', '#4ade80', '#97f0b8', '#c8f8d9', '#f4fff7', '#6b6f6d']; // GND (grey-green) · <1k · 1-3k · 3-6k · 6-10k (Signal) · 10-20k · 20-30k · 30k+ (white) · unknown (neutral grey, drawn at 60%)
const touch = document.documentElement.classList.contains('kiosk') || matchMedia('(pointer: coarse)').matches;

export function webglOK() {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; }
}

// ---------- basemap style ----------
const FIELDNOTE = { // Protomaps "dark" flavor, Night Ops v2: near-black, neutral greys (color is kept for aircraft)
  background: '#0b0f0c', water: '#0b0f0c', earth: '#0f1712', aerodrome: '#151c18', runway: '#6b7771',
  park_a: '#111a14', park_b: '#111a14', wood_a: '#101813', wood_b: '#101813', scrub_a: '#111712', scrub_b: '#111712',
  industrial: '#121714', hospital: '#121714', school: '#121714', beach: '#161c18', sand: '#151b17', pedestrian: '#111612',
  minor_service: '#1a211d', minor_a: '#1e2621', minor_b: '#1a211d', other: '#1a211d', link: '#26302a', major: '#26302a',
  highway: '#333f38', bridges_highway: '#333f38', bridges_major: '#26302a', bridges_link: '#26302a', bridges_minor: '#1a211d',
  minor_casing: '#0f1411', major_casing_early: '#0f1411', major_casing_late: '#0f1411', highway_casing_early: '#0f1411',
  highway_casing_late: '#0f1411', link_casing: '#0f1411', minor_service_casing: '#0f1411', railway: '#1f2723', boundaries: '#1f4a2e',
  roads_label_minor: '#6f7a74', roads_label_minor_halo: '#0b0f0c', roads_label_major: '#8a958f', roads_label_major_halo: '#0b0f0c',
  city_label: '#c4cdc7', city_label_halo: '#0b0f0c', subplace_label: '#808b85', subplace_label_halo: '#0b0f0c',
  ocean_label: '#4f6b58', state_label: '#4d5852', state_label_halo: '#0b0f0c',
};
const DROP = new Set(['buildings', 'address_label', 'roads_oneway', 'roads_shields', 'landuse_hospital', 'landuse_school', 'landuse_zoo']);

// 1.3: canvas pixels per CSS pixel = device pixels x the UI zoom on <body> (Text size), so the map is never upscaled
// 1.3.1: aircraft icons stay at their Normal size at every Text size (only the labels grow): sizes are divided by the zoom
function uiZoom() { let z = 1; try { z = parseFloat(getComputedStyle(document.body).zoom) || 1; } catch (e) {} return Math.max(1, z); }
function mapPixelRatio() {
  let z = 1;
  try { z = parseFloat(getComputedStyle(document.body).zoom) || 1; } catch (e) {}
  return Math.min((window.devicePixelRatio || 1) * Math.max(1, z), 3);
}
function basemapLayers(source, zoomPart) {
  const flavor = Object.assign({}, window.basemaps.namedFlavor('dark'), FIELDNOTE);
  const out = [];
  for (const l of window.basemaps.layers(source, flavor, { lang: 'en' })) {
    if (DROP.has(l.id)) continue;
    if (zoomPart === 'pack' && l.id === 'background') continue;
    const L = Object.assign({}, l, { id: source + ':' + l.id });
    if (l.id === 'pois') L.filter = ['all', l.filter, ['==', ['get', 'kind'], 'aerodrome']];  // only airports
    if (l.id === 'roads_runway') L.paint = Object.assign({}, l.paint, {
      'line-color': FIELDNOTE.runway, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 8, 0.8, 11, 2.5, 14, 12, 17, 40] });
    out.push(L);
  }
  return out;
}

// 1.2.6: downloaded regions (sdr-content packs). Each pack is its own PMTiles source limited to its box and zoom range,
// drawn under the built-in LA layers (LA keeps its detail where the two overlap).
function packSources(packs) {
  const src = {}, layers = [];
  (packs || []).forEach((p, i) => {
    const id = 'pk' + i;
    // 1.3.7: the whole map stops at zoom 10, so packs are read up to zoom 10 at most (pack files are unchanged)
    const mx = Math.min(DATA_MAX_ZOOM, p.maxzoom || 14);
    src[id] = { type: 'vector', tiles: ['pmtiles://' + location.origin + p.url + '/{z}/{x}/{y}'], minzoom: Math.min(p.minzoom || 0, mx),
                maxzoom: mx, bounds: p.bbox };
    if (p.attribution) src[id].attribution = p.attribution;
    for (const l of basemapLayers(id, 'pack')) layers.push(l);
  });
  return { src, layers };
}

function pmtilesStyle(url, manifest, packs) {
  const abs = location.origin + url + '/{z}/{x}/{y}';
  // 1.2.1: on the kiosk the credit is plain text (tapping the link navigated the kiosk away and blanked the page);
  // browsers on other devices keep the links
  const kioskPage = document.documentElement.classList.contains('kiosk');
  const att = kioskPage ? '© OpenStreetMap contributors · Protomaps'
    : '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · <a href="https://protomaps.com">Protomaps</a>';
  const st = {
    version: 8,
    glyphs: location.origin + '/maplib/fonts/{fontstack}/{range}.pbf',
    sprite: location.origin + '/maplib/sprites/dark',
    sources: url ? {
      // the SoCal overview (zoom 0-11 in the file; the map stops at 10). 1.3.7: the LA street-level layers (pmc, zoom
      // 12-14 of the same file) are no longer drawn; la.pmtiles itself is unchanged.
      pmo: { type: 'vector', tiles: ['pmtiles://' + abs], minzoom: 0, maxzoom: DATA_MAX_ZOOM, attribution: att },
    } : {},
    // 1.3.5: no LA file but a pack (the USA street map) -> draw the packs alone (1.3.7: also capped at zoom 10)
    layers: url ? basemapLayers('pmo', 'outer') : [{ id: 'bg', type: 'background', paint: { 'background-color': '#0b0f0c' } }],
  };
  if (!url && packs && packs[0]) packs[0] = Object.assign({}, packs[0], { attribution: att });
  const pk = packSources(packs);
  if (pk.layers.length) {
    // interleave by basemap layer (all earth, then all water, ... roads, labels) so overlapping files merge cleanly:
    // a low-zoom tile in one file never paints over roads or labels from another
    Object.assign(st.sources, pk.src);
    const base = id => id.slice(id.indexOf(':') + 1), groups = new Map();
    for (const l of [...st.layers, ...pk.layers]) { const b = base(l.id); if (!groups.has(b)) groups.set(b, []); groups.get(b).push(l); }
    st.layers = [].concat(...groups.values());
  }
  return st;
}

function fallbackStyle(url) {
  return {
    version: 8,
    glyphs: location.origin + '/maplib/fonts/{fontstack}/{range}.pbf',
    sources: { fb: { type: 'geojson', data: url, attribution: '© OpenStreetMap contributors · Protomaps' } },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#0b0f0c' } },
      { id: 'land', type: 'fill', source: 'fb', filter: ['==', ['get', 'c'], 'land'], paint: { 'fill-color': '#0f1712' } },
      { id: 'aero', type: 'fill', source: 'fb', filter: ['==', ['get', 'c'], 'aerodrome'], paint: { 'fill-color': '#111c15' } },
      { id: 'hwy', type: 'line', source: 'fb', filter: ['==', ['get', 'c'], 'highway'], paint: { 'line-color': '#1f4a2e', 'line-width': 1.2 } },
      { id: 'rwy', type: 'line', source: 'fb', filter: ['==', ['get', 'c'], 'runway'], paint: { 'line-color': '#2f6b44', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1, 14, 10] } },
    ],
  };
}

// ---------- plane icons ----------
// 1.3.2: 8 type classes x 9 altitude bands. Silhouettes are Stillwave's own drawings (1.3.2 mockup), not tar1090's
// markers. Nose up (north); MapLibre rotates by track. The class comes from /api/adsb "cls" (aircraft_types.json via the
// sdr-aircraft-db type code, else the ADS-B emitter category).
export const PLANE_CLASSES = ['airliner', 'heavy', 'regional', 'bizjet', 'turboprop', 'light', 'heli', 'unknown'];
const PLANE_PATHS = {
  unknown: 'M0,-28 C3,-28 4,-22 4,-16 L4,-6 L26,6 L26,11 L4,5 L3,18 L10,23 L10,27 L0,24 L-10,27 L-10,23 L-3,18 L-4,5 L-26,11 L-26,6 L-4,-6 L-4,-16 C-4,-22 -3,-28 0,-28Z',
  airliner: 'M0,-28 C3,-27 3,-22 3,-14 L3,-4 L25,8 L25,12 L3,6 L2,18 L10,24 L10,27 L0,25 L-10,27 L-10,24 L-2,18 L-3,6 L-25,12 L-25,8 L-3,-4 L-3,-14 C-3,-22 -3,-27 0,-28Z',
  heavy: 'M0,-30 C5,-29 5,-22 5,-14 L5,-6 L30,8 L30,14 L5,6 L4,19 L13,25 L13,29 L0,26 L-13,29 L-13,25 L-4,19 L-5,6 L-30,14 L-30,8 L-5,-6 L-5,-14 C-5,-22 -5,-29 0,-30Z',
  regional: 'M0,-24 C2,-24 3,-19 3,-12 L3,-2 L20,4 L20,8 L3,5 L2,14 L3,16 L9,13 L9,17 L0,22 L-9,17 L-9,13 L-3,16 L-2,14 L-3,5 L-20,8 L-20,4 L-3,-2 L-3,-12 C-3,-19 -2,-24 0,-24Z',
  bizjet: 'M0,-22 C2,-22 2,-17 2,-10 L2,-1 L15,6 L15,9 L2,6 L2,14 L5,14 L5,10 L9,10 L8,20 L0,19 L-8,20 L-9,10 L-5,10 L-5,14 L-2,14 L-2,6 L-15,9 L-15,6 L-2,-1 L-2,-10 C-2,-17 -2,-22 0,-22Z',
  turboprop: 'M0,-24 C2,-24 3,-20 3,-14 L3,-6 L24,-5 L24,-1 L3,0 L2,15 L9,17 L9,21 L0,21 L-9,21 L-9,17 L-2,15 L-3,0 L-24,-1 L-24,-5 L-3,-6 L-3,-14 C-3,-20 -2,-24 0,-24Z',
  light: 'M0,-20 C2,-20 2,-16 2,-12 L20,-11 L20,-6 L2,-5 L1,12 L7,13 L7,16 L0,16 L-7,16 L-7,13 L-1,12 L-2,-5 L-20,-6 L-20,-11 L-2,-12 C-2,-16 -2,-20 0,-20Z',
  heli: 'M0,-14 C6,-14 7,-8 7,-2 C7,5 3,8 1,9 L1,24 L6,24 L6,27 L-6,27 L-6,24 L-1,24 L-1,9 C-3,8 -7,5 -7,-2 C-7,-8 -6,-14 0,-14Z',
};
const PLANE_LINES = { airliner: 'M9,4 l0,5 M-9,4 l0,5', turboprop: 'M10,-12 l0,8 M-10,-12 l0,8 M7,-12 l6,0 M-7,-12 l-6,0', light: 'M-6,-21 l12,0' };
const ROTOR = 'M-22,-17 L22,17 M22,-17 L-22,17';
function planeImage(fill, alpha = 1, cls = 'unknown') {
  const s = 96, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.translate(s / 2, s / 2); g.scale(s / 64, s / 64);
  const body = new Path2D(PLANE_PATHS[cls] || PLANE_PATHS.unknown);
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (cls === 'heli') {   // rotor first (under the body), LIGHT so it reads on the dark map (mockup rotor was too dark)
    const r = new Path2D(ROTOR);
    g.lineWidth = 6; g.strokeStyle = '#060908'; g.stroke(r);
    g.globalAlpha = alpha; g.lineWidth = 2.6; g.strokeStyle = '#d7e3dc'; g.stroke(r); g.globalAlpha = 1;
  }
  g.lineWidth = 5; g.strokeStyle = '#060908'; g.stroke(body);
  g.globalAlpha = alpha; g.fillStyle = fill; g.fill(body);
  if (PLANE_LINES[cls]) { const l = new Path2D(PLANE_LINES[cls]); g.lineWidth = 1.6; g.strokeStyle = '#060908'; g.stroke(l); }
  return g.getImageData(0, 0, s, s);
}

// 1.3.2 AIS boat icons (option B): top-down hull rotated by heading (else course), colored by type; moving boats
// (sog > 0.5 kt) get a short wake behind and a dashed heading tick; stopped boats are the hull only.
const HULL = 'M0,-13 C4,-8 5,-3 5,4 L4,11 L-4,11 L-5,4 C-5,-3 -4,-8 0,-13Z';
function boatImage(fill, moving) {
  const s = 96, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.translate(s / 2, s / 2); g.scale(s / 68 * 1.45, s / 68 * 1.45);
  g.lineCap = 'round'; g.lineJoin = 'round';
  if (moving) {
    g.globalAlpha = 0.55; g.strokeStyle = '#e6efe8'; g.lineWidth = 1.6 / 1.45; g.stroke(new Path2D('M-3,12 L-7,22 M3,12 L7,22')); g.globalAlpha = 1;
    g.setLineDash([2, 2]); g.strokeStyle = fill; g.lineWidth = 2 / 1.45; g.stroke(new Path2D('M0,-14 L0,-21')); g.setLineDash([]);
  }
  const h = new Path2D(HULL);
  g.lineWidth = 2 / 1.45 * 1.4; g.strokeStyle = '#0b0f0c'; g.stroke(h);
  g.fillStyle = fill; g.fill(h);
  g.globalAlpha = 0.5; g.lineWidth = 1; g.stroke(new Path2D('M0,-6 L0,6'));
  return g.getImageData(0, 0, s, s);
}
export function boatRot(b) {   // AIS: heading 511 = not available; cog 360 = not available
  const h = Number(b.hdg), c = Number(b.cog);
  if (b.hdg != null && isFinite(h) && h >= 0 && h < 360) return h;
  if (b.cog != null && isFinite(c) && c >= 0 && c < 360) return c;
  return 0;
}

function altBand(a) {   // 8 bands, ground first; 8 = unknown
  if (a.alt === 'ground') return 0;
  const v = typeof a.alt === 'number' ? a.alt : null;
  if (v === null) return 8;
  return v < 1000 ? 1 : v < 3000 ? 2 : v < 6000 ? 3 : v < 10000 ? 4 : v < 20000 ? 5 : v < 30000 ? 6 : 7;
}

// ---------- geometry helpers ----------
function dest(lon, lat, bearingDeg, meters) {
  const R = 6371008.8, d = meters / R, b = bearingDeg * Math.PI / 180, p1 = lat * Math.PI / 180, l1 = lon * Math.PI / 180;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [l2 * 180 / Math.PI, p2 * 180 / Math.PI];
}
// range rings scale with zoom on a "nice" ladder 0.5/1/2.5/5/10/25/50/100 nm, recomputed on zoomend
const RING_STEPS = [0.5, 1, 2.5, 5, 10, 25, 50, 100];
// 1.0.4: user ring settings. count = 0/2/3/4/6 rings; spacing 'auto' or a base step (nm) at the default zoom.
// AUTO: the smallest ladder step that lets `count` rings reach ~60% of the half-view or more (fewer, wider rings than 1.0.3).
// Fixed base: the step at the default zoom, rescaled by zoom and snapped to the same ladder (log-nearest).
function nmHalfView(map) {
  const c = map.getCenter(), p = map.project(c), q = map.unproject([p.x + 100, p.y]);
  const el = map.getContainer();
  return Math.min(el.clientWidth, el.clientHeight) / 2 * (c.distanceTo(q) / 100 / NM);
}
function ringStepFor(map, count, spacing, z0) {
  if (spacing === 'auto') return RING_STEPS.find(s => s * count >= nmHalfView(map) * 0.6) || RING_STEPS[RING_STEPS.length - 1];
  const want = +spacing * Math.pow(2, z0 - map.getZoom());
  return RING_STEPS.reduce((b, s) => Math.abs(Math.log(s / want)) < Math.abs(Math.log(b / want)) ? s : b);
}
function ringsGeo(lon, lat, step, n) {
  const feats = [];
  for (let k = 1; k <= n; k++) {
    const nm = +(k * step).toFixed(1), ring = [];
    for (let i = 0; i <= 96; i++) ring.push(dest(lon, lat, i * 3.75, nm * NM));
    feats.push({ type: 'Feature', properties: { nm }, geometry: { type: 'LineString', coordinates: ring } });
    feats.push({ type: 'Feature', properties: { label: nm + ' NM' }, geometry: { type: 'Point', coordinates: dest(lon, lat, 30, nm * NM) } });
  }
  return { type: 'FeatureCollection', features: feats };
}
const fc = features => ({ type: 'FeatureCollection', features });

// 1.3.1 AIS hull colors by ship type (blue-ish so boats never read as an altitude band)
export const BOAT_COLORS = { cargo: '#60a5fa', tanker: '#f87171', passenger: '#c084fc', fishing: '#fbbf24', tug: '#fb923c', sail: '#e6efe8', other: '#7dd3fc' };
export function trimName(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

// ---------- the map ----------
export class AircraftMap {
  constructor(el, opts) {
    this.el = el; this.opts = opts || {};
    this.planes = new Map();      // hex -> {a, trail: [[lon, lat, t]], px}
    this.selected = null; this.follow = false; this.labels = true; this.rings = true; this.boats = new Map(); this.boatSel = null; this.show = 'all';
    this.ringOpts = Object.assign({ count: 3, spacing: 'auto' }, opts && opts.rings || {});   // 1.0.4
    this.receiver = opts.receiver || { lat: LAX[1], lon: LAX[0], default: true };
    this.pending = false; this.ready = false;
  }

  async start(mapInfo) {
    const proto = new window.pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', proto.tile);
    const packs = (mapInfo && mapInfo.packs) || [];
    const detailed = mapInfo && (mapInfo.installed || packs.length > 0);   // 1.3.5: the USA map alone is a full street map

    const style = detailed ? pmtilesStyle(mapInfo.installed ? mapInfo.url : null, mapInfo.manifest, packs) : fallbackStyle(mapInfo ? mapInfo.fallback : '/maplib/fallback/la-lowzoom.geojson');
    // 1.2.6: the pan limit grows to cover every downloaded region (LA box only when there are none)
    let bounds = [[-121.5, 32.3], [-115.5, 35.8]];
    for (const p of packs) {
      const b = p.bbox, pad = 1.5;
      bounds = [[Math.max(-180, Math.min(bounds[0][0], b[0] - pad)), Math.max(-85, Math.min(bounds[0][1], b[1] - pad))],
                [Math.min(180, Math.max(bounds[1][0], b[2] + pad)), Math.min(85, Math.max(bounds[1][1], b[3] + pad))]];
    }
    const wide = packs.some(p => (p.bbox[2] - p.bbox[0]) > 20);
    this.detailed = detailed;
    const m = this.map = new maplibregl.Map({
      container: this.el, style, center: LAX, zoom: (this.defaultZoom = this.el.clientWidth < 500 ? 8.9 : 9.4), minZoom: wide ? 2 : (packs.length ? 4 : 6), maxZoom: MAX_ZOOM,
      maxBounds: bounds, attributionControl: false,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0,
      fadeDuration: 0, antialias: false, renderWorldCopies: false,
      // 1.0.7 zoom-lag fix: no per-frame extras (tile resource timing, expired-tile refresh, >1x canvas on big screens)
      refreshExpiredTiles: false, collectResourceTiming: false, pixelRatio: mapPixelRatio(),
    });
    // 1.3: Large / XL text zooms <body> (CSS zoom); draw the map at the real screen density so it stays sharp, and follow
    // text size changes (nav.js fires resize).
    window.addEventListener('resize', () => { try { const r = mapPixelRatio(); if (Math.abs(r - m.getPixelRatio()) > 0.01) m.setPixelRatio(r); } catch (e) {} });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-left');
    m.addControl(new maplibregl.ScaleControl({ unit: 'nautical', maxWidth: 90 }), 'bottom-right');
    await new Promise(res => m.once('load', res));
    for (const cls of PLANE_CLASSES) ALT_COLORS.forEach((col, i) => m.addImage('plane-' + cls + '-' + i, planeImage(col, i === 8 ? 0.6 : 1, cls), { pixelRatio: 2 }));
    for (const [k, col] of Object.entries(BOAT_COLORS)) { m.addImage('boat-' + k + '-0', boatImage(col, false), { pixelRatio: 2 }); m.addImage('boat-' + k + '-1', boatImage(col, true), { pixelRatio: 2 }); }
    const iconBase = touch ? 0.78 : 0.62, selBase = touch ? 24 : 20, offBase = touch ? 1.5 : 1.3;
    const iconSize = iconBase / uiZoom();

    m.addSource('rings', { type: 'geojson', data: fc([]), maxzoom: 12, buffer: 32, tolerance: 0.5 });
    m.addSource('rcv', { type: 'geojson', data: fc([]), maxzoom: 12, buffer: 32, tolerance: 0.5 });
    m.addSource('lax', { type: 'geojson', data: fc([{ type: 'Feature', properties: { label: 'LAX' }, geometry: { type: 'Point', coordinates: LAX } }]) });
    m.addSource('trails', { type: 'geojson', data: fc([]), maxzoom: 12, buffer: 32, tolerance: 0.5 });
    m.addSource('ac', { type: 'geojson', data: fc([]), maxzoom: 12, buffer: 32, tolerance: 0.5 });
    // 1.3.1 AIS boats (own source; drawn under the aircraft)
    m.addSource('boats', { type: 'geojson', data: fc([]), maxzoom: 12, buffer: 32, tolerance: 0.5 });
    m.addLayer({ id: 'rings', type: 'line', source: 'rings', filter: ['has', 'nm'],
      paint: { 'line-color': '#4ade80', 'line-opacity': 0.3, 'line-width': 1.2, 'line-dasharray': [3, 4] } });
    m.addLayer({ id: 'ring-labels', type: 'symbol', source: 'rings', filter: ['has', 'label'],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': 13, 'text-letter-spacing': 0.12, 'text-offset': [0.4, -0.6], 'text-anchor': 'left', 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': '#a3b5a9', 'text-halo-color': '#0b0f0c', 'text-halo-width': 1.5 } });
    m.addLayer({ id: 'lax', type: 'symbol', source: 'lax', minzoom: 7.5,
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': 17,
        'text-letter-spacing': 0.15, 'text-allow-overlap': true, 'text-offset': [0, -1.4] },
      paint: { 'text-color': '#e6efe8', 'text-halo-color': '#0b0f0c', 'text-halo-width': 2 } });
    m.addLayer({ id: 'rcv', type: 'circle', source: 'rcv',
      paint: { 'circle-radius': 6, 'circle-color': '#0b0f0c', 'circle-stroke-color': '#4ade80', 'circle-stroke-width': 3 } });
    m.addLayer({ id: 'trails', type: 'line', source: 'trails', layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'col'], 'line-width': touch ? 2.4 : 2, 'line-opacity': ['*', 0.6, ['get', 'op']] } });
    // 1.3.2: selection ring (circle) + hull symbol; both keep the Normal size at Large/XL (divided by the UI zoom)
    m.addLayer({ id: 'boat-sel', type: 'circle', source: 'boats', filter: ['==', ['get', 'sel'], 1],
      paint: { 'circle-radius': (touch ? 19 : 16) / uiZoom(), 'circle-color': 'rgba(230,239,232,0.12)', 'circle-stroke-color': '#e6efe8', 'circle-stroke-width': 2, 'circle-opacity': ['get', 'op'], 'circle-stroke-opacity': ['get', 'op'] } });
    m.addLayer({ id: 'boat', type: 'symbol', source: 'boats',
      layout: { 'icon-image': ['concat', 'boat-', ['get', 'kind'], '-', ['get', 'mv']], 'icon-size': (touch ? 0.62 : 0.52) / uiZoom(), 'icon-rotate': ['get', 'rot'],
        'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'symbol-sort-key': ['get', 'sel'] },
      paint: { 'icon-opacity': ['get', 'op'] } });
    m.addLayer({ id: 'boat-label', type: 'symbol', source: 'boats',
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': 13, 'text-anchor': 'top',
        'text-offset': [0, (touch ? 1.5 : 1.3) / uiZoom()], 'text-optional': true },
      paint: { 'text-color': '#cfe3ff', 'text-halo-color': '#0b0f0c', 'text-halo-width': 1.5, 'text-opacity': ['get', 'op'] } });
    m.addLayer({ id: 'ac-sel', type: 'circle', source: 'ac', filter: ['==', ['get', 'sel'], 1],
      paint: { 'circle-radius': selBase / uiZoom(), 'circle-color': 'rgba(74,222,128,0.14)', 'circle-stroke-color': '#4ade80', 'circle-stroke-width': 2 } });
    m.addLayer({ id: 'ac', type: 'symbol', source: 'ac',
      layout: { 'icon-image': ['concat', 'plane-', ['get', 'cls'], '-', ['get', 'band']], 'icon-size': iconSize, 'icon-rotate': ['get', 'rot'],
        'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'sel'] },
      paint: { 'icon-opacity': ['get', 'op'] } });
    m.addLayer({ id: 'ac-label', type: 'symbol', source: 'ac',
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': 15,
        'text-anchor': 'top', 'text-offset': [0, offBase / uiZoom()], 'text-line-height': 1.15, 'text-optional': true,
        'symbol-sort-key': ['-', 0, ['get', 'sel']] },
      paint: { 'text-color': '#e6efe8', 'text-halo-color': '#0b0f0c', 'text-halo-width': 1.6, 'text-opacity': ['get', 'op'] } });

    // follow Text size changes (nav.js fires resize): icons back to Normal size, label gap to match
    window.addEventListener('resize', () => { try { const z = uiZoom();
      m.setLayoutProperty('ac', 'icon-size', iconBase / z); m.setPaintProperty('ac-sel', 'circle-radius', selBase / z);
      m.setLayoutProperty('ac-label', 'text-offset', [0, offBase / z]); if (this.onZoomUi) this.onZoomUi(z); } catch (e) {} });
    m.on('click', e => this._tap(e));
    m.on('dragstart', () => { if (this.follow) { this.follow = false; this.opts.onFollow && this.opts.onFollow(false); } });
    // 1.0.7 zoom-lag fix: while the map moves (pinch / wheel / ease) aircraft and ring data are NOT re-sent every
    // second (each setData re-tiles the source in the worker and re-places every label mid-gesture). Updates are
    // held and applied once in the next animation frame after the move ends; rings are recomputed on zoomend only.
    // Same layers, same paint: the look (glow, colors, labels) is unchanged.
    this.moving = false;
    m.on('movestart', e => { this.moving = true; this.userMove = !!(e && e.originalEvent); });
    m.on('moveend', () => { this.moving = false; this.userMove = false; if (this.dirty) { this.dirty = false; this._schedule(); } });
    this.ready = true;
    m.on('zoomend', () => { if (this.ringRaf) return; this.ringRaf = requestAnimationFrame(() => { this.ringRaf = 0; this.updateRings(); }); });
    this.setRings();
    this.setShow(this.show);
    this.setReceiver(this.receiver);
    this._schedule();
    return this;
  }

  setReceiver(r) {
    if (r && typeof r.lat === 'number' && typeof r.lon === 'number') this.receiver = r;
    if (!this.ready) return;
    const { lon, lat } = this.receiver;
    this.updateRings();
    this.map.getSource('rcv').setData(fc([{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }]));
  }
  updateRings() {
    if (!this.ready || !this.receiver) return;
    const m = this.map, { lon, lat } = this.receiver, { count, spacing } = this.ringOpts;
    const step = count ? ringStepFor(m, count, spacing, this.defaultZoom) : 0;
    this.ringStepNm = step;
    m.getSource('rings').setData(ringsGeo(lon, lat, step, count));
  }
  setRings(o) {   // 1.0.4: { count, spacing }; count 0 hides the rings
    Object.assign(this.ringOpts, o || {});
    this.rings = this.ringOpts.count > 0;
    if (this.ready) { for (const id of ['rings', 'ring-labels']) this.map.setLayoutProperty(id, 'visibility', this.rings ? 'visible' : 'none'); this.updateRings(); }
    return this.ringOpts;
  }
  toggleRings(on) {
    this.rings = on === undefined ? !this.rings : on;
    for (const id of ['rings', 'ring-labels']) this.map.setLayoutProperty(id, 'visibility', this.rings ? 'visible' : 'none');
    return this.rings;
  }
  toggleLabels(on) {
    this.labels = on === undefined ? !this.labels : on;
    for (const id of ['ac-label', 'boat-label']) this.map.setLayoutProperty(id, 'visibility', this.labels && (id !== 'boat-label' || this.show !== 'aircraft') && (id !== 'ac-label' || this.show !== 'boats') ? 'visible' : 'none');
    return this.labels;
  }
  centerLAX() { this.follow = false; this.map.easeTo({ center: LAX, zoom: Math.max(this.map.getZoom(), 9.5), duration: 600 }); }
  centerReceiver() { this.follow = false; this.map.easeTo({ center: [this.receiver.lon, this.receiver.lat], duration: 600 }); }
  resize() { this.map && this.map.resize(); }

  _pad() {   // 1.0.8.1: keep the followed plane above the docked card
    const c = document.getElementById('acard'), box = this.map.getContainer().getBoundingClientRect();
    if (!c || c.classList.contains('hide')) return { top: 0, bottom: 0, left: 0, right: 0 };
    const r = c.getBoundingClientRect();
    return { top: 0, left: 0, right: 0, bottom: Math.max(0, Math.min(box.height * .6, box.bottom - r.top + 16)) };
  }
  select(hex) {
    this.selected = hex;
    if (!hex) { this.follow = false; this.map && this.map.easeTo({ padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 300 }); }
    this._schedule();
    this.opts.onSelect && this.opts.onSelect(hex ? this.planes.get(hex) : null);
  }
  setFollow(on) {
    this.follow = !!on && !!this.selected;
    const p = this.selected && this.planes.get(this.selected);
    if (this.follow && p && p.a.lat != null) this.map.easeTo({ center: [p.a.lon, p.a.lat], padding: this._pad(), duration: 500 });
    return this.follow;
  }

  _tap(e) {
    const r = touch ? 26 : 16;
    const hits = this.map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['ac'] });
    if (!hits.length) {
      const bh = this.show === 'aircraft' ? [] : this.map.queryRenderedFeatures([[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]], { layers: ['boat'] });
      if (bh.length) { if (this.selected) this.select(null); this.selectBoat(bh[0].properties.mmsi); return; }
      if (this.selected) this.select(null); if (this.boatSel) this.selectBoat(null); return;
    }
    if (this.boatSel) this.selectBoat(null);
    let best = hits[0], bd = Infinity;
    for (const h of hits) {
      const p = this.map.project(h.geometry.coordinates), d = (p.x - e.point.x) ** 2 + (p.y - e.point.y) ** 2;
      if (d < bd) { bd = d; best = h; }
    }
    this.select(best.properties.hex);
  }

  // Feed one /api/adsb response. Map updates are batched into one animation frame.
  update(list, nowMs) {
    const now = nowMs || Date.now(), seen = new Set();
    for (const a of list) {
      if (!a.hex) continue;
      seen.add(a.hex);
      let p = this.planes.get(a.hex);
      if (!p) { p = { a, trail: [] }; this.planes.set(a.hex, p); }
      p.a = a;
      const posAge = a.seen_pos != null ? a.seen_pos : a.seen;
      if (a.lat != null && a.lon != null && posAge <= STALE_DROP) {
        const last = p.trail[p.trail.length - 1];
        if (!last || Math.abs(last[0] - a.lon) > 1e-4 || Math.abs(last[1] - a.lat) > 1e-4) p.trail.push([a.lon, a.lat, now]);
      }
      while (p.trail.length && (now - p.trail[0][2] > TRAIL_SECS * 1000 || p.trail.length > TRAIL_MAX)) p.trail.shift();
    }
    for (const hex of [...this.planes.keys()]) if (!seen.has(hex)) this.planes.delete(hex);   // gone (>60 s)
    if (this.selected && !this.planes.has(this.selected)) this.select(null);
    else if (this.selected) this.opts.onSelect && this.opts.onSelect(this.planes.get(this.selected));
    if (this.follow && this.selected && !this.userMove) {
      const a = this.planes.get(this.selected).a;
      if (a.lat != null) this.map.easeTo({ center: [a.lon, a.lat], padding: this._pad(), duration: 800 });
    }
    this._schedule();
  }

  // 1.3.1 AIS: feed /api/boats; show = 'all' | 'aircraft' | 'boats'
  updateBoats(list) {
    this.boats = new Map((list || []).map(b => [b.mmsi, b]));
    if (this.boatSel && !this.boats.has(this.boatSel)) this.selectBoat(null);
    else if (this.boatSel) this.opts.onBoat && this.opts.onBoat(this.boats.get(this.boatSel));
    if (this.ready) this._renderBoats();
  }
  selectBoat(mmsi) {
    this.boatSel = mmsi || null;
    if (this.ready) this._renderBoats();
    this.opts.onBoat && this.opts.onBoat(mmsi ? this.boats.get(mmsi) : null);
  }
  setShow(v) {
    this.show = ['all', 'aircraft', 'boats'].includes(v) ? v : 'all';
    if (!this.ready) return this.show;
    const air = this.show !== 'boats', sea = this.show !== 'aircraft';
    for (const id of ['ac', 'ac-sel', 'trails']) this.map.setLayoutProperty(id, 'visibility', air ? 'visible' : 'none');
    for (const id of ['boat', 'boat-sel']) this.map.setLayoutProperty(id, 'visibility', sea ? 'visible' : 'none');
    this.toggleLabels(this.labels);
    if (!air && this.selected) this.select(null);
    if (!sea && this.boatSel) this.selectBoat(null);
    return this.show;
  }
  _renderBoats() {
    const pts = [];
    for (const [mmsi, b] of this.boats || []) {
      const kind = BOAT_COLORS[b.kind] ? b.kind : 'other', sel = mmsi === this.boatSel ? 1 : 0;
      const mv = typeof b.sog === 'number' && b.sog > 0.5 && b.sog < 102 ? 1 : 0;
      pts.push({ type: 'Feature', properties: { mmsi, kind, mv, rot: boatRot(b), sel, op: b.op, label: trimName(b.name, 14) }, geometry: { type: 'Point', coordinates: [b.lon, b.lat] } });
    }
    this.map.getSource('boats').setData(fc(pts));
  }

  onMapCount() {
    let n = 0;
    for (const p of this.planes.values()) { const age = p.a.seen_pos != null ? p.a.seen_pos : p.a.seen; if (p.a.lat != null && age <= STALE_DROP) n++; }
    return n;
  }

  _schedule() {
    if (this.pending || !this.ready) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      if (this.moving && this.userMove) { this.dirty = true; return; }   // applied at moveend (zoom-lag fix)
      this._render();
    });
  }

  _render() {
    const pts = [], lines = [];
    for (const [hex, p] of this.planes) {
      const a = p.a, age = a.seen_pos != null ? a.seen_pos : a.seen;
      if (a.lat == null || a.lon == null || age > STALE_DROP) continue;
      const op = age <= STALE_FADE ? 1 : Math.max(0.25, 1 - (age - STALE_FADE) / (STALE_DROP - STALE_FADE) * 0.75);
      const band = altBand(a), sel = hex === this.selected ? 1 : 0;
      const alt = a.alt === 'ground' ? 'ground' : (typeof a.alt === 'number' ? a.alt.toLocaleString('en-US') + ' ft' : '');
      const spd = typeof a.gs === 'number' ? Math.round(a.gs) + ' kt' : '';
      const second = [alt, spd].filter(Boolean).join(' · ');
      const cls = PLANE_CLASSES.includes(a.cls) ? a.cls : 'unknown';
      pts.push({ type: 'Feature', properties: { hex, band, cls, sel, op, rot: typeof a.track === 'number' ? a.track : 0,
        label: (a.flight || hex.toUpperCase()) + (second ? '\n' + second : '') }, geometry: { type: 'Point', coordinates: [a.lon, a.lat] } });
      if (p.trail.length > 1) lines.push({ type: 'Feature', properties: { col: ALT_COLORS[band], op },
        geometry: { type: 'LineString', coordinates: p.trail.map(t => [t[0], t[1]]) } });
    }
    this.map.getSource('ac').setData(fc(pts));
    this.map.getSource('trails').setData(fc(lines));
  }
}
