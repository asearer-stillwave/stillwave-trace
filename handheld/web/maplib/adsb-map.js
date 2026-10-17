// Stillwave Trace: offline live aircraft map for the ADS-B page.
// MapLibre GL + PMTiles (Protomaps basemap, OpenStreetMap data) served by this box; no internet needed.
import * as maplibregl from '/maplib/maplibre-gl.mjs';

const LAX = [-118.4081, 33.9425];
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

function basemapLayers(source, zoomPart) {
  const flavor = Object.assign({}, window.basemaps.namedFlavor('dark'), FIELDNOTE);
  const out = [];
  for (const l of window.basemaps.layers(source, flavor, { lang: 'en' })) {
    if (DROP.has(l.id)) continue;
    if (zoomPart === 'core' && l.id === 'background') continue;
    const L = Object.assign({}, l, { id: source + ':' + l.id });
    if (l.id === 'pois') L.filter = ['all', l.filter, ['==', ['get', 'kind'], 'aerodrome']];  // only airports
    if (l.id === 'roads_runway') L.paint = Object.assign({}, l.paint, {
      'line-color': FIELDNOTE.runway, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 8, 0.8, 11, 2.5, 14, 12, 17, 40] });
    if (zoomPart === 'outer' && l.type === 'symbol') L.maxzoom = 12;    // core takes over labels at 12+
    if (zoomPart === 'core') L.minzoom = Math.max(12, l.minzoom || 0);
    out.push(L);
  }
  return out;
}

function pmtilesStyle(url, manifest) {
  const abs = location.origin + url + '/{z}/{x}/{y}';
  const core = (manifest && manifest.bbox_core) || [-118.75, 33.55, -117.90, 34.30];
  // 1.2.1: on the kiosk the credit is plain text (tapping the link navigated the kiosk away and blanked the page);
  // browsers on other devices keep the links
  const kioskPage = document.documentElement.classList.contains('kiosk');
  const att = kioskPage ? '© OpenStreetMap contributors · Protomaps'
    : '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> · <a href="https://protomaps.com">Protomaps</a>';
  return {
    version: 8,
    glyphs: location.origin + '/maplib/fonts/{fontstack}/{range}.pbf',
    sprite: location.origin + '/maplib/sprites/dark',
    sources: {
      // one file: the SoCal overview (zoom 0-11, overzoomed outside the LA core) ...
      pmo: { type: 'vector', tiles: ['pmtiles://' + abs], minzoom: 0, maxzoom: 11, attribution: att },
      // ... and the LA basin detail (zoom 12-14)
      pmc: { type: 'vector', tiles: ['pmtiles://' + abs], minzoom: 12, maxzoom: 14, bounds: core },
    },
    layers: [...basemapLayers('pmo', 'outer'), ...basemapLayers('pmc', 'core')],
  };
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

// ---------- plane icons (one per altitude band, drawn once) ----------
function planeImage(fill, alpha = 1) {
  const s = 96, c = document.createElement('canvas'); c.width = c.height = s;
  const g = c.getContext('2d');
  g.translate(s / 2, s / 2); g.scale(s / 64, s / 64);
  g.beginPath();  // nose up (north); MapLibre rotates by track
  g.moveTo(0, -28); g.bezierCurveTo(3, -28, 4, -22, 4, -16); g.lineTo(4, -6); g.lineTo(26, 6); g.lineTo(26, 11);
  g.lineTo(4, 5); g.lineTo(3, 18); g.lineTo(10, 23); g.lineTo(10, 27); g.lineTo(0, 24); g.lineTo(-10, 27); g.lineTo(-10, 23);
  g.lineTo(-3, 18); g.lineTo(-4, 5); g.lineTo(-26, 11); g.lineTo(-26, 6); g.lineTo(-4, -6); g.lineTo(-4, -16);
  g.bezierCurveTo(-4, -22, -3, -28, 0, -28); g.closePath();
  g.lineJoin = 'round'; g.lineWidth = 5; g.strokeStyle = '#060908'; g.stroke();
  g.globalAlpha = alpha; g.fillStyle = fill; g.fill();
  return g.getImageData(0, 0, s, s);
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

// ---------- the map ----------
export class AircraftMap {
  constructor(el, opts) {
    this.el = el; this.opts = opts || {};
    this.planes = new Map();      // hex -> {a, trail: [[lon, lat, t]], px}
    this.selected = null; this.follow = false; this.labels = true; this.rings = true;
    this.ringOpts = Object.assign({ count: 3, spacing: 'auto' }, opts && opts.rings || {});   // 1.0.4
    this.receiver = opts.receiver || { lat: LAX[1], lon: LAX[0], default: true };
    this.pending = false; this.ready = false;
  }

  async start(mapInfo) {
    const proto = new window.pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', proto.tile);
    const detailed = mapInfo && mapInfo.installed;
    const style = detailed ? pmtilesStyle(mapInfo.url, mapInfo.manifest) : fallbackStyle(mapInfo ? mapInfo.fallback : '/maplib/fallback/la-lowzoom.geojson');
    this.detailed = detailed;
    const m = this.map = new maplibregl.Map({
      container: this.el, style, center: LAX, zoom: (this.defaultZoom = this.el.clientWidth < 500 ? 8.9 : 9.4), minZoom: 6, maxZoom: 15.5,
      maxBounds: [[-121.5, 32.3], [-115.5, 35.8]], attributionControl: false,
      dragRotate: false, pitchWithRotate: false, touchPitch: false, maxPitch: 0,
      fadeDuration: 0, antialias: false, renderWorldCopies: false,
      // 1.0.7 zoom-lag fix: no per-frame extras (tile resource timing, expired-tile refresh, >1x canvas on big screens)
      refreshExpiredTiles: false, collectResourceTiming: false, pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    });
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new maplibregl.AttributionControl({ compact: false }), 'bottom-left');
    m.addControl(new maplibregl.ScaleControl({ unit: 'nautical', maxWidth: 90 }), 'bottom-right');
    await new Promise(res => m.once('load', res));
    ALT_COLORS.forEach((col, i) => m.addImage('plane-' + i, planeImage(col, i === 8 ? 0.6 : 1), { pixelRatio: 2 }));
    const iconSize = touch ? 0.78 : 0.62;

    m.addSource('rings', { type: 'geojson', data: fc([]), maxzoom: 12, buffer: 32, tolerance: 0.5 });
    m.addSource('rcv', { type: 'geojson', data: fc([]), maxzoom: 12, buffer: 32, tolerance: 0.5 });
    m.addSource('lax', { type: 'geojson', data: fc([{ type: 'Feature', properties: { label: 'LAX' }, geometry: { type: 'Point', coordinates: LAX } }]) });
    m.addSource('trails', { type: 'geojson', data: fc([]), maxzoom: 12, buffer: 32, tolerance: 0.5 });
    m.addSource('ac', { type: 'geojson', data: fc([]), maxzoom: 12, buffer: 32, tolerance: 0.5 });
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
    m.addLayer({ id: 'ac-sel', type: 'circle', source: 'ac', filter: ['==', ['get', 'sel'], 1],
      paint: { 'circle-radius': touch ? 24 : 20, 'circle-color': 'rgba(74,222,128,0.14)', 'circle-stroke-color': '#4ade80', 'circle-stroke-width': 2 } });
    m.addLayer({ id: 'ac', type: 'symbol', source: 'ac',
      layout: { 'icon-image': ['concat', 'plane-', ['get', 'band']], 'icon-size': iconSize, 'icon-rotate': ['get', 'rot'],
        'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'sel'] },
      paint: { 'icon-opacity': ['get', 'op'] } });
    m.addLayer({ id: 'ac-label', type: 'symbol', source: 'ac',
      layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Medium'], 'text-size': 15,
        'text-anchor': 'top', 'text-offset': [0, touch ? 1.5 : 1.3], 'text-line-height': 1.15, 'text-optional': true,
        'symbol-sort-key': ['-', 0, ['get', 'sel']] },
      paint: { 'text-color': '#e6efe8', 'text-halo-color': '#0b0f0c', 'text-halo-width': 1.6, 'text-opacity': ['get', 'op'] } });

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
    this.map.setLayoutProperty('ac-label', 'visibility', this.labels ? 'visible' : 'none');
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
    if (!hits.length) { if (this.selected) this.select(null); return; }
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
      pts.push({ type: 'Feature', properties: { hex, band, sel, op, rot: typeof a.track === 'number' ? a.track : 0,
        label: (a.flight || hex.toUpperCase()) + (second ? '\n' + second : '') }, geometry: { type: 'Point', coordinates: [a.lon, a.lat] } });
      if (p.trail.length > 1) lines.push({ type: 'Feature', properties: { col: ALT_COLORS[band], op },
        geometry: { type: 'LineString', coordinates: p.trail.map(t => [t[0], t[1]]) } });
    }
    this.map.getSource('ac').setData(fc(pts));
    this.map.getSource('trails').setData(fc(lines));
  }
}
