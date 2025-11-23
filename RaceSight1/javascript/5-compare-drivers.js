
  /* small polyfills/helpers */
if (typeof CSS === 'undefined' || typeof CSS.escape !== 'function') {
  (function(global){ const cssEscape = v=>String(v).replace(/([^\x00-\x7F]|[^a-zA-Z0-9_\-])/g,ch=>'\\'+ch.charCodeAt(0).toString(16)+' '); if(!global.CSS) global.CSS={}; global.CSS.escape=cssEscape; })(window);
}
function parseNum(v){ if(v==null||v==='') return NaN; const n=+v; return isFinite(n)?n:NaN; }
function parseTimeToMs(v){
  if(v==null) return null;
  if(typeof v==='number') return v>1e11?Math.floor(v):Math.floor(v*1000);
  if(typeof v==='string'){
    // accept ISO, unix seconds, ms as string
    if(/^\d+$/.test(v)){ const n=Number(v); return n>1e11?Math.floor(n):Math.floor(n*1000); }
    const p = Date.parse(v);
    return isNaN(p)?null:p;
  }
  return null;
}
function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* readEmbeddedJSON: try synchronous XHR for script[src], otherwise parse embedded text */
function readEmbeddedJSON(id){
  const el = document.getElementById(id); if(!el) return null;
  const src = el.getAttribute('src'); let txt = '';
  if(src){
    try{
      const xhr = new XMLHttpRequest();
      xhr.open('GET', src, false); // sync (file:// friendly)
      xhr.overrideMimeType && xhr.overrideMimeType('application/json');
      xhr.send(null);
      if((xhr.status === 200 || xhr.status === 0) && xhr.responseText) txt = xhr.responseText;
      else console.warn('readEmbeddedJSON: XHR status', xhr.status, 'for', src);
    }catch(e){ console.warn('readEmbeddedJSON: XHR error', e); }
  }
  if(!txt) txt = el.textContent ? el.textContent.trim() : '';
  if(!txt) return null;
  try{ const parsed = JSON.parse(txt); if(Array.isArray(parsed)) return parsed; const keys=['data','rows','results','items','payload','values']; for(const k of keys) if(Array.isArray(parsed[k])) return parsed[k]; const arrProps = Object.keys(parsed).filter(k=>Array.isArray(parsed[k])); if(arrProps.length===1) return parsed[arrProps[0]]; return null; } catch(err){ console.warn('readEmbeddedJSON parse failed for', id, err); return null; }
}

/* nearest lookup */
function nearestInMap(m, tMs, maxDelta = 1000){
  if(!m || typeof m.get !== 'function') return undefined;
  if(m.has(tMs)) return m.get(tMs);
  let best=null, bestD=Infinity;
  for(const k of m.keys()){
    const d = Math.abs(k - tMs);
    if(d < bestD){ bestD = d; best = k; }
  }
  return (best !== null && bestD <= maxDelta) ? m.get(best) : undefined;
}

/* Panel: minimal long/wide support */
function Panel(prefix, color){
  this.prefix = prefix; this.color = color;
  this.loadBtn = document.getElementById(prefix + '_load');
  this.timeField = document.getElementById(prefix + '_timeField');
  this.latSel = document.getElementById(prefix + '_lat'); this.lonSel = document.getElementById(prefix + '_lon');
  this.grid = document.getElementById(prefix + '_grid'); this.play = document.getElementById(prefix + '_play');
  this.resetBtn = document.getElementById(prefix + '_reset'); this.slider = document.getElementById(prefix + '_slider');
  this.rateSel = document.getElementById(prefix + '_rate');
  this.timeLabel = document.getElementById(prefix + '_time');
  this.raw = []; this.mode='unknown'; this.maps = {}; this.points = []; this.keysSorted = [];
  this.anim = { playing:false, currentIdx:0, startIdx:0, endIdx:0, raf:null, lastTime:null, accum:0, rate:1 };

  this.loadBtn && this.loadBtn.addEventListener('click', ()=> this.load());
  this.play && this.play.addEventListener('click', ()=> this.togglePlay());
  this.resetBtn && this.resetBtn.addEventListener('click', ()=> this.reset());
  this.slider && this.slider.addEventListener('input', (e)=> {
    this.anim.currentIdx = +e.target.value;
    this.updateDisplay(this.anim.currentIdx);
    try{
      updateCombinedMap();
      const idx = this.anim.currentIdx;
      const p = this.points && this.points[idx];
      if(p && p.tMs && typeof updateWeatherForSeconds === 'function') updateWeatherForSeconds(Math.floor(p.tMs/1000));
      // forward slider change to other panel when linked
      if(typeof forwardSliderChange === 'function') forwardSliderChange(this, idx);
    }catch(err){}
  });
  // keep anim.rate in sync with selector when user changes it
  if(this.rateSel){ this.rateSel.onchange = ()=> { try{ this.anim.rate = Number(this.rateSel.value) || 1; }catch(e){} }; }
  [this.timeField,this.latSel,this.lonSel].forEach(el => el && (el.onchange = ()=> this.build()));
}

Panel.prototype.load = function(){
  const arr = readEmbeddedJSON(this.prefix + '_json');
  if(Array.isArray(arr)){ this.raw = arr; this.timeLabel && (this.timeLabel.textContent = `Loaded ${arr.length} rows`); this.prepareUI(); this.build(); return; }
  this.timeLabel && (this.timeLabel.textContent = 'No JSON found');
};

// ensure lap options refresh after load
const _orig_panel_load = Panel.prototype.load;
Panel.prototype.load = function(){
  _orig_panel_load.apply(this, arguments);
  try{ if(typeof refreshLapOptions === 'function') refreshLapOptions(); }catch(e){}
};

Panel.prototype.prepareUI = function(){
  this.mode = 'unknown';
  if(!Array.isArray(this.raw) || this.raw.length===0){ if(this.latSel) this.latSel.innerHTML = ''; if(this.lonSel) this.lonSel.innerHTML = ''; return; }
  const sample = this.raw.slice(0,10);
  const longDetected = sample.some(r => r && (r.telemetry_name !== undefined || r.name !== undefined) && (r.telemetry_value !== undefined || r.value !== undefined));
  if(longDetected){
    this.mode = 'long';
    const telemetry = new Set(), timeFields = new Set();
    this.raw.forEach(r=>{ if(r.telemetry_name) telemetry.add(String(r.telemetry_name)); if(r.name) telemetry.add(String(r.name)); if(r.meta_time!==undefined) timeFields.add('meta_time'); if(r.timestamp!==undefined) timeFields.add('timestamp'); if(r.time!==undefined) timeFields.add('time'); });
    const list = Array.from(telemetry).sort();
    // prefer explicit VBOX lat/lon names if present, otherwise fall back to full telemetry list
    if(this.latSel){
      if(telemetry.has('VBOX_Lat_Min')){
        this.latSel.innerHTML = `<option value="VBOX_Lat_Min">VBOX_Lat_Min</option>`;
      } else {
        this.latSel.innerHTML = list.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
      }
    }
    if(this.lonSel){
      if(telemetry.has('VBOX_Long_Minutes')){
        this.lonSel.innerHTML = `<option value="VBOX_Long_Minutes">VBOX_Long_Minutes</option>`;
      } else {
        this.lonSel.innerHTML = list.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
      }
    }
    if(this.latSel && this.latSel.options.length>0) this.latSel.selectedIndex = 0;
    if(this.lonSel && this.lonSel.options.length>1) this.lonSel.selectedIndex = Math.min(1,this.lonSel.options.length-1);
    if(this.timeField) this.timeField.innerHTML = (Array.from(timeFields).length ? Array.from(timeFields).map(t=>`<option value="${t}">${t}</option>`).join('') : '<option value="meta_time">meta_time</option><option value="timestamp">timestamp</option><option value="time">time</option>');
    return;
  }
  const obj = sample[0];
  if(typeof obj === 'object' && obj !== null){
    const keys = Object.keys(obj);
    const timeCandidates = keys.filter(k => /time|timestamp|meta_time/i.test(k));
    const latCandidates = keys.filter(k => /(^lat$|latitude|gps_lat|_lat$)/i.test(k));
    const lonCandidates = keys.filter(k => /(^lon$|lng|longitude|gps_lon|_lon$)/i.test(k));
    const telemetryKeys = keys.filter(k => !timeCandidates.includes(k) && !latCandidates.includes(k) && !lonCandidates.includes(k));
    if(telemetryKeys.length){
      this.mode = 'wide';
      const latList = latCandidates.length ? latCandidates : keys.filter(k => /lat/i.test(k)).slice(0,3);
      const lonList = lonCandidates.length ? lonCandidates : keys.filter(k => /lon|lng|long/i.test(k)).slice(0,3);
      // prefer explicit VBOX fields when available
      if(this.latSel){
        if(keys.includes('VBOX_Lat_Min')) this.latSel.innerHTML = `<option value="VBOX_Lat_Min">VBOX_Lat_Min</option>`;
        else this.latSel.innerHTML = latList.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('') || '<option value="">(none)</option>';
      }
      if(this.lonSel){
        if(keys.includes('VBOX_Long_Minutes')) this.lonSel.innerHTML = `<option value="VBOX_Long_Minutes">VBOX_Long_Minutes</option>`;
        else this.lonSel.innerHTML = lonList.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('') || '<option value="">(none)</option>';
      }
      if(this.latSel && this.latSel.options.length>0) this.latSel.selectedIndex = 0;
      if(this.lonSel && this.lonSel.options.length>0) this.lonSel.selectedIndex = 0;
      if(this.timeField) this.timeField.innerHTML = (timeCandidates.length ? timeCandidates.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('') : '<option value="meta_time">meta_time</option><option value="timestamp">timestamp</option><option value="time">time</option>');
      return;
    }
  }
  this.mode = 'long';
  if(this.latSel) this.latSel.innerHTML=''; if(this.lonSel) this.lonSel.innerHTML='';
  if(this.timeField) this.timeField.innerHTML = '<option value="meta_time">meta_time</option><option value="timestamp">timestamp</option><option value="time">time</option>';
};

Panel.prototype.build = function(){
  this.maps = {}; this.points = []; this.keysSorted = [];
  // respect global lap selection (if present)
  const lapSelEl = document.getElementById('lapSelect');
  const selectedLap = (lapSelEl && lapSelEl.value) ? lapSelEl.value : 'All';

  if(!Array.isArray(this.raw) || this.raw.length===0){ this.renderGrid(); return; }

  if(this.mode === 'long'){
    this.raw.forEach(r=>{
      if(selectedLap !== 'All'){
        // allow numeric or string comparisons
        const rl = (r.lap === undefined || r.lap === null) ? '' : String(r.lap);
        if(rl !== String(selectedLap)) return;
      }
      const name = r.telemetry_name ?? r.name; if(!name) return;
      const tRaw = r[this.timeField?.value] ?? r.meta_time ?? r.timestamp ?? r.time;
      const tMs = parseTimeToMs(tRaw); if(tMs==null) return;
      const valRaw = r.telemetry_value ?? r.value;
      const v = parseNum(valRaw);
      this.maps[name] = this.maps[name] || new Map(); this.maps[name].set(tMs, v);
    });

    const latName = this.latSel?.value || null;
    const lonName = this.lonSel?.value || null;
    const latMap = latName ? (this.maps[latName] || new Map()) : new Map();
    const lonMap = lonName ? (this.maps[lonName] || new Map()) : new Map();
    const times = Array.from(latMap.keys()).filter(t=>lonMap.has(t)).sort((a,b)=>a-b);
    this.points = times.map(t => ({ tMs:t, lat:latMap.get(t), lon:lonMap.get(t) }));

  } else { // wide
    const timeKey = this.timeField?.value;
    const latKey = this.latSel?.value;
    const lonKey = this.lonSel?.value;

    this.raw.forEach(row=>{
      if(selectedLap !== 'All'){
        const rl = (row.lap === undefined || row.lap === null) ? '' : String(row.lap);
        if(rl !== String(selectedLap)) return;
      }
      const tRaw = row[timeKey] ?? row.meta_time ?? row.timestamp ?? row.time;
      const tMs = parseTimeToMs(tRaw); if(tMs==null) return;
      Object.keys(row).forEach(k=>{
        if(k === timeKey) return;
        if(k === latKey || k === lonKey) return;
        this.maps[k] = this.maps[k] || new Map();
        this.maps[k].set(tMs, parseNum(row[k]));
      });
    });

    this.points = this.raw.map(row=>{
      const tRaw = row[timeKey] ?? row.meta_time ?? row.timestamp ?? row.time;
      const tMs = parseTimeToMs(tRaw);
      const lat = parseNum(row[latKey]); const lon = parseNum(row[lonKey]);
      return (tMs && isFinite(lat) && isFinite(lon)) ? { tMs, lat, lon } : null;
    }).filter(Boolean).sort((a,b)=>a.tMs - b.tMs);
  }

  this.renderGrid();
  // refresh chart variable list (if chart exists)
  try{ if(typeof refreshChartVars === 'function') refreshChartVars(); }catch(e){}
  updateCombinedMap();
  if(this.slider){ this.slider.min = 0; this.slider.max = Math.max(0,this.points.length-1); this.slider.value = 0; }
  if(this.rateSel){ try{ this.rateSel.value = String(this.anim.rate || 1); }catch(e){} }
  this.anim.startIdx = 0; this.anim.endIdx = this.points.length-1; this.anim.currentIdx = 0;
  this.updateDisplay(0);
  // ensure controls/weather heights sync after building (in case control A changed size)
  try{ if(typeof syncControlsWeatherHeightDebounced === 'function') syncControlsWeatherHeightDebounced(); }catch(e){}
};

Panel.prototype.renderGrid = function(){
  if(!this.grid) return;
  this.grid.innerHTML = '';
  this.keysSorted = Object.keys(this.maps).sort((a,b)=> a.localeCompare(b, undefined, {sensitivity:'base', numeric:true}));
  this.keysSorted.forEach(k=>{
    const el = document.createElement('div'); el.className='box'; el.dataset.name = k;
    el.style.setProperty('--box-stripe', this.color || '#777');
    el.innerHTML = `<div class="name">${escapeHtml(k)}</div><div class="value" aria-live="polite">—</div><div class="meta"></div>`;
    this.grid.appendChild(el);
  });
};

Panel.prototype.updateDisplay = function(idx){
  if(!this.points || this.points.length===0){ this.updateGridValues(null); this.timeLabel && (this.timeLabel.textContent='—'); return; }
  idx = Math.max(0, Math.min(this.points.length-1, idx));
  const p = this.points[idx];
  if(this.slider) this.slider.value = idx;
  if(this.timeLabel) this.timeLabel.textContent = new Date(p.tMs).toISOString();
  this.updateGridValues(p.tMs);
};

Panel.prototype.updateGridValues = function(tMs){
  this.keysSorted.forEach(name=>{
    const box = this.grid.querySelector(`.box[data-name="${CSS.escape(name)}"]`); if(!box) return;
    const valEl = box.querySelector('.value'), metaEl = box.querySelector('.meta');
    if(tMs==null){ valEl.textContent='—'; metaEl.textContent=''; return; }
    const m = this.maps[name];
    const v = nearestInMap(m, tMs, 1000);
    if(v===undefined || Number.isNaN(v)){ valEl.textContent='—'; metaEl.textContent=''; }
    else { valEl.textContent = (typeof v==='number' && !Number.isInteger(v)) ? Number(v).toFixed(3) : String(v); metaEl.textContent = new Date(tMs).toISOString(); }
  });
};

Panel.prototype.togglePlay = function(){
  // stop
  if(this.anim.playing){
    this.anim.playing = false;
    this.play.textContent = 'Play';
    if(this.anim.raf) cancelAnimationFrame(this.anim.raf);
    this.anim.raf = null;
    try{ if(typeof forwardPlayState === 'function') forwardPlayState(this, this.anim.playing); }catch(e){}
    return;
  }

  // start
  if(this.anim.endIdx <= this.anim.startIdx) return;
  this.anim.playing = true;
  this.play.textContent = 'Pause';
  this.anim.lastTime = null; this.anim.accum = 0;
  // read rate from selector if present (default 1)
  try{ this.anim.rate = Number(this.rateSel && this.rateSel.value) || 1; }catch(e){ this.anim.rate = 1; }
  try{ if(typeof forwardPlayState === 'function') forwardPlayState(this, this.anim.playing); }catch(e){}

  const step = (now) => {
    if(!this.anim.playing) return;
    if(this.anim.lastTime == null) this.anim.lastTime = now;
    const dt = now - this.anim.lastTime; this.anim.lastTime = now;
    this.anim.accum += (dt/1000) * this.anim.rate;
    const adv = Math.floor(this.anim.accum);
    if(adv >= 1){
      this.anim.currentIdx = Math.min(this.anim.endIdx, this.anim.currentIdx + adv);
      this.anim.accum -= adv;
      this.updateDisplay(this.anim.currentIdx);
      updateCombinedMap();
    }
    if(this.anim.currentIdx >= this.anim.endIdx){ this.anim.playing = false; this.play.textContent = 'Play'; try{ if(typeof forwardPlayState === 'function') forwardPlayState(this, this.anim.playing); }catch(e){}; return; }
    this.anim.raf = requestAnimationFrame(step);
  };
  this.anim.raf = requestAnimationFrame(step);
};

Panel.prototype.reset = function(){
  // stop playback and clear any pending animation state
  this.anim.playing = false;
  if(this.anim.raf) cancelAnimationFrame(this.anim.raf);
  this.anim.raf = null;

  // reset index and clear accumulated time so subsequent Play starts clean
  this.anim.currentIdx = this.anim.startIdx || 0;
  this.anim.accum = 0;
  this.anim.lastTime = null;

  // update UI and inform linked panel (if linkPlayback is enabled)
  // ensure slider bounds and visual thumb update
  try{
    if(this.slider){
      this.slider.min = (typeof this.anim.startIdx === 'number') ? this.anim.startIdx : 0;
      this.slider.max = (typeof this.anim.endIdx === 'number') ? this.anim.endIdx : 0;
      this.slider.step = 1;
      this.slider.value = this.anim.currentIdx;
      // call local update to refresh grid/map/time
      this.updateDisplay(this.anim.currentIdx);
      // dispatch an input event so any UI listeners run and linked panels receive an event
      const ev = new Event('input', { bubbles: true, cancelable: false });
      try{ this.slider.dispatchEvent(ev); }catch(e){}
      // explicitly forward slider change to linked panel (robust fallback)
      try{ if(typeof forwardSliderChange === 'function') forwardSliderChange(this, Number(this.slider.value)); }catch(e){}
    } else {
      this.updateDisplay(this.anim.currentIdx);
    }
  }catch(e){ this.updateDisplay(this.anim.currentIdx); }
  this.play.textContent = 'Play';
  try{ if(typeof forwardPlayState === 'function') forwardPlayState(this, false); }catch(e){}

  // refresh combined map display
  try{ updateCombinedMap(); }catch(e){}
};

/* Combined map (single Leaflet instance) */
const mainMap = L.map('mainMap', { attributionControl:false }).setView([0,0],2);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mainMap);
const polyA = L.polyline([], { color: getComputedStyle(document.documentElement).getPropertyValue('--accentA')||'#1f77b4', weight:3 }).addTo(mainMap);
const polyB = L.polyline([], { color: getComputedStyle(document.documentElement).getPropertyValue('--accentB')||'#ff7f0e', weight:3 }).addTo(mainMap);
const markerA = L.circleMarker([0,0], { radius:6, color: getComputedStyle(document.documentElement).getPropertyValue('--accentA')||'#1f77b4', fill:true, fillOpacity:1 }).addTo(mainMap);
const markerB = L.circleMarker([0,0], { radius:6, color: getComputedStyle(document.documentElement).getPropertyValue('--accentB')||'#ff7f0e', fill:true, fillOpacity:1 }).addTo(mainMap);

function updateCombinedMap(){
  try{ mainMap.invalidateSize(); } catch(e){}
  const coordsA = panelA.points.map(p=>[p.lat,p.lon]).filter(c=>isFinite(c[0]) && isFinite(c[1]));
  const coordsB = panelB.points.map(p=>[p.lat,p.lon]).filter(c=>isFinite(c[0]) && isFinite(c[1]));
  polyA.setLatLngs(coordsA); polyB.setLatLngs(coordsB);

  const idxA = (panelA.points && panelA.points.length) ? Math.max(0, Math.min(panelA.points.length-1, panelA.anim.currentIdx||0)) : -1;
  const idxB = (panelB.points && panelB.points.length) ? Math.max(0, Math.min(panelB.points.length-1, panelB.anim.currentIdx||0)) : -1;

  if(idxA >= 0){ const p=panelA.points[idxA]; if(isFinite(p.lat)&&isFinite(p.lon)) markerA.setLatLng([p.lat,p.lon]); markerA.setStyle({opacity:1, fillOpacity:1}); } else { markerA.setStyle({opacity:0, fillOpacity:0}); }
  if(idxB >= 0){ const p=panelB.points[idxB]; if(isFinite(p.lat)&&isFinite(p.lon)) markerB.setLatLng([p.lat,p.lon]); markerB.setStyle({opacity:1, fillOpacity:1}); } else { markerB.setStyle({opacity:0, fillOpacity:0}); }

  const all = coordsA.concat(coordsB);
  if(all.length) try{ mainMap.fitBounds(all, { padding:[40,40] }); } catch(e){ console.warn('fitBounds failed', e); }
  // ensure side images match the map height after map updates
  try{ if(typeof syncMapHeightDebounced === 'function') syncMapHeightDebounced(); } catch(e){}
  // sync central weather display to a representative time from panels (seconds)
  try{
    var tA = (panelA && panelA.points && panelA.points.length && panelA.anim && typeof panelA.anim.currentIdx === 'number') ? (panelA.points[Math.max(0,Math.min(panelA.points.length-1, panelA.anim.currentIdx))]?.tMs) : null;
    var tB = (panelB && panelB.points && panelB.points.length && panelB.anim && typeof panelB.anim.currentIdx === 'number') ? (panelB.points[Math.max(0,Math.min(panelB.points.length-1, panelB.anim.currentIdx))]?.tMs) : null;
    var useMs = null;
    if(tA && tB) useMs = Math.max(tA, tB); else useMs = tA || tB || null;
    if(useMs && typeof updateWeatherForSeconds === 'function') updateWeatherForSeconds(Math.floor(useMs/1000));
    try{ if(useMs && typeof updateChartCursor === 'function') updateChartCursor(useMs); }catch(e){}
  }catch(e){}
}





/* D3 chart: plot selected variable for both Panel A and Panel B, synced to playback */
(function(){
  const chartNode = document.getElementById('chartA'); if(!chartNode) return;
  const CH_W = 1100, CH_H = 220, M = {top:12,right:16,bottom:34,left:56};
  const innerW = CH_W - M.left - M.right, innerH = CH_H - M.top - M.bottom;
  const svg = d3.select(chartNode).append('svg').attr('viewBox', `0 0 ${CH_W} ${CH_H}`).style('width','100%').style('height', CH_H + 'px');
  const g = svg.append('g').attr('transform', `translate(${M.left},${M.top})`);
  const xG = g.append('g').attr('transform', `translate(0,${innerH})`);
  const yG = g.append('g');
  const xLabel = g.append('text').attr('x', innerW/2).attr('y', innerH + 28).attr('text-anchor','middle');
  const yLabel = g.append('text').attr('transform','rotate(-90)').attr('x', -innerH/2).attr('y', -42).attr('text-anchor','middle');

  const lineA = g.append('path').attr('fill','none').attr('stroke', getComputedStyle(document.documentElement).getPropertyValue('--accentA') || '#f80909').attr('stroke-width',1.8);
  const lineB = g.append('path').attr('fill','none').attr('stroke', getComputedStyle(document.documentElement).getPropertyValue('--accentB') || '#08b4f8').attr('stroke-width',1.8);
  const ptsA = g.append('g').attr('class','ptsA');
  const ptsB = g.append('g').attr('class','ptsB');
  const cursorG = g.append('g').attr('class','cursor');

  let xScale = d3.scaleUtc().range([0,innerW]);
  let yScale = d3.scaleLinear().range([innerH,0]);
  let seriesA = [], seriesB = [], currentVar = '';

  window.refreshChartVars = function(){
    try{
      const sel = document.getElementById('chartVar'); if(!sel) return;
      // union of keys from both panels
      const set = new Set((panelA.keysSorted||[]).concat(panelB.keysSorted||[]));
      const list = Array.from(set).sort((a,b)=>a.localeCompare(b, undefined, {sensitivity:'base', numeric:true}));
      const prev = sel.value;
      sel.innerHTML = list.map(k=>`<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
      if(list.length){ sel.value = list.includes(prev) ? prev : list[0]; currentVar = sel.value; updateChartData(currentVar); }
      sel.onchange = function(){ currentVar = this.value; updateChartData(currentVar); };
    }catch(e){ console.warn('refreshChartVars', e); }
  };

  function mapToSeries(m){ if(!m) return []; return Array.from(m.entries()).map(([ms,v])=>({ms:+ms, val: (Number.isFinite(+v) ? +v : NaN)})).filter(d=>!Number.isNaN(d.val)).sort((a,b)=>a.ms - b.ms); }

  function updateChartData(varName){
    try{
      if(!varName){ seriesA = []; seriesB = []; redraw(); return; }
      seriesA = mapToSeries(panelA.maps[varName]);
      seriesB = mapToSeries(panelB.maps[varName]);
      const all = seriesA.concat(seriesB);
      if(all.length===0){ redraw(); return; }
      const x0 = new Date(d3.min(all, d=>d.ms));
      const x1 = new Date(d3.max(all, d=>d.ms));
      xScale.domain([x0,x1]).nice();
      const vals = all.map(d=>d.val).filter(v=>Number.isFinite(v));
      const yDom = vals.length ? d3.extent(vals) : [0,1];
      yScale.domain(yDom).nice();
      xG.call(d3.axisBottom(xScale).ticks(6).tickFormat(d3.utcFormat('%H:%M:%S')));
      yG.call(d3.axisLeft(yScale).ticks(5));
      xLabel.text(varName + ' vs time'); yLabel.text(varName);
      const lineGen = d3.line().x(d=>xScale(new Date(d.ms))).y(d=>yScale(d.val)).defined(d=>Number.isFinite(d.val));
      lineA.datum(seriesA).attr('d', lineGen);
      lineB.datum(seriesB).attr('d', lineGen);
      const selA = ptsA.selectAll('circle').data(seriesA, d=>d.ms);
      selA.exit().remove(); selA.enter().append('circle').attr('r',0).attr('fill',getComputedStyle(document.documentElement).getPropertyValue('--accentA')||'#f80909').merge(selA).attr('cx',d=>xScale(new Date(d.ms))).attr('cy',d=>yScale(d.val)).attr('r',3.4);
      const selB = ptsB.selectAll('circle').data(seriesB, d=>d.ms);
      selB.exit().remove(); selB.enter().append('circle').attr('r',0).attr('fill',getComputedStyle(document.documentElement).getPropertyValue('--accentB')||'#08b4f8').merge(selB).attr('cx',d=>xScale(new Date(d.ms))).attr('cy',d=>yScale(d.val)).attr('r',3.4);
      cursorG.selectAll('*').remove();
      cursorG.append('line').attr('class','cursorLine').attr('y1',0).attr('y2',innerH).attr('stroke','orange').attr('stroke-dasharray','4 3').attr('x1',0).attr('x2',0);
      cursorG.append('circle').attr('r',5).attr('fill','orange').attr('stroke','#fff').attr('stroke-width',0.8).attr('cx',0).attr('cy',0).style('display','none');
    }catch(e){ console.warn('updateChartData', e); }
  }

  function redraw(){ updateChartData(currentVar); }

  function findNearestIdx(arr, ms){ if(!arr || arr.length===0) return -1; let lo=0, hi=arr.length-1; while(lo<hi){ const mid=Math.floor((lo+hi)/2); if(arr[mid].ms < ms) lo=mid+1; else hi=mid; } // lo is first >= ms
    if(lo===0) return 0; if(lo>=arr.length) return arr.length-1; const a = arr[lo-1], b = arr[lo]; return (Math.abs(a.ms-ms) <= Math.abs(b.ms-ms)) ? (lo-1) : lo; }

  window.updateChartCursor = function(ms){ try{
      if(!ms || (!seriesA.length && !seriesB.length)) return;
      const x = xScale(new Date(ms)); cursorG.selectAll('line.cursorLine').attr('x1',x).attr('x2',x);
      // A marker
      const ia = findNearestIdx(seriesA, ms); const ib = findNearestIdx(seriesB, ms);
      // draw markers
      let mA = cursorG.selectAll('circle.markerA').data( (seriesA[ia] && Math.abs(seriesA[ia].ms - ms) < 60000) ? [seriesA[ia]] : [] , d=>d.ms);
      mA.exit().remove(); mA.enter().append('circle').attr('class','markerA').attr('r',5).attr('fill',getComputedStyle(document.documentElement).getPropertyValue('--accentA')||'#f80909').attr('stroke','#fff').attr('stroke-width',0.8).merge(mA).attr('cx', d=>xScale(new Date(d.ms))).attr('cy', d=>yScale(d.val));
      let mB = cursorG.selectAll('circle.markerB').data( (seriesB[ib] && Math.abs(seriesB[ib].ms - ms) < 60000) ? [seriesB[ib]] : [], d=>d.ms);
      mB.exit().remove(); mB.enter().append('circle').attr('class','markerB').attr('r',5).attr('fill',getComputedStyle(document.documentElement).getPropertyValue('--accentB')||'#08b4f8').attr('stroke','#fff').attr('stroke-width',0.8).merge(mB).attr('cx', d=>xScale(new Date(d.ms))).attr('cy', d=>yScale(d.val));
    }catch(e){ console.warn('updateChartCursor', e); } };

  // expose updateChartData for external triggers
  window.updateChartData = updateChartData;
})();

  /* lap selector refresh: build the union of lap values from loaded panel raw arrays */
  function refreshLapOptions(){
    try{
      const el = document.getElementById('lapSelect'); if(!el) return;
      const vals = new Set();
      [panelA, panelB].forEach(p=>{ if(p && Array.isArray(p.raw)) p.raw.forEach(r=>{ if(r && r.lap !== undefined && r.lap !== null) vals.add(String(r.lap)); }); });
      const arr = Array.from(vals).map(v=>({orig:v,num: Number(v)})).sort((a,b)=>{
        if(isFinite(a.num) && isFinite(b.num)) return a.num - b.num;
        return a.orig.localeCompare(b.orig);
      }).map(x=>x.orig);
      const prev = el.value;
      el.innerHTML = '<option>All</option>' + arr.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
      if(arr.length && prev && prev !== 'All'){
        el.value = arr.includes(prev) ? prev : 'All';
      } else { el.value = prev || 'All'; }
      el.onchange = function(){ try{ panelA.build(); panelB.build(); if(typeof refreshChartVars === 'function') refreshChartVars(); }catch(e){} };
    }catch(e){ console.warn('refreshLapOptions', e); }
  }

/* instantiate and auto-load */
const panelA = new Panel('A', getComputedStyle(document.documentElement).getPropertyValue('--accentA')||'#1f77b4');
const panelB = new Panel('B', getComputedStyle(document.documentElement).getPropertyValue('--accentB')||'#ff7f0e');
window.panelA = panelA; window.panelB = panelB;

// Link playback checkbox (when checked, play/slider actions forward to the other panel)
const linkCheckbox = document.getElementById('linkPlayback');
function forwardPlayState(sourcePanel, isPlaying){
  try{ if(!linkCheckbox || !linkCheckbox.checked) return; }catch(e){ return; }
  const target = (sourcePanel === panelA) ? panelB : panelA;
  if(!target) return;
  if(isPlaying && !target.anim.playing) target.togglePlay();
  if(!isPlaying && target.anim.playing) target.togglePlay();
}
function forwardSliderChange(sourcePanel, idx){
  try{ if(!linkCheckbox || !linkCheckbox.checked) return; }catch(e){ return; }
  const target = (sourcePanel === panelA) ? panelB : panelA;
  if(!target) return;
  try{
    target.anim.currentIdx = idx;
    // ensure slider bounds and value reflect the forwarded index
    if(target.slider){
      target.slider.min = (typeof target.anim.startIdx === 'number') ? target.anim.startIdx : 0;
      target.slider.max = (typeof target.anim.endIdx === 'number') ? target.anim.endIdx : 0;
      target.slider.step = 1;
      target.slider.value = idx;
      // update local display (grid/map/time)
      target.updateDisplay(idx);
      // dispatch input event asynchronously to avoid timing/paint ordering issues
      setTimeout(()=>{ try{ target.slider.dispatchEvent(new Event('input', { bubbles:true, cancelable:false })); }catch(e){} }, 0);
    } else {
      target.updateDisplay(idx);
    }
  }catch(e){ try{ target.updateDisplay(idx); }catch(_){ } }
}

/* Weather grid rendering (reads embedded JSON via readEmbeddedJSON - file:// friendly) */
window.weatherPoints = [];
const weatherVars = ['AIR_TEMP','TRACK_TEMP','HUMIDITY','PRESSURE','WIND_SPEED','WIND_DIRECTION','RAIN','TIME_UTC_STR','TIME_UTC_SECONDS'];

function renderWeatherGrid(points){
  const grid = document.getElementById('weatherGrid'); if(!grid) return;
  grid.innerHTML = '';
  // build boxes
  for(const v of weatherVars){
    const c = document.createElement('div'); c.className = 'box'; c.dataset.var = v; c.style.setProperty('--box-stripe', '#6b6b6b');
    c.innerHTML = `<div class="name">${v}</div><div class="value" id="wv_${v}">—</div><div class="meta"></div>`;
    grid.appendChild(c);
  }
  // reset last-updated tracker so the next update will render
  try{ window._lastWeatherIdx = null; }catch(e){}
  // after rendering, ensure control boxes and weather area heights are synced
  try{ if(typeof syncControlsWeatherHeightDebounced === 'function') syncControlsWeatherHeightDebounced(); }catch(e){}
}

function updateWeatherForSeconds(seconds){
  if(!window.weatherPoints || window.weatherPoints.length===0) return;
  const sec = Number(seconds || 0);
  // find nearest by TIME_UTC_SECONDS
  let bestIdx = 0, bestD = Infinity;
  for(let i=0;i<window.weatherPoints.length;i++){ const p = window.weatherPoints[i]; const t = Number(p.TIME_UTC_SECONDS||0); const d = Math.abs(t - sec); if(d < bestD){ bestD = d; bestIdx = i; } }
  // skip updating if the nearest weather index hasn't changed (avoids flicker)
  try{ if(typeof window._lastWeatherIdx !== 'undefined' && window._lastWeatherIdx === bestIdx) return; }catch(e){}
  try{ window._lastWeatherIdx = bestIdx; }catch(e){}
  const p = window.weatherPoints[bestIdx]; if(!p) return;
  const tEl = document.getElementById('weather_time'); if(tEl) tEl.textContent = String(p.TIME_UTC_STR ?? p.TIME_UTC_SECONDS ?? '');
  for(const v of weatherVars){ const el = document.getElementById('wv_'+v); if(!el) continue; const val = p[v]; el.textContent = (val === null || val === undefined) ? '—' : String(val); const box = el.closest('.box'); if(box){ const meta = box.querySelector('.meta'); if(meta) meta.textContent = (p.TIME_UTC_STR ? String(p.TIME_UTC_STR) : ''); } }
}

function loadWeatherFromEmbedded(){
  const arr = readEmbeddedJSON('weather_json'); if(!Array.isArray(arr)) return;
  window.weatherPoints = arr.map(o => Object.assign({}, o, { TIME_UTC_SECONDS: Number(o.TIME_UTC_SECONDS || o.TIME_UTC_SECONDS || 0) })).sort((a,b)=> (a.TIME_UTC_SECONDS||0) - (b.TIME_UTC_SECONDS||0));
  renderWeatherGrid(window.weatherPoints);
  if(window.weatherPoints.length) updateWeatherForSeconds(window.weatherPoints[window.weatherPoints.length-1].TIME_UTC_SECONDS);
}

// load weather JSON by URL (fetch) and populate grid
async function loadWeatherFrom(url){
  if(!url) return;
  try{
    const r = await fetch(url);
    if(!r.ok) throw new Error('fetch failed');
    const j = await r.json();
    if(!Array.isArray(j)){ console.warn('weather json not array'); return; }
    window.weatherPoints = j.map(o => Object.assign({}, o, { TIME_UTC_SECONDS: Number(o.TIME_UTC_SECONDS || 0) })).sort((a,b)=> (a.TIME_UTC_SECONDS||0) - (b.TIME_UTC_SECONDS||0));
    renderWeatherGrid(window.weatherPoints);
    if(window.weatherPoints.length) updateWeatherForSeconds(window.weatherPoints[0].TIME_UTC_SECONDS);
    console.info('Loaded weather points:', window.weatherPoints.length);
  }catch(e){ console.warn('loadWeather failed', e); }
}

// wire up UI buttons
try{
  const wb = document.getElementById('weather_load'); if(wb) wb.addEventListener('click', ()=> loadWeatherFrom(document.getElementById('weather_url').value || document.getElementById('weather_url').placeholder));
  const wr = document.getElementById('weather_reset'); if(wr) wr.addEventListener('click', ()=> { window.weatherPoints = []; const g = document.getElementById('weatherGrid'); if(g) g.innerHTML = ''; const wt = document.getElementById('weather_time'); if(wt) wt.textContent = '—'; });
}catch(e){}

/* D3 weather vs time chart for test.html */
function renderWeatherChart(){
  if(typeof d3 === 'undefined') return;
  const wrap = document.getElementById('chartWeather');
  const sel = document.getElementById('weatherChartVar');
  if(!wrap || !sel) return;
  wrap.innerHTML = '';
  const W = Math.max(480, wrap.clientWidth || 640);
  const H = 200;
  const margin = {top:10,right:12,bottom:34,left:56};
  const innerW = W - margin.left - margin.right;
  const innerH = H - margin.top - margin.bottom;
  const svg = d3.select(wrap).append('svg').attr('width', W).attr('height', H).style('display','block');
  const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
  const xG = g.append('g').attr('transform', `translate(0,${innerH})`);
  const yG = g.append('g');
  const xScale = d3.scaleLinear().range([0, innerW]);
  const yScale = d3.scaleLinear().range([innerH, 0]);
  const line = d3.line().x(d=>xScale(d.TIME_UTC_SECONDS)).y(d=>yScale(d._val)).defined(d=>d._val!=null);

  function draw(){
    const varName = sel.value;
    const pts = (window.weatherPoints || []).map(d=>({ TIME_UTC_SECONDS: Number(d.TIME_UTC_SECONDS||0), _raw: d[varName], _val: (d[varName]==null?null:+d[varName]) }));
    if(pts.length===0){ xScale.domain([0,1]); yScale.domain([0,1]); xG.call(d3.axisBottom(xScale)); yG.call(d3.axisLeft(yScale)); return; }
    const xMin = d3.min(pts, d=>d.TIME_UTC_SECONDS), xMax = d3.max(pts, d=>d.TIME_UTC_SECONDS);
    const yMin = d3.min(pts, d=>d._val), yMax = d3.max(pts, d=>d._val);
    xScale.domain([xMin, xMax]);
    if(yMin==null || yMax==null || isNaN(yMin) || isNaN(yMax)) yScale.domain([0,1]);
    else if(yMin===yMax) yScale.domain([yMin-1,yMax+1]); else yScale.domain([yMin,yMax]);
    xG.call(d3.axisBottom(xScale).ticks(6).tickFormat(t=> new Date(t*1000).toISOString().replace('T',' ').slice(0,19)));
    yG.call(d3.axisLeft(yScale).ticks(5));

    const series = g.selectAll('.series').data([pts]);
    series.enter().append('path').attr('class','series').merge(series).attr('d', d=>line(d)).attr('fill','none').attr('stroke','#1f77b4').attr('stroke-width',2);

    g.selectAll('.hover-rect').remove(); g.selectAll('.hover-dot').remove();
    const overlay = g.append('rect').attr('class','hover-rect').attr('width', innerW).attr('height', innerH).attr('fill','transparent').style('pointer-events','all');
    const bis = d3.bisector(d=>d.TIME_UTC_SECONDS).left;
    const dot = g.append('circle').attr('class','hover-dot').attr('r',4).attr('fill','#d62728').style('display','none');
    const tip = document.createElement('div'); tip.style.position='absolute'; tip.style.pointerEvents='none'; tip.style.background='#fff'; tip.style.border='1px solid #ccc'; tip.style.padding='6px'; tip.style.borderRadius='6px'; tip.style.fontSize='12px'; tip.style.display='none'; document.body.appendChild(tip);

    overlay.on('mousemove touchmove', (ev)=>{
      const [mx] = d3.pointer(ev);
      const vx = xScale.invert(mx);
      const i = Math.max(0, Math.min(pts.length-1, bis(pts, vx)));
      const p = pts[i]; if(!p || p._val==null) { dot.style('display','none'); tip.style.display='none'; return; }
      dot.style('display',null).attr('cx', xScale(p.TIME_UTC_SECONDS)).attr('cy', yScale(p._val));
      const rect = wrap.getBoundingClientRect();
      tip.style.left = (rect.left + margin.left + xScale(p.TIME_UTC_SECONDS) + 12) + 'px';
      tip.style.top = (rect.top + margin.top + yScale(p._val) - 8) + 'px';
      tip.style.display = 'block';
      tip.innerHTML = `<strong>${varName}</strong><br/>time: ${new Date(p.TIME_UTC_SECONDS*1000).toISOString()}<br/>value: ${p._raw}`;
    }).on('mouseleave touchend', ()=>{ dot.style('display','none'); tip.style.display='none'; });
  }

  sel.addEventListener('change', draw);
  draw();
}

// call render after embedded weather load and when weather is fetched
function renderWeatherChartIfReady(){ try{ renderWeatherChart(); }catch(e){} }
const __origLoadWeather = loadWeatherFrom;
loadWeatherFrom = async function(url){ await __origLoadWeather(url); try{ renderWeatherChart(); }catch(e){} };
window.addEventListener('resize', ()=>{ try{ renderWeatherChart(); }catch(e){} });

document.addEventListener('DOMContentLoaded', ()=> {
  const a = readEmbeddedJSON('A_json'); if(Array.isArray(a)){ panelA.raw = a; panelA.prepareUI(); panelA.build(); }
  const b = readEmbeddedJSON('B_json'); if(Array.isArray(b)){ panelB.raw = b; panelB.prepareUI(); panelB.build(); }
  // load embedded weather JSON (if present) and render grid
  try{ loadWeatherFromEmbedded(); } catch(e){}
  // populate lap selector from loaded panels
  try{ if(typeof refreshLapOptions === 'function') refreshLapOptions(); }catch(e){}
  // show the A_json/B_json filenames under the car images
  try{
    function scriptFilename(el){ if(!el) return ''; const s = el.getAttribute('src'); if(s) return s.split('/').pop(); const txt = (el.textContent || '').trim(); return txt ? '(embedded)' : ''; }
    const aScript = document.getElementById('A_json'); const bScript = document.getElementById('B_json');
    const aCap = document.getElementById('A_json_name'); const bCap = document.getElementById('B_json_name');
    if(aCap) aCap.textContent = scriptFilename(aScript) || '';
    if(bCap) bCap.textContent = scriptFilename(bScript) || '';
  }catch(e){ /* non-fatal */ }
  // small console hints
  setTimeout(()=> { if(panelA.raw && panelA.raw.length && panelA.points.length===0) console.info('Panel A: loaded but no lat/lon points'); if(panelB.raw && panelB.raw.length && panelB.points.length===0) console.info('Panel B: loaded but no lat/lon points'); },200);
  // sync CSS --map-height to the rendered map wrapper height so side images match the map
  // debounce helper
  (function(){
    function setMapHeightVar(px){ document.documentElement.style.setProperty('--map-height', Math.round(px) + 'px'); }
    function syncMapHeight(){ const el = document.getElementById('mainMapWrap'); if(!el) return; const h = el.clientHeight || el.getBoundingClientRect().height || parseInt(getComputedStyle(el).height) || 0; if(h>0) setMapHeightVar(h); }
    syncMapHeightDebounced = (function(){ let t; return function(){ clearTimeout(t); t = setTimeout(syncMapHeight, 120); }; })();
    // run once and attach listeners
    syncMapHeightDebounced();
    window.addEventListener('resize', syncMapHeightDebounced);
    try{ mainMap.on('resize', syncMapHeightDebounced); } catch(e){}
  })();
  // sync control-box A height to weather center and control-box B
  (function(){
    function syncControlsWeatherHeight(){
      try{
        const allControls = Array.from(document.querySelectorAll('.panelControls'));
        if(!allControls || allControls.length === 0) return;
        // find left control (grid-column:1/2) and right control (grid-column:3/4)
        let left = allControls.find(el => (el.style && el.style.gridColumn && el.style.gridColumn.indexOf('1/2')>=0));
        let right = allControls.find(el => (el.style && el.style.gridColumn && el.style.gridColumn.indexOf('3/4')>=0));
        // fallback by order
        if(!left) left = allControls[0];
        if(!right) right = allControls.length>1 ? allControls[1] : allControls[0];
        const weather = document.querySelector('.weatherWrap');
        if(!left || !right || !weather) return;
        const h = Math.round(left.getBoundingClientRect().height);
        if(h && h>0){
          // set explicit heights so the center (weather_time + weatherGrid) and right control match left
          right.style.height = h + 'px';
          weather.style.height = h + 'px';
          // ensure weather children fill vertical space: weatherGrid already flex:1 in CSS
        }
        // also ensure the middle panel (between A and B) matches the taller of Panel A / Panel B
        try{
          const panelLeft = document.querySelector('.panel[style*="grid-column:1/2"][style*="grid-row:3/4"]');
          const panelRight = document.querySelector('.panel[style*="grid-column:3/4"][style*="grid-row:3/4"]');
          const mid = document.getElementById('mid_panel');
          if(panelLeft && panelRight && mid){
            const hL = Math.round(panelLeft.getBoundingClientRect().height);
            const hR = Math.round(panelRight.getBoundingClientRect().height);
            const hm = Math.max(hL || 0, hR || 0);
            if(hm > 0) mid.style.height = hm + 'px';
          }
        }catch(e){}
      }catch(e){ console.warn('syncControlsWeatherHeight failed', e); }
    }
    syncControlsWeatherHeightDebounced = (function(){ let t; return function(){ clearTimeout(t); t = setTimeout(syncControlsWeatherHeight, 80); }; })();
    // run once and attach listeners
    try{ syncControlsWeatherHeightDebounced(); }catch(e){}
    window.addEventListener('resize', syncControlsWeatherHeightDebounced);
  })();
});