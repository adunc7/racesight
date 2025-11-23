 // single-html Leaflet playback: load a single telemetry JSON (array-of-rows)
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

      const status = document.getElementById('status');
      const grid = document.getElementById('grid');

      const map = L.map('map').setView([0,0],2);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(map);
      const polyAll = L.polyline([], {color:'#888', weight:2, opacity:0.6}).addTo(map);
      const polyTrace = L.polyline([], {color:'#1f77b4', weight:3}).addTo(map);
      const marker = L.circleMarker([0,0],{radius:6,color:'#d4472a',fill:true,fillOpacity:1}).addTo(map);

      let rawRows = [];
      let points = []; // ordered points where lat&lon both present at same timestamp
      let maps = {};   // telemetry_name -> Map(tMs -> value)
      let keysSorted = []; // telemetry keys for box ordering
      let anim = {playing:false,startIdx:0,endIdx:0,currentIdx:0,rate:1,raf:null,lastTime:null,accum:0};

      function parseTimeToMs(v){
        if(v==null) return null;
        if(typeof v==='string'){ const p = Date.parse(v); return isNaN(p)?null:p; }
        if(typeof v==='number') return v>1e11?Math.floor(v):Math.floor(v*1000);
        return null;
      }
      function parseNum(v){ if(v==null||v==='') return NaN; const n=+v; return isFinite(n)?n:NaN; }

      function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

      // auto-detect favorable telemetry names
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
        return `hsl(${hue} 70% 45%)`;
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

        // sort laps numerically when possible
        const sortedLaps = Array.from(laps).sort((a,b) => {
          const na = Number(a), nb = Number(b);
          if (isFinite(na) && isFinite(nb)) return na - nb;
          return String(a).localeCompare(String(b));
        });
        lapSelect.innerHTML = '<option value="All">All</option>' + sortedLaps.map(l=>`<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join('');

        timeFieldSel.innerHTML = (Array.from(timeFields).length ? Array.from(timeFields).map(t=>`<option value="${t}">${t}</option>`).join('') : '<option value="meta_time">meta_time</option><option value="timestamp">timestamp</option>');

        // Force Lat/Lon selects to the canonical VBOX field names (matching compare-drivers behaviour)
        latNameSel.innerHTML = '<option value="VBOX_Lat_Min">VBOX_Lat_Min</option>';
        lonNameSel.innerHTML = '<option value="VBOX_Long_Minutes">VBOX_Long_Minutes</option>';
        latNameSel.value = 'VBOX_Lat_Min';
        lonNameSel.value = 'VBOX_Long_Minutes';

        // Wire most controls to rebuild the route/maps when changed.
        [timeFieldSel, latNameSel, lonNameSel, coordsInDegrees].forEach(el => el.onchange = buildRouteAndMaps);
        // For lapSelect, rebuild and then autoplay the selected lap (makes selecting a lap immediately play it)
        lapSelect.onchange = () => { buildRouteAndMaps(); if(points && points.length) startPlayback(); };
      }

      function buildRouteAndMaps(){
        // build maps for each telemetry_name -> Map(tMs -> value)
        maps = {};
        const selectedLap = lapSelect.value === 'All' ? 'All' : lapSelect.value;
        rawRows.forEach(r=>{
          // If a lap is selected, only include rows from that lap
          const rowLap = (r.lap !== undefined && r.lap !== null) ? String(r.lap) : 'all';
          if(selectedLap !== 'All' && rowLap !== selectedLap) return;
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

        // prepare keys (all telemetry names) for boxes
        keysSorted = Object.keys(maps).sort((a,b)=> a.localeCompare(b, undefined, {sensitivity:'base', numeric:true}));

        renderBoxes();

        // build lat/lon matched timestamps for map trace
        const latName = latNameSel.value;
        const lonName = lonNameSel.value;
        const latMap = maps[latName] || new Map();
        const lonMap = maps[lonName] || new Map();

        const commonTimes = Array.from(latMap.keys()).filter(t=>lonMap.has(t)).sort((a,b)=>a-b);
        points = commonTimes.map(t=>{
          let lat = latMap.get(t), lon = lonMap.get(t);
          // checked = coordinates already in degrees; when unchecked, convert minutes->degrees
          if(!coordsInDegrees.checked){
            lat = lat/60; lon = lon/60;
          }
          return {tMs:t, lat:lat, lon:lon};
        });

        if(points.length===0){
          polyAll.setLatLngs([]); polyTrace.setLatLngs([]); marker.setLatLng([0,0]); map.setView([0,0],2);
          status.textContent = 'No matched lat/lon points for selected fields/lap/time.';
          slider.min = 0; slider.max = 0; slider.value = 0;
          anim.startIdx = anim.endIdx = anim.currentIdx = 0;
          updateBoxesForTime(null);
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

      // Start playback from the current startIdx. Resets index to start and begins RAF loop.
      function startPlayback(){
        if(!points || points.length===0) return;
        // position at start and begin playing
        anim.currentIdx = anim.startIdx;
        updateDisplayForIndex(anim.currentIdx);
        if(anim.raf) cancelAnimationFrame(anim.raf);
        anim.rate = +rateSel.value;
        anim.accum = 0;
        anim.lastTime = null;
        anim.playing = true;
        playBtn.textContent = 'Pause';
        anim.raf = requestAnimationFrame(step);
      }

      // build DOM boxes for all telemetry keys
      function renderBoxes(){
        grid.innerHTML = '';
        keysSorted.forEach(name => {
          const box = document.createElement('div');
          box.className = 'box';
          box.dataset.name = name;
          //box.innerHTML = `<div class="name">${escapeHtml(name)}</div>
           //                <div class="value" aria-live="polite"></div>
           //                <div class="meta"></div>`;


          // set a unique accent color per box (deterministic from name)
          const color = nameToColor(name);
          box.style.setProperty('--accent', color);
          box.innerHTML = `<div class="name">${escapeHtml(name)}</div>
                           <div class="value" aria-live="polite"></div>
                           <div class="meta"></div>`;

          grid.appendChild(box);
        });
      }

      // set all boxes values for exact timestamp (or blank if none)
      function updateBoxesForTime(tMs){
        // tMs can be null to clear
        keysSorted.forEach(name => {
          const box = grid.querySelector(`.box[data-name="${CSS.escape(name)}"]`);
          if(!box) return;
          const valEl = box.querySelector('.value');
          const metaEl = box.querySelector('.meta');
          if(tMs == null){
            valEl.textContent = '';
            metaEl.textContent = '';
            valEl.dataset.last = '';
            return;
          }
          const m = maps[name];
          const v = m ? m.get(tMs) : undefined;
          if(v === undefined || Number.isNaN(v)){
            // explicit blank when no exact timestamp value
            if(valEl.dataset.last !== ''){ valEl.textContent = ''; valEl.dataset.last = ''; metaEl.textContent = ''; }
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
      }

      function updateDisplayForIndex(idx){
        if(!points || points.length===0){
          updateBoxesForTime(null);
          return;
        }
        idx = Math.max(0, Math.min(points.length-1, idx));
        const p = points[idx];
        marker.setLatLng([p.lat, p.lon]);
        const traced = points.slice(0, idx+1).map(d=>[d.lat,d.lon]);
        polyTrace.setLatLngs(traced);
        slider.value = idx;

        // update map info area
        status.textContent = `${points.length} pts • ${idx+1}/${points.length} • ${new Date(p.tMs).toISOString()}`;

        // update boxes for this exact timestamp
        updateBoxesForTime(p.tMs);
      }

      // animation loop (index-based)
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

      // controls
      playBtn.onclick = () => {
        if(!points || points.length===0) return;
        if(anim.playing){
          anim.playing = false; playBtn.textContent = 'Play';
          if(anim.raf) cancelAnimationFrame(anim.raf);
        } else {
          if(anim.startIdx === anim.endIdx) return;
          anim.playing = true; playBtn.textContent = 'Pause';
          anim.rate = +rateSel.value;
          anim.accum = 0; anim.lastTime = null;
          anim.raf = requestAnimationFrame(step);
        }
      };
      resetBtn.onclick = () => {
        anim.playing = false; playBtn.textContent = 'Play';
        if(anim.raf) cancelAnimationFrame(anim.raf);
        anim.currentIdx = anim.startIdx; updateDisplayForIndex(anim.currentIdx);
      };
      slider.oninput = (e) => { anim.currentIdx = +e.target.value; updateDisplayForIndex(anim.currentIdx); };

      // quick helper to prefill default filename (user must click Load)
      urlInput.value = "https://fulxwiizgkbyspqyluzc.supabase.co/storage/v1/object/sign/racingfiles/vehicle_5_test_laps_2_3_4.json?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV83MDA1NzQ3OC1mMDg3LTRlZTktYTRhNy03M2QzNmNlNzYyNTgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJyYWNpbmdmaWxlcy92ZWhpY2xlXzVfdGVzdF9sYXBzXzJfM180Lmpzb24iLCJpYXQiOjE3NjM4NTE4MDgsImV4cCI6MTc2NjQ0MzgwOH0.MXWpuL7aRSh98n1bTXkHotWhjmSlpQ826RSny3JGaz0";