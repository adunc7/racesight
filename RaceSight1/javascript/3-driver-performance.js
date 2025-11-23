// minimal nav click handlers (no page reload)
    //document.getElementById('nav-home').addEventListener('click', e => { e.preventDefault(); alert('Home clicked'); });
    //document.getElementById('nav-about').addEventListener('click', e => { e.preventDefault(); alert('About clicked'); });
    //document.getElementById('nav-contact').addEventListener('click', e => { e.preventDefault(); alert('Contact clicked'); });

    // existing plotting script follows (modified to support axis selectors)
    function parseTimeVal(v) {
      if (v === null || v === undefined) return NaN;
      if (typeof v === 'number') return v;
      const s = String(v).trim();
      if (s === '' || s.toLowerCase() === 'nan' || s.toLowerCase() === 'none') return NaN;
      if (s.includes(':')) {
        const parts = s.split(':').map(x => x.trim());
        if (parts.length === 2) return (+parts[0]) * 60 + (+parts[1]);
        if (parts.length === 3) return (+parts[0]) * 3600 + (+parts[1]) * 60 + (+parts[2]);
      }
      const n = parseFloat(s);
      return isNaN(n) ? NaN : n;
    }

    d3.json("/Barber_Data_JSON_UPDATED/23_AnalysisEnduranceWithSections_Race 1_Anonymized.json").then(raw => {
      if (!raw || !raw.length) { console.error('No data loaded'); return; }

      const normalized = raw.map(obj => {
        const o = {};
        Object.entries(obj).forEach(([k,v]) => o[k.trim()] = v);
        if (o.NUMBER != null) {
          const n = Number(o.NUMBER);
          o.NUMBER = isNaN(n) ? o.NUMBER : n;
        }
        return o;
      });

      const sampleKeys = Object.keys(normalized[0] || {});
      // detect a FLAG_AT_FL-like column if present
      const flagKey = sampleKeys.find(k => k.toLowerCase() === 'flag_at_fl' || (k.toLowerCase().includes('flag') && k.toLowerCase().includes('fl'))) || null;
      const lapKey = sampleKeys.find(k => k.toLowerCase().includes('lap_number')) ||
                     sampleKeys.find(k => k.toLowerCase() === 'lap') ||
                     sampleKeys.find(k => k.toLowerCase().includes('lap')) || null;

      const imCandidates = ['IM1a_elapsed','IM1_elapsed','IM2a_elapsed','IM2_elapsed','IM3a_elapsed','FL_elapsed'];
      const imCols = sampleKeys.filter(k => {
        const kl = k.toLowerCase();
        return imCandidates.some(c => kl.indexOf(c.toLowerCase()) !== -1);
      });

      // detect numeric-ish columns (simple heuristic)
      const numericCols = sampleKeys.filter(k => {
        // if any non-NaN numeric or time-like value exists, consider numeric
        for (let i=0;i<normalized.length;i++){
          const v = normalized[i][k];
          if (v === null || v === undefined) continue;
          if (!isNaN(parseFloat(String(v)))) return true;
          if (String(v).includes(':')) {
            const t = parseTimeVal(v);
            if (!isNaN(t)) return true;
          }
        }
        return false;
      });

      // ensure NUMBER present in numericCols
      if (!numericCols.includes('NUMBER') && sampleKeys.includes('NUMBER')) numericCols.push('NUMBER');

      if (imCols.length === 0 && numericCols.length === 0) {
        console.error('No numeric / IM-like columns found. Keys:', sampleKeys);
        return;
      }

      const lapSet = new Set();
      if (lapKey) {
        normalized.forEach(r => {
          const rawVal = r[lapKey];
          if (rawVal === null || rawVal === undefined) return;
          const n = Number(rawVal);
          lapSet.add(isNaN(n) ? String(rawVal).trim() : n);
        });
      }
      const lapValues = Array.from(lapSet).sort((a,b) => (typeof a==='number' && typeof b==='number') ? a-b : String(a).localeCompare(String(b)));

      const lapSelect = d3.select('#lapSelect');
      lapValues.forEach(l => lapSelect.append('option').attr('value', l).text(l));

      const driverListDiv = d3.select('#driverList');
      const selectAllBtn = d3.select('#selectAll');
      const clearAllBtn = d3.select('#clearAll');
      const summary = d3.select('#summary');
      const tooltip = d3.select('#tooltip');

      const xSelect = d3.select('#xSelect');
      const ySelect = d3.select('#ySelect');

      // populate axis selects
      xSelect.append('option').attr('value','__all_im').text('All IM columns (each checkpoint as point)');
      imCols.forEach(c => xSelect.append('option').attr('value', c).text(c));
      // numeric columns not already in imCols
      numericCols.filter(c => !imCols.includes(c)).forEach(c => xSelect.append('option').attr('value', c).text(c));

      // Y axis options: prefer NUMBER first
      const yCandidates = Array.from(new Set(['NUMBER'].concat(numericCols)));
      yCandidates.forEach(c => ySelect.append('option').attr('value', c).text(c));

      // defaults
      xSelect.node().value = '__all_im';
      if (yCandidates.includes('NUMBER')) ySelect.node().value = 'NUMBER';
      else ySelect.node().value = yCandidates[0];

      const plotSvg = d3.select('#plotSvg');
      const fullWidth = plotSvg.node().getBoundingClientRect().width || parseInt(plotSvg.style('width'), 10) || 1000;
      const fullHeight = parseInt(plotSvg.attr('height'), 10) || 600;

      const margin = { top: 40, right: 20, bottom: 60, left: 70 };
      const width = fullWidth - margin.left - margin.right;
      const height = fullHeight - margin.top - margin.bottom;

      const svg = plotSvg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

      const plotG = svg.append('g').attr('class','plotG');
      const xAxisG = svg.append('g').attr('transform', `translate(0, ${height})`);
      const yAxisG = svg.append('g');
      svg.append('text').attr('class','axis-label x-label').attr('x', width/2).attr('y', height + 44).attr('text-anchor','middle');
      svg.append('text').attr('class','axis-label y-label').attr('x', -height/2).attr('y', -50).attr('transform','rotate(-90)').attr('text-anchor','middle').text('Driver NUMBER');

      function buildPoints(rows) {
        const xVar = xSelect.node().value;
        const yVar = ySelect.node().value;
        const pts = [];
        rows.forEach(r => {
          // support number for filtering
          const drv = r.NUMBER != null ? +r.NUMBER : null;
          if (xVar === '__all_im') {
            imCols.forEach(col => {
              const xv = parseTimeVal(r[col]);
              const yv = parseFloat(r[yVar]);
              if (!isNaN(xv) && !isNaN(yv)) pts.push({ NUMBER: drv, x: xv, y: yv, Checkpoint: col, rawX: r[col], rawY: r[yVar] });
            });
          } else {
            const xv = parseTimeVal(r[xVar]);
            const yv = parseFloat(r[yVar]);
            if (!isNaN(xv) && !isNaN(yv)) pts.push({ NUMBER: drv, x: xv, y: yv, Checkpoint: xVar, rawX: r[xVar], rawY: r[yVar] });
          }
        });
        return pts;
      }

      const driverSet = new Set(normalized.map(d => d.NUMBER).filter(v => v != null));
      const drivers = Array.from(driverSet).sort((a,b)=>a-b);

      drivers.forEach(driver => {
        const id = `drv_${driver}`;
        const wrap = driverListDiv.append('div').attr('class','driver-checkbox');
        wrap.append('input').attr('type','checkbox').attr('id', id).attr('value', driver).property('checked', false);
        wrap.append('label').attr('for', id).text(driver);
      });

      function getSelectedDrivers() {
        const checked = Array.from(driverListDiv.selectAll('input').nodes()).filter(n => n.checked).map(n=>+n.value);
        return new Set(checked);
      }
      function setAllDriverCheckboxes(val) { driverListDiv.selectAll('input').property('checked', val); }
      setAllDriverCheckboxes(true);

      function colorForDrivers(driverArray) {
        const basePalette = [].concat(d3.schemeTableau10, d3.schemeSet3);
        if (driverArray.length <= basePalette.length) {
          return d3.scaleOrdinal().domain(driverArray).range(basePalette.slice(0, driverArray.length));
        } else {
          return d3.scaleOrdinal().domain(driverArray).range(driverArray.map((_,i)=>d3.interpolateRainbow(i/driverArray.length)));
        }
      }

      function render(selectedLap) {
        let rows = normalized;
        if (lapKey && selectedLap !== '__all') {
          rows = normalized.filter(r => {
            const val = r[lapKey];
            if (val === null || val === undefined) return false;
            const n = Number(val);
            return (!isNaN(n)) ? n === Number(selectedLap) : String(val).trim() === String(selectedLap);
          });
        }

        const points = buildPoints(rows);
        // update FLAG_AT_FL box (show unique values for the selected rows)
        (function updateFlagBox(rows){
          const el = d3.select('#flagAtFlVal');
          if(!el.node()) return;
          if(!flagKey){ el.text('n/a'); return; }
          const vals = new Set();
          rows.forEach(r => { const v = r[flagKey]; if(v !== undefined && v !== null && String(v).trim() !== '') vals.add(String(v)); });
          if(vals.size === 0) el.text('—');
          else if(vals.size === 1) el.text(Array.from(vals)[0]);
          else {
            const arr = Array.from(vals);
            const shown = arr.slice(0,3).join(', ');
            el.text(shown + (arr.length>3 ? ` (+${arr.length-3})` : ''));
          }
        })(rows);
        if (points.length === 0) {
          plotG.selectAll('*').remove();
          xAxisG.call(d3.axisBottom(d3.scaleLinear().range([0,width]).domain([0,1])));
          yAxisG.call(d3.axisLeft(d3.scaleLinear().range([height,0]).domain([0,1])));
          summary.text('No data for selection');
          d3.select('#legendContainer').html('');
          return;
        }

        const x = d3.scaleLinear().domain(d3.extent(points, d=>d.x)).nice().range([0,width]);
        const y = d3.scaleLinear().domain(d3.extent(points, d=>d.y)).nice().range([height,0]);

        xAxisG.transition().duration(250).call(d3.axisBottom(x));
        yAxisG.transition().duration(250).call(d3.axisLeft(y).tickFormat(d3.format('~g')));

        // set axis labels to selected names
        const xLabelText = xSelect.selectAll('option').nodes().find(n => n.value === xSelect.node().value)?.text || xSelect.node().value;
        const yLabelText = ySelect.selectAll('option').nodes().find(n => n.value === ySelect.node().value)?.text || ySelect.node().value;
        svg.select('.x-label').text(xLabelText);
        svg.select('.y-label').text(yLabelText);

        const selectedDrivers = Array.from(getSelectedDrivers());
        summary.text(`Drivers selected: ${selectedDrivers.length} / ${drivers.length}`);

        const color = colorForDrivers(drivers);
        const showSet = new Set(selectedDrivers.length ? selectedDrivers : drivers);
        const visible = points.filter(p => (p.NUMBER == null) ? true : showSet.has(p.NUMBER));

        // join points
        const sel = plotG.selectAll('g.point').data(visible, d=>`${d.Checkpoint}|${d.NUMBER}|${d.x}|${d.y}`);
        sel.exit().transition().attr('opacity',0).remove();

        const enter = sel.enter().append('g').attr('class','point').attr('transform', d=>`translate(${x(d.x)},${y(d.y)})`);
        enter.append('circle').attr('r',0).attr('fill', d => d.NUMBER != null ? color(d.NUMBER) : '#666').attr('stroke','#222').attr('stroke-width',0.8).transition().attr('r',10);
        enter.append('text').attr('class','label-text').attr('text-anchor','middle').attr('dy','0.35em').attr('fill','white').attr('font-size','11px').text(d=>d.NUMBER != null ? d.NUMBER : '');

        const merged = enter.merge(sel);
        merged.transition().duration(250).attr('transform', d=>`translate(${x(d.x)},${y(d.y)})`);
        merged.select('circle').attr('fill', d => d.NUMBER != null ? color(d.NUMBER) : '#666');
        merged.select('text').text(d=>d.NUMBER != null ? d.NUMBER : '');

        merged.on('mousemove', (event, d) => {
          tooltip.style('display','block').style('left',(event.pageX+10)+'px').style('top',(event.pageY+10)+'px')
            .html(`<strong>${yLabelText}:</strong> ${d.rawY}<br><strong>${xLabelText}:</strong> ${d.rawX}<br><strong>Driver:</strong> ${d.NUMBER ?? '—'}`);
        }).on('mouseleave', ()=>tooltip.style('display','none'));

        // draw lines per driver when available (connect visible points with same NUMBER)
        const linesData = d3.groups(visible.filter(d => d.NUMBER != null), d=>d.NUMBER).map(([num, arr]) => {
          const sorted = arr.slice().sort((a,b) => a.x - b.x);
          return { id: num, values: sorted };
        });

        const lineGen = d3.line().x(d=>x(d.x)).y(d=>y(d.y));
        const lines = plotG.selectAll('path.driver-line').data(linesData, d=>d.id);
        lines.exit().transition().attr('opacity',0).remove();
        const linesEnter = lines.enter().append('path').attr('class','driver-line').attr('fill','none').attr('stroke-width',2);
        linesEnter.merge(lines).attr('stroke', d=>color(d.id)).transition().attr('d', d=>lineGen(d.values)).attr('opacity', d=> selectedDrivers.length ? (selectedDrivers.includes(d.id)?1:0.07) : 0.6);

        // populate the HTML legend (scrollable) so all drivers are visible
        const legendDiv = d3.select('#legendContainer');
        legendDiv.html(''); // clear
        legendDiv.append('div').style('font-weight','600').text('Driver colors');
        const list = legendDiv.append('div');
        drivers.forEach(drv => {
          const row = list.append('div').attr('class','row');
          row.append('div').attr('class','swatch').style('background', color(drv));
          row.append('div').text(drv);
        });
      }

      function rerender() { render(lapSelect.node().value); }

      // wire events
      driverListDiv.selectAll('input').on('change', rerender);
      lapSelect.on('change', rerender);
      selectAllBtn.on('click', () => { setAllDriverCheckboxes(true); rerender(); });
      clearAllBtn.on('click', () => { setAllDriverCheckboxes(false); rerender(); });
      xSelect.on('change', rerender);
      ySelect.on('change', rerender);

      render('__all');

    }).catch(err => console.error(err));