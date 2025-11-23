  let allData = [];

    // parse "m:ss.xxx" or "mm:ss.xxx" or plain seconds -> seconds (number)
    function parseTimeToSeconds(v) {
      if (v === null || v === undefined) return NaN;
      if (typeof v === 'number') return v;
      const s = String(v).trim();
      if (s === '') return NaN;
      // mm:ss.sss or hh:mm:ss
      if (s.includes(':')) {
        const parts = s.split(':').map(p => parseFloat(p.replace(',', '.')));
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
      const n = parseFloat(s.replace(',', '.'));
      return isNaN(n) ? NaN : n;
    }

    // Deterministic color for a driver number (HSL)
    function colorForDriver(num) {
      if (num == null || num === '') return '#888';
      const n = Number(num);
      if (isNaN(n)) return '#666';
      const hue = (n * 47) % 360; // arbitrary multiplier to spread colors
      return `hsl(${hue} 78% 45%)`;
    }



    // Load JSON Data / Fetch JSON and populate select
    fetch('Barber_Data_JSON_UPDATED/99_Best 10 Laps By Driver_Race 1_Anonymized.json')
      .then(r => r.json())
      .then(data => {
        allData = data;
        const sel = document.getElementById('driverSelect');
        // build unique sorted driver numbers (fall back to index if NUMBER absent)
        const nums = Array.from(new Set(data.map((d,i) => d.NUMBER ?? String(i+1)))).sort((a,b)=> {
          const na = Number(a), nb = Number(b);
          if (!isNaN(na) && !isNaN(nb)) return na-nb;
          return String(a).localeCompare(String(b));
        });
        nums.forEach(n => {
          const opt = document.createElement('option');
          opt.value = n;
          opt.textContent = `Driver ${n}`;
          sel.appendChild(opt);
        });
      })
      .catch(err => { console.error('Failed to load output2.json', err); });


    // Build rows for given driver record: returns sorted array ascending by time
    function extractTopLaps(record) {
      if (!record) return [];
      const pairs = [];

      // Prefer keys BESTLAP_N and BESTLAP_N_LAPNUM patterns
      Object.keys(record).forEach(k => {
        const m = k.match(/^BESTLAP[_\s-]?(\d+)$/i);
        if (m) {
          const idx = m[1];
          const timeKey = k;
          const lapnumKeyCandidates = [
            `BESTLAP_${idx}_LAPNUM`,
            `BESTLAP_${idx}_LAP_NUM`,
            `BESTLAP ${idx} LAPNUM`,
            `BESTLAP${idx}LAPNUM`
          ];
          // find matching lapnum key (case-insensitive)
          const lapNumKey = Object.keys(record).find(key => {
            const kn = key.toUpperCase().replace(/[\s_-]+/g,'');
            return lapnumKeyCandidates.some(c => kn === c.toUpperCase().replace(/[\s_-]+/g,''));
          });
          const timeRaw = record[timeKey];
          const lapRaw = lapNumKey ? record[lapNumKey] : null;
          const tSec = parseTimeToSeconds(timeRaw);
          if (!isNaN(tSec)) pairs.push({ timeRaw, lapRaw, tSec });
        }
      });

      // Fallback: if no BESTLAP_* keys found, search for BESTLAP_1..10 explicitly
      if (pairs.length === 0) {
        for (let i = 1; i <= 10; i++) {
          const timeKey = `BESTLAP_${i}`;
          const lapKey = `BESTLAP_${i}_LAPNUM`;
          if (timeKey in record) {
            const timeRaw = record[timeKey];
            const lapRaw = lapKey in record ? record[lapKey] : null;
            const tSec = parseTimeToSeconds(timeRaw);
            if (!isNaN(tSec)) pairs.push({ timeRaw, lapRaw, tSec });
          }
        }
      }

      // also allow case where BESTLAP_ fields exist but with different capitalization - already handled by above since keys from record are iterated
      // sort ascending (best -> worst)
      pairs.sort((a,b)=>a.tSec - b.tSec);

      // limit to top 10
      return pairs.slice(0,10);
    }

    function renderTop10ForDriver(driverNumber) {
      const tbody = document.getElementById('tableBody');
      tbody.innerHTML = '';

      const driverBox = document.getElementById('driverBox');
      const driverBoxNum = document.getElementById('driverBoxNum');

      if (!driverNumber) {
        driverBoxNum.textContent = '—';
        driverBox.style.background = '#888';
        return;
      }

      const rec = allData.find(r => String(r.NUMBER) === String(driverNumber));
      if (!rec) {
        // If there is no record keyed by NUMBER, try to find by index-style / fallback
        driverBoxNum.textContent = driverNumber;
        driverBox.style.background = colorForDriver(driverNumber);
        return;
      }

      // set colored box
      driverBoxNum.textContent = String(driverNumber);
      driverBox.style.background = colorForDriver(driverNumber);

      const rows = extractTopLaps(rec);

      // ensure we show 10 rows even if less data available
      for (let i=0;i<10;i++) {
        const tr = document.createElement('tr');
        const rankTd = document.createElement('td');
        rankTd.textContent = i+1;
        const timeTd = document.createElement('td');
        const lapTd = document.createElement('td');

        if (rows[i]) {
          timeTd.textContent = rows[i].timeRaw;
          lapTd.textContent = rows[i].lapRaw ?? '';
        } else {
          timeTd.textContent = '';
          lapTd.textContent = '';
        }

        tr.appendChild(rankTd);
        tr.appendChild(timeTd);
        tr.appendChild(lapTd);
        tbody.appendChild(tr);
      }
    }

    document.getElementById('driverSelect').addEventListener('change', function(e) {
      renderTop10ForDriver(this.value);
    });
