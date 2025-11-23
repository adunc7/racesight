      // Optional View 3 - Telemetry Graphs JS code

      const urlInput = document.getElementById('urlInput');
      const loadBtn = document.getElementById('loadBtn');
      const timeFieldSel = document.getElementById('timeField');
      const lapSelect = document.getElementById('lapSelect');
      const latNameSel = document.getElementById('latName');
      const lonNameSel = document.getElementById('lonName');
      const coordsInDegrees = document.getElementById('coordsInDegrees');
      const variablePlotSel = document.getElementById('variablePlot');

      const playBtn = document.getElementById('playPause');
      const resetBtn = document.getElementById('reset');
      const rateSel = document.getElementById('rate');
      const slider = document.getElementById('timeSlider');

      const status = document.getElementById('status');

      const map = L.map('map').setView([0,0],2);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(map);
      const polyAll = L.polyline([], {color:'#888', weight:2, opacity:0.6}).addTo(map);
      const polyTrace = L.polyline([], {color:'#1f77b4', weight:3}).addTo(map);
      const marker = L.circleMarker([0,0],{radius:6,color:'#d4472a',fill:true,fillOpacity:1}).addTo(map);

      let rawRows = [];
      let points = []; // ordered points where lat&lon both present at same timestamp
      let maps = {};   // telemetry_name -> Map(tMs -> value)
      let anim = {playing:false,startIdx:0,endIdx:0,currentIdx:0,rate:1,raf:null,lastTime:null,accum:0};

      // D3 chart setup
      const chartNode = d3.select('#chart');
      const CH_W = 1100, CH_H = 240, CH_M = {top:12,right:20,bottom:36,left:60};
      const chInnerW = CH_W - CH_M.left - CH_M.right, chInnerH = CH_H - CH_M.top - CH_M.bottom;
      const svg = chartNode.append('svg').attr('viewBox', `0 0 ${CH_W} ${CH_H}`).style('width','100%').style('height','260px');
      const chG = svg.append('g').attr('transform', `translate(${CH_M.left},${CH_M.top})`);
      const xG = chG.append('g').attr('transform', `translate(0,${chInnerH})`);
      const yG = chG.append('g');
      const xLabel = chG.append('text').attr('x', chInnerW/2).attr('y', chInnerH + 30).attr('text-anchor','middle');
      const yLabel = chG.append('text').attr('transform','rotate(-90)').attr('x', -chInnerH/2).attr('y', -45).attr('text-anchor','middle');

      const linePath = chG.append('path').attr('fill','none').attr('stroke','steelblue').attr('stroke-width',1.6);
      const ptsG = chG.append('g').attr('class','points');
      const cursorG = chG.append('g').attr('class','cursor');

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

        const list = Array.from(telemetry).sort();
        // Force Lat/Lon selects to the canonical VBOX names per user request
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

        // variable selection
        const varList = Object.keys(maps).sort((a,b)=> a.localeCompare(b, undefined, {sensitivity:'base', numeric:true}));
        const prevVar = variablePlotSel.value;
        variablePlotSel.innerHTML = varList.map(k=>`<option value="${escapeHtml(k)}">${escapeHtml(k)}</option>`).join('');
        if(varList.length){
          const restore = (prevVar && varList.includes(prevVar)) ? prevVar : varList[0];
          variablePlotSel.value = restore;
        } else {
          variablePlotSel.value = '';
        }
        variablePlotSel.onchange = ()=> updateChartData(variablePlotSel.value);

        updateChartData(variablePlotSel.value);

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
          updateChartData(null);
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

      // chart series and scales
      let chartSeries = [];
      let xScale = d3.scaleUtc().range([0,chInnerW]);
      let yScale = d3.scaleLinear().range([chInnerH,0]);

      function updateChartData(varName){
        if(!varName || !maps[varName]){ chartSeries = []; linePath.attr('d', null); ptsG.selectAll('*').remove(); cursorG.selectAll('*').remove(); xG.call(d3.axisBottom(xScale)); yG.call(d3.axisLeft(yScale)); return; }
        const arr = Array.from(maps[varName].entries()).map(([ms,v]) => ({t: new Date(ms), ms:+ms, val: v})).sort((a,b)=>a.ms - b.ms);
        chartSeries = arr;
        if(chartSeries.length === 0){
          linePath.attr('d', null); ptsG.selectAll('*').remove(); cursorG.selectAll('*').remove(); return;
        }
        const xDom = [new Date(chartSeries[0].ms), new Date(chartSeries[chartSeries.length-1].ms)];
        const vals = chartSeries.map(d=>d.val).filter(v=>Number.isFinite(v));
        const yDom = vals.length ? d3.extent(vals) : [0,1];
        xScale.domain(xDom).nice();
        yScale.domain(yDom).nice();

        xG.call(d3.axisBottom(xScale).ticks(6).tickFormat(d3.utcFormat('%H:%M:%S')));
        yG.call(d3.axisLeft(yScale).ticks(5));
        xLabel.text(varName + ' vs time');
        yLabel.text(varName);

        const lineGen = d3.line().defined(d=>d.t && Number.isFinite(d.val)).x(d=>xScale(d.t)).y(d=>yScale(d.val));
        linePath.datum(chartSeries).attr('d', lineGen);
        const sel = ptsG.selectAll('circle').data(chartSeries.filter(d=>Number.isFinite(d.val)), d=>d.ms);
        sel.exit().remove();
        sel.enter().append('circle').attr('r',0).attr('fill','steelblue').attr('stroke','#fff').attr('stroke-width',0.6)
          .merge(sel).attr('cx', d=>xScale(d.t)).attr('cy', d=>yScale(d.val)).attr('r', 3.2);
        cursorG.selectAll('*').remove();
        cursorG.append('line').attr('class','cursorLine').attr('y1',0).attr('y2',chInnerH).attr('stroke','orange').attr('stroke-dasharray','4 3').attr('x1',0).attr('x2',0);
        cursorG.append('circle').attr('r',5).attr('fill','orange').attr('stroke','#fff').attr('stroke-width',0.8).attr('cx',0).attr('cy',0).style('display','none');
      }

      function updateChartToMs(ms){
        if(!ms){ cursorG.selectAll('.cursorLine').attr('x1',0).attr('x2',0); return; }
        const x = xScale ? xScale(new Date(ms)) : 0;
        cursorG.selectAll('line.cursorLine').attr('x1', x).attr('x2', x);
        if(!chartSeries || chartSeries.length===0){ cursorG.selectAll('circle').style('display','none'); return; }
        const found = chartSeries.find(d => d.ms === +ms && Number.isFinite(d.val));
        if(found){
          cursorG.selectAll('circle').style('display','block').attr('cx', x).attr('cy', yScale(found.val));
        } else {
          cursorG.selectAll('circle').style('display','none');
        }
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

        // keep marker popup informative
        marker.bindPopup(`${new Date(p.tMs).toISOString()}<br>${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`);

        // update chart cursor only (panel removed)
        updateChartToMs(p.tMs);
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

      // prefill default filename (user must click Load)
      urlInput.value = "https://fulxwiizgkbyspqyluzc.supabase.co/storage/v1/object/sign/racingfiles/vehicle_5_test_laps_2_3_4.json?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV83MDA1NzQ3OC1mMDg3LTRlZTktYTRhNy03M2QzNmNlNzYyNTgiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJyYWNpbmdmaWxlcy92ZWhpY2xlXzVfdGVzdF9sYXBzXzJfM180Lmpzb24iLCJpYXQiOjE3NjM4NTE4MDgsImV4cCI6MTc2NjQ0MzgwOH0.MXWpuL7aRSh98n1bTXkHotWhjmSlpQ826RSny3JGaz0";