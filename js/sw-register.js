// PWA service worker registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('[PWA] Service Worker registered, scope:', reg.scope);
        // Notify user when a new SW version is waiting
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Optional: show a toast to the user
              if (typeof showToast === 'function') {
                showToast('App update available — refresh to apply', 'info');
              }
            }
          });
        });
      })
      .catch(err => console.warn('[PWA] SW registration failed:', err));
  });
}

// ── Install prompt (Add to Home Screen) ──────────────────────
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredPrompt = e;
  // Show an "Install App" button if one exists in the settings page
  const installBtn = document.getElementById('btnInstallApp');
  if (installBtn) installBtn.style.display = 'inline-flex';
});

function installPWA() {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  deferredPrompt.userChoice.then(choice => {
    if (choice.outcome === 'accepted' && typeof showToast === 'function') {
      showToast('App installed successfully! 🎉', 'success');
    }
    deferredPrompt = null;
    const installBtn = document.getElementById('btnInstallApp');
    if (installBtn) installBtn.style.display = 'none';
  });
}



// ── Drawer ────────────────────────────────────────────────────
function openDrawer() {
  document.getElementById('sideDrawer')?.classList.add('open');
  document.getElementById('drawerOverlay')?.classList.add('open');
  const u = currentUser;
  const nameEl = document.getElementById('drawerUserName');
  if (nameEl && u) nameEl.textContent = (u.name || u.email || '') + ' · ' + (u.role || '');
  const acad = document.getElementById('topAcadName');
  const dAcad = document.getElementById('drawerAcadName');
  if (acad && dAcad) dAcad.textContent = acad.textContent;
}
function closeDrawer() {
  document.getElementById('sideDrawer')?.classList.remove('open');
  document.getElementById('drawerOverlay')?.classList.remove('open');
}

// ── Tab dropdown (3-dot menu) ──────────────────────────────────
const TAB_META = {
  home:       { icon:'🏠', label:'Home' },
  students:   { icon:'👥', label:'Students' },
  attendance: { icon:'📅', label:'Attendance' },
  fees:       { icon:'💰', label:'Fees' },
  enquiry:    { icon:'💬', label:'Enquiry' },
  activity:   { icon:'📋', label:'Activity Log' },
  performance:{ icon:'🏆', label:'Performance' },
  profile:    { icon:'👤', label:'Profile' }
};
function toggleTabMenu() {
  const dd  = document.getElementById('tabDropdown');
  const ov  = document.getElementById('tabPanelOverlay');
  const open = dd.getAttribute('data-open') === '1';
  if (open) {
    dd.setAttribute('data-open','0');
    dd.style.transform = 'translateX(100%)';
    if (ov) ov.style.display = 'none';
  } else {
    // Sync logo
    const logoUrl = DB.settings.logoUrl;
    const panel = document.getElementById('tabPanelLogo');
    if (panel) {
      if (logoUrl) {
        panel.innerHTML = `<img src="${logoUrl}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      } else {
        const topLogo = document.getElementById('topLogo');
        panel.innerHTML = topLogo ? (topLogo.innerHTML || '⚔️') : '⚔️';
      }
    }
    // Sync academy name
    const acad  = document.getElementById('topAcadName');
    const pAcad = document.getElementById('tabPanelAcadName');
    if (acad && pAcad) pAcad.textContent = acad.textContent;
    // Sync user name from currentUser directly
    const pUname = document.getElementById('tabPanelUserName');
    const displayName = (typeof currentUser !== 'undefined' && currentUser) ? (currentUser.name || currentUser.id || '') : '';
    if (pUname) pUname.textContent = displayName;
    // Sync role badge
    const roleTxt = document.getElementById('topRoleBadge')?.textContent || (typeof isAdmin === 'function' && isAdmin() ? 'Admin' : 'Staff');
    const pRole = document.getElementById('tabPanelRoleBadge');
    if (pRole) pRole.textContent = roleTxt;
    // Show plan badge — only for admins (staff don't need to see plan)
    const planBadgeEl = document.getElementById('tabPanelPlanBadge');
    if (planBadgeEl && typeof isAdmin === 'function' && isAdmin()) {
      const plan = (typeof DB !== 'undefined' && DB.settings && DB.settings.plan) || 'trial';
      const planLabels = { trial:'Trial', basic:'Basic', pro:'Pro', premium:'Premium', frozen:'Frozen' };
      const planColors = {
        trial:   { bg:'rgba(245,158,11,.15)', color:'#f59e0b', border:'rgba(245,158,11,.3)' },
        basic:   { bg:'rgba(59,130,246,.15)',  color:'#3b82f6', border:'rgba(59,130,246,.3)' },
        pro:     { bg:'rgba(124,58,237,.15)',  color:'#7c3aed', border:'rgba(124,58,237,.3)' },
        premium: { bg:'rgba(16,185,129,.15)',  color:'#10b981', border:'rgba(16,185,129,.3)' },
        frozen:  { bg:'rgba(239,68,68,.15)',   color:'#ef4444', border:'rgba(239,68,68,.3)'  },
      };
      const c = planColors[plan] || planColors.trial;
      planBadgeEl.textContent = planLabels[plan] || plan;
      planBadgeEl.style.background = c.bg;
      planBadgeEl.style.color      = c.color;
      planBadgeEl.style.border     = '1px solid ' + c.border;
      planBadgeEl.style.display    = 'inline';
    } else if (planBadgeEl) {
      planBadgeEl.style.display = 'none';
    }
    // Set avatar initial
    const avatar = document.getElementById('tabPanelAvatar');
    if (avatar && pUname) {
      const nm = pUname.textContent || '?';
      avatar.textContent = nm.trim().charAt(0).toUpperCase();
    }
    dd.setAttribute('data-open','1');
    dd.style.transform = 'translateX(0)';
    if (ov) ov.style.display = 'block';
  }
}
function closeTabMenu() {
  const dd = document.getElementById('tabDropdown');
  const ov = document.getElementById('tabPanelOverlay');
  if (dd) { dd.setAttribute('data-open','0'); dd.style.transform = 'translateX(100%)'; }
  if (ov) ov.style.display = 'none';
}

// ══════════════════════════════════════════════════════════════════
// SCHEDULES — Field-ops task dispatcher (Teams-style)
// Each record: { id, staffId, date, time, location, task, note, status, createdBy, createdAt }
// status: 'scheduled' → 'in_progress' → 'done'  (or 'cancelled')
// ══════════════════════════════════════════════════════════════════

let _schedEditId = null;
let _schedView = 'month';        // 'month' | 'week' | 'day' | 'list'
let _schedMonthDate = '';        // any ISO date within the displayed month
let _schedWeekFrom  = '';        // ISO date of the Monday of the displayed week
let _schedDayDate   = '';        // ISO date of the displayed day
let _schedNavLock   = false;     // guards against double tap-fire on nav buttons

// ── Helpers ──────────────────────────────────────────────────────
// Format a Date using its LOCAL y/m/d (never use .toISOString() for this —
// that converts to UTC first, which silently rolls the date back by one
// day in any timezone ahead of UTC, e.g. India Standard Time).
function _isoLocal(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function todayIso() {
  return _isoLocal(new Date());
}
function addDays(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return _isoLocal(d);
}
function addMonths(isoDate, n) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setMonth(d.getMonth() + n, 1); // pin to day 1 to avoid month-length overflow
  return _isoLocal(d);
}
function getMonday(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return _isoLocal(d);
}
function dayName(isoDate) {
  return new Date(isoDate + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' });
}
function shortDate(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function monthLabel(isoDate) {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}
function staffName(id) {
  const u = (DB.users || []).find(u => u.id === id);
  return u ? (u.name || u.id) : id;
}
function _esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// Runs fn once, ignoring any re-entrant call (incl. ghost/double-tap) within `ms`.
function _navOnce(fn, ms) {
  if (_schedNavLock) return;
  _schedNavLock = true;
  setTimeout(() => { _schedNavLock = false; }, ms || 300);
  fn();
}

// ── Set view ─────────────────────────────────────────────────────
function setSchedView(v) {
  _schedView = v;
  ['month','day','list'].forEach(k => {
    const btn = document.getElementById('schedView' + k.charAt(0).toUpperCase() + k.slice(1));
    if (btn) btn.classList.toggle('btn-primary', k === v);
  });
  const dateRangeBar = document.getElementById('schedDateRangeBar');
  if (dateRangeBar) dateRangeBar.style.display = v === 'list' ? 'flex' : 'none';
  renderSchedulesPage();
}

// ── Main render ──────────────────────────────────────────────────
function renderSchedulesPage() {
  const isAdm = isAdmin();

  // Admin controls
  const adminBtns = document.getElementById('schedPageAdminBtns');
  if (adminBtns) adminBtns.style.display = isAdm ? '' : 'none';
  const leaveBtn = document.getElementById('schedStaffLeaveBtn');
  if (leaveBtn) leaveBtn.style.display = isAdm ? 'none' : '';
  const staffLeaveCountBtn = document.getElementById('schedStaffLeaveCountBtn');
  if (staffLeaveCountBtn) staffLeaveCountBtn.style.display = isAdm ? 'none' : '';

  // Filter bar always visible; staff filter only for admin
  const filterBar = document.getElementById('schedFilterBar');
  if (filterBar) filterBar.style.display = '';
  const staffWrap = document.getElementById('schedStaffFilterWrap');
  if (staffWrap) staffWrap.style.display = isAdm ? '' : 'none';

  // Populate staff filter
  if (isAdm) {
    const staffSel = document.getElementById('schedStaffFilter');
    if (staffSel && staffSel.options.length <= 1) {
      const staff = (DB.users||[]).filter(u => u.role === 'staff');
      staffSel.innerHTML = '<option value="ALL">All Staff</option>' +
        staff.map(u => `<option value="${_esc(u.id)}">${_esc(u.name||u.id)}</option>`).join('');
    }
  }

  // Apply visibility scope:
  // Admins see every task. Staff only ever see tasks assigned to them —
  // this filter applies regardless of which view (month/week/day/list) is active.
  let tasks = [...(DB.weekSchedules || [])];
  if (!isAdm && currentUser) {
    tasks = tasks.filter(t => t.staffId === currentUser.id);
  } else if (isAdm) {
    const sv = document.getElementById('schedStaffFilter')?.value || 'ALL';
    if (sv !== 'ALL') tasks = tasks.filter(t => t.staffId === sv);
  }

  // Sort by date+time
  tasks.sort((a,b) => (a.date+(a.inTime||'')).localeCompare(b.date+(b.inTime||'')));

  const el = document.getElementById('schedPageContent');
  if (!el) return;

  if (_schedView === 'month') {
    if (!_schedMonthDate) _schedMonthDate = todayIso();
    el.innerHTML = renderSchedMonthView(tasks, isAdm);
    initMonthSwipe();
  } else if (_schedView === 'day') {
    if (!_schedDayDate) _schedDayDate = todayIso();
    el.innerHTML = renderSchedDayView(tasks, isAdm);
  } else {
    const listFromEl = document.getElementById('schedDateFrom');
    const listToEl   = document.getElementById('schedDateTo');
    const lFrom = listFromEl?.value || '';
    const lTo   = listToEl?.value   || '';
    const listTasks = (lFrom || lTo)
      ? tasks.filter(t => (!lFrom || t.date >= lFrom) && (!lTo || t.date <= lTo))
      : tasks;
    el.innerHTML = renderSchedListView(listTasks, isAdm);
  }
}

function clearSchedDateFilter() {
  const fromEl = document.getElementById('schedDateFrom');
  const toEl   = document.getElementById('schedDateTo');
  if (fromEl) fromEl.value = '';
  if (toEl)   toEl.value   = '';
  renderSchedulesPage();
}

// ── MONTH VIEW ───────────────────────────────────────────────────
function schedNavMonth(n) {
  _navOnce(() => {
    _schedMonthDate = addMonths(_schedMonthDate || todayIso(), n);
    renderSchedulesPage();
  });
}
function schedNavMonthToday() {
  _navOnce(() => {
    _schedMonthDate = todayIso();
    renderSchedulesPage();
  });
}
function schedOpenDay(iso) {
  _schedDayDate = iso;
  setSchedView('day');
}
function renderSchedMonthView(tasks, isAdm) {
  const anchor = _schedMonthDate || todayIso();
  const [y, m] = anchor.split('-').map(Number);
  const firstOfMonth = `${y}-${String(m).padStart(2,'0')}-01`;
  const gridStart = getMonday(firstOfMonth);

  // Count tasks per date for quick lookup
  const countByDate = {};
  tasks.forEach(t => { countByDate[t.date] = (countByDate[t.date] || 0) + 1; });

  const todays = todayIso();
  const cells = [];
  for (let i = 0; i < 42; i++) {           // 6 weeks always, consistent grid height
    const d = addDays(gridStart, i);
    const inMonth = Number(d.slice(5,7)) === m;
    const isToday = d === todays;
    const count = countByDate[d] || 0;

    cells.push(`
      <div onclick="schedOpenDay('${d}')" style="aspect-ratio:1;min-height:44px;border-radius:8px;cursor:pointer;
           display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;
           background:${isToday ? 'var(--accent2)' : 'var(--card2)'};
           opacity:${inMonth ? '1' : '0.35'};">
        <div style="font-size:12px;font-weight:${isToday?'800':'600'};color:${isToday?'#fff':'var(--offwhite)'};">${Number(d.slice(8,10))}</div>
        ${count ? `<div style="font-size:8px;font-weight:700;padding:1px 5px;border-radius:99px;
             background:${isToday?'rgba(255,255,255,.3)':'var(--accent2)'};color:${isToday?'#fff':'#fff'};">${count}</div>` : ''}
      </div>`);
  }

  const dowHeader = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
    .map(d => `<div style="text-align:center;font-size:10px;font-weight:700;color:var(--gray);text-transform:uppercase;">${d}</div>`).join('');

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <button class="btn" style="padding:5px 12px;font-size:12px;" onclick="schedNavMonth(-1)">‹</button>
      <div style="font-size:13px;font-weight:800;color:var(--offwhite);display:flex;align-items:center;gap:6px;">
        ${monthLabel(anchor)}
        
      </div>
      <button class="btn" style="padding:5px 12px;font-size:12px;" onclick="schedNavMonth(1)">›</button>
    </div>
    <div id="schedMonthGrid"
         style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:6px;">${dowHeader}</div>
    <div id="schedMonthCells"
         style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;touch-action:pan-y;">${cells.join('')}</div>
    <div style="font-size:10px;color:var(--gray);text-align:center;margin-top:8px;">Swipe left/right or use arrows to change month</div>`;
}

// ── WEEK VIEW ────────────────────────────────────────────────────
function initMonthSwipe() {
  const el = document.getElementById('schedMonthCells');
  if (!el) return;
  let sx = 0, sy = 0, moved = false;
  el.addEventListener('touchstart', e => {
    sx = e.touches[0].clientX;
    sy = e.touches[0].clientY;
    moved = false;
  }, { passive: true });
  el.addEventListener('touchmove', e => {
    const dx = Math.abs(e.touches[0].clientX - sx);
    const dy = Math.abs(e.touches[0].clientY - sy);
    if (dx > dy && dx > 8) moved = true;
  }, { passive: true });
  el.addEventListener('touchend', e => {
    if (!moved) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 40) schedNavMonth(dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ── WEEK VIEW ────────────────────────────────────────────────────
function schedNavWeek(mon) {
  _navOnce(() => {
    _schedWeekFrom = mon;
    renderSchedulesPage();
  });
}
function renderSchedWeekView(tasks, from, isAdm) {
  const to = addDays(from, 6);
  const weekTasks = tasks.filter(t => t.date >= from && t.date <= to);

  const cols = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    const dayTasks = weekTasks.filter(t => t.date === d);
    const isToday = d === todayIso();

    const taskHtml = dayTasks.length
      ? dayTasks.map(t => schedTaskChip(t, isAdm)).join('')
      : `<div style="font-size:11px;color:var(--graydk);text-align:center;padding:12px 0;">No tasks</div>`;

    cols.push(`
      <div style="min-width:110px;flex:1;">
        <div onclick="schedOpenDay('${d}')" style="cursor:pointer;text-align:center;padding:6px 4px;border-radius:8px;margin-bottom:8px;
             background:${isToday ? 'var(--accent2)' : 'var(--card2)'};
             color:${isToday ? '#fff' : 'var(--gray)'};">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;">${dayName(d)}</div>
          <div style="font-size:15px;font-weight:800;">${shortDate(d)}</div>
        </div>
        ${taskHtml}
      </div>`);
  }

  const prevMon = addDays(from, -7);
  const nextMon = addDays(from,  7);

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
      <button class="btn" style="padding:5px 12px;font-size:12px;" onclick="schedNavWeek('${prevMon}')">‹ Prev</button>
      <div style="font-size:12px;font-weight:700;color:var(--offwhite);">${shortDate(from)} – ${shortDate(to)}</div>
      <button class="btn" style="padding:5px 12px;font-size:12px;" onclick="schedNavWeek('${nextMon}')">Next ›</button>
    </div>
    <div style="display:flex;gap:8px;overflow-x:scroll;overflow-y:visible;padding-bottom:8px;-webkit-overflow-scrolling:touch;touch-action:pan-x;scroll-snap-type:x mandatory;">
      ${cols.join('')}
    </div>`;
}

// ── DAY VIEW ─────────────────────────────────────────────────────
function schedNavDay(n) {
  _navOnce(() => {
    _schedDayDate = addDays(_schedDayDate || todayIso(), n);
    renderSchedulesPage();
  });
}
function schedNavDayToday() {
  _navOnce(() => {
    _schedDayDate = todayIso();
    renderSchedulesPage();
  });
}
function renderSchedDayView(tasks, isAdm) {
  const dayTasks = tasks.filter(t => t.date === _schedDayDate);
  const isToday  = _schedDayDate === todayIso();

  const body = dayTasks.length
    ? dayTasks.map(t => schedTaskCard(t, isAdm)).join('')
    : `<div class="empty-state" style="padding:32px 0;text-align:center;color:var(--gray);">
         <div style="font-size:32px;margin-bottom:8px;">📭</div>
         <div style="font-size:13px;">No tasks scheduled for this day</div>
       </div>`;

  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;gap:8px;">
      <button class="btn" style="padding:5px 16px;font-size:16px;min-width:44px;flex-shrink:0;" onclick="schedNavDay(-1)">‹</button>
      <div style="font-size:13px;font-weight:800;color:var(--offwhite);text-align:center;flex:1;">
        ${dayName(_schedDayDate)}, ${shortDate(_schedDayDate)}
        
      </div>
      <button class="btn" style="padding:5px 16px;font-size:16px;min-width:44px;flex-shrink:0;" onclick="schedNavDay(1)">›</button>
    </div>
    ${body}`;
}

// ── LIST VIEW ────────────────────────────────────────────────────
function renderSchedListView(tasks, isAdm) {
  if (!tasks.length) return `<div class="empty-state" style="padding:40px 0;text-align:center;color:var(--gray);">
    <div style="font-size:36px;margin-bottom:8px;">📋</div>
    <div style="font-size:13px;">${isAdm ? 'No scheduled tasks found. Try adjusting filters.' : 'No tasks assigned to you yet.'}</div>
  </div>`;

  // Group by date
  const byDate = {};
  tasks.forEach(t => { (byDate[t.date] = byDate[t.date] || []).push(t); });

  return Object.keys(byDate).sort().map(date => `
    <div style="margin-bottom:14px;">
      <div style="font-size:11px;font-weight:800;color:var(--accent2);letter-spacing:.4px;text-transform:uppercase;margin-bottom:7px;display:flex;align-items:center;gap:8px;">
        <span>${dayName(date)}, ${shortDate(date)}</span>
        ${date===todayIso() ? '<span style="font-size:9px;background:var(--accent2);color:#fff;padding:2px 7px;border-radius:99px;">TODAY</span>' : ''}
      </div>
      ${byDate[date].map(t => schedTaskCard(t, isAdm)).join('')}
    </div>`).join('');
}

// ── Task chip (compact, for week view) ───────────────────────────
// ── Status helpers ───────────────────────────────────────────────
// status flow: 'scheduled' → 'in_progress' → 'done'  (or 'cancelled')
const SCHED_COLORS = { scheduled:'#3b82f6', pending:'#3b82f6', in_progress:'#f59e0b', done:'#22c55e', cancelled:'#ef4444' };
const SCHED_LABELS = { scheduled:'📅 Scheduled', pending:'📅 Scheduled', in_progress:'▶️ In Progress', done:'✅ Done', cancelled:'❌ Cancelled' };

function fmtTime12(isoStr) {
  // "2026-06-28T09:34:00.000Z" → "9:34 AM"
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleTimeString('en-IN', { hour:'numeric', minute:'2-digit', hour12:true });
}
// Convert HH:MM (24h input value) → "9:00 AM" / "1:30 PM"
function fmt24to12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h % 12) || 12)}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

// ── Task chip (compact, for week view) ───────────────────────────
function schedTaskChip(t, isAdm) {
  const color = SCHED_COLORS[t.status] || SCHED_COLORS.scheduled;
  const label = SCHED_LABELS[t.status] || SCHED_LABELS.scheduled;
  const inBadge  = t.startedAt  ? `<div style="font-size:9px;color:#f59e0b;margin-top:2px;">▶ In ${fmtTime12(t.startedAt)}</div>` : '';
  const doneBadge= t.completedAt? `<div style="font-size:9px;color:#22c55e;margin-top:1px;">✓ Out ${fmtTime12(t.completedAt)}</div>` : '';
  const staffLabel = isAdm ? `<div style="font-size:9px;color:var(--gray);margin-top:1px;">👤 ${_esc(staffName(t.staffId))}</div>` : '';

  return `<div onclick="openViewTask('${t.id}')" style="background:var(--card2);border-radius:7px;padding:7px 8px;margin-bottom:5px;cursor:pointer;
    border-left:3px solid ${color};transition:box-shadow .15s;" onmouseover="this.style.boxShadow='0 2px 8px rgba(0,0,0,.15)'" onmouseout="this.style.boxShadow=''">
    <div style="font-size:10px;font-weight:700;color:${color};">${t.inTime?'⏰ '+fmt24to12(t.inTime):''}${t.inTime&&t.outTime?' – ':''}${t.outTime?fmt24to12(t.outTime)+' · ':''}${label}</div>
    <div style="font-size:11px;font-weight:700;color:var(--offwhite);margin-top:2px;line-height:1.3;">${_esc(t.task||'')}</div>
    ${t.sport ? `<div style="font-size:9px;color:var(--accent2);margin-top:2px;font-weight:700;">🏅 ${_esc(t.sport)}${t.batch?' · '+_esc(t.batch):''}</div>` : ''}
    ${t.location ? `<div style="font-size:10px;color:var(--gray);margin-top:2px;">📍 ${_esc(t.location)}</div>` : ''}
    ${inBadge}${doneBadge}${staffLabel}
  </div>`;
}

// ── Task card (full, for day/list view) ──────────────────────────
function schedTaskCard(t, isAdm) {
  const color = SCHED_COLORS[t.status] || SCHED_COLORS.scheduled;
  const label = SCHED_LABELS[t.status] || SCHED_LABELS.scheduled;

  const staffBadge = isAdm
    ? `<span style="background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:3px 8px;font-size:11px;font-weight:700;color:var(--offwhite);">👤 ${_esc(staffName(t.staffId))}</span>`
    : '';

  // Check-in / check-out timeline row
  const timeline = (t.startedAt || t.completedAt) ? `
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:7px;padding:8px 10px;background:var(--card2);border-radius:8px;">
      ${t.startedAt   ? `<div style="font-size:11px;"><span style="color:var(--gray);">▶ Started:</span> <span style="font-weight:700;color:#f59e0b;">${fmtTime12(t.startedAt)}</span></div>` : ''}
      ${t.completedAt ? `<div style="font-size:11px;"><span style="color:var(--gray);">✓ Completed:</span> <span style="font-weight:700;color:#22c55e;">${fmtTime12(t.completedAt)}</span></div>` : ''}
      ${(t.startedAt && t.completedAt) ? `<div style="font-size:11px;"><span style="color:var(--gray);">⏱ Duration:</span> <span style="font-weight:700;color:var(--offwhite);">${calcDuration(t.startedAt, t.completedAt)}</span></div>` : ''}
    </div>` : '';

  const adminActions = isAdm ? `
    <div style="display:flex;gap:5px;margin-top:10px;">
      <button class="btn btn-xs" style="font-size:11px;padding:4px 10px;" onclick="openEditTaskSchedule('${t.id}')">✏️ Edit</button>
      <button class="btn btn-xs" style="font-size:11px;padding:4px 10px;background:#ef444422;color:#f87171;border:1px solid #ef444444;" onclick="deleteTaskSchedule('${t.id}')">🗑 Delete</button>
    </div>` : '';

  // Staff action buttons based on status
  let staffActions = '';
  if (!isAdm) {
    if (t.status === 'scheduled' || t.status === 'pending') {
      staffActions = `<div style="margin-top:10px;">
        <button class="btn" style="width:100%;font-size:12px;padding:9px;background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b44;font-weight:700;" onclick="markTaskStarted('${t.id}')">▶️ Start — Check In</button>
      </div>`;
    } else if (t.status === 'in_progress') {
      staffActions = `<div style="margin-top:10px;">
        <button class="btn" style="width:100%;font-size:12px;padding:9px;background:#22c55e22;color:#22c55e;border:1px solid #22c55e44;font-weight:700;" onclick="markTaskDone('${t.id}')">✅ Done — Check Out</button>
      </div>`;
    }
  }

  return `<div class="card" style="margin-bottom:8px;padding:13px 14px;border-left:4px solid ${color};">
    <div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:6px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:14px;font-weight:800;color:var(--offwhite);margin-bottom:4px;">${_esc(t.task||'Untitled Task')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:6px;">
          ${t.sport ? `<span style="font-size:10px;font-weight:700;background:var(--accent2)22;color:var(--accent2);border:1px solid var(--accent2)44;padding:2px 7px;border-radius:6px;">🏅 ${_esc(t.sport)}${t.batch?' · '+_esc(t.batch):''}</span>` : ''}
          ${t.inTime ? `<span style="font-size:11px;font-weight:700;color:${color};">⏰ ${fmt24to12(t.inTime)}${t.outTime?' – '+fmt24to12(t.outTime):''}</span>` : ''}
          ${t.date ? `<span style="font-size:11px;color:var(--gray);">📆 ${isoToDisplay(t.date)}</span>` : ''}
          ${t.location ? `<span style="font-size:11px;color:var(--gray);">📍 ${_esc(t.location)}</span>` : ''}
        </div>
        ${t.note ? `<div style="font-size:12px;color:var(--gray);font-style:italic;margin-bottom:6px;">${_esc(t.note)}</div>` : ''}
        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
          ${staffBadge}
          <span style="font-size:11px;font-weight:700;color:${color};background:${color}22;border:1px solid ${color}44;padding:3px 8px;border-radius:6px;">${label}</span>
        </div>
        ${timeline}
      </div>
    </div>
    ${adminActions}
    ${staffActions}
  </div>`;
}

// ── Duration calculator ───────────────────────────────────────────
function calcDuration(startIso, endIso) {
  const ms = new Date(endIso) - new Date(startIso);
  if (ms < 0) return '—';
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ── View task detail modal ────────────────────────────────────────
function openViewTask(id) {
  const t = (DB.weekSchedules||[]).find(x => x.id === id);
  if (!t) return;
  const isAdm = isAdmin();
  const el = document.getElementById('viewTaskBody');
  if (!el) return;

  const color = SCHED_COLORS[t.status] || SCHED_COLORS.scheduled;
  const label = SCHED_LABELS[t.status] || SCHED_LABELS.scheduled;

  const timelineBlock = (t.startedAt || t.completedAt) ? `
    <div style="margin-top:10px;padding:10px 12px;background:var(--card2);border-radius:10px;">
      <div style="font-size:10px;font-weight:800;color:var(--gray);letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px;">Attendance Timeline</div>
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${t.startedAt ? `
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:28px;height:28px;border-radius:50%;background:#f59e0b22;border:2px solid #f59e0b;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">▶</div>
          <div>
            <div style="font-size:12px;font-weight:700;color:#f59e0b;">Checked In — ${fmtTime12(t.startedAt)}</div>
            <div style="font-size:10px;color:var(--gray);">Started by ${_esc(staffName(t.startedBy||t.staffId))}</div>
          </div>
        </div>` : ''}
        ${(t.startedAt && t.completedAt) ? `<div style="width:2px;height:12px;background:var(--border);margin-left:13px;"></div>` : ''}
        ${t.completedAt ? `
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:28px;height:28px;border-radius:50%;background:#22c55e22;border:2px solid #22c55e;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;">✓</div>
          <div>
            <div style="font-size:12px;font-weight:700;color:#22c55e;">Checked Out — ${fmtTime12(t.completedAt)}</div>
            <div style="font-size:10px;color:var(--gray);">${t.startedAt ? `Duration: ${calcDuration(t.startedAt, t.completedAt)}` : ''}</div>
          </div>
        </div>` : ''}
      </div>
    </div>` : '';

  el.innerHTML = `
    <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border);">
      <div style="font-size:16px;font-weight:800;color:var(--offwhite);margin-bottom:8px;">${_esc(t.task||'')}</div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        <div style="background:var(--card2);border-radius:8px;padding:8px 12px;font-size:12px;">
          <div style="color:var(--gray);font-size:10px;margin-bottom:2px;">ASSIGNED TO</div>
          <div style="font-weight:700;color:var(--offwhite);">👤 ${_esc(staffName(t.staffId))}</div>
        </div>
        <div style="background:var(--card2);border-radius:8px;padding:8px 12px;font-size:12px;">
          <div style="color:var(--gray);font-size:10px;margin-bottom:2px;">DATE &amp; TIME</div>
          <div style="font-weight:700;color:var(--offwhite);">📆 ${isoToDisplay(t.date)}${t.inTime?' ⏰ '+fmt24to12(t.inTime)+(t.outTime?' – '+fmt24to12(t.outTime):''):''}</div>
        </div>
        ${t.location ? `<div style="background:var(--card2);border-radius:8px;padding:8px 12px;font-size:12px;">
          <div style="color:var(--gray);font-size:10px;margin-bottom:2px;">LOCATION</div>
          <div style="font-weight:700;color:var(--offwhite);">📍 ${_esc(t.location)}</div>
        </div>` : ''}
        <div style="background:${color}22;border:1px solid ${color}44;border-radius:8px;padding:8px 12px;font-size:12px;">
          <div style="color:var(--gray);font-size:10px;margin-bottom:2px;">STATUS</div>
          <div style="font-weight:700;color:${color};">${label}</div>
        </div>
      </div>
      ${t.note ? `<div style="margin-top:10px;font-size:13px;color:var(--gray);font-style:italic;background:var(--card2);border-radius:8px;padding:10px;">💬 ${_esc(t.note)}</div>` : ''}
      ${timelineBlock}
    </div>
    <div style="font-size:11px;color:var(--graydk);">Assigned by ${_esc(staffName(t.createdBy))} on ${isoToDisplay((t.createdAt||'').slice(0,10))}</div>

    ${isAdm ? `<div style="display:flex;gap:8px;margin-top:14px;">
      <button class="btn" style="flex:1;background:var(--card2);font-size:12px;" onclick="closeModal('modalViewTask');openEditTaskSchedule('${t.id}')">✏️ Edit</button>
      <button class="btn" style="flex:1;background:#ef444422;color:#f87171;border:1px solid #ef444444;font-size:12px;" onclick="closeModal('modalViewTask');deleteTaskSchedule('${t.id}')">🗑 Delete</button>
    </div>` : ''}

    ${!isAdm && t.status === 'scheduled' || t.status === 'pending' ? `
      <button class="btn" style="width:100%;background:#f59e0b22;color:#f59e0b;border:1px solid #f59e0b44;margin-top:12px;font-size:13px;padding:11px;font-weight:700;"
        onclick="markTaskStarted('${t.id}');closeModal('modalViewTask')">▶️ Start — Check In Now</button>` : ''}

    ${!isAdm && t.status === 'in_progress' ? `
      <div style="background:#f59e0b11;border:1px solid #f59e0b33;border-radius:10px;padding:10px;margin-top:12px;text-align:center;">
        <div style="font-size:11px;color:#f59e0b;font-weight:700;margin-bottom:8px;">⏱ In progress since ${fmtTime12(t.startedAt)}</div>
        <button class="btn" style="width:100%;background:#22c55e22;color:#22c55e;border:1px solid #22c55e44;font-size:13px;padding:11px;font-weight:700;"
          onclick="markTaskDone('${t.id}');closeModal('modalViewTask')">✅ Done — Check Out Now</button>
      </div>` : ''}
  `;
  openModal('modalViewTask');
}

// ── Staff: check in (start) ───────────────────────────────────────
async function markTaskStarted(id) {
  const idx = (DB.weekSchedules||[]).findIndex(x => x.id === id);
  if (idx < 0) return;
  const now = new Date().toISOString();
  const { error } = await sb().from('week_schedules').update({
    status: 'in_progress', started_at: now, started_by: currentUser?.id
  }).eq('id', id);
  if (error) { showToast('Failed: ' + error.message, 'error'); return; }
  DB.weekSchedules[idx].status    = 'in_progress';
  DB.weekSchedules[idx].startedAt = now;
  DB.weekSchedules[idx].startedBy = currentUser?.id;
  showToast('Checked in ▶️ — task started', 'success');
  renderSchedulesPage();
}

// ── Staff: check out (done) ───────────────────────────────────────
async function markTaskDone(id) {
  const idx = (DB.weekSchedules||[]).findIndex(x => x.id === id);
  if (idx < 0) return;
  const now = new Date().toISOString();
  const { error } = await sb().from('week_schedules').update({
    status: 'done', completed_at: now, completed_by: currentUser?.id
  }).eq('id', id);
  if (error) { showToast('Failed: ' + error.message, 'error'); return; }
  DB.weekSchedules[idx].status      = 'done';
  DB.weekSchedules[idx].completedAt = now;
  DB.weekSchedules[idx].completedBy = currentUser?.id;
  showToast('✅ Checked out — task complete!', 'success');
  renderSchedulesPage();
}

// ── Open create/edit modal ────────────────────────────────────────
// ── Populate sport/batch dropdowns in task modal ─────────────────
function populateTsSportBatch(selSport, selBatch) {
  const sports = DB.sports || [];
  const sportEl = document.getElementById('tsSport');
  const batchEl = document.getElementById('tsBatch');
  if (!sportEl || !batchEl) return;
  sportEl.innerHTML = '<option value="">— Any sport —</option>' +
    sports.map(s => `<option value="${_esc(s)}" ${s===selSport?'selected':''}>${_esc(s)}</option>`).join('');
  onTsSportChange(selBatch);
}
function onTsSportChange(preselBatch) {
  const sport = document.getElementById('tsSport')?.value || '';
  const batchEl = document.getElementById('tsBatch');
  if (!batchEl) return;
  const batchSport = DB.batchSport || {};
  const batches = sport
    ? Object.keys(batchSport).filter(b => batchSport[b] === sport)
    : Object.keys(batchSport);
  batchEl.innerHTML = '<option value="">— Any batch —</option>' +
    batches.map(b => `<option value="${_esc(b)}" ${b===preselBatch?'selected':''}>${_esc(b)}</option>`).join('');
}

// ── Date range → show/hide recurring panel ────────────────────────
function onTsDateChange() {
  const from = document.getElementById('tsDateFrom')?.value || '';
  const to   = document.getElementById('tsDateTo')?.value   || '';
  const wrap  = document.getElementById('tsRecurringWrap');
  if (!wrap) return;
  // Show recurring only when a multi-day range is chosen
  const multiDay = from && to && to > from;
  wrap.style.display = multiDay ? '' : 'none';
  if (!multiDay) document.getElementById('tsRecurringPreview').textContent = '';
  else updateTsRecurringPreview(from, to);
  updateTsAssignPreview();
}

function getCheckedDays() {
  return [...document.querySelectorAll('#tsDayChips input[type=checkbox]:checked')].map(c => parseInt(c.value));
}

function updateTsRecurringPreview(from, to) {
  const days = getCheckedDays();
  if (!days.length || !from || !to) {
    document.getElementById('tsRecurringPreview').textContent = '';
    return;
  }
  const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dates = expandDates(from, to, days);
  document.getElementById('tsRecurringPreview').textContent =
    `${dates.length} occurrence(s): ${days.map(d=>dayNames[d]).join(', ')} between ${isoToDisplay(from)} and ${isoToDisplay(to)}`;
}

// ── Expand a date range by recurring weekdays ─────────────────────
// days: array of 0-6 (Sun=0). If empty, returns every day in range.
function expandDates(from, to, days) {
  const result = [];
  let cur = new Date(from + 'T00:00:00');
  const end = new Date(to   + 'T00:00:00');
  while (cur <= end) {
    if (!days.length || days.includes(cur.getDay())) {
      result.push(_isoLocal(cur));
    }
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

function updateTsAssignPreview() {
  const from  = document.getElementById('tsDateFrom')?.value || '';
  const to    = document.getElementById('tsDateTo')?.value   || '';
  const days  = getCheckedDays();
  const prevEl = document.getElementById('tsAssignPreview');
  if (!prevEl) return;
  if (!from) { prevEl.style.display='none'; return; }

  const dates = (!to || to <= from) ? [from] : expandDates(from, to, days);
  const checks = document.querySelectorAll('#tsStaffList input[type=checkbox]:checked');
  const staffCount = checks.length;

  if (!dates.length) { prevEl.style.display='none'; return; }
  prevEl.style.display = '';
  prevEl.innerHTML = `Will create <strong>${dates.length * Math.max(staffCount,1)}</strong> task record(s): 
    <strong>${dates.length}</strong> date(s) × <strong>${Math.max(staffCount,1)}</strong> staff`;
}

// ── 12hr time select helpers ─────────────────────────────────────
// Converts HH:MM (24hr) → sets hour/min/ampm selects
function setTimeSelects(prefix, hhmm) {
  // prefix: 'tsIn' → element id: 'tsInTime', 'tsOut' → 'tsOutTime'
  const el = document.getElementById(prefix + 'Time');
  if (!el) return;
  el.value = hhmm || '';
}
// Reads native time input → HH:MM (24hr) for storage, or '' if blank
function getTimeFromSelects(prefix) {
  return document.getElementById(prefix + 'Time')?.value || '';
}

function openNewTaskSchedule() {
  if (!isAdmin()) { showToast('Only admins can assign tasks','error'); return; }
  _schedEditId = null;
  document.getElementById('tsModalTitle').textContent = '📅 Assign New Task';
  document.getElementById('tsTask').value = '';
  document.getElementById('tsLocation').value = '';
  document.getElementById('tsDateFrom').value = todayIso();
  document.getElementById('tsDateTo').value = '';
  document.getElementById('tsInTime').value = '';
  document.getElementById('tsOutTime').value = '';
  document.getElementById('tsNote').value = '';
  document.getElementById('tsRecurringWrap').style.display = 'none';
  document.getElementById('tsAssignPreview').style.display = 'none';
  // Uncheck all day chips
  document.querySelectorAll('#tsDayChips input[type=checkbox]').forEach(c => c.checked = false);
  populateTsSportBatch('', '');
  buildStaffCheckboxes([]);
  openModal('modalTaskSchedule');
}

function openEditTaskSchedule(id) {
  if (!isAdmin()) return;
  const t = (DB.weekSchedules||[]).find(x => x.id === id);
  if (!t) return;
  _schedEditId = id;
  document.getElementById('tsModalTitle').textContent = '✏️ Edit Task';
  document.getElementById('tsTask').value = t.task || '';
  document.getElementById('tsLocation').value = t.location || '';
  document.getElementById('tsDateFrom').value = t.date || '';
  document.getElementById('tsDateTo').value = '';
  setTimeSelects('tsIn', t.inTime || '');
  setTimeSelects('tsOut', t.outTime || '');
  document.getElementById('tsNote').value = t.note || '';
  document.getElementById('tsRecurringWrap').style.display = 'none';
  document.getElementById('tsAssignPreview').style.display = 'none';
  document.querySelectorAll('#tsDayChips input[type=checkbox]').forEach(c => c.checked = false);
  populateTsSportBatch(t.sport||'', t.batch||'');
  buildStaffCheckboxes(Array.isArray(t.staffId) ? t.staffId : (t.staffId ? [t.staffId] : []));
  openModal('modalTaskSchedule');
}

function buildStaffCheckboxes(selected) {
  const container = document.getElementById('tsStaffList');
  if (!container) return;
  const staff = (DB.users||[]).filter(u => u.role === 'staff');
  if (!staff.length) {
    container.innerHTML = '<div style="font-size:12px;color:var(--gray);">No staff members found. Add staff from Profile → Users.</div>';
    return;
  }
  container.innerHTML = staff.map(u => `
    <label style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:8px;cursor:pointer;background:var(--card2);border:1px solid var(--border);margin-bottom:5px;transition:background .15s;"
           onmouseover="this.style.background='var(--border)'" onmouseout="this.style.background='var(--card2)'" onclick="updateTsAssignPreview()">
      <input type="checkbox" value="${_esc(u.id)}" ${selected.includes(u.id)?'checked':''} style="width:16px;height:16px;accent-color:var(--accent2);">
      <div>
        <div style="font-size:13px;font-weight:700;color:var(--offwhite);">${_esc(u.name||u.id)}</div>
        <div style="font-size:10px;color:var(--gray);">${_esc(u.email||'')}</div>
      </div>
    </label>`).join('');
}

async function saveTaskSchedule() {
  const task     = (document.getElementById('tsTask')?.value||'').trim();
  const location = (document.getElementById('tsLocation')?.value||'').trim();
  const sport    = document.getElementById('tsSport')?.value || '';
  const batch    = document.getElementById('tsBatch')?.value || '';
  const dateFrom = document.getElementById('tsDateFrom')?.value || '';
  const dateTo   = document.getElementById('tsDateTo')?.value   || '';
  const inTime   = getTimeFromSelects('tsIn');
  const outTime  = getTimeFromSelects('tsOut');
  const note     = (document.getElementById('tsNote')?.value||'').trim();

  // Collect recurring days (only used when dateTo is set)
  const recurDays = getCheckedDays();

  // Collect checked staff
  const checks = document.querySelectorAll('#tsStaffList input[type=checkbox]:checked');
  const staffIds = [...checks].map(c => c.value);

  if (!task)           { showToast('Please enter a task description','error'); return; }
  if (!dateFrom)       { showToast('Please pick a From date','error'); return; }
  if (!staffIds.length){ showToast('Please select at least one staff member','error'); return; }

  // Build list of dates to create tasks for
  let dates;
  if (!dateTo || dateTo <= dateFrom) {
    dates = [dateFrom];
  } else {
    // Multi-day range
    if (recurDays.length === 0) {
      // No specific days chosen — every day in range
      dates = expandDates(dateFrom, dateTo, []);
    } else {
      dates = expandDates(dateFrom, dateTo, recurDays);
    }
    if (!dates.length) { showToast('No matching dates in range for selected days','warn'); return; }
  }

  DB.weekSchedules = DB.weekSchedules || [];
  const aid = acadId();

  if (_schedEditId) {
    // Edit single record
    const idx = DB.weekSchedules.findIndex(x => x.id === _schedEditId);
    if (idx >= 0) {
      const updRow = {
        task, location, sport, batch,
        date: dateFrom, in_time: inTime, out_time: outTime, note,
        staff_id: staffIds[0],
        updated_by: currentUser?.id, updated_at: new Date().toISOString()
      };
      const { error } = await sb().from('week_schedules').update(updRow).eq('id', _schedEditId);
      if (error) { showToast('Save failed: ' + error.message, 'error'); return; }
      DB.weekSchedules[idx] = { ...DB.weekSchedules[idx], ...{
        task, location, sport, batch, date: dateFrom, inTime, outTime, note,
        staffId: staffIds[0], updatedBy: currentUser?.id, updatedAt: updRow.updated_at
      }};
      // Extra staff (multi-assign on edit) — insert as new rows
      const extraRows = staffIds.slice(1).map(sid => ({
        id: 'ts_'+Date.now()+'_'+Math.random().toString(36).slice(2,5),
        academy_id: aid, staff_id: sid, date: dateFrom,
        task, location, sport, batch, in_time: inTime, out_time: outTime, note,
        status: 'scheduled', created_by: currentUser?.id, created_at: new Date().toISOString()
      }));
      if (extraRows.length) {
        const { error: e2 } = await sb().from('week_schedules').insert(extraRows);
        if (!e2) extraRows.forEach(r => DB.weekSchedules.push({ id: r.id, staffId: r.staff_id, date: r.date, task, location, sport, batch, inTime, outTime, note, status: 'scheduled', createdBy: r.created_by, createdAt: r.created_at }));
      }
    }
    showToast('Task updated ✓', 'success');
  } else {
    // New: batch insert all dates × staff
    const ts = Date.now();
    let counter = 0;
    const rows = [];
    dates.forEach(date => {
      staffIds.forEach(sid => {
        rows.push({
          id: 'ts_' + ts + '_' + (counter++) + '_' + Math.random().toString(36).slice(2,5),
          academy_id: aid, staff_id: sid, date,
          task, location, sport, batch,
          in_time: inTime, out_time: outTime, note,
          recur_days: recurDays.length ? recurDays : null,
          status: 'scheduled',
          created_by: currentUser?.id, created_at: new Date().toISOString()
        });
      });
    });

    // Insert in chunks of 100 to avoid request size limits
    const chunkSize = 100;
    let failed = false;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error } = await sb().from('week_schedules').insert(chunk);
      if (error) { showToast('Save failed: ' + error.message, 'error'); failed = true; break; }
      chunk.forEach(r => DB.weekSchedules.push({
        id: r.id, staffId: r.staff_id, date: r.date,
        task, location, sport, batch, inTime, outTime, note,
        recurDays: r.recur_days, status: 'scheduled',
        createdBy: r.created_by, createdAt: r.created_at
      }));
    }
    if (!failed) showToast(`Created ${rows.length} task(s) ✓`, 'success');
  }
  closeModal('modalTaskSchedule');
  renderSchedulesPage();
}

async function deleteTaskSchedule(id) {
  if (!isAdmin()) return;
  if (!confirm('Delete this task assignment?')) return;
  const { error } = await sb().from('week_schedules').delete().eq('id', id);
  if (error) { showToast('Delete failed: ' + error.message, 'error'); return; }
  DB.weekSchedules = (DB.weekSchedules||[]).filter(x => x.id !== id);
  showToast('Task deleted', 'success');
  renderSchedulesPage();
}


function tabNav(page) {
  closeTabMenu();
  switchPage(page);
}
function drawerNav(page) {
  closeDrawer();
  switchPage(page);
}

// ── Inline roll edit ──────────────────────────────────────────
function startInlineRollEdit(sid) {
  const badge = document.getElementById('rollbadge_' + sid);
  if (!badge) return;
  const s = DB.students.find(x => x.id === sid);
  if (!s) return;
  badge.innerHTML = '';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.value = s.rollNo ? String(s.rollNo) : '';
  inp.placeholder = 'e.g. SM01';
  inp.maxLength = 20;
  inp.className = 'roll-edit-input';
  inp.onclick = e => e.stopPropagation();
  inp.onkeydown = e => {
    if (e.key === 'Enter')  { e.preventDefault(); saveInlineRollEdit(sid, inp.value.trim()); }
    if (e.key === 'Escape') { e.stopPropagation(); renderStudentList(); }
  };
  inp.onblur = () => saveInlineRollEdit(sid, inp.value.trim());
  badge.appendChild(inp);
  inp.focus();
  inp.select();
}
function saveInlineRollEdit(sid, newRoll) {
  newRoll = newRoll.toUpperCase();
  if (newRoll) {
    const dup = DB.students.find(s => String(s.rollNo||'').toUpperCase() === newRoll && s.id !== sid);
    if (dup) { showToast(`Roll ${newRoll} already used by ${dup.name}`, 'error'); renderStudentList(); return; }
  }
  const idx = DB.students.findIndex(s => s.id === sid);
  if (idx >= 0) {
    DB.students[idx].rollNo = newRoll || '';
    if (typeof sbSaveStudent === 'function') sbSaveStudent(DB.students[idx]).catch(()=>{});
    else if (typeof scheduleSupabasePush === 'function') scheduleSupabasePush();
    if (typeof addLog === 'function') addLog('student', `Roll updated to "${newRoll || 'none'}"`);
    showToast('Roll number saved ✓', 'success');
  }
  renderStudentList();
}
