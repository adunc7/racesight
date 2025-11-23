let allData = [];

    // Helpers to read possible field name variants
    function fld(rec, ...names) {
      for (const n of names) {
        if (rec === undefined || rec === null) continue;
        if (n in rec && rec[n] !== null && rec[n] !== undefined && String(rec[n]).trim() !== '') return rec[n];
        // try case variants
        const key = Object.keys(rec).find(k => k.toLowerCase() === n.toLowerCase());
        if (key && rec[key] !== null && rec[key] !== undefined && String(rec[key]).trim() !== '') return rec[key];
      }
      return null;
    }




    function colorForDriver(num) {
      if (num == null || num === '') return '#888';
      const n = Number(num);
      if (isNaN(n)) return '#666';
      const hue = (n * 47) % 360;
      return `hsl(${hue} 78% 45%)`;
    }


    //Load the data
    async function loadData(){
      try {
        const r = await fetch('/Barber_Data_JSON_UPDATED/03_Results GR Cup Race 2 Official_Anonymized.json');
        allData = await r.json();
      } catch (e) {
        try { const r2 = await fetch('/Barber_Data_JSON_UPDATED/03_Results GR Cup Race 2 Official_Anonymized.json'); allData = await r2.json(); }
        catch (e2) { console.error('No data file'); allData = []; }
      }
      populateDriversTable();
      populateDriverSelect();
    }

    function populateDriversTable(){
      const tbody = document.getElementById('driversBody');
      tbody.innerHTML = '';

      // Sort by numeric POSITION if available, otherwise by NUMBER, then keep original order
      const copy = Array.from(allData);
      copy.sort((a,b)=>{
        const paRaw = fld(a,'POSITION','Position','pos');
        const pbRaw = fld(b,'POSITION','Position','pos');
        const pa = Number(paRaw);
        const pb = Number(pbRaw);
        if (!isNaN(pa) && !isNaN(pb)) return pa - pb;
        if (!isNaN(pa) && isNaN(pb)) return -1; // a has position, b doesn't
        if (isNaN(pa) && !isNaN(pb)) return 1;  // b has position, a doesn't

        // fallback to NUMBER if positions are not available
        const na = Number(fld(a,'NUMBER','Number','number') ?? Infinity);
        const nb = Number(fld(b,'NUMBER','Number','number') ?? Infinity);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;

        return 0;
      });

      copy.forEach((rec, idx) => {
        const row = document.createElement('tr');
        row.dataset.index = idx;
        const num = fld(rec,'NUMBER','Number','number') ?? (idx+1);
        const driverName = fld(rec,'DRIVER','Driver','Name','DRIVER_NAME','DriverName') ?? '';
        const pos = fld(rec,'POSITION','Position','pos') ?? '';
        const laps = fld(rec,'LAPS','Laps','laps') ?? '';
        const total = fld(rec,'TOTAL_TIME','TotalTime','total_time') ?? '';
        const fl = fld(rec,'FL_TIME','FastestLapTime','BESTLAP_1','BESTLAP_1') ?? '';
        const flkph = fld(rec,'FL_KPH','FAST_LAP_KPH','FL_KPH') ?? '';
        const vehicle = fld(rec,'VEHICLE','Car','Vehicle') ?? '';
        const cls = fld(rec,'CLASS','Class') ?? '';

        row.innerHTML = `
          <td>${escapeHtml(String(num))}</td>
          <td style="text-align:left;padding-left:14px">${escapeHtml(String(driverName))}</td>
          <td>${escapeHtml(String(pos))}</td>
          <td>${escapeHtml(String(laps))}</td>
          <td>${escapeHtml(String(total))}</td>
          <td>${escapeHtml(String(fl))}</td>
          <td>${escapeHtml(String(flkph))}</td>
          <td>${escapeHtml(String(vehicle))}</td>
          <td>${escapeHtml(String(cls))}</td>
        `;
        row.addEventListener('click', () => {
          // remove previous selection
          const prev = document.querySelector('tr.selected');
          if (prev) prev.classList.remove('selected');
          row.classList.add('selected');
          showDriverDetails(rec, num);
          // sync quick-select
          const sel = document.getElementById('driverSelect');
          for (const o of sel.options) if (o.value === String(num)) { sel.value = String(num); break; }
        });
        tbody.appendChild(row);
      });
    }



    function populateDriverSelect(){
      const sel = document.getElementById('driverSelect');
      sel.innerHTML = '<option value="">— choose —</option>';
      const nums = Array.from(new Set(allData.map((d,i)=> String(fld(d,'NUMBER','Number','number') ?? (i+1))))).sort((a,b)=>{
        const na = Number(a), nb = Number(b);
        if (!isNaN(na) && !isNaN(nb)) return na-nb;
        return a.localeCompare(b);
      });
      nums.forEach(n=>{
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = `# ${n}`;
        sel.appendChild(opt);
      });

      sel.onchange = function(){
        const v = this.value;
        if (!v) return;
        // find first record with that number and click its row
        const rows = document.querySelectorAll('#driversBody tr');
        for (const r of rows){
          if (r.children[0] && r.children[0].textContent.trim() === String(v)){
            r.click(); r.scrollIntoView({behavior:'smooth', block:'center'}); break;
          }
        }
      };
    }

    function escapeHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    function showDriverDetails(rec, number){
      const driverBox = document.getElementById('driverBox');
      const driverBoxNum = document.getElementById('driverBoxNum');
      driverBoxNum.textContent = String(number);
      driverBox.style.background = colorForDriver(number);

      const setStat = (id, val) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = (val === null || val === undefined || String(val).trim() === '') ? '—' : String(val);
      };

      setStat('stat_POSITION', fld(rec,'POSITION','Position','pos'));
      setStat('stat_LAPS', fld(rec,'LAPS','Laps','laps'));
      setStat('stat_TOTAL_TIME', fld(rec,'TOTAL_TIME','TotalTime','total_time'));
      setStat('stat_FL_TIME', fld(rec,'FL_TIME','FastestLapTime','BESTLAP_1'));
      setStat('stat_FL_KPH', fld(rec,'FL_KPH','FAST_LAP_KPH'));
      setStat('stat_VEHICLE', fld(rec,'VEHICLE','Car','Vehicle'));
      setStat('stat_CLASS', fld(rec,'CLASS','Class'));
    }

    // start
    loadData();