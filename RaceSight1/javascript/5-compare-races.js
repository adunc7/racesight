// CSS.escape polyfill (small)
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  (function(global){
    const cssEscape = function(value){
     return String(value).replace(/([^\x00-\x7F]|[^a-zA-Z0-9_\-])/g, function(ch){
        const hex = ch.charCodeAt(0).toString(16);
        return '\\' + hex + ' ';
      });
    };
    if (typeof global.CSS === 'undefined') global.CSS = {};
    global.CSS.escape = cssEscape;
  })(window);
}



/* Shared helpers */
function parseNum(v){ if(v==null||v==='') return NaN; const n=+v; return isFinite(n)?n:NaN; }
function parseTimeToMs(v){ if(v==null) return null; if(typeof v==='string'){ const p = Date.parse(v); return isNaN(p)?null:p; } if(typeof v==='number') return v>1e11?Math.floor(v):Math.floor(v*1000); return null; }
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function findMatch(set, candidates){
  const arr = Array.from(set).map(s=>({orig:s,norm:String(s).toLowerCase().replace(/[_\s-]+/g,'')}));
  for(const c of candidates){ const t = c.toLowerCase().replace(/[_\s-]+/g,''); const f = arr.find(x=>x.norm===t); if(f) return f.orig; }
  for(const c of candidates){ const t = c.toLowerCase().replace(/[_\s-]+/g,''); const f = arr.find(x=>x.norm.includes(t)); if(f) return f.orig; }
  return null;
}
function nameToColor(name){
  let h = 0;
  for(let i=0;i<name.length;i++){ h = ((h<<5) - h) + name.charCodeAt(i); h |= 0; }
  const hue = (Math.abs(h) % 360);
  return `hsl(${hue},70%,45%)`;
}

/* Panel class updated to render variable boxes like dash.html */
function Panel(prefix){
  this.prefix = prefix;
  this.urlInput = document.getElementById(prefix + '_url');
  this.loadBtn = document.getElementById(prefix + '_load');
  this.timeFieldSel = document.getElementById(prefix + '_timeField');
  this.lapSelect = document.getElementById(prefix + '_lap');
  this.latNameSel = document.getElementById(prefix + '_lat');
  this.lonNameSel = document.getElementById(prefix + '_lon');
  this.mapEl = document.getElementById(prefix + '_map');
  this.playBtn = document.getElementById(prefix + '_play');
  this.resetBtn = document.getElementById(prefix + '_reset');
  // play rate selector (per-panel) and separate weather rate selector
  this.playRate = document.getElementById(prefix + '_rate');
  this.rateSel = document.getElementById(prefix + '_weatherRate');
  this.slider = document.getElementById(prefix + '_slider');
  this.timeVal = document.getElementById(prefix + '_status');
  this.timeDisplay = document.getElementById(prefix + '_status_time');
  this.gridEl = document.getElementById(prefix + '_grid');

  this.rawRows = [];
  this.maps = {};
  this.points = [];
  this.keysSorted = [];
  this.anim = {playing:false,startIdx:0,endIdx:0,currentIdx:0,rate:1,raf:null,lastTime:null,accum:0};

  try{
    this.map = L.map(this.mapEl, {attributionControl:false}).setView([0,0],2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(this.map);
    this.polyAll = L.polyline([], {color:'#888', weight:2, opacity:0.6}).addTo(this.map);
    this.polyTrace = L.polyline([], {color:getComputedStyle(document.documentElement).getPropertyValue('--accent')||'#1f77b4', weight:3}).addTo(this.map);
    this.marker = L.circleMarker([0,0],{radius:5,color:'#d4472a',fill:true,fillOpacity:1}).addTo(this.map);
  }catch(e){ this.map = null; }

  this.weatherGrid = document.getElementById(prefix + '_weatherGrid');
  this.weatherVars = ['AIR_TEMP','TRACK_TEMP','HUMIDITY','PRESSURE','WIND_SPEED','WIND_DIRECTION','RAIN','TIME_UTC_STR','TIME_UTC_SECONDS'];
  this.buildWeatherCells();

  this.loadBtn.addEventListener('click', ()=> this.loadUrl());
  this.playBtn.addEventListener('click', ()=> this.togglePlay());
  this.resetBtn.addEventListener('click', ()=> this.reset());
  this.slider.addEventListener('input', (e)=> { this.anim.currentIdx = +e.target.value; this.updateDisplayForIndex(this.anim.currentIdx); forwardSliderChange(this, +e.target.value); });
  if(this.playRate){ this.playRate.onchange = ()=> { try{ this.anim.rate = Number(this.playRate.value) || 1; }catch(e){} }; }
  [this.timeFieldSel, this.lapSelect, this.latNameSel, this.lonNameSel].forEach(el => el && (el.onchange = () => this.buildRouteAndMaps()));
}

Panel.prototype.buildWeatherCells = function(){
  if(!this.weatherGrid) return;
  this.weatherGrid.innerHTML = '';
  const timeDiv = document.createElement('div');
  timeDiv.className = 'box weatherTime';
  timeDiv.id = `${this.prefix}_weatherTime`;
  timeDiv.textContent = '—';
  this.weatherGrid.appendChild(timeDiv);

  for(const v of this.weatherVars){
    const c = document.createElement('div');
    c.className = 'box';
    c.dataset.var = v;
    const col = nameToColor(v);
    c.style.setProperty('--box-stripe', col);
    c.innerHTML = `<div class="name">${v}</div><div class="value" id="${this.prefix}_wv_${v}">—</div><div class="meta"></div>`;
    this.weatherGrid.appendChild(c);
  }
};

Panel.prototype.loadUrl = async function(){
  const url = (this.urlInput.value || '').trim();
  if(!url){ this.timeVal.textContent = 'Enter a JSON filename/URL.'; return; }
  try{
    const j = await fetch(url).then(r=>r.json());
    if(!Array.isArray(j)){ this.timeVal.textContent = 'JSON must be an array.'; return; }
    this.rawRows = j;
    this.timeVal.textContent = `Loaded ${j.length} rows.`;
    this.prepareUIFromRows();
    this.buildRouteAndMaps();
  }catch(e){
    console.error(e); this.timeVal.textContent = 'Failed to load JSON.';
  }
};

Panel.prototype.prepareUIFromRows = function(){
  const telemetry = new Set();
  const laps = new Set();
  const timeFields = new Set();
  this.rawRows.forEach(r=>{
    if(r.telemetry_name) telemetry.add(String(r.telemetry_name));
    if(r.name) telemetry.add(String(r.name));
    if(r.lap!==undefined && r.lap!==null) laps.add(String(r.lap));
    if(r.meta_time!==undefined) timeFields.add('meta_time');
    if(r.timestamp!==undefined) timeFields.add('timestamp');
    if(r.time!==undefined) timeFields.add('time');
  });
  const sortedLaps = Array.from(laps).sort((a,b)=>{ const na=Number(a), nb=Number(b); if(isFinite(na)&&isFinite(nb)) return na-nb; return String(a).localeCompare(b); });
  this.lapSelect.innerHTML = '<option value="All">All</option>' + sortedLaps.map(l=>`<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
  this.timeFieldSel.innerHTML = (Array.from(timeFields).length ? Array.from(timeFields).map(t=>`<option value="${t}">${t}</option>`).join('') : '<option value="meta_time">meta_time</option><option value="timestamp">timestamp</option>');
  const list = Array.from(telemetry).sort();
  // Prefer explicit VBOX fields for lat/lon when available; otherwise fall back to full telemetry list
  if(this.latNameSel){
    if(telemetry.has('VBOX_Lat_Min')){
      this.latNameSel.innerHTML = `<option value="VBOX_Lat_Min">VBOX_Lat_Min</option>`;
    } else {
      this.latNameSel.innerHTML = list.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    }
  }
  if(this.lonNameSel){
    if(telemetry.has('VBOX_Long_Minutes')){
      this.lonNameSel.innerHTML = `<option value="VBOX_Long_Minutes">VBOX_Long_Minutes</option>`;
    } else {
      this.lonNameSel.innerHTML = list.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    }
  }
};

Panel.prototype.renderBoxes = function(){
  if(!this.gridEl) return;
  this.gridEl.innerHTML = '';
  this.keysSorted = Object.keys(this.maps).sort((a,b)=> a.localeCompare(b, undefined, {sensitivity:'base', numeric:true}));
  this.keysSorted.forEach(name => {
    const box = document.createElement('div');
    box.className = 'box';
    box.dataset.name = name;
    const color = nameToColor(name);
    box.style.setProperty('--box-stripe', color);
    box.innerHTML = `<div class="name">${escapeHtml(name)}</div><div class="value" aria-live="polite"></div><div class="meta"></div>`;
    this.gridEl.appendChild(box);
  });
};

Panel.prototype.updateBoxesForTime = function(tMs){
  if(!this.keysSorted) return;
  this.keysSorted.forEach(name => {
    const box = this.gridEl.querySelector(`.box[data-name="${CSS.escape(name)}"]`);
    if(!box) return;
    const valEl = box.querySelector('.value');
    const metaEl = box.querySelector('.meta');
    if(tMs == null){
      valEl.textContent = '';
      metaEl.textContent = '';
      valEl.dataset.last = '';
      return;
    }
    const m = this.maps[name];
    const v = m ? m.get(tMs) : undefined;
    if(v === undefined || Number.isNaN(v)){
      if(valEl.dataset.last !== ''){
        valEl.textContent = '';
        valEl.dataset.last = '';
        metaEl.textContent = '';
      }
    } else {
      const display = (typeof v === 'number') ? (Number.isInteger(v) ? v : v.toFixed(3)) : String(v);
      if(String(valEl.dataset.last) !== String(display)){
        valEl.textContent = display;
        valEl.dataset.last = display;
        metaEl.textContent = new Date(tMs).toISOString();
        box.classList.add('updated');
        clearTimeout(box._t); box._t = setTimeout(()=> box.classList.remove('updated'), 350);
      }
    }
  });
};

Panel.prototype.buildRouteAndMaps = function(){
  this.maps = {};
  const selectedLap = (this.lapSelect.value === 'All') ? 'All' : this.lapSelect.value;
  this.rawRows.forEach(r=>{
    const lk = (r.lap !== undefined && r.lap !== null) ? String(r.lap) : 'all';
    if(selectedLap !== 'All' && lk !== selectedLap) return;
    const name = r.telemetry_name ?? r.name;
    if(!name) return;
    const tRaw = r[this.timeFieldSel.value] ?? r.meta_time ?? r.timestamp ?? r.time;
    const tMs = parseTimeToMs(tRaw);
    if(tMs==null) return;
    const valRaw = r.telemetry_value ?? r.value;
    const v = parseNum(valRaw);
    this.maps[name] = this.maps[name] || new Map();
    this.maps[name].set(tMs, v);
  });

  // render variable boxes for this panel
  this.renderBoxes();

  const latName = this.latNameSel.value;
  const lonName = this.lonNameSel.value;
  const latMap = this.maps[latName] || new Map();
  const lonMap = this.maps[lonName] || new Map();
  const commonTimes = Array.from(latMap.keys()).filter(t=>lonMap.has(t)).sort((a,b)=>a-b);
  this.points = commonTimes.map(t=>{ let lat = latMap.get(t), lon = lonMap.get(t); return {tMs:t, lat:lat, lon:lon}; });

  if(this.points.length===0){
    if(this.polyAll) this.polyAll.setLatLngs([]); if(this.polyTrace) this.polyTrace.setLatLngs([]); if(this.marker) this.marker.setLatLng([0,0]); if(this.map) this.map.setView([0,0],2);
    this.timeVal.textContent = 'No matched lat/lon points.';

  // update the shared/global grid (if present)
  if(typeof window.updateGlobalGrid === 'function') window.updateGlobalGrid();
    this.slider.min = 0; this.slider.max = 0; this.slider.value = 0;
    this.anim.startIdx = this.anim.endIdx = this.anim.currentIdx = 0;
    this.updateBoxesForTime(null);
    return;
  }

  const coords = this.points.map(p=>[p.lat,p.lon]);
  if(this.polyAll) this.polyAll.setLatLngs(coords);
  if(this.polyTrace) this.polyTrace.setLatLngs([]);
  if(this.marker) this.marker.setLatLng(coords[0]);
  if(this.map) this.map.fitBounds(this.polyAll.getBounds().pad(0.05));

  this.anim.startIdx = 0; this.anim.endIdx = this.points.length-1; this.anim.currentIdx = 0;
  this.slider.min = 0; this.slider.max = this.anim.endIdx; this.slider.step = 1; this.slider.value = 0;
  this.anim.accum = 0; this.anim.lastTime = null; this.anim.playing = false; this.playBtn.textContent = 'Play';
  this.updateDisplayForIndex(0);
  this.timeVal.textContent = `${this.points.length} points — lat:${latName} lon:${lonName}`;
};

Panel.prototype.updateDisplayForIndex = function(idx){
  if(!this.points || this.points.length===0) { this.updateBoxesForTime(null); return; }
  idx = Math.max(0, Math.min(this.points.length-1, idx));
  const p = this.points[idx];
  if(this.marker) this.marker.setLatLng([p.lat,p.lon]);
  if(this.polyTrace) this.polyTrace.setLatLngs(this.points.slice(0,idx+1).map(d=>[d.lat,d.lon]));
  this.slider.value = idx;
  if(this.timeDisplay) this.timeDisplay.textContent = new Date(p.tMs).toISOString();

  // update a few summary variables (optional)
  const steeringNames = ['Steering_Angle','steeringangle','steer_angle','steering'];
  const steeringKey = findMatch(Object.keys(this.maps), steeringNames);
  const apsKey = findMatch(Object.keys(this.maps), ['aps','APS','Throttle','Throttle_Pedal','throttle']);
  const speedKey = findMatch(Object.keys(this.maps), ['speed','Speed','vbox_speed','VBOX_Speed','VehicleSpeed','speed_kmh']);

  const ang = steeringKey ? (this.maps[steeringKey] ? this.maps[steeringKey].get(p.tMs) : null) : null;
  const apsv = apsKey ? (this.maps[apsKey] ? this.maps[apsKey].get(p.tMs) : null) : null;
  const sp = speedKey ? (this.maps[speedKey] ? this.maps[speedKey].get(p.tMs) : null) : null;

  // optional small summary inside panel status
  if(this.timeVal) this.timeVal.textContent = `t:${new Date(p.tMs).toISOString()}`;

  // update per-box values
  this.updateBoxesForTime(p.tMs);

  // update weather cells for this panel (prefer panel-specific weather, else global)
  const hasWeather = (this.weatherPoints && this.weatherPoints.length>0) || (window.weatherPoints && window.weatherPoints.length>0);
  if(hasWeather && p && p.tMs){
    const sec = Math.floor(p.tMs / 1000);
    updateWeatherForPanel(this, sec);
  }
};

Panel.prototype.togglePlay = function(){
  const was = this.anim.playing;
  if(was){
    this.anim.playing = false;
    this.playBtn.textContent = 'Play';
    if(this.anim.raf) cancelAnimationFrame(this.anim.raf);
    this.anim.raf = null;
  } else {
    if(this.anim.endIdx <= this.anim.startIdx) return;
    this.anim.playing = true;
    this.playBtn.textContent = 'Pause';
    this.anim.lastTime = null;
    this.anim.accum = 0;
  // prefer per-panel play rate selector if present
  try{ this.anim.rate = Number(this.playRate && this.playRate.value) || Number(this.rateSel && this.rateSel.value) || 1; }catch(e){ this.anim.rate = 1; }
    const step = (now) => {
      if(!this.anim.playing) return;
      if(this.anim.lastTime == null) this.anim.lastTime = now;
      const dt = now - this.anim.lastTime; this.anim.lastTime = now;
      this.anim.accum += (dt/1000) * this.anim.rate;
      const advance = Math.floor(this.anim.accum);
      if(advance >= 1){
        this.anim.currentIdx = Math.min(this.anim.endIdx, this.anim.currentIdx + advance);
        this.anim.accum -= advance;
        this.updateDisplayForIndex(this.anim.currentIdx);
        forwardPlayState(this, this.anim.playing);
      }
      if(this.anim.currentIdx >= this.anim.endIdx){ this.anim.playing = false; this.playBtn.textContent = 'Play'; return; }
      this.anim.raf = requestAnimationFrame(step);
    };
    this.anim.raf = requestAnimationFrame(step);
  }
  forwardPlayState(this, this.anim.playing);
};

Panel.prototype.reset = function(){
  this.anim.playing = false;
  if(this.anim.raf) cancelAnimationFrame(this.anim.raf);
  this.anim.raf = null;
  this.anim.currentIdx = this.anim.startIdx || 0;
  this.updateDisplayForIndex(this.anim.currentIdx);
  this.playBtn.textContent = 'Play';
  forwardPlayState(this, false);
};

/* create panels */
// global grid renderer (shows union of telemetry keys from both panels)
function renderGlobalGrid(keys){
  const g = document.getElementById('globalGrid');
  if(!g) return;
  g.innerHTML = '';
  keys.forEach(name=>{
    const box = document.createElement('div');
    box.className = 'box';
    box.dataset.name = name;
    box.style.setProperty('--box-stripe', nameToColor(name));
    box.innerHTML = `<div class="name">${escapeHtml(name)}</div><div class="value">—</div><div class="meta"></div>`;
    g.appendChild(box);
  });
}

function updateGlobalGrid(){
  const keys = new Set();
  if(window.panelA && panelA.maps) Object.keys(panelA.maps).forEach(k=>keys.add(k));
  if(window.panelB && panelB.maps) Object.keys(panelB.maps).forEach(k=>keys.add(k));
  const arr = Array.from(keys).sort((a,b)=> a.localeCompare(b, undefined, {sensitivity:'base', numeric:true}));
  renderGlobalGrid(arr);
}


const panelA = new Panel('A');
const panelB = new Panel('B');
// ensure initial global grid (if any telemetry already loaded)
updateGlobalGrid();


const linkCheckbox = document.getElementById('linkPlayback');
function forwardPlayState(sourcePanel, isPlaying){
  if(!linkCheckbox.checked) return;
  const target = sourcePanel.prefix === 'A' ? panelB : panelA;
  if(isPlaying && !target.anim.playing) target.togglePlay();
  if(!isPlaying && target.anim.playing) target.togglePlay();
}
function forwardSliderChange(sourcePanel, idx){
  if(!linkCheckbox.checked) return;
  const target = sourcePanel.prefix === 'A' ? panelB : panelA;
  target.anim.currentIdx = idx;
  target.updateDisplayForIndex(idx);
}

/* Weather: global loader and per-panel updater */
// Support per-panel weather datasets. Panels may have their own `weatherPoints` arrays.
window.weatherPoints = [];
const weatherLoadBtnA = document.getElementById('weather_load_A');
const weatherLoadBtnB = document.getElementById('weather_load_B');
const weatherResetBtn = document.getElementById('weather_reset');
const weatherUrlInputA = document.getElementById('weather_url_A');
const weatherUrlInputB = document.getElementById('weather_url_B');

async function fetchWeatherJson(url){
  if(!url) return null;
  try{
    const r = await fetch(url);
    if(!r.ok) throw new Error('fetch failed');
    const j = await r.json();
    if(!Array.isArray(j)) { console.warn('weather json not array'); return null; }
    return j.map(o => Object.assign({}, o, { TIME_UTC_SECONDS: Number(o.TIME_UTC_SECONDS) }))
            .sort((a,b)=> (a.TIME_UTC_SECONDS||0) - (b.TIME_UTC_SECONDS||0));
  }catch(e){ console.warn('fetchWeatherJson failed', e); return null; }
}

async function loadWeatherForPanel(url, panel){
  if(!url || !panel) return;
  const j = await fetchWeatherJson(url);
  if(!j) { console.warn('no weather data loaded for', panel && panel.prefix); return; }
  // store per-panel points
  panel.weatherPoints = j;
  if(panel.weatherPoints.length){
    updateWeatherForPanel(panel, panel.weatherPoints[0].TIME_UTC_SECONDS);
  }
  console.info(`Loaded weather points for ${panel.prefix}:`, panel.weatherPoints.length);
}

weatherLoadBtnA && weatherLoadBtnA.addEventListener('click', () => loadWeatherForPanel(weatherUrlInputA.value || weatherUrlInputA.placeholder, panelA));
weatherLoadBtnB && weatherLoadBtnB.addEventListener('click', () => loadWeatherForPanel(weatherUrlInputB.value || weatherUrlInputB.placeholder, panelB));
weatherResetBtn && weatherResetBtn.addEventListener('click', () => { panelA.weatherPoints = []; panelB.weatherPoints = []; clearPanelWeather(panelA); clearPanelWeather(panelB); });

function updateWeatherForPanel(panel, seconds){
  if(!panel || !panel.weatherVars) return;
  // prefer panel-specific weatherPoints, fall back to global window.weatherPoints
  const pts = (panel.weatherPoints && panel.weatherPoints.length) ? panel.weatherPoints : ((window.weatherPoints && window.weatherPoints.length) ? window.weatherPoints : null);
  if(!pts || pts.length===0) return;
  const idx = pts.findIndex(wp => (wp.TIME_UTC_SECONDS||0) >= Number(seconds));
  const use = idx === -1 ? (pts.length - 1) : idx;
  const p = pts[use];
  if(!p) return;
  const tEl = document.getElementById(`${panel.prefix}_weatherTime`);
  if(tEl) tEl.textContent = String(p.TIME_UTC_STR ?? p.TIME_UTC_SECONDS ?? '');
  for(const v of panel.weatherVars){
    const el = document.getElementById(`${panel.prefix}_wv_${v}`);
    if(!el) continue;
    const val = p[v];
    el.textContent = (val === null || val === undefined) ? '—' : String(val);
    const box = el.closest('.box');
    if(box){
      const meta = box.querySelector('.meta');
      if(meta) meta.textContent = (p.TIME_UTC_STR) ? String(p.TIME_UTC_STR) : '';
    }
  }
}

function clearPanelWeather(panel){
  if(!panel || !panel.weatherVars) return;
  const tEl = document.getElementById(`${panel.prefix}_weatherTime`);
  if(tEl) tEl.textContent = '—';
  for(const v of panel.weatherVars){
    const el = document.getElementById(`${panel.prefix}_wv_${v}`);
    if(el) el.textContent = '—';
    const box = el ? el.closest('.box') : null;
    if(box){
      const meta = box.querySelector('.meta');
      if(meta) meta.textContent = '';
    }
  }
}

/* initial fetch of default weather files (non-blocking) */
// Attempt to load default A and B weather (if inputs present)
if(typeof weatherUrlInputA !== 'undefined' && weatherUrlInputA) loadWeatherForPanel(weatherUrlInputA.value || weatherUrlInputA.placeholder, panelA);
if(typeof weatherUrlInputB !== 'undefined' && weatherUrlInputB) loadWeatherForPanel(weatherUrlInputB.value || weatherUrlInputB.placeholder, panelB);

/* expose for debugging */
window.panelA = panelA;
window.panelB = panelB;