  const urlInput = document.getElementById('urlInput');
    const loadBtn = document.getElementById('loadBtn');
    const timeFieldSel = document.getElementById('timeField');
    const lapSelect = document.getElementById('lapSelect');
    const latNameSel = document.getElementById('latName');
    const lonNameSel = document.getElementById('lonName');
    const coordsInDegrees = document.getElementById('coordsInDegrees');

    const playBtn = document.getElementById('playPause');
    const resetBtn = document.getElementById('reset');
    const rateSel = document.getElementById('rate');
    const slider = document.getElementById('timeSlider');

    const timeVal = document.getElementById('timeVal');
    const apsPct = document.getElementById('apsPct');
    const angleVal = document.getElementById('angleVal');
    const circle = document.getElementById('circle');
    const status = document.getElementById('status');

    const radialEl = document.getElementById('speedRadial');
    const radialProg = radialEl ? radialEl.querySelector('.prog') : null;
    const gearCenter = document.getElementById('gearCenter');
    const speedTextEl = document.getElementById('speedText');
    const RADIUS = 48;
    const CIRC = 2 * Math.PI * RADIUS;

    const apsBarFill = document.querySelector('#apsBar .fill');

    if (radialProg) {
      radialProg.setAttribute('stroke-dasharray', `${CIRC} ${CIRC}`);
      radialProg.setAttribute('stroke-dashoffset', `${CIRC}`);
    }
    if (apsBarFill) apsBarFill.style.height = '0%';
    if (speedTextEl) speedTextEl.textContent = '— km/h';

    const map = L.map('map').setView([0,0],2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(map);
    const polyAll = L.polyline([], {color:'#888', weight:2, opacity:0.6}).addTo(map);
    const polyTrace = L.polyline([], {color:getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()||'#1f77b4', weight:3}).addTo(map);
    const marker = L.circleMarker([0,0],{radius:6,color:'#d4472a',fill:true,fillOpacity:1}).addTo(map);

    let rawRows = [];
    let points = [];
    let maps = {};
    let anim = {playing:false,startIdx:0,endIdx:0,currentIdx:0,rate:1,raf:null,lastTime:null,accum:0};

    const speedCandidates = ['speed'];
    const apsCandidates = ['aps','APS','Throttle','Throttle_Pedal','throttle'];
    const gearCandidates = ['gear'];
    let speedKey = null;
    let maxSpeed = 200;
    let gearKey = null;

    function parseTimeToMs(v){
      if(v==null) return null;
      if(typeof v==='string'){ const p = Date.parse(v); return isNaN(p)?null:p; }
      if(typeof v==='number') return v>1e11?Math.floor(v):Math.floor(v*1000);
      return null;
    }
    function parseNum(v){ if(v==null||v==='') return NaN; const n=+v; return isFinite(n)?n:NaN; }
    function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function findMatch(set, candidates){
      const arr = Array.from(set).map(s=>({orig:s,norm:String(s).toLowerCase().replace(/[_\s-]+/g,'')}));
      for(const c of candidates){
        const t = c.toLowerCase().replace(/[_\s-]+/g,'');
        const f = arr.find(x=>x.norm===t); if(f) return f.orig;
      }
      for(const c of candidates){
        const t = c.toLowerCase().replace(/[_\s-]+/g,'');
        const f = arr.find(x=>x.norm.includes(t)); if(f) return f.orig;
      }
      return null;
    }

    // deterministic color per name: hash -> hue
    function nameToColor(name){
      let h = 0;
      for(let i=0;i<name.length;i++){ h = ((h<<5) - h) + name.charCodeAt(i); h |= 0; }
      const hue = (Math.abs(h) % 360);
      return `hsl(${hue},100%,45%)`;
    }

    async function loadUrl(){
      const url = (urlInput.value || '').trim();
      if(!url){ status.textContent = 'Enter a JSON filename/URL (served by http).'; return; }
      try{
        const j = await fetch(url).then(r=>r.json());
        if(!Array.isArray(j)){ status.textContent = 'JSON must be an array of telemetry rows.'; return; }
        rawRows = j;
        prepareUIFromRows();
        buildRouteAndMaps();
        status.textContent = `Loaded ${rawRows.length} rows.`;
      }catch(e){
        console.error(e); status.textContent = 'Failed to fetch/parse JSON (check CORS / server).';
      }
    }
    loadBtn.onclick = loadUrl;

    function prepareUIFromRows(){
      const telemetry = new Set();
      const laps = new Set();
      const timeFields = new Set();
      rawRows.forEach(r=>{
        if(r.telemetry_name) telemetry.add(String(r.telemetry_name));
        if(r.name) telemetry.add(String(r.name));
        if(r.lap!==undefined && r.lap!==null) laps.add(String(r.lap));
        if(r.meta_time!==undefined) timeFields.add('meta_time');
        if(r.timestamp!==undefined) timeFields.add('timestamp');
        if(r.time!==undefined) timeFields.add('time');
      });

      const sortedLaps = Array.from(laps).sort((a,b) => {
        const na = Number(a), nb = Number(b);
        if (isFinite(na) && isFinite(nb)) return na - nb;
        return String(a).localeCompare(String(b));
      });
      lapSelect.innerHTML = '<option value="All">All</option>' + sortedLaps.map(l=>`<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');
      timeFieldSel.innerHTML = (Array.from(timeFields).length ? Array.from(timeFields).map(t=>`<option value="${t}">${t}</option>`).join('') : '<option value="meta_time">meta_time</option><option value="timestamp">timestamp</option>');
      // restrict Lat/Lon selectors to the canonical VBOX field names
      latNameSel.innerHTML = '<option value="VBOX_Lat_Min">VBOX_Lat_Min</option>';
      lonNameSel.innerHTML = '<option value="VBOX_Long_Minutes">VBOX_Long_Minutes</option>';
      latNameSel.value = 'VBOX_Lat_Min';
      lonNameSel.value = 'VBOX_Long_Minutes';

      [timeFieldSel, lapSelect, latNameSel, lonNameSel, coordsInDegrees].forEach(el => el.onchange = buildRouteAndMaps);
    }

    function buildRouteAndMaps(){
      maps = {};
      const selectedLap = (lapSelect.value === 'All') ? 'All' : lapSelect.value;
      rawRows.forEach(r=>{
        const lk = (r.lap !== undefined && r.lap !== null) ? String(r.lap) : 'all';
        if(selectedLap !== 'All' && lk !== selectedLap) return;
        const name = r.telemetry_name ?? r.name;
        if(!name) return;
        const tRaw = r[timeFieldSel.value] ?? r.meta_time ?? r.timestamp ?? r.time;
        const tMs = parseTimeToMs(tRaw);
        if(tMs==null) return;
        const valRaw = r.telemetry_value ?? r.value;
        const v = parseNum(valRaw);
        maps[name] = maps[name] || new Map();
        maps[name].set(tMs, v);
      });

      const mapKeys = Object.keys(maps);
      speedKey = findMatch(mapKeys, speedCandidates);
      const apsKey = findMatch(mapKeys, apsCandidates);
      gearKey = findMatch(mapKeys, gearCandidates);

      if(speedKey && maps[speedKey]){
        const vals = Array.from(maps[speedKey].values()).filter(v=>Number.isFinite(v)).map(v=>Math.abs(v));
        if(vals.length) maxSpeed = Math.max(30, Math.ceil(Math.max(...vals) / 10) * 10);
        else maxSpeed = 200;
      } else { speedKey = null; maxSpeed = 200; }

      const latName = latNameSel.value;
      const lonName = lonNameSel.value;
      const latMap = maps[latName] || new Map();
      const lonMap = maps[lonName] || new Map();

      const commonTimes = Array.from(latMap.keys()).filter(t=>lonMap.has(t)).sort((a,b)=>a-b);
      points = commonTimes.map(t=>{
        let lat = latMap.get(t), lon = lonMap.get(t);
        if(!coordsInDegrees.checked){ lat = lat/60; lon = lon/60; }
        return {tMs:t, lat:lat, lon:lon};
      });

      if(points.length===0){
        polyAll.setLatLngs([]); polyTrace.setLatLngs([]); marker.setLatLng([0,0]); map.setView([0,0],2);
        status.textContent = 'No matched lat/lon points for selected fields/lap/time.';
        slider.min = 0; slider.max = 0; slider.value = 0;
        anim.startIdx = anim.endIdx = anim.currentIdx = 0;
        updateSpeedRadial(null);
        updateApsBar(null);
        if (gearCenter) gearCenter.textContent = '—';
        return;
      }

      const coords = points.map(p=>[p.lat, p.lon]);
      polyAll.setLatLngs(coords);
      polyTrace.setLatLngs([]);
      marker.setLatLng(coords[0]);
      marker.bindPopup(new Date(points[0].tMs).toISOString());
      map.fitBounds(polyAll.getBounds().pad(0.05));

      anim.startIdx = 0; anim.endIdx = points.length-1; anim.currentIdx = 0;
      slider.min = 0; slider.max = anim.endIdx; slider.step = 1; slider.value = 0;
      anim.accum = 0; anim.lastTime = null; anim.playing = false; playBtn.textContent = 'Play';
      updateDisplayForIndex(0);
      status.textContent = `${points.length} points — lat:${latName} lon:${lonName}`;
    }

    function updateSpeedRadial(v){
      if(v==null || !Number.isFinite(v)){
        if (speedTextEl) speedTextEl.textContent = '— km/h';
        if (radialProg) radialProg.setAttribute('stroke-dashoffset', `${CIRC}`);
        return;
      }
      const pct = Math.max(0, Math.min(1, v / maxSpeed));
      const offset = CIRC * (1 - pct);
      if (radialProg) radialProg.setAttribute('stroke-dashoffset', `${offset}`);
      if (speedTextEl) speedTextEl.textContent = (Number.isFinite(v) ? v.toFixed(1) + ' km/h' : String(v));
    }

    function updateApsBar(v){
      if(v==null || !Number.isFinite(v)){
        if(apsBarFill) apsBarFill.style.height = '0%';
        if(apsPct) apsPct.textContent = '—';
        return;
      }
      let pct = v;
      if (Math.abs(pct) <= 1.001) pct = pct * 100;
      pct = Math.max(0, Math.min(100, pct));
      if(apsBarFill) apsBarFill.style.height = pct + '%';
      if(apsPct) apsPct.textContent = Math.round(pct) + '%';
    }

    function getTelemetryAt(name, tMs){
      const m = maps[name];
      if(!m) return null;
      const v = m.get(tMs);
      return (v===undefined || Number.isNaN(v)) ? null : v;
    }

    function updateDisplayForIndex(idx){
      if(!points || points.length===0) return;
      idx = Math.max(0, Math.min(points.length-1, idx));
      const p = points[idx];
      marker.setLatLng([p.lat, p.lon]);
      const traced = points.slice(0, idx+1).map(d=>[d.lat,d.lon]);
      polyTrace.setLatLngs(traced);
      slider.value = idx;

      timeVal.textContent = new Date(p.tMs).toISOString();

      const steeringNames = ['Steering_Angle','steeringangle','steer_angle','steering'];
      const steeringKey = findMatch(Object.keys(maps), steeringNames);
      const apsKey = findMatch(Object.keys(maps), apsCandidates);

      const sp = speedKey ? getTelemetryAt(speedKey, p.tMs) : null;
      const ang = steeringKey ? getTelemetryAt(steeringKey, p.tMs) : null;
      const apsv = apsKey ? getTelemetryAt(apsKey, p.tMs) : null;
      const gearv = gearKey ? getTelemetryAt(gearKey, p.tMs) : null;

      angleVal.textContent = (ang==null) ? '—' : (Number.isFinite(ang) ? ang.toFixed(1) + '°' : String(ang));
      if(Number.isFinite(ang)) circle.style.transform = `rotate(${ang}deg)`; else circle.style.transform = 'none';

      updateSpeedRadial(sp);
      updateApsBar(apsv);

      if (gearCenter) gearCenter.textContent = (gearv==null) ? '—' : String(gearv);

      marker.bindPopup(`${new Date(p.tMs).toISOString()}<br>${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`);

      if(window.weatherPoints && window.weatherPoints.length>0){
        const sec = Math.floor(p.tMs/1000);
        jumpWeatherToTime(sec);
      }
    }

    function step(now){
      if(!anim.playing){ anim.raf = null; anim.lastTime = null; return; }
      if(anim.lastTime==null) anim.lastTime = now;
      const dt = now - anim.lastTime; anim.lastTime = now;
      anim.accum += (dt/1000) * anim.rate;
      const advance = Math.floor(anim.accum);
      if(advance >= 1){
        anim.currentIdx = Math.min(anim.endIdx, anim.currentIdx + advance);
        anim.accum -= advance;
        updateDisplayForIndex(anim.currentIdx);
      }
      if(anim.currentIdx >= anim.endIdx){
        anim.playing = false; playBtn.textContent = 'Play'; anim.raf = null; anim.lastTime = null; return;
      }
      anim.raf = requestAnimationFrame(step);
    }

    const weatherVars = ['AIR_TEMP','TRACK_TEMP','HUMIDITY','PRESSURE','WIND_SPEED','WIND_DIRECTION','RAIN','TIME_UTC_STR','TIME_UTC_SECONDS'];
    const weatherGrid = document.getElementById('weatherGrid');
    const weatherRate = document.getElementById('weatherRate');

    function buildWeatherCells(){
      weatherGrid.innerHTML = '';
      const timeDiv = document.createElement('div');
      timeDiv.className = 'weatherTime';
      timeDiv.id = 'weatherTime';
      timeDiv.textContent = '—';
      weatherGrid.appendChild(timeDiv);
      for(const v of weatherVars){
        const c = document.createElement('div');
        // give the weather cell the same box styling used in dash.html
        c.className = 'box weatherCell';
        c.dataset.var = v;
        // set deterministic accent color per variable so ::before stripe uses it
        const col = nameToColor(v);
        c.style.setProperty('--accent', col);
        c.innerHTML = `<div class="name">${v}</div><div class="value" id="wv_${v}">—</div><div class="meta"></div>`;
        weatherGrid.appendChild(c);
      }
    }
    buildWeatherCells();

    window.weatherPoints = [];
    let weatherAnim = {playing:false, idx:0, raf:null, lastTime:null, accum:0, rate:1};

    async function loadWeather(){
      try{
        const r = await fetch('Barber_Data_JSON_UPDATED/26_Weather_Race 1_Anonymized.json');
        if(!r.ok) throw new Error('not ok');
        const j = await r.json();
        window.weatherPoints = j.map(o => Object.assign({}, o, {TIME_UTC_SECONDS: Number(o.TIME_UTC_SECONDS)}))
                         .sort((a,b)=> (a.TIME_UTC_SECONDS||0) - (b.TIME_UTC_SECONDS||0));
        weatherAnim.idx = 0;
        updateWeatherDisplay(0);
      }catch(e){
        console.warn('weather load failed', e);
      }
    }
    loadWeather();

    function updateWeatherDisplay(i){
      if(!window.weatherPoints || window.weatherPoints.length===0) return;
      i = Math.max(0, Math.min(window.weatherPoints.length-1, i));
      const p = window.weatherPoints[i];
      document.getElementById('weatherTime').textContent = String(p.TIME_UTC_STR ?? p.TIME_UTC_SECONDS ?? '');
      for(const v of weatherVars){
        const el = document.getElementById('wv_' + v);
        if(!el) continue;
        const val = p[v];
        el.textContent = (val === null || val === undefined) ? '—' : String(val);
        // update meta inside the same box
        const box = el.closest('.box');
        if(box){
          const meta = box.querySelector('.meta');
          if(meta) meta.textContent = (p.TIME_UTC_STR) ? String(p.TIME_UTC_STR) : '';
        }
      }
      weatherAnim.idx = i;
    }

    function jumpWeatherToTime(seconds){
      if(!window.weatherPoints || window.weatherPoints.length===0) return;
      const idx = window.weatherPoints.findIndex(p => (p.TIME_UTC_SECONDS||0) >= Number(seconds));
      const use = idx === -1 ? (window.weatherPoints.length-1) : idx;
      updateWeatherDisplay(use);
    }
    window.jumpWeatherToTime = jumpWeatherToTime;

    function weatherStep(now){
      if(!weatherAnim.playing){ weatherAnim.raf = null; weatherAnim.lastTime = null; return; }
      if(weatherAnim.lastTime == null) weatherAnim.lastTime = now;
      const dt = now - weatherAnim.lastTime; weatherAnim.lastTime = now;
      weatherAnim.accum += (dt/1000) * weatherAnim.rate;
      const adv = Math.floor(weatherAnim.accum);
      if(adv >= 1){
        weatherAnim.idx = Math.min(window.weatherPoints.length-1, weatherAnim.idx + adv);
        weatherAnim.accum -= adv;
        updateWeatherDisplay(weatherAnim.idx);
      }
      if(weatherAnim.idx >= window.weatherPoints.length-1){
        weatherAnim.playing = false; playBtn.textContent = 'Play'; weatherAnim.raf = null; weatherAnim.lastTime = null; return;
      }
      weatherAnim.raf = requestAnimationFrame(weatherStep);
    }

    playBtn.onclick = () => {
      const hasTelemetry = points && points.length>0;
      const hasWeather = window.weatherPoints && window.weatherPoints.length>0;
      if(!hasTelemetry && !hasWeather) return;
      const anyPlaying = (anim.playing || weatherAnim.playing);
      if(anyPlaying){
        if(anim.playing){ anim.playing = false; if(anim.raf) cancelAnimationFrame(anim.raf); anim.raf = null; anim.lastTime = null; }
        if(weatherAnim.playing){ weatherAnim.playing = false; if(weatherAnim.raf) cancelAnimationFrame(weatherAnim.raf); weatherAnim.raf = null; weatherAnim.lastTime = null; }
        playBtn.textContent = 'Play';
      } else {
        if(hasTelemetry && anim.startIdx !== anim.endIdx){
          anim.playing = true;
          anim.rate = +rateSel.value;
          anim.accum = 0; anim.lastTime = null;
          anim.raf = requestAnimationFrame(step);
        }
        if(hasWeather && !hasTelemetry){
          weatherAnim.playing = true;
          weatherAnim.rate = Number(weatherRate.value || 1);
          weatherAnim.accum = 0; weatherAnim.lastTime = null;
          weatherAnim.raf = requestAnimationFrame(weatherStep);
        }
        playBtn.textContent = 'Pause';
      }
    };

    resetBtn.onclick = () => {
      anim.playing = false;
      if(anim.raf) cancelAnimationFrame(anim.raf);
      anim.raf = null; anim.lastTime = null;
      anim.currentIdx = anim.startIdx; updateDisplayForIndex(anim.currentIdx);
      weatherAnim.playing = false;
      if(weatherAnim.raf) cancelAnimationFrame(weatherAnim.raf);
      weatherAnim.raf = null; weatherAnim.lastTime = null;
      weatherAnim.idx = 0; updateWeatherDisplay(0);
      playBtn.textContent = 'Play';
    };

    slider.oninput = (e) => {
      anim.currentIdx = +e.target.value;
      updateDisplayForIndex(anim.currentIdx);
    };

    urlInput.value = "https://fulxwiizgkbyspqyluzc.supabase.co/storage/v1/object/sign/racingfiles/vehicle_5_test_laps_2_3_4.json?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV83MDA1NzQ3OC1mMDg3LTRlZTktYTRhNy03M2QzNmNlNzYyNTgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJyYWNpbmdmaWxlcy92ZWhpY2xlXzVfdGVzdF9sYXBzXzJfM180Lmpzb24iLCJpYXQiOjE3NjM4NTE4MDgsImV4cCI6MTc2NjQ0MzgwOH0.MXWpuL7aRSh98n1bTXkHotWhjmSlpQ826RSny3JGaz0";