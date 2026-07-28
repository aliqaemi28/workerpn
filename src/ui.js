// ui.js — پنل مدیریت Chop (HTML/CSS/JS، بدون نیاز به build جدا)

const BASE_STYLE = `
<style>
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@500;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
  :root{
    --base:#0D0D10; --panel:#17171B; --panel2:#1D1D22; --line:#28282E;
    --edge:#FF5A36; --edge-dim:#8A3320; --online:#3DDC84; --warn:#F4B740; --danger:#E5484D;
    --ink:#F2F1EE; --ink-dim:#8B8B92;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--base);color:var(--ink);font-family:'Inter',sans-serif;-webkit-font-smoothing:antialiased}
  .mono{font-family:'JetBrains Mono',monospace}
  .display{font-family:'Sora',sans-serif}
  .chop-mark{display:flex;align-items:center;gap:10px}
  .chop-mark .dot{width:10px;height:10px;border-radius:50%;background:var(--edge);box-shadow:0 0 12px var(--edge)}
  .chop-mark h1{font-family:'Sora',sans-serif;font-weight:800;font-size:22px;letter-spacing:-0.02em;margin:0}
  .chop-line{height:6px;width:100%;background:
    linear-gradient(135deg, var(--edge) 25%, transparent 25%) -3px 0,
    linear-gradient(225deg, var(--edge) 25%, transparent 25%) -3px 0;
    background-size:12px 12px; background-repeat:repeat-x; opacity:.9}
  a{color:inherit}
  input,select{
    background:var(--base); border:1px solid var(--line); color:var(--ink);
    border-radius:8px; padding:10px 12px; font-family:'Inter',sans-serif; font-size:14px; width:100%;
  }
  input:focus,select:focus{outline:none;border-color:var(--edge);box-shadow:0 0 0 3px rgba(255,90,54,.15)}
  label{font-size:11px;color:var(--ink-dim);text-transform:uppercase;letter-spacing:.06em;font-family:'JetBrains Mono',monospace;display:block;margin-bottom:6px}
  button{cursor:pointer;font-family:'Inter',sans-serif;border:none}
  .btn-primary{background:var(--edge);color:#160C08;font-weight:600;border-radius:8px;padding:10px 18px;font-size:14px;transition:filter .15s}
  .btn-primary:hover{filter:brightness(1.1)}
  .btn-primary:disabled{opacity:.5;cursor:default}
  .btn-ghost{background:transparent;border:1px solid var(--line);color:var(--ink-dim);border-radius:8px;padding:7px 12px;font-size:12px;font-family:'JetBrains Mono',monospace;transition:.15s}
  .btn-ghost:hover{color:var(--ink);border-color:#3a3a42}
  .btn-ghost.danger:hover{color:var(--danger);border-color:var(--danger)}
  .btn-ghost.online-btn:hover{color:var(--online);border-color:var(--online)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:14px}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{text-align:right;color:var(--ink-dim);font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:10px 8px;border-bottom:1px solid var(--line);font-family:'JetBrains Mono',monospace}
  td{padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
  .tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:20px;flex-wrap:wrap}
  .tab{padding:10px 16px;font-size:13px;color:var(--ink-dim);border-bottom:2px solid transparent;cursor:pointer}
  .tab.active{color:var(--ink);border-bottom-color:var(--edge)}
  .pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-family:'JetBrains Mono',monospace}
  .pill.on{background:rgba(61,220,132,.12);color:var(--online)}
  .pill.off{background:rgba(229,72,77,.12);color:var(--danger)}
  .modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:16px;z-index:50}
  .stat{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px}
  .stat .num{font-family:'Sora',sans-serif;font-weight:800;font-size:26px}
  .stat .lbl{color:var(--ink-dim);font-size:12px;margin-top:4px}
  ::-webkit-scrollbar{width:6px;height:6px}
  ::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px}
</style>
`;

export function loginPage() {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chop — ورود</title>
${BASE_STYLE}
</head>
<body>
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px">
    <div style="width:100%;max-width:360px">
      <div class="chop-mark" style="justify-content:center;margin-bottom:6px">
        <span class="dot"></span><h1>Chop</h1>
      </div>
      <div class="chop-line" style="margin-bottom:28px;border-radius:3px"></div>
      <div class="card" style="padding:24px">
        <div style="margin-bottom:16px"><label>نام کاربری</label><input id="u" autocomplete="username"></div>
        <div style="margin-bottom:18px"><label>رمز عبور</label><input id="p" type="password" autocomplete="current-password"></div>
        <button class="btn-primary" style="width:100%" onclick="doLogin()">ورود</button>
        <div id="err" style="color:var(--danger);font-size:13px;margin-top:12px;display:none"></div>
      </div>
    </div>
  </div>
<script>
async function doLogin(){
  const err = document.getElementById('err');
  err.style.display='none';
  try{
    const res = await fetch('/api/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username: document.getElementById('u').value, password: document.getElementById('p').value})
    });
    const data = await res.json();
    if(!res.ok){ err.textContent = data.detail || 'خطا'; err.style.display='block'; return; }
    location.href='/dashboard';
  }catch(e){ err.textContent='خطای شبکه'; err.style.display='block'; }
}
document.getElementById('p').addEventListener('keydown', e=>{ if(e.key==='Enter') doLogin(); });
</script>
</body>
</html>`;
}

export function dashboardPage() {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Chop — پنل مدیریت</title>
${BASE_STYLE}
</head>
<body>
<div style="max-width:1080px;margin:0 auto;padding:24px 16px 60px">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
    <div class="chop-mark"><span class="dot"></span><h1>Chop</h1></div>
    <button class="btn-ghost" onclick="logout()">خروج</button>
  </div>
  <div class="chop-line" style="border-radius:3px;margin-bottom:24px"></div>

  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:24px" id="stats"></div>

  <div class="tabs">
    <div class="tab active" data-tab="configs">کانفیگ‌ها</div>
    <div class="tab" data-tab="logs">لاگ اتصال‌ها</div>
    <div class="tab" data-tab="bot">ربات تلگرام</div>
    <div class="tab" data-tab="backup">بکاپ و بازیابی</div>
  </div>

  <div id="tab-configs">
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="btn-primary" onclick="openConfigModal()">+ کانفیگ جدید</button>
    </div>
    <div class="card" style="overflow:auto">
      <table>
        <thead><tr>
          <th>نام</th><th>وضعیت</th><th>آنلاین</th><th>مصرف</th><th>انقضا</th><th>عملیات</th>
        </tr></thead>
        <tbody id="configRows"></tbody>
      </table>
    </div>
  </div>

  <div id="tab-logs" style="display:none">
    <div style="margin-bottom:12px;display:flex;gap:8px;align-items:center">
      <label style="margin:0">فیلتر کانفیگ:</label>
      <select id="logFilter" style="width:220px" onchange="loadLogs()"><option value="">همه</option></select>
    </div>
    <div class="card" style="overflow:auto">
      <table>
        <thead><tr><th>زمان</th><th>کانفیگ</th><th>IP</th><th>مقصد</th><th>حجم</th></tr></thead>
        <tbody id="logRows"></tbody>
      </table>
    </div>
  </div>

  <div id="tab-bot" style="display:none">
    <div class="card" style="padding:20px;margin-bottom:16px">
      <div style="margin-bottom:14px"><label>توکن ربات (از BotFather)</label><input id="botToken" placeholder="123456:ABC-..."></div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
        <input type="checkbox" id="botEnabled" style="width:auto">
        <label style="margin:0">ربات فعال باشد</label>
      </div>
      <button class="btn-primary" onclick="saveBotSettings()">ذخیره و اتصال Webhook</button>
      <div id="botStatus" class="mono" style="margin-top:14px;font-size:12px;color:var(--ink-dim)"></div>
    </div>
    <div class="card" style="padding:20px;margin-bottom:16px">
      <label>افزودن ادمین (آی‌دی عددی تلگرام)</label>
      <div style="display:flex;gap:8px">
        <input id="newAdminId">
        <button class="btn-ghost" onclick="addBotAdmin()">افزودن</button>
      </div>
      <div id="adminList" style="margin-top:12px"></div>
    </div>
    <div class="card" style="padding:20px">
      <div class="mono" id="memberCount" style="color:var(--ink-dim);font-size:13px"></div>
    </div>
  </div>

  <div id="tab-backup" style="display:none">
    <div class="card" style="padding:20px;margin-bottom:16px">
      <div style="margin-bottom:10px;color:var(--ink-dim);font-size:13px">یک فایل JSON شامل همه‌ی کانفیگ‌ها، مصرف، تنظیمات ربات و لاگ‌ها دانلود می‌کند.</div>
      <button class="btn-primary" onclick="location.href='/api/backup'">دانلود بکاپ</button>
    </div>
    <div class="card" style="padding:20px">
      <div style="margin-bottom:10px"><label>فایل بکاپ</label><input type="file" id="restoreFile" accept="application/json"></div>
      <div style="display:flex;gap:16px;align-items:center;margin-bottom:14px">
        <label style="margin:0"><input type="radio" name="mode" value="replace" checked style="width:auto"> جایگزینی کامل</label>
        <label style="margin:0"><input type="radio" name="mode" value="merge" style="width:auto"> ادغام</label>
      </div>
      <button class="btn-primary" onclick="doRestore()">بازیابی</button>
      <div id="restoreStatus" class="mono" style="margin-top:12px;font-size:12px"></div>
    </div>
  </div>
</div>

<div id="configModalBg" class="modal-bg" style="display:none">
  <div class="card" style="padding:24px;width:100%;max-width:420px;max-height:90vh;overflow:auto">
    <h3 class="display" id="modalTitle" style="margin:0 0 16px">کانفیگ جدید</h3>
    <input type="hidden" id="cfgId">
    <div style="margin-bottom:12px"><label>نام</label><input id="cfgName"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div><label>محدودیت ترافیک (GB, 0=بی‌نهایت)</label><input id="cfgTraffic" type="number" value="0"></div>
      <div><label>انقضا (روز, 0=بدون انقضا)</label><input id="cfgExpires" type="number" value="0"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div><label>محدودیت IP هم‌زمان (0=بی‌نهایت)</label><input id="cfgIpLimit" type="number" value="0"></div>
      <div><label>پورت</label><input id="cfgPort" type="number" value="443"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">
      <div><label>Fingerprint</label>
        <select id="cfgFp">
          <option value="chrome">chrome</option><option value="firefox">firefox</option>
          <option value="safari">safari</option><option value="ios">ios</option>
          <option value="android">android</option><option value="edge">edge</option>
        </select>
      </div>
      <div><label>ALPN</label><input id="cfgAlpn" value="h2,http/1.1"></div>
    </div>
    <div style="display:flex;gap:10px;margin-top:18px">
      <button class="btn-primary" style="flex:1" onclick="saveConfig()">ذخیره</button>
      <button class="btn-ghost" style="flex:1" onclick="closeConfigModal()">انصراف</button>
    </div>
  </div>
</div>

<div id="linkModalBg" class="modal-bg" style="display:none">
  <div class="card" style="padding:24px;width:100%;max-width:460px">
    <h3 class="display" style="margin:0 0 14px">لینک اتصال</h3>
    <textarea id="linkText" readonly style="width:100%;height:90px;background:var(--base);border:1px solid var(--line);border-radius:8px;color:var(--ink);padding:10px;font-family:'JetBrains Mono',monospace;font-size:12px"></textarea>
    <div style="display:flex;gap:10px;margin-top:14px">
      <button class="btn-primary" style="flex:1" onclick="copyLink()">کپی</button>
      <button class="btn-ghost" style="flex:1" onclick="document.getElementById('linkModalBg').style.display='none'">بستن</button>
    </div>
  </div>
</div>

<script>
let CONFIGS = [];

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  ['configs','logs','bot','backup'].forEach(name=>{
    document.getElementById('tab-'+name).style.display = (name===t.dataset.tab)?'':'none';
  });
  if(t.dataset.tab==='logs') loadLogs();
  if(t.dataset.tab==='bot') loadBotSettings();
}));

function fmtBytes(n){
  if(!n) return '0 B';
  const units=['B','KB','MB','GB','TB']; let i=0; let v=n;
  while(v>=1024 && i<units.length-1){ v/=1024; i++; }
  return v.toFixed(v>=10||i===0?0:1)+' '+units[i];
}
function fmtDate(ts){ if(!ts) return '—'; return new Date(ts*1000).toLocaleString('fa-IR'); }

async function api(path, opts={}){
  const res = await fetch(path, {headers:{'Content-Type':'application/json'}, ...opts});
  if(res.status===401){ location.href='/'; throw new Error('unauthorized'); }
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.detail||'خطا');
  return data;
}

async function logout(){ await api('/api/logout', {method:'POST'}); location.href='/'; }

async function loadStats(){
  const s = await api('/api/stats');
  document.getElementById('stats').innerHTML = \`
    <div class="stat"><div class="num">\${s.config_count}</div><div class="lbl">کانفیگ</div></div>
    <div class="stat"><div class="num" style="color:var(--online)">\${s.online}</div><div class="lbl">آنلاین</div></div>
    <div class="stat"><div class="num">\${fmtBytes(s.total_used_bytes)}</div><div class="lbl">ترافیک کل</div></div>
    <div class="stat"><div class="num mono" style="font-size:14px">\${s.backend}</div><div class="lbl">بک‌اند</div></div>
  \`;
}

async function loadConfigs(){
  const data = await api('/api/configs');
  CONFIGS = data.configs;
  const sel = document.getElementById('logFilter');
  sel.innerHTML = '<option value="">همه</option>' + CONFIGS.map(c=>\`<option value="\${c.id}">\${c.name}</option>\`).join('');
  document.getElementById('configRows').innerHTML = CONFIGS.map(c=>\`
    <tr>
      <td>\${c.name}</td>
      <td><span class="pill \${c.enabled?'on':'off'}">\${c.enabled?'فعال':'غیرفعال'}</span></td>
      <td>\${c.online}</td>
      <td>\${fmtBytes(c.used_bytes)}\${c.traffic_limit_bytes?' / '+fmtBytes(c.traffic_limit_bytes):''}</td>
      <td>\${fmtDate(c.expires_at)}</td>
      <td style="white-space:nowrap">
        <button class="btn-ghost" onclick="showLink('\${c.id}')">لینک</button>
        <button class="btn-ghost" onclick="editConfig('\${c.id}')">ویرایش</button>
        <button class="btn-ghost" onclick="toggleConfig('\${c.id}', \${!c.enabled})">\${c.enabled?'خاموش':'روشن'}</button>
        <button class="btn-ghost" onclick="resetUsage('\${c.id}')">ریست مصرف</button>
        <button class="btn-ghost" onclick="filterLogsFor('\${c.id}')">لاگ</button>
        <button class="btn-ghost danger" onclick="deleteConfig('\${c.id}')">حذف</button>
      </td>
    </tr>\`).join('');
}

function filterLogsFor(id){
  document.querySelector('.tab[data-tab=logs]').click();
  document.getElementById('logFilter').value = id;
  loadLogs();
}

async function loadLogs(){
  const cid = document.getElementById('logFilter').value;
  const data = await api('/api/logs'+(cid?('?config_id='+cid):''));
  document.getElementById('logRows').innerHTML = data.logs.map(l=>\`
    <tr><td class="mono">\${fmtDate(l.ts)}</td><td>\${l.config_name}</td><td class="mono">\${l.ip}</td>
    <td class="mono">\${l.address}:\${l.port}</td><td>\${fmtBytes(l.bytes)}</td></tr>\`).join('') || '<tr><td colspan="5" style="color:var(--ink-dim)">رکوردی نیست</td></tr>';
}

function openConfigModal(){
  document.getElementById('modalTitle').textContent='کانفیگ جدید';
  document.getElementById('cfgId').value='';
  document.getElementById('cfgName').value='';
  document.getElementById('cfgTraffic').value=0;
  document.getElementById('cfgExpires').value=0;
  document.getElementById('cfgIpLimit').value=0;
  document.getElementById('cfgPort').value=443;
  document.getElementById('cfgFp').value='chrome';
  document.getElementById('cfgAlpn').value='h2,http/1.1';
  document.getElementById('configModalBg').style.display='flex';
}
function closeConfigModal(){ document.getElementById('configModalBg').style.display='none'; }

function editConfig(id){
  const c = CONFIGS.find(x=>x.id===id);
  if(!c) return;
  document.getElementById('modalTitle').textContent='ویرایش کانفیگ';
  document.getElementById('cfgId').value=c.id;
  document.getElementById('cfgName').value=c.name;
  document.getElementById('cfgTraffic').value=(c.traffic_limit_bytes/1073741824)||0;
  document.getElementById('cfgExpires').value=0;
  document.getElementById('cfgIpLimit').value=c.ip_limit||0;
  document.getElementById('cfgPort').value=c.port||443;
  document.getElementById('cfgFp').value=c.fingerprint||'chrome';
  document.getElementById('cfgAlpn').value=c.alpn||'h2,http/1.1';
  document.getElementById('configModalBg').style.display='flex';
}

async function saveConfig(){
  const id = document.getElementById('cfgId').value;
  const body = {
    name: document.getElementById('cfgName').value,
    traffic_limit_gb: parseFloat(document.getElementById('cfgTraffic').value||0),
    expires_days: parseInt(document.getElementById('cfgExpires').value||0),
    ip_limit: parseInt(document.getElementById('cfgIpLimit').value||0),
    port: parseInt(document.getElementById('cfgPort').value||443),
    fingerprint: document.getElementById('cfgFp').value,
    alpn: document.getElementById('cfgAlpn').value,
  };
  if(id){
    await api('/api/configs/'+id, {method:'PATCH', body: JSON.stringify(body)});
  } else {
    await api('/api/configs', {method:'POST', body: JSON.stringify(body)});
  }
  closeConfigModal();
  await Promise.all([loadConfigs(), loadStats()]);
}

async function toggleConfig(id, enabled){
  await api('/api/configs/'+id, {method:'PATCH', body: JSON.stringify({enabled})});
  loadConfigs();
}
async function resetUsage(id){
  await api('/api/configs/'+id, {method:'PATCH', body: JSON.stringify({reset_usage:true})});
  loadConfigs(); loadStats();
}
async function deleteConfig(id){
  if(!confirm('این کانفیگ حذف شود؟')) return;
  await api('/api/configs/'+id, {method:'DELETE'});
  loadConfigs(); loadStats();
}
function showLink(id){
  const c = CONFIGS.find(x=>x.id===id);
  document.getElementById('linkText').value = c.link;
  document.getElementById('linkModalBg').style.display='flex';
}
function copyLink(){
  const t = document.getElementById('linkText');
  t.select(); document.execCommand('copy');
}

async function loadBotSettings(){
  const s = await api('/api/bot/settings');
  document.getElementById('botEnabled').checked = s.enabled;
  document.getElementById('botToken').placeholder = s.token_masked || '123456:ABC-...';
  document.getElementById('botStatus').textContent = s.webhook_url ? ('Webhook: '+s.webhook_url) : '';
  document.getElementById('memberCount').textContent = 'اعضای ثبت‌شده: '+s.member_count;
  document.getElementById('adminList').innerHTML = s.admins.map(a=>\`
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
      <span class="mono">\${a.id}</span>
      <button class="btn-ghost danger" onclick="removeBotAdmin('\${a.id}')">حذف</button>
    </div>\`).join('') || '<div style="color:var(--ink-dim)">ادمینی ثبت نشده</div>';
}
async function saveBotSettings(){
  const token = document.getElementById('botToken').value.trim();
  const enabled = document.getElementById('botEnabled').checked;
  await api('/api/bot/settings', {method:'POST', body: JSON.stringify({token, enabled})});
  loadBotSettings();
}
async function addBotAdmin(){
  const id = document.getElementById('newAdminId').value.trim();
  if(!id) return;
  await api('/api/bot/admins', {method:'POST', body: JSON.stringify({id})});
  document.getElementById('newAdminId').value='';
  loadBotSettings();
}
async function removeBotAdmin(id){
  await api('/api/bot/admins/'+id, {method:'DELETE'});
  loadBotSettings();
}

async function doRestore(){
  const file = document.getElementById('restoreFile').files[0];
  const status = document.getElementById('restoreStatus');
  if(!file){ status.textContent='یک فایل انتخاب کنید'; return; }
  const mode = document.querySelector('input[name=mode]:checked').value;
  try{
    const text = await file.text();
    const backup = JSON.parse(text);
    const data = await api('/api/backup/restore', {method:'POST', body: JSON.stringify({backup, mode})});
    status.style.color='var(--online)';
    status.textContent = 'انجام شد: '+data.counters.configs+' کانفیگ، '+data.counters.admins+' ادمین، '+data.counters.members+' عضو';
    loadConfigs(); loadStats();
  }catch(e){ status.style.color='var(--danger)'; status.textContent = e.message; }
}

loadStats(); loadConfigs();
setInterval(()=>{ loadStats(); loadConfigs(); }, 15000);
</script>
</body>
</html>`;
}
