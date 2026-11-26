const THEME_KEY = 'smartPotTheme';
const LED_KEY = 'smartPotLedLevels';
const DEFAULT_LED_LEVELS = { red: 70, blue: 55, white: 80, farRed: 25 };
const TANK_HEIGHT_CM = 30;
const POLL_SECONDS = 4;
const $ = id => document.getElementById(id);
const supabase = window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
  : null;
const timeFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit'
});
const chartFormatter = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit'
});

let soilChart, waterChart, busy = false, seconds = POLL_SECONDS;
let lastRows = [], currentUser = null, ledSaveTimer;
let ledSaveInFlight = false, ledSavePending = false;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const waterPercent = distance => distance < 0 ? null : clamp(((TANK_HEIGHT_CM - distance) / TANK_HEIGHT_CM) * 100, 0, 100);
const soilState = value => value < 35 ? ['Kering', 'red'] : value <= 65 ? ['Ideal', 'green'] : ['Basah', 'blue'];

function normalizeLog(row) {
  const soil = row.kelembapan_tanah;
  const distance = row.jarak_air;
  const pwm = ['pwm_red', 'pwm_blue', 'pwm_white', 'pwm_farred'].map(key => row[key]);
  const date = new Date(row.created_at);
  if (!Number.isInteger(soil) || soil < 0 || soil > 100 ||
      !Number.isFinite(distance) || (distance !== -1 && distance < 0) ||
      !pwm.every(value => Number.isInteger(value) && value >= 0 && value <= 255) ||
      typeof row.status_pompa !== 'boolean' || typeof row.status_lampu !== 'boolean' ||
      Number.isNaN(date.getTime())) throw new Error('Ada log sensor dengan format tidak valid.');
  return { id: row.id, date, soil, distance, water: waterPercent(distance),
    pump: row.status_pompa, lamp: row.status_lampu, pwm };
}

function refreshIcons() { if (window.lucide?.createIcons) window.lucide.createIcons(); }
function readLedLevels() {
  try { return { ...DEFAULT_LED_LEVELS, ...JSON.parse(localStorage.getItem(LED_KEY) || '{}') }; }
  catch { return { ...DEFAULT_LED_LEVELS }; }
}
function renderLedControls(levels = readLedLevels()) {
  for (const [channel, raw] of Object.entries(levels)) {
    const value = clamp(Number(raw) || 0, 0, 100);
    $(`${channel}Slider`).value = value;
    $(`${channel}Level`).textContent = `${value}%`;
  }
}
function setLedAccess(user) {
  const enabled = Boolean(user);
  for (const channel of Object.keys(DEFAULT_LED_LEVELS)) $(`${channel}Slider`).disabled = !enabled;
  const status = $('ledStorageStatus');
  status.className = `inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold ${enabled ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`;
  status.textContent = enabled ? 'Tersimpan di Supabase' : 'Login untuk kontrol';
  $('authButton').textContent = enabled ? 'Logout' : 'Login admin';
}
function requireSupabase() {
  if (!supabase) throw new Error('Supabase SDK belum termuat. Cek koneksi internet.');
  return supabase;
}
async function loadLedLevels() {
  if (!currentUser) return;
  const { data, error } = await requireSupabase().from('led_settings')
    .select('red,blue,white,far_red').eq('user_id', currentUser.id).maybeSingle();
  if (error) throw error;
  const levels = data ? { red: data.red, blue: data.blue, white: data.white, farRed: data.far_red }
    : { ...DEFAULT_LED_LEVELS };
  localStorage.setItem(LED_KEY, JSON.stringify(levels));
  renderLedControls(levels);
}
async function saveLedLevels() {
  if (!currentUser) return;
  if (ledSaveInFlight) { ledSavePending = true; return; }
  ledSaveInFlight = true;
  try {
    do {
      ledSavePending = false;
      const levels = readLedLevels();
      const { error } = await requireSupabase().from('led_settings').upsert({
        user_id: currentUser.id, red: levels.red, blue: levels.blue,
        white: levels.white, far_red: levels.farRed, updated_at: new Date().toISOString()
      });
      if (error) { alertUser(`Gagal menyimpan LED ke Supabase: ${error.message}`); break; }
    } while (ledSavePending && currentUser);
  } catch (error) { alertUser(`Gagal menyimpan LED: ${error.message}`); }
  finally { ledSaveInFlight = false; }
}
function bindLedControls() {
  for (const channel of Object.keys(DEFAULT_LED_LEVELS)) {
    $(`${channel}Slider`).addEventListener('input', event => {
      const levels = readLedLevels();
      levels[channel] = Number(event.target.value);
      localStorage.setItem(LED_KEY, JSON.stringify(levels));
      $(`${channel}Level`).textContent = `${levels[channel]}%`;
      clearTimeout(ledSaveTimer);
      ledSaveTimer = setTimeout(saveLedLevels, 400);
    });
  }
}

function alertUser(message) {
  const box = $('alert');
  box.textContent = message;
  box.className = 'mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/70 dark:bg-red-950/40 dark:text-red-300';
}
function clearAlert() { $('alert').className = 'mb-6 hidden'; }
function setConnection(state) {
  const el = $('connectionStatus');
  const labels = { online: 'Online / Terhubung', stale: 'Data lama', empty: 'Belum ada data', error: 'Error / Terputus' };
  el.textContent = labels[state];
  el.className = `inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold ${state === 'online' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : state === 'empty' ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'}`;
}
function setPump(on) {
  $('pumpStatus').textContent = on ? 'ON' : 'OFF';
  $('pumpStatus').className = `mt-2 text-3xl font-bold ${on ? 'text-emerald-600' : ''}`;
  $('pumpDot').className = `h-3 w-3 rounded-full ${on ? 'bg-emerald-500 pulse-on' : 'bg-slate-300 dark:bg-slate-600'}`;
  $('pumpDot').setAttribute('aria-label', `Pompa ${on ? 'menyala' : 'mati'}`);
  $('pumpText').textContent = on ? 'Pompa sedang menyiram' : 'Pompa mati';
}
function renderCards(latest) {
  if (!latest) {
    $('soilValue').textContent = '--'; $('soilBadge').textContent = '-'; $('soilBar').style.width = '0%';
    $('waterValue').textContent = '--'; $('waterBadge').textContent = '-';
    $('waterDistance').textContent = 'Jarak sensor: -- cm'; $('waterBar').style.width = '0%';
    $('pumpStatus').textContent = '--'; $('pumpText').textContent = 'Belum ada pembacaan';
    $('pumpDot').className = 'h-3 w-3 rounded-full bg-slate-300 dark:bg-slate-600';
    $('pumpDot').setAttribute('aria-label', 'Status pompa belum tersedia');
    $('lastUpdated').textContent = 'Belum ada data sensor dari ESP32.';
    return;
  }
  const [state, color] = soilState(latest.soil);
  $('soilValue').textContent = latest.soil.toFixed(1);
  $('soilBar').style.width = `${latest.soil}%`;
  $('soilBar').className = `h-full rounded-full transition-all duration-500 ${color === 'red' ? 'bg-red-500' : color === 'blue' ? 'bg-sky-500' : 'bg-emerald-500'}`;
  $('soilBadge').textContent = state;
  $('soilBadge').className = `rounded-full px-2.5 py-1 text-xs font-bold ${color === 'red' ? 'bg-red-100 text-red-700' : color === 'blue' ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700'}`;
  if (latest.water === null) {
    $('waterValue').textContent = '--'; $('waterBadge').textContent = 'Sensor gagal';
    $('waterDistance').textContent = 'Sensor ultrasonik tidak terbaca';
    $('waterBar').style.width = '0%';
  } else {
    const low = latest.water <= 20;
    $('waterValue').textContent = latest.water.toFixed(1);
    $('waterBadge').textContent = low ? 'Hampir kosong' : 'Tangki aman';
    $('waterDistance').textContent = `Jarak sensor: ${latest.distance.toFixed(1)} cm`;
    $('waterBar').style.width = `${latest.water}%`;
    $('waterBar').className = `h-full rounded-full transition-all duration-500 ${low ? 'bg-red-500' : 'bg-sky-500'}`;
  }
  setPump(latest.pump);
  $('lastUpdated').textContent = `Pembacaan terakhir: ${timeFormatter.format(latest.date)} WIB`;
}
function chartOptions(unit) {
  return { responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} ${unit}` } } },
    scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } },
      y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,.15)' }, ticks: { callback: value => `${value}${unit}` } } } };
}
function initCharts() {
  soilChart = new Chart($('soilChart'), { type: 'line', data: { labels: [], datasets: [{ data: [], borderColor: '#10b981', backgroundColor: 'rgba(16,185,129,.12)', fill: true, tension: .35, pointRadius: 2 }] }, options: chartOptions('%') });
  waterChart = new Chart($('waterChart'), { type: 'line', data: { labels: [], datasets: [{ data: [], borderColor: '#0ea5e9', backgroundColor: 'rgba(14,165,233,.12)', fill: true, tension: .35, pointRadius: 2 }] }, options: chartOptions('%') });
}
function updateCharts(rows) {
  if (!soilChart || !waterChart) return;
  const chronological = [...rows].reverse();
  const labels = chronological.map(row => chartFormatter.format(row.date));
  soilChart.data.labels = labels;
  soilChart.data.datasets[0].data = chronological.map(row => row.soil);
  waterChart.data.labels = labels;
  waterChart.data.datasets[0].data = chronological.map(row => row.water);
  soilChart.update('none'); waterChart.update('none');
}
function renderTable(rows) {
  const body = $('historyBody');
  body.replaceChildren();
  if (!rows.length) {
    const cell = document.createElement('td'); cell.colSpan = 7;
    cell.className = 'px-4 py-8 text-center text-slate-500';
    cell.textContent = 'Belum ada log sensor.';
    const tr = document.createElement('tr'); tr.append(cell); body.append(tr);
    return;
  }
  for (const row of rows) {
    const values = [timeFormatter.format(row.date), `${row.soil}%`,
      row.distance < 0 ? 'Tidak terbaca' : `${row.distance.toFixed(1)} cm`,
      row.water === null ? '-' : `${row.water.toFixed(1)}%`,
      row.pump ? 'ON' : 'OFF', row.lamp ? 'ON' : 'OFF', row.pwm.join('/')];
    const tr = document.createElement('tr');
    tr.className = 'border-t border-slate-100 dark:border-slate-800';
    for (const value of values) {
      const td = document.createElement('td');
      td.className = 'whitespace-nowrap px-4 py-3'; td.textContent = value; tr.append(td);
    }
    body.append(tr);
  }
}
function csvCell(value) { return `"${String(value).replaceAll('"', '""')}"`; }
function csvText(rows) {
  const header = ['created_at_wib', 'kelembapan_tanah', 'jarak_air_cm', 'level_air_persen',
    'status_pompa', 'status_lampu', 'pwm_red', 'pwm_blue', 'pwm_white', 'pwm_farred'];
  const lines = rows.map(row => [timeFormatter.format(row.date), row.soil, row.distance,
    row.water === null ? '' : row.water.toFixed(1), row.pump, row.lamp, ...row.pwm]
    .map(csvCell).join(','));
  return '\uFEFF' + [header.map(csvCell).join(','), ...lines].join('\r\n') + '\r\n';
}
function exportCsv() {
  if (!lastRows.length) return;
  const blob = new Blob([csvText(lastRows)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'smartpot-logs.csv'; link.click();
  URL.revokeObjectURL(url);
}
async function fetchLogs() {
  const url = `${SUPABASE_URL}/rest/v1/smartpot_logs?select=id,created_at,kelembapan_tanah,jarak_air,status_pompa,status_lampu,pwm_red,pwm_blue,pwm_white,pwm_farred&order=created_at.desc,id.desc&limit=30`;
  const response = await fetch(url, { cache: 'no-store', headers: {
    apikey: SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json'
  } });
  if (!response.ok) throw new Error(`Supabase merespons HTTP ${response.status}. Periksa tabel dan policy SELECT smartpot_logs.`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error('Format respons smartpot_logs tidak valid.');
  return rows.map(normalizeLog);
}
async function refresh() {
  if (busy) return;
  busy = true; $('refreshButton').disabled = true;
  try {
    const rows = await fetchLogs();
    lastRows = rows;
    renderCards(rows[0]); updateCharts(rows); renderTable(rows);
    $('exportButton').disabled = rows.length === 0;
    setConnection(!rows.length ? 'empty' : Date.now() - rows[0].date.getTime() > 20000 ? 'stale' : 'online');
    clearAlert();
  } catch (error) {
    setConnection('error'); alertUser(error.message);
  } finally {
    busy = false; $('refreshButton').disabled = false;
    seconds = POLL_SECONDS; $('countdown').textContent = seconds;
  }
}
function toggleTheme() {
  const dark = document.documentElement.classList.toggle('dark');
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
  $('themeButton').innerHTML = `<i data-lucide="${dark ? 'moon' : 'sun'}" class="h-4 w-4"></i>`;
  refreshIcons();
}
async function syncAuth() {
  if (!supabase) { setLedAccess(null); return; }
  const { data: { user } } = await supabase.auth.getUser();
  currentUser = user; setLedAccess(user);
  if (user) await loadLedLevels();
}
function openAuthDialog() {
  $('authDialog').showModal(); $('authEmail').focus();
  if (!supabase) $('authMessage').textContent = 'Supabase SDK belum termuat.';
}
function bindEvents() {
  $('refreshButton').onclick = refresh;
  $('exportButton').onclick = exportCsv;
  $('themeButton').onclick = toggleTheme;
  $('authButton').onclick = async () => {
    if (!currentUser) { openAuthDialog(); return; }
    await requireSupabase().auth.signOut();
    currentUser = null; setLedAccess(null);
  };
  $('closeAuth').onclick = () => $('authDialog').close();
  $('authForm').onsubmit = async event => {
    event.preventDefault(); $('authSubmit').disabled = true; $('authMessage').textContent = '';
    try {
      const { error } = await requireSupabase().auth.signInWithPassword({
        email: $('authEmail').value.trim(), password: $('authPassword').value
      });
      if (error) { $('authMessage').textContent = `Login gagal: ${error.message}`; return; }
      $('authPassword').value = ''; $('authDialog').close(); await syncAuth();
    } catch (error) { $('authMessage').textContent = `Login gagal: ${error.message}`; }
    finally { $('authSubmit').disabled = false; }
  };
}
function init() {
  document.documentElement.classList.toggle('dark', (localStorage.getItem(THEME_KEY) || 'dark') === 'dark');
  bindEvents(); bindLedControls(); renderLedControls(); setLedAccess(null);
  refreshIcons(); renderCards(null); renderTable([]);
  try { initCharts(); } catch { alertUser('Grafik belum tersedia. Periksa pemuatan Chart.js.'); }
  syncAuth().catch(error => alertUser(`Login Supabase belum siap: ${error.message}`));
  setInterval(() => { seconds = Math.max(0, seconds - 1); $('countdown').textContent = seconds; }, 1000);
  setInterval(refresh, POLL_SECONDS * 1000);
  refresh();
}
init();
