// Core FeeZo application logic — state, rendering, all screens/modals
// (was the large inline <script> block, ~10,900 lines)
// ================================================================
// DATABASE
// ================================================================
let DB = {
  settings: { academyName:'Academy', logoUrl:'', email:'', phone:'', phone2:'', tagline:'', loginBgUrl:'', loginSupport:'', msgTemplate:'Dear {name}, your fee for {month} is pending at {academy}. Kindly pay at the earliest. Thank you.' },
  users: [
    { id:'admin', email:'admin@youracademy.com', name:'Admin', role:'admin' },
    { id:'staff1', email:'staff1@youracademy.com', name:'Staff 1', role:'staff' }
  ],
  batches: ['Batch 1','Batch 2','Batch 3'],
  sports: [],          // admin-managed list of sports
  batchSport: {},      // { batchName: sportName } — which sport each batch belongs to
  attDone: {},         // { "sport|YYYY-MM-DD": true } — attendance register closed for that sport+day
  feeDone: {},         // { "sport|YYYY-MM" : true } — fees finalized for that sport+month
  enrollments: [],     // [ {id, studentId, sport, batch, joinDate, active} ] — Stage 2
  students: [],
  attendance: {},  // { "YYYY-MM-DD": { studentId: "P"|"A" } }
  fees: {},         // { "YYYY-MM":    { studentId: { status, amount, method, date, by } } }
  notes: '',
  enquiries: [],
  snapshotIndex: [],
  changelog: [],
  msgLogs: [],
  classLog: [],
  schedules: [],
  perfScores: {},
  perfWeights: { points: 70, attendance: 30 },
  weekSchedules: [],   // [ {id, staffId, date, time, location, task, note, status('pending'|'in_progress'|'done'|'cancelled'), startedAt, startedBy, completedAt, completedBy, createdBy, createdAt} ]
  leaveRequests: []    // [ {id, staffId, date, reason, status('pending'|'approved'|'rejected'), appliedAt, reviewedBy, reviewedAt, note} ]
};

let currentUser = null;
let _appLaunched = false; // guard: only auto-launch the app once

// ── Cloudflare Turnstile CAPTCHA state + callbacks ──
let _turnstileToken = '';
function onTurnstileSuccess(token) { _turnstileToken = token; }
function onTurnstileExpired() { _turnstileToken = ''; }
function _resetTurnstile() {
  _turnstileToken = '';
  try { if (window.turnstile) window.turnstile.reset(); } catch(e) {}
}
let _currentAcademyId = null;  // set on login — scopes all Supabase queries to this academy
let currentPage = 'home';
let editStudId = null;
let _formEnrollments = []; // working list of {sport,batch,joinDate} while add/edit student form is open
let _rollAutoFilled = false; // true while sRollNo holds our auto-suggestion (so we know it's safe to overwrite)
let selectedBatch = { student:'ALL', att:'ALL', fee:'ALL' };
// Stage 4: which sport the attendance page is currently showing/marking
let _attSport = 'ALL';
// Returns the current attendance sport selection. 'ALL' = view all sports.
function attCurrentSport() {
  if (_attSport === 'ALL') return 'ALL';
  if (_attSport && (DB.sports||[]).includes(_attSport)) return _attSport;
  return (DB.sports && DB.sports[0]) || 'ALL';
}
// In ALL mode, resolve which sport a student's mark belongs to.
// Returns the sport string, or null if the student is in multiple sports (ambiguous).
function studentSingleSport(sid) {
  const realId = sid;
  const mine = (DB.enrollments||[]).filter(e => e.studentId === realId).map(e => e.sport);
  if (mine.length === 1) return mine[0];
  return null; // 0 or multiple → ambiguous
}
// Accessor helpers — keep the per-sport nesting in ONE place.
// Structure: DB.attendance[date][sport][studentId] = 'P' | 'A'
function attGet(dateKey, sid, sport) {
  const sp = sport || attCurrentSport();
  if (sp === 'ALL') {
    // Look across every sport that day; return this student's mark if any
    const day = DB.attendance[dateKey] || {};
    for (const spName of Object.keys(day)) {
      if (day[spName][sid] !== undefined) return day[spName][sid];
    }
    return undefined;
  }
  return ((DB.attendance[dateKey] || {})[sp] || {})[sid];
}
function attSet(dateKey, sid, status, sport) {
  let sp = sport || attCurrentSport();
  if (sp === 'ALL') sp = studentSingleSport(sid) || (DB.sports && DB.sports[0]);
  if (!sp) return;
  if (!DB.attendance[dateKey]) DB.attendance[dateKey] = {};
  if (!DB.attendance[dateKey][sp]) DB.attendance[dateKey][sp] = {};
  DB.attendance[dateKey][sp][sid] = status;
}
function attClear(dateKey, sid, sport) {
  let sp = sport || attCurrentSport();
  if (sp === 'ALL') sp = studentSingleSport(sid) || (DB.sports && DB.sports[0]);
  if (!sp || !DB.attendance[dateKey] || !DB.attendance[dateKey][sp]) return;
  delete DB.attendance[dateKey][sp][sid];
  if (!Object.keys(DB.attendance[dateKey][sp]).length) delete DB.attendance[dateKey][sp];
  if (!Object.keys(DB.attendance[dateKey]).length) delete DB.attendance[dateKey];
}
// Day map for a given date+sport. In ALL mode, merges all sports' marks for the day.
function attDayMap(dateKey, sport) {
  const sp = sport || attCurrentSport();
  if (sp === 'ALL') {
    const day = DB.attendance[dateKey] || {};
    const merged = {};
    Object.keys(day).forEach(spName => Object.assign(merged, day[spName]));
    return merged;
  }
  return (DB.attendance[dateKey] || {})[sp] || {};
}
// Scroll a list container to its bottom (down-arrow button)
function scrollListBottom(wrapId) {
  const el = document.getElementById(wrapId);
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
}
// Show the scroll-to-bottom arrow only when there's more to scroll AND not already at bottom
function updateScrollArrow(wrapId, btnId) {
  const el = document.getElementById(wrapId);
  const btn = document.getElementById(btnId);
  if (!el || !btn) return;
  const scrollable = el.scrollHeight - el.clientHeight > 8;
  const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
  const show = scrollable && !atBottom;
  btn.style.opacity = show ? '1' : '0';
  btn.style.pointerEvents = show ? 'auto' : 'none';
}
// ── Search box clear (✕) button helpers ──
function toggleSearchClearBtn(inputId, btnId) {
  const inp = document.getElementById(inputId);
  const btn = document.getElementById(btnId);
  if (!inp || !btn) return;
  btn.style.display = inp.value ? 'flex' : 'none';
}
function clearSearchField(inputId, btnId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.value = '';
  toggleSearchClearBtn(inputId, btnId);
  inp.focus();
}
// ── Students/Attendance/Fees search+filter bars: auto-hide on scroll-down,
// reappear on scroll-up (like a professional app's collapsing toolbar).
function _collapseSearchWrap(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.style.maxHeight = '0px';
  wrap.style.opacity = '0';
  wrap.style.marginBottom = '0px';
  wrap.style.pointerEvents = 'none';
}
function _expandSearchWrap(wrapId, maxH, marginB) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.style.maxHeight = maxH;
  wrap.style.opacity = '1';
  wrap.style.marginBottom = marginB;
  wrap.style.pointerEvents = 'auto';
}
function _handleAutoHideScroll(el, wrapId, maxH, marginB, state) {
  const top = el.scrollTop;
  const delta = top - state.top;
  const THRESHOLD = 6; // ignore tiny/jitter scrolls
  if (top <= 4) {
    _expandSearchWrap(wrapId, maxH, marginB);       // always show at very top
  } else if (delta > THRESHOLD) {
    _collapseSearchWrap(wrapId);                     // scrolling down → hide
  } else if (delta < -THRESHOLD) {
    _expandSearchWrap(wrapId, maxH, marginB);        // scrolling up → show
  }
  state.top = top;
}
const _stuScrollState = { top: 0 };
function handleStudentListScroll(el) {
  _handleAutoHideScroll(el, 'studentSearchFilterWrap', '60px', '0px', _stuScrollState);
}
const _attScrollState = { top: 0 };
function handleAttListScroll(el) {
  _handleAutoHideScroll(el, 'attSearchFilterWrap', '60px', '7px', _attScrollState);
}
const _feeScrollState = { top: 0 };
function handleFeeListScroll(el) {
  _handleAutoHideScroll(el, 'feeSearchFilterWrap', '60px', '7px', _feeScrollState);
}
// ── "Done" / register-closed state (per sport + date) ──
function attDoneKey(dateKey, sport) { return (sport || attCurrentSport()) + '|' + dateKey; }
function isAttDone(dateKey, sport) { return !!(DB.attDone && DB.attDone[attDoneKey(dateKey, sport)]); }
function setAttDone(dateKey, sport) {
  if (!DB.attDone) DB.attDone = {};
  DB.attDone[attDoneKey(dateKey, sport)] = true;
}
// Track which students were marked Present AFTER Done (latecomers): stored in the fee/att obj? 
// Simpler: a latecomer is anyone marked Present while the register is already Done.
// We persist this as a per-day set of "late" student ids.
function attLateKey(dateKey, sport) { return 'late|' + (sport || attCurrentSport()) + '|' + dateKey; }
function isLatecomer(dateKey, sid, sport) {
  const m = (DB.attDone && DB.attDone[attLateKey(dateKey, sport)]) || {};
  return !!m[sid];
}
function markLatecomer(dateKey, sid, sport) {
  if (!DB.attDone) DB.attDone = {};
  const k = attLateKey(dateKey, sport);
  if (!DB.attDone[k]) DB.attDone[k] = {};
  DB.attDone[k][sid] = true;
}

// Stage 5: which sport the Fees page is currently showing
let _feeSport = 'ALL';
function feeCurrentSport() {
  if (_feeSport === 'ALL') return 'ALL';
  if (_feeSport && (DB.sports||[]).includes(_feeSport)) return _feeSport;
  return (DB.sports && DB.sports[0]) || 'ALL';
}
// Fee accessor helpers — structure: DB.fees[month][sport][studentId] = feeObj
function feeGet(monthKey, sid, sport) {
  const sp = sport || feeCurrentSport();
  if (sp === 'ALL') {
    const mm = DB.fees[monthKey] || {};
    for (const spName of Object.keys(mm)) {
      if (mm[spName][sid] !== undefined) return mm[spName][sid];
    }
    return undefined;
  }
  return ((DB.fees[monthKey] || {})[sp] || {})[sid];
}
function feeSet(monthKey, sid, feeObj, sport) {
  let sp = sport || feeCurrentSport();
  if (sp === 'ALL') sp = studentSingleSport(sid) || (DB.sports && DB.sports[0]);
  if (!sp) return;
  if (!DB.fees[monthKey]) DB.fees[monthKey] = {};
  if (!DB.fees[monthKey][sp]) DB.fees[monthKey][sp] = {};
  DB.fees[monthKey][sp][sid] = feeObj;
}
function feeEnsure(monthKey, sid, sport) {
  let sp = sport || feeCurrentSport();
  if (sp === 'ALL') sp = studentSingleSport(sid) || (DB.sports && DB.sports[0]);
  if (!DB.fees[monthKey]) DB.fees[monthKey] = {};
  if (!DB.fees[monthKey][sp]) DB.fees[monthKey][sp] = {};
  if (!DB.fees[monthKey][sp][sid]) DB.fees[monthKey][sp][sid] = {};
  return DB.fees[monthKey][sp][sid];
}
function feeMonthMap(monthKey, sport) {
  const sp = sport || feeCurrentSport();
  if (sp === 'ALL') {
    const mm = DB.fees[monthKey] || {};
    const merged = {};
    Object.keys(mm).forEach(spName => Object.assign(merged, mm[spName]));
    return merged;
  }
  return (DB.fees[monthKey] || {})[sp] || {};
}
// Fees "Done" / finalize state (per sport + month)
function feeDoneKey(monthKey, sport) { return (sport || feeCurrentSport()) + '|' + monthKey; }
function isFeeDone(monthKey, sport) { return !!(DB.feeDone && DB.feeDone[feeDoneKey(monthKey, sport)]); }
function setFeeDone(monthKey, sport) {
  if (!DB.feeDone) DB.feeDone = {};
  DB.feeDone[feeDoneKey(monthKey, sport)] = true;
}
function markFeesDone() {
  const fk = getFeeKey();
  const sp = feeCurrentSport();
  if (sp === 'ALL') { showToast('Pick a specific sport to finalize its fees.', 'warn'); return; }
  if (isFeeDone(fk, sp)) return;
  confirm_('🔒', 'Finalize Fees',
    `Finalize the ${sp} fees for ${fk}?\n\nOnce finalized, fee entries for this month are locked and cannot be changed. This cannot be undone.`,
    () => {
      setFeeDone(fk, sp);
      sbSaveSettings();
      addLog('fee', `Fees finalized (${sp}) for ${fk}`);
      showToast('Fees finalized ✓', 'success');
      renderFees();
    });
}

// ----------------------------------------------------------------
// STORAGE — Firebase only, no localStorage secret key needed
// Firebase Auth token is retrieved automatically from the Auth SDK
// saveLocalOnly and saveLocal are no-ops — Firebase is the only store.
// All writes go directly to Supabase.

// ================================================================
// ENQUIRY / QUERIES
// ================================================================
function openAddEnquiryModal() {
  document.getElementById('enqName').value = '';
  document.getElementById('enqPhone').value = '';
  document.getElementById('enqQuery').value = '';
  document.getElementById('enqLocation').value = '';
  document.getElementById('enqConversion').value = '';
  document.getElementById('enqReminder').value = '';
  // Populate sport dropdown
  const sportSel = document.getElementById('enqSport');
  if (sportSel) {
    const sports = Array.isArray(DB.sports) ? DB.sports : [];
    sportSel.innerHTML = '<option value="">— Select sport —</option>' +
      sports.map(sp => `<option value="${escHtml(sp)}">${escHtml(sp)}</option>`).join('');
    sportSel.value = '';
  }
  // Populate staff dropdown (admin only)
  const assignSel = document.getElementById('enqAssignTo');
  const assignGrp = document.getElementById('enqAssignGroup');
  if (assignSel) {
    const users = (DB.users || []).slice().sort((a,b) => (a.name||a.id).localeCompare(b.name||b.id));
    assignSel.innerHTML = '<option value="">— Unassigned —</option>' +
      users.map(u => {
        const label = (u.name || u.id) + (u.role === 'admin' ? ' (Admin)' : '');
        return `<option value="${escHtml(u.id)}">${escHtml(label)}</option>`;
      }).join('');
    assignSel.value = '';
  }
  if (assignGrp) assignGrp.style.display = isAdmin() ? '' : 'none';
  openModal('modalAddEnquiry');
}
function saveEnquiry() {
  const name  = (document.getElementById('enqName').value  || '').trim();
  const phone = (document.getElementById('enqPhone').value || '').trim();
  const query = (document.getElementById('enqQuery').value || '').trim();
  const loc   = (document.getElementById('enqLocation').value || '').trim();
  const conv  = (document.getElementById('enqConversion').value || '').trim();
  const sport = (document.getElementById('enqSport')?.value || '').trim();
  const reminder = (document.getElementById('enqReminder').value || '').trim();
  if (!name)  { showToast('Name is required', 'error');  return; }
  if (!phone) { showToast('Phone is required', 'error'); return; }
  if (!query) { showToast('Query is required', 'error'); return; }
  if (!sport) { showToast('Please select a sport', 'error'); return; }
  if (!Array.isArray(DB.enquiries)) DB.enquiries = [];
  const createdBy = currentUser ? (currentUser.name || currentUser.id) : 'Unknown';
  const assignedTo = isAdmin() ? (document.getElementById('enqAssignTo')?.value || '') : '';
  const newEnq = { id:'enq_'+Date.now(), name, phone, query, location:loc, conversionRatio:conv, sport, reminderDate:reminder, assignedTo, datetime:new Date().toISOString(), createdBy, editHistory:[] };
  DB.enquiries.unshift(newEnq);
  sbInsertEnquiry(newEnq).then(row => {
    if (row) {
      const idx = DB.enquiries.findIndex(q => q.id === newEnq.id);
      if (idx >= 0) DB.enquiries[idx].id = row.id;
    }
    // Re-render AFTER the real id is mapped back so the row opens correctly
    renderEnquiryList();
  });
  closeModal('modalAddEnquiry');
  renderEnquiryList();
  showToast('Query saved ✓', 'success');
  addLog('enquiry', 'Added query for ' + name);
}
function clearEnquiryFilters() {
  const cf = document.getElementById('enqFilterConversion');
  const rf = document.getElementById('enqFilterReminderDate');
  const sf = document.getElementById('enqFilterStaff');
  const spf = document.getElementById('enqFilterSport');
  if (cf) cf.value = '';
  if (rf) rf.value = '';
  if (sf) sf.value = '';
  if (spf) spf.value = '';
  updateEnqFilterIndicator();
  renderEnquiryList();
}
function toggleEnquiryFilter() {
  const body    = document.getElementById('enqFilterBody');
  const chevron = document.getElementById('enqFilterChevron');
  const btn     = document.getElementById('enqFilterToggleBtn');
  if (!body) return;
  const open = body.style.display === 'block';
  body.style.display = open ? 'none' : 'block';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
  if (btn) btn.style.borderRadius = open ? '10px' : '10px 10px 0 0';
}
function updateEnqFilterIndicator() {
  const cf = document.getElementById('enqFilterConversion')?.value || '';
  const rf = document.getElementById('enqFilterReminderDate')?.value || '';
  const sf = document.getElementById('enqFilterStaff')?.value || '';
  const dot = document.getElementById('enqFilterActiveIndicator');
  if (dot) dot.style.display = (cf || rf || sf) ? 'inline-block' : 'none';
}

function conversionBadge(ratio) {
  if (!ratio) return '';
  const map = { High: 'badge-green', Medium: 'badge-orange', Low: 'badge-gray' };
  const icon = { High: '🔥', Medium: '⚡', Low: '❄️' };
  return `<span class="badge ${map[ratio]||'badge-gray'}" style="font-size:10px;">${icon[ratio]||''}${ratio}</span>`;
}

function setEnqView(view) {
  window._enqView = view;
  const aBtn = document.getElementById('enqViewActiveBtn');
  const rBtn = document.getElementById('enqViewArchiveBtn');
  if (aBtn) aBtn.classList.toggle('active', view === 'active');
  if (rBtn) rBtn.classList.toggle('active', view === 'archive');
  renderEnquiryList();
}

function renderEnquiryList() {
  const wrap = document.getElementById('enquiryListWrap');
  if (!wrap) return;
  if (!Array.isArray(DB.enquiries)) DB.enquiries = [];
  const search = (document.getElementById('enquirySearch')?.value || '').toLowerCase();
  const filterConv = document.getElementById('enqFilterConversion')?.value || '';
  const filterReminder = document.getElementById('enqFilterReminderDate')?.value || '';
  const filterStaff = document.getElementById('enqFilterStaff')?.value || '';
  const filterSport = document.getElementById('enqFilterSport')?.value || '';
  // Populate sport filter dropdown
  const sportSel = document.getElementById('enqFilterSport');
  if (sportSel) {
    const cur = sportSel.value;
    let sports = Array.isArray(DB.sports) ? DB.sports : [];
    // Staff only see the sports assigned to them
    if (!isAdmin()) {
      const ss = getStaffSports();
      sports = sports.filter(sp => ss.includes(sp));
    }
    const stillValid = sports.includes(cur);
    sportSel.innerHTML = '<option value="">All Sports</option>' +
      sports.map(sp => `<option value="${escHtml(sp)}"${(stillValid && cur===sp)?' selected':''}>${escHtml(sp)}</option>`).join('');
  }
  let list = DB.enquiries;

  // Show Active/Archive toggle for admins only
  const viewToggle = document.getElementById('enqViewToggle');
  if (viewToggle) viewToggle.style.display = isAdmin() ? 'flex' : 'none';

  // Filter by archive state: staff always see active only; admins switch via toggle
  const showArchive = isAdmin() && window._enqView === 'archive';
  list = list.filter(q => showArchive ? q.archived : !q.archived);

  // Admin: show "assigned to" filter dropdown — lists ALL users (admins + staff)
  if (isAdmin()) {
    const staffSel = document.getElementById('enqFilterStaff');
    if (staffSel) {
      staffSel.style.display = '';
      const currentVal = staffSel.value;
      const users = (DB.users || []).slice().sort((a,b) => (a.name||a.id).localeCompare(b.name||b.id));
      staffSel.innerHTML = '<option value="">👥 Assigned to: All</option>' +
        users.map(u => {
          const label = (u.name || u.id) + (u.role === 'admin' ? ' (Admin)' : '');
          return `<option value="${escHtml(u.id)}"${u.id===currentVal?' selected':''}>${escHtml(label)}</option>`;
        }).join('') +
        `<option value="__UNASSIGNED__"${currentVal==='__UNASSIGNED__'?' selected':''}>— Unassigned —</option>`;
    }
  }

  // Staff: only see queries they created OR are assigned to
  if (!isAdmin() && currentUser) {
    const myId   = currentUser.id;
    const myName = currentUser.name || currentUser.id;
    list = list.filter(q =>
      q.assignedTo === myId ||
      q.createdBy  === myName ||
      q.createdBy  === myId
    );
  }

  if (search) list = list.filter(q => q.name.toLowerCase().includes(search) || (q.phone||'').toLowerCase().includes(search));
  if (filterConv) list = list.filter(q => q.conversionRatio === filterConv);
  if (filterSport) list = list.filter(q => (q.sport||'') === filterSport);
  if (filterReminder) list = list.filter(q => q.reminderDate === filterReminder);
  // Admin: filter by the user a query is ASSIGNED to
  if (isAdmin() && filterStaff) {
    if (filterStaff === '__UNASSIGNED__') list = list.filter(q => !q.assignedTo);
    else list = list.filter(q => q.assignedTo === filterStaff);
  }

  // Sort: overdue reminders first, then upcoming, then no reminder
  const today = new Date().toISOString().slice(0,10);
  list = [...list].sort((a, b) => {
    const ar = a.reminderDate || '', br = b.reminderDate || '';
    if (ar && !br) return -1;
    if (!ar && br) return 1;
    if (ar && br) return ar.localeCompare(br);
    return 0;
  });

  if (!list.length) {
    const inArchive = isAdmin() && window._enqView === 'archive';
    wrap.innerHTML = inArchive
      ? '<div class="empty-state">🗄️ No archived queries.</div>'
      : (isAdmin()
        ? '<div class="empty-state">No queries match your filters.<br>Tap <b>+ Add</b> to record one.</div>'
        : '<div class="empty-state">No queries assigned to you yet.</div>');
    return;
  }
  wrap.innerHTML = list.map(q => {
    const isOverdue = q.reminderDate && q.reminderDate < today;
    const reminderHtml = q.reminderDate
      ? `<span style="font-size:10px;${isOverdue?'color:#f87171;font-weight:700;':'color:var(--gold);'}">⏰ ${q.reminderDate}${isOverdue?' (overdue)':''}</span>`
      : '';
    const assignedUser = q.assignedTo ? DB.users.find(u => u.id === q.assignedTo) : null;
    const assignedBadge = assignedUser
      ? `<span class="badge badge-blue" style="font-size:10px;">👤 ${escHtml(assignedUser.name||assignedUser.id)}</span>`
      : (isAdmin() ? `<span class="badge badge-gray" style="font-size:10px;">Unassigned</span>` : '');
    const noteCount = (q.staffNotes && q.staffNotes.length) || 0;
    const noteBadge = noteCount ? `<span class="badge badge-gold" style="font-size:10px;">📝 ${noteCount} note${noteCount>1?'s':''}</span>` : '';
    const createdByBadge = isAdmin() && q.createdBy
      ? `<span class="badge badge-gray" style="font-size:10px;">✍️ ${escHtml(q.createdBy)}</span>`
      : '';
    return `
    <div onclick="openEnquiryDetail('${escHtml(q.id)}')" class="hover-lift"
         style="display:flex;align-items:center;justify-content:space-between;background:var(--card);
                border:1px solid ${isOverdue?'#ef444455':'var(--border)'};border-radius:10px;padding:12px 14px;
                margin-bottom:7px;cursor:pointer;gap:10px;transition:border-color .2s, transform .15s ease, box-shadow .15s ease;">
      <div style="display:flex;align-items:center;gap:11px;min-width:0;flex:1;">
        <div style="width:38px;height:38px;border-radius:50%;background:var(--accent2);
                    display:flex;align-items:center;justify-content:center;
                    font-size:16px;font-weight:700;color:#fff;flex-shrink:0;">
          ${escHtml(q.name.charAt(0).toUpperCase())}
        </div>
        <div style="min-width:0;flex:1;">
          <div style="font-size:14px;font-weight:700;color:var(--white);margin-bottom:3px;
                      white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
            ${escHtml(q.name)} ${conversionBadge(q.conversionRatio)}
          </div>
          <div style="font-size:12px;color:var(--accent2);">📞 ${escHtml(q.phone)}</div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:3px;">
            ${reminderHtml ? `<div>${reminderHtml}</div>` : ''}
            ${assignedBadge}
            ${noteBadge}
            ${createdByBadge}
          </div>
        </div>
      </div>
      <div style="font-size:10px;color:var(--gray);text-align:right;flex-shrink:0;white-space:nowrap;">
        ${enqRelTime(q.datetime)}
      </div>
    </div>`;
  }).join('');
}

function openEnquiryDetail(id) {
  const q = (DB.enquiries||[]).find(x => x.id === id);
  if (!q) return;
  const today = new Date().toISOString().slice(0,10);
  const isOverdue = q.reminderDate && q.reminderDate < today;

  // Build edit history
  let historyHtml = '';
  if (q.editHistory && q.editHistory.length) {
    historyHtml = `<div style="background:var(--royal2);border-radius:8px;padding:10px 12px;margin-top:8px;">
      <div style="font-size:10px;color:var(--gray);margin-bottom:6px;letter-spacing:.5px;">EDIT HISTORY</div>
      ${q.editHistory.map(h => `<div style="font-size:11px;color:var(--graydk);padding:3px 0;border-bottom:1px solid var(--border);">
        ✏️ Edited by <b style="color:var(--offwhite);">${escHtml(h.by)}</b> on ${escHtml(h.at ? new Date(h.at).toLocaleString() : '—')}
      </div>`).join('')}
    </div>`;
  }

  document.getElementById('enquiryDetailBody').innerHTML = `
    <div style="background:var(--card2);border-radius:10px;padding:14px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
        <div style="width:46px;height:46px;border-radius:50%;background:var(--accent2);
                    display:flex;align-items:center;justify-content:center;
                    font-size:20px;font-weight:700;color:#fff;flex-shrink:0;">
          ${escHtml(q.name.charAt(0).toUpperCase())}
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-size:16px;font-weight:700;margin-bottom:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
            ${escHtml(q.name)} ${conversionBadge(q.conversionRatio)}
          </div>
          <a href="tel:${escHtml(q.phone)}"
             style="font-size:13px;color:var(--accent2);font-weight:600;text-decoration:none;">
            📞 ${escHtml(q.phone)}
          </a>
        </div>
      </div>
      <div style="display:grid;gap:8px;">
        <div style="background:var(--royal2);border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:var(--gray);margin-bottom:4px;letter-spacing:.5px;">QUERY</div>
          <div style="font-size:13px;line-height:1.6;">${escHtml(q.query)}</div>
        </div>
        ${q.location ? `<div style="background:var(--royal2);border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:var(--gray);margin-bottom:4px;letter-spacing:.5px;">LOCATION</div>
          <div style="font-size:13px;">📍 ${escHtml(q.location)}</div>
        </div>` : ''}
        <div style="background:var(--royal2);border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:var(--gray);margin-bottom:6px;letter-spacing:.5px;">⏰ NEXT REMINDER${isOverdue?' <span style="color:#f87171;">(overdue)</span>':''}</div>
          <div style="display:flex;gap:7px;align-items:center;">
            <input type="date" id="enqReminderInput" value="${escHtml(q.reminderDate||'')}"
              style="flex:1;padding:8px 9px;background:var(--card);border:1px solid var(--border);
                     border-radius:8px;color:var(--white);font-size:13px;outline:none;font-family:var(--font);">
            <button onclick="saveEnquiryReminder('${escHtml(q.id)}')"
              class="btn btn-primary btn-sm" style="flex-shrink:0;padding:8px 12px;">💾 Save</button>
          </div>
        </div>
        <div style="background:var(--royal2);border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:var(--gray);margin-bottom:4px;letter-spacing:.5px;">DATE &amp; TIME</div>
          <div style="font-size:13px;">🕐 ${enqFullDate(q.datetime)}</div>
        </div>
        <div style="background:var(--royal2);border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:var(--gray);margin-bottom:4px;letter-spacing:.5px;">ENTERED BY</div>
          <div style="font-size:13px;">👤 ${escHtml(q.createdBy || 'Unknown')}</div>
        </div>
        <div style="background:var(--royal2);border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:var(--gray);margin-bottom:4px;letter-spacing:.5px;">ASSIGNED TO</div>
          <div style="font-size:13px;">${(() => {
            if (!q.assignedTo) return '<span style="color:var(--gray);">— Unassigned —</span>';
            const u = DB.users.find(x => x.id === q.assignedTo);
            return '👤 ' + escHtml(u ? (u.name||u.id) : q.assignedTo);
          })()}</div>
        </div>
        ${historyHtml}

        <!-- Staff Notes Section -->
        <div style="background:var(--royal2);border-radius:8px;padding:10px 12px;">
          <div style="font-size:10px;color:var(--gray);margin-bottom:8px;letter-spacing:.5px;">📝 STAFF NOTES</div>
          ${(q.staffNotes && q.staffNotes.length)
            ? q.staffNotes.map(n => {
                const nd = new Date(n.at);
                const ts = pad(nd.getDate())+'/'+pad(nd.getMonth()+1)+'/'+nd.getFullYear()+
                  ' '+((nd.getHours()%12)||12)+':'+pad(nd.getMinutes())+' '+(nd.getHours()>=12?'PM':'AM');
                return `<div style="padding:7px 0;border-bottom:1px solid var(--border);font-size:12px;">
                  <div style="color:var(--offwhite);line-height:1.5;">${escHtml(n.note)}</div>
                  <div style="font-size:10px;color:var(--graydk);margin-top:3px;">
                    👤 <b style="color:var(--gold);">${escHtml(n.by)}</b> · ${escHtml(ts)}
                  </div>
                </div>`;
              }).join('')
            : `<div style="font-size:12px;color:var(--graydk);">No notes yet.</div>`
          }
          <div style="margin-top:10px;display:flex;gap:7px;align-items:flex-end;">
            <textarea id="enqNoteInput" rows="2" placeholder="Add a note…"
              style="flex:1;padding:9px 11px;background:var(--card);border:1px solid var(--border);
                     border-radius:8px;color:var(--white);font-size:13px;outline:none;resize:none;
                     font-family:var(--font);"></textarea>
            <button onclick="saveEnquiryNote('${escHtml(q.id)}')"
              class="btn btn-primary btn-sm" style="flex-shrink:0;padding:9px 13px;">💾 Add</button>
          </div>
        </div>
      </div>
    </div>`;
  document.getElementById('enqDeleteBtn').onclick  = () => deleteEnquiry(id);
  document.getElementById('enqEditBtn').onclick    = () => openEditEnquiryModal(id);
  document.getElementById('enqConvertBtn').onclick = () => convertEnquiryToStudent(id);
  const archBtn = document.getElementById('enqArchiveBtn');
  if (archBtn) {
    archBtn.textContent = q.archived ? '↩️ Restore from Archive' : '🗄️ Move to Archive';
    archBtn.onclick = () => toggleArchiveEnquiry(id);
  }
  // Admin: full access. Staff: view + notes only
  const isAdm = isAdmin();
  document.getElementById('enqConvertBtn').style.display = isAdm ? '' : 'none';
  document.getElementById('enqDeleteBtn').style.display  = isAdm ? '' : 'none';
  document.getElementById('enqEditBtn').style.display    = isAdm ? '' : 'none';
  if (archBtn) archBtn.style.display = isAdm ? '' : 'none';
  openModal('modalEnquiryDetail');
}

function saveEnquiryNote(id) {
  const noteInput = document.getElementById('enqNoteInput');
  const note = (noteInput ? noteInput.value : '').trim();
  if (!note) { showToast('Note cannot be empty', 'error'); return; }
  const q = (DB.enquiries||[]).find(x => x.id === id);
  if (!q) return;
  if (!Array.isArray(q.staffNotes)) q.staffNotes = [];
  const by = currentUser ? (currentUser.name || currentUser.id) : 'Unknown';
  q.staffNotes.push({ note, by, at: new Date().toISOString() });
  sbUpdateEnquiry(q.id, q);
  addLog('enquiry', `Note added to query for ${q.name} by ${by}`);
  showToast('Note saved ✓', 'success');
  // Re-render detail to show the new note
  openEnquiryDetail(id);
}

function saveEnquiryReminder(id) {
  const input = document.getElementById('enqReminderInput');
  const newDate = input ? input.value : '';
  const q = (DB.enquiries||[]).find(x => x.id === id);
  if (!q) return;
  q.reminderDate = newDate || '';
  sbUpdateEnquiry(q.id, q);
  addLog('enquiry', `Reminder date updated for ${q.name}` + (newDate ? ` → ${newDate}` : ' (cleared)'));
  showToast('Reminder saved ✓', 'success');
  refreshBellDot();
  // Re-render detail to reflect the updated reminder (and overdue styling)
  openEnquiryDetail(id);
}

function openEditEnquiryModal(id) {
  const q = (DB.enquiries||[]).find(x => x.id === id);
  if (!q) return;
  closeModal('modalEnquiryDetail');
  document.getElementById('editEnqId').value = id;
  document.getElementById('editEnqName').value = q.name || '';
  document.getElementById('editEnqPhone').value = q.phone || '';
  document.getElementById('editEnqQuery').value = q.query || '';
  document.getElementById('editEnqLocation').value = q.location || '';
  document.getElementById('editEnqConversion').value = q.conversionRatio || '';
  document.getElementById('editEnqReminder').value = q.reminderDate || '';
  // Populate staff dropdown (admin only)
  const assignSel = document.getElementById('editEnqAssignTo');
  const assignGrp = document.getElementById('editEnqAssignGroup');
  if (assignSel) {
    const users = (DB.users || []).slice().sort((a,b) => (a.name||a.id).localeCompare(b.name||b.id));
    assignSel.innerHTML = '<option value="">— Unassigned —</option>' +
      users.map(u => {
        const label = (u.name || u.id) + (u.role === 'admin' ? ' (Admin)' : '');
        return `<option value="${escHtml(u.id)}">${escHtml(label)}</option>`;
      }).join('');
    assignSel.value = q.assignedTo || '';
  }
  if (assignGrp) assignGrp.style.display = isAdmin() ? '' : 'none';
  openModal('modalEditEnquiry');
}

function saveEditEnquiry() {
  const id = document.getElementById('editEnqId').value;
  const name  = (document.getElementById('editEnqName').value  || '').trim();
  const phone = (document.getElementById('editEnqPhone').value || '').trim();
  const query = (document.getElementById('editEnqQuery').value || '').trim();
  const loc   = (document.getElementById('editEnqLocation').value || '').trim();
  const conv  = (document.getElementById('editEnqConversion').value || '').trim();
  const reminder = (document.getElementById('editEnqReminder').value || '').trim();
  if (!name)  { showToast('Name is required', 'error');  return; }
  if (!phone) { showToast('Phone is required', 'error'); return; }
  if (!query) { showToast('Query is required', 'error'); return; }
  const idx = DB.enquiries.findIndex(x => x.id === id);
  if (idx < 0) { showToast('Query not found', 'error'); return; }
  const editedBy = currentUser ? (currentUser.name || currentUser.id) : 'Unknown';
  if (!Array.isArray(DB.enquiries[idx].editHistory)) DB.enquiries[idx].editHistory = [];
  DB.enquiries[idx].editHistory.push({ by: editedBy, at: new Date().toISOString() });
  const assignedTo = isAdmin() ? (document.getElementById('editEnqAssignTo')?.value || '') : (DB.enquiries[idx].assignedTo || '');
  DB.enquiries[idx] = { ...DB.enquiries[idx], name, phone, query, location:loc, conversionRatio:conv, reminderDate:reminder, assignedTo };
  sbUpdateEnquiry(DB.enquiries[idx].id, DB.enquiries[idx]);
  closeModal('modalEditEnquiry');
  renderEnquiryList();
  showToast('Query updated ✓', 'success');
  addLog('enquiry', 'Edited query for ' + name);
}
let _convertingEnqId = null; // tracks which enquiry is being converted

function convertEnquiryToStudent(id) {
  const q = (DB.enquiries||[]).find(x => x.id === id);
  if (!q) return;
  closeModal('modalEnquiryDetail');

  // Use the standard Add Student flow so the whole form (incl. Sports Enrolled) is set up properly
  openAddStudentModal();
  _convertingEnqId = id;

  // Pre-fill from the enquiry
  document.getElementById('modalStudentTitle').textContent = '👥 Convert to Student';
  const setV = (elId, val) => { const el = document.getElementById(elId); if (el) el.value = val; };
  setV('sName', '');                 // student name entered manually
  setV('sParent', q.name || '');     // enquiry person = parent/guardian
  setV('sContact', q.phone || '');
  setV('sContact2', '');
  setV('sAddress', q.location || '');
  setV('sAge', '');
  setV('sDob', '');
  const ageAuto = document.getElementById('sAgeAuto'); if (ageAuto) ageAuto.textContent = '';
  setV('sJoinDate', todayDisplay());

  // If the query had a sport, pre-select it so its batches populate below
  if (q.sport && (DB.sports||[]).includes(q.sport)) {
    try {
      const spPick = document.getElementById('enrollSportPick');
      if (spPick) { spPick.value = q.sport; if (typeof onEnrollSportPick === 'function') onEnrollSportPick(); }
    } catch(e) {}
  }

  // Show a note inside the modal about the source enquiry
  const noteEl = document.getElementById('convertFromEnqNote');
  if (noteEl) {
    noteEl.style.display = '';
    noteEl.textContent = '📋 Parent name & contact pre-filled from query. Please enter the student\'s name and assign a sport above.';
  }
}

function toggleArchiveEnquiry(id) {
  if (!isAdmin()) { showToast('Only admins can archive queries', 'error'); return; }
  const q = (DB.enquiries||[]).find(x => x.id === id);
  if (!q) return;
  const goingToArchive = !q.archived;
  const title = goingToArchive ? '🗄️ Move to Archive' : '↩️ Restore Query';
  const msg = goingToArchive
    ? `Move "${q.name}" to the archive? They will be hidden from the active list.`
    : `Restore "${q.name}" back to the active queries list?`;
  confirm_(goingToArchive ? '🗄️' : '↩️', title, msg, () => {
    q.archived = goingToArchive;
    q.archivedAt = goingToArchive ? new Date().toISOString() : '';
    addLog('enquiry', `${goingToArchive ? 'Archived' : 'Restored'} query for ${q.name}`);
    sbUpdateEnquiry(q.id, q);
    closeModal('modalEnquiryDetail');
    renderEnquiryList();
    showToast(goingToArchive ? 'Moved to archive ✓' : 'Restored ✓', 'success');
  });
}

function deleteEnquiry(id) {
  const q = (DB.enquiries||[]).find(x => x.id === id);
  const qName = q ? q.name : id;
  confirm_('🗑️','Delete Query','Delete this query permanently?', () => {
    DB.enquiries = (DB.enquiries||[]).filter(q => q.id !== id);
    addLog('enquiry', `Deleted query for ${qName}`);
    sbDeleteEnquiry(id);
    closeModal('modalEnquiryDetail');
    renderEnquiryList();
    showToast('Deleted ✓','success');
  });
}
function enqRelTime(iso) {
  if (!iso) return '';
  const diff = (Date.now() - new Date(iso)) / 1000;
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  const d = new Date(iso);
  return pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear();
}
function enqFullDate(iso) {
  if (!iso) return '—';
  const d=new Date(iso);
  const DAY=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const h=d.getHours(), m=d.getMinutes();
  return DAY[d.getDay()]+', '+d.getDate()+' '+MON[d.getMonth()]+' '+d.getFullYear()+
    ' at '+((h%12)||12)+':'+pad(m)+' '+(h>=12?'PM':'AM');
}

// ================================================================
// ================================================================
// DAILY SNAPSHOTS — with plan-based retention enforcement
// ================================================================
// Basic:   7-day retention
// Pro:    15-day retention
// Premium: 30-day retention
// Trial:   7-day retention (same as Basic)
// ================================================================

// ── Plan limits ──────────────────────────────────────────────────
const SNAP_LIMITS = { basic:7, pro:15, premium:30, trial:30, frozen:7 };

function snapGetLimit() {
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  return SNAP_LIMITS[plan] || 7;
}

function snapGetPlanName() {
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

function snapDateKey(d) {
  d = d || new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}

// Returns cutoff date key — snapshots older than this are beyond the plan limit
function snapCutoffKey() {
  const d = new Date();
  d.setDate(d.getDate() - snapGetLimit());
  return snapDateKey(d);
}

// ── Auto-purge snapshots beyond the plan retention limit ─────────
async function snapPurgeOld() {
  try {
    const cutoff = snapCutoffKey();
    const aid    = acadId();
    if (!aid) return;

    // Get all snapshots older than cutoff
    const { data: old } = await sb().from('snapshots')
      .select('snap_key')
      .eq('academy_id', aid)
      .lt('snap_key', cutoff);  // snap_key is YYYY-MM-DD so string compare works

    if (!old || !old.length) return;

    // Delete them
    const keys = old.map(s => s.snap_key);
    await sb().from('snapshots')
      .delete()
      .eq('academy_id', aid)
      .in('snap_key', keys);

    // Update local index
    DB.snapshotIndex = (DB.snapshotIndex || []).filter(s => s.key >= cutoff);

    console.log(`Purged ${keys.length} snapshot(s) beyond ${snapGetPlanName()} plan limit (${snapGetLimit()} days)`);
  } catch(e) {
    console.warn('snapPurgeOld failed:', e);
  }
}

// ── Count snapshots within the allowed window ────────────────────
async function snapCountWithinLimit() {
  try {
    const cutoff = snapCutoffKey();
    const aid    = acadId();
    const { count } = await sb().from('snapshots')
      .select('snap_key', { count: 'exact', head: true })
      .eq('academy_id', aid)
      .gte('snap_key', cutoff);
    return count || 0;
  } catch(e) { return 0; }
}

// ── Take a snapshot ──────────────────────────────────────────────
async function takeSnapshot(label) {
  try {
    const key  = snapDateKey();
    const snap = JSON.parse(JSON.stringify(DB));
    if (snap.settings) { delete snap.settings.firebaseUrl; delete snap.settings.firebaseApiKey; }
    snap._snapLabel = label || 'auto';
    snap._snapTime  = new Date().toISOString();
    snap._snapKey   = key;

    await sbAddSnapshot(key, snap._snapLabel, snap);

    if (!Array.isArray(DB.snapshotIndex)) DB.snapshotIndex = [];
    const existing = DB.snapshotIndex.find(s => s.key === key);
    if (existing) { existing.time = snap._snapTime; existing.label = snap._snapLabel; }
    else DB.snapshotIndex.unshift({ key, time: snap._snapTime, label: snap._snapLabel });

    // Keep local index within limit
    DB.snapshotIndex = DB.snapshotIndex.slice(0, snapGetLimit());

    // Purge old snapshots beyond plan retention (runs in background)
    snapPurgeOld().catch(()=>{});

    renderSnapshotList();
    return key;
  } catch(e) { console.error('Snapshot failed:', e); return null; }
}

// ── Manual snapshot (triggered by user) ─────────────────────────
function takeSnapshotNow() {
  const limit = snapGetLimit();
  const plan  = snapGetPlanName();

  confirm_('📸', 'Take Snapshot',
    `Save a snapshot of all current data?\n\nYour ${plan} plan keeps snapshots for ${limit} days.`,
    async () => {
      const key = await takeSnapshot('manual');
      if (key) {
        showToast('📸 Snapshot saved: ' + key, 'success');
        addLog('snapshot', 'Manual snapshot: ' + key);
        await renderSnapshotList();
      } else {
        showToast('Snapshot failed', 'error');
      }
    }
  );
}

// ── Auto-snapshot at midnight ────────────────────────────────────
function checkMidnightSnapshot() {
  if (!currentUser || !isAdmin()) return;
  const todayKey = snapDateKey();
  const done = Array.isArray(DB.snapshotIndex) && DB.snapshotIndex.some(s => s.key === todayKey);
  if (!done) {
    takeSnapshot('auto').then(key => {
      if (key) { showToast('📸 Daily snapshot saved', 'success'); addLog('snapshot', 'Auto snapshot: ' + key); }
    });
  }
  // Always purge old ones at midnight check
  snapPurgeOld().catch(()=>{});
}

// ── Render snapshot list ─────────────────────────────────────────
async function renderSnapshotList() {
  const wrap = document.getElementById('snapshotListWrap');
  if (!wrap) return;

  const limit   = snapGetLimit();
  const plan    = snapGetPlanName();
  const cutoff  = snapCutoffKey();

  wrap.innerHTML = '<div class="empty-state" style="padding:14px;">🔄 Loading snapshots…</div>';

  let list = [];
  try {
    const aid = acadId();
    const { data, error } = await sb().from('snapshots')
      .select('snap_key,label,created_at')
      .eq('academy_id', aid)
      .gte('snap_key', cutoff)           // only show snapshots within plan window
      .order('created_at', { ascending: false });
    if (error) throw error;
    list = (data || []).map(s => ({ key: s.snap_key, time: s.created_at, label: s.label || 'auto' }));
    DB.snapshotIndex = list.map(s => ({ key: s.key, time: s.time, label: s.label }));
  } catch(e) {
    const fallback = Array.isArray(DB.snapshotIndex) ? [...DB.snapshotIndex] : [];
    list = fallback
      .filter(s => s.key >= cutoff)
      .sort((a,b) => b.key.localeCompare(a.key));
  }

  // ── Plan retention badge ──────────────────────────────────────
  const nextPlan    = plan === 'Basic' ? 'Pro (15 days)' : plan === 'Pro' ? 'Premium (30 days)' : null;
  const upgradeLine = nextPlan
    ? `<div style="font-size:11px;color:#f59e0b;padding:6px 12px 0;display:flex;align-items:center;gap:6px;">
        <i class="ti ti-arrow-up-circle"></i>
        Upgrade to ${nextPlan} for longer history
       </div>`
    : '';

  const limitBadge = `
    <div style="display:flex;align-items:center;justify-content:space-between;
                padding:8px 12px;background:var(--card2);border-radius:8px;margin-bottom:8px;">
      <div style="font-size:12px;color:var(--gray);">
        <span style="color:var(--accent2);font-weight:700;">${plan} plan</span>
        &nbsp;·&nbsp; ${limit}-day history
      </div>
      <div style="font-size:11px;color:var(--gray);">
        ${list.length} snapshot${list.length !== 1 ? 's' : ''}
      </div>
    </div>
    ${upgradeLine}`;

  if (!list.length) {
    wrap.innerHTML = limitBadge +
      '<div class="empty-state" style="padding:14px;">No snapshots yet within your ' + limit + '-day window.<br>Tap 📸 Snap Now to create one.</div>';
    return;
  }

  wrap.innerHTML = limitBadge + list.map(s => {
    const d   = new Date(s.time);
    const lbl = s.label === 'manual' ? '🖐 Manual' : '🕛 Auto';
    const col = s.label === 'manual' ? 'var(--accent2)' : 'var(--gold)';
    const ts  = d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) +
                ' ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    return `<div style="display:flex;align-items:center;justify-content:space-between;
                        padding:10px 12px;border-bottom:1px solid var(--border);gap:8px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--white);">📅 ${escHtml(s.key)}</div>
        <div style="font-size:11px;color:var(--gray);margin-top:2px;">
          <span style="color:${col};font-weight:600;">${lbl}</span> · ${escHtml(ts)}
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0;">
        <button onclick="restoreSnapshot('${escHtml(s.key)}')"
                class="btn btn-warning btn-xs">↩ Restore</button>
        <button onclick="deleteSnapshot('${escHtml(s.key)}')"
                class="btn btn-danger btn-xs">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

// ── Restore a snapshot ───────────────────────────────────────────
function restoreSnapshot(key) {
  const cutoff = snapCutoffKey();
  if (key < cutoff) {
    showToast('This snapshot is outside your ' + snapGetPlanName() + ' plan window', 'error');
    return;
  }
  confirm_('⚠️', 'Restore Snapshot',
    'Restore ALL data from ' + key + '? Current data will be overwritten.',
    async () => {
      try {
        const aid = acadId();
        const { data: row, error } = await sb().from('snapshots')
          .select('data').eq('academy_id', aid).eq('snap_key', key).single();
        if (error) throw error;
        const data = row && row.data;
        if (!data) { showToast('Snapshot not found', 'error'); return; }
        const savedIndex = Array.isArray(DB.snapshotIndex) ? [...DB.snapshotIndex] : [];
        DB = ensureArrays(data);
        DB.snapshotIndex = savedIndex;
        await sbPushFullDB();
        refreshCurrentPage();
        showToast('✅ Restored from ' + key, 'success');
        addLog('snapshot', 'Restored from snapshot ' + key);
      } catch(e) { showToast('Restore failed: ' + e.message, 'error'); }
    });
}

// ── Delete a snapshot ────────────────────────────────────────────
function deleteSnapshot(key) {
  confirm_('🗑️', 'Delete Snapshot',
    'Delete snapshot ' + key + '? This cannot be undone.',
    async () => {
      try {
        await sbDeleteSnapshot(key);
        DB.snapshotIndex = (DB.snapshotIndex || []).filter(s => s.key !== key);
        renderSnapshotList();
        addLog('snapshot', 'Deleted snapshot ' + key);
        showToast('Snapshot deleted ✓', 'success');
      } catch(e) { showToast('Delete failed: ' + e.message, 'error'); }
    });
}

// ── ensureArrays (shared utility) ───────────────────────────────
function ensureArrays(db) {
  if (!db.settings   || typeof db.settings   !== 'object') db.settings   = {};
  if (!db.attendance || typeof db.attendance !== 'object') db.attendance = {};
  if (!db.fees       || typeof db.fees       !== 'object') db.fees       = {};
  ['users','batches','students','changelog','enquiries','snapshotIndex','msgLogs','classLog'].forEach(key => {
    if (!db[key]) {
      db[key] = [];
    } else if (!Array.isArray(db[key]) && typeof db[key] === 'object') {
      db[key] = Object.values(db[key]);
    }
    if (Array.isArray(db[key])) {
      db[key] = db[key].filter(item => item !== null && item !== undefined);
    }
  });
  return db;
}


// ----------------------------------------------------------------
// HELPERS
// ----------------------------------------------------------------
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function isAdmin() { return currentUser && currentUser.role === 'admin'; }
function isStaff() { return currentUser && currentUser.role === 'staff'; }
function pad(n) { return String(n).padStart(2,'0'); }

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function todayDisplay() {
  const d = new Date();
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()}`;
}
// Convert ISO YYYY-MM-DD (Supabase) → DD/MM/YYYY (display). Returns '' if invalid.
function isoToDisplay(str) {
  if (!str || typeof str !== 'string') return '';
  const p = str.substring(0, 10).split('-');
  if (p.length !== 3) return str;
  const [yyyy, mm, dd] = p;
  if (!yyyy || !mm || !dd) return str;
  return `${dd}/${mm}/${yyyy}`;
}
// Parse DD/MM/YYYY → Date. Returns null if invalid.
function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const s = str.trim();
  // Support YYYY-MM-DD (ISO from Supabase) as well as DD/MM/YYYY (display format)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const [yyyy, mm, dd] = s.substring(0, 10).split('-').map(Number);
    if (!dd || !mm || !yyyy) return null;
    const d = new Date(yyyy, mm-1, dd);
    return isNaN(d.getTime()) ? null : d;
  }
  const p = s.split('/');
  if (p.length !== 3) return null;
  const [dd, mm, yyyy] = p.map(Number);
  if (!dd || !mm || !yyyy) return null;
  const d = new Date(yyyy, mm-1, dd);
  if (isNaN(d.getTime())) return null;
  return d;
}
function daysInMonth(year, month) { return new Date(year, month, 0).getDate(); } // month is 1-based

function addLog(action, detail) {
  if (!currentUser) return;
  // Unique id ensures concurrent log entries from different devices don't
  // collide. Time + random suffix is good enough for our scale.
  const id = 'lg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  const entry = {
    id,
    user: currentUser.id,
    role: currentUser.role || 'staff',
    action,
    detail,
    time: new Date().toISOString()
  };
  DB.changelog.unshift(entry);
  if (DB.changelog.length > 500) DB.changelog.length = 500;
  if (typeof rtMarkSelfWrite === 'function') rtMarkSelfWrite();
  sbAddAudit(entry); // persist to Supabase audit_log
}

// Time-aware greeting for the top bar (Good morning/afternoon/evening)
function greetingText() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
}

// ── Shared sort comparator ────────────────────────────────────────
// Compares roll numbers/codes: plain numeric rolls compare numerically,
// alphanumeric codes (e.g. "SM01") fall back to natural string comparison.
function rollCmp(a, b) {
  const ra = parseInt(a.rollNo) || 0, rb = parseInt(b.rollNo) || 0;
  if (ra && rb && ra !== rb) return ra - rb;
  return String(a.rollNo || '').localeCompare(String(b.rollNo || ''), undefined, { numeric: true });
}
// sortKey: 'roll_asc' | 'roll_desc' | 'name_az' | 'name_za'
// Also handles legacy 'roll' (→ roll_asc) and 'name' (→ name_az)
function makeSorter(sortKey) {
  const k = sortKey || 'roll_asc';
  switch (k) {
    case 'roll_asc':  case 'roll': return (a, b) => rollCmp(a, b) || a.name.localeCompare(b.name);
    case 'roll_desc':              return (a, b) => rollCmp(b, a) || a.name.localeCompare(b.name);
    case 'name_az':   case 'name': return (a, b) => a.name.localeCompare(b.name);
    case 'name_za':                return (a, b) => b.name.localeCompare(a.name);
    default:                       return (a, b) => rollCmp(a, b) || a.name.localeCompare(b.name);
  }
}

// ----------------------------------------------------------------
// LOADING PROGRESS RING (0→90% while loading, →100% when done)
// ----------------------------------------------------------------
let _loadPctVal = 0;
let _loadPctTimer = null;
function startLoadProgress() {
  _loadPctVal = 0;
  const el = document.getElementById('loadPct');
  if (el) el.textContent = '0%';
  if (_loadPctTimer) clearInterval(_loadPctTimer);
  _loadPctTimer = setInterval(() => {
    // Climb fast early, slow down approaching 90%, never reach 100% on its own
    if (_loadPctVal < 90) {
      const step = _loadPctVal < 50 ? (Math.random() * 8 + 3) : (Math.random() * 3 + 1);
      _loadPctVal = Math.min(90, _loadPctVal + step);
      const el2 = document.getElementById('loadPct');
      if (el2) el2.textContent = Math.round(_loadPctVal) + '%';
    }
  }, 200);
}
function finishLoadProgress(cb) {
  if (_loadPctTimer) { clearInterval(_loadPctTimer); _loadPctTimer = null; }
  // Animate the remaining way to 100%, then run the callback
  const el = document.getElementById('loadPct');
  const finish = setInterval(() => {
    _loadPctVal = Math.min(100, _loadPctVal + 4);
    if (el) el.textContent = Math.round(_loadPctVal) + '%';
    if (_loadPctVal >= 100) {
      clearInterval(finish);
      setTimeout(() => { if (cb) cb(); }, 200);
    }
  }, 25);
}

// ----------------------------------------------------------------
// TOAST & CONFIRM
// ----------------------------------------------------------------
let toastTimer = null;
function showToast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.className = '', 2800);
}
function confirm_(icon, title, msg, cb, yesLabel, noLabel) {
  document.getElementById('cfIcon').textContent = icon;
  document.getElementById('cfTitle').textContent = title;
  document.getElementById('cfMsg').textContent = msg;
  document.getElementById('cfYes').textContent = yesLabel || 'Yes, Proceed';
  const noBtn = document.getElementById('cfNo');
  if (noBtn) noBtn.textContent = noLabel || 'No';
  document.getElementById('cfYes').onclick = () => { closeConfirm(); cb(); };
  document.getElementById('confirmDlg').classList.add('active');
}
function closeConfirm() { document.getElementById('confirmDlg').classList.remove('active'); }
function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  // If student modal is closed without saving, reset the convert flag
  if (id === 'modalStudent') {
    _convertingEnqId = null;
    const noteEl = document.getElementById('convertFromEnqNote');
    if (noteEl) noteEl.style.display = 'none';
  }
  // Don't schedule push here — each save function handles its own push
}

// ----------------------------------------------------------------
// CLOCK
// ----------------------------------------------------------------
function updateClock() {
  const now = new Date();
  const h24 = now.getHours();
  const h12 = ((h24 % 12) || 12);
  const ampm = h24 >= 12 ? 'PM' : 'AM';
  const clockTimeEl = document.getElementById('clockTime');
  const clockDateEl = document.getElementById('clockDate');
  if (clockTimeEl) clockTimeEl.textContent = `${pad(h12)}:${pad(now.getMinutes())} ${ampm}`;
  if (clockDateEl) clockDateEl.textContent = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()}`;
}

// ----------------------------------------------------------------
// LOGIN / LOGOUT
// ----------------------------------------------------------------
function clearLoginError() {
  const el = document.getElementById('loginError');
  if (el) { el.classList.remove('show'); }
  const idEl = document.getElementById('loginId');
  const pwEl = document.getElementById('loginPass');
  if (idEl) idEl.style.borderColor = '';
  if (pwEl) pwEl.style.borderColor = '';
}
function toggleLoginPass() {
  const pw = document.getElementById('loginPass');
  if (pw) pw.type = pw.type === 'password' ? 'text' : 'password';
}
function showLoginError(msg, opts) {
  const quiet = opts && opts.quiet;  // quiet = update text only, no shake/select
  const el = document.getElementById('loginError');
  const msgEl = document.getElementById('loginErrorMsg');
  const box = document.querySelector('.login-box');
  if (msgEl) msgEl.textContent = msg;
  if (el) el.classList.add('show');
  if (quiet) return;  // skip shake + field highlight for repeated countdown updates
  // Shake the login box
  if (box) {
    box.classList.remove('login-shake');
    void box.offsetWidth; // reflow to restart animation
    box.classList.add('login-shake');
    setTimeout(() => box.classList.remove('login-shake'), 500);
  }
  // Highlight the password field red
  const pwEl = document.getElementById('loginPass');
  if (pwEl) { pwEl.style.borderColor = '#ef4444'; pwEl.select(); }
}
async function doLogin() {

  // ── Progressive lockout check ──
  if (_loginLockUntil && Date.now() < _loginLockUntil) {
    _showLockoutCountdown();
    return;
  }

  const rawId = document.getElementById('loginId').value.trim().toLowerCase();
  const email = rawId.includes('@') ? rawId : rawId + '@gmail.com';
  const pw    = document.getElementById('loginPass').value;
  if (!rawId || !pw) {
    showLoginError('Please enter User ID and Password.');
    return;
  }
  // === CAPTCHA TEMPORARILY DISABLED FOR TESTING ===
  // To RE-ENABLE: uncomment the 4 lines below (remove the // from each).
  // if (!_turnstileToken) {
  //   showLoginError('Please complete the "I\'m not a robot" check below.');
  //   return;
  // }
  // === END CAPTCHA DISABLE BLOCK ===

  const btn = document.getElementById('loginBtn');
  btn.textContent = 'Checking...';
  btn.disabled = true;

  try {
    // Step 1: Sign in with Supabase Auth (with CAPTCHA token)
    if (!window._sbSignIn) throw new Error('Supabase not loaded yet. Please refresh.');
    const { data: signInData, error: signInErr } = await window._sbSignIn(email, pw, _turnstileToken);
    // Reset the CAPTCHA after each attempt (tokens are single-use)
    _resetTurnstile();
    if (signInErr) {
      // Normalize Supabase auth errors into the codes the catch block expects
      const msg = (signInErr.message || '').toLowerCase();
      if (msg.includes('invalid login') || msg.includes('credentials')) {
        const e = new Error('wrong'); e.code = 'auth/wrong-password'; throw e;
      }
      const e = new Error(signInErr.message); e.code = 'auth/other'; throw e;
    }

    // Step 2: Fetch this user's app profile (role, academy, name) from app_users
    // Wait until the auth session (JWT) is actually available, then query.
    // Without a valid token the RLS policy sees auth.uid() = null and returns 401/403.
    let authUid = signInData && signInData.user ? signInData.user.id : null;
    let haveToken = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const { data: sess } = await window._sb.auth.getSession();
        if (sess && sess.session && sess.session.access_token) {
          authUid = sess.session.user.id;
          haveToken = true;
          break;
        }
      } catch(e) {}
      await new Promise(r => setTimeout(r, 150)); // wait 150ms and retry
    }
    if (!haveToken) console.warn('No access token available after sign-in');

    const { data: profile, error: profErr } = await window._sb
      .from('app_users')
      .select('*')
      .eq('id', authUid)
      .single();
    if (profErr) console.error('app_users lookup error:', profErr);

    const user = profile ? {
      id: profile.login_id || profile.email,
      uid: profile.id,
      academyId: profile.academy_id,
      email: profile.email,
      name: profile.name,
      role: profile.role,
      assignedBatches: profile.assigned_batches || [],
      assignedSports: profile.assigned_sports || []
    } : null;

    if (profErr || !user) {
      // Auth succeeded but no app profile found — treat as unauthorised
      await window._sbSignOut();
      showLoginError('Account not set up in app. Contact your admin.');
      btn.textContent = 'Login →'; btn.disabled = false;
      return;
    }

    // Step 3: Launch app
    _currentAcademyId = user.academyId;   // scope all data to this academy
    window._currentAcademyId = user.academyId;   // expose for other <script> blocks (plans/config patch)
    DB.users = [user];
    _loginFailCount = 0; _loginLockUntil = 0; _persistLockout();  // reset lockout on success
    clearLoginError();
    btn.textContent = 'Login →'; btn.disabled = false;
    currentUser = user;

    // Save lightweight session (email only — no password stored)
    try { localStorage.setItem('sac_session', JSON.stringify({ email })); localStorage.setItem('sac_session_time', Date.now()); } catch(e) {}

    const overlay = document.getElementById('loadingOverlay');
    const loadMsg = document.getElementById('loadingMsg');
    const loadSub = document.getElementById('loadingSub');
    if (overlay) overlay.classList.add('active');
    startLoadProgress();
    if (loadMsg) loadMsg.textContent = 'Welcome, ' + (user.name || user.id) + '!';
    if (loadSub) loadSub.textContent = '';
    document.getElementById('topRoleBadge').textContent = isAdmin() ? 'Admin' : 'Staff';
    applyRoleUI();
    updateLogos();
    // NOTE: addLog('login', ...) is intentionally NOT called here.
    // It must run AFTER initFirebase has pulled the cloud data, otherwise
    // the push it triggers would race the pull and could wipe Firebase
    // with the empty default in-memory DB.

    _appLaunched = true; // set immediately so onAuthStateChanged doesn't double-launch

    // FeeZo patch: check frozen/trial BEFORE loading dashboard
    // Fully self-contained — no dependency on patch script timing
    {
      try {
        const { data: _fzd } = await window._sb
          .from('academies')
          .select('plan, trial_ends_at, plan_ends_at, frozen_at')
          .eq('id', _currentAcademyId)
          .single();
        if (_fzd) {
          const _fp = _fzd.plan, _fte = _fzd.trial_ends_at, _fpe = _fzd.plan_ends_at, _fn = Date.now();
          const _ff = _fp === 'frozen'
            || (_fp === 'trial' && _fte && new Date(_fte) < _fn)
            || (['basic','pro','premium'].includes(_fp) && _fpe && new Date(_fpe) < _fn);
          if (_ff) {
            if (overlay) { overlay.classList.remove('active'); overlay.style.display = 'none'; }
            // Show frozen screen — raw DOM, no external dependency
            const _fsel = document.getElementById('fzFrozenScreen');
            if (_fsel) {
              document.body.style.overflow = 'hidden';
              _fsel.style.cssText = 'display:flex !important;position:fixed;inset:0;z-index:2147483647;background:linear-gradient(135deg,#0f1f3d,#1a1040,#0a1628);align-items:center;justify-content:center;padding:20px;overflow-y:auto;font-family:Poppins,sans-serif;';
              // Set titles
              const _kind = _fp === 'frozen' ? 'manual' : (_fp === 'trial' ? 'trial' : 'plan');
              const _titles = {trial:'Your Free Trial Has Ended',plan:'Your Subscription Has Expired',manual:'Your Account Is On Hold'};
              const _badges = {trial:'Free Trial Ended',plan:'Subscription Expired',manual:'Account On Hold'};
              const _emojis = {trial:'⏰',plan:'🔄',manual:'🔒'};
              const _reasonTitles = {trial:'Your 7-day free trial has expired',plan:'Your '+_fp+' plan has expired',manual:'Your account has been put on hold'};
              const _el = id => document.getElementById(id);
              if(_el('fzFrozenTitle'))    _el('fzFrozenTitle').textContent    = _titles[_kind];
              if(_el('fzFrozenBadge'))    _el('fzFrozenBadge').textContent    = _badges[_kind];
              if(_el('fzFrozenEmoji'))    _el('fzFrozenEmoji').textContent    = _emojis[_kind];
              if(_el('fzFrozenSub'))      _el('fzFrozenSub').textContent      = 'Subscribe now to restore full access. Your data is 100% safe.';
              if(_el('fzReasonTitle'))    _el('fzReasonTitle').textContent    = _reasonTitles[_kind];
              const _expDate = _fp === 'trial' ? _fte : (_fp === 'frozen' ? _fzd.frozen_at : _fpe);
              const _dateStr = _expDate ? new Date(_expDate).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}) : '—';
              if(_el('fzReasonSub'))      _el('fzReasonSub').innerHTML = 'Your account was paused on <span style="color:#fff;font-weight:700;">' + _dateStr + '</span>';
              // Load stats async (best effort)
              if (window.fzShowFrozenPublic) window.fzShowFrozenPublic(_kind);
            }
            return; // dashboard never loads
          }
        }
      } catch(_fze) { console.warn('FeeZo frozen check failed:', _fze); }
    }

    loadAllData().then(() => {
      finishLoadProgress(() => {
        if (overlay) overlay.classList.remove('active');
        updateLogos();  // refresh logo now that settings loaded
        applyAcadSettings();  // refresh academy name/tagline now that settings loaded
        applyRoleUI();  // re-apply now that DB.settings.plan is populated from Supabase
        initNotifSystem();
        addLog('login', 'Logged in');
        if (isDefaultPassword(user)) {
          showChangePassScreen();
        } else {
          showToast('Welcome, ' + (user.name || user.id) + '! ✓', 'success');
          launchApp();
        }
      });
    });

  } catch(err) {
    btn.textContent = 'Login →'; btn.disabled = false;
    const code = err.code || '';
    if (code === 'auth/user-not-found' || code === 'auth/invalid-email') {
      showLoginError('User ID not found. Check and try again.');
    } else if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
      // Count the failed attempt and apply progressive lockout
      _loginFailCount++;
      // Lockout waits in seconds, starting from the 3rd wrong attempt
      // 3rd:30s, 4th:1m, 5th:10m, 6th:6h, 7th:1day, 8th:1week, 9th+:1month
      const waits = [
        30,            // 3rd
        60,            // 4th  (1 min)
        600,           // 5th  (10 min)
        6 * 3600,      // 6th  (6 hours)
        24 * 3600,     // 7th  (1 day)
        7 * 24 * 3600, // 8th  (1 week)
        30 * 24 * 3600 // 9th+ (1 month)
      ];
      if (_loginFailCount >= 3) {
        const idx = Math.min(_loginFailCount - 3, waits.length - 1);
        const waitSec = waits[idx];
        _loginLockUntil = Date.now() + waitSec * 1000;
        _persistLockout();
        _showLockoutCountdown();
      } else {
        _persistLockout();
        const left = 3 - _loginFailCount; // attempts before lock
        showLoginError(`Incorrect password. ⚠️ ${left} more wrong attempt${left>1?'s':''} will lock login temporarily.`);
      }
    } else if (code === 'auth/too-many-requests') {
      showLoginError('Too many attempts. Try again later.');
    } else {
      showLoginError(err.message || 'Login failed. Please try again.');
    }
  }
}

// ── Progressive login lockout state + countdown ──
let _loginFailCount = 0;
let _loginLockUntil = 0;
let _lockTimer = null;

// Restore persisted lockout on page load (so refresh doesn't bypass it)
(function _restoreLockout(){
  try {
    const fc = parseInt(localStorage.getItem('sac_login_failcount') || '0');
    const lu = parseInt(localStorage.getItem('sac_login_lockuntil') || '0');
    if (!isNaN(fc)) _loginFailCount = fc;
    if (!isNaN(lu)) _loginLockUntil = lu;
  } catch(e) {}
  // If a lock is still active, show the countdown once the page is ready
  if (_loginLockUntil && Date.now() < _loginLockUntil) {
    const start = () => { try { _showLockoutCountdown(); } catch(e) {} };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  }
})();

function _persistLockout(){
  try {
    localStorage.setItem('sac_login_failcount', String(_loginFailCount));
    localStorage.setItem('sac_login_lockuntil', String(_loginLockUntil));
  } catch(e) {}
}
function _showLockoutCountdown() {
  const btn = document.getElementById('loginBtn');
  if (_lockTimer) clearInterval(_lockTimer);
  const fmt = (secs) => {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };
  const tick = () => {
    const remain = Math.ceil((_loginLockUntil - Date.now()) / 1000);
    if (remain <= 0) {
      clearInterval(_lockTimer); _lockTimer = null;
      if (btn) { btn.disabled = false; btn.textContent = 'Sign In to Portal'; }
      clearLoginError();
      return;
    }
    const tStr = fmt(remain);
    showLoginError(`🔒 Too many wrong attempts. Login locked. Try again in ${tStr}.`, { quiet: true });
    if (btn) { btn.disabled = true; btn.textContent = `Locked (${tStr})`; }
  };
  tick();
  _lockTimer = setInterval(tick, 1000);
}
// ================================================================
// FIRST-TIME SETUP
// ================================================================

// Setup screen removed — Firebase config is baked into the app

// ================================================================
// CHANGE PASSWORD (forced after first login with default password)
// ================================================================

function isDefaultPassword(user) {
  // With Firebase Auth, password management is handled by Firebase.
  // Only check the mustChangePass flag set explicitly by admin.
  return user.mustChangePass === true;
}

function showChangePassScreen() {
  document.getElementById('changePassScreen').style.display = 'flex';
}

function openMyPassModal() {
  closeModal('modalSettings');
  document.getElementById('myPassNew').value = '';
  document.getElementById('myPassConfirm').value = '';
  const err = document.getElementById('myPassError');
  if (err) err.style.display = 'none';
  openModal('modalMyPass');
}

async function doChangeMyPassword() {
  const np = document.getElementById('myPassNew').value;
  const cp = document.getElementById('myPassConfirm').value;
  const err = document.getElementById('myPassError');
  const showErr = (m) => { if (err) { err.textContent = m; err.style.display = ''; } };
  if (!np || np.length < 6) { showErr('Password must be at least 6 characters.'); return; }
  if (np !== cp) { showErr('Passwords do not match.'); return; }
  try {
    const { error } = await window._sb.auth.updateUser({ password: np });
    if (error) throw error;
    addLog('user', 'Changed own password');
    closeModal('modalMyPass');
    showToast('Password updated ✓', 'success');
  } catch(e) {
    showErr(e.message || 'Could not update password.');
  }
}

async function doChangePass() {
  const np = document.getElementById('chPassNew').value;
  const cp = document.getElementById('chPassConfirm').value;
  const errEl = document.getElementById('chPassError');
  const msgEl = document.getElementById('chPassErrorMsg');
  if (!np || np.length < 6) {
    msgEl.textContent = 'Password must be at least 6 characters.';
    errEl.classList.add('show'); return;
  }
  if (np !== cp) {
    msgEl.textContent = 'Passwords do not match.';
    errEl.classList.add('show'); return;
  }
  try {
    // Update the logged-in user's own password via Supabase Auth
    const { error } = await window._sb.auth.updateUser({ password: np });
    if (error) throw error;
    const idx = DB.users.findIndex(u => u.id === currentUser.id);
    if (idx >= 0) {
      delete DB.users[idx].mustChangePass;
      currentUser = DB.users[idx];
    }
    addLog('user', 'Password changed on first login');
    document.getElementById('changePassScreen').style.display = 'none';
    launchApp();
    showToast('Password set! Welcome.', 'success');
  } catch(err) {
    msgEl.textContent = err.message || 'Could not update password. Please try again.';
    errEl.classList.add('show');
  }
}

function launchApp() {
  const overlay = document.getElementById('loadingOverlay');
  if (overlay) overlay.classList.remove('active');
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').classList.add('active');

  // Migrate: assign roll numbers to existing students that don't have one
  migrateRollNumbers();

  // Apply batch restriction for staff
  const staffBatches = getStaffBatches();
  if (staffBatches.length > 0) {
    selectedBatch = { student: staffBatches[0], att: staffBatches[0], fee: staffBatches[0] };
  } else {
    selectedBatch = { student: 'ALL', att: 'ALL', fee: 'ALL' };
  }

  initDashFilters();
  initAttFilters();
  initFeeFilters();
  switchPage('home');
  checkMidnightSnapshot();
  startRealtimeSync();
}

// ----------------------------------------------------------------
// REALTIME SYNC — listen for DB changes and refresh across devices
// ----------------------------------------------------------------
let _rtChannel = null;
let _rtReloadTimer = null;
let _rtSelfWriteUntil = 0; // brief window to ignore our own echoes
let _rtLastLogId = null;   // id of the last audit-log entry we've already shown a popup for

// Call this after we make a local write, so the immediate echo doesn't
// trigger a redundant full reload.
function rtMarkSelfWrite() { _rtSelfWriteUntil = Date.now() + 1500; }

function startRealtimeSync() {
  if (!window._sb || _rtChannel) return;
  const aid = acadId();
  if (!aid) return;
  _rtLastLogId = (DB.changelog && DB.changelog[0] && DB.changelog[0].id) || null;

  // Supabase's postgres_changes filter is per-table (no schema-wide filter),
  // so we chain one .on() per table, each scoped to this academy's rows only.
  // This stops staff in Academy A from triggering reloads on Academy B's data.
  const RT_TABLES = [
    'app_users', 'batches', 'students', 'attendance', 'fees', 'enquiries',
    'class_log', 'audit_log', 'msg_logs', 'sports', 'enrollments',
    'leave_requests', 'week_schedules'
  ];

  const onChange = (payload) => {
    // A change happened on some table. If it was very likely our own
    // write, skip (we already updated locally). Otherwise refresh.
    if (Date.now() < _rtSelfWriteUntil) return;
    scheduleRealtimeReload();
  };

  try {
    let ch = window._sb.channel('academy-' + aid);
    RT_TABLES.forEach(table => {
      ch = ch.on('postgres_changes',
        { event: '*', schema: 'public', table, filter: 'academy_id=eq.' + aid },
        onChange);
    });
    // 'academies' row itself uses its own id, not academy_id, as the key
    ch = ch.on('postgres_changes',
      { event: '*', schema: 'public', table: 'academies', filter: 'id=eq.' + aid },
      onChange);
    _rtChannel = ch.subscribe();
  } catch (e) {
    console.warn('Realtime subscribe failed:', e);
  }
}

function stopRealtimeSync() {
  if (_rtChannel) { try { window._sb.removeChannel(_rtChannel); } catch(e){} _rtChannel = null; }
}

// Debounced: reload all data, then re-render whatever page is showing.
function scheduleRealtimeReload() {
  if (_rtReloadTimer) clearTimeout(_rtReloadTimer);
  _rtReloadTimer = setTimeout(async () => {
    try {
      await loadAllData();
      refreshCurrentPage();
      // subtle indicator that data updated from another device
      const dot = document.getElementById('rtSyncDot');
      if (dot) { dot.style.opacity = '1'; setTimeout(() => { dot.style.opacity = '0'; }, 1200); }
      // Popup: tell the admin/staff who made the change, using the newest audit log entry
      const latest = (DB.changelog && DB.changelog[0]) || null;
      if (latest && latest.id !== _rtLastLogId) {
        _rtLastLogId = latest.id;
        const isOwnAction = currentUser && latest.user === currentUser.id;
        if (!isOwnAction && typeof isAdmin === 'function' && isAdmin() && isRtPopupEnabled()) {
          const u = (DB.users || []).find(x => x.id === latest.user);
          const who = (u && u.name) || (latest.role === 'admin' ? 'Admin' : 'A staff member');
          const what = latest.detail || latest.action || 'made a change';
          showToast(`🔄 ${who}: ${what}`);
        }
      }
    } catch (e) { console.warn('Realtime reload failed:', e); }
  }, 600);
}

function migrateRollNumbers() {
  // Get students without a roll number
  const noRoll = DB.students.filter(s => !s.rollNo);
  if (!noRoll.length) return;

  // Sort by join date so earliest joiners get lower numbers
  noRoll.sort((a, b) => {
    const da = parseDate(a.joinDate), db = parseDate(b.joinDate);
    if (da && db) return da - db;
    if (da) return -1;
    if (db) return 1;
    return a.name.localeCompare(b.name);
  });

  // Assign roll codes based on each student's first enrollment (sport + batch)
  const changed = [];
  noRoll.forEach(s => {
    const idx = DB.students.findIndex(x => x.id === s.id);
    if (idx < 0) return;
    const sid = s._sid || s.id;
    const enroll = (DB.enrollments || []).find(e => e.studentId === sid);
    const sport = enroll ? enroll.sport : '';
    const batch = (enroll && enroll.batch) || s.batch || '';
    const code = nextRollForSportBatch(sport, batch);
    if (code) {
      DB.students[idx].rollNo = code;
      changed.push(DB.students[idx]);
    }
  });
  // Persist each changed student to Supabase
  changed.forEach(st => { if (st._sid) sbUpdateStudent(st._sid, st); });
}

function doLogout() {
  confirm_('🚪','Logout','Are you sure you want to logout?', () => {
    addLog('logout','Logged out');
    stopRealtimeSync();
    _appLaunched = false;
    currentUser = null;
    try { localStorage.removeItem('sac_session'); localStorage.removeItem('sac_session_time'); } catch(e) {}
    if (window._sbSignOut) window._sbSignOut().catch(()=>{});
    document.getElementById('app').classList.remove('active');
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('loginId').value = '';
    document.getElementById('loginPass').value = '';
  });
}
function applyRoleUI() {
  // Role-based: admin-only elements
  document.querySelectorAll('.admin-only').forEach(el => {
    el.style.display = isAdmin() ? '' : 'none';
  });

  // Plan-based: Pro+ tabs (enquiry, activity, performance, schedules)
  // Trial is treated as Premium-tier during the trial period (premium-trial offering)
  const plan    = (DB.settings && DB.settings.plan) || 'trial';
  const isPro   = ['pro','premium','trial'].includes(plan);
  const isPrem  = ['premium','trial'].includes(plan);

  // Plans button in hamburger — admin only, hide for Premium (already max plan)
  const plansBtn = document.getElementById('tnav-plans-btn');
  if (plansBtn) {
    const showPlans = isAdmin() && plan !== 'premium';
    plansBtn.style.display = showPlans ? 'block' : 'none';
  }

  // Refresh plan badge in the side panel
  const panelPlanBadge = document.getElementById('tabPanelPlanBadge');
  if (panelPlanBadge && isAdmin()) {
    const planLabels = { trial:'Trial', basic:'Basic', pro:'Pro', premium:'Premium', frozen:'Frozen' };
    const planColors = {
      trial:   { bg:'rgba(245,158,11,.15)', color:'#f59e0b', border:'rgba(245,158,11,.3)' },
      basic:   { bg:'rgba(59,130,246,.15)',  color:'#3b82f6', border:'rgba(59,130,246,.3)' },
      pro:     { bg:'rgba(124,58,237,.15)',  color:'#7c3aed', border:'rgba(124,58,237,.3)' },
      premium: { bg:'rgba(16,185,129,.15)',  color:'#10b981', border:'rgba(16,185,129,.3)' },
      frozen:  { bg:'rgba(239,68,68,.15)',   color:'#ef4444', border:'rgba(239,68,68,.3)'  },
    };
    const c = planColors[plan] || planColors.trial;
    panelPlanBadge.textContent    = planLabels[plan] || plan;
    panelPlanBadge.style.background = c.bg;
    panelPlanBadge.style.color      = c.color;
    panelPlanBadge.style.border     = '1px solid ' + c.border;
    panelPlanBadge.style.display    = 'inline';
  }

  // Enquiry tab — Pro+
  const enqNav  = document.getElementById('tnav-enquiry');
  if (enqNav)  enqNav.style.display  = isPro ? '' : 'none';
  const enqBottomNav = document.getElementById('nav-enquiry');
  if (enqBottomNav) enqBottomNav.style.display = isPro ? '' : 'none';

  // Activity tab — Pro+
  const actNav  = document.getElementById('tnav-activity');
  if (actNav)  actNav.style.display  = isPro ? '' : 'none';

  // Performance tab — Pro+
  const perfNav = document.getElementById('tnav-performance');
  if (perfNav) perfNav.style.display = isPro ? '' : 'none';

  // Schedules tab — Premium only
  const schedNav = document.getElementById('tnav-schedules');
  if (schedNav) schedNav.style.display = isPrem ? '' : 'none';

  // If current page is a locked tab, redirect to home
  if (!isPro && ['enquiry','activity','performance'].includes(currentPage)) {
    switchPage('home');
  }
  if (!isPrem && currentPage === 'schedules') {
    switchPage('home');
  }
}

// hasLoadedRemote: set true once the initial Supabase load completes.
let hasLoadedRemote = false;

// ============================================================
// SUPABASE DATA LAYER
// Loads all tables for the current academy into the in-memory DB,
// mapping back to the structure the rest of the app expects.
// ============================================================
const sb = () => window._sb;
const acadId = () => _currentAcademyId;

// Supabase caps unpaginated selects at 1000 rows by default. Tables that grow
// large over time (attendance, fees — one row per student per day/month) can
// silently lose the newest rows once the table passes that cap. This fetches
// every page so nothing gets dropped as the table grows.
async function fetchAllPaged(table, aid, orderFn) {
  const pageSize = 1000;
  let from = 0;
  let all = [];
  while (true) {
    let q = sb().from(table).select('*').eq('academy_id', aid);
    if (orderFn) q = orderFn(q);
    const { data, error } = await q.range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    all = all.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return { data: all, error: null };
}
async function loadAllData() {
  try {
    const aid = acadId();
    if (!aid) throw new Error('No academy id set');

    // Fetch all tables in parallel, scoped to this academy
    const [
      acadRes, usersRes, batchesRes, studentsRes,
      attRes, feesRes, enqRes, classRes, auditRes, msgRes, snapRes,
      sportsRes, enrollRes, leaveRes, weekSchedRes
    ] = await Promise.all([
      sb().from('academies').select('*').eq('id', aid).single(),
      sb().from('app_users').select('*').eq('academy_id', aid),
      sb().from('batches').select('*').eq('academy_id', aid).order('sort_order'),
      sb().from('students').select('*').eq('academy_id', aid),
      fetchAllPaged('attendance', aid),
      fetchAllPaged('fees', aid),
      sb().from('enquiries').select('*').eq('academy_id', aid),
      fetchAllPaged('class_log', aid),
      sb().from('audit_log').select('*').eq('academy_id', aid)
        .gte('created_at', new Date(Date.now() - 270*24*60*60*1000).toISOString())
        .order('created_at', { ascending: false }).limit(1000),
      sb().from('msg_logs').select('*').eq('academy_id', aid).order('sent_at', { ascending: false }).limit(200),
      sb().from('snapshots').select('snap_key,label,created_at').eq('academy_id', aid).order('created_at', { ascending: false }),
      sb().from('sports').select('*').eq('academy_id', aid).order('sort_order'),
      sb().from('enrollments').select('*').eq('academy_id', aid),
      sb().from('leave_requests').select('*').eq('academy_id', aid).order('applied_at', { ascending: false }),
      fetchAllPaged('week_schedules', aid, q => q.order('date', { ascending: true }))
    ]);
    // --- settings (from academies row) ---
    const a = acadRes.data || {};
    DB.settings = {
      academyName: a.name || '', logoUrl: a.logo_url || '', email: a.email || '',
      phone: a.phone || '', phone2: a.phone2 || '', tagline: a.tagline || '', loginBgUrl: a.login_bg_url || '',
      loginSupport: a.login_support || '', msgTemplate: a.msg_template || DB.settings.msgTemplate,
      thankTemplate: a.thank_template || DB.settings.thankTemplate,
      plan: a.plan || 'trial', trialEndsAt: a.trial_ends_at || null, planEndsAt: a.plan_ends_at || null,
    };
    // Now that plan is known, trim changelog to plan retention window
    // and schedule async cleanup of old audit_log rows in Supabase
    const _retMs = { basic:90, pro:180, premium:270, trial:270, frozen:90 }[a.plan||'trial'] || 90;
    const _retMs2 = _retMs * 24 * 60 * 60 * 1000;
    const _cutoffISO = new Date(Date.now() - _retMs2).toISOString();
    if (Array.isArray(DB.changelog)) {
      DB.changelog = DB.changelog.filter(c => c.time >= _cutoffISO);
    }
    // Background purge: delete audit_log rows older than retention
    if (typeof sb === 'function') {
      sb().from('audit_log')
        .delete()
        .eq('academy_id', aid)
        .lt('created_at', _cutoffISO)
        .then(() => {})
        .catch(() => {});
    }
    // Keep localStorage in sync so logo survives refresh even before Supabase loads
    try {
      const lk = 'fezo_logo_' + (acadId()||'local');
      if (DB.settings.logoUrl) localStorage.setItem(lk, DB.settings.logoUrl);
      else if (!DB.settings.logoUrl) {
        const cached = localStorage.getItem(lk);
        if (cached) DB.settings.logoUrl = cached;
      }
    } catch(e) {}
    DB.notes = a.notes || '';
    // --- sports config (sports list + batch→sport map) ---
    const sc = a.sports_config && typeof a.sports_config === 'object' ? a.sports_config : {};
    // Prefer the new sports table (Stage 2); fall back to sports_config (Stage 1)
    const sportRows = sportsRes && sportsRes.data ? sportsRes.data : [];
    DB.sports = sportRows.length ? sportRows.map(s => s.name) : (Array.isArray(sc.sports) ? sc.sports : []);
    DB.batchSport = (sc.batchSport && typeof sc.batchSport === 'object') ? sc.batchSport : {};
    DB.attDone = (sc.attDone && typeof sc.attDone === 'object') ? sc.attDone : {};
    DB.feeDone = (sc.feeDone && typeof sc.feeDone === 'object') ? sc.feeDone : {};
    DB.schedules  = Array.isArray(sc.schedules)  ? sc.schedules  : [];
    DB.weekSchedules = Array.isArray(sc.weekSchedules) ? sc.weekSchedules : [];
    // weekSchedules now loaded from dedicated table (not sports_config)
    DB.weekSchedules = (weekSchedRes?.data || []).map(r => ({
      id: r.id, staffId: r.staff_id, date: r.date,
      task: r.task, location: r.location, sport: r.sport, batch: r.batch,
      inTime: r.in_time, outTime: r.out_time, note: r.note,
      recurDays: r.recur_days || null, status: r.status || 'scheduled',
      startedAt: r.started_at, startedBy: r.started_by,
      completedAt: r.completed_at, completedBy: r.completed_by,
      createdBy: r.created_by, createdAt: r.created_at,
      updatedBy: r.updated_by, updatedAt: r.updated_at
    }));
    // leaveRequests now loaded from dedicated table (not sports_config)
    DB.leaveRequests = (leaveRes?.data || []).map(r => ({
      id: r.id, staffId: r.staff_id, staffName: r.staff_name,
      date: r.date, reason: r.reason, status: r.status,
      appliedAt: r.applied_at, reviewedBy: r.reviewed_by, reviewedAt: r.reviewed_at
    }));
    DB.perfScores = (sc.perfScores && typeof sc.perfScores === 'object') ? sc.perfScores : {};
    DB.perfWeights = (sc.perfWeights && typeof sc.perfWeights === 'object' &&
      Number.isFinite(sc.perfWeights.points) && Number.isFinite(sc.perfWeights.attendance))
      ? sc.perfWeights : { points: 70, attendance: 30 };

    // --- enrollments (Stage 2): one row per student per sport ---
    DB.enrollments = (enrollRes && enrollRes.data ? enrollRes.data : []).map(e => ({
      id: e.id, studentId: e.student_id, sport: e.sport, batch: e.batch,
      joinDate: isoToDisplay(e.join_date), active: e.active
    }));

    // --- users ---
    DB.users = (usersRes.data || []).map(u => ({
      id: u.login_id || u.email, uid: u.id, academyId: u.academy_id,
      email: u.email, name: u.name, role: u.role, assignedBatches: u.assigned_batches || [], assignedSports: u.assigned_sports || []
    }));

    // --- batches (array of names) ---
    DB.batches = (batchesRes.data || []).map(b => b.name);

    // --- students (keep db uuid as _sid for later writes; id stays app-style) ---
    DB.students = (studentsRes.data || []).map(s => ({
      _sid: s.id, id: s.id, rollNo: s.roll_no, name: s.name, age: s.age, dob: s.dob,
      parent: s.parent, contact: s.contact, contact2: s.contact2, address: s.address,
      batch: s.batch, joinDate: isoToDisplay(s.join_date), banned: s.banned, bannedOn: s.banned_on
    }));
    // Map student uuid -> for attendance/fees rebuild
    const sidToId = {}; DB.students.forEach(s => { sidToId[s._sid] = s.id; });

    // --- attendance: rebuild { "YYYY-MM-DD": { sport: { studentId: "P"/"A" } } } ---
    DB.attendance = {};
    (attRes.data || []).forEach(r => {
      const d = r.date;
      const sp = r.sport || (DB.sports && DB.sports[0]) || 'General';
      if (!DB.attendance[d]) DB.attendance[d] = {};
      if (!DB.attendance[d][sp]) DB.attendance[d][sp] = {};
      DB.attendance[d][sp][r.student_id] = r.status;
    });

    // --- fees: rebuild { "YYYY-MM": { sport: { studentId: {...} } } } ---
    DB.fees = {};
    (feesRes.data || []).forEach(r => {
      const m = r.month;
      const sp = r.sport || (DB.sports && DB.sports[0]) || 'General';
      if (!DB.fees[m]) DB.fees[m] = {};
      if (!DB.fees[m][sp]) DB.fees[m][sp] = {};
      DB.fees[m][sp][r.student_id] = {
        status: r.status, amount: r.amount, method: r.method,
        date: r.paid_date, by: r.collected_by, msgSent: r.msg_sent || []
      };
    });

    // --- enquiries ---
    DB.enquiries = (enqRes.data || []).map(e => ({
      id: e.id, name: e.name, phone: e.phone, query: e.query, location: e.location,
      conversionRatio: e.conversion_ratio, reminderDate: e.reminder_date, sport: e.sport || '',
      assignedTo: e.assigned_to, createdBy: e.created_by, archived: e.archived,
      archivedAt: e.archived_at, datetime: e.created_at, editHistory: e.edit_history || [],
      staffNotes: e.staff_notes || []
    }));

    // --- class log ---
    DB.classLog = (classRes.data || []).map(c => ({
      id: c.id, date: c.date, sport: c.sport || '', batch: c.batch, inTime: c.in_time, outTime: c.out_time,
      duration: c.duration, note: c.note, by: c.created_by, at: c.created_at
    }));

    // --- changelog (audit) ---
    DB.changelog = (auditRes.data || []).map(c => ({
      id: c.id, user: c.user_id, role: c.role, action: c.action, detail: c.detail, time: c.created_at
    }));

    // --- msg logs ---
    DB.msgLogs = (msgRes.data || []).map(m => ({
      id: m.id, type: m.type, kind: m.kind || 'reminder', to: m.to_name, contact: m.contact,
      month: m.month, by: m.sent_by, at: m.sent_at, msg: m.message
    }));

    // --- snapshot index ---
    DB.snapshotIndex = (snapRes.data || []).map(s => ({
      key: s.snap_key, label: s.label, time: s.created_at
    }));

    hasLoadedRemote = true;
    return true;
  } catch (e) {
    console.error('loadAllData failed:', e);
    showToast('Failed to load data: ' + e.message, 'error');
    return false;
  }
}

// ============================================================
// STAGE C — SUPABASE WRITE OPERATIONS (per-table)
// Each function writes a single row/record directly to Supabase.
// ============================================================

// ---- SETTINGS (academies row) ----
async function sbSaveSettings() {
  const aid = acadId();
  if (!aid) return false;
  try {
    const { error } = await sb().from('academies').update({
      name:          DB.settings.academyName || '',
      logo_url:      DB.settings.logoUrl     || '',
      email:         DB.settings.email       || '',
      phone:         DB.settings.phone       || '',
      phone2:        DB.settings.phone2      || '',
      tagline:       DB.settings.tagline     || '',
      login_bg_url:  DB.settings.loginBgUrl  || '',
      login_support: DB.settings.loginSupport|| '',
      msg_template:  DB.settings.msgTemplate || '',
      thank_template: DB.settings.thankTemplate || '',
      sports_config: { sports: DB.sports || [], batchSport: DB.batchSport || {}, attDone: DB.attDone || {}, feeDone: DB.feeDone || {}, schedules: DB.schedules || [], perfScores: DB.perfScores || {}, perfWeights: DB.perfWeights || { points: 70, attendance: 30 } },
      notes:         DB.notes                || ''
    }).eq('id', aid);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('sbSaveSettings failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
    return false;
  }
}

// ---- LOGO ONLY SAVE ----
async function sbSaveLogo() {
  const aid = acadId();
  if (!aid) return false;
  try {
    const { error } = await sb().from('academies')
      .update({ logo_url: DB.settings.logoUrl || '' })
      .eq('id', aid);
    if (error) throw error;
    return true;
  } catch (e) {
    console.error('sbSaveLogo failed:', e);
    showToast('Logo save failed: ' + e.message, 'error');
    return false;
  }
}

// ---- SPORTS (sports table) ----
async function sbAddSport(name, sortOrder) {
  const aid = acadId();
  if (!aid) return;
  try {
    const { error } = await sb().from('sports').insert({ academy_id: aid, name, sort_order: sortOrder || 0 });
    if (error) throw error;
  } catch (e) { console.error('sbAddSport failed:', e); showToast('Save to cloud failed: ' + e.message, 'error'); }
}
async function sbRenameSport(oldName, newName) {
  const aid = acadId();
  if (!aid) return;
  try {
    const { error } = await sb().from('sports').update({ name: newName }).eq('academy_id', aid).eq('name', oldName);
    if (error) throw error;
    await sb().from('enrollments').update({ sport: newName }).eq('academy_id', aid).eq('sport', oldName);
  } catch (e) { console.error('sbRenameSport failed:', e); showToast('Save to cloud failed: ' + e.message, 'error'); }
}
async function sbDeleteSport(name) {
  const aid = acadId();
  if (!aid) return;
  try {
    const { error } = await sb().from('sports').delete().eq('academy_id', aid).eq('name', name);
    if (error) throw error;
  } catch (e) { console.error('sbDeleteSport failed:', e); showToast('Save to cloud failed: ' + e.message, 'error'); }
}

// ---- BATCHES (batches table) ----
async function sbAddBatch(name, sortOrder) {
  const aid = acadId();
  if (!aid) return;
  try {
    const { error } = await sb().from('batches').insert({
      academy_id: aid, name: name, sort_order: sortOrder || 0
    });
    if (error) throw error;
  } catch (e) {
    console.error('sbAddBatch failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
async function sbRenameBatch(oldName, newName) {
  const aid = acadId();
  if (!aid) return;
  try {
    // Rename the batch row
    const { error: e1 } = await sb().from('batches')
      .update({ name: newName }).eq('academy_id', aid).eq('name', oldName);
    if (e1) throw e1;
    // Update any students that were in the old batch
    const { error: e2 } = await sb().from('students')
      .update({ batch: newName }).eq('academy_id', aid).eq('batch', oldName);
    if (e2) throw e2;
  } catch (e) {
    console.error('sbRenameBatch failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
async function sbDeleteBatch(name, fallbackName) {
  const aid = acadId();
  if (!aid) return;
  try {
    // Move students to fallback batch
    const { error: e1 } = await sb().from('students')
      .update({ batch: fallbackName }).eq('academy_id', aid).eq('batch', name);
    if (e1) throw e1;
    // Delete the batch row
    const { error: e2 } = await sb().from('batches')
      .delete().eq('academy_id', aid).eq('name', name);
    if (e2) throw e2;
  } catch (e) {
    console.error('sbDeleteBatch failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}

// ---- STUDENTS (students table) ----
// Converts an in-memory student object to a DB row
function _studentRow(s) {
  const aid = acadId();
  return {
    academy_id: aid,
    roll_no: s.rollNo || null,
    name: s.name || '',
    age: s.age || '',
    dob: s.dob || '',
    parent: s.parent || '',
    contact: s.contact || '',
    contact2: s.contact2 || '',
    address: s.address || '',
    batch: s.batch || '',
    join_date: _toDateOrNull(s.joinDate),
    banned: !!s.banned,
    banned_on: s.bannedOn || null
  };
}
// Insert a new student; returns the created row (with real uuid) or null
async function sbInsertStudent(s) {
  try {
    const { data, error } = await sb().from('students')
      .insert(_studentRow(s)).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('sbInsertStudent failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
    return null;
  }
}
// Update an existing student by its uuid (_sid)
async function sbUpdateStudent(sid, s) {
  try {
    const row = _studentRow(s);
    delete row.academy_id; // don't change ownership
    const { error } = await sb().from('students').update(row).eq('id', sid);
    if (error) throw error;
  } catch (e) {
    console.error('sbUpdateStudent failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
// ---- ENROLLMENTS (enrollments table) ----
// Sync a student's enrollments to match the given list of {sport,batch}.
// studentSid = the student's uuid. Adds new, removes ones no longer present.
async function sbSyncEnrollments(studentSid, enrollList) {
  const aid = acadId();
  if (!aid) { console.warn('sbSyncEnrollments: no academy id'); return false; }
  if (!studentSid) {
    console.warn('sbSyncEnrollments: missing studentSid (student has no _sid uuid yet)');
    showToast('Could not save sports: student ID not ready. Try editing & saving again.', 'error');
    return false;
  }
  // Guard: a uuid has dashes; the app-style temp id looks like "S1700000000000"
  if (typeof studentSid === 'string' && studentSid[0] === 'S' && !studentSid.includes('-')) {
    console.warn('sbSyncEnrollments: studentSid is a temp id, not a uuid:', studentSid);
    showToast('Could not save sports: student not synced yet. Reopen and save again.', 'error');
    return false;
  }
  try {
    // Fetch current enrollments for this student
    const { data: existing, error: e1 } = await sb().from('enrollments')
      .select('id,sport,batch').eq('academy_id', aid).eq('student_id', studentSid);
    if (e1) throw e1;
    const have = existing || [];
    const want = enrollList || [];
    // Delete enrollments whose sport is no longer in the want-list
    const wantSports = want.map(w => w.sport);
    for (const h of have) {
      if (!wantSports.includes(h.sport)) {
        const { error } = await sb().from('enrollments').delete().eq('id', h.id);
        if (error) throw error;
      }
    }
    // Upsert each wanted enrollment (insert new, or update batch if sport exists)
    for (const w of want) {
      const match = have.find(h => h.sport === w.sport);
      if (match) {
        if (match.batch !== w.batch) {
          const { error } = await sb().from('enrollments').update({ batch: w.batch }).eq('id', match.id);
          if (error) throw error;
        }
      } else {
        const { error } = await sb().from('enrollments').insert({
          academy_id: aid, student_id: studentSid,
          sport: w.sport, batch: w.batch || null,
          join_date: _toDateOrNull(w.joinDate), active: true
        });
        if (error) throw error;
      }
    }
    return true;
  } catch (e) {
    console.error('sbSyncEnrollments failed:', e);
    showToast('Enrollment save failed: ' + (e.message || e), 'error');
    return false;
  }
}

// Delete a student by uuid
async function sbDeleteStudent(sid) {
  try {
    const { error } = await sb().from('students').delete().eq('id', sid);
    if (error) throw error;
  } catch (e) {
    console.error('sbDeleteStudent failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
// Bulk insert students (import); maps real uuids back into DB.students
async function sbBulkInsertStudents(studs) {
  if (!studs || !studs.length) return [];
  try {
    const rows = studs.map(_studentRow);
    const { data, error } = await sb().from('students').insert(rows).select();
    if (error) throw error;
    // Map returned rows back by matching name+contact order (insert preserves order)
    (data || []).forEach((row, i) => {
      const orig = studs[i];
      const idx = DB.students.findIndex(s => s.id === orig.id);
      if (idx >= 0) { DB.students[idx]._sid = row.id; DB.students[idx].id = row.id; }
    });
    return data || [];
  } catch (e) {
    console.error('sbBulkInsertStudents failed:', e);
    showToast('Some students may not have saved to cloud: ' + e.message, 'error');
    return [];
  }
}

// ---- ATTENDANCE (attendance table; upsert per student+sport+date) ----
async function sbSetAttendance(studentUuid, dateKey, status, markedBy, sport) {
  const aid = acadId();
  if (!aid) return;
  const sp = sport || attCurrentSport();
  try {
    const { error } = await sb().from('attendance').upsert({
      academy_id: aid, student_id: studentUuid, date: dateKey, sport: sp,
      status: status, marked_by: markedBy || ''
    }, { onConflict: 'student_id,sport,date' });
    if (error) throw error;
  } catch (e) {
    console.error('sbSetAttendance failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
async function sbClearAttendance(studentUuid, dateKey, sport) {
  const sp = sport || attCurrentSport();
  try {
    const { error } = await sb().from('attendance')
      .delete().eq('student_id', studentUuid).eq('date', dateKey).eq('sport', sp);
    if (error) throw error;
  } catch (e) {
    console.error('sbClearAttendance failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
// Bulk upsert (mark all) / bulk clear
async function sbSetAttendanceBulk(studentUuids, dateKey, status, markedBy, sport) {
  const aid = acadId();
  if (!aid || !studentUuids.length) return;
  const sp = sport || attCurrentSport();
  try {
    const rows = studentUuids.map(uid => ({
      academy_id: aid, student_id: uid, date: dateKey, sport: sp, status, marked_by: markedBy || ''
    }));
    const { error } = await sb().from('attendance').upsert(rows, { onConflict: 'student_id,sport,date' });
    if (error) throw error;
  } catch (e) {
    console.error('sbSetAttendanceBulk failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
async function sbClearAttendanceBulk(studentUuids, dateKey, sport) {
  if (!studentUuids.length) return;
  const sp = sport || attCurrentSport();
  try {
    const { error } = await sb().from('attendance')
      .delete().in('student_id', studentUuids).eq('date', dateKey).eq('sport', sp);
    if (error) throw error;
  } catch (e) {
    console.error('sbClearAttendanceBulk failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}

// ---- FEES (fees table; upsert per student+month) ----
async function sbSetFee(studentUuid, month, fee, sport) {
  const aid = acadId();
  if (!aid) return;
  const sp = sport || feeCurrentSport();
  try {
    const { error } = await sb().from('fees').upsert({
      academy_id: aid, student_id: studentUuid, month: month, sport: sp,
      status: fee.status || '', amount: fee.amount || null,
      method: fee.method || '', paid_date: _toDateOrNull(fee.date),
      collected_by: fee.by || '',
      msg_sent: fee.msgSent || []
    }, { onConflict: 'student_id,sport,month' });
    if (error) throw error;
  } catch (e) {
    console.error('sbSetFee failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
async function sbClearFee(studentUuid, month, sport) {
  const sp = sport || feeCurrentSport();
  try {
    const { error } = await sb().from('fees')
      .delete().eq('student_id', studentUuid).eq('month', month).eq('sport', sp);
    if (error) throw error;
  } catch (e) {
    console.error('sbClearFee failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}

// ---- MSG LOGS (msg_logs table) ----
async function sbAddMsgLog(entry) {
  const aid = acadId();
  if (!aid) return;
  try {
    const { error } = await sb().from('msg_logs').insert({
      academy_id: aid, type: entry.type || '', kind: entry.kind || 'reminder', to_name: entry.to || '',
      contact: entry.contact || '', month: entry.month || '',
      sent_by: entry.by || '', sent_at: entry.at || new Date().toISOString(),
      message: entry.msg || ''
    });
    if (error) throw error;
  } catch (e) {
    console.error('sbAddMsgLog failed:', e);
  }
}

// ---- ENQUIRIES (enquiries table) ----
function _enqRow(q) {
  return {
    academy_id: acadId(),
    name: q.name || '', phone: q.phone || '', query: q.query || '',
    location: q.location || '', conversion_ratio: q.conversionRatio || '',
    sport: q.sport || '',
    reminder_date: _toDateOrNull(q.reminderDate), assigned_to: q.assignedTo || '',
    created_by: q.createdBy || '', archived: !!q.archived,
    archived_at: q.archivedAt || null, edit_history: q.editHistory || [],
    staff_notes: q.staffNotes || []
  };
}
async function sbInsertEnquiry(q) {
  try {
    const { data, error } = await sb().from('enquiries').insert(_enqRow(q)).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('sbInsertEnquiry failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
    return null;
  }
}
async function sbUpdateEnquiry(id, q) {
  try {
    const row = _enqRow(q); delete row.academy_id;
    const { error } = await sb().from('enquiries').update(row).eq('id', id);
    if (error) throw error;
  } catch (e) {
    console.error('sbUpdateEnquiry failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
async function sbDeleteEnquiry(id) {
  try {
    const { error } = await sb().from('enquiries').delete().eq('id', id);
    if (error) throw error;
  } catch (e) {
    console.error('sbDeleteEnquiry failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}

// ---- CLASS LOG (class_log table) ----
function _classRow(c) {
  return {
    academy_id: acadId(),
    date: _toDateOrNull(c.date), sport: c.sport || '', batch: c.batch || '',
    in_time: c.inTime || '', out_time: c.outTime || '',
    duration: c.duration || '', note: c.note || '', created_by: c.by || ''
  };
}
async function sbInsertClassLog(c) {
  try {
    const { data, error } = await sb().from('class_log').insert(_classRow(c)).select().single();
    if (error) throw error;
    return data;
  } catch (e) {
    console.error('sbInsertClassLog failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
    return null;
  }
}
async function sbUpdateClassLog(id, c) {
  try {
    const row = _classRow(c); delete row.academy_id;
    const { error } = await sb().from('class_log').update(row).eq('id', id);
    if (error) throw error;
  } catch (e) {
    console.error('sbUpdateClassLog failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
async function sbDeleteClassLog(id) {
  try {
    const { error } = await sb().from('class_log').delete().eq('id', id);
    if (error) throw error;
  } catch (e) {
    console.error('sbDeleteClassLog failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}

// ---- AUDIT LOG (audit_log table) ----
async function sbAddAudit(entry) {
  const aid = acadId();
  if (!aid) return;
  try {
    const { error } = await sb().from('audit_log').insert({
      academy_id: aid, user_id: entry.user || '', role: entry.role || '',
      action: entry.action || '', detail: entry.detail || ''
    });
    if (error) throw error;
  } catch (e) {
    console.error('sbAddAudit failed:', e);
  }
}

// ---- SNAPSHOTS (snapshots table) ----
async function sbAddSnapshot(snapKey, label, data) {
  const aid = acadId();
  if (!aid) return;
  try {
    const { error } = await sb().from('snapshots').insert({
      academy_id: aid, snap_key: snapKey, label: label || '', data: data || {}
    });
    if (error) throw error;
  } catch (e) {
    console.error('sbAddSnapshot failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
async function sbDeleteSnapshot(snapKey) {
  const aid = acadId();
  try {
    const { error } = await sb().from('snapshots')
      .delete().eq('academy_id', aid).eq('snap_key', snapKey);
    if (error) throw error;
  } catch (e) {
    console.error('sbDeleteSnapshot failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}

// ---- APP USERS (app_users table) ----
async function sbUpsertUser(authUid, u) {
  const aid = acadId();
  if (!aid) return;
  try {
    const { error } = await sb().from('app_users').upsert({
      id: authUid,
      academy_id: aid,
      login_id: u.id || '',
      email: u.email || '',
      name: u.name || '',
      role: u.role || 'staff',
      assigned_batches: u.assignedBatches || [],
      assigned_sports: u.assignedSports || []
    });
    if (error) throw error;
  } catch (e) {
    console.error('sbUpsertUser failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
async function sbUpdateUserByLogin(loginId, fields) {
  const aid = acadId();
  if (!aid) return;
  try {
    const { error } = await sb().from('app_users')
      .update(fields).eq('academy_id', aid).eq('login_id', loginId);
    if (error) throw error;
  } catch (e) {
    console.error('sbUpdateUserByLogin failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}
async function sbDeleteUserByLogin(loginId) {
  const aid = acadId();
  try {
    const { error } = await sb().from('app_users')
      .delete().eq('academy_id', aid).eq('login_id', loginId);
    if (error) throw error;
  } catch (e) {
    console.error('sbDeleteUserByLogin failed:', e);
    showToast('Save to cloud failed: ' + e.message, 'error');
  }
}

// ---- FULL DB PUSH (used by restore-backup and Firebase→Supabase migration) ----
// Writes the entire in-memory DB up to Supabase. Students are inserted first to
// obtain their uuids, then attendance/fees are written using those uuids.
async function sbPushFullDB(opts) {
  const aid = acadId();
  if (!aid) { showToast('No academy id', 'error'); return false; }
  const log = (opts && opts.onProgress) || (() => {});
  try {
    // 1. Settings (academies row)
    log('Saving settings…');
    await sbSaveSettings();

    // 2. Sports — replace all
    log('Saving sports…');
    await sb().from('sports').delete().eq('academy_id', aid);
    if (DB.sports && DB.sports.length) {
      await sb().from('sports').insert(
        DB.sports.map((name, i) => ({ academy_id: aid, name, sort_order: i }))
      );
    }

    // 2b. Batches — replace all
    log('Saving batches…');
    await sb().from('batches').delete().eq('academy_id', aid);
    if (DB.batches && DB.batches.length) {
      await sb().from('batches').insert(
        DB.batches.map((name, i) => ({ academy_id: aid, name, sort_order: i }))
      );
    }

    // 3. Students — insert and build oldId -> newUuid map
    log('Saving students…');
    const idMap = {}; // old in-memory id -> new uuid
    if (DB.students && DB.students.length) {
      const rows = DB.students.map(s => _studentRow(s));
      const { data, error } = await sb().from('students').insert(rows).select();
      if (error) throw error;
      (data || []).forEach((row, i) => {
        const orig = DB.students[i];
        idMap[orig.id] = row.id;
        orig._sid = row.id; // keep for later
      });
    }

    // 4. Enrollments — which sport/batch each student is in (uses new student UUIDs)
    log('Saving enrollments…');
    await sb().from('enrollments').delete().eq('academy_id', aid);
    if (DB.enrollments && DB.enrollments.length) {
      const enrollRows = DB.enrollments.map(e => ({
        academy_id: aid,
        student_id: idMap[e.studentId] || e.studentId,
        sport: e.sport,
        batch: e.batch || '',
        join_date: _toDateOrNull(e.joinDate),
        active: e.active !== false
      })).filter(r => r.student_id);
      for (let i = 0; i < enrollRows.length; i += 500) {
        await sb().from('enrollments').insert(enrollRows.slice(i, i+500));
      }
    }

    // 4b. Attendance — flatten { date: { sport: { studentId: status } } }
    log('Saving attendance…');
    const attRows = [];
    Object.keys(DB.attendance || {}).forEach(date => {
      Object.keys(DB.attendance[date] || {}).forEach(sport => {
        Object.keys(DB.attendance[date][sport] || {}).forEach(oldSid => {
          const newSid = idMap[oldSid] || oldSid;
          attRows.push({ academy_id: aid, student_id: newSid, date, sport, status: DB.attendance[date][sport][oldSid] });
        });
      });
    });
    if (attRows.length) {
      // Insert in chunks of 500 to stay safe
      for (let i = 0; i < attRows.length; i += 500) {
        await sb().from('attendance').upsert(attRows.slice(i, i+500), { onConflict: 'student_id,sport,date' });
      }
    }

    // 5. Fees — flatten { month: { sport: { studentId: {...} } } }
    log('Saving fees…');
    const feeRows = [];
    Object.keys(DB.fees || {}).forEach(month => {
      Object.keys(DB.fees[month] || {}).forEach(sport => {
        Object.keys(DB.fees[month][sport] || {}).forEach(oldSid => {
          const f = DB.fees[month][sport][oldSid];
          const newSid = idMap[oldSid] || oldSid;
          feeRows.push({
            academy_id: aid, student_id: newSid, month, sport,
            status: f.status || '', amount: f.amount || null, method: f.method || '',
            paid_date: _toDateOrNull(f.date), collected_by: f.by || '', msg_sent: f.msgSent || []
          });
        });
      });
    });
    if (feeRows.length) {
      for (let i = 0; i < feeRows.length; i += 500) {
        await sb().from('fees').upsert(feeRows.slice(i, i+500), { onConflict: 'student_id,sport,month' });
      }
    }

    // 6. Enquiries
    log('Saving enquiries…');
    await sb().from('enquiries').delete().eq('academy_id', aid);
    if (DB.enquiries && DB.enquiries.length) {
      await sb().from('enquiries').insert(DB.enquiries.map(_enqRow));
    }

    // 7. Class log
    log('Saving class log…');
    await sb().from('class_log').delete().eq('academy_id', aid);
    if (DB.classLog && DB.classLog.length) {
      await sb().from('class_log').insert(DB.classLog.map(_classRow));
    }

    log('Done.');
    return true;
  } catch (e) {
    console.error('sbPushFullDB failed:', e);
    showToast('Full sync failed: ' + e.message, 'error');
    return false;
  }
}
// Helper: convert "DD/MM/YYYY" or similar display date to ISO date, or null
function _toDateOrNull(v) {
  if (!v) return null;
  // If already ISO (YYYY-MM-DD), keep it
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0,10);
  // Try DD/MM/YYYY or DD-MM-YYYY
  const m = String(v).match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  return null;
}

// ---- Legacy Firebase data-layer removed (app now uses Supabase) ----
// Kept as a harmless no-op because an old comment references it.
// Writes go directly to Supabase — no batch push needed.


function isModalOpen() {
  const inputModals = ['modalStudent','modalFee','modalUser','modalAddBatch','modalNote','modalImport','modalAttImport','modalFeeImport'];
  return inputModals.some(id => {
    const el = document.getElementById(id);
    return el && el.classList.contains('active');
  });
}



const PAGE_ORDER_NAV = ['home','students','attendance','fees','enquiry','activity','performance','schedules','profile'];
function getPageEl(n) { return document.getElementById('page' + n.charAt(0).toUpperCase() + n.slice(1)); }
function switchPage(name, noAnim) {
  const prevPage = currentPage;
  currentPage = name;

  const prevIdx = PAGE_ORDER_NAV.indexOf(prevPage);
  const nextIdx = PAGE_ORDER_NAV.indexOf(name);
  const goingRight = nextIdx > prevIdx;

  const prevEl = getPageEl(prevPage);
  const nextEl = getPageEl(name);

  // Prepare next page off-screen
  if (nextEl) {
    nextEl.style.transition = 'none';
    nextEl.style.transform = noAnim ? 'translateX(0)' : (goingRight ? 'translateX(100%)' : 'translateX(-100%)');
    nextEl.classList.add('active');
  }

  // Animate out current page
  if (prevEl && prevEl !== nextEl && !noAnim) {
    prevEl.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1)';
    prevEl.style.transform = goingRight ? 'translateX(-30%)' : 'translateX(100%)';
    prevEl.classList.add(goingRight ? 'slide-out-left' : 'slide-out-right');
  }

  // Animate in next page
  if (nextEl && !noAnim) {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        nextEl.style.transition = 'transform 0.3s cubic-bezier(0.4,0,0.2,1)';
        nextEl.style.transform = 'translateX(0)';
      });
    });
  } else if (nextEl) {
    nextEl.style.transform = 'translateX(0)';
  }

  // Clean up after animation
  setTimeout(() => {
    document.querySelectorAll('.page').forEach(p => {
      if (p !== nextEl) {
        p.classList.remove('active','slide-out-left','slide-out-right');
        p.style.transform = '';
        p.style.transition = '';
      }
    });
    if (nextEl) { nextEl.style.transition = ''; }
  }, 350);

  // Update nav highlight
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const navEl = document.getElementById('nav-' + name);
  if (navEl) navEl.classList.add('active');
  // Update tab dropdown active state
  document.querySelectorAll('.tab-drop-item').forEach(n => n.classList.remove('active'));
  const tnavEl = document.getElementById('tnav-' + name);
  if (tnavEl) tnavEl.classList.add('active');
  // (current page label removed from topbar)
  document.querySelectorAll('.drawer-item').forEach(n => n.classList.remove('active'));
  const dnavEl = document.getElementById('drawer-' + name);
  if (dnavEl) dnavEl.classList.add('active');

  if (name === 'home') loadDashboard();
  if (name === 'students') { renderBatchChips('student'); renderStudentList(); }
  if (name === 'attendance') { populateAttSportSelect(); renderAttendance(); }
  if (name === 'fees') { populateFeeSportSelect(); renderFees(); }
  if (name === 'enquiry') renderEnquiryList();
  // Plan gate — redirect to home if tab is locked for this plan
  const _plan    = (DB.settings && DB.settings.plan) || 'trial';
  const _isPro   = ['pro','premium','trial'].includes(_plan);
  const _isPrem  = ['premium','trial'].includes(_plan);
  const _proTabs = ['enquiry','activity','performance'];
  const _premTabs = ['schedules','leaveCount'];

  if (_proTabs.includes(name) && !_isPro) {
    showToast('Enquiry, Activity & Performance are available on Pro plan. Upgrade to unlock.', 'error');
    setTimeout(() => { if (typeof fzOpenPlans === 'function') fzOpenPlans(); }, 800);
    return;
  }
  if (_premTabs.includes(name) && !_isPrem) {
    showToast('Staff Schedules are available on Premium plan. Upgrade to unlock.', 'error');
    setTimeout(() => { if (typeof fzOpenPlans === 'function') fzOpenPlans(); }, 800);
    return;
  }

  if (name === 'activity') renderActivityPage();
  if (name === 'performance') renderPerformancePage();
  if (name === 'schedules') renderSchedulesPage();
  if (name === 'leaveCount') renderLeaveCountPage();
  if (name === 'profile') renderProfilePage();
}
function refreshCurrentPage() {
  // noAnim=true — we're re-rendering the SAME page after a background sync,
  // not navigating, so the slide transition must not play.
  if (currentUser && !isModalOpen()) switchPage(currentPage, true);
}

// ----------------------------------------------------------------
// SWIPE NAVIGATION — swipe the page content left/right to move
// between bottom-nav tabs (Home, Students, Attendance, Fees, Enquiry, Profile)
// ----------------------------------------------------------------
(function initSwipeNav() {
  const SWIPE_TABS = ['home', 'students', 'attendance', 'fees', 'enquiry', 'profile'];
  const viewport = document.querySelector('.pages-viewport');
  if (!viewport) return;

  let startX = 0, startY = 0, startTime = 0, tracking = false;

  function isInsideHScroll(el) {
    while (el && el !== viewport) {
      if (el.classList && el.classList.contains('table-wrap')) return true;
      const style = el.getAttribute && el.getAttribute('style');
      if (style && /overflow-x\s*:\s*(auto|scroll)/i.test(style)) return true;
      el = el.parentElement;
    }
    return false;
  }

  function visibleSwipeTabs() {
    return SWIPE_TABS.filter(name => {
      const btn = document.getElementById('nav-' + name);
      return btn && btn.offsetParent !== null;
    });
  }

  viewport.addEventListener('touchstart', (e) => {
    if ((typeof isModalOpen === 'function' && isModalOpen()) || e.touches.length !== 1 || isInsideHScroll(e.target)) {
      tracking = false;
      return;
    }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
    tracking = true;
  }, { passive: true });

  viewport.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = Date.now() - startTime;

    if (dt > 600 || Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.3) return;

    const tabs = visibleSwipeTabs();
    const idx = tabs.indexOf(currentPage);
    if (idx === -1) return;

    if (dx < 0 && idx < tabs.length - 1) switchPage(tabs[idx + 1]);
    else if (dx > 0 && idx > 0) switchPage(tabs[idx - 1]);
  }, { passive: true });
})();

// ----------------------------------------------------------------
// BATCH CHIPS (preserves selection)
// ----------------------------------------------------------------
function renderBatchChips(page) {
  const el = document.getElementById(page + 'BatchChips');
  if (!el) return;

  const staffBatches = getStaffBatches();

  // Determine which sport scopes this tab (attendance / fees), then limit batches to that sport
  let sportForPage = '';
  if (page === 'att') sportForPage = attCurrentSport();
  else if (page === 'fee') sportForPage = feeCurrentSport();
  let sportBatches = DB.batches;
  if (sportForPage) sportBatches = DB.batches.filter(b => (DB.batchSport && DB.batchSport[b]) === sportForPage);

  // Staff are restricted to their assigned batches, intersected with the sport's batches
  let restrictedBatches = staffBatches.length > 0
    ? staffBatches.filter(b => sportBatches.includes(b))
    : sportBatches;

  // Auto-lock selection to first available batch for staff
  if (staffBatches.length > 0 && selectedBatch[page] === 'ALL') {
    selectedBatch[page] = restrictedBatches[0] || 'ALL';
  }
  // If the current selection isn't in this sport's batches, reset to ALL
  if (selectedBatch[page] !== 'ALL' && selectedBatch[page] !== '__DROPPED__'
      && !restrictedBatches.includes(selectedBatch[page])) {
    selectedBatch[page] = 'ALL';
  }
  const cur = selectedBatch[page] || 'ALL';

  const activeStudents = getActiveStudents();
  const counts = {};
  DB.batches.forEach(b => counts[b] = activeStudents.filter(s => s.batch === b).length);

  let html = '';
  if (staffBatches.length === 0) {
    // Admin or unassigned staff — show All chip
    html += `<div class="batch-chip ${cur==='ALL'?'active':''}" onclick="selectBatch('${page}','ALL',this)">All (${activeStudents.length})</div>`;
  }
  restrictedBatches.forEach(b => {
    html += `<div class="batch-chip ${cur===b?'active':''}" onclick="selectBatch('${page}','${b}',this)">${escHtml(b)} (${counts[b]||0})</div>`;
  });
  if (page === 'student' && staffBatches.length === 0) {
    const droppedCount = getBannedStudents().length;
    html += `<div class="batch-chip ${cur==='__DROPPED__'?'active':''}" onclick="selectBatch('${page}','__DROPPED__',this)" style="${cur==='__DROPPED__'?'':'border-color:#ef444455;color:#f87171;'}">🚫 Dropped (${droppedCount})</div>`;
  }
  el.innerHTML = html;
}
function selectBatch(page, batch, el) {
  const staffBatches = getStaffBatches();
  // Block staff from switching to a batch they're not assigned to
  if (staffBatches.length > 0 && batch !== '__DROPPED__' && !staffBatches.includes(batch) && batch !== 'ALL') {
    showToast('You are not assigned to this batch', 'warn');
    return;
  }
  selectedBatch[page] = batch;
  el.closest('.batch-chips').querySelectorAll('.batch-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  if (page === 'student') renderStudentList();
  if (page === 'att') renderAttendance();
  if (page === 'fee') renderFees();
}

// ----------------------------------------------------------------
// STUDENTS
// ----------------------------------------------------------------
function getActiveStudents() {
  return DB.students
    .filter(s => !s.banned)
    .sort((a,b) => rollCmp(a,b) || a.name.localeCompare(b.name));
}
function getBannedStudents() {
  return DB.students
    .filter(s => s.banned)
    .sort((a,b) => a.name.localeCompare(b.name));
}
// Returns true if the student was already enrolled ON or BEFORE the given date.
// day=0 means "check the whole month" — student must have joined before end of that month.
// Returns true if the student was NOT yet dropped on the given date.
// A dropped student still appears for dates before their drop date.
function isActiveOnDate(student, year, month, day) {
  if (!student.banned) return true;
  if (!student.bannedOn) return false; // dropped but no date — hide everywhere
  const dropped = new Date(student.bannedOn);
  dropped.setHours(0,0,0,0);
  const checkD = new Date(year, month-1, day || daysInMonth(year, month));
  checkD.setHours(0,0,0,0);
  return checkD < dropped; // active only strictly before the drop date
}

function isEnrolledOnDate(student, year, month, day) {
  if (!student.joinDate) return true;
  const jd = parseDate(student.joinDate);
  if (!jd) return true;
  // Normalise jd to midnight
  jd.setHours(0,0,0,0);
  // For day=0 or undefined we check if joined anytime within/before the month
  const checkD = new Date(year, month-1, day || daysInMonth(year, month));
  checkD.setHours(0,0,0,0);
  return jd <= checkD;
}

// Returns true if the student was enrolled on or before the specific date key "YYYY-MM-DD"
function isEnrolledOnKey(student, dateKey) {
  const [y,m,d] = dateKey.split('-').map(Number);
  return isEnrolledOnDate(student, y, m, d);
}

// Get the student's join date as a "YYYY-MM-DD" string, or '0000-01-01' if none
function joinKey(student) {
  if (!student.joinDate) return '0000-01-01';
  const jd = parseDate(student.joinDate);
  if (!jd) return '0000-01-01';
  return `${jd.getFullYear()}-${pad(jd.getMonth()+1)}-${pad(jd.getDate())}`;
}

function dobAutoFormat(el) {
  // Strip everything except digits
  let raw = el.value.replace(/[^\d]/g, '');
  // Limit to 8 digits (DDMMYYYY)
  if (raw.length > 8) raw = raw.slice(0, 8);
  // Build formatted string with auto slashes
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (i === 2 || i === 4) out += '/';
    out += raw[i];
  }
  // Preserve cursor position
  const prevLen = el.value.length;
  el.value = out;
  calcAgeFromDob();
}
function dobKeyDown(e, el) {
  // Allow backspace to work naturally — strip slash too if needed
  if (e.key === 'Backspace') {
    const pos = el.selectionStart;
    if (pos > 0 && el.value[pos - 1] === '/') {
      e.preventDefault();
      el.value = el.value.slice(0, pos - 1) + el.value.slice(pos);
      el.setSelectionRange(pos - 1, pos - 1);
      calcAgeFromDob();
    }
  }
}

function calcAgeFromDob() {
  const dobVal = (document.getElementById('sDob')?.value || '').trim();
  const ageEl  = document.getElementById('sAge');
  const autoLbl = document.getElementById('sAgeAuto');
  if (!dobVal || dobVal.length < 8) {
    if (ageEl) { ageEl.value = ''; }
    if (autoLbl) autoLbl.textContent = '';
    return;
  }
  const d = parseDate(dobVal);
  if (!d) {
    if (autoLbl) { autoLbl.textContent = '(invalid date)'; autoLbl.style.color='#f87171'; }
    return;
  }
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const mDiff = today.getMonth() - d.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < d.getDate())) age--;
  if (d > today) {
    // Future DOB (not yet born or upcoming birthday this year)
    if (autoLbl) { autoLbl.textContent = '(future date)'; autoLbl.style.color='#f59e0b'; }
    if (ageEl) ageEl.value = '';
    return;
  }
  if (ageEl) ageEl.value = age;
  if (autoLbl) { autoLbl.textContent = '(auto)'; autoLbl.style.color='var(--gold)'; }
}

// Shared age-from-DOB calculation (same rules as calcAgeFromDob) for non-form contexts like bulk import.
// Accepts a DD/MM/YYYY (or ISO) date string; returns '' if blank, invalid, or a future date.
function ageFromDob(dobStr) {
  if (!dobStr) return '';
  const d = parseDate(dobStr);
  if (!d) return '';
  const today = new Date();
  if (d > today) return '';
  let age = today.getFullYear() - d.getFullYear();
  const mDiff = today.getMonth() - d.getMonth();
  if (mDiff < 0 || (mDiff === 0 && today.getDate() < d.getDate())) age--;
  return age >= 0 ? String(age) : '';
}

function openAddStudentModal(id=null) {
  editStudId = id;

  if (id) {
    const s = DB.students.find(x => x.id === id);
    if (!s) return;
    document.getElementById('modalStudentTitle').textContent = 'Edit Student';
    document.getElementById('sRollNo').value = s.rollNo || '';
    _rollAutoFilled = false;
    document.getElementById('sName').value = s.name || '';
    document.getElementById('sDob').value = s.dob || ''; calcAgeFromDob(); if (!s.dob && s.age) document.getElementById('sAge').value = s.age || '';
    document.getElementById('sParent').value = s.parent || '';
    document.getElementById('sContact').value = s.contact || '';
    document.getElementById('sContact2').value = s.contact2 || '';
    document.getElementById('sAddress').value = s.address || '';
    document.getElementById('sJoinDate').value = s.joinDate || '';
    // Load this student's existing enrollments into the working list
    _formEnrollments = (DB.enrollments || [])
      .filter(e => e.studentId === (s._sid || s.id))
      .map(e => ({ sport: e.sport, batch: e.batch || '', joinDate: e.joinDate || s.joinDate }));
  } else {
    document.getElementById('modalStudentTitle').textContent = 'Add Student';
    document.getElementById('sRollNo').value = ''; // filled in once a sport+batch is enrolled below
    document.getElementById('sAge').value = ''; document.getElementById('sDob').value = ''; document.getElementById('sAgeAuto').textContent = '';
    ['sName','sAge','sDob','sParent','sContact','sContact2','sAddress'].forEach(f => document.getElementById(f).value = '');
    document.getElementById('sJoinDate').value = todayDisplay();
    _formEnrollments = [];
    _rollAutoFilled = true;
    _convertingEnqId = null;
    const noteEl = document.getElementById('convertFromEnqNote');
    if (noteEl) noteEl.style.display = 'none';
  }
  populateEnrollPickers();
  renderEnrollRows();
  openModal('modalStudent');
}

// Fill the sport picker (and its batch picker) in the student form
function populateEnrollPickers() {
  const sportSel = document.getElementById('enrollSportPick');
  if (!sportSel) return;
  const sports = Array.isArray(DB.sports) ? DB.sports : [];
  sportSel.innerHTML = '<option value="">— Select Sport —</option>' +
    sports.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
  onEnrollSportPick();
  setEnrollPickersDisabled(_formEnrollments.length > 0);
}
// Gray out / lock the Sport & Batch pickers once an enrollment has been confirmed —
// the Remove (✕) button on the chip below is the only way back in to change it.
function setEnrollPickersDisabled(disabled) {
  ['enrollSportPick','enrollBatchPick'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = disabled;
    el.style.opacity = disabled ? '.55' : '1';
    el.style.cursor = disabled ? 'not-allowed' : '';
  });
}
// When a sport is picked, show only the batches that belong to that sport
function onEnrollSportPick() {
  const sport = document.getElementById('enrollSportPick')?.value || '';
  const batchSel = document.getElementById('enrollBatchPick');
  if (!batchSel) return;
  if (!sport) { batchSel.innerHTML = '<option value="">— Select Batch —</option>'; return; }
  const batchesForSport = DB.batches.filter(b => (DB.batchSport && DB.batchSport[b]) === sport);
  batchSel.innerHTML = batchesForSport.length
    ? '<option value="">— Select Batch —</option>' + batchesForSport.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('')
    : '<option value="">— No batches in this sport —</option>';
}
// Fires once both Sport and Batch are picked — pops up a confirmation before actually
// enrolling the student, so a wrong pick can be backed out with one tap instead of added.
function onEnrollBatchPick() {
  const sport = document.getElementById('enrollSportPick')?.value || '';
  const batch = document.getElementById('enrollBatchPick')?.value || '';
  if (!sport || !batch) return;
  if (_formEnrollments.some(e => e.sport === sport)) {
    showToast('Already enrolled in '+sport, 'error');
    document.getElementById('enrollBatchPick').value = '';
    return;
  }
  confirm_('🏆', 'Confirm Enrollment', `Enroll student in ${sport} — ${batch} batch?`, () => {
    _formEnrollments.push({ sport, batch, joinDate: document.getElementById('sJoinDate').value.trim() });
    renderEnrollRows();
    suggestRollFromEnrollments();
    setEnrollPickersDisabled(true);
    showToast(`Enrolled: ${sport} · ${batch}`, 'success');
  }, '✅ Confirm', '↩️ Remove');
  // Reset the batch picker right away — if Confirm is tapped the pick is already captured
  // above; if Remove/cancel is tapped, this resets it as if nothing was ever selected.
  document.getElementById('enrollBatchPick').value = '';
}
function removeEnrollRow(i) {
  _formEnrollments.splice(i, 1);
  renderEnrollRows();
  suggestRollFromEnrollments();
  setEnrollPickersDisabled(_formEnrollments.length > 0);
  if (!_formEnrollments.length) {
    document.getElementById('enrollSportPick').value = '';
    onEnrollSportPick();
  }
}
// Fill Roll Number with the next SportLetter+BatchLetter+sequence code, based on the
// student's first sport enrollment. Only touches the field if it still holds our
// own previous suggestion (or is empty) — never overwrites something the user typed.
function suggestRollFromEnrollments() {
  if (editStudId) return; // never auto-touch roll numbers while editing an existing student
  const rollEl = document.getElementById('sRollNo');
  if (!rollEl) return;
  const current = rollEl.value.trim();
  if (current && !_rollAutoFilled) return; // user has typed their own value — leave it alone
  const first = _formEnrollments[0];
  const suggestion = first ? nextRollForSportBatch(first.sport, first.batch) : '';
  rollEl.value = suggestion;
  _rollAutoFilled = true;
}
function renderEnrollRows() {
  const wrap = document.getElementById('enrollRows');
  if (!wrap) return;
  if (!_formEnrollments.length) {
    wrap.innerHTML = `<div style="font-size:11px;color:var(--gray);padding:4px 0;">No sports added yet.</div>`;
    return;
  }
  wrap.innerHTML = _formEnrollments.map((e,i) => `
    <div style="display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 10px;margin-bottom:5px;">
      <span style="flex:1;font-size:12px;"><b>🏆 ${escHtml(e.sport)}</b>${e.batch?` · ${escHtml(e.batch)}`:' · <span style="color:var(--gray);">no batch</span>'}</span>
      <button type="button" class="btn btn-danger btn-xs" onclick="removeEnrollRow(${i})">✕</button>
    </div>`).join('');
}
// ── Plan-based feature limits ────────────────────────────────────
// Returns log retention in days per plan
function planLogRetentionDays() {
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  return { basic:90, pro:180, premium:270, trial:270, frozen:90 }[plan] || 90;
}
function planLogCutoff() {
  const d = new Date();
  d.setDate(d.getDate() - planLogRetentionDays());
  return d.toISOString();
}
function planLogRetentionLabel() {
  return Math.round(planLogRetentionDays()/30) + ' months';
}

function planStudentLimit() {
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  const limits = {basic:50, pro:250, premium:null, trial:null, frozen:0};
  return plan in limits ? limits[plan] : 50;
}
function planStaffLimit() {
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  return {basic:2, pro:4, premium:20, trial:20, frozen:0}[plan] ?? 2;
}
function planSportLimit() {
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  return {basic:2, pro:10, premium:20, trial:20, frozen:0}[plan] ?? 2;
}
function planBatchLimit() {
  // Total batch limit = sports × batches per sport
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  return {basic:4, pro:100, premium:400, trial:400, frozen:0}[plan] ?? 4;
}
// Batches per sport limit
function planBatchesPerSport() {
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  return {basic:2, pro:10, premium:20, trial:20, frozen:0}[plan] ?? 2;
}
function planDisplayName() {
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  return {basic:'Basic',pro:'Pro',premium:'Premium',trial:'Trial',frozen:'Frozen'}[plan] || 'Basic';
}
function showPlanLimitToast(feature, limit, upgrade) {
  showToast(`${planDisplayName()} plan limit reached: ${limit} ${feature}. Upgrade to ${upgrade} for more.`, 'error');
}

function saveStudent() {
  const name = document.getElementById('sName').value.trim();
  if (!name) { showToast('Name is required','error'); return; }
  // Sport is mandatory — student must have at least one enrollment
  if (!_formEnrollments.length) { showToast('Please add at least one Sport for this student','error'); return; }

  // ── Plan student limit check ──────────────────────────────────
  if (!editStudId) {
    const limit = planStudentLimit();
    if (limit !== null) {
      const active = (DB.students||[]).filter(s=>!s.banned&&!s.archived).length;
      if (active >= limit) {
        const nextPlan = limit<=50 ? 'Pro (250 students)' : 'Premium (unlimited)';
        showPlanLimitToast('students', limit, nextPlan);
        setTimeout(()=>{ if(typeof fzOpenPlans==='function') fzOpenPlans(); }, 1000);
        return;
      }
    }
  }

  // Batch is mandatory — every enrollment row must have a batch selected
  const missingBatch = _formEnrollments.find(e => !e.batch);
  if (missingBatch) { showToast(`Please select a Batch for ${missingBatch.sport}`,'error'); return; }
  const joinDate = document.getElementById('sJoinDate').value.trim() || todayDisplay();
  const action = editStudId ? 'Update' : 'Add';
  confirm_('💾', action + ' Student', `${action} "${name}"?`, () => {
    const rollNo = document.getElementById('sRollNo').value.trim().toUpperCase() || undefined;
    // Check uniqueness — skip check for the student being edited
    if (rollNo) {
      const duplicate = DB.students.find(s => String(s.rollNo||'').toUpperCase() === rollNo && s.id !== editStudId);
      if (duplicate) { showToast(`Roll number ${rollNo} already assigned to ${duplicate.name}`, 'error'); return; }
    }
    const data = {
      name,
      rollNo,
      age: document.getElementById('sAge').value.trim(),
      dob: document.getElementById('sDob').value.trim(),
      parent: document.getElementById('sParent').value.trim(),
      contact: document.getElementById('sContact').value.trim(),
      contact2: document.getElementById('sContact2').value.trim(),
      address: document.getElementById('sAddress').value.trim(),
      joinDate,
      batch: _formEnrollments[0].batch
    };
    // Snapshot the working enrollment list for this save
    const enrollSnapshot = _formEnrollments.map(e => ({ sport: e.sport, batch: e.batch, joinDate: e.joinDate || joinDate }));
    if (editStudId) {
      const idx = DB.students.findIndex(s => s.id === editStudId);
      // Use the form's rollNo (user may have edited it); uniqueness already checked above
      if (idx >= 0) {
        DB.students[idx] = { ...DB.students[idx], ...data };
        sbUpdateStudent(DB.students[idx]._sid, DB.students[idx]);
        const sid = DB.students[idx]._sid;
        // Sync enrollments to cloud, then refresh in-memory list
        sbSyncEnrollments(sid, enrollSnapshot).then(() => {
          DB.enrollments = (DB.enrollments || []).filter(e => e.studentId !== sid)
            .concat(enrollSnapshot.map(e => ({ id: null, studentId: sid, sport: e.sport, batch: e.batch, joinDate: e.joinDate, active: true })));
        });
      }
      addLog('student_edit', `Edited "${name}"`);
    } else {
      const newStud = { id: 'S' + Date.now(), banned: false, ...data };
      DB.students.push(newStud);
      addLog('student_add', `Added "${name}"`);
      // Insert into Supabase and capture the real uuid for future edits
      sbInsertStudent(newStud).then(row => {
        if (row) {
          const idx = DB.students.findIndex(s => s.id === newStud.id);
          if (idx >= 0) { DB.students[idx]._sid = row.id; DB.students[idx].id = row.id; }
          // Now that we have the real uuid, write enrollments
          sbSyncEnrollments(row.id, enrollSnapshot).then(() => {
            DB.enrollments = (DB.enrollments || []).filter(e => e.studentId !== row.id)
              .concat(enrollSnapshot.map(e => ({ id: null, studentId: row.id, sport: e.sport, batch: e.batch, joinDate: e.joinDate, active: true })));
          });
        }
      });
      // If converted from an enquiry, remove the enquiry entry
      if (_convertingEnqId) {
        const enqToDel = _convertingEnqId;
        DB.enquiries = (DB.enquiries||[]).filter(q => q.id !== enqToDel);
        sbDeleteEnquiry(enqToDel);
        addLog('enquiry', `Converted query to student: "${name}"`);
        _convertingEnqId = null;
        const noteEl = document.getElementById('convertFromEnqNote');
        if (noteEl) noteEl.style.display = 'none';
      }
    }
    closeModal('modalStudent');
    renderStudentList();
    if (currentPage === 'home') loadDashboard();
    showToast('Saved ✓','success');
  });
}
function deleteStudent(id) {
  const s = DB.students.find(x => x.id === id);
  confirm_('🗑️','Delete Student',`Permanently delete "${s?.name}"? All attendance & fee data for this student will remain but be orphaned.`, () => {
    const sid = s?._sid;
    DB.students = DB.students.filter(x => x.id !== id);
    addLog('student_delete', `Deleted "${s?.name}"`);
    if (sid) sbDeleteStudent(sid);
    renderStudentList();
    loadDashboard();
    showToast('Deleted','success');
  });
}
function banStudent(id) {
  const s = DB.students.find(x => x.id === id);
  confirm_('🚫','Mark as Dropout',`Mark "${s?.name}" as dropout? They will be hidden from attendance and fee lists.`, () => {
    s.banned = true; s.bannedOn = new Date().toISOString();
    addLog('student_ban', `Marked dropout: "${s?.name}"`);
    if (s._sid) sbUpdateStudent(s._sid, s);
    renderStudentList(); loadDashboard();
    showToast('Marked as dropout','warn');
  });
}
function unbanStudent(id) {
  const s = DB.students.find(x => x.id === id);
  confirm_('✅','Restore Student',`Restore "${s?.name}" to active list?`, () => {
    s.banned = false; delete s.bannedOn;
    addLog('student_unban', `Restored: "${s?.name}"`);
    if (s._sid) sbUpdateStudent(s._sid, s);
    renderStudentList();
    showToast('Restored ✓','success');
  });
}

// ----------------------------------------------------------------
// IMPORT STUDENTS
// ----------------------------------------------------------------
let importRows = [];
let importRejected = [];

function openImportModal() {
  importRows = [];
  importRejected = [];
  document.getElementById('importError').style.display = 'none';
  document.getElementById('importFileInput').value = '';
  openModal('modalImport');
}

// Roll number format: first letter of Sport + first letter of Batch + 2-digit sequence
// e.g. Silambam + Morning -> "SM01", "SM02", ...
function rollPrefix(sport, batch) {
  const s = String(sport||'').trim();
  const b = String(batch||'').trim();
  if (!s || !b) return '';
  return (s[0] + b[0]).toUpperCase();
}
// Next available roll code for a given sport+batch. excludeId lets edits ignore
// the student's own current roll when recomputing (so editing doesn't self-collide).
function nextRollForSportBatch(sport, batch, excludeId, list) {
  const prefix = rollPrefix(sport, batch);
  if (!prefix) return '';
  let maxNum = 0;
  (list || DB.students || []).forEach(s => {
    if (excludeId && s.id === excludeId) return;
    const rn = String(s.rollNo || '').toUpperCase();
    if (rn.startsWith(prefix)) {
      const n = parseInt(rn.slice(prefix.length), 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
  });
  const next = maxNum + 1;
  return prefix + String(next).padStart(next >= 100 ? 3 : 2, '0');
}

// Download a ready-to-fill Excel template for importing students
function downloadImportTemplate() {
  try {
    const headers = ['Name','RollNo','Sport','Batch','DOB','Parent','Contact','Contact2','School','JoinDate'];
    const today = todayDisplay();
    // Generic examples (delete before importing). Leave RollNo blank to auto-generate
    // from Sport + Batch (e.g. Silambam + Morning -> SM01, SM02, ...).
    const example1 = ['Arjun Kumar', '',  'Sport A', 'Batch 1', '15/06/2013', 'Ramesh Kumar', '9876543210', '', 'ABC School', today];
    const example2 = ['Divya Sharma', '', 'Sport A', 'Batch 1', '22/03/2015', 'Suresh Sharma','9123456780','9123456781','XYZ School', today];

    const wb = XLSX.utils.book_new();

    // Sheet 1: Students (headers + 2 examples)
    const ws = XLSX.utils.aoa_to_sheet([headers, example1, example2]);
    ws['!cols'] = [{wch:18},{wch:8},{wch:12},{wch:12},{wch:12},{wch:16},{wch:13},{wch:13},{wch:16},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws, 'Students');

    // Sheet 2: Instructions
    const instr = [
      ['HOW TO USE THIS TEMPLATE'],
      [''],
      ['1. Fill one row per student in the "Students" sheet.'],
      ['2. DELETE the two example rows before importing.'],
      ['3. "Name", "Sport" and "Batch" are required for every student.'],
      [''],
      ['COLUMN GUIDE'],
      ['Name', 'Required. Full name of the student.'],
      ['RollNo', 'Leave blank to auto-generate from Sport + Batch, e.g. Silambam + Morning -> SM01, SM02, ...'],
      ['', 'Or type your own — it just needs to be unique.'],
      ['Sport', 'REQUIRED. The sport the student is enrolled in (must match a sport in the app). Rows without it are skipped.'],
      ['Batch', 'REQUIRED. The batch the student belongs to (must match a batch in the app). Rows without it are skipped.'],
      ['DOB', 'Date of birth in DD/MM/YYYY format. Age is calculated automatically from this — no separate Age column needed.'],
      ['Parent', 'Parent / guardian name.'],
      ['Contact', 'Primary phone number.'],
      ['Contact2', 'Alternate phone number (optional).'],
      ['School', 'School / college name (optional).'],
      ['JoinDate', 'Joining date in DD/MM/YYYY. Blank = today.'],
      [''],
      ['NOTE ON ROLL NUMBERS'],
      ['Roll numbers must stay unique across the whole academy.'],
      ['Format: first letter of Sport + first letter of Batch + sequence number.'],
      ['Re-importing a student with the same Name + Contact is skipped (no duplicates).'],
    ];
    const wsI = XLSX.utils.aoa_to_sheet(instr);
    wsI['!cols'] = [{wch:14},{wch:64}];
    XLSX.utils.book_append_sheet(wb, wsI, 'Instructions');

    XLSX.writeFile(wb, 'Student_Import_Template.xlsx');
    showToast('Template downloaded ✓', 'success');
  } catch (e) {
    console.error('Template download failed:', e);
    showToast('Could not generate template: ' + e.message, 'error');
  }
}

function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  const errEl = document.getElementById('importError');
  errEl.style.display = 'none';

  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    const reader = new FileReader();
    reader.onload = ev => parseImportCSV(ev.target.result);
    reader.readAsText(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_csv(ws);
        parseImportCSV(data);
      } catch(err) { showImportError('Could not read Excel file: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    showImportError('Please choose a .csv, .xlsx or .xls file.');
  }
}

// Parse a single CSV line, handling quoted fields
function parseCSVLine(line) {
  const cols = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; }
    else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  cols.push(cur.trim());
  return cols;
}

function normHeader(s) {
  return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
}

const HEADER_MAP = {
  'name':'name','studentname':'name','fullname':'name',
  'rollno':'rollNo','roll':'rollNo','rollnumber':'rollNo','rollno.':'rollNo','sno':'rollNo','sno.':'rollNo','no':'rollNo',
  'batch':'batch','batchname':'batch','group':'batch','class':'batch',
  'sport':'sport','sportname':'sport','game':'sport','discipline':'sport',
  'age':'age',
  'dob':'dob','dateofbirth':'dob','birthdate':'dob','birthday':'dob',
  'parent':'parent','parentname':'parent','guardian':'parent','guardianname':'parent',
  'contact':'contact','contact1':'contact','phone':'contact','mobile':'contact','phonenumber':'contact',
  'contact2':'contact2','phone2':'contact2','altcontact':'contact2','alternatecontact':'contact2',
  'school':'address','schoolname':'address','college':'address','address':'address',
  'joindate':'joinDate','joiningdate':'joinDate','joined':'joinDate','dateofjoining':'joinDate',
};

function excelDateToDisplay(val) {
  if (!val) return '';
  const s = String(val).trim();
  // Excel serial number
  if (/^\d{4,5}$/.test(s)) {
    const d = new Date(Math.round((parseFloat(s) - 25569) * 86400 * 1000));
    if (!isNaN(d)) return pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear();
  }
  // ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const p = s.split('-');
    return p[2].slice(0,2)+'/'+p[1]+'/'+p[0];
  }
  return s; // already DD/MM/YYYY or other — keep as-is
}

function parseImportCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { showImportError('File must have a header row and at least one data row.'); return; }

  const headerCols = parseCSVLine(lines[0]);
  const colMap = {};
  headerCols.forEach((h, i) => {
    const key = HEADER_MAP[normHeader(h)];
    if (key && !(key in colMap)) colMap[key] = i;
  });

  if (colMap['name'] === undefined) {
    showImportError('Could not find a "Name" column. Make sure your first row has column headers.');
    return;
  }

  const todayFmt = todayDisplay();
  importRejected = [];
  importRows = [];

  lines.slice(1).forEach((line, li) => {
    const cols = parseCSVLine(line);
    const get = key => colMap[key] !== undefined ? (cols[colMap[key]] || '').trim() : '';
    const name = get('name');
    if (!name) return; // fully blank row — nothing to report
    const rowLabel = name;

    // Case-insensitive batch match: find existing batch by name — Batch is mandatory, no fallback
    const rawBatch = get('batch');
    if (!rawBatch) { importRejected.push({ label: rowLabel, reason: 'Missing Batch.' }); return; }
    const matchedBatch = DB.batches.find(b => b.toLowerCase() === rawBatch.toLowerCase()) || rawBatch;
    // Sport: explicit column, else infer from the batch's mapped sport — Sport is mandatory, no fallback
    const rawSport = get('sport');
    const matchedSport = rawSport
      ? ((DB.sports||[]).find(sp => sp.toLowerCase() === rawSport.toLowerCase()) || rawSport)
      : ((DB.batchSport && DB.batchSport[matchedBatch]) || '');
    if (!matchedSport) { importRejected.push({ label: rowLabel, reason: 'Missing Sport (and batch has no default sport mapping).' }); return; }

    const rollRaw = get('rollNo');
    const dobVal = excelDateToDisplay(get('dob'));
    importRows.push({
      name,
      rollNo:   rollRaw ? rollRaw.toUpperCase() : '',
      batch:    matchedBatch,
      sport:    matchedSport,
      age:      ageFromDob(dobVal),
      dob:      dobVal,
      parent:   get('parent'),
      contact:  get('contact'),
      contact2: get('contact2'),
      address:  get('address'),
      joinDate: excelDateToDisplay(get('joinDate')) || todayFmt,
    });
  });

  // Match each valid row against an existing student (same Name + Contact) to decide
  // whether it's a fresh Insert or an Update to an already-existing record.
  importRows.forEach(r => {
    r._match = DB.students.find(s => {
      if (s.name.toLowerCase() !== r.name.toLowerCase()) return false;
      if (!s.dob || !r.dob || s.dob !== r.dob) return false;
      if (!s.parent || !r.parent || s.parent.toLowerCase() !== r.parent.toLowerCase()) return false;
      const importNums = [r.contact, r.contact2].filter(Boolean);
      const existingNums = [s.contact, s.contact2].filter(Boolean);
      return importNums.some(n => existingNums.includes(n));
    }) || null;
  });

  // Auto-generate the roll number for INSERT rows only, so the review screen shows the
  // real roll code before confirming — not a blank. Update rows keep the student's
  // existing roll unless the sheet explicitly gives a different, non-clashing one.
  // Simulated against a temp copy of DB.students so numbering stays sequential across
  // this file without touching the real DB until the user confirms.
  const previewStudents = (DB.students || []).slice();
  importRows.forEach(r => {
    if (r._match) return;
    let roll = r.rollNo || '';
    if (roll && previewStudents.some(s => String(s.rollNo||'').toUpperCase() === roll)) roll = ''; // clashes with existing — regenerate
    if (!roll) roll = nextRollForSportBatch(r.sport, r.batch, null, previewStudents) || '';
    r.rollNo = roll;
    previewStudents.push({ rollNo: roll });
  });

  // Classify matched rows as an Update (something actually differs) or a Skip (no real change).
  const FIELDS_TO_COMPARE = ['rollNo','batch','sport','contact','contact2','address'];
  importRows.forEach(r => {
    if (!r._match) { r._action = 'insert'; r._diffs = []; return; }
    const m = r._match;
    const msid = m._sid || m.id;
    const existingVals = {
      rollNo: m.rollNo||'', batch: m.batch||'', sport: studentSingleSport(msid) || '',
      contact: m.contact||'', contact2: m.contact2||'', address: m.address||''
    };
    const diffs = [];
    FIELDS_TO_COMPARE.forEach(f => {
      const newVal = r[f] || '';
      if (newVal && newVal !== existingVals[f]) diffs.push({ field: f, from: existingVals[f], to: newVal });
    });
    r._diffs = diffs;
    r._action = diffs.length ? 'update' : 'skip';
  });

  if (importRejected.length) console.warn('Student import rejected rows:', importRejected);
  if (!importRows.length && !importRejected.length) { showImportError('No data rows found in file.'); return; }
  if (!importRows.length) {
    showImportError('No valid rows found. ' + (importRejected[0] ? importRejected[0].label + ': ' + importRejected[0].reason : ''));
    return;
  }

  openImportReview();
}

function showImportError(msg) {
  const el = document.getElementById('importError');
  el.textContent = '⚠️ ' + msg;
  el.style.display = '';
}

const IMPORT_RES_TAB_META = {
  insert: { title: 'New Students — will be Inserted',      empty: 'No new students to insert.' },
  update: { title: 'Existing Students — will be Updated',  empty: 'No existing students will be updated.' },
  skip:   { title: 'Skipped — No Changes',                 empty: 'Nothing was skipped.' },
  reject: { title: 'Rejected Rows',                         empty: 'Nothing was rejected.' },
};
const IMPORT_FIELD_LABELS = { rollNo:'Roll No', batch:'Batch', sport:'Sport', contact:'Contact', contact2:'Contact 2', address:'Address' };
let _importResultActiveTab = 'insert';

function openImportReview() {
  const inserts = importRows.filter(r => r._action === 'insert');
  const updates = importRows.filter(r => r._action === 'update');
  const skips   = importRows.filter(r => r._action === 'skip');

  document.getElementById('importResCount-insert').textContent = inserts.length;
  document.getElementById('importResCount-update').textContent = updates.length;
  document.getElementById('importResCount-skip').textContent   = skips.length;
  document.getElementById('importResCount-reject').textContent = importRejected.length;

  const submitBtn = document.getElementById('importSubmitBtn');
  const total = inserts.length + updates.length;
  submitBtn.textContent = total ? `✅ Confirm & Apply (${total})` : '✅ Confirm & Apply';
  submitBtn.disabled = !total;
  submitBtn.style.opacity = total ? '1' : '.5';

  document.getElementById('importError').style.display = 'none';
  document.getElementById('importFileInput').value = '';
  closeModal('modalImport');
  openModal('modalImportResults');
  showImportResultList(importRejected.length ? 'reject' : (inserts.length ? 'insert' : (updates.length ? 'update' : 'skip')));
}

function showImportResultList(tab) {
  _importResultActiveTab = tab;
  Object.keys(IMPORT_RES_TAB_META).forEach(t => {
    const btn = document.getElementById('importResTabBtn-' + t);
    if (btn) btn.classList.toggle('active', t === tab);
  });

  const meta = IMPORT_RES_TAB_META[tab];
  const list = tab === 'reject' ? importRejected : importRows.filter(r => r._action === tab);
  document.getElementById('importResultListLabel').textContent = `${meta.title} (${list.length})`;

  const body = document.getElementById('importResultListBody');
  if (!list.length) {
    body.innerHTML = `<div style="padding:16px;text-align:center;color:var(--gray);font-size:12px;">${meta.empty}</div>`;
    return;
  }

  if (tab === 'reject') {
    body.innerHTML = list.map((r, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--border);font-size:12px;">
        <span style="width:22px;height:22px;border-radius:50%;background:#f8717130;color:#f87171;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i+1}</span>
        <div style="flex:1;">
          <div style="font-weight:700;">${escHtml(r.label)}</div>
          <div style="color:#f87171;">${escHtml(r.reason)}</div>
        </div>
      </div>`).join('');
    return;
  }

  body.innerHTML = list.map((r, i) => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border);font-size:12px;">
      <span style="width:22px;height:22px;border-radius:50%;background:var(--accent);color:var(--gold);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">${i+1}</span>
      <div style="flex:1;">
        <div style="font-weight:700;">${escHtml(r.rollNo ? (r.rollNo + ' · ') : '')}${escHtml(r.name)}</div>
        <div style="color:var(--gray);margin-bottom:4px;">${[r.sport, r.batch, r.contact, r.joinDate].filter(Boolean).map(escHtml).join(' · ')}</div>
        ${tab === 'update' ? `<div style="display:flex;flex-wrap:wrap;gap:5px;">${r._diffs.map(d => `<span style="padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;background:var(--accent);color:var(--gold);">${IMPORT_FIELD_LABELS[d.field]||d.field}: ${escHtml(d.from||'—')} → ${escHtml(d.to)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`).join('');
}

// ── Submit: user has reviewed the categorized lists, now actually apply ──
function submitImportAll() {
  const inserts = importRows.filter(r => r._action === 'insert');
  const updates = importRows.filter(r => r._action === 'update');
  const total = inserts.length + updates.length;
  if (!total) return;

  confirm_('⬆️', 'Apply Student Import',
    `This will add ${inserts.length} new student(s) and update ${updates.length} existing student's details. Continue?`,
    () => {
      const newOnes = [];
      const newSports = []; // parallel array: sport for each newOnes entry
      const updatedOnes = [];

      inserts.forEach(r => {
        const stud = {
          id: 'st_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
          name: r.name, rollNo: r.rollNo, batch: r.batch, age: r.age, dob: r.dob,
          parent: r.parent, contact: r.contact, contact2: r.contact2,
          address: r.address, joinDate: r.joinDate || todayDisplay(),
          banned: false
        };
        DB.students.push(stud);
        newOnes.push(stud);
        newSports.push(r.sport || '');
      });

      updates.forEach(r => {
        const m = r._match;
        let sportChange = '';
        r._diffs.forEach(d => {
          if (d.field === 'sport') sportChange = d.to;
          else m[d.field] = d.to;
        });
        updatedOnes.push({ student: m, sport: sportChange, batch: r.batch, joinDate: r.joinDate });
        const msid = m._sid || m.id;
        if (msid && !String(msid).startsWith('st_')) sbUpdateStudent(msid, m);
      });

      // Bulk insert new students to Supabase, then create one enrollment per student for its sport
      sbBulkInsertStudents(newOnes).then(() => {
        newOnes.forEach((stud, i) => {
          const sport = newSports[i];
          const sid = stud._sid || stud.id;
          if (sport && sid && !String(sid).startsWith('st_')) {
            const enroll = [{ sport, batch: stud.batch, joinDate: stud.joinDate }];
            sbSyncEnrollments(sid, enroll).then(() => {
              DB.enrollments = (DB.enrollments || [])
                .filter(e => e.studentId !== sid)
                .concat({ id: null, studentId: sid, sport, batch: stud.batch, joinDate: stud.joinDate, active: true });
              renderStudentList();
            });
          }
        });
      });

      // For updated students whose Sport or Batch changed, refresh their enrollment too
      updatedOnes.forEach(u => {
        const sid = u.student._sid || u.student.id;
        if (u.sport && sid && !String(sid).startsWith('st_')) {
          const enroll = [{ sport: u.sport, batch: u.batch, joinDate: u.joinDate || u.student.joinDate }];
          sbSyncEnrollments(sid, enroll).then(() => {
            DB.enrollments = (DB.enrollments || [])
              .filter(e => e.studentId !== sid)
              .concat({ id: null, studentId: sid, sport: u.sport, batch: u.batch, joinDate: u.joinDate || u.student.joinDate, active: true });
            renderStudentList();
          });
        }
      });

      addLog('student_import', `Imported students: ${inserts.length} inserted, ${updates.length} updated`);
      closeModal('modalImportResults');
      renderStudentList();
      renderBatchChips('student');
      showToast(`Imported: ${inserts.length} added, ${updates.length} updated`, 'success');
    }
  );
}

// =====================================================================
// ATTENDANCE BULK IMPORT
// =====================================================================
let attImportRows = [];
let attImportRejected = [];      // [{ label, reason }] — invalid rows found while parsing
let attImportFutureSkipped = []; // [{ student, sid, dateKey, displayDate, sport, batch, attemptedStatus }] — valid rows but date is in the future
let _attImportResults = { inserted: [], updated: [], rejected: [], skipped: [] };
let _attResultActiveTab = 'inserted';

function openAttImportModal() {
  attImportRows = [];
  attImportRejected = [];
  attImportFutureSkipped = [];
  document.getElementById('attImportError').style.display = 'none';
  document.getElementById('attImportFileInput').value = '';
  openModal('modalAttImport');
}

function downloadAttImportTemplate() {
  try {
    const fmtDate = d => pad(d.getDate())+'/'+pad(d.getMonth()+1)+'/'+d.getFullYear();
    const d1 = new Date();
    const d2 = new Date(d1.getTime() + 86400000);
    const date1 = fmtDate(d1), date2 = fmtDate(d2);

    const headers = ['Name','RollNo','Sport','Batch', date1, date2];
    const sp = (DB.sports && DB.sports[0]) || 'Sport A';
    const s1 = DB.students[0] || {};
    const s2 = DB.students[1] || {};
    const batch1 = s1.batch || (DB.batches && DB.batches[0]) || 'Morning';
    const batch2 = s2.batch || (DB.batches && DB.batches[1]) || 'Evening';
    const ex1 = [s1.name||'Arjun Kumar',  s1.rollNo||'SM01',  s1.sport||sp, batch1, 'P', 'A'];
    const ex2 = [s2.name||'Divya Sharma', s2.rollNo||'SM02',  s2.sport||sp, batch2, 'A', 'P'];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ex1, ex2]);
    ws['!cols'] = [{wch:20},{wch:8},{wch:14},{wch:12},{wch:12},{wch:12}];
    XLSX.utils.book_append_sheet(wb, ws, 'Attendance');

    const instr = [
      ['HOW TO USE THIS TEMPLATE'],[''],
      ['1. Fill one row per student in the "Attendance" sheet.'],
      ['2. Add one column per date you want to mark — the column header must be DD/MM/YYYY.'],
      ['3. Fill each date column with P (Present) or A (Absent). Leave a cell blank to skip that student for that date.'],
      ['4. DELETE the two example rows before importing.'],
      ['5. Name or RollNo is required to find the student. Batch must exactly match the student\'s batch in the app, or the row is skipped.'],[''],
      ['COLUMN GUIDE'],
      ['Name',    'Full name of the student (used to look up in the app).'],
      ['RollNo',  'Roll number. Used as fallback if Name is blank.'],
      ['Sport',   'Sport name (must match a sport in the app).'],
      ['Batch',   'Must exactly match the student\'s batch in the app.'],
      ['DD/MM/YYYY columns', 'One per date. P = Present, A = Absent, blank = skip.'],
    ];
    const wsI = XLSX.utils.aoa_to_sheet(instr);
    wsI['!cols'] = [{wch:18},{wch:60}];
    XLSX.utils.book_append_sheet(wb, wsI, 'Instructions');

    XLSX.writeFile(wb, 'Attendance_Import_Template.xlsx');
    showToast('Template downloaded ✓', 'success');
  } catch(e) {
    showToast('Could not generate template: ' + e.message, 'error');
  }
}

function showAttImportError(msg) {
  const el = document.getElementById('attImportError');
  el.textContent = '⚠️ ' + msg;
  el.style.display = '';
}

function handleAttImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('attImportError').style.display = 'none';
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    const reader = new FileReader();
    reader.onload = ev => {
      try { parseAttImportCSV(ev.target.result); }
      catch(err) { showAttImportError('Could not read CSV file: ' + err.message); }
    };
    reader.onerror = () => showAttImportError('Could not read the file.');
    reader.readAsText(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        parseAttImportCSV(XLSX.utils.sheet_to_csv(ws));
      } catch(err) { showAttImportError('Could not read Excel file: ' + err.message); }
    };
    reader.onerror = () => showAttImportError('Could not read the file.');
    reader.readAsArrayBuffer(file);
  } else {
    showAttImportError('Please choose a .csv, .xlsx or .xls file.');
  }
}

const ATT_IMPORT_HEADER_MAP = {
  'name':'name','studentname':'name','fullname':'name',
  'rollno':'rollNo','roll':'rollNo','rollnumber':'rollNo','no':'rollNo','sno':'rollNo',
  'sport':'sport','game':'sport','discipline':'sport',
  'batch':'batch','batchname':'batch','group':'batch','class':'batch',
};

function parseAttImportCSV(text) {
  try {
    _parseAttImportCSVInner(text);
  } catch(err) {
    console.error('Attendance import parse error:', err);
    showAttImportError('Something went wrong reading this file: ' + err.message);
  }
}

function _parseAttImportCSVInner(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { showAttImportError('File must have a header row and at least one data row.'); return; }

  const headerCols = parseCSVLine(lines[0]);
  const colMap = {};     // fixed field name -> column index
  const dateCols = [];   // { idx, dateKey, displayDate } — every non-fixed column that parses as a date

  headerCols.forEach((h, i) => {
    const key = ATT_IMPORT_HEADER_MAP[normHeader(h)];
    if (key) {
      if (!(key in colMap)) colMap[key] = i;
      return;
    }
    // Not a recognized fixed column — see if the header itself is a date (DD/MM/YYYY, ISO, or Excel serial)
    const disp = excelDateToDisplay(h);
    const m = disp.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const dateKey = `${m[3]}-${pad(parseInt(m[2]))}-${pad(parseInt(m[1]))}`;
      dateCols.push({ idx: i, dateKey, displayDate: disp });
    }
  });

  if (colMap['name'] === undefined && colMap['rollNo'] === undefined) {
    showAttImportError('Could not find a "Name" or "RollNo" column.'); return;
  }
  if (colMap['batch'] === undefined) { showAttImportError('Could not find a "Batch" column.'); return; }
  if (!dateCols.length) { showAttImportError('Could not find any date columns. Date column headers must be in DD/MM/YYYY format.'); return; }

  const todayKey = todayStr();
  attImportRows = [];
  attImportRejected = [];
  attImportFutureSkipped = [];

  lines.slice(1).forEach((line, li) => {
    const cols = parseCSVLine(line);
    const get = key => colMap[key] !== undefined ? (cols[colMap[key]] || '').trim() : '';
    const rawName = get('name');
    const rawRoll = get('rollNo');
    const rawSport = get('sport');
    const rawBatch = get('batch');
    const rowLabel = rawName || (rawRoll ? `Roll ${rawRoll}` : `Row ${li+2}`);

    // Resolve sport — always normalize to the exact casing used in DB.sports.
    // Done BEFORE student resolution so we can disambiguate same-name students across sports.
    const resolvedSportRaw = rawSport
      ? ((DB.sports||[]).find(sp => sp.toLowerCase() === rawSport.toLowerCase().trim()) || rawSport.trim())
      : '';

    // Resolve student
    let student = null;
    if (rawRoll) {
      student = DB.students.find(s => String(s.rollNo||'').toUpperCase() === rawRoll.toUpperCase());
    }
    if (!student && rawName) {
      const nameMatches = DB.students.filter(s => s.name.toLowerCase() === rawName.toLowerCase());
      if (nameMatches.length > 1 && resolvedSportRaw) {
        // Multiple students share this name — use the Sport column to pick the right one
        student = nameMatches.find(s => {
          const sid2 = s._sid || s.id;
          return (DB.enrollments||[]).some(e => e.studentId === sid2 && e.sport && e.sport.toLowerCase() === resolvedSportRaw.toLowerCase());
        }) || null;
        if (!student) { attImportRejected.push({ label: rowLabel, reason: `Matches ${nameMatches.length} students but none enrolled in "${resolvedSportRaw}" — add RollNo to be precise.` }); return; }
      } else if (nameMatches.length > 1) {
        attImportRejected.push({ label: rowLabel, reason: `Matches ${nameMatches.length} students — add a Sport or RollNo column to disambiguate.` });
        return;
      } else {
        student = nameMatches[0] || null;
      }
    }
    if (!student) { attImportRejected.push({ label: rowLabel, reason: 'Student not found.' }); return; }

    // Final sport for this row: prefer the resolved sport column; else fall back to student's single sport
    const sid = student._sid || student.id;
    const sport = resolvedSportRaw || (studentSingleSport(sid) || (DB.sports&&DB.sports[0]) || '');

    // Validate Batch against the student's actual batch (their enrollment for this sport, else their profile batch)
    const enroll = (DB.enrollments||[]).find(e => e.studentId === sid && e.sport && e.sport.toLowerCase() === sport.toLowerCase());
    const actualBatch = (enroll && enroll.batch) || student.batch || '';
    if (!rawBatch) { attImportRejected.push({ label: student.name, reason: 'Batch is required.' }); return; }
    if (!actualBatch || actualBatch.toLowerCase() !== rawBatch.toLowerCase()) {
      attImportRejected.push({ label: student.name, reason: `Batch "${rawBatch}" doesn't match their actual batch${actualBatch?` ("${actualBatch}")`:''}.` });
      return;
    }

    // Walk every date column and create one attendance record per filled-in cell
    dateCols.forEach(dc => {
      const rawCell = (cols[dc.idx] || '').trim();
      if (!rawCell) return; // blank cell — no attempt for this student on this date

      // Never apply attendance for future dates — track separately instead
      if (dc.dateKey > todayKey) {
        attImportFutureSkipped.push({ student, sid, dateKey: dc.dateKey, displayDate: dc.displayDate, sport, batch: actualBatch, attemptedStatus: rawCell.toUpperCase() });
        return;
      }

      const rawStatus = rawCell.toUpperCase();
      const status = rawStatus === 'P' || rawStatus === 'PRESENT' ? 'P'
                   : rawStatus === 'A' || rawStatus === 'ABSENT'  ? 'A' : null;
      if (!status) { attImportRejected.push({ label: student.name, reason: `${dc.displayDate}: Status "${rawCell}" must be P or A.` }); return; }
      attImportRows.push({ student, sid, dateKey: dc.dateKey, status, sport, batch: actualBatch, displayDate: dc.displayDate });
    });
  });

  if (attImportRejected.length) console.warn('Attendance import warnings:', attImportRejected);
  if (!attImportRows.length && !attImportFutureSkipped.length) {
    showAttImportError('No valid rows found. ' + (attImportRejected[0] ? attImportRejected[0].label + ': ' + attImportRejected[0].reason : ''));
    return;
  }
  if (!attImportRows.length) {
    showAttImportError(`All ${attImportFutureSkipped.length} entr${attImportFutureSkipped.length===1?'y':'ies'} found are for future dates and will not be applied. Nothing to import.`);
    return;
  }

  // Classify every valid row as a fresh insert or an update to an existing mark
  // (read-only check — nothing is written to DB yet).
  attImportRows.forEach(r => {
    const existing = attGet(r.dateKey, r.sid, r.sport);
    r.isNew = existing === undefined;
    r.prevStatus = existing;
  });

  document.getElementById('attImportError').style.display = 'none';
  document.getElementById('attImportFileInput').value = ''; // allow re-choosing the same file later
  closeModal('modalAttImport');
  openAttImportReview();
}

// Group flat per-date rows into one entry per student, with all their dates/statuses attached.
function _groupAttRowsByStudent(rows) {
  const map = new Map();
  rows.forEach(r => {
    const key = r.sid + '|' + r.sport;
    if (!map.has(key)) {
      map.set(key, { student: r.student, sid: r.sid, sport: r.sport, batch: r.batch, entries: [] });
    }
    map.get(key).entries.push({ displayDate: r.displayDate, dateKey: r.dateKey, value: r.status, prevStatus: r.prevStatus });
  });
  return Array.from(map.values()).sort((a, b) => a.student.name.localeCompare(b.student.name));
}

// ── Review & Submit modal (shown BEFORE anything is written to attendance) ──
function openAttImportReview() {
  const insertRows = attImportRows.filter(r => r.isNew);
  const updateRows = attImportRows.filter(r => !r.isNew);

  _attImportResults = {
    inserted: _groupAttRowsByStudent(insertRows),
    updated:  _groupAttRowsByStudent(updateRows),
    rejected: attImportRejected.slice(),
    skipped:  _groupAttRowsByStudent(attImportFutureSkipped.map(r => ({ ...r, status: r.attemptedStatus })))
  };

  document.getElementById('attResCount-inserted').textContent = insertRows.length;
  document.getElementById('attResCount-updated').textContent  = updateRows.length;
  document.getElementById('attResCount-rejected').textContent = attImportRejected.length;
  document.getElementById('attResCount-skipped').textContent  = attImportFutureSkipped.length;

  const submitBtn = document.getElementById('attSubmitBtn');
  const total = insertRows.length + updateRows.length;
  submitBtn.textContent = total ? `✅ Submit & Apply (${total})` : '✅ Submit & Apply';
  submitBtn.disabled = !total;
  submitBtn.style.opacity = total ? '1' : '.5';

  openModal('modalAttImportResults');
  // Default to the most useful tab: rejected first if any exist, else new records
  const defaultTab = attImportRejected.length ? 'rejected' : 'inserted';
  showAttResultList(defaultTab);
}

const ATT_RES_TAB_META = {
  inserted: { title: 'New Records — will be Inserted', empty: 'No new records to insert.' },
  updated:  { title: 'Existing Records — will be Updated', empty: 'No existing records will be updated.' },
  rejected: { title: 'Rejected Rows',          empty: 'Nothing was rejected.' },
  skipped:  { title: 'Skipped — Future Dates', empty: 'No future-dated entries were found.' },
};

function showAttResultList(tab) {
  _attResultActiveTab = tab;
  Object.keys(ATT_RES_TAB_META).forEach(t => {
    const btn = document.getElementById('attResTabBtn-' + t);
    if (!btn) return;
    btn.classList.toggle('active', t === tab);
  });

  const meta = ATT_RES_TAB_META[tab];
  const list = _attImportResults[tab] || [];
  document.getElementById('attResultListLabel').textContent = `${meta.title} (${list.length})`;

  const body = document.getElementById('attResultListBody');
  if (!list.length) {
    body.innerHTML = `<div style="padding:16px;text-align:center;color:var(--gray);font-size:12px;">${meta.empty}</div>`;
    return;
  }

  if (tab === 'rejected') {
    body.innerHTML = list.map((r, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--border);font-size:12px;">
        <span style="width:22px;height:22px;border-radius:50%;background:#f8717130;color:#f87171;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i+1}</span>
        <div style="flex:1;">
          <div style="font-weight:700;">${escHtml(r.label)}</div>
          <div style="color:#f87171;">${escHtml(r.reason)}</div>
        </div>
      </div>`).join('');
    return;
  }

  // inserted / updated / skipped — one row per student, with a chip per date
  const futureNote = tab === 'skipped' ? ' <span style="color:var(--gold);">— future date, not applied</span>' : '';
  body.innerHTML = list.map((r, i) => `
    <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border);font-size:12px;">
      <span style="width:22px;height:22px;border-radius:50%;background:var(--accent);color:var(--gold);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;">${i+1}</span>
      <div style="flex:1;">
        <div style="font-weight:700;">${escHtml(r.student.rollNo != null ? (r.student.rollNo + ' · ') : '')}${escHtml(r.student.name)}</div>
        <div style="color:var(--gray);margin-bottom:4px;">${escHtml(r.sport)} · ${escHtml(r.batch)}${futureNote}</div>
        <div style="display:flex;flex-wrap:wrap;gap:5px;">
          ${r.entries.map(e => `<span style="padding:2px 7px;border-radius:10px;font-size:11px;font-weight:600;background:${e.value==='P'?'#16a34a30':'#dc262630'};color:${e.value==='P'?'var(--green)':'var(--red)'};">${escHtml(e.displayDate)}: ${e.value==='P'?'Present':'Absent'}${tab==='updated' ? ` (was ${e.prevStatus==='P'?'Present':e.prevStatus==='A'?'Absent':'unmarked'})` : ''}</span>`).join('')}
        </div>
      </div>
    </div>`).join('');
}

// ── Submit: user has reviewed the categorized lists, now actually apply ──
function submitAttImport() {
  const insertRows = attImportRows.filter(r => r.isNew);
  const updateRows = attImportRows.filter(r => !r.isNew);
  const total = insertRows.length + updateRows.length;
  if (!total) return;

  confirm_('⬆️', 'Apply Attendance Import',
    `This will mark attendance for ${insertRows.length} new record(s) and update ${updateRows.length} existing record(s). This cannot be easily undone. Continue?`,
    () => {
      const markedBy = currentUser ? (currentUser.name || currentUser.id) : '';
      const inserted = [], updated = [];

      attImportRows.forEach(r => {
        if (r.isNew) inserted.push(r); else updated.push(r);
        attSet(r.dateKey, r.sid, r.status, r.sport);
        sbSetAttendance(r.sid, r.dateKey, r.status, markedBy, r.sport);
      });

      addLog('attendance_import', `Bulk imported attendance: ${inserted.length} inserted, ${updated.length} updated, ${attImportRejected.length} rejected, ${attImportFutureSkipped.length} skipped (future date)`);
      closeModal('modalAttImportResults');

      // Jump the Attendance screen to the most recent applied date + that record's sport
      // so the marks are immediately visible (screen only shows one date/sport at a time).
      const applied = inserted.concat(updated);
      if (applied.length) {
        const latest = applied.reduce((a, b) => (a.dateKey > b.dateKey ? a : b));
        const [ly, lm, ld] = latest.dateKey.split('-').map(Number);
        const yEl = document.getElementById('attYear');
        const mEl = document.getElementById('attMonth');
        const dEl = document.getElementById('attDate');
        const vEl = document.getElementById('attViewType');
        if (yEl) yEl.value = ly;
        if (mEl) mEl.value = lm;
        if (dEl) dEl.value = ld;
        if (vEl) vEl.value = 'day';
        if (latest.sport && (DB.sports||[]).includes(latest.sport)) {
          _attSport = latest.sport;
          const sportSel = document.getElementById('attSportSelect');
          if (sportSel) sportSel.value = latest.sport;
        }
        renderAttendance();
      }

      showToast(`Imported: ${inserted.length} inserted, ${updated.length} updated`, 'success');
    }
  );
}

// =====================================================================
// FEE BULK IMPORT
// =====================================================================
let feeImportRows = [];

function openFeeImportModal() {
  feeImportRows = [];
  document.getElementById('feeImportPreview').style.display = 'none';
  document.getElementById('feeImportError').style.display = 'none';
  document.getElementById('feeImportFileInput').value = '';
  openModal('modalFeeImport');
}

function downloadFeeImportTemplate() {
  try {
    const headers = ['Name','RollNo','Sport','Month','Status','Amount','Method','PaidDate'];
    const sp = (DB.sports && DB.sports[0]) || 'Sport A';
    const s1 = DB.students[0] || {};
    const s2 = DB.students[1] || {};
    const thisMonth = (()=>{ const n=new Date(); return n.getFullYear()+'-'+pad(n.getMonth()+1); })();
    const ex1 = [s1.name||'Arjun Kumar',  s1.rollNo||'SM01', s1.sport||sp, thisMonth, 'paid',   1500, 'Cash', todayDisplay()];
    const ex2 = [s2.name||'Divya Sharma', s2.rollNo||'SM02', s2.sport||sp, thisMonth, 'unpaid', '',   '',     ''];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ex1, ex2]);
    ws['!cols'] = [{wch:20},{wch:8},{wch:14},{wch:10},{wch:8},{wch:8},{wch:10},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, 'Fees');

    const instr = [
      ['HOW TO USE THIS TEMPLATE'],[''],
      ['1. Fill one row per student per month in the "Fees" sheet.'],
      ['2. DELETE the two example rows before importing.'],
      ['3. Name or RollNo is required to find the student.'],[''],
      ['COLUMN GUIDE'],
      ['Name',     'Full name of the student.'],
      ['RollNo',   'Roll number — used as fallback if Name is blank.'],
      ['Sport',    'Sport name (must match a sport in the app).'],
      ['Month',    'YYYY-MM format — e.g. 2025-06'],
      ['Status',   'paid   or   unpaid'],
      ['Amount',   'Fee amount as a number — e.g. 1500. Leave blank to keep existing.'],
      ['Method',   'Cash / UPI / Card / Cheque / Online etc.'],
      ['PaidDate', 'DD/MM/YYYY — date payment was received. Optional.'],
    ];
    const wsI = XLSX.utils.aoa_to_sheet(instr);
    wsI['!cols'] = [{wch:12},{wch:60}];
    XLSX.utils.book_append_sheet(wb, wsI, 'Instructions');

    XLSX.writeFile(wb, 'Fee_Import_Template.xlsx');
    showToast('Template downloaded ✓', 'success');
  } catch(e) {
    showToast('Could not generate template: ' + e.message, 'error');
  }
}

function showFeeImportError(msg) {
  const el = document.getElementById('feeImportError');
  el.textContent = '⚠️ ' + msg;
  el.style.display = '';
  document.getElementById('feeImportPreview').style.display = 'none';
}

function handleFeeImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('feeImportError').style.display = 'none';
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    const reader = new FileReader();
    reader.onload = ev => parseFeeImportCSV(ev.target.result);
    reader.readAsText(file);
  } else if (ext === 'xlsx' || ext === 'xls') {
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        parseFeeImportCSV(XLSX.utils.sheet_to_csv(ws));
      } catch(err) { showFeeImportError('Could not read Excel file: ' + err.message); }
    };
    reader.readAsArrayBuffer(file);
  } else {
    showFeeImportError('Please choose a .csv, .xlsx or .xls file.');
  }
}

const FEE_IMPORT_HEADER_MAP = {
  'name':'name','studentname':'name','fullname':'name',
  'rollno':'rollNo','roll':'rollNo','rollnumber':'rollNo','no':'rollNo','sno':'rollNo',
  'sport':'sport','game':'sport',
  'month':'month','feemonth':'month','period':'month',
  'status':'status','feestatus':'status','paymentstatus':'status',
  'amount':'amount','feeamount':'amount','fees':'amount',
  'method':'method','paymentmethod':'method','mode':'method','paymentmode':'method',
  'paiddate':'paidDate','datepaid':'paidDate','paymentdate':'paidDate','date':'paidDate',
};

function parseFeeImportCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) { showFeeImportError('File must have a header row and at least one data row.'); return; }

  const headerCols = parseCSVLine(lines[0]);
  const colMap = {};
  headerCols.forEach((h, i) => {
    const key = FEE_IMPORT_HEADER_MAP[normHeader(h)];
    if (key && !(key in colMap)) colMap[key] = i;
  });

  if (colMap['month'] === undefined) { showFeeImportError('Could not find a "Month" column (format: YYYY-MM).'); return; }
  if (colMap['status'] === undefined) { showFeeImportError('Could not find a "Status" column (paid/unpaid).'); return; }
  if (colMap['name'] === undefined && colMap['rollNo'] === undefined) {
    showFeeImportError('Could not find a "Name" or "RollNo" column.'); return;
  }

  const errors = [];
  feeImportRows = lines.slice(1).map((line, li) => {
    const cols = parseCSVLine(line);
    const get = key => colMap[key] !== undefined ? (cols[colMap[key]] || '').trim() : '';
    const rawName   = get('name');
    const rawRoll   = get('rollNo');
    const rawMonth  = get('month').trim();   // YYYY-MM
    const rawStatus = get('status').toLowerCase();
    const rawAmount = get('amount');
    const rawMethod = get('method');
    const rawPaid   = excelDateToDisplay(get('paidDate'));
    const rawSport  = get('sport');

    // Validate month YYYY-MM
    if (!/^\d{4}-\d{2}$/.test(rawMonth)) {
      errors.push(`Row ${li+2}: Invalid month "${rawMonth}" — use YYYY-MM format. Skipped.`); return null;
    }

    // Resolve student
    let student = null;
    if (rawRoll) student = DB.students.find(s => String(s.rollNo||'').toUpperCase() === rawRoll.toUpperCase());
    if (!student && rawName) student = DB.students.find(s => s.name.toLowerCase() === rawName.toLowerCase());
    if (!student) { errors.push(`Row ${li+2}: Student "${rawName||rawRoll}" not found — skipped.`); return null; }

    const status = (rawStatus === 'paid') ? 'paid' : (rawStatus === 'unpaid') ? 'unpaid' : null;
    if (!status) { errors.push(`Row ${li+2}: Status "${get('status')}" must be "paid" or "unpaid" — skipped.`); return null; }

    const sid = student._sid || student.id;
    let sport = rawSport
      ? ((DB.sports||[]).find(sp => sp.toLowerCase() === rawSport.toLowerCase()) || rawSport)
      : (studentSingleSport(sid) || (DB.sports&&DB.sports[0]) || '');

    // Parse paidDate DD/MM/YYYY → ISO
    let paidDateIso = '';
    if (rawPaid) {
      const dp = rawPaid.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dp) paidDateIso = `${dp[3]}-${pad(parseInt(dp[2]))}-${pad(parseInt(dp[1]))}T00:00:00.000Z`;
    }

    const feeObj = {
      status,
      amount: rawAmount ? (parseFloat(rawAmount) || null) : null,
      method: rawMethod || '',
      date: paidDateIso || (status === 'paid' ? new Date().toISOString() : ''),
      by: currentUser ? (currentUser.name || currentUser.id) : '',
      msgSent: []
    };

    return { student, sid, monthKey: rawMonth, sport, feeObj, displayMonth: rawMonth };
  }).filter(Boolean);

  if (errors.length) console.warn('Fee import warnings:', errors);
  if (!feeImportRows.length) { showFeeImportError('No valid rows found. ' + (errors[0]||'')); return; }

  document.getElementById('feeImportPreviewLabel').textContent =
    feeImportRows.length + ' record' + (feeImportRows.length !== 1 ? 's' : '') + ' ready to import' +
    (errors.length ? ` (${errors.length} skipped)` : '') + ':';
  document.getElementById('feeImportPreviewList').innerHTML = feeImportRows.map((r, i) =>
    `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--border);font-size:12px;">
      <span style="width:22px;height:22px;border-radius:50%;background:var(--accent);color:var(--gold);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${i+1}</span>
      <div style="flex:1;">
        <div style="font-weight:700;">${escHtml(r.student.name)}</div>
        <div style="color:var(--gray);">${escHtml(r.displayMonth)} · ${escHtml(r.sport)} · <span style="color:${r.feeObj.status==='paid'?'var(--green)':'var(--red)'};">${r.feeObj.status}</span>${r.feeObj.amount?' · ₹'+r.feeObj.amount:''}</div>
      </div>
    </div>`
  ).join('');
  document.getElementById('feeImportPreview').style.display = '';
  document.getElementById('feeImportError').style.display = 'none';
}

function confirmFeeImport() {
  if (!feeImportRows.length) return;
  confirm_('⬆️', 'Import Fees', `Import ${feeImportRows.length} fee record(s)?`, () => {
    feeImportRows.forEach(r => {
      feeSet(r.monthKey, r.sid, r.feeObj, r.sport);
      sbSetFee(r.sid, r.monthKey, r.feeObj, r.sport);
    });
    addLog('fee_import', `Bulk imported ${feeImportRows.length} fee record(s)`);
    closeModal('modalFeeImport');
    renderFees();
    showToast(feeImportRows.length + ' fee record(s) imported ✓', 'success');
  });
}

function downloadStudents(fmt) {
  const search      = (document.getElementById('studentSearch')?.value || '').toLowerCase().trim();
  const filterBatch = document.getElementById('filterStudentBatch')?.value || '';
  const filterSport = document.getElementById('studentSportFilter')?.value || '';
  const sortBy      = document.getElementById('studentSortBy')?.value || 'roll';
  const chipBatch   = selectedBatch.student;

  let actives = getActiveStudents();
  let banned  = getBannedStudents();

  // Chip filter (Dropped view)
  if (chipBatch === '__DROPPED__') {
    actives = [];
  } else if (chipBatch !== 'ALL') {
    actives = actives.filter(s => s.batch === chipBatch);
    banned  = banned.filter(s => s.batch === chipBatch);
  }
  // Sport filter
  if (filterSport) {
    const sportSids = new Set((DB.enrollments||[]).filter(e => e.sport === filterSport).map(e => e.studentId));
    const f = s => sportSids.has(s._sid || s.id);
    actives = actives.filter(f); banned = banned.filter(f);
  }
  // Batch dropdown filter
  if (filterBatch) {
    actives = actives.filter(s => (s.batch||'') === filterBatch);
    banned  = banned.filter(s => (s.batch||'') === filterBatch);
  }
  // Search (name OR roll, also contact/parent)
  if (search) {
    const f = s => s.name.toLowerCase().includes(search)
      || String(s.rollNo||'').toLowerCase().includes(search)
      || (s.contact||'').includes(search)
      || (s.parent||'').toLowerCase().includes(search);
    actives = actives.filter(f);
    banned  = banned.filter(f);
  }

  // Sort to match the screen
  const sorter = makeSorter(sortBy);
  actives.sort(sorter);
  banned.sort(sorter);

  const todayKey = todayStr();
  const todayAtt = attDayMap(todayKey);

  const headers = ['#','Name','Batch','Age','DOB','Parent/Guardian','Contact 1','Contact 2','School','Joined','Today'];

  const toRow = (s, idx) => {
    const att = todayAtt[s.id];
    const todayLabel = att==='P' ? 'Present' : att==='A' ? 'Absent' : '—';
    return [idx+1, s.name, s.batch||'', (s.dob ? (ageFromDob(s.dob) || s.age) : s.age) || '', s.dob||'', s.parent||'',
            s.contact||'', s.contact2||'', s.address||'', s.joinDate||'', todayLabel];
  };

  const activeRows = actives.map(toRow);
  const bannedRows = banned.map(toRow);

  const acad = DB.settings.academyName || 'Academy';
  const dateStr = new Date().toLocaleDateString();

  if (fmt === 'pdf') {
    // ── PDF: two sections with separator ──
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape' });

    // Header
    doc.setFontSize(14); doc.setTextColor(30,58,138);
    doc.text(acad, 14, 13);
    doc.setFontSize(10); doc.setTextColor(100,116,139);
    doc.text('Student List  •  ' + dateStr, 14, 20);

    // ── ACTIVE STUDENTS ──
    doc.setFontSize(11); doc.setTextColor(34,197,94);
    doc.text(`Active Students (${actives.length})`, 14, 29);

    doc.autoTable({
      head: [headers],
      body: activeRows.length ? activeRows : [['—','No active students','','','','','','','','','']],
      startY: 33,
      styles: { fontSize: 7.5, cellPadding: 2.5 },
      headStyles: { fillColor: [30,58,138], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [240,245,255] },
      margin: { left: 14, right: 14 }
    });

    // ── BLOCKED / DROPOUT STUDENTS ──
    const afterActive = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(11); doc.setTextColor(239,68,68);
    doc.text(`Blocked / Dropout Students (${banned.length})`, 14, afterActive);

    doc.autoTable({
      head: [headers],
      body: bannedRows.length ? bannedRows : [['—','No blocked students','','','','','','','','','']],
      startY: afterActive + 4,
      styles: { fontSize: 7.5, cellPadding: 2.5 },
      headStyles: { fillColor: [127,29,29], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [255,240,240] },
      margin: { left: 14, right: 14 }
    });

    doc.save(`Students_${acad.replace(/\s+/g,'_')}_${dateStr.replace(/\//g,'-')}.pdf`);
    showToast('PDF downloaded ✓', 'success');

  } else {
    // ── XL: two sheets — Active and Blocked ──
    const wb = XLSX.utils.book_new();

    // Active sheet
    const wsActive = XLSX.utils.aoa_to_sheet([
      [acad + ' — Active Students', '', '', '', '', '', '', '', '', '', ''],
      ['Generated: ' + dateStr],
      [],
      headers,
      ...activeRows
    ]);
    // Style header row width hints
    wsActive['!cols'] = [4,24,12,5,12,18,14,14,28,12,10].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, wsActive, 'Active Students');

    // Blocked sheet
    const wsBlocked = XLSX.utils.aoa_to_sheet([
      [acad + ' — Blocked / Dropout Students', '', '', '', '', '', '', '', '', '', ''],
      ['Generated: ' + dateStr],
      [],
      headers,
      ...bannedRows
    ]);
    wsBlocked['!cols'] = [4,24,12,5,12,18,14,14,28,12,10].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, wsBlocked, 'Blocked Students');

    XLSX.writeFile(wb, `Students_${acad.replace(/\s+/g,'_')}_${dateStr.replace(/\//g,'-')}.xlsx`);
    showToast('Excel downloaded ✓', 'success');
  }
}

// ── Collapsible student filter ────────────────────────────────────
function toggleStudentFilter() {
  const body    = document.getElementById('studentFilterBody');
  const chevron = document.getElementById('studentFilterChevron');
  const btn     = document.getElementById('studentFilterToggleBtn');
  if (!body) return;
  const open = body.style.display === 'block';
  body.style.display = open ? 'none' : 'block';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
  if (btn) btn.style.borderRadius = open ? '10px' : '10px 10px 0 0';
}
function updateStudentFilterIndicator() {
  const n = (document.getElementById('filterStudentName')?.value || '').trim();
  const b = document.getElementById('filterStudentBatch')?.value || '';
  const s = (document.getElementById('filterStudentSchool')?.value || '').trim();
  const dot = document.getElementById('studentFilterActiveIndicator');
  if (dot) dot.style.display = (n || b || s) ? 'inline-block' : 'none';
}
function toggleAttFilter() {
  const body    = document.getElementById('attFilterBody');
  const chevron = document.getElementById('attFilterChevron');
  const btn     = document.getElementById('attFilterToggleBtn');
  if (!body) return;
  const open = body.style.display === 'block';
  body.style.display = open ? 'none' : 'block';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
  if (btn) btn.style.borderRadius = open ? '10px' : '10px 10px 0 0';
}
function updateAttFilterIndicator() {
  const n = (document.getElementById('attSearch')?.value || '').trim();
  const s = document.getElementById('attStatusFilter')?.value || 'all';
  const dot = document.getElementById('attFilterActiveIndicator');
  if (dot) dot.style.display = (n || s !== 'all') ? 'inline-block' : 'none';
}
function clearAttFilters() {
  const si = document.getElementById('attSearch');
  const sf = document.getElementById('attStatusFilter');
  if (si) si.value = '';
  if (sf) sf.value = 'all';
  updateAttFilterIndicator();
  renderAttendance();
}

// ── Att display selects bridge ────────────────────────────────────
function syncAttDisplaySelects() {
  const ySel = document.getElementById('attYear');
  const mSel = document.getElementById('attMonth');
  const yDisp = document.getElementById('attYearDisplay');
  const mDisp = document.getElementById('attMonthDisplay');
  if (!ySel || !mSel || !yDisp || !mDisp) return;
  // Sync year display
  yDisp.innerHTML = '';
  Array.from(ySel.options).forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = o.value;
    if (o.selected) opt.selected = true;
    yDisp.appendChild(opt);
  });
  // Sync month display (short names)
  mDisp.innerHTML = '';
  Array.from(mSel.options).forEach(o => {
    const opt = document.createElement('option');
    opt.value = o.value; opt.textContent = MONTHS[parseInt(o.value)-1]?.substring(0,3) || o.value;
    if (o.selected) opt.selected = true;
    mDisp.appendChild(opt);
  });
}
function onAttMonthDisplayChange() {
  const v = document.getElementById('attMonthDisplay')?.value;
  const mSel = document.getElementById('attMonth');
  if (mSel && v) mSel.value = v;
  onAttFilterChange();
}
function onAttYearDisplayChange() {
  const v = document.getElementById('attYearDisplay')?.value;
  const ySel = document.getElementById('attYear');
  if (ySel && v) { Array.from(ySel.options).forEach(o => o.selected = o.value === v); }
  onAttFilterChange();
}

// ── Attendance view toggle (Day / Month / Year) ───────────────────
function setAttView(view) {
  const sel = document.getElementById('attViewType');
  if (sel) sel.value = view;
  ['Day','Month','Year'].forEach(v => {
    const btn = document.getElementById('attView' + v);
    if (!btn) return;
    const active = view.toLowerCase() === v.toLowerCase();
    btn.style.background  = active ? 'var(--accent2)' : 'var(--card2)';
    btn.style.color       = active ? '#fff' : 'var(--offwhite)';
    btn.style.borderColor = active ? 'var(--accent2)' : 'var(--border)';
  });
  const badge = document.getElementById('attViewBadge');
  if (badge) badge.textContent = view.charAt(0).toUpperCase() + view.slice(1);
  renderAttendance();
}

// ── Fee display selects bridge ────────────────────────────────────
function syncFeeDisplaySelects() {
  const mSel = document.getElementById('feeMonth');
  const ySel = document.getElementById('feeYear');
  const yoSel = document.getElementById('feeYearOnly');
  const mDisp = document.getElementById('feeMonthDisplay');
  const yDisp = document.getElementById('feeYearDisplay');
  const yoDisp = document.getElementById('feeYearOnlyDisplay');
  if (mSel && mDisp) {
    mDisp.innerHTML = '';
    Array.from(mSel.options).forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = MONTHS[parseInt(o.value)-1]?.substring(0,3) || o.value;
      if (o.selected) opt.selected = true;
      mDisp.appendChild(opt);
    });
  }
  if (ySel && yDisp) {
    yDisp.innerHTML = '';
    Array.from(ySel.options).forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.value;
      if (o.selected) opt.selected = true;
      yDisp.appendChild(opt);
    });
  }
  if (yoSel && yoDisp) {
    yoDisp.innerHTML = '';
    Array.from(yoSel.options).forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.value; opt.textContent = o.value;
      if (o.selected) opt.selected = true;
      yoDisp.appendChild(opt);
    });
  }
}
function onFeeMonthDisplayChange() {
  const v = document.getElementById('feeMonthDisplay')?.value;
  const mSel = document.getElementById('feeMonth');
  if (mSel && v) mSel.value = v;
  renderFees();
}
function onFeeYearDisplayChange() {
  const v = document.getElementById('feeYearDisplay')?.value;
  const ySel = document.getElementById('feeYear');
  if (ySel && v) { Array.from(ySel.options).forEach(o => o.selected = o.value === v); }
  renderFees();
}
function onFeeYearOnlyDisplayChange() {
  const v = document.getElementById('feeYearOnlyDisplay')?.value;
  const yoSel = document.getElementById('feeYearOnly');
  if (yoSel && v) { Array.from(yoSel.options).forEach(o => o.selected = o.value === v); }
  renderFees();
}

// ── Multi-select state ─────────────────────────────────────────────
let selectedStudentIds = new Set();

function toggleStudentSelect(id, cb) {
  if (cb.checked) { selectedStudentIds.add(id); }
  else { selectedStudentIds.delete(id); }
  updateStudentSelectToolbar();
}

function updateStudentSelectToolbar() {
  const toolbar = document.getElementById('studentSelectToolbar');
  const label   = document.getElementById('selectedCountLabel');
  const count   = selectedStudentIds.size;
  if (toolbar) { toolbar.style.display = count > 0 ? 'flex' : 'none'; }
  if (label)   label.textContent = count;
}

function selectAllStudents() {
  document.querySelectorAll('.student-select-cb').forEach(cb => {
    cb.checked = true;
    selectedStudentIds.add(cb.dataset.id);
  });
  updateStudentSelectToolbar();
}

function clearStudentSelection() {
  selectedStudentIds.clear();
  document.querySelectorAll('.student-select-cb').forEach(cb => cb.checked = false);
  updateStudentSelectToolbar();
}

function clearStudentFilters() {
  const n = document.getElementById('filterStudentName');
  const b = document.getElementById('filterStudentBatch');
  const s = document.getElementById('filterStudentSchool');
  if (n) n.value = '';
  if (b) b.value = '';
  if (s) s.value = '';
  renderStudentList();
}

// Populate batch filter dropdown
function populateStudentBatchFilter() {
  const sel = document.getElementById('filterStudentBatch');
  if (!sel) return;
  const cur = sel.value;
  const selSport = document.getElementById('studentSportFilter')?.value || '';
  // If a sport is chosen, only show batches mapped to that sport
  let batches = DB.batches;
  if (selSport) batches = DB.batches.filter(b => (DB.batchSport && DB.batchSport[b]) === selSport);
  if (!isAdmin()) {
    const sb = getStaffBatches();
    if (sb.length) batches = batches.filter(b => sb.includes(b));
  }
  const stillValid = batches.includes(cur);
  sel.innerHTML = '<option value="">All Batches</option>' +
    batches.map(b => `<option value="${escHtml(b)}"${(stillValid && cur===b)?' selected':''}>${escHtml(b)}</option>`).join('');
}
function populateStudentSportFilter() {
  const sel = document.getElementById('studentSportFilter');
  if (!sel) return;
  const cur = sel.value;
  let sports = Array.isArray(DB.sports) ? DB.sports : [];
  // Staff only see the sports assigned to them
  if (!isAdmin()) {
    const ss = getStaffSports();
    sports = sports.filter(sp => ss.includes(sp));
  }
  const stillValid = sports.includes(cur);
  sel.innerHTML = '<option value="">All Sports</option>' +
    sports.map(sp => `<option value="${escHtml(sp)}"${(stillValid && cur===sp)?' selected':''}>${escHtml(sp)}</option>`).join('');
}
// When sport filter changes, reset+repopulate the batch dropdown for that sport
function onStudentSportFilterChange() {
  const batchSel = document.getElementById('filterStudentBatch');
  if (batchSel) batchSel.value = '';
  renderStudentList();
}

function renderStudentList() {
  populateStudentBatchFilter();
  populateStudentSportFilter();

  const search       = (document.getElementById('studentSearch')?.value || '').toLowerCase().trim();
  const filterBatch  = document.getElementById('filterStudentBatch')?.value || '';
  const filterSport  = document.getElementById('studentSportFilter')?.value || '';
  const sortBy       = document.getElementById('studentSortBy')?.value || 'roll';
  const batch = selectedBatch.student;

  let actives = getActiveStudents();
  let banned = getBannedStudents();

  // Staff are limited to their assigned batches AND sports; no assignment = see nothing
  if (!isAdmin()) {
    const sb = getStaffBatches();
    const ss = getStaffSports();
    if (sb.length) {
      actives = actives.filter(s => sb.includes(s.batch));
      banned  = banned.filter(s => sb.includes(s.batch));
    } else {
      actives = []; banned = [];
    }
    if (ss.length) {
      const spSids = new Set((DB.enrollments||[]).filter(e => ss.includes(e.sport)).map(e => e.studentId));
      actives = actives.filter(s => spSids.has(s._sid || s.id));
      banned  = banned.filter(s => spSids.has(s._sid || s.id));
    } else {
      actives = []; banned = [];
    }
  }

  // Batch chip filter (legacy, still respected if set)
  if (batch === '__DROPPED__') {
    actives = [];
  } else if (batch !== 'ALL') {
    actives = actives.filter(s => s.batch === batch);
    banned  = banned.filter(s => s.batch === batch);
  }

  // Search bar — matches name OR roll number only
  if (search) {
    const f = s => s.name.toLowerCase().includes(search)
      || String(s.rollNo||'').toLowerCase().includes(search);
    actives = actives.filter(f); banned = banned.filter(f);
  }

  // Sport filter — students enrolled in the chosen sport
  if (filterSport) {
    const sportSids = new Set((DB.enrollments||[]).filter(e => e.sport === filterSport).map(e => e.studentId));
    const f = s => sportSids.has(s._sid || s.id);
    actives = actives.filter(f); banned = banned.filter(f);
  }

  // Batch dropdown filter
  if (filterBatch) {
    const f = s => (s.batch || '') === filterBatch;
    actives = actives.filter(f); banned = banned.filter(f);
  }

  // ── Student count badge (reflects active filters) ────────────
  const badge = document.getElementById('studentLimitBadge');
  if (badge) {
    const hasFilters = !!(search || filterSport || filterBatch || (batch && batch !== 'ALL'));
    const filteredCount = actives.length + banned.length;
    const limit = (typeof planStudentLimit === 'function') ? planStudentLimit() : null;
    const totalActive = (DB.students||[]).filter(s=>!s.banned&&!s.archived).length;

    if (hasFilters) {
      badge.textContent = filteredCount + ' of ' + totalActive + (totalActive === 1 ? ' student' : ' students');
      badge.style.background = 'var(--card2)';
      badge.style.color = 'var(--gray)';
    } else if (limit === null) {
      badge.textContent = totalActive + (totalActive === 1 ? ' student' : ' students');
      badge.style.background = 'var(--card2)';
      badge.style.color = 'var(--gray)';
    } else {
      const pct  = totalActive / limit;
      const near = pct >= 0.8;
      const full = totalActive >= limit;
      badge.textContent = totalActive + ' / ' + limit;
      badge.style.background = full ? 'rgba(232,57,47,.15)' : near ? 'rgba(245,158,11,.15)' : 'var(--card2)';
      badge.style.color      = full ? '#e8392f'             : near ? '#f59e0b'              : 'var(--gray)';
    }
  }

  // Today's attendance (for the badge)
  const todayKey = todayStr();
  const todayAtt = attDayMap(todayKey);
  const attRank = s => { const v = todayAtt[s.id]; return v==='P'?0:v==='A'?1:2; };
  // Sort by chosen option
  const sorter = makeSorter(sortBy);
  actives.sort(sorter);
  banned.sort(sorter);

  let html = '';
  const row = (s, isBanned, num) => {
    const isChecked = selectedStudentIds.has(s.id);
    const att = todayAtt[s.id];
    const attBadge = att==='P'?'<span class="badge badge-green" style="font-size:10px;">✅</span>':att==='A'?'<span class="badge badge-red" style="font-size:10px;">❌</span>':'';
    const sports = (DB.enrollments||[]).filter(e=>e.studentId===(s._sid||s.id)).map(e=>e.sport);
    return `
    <div class="card" style="margin-bottom:4px;padding:8px 10px;${isBanned?'opacity:.65;border-color:#dc262655;':''}${isChecked?'border-color:var(--accent2);background:var(--card2);':''}">
      <div style="display:flex;align-items:center;gap:8px;min-width:0;">
        <label style="display:flex;align-items:center;flex-shrink:0;cursor:pointer;" onclick="event.stopPropagation()">
          <input type="checkbox" class="student-select-cb" data-id="${s.id}"
            ${isChecked?'checked':''}
            onchange="toggleStudentSelect('${s.id}',this)"
            style="width:17px;height:17px;accent-color:var(--accent2);cursor:pointer;flex-shrink:0;">
        </label>
        <span id="rollbadge_${s.id}"
          style="background:var(--accent2);color:#fff;border-radius:6px;min-width:36px;height:22px;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;padding:0 5px;flex-shrink:0;cursor:${isAdmin()?'pointer':'default'};"
          title="${isAdmin()?'Tap to edit roll number':''}"
          onclick="${isAdmin()?`event.stopPropagation();startInlineRollEdit('${s.id}')`:''}"
          >${s.rollNo ? escHtml(String(s.rollNo)) : `<span style="opacity:.5;font-size:10px;">${isAdmin()?'+Roll':'—'}</span>`}</span>
        <div style="flex:1;min-width:0;overflow:hidden;cursor:pointer;" onclick="openStudentDetail('${s.id}')">
          <div style="font-size:14px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:5px;">
            <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(s.name)}</span>
            ${isBanned?'<span class="badge badge-red" style="font-size:10px;flex-shrink:0;">Dropout</span>':''}
            ${attBadge?`<span style="flex-shrink:0;">${attBadge}</span>`:''}
          </div>
          <div style="display:flex;align-items:center;gap:5px;margin-top:2px;flex-wrap:nowrap;overflow:hidden;">
            <span class="badge badge-blue" style="font-size:10px;flex-shrink:0;white-space:nowrap;">${escHtml(s.batch||'—')}</span>
            ${sports.map(sp=>`<span class="badge badge-gold" style="font-size:10px;flex-shrink:0;white-space:nowrap;">${escHtml(sp)}</span>`).join('')}
          </div>
          ${s.contact?`<div style="margin-top:2px;font-size:12px;color:var(--accent2);white-space:nowrap;">📞 ${escHtml(s.contact)}</div>`:''}
        </div>
        <div style="color:var(--graydk);font-size:16px;flex-shrink:0;" onclick="openStudentDetail('${s.id}')">›</div>
      </div>
    </div>`;
  };

  actives.forEach((s, i) => html += row(s, false, i + 1));
  if (banned.length) {
    html += `<div style="margin:10px 0 6px;font-size:11px;color:var(--gray);font-weight:600;letter-spacing:.5px;">— DROPOUT / BANNED STUDENTS —</div>`;
    banned.forEach((s, i) => html += row(s, true, i + 1));
  }
  if (!html) html = `<div class="empty-state">No students found.</div>`;
  document.getElementById('studentListWrap').innerHTML = html;
  updateStudentSelectToolbar();
}

// Student detail popup — full info + actions
function openStudentDetail(id) {
  const s = DB.students.find(x => x.id === id);
  if (!s) return;
  const isBanned = !!s.banned;
  // Today's attendance across all sports this student is in
  const _td = todayStr();
  const _myEnrollSports = (DB.enrollments||[]).filter(e => e.studentId === (s._sid||s.id)).map(e => e.sport);
  let att = undefined;
  for (const _sp of _myEnrollSports) { const v = attGet(_td, s.id, _sp); if (v === 'P') { att = 'P'; break; } if (v === 'A') att = 'A'; }
  const attTxt = att==='P'?'✅ Present today':att==='A'?'❌ Absent today':'— Not marked today';
  const row = (label, val) => val ? `<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid var(--border);"><span style="color:var(--gray);font-size:12px;">${label}</span><span style="font-size:13px;font-weight:600;text-align:right;">${escHtml(String(val))}</span></div>` : '';
  // Sports this student is enrolled in
  const myEnroll = (DB.enrollments || []).filter(e => e.studentId === (s._sid || s.id));
  const enrollHtml = myEnroll.length
    ? `<div style="padding:8px 0;border-bottom:1px solid var(--border);">
         <div style="color:var(--gray);font-size:12px;margin-bottom:6px;">🏆 Sports Enrolled</div>
         <div style="display:flex;flex-wrap:wrap;gap:5px;justify-content:flex-end;">
         ${myEnroll.map(e => `<span class="badge badge-blue">${escHtml(e.sport)}${e.batch?` · ${escHtml(e.batch)}`:''}</span>`).join('')}
         </div></div>`
    : '';
  document.getElementById('studentDetailBody').innerHTML = `
    <div style="text-align:center;margin-bottom:12px;">
      ${s.rollNo ? `<div style="display:inline-flex;align-items:center;justify-content:center;background:var(--accent2);color:#fff;border-radius:8px;padding:3px 14px;font-size:13px;font-weight:800;margin-bottom:8px;">Roll No. ${escHtml(String(s.rollNo))}</div>` : ''}
      <div style="font-size:18px;font-weight:800;">${escHtml(s.name)}</div>
      <div style="margin-top:4px;">
        <span class="badge badge-blue">${escHtml(s.batch||'')}</span>
        ${isBanned?'<span class="badge badge-red">Dropout</span>':''}
      </div>
      <div style="font-size:11px;color:var(--gray);margin-top:6px;">${attTxt}</div>
    </div>
    ${row('Age', s.dob ? (ageFromDob(s.dob) || s.age) : s.age)}
    ${row('Date of Birth', s.dob)}
    ${row('Contact 1', s.contact)}
    ${row('Contact 2', s.contact2)}
    ${row('Parent / Guardian', s.parent)}
    ${row('School', s.address)}
    ${row('Joined', s.joinDate)}
    ${enrollHtml}
    <div style="display:flex;gap:6px;margin-top:14px;">
      <button class="btn btn-primary btn-sm" style="flex:1;" onclick="closeModal('modalStudentDetail');openAddStudentModal('${s.id}')">✏️ Edit</button>
      ${!isBanned?`<button class="btn btn-warning btn-sm" style="flex:1;" onclick="closeModal('modalStudentDetail');banStudent('${s.id}')">🚫 Block</button>`
        :`<button class="btn btn-success btn-sm" style="flex:1;" onclick="closeModal('modalStudentDetail');unbanStudent('${s.id}')">✅ Restore</button>`}
      <button class="btn btn-danger btn-sm" style="flex:1;" onclick="closeModal('modalStudentDetail');deleteStudent('${s.id}')">🗑️ Delete</button>
    </div>`;
  openModal('modalStudentDetail');
}

// ── Bulk Edit ─────────────────────────────────────────────────────
function openBulkEditModal() {
  if (selectedStudentIds.size === 0) { showToast('No students selected','warn'); return; }

  // Populate batch dropdown
  const bSel = document.getElementById('bulkBatch');
  bSel.innerHTML = '<option value="">— No change —</option>' +
    DB.batches.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');

  // Clear inputs
  document.getElementById('bulkSchool').value = '';
  document.getElementById('bulkJoinDate').value = '';

  // Show selected students list
  const label = document.getElementById('bulkEditCountLabel');
  if (label) label.textContent = selectedStudentIds.size;

  const listEl = document.getElementById('bulkEditStudentList');
  if (listEl) {
    const names = [...selectedStudentIds].map(id => {
      const s = DB.students.find(x => x.id === id);
      return s ? `<span style="display:inline-block;background:var(--accent);border-radius:4px;padding:1px 7px;margin:2px 3px 2px 0;font-size:11px;color:var(--gold);font-weight:600;">${escHtml(s.name)}</span>` : '';
    }).filter(Boolean);
    listEl.innerHTML = names.join('');
  }

  openModal('modalBulkEdit');
}

function saveBulkEdit() {
  const school   = document.getElementById('bulkSchool').value.trim();
  const joinDate = document.getElementById('bulkJoinDate').value.trim();
  const batch    = document.getElementById('bulkBatch').value;

  if (!school && !joinDate && !batch) {
    showToast('Fill at least one field to apply','warn'); return;
  }

  const count = selectedStudentIds.size;
  confirm_('✏️', 'Bulk Edit', `Apply changes to ${count} student(s)?`, () => {
    const changed = [];
    selectedStudentIds.forEach(id => {
      const idx = DB.students.findIndex(s => s.id === id);
      if (idx < 0) return;
      if (school)   DB.students[idx].address  = school;
      if (joinDate) DB.students[idx].joinDate = joinDate;
      if (batch)    DB.students[idx].batch    = batch;
      changed.push(DB.students[idx]);
    });
    addLog('student_bulk_edit', `Bulk edited ${count} student(s): ${[school&&'school',joinDate&&'joinDate',batch&&'batch'].filter(Boolean).join(', ')}`);
    closeModal('modalBulkEdit');
    changed.forEach(st => { if (st._sid) sbUpdateStudent(st._sid, st); });
    selectedStudentIds.clear();
    renderStudentList();
    renderBatchChips('student');
    showToast(`${count} student(s) updated ✓`, 'success');
  });
}

// ── Bulk Delete ───────────────────────────────────────────────────
function bulkDeleteStudents() {
  if (!isAdmin()) { showToast('Only admin can delete students', 'error'); return; }
  const count = selectedStudentIds.size;
  if (count === 0) { showToast('No students selected', 'warn'); return; }
  const names = [...selectedStudentIds].map(id => {
    const s = DB.students.find(x => x.id === id);
    return s ? s.name : '';
  }).filter(Boolean);
  confirm_('🗑️', 'Delete Students',
    `Permanently delete ${count} student(s)?\n\n${names.slice(0,5).join(', ')}${names.length > 5 ? ` … +${names.length - 5} more` : ''}\n\nThis cannot be undone.`,
    () => {
      const ids = [...selectedStudentIds];
      ids.forEach(id => {
        const s = DB.students.find(x => x.id === id);
        if (!s) return;
        // Remove enrollments
        if (Array.isArray(DB.enrollments)) {
          DB.enrollments = DB.enrollments.filter(e => e.studentId !== (s._sid || id));
        }
        // Remove from Supabase
        if (typeof sbDeleteStudent === 'function' && s._sid) sbDeleteStudent(s._sid).catch(() => {});
        // Remove from local DB
        DB.students = DB.students.filter(x => x.id !== id);
        addLog('student_delete', `Deleted student "${s.name}"`);
      });
      selectedStudentIds.clear();
      renderStudentList();
      renderBatchChips('student');
      loadDashboard();
      showToast(`${ids.length} student(s) deleted ✓`, 'success');
    });
}


function updateAttNavLabel() {
  const ySel = document.getElementById('attYear');
  const mSel = document.getElementById('attMonth');
  const dSel = document.getElementById('attDate');
  const lbl  = document.getElementById('attNavLabel');
  const lbl2 = document.getElementById('attDateNavLabel2');
  const badge = document.getElementById('attViewBadge');
  if (!ySel || !mSel) return;
  const m = parseInt(mSel.value);
  const d = dSel ? parseInt(dSel.value) : '';
  const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dayName = d ? DAYS_SHORT[new Date(parseInt(ySel.value), m-1, d).getDay()] : '';
  const dateStr = d ? `${pad(d)} ${dayName}, ` : '';
  const fullLabel = dateStr + MONTHS[m-1].substring(0,3) + ' ' + ySel.value;
  if (lbl)  lbl.textContent  = MONTHS[m-1].substring(0,3) + ' ' + ySel.value;
  if (lbl2) lbl2.textContent = fullLabel;
  // Update view badge
  if (badge) {
    const view = document.getElementById('attViewType')?.value || 'day';
    const viewLabels = { day:'Day', month:'Month', year:'Year' };
    badge.textContent = viewLabels[view] || 'Day';
  }
}
function toggleAttDateNav() {
  const body    = document.getElementById('attDateNavBody');
  const chevron = document.getElementById('attDateNavChevron');
  const btn     = document.getElementById('attDateNavToggleBtn');
  if (!body) return;
  const open = body.style.display === 'block';
  body.style.display = open ? 'none' : 'block';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
  if (btn) btn.style.borderRadius = open ? '10px' : '10px 10px 0 0';
}
function initAttFilters() {
  const now = new Date();
  const ySel = document.getElementById('attYear');
  const mSel = document.getElementById('attMonth');
  if (!ySel) return;
  // Plan-based history limit
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  const histYears = plan === 'premium' ? 10 : plan === 'pro' ? 1 : 0;
  // histYears=0 means same year only (3 months back handled via month limit)
  const minYear = now.getFullYear() - histYears;
  ySel.innerHTML = '';
  for (let y = minYear; y <= now.getFullYear()+1; y++)
    ySel.innerHTML += `<option${y===now.getFullYear()?' selected':''}>${y}</option>`;
  mSel.innerHTML = MONTHS.map((m,i) => `<option value="${i+1}"${i===now.getMonth()?' selected':''}>${m}</option>`).join('');
  updateDateOptions();
  updateAttNavLabel();
  syncAttDisplaySelects();
}
function updateDateOptions() {
  const y = parseInt(document.getElementById('attYear').value);
  const m = parseInt(document.getElementById('attMonth').value);
  const dSel = document.getElementById('attDate');
  const cur = parseInt(dSel.value) || new Date().getDate();
  const maxD = daysInMonth(y, m);
  const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  dSel.innerHTML = '';
  for (let d = 1; d <= maxD; d++) {
    const dayName = DAYS_SHORT[new Date(y, m-1, d).getDay()];
    dSel.innerHTML += `<option value="${d}"${d===Math.min(cur,maxD)?' selected':''}>${pad(d)} ${dayName}</option>`;
  }
}
function onAttFilterChange() { updateDateOptions(); updateAttNavLabel(); syncAttDisplaySelects(); renderAttendance(); }

function navAtt(type, dir) {
  const ySel = document.getElementById('attYear');
  const mSel = document.getElementById('attMonth');
  const dSel = document.getElementById('attDate');
  if (type === 'year') {
    const newIdx = Math.max(0, Math.min(ySel.options.length-1, ySel.selectedIndex + dir));
    ySel.selectedIndex = newIdx;
    updateAttNavLabel(); updateDateOptions(); syncAttDisplaySelects(); renderAttendance();
  } else if (type === 'month') {
    let v = parseInt(mSel.value) + dir;
    let y = parseInt(ySel.value);
    if (v < 1)  { v = 12; y--; if (y < parseInt(ySel.options[0].value)) return; ySel.value = y; mSel.value = v; updateAttNavLabel(); updateDateOptions(); syncAttDisplaySelects(); renderAttendance(); return; }
    if (v > 12) { v = 1;  y++; if (y > parseInt(ySel.options[ySel.options.length-1].value)) return; ySel.value = y; }
    mSel.value = v; updateAttNavLabel(); updateDateOptions(); syncAttDisplaySelects(); renderAttendance();
  } else if (type === 'date') {
    let y = parseInt(ySel.value), m = parseInt(mSel.value);
    let v = parseInt(dSel.value) + dir;
    const max = daysInMonth(y, m);
    if (v < 1) {
      // Roll back into the previous month
      m -= 1;
      if (m < 1) { m = 12; y -= 1; }
      if (y < parseInt(ySel.options[0].value)) return; // out of allowed history range
      ySel.value = y; mSel.value = m;
      updateDateOptions();
      dSel.value = daysInMonth(y, m); // land on last day of previous month
    } else if (v > max) {
      // Roll forward into the next month
      m += 1;
      if (m > 12) { m = 1; y += 1; }
      if (y > parseInt(ySel.options[ySel.options.length-1].value)) return; // out of allowed range
      ySel.value = y; mSel.value = m;
      updateDateOptions();
      dSel.value = 1; // land on first day of next month
    } else {
      dSel.value = v;
    }
    updateAttNavLabel(); syncAttDisplaySelects(); renderAttendance();
  }
}
function navFee(type, dir) {
  const ySel  = document.getElementById('feeYear');
  const mSel  = document.getElementById('feeMonth');
  const yoSel = document.getElementById('feeYearOnly');
  if (type === 'year') {
    ySel.selectedIndex  = Math.max(0, Math.min(ySel.options.length-1,  ySel.selectedIndex+dir));
    if (yoSel) yoSel.selectedIndex = Math.max(0, Math.min(yoSel.options.length-1, yoSel.selectedIndex+dir));
  } else {
    let v = parseInt(mSel.value) + dir;
    if (v < 1)  { v = 12; ySel.selectedIndex = Math.max(0, ySel.selectedIndex-1); }
    if (v > 12) { v = 1;  ySel.selectedIndex = Math.min(ySel.options.length-1, ySel.selectedIndex+1); }
    mSel.value = v;
  }
  updateFeeNavLabel();
  syncFeeDisplaySelects();
  renderFees();
}

function getAttKey() {
  const y = document.getElementById('attYear').value;
  const m = pad(document.getElementById('attMonth').value);
  const d = pad(document.getElementById('attDate').value);
  return `${y}-${m}-${d}`;
}

// A day is a "class day" (for the current sport) if at least one student has P or A
function isClassDay(dateKey, sport) {
  const dd = attDayMap(dateKey, sport);
  return Object.values(dd).some(v => v === 'P' || v === 'A');
}

// Check if student attended ≥1 day in given year-month (current sport)
function studentAttendedMonth(sid, year, month, sport) {
  const student = DB.students.find(s => s.id === sid);
  const prefix = `${year}-${pad(month)}-`;
  return Object.keys(DB.attendance).some(dateKey => {
    if (!dateKey.startsWith(prefix)) return false;
    if (student && !isEnrolledOnKey(student, dateKey)) return false;
    return attGet(dateKey, sid, sport) === 'P';
  });
}

function markAttendance(sid, dateKey, status) {
  // Block future dates as a safety net
  if (dateKey > todayStr()) {
    showToast('Cannot mark attendance for future dates', 'error');
    return;
  }
  let sp = attCurrentSport();
  // In ALL mode, resolve which sport this mark belongs to
  if (sp === 'ALL') {
    const resolved = studentSingleSport(sid);
    if (!resolved) {
      // Student is in multiple sports — ask which one
      promptSportForStudent(sid, (chosen) => { _markAttendanceFor(sid, dateKey, status, chosen); });
      return;
    }
    sp = resolved;
  }
  _markAttendanceFor(sid, dateKey, status, sp);
}
// Show a small chooser when a student has multiple sports
function promptSportForStudent(sid, cb) {
  const mine = (DB.enrollments||[]).filter(e => e.studentId === sid).map(e => e.sport);
  const s = DB.students.find(x => x.id === sid);
  const list = mine.map(sp => `<button class="btn btn-outline" style="width:100%;margin-bottom:6px;padding:10px;" onclick="window._sportPick&&window._sportPick('${escHtml(sp)}')">${escHtml(sp)}</button>`).join('');
  // Reuse confirm modal area via a simple prompt fallback
  window._sportPick = (sp) => { closeModal('modalSportPick'); window._sportPick = null; cb(sp); };
  let modal = document.getElementById('modalSportPick');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modalSportPick';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div class="modal"><div class="modal-title">Pick sport for ${escHtml(s?s.name:'')}<button class="modal-close" onclick="closeModal('modalSportPick')">×</button></div>
    <div style="font-size:12px;color:var(--gray);margin-bottom:10px;">This student is in multiple sports. Which one is this for?</div>${list}</div>`;
  openModal('modalSportPick');
}
function _markAttendanceFor(sid, dateKey, status, sp) {
  const existing = attGet(dateKey, sid, sp);
  const s = DB.students.find(x => x.id === sid);
  const name = s ? s.name : sid;
  const done = isAttDone(dateKey, sp);

  // Register CLOSED (Done) — locked rules
  if (done) {
    // Already-marked students are locked, except latecomers (P) can be changed to Absent
    if (existing === 'A') {
      showToast('Register is closed for this day — already marked, cannot change.', 'warn');
      return;
    }
    if (existing === 'P' && status === 'A') {
      const late = isLatecomer(dateKey, sid, sp);
      if (!late) {
        showToast('Register is closed for this day — already marked, cannot change.', 'warn');
        return;
      }
      confirm_('🔄', 'Change Latecomer to Absent', `Change ${name} from Latecomer → Absent (${sp}) on ${dateKey}?`, () => {
        attSet(dateKey, sid, 'A', sp);
        sbSetAttendance(sid, dateKey, 'A', currentUser ? (currentUser.name||currentUser.id) : '', sp);
        addLog('attendance', `${name} → Absent from latecomer (${sp}) on ${dateKey}`);
        renderAttendance();
      });
      return;
    }
    if (existing === 'P') {
      showToast('Register is closed for this day — already marked, cannot change.', 'warn');
      return;
    }
    // Unmarked: Present (latecomer) or Absent allowed
    if (status === 'A') {
      confirm_('🔴', 'Mark Absent', `Mark ${name} as Absent (${sp}) on ${dateKey}?`, () => {
        attSet(dateKey, sid, 'A', sp);
        sbSetAttendance(sid, dateKey, 'A', currentUser ? (currentUser.name||currentUser.id) : '', sp);
        addLog('attendance', `${name} → Absent (${sp}) on ${dateKey} [after register closed]`);
        renderAttendance();
      });
      return;
    }
    // Mark as a latecomer (Present, shown orange)
    confirm_('🟠', 'Add Latecomer', `Mark ${name} as a latecomer (Present after register closed)?`, () => {
      attSet(dateKey, sid, 'P', sp);
      markLatecomer(dateKey, sid, sp);
      sbSetAttendance(sid, dateKey, 'P', currentUser ? (currentUser.name||currentUser.id) : '', sp);
      sbSaveSettings(); // persist latecomer flag
      addLog('attendance', `${name} → latecomer Present (${sp}) on ${dateKey}`);
      renderAttendance();
    });
    return;
  }

  // Toggle off: same button again = clear — ask confirmation
  if (existing === status) {
    const label = existing === 'P' ? 'Present' : 'Absent';
    confirm_('🗑️', 'Clear Attendance',
      `Remove ${label} mark for ${name} (${sp}) on ${dateKey}?`,
      () => {
        attClear(dateKey, sid, sp);
        sbClearAttendance(sid, dateKey, sp);
        addLog('attendance', `${name} → cleared (${sp}) on ${dateKey}`);
        renderAttendance();
      }
    );
    return;
  }

  // Changing P→A or A→P: ask confirmation
  if (existing === 'P' || existing === 'A') {
    const fromLabel = existing === 'P' ? 'Present' : 'Absent';
    const toLabel   = status   === 'P' ? 'Present' : 'Absent';
    confirm_('🔄', 'Change Attendance',
      `Change ${name} from ${fromLabel} → ${toLabel} (${sp}) on ${dateKey}?`,
      () => {
        attSet(dateKey, sid, status, sp);
        sbSetAttendance(sid, dateKey, status, currentUser ? (currentUser.name||currentUser.id) : '', sp);
        addLog('attendance', `${name} → ${status} (${sp}) on ${dateKey}`);
        renderAttendance();
      }
    );
    return;
  }

  // Fresh mark (no existing entry)
  attSet(dateKey, sid, status, sp);
  sbSetAttendance(sid, dateKey, status, currentUser ? (currentUser.name||currentUser.id) : '', sp);
  addLog('attendance', `${name} → ${status} (${sp}) on ${dateKey}`);
  renderAttendance();
}

// Close the register for the current sport + date (Done button)
function markAttendanceDone() {
  const sp = attCurrentSport();
  if (sp === 'ALL') { showToast('Pick a specific sport to close its register.', 'warn'); return; }
  const y = parseInt(document.getElementById('attYear').value);
  const m = parseInt(document.getElementById('attMonth').value);
  const d = parseInt(document.getElementById('attDate').value);
  const dateKey = `${y}-${pad(m)}-${pad(d)}`;
  if (isAttDone(dateKey, sp)) return;
  if (dateKey > todayStr()) { showToast('Cannot close a future date','error'); return; }
  confirm_('🔒', 'Close Register',
    `Close the ${sp} attendance register for ${dateKey}?\n\nOnce closed: marked students are locked, and anyone marked Present afterward is flagged as a latecomer (orange). This cannot be undone.`,
    () => {
      setAttDone(dateKey, sp);
      sbSaveSettings();
      addLog('attendance', `Register closed (${sp}) for ${dateKey}`);
      showToast('Register closed ✓', 'success');
      renderAttendance();
    });
}

function markAllAttendance(dateKey, status, checked) {
  if (dateKey > todayStr()) {
    showToast('Cannot mark attendance for future dates', 'error');
    renderAttendance();
    return;
  }
  const y = parseInt(dateKey.split('-')[0]);
  const m = parseInt(dateKey.split('-')[1]);
  const d = parseInt(dateKey.split('-')[2]);
  const sp = attCurrentSport();
  if (sp === 'ALL') {
    showToast('Pick a specific sport to use Mark All.', 'warn');
    const cb = document.getElementById(status === 'P' ? 'chkAllPresent' : 'chkAllAbsent');
    if (cb) cb.checked = false;
    return;
  }
  const batch = selectedBatch.att;
  // Only students enrolled in the CURRENT sport
  const sportSids = new Set((DB.enrollments||[]).filter(e => e.sport === sp).map(e => e.studentId));
  let students = DB.students.filter(s => sportSids.has(s._sid || s.id));
  if (batch !== 'ALL') students = students.filter(s => s.batch === batch);
  const enrolled = students.filter(s => isEnrolledOnDate(s, y, m, d) && isActiveOnDate(s, y, m, d));
  if (!enrolled.length) { renderAttendance(); return; }

  const label = status === 'P' ? 'Present' : 'Absent';
  if (checked) {
    confirm_('✅', `Mark All ${label}`, `Mark all ${enrolled.length} ${sp} student(s) as ${label} on ${dateKey}?`, () => {
      enrolled.forEach(s => { attSet(dateKey, s.id, status); });
      sbSetAttendanceBulk(enrolled.map(s => s.id), dateKey, status, currentUser ? (currentUser.name||currentUser.id) : '');
      addLog('attendance', `All ${sp} students → ${status} on ${dateKey}`);
      showToast(`All marked ${label} ✓`, 'success');
      renderAttendance();
    });
    // revert checkbox until confirmed
    const cb = document.getElementById(status === 'P' ? 'chkAllPresent' : 'chkAllAbsent');
    if (cb) cb.checked = false;
  } else {
    confirm_('🗑️', `Clear All ${label}`, `Remove ${label} mark for all ${sp} students on ${dateKey}?`, () => {
      const cleared = [];
      enrolled.forEach(s => {
        if (attGet(dateKey, s.id) === status) { attClear(dateKey, s.id); cleared.push(s.id); }
      });
      sbClearAttendanceBulk(cleared, dateKey);
      addLog('attendance', `All ${status} cleared (${sp}) on ${dateKey}`);
      showToast(`All ${label} marks cleared ✓`, 'success');
      renderAttendance();
    });
    // revert checkbox until confirmed
    const cb = document.getElementById(status === 'P' ? 'chkAllPresent' : 'chkAllAbsent');
    if (cb) cb.checked = true;
  }
}

function populateAttSportSelect() {
  const sel = document.getElementById('attSportSelect');
  if (!sel) return;
  let sports = Array.isArray(DB.sports) ? DB.sports : [];
  if (!isAdmin()) {
    const ss = getStaffSports();
    sports = sports.filter(sp => ss.includes(sp));
  }
  if (!sports.length) { sel.innerHTML = '<option value="">— No sports —</option>'; return; }
  if (_attSport !== 'ALL' && !sports.includes(_attSport)) _attSport = 'ALL';
  sel.innerHTML = `<option value="ALL"${_attSport==='ALL'?' selected':''}>All Sports</option>` +
    sports.map(s => `<option value="${escHtml(s)}"${s===_attSport?' selected':''}>${escHtml(s)}</option>`).join('');
  populateAttBatchFilter();
}
// Batch dropdown reflects the current sport's batches (all batches in ALL mode)
function populateAttBatchFilter() {
  const sel = document.getElementById('attBatchFilter');
  if (!sel) return;
  const sp = attCurrentSport();
  const staffBatches = getStaffBatches();
  let batches = sp === 'ALL'
    ? DB.batches.slice()
    : DB.batches.filter(b => (DB.batchSport && DB.batchSport[b]) === sp);
  if (staffBatches.length) batches = batches.filter(b => staffBatches.includes(b));
  const cur = selectedBatch.att;
  const stillValid = batches.includes(cur);
  if (!stillValid && cur !== 'ALL') selectedBatch.att = 'ALL';
  let opts = staffBatches.length ? '' : '<option value="ALL">All Batches</option>';
  opts += batches.map(b => `<option value="${escHtml(b)}"${selectedBatch.att===b?' selected':''}>${escHtml(b)}</option>`).join('');
  sel.innerHTML = opts || '<option value="ALL">All Batches</option>';
}
function onAttBatchFilterChange() {
  const sel = document.getElementById('attBatchFilter');
  if (sel) selectedBatch.att = sel.value;
  renderAttendance();
}
function onAttSportChange() {
  const sel = document.getElementById('attSportSelect');
  if (sel) _attSport = sel.value;
  selectedBatch.att = 'ALL';
  populateAttBatchFilter();
  renderAttendance();
}

function renderAttendance() {
  const viewType = document.getElementById('attViewType').value;
  const y = parseInt(document.getElementById('attYear').value);
  const m = parseInt(document.getElementById('attMonth').value);
  const d = parseInt(document.getElementById('attDate').value);
  const batch = selectedBatch.att;
  const sp = attCurrentSport();

  // Get students: active + recently-dropped (for past dates), filtered by sport, batch & search
  const attSearch = (document.getElementById('attSearch')?.value || '').toLowerCase();
  const attStatusFilter = document.getElementById('attStatusFilter')?.value || 'all';
  // Students enrolled in the current sport (or ALL sports in ALL mode)
  const _sportSids = sp === 'ALL'
    ? new Set((DB.enrollments||[]).map(e => e.studentId))
    : new Set((DB.enrollments||[]).filter(e => e.sport === sp).map(e => e.studentId));
  let students = DB.students.filter(s => _sportSids.has(s._sid || s.id));
  // Staff are limited to their assigned batches AND sports; no assignment = see nothing
  if (!isAdmin()) {
    const sb = getStaffBatches();
    const ss = getStaffSports();
    students = sb.length ? students.filter(s => sb.includes(s.batch)) : [];
    if (ss.length) {
      const spSids = new Set((DB.enrollments||[]).filter(e => ss.includes(e.sport)).map(e => e.studentId));
      students = students.filter(s => spSids.has(s._sid || s.id));
    } else {
      students = [];
    }
  }
  if (batch !== 'ALL') students = students.filter(s => s.batch === batch);
  if (attSearch) students = students.filter(s => s.name.toLowerCase().includes(attSearch) || String(s.rollNo||'').toLowerCase().includes(attSearch));

  const wrap = document.getElementById('attListWrap');
  const summBar = document.getElementById('attSummaryBar');

  if (viewType === 'day') {
    const dateKey = `${y}-${pad(m)}-${pad(d)}`;
    const isFutureDate = dateKey > todayStr();
    const dayData = attDayMap(dateKey);
    const classDay = isClassDay(dateKey);

    // Enrolled (joined on/before) AND active (not yet dropped) on this date
    const _attSort = (document.getElementById('attSortBy')?.value) || 'roll_asc';
    let enrolled = students.filter(s => isEnrolledOnDate(s, y, m, d) && isActiveOnDate(s, y, m, d));
    if (_attSort === 'present_first' || _attSort === 'absent_first') {
      // Present/Absent sort only makes sense against this specific day's marks
      const rank = s => {
        const v = dayData[s.id];
        if (_attSort === 'present_first') return v === 'P' ? 0 : (v === 'A' ? 2 : 1);
        return v === 'A' ? 0 : (v === 'P' ? 2 : 1);
      };
      enrolled = enrolled.sort((a, b) => rank(a) - rank(b) || rollCmp(a, b) || a.name.localeCompare(b.name));
    } else {
      enrolled = enrolled.sort(makeSorter(_attSort));
    }

    // Summary counts
    let pCount=0, aCount=0, lCount=0;
    if (classDay) {
      enrolled.forEach(s => {
        const v = dayData[s.id];
        if (v==='P') pCount++;
        else if (v==='A') aCount++;
        else lCount++;
      });
    }
    const allPresent = enrolled.length > 0 && pCount === enrolled.length;
    const allAbsent  = enrolled.length > 0 && aCount === enrolled.length;
    summBar.innerHTML = `<div class="att-summary-bar" style="justify-content:space-between;align-items:center;">
      <div style="display:flex;gap:8px;flex-wrap:nowrap;white-space:nowrap;flex-shrink:0;">
        <span style="color:#4ade80;" title="Present">✅ ${pCount}</span>
        <span style="color:#f87171;" title="Absent">❌ ${aCount}</span>
        <span style="color:var(--gray);" title="Leave">🏃 ${lCount}</span>
        ${!classDay?'<span style="color:var(--gold);" title="Holiday">🏖️</span>':''}
      </div>
      ${!isFutureDate ? `<div style="display:flex;gap:6px;flex-shrink:0;white-space:nowrap;">
        <label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:11px;font-weight:700;color:#4ade80;" title="Mark all Present">
          <input type="checkbox" id="chkAllPresent" ${allPresent?'checked':''} onchange="markAllAttendance('${dateKey}','P',this.checked)"
            style="width:14px;height:14px;accent-color:#22c55e;cursor:pointer;flex-shrink:0;">
          All P
        </label>
        <label style="display:flex;align-items:center;gap:3px;cursor:pointer;font-size:11px;font-weight:700;color:#f87171;" title="Mark all Absent">
          <input type="checkbox" id="chkAllAbsent" ${allAbsent?'checked':''} onchange="markAllAttendance('${dateKey}','A',this.checked)"
            style="width:14px;height:14px;accent-color:#ef4444;cursor:pointer;flex-shrink:0;">
          All A
        </label>
      </div>` : ''}
    </div>`;

    const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dayOfWeek = DAYS_SHORT[new Date(y, m-1, d).getDay()];
    let html = ``;
    if (isFutureDate) {
      html += `<div style="background:#f59e0b18;border:1px solid #f59e0b55;border-radius:10px;padding:11px 14px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:18px;">🔒</span>
        <div style="font-size:12px;color:#fbbf24;font-weight:600;">Future date — attendance cannot be marked.</div>
      </div>`;
      wrap.innerHTML = html;
      updateWheel(enrolled, 0, 0, enrolled.length, false);
      return;
    }
    html += `<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">`;
    const done = isAttDone(dateKey, sp);
    if (!enrolled.length) {
      html += `<div class="empty-state">No students enrolled on this date.</div>`;
    } else {
      enrolled.forEach(s => {
        const v = dayData[s.id];
        // Apply status filter (only relevant in day view)
        if (attStatusFilter === 'present' && v !== 'P') return;
        if (attStatusFilter === 'absent'  && v !== 'A') return;
        // In ALL mode, resolve this student's sport for late/lock checks
        const rowSp = sp === 'ALL' ? (studentSingleSport(s._sid || s.id) || (DB.sports&&DB.sports[0])) : sp;
        const rowDone = isAttDone(dateKey, rowSp);
        const late = v === 'P' && isLatecomer(dateKey, s.id, rowSp);
        // Present button class: orange if latecomer, else normal green
        const pClass = v === 'P' ? (late ? 'present late' : 'present') : 'inactive';
        const lockedMark = rowDone && (v === 'P' || v === 'A'); // already-marked + closed = locked
        html += `<div class="att-row">
          <div class="att-name">
            ${s.rollNo ? `<span style="background:var(--accent2);color:#fff;border-radius:50%;min-width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;padding:0 4px;margin-right:5px;vertical-align:middle;">${s.rollNo}</span>` : ''}<span style="font-weight:700;">${escHtml(s.name)}</span>${late?'<span style="background:#f9731622;color:#fb923c;border:1px solid #f9731655;border-radius:5px;font-size:9px;font-weight:800;padding:1px 5px;margin-left:5px;">LATE</span>':''}<br>
            <span style="font-size:10px;color:var(--gray);">${escHtml(s.batch||'')}</span>
          </div>
          <div class="att-btns">
            <button class="att-btn ${pClass}" onclick="markAttendance('${s.id}','${dateKey}','P')" title="${lockedMark?'Locked — register closed':(v==='P'?'Click to clear':'Mark Present')}">P</button>
            <button class="att-btn ${v==='A'?'absent':'inactive'}" onclick="markAttendance('${s.id}','${dateKey}','A')" title="${lockedMark?'Locked — register closed':(v==='A'?'Click to clear':'Mark Absent')}">A</button>
          </div>
        </div>`;
      });
    }
    html += `</div>`;
    // Done / register-closed button
    if (enrolled.length) {
      if (sp === 'ALL') {
        html += `<div style="font-size:11px;color:var(--graydk);margin-top:10px;padding:8px 10px;background:var(--card2);border:1px solid var(--border);border-radius:8px;">👉 You're viewing <b>All Sports</b>. Pick a specific sport above to close its register (Done) and flag latecomers.</div>`;
      } else if (done) {
        html += `<button class="btn" disabled style="width:100%;margin-top:10px;padding:12px;background:var(--card2);color:var(--gray);border:1px solid var(--border);cursor:not-allowed;font-weight:800;">🔒 Register Closed</button>
          <div style="font-size:11px;color:var(--graydk);margin-top:5px;padding:0 4px;">Closed. Marked students are locked. New Present marks show as latecomers (orange).</div>`;
      } else {
        html += `<button class="btn btn-primary" onclick="markAttendanceDone()" style="width:100%;margin-top:10px;padding:12px;font-weight:800;">✅ Done — Close Register</button>
          <div style="font-size:11px;color:var(--graydk);margin-top:5px;padding:0 4px;">Tip: Tap P/A again to clear. Click Done to close the register for the day.</div>`;
      }
    }
    wrap.innerHTML = html;
    updateWheel(enrolled, pCount, aCount, lCount, classDay);
    setTimeout(() => updateScrollArrow('attListWrap','attScrollArrow'), 50);

  } else if (viewType === 'year') {
    // YEAR VIEW — monthly summary for the whole year
    summBar.innerHTML = `<div class="att-summary-bar">
      <span style="color:var(--gold);">🗓️ Year ${y} — Annual Summary</span>
    </div>`;

    let yearHtml = '';
    let totalP = 0, totalA = 0, totalDays = 0;
    for (let mo = 1; mo <= 12; mo++) {
      const prefix = `${y}-${pad(mo)}-`;
      const classDays = Object.keys(DB.attendance)
        .filter(k => k.startsWith(prefix) && isClassDay(k)).sort();
      if (!classDays.length) continue;
      totalDays += classDays.length;
      const enrolled = students.filter(s => isEnrolledOnDate(s, y, mo, 0));
      let mP = 0, mA = 0;
      enrolled.forEach(s => {
        classDays.forEach(dk => {
          const v = attGet(dk, s.id);
          if (v==='P') mP++;
          else if (v==='A') mA++;
        });
      });
      totalP += mP; totalA += mA;
      yearHtml += `<div style="display:flex;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border);gap:10px;">
        <div style="width:42px;font-size:12px;font-weight:700;color:var(--gold);flex-shrink:0;">${MONTHS[mo-1].substring(0,3)}</div>
        <div style="flex:1;font-size:11px;color:var(--gray);">${classDays.length} class days · ${enrolled.length} students</div>
        <span style="color:#4ade80;font-size:11px;font-weight:700;">✅ ${mP}</span>
        <span style="color:#f87171;font-size:11px;font-weight:700;">❌ ${mA}</span>
      </div>`;
    }

    wrap.innerHTML = `<div style="background:var(--card2);border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:12px;display:flex;gap:12px;flex-wrap:wrap;">
      <span style="color:var(--gold);">📅 ${totalDays} total class days in ${y}</span>
      <span style="color:#4ade80;">✅ ${totalP} present records</span>
      <span style="color:#f87171;">❌ ${totalA} absent records</span>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">
      ${yearHtml || '<div class="empty-state">No attendance recorded for ' + y + '.</div>'}
    </div>`;
    summBar.innerHTML = '';

  } else {
    const prefix = `${y}-${pad(m)}-`;
    const classDays = Object.keys(DB.attendance)
      .filter(k => k.startsWith(prefix) && isClassDay(k))
      .sort();
    const totalClassDays = classDays.length;

    summBar.innerHTML = `<div class="att-summary-bar">
      <span style="color:var(--gold);">📅 ${totalClassDays} class days in ${MONTHS[m-1]} ${y}</span>
    </div>`;

    // Show any student who joined any day this month or earlier
    const enrolled = students.filter(s => isEnrolledOnDate(s, y, m, 0));
    const attended = enrolled.filter(s => studentAttendedMonth(s.id, y, m));
    const notAttended = enrolled.filter(s => !studentAttendedMonth(s.id, y, m));

    let html = ``;

    const monthRow = (s, isNA) => {
      // Only count class days from this student's join date
      const studentClassDays = classDays.filter(dk => isEnrolledOnKey(s, dk));
      let p=0, a=0, l=0, datePres=[];
      studentClassDays.forEach(dk => {
        const v = attGet(dk, s.id);
        if (v==='P') { p++; datePres.push(parseInt(dk.split('-')[2])); }
        else if (v==='A') a++;
        else l++;
      });
      const joinedMid = s.joinDate && parseDate(s.joinDate) && parseDate(s.joinDate) > new Date(y, m-1, 1);
      return `<div class="card" style="margin-bottom:6px;${isNA?'opacity:.7;border-color:#47556955;':''}">
        <div style="font-size:13px;font-weight:700;">${escHtml(s.name)} ${isNA?'<span class="badge badge-gray">No Attendance</span>':''}${joinedMid?`<span class="badge badge-orange" style="margin-left:4px;">Joined ${s.joinDate}</span>`:''}</div>
        <div style="font-size:11px;color:var(--gray);">${escHtml(s.batch||'')}</div>
        <div style="display:flex;gap:10px;margin-top:5px;font-size:12px;">
          <span style="color:#4ade80;">✅ ${p}/${studentClassDays.length} days</span>
          <span style="color:#f87171;">❌ ${a} absent</span>
          <span style="color:var(--gray);">🏃 ${l} leave</span>
        </div>
        ${datePres.length?`<div style="font-size:10px;color:var(--graydk);margin-top:3px;">Present dates: ${datePres.join(', ')}</div>`:''}
      </div>`;
    };

    attended.forEach(s => html += monthRow(s, false));
    if (notAttended.length) {
      html += `<div style="margin:8px 0 5px;font-size:11px;color:var(--gray);">— No attendance this month (fee-exempt) —</div>`;
      notAttended.forEach(s => html += monthRow(s, true));
    }
    if (!enrolled.length) html = `<div class="empty-state">No students enrolled this month.</div>`;
    wrap.innerHTML = html;
    summBar.innerHTML = `<div class="att-summary-bar">
      <span style="color:var(--gold);">📅 ${totalClassDays} class days</span>
      <span style="color:#4ade80;">✅ ${attended.length} attended</span>
      <span style="color:var(--gray);">— ${notAttended.length} absent all month</span>
    </div>`;
  }
}

function updateWheel(enrolled, p, a, l, classDay) {
  const total = enrolled.length;
  const circ = 276.5;
  const pD = total && classDay ? (p/total*circ) : 0;
  const aD = total && classDay ? (a/total*circ) : 0;
  const lD = total && classDay ? (l/total*circ) : 0;
  document.getElementById('wP').setAttribute('stroke-dasharray', `${pD} ${circ-pD}`);
  document.getElementById('wP').setAttribute('stroke-dashoffset', '0');
  document.getElementById('wA').setAttribute('stroke-dasharray', `${aD} ${circ-aD}`);
  document.getElementById('wA').setAttribute('stroke-dashoffset', `${-pD}`);
  document.getElementById('wL').setAttribute('stroke-dasharray', `${lD} ${circ-lD}`);
  document.getElementById('wL').setAttribute('stroke-dashoffset', `${-(pD+aD)}`);
  document.getElementById('wTotal').textContent = total;
  document.getElementById('wPNum').textContent = p;
  document.getElementById('wANum').textContent = a;
  document.getElementById('wLNum').textContent = l;
}
function toggleOverview(e) {
  e.stopPropagation();
  document.getElementById('attOverviewPopup').classList.toggle('show');
}

// ----------------------------------------------------------------
// FEES
// ----------------------------------------------------------------
let feeFilterMode = 'month'; // 'month' | 'year'

function updateFeeNavLabel() {
  const mSel  = document.getElementById('feeMonth');
  const ySel  = document.getElementById('feeYear');
  const yoSel = document.getElementById('feeYearOnly');
  const lbl   = document.getElementById('feeNavLabel');
  const lbl2  = document.getElementById('feeNavLabel2');
  const yLbl  = document.getElementById('feeYearNavLabel');
  if (mSel && ySel) {
    const m = parseInt(mSel.value);
    const text = MONTHS[m-1].substring(0,3) + ' ' + ySel.value;
    if (lbl)  lbl.textContent  = text;
    if (lbl2) lbl2.textContent = text;
  }
  if (yLbl && yoSel) yLbl.textContent = yoSel.value;
}
function toggleFeeNav() {
  const body    = document.getElementById('feeNavBody');
  const chevron = document.getElementById('feeNavChevron');
  const btn     = document.getElementById('feeNavToggleBtn');
  if (!body) return;
  const open = body.style.display === 'block';
  body.style.display = open ? 'none' : 'block';
  if (chevron) chevron.style.transform = open ? '' : 'rotate(180deg)';
  if (btn) btn.style.borderRadius = open ? '10px' : '10px 10px 0 0';
}
function initFeeFilters() {
  const now = new Date();
  const ySel  = document.getElementById('feeYear');
  const mSel  = document.getElementById('feeMonth');
  const yoSel = document.getElementById('feeYearOnly');
  if (!ySel) return;
  // Plan-based history limit
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  const histYears = plan === 'premium' ? 10 : plan === 'pro' ? 1 : 0;
  const minYear = now.getFullYear() - histYears;
  [ySel, yoSel].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '';
    for (let y = minYear; y <= now.getFullYear()+1; y++)
      sel.innerHTML += `<option${y===now.getFullYear()?' selected':''}>${y}</option>`;
  });
  if (mSel) mSel.innerHTML = MONTHS.map((mn,i) =>
    `<option value="${i+1}"${i===now.getMonth()?' selected':''}>${mn}</option>`).join('');
  updateFeeNavLabel();
  syncFeeDisplaySelects();
}

function setFeeFilterMode(mode) {
  feeFilterMode = mode;
  const monthBtn = document.getElementById('feeFilterMonthBtn');
  const yearBtn  = document.getElementById('feeFilterYearBtn');
  // Toggle month nav visibility in the single-line row
  const monthNavBtns = document.getElementById('feeMonthNavBtns');
  const monthDivider = document.getElementById('feeMonthDivider');

  if (mode === 'month') {
    if (monthNavBtns) { monthNavBtns.style.display = 'contents'; }
    if (monthDivider) { monthDivider.style.display = ''; }
    if (monthBtn) { monthBtn.style.background='var(--accent2)'; monthBtn.style.color='#fff'; monthBtn.style.borderColor='var(--accent2)'; }
    if (yearBtn)  { yearBtn.style.background='var(--card2)';    yearBtn.style.color='var(--offwhite)'; yearBtn.style.borderColor='var(--border)'; }
  } else {
    // Year mode — hide month nav
    if (monthNavBtns) { monthNavBtns.style.display = 'none'; }
    if (monthDivider) { monthDivider.style.display = 'none'; }
    if (yearBtn)  { yearBtn.style.background='var(--accent2)';  yearBtn.style.color='#fff'; yearBtn.style.borderColor='var(--accent2)'; }
    if (monthBtn) { monthBtn.style.background='var(--card2)';   monthBtn.style.color='var(--offwhite)'; monthBtn.style.borderColor='var(--border)'; }
    // sync year selectors
    const fy = document.getElementById('feeYear').value;
    const yo = document.getElementById('feeYearOnly');
    if (yo) yo.value = fy;
  }
  updateFeeNavLabel();
  syncFeeDisplaySelects();
  // Update mode badge in collapsed header
  const badge = document.getElementById('feeModeBadge');
  if (badge) badge.textContent = mode === 'month' ? 'Monthly' : 'Yearly';
  renderFees();
}

function getFeeKey() {
  const y = document.getElementById('feeYear')?.value || new Date().getFullYear();
  const m = pad(document.getElementById('feeMonth')?.value || (new Date().getMonth()+1));
  return `${y}-${m}`;
}
function getFeeYear() {
  if (feeFilterMode === 'year') {
    return parseInt(document.getElementById('feeYearOnly')?.value || new Date().getFullYear());
  }
  return parseInt(document.getElementById('feeYear')?.value || new Date().getFullYear());
}
function isPaid(entry) {
  if (!entry || entry.status !== 'paid') return false;
  const amt = parseInt(entry.amount);
  return !isNaN(amt) && amt > 0;
}

function openFeeModal(sid) {
  const s = DB.students.find(x => x.id === sid);
  if (!s) return;
  // Resolve which sport this fee is for (ALL mode → student's sport, prompt if multiple)
  let modalSport = feeCurrentSport();
  if (modalSport === 'ALL') {
    const single = studentSingleSport(sid);
    if (!single) {
      promptSportForStudent(sid, (chosen) => { _feeModalSport = chosen; _openFeeModalFor(sid); });
      return;
    }
    modalSport = single;
  }
  _feeModalSport = modalSport;
  _openFeeModalFor(sid);
}
let _feeModalSport = null;
function _openFeeModalFor(sid) {
  const s = DB.students.find(x => x.id === sid);
  if (!s) return;
  // Pre-fill month/year from current fee filter
  const fk = getFeeKey();
  const [fy, fm] = fk.split('-').map(Number);

  // Finalized? — block all edits for this sport+month
  if (isFeeDone(fk, _feeModalSport)) {
    showToast('Fees for this month are finalized and locked.', 'warn');
    return;
  }

  // Load existing entry if any (for the resolved fee sport)
  const existing = feeGet(fk, sid, _feeModalSport);

  // Staff restriction: only admin can EDIT an already-saved entry (one that has a 'by' field)
  // Staff CAN do the first-time entry (no existing record, or record with no 'by')
  const alreadySaved = existing && existing.by;
  if (!isAdmin() && alreadySaved) {
    showToast('Only admin can edit a fee that has already been entered.', 'error');
    return;
  }

  document.getElementById('feeStudId').value = sid;
  document.getElementById('feeStudName').textContent = s.name;
  document.getElementById('feeStudBatch').textContent = s.batch || '';
  document.getElementById('feeStudContact').textContent = s.contact ? '📞 ' + s.contact : '';
  document.getElementById('modalFeeTitle').textContent = (existing ? '✏️ Edit Fee' : '💳 Add Fee') + ' — ' + MONTHS[fm-1] + ' ' + fy;

  const mSel = document.getElementById('feeEntryMonth');
  const ySel = document.getElementById('feeEntryYear');
  mSel.innerHTML = MONTHS.map((m,i) => `<option value="${i+1}"${i+1===fm?' selected':''}>${m}</option>`).join('');
  ySel.innerHTML = '';
  for (let y = fy-1; y <= fy+1; y++) ySel.innerHTML += `<option${y===fy?' selected':''}>${y}</option>`;

  if (existing) {
    document.getElementById('feeEntryStatus').value = existing.status || 'unpaid';
    document.getElementById('feeAmount').value = existing.amount || '';
    document.getElementById('feeMethod').value = existing.method || 'cash';
  } else {
    document.getElementById('feeEntryStatus').value = 'paid';
    document.getElementById('feeAmount').value = '';
    document.getElementById('feeMethod').value = 'cash';
  }

  // Lock month/year selectors for staff (first-entry only)
  const lockForStaff = !isAdmin();
  mSel.disabled = lockForStaff;
  ySel.disabled = lockForStaff;

  // Show who collected previously if editing
  const byInfo = document.getElementById('feeByInfo');
  if (byInfo) {
    if (existing && existing.by) {
      byInfo.textContent = 'Last saved by: ' + existing.by + (existing.date ? ' on ' + new Date(existing.date).toLocaleDateString() : '');
      byInfo.style.display = '';
    } else {
      byInfo.style.display = 'none';
    }
  }

  toggleFeeFields();
  openModal('modalFee');
}
function toggleFeeFields() {
  const paid = document.getElementById('feeEntryStatus').value === 'paid';
  document.getElementById('feeAmtFields').style.display = paid ? 'block' : 'none';
}
function saveFeeEntry() {
  const sid = document.getElementById('feeStudId').value;
  const status = document.getElementById('feeEntryStatus').value;
  const amount = parseInt(document.getElementById('feeAmount').value) || 0;
  const method = document.getElementById('feeMethod').value;
  const m = parseInt(document.getElementById('feeEntryMonth').value);
  const y = parseInt(document.getElementById('feeEntryYear').value);
  const fk = `${y}-${pad(m)}`;

  if (status === 'paid' && (!amount || amount < 1)) {
    showToast('Please enter a valid amount','error'); return;
  }
  const s = DB.students.find(x => x.id === sid);
  const sp = (_feeModalSport && _feeModalSport !== 'ALL') ? _feeModalSport : feeCurrentSport();
  confirm_('💳','Save Payment',`Save ${sp} fee for "${s?.name}" — ${MONTHS[m-1]} ${y}?`, () => {
    const feeObj = { status, amount, method, date: new Date().toISOString(), by: currentUser.name || currentUser.id };
    feeSet(fk, sid, feeObj, sp);
    sbSetFee(sid, fk, feeObj, sp);
    addLog('fee', `${s?.name}: ${sp} ${status} ₹${amount} for ${fk}`);
    closeModal('modalFee');
    renderFees();
    loadDashboard();
    showToast('Payment saved ✓','success');
    // After a PAID entry, offer to send a thank-you greeting (Send / Skip)
    if (status === 'paid' && s && s.contact) {
      const monthLabel = MONTHS[m-1] + ' ' + y;
      setTimeout(() => {
        confirm_('🎉', 'Send Payment Greeting',
          `Send a payment received thank-you to ${s.name} via WhatsApp?`,
          () => { openThankMsgModal(sid, fk, amount, method); },
          'Send Message', 'Skip');
      }, 400);
    }
  });
}

function populateFeeSportSelect() {
  const sel = document.getElementById('feeSportSelect');
  if (!sel) return;
  let sports = Array.isArray(DB.sports) ? DB.sports : [];
  if (!isAdmin()) {
    const ss = getStaffSports();
    sports = sports.filter(sp => ss.includes(sp));
  }
  if (!sports.length) { sel.innerHTML = '<option value="">— No sports —</option>'; return; }
  if (_feeSport !== 'ALL' && !sports.includes(_feeSport)) _feeSport = 'ALL';
  sel.innerHTML = `<option value="ALL"${_feeSport==='ALL'?' selected':''}>All Sports</option>` +
    sports.map(s => `<option value="${escHtml(s)}"${s===_feeSport?' selected':''}>${escHtml(s)}</option>`).join('');
  populateFeeBatchFilter();
}
function populateFeeBatchFilter() {
  const sel = document.getElementById('feeBatchFilter');
  if (!sel) return;
  const sp = feeCurrentSport();
  const staffBatches = getStaffBatches();
  let batches = sp === 'ALL'
    ? DB.batches.slice()
    : DB.batches.filter(b => (DB.batchSport && DB.batchSport[b]) === sp);
  if (staffBatches.length) batches = batches.filter(b => staffBatches.includes(b));
  const cur = selectedBatch.fee;
  if (!batches.includes(cur) && cur !== 'ALL') selectedBatch.fee = 'ALL';
  let opts = staffBatches.length ? '' : '<option value="ALL">All Batches</option>';
  opts += batches.map(b => `<option value="${escHtml(b)}"${selectedBatch.fee===b?' selected':''}>${escHtml(b)}</option>`).join('');
  sel.innerHTML = opts || '<option value="ALL">All Batches</option>';
}
function onFeeBatchFilterChange() {
  const sel = document.getElementById('feeBatchFilter');
  if (sel) selectedBatch.fee = sel.value;
  renderFees();
}
function onFeeSportChange() {
  const sel = document.getElementById('feeSportSelect');
  if (sel) _feeSport = sel.value;
  selectedBatch.fee = 'ALL';
  populateFeeBatchFilter();
  renderFees();
}

function renderFees() {
  const statusFilter = document.getElementById('feeStatusFilter').value;
  const batch = selectedBatch.fee;
  const wrap = document.getElementById('feeListWrap');
  const searchQ = (document.getElementById('feeSearch').value || '').trim().toLowerCase();

  // ---- Determine filter range ----
  let rangeLabel = '';
  let feeMonthKeys = [];

  if (feeFilterMode === 'year') {
    // Full year mode — show all 12 months of selected year
    const fy = getFeeYear();
    rangeLabel = 'Full Year ' + fy;
    for (let m = 1; m <= 12; m++) feeMonthKeys.push(`${fy}-${pad(m)}`);
  } else {
    // Single month mode
    const fk = getFeeKey();
    const [fy, fm] = fk.split('-').map(Number);
    rangeLabel = MONTHS[fm-1] + ' ' + fy;
    feeMonthKeys = [fk];
  }

  const feeSp = feeCurrentSport();
  const _feeSportSids = feeSp === 'ALL'
    ? new Set((DB.enrollments||[]).map(e => e.studentId))
    : new Set((DB.enrollments||[]).filter(e => e.sport === feeSp).map(e => e.studentId));
  let students = getActiveStudents().filter(s => _feeSportSids.has(s._sid || s.id));
  // Staff are limited to their assigned batches AND sports; no assignment = see nothing
  if (!isAdmin()) {
    const sb = getStaffBatches();
    const ss = getStaffSports();
    students = sb.length ? students.filter(s => sb.includes(s.batch)) : [];
    if (ss.length) {
      const spSids = new Set((DB.enrollments||[]).filter(e => ss.includes(e.sport)).map(e => e.studentId));
      students = students.filter(s => spSids.has(s._sid || s.id));
    } else {
      students = [];
    }
  }
  if (batch !== 'ALL') students = students.filter(s => s.batch === batch);
  if (searchQ) students = students.filter(s =>
    (s.name||'').toLowerCase().includes(searchQ) ||
    String(s.rollNo||'').toLowerCase().includes(searchQ)
  );
  // Sort
  const feeSortBy = document.getElementById('feeSortBy')?.value || 'roll_asc';
  students.sort(makeSorter(feeSortBy));

  // For year mode: show all months grouped with paid/unpaid sections
  if (feeFilterMode === 'year' && feeMonthKeys.length > 1) {
    let totalPaid = 0, totalUnpaid = 0, totalAmt = 0;
    let allRows = '';

    feeMonthKeys.forEach(fk => {
      const [fy, fm] = fk.split('-').map(Number);
      const feeData = feeMonthMap(fk);
      const monthStudents = students.filter(s => isEnrolledOnDate(s, fy, fm, 0));
      const eligible = monthStudents.filter(s => studentAttendedMonth(s.id, fy, fm));
      if (!eligible.length) return;

      const mPaid   = eligible.filter(s => isPaid(feeData[s.id]));
      const mUnpaid = eligible.filter(s => !isPaid(feeData[s.id]));
      if (statusFilter === 'paid'   && !mPaid.length)   return;
      if (statusFilter === 'unpaid' && !mUnpaid.length) return;

      totalPaid   += mPaid.length;
      totalUnpaid += mUnpaid.length;
      totalAmt    += mPaid.reduce((s, st) => s + parseInt((feeData[st.id]||{}).amount||0), 0);

      allRows += `<div style="padding:6px 12px;background:var(--card2);font-size:13px;font-weight:700;color:var(--gold);display:flex;justify-content:space-between;align-items:center;">
        <span>${MONTHS[fm-1]} ${fy}</span>
        <span style="font-size:11px;">✅ ${mPaid.length} paid &nbsp; ❌ ${mUnpaid.length} unpaid</span>
      </div>`;
      eligible.forEach(s => {
        const entry = feeData[s.id] || {};
        const paid = isPaid(entry);
        if (statusFilter === 'paid'   && !paid) return;
        if (statusFilter === 'unpaid' &&  paid) return;
        allRows += `<div class="fee-row" style="border-left:3px solid ${paid?'#22c55e':'#ef4444'};padding-left:9px;">
          <div style="flex:1;min-width:0;">
            <div class="fee-name">${escHtml(s.name)}</div>
            <div style="font-size:10px;color:var(--gray);">${escHtml(s.batch||'')}${s.contact?` · <a href="tel:${escHtml(s.contact)}" style="color:var(--accent2);">${s.contact}</a>`:''}</div>
            ${entry.amount?`<div style="font-size:11px;color:${paid?'#4ade80':'var(--graydk)'};">
              <span style="font-weight:700;">₹${entry.amount}</span>
              ${entry.method ? `<span style="color:var(--gray);"> · ${entry.method}</span>` : ''}
              ${entry.date   ? `<span style="color:var(--graydk);"> · ${new Date(entry.date).toLocaleDateString()}</span>` : ''}
              ${entry.by     ? `<span style="color:var(--gold);font-weight:600;"> · 👤 ${entry.by}</span>` : ''}
            </div>`:''}
          </div>
          <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
            <button class="btn btn-primary btn-xs" onclick="openFeeModal('${s.id}')" style="white-space:nowrap;">${paid&&!isAdmin()?'🔒 Paid':paid?'✏️ Edit':'💳 Pay'}</button>
          </div>
        </div>`;
      });
    });

    wrap.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center;">
      <span style="font-size:13px;color:var(--gold);font-weight:700;">${rangeLabel}</span>
      <span class="badge badge-green">● ${totalPaid} Paid</span>
      <span class="badge badge-red">● ${totalUnpaid} Unpaid</span>
      ${isAdmin()?`<span class="badge badge-gold">₹${totalAmt.toLocaleString()} Collected</span>`:''}
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">
      ${allRows || '<div class="empty-state">No fee records for this year.</div>'}
    </div>`;
    return;
  }

  // ── Single month view ──
  const fk = feeMonthKeys[0] || getFeeKey();
  const [fy, fm] = fk.split('-').map(Number);
  const feeData = feeMonthMap(fk);

  let monthStudents = students.filter(s => isEnrolledOnDate(s, fy, fm, 0));
  const eligible   = monthStudents.filter(s => studentAttendedMonth(s.id, fy, fm));
  const notEligible= monthStudents.filter(s => !studentAttendedMonth(s.id, fy, fm));

  // Split into paid / unpaid
  const paidStudents   = eligible.filter(s => isPaid(feeData[s.id]));
  const unpaidStudents = eligible.filter(s => !isPaid(feeData[s.id]));
  const collected = paidStudents.reduce((sum,s) => sum + parseInt((feeData[s.id]||{}).amount||0), 0);

  // Row builder
  const feeRow = (s, mode) => {
    // mode: 'paid' | 'unpaid' | 'noatt'
    const entry = feeData[s.id] || {};
    const paid  = isPaid(entry);
    const joinedMid = s.joinDate && parseDate(s.joinDate) && parseDate(s.joinDate) > new Date(fy, fm-1, 1);
    // Message sent info
    const msgSentArr = entry.msgSent || [];
    const lastMsg = msgSentArr.length ? msgSentArr[msgSentArr.length-1] : null;
    const msgSentHtml = lastMsg
      ? `<span class="${lastMsg.type==='whatsapp'?'msg-whatsapp-badge':'msg-sent-badge'}" style="margin-left:4px;">${lastMsg.type==='whatsapp'?'💬 WA':'📱 SMS'} sent by ${escHtml(lastMsg.by)}</span>`
      : '';
    if (mode === 'noatt') {
      return `<div class="fee-row" style="opacity:.6;">
        <div style="flex:1;min-width:0;">
          <div class="fee-name" style="color:var(--gray);">${escHtml(s.name)}</div>
          <div style="font-size:10px;color:var(--graydk);">${escHtml(s.batch||'')}${s.contact?` · ${s.contact}`:''}</div>
        </div>
        <span class="badge badge-gray" style="flex-shrink:0;">No Attendance</span>
      </div>`;
    }
    return `<div class="fee-row" style="border-left:3px solid ${paid?'#22c55e':'#ef4444'};padding-left:9px;">
      <div style="flex:1;min-width:0;">
        <div class="fee-name">${escHtml(s.name)}${joinedMid?` <span style="font-size:9px;color:var(--gold);">Joined ${s.joinDate}</span>`:''}${!paid?msgSentHtml:''}</div>
        <div style="font-size:10px;color:var(--gray);">${escHtml(s.batch||'')}${s.contact?` · <a href="tel:${escHtml(s.contact)}" style="color:var(--accent2);">${s.contact}</a>`:''}</div>
        ${entry.amount?`<div style="font-size:11px;color:${paid?'#4ade80':'var(--graydk)'};margin-top:2px;font-weight:${paid?'600':'400'};">
          ${paid
            ? `<span style="color:#4ade80;font-weight:700;">₹${entry.amount}</span>`
              + (entry.method ? ` <span style="color:var(--gray);">· ${entry.method}</span>` : '')
              + (entry.date   ? ` <span style="color:var(--graydk);">· ${new Date(entry.date).toLocaleDateString()}</span>` : '')
              + (entry.by     ? ` <span style="color:var(--gold);font-weight:600;">· 👤 ${entry.by}</span>` : '')
            : 'Not paid yet'}
        </div>`:''}
      </div>
      <div style="display:flex;align-items:center;gap:5px;flex-shrink:0;">
        ${!paid && s.contact && !isFeeDone(fk) ? `<button class="btn btn-xs" style="background:#25d366;color:#fff;" onclick="openSendMsgModal('${s.id}','${fk}')" title="Send fee reminder">💬</button>` : ''}
        ${isFeeDone(fk)
          ? `<button class="btn btn-xs" disabled style="white-space:nowrap;background:var(--card2);color:var(--gray);border:1px solid var(--border);cursor:not-allowed;">${paid?'🔒 Paid':'🔒 Locked'}</button>`
          : `<button class="btn btn-primary btn-xs" onclick="openFeeModal('${s.id}')" style="white-space:nowrap;${paid&&!isAdmin()?'opacity:.6;':''}">
          ${entry.by && !isAdmin() ? '🔒 Paid' : paid ? '✏️ Edit' : '💳 Pay'}
        </button>`}
      </div>
    </div>`;
  };

  // ── Summary bar ──
  let html = `<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap;align-items:center;">
    <span style="font-size:13px;color:var(--gold);font-weight:700;">${rangeLabel}</span>
    <span class="badge badge-green">● ${paidStudents.length} Paid</span>
    <span class="badge badge-red">● ${unpaidStudents.length} Unpaid</span>
    <span class="badge badge-gray">● ${notEligible.length} No Attendance</span>
    ${isAdmin()?`<span class="badge badge-gold">₹${collected.toLocaleString()} Collected</span>`:''}
  </div>`;

  // ── UNPAID SECTION ──
  if (statusFilter !== 'paid') {
    let unpaidHtml = unpaidStudents.map(s => feeRow(s,'unpaid')).join('');
    html += `<div style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;flex-wrap:wrap;">
        <div style="height:2px;flex:1;background:#ef444433;border-radius:2px;"></div>
        <span style="font-size:11px;font-weight:700;color:#f87171;white-space:nowrap;">● NOT PAID — ${unpaidStudents.length} students</span>
        <div style="height:2px;flex:1;background:#ef444433;border-radius:2px;"></div>
      </div>
      <div style="background:var(--card);border:1px solid #ef444433;border-radius:var(--radius);overflow:hidden;">
        ${unpaidHtml || '<div class="empty-state" style="color:#4ade80;">🎉 All students paid!</div>'}
      </div>
    </div>`;
  }

  // ── PAID SECTION ──
  if (statusFilter !== 'unpaid') {
    let paidHtml = paidStudents.map(s => feeRow(s,'paid')).join('');
    html += `<div style="margin-bottom:10px;">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
        <div style="height:2px;flex:1;background:#22c55e33;border-radius:2px;"></div>
        <span style="font-size:11px;font-weight:700;color:#4ade80;white-space:nowrap;">● PAID — ${paidStudents.length} students${isAdmin()?' · ₹'+collected.toLocaleString():''}</span>
        <div style="height:2px;flex:1;background:#22c55e33;border-radius:2px;"></div>
      </div>
      <div style="background:var(--card);border:1px solid #22c55e33;border-radius:var(--radius);overflow:hidden;">
        ${paidHtml || '<div class="empty-state">No paid students yet.</div>'}
      </div>
    </div>`;
  }

  // ── NO ATTENDANCE SECTION ──
  if (notEligible.length && statusFilter === 'all') {
    html += `<div>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:5px;">
        <div style="height:1px;flex:1;background:var(--border);"></div>
        <span style="font-size:10px;color:var(--gray);white-space:nowrap;">👻 NO ATTENDANCE — ${notEligible.length} excluded</span>
        <div style="height:1px;flex:1;background:var(--border);"></div>
      </div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">
        ${notEligible.map(s => feeRow(s,'noatt')).join('')}
      </div>
    </div>`;
  }

  // Done / finalize button (single-month mode only)
  if (feeFilterMode !== 'year') {
    const fkNow = getFeeKey();
    if (feeCurrentSport() === 'ALL') {
      html += `<div style="font-size:11px;color:var(--graydk);margin-top:6px;padding:8px 10px;background:var(--card2);border:1px solid var(--border);border-radius:8px;">👉 You're viewing <b>All Sports</b>. Pick a specific sport above to finalize (Done) its fees.</div>`;
    } else if (isFeeDone(fkNow)) {
      html += `<button class="btn" disabled style="width:100%;margin-top:6px;padding:12px;background:var(--card2);color:var(--gray);border:1px solid var(--border);cursor:not-allowed;font-weight:800;">🔒 Fees Finalized</button>
        <div style="font-size:11px;color:var(--graydk);margin-top:5px;padding:0 4px;">This month's ${escHtml(feeCurrentSport())} fees are locked.</div>`;
    } else if (isAdmin()) {
      html += `<button class="btn btn-primary" onclick="markFeesDone()" style="width:100%;margin-top:6px;padding:12px;font-weight:800;">✅ Done — Finalize Fees</button>
        <div style="font-size:11px;color:var(--graydk);margin-top:5px;padding:0 4px;">Click Done to lock this month's fees.</div>`;
    }
  }

  wrap.innerHTML = html;
}
let _sendMsgStudId = null, _sendMsgMonth = null, _sendMsgKind = 'reminder';

function openSendAllMsgModal(fk) {
  // Opens a WhatsApp-style send for all unpaid students who have a contact
  const [fy, fm] = fk.split('-').map(Number);
  const monthLabel = MONTHS[fm-1] + ' ' + fy;
  const feeSp = feeCurrentSport();
  const feeData = feeMonthMap(fk);
  const _spSids = feeSp === 'ALL'
    ? new Set((DB.enrollments||[]).map(e => e.studentId))
    : new Set((DB.enrollments||[]).filter(e => e.sport === feeSp).map(e => e.studentId));
  let students = getActiveStudents().filter(s => _spSids.has(s._sid || s.id));
  if (selectedBatch.fee !== 'ALL') students = students.filter(s => s.batch === selectedBatch.fee);
  const eligible = students.filter(s => isEnrolledOnDate(s, fy, fm, 0) && studentAttendedMonth(s.id, fy, fm));
  const unpaid = eligible.filter(s => !isPaid(feeData[s.id]) && s.contact);
  if (!unpaid.length) { showToast('No unpaid students with contact numbers', 'error'); return; }
  confirm_('💬', 'Send All Reminders',
    `Send ${feeSp} fee reminder to ${unpaid.length} unpaid student(s) via WhatsApp?`,
    () => {
      unpaid.forEach((s, i) => {
        setTimeout(() => {
          const msg = buildFeeMsg(s.name, monthLabel);
          const phone = s.contact.replace(/\D/g, '');
          window.open('https://wa.me/91' + phone + '?text=' + encodeURIComponent(msg), '_blank');
          // Log
          const sentBy = currentUser.name || currentUser.id;
          const sentAt = new Date().toISOString();
          if (!DB.msgLogs) DB.msgLogs = [];
          DB.msgLogs.unshift({ id: 'ml_'+Date.now()+'_'+Math.random().toString(36).slice(2,8), type: 'whatsapp', kind: 'reminder', to: s.name, contact: s.contact, month: monthLabel, by: sentBy, at: sentAt, msg });
          sbAddMsgLog({ type: 'whatsapp', kind: 'reminder', to: s.name, contact: s.contact, month: monthLabel, by: sentBy, at: sentAt, msg });
          const fo = feeEnsure(fk, s.id);
          if (!fo.msgSent) fo.msgSent = [];
          fo.msgSent.push({ type: 'whatsapp', by: sentBy, at: sentAt });
          sbSetFee(s.id, fk, fo);
        }, i * 600);
      });
      setTimeout(() => {
        addLog('message', `Bulk fee reminder (WhatsApp) sent to ${unpaid.length} students for ${monthLabel}`);
        renderFees();
        showToast(`Reminders sent to ${unpaid.length} students ✓`, 'success');
      }, unpaid.length * 600 + 200);
    });
}

function getDefaultMsgTemplate() {
  return DB.settings.msgTemplate ||
    'Dear {name}, your fee for {month} is pending at {academy}. Kindly pay at the earliest. Thank you.';
}
function getDefaultThankTemplate() {
  return DB.settings.thankTemplate ||
    'Dear {name}, we have received your fee payment for {month}. Thank you! — {academy}';
}

function buildThankMsg(studentName, monthLabel, amount, method) {
  return getDefaultThankTemplate()
    .replace(/{name}/g, studentName)
    .replace(/{month}/g, monthLabel)
    .replace(/{academy}/g, DB.settings.academyName || 'Academy')
    .replace(/{amount}/g, amount != null ? '₹' + amount : '')
    .replace(/{method}/g, method || '');
}

function buildFeeMsg(studentName, monthLabel) {
  return getDefaultMsgTemplate()
    .replace(/{name}/g, studentName)
    .replace(/{month}/g, monthLabel)
    .replace(/{academy}/g, DB.settings.academyName || 'Academy');
}

function openMsgTemplateModal() {
  if (!isAdmin()) { showToast('Only admin can edit the message template.', 'error'); return; }
  document.getElementById('msgTemplateInput').value = getDefaultMsgTemplate();
  openModal('modalMsgTemplate');
}

function saveProfileMsgTemplate() {
  if (!isAdmin()) { showToast('Only admin can edit the message template.', 'error'); return; }
  const val = (document.getElementById('profileMsgTemplate').value || '').trim();
  if (!val) { showToast('Template cannot be empty', 'error'); return; }
  DB.settings.msgTemplate = val;
  sbSaveSettings();
  addLog('settings', 'Fee reminder message template updated');
  showToast('Template saved ✓', 'success');
}
function saveProfileThankTemplate() {
  if (!isAdmin()) { showToast('Only admin can edit the message template.', 'error'); return; }
  const val = (document.getElementById('profileThankTemplate').value || '').trim();
  if (!val) { showToast('Template cannot be empty', 'error'); return; }
  DB.settings.thankTemplate = val;
  sbSaveSettings();
  addLog('settings', 'Payment thank-you template updated');
  showToast('Thank-you template saved ✓', 'success');
}

function saveMsgTemplate() {
  const val = document.getElementById('msgTemplateInput').value.trim();
  if (!val) { showToast('Template cannot be empty', 'error'); return; }
  DB.settings.msgTemplate = val;
  sbSaveSettings();
  addLog('settings', 'Fee reminder message template updated');
  closeModal('modalMsgTemplate');
  showToast('Template saved ✓', 'success');
}

function openSendMsgModal(sid, fk) {
  const s = DB.students.find(x => x.id === sid);
  if (!s) return;
  _sendMsgStudId = sid; _sendMsgMonth = fk; _sendMsgKind = 'reminder';
  const [fy, fm] = fk.split('-').map(Number);
  const monthLabel = MONTHS[fm-1] + ' ' + fy;
  document.getElementById('sendMsgStudentInfo').innerHTML =
    `<b>${escHtml(s.name)}</b> · ${escHtml(s.batch||'')}` +
    (s.contact ? ` · <span style="color:var(--accent2);">📞 ${escHtml(s.contact)}</span>` : ' · <span style="color:var(--gray);">No contact</span>');
  document.getElementById('sendMsgText').value = buildFeeMsg(s.name, monthLabel);
  const hasTel = !!s.contact;
  document.getElementById('btnSendSMS').style.opacity = hasTel ? '1' : '0.5';
  document.getElementById('btnSendWhatsApp').style.opacity = hasTel ? '1' : '0.5';
  openModal('modalSendMsg');
}
// Same modal, but pre-filled with the Payment Thank-You greeting
function openThankMsgModal(sid, fk, amount, method) {
  const s = DB.students.find(x => x.id === sid);
  if (!s) return;
  _sendMsgStudId = sid; _sendMsgMonth = fk; _sendMsgKind = 'paid';
  const [fy, fm] = fk.split('-').map(Number);
  const monthLabel = MONTHS[fm-1] + ' ' + fy;
  document.getElementById('sendMsgStudentInfo').innerHTML =
    `<b>${escHtml(s.name)}</b> · ${escHtml(s.batch||'')}` +
    (s.contact ? ` · <span style="color:var(--accent2);">📞 ${escHtml(s.contact)}</span>` : ' · <span style="color:var(--gray);">No contact</span>');
  document.getElementById('sendMsgText').value = buildThankMsg(s.name, monthLabel, amount, method);
  const hasTel = !!s.contact;
  document.getElementById('btnSendSMS').style.opacity = hasTel ? '1' : '0.5';
  document.getElementById('btnSendWhatsApp').style.opacity = hasTel ? '1' : '0.5';
  openModal('modalSendMsg');
}

function sendFeeMsg(type) {
  const s = DB.students.find(x => x.id === _sendMsgStudId);
  if (!s) return;
  const msgText = document.getElementById('sendMsgText').value.trim();
  if (!msgText) { showToast('Message cannot be empty', 'error'); return; }
  if (!s.contact) { showToast('No contact number for this student', 'error'); return; }
  const phone = s.contact.replace(/\D/g, '');
  if (type === 'whatsapp') {
    window.open('https://wa.me/91' + phone + '?text=' + encodeURIComponent(msgText), '_blank');
  } else {
    window.open('sms:' + s.contact + '?body=' + encodeURIComponent(msgText), '_blank');
  }
  // Log the sent message
  const [fy, fm] = _sendMsgMonth.split('-').map(Number);
  const monthLabel = MONTHS[fm-1] + ' ' + fy;
  const sentBy = currentUser.name || currentUser.id;
  const sentAt = new Date().toISOString();
  const logEntry = { id: 'ml_'+Date.now()+'_'+Math.random().toString(36).slice(2,8), type, kind: _sendMsgKind, to: s.name, contact: s.contact, month: monthLabel, by: sentBy, at: sentAt, msg: msgText };
  if (!DB.msgLogs) DB.msgLogs = [];
  DB.msgLogs.unshift(logEntry);
  if (DB.msgLogs.length > 200) DB.msgLogs.length = 200;
  // Save on fee entry that a message was sent
  const fk = _sendMsgMonth;
  const _fo = feeEnsure(fk, _sendMsgStudId);
  if (!_fo.msgSent) _fo.msgSent = [];
  _fo.msgSent.push({ type, by: sentBy, at: sentAt });
  sbSetFee(_sendMsgStudId, fk, _fo);
  sbAddMsgLog({ type, kind: _sendMsgKind, to: s.name, contact: s.contact, month: monthLabel, by: sentBy, at: sentAt, msg: msgText });
  addLog('message', `${_sendMsgKind === 'paid' ? 'Payment greeting' : 'Fee reminder'} sent (${type}) to ${s.name} for ${monthLabel}`);
  closeModal('modalSendMsg');
  renderFees();
  showToast('Message opened ✓', 'success');
}

function updateDashNavLabel() {
  const mSel = document.getElementById('dashMonth');
  const ySel = document.getElementById('dashYear');
  const lbl  = document.getElementById('dashNavLabel');
  if (!mSel || !ySel || !lbl) return;
  const m = parseInt(mSel.value);
  const y = ySel.value;
  lbl.textContent = MONTHS[m-1].substring(0,3) + ' ' + y;
}
function initDashFilters() {
  const now = new Date();
  const mSel = document.getElementById('dashMonth');
  const ySel = document.getElementById('dashYear');
  if (!mSel || !ySel) return;
  mSel.innerHTML = MONTHS.map((mn,i) => `<option value="${i+1}"${i===now.getMonth()?' selected':''}>${mn}</option>`).join('');
  ySel.innerHTML = '';
  for (let y = now.getFullYear()-3; y <= now.getFullYear()+1; y++)
    ySel.innerHTML += `<option${y===now.getFullYear()?' selected':''}>${y}</option>`;
  updateDashNavLabel();
}
// Populate the dashboard Sport + Batch filter dropdowns
function populateDashFilters() {
  const spSel = document.getElementById('dashSport');
  const bSel = document.getElementById('dashBatch');
  const staffSports = getStaffSports();
  const staffBatches = getStaffBatches();
  if (spSel) {
    const cur = spSel.value || 'ALL';
    let sports = Array.isArray(DB.sports) ? DB.sports : [];
    if (staffSports.length) sports = sports.filter(sp => staffSports.includes(sp));
    const stillValid = sports.includes(cur);
    spSel.innerHTML = '<option value="ALL">All Sports</option>' +
      sports.map(sp => `<option value="${escHtml(sp)}"${(stillValid && cur===sp)?' selected':''}>${escHtml(sp)}</option>`).join('');
  }
  if (bSel) {
    const cur = bSel.value || 'ALL';
    const selSport = spSel ? spSel.value : 'ALL';
    let batches = selSport === 'ALL' ? DB.batches.slice() : DB.batches.filter(b => (DB.batchSport&&DB.batchSport[b]) === selSport);
    if (staffBatches.length) batches = batches.filter(b => staffBatches.includes(b));
    const stillValid = batches.includes(cur);
    bSel.innerHTML = '<option value="ALL">All Batches</option>' +
      batches.map(b => `<option value="${escHtml(b)}"${(stillValid&&cur===b)?' selected':''}>${escHtml(b)}</option>`).join('');
  }
}
// Sport change → reset batch to ALL and refilter batch options, then reload
function onDashSportChange() {
  const bSel = document.getElementById('dashBatch');
  if (bSel) bSel.value = 'ALL';
  populateDashFilters();
  loadDashboard();
}

function navDash(type, dir) {
  const mSel = document.getElementById('dashMonth');
  const ySel = document.getElementById('dashYear');
  if (type === 'month') {
    let v = parseInt(mSel.value) + dir;
    if (v < 1)  { v = 12; ySel.selectedIndex = Math.max(0, ySel.selectedIndex-1); }
    if (v > 12) { v = 1;  ySel.selectedIndex = Math.min(ySel.options.length-1, ySel.selectedIndex+1); }
    mSel.value = v;
  } else {
    ySel.selectedIndex = Math.max(0, Math.min(ySel.options.length-1, ySel.selectedIndex+dir));
  }
  updateDashNavLabel();
  loadDashboard();
}
// Time-aware, personalized greeting shown under the academy name in the top bar.
// Refreshed on login/session-restore and every dashboard load, so it stays correct
// across the day (e.g. flips from "Good morning" to "Good afternoon" automatically).
function renderHomeGreeting() {
  const el = document.getElementById('homeGreeting');
  if (!el) return;

  const hour = new Date().getHours();
  const timeGreeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  let displayName = 'there';
  if (currentUser) {
    const raw = currentUser.name || (currentUser.email ? currentUser.email.split('@')[0] : '');
    displayName = raw ? raw.split(' ')[0] : 'there';
  }

  el.textContent = `👋 ${timeGreeting}, ${displayName}`;
}

function loadDashboard() {
  renderHomeGreeting();
  updateDashNavLabel();
  populateDashFilters();

  // Read selected month/year from the filter selectors
  const mSel = document.getElementById('dashMonth');
  const ySel = document.getElementById('dashYear');
  const m = mSel ? parseInt(mSel.value) : new Date().getMonth()+1;
  const y = ySel ? parseInt(ySel.value) : new Date().getFullYear();
  const fk = `${y}-${pad(m)}`;

  document.getElementById('dashMonthLabel').textContent = MONTHS[m-1] + ' ' + y;
  const joinedLbl = document.getElementById('statJoinedLabel');
  if (joinedLbl) joinedLbl.textContent = 'Joined (' + MONTHS[m-1].substring(0,3) + ')';

  const staffBatches = getStaffBatches();
  const staffSports  = getStaffSports();
  let actives = getActiveStudents();
  if (!isAdmin()) {
    actives = staffBatches.length ? actives.filter(s => staffBatches.includes(s.batch)) : [];
    if (staffSports.length) {
      const spSids = new Set((DB.enrollments||[]).filter(e => staffSports.includes(e.sport)).map(e => e.studentId));
      actives = actives.filter(s => spSids.has(s._sid || s.id));
    } else {
      actives = [];
    }
  }

  // Dashboard-only Sport + Batch filter
  const dashSport = document.getElementById('dashSport')?.value || 'ALL';
  const dashBatch = document.getElementById('dashBatch')?.value || 'ALL';
  if (dashSport !== 'ALL') {
    const spSids = new Set((DB.enrollments||[]).filter(e => e.sport === dashSport).map(e => e.studentId));
    actives = actives.filter(s => spSids.has(s._sid || s.id));
  }
  if (dashBatch !== 'ALL') actives = actives.filter(s => s.batch === dashBatch);

  document.getElementById('statTotal').textContent = actives.length;

  // Joined tile: students who joined in the selected month
  const joinedThisMonth = actives.filter(s => {
    if (!s.joinDate) return false;
    const jd = parseDate(s.joinDate);
    if (!jd) return false;
    return jd.getFullYear() === y && (jd.getMonth() + 1) === m;
  });
  document.getElementById('statTodayPresent').textContent = joinedThisMonth.length;

  // Monthly attendance summary (all class days in the selected month)
  const prefix = `${y}-${pad(m)}-`;
  const classDays = Object.keys(DB.attendance).filter(k => k.startsWith(prefix) && isClassDay(k));
  let totalPresent=0, totalAbsent=0, totalLeave=0;
  // Count across ALL enrolled students across ALL class days
  const enrolledInMonth = actives.filter(s => isEnrolledOnDate(s, y, m, 0));
  classDays.forEach(dk => {
    const daySports = DB.attendance[dk] || {}; // { sport: { sid: status } }
    enrolledInMonth.forEach(s => {
      if (!isEnrolledOnKey(s, dk)) return;
      // Count this student's mark across every sport they have a record in that day
      let counted = false;
      Object.keys(daySports).forEach(sportName => {
        const v = daySports[sportName][s.id];
        if (v==='P') { totalPresent++; counted = true; }
        else if (v==='A') { totalAbsent++; counted = true; }
      });
      if (!counted) totalLeave++;
    });
  });
  document.getElementById('dashPresent').textContent = totalPresent;
  document.getElementById('dashAbsent').textContent = totalAbsent;
  document.getElementById('dashLeave').textContent = totalLeave;
  document.getElementById('dashHoliday').textContent = classDays.length;

  // Selected month fees — summed across ALL sports
  const feeMonthAllSports = DB.fees[fk] || {}; // { sport: { sid: feeObj } }
  let collected=0, pendList=[];
  actives.forEach(s => {
    if (!isEnrolledOnDate(s, y, m, 0)) return;
    if (!studentAttendedMonth(s.id, y, m)) return;
    const sid = s.id;
    // This student's enrolled sports
    const mySports = (DB.enrollments||[]).filter(e => e.studentId === (s._sid||s.id)).map(e => e.sport);
    let anyUnpaid = false;
    mySports.forEach(sp => {
      const entry = (feeMonthAllSports[sp] || {})[sid];
      if (isPaid(entry)) collected += parseInt(entry.amount);
      else anyUnpaid = true;
    });
    if (!mySports.length || anyUnpaid) pendList.push(s);
  });

  document.getElementById('statPending').textContent = pendList.length;
  document.getElementById('dashPendCount').textContent = pendList.length + ' students';
  const collCard = document.getElementById('statCollectedCard');
  if (collCard) collCard.style.display = isAdmin() ? '' : 'none';
  document.getElementById('statCollected').textContent = collected.toLocaleString();

  // Pending list with phone
  const pendEl = document.getElementById('pendingList');
  if (pendList.length) {
    pendEl.innerHTML = `<div style="font-size:11px;color:var(--gray);margin-bottom:5px;">${MONTHS[m-1]} ${y} — unpaid students who attended class:</div>` +
      pendList.map(s =>
        `<div class="pending-item">
          <div class="pending-name">${escHtml(s.name)} <span style="font-size:10px;color:var(--graydk);">${escHtml(s.batch||'')}</span></div>
          ${s.contact?`<a href="tel:${escHtml(s.contact)}" class="pending-phone">📞 ${s.contact}</a>`:
            `<span style="font-size:11px;color:var(--graydk);">No contact</span>`}
        </div>`).join('');
  } else {
    pendEl.innerHTML = `<div style="color:#4ade80;font-size:13px;padding:8px 0;">✅ All fees collected for ${MONTHS[m-1]} ${y}!</div>`;
  }

  // Previous month (relative to selected month)
  const pm = m===1?12:m-1, py = m===1?y-1:y;
  const pfk = `${py}-${pad(pm)}`;
  document.getElementById('prevMonthLabel').textContent = MONTHS[pm-1] + ' ' + py;
  const prevFeeAllSports = DB.fees[pfk] || {};
  const prevPend = actives.filter(s => {
    if (!isEnrolledOnDate(s, py, pm, 0)) return false;
    if (!studentAttendedMonth(s.id, py, pm)) return false;
    const mySports = (DB.enrollments||[]).filter(e => e.studentId === (s._sid||s.id)).map(e => e.sport);
    if (!mySports.length) return true;
    return mySports.some(sp => !isPaid((prevFeeAllSports[sp]||{})[s.id]));
  });
  const prevEl = document.getElementById('prevMonthPending');
  if (prevPend.length) {
    prevEl.innerHTML = prevPend.map(s =>
      `<div class="pending-item">
        <div class="pending-name">${escHtml(s.name)}</div>
        ${s.contact?`<a href="tel:${escHtml(s.contact)}" class="pending-phone">📞 ${s.contact}</a>`:''}
      </div>`).join('');
  } else {
    prevEl.innerHTML = `<div style="color:var(--gray);font-size:12px;padding:6px 0;">No pending from ${MONTHS[pm-1]} ${py}.</div>`;
  }
  // Render charts
  renderDashChart();
  renderHomeTileChart();
}

// ----------------------------------------------------------------
// DASHBOARD CHART
// ----------------------------------------------------------------
let dashChartMode = 'present'; // 'present' | 'joined'
let chartMaxMode = 'present';
let chartMaxOrientation = 'vertical'; // 'vertical' | 'horizontal'

function setDashChartMode(mode) {
  dashChartMode = mode;
  _syncChartModeButtons('chartBtnPresent','chartBtnJoined', mode);
  renderDashChart();
}
function setChartMaxMode(mode) {
  chartMaxMode = mode;
  _syncChartModeButtons('chartMaxBtnAtt','chartMaxBtnJoin', mode);
  renderChartMax();
}
function setChartMaxOrientation(orient) {
  chartMaxOrientation = orient;
  const bV = document.getElementById('chartMaxBtnV');
  const bH = document.getElementById('chartMaxBtnH');
  if (bV && bH) {
    if (orient === 'vertical') {
      bV.style.background='var(--accent2)'; bV.style.color='#fff';
      bH.style.background='transparent'; bH.style.color='var(--gray)';
    } else {
      bH.style.background='var(--accent2)'; bH.style.color='#fff';
      bV.style.background='transparent'; bV.style.color='var(--gray)';
    }
  }
  renderChartMax();
}
function _syncChartModeButtons(idA, idB, mode) {
  const bA = document.getElementById(idA);
  const bB = document.getElementById(idB);
  if (!bA || !bB) return;
  if (mode === 'present') {
    bA.style.background='var(--accent2)'; bA.style.color='#fff';
    bB.style.background='transparent'; bB.style.color='var(--gray)';
  } else {
    bB.style.background='var(--accent2)'; bB.style.color='#fff';
    bA.style.background='transparent'; bA.style.color='var(--gray)';
  }
}

function openChartMax() {
  // Sync controls from mini chart
  chartMaxMode = dashChartMode;
  _syncChartModeButtons('chartMaxBtnAtt','chartMaxBtnJoin', chartMaxMode);
  const mm = document.getElementById('chartRangeMonths');
  const my = document.getElementById('chartRangeYears');
  const cm = document.getElementById('chartMaxMonths');
  const cy = document.getElementById('chartMaxYears');
  if (mm && cm) cm.value = mm.value;
  if (my && cy) cy.value = my.value;
  chartMaxOrientation = 'vertical';
  setChartMaxOrientation('vertical');

  // Inject pageChartMax into page order temporarily and navigate
  const pages = document.querySelectorAll('.page');
  pages.forEach(p => {
    p.classList.remove('active','slide-out-left','slide-out-right');
    p.style.transform = '';
  });
  const pg = document.getElementById('pageChartMax');
  pg.style.transform = '';
  pg.classList.add('active');
  setTimeout(() => renderChartMax(), 80);
}

function closeChartMax() {
  const pg = document.getElementById('pageChartMax');
  pg.classList.remove('active');
  pg.style.transform = '';
  // Restore home page
  const home = document.getElementById('pageHome');
  home.style.transform = '';
  home.classList.add('active');
}

// Build months array from selected range
function _buildMonthRange(selM, selY, numMonths, numYears) {
  const totalMonths = numMonths * numYears;
  const months = [];
  for (let i = totalMonths - 1; i >= 0; i--) {
    let mo = selM - i;
    let yr = selY;
    while (mo < 1) { mo += 12; yr--; }
    months.push({ m: mo, y: yr });
  }
  return months;
}

function _buildChartDataDaily(m, y, mode) {
  const actives = _applyDashFilter(getActiveStudents());
  const blocked = _applyDashFilter(getBannedStudents());
  const allStudents = _applyDashFilter(DB.students);
  const dim = daysInMonth(y, m);
  // If viewing the current month, only show days up to today
  const now = new Date();
  const isCurrentMonth = (y === now.getFullYear() && m === now.getMonth() + 1);
  const lastDay = isCurrentMonth ? Math.min(now.getDate(), dim) : dim;
  const out = [];
  for (let day = 1; day <= lastDay; day++) {
    const dateKey = `${y}-${pad(m)}-${pad(day)}`;
    const label = String(day);
    if (mode === 'present') {
      const daySports = DB.attendance[dateKey] || {};
      const enrolled = allStudents.filter(s => isEnrolledOnKey(s, dateKey) && isActiveOnDate(s, y, m, day));
      let present = 0, absent = 0;
      enrolled.forEach(s => {
        Object.keys(daySports).forEach(sportName => {
          const v = daySports[sportName][s.id];
          if (v === 'P') present++;
          else if (v === 'A') absent++;
        });
      });
      out.push({ onTime: present, notOnTime: absent, label });
    } else {
      const enrolledActive  = actives.filter(s => isEnrolledOnKey(s, dateKey) && isActiveOnDate(s, y, m, day));
      const enrolledDropped = blocked.filter(s => isEnrolledOnKey(s, dateKey) && !isActiveOnDate(s, y, m, day));
      out.push({ onTime: enrolledActive.length, notOnTime: enrolledDropped.length, label });
    }
  }
  return out;
}

// Apply the dashboard Sport+Batch filter to a student list
function _applyDashFilter(arr) {
  const dashSport = document.getElementById('dashSport')?.value || 'ALL';
  const dashBatch = document.getElementById('dashBatch')?.value || 'ALL';
  let out = arr;
  if (dashSport !== 'ALL') {
    const spSids = new Set((DB.enrollments||[]).filter(e => e.sport === dashSport).map(e => e.studentId));
    out = out.filter(s => spSids.has(s._sid || s.id));
  }
  if (dashBatch !== 'ALL') out = out.filter(s => s.batch === dashBatch);
  return out;
}
function _buildChartData(months, mode) {
  const actives = _applyDashFilter(getActiveStudents());
  const blocked = _applyDashFilter(getBannedStudents());
  return months.map(({ m, y }) => {
    if (mode === 'present') {
      const prefix = `${y}-${pad(m)}-`;
      const classDays = Object.keys(DB.attendance).filter(k => k.startsWith(prefix) && isClassDay(k));
      if (!classDays.length) return { onTime: 0, notOnTime: 0, label: MONTHS[m-1].substring(0,3) + '\'' + String(y).slice(2) };
      const enrolled = actives.filter(s => isEnrolledOnDate(s, y, m, 0));
      const attended = enrolled.filter(s => studentAttendedMonth(s.id, y, m));
      return { onTime: attended.length, notOnTime: enrolled.length - attended.length, label: MONTHS[m-1].substring(0,3) + '\'' + String(y).slice(2) };
    } else {
      // Strength mode: active students vs blocked students enrolled by this month
      const enrolledActive  = actives.filter(s => isEnrolledOnDate(s, y, m, 0));
      const enrolledBlocked = blocked.filter(s => isEnrolledOnDate(s, y, m, 0));
      return { onTime: enrolledActive.length, notOnTime: enrolledBlocked.length, label: MONTHS[m-1].substring(0,3) + '\'' + String(y).slice(2) };
    }
  });
}

function renderDashChart() {
  const canvas = document.getElementById('dashBarChart');
  if (!canvas) return;

  const mSel = document.getElementById('dashMonth');
  const ySel = document.getElementById('dashYear');
  const selM = mSel ? parseInt(mSel.value) : new Date().getMonth()+1;
  const selY = ySel ? parseInt(ySel.value) : new Date().getFullYear();
  const numMonths = parseInt(document.getElementById('chartRangeMonths')?.value || 6);
  const numYears  = parseInt(document.getElementById('chartRangeYears')?.value  || 1);

  const months = _buildMonthRange(selM, selY, numMonths, numYears);
  const data = _buildChartData(months, dashChartMode);

  const titleEl = document.getElementById('dashChartTitle');
  if (titleEl) titleEl.textContent = dashChartMode==='present' ? '📊 Attendance' : '📊 Students Strength';

  // Update legend labels based on mode
  const leg1 = document.getElementById('dashChartLegend1');
  const leg2 = document.getElementById('dashChartLegend2');
  const legAvg = document.getElementById('dashChartLegendAvg');
  if (leg1) { leg1.querySelector('span').style.background = dashChartMode==='present'?'#22c55e':'#2563eb'; leg1.childNodes[leg1.childNodes.length-1].textContent = dashChartMode==='present'?' Attended':' Active'; }
  if (leg2) { leg2.querySelector('span').style.background = dashChartMode==='present'?'#f97316':'#ef4444'; leg2.childNodes[leg2.childNodes.length-1].textContent = dashChartMode==='present'?' Absent':' Blocked'; }
  if (legAvg) legAvg.style.display = dashChartMode==='present' ? 'flex' : 'none';

  _drawStackedBars(canvas, data, dashChartMode, false);
}

// ── HOME TILE CHART ──────────────────────────────────────────────
let homeTileMode = 'present'; // 'present' | 'joined'

function setHomeTileMode(mode) {
  homeTileMode = mode;
  const bAtt = document.getElementById('homeTileBtnAtt');
  const bStr = document.getElementById('homeTileBtnStr');
  if (bAtt && bStr) {
    if (mode === 'present') {
      bAtt.style.background = 'var(--accent2)'; bAtt.style.color = '#fff';
      bStr.style.background = 'transparent';    bStr.style.color = 'var(--gray)';
    } else {
      bStr.style.background = 'var(--accent2)'; bStr.style.color = '#fff';
      bAtt.style.background = 'transparent';    bAtt.style.color = 'var(--gray)';
    }
  }
  renderHomeTileChart();
}

function renderHomeTileChart() {
  const canvas = document.getElementById('homeTileCanvas');
  if (!canvas) return;

  // Update title and legend
  const titleEl = document.getElementById('homeTileChartTitle');
  const leg1Dot  = document.getElementById('legendDot1');
  const leg1Text = document.getElementById('legendLabel1');
  const leg2Dot  = document.getElementById('legendDot2');
  const leg2Text = document.getElementById('legendLabel2');

  if (homeTileMode === 'present') {
    if (titleEl) titleEl.textContent = '📊 Attendance';
    if (leg1Dot)  leg1Dot.style.background  = '#4caf8e';
    if (leg1Text) leg1Text.textContent       = 'Present';
    if (leg2Dot)  leg2Dot.style.background  = '#e06b6b';
    if (leg2Text) leg2Text.textContent       = 'Absent';
  } else {
    if (titleEl) titleEl.textContent = '📊 Strength';
    if (leg1Dot)  leg1Dot.style.background  = '#5b7cc4';
    if (leg1Text) leg1Text.textContent       = 'Active';
    if (leg2Dot)  leg2Dot.style.background  = '#e0a05a';
    if (leg2Text) leg2Text.textContent       = 'Dropped';
  }

  const mSel = document.getElementById('dashMonth');
  const ySel = document.getElementById('dashYear');
  const selM = mSel ? parseInt(mSel.value) : new Date().getMonth() + 1;
  const selY = ySel ? parseInt(ySel.value) : new Date().getFullYear();

  // Daily data for the selected month
  const data = _buildChartDataDaily(selM, selY, homeTileMode);

  _drawHomeTileBars(canvas, data, homeTileMode);
}

function _drawHomeTileBars(canvas, data, mode) {
  const dpr = window.devicePixelRatio || 1;
  const containerW = canvas.parentElement.offsetWidth || 300;
  const H = 160;
  // Line chart fits the container — no horizontal scroll
  const W = containerW;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const fs = 9;
  const padL = 28, padR = 8, padT = 12, padB = 30;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const nGroups  = data.length;
  const groupW = chartW / nGroups;
  const maxVal = Math.max(...data.map(d => Math.max(d.onTime, d.notOnTime)), 1);

  // Line 1 = present/active (green/blue), Line 2 = absent/dropped (orange/red)
  const col1 = mode === 'present' ? '#4caf8e' : '#5b7cc4';
  const fill1 = mode === 'present' ? 'rgba(76,175,142,0.12)' : 'rgba(91,124,196,0.12)';
  const col2 = mode === 'present' ? '#e06b6b' : '#e0a05a';

  // Y-axis labels only (no horizontal gridlines)
  for (let i = 0; i <= 4; i++) {
    const gY = padT + (chartH / 4) * i;
    ctx.fillStyle = 'rgba(90,105,130,0.9)'; ctx.font = `${fs}px sans-serif`; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), padL - 3, gY + 3);
  }

  const xOf = (i) => padL + i * groupW + groupW / 2;
  const yOf = (val) => padT + chartH - (val / maxVal * chartH);

  // Build points for both series
  const pts1 = data.map((d, i) => ({ x: xOf(i), y: yOf(d.onTime),   v: d.onTime }));
  const pts2 = data.map((d, i) => ({ x: xOf(i), y: yOf(d.notOnTime), v: d.notOnTime }));

  const buildCurve = (pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) { ctx.moveTo(p.x, p.y); return; }
      const prev = pts[i - 1];
      const cx = (prev.x + p.x) / 2;
      ctx.bezierCurveTo(cx, prev.y, cx, p.y, p.x, p.y);
    });
  };

  // Fill under line 1
  if (pts1.length > 1) {
    buildCurve(pts1);
    ctx.lineTo(pts1[pts1.length - 1].x, padT + chartH);
    ctx.lineTo(pts1[0].x, padT + chartH);
    ctx.closePath();
    ctx.fillStyle = fill1;
    ctx.fill();
  }

  // Draw a line series with dots
  const drawSeries = (pts, color) => {
    if (pts.length > 1) {
      buildCurve(pts);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    pts.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.3;
      ctx.stroke();
    });
  };

  drawSeries(pts1, col1);
  drawSeries(pts2, col2);

  // X-axis labels (skip some if crowded)
  const skip = nGroups > 16 ? Math.ceil(nGroups / 12) : 1;
  data.forEach((d, i) => {
    if (i % skip !== 0 && i !== nGroups - 1) return;
    ctx.fillStyle = 'rgba(90,105,130,0.95)';
    ctx.font = `${fs}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(d.label, xOf(i), H - padB + fs + 5);
  });

  // Store points and bind hover/tap for the dashboard chart
  const labelP = mode === 'present' ? 'Present' : 'Active';
  const labelN = mode === 'present' ? 'Absent' : 'Dropped';
  _homeTilePts = {
    pts1: pts1.map((p, i) => ({ ...p, v: data[i].onTime, label: data[i].label })),
    pts2: pts2.map((p, i) => ({ ...p, v: data[i].notOnTime, label: data[i].label })),
    col1, col2, labelP, labelN, W
  };
  if (!canvas._tapBound) {
    canvas._tapBound = true;
    const handler = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      const cy = (ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top;
      _showHomeTileTooltip(canvas, cx, cy);
    };
    canvas.addEventListener('click', handler);
    canvas.addEventListener('touchstart', handler, { passive: true });
    canvas.addEventListener('mousemove', handler);
    canvas.addEventListener('mouseleave', () => { const t=document.getElementById('homeTileTooltip'); if(t) t.style.display='none'; });
  }
}

let _homeTilePts = null;
function _showHomeTileTooltip(canvas, cx, cy) {
  if (!_homeTilePts) return;
  const { pts1, pts2, col1, col2, labelP, labelN, W } = _homeTilePts;
  let best = null, bestDist = 9999;
  const consider = (p, color, kind) => {
    const dx = p.x - cx, dy = p.y - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < bestDist) { bestDist = dist; best = { p, color, kind }; }
  };
  pts1.forEach(p => consider(p, col1, labelP));
  pts2.forEach(p => consider(p, col2, labelN));
  let tip = document.getElementById('homeTileTooltip');
  if (!best || bestDist > 26) { if (tip) tip.style.display='none'; return; }
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'homeTileTooltip';
    tip.style.cssText = 'position:absolute;background:#1a2233;color:#fff;font-size:11px;font-weight:700;padding:4px 8px;border-radius:6px;pointer-events:none;z-index:50;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,.25);';
    canvas.parentElement.style.position = 'relative';
    canvas.parentElement.appendChild(tip);
  }
  tip.innerHTML = `<span style="color:${best.color};">●</span> ${best.kind}: ${best.p.v} (Day ${best.p.label})`;
  tip.style.display = 'block';
  // Measure actual tooltip width, then position so it never overflows the chart
  const tw = tip.offsetWidth || 120;
  let left = best.p.x + 8;
  // If it would overflow the right edge, flip it to the left of the point
  if (left + tw > W - 4) left = best.p.x - tw - 8;
  // Final clamp so it never goes past either edge
  left = Math.max(4, Math.min(left, W - tw - 4));
  tip.style.left = left + 'px';
  tip.style.top  = Math.max(best.p.y - 28, 2) + 'px';
}
// ─────────────────────────────────────────────────────────────────

function renderChartMax() {
  const canvas = document.getElementById('chartMaxCanvas');
  if (!canvas) return;

  const mSel = document.getElementById('dashMonth');
  const ySel = document.getElementById('dashYear');
  const selM = mSel ? parseInt(mSel.value) : new Date().getMonth()+1;
  const selY = ySel ? parseInt(ySel.value) : new Date().getFullYear();
  const numMonths = parseInt(document.getElementById('chartMaxMonths')?.value || 6);
  const numYears  = parseInt(document.getElementById('chartMaxYears')?.value  || 1);

  const titleEl = document.getElementById('chartMaxTitle');
  if (titleEl) titleEl.textContent = chartMaxMode==='present' ? '📊 Attendance' : '📊 Students Strength';
  const leg2 = document.getElementById('chartMaxLeg2');
  const leg1 = document.getElementById('chartMaxLeg1');
  if (leg1) { const sp=leg1.querySelector('span'); if(sp) sp.style.background=chartMaxMode==='present'?'#22c55e':'#2563eb'; if(leg1.lastChild) leg1.lastChild.textContent=chartMaxMode==='present'?' Attended':' Active'; }
  if (leg2) { leg2.style.display='flex'; const sp=leg2.querySelector('span'); if(sp) sp.style.background=chartMaxMode==='present'?'#f97316':'#ef4444'; if(leg2.lastChild) leg2.lastChild.textContent=chartMaxMode==='present'?' Not Attended':' Blocked'; }

  const months = _buildMonthRange(selM, selY, numMonths, numYears);
  // Use daily data for the selected month with line chart
  const data = _buildChartDataDaily(selM, selY, chartMaxMode);
  _drawLineChartMax(canvas, data, chartMaxMode);
}

// Line chart for the expanded view, with tap-to-show count
let _chartMaxPts = null;
function _drawLineChartMax(canvas, data, mode) {
  const dpr = window.devicePixelRatio || 1;
  const containerW = canvas.parentElement.offsetWidth || 320;
  const containerH = canvas.parentElement.offsetHeight || 360;
  const W = containerW, H = containerH;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const fs = 11;
  const padL = 36, padR = 14, padT = 18, padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const n = data.length;
  const maxVal = Math.max(...data.map(d => Math.max(d.onTime, d.notOnTime)), 1);

  const col1 = mode === 'present' ? '#4caf8e' : '#5b7cc4';
  const fill1 = mode === 'present' ? 'rgba(76,175,142,0.12)' : 'rgba(91,124,196,0.12)';
  const col2 = mode === 'present' ? '#e06b6b' : '#e0a05a';

  for (let i = 0; i <= 4; i++) {
    const gY = padT + (chartH / 4) * i;
    ctx.fillStyle = 'rgba(90,105,130,0.9)'; ctx.font = `${fs}px sans-serif`; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), padL - 4, gY + 4);
  }

  const xOf = (i) => padL + (n > 1 ? (chartW / (n - 1)) * i : chartW / 2);
  const yOf = (val) => padT + chartH - (val / maxVal * chartH);

  const pts1 = data.map((d, i) => ({ x: xOf(i), y: yOf(d.onTime),   v: d.onTime,   label: d.label }));
  const pts2 = data.map((d, i) => ({ x: xOf(i), y: yOf(d.notOnTime), v: d.notOnTime, label: d.label }));

  const buildCurve = (pts) => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) { ctx.moveTo(p.x, p.y); return; }
      const prev = pts[i - 1];
      const cx = (prev.x + p.x) / 2;
      ctx.bezierCurveTo(cx, prev.y, cx, p.y, p.x, p.y);
    });
  };

  if (pts1.length > 1) {
    buildCurve(pts1);
    ctx.lineTo(pts1[pts1.length - 1].x, padT + chartH);
    ctx.lineTo(pts1[0].x, padT + chartH);
    ctx.closePath();
    ctx.fillStyle = fill1; ctx.fill();
  }

  const drawSeries = (pts, color) => {
    if (pts.length > 1) {
      buildCurve(pts);
      ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
    }
    pts.forEach(p => {
      ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, 0, Math.PI*2);
      ctx.fillStyle = color; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
    });
  };
  drawSeries(pts1, col1);
  drawSeries(pts2, col2);

  const skip = n > 16 ? Math.ceil(n / 12) : 1;
  data.forEach((d, i) => {
    if (i % skip !== 0 && i !== n - 1) return;
    ctx.fillStyle = 'rgba(90,105,130,0.95)'; ctx.font = `${fs}px sans-serif`; ctx.textAlign = 'center';
    ctx.fillText(d.label, xOf(i), H - padB + fs + 6);
  });

  // Store points for tap detection
  _chartMaxPts = { pts1, pts2, col1, col2, mode, W, H, padT, padB, chartH };

  // Attach tap/hover handler once
  if (!canvas._tapBound) {
    canvas._tapBound = true;
    const handler = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - rect.left;
      const cy = (ev.touches ? ev.touches[0].clientY : ev.clientY) - rect.top;
      _showChartMaxTooltip(canvas, cx, cy);
    };
    canvas.addEventListener('click', handler);
    canvas.addEventListener('touchstart', handler, { passive: true });
    canvas.addEventListener('mousemove', handler);
    canvas.addEventListener('mouseleave', _hideChartMaxTooltip);
  }
}

function _showChartMaxTooltip(canvas, cx, cy) {
  if (!_chartMaxPts) return;
  const { pts1, pts2, col1, col2, mode } = _chartMaxPts;
  // Find nearest point across both series
  let best = null, bestDist = 9999;
  const consider = (p, color, kind) => {
    const dx = p.x - cx, dy = p.y - cy;
    const dist = Math.sqrt(dx*dx + dy*dy);
    if (dist < bestDist) { bestDist = dist; best = { p, color, kind }; }
  };
  pts1.forEach(p => consider(p, col1, mode==='present'?'Present':'Active'));
  pts2.forEach(p => consider(p, col2, mode==='present'?'Absent':'Dropped'));
  if (!best || bestDist > 30) { _hideChartMaxTooltip(); return; }

  let tip = document.getElementById('chartMaxTooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'chartMaxTooltip';
    tip.style.cssText = 'position:absolute;background:#1a2233;color:#fff;font-size:12px;font-weight:700;padding:5px 9px;border-radius:7px;pointer-events:none;z-index:50;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,.25);';
    canvas.parentElement.style.position = 'relative';
    canvas.parentElement.appendChild(tip);
  }
  tip.innerHTML = `<span style="color:${best.color};">●</span> ${best.kind}: ${best.p.v} (Day ${best.p.label})`;
  tip.style.display = 'block';
  const W = _chartMaxPts.W;
  const tw = tip.offsetWidth || 130;
  let left = best.p.x + 8;
  if (left + tw > W - 4) left = best.p.x - tw - 8;
  left = Math.max(4, Math.min(left, W - tw - 4));
  tip.style.left = left + 'px';
  tip.style.top  = Math.max(best.p.y - 30, 4) + 'px';
}
function _hideChartMaxTooltip() {
  const tip = document.getElementById('chartMaxTooltip');
  if (tip) tip.style.display = 'none';
}

// Single stacked bar chart (for home dashboard)
function _drawStackedBars(canvas, data, mode, isMax) {
  const dpr = window.devicePixelRatio || 1;
  const containerW = canvas.parentElement.offsetWidth || 300;
  const containerH = isMax ? (canvas.parentElement.offsetHeight || 360) : 130;
  const W = Math.max(containerW, data.length * 28);
  const H = containerH;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const fs = isMax ? 10 : 8;
  const nBars = data.length;
  const padL = isMax?36:28, padR=isMax?12:8, padT=isMax?14:10, padB=isMax?34:28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barGroupW = chartW / nBars;
  const barGap = isMax ? 6 : 4;
  const barW = barGroupW - barGap * 2;
  const maxVal = Math.max(...data.map(d => d.onTime + d.notOnTime), 1);
  const rx = isMax ? 5 : 3;

  // Color pairs per mode
  const col1 = mode === 'present' ? '#22c55e' : '#2563eb'; // bottom segment
  const col2 = mode === 'present' ? '#f97316' : '#ef4444'; // top segment

  // Y-axis labels only (no horizontal gridlines)
  for (let i = 0; i <= 4; i++) {
    const gY = padT + (chartH / 4) * i;
    ctx.fillStyle = 'rgba(90,105,130,0.9)'; ctx.font = `${fs}px sans-serif`; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal - (maxVal / 4) * i), padL - 3, gY + 3);
  }

  const avgVals = [];

  // Build the data points (total per period)
  const pts = data.map((d, i) => {
    const total = d.onTime + d.notOnTime;
    const x = padL + i * barGroupW + barGroupW / 2;
    const y = padT + chartH - (total / maxVal * chartH);
    return { x, y, total, label: d.label, onTime: d.onTime, notOnTime: d.notOnTime };
  });

  // Line color per mode
  const lineCol = mode === 'present' ? '#4caf8e' : '#5b7cc4';
  const fillCol = mode === 'present' ? 'rgba(76,175,142,0.12)' : 'rgba(91,124,196,0.12)';

  // Helper: build a smooth curve path through the points
  const buildCurve = () => {
    ctx.beginPath();
    pts.forEach((p, i) => {
      if (i === 0) { ctx.moveTo(p.x, p.y); return; }
      const prev = pts[i - 1];
      const cx = (prev.x + p.x) / 2;
      ctx.bezierCurveTo(cx, prev.y, cx, p.y, p.x, p.y);
    });
  };

  // Fill under the curve
  if (pts.length > 1) {
    buildCurve();
    ctx.lineTo(pts[pts.length - 1].x, padT + chartH);
    ctx.lineTo(pts[0].x, padT + chartH);
    ctx.closePath();
    ctx.fillStyle = fillCol;
    ctx.fill();
  }

  // The curve line
  if (pts.length > 1) {
    buildCurve();
    ctx.strokeStyle = lineCol;
    ctx.lineWidth = isMax ? 3 : 2.5;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  // Points + value labels + x-axis labels
  pts.forEach((p) => {
    // dot
    ctx.beginPath();
    ctx.arc(p.x, p.y, isMax ? 4 : 3, 0, Math.PI * 2);
    ctx.fillStyle = lineCol;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // value label above the point
    if (p.total > 0) {
      ctx.fillStyle = '#1a2233';
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(p.total, p.x, p.y - (isMax ? 8 : 6));
    }

    // x-axis label
    ctx.fillStyle = 'rgba(90,105,130,0.95)';
    ctx.font = `${fs}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(p.label, p.x, H - padB + fs + 4);
  });
}

function _drawVerticalBars(canvas, data, mode, isMax) {
  const dpr = window.devicePixelRatio || 1;
  const containerW = canvas.parentElement.offsetWidth || 300;
  const containerH = isMax ? (canvas.parentElement.offsetHeight || 360) : 130;
  const W = Math.max(containerW, data.length * 32);
  const H = containerH;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const fs = isMax ? 10 : 8;
  const nBars = data.length;
  const padL = isMax?36:28, padR=isMax?12:8, padT=isMax?14:10, padB=isMax?34:28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barGroupW = chartW / nBars;
  const barGap = isMax?4:3;
  const subBarW = mode==='present' ? (barGroupW/2 - barGap*1.5) : (barGroupW - barGap*2);
  const maxVal = Math.max(...data.map(d => d.onTime + d.notOnTime), 1);

  // Y-axis labels only (no horizontal gridlines)
  for (let i=0;i<=4;i++) {
    const gY = padT+(chartH/4)*i;
    ctx.fillStyle='rgba(90,105,130,0.9)'; ctx.font=`${fs}px sans-serif`; ctx.textAlign='right';
    ctx.fillText(Math.round(maxVal-(maxVal/4)*i), padL-3, gY+3);
  }

  const avgVals=[];
  const rx = isMax?4:3;

  data.forEach((d,i) => {
    const x0 = padL + i*barGroupW + barGap;
    const drawBar = (bx,bw,bh,col,lbl) => {
      if (bh<=0) return;
      const by = padT+chartH-bh;
      ctx.fillStyle=col; ctx.beginPath();
      ctx.moveTo(bx+rx,by); ctx.lineTo(bx+bw-rx,by);
      ctx.quadraticCurveTo(bx+bw,by,bx+bw,by+rx);
      ctx.lineTo(bx+bw,by+bh); ctx.lineTo(bx,by+bh);
      ctx.lineTo(bx,by+rx); ctx.quadraticCurveTo(bx,by,bx+rx,by); ctx.fill();
      if (lbl>0) {
        ctx.fillStyle='#fff'; ctx.font=`bold ${fs}px sans-serif`; ctx.textAlign='center';
        ctx.fillText(lbl, bx+bw/2, by+(bh>fs+4?bh/2+fs/2:-3));
      }
    };

    if (mode==='present') {
      const h1=d.onTime/maxVal*chartH, h2=d.notOnTime/maxVal*chartH;
      const ox=x0+subBarW+barGap;
      drawBar(x0,subBarW,h1,'#22c55e',d.onTime);
      drawBar(ox,subBarW,h2,'#f97316',d.notOnTime);
      avgVals.push({x:x0+subBarW+barGap/2, y:padT+chartH-((d.onTime+d.notOnTime)/maxVal*chartH)});
    } else {
      const h1=d.onTime/maxVal*chartH;
      drawBar(x0,subBarW,h1,'#2563eb',d.onTime);
      avgVals.push({x:x0+subBarW/2, y:padT+chartH-(d.onTime/maxVal*chartH)});
    }

    ctx.fillStyle='rgba(90,105,130,0.95)'; ctx.font=`${fs}px sans-serif`; ctx.textAlign='center';
    ctx.fillText(d.label, padL+i*barGroupW+barGroupW/2, H-padB+fs+4);
  });

  if (avgVals.length>1) {
    ctx.strokeStyle='#1a2233'; ctx.lineWidth=isMax?2:1.5; ctx.setLineDash([4,4]);
    ctx.beginPath(); avgVals.forEach((pt,i)=>{ i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y); }); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='#1a2233';
    avgVals.forEach(pt=>{ ctx.beginPath(); ctx.arc(pt.x,pt.y,isMax?3:2.5,0,Math.PI*2); ctx.fill(); });
  }
}

function _drawHorizontalBars(canvas, data, mode) {
  const dpr = window.devicePixelRatio || 1;
  const container = canvas.parentElement;
  const rowH = mode==='present' ? 36 : 26;
  const H = Math.max(data.length * rowH + 50, container.offsetHeight || 300);
  const W = container.offsetWidth || 300;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const fs = 11;
  const padL=68, padR=16, padT=14, padB=24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const nBars = data.length;
  const barGroupH = chartH / nBars;
  const barGap = 3;
  const subBarH = mode==='present' ? (barGroupH/2-barGap*1.5) : (barGroupH-barGap*2);
  const maxVal = Math.max(...data.map(d=>d.onTime+d.notOnTime), 1);

  // X-axis labels only (no vertical gridlines)
  for (let i=0;i<=4;i++) {
    const gX = padL + (chartW/4)*i;
    ctx.fillStyle='rgba(90,105,130,0.9)'; ctx.font=`${fs-1}px sans-serif`; ctx.textAlign='center';
    ctx.fillText(Math.round(maxVal/4*i), gX, padT+chartH+12);
  }

  const avgVals=[];
  const rx=4;

  data.forEach((d,i)=>{
    const y0 = padT + i*barGroupH + barGap;
    const drawHBar=(by,bh,bw,col,lbl)=>{
      if(bw<=0) return;
      ctx.fillStyle=col; ctx.beginPath();
      const bx=padL, bRight=padL+bw;
      ctx.moveTo(bx,by+rx); ctx.lineTo(bx,by+bh-rx);
      ctx.quadraticCurveTo(bx,by+bh,bx+rx,by+bh);
      ctx.lineTo(bRight-rx,by+bh); ctx.quadraticCurveTo(bRight,by+bh,bRight,by+bh-rx);
      ctx.lineTo(bRight,by+rx); ctx.quadraticCurveTo(bRight,by,bRight-rx,by);
      ctx.lineTo(bx+rx,by); ctx.quadraticCurveTo(bx,by,bx,by+rx); ctx.fill();
      if(lbl>0){
        ctx.fillStyle='#fff'; ctx.font=`bold ${fs}px sans-serif`; ctx.textAlign='center';
        ctx.fillText(lbl, padL+bw/2, by+bh/2+fs/2-1);
      }
    };

    if(mode==='present'){
      const w1=d.onTime/maxVal*chartW, w2=d.notOnTime/maxVal*chartW;
      const oy=y0+subBarH+barGap;
      drawHBar(y0,subBarH,w1,'#22c55e',d.onTime);
      drawHBar(oy,subBarH,w2,'#f97316',d.notOnTime);
      const tot=(d.onTime+d.notOnTime)/maxVal*chartW;
      avgVals.push({x:padL+tot, y:y0+subBarH+barGap/2});
    } else {
      const w1=d.onTime/maxVal*chartW;
      drawHBar(y0,subBarH,w1,'#2563eb',d.onTime);
      avgVals.push({x:padL+w1, y:y0+subBarH/2});
    }

    // Y-axis labels
    ctx.fillStyle='rgba(90,105,130,0.95)'; ctx.font=`${fs}px sans-serif`; ctx.textAlign='right';
    ctx.fillText(d.label, padL-5, y0+barGroupH/2+fs/2-2);
  });

  if(avgVals.length>1){
    ctx.strokeStyle='#1a2233'; ctx.lineWidth=2; ctx.setLineDash([4,4]);
    ctx.beginPath(); avgVals.forEach((pt,i)=>{ i===0?ctx.moveTo(pt.x,pt.y):ctx.lineTo(pt.x,pt.y); }); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle='#1a2233';
    avgVals.forEach(pt=>{ ctx.beginPath(); ctx.arc(pt.x,pt.y,3,0,Math.PI*2); ctx.fill(); });
  }
}

function showJoinedStudents() { showTileStudents('joined'); }

// ================================================================
// CHART PAGES (Attendance + Fees pie charts)
// ================================================================
function closeChartPage(id) { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

// Build an SVG donut/pie from segments [{label,value,color}]
function buildPieSVG(segments) {
  const total = segments.reduce((a,s) => a + s.value, 0);
  const size = 220, r = 95, cx = size/2, cy = size/2, inner = 52;
  if (!total) {
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="display:block;margin:0 auto;">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--border)" stroke-width="${r-inner}"/>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" fill="var(--gray)" font-size="13">No data</text></svg>`;
  }
  let angle = -Math.PI/2; // start at top
  let paths = '';
  segments.forEach(s => {
    if (s.value <= 0) return;
    const frac = s.value / total;
    const pct = Math.round(frac*100);
    const tip = `${s.label}: ${s.value} (${pct}%)`;
    const a2 = angle + frac * Math.PI * 2;
    // Full circle special case
    if (frac >= 0.999) {
      paths += `<circle class="pie-seg" cx="${cx}" cy="${cy}" r="${(r+inner)/2}" fill="none" stroke="${s.color}" stroke-width="${r-inner}"><title>${escHtml(tip)}</title></circle>`;
      angle = a2; return;
    }
    const x1 = cx + r*Math.cos(angle), y1 = cy + r*Math.sin(angle);
    const x2 = cx + r*Math.cos(a2),    y2 = cy + r*Math.sin(a2);
    const xi2 = cx + inner*Math.cos(a2), yi2 = cy + inner*Math.sin(a2);
    const xi1 = cx + inner*Math.cos(angle), yi1 = cy + inner*Math.sin(angle);
    const large = frac > 0.5 ? 1 : 0;
    paths += `<path class="pie-seg" d="M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${xi2} ${yi2} A ${inner} ${inner} 0 ${large} 0 ${xi1} ${yi1} Z" fill="${s.color}"><title>${escHtml(tip)}</title></path>`;
    angle = a2;
  });
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" style="display:block;margin:0 auto;overflow:visible;">
    ${paths}
    <text x="${cx}" y="${cy-6}" text-anchor="middle" dominant-baseline="middle" fill="var(--offwhite)" font-size="26" font-weight="800">${total}</text>
    <text x="${cx}" y="${cy+16}" text-anchor="middle" dominant-baseline="middle" fill="var(--gray)" font-size="11">Total</text>
  </svg>`;
}
function renderPie(wrapId, segments, subtitle) {
  const total = segments.reduce((a,s) => a + s.value, 0);
  const legend = segments.map(s => {
    const pct = total ? Math.round(s.value/total*100) : 0;
    return `<div class="chart-legend-item">
      <span class="chart-legend-dot" style="background:${s.color};"></span>
      <span style="flex:1;">${escHtml(s.label)}</span>
      <span style="color:var(--gray);font-weight:700;">${s.value} · ${pct}%</span>
    </div>`;
  }).join('');
  const wrap = document.getElementById(wrapId);
  wrap.innerHTML =
    `<div style="position:relative;">` +
    buildPieSVG(segments) +
    `<div class="pie-tip" id="${wrapId}_tip" style="display:none;"></div></div>` +
    (subtitle ? `<div class="chart-total-box">${escHtml(subtitle)}</div>` : '') +
    `<div class="chart-legend">${legend}</div>`;
  // Attach hover behaviour to the segments
  const tip = document.getElementById(wrapId + '_tip');
  const container = wrap.querySelector('div');
  wrap.querySelectorAll('.pie-seg').forEach(seg => {
    const move = (e) => {
      const t = seg.querySelector('title');
      if (!t || !tip) return;
      tip.textContent = t.textContent;
      tip.style.display = 'block';
      const rect = container.getBoundingClientRect();
      const px = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
      const py = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
      tip.style.left = px + 'px';
      tip.style.top  = (py - 34) + 'px';
    };
    seg.addEventListener('mousemove', move);
    seg.addEventListener('mouseenter', move);
    seg.addEventListener('mouseleave', () => { if (tip) tip.style.display = 'none'; });
    // Mobile: tap to show
    seg.addEventListener('touchstart', move, {passive:true});
  });
}
// shared: populate a sport dropdown + its batches
function _fillChartSport(sportSelId) {
  const sel = document.getElementById(sportSelId);
  if (!sel) return;
  const cur = sel.value || 'ALL';
  let sports = Array.isArray(DB.sports) ? DB.sports : [];
  if (!isAdmin()) {
    const ss = getStaffSports();
    if (ss.length) sports = sports.filter(sp => ss.includes(sp));
  }
  const stillValid = sports.includes(cur);
  sel.innerHTML = '<option value="ALL">All Sports</option>' +
    sports.map(sp => `<option value="${escHtml(sp)}"${(stillValid && cur===sp)?' selected':''}>${escHtml(sp)}</option>`).join('');
}
function _fillChartBatch(sportSelId, batchSelId) {
  const sp = document.getElementById(sportSelId)?.value || 'ALL';
  const sel = document.getElementById(batchSelId);
  if (!sel) return;
  let batches = sp === 'ALL' ? DB.batches.slice() : DB.batches.filter(b => (DB.batchSport&&DB.batchSport[b]) === sp);
  if (!isAdmin()) {
    const sb = getStaffBatches();
    if (sb.length) batches = batches.filter(b => sb.includes(b));
  }
  sel.innerHTML = '<option value="ALL">All Batches</option>' +
    batches.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');
}
function _fillChartYears(yearSelId) {
  const sel = document.getElementById(yearSelId);
  if (!sel) return;
  const nowY = new Date().getFullYear();
  let opts = '';
  for (let y = nowY + 1; y >= nowY - 5; y--) opts += `<option value="${y}"${y===nowY?' selected':''}>${y}</option>`;
  sel.innerHTML = opts;
}

// ---- ATTENDANCE CHART ----
function openAttChart() {
  _fillChartSport('attChartSport');
  _fillChartBatch('attChartSport','attChartBatch');
  _fillChartYears('attChartYear');
  const mEl = document.getElementById('attChartMonth');
  if (mEl && !mEl.value) { const n = new Date(); mEl.value = n.getFullYear()+'-'+pad(n.getMonth()+1); }
  const dEl = document.getElementById('attChartDate');
  if (dEl && !dEl.value) dEl.value = todayStr();
  document.getElementById('attChartPage').style.display = 'flex';
  onAttChartViewChange();
}
function onAttChartSportChange() { _fillChartBatch('attChartSport','attChartBatch'); renderAttChart(); }
function onAttChartViewChange() {
  const vt = document.getElementById('attChartView').value;
  document.getElementById('attChartDate').style.display  = vt==='day'  ? '' : 'none';
  document.getElementById('attChartMonth').style.display = vt==='month'? '' : 'none';
  document.getElementById('attChartYear').style.display  = vt==='year' ? '' : 'none';
  renderAttChart();
}
function renderAttChart() {
  const sp = document.getElementById('attChartSport').value;
  const batch = document.getElementById('attChartBatch').value;
  const vt = document.getElementById('attChartView').value;
  // students in scope (by sport+batch)
  const sportSids = sp === 'ALL'
    ? new Set((DB.enrollments||[]).map(e=>e.studentId))
    : new Set((DB.enrollments||[]).filter(e=>e.sport===sp).map(e=>e.studentId));
  let students = getActiveStudents().filter(s => sportSids.has(s._sid||s.id));
  if (batch !== 'ALL') students = students.filter(s => s.batch === batch);
  const sidSet = new Set(students.map(s => s.id));

  // Decide which date keys are in range
  let dateKeys = [];
  let subtitle = '';
  if (vt === 'day') {
    const dk = document.getElementById('attChartDate').value;
    if (dk) dateKeys = [dk];
    subtitle = dk || '';
  } else if (vt === 'year') {
    const y = document.getElementById('attChartYear').value;
    dateKeys = Object.keys(DB.attendance).filter(k => k.startsWith(y+'-'));
    subtitle = 'Year ' + y;
  } else {
    const ym = document.getElementById('attChartMonth').value; // YYYY-MM
    if (ym) { dateKeys = Object.keys(DB.attendance).filter(k => k.startsWith(ym+'-')); 
      const [yy,mm] = ym.split('-'); subtitle = MONTHS[parseInt(mm)-1]+' '+yy; }
  }

  let present=0, absent=0, late=0, noEntry=0;
  dateKeys.forEach(dk => {
    const day = DB.attendance[dk] || {};
    // Count P/A/late from existing marks
    Object.keys(day).forEach(spName => {
      if (sp !== 'ALL' && spName !== sp) return;
      const marks = day[spName];
      Object.keys(marks).forEach(sid => {
        if (!sidSet.has(sid)) return;
        const v = marks[sid];
        if (v === 'P') {
          if (isLatecomer(dk, sid, spName)) late++; else present++;
        } else if (v === 'A') absent++;
      });
    });
    // "No entry" = enrolled students on this (class) day with no P/A mark.
    // Only count days that are class days (have at least one mark) to avoid counting holidays.
    if (isClassDay(dk, sp === 'ALL' ? undefined : sp)) {
      const [yy,mm,dd] = dk.split('-').map(Number);
      students.forEach(s => {
        if (!isEnrolledOnDate(s, yy, mm, dd) || !isActiveOnDate(s, yy, mm, dd)) return;
        const marked = attGet(dk, s.id, sp === 'ALL' ? 'ALL' : sp);
        if (marked !== 'P' && marked !== 'A') noEntry++;
      });
    }
  });

  renderPie('attChartWrap', [
    { label:'Present', value:present, color:'#16a34a' },
    { label:'Absent',  value:absent,  color:'#dc2626' },
    { label:'Latecomers', value:late, color:'#f97316' },
    { label:'No Entry', value:noEntry, color:'#94a3b8' },
  ], subtitle);
}

// ---- FEES CHART ----
function openFeeChart() {
  _fillChartSport('feeChartSport');
  _fillChartBatch('feeChartSport','feeChartBatch');
  _fillChartYears('feeChartYear');
  const mEl = document.getElementById('feeChartMonth');
  if (mEl && !mEl.value) { const n = new Date(); mEl.value = n.getFullYear()+'-'+pad(n.getMonth()+1); }
  document.getElementById('feeChartPage').style.display = 'flex';
  onFeeChartViewChange();
}
function onFeeChartSportChange() { _fillChartBatch('feeChartSport','feeChartBatch'); renderFeeChart(); }
function onFeeChartViewChange() {
  const vt = document.getElementById('feeChartView').value;
  document.getElementById('feeChartMonth').style.display = vt==='month'? '' : 'none';
  document.getElementById('feeChartYear').style.display  = vt==='year' ? '' : 'none';
  renderFeeChart();
}
function renderFeeChart() {
  const sp = document.getElementById('feeChartSport').value;
  const batch = document.getElementById('feeChartBatch').value;
  const vt = document.getElementById('feeChartView').value;
  const sportSids = sp === 'ALL'
    ? new Set((DB.enrollments||[]).map(e=>e.studentId))
    : new Set((DB.enrollments||[]).filter(e=>e.sport===sp).map(e=>e.studentId));
  let students = getActiveStudents().filter(s => sportSids.has(s._sid||s.id));
  if (batch !== 'ALL') students = students.filter(s => s.batch === batch);

  let monthKeys = [];
  let subtitle = '';
  if (vt === 'year') {
    const y = document.getElementById('feeChartYear').value;
    for (let m=1;m<=12;m++) monthKeys.push(`${y}-${pad(m)}`);
    subtitle = 'Year ' + y;
  } else {
    const ym = document.getElementById('feeChartMonth').value;
    if (ym) { monthKeys=[ym]; const [yy,mm]=ym.split('-'); subtitle = MONTHS[parseInt(mm)-1]+' '+yy; }
  }

  let paid=0, notPaid=0, na=0;
  monthKeys.forEach(fk => {
    const [fy,fm] = fk.split('-').map(Number);
    const feeData = feeMonthMap(fk, sp === 'ALL' ? 'ALL' : sp);
    students.forEach(s => {
      if (!isEnrolledOnDate(s, fy, fm, 0)) return;
      // NA = not eligible (didn't attend that month)
      if (!studentAttendedMonth(s.id, fy, fm)) { na++; return; }
      if (isPaid(feeData[s.id])) paid++; else notPaid++;
    });
  });

  renderPie('feeChartWrap', [
    { label:'Paid', value:paid, color:'#16a34a' },
    { label:'Not Paid', value:notPaid, color:'#dc2626' },
    { label:'NA (not eligible)', value:na, color:'#94a3b8' },
  ], subtitle);
}

// Unified: clicking any dashboard tile lists the relevant students with contact
function showTileStudents(type) {
  const m = parseInt(document.getElementById('dashMonth').value);
  const y = parseInt(document.getElementById('dashYear').value);
  const actives = getActiveStudents();
  let list = [];
  let title = '';
  let subtitle = '';

  if (type === 'total') {
    list = actives.slice();
    title = 'Total Students (' + list.length + ')';
    subtitle = 'All active students:';
  } else if (type === 'joined') {
    list = actives.filter(s => {
      if (!s.joinDate) return false;
      const jd = parseDate(s.joinDate);
      return jd && jd.getFullYear() === y && (jd.getMonth() + 1) === m;
    });
    title = 'Joined in ' + MONTHS[m-1] + ' ' + y + ' (' + list.length + ')';
    subtitle = 'Students who joined this month:';
  } else if (type === 'collected' || type === 'pending') {
    const feeMonthAllSports = DB.fees[`${y}-${pad(m)}`] || {};
    const paidList = [], pendingList = [];
    actives.forEach(s => {
      if (!isEnrolledOnDate(s, y, m, 0)) return;
      if (!studentAttendedMonth(s.id, y, m)) return;
      const sid = s.id;
      const mySports = (DB.enrollments||[]).filter(e => e.studentId === (s._sid||s.id)).map(e => e.sport);
      let anyUnpaid = false, anyPaid = false;
      mySports.forEach(sp => {
        const entry = (feeMonthAllSports[sp] || {})[sid];
        if (isPaid(entry)) anyPaid = true; else anyUnpaid = true;
      });
      if (!mySports.length || anyUnpaid) pendingList.push(s);
      if (anyPaid) paidList.push(s);
    });
    if (type === 'collected') {
      list = paidList;
      title = 'Fees Collected — ' + MONTHS[m-1] + ' ' + y + ' (' + list.length + ')';
      subtitle = 'Students who paid this month:';
    } else {
      list = pendingList;
      title = 'Fee Pending — ' + MONTHS[m-1] + ' ' + y + ' (' + list.length + ')';
      subtitle = 'Students with pending fees:';
    }
  }

  // Sort by roll number then name
  list.sort((a,b) => rollCmp(a,b) || a.name.localeCompare(b.name));

  document.getElementById('modalJoinedTitle').textContent = title;
  document.getElementById('modalJoinedListWrap').innerHTML = list.length
    ? `<div style="font-size:11px;color:var(--gray);padding:0 2px 8px;">${subtitle}</div>` +
      `<div style="background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;">` +
      list.map((s, i) =>
        `<div class="att-row" style="${i < list.length-1 ? '' : 'border-bottom:none;'}">
          <div style="flex:1;min-width:0;">
            <div class="att-name">${s.rollNo?`<span style="background:var(--accent2);color:#fff;border-radius:50%;min-width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;padding:0 4px;margin-right:5px;">${s.rollNo}</span>`:''}${escHtml(s.name)}</div>
            <div style="font-size:10px;color:var(--gray);margin-top:2px;">${escHtml(s.batch || '')}${type==='joined' && s.joinDate ? ' · Joined ' + escHtml(s.joinDate) : ''}</div>
          </div>
          ${s.contact ? `<a href="tel:${escHtml(s.contact)}" style="font-size:12px;color:var(--accent2);font-weight:600;white-space:nowrap;flex-shrink:0;">📞 ${escHtml(s.contact)}</a>` : '<span style="font-size:11px;color:var(--graydk);flex-shrink:0;">No contact</span>'}
        </div>`
      ).join('') + `</div>`
    : '<div class="empty-state">No students to show.</div>';
  openModal('modalJoinedList');
}

// ----------------------------------------------------------------
// PROFILE
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// DATA EXPORT / IMPORT
// ----------------------------------------------------------------
function exportAllData() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  const name = (DB.settings.academyName || 'Academy').replace(/\s+/g, '_');
  a.href = url;
  a.download = `${name}_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  addLog('settings', 'Data exported');
  showToast('Data exported ✓', 'success');
}

function importAllData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('importDataStatus');
  const reader = new FileReader();
  reader.onload = ev => {
    let parsed;
    try {
      parsed = JSON.parse(ev.target.result);
    } catch (err) {
      if (statusEl) { statusEl.style.display=''; statusEl.style.color='#f87171'; statusEl.textContent='⚠️ Not a valid JSON file.'; }
      showToast('Import failed: invalid JSON', 'error');
      e.target.value = '';
      return;
    }
    // Lenient validation — only students + settings are essential
    if (!parsed.students || !parsed.settings) {
      if (statusEl) { statusEl.style.display=''; statusEl.style.color='#f87171'; statusEl.textContent='⚠️ Invalid backup — missing students or settings.'; }
      showToast('Import failed: missing data', 'error');
      e.target.value = '';
      return;
    }
    confirm_('⬆️', 'Import Data',
      `Import ${parsed.students.length} students and all related data into Supabase?`,
      async () => {
        try {
          // Merge parsed data into DB, ensuring all arrays/objects exist
          DB = Object.assign({}, DB, parsed);
          DB.attendance = DB.attendance || {};
          DB.fees = DB.fees || {};
          DB.enquiries = DB.enquiries || [];
          DB.classLog = DB.classLog || [];
          DB.batches = DB.batches || [];

          if (statusEl) { statusEl.style.display=''; statusEl.style.color='#888'; statusEl.textContent='⏳ Uploading to Supabase…'; }

          const ok = await sbPushFullDB({ onProgress: (m) => {
            if (statusEl) statusEl.textContent = '⏳ ' + m;
          }});

          if (!ok) throw new Error('Upload to Supabase failed — see console for details.');

          updateLogos();
          initDashFilters(); initFeeFilters(); initAttFilters();
          renderStudentList(); loadDashboard(); renderProfilePage();
          addLog('settings', 'Data migrated from backup');
          if (statusEl) {
            statusEl.style.color = '#4ade80';
            statusEl.textContent = '✅ Migrated — ' + (parsed.students.length||0) + ' students, ' +
              Object.keys(DB.attendance).length + ' attendance days, ' +
              Object.keys(DB.fees).length + ' fee months.';
          }
          showToast('Data migrated ✓', 'success');
        } catch (err) {
          console.error('Import/migration error:', err);
          if (statusEl) { statusEl.style.display=''; statusEl.style.color='#f87171'; statusEl.textContent='⚠️ ' + (err.message||'Migration failed'); }
          showToast('Import failed: ' + (err.message||'see console'), 'error');
        }
      }
    );
    e.target.value = '';
  };
  reader.readAsText(file);
}


async function renderProfilePage() {
  if (!currentUser) return;
  applyAcadSettings();
  const dataCard = document.getElementById('dataCard');
  if (dataCard) dataCard.style.display = isAdmin() ? '' : 'none';

  updateLogos();
  if (isAdmin()) {
    renderAdminNameField();
    renderSportList();
    renderBatchList();
    renderSportBatch();
    renderUserList();
    renderChangeLog();
    await renderSnapshotList();
    document.getElementById('staffLogCard').style.display = 'none';
    const msgTplEl = document.getElementById('profileMsgTemplate');
    if (msgTplEl) msgTplEl.value = getDefaultMsgTemplate();
    const thankTplEl = document.getElementById('profileThankTemplate');
    if (thankTplEl) thankTplEl.value = getDefaultThankTemplate();
  } else {
    // Staff: show only their own log + their own profile entry
    renderUserList();
    const staffLogCard = document.getElementById('staffLogCard');
    const staffLogWrap = document.getElementById('staffLogWrap');
    if (staffLogCard) staffLogCard.style.display = '';
    if (staffLogWrap) {
      const myLogs = DB.changelog.filter(l => l.user === currentUser.id).slice(0,60);
      staffLogWrap.innerHTML = myLogs.length
        ? myLogs.map(l => `<div class="log-row"><div style="font-size:12px;">${escHtml(l.action)}: ${escHtml(l.detail)}</div><div class="log-meta">${new Date(l.time).toLocaleString()}</div></div>`).join('')
        : `<div style="color:var(--gray);font-size:12px;padding:8px;">No activity yet.</div>`;
    }
  }
  renderMsgLog();
}

let _feesLogTab = 'reminder'; // 'reminder' | 'paid'
function setFeesLogTab(tab) {
  _feesLogTab = tab;
  const r = document.getElementById('feesLogTabReminder');
  const p = document.getElementById('feesLogTabPaid');
  if (r && p) {
    if (tab === 'reminder') {
      r.style.background = 'var(--accent2)'; r.style.color = '#fff';
      p.style.background = 'var(--card2)';   p.style.color = 'var(--gray)';
    } else {
      p.style.background = 'var(--accent2)'; p.style.color = '#fff';
      r.style.background = 'var(--card2)';   r.style.color = 'var(--gray)';
    }
  }
  renderMsgLog();
}
// Collect "Fee Paid" events from the changelog (action === 'fee')
function getFeePaidLogs() {
  return (DB.changelog || []).filter(l => l.action === 'fee').map(l => ({
    detail: l.detail || '', by: l.user || '', at: l.time
  }));
}
function renderMsgLog() {
  const wrap = document.getElementById('msgLogWrap');
  if (!wrap) return;
  const logs = (Array.isArray(DB.msgLogs) ? DB.msgLogs : [])
    .filter(l => (l.kind || 'reminder') === _feesLogTab)
    .filter(l => !_feeSelectedTypes.length || _feeSelectedTypes.some(c => FEE_LOG_TYPES[c] === l.type));
  if (!logs.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:14px;">No ${_feesLogTab === 'paid' ? 'payment greetings' : 'reminders'} sent yet.</div>`;
    return;
  }
  wrap.innerHTML = logs.slice(0, 100).map(l => {
    const d = new Date(l.at);
    const timeStr = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${((d.getHours()%12)||12)}:${pad(d.getMinutes())} ${d.getHours()>=12?'PM':'AM'}`;
    const typeBadge = l.type === 'whatsapp'
      ? `<span class="msg-whatsapp-badge">💬 WhatsApp</span>`
      : `<span class="msg-sent-badge">📱 SMS</span>`;
    const kindBadge = (l.kind === 'paid')
      ? `<span class="msg-sent-badge" style="background:#16a34a22;color:#4ade80;border:1px solid #16a34a55;">✅ Paid</span>`
      : `<span class="msg-sent-badge" style="background:#f9731622;color:#fb923c;border:1px solid #f9731655;">💬 Reminder</span>`;
    return `<div class="msg-log-row">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
        ${kindBadge}${typeBadge}
        <span style="font-size:12px;font-weight:600;">${escHtml(l.to)}</span>
        <span style="font-size:11px;color:var(--gray);">${escHtml(l.month)}</span>
      </div>
      <div class="msg-log-meta">Sent by <b style="color:var(--gold);">${escHtml(l.by)}</b> · ${escHtml(timeStr)} · 📞 ${escHtml(l.contact||'')}</div>
    </div>`;
  }).join('');
}

function renderAdminNameField() {
  // Show/hide edit button
  const editBtn = document.getElementById('acadEditBtn');
  if (editBtn) { editBtn.style.display = isAdmin() ? '' : 'none'; editBtn.textContent = '✏️ Edit'; }
  // Always start collapsed
  const fields = document.getElementById('adminProfileFields');
  if (fields) fields.style.display = 'none';
  if (!isAdmin()) return;
  // Pre-fill values (ready for when panel opens)
  const ci = document.getElementById('changeAcadInput');
  const ce = document.getElementById('changeEmail');
  const cp = document.getElementById('changePhone');
  const ct = document.getElementById('changeTagline');
  if (ci) ci.value = DB.settings.academyName || '';
  if (ce) ce.value = DB.settings.email        || '';
  if (cp) cp.value = DB.settings.phone        || '';
  if (ct) ct.value = DB.settings.tagline      || '';
}

function toggleAcadEdit() {
  const fields  = document.getElementById('adminProfileFields');
  const editBtn = document.getElementById('acadEditBtn');
  if (!fields) return;
  const opening = fields.style.display === 'none';
  fields.style.display = opening ? '' : 'none';
  if (editBtn) editBtn.textContent = opening ? '✕ Close' : '✏️ Edit';
  if (opening) {
    // Re-populate when opening
    const ci = document.getElementById('changeAcadInput');
    const ce = document.getElementById('changeEmail');
    const cp = document.getElementById('changePhone');
    const ct = document.getElementById('changeTagline');
    const cls = document.getElementById('changeLoginSupport');
    if (ci) ci.value = DB.settings.academyName || '';
    if (ce) ce.value = DB.settings.email        || '';
    if (cp) cp.value = DB.settings.phone        || '';
    if (ct) ct.value = DB.settings.tagline      || '';
    if (cls) cls.value = DB.settings.loginSupport || '';
    const cp2 = document.getElementById('changePhone2');
    if (cp2) cp2.value = DB.settings.phone2 || '';
    // Scroll to card
    fields.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function saveAcadDetails() {
  const name    = document.getElementById('changeAcadInput')?.value.trim();
  const email   = document.getElementById('changeEmail')?.value.trim();
  const phone   = document.getElementById('changePhone')?.value.trim();
  const phone2  = document.getElementById('changePhone2')?.value.trim();
  const tagline = document.getElementById('changeTagline')?.value.trim();
  const loginSupport = document.getElementById('changeLoginSupport')?.value.trim();
  if (!name) { showToast('Academy name is required','error'); return; }
  confirm_('💾','Save Academy Details','Save all changes to academy profile?', () => {
    DB.settings.academyName = name;
    DB.settings.email   = email   || DB.settings.email;
    DB.settings.phone   = phone   || DB.settings.phone;
    DB.settings.phone2  = phone2  !== undefined ? phone2 : DB.settings.phone2;
    DB.settings.tagline = tagline;
    DB.settings.loginSupport = loginSupport;
    sbSaveSettings();
    addLog('settings','Academy profile updated');
    applyAcadSettings();
    showToast('Profile saved ✓','success');
    const fields2=document.getElementById('adminProfileFields'); if(fields2) fields2.style.display='none';
    const eb=document.getElementById('acadEditBtn'); if(eb) eb.textContent='✏️ Edit';
  });
}

function applyAcadSettings() {
  renderHomeGreeting();
  const n = DB.settings.academyName || '';
  const e = DB.settings.email       || '';
  const p = DB.settings.phone       || '';
  const p2= DB.settings.phone2      || '';
  const t = DB.settings.tagline     || '';
  // Top bar
  const topName = document.getElementById('topAcadName');
  if (topName) topName.textContent = n;
  // Profile card
  ['profileAcadName'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent=n; });
  const pEmail  = document.getElementById('profileEmail');  if(pEmail)  pEmail.textContent  = e;
  const pPhone  = document.getElementById('profilePhone');  if(pPhone)  pPhone.textContent  = p;
  const pPhone2 = document.getElementById('profilePhone2'); if(pPhone2) pPhone2.textContent = p2 ? '📞 ' + p2 : '';
  const pTag    = document.getElementById('profileTagline');if(pTag)    pTag.textContent    = t;
  // Login screen — "Welcome Back" title, sign-in subtitle, support line
  const lTitle = document.getElementById('loginAcadTitle'); if(lTitle)  lTitle.textContent = 'Welcome Back';
  const lTag   = document.getElementById('loginTagline');   if(lTag)    lTag.textContent   = "Let's run your academy smarter";
  const lSup   = document.getElementById('loginSupport');
  if (lSup) lSup.textContent = DB.settings.loginSupport || '';
}

function saveAcadName() { saveAcadDetails(); } // legacy alias

// ── SPORT MANAGEMENT ─────────────────────────────────────────────
// Unified Sports & Batches: each sport listed with its batches nested underneath
let _sportCollapsed = {}; // { sportName: true=collapsed } — kept for compatibility, unused now that batches have their own tab
let _sportBatchTab = 'sports'; // 'sports' | 'batches'
function toggleSportCollapse(sp) {
  _sportCollapsed[sp] = !_sportCollapsed[sp];
  renderSportBatch();
}
function setSportBatchTab(tab) {
  _sportBatchTab = tab;
  const sportsBtn  = document.getElementById('sbTabSports');
  const batchesBtn = document.getElementById('sbTabBatches');
  const mainBtn    = document.getElementById('sportBatchMainBtn');
  if (sportsBtn && batchesBtn) {
    const active   = 'background:var(--accent2);color:#fff;';
    const inactive = 'background:var(--card2);color:var(--gray);';
    const base = 'flex:1;padding:7px 0;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;';
    sportsBtn.style.cssText  = base + (tab === 'sports'  ? active : inactive);
    batchesBtn.style.cssText = base + (tab === 'batches' ? active : inactive);
  }
  if (mainBtn) {
    if (tab === 'sports') { mainBtn.textContent = '+ Sport';  mainBtn.setAttribute('onclick','openAddSportModal()'); }
    else                  { mainBtn.textContent = '+ Batch';  mainBtn.setAttribute('onclick','openAddBatchModal()'); }
  }
  renderSportBatch();
}
function renderSportBatch() {
  // Update sport/batch count badges
  const sportBadge = document.getElementById('sportLimitBadge');
  const batchBadge = document.getElementById('batchLimitBadge');
  if (sportBadge && typeof planSportLimit === 'function') {
    const lim = planSportLimit();
    const cur = (DB.sports||[]).length;
    if (lim === null) { sportBadge.textContent = cur+' sports'; sportBadge.style.cssText='font-size:11px;font-weight:600;padding:2px 9px;border-radius:12px;background:var(--card2);color:var(--gray);'; }
    else {
      const full = cur >= lim, near = cur/lim >= 0.8;
      sportBadge.textContent = cur+' / '+lim;
      sportBadge.style.cssText='font-size:11px;font-weight:600;padding:2px 9px;border-radius:12px;background:'+(full?'rgba(232,57,47,.15)':near?'rgba(245,158,11,.15)':'var(--card2)')+';color:'+(full?'#e8392f':near?'#f59e0b':'var(--gray)')+';';
    }
  }
  if (batchBadge && typeof planBatchesPerSport === 'function') {
    const perSport = planBatchesPerSport();
    const cur = (DB.batches||[]).length;
    const sportCount = (DB.sports||[]).length;
    const totalLim = perSport * sportCount;
    const full = cur >= totalLim, near = totalLim > 0 && cur/totalLim >= 0.8;
    batchBadge.textContent = cur+' batches · '+perSport+'/sport';
    batchBadge.style.cssText='font-size:11px;font-weight:600;padding:2px 9px;border-radius:12px;background:'+(full?'rgba(232,57,47,.15)':near?'rgba(245,158,11,.15)':'var(--card2)')+';color:'+(full?'#e8392f':near?'#f59e0b':'var(--gray)')+';';
  }
  const wrap = document.getElementById('sportBatchWrap');
  if (!wrap) return;
  if (!Array.isArray(DB.sports)) DB.sports = [];
  if (!Array.isArray(DB.batches)) DB.batches = [];

  if (_sportBatchTab === 'batches') { renderBatchesTabOnly(wrap); return; }
  renderSportsTabOnly(wrap);
}

// ── SPORTS TAB: list of sports with batch counts, no nested batch rows ──
function renderSportsTabOnly(wrap) {
  if (!DB.sports.length) {
    wrap.innerHTML = `<div style="color:var(--gray);font-size:12px;padding:6px 2px;">No sports yet. Tap <b>+ Sport</b> to create one.</div>`;
    return;
  }
  let html = '';
  DB.sports.forEach((sp, si) => {
    const batches = DB.batches.filter(b => (DB.batchSport && DB.batchSport[b]) === sp);
    html += `<div style="display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;background:var(--card2);padding:10px 12px;">
      <span style="font-size:15px;">🏆</span>
      <span style="flex:1;font-size:14px;font-weight:700;color:var(--offwhite);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(sp)}</span>
      <span style="font-size:10px;color:var(--gray);white-space:nowrap;">${batches.length} batch${batches.length===1?'':'es'}</span>
      <button onclick="openEditSportModal(${si})" title="Edit sport" style="background:none;border:none;cursor:pointer;padding:3px;display:flex;align-items:center;">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
      </button>
    </div>`;
  });
  wrap.innerHTML = html;
}

// ── BATCHES TAB: flat list of every batch, each tagged with its sport ──
function renderBatchesTabOnly(wrap) {
  if (!DB.batches.length) {
    wrap.innerHTML = `<div style="color:var(--gray);font-size:12px;padding:6px 2px;">No batches yet. Tap <b>+ Batch</b> to create one.</div>`;
    return;
  }
  let html = '';
  DB.batches.forEach(b => {
    const bi = DB.batches.indexOf(b);
    const sport = (DB.batchSport && DB.batchSport[b]) || '';
    const validSport = sport && DB.sports.includes(sport);
    const cnt = getActiveStudents().filter(s => s.batch === b).length;
    html += `<div style="display:flex;align-items:center;gap:8px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;padding:9px 12px;">
      <span style="color:var(--gray);font-size:13px;">📦</span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--offwhite);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(b)}</div>
        <div style="font-size:10px;color:${validSport?'var(--accent2)':'#e8392f'};margin-top:2px;">🏆 ${validSport?escHtml(sport):'Unassigned'}</div>
      </div>
      <span style="font-size:10px;color:var(--gray);white-space:nowrap;">${cnt} student${cnt===1?'':'s'}</span>
      <button onclick="openEditBatchModal(${bi})" title="Edit batch" style="background:none;border:none;cursor:pointer;padding:3px;display:flex;align-items:center;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
      </button>
    </div>`;
  });
  wrap.innerHTML = html;
}
// Open the Add Batch modal pre-set to a given sport
function addBatchToSport(sport) {
  openAddBatchModal();
  const sportSel = document.getElementById('newBatchSport');
  if (sportSel) sportSel.value = sport;
}
// ── Edit Sport modal ──
function openEditSportModal(idx) {
  document.getElementById('editSportIdx').value = idx;
  document.getElementById('editSportName').value = DB.sports[idx] || '';
  openModal('modalEditSport');
}
function saveEditSport() {
  const i = parseInt(document.getElementById('editSportIdx').value);
  const newName = (document.getElementById('editSportName').value || '').trim();
  if (!newName) { showToast('Enter a sport name','error'); return; }
  const old = DB.sports[i];
  if (newName === old) { closeModal('modalEditSport'); return; }
  if (DB.sports.some((s,j) => j!==i && s.toLowerCase() === newName.toLowerCase())) { showToast('Sport already exists','error'); return; }
  confirm_('✏️','Rename Sport',`Rename "${old}" → "${newName}"?`, () => {
    DB.sports[i] = newName;
    Object.keys(DB.batchSport || {}).forEach(b => { if (DB.batchSport[b] === old) DB.batchSport[b] = newName; });
    (DB.enrollments || []).forEach(e => { if (e.sport === old) e.sport = newName; });
    sbRenameSport(old, newName);
    sbSaveSettings();
    addLog('sport_rename', `"${old}" → "${newName}"`);
    closeModal('modalEditSport');
    renderSportBatch();
    showToast('Renamed ✓','success');
  });
}
function deleteSportFromModal() {
  const i = parseInt(document.getElementById('editSportIdx').value);
  closeModal('modalEditSport');
  deleteSport(i);
  setTimeout(renderSportBatch, 50);
}
// ── Edit Batch modal ──
function openEditBatchModal(idx) {
  document.getElementById('editBatchIdx').value = idx;
  document.getElementById('editBatchName').value = DB.batches[idx] || '';
  const b = DB.batches[idx];
  const cur = (DB.batchSport && DB.batchSport[b]) || '';
  const sportSel = document.getElementById('editBatchSport');
  if (sportSel) {
    const sports = Array.isArray(DB.sports) ? DB.sports : [];
    sportSel.innerHTML = '<option value="">— none —</option>' +
      sports.map(s => `<option value="${escHtml(s)}"${s===cur?' selected':''}>${escHtml(s)}</option>`).join('');
  }
  openModal('modalEditBatch');
}
function saveEditBatch() {
  const i = parseInt(document.getElementById('editBatchIdx').value);
  const newName = (document.getElementById('editBatchName').value || '').trim();
  const newSport = document.getElementById('editBatchSport')?.value || '';
  if (!newName) { showToast('Enter a batch name','error'); return; }
  const old = DB.batches[i];
  if (DB.batches.some((b,j) => j!==i && b.toLowerCase() === newName.toLowerCase())) { showToast('Batch already exists','error'); return; }
  confirm_('✏️','Save Batch',`Update batch "${old}"?`, () => {
    // Rename if changed
    if (newName !== old) {
      DB.students.forEach(s => { if (s.batch === old) s.batch = newName; });
      DB.batches[i] = newName;
      if (DB.batchSport && DB.batchSport[old] !== undefined) {
        DB.batchSport[newName] = DB.batchSport[old];
        delete DB.batchSport[old];
      }
      (DB.enrollments || []).forEach(e => { if (e.batch === old) e.batch = newName; });
      sbRenameBatch(old, newName);
    }
    // Update sport mapping
    if (!DB.batchSport) DB.batchSport = {};
    if (newSport) DB.batchSport[newName] = newSport;
    else delete DB.batchSport[newName];
    sbSaveSettings();
    addLog('batch_edit', `Batch "${old}" → "${newName}" (sport: ${newSport||'none'})`);
    closeModal('modalEditBatch');
    renderSportBatch();
    renderBatchChips('student'); renderBatchChips('att'); renderBatchChips('fee');
    showToast('Batch updated ✓','success');
  });
}
function deleteBatchFromModal() {
  const i = parseInt(document.getElementById('editBatchIdx').value);
  closeModal('modalEditBatch');
  deleteBatch(i);
  setTimeout(renderSportBatch, 50);
}

function renderSportList() {
  const wrap = document.getElementById('sportListWrap');
  if (!wrap) return;
  if (!Array.isArray(DB.sports)) DB.sports = [];
  let html = '';
  DB.sports.forEach((sp, i) => {
    const batchCount = Object.values(DB.batchSport || {}).filter(v => v === sp).length;
    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
      <input type="text" class="form-input" id="sportInp${i}" value="${escHtml(sp)}" style="flex:1;">
      <button class="btn btn-primary btn-xs" onclick="renameSport(${i})">✓</button>
      <button class="btn btn-danger btn-xs" onclick="deleteSport(${i})">✕</button>
      <span style="font-size:11px;color:var(--gray);white-space:nowrap;">${batchCount} batch${batchCount===1?'':'es'}</span>
    </div>`;
  });
  wrap.innerHTML = html || `<div style="color:var(--gray);font-size:12px;">No sports yet. Tap + Add to create one.</div>`;
}
function openAddSportModal() {
  document.getElementById('newSportName').value = '';
  openModal('modalAddSport');
}
function saveNewSport() {
  const name = document.getElementById('newSportName').value.trim();
  if (!name) { showToast('Enter a sport name','error'); return; }
  if (!Array.isArray(DB.sports)) DB.sports = [];

  // ── Plan sport limit check ──────────────────────────────────
  const sportLimit = (typeof planSportLimit === 'function') ? planSportLimit() : 1;
  if (sportLimit !== null && DB.sports.length >= sportLimit) {
    const nextPlan = sportLimit <= 2 ? 'Pro (10 sports)' : sportLimit <= 10 ? 'Premium (20 sports)' : 'Premium';
    showPlanLimitToast('sports', sportLimit, nextPlan);
    setTimeout(() => { if (typeof fzOpenPlans === 'function') fzOpenPlans(); }, 800);
    return;
  }
  if (DB.sports.length >= 20) { showToast('Max 20 sports reached','error'); return; }
  if (DB.sports.some(s => s.toLowerCase() === name.toLowerCase())) { showToast('Sport already exists','error'); return; }
  confirm_('➕','Add Sport',`Add sport "${name}"?`, () => {
    DB.sports.push(name);
    sbAddSport(name, DB.sports.length - 1);
    sbSaveSettings();
    addLog('sport_add', `Added sport "${name}"`);
    closeModal('modalAddSport');
    renderSportList();
    renderSportBatch();
    showToast('Sport added ✓','success');
  });
}
function renameSport(i) {
  const newName = document.getElementById(`sportInp${i}`)?.value.trim();
  if (!newName) return;
  const old = DB.sports[i];
  if (newName === old) return;
  if (DB.sports.some((s,j) => j!==i && s.toLowerCase() === newName.toLowerCase())) { showToast('Sport already exists','error'); return; }
  confirm_('✏️','Rename Sport',`Rename "${old}" → "${newName}"?`, () => {
    DB.sports[i] = newName;
    // Re-point any batches that belonged to the old sport
    Object.keys(DB.batchSport || {}).forEach(b => { if (DB.batchSport[b] === old) DB.batchSport[b] = newName; });
    // Update local enrollments in memory too
    (DB.enrollments || []).forEach(e => { if (e.sport === old) e.sport = newName; });
    sbRenameSport(old, newName);
    sbSaveSettings();
    addLog('sport_rename', `"${old}" → "${newName}"`);
    renderSportList();
    renderBatchList();
    showToast('Renamed ✓','success');
  });
}
function deleteSport(i) {
  const sp = DB.sports[i];
  const batchCount = Object.values(DB.batchSport || {}).filter(v => v === sp).length;
  const enrollCount = (DB.enrollments || []).filter(e => e.sport === sp).length;
  let warn = '';
  if (batchCount) warn += ` ${batchCount} batch(es) will be left without a sport.`;
  if (enrollCount) warn += ` ${enrollCount} student enrollment(s) reference this sport — they will NOT be deleted, but will point to a missing sport.`;
  confirm_('🗑️','Delete Sport',`Delete "${sp}"?${warn}`, () => {
    DB.sports.splice(i,1);
    // Unassign batches that pointed to this sport
    Object.keys(DB.batchSport || {}).forEach(b => { if (DB.batchSport[b] === sp) delete DB.batchSport[b]; });
    sbDeleteSport(sp);
    sbSaveSettings();
    addLog('sport_delete', `Deleted sport "${sp}"`);
    renderSportList();
    renderBatchList();
    showToast('Deleted','success');
  });
}

function renderBatchList() {
  let html = '';
  const sports = Array.isArray(DB.sports) ? DB.sports : [];
  DB.batches.forEach((b,i) => {
    const cnt = getActiveStudents().filter(s => s.batch===b).length;
    const sport = (DB.batchSport && DB.batchSport[b]) || '';
    const opts = `<option value="">— none —</option>` +
      sports.map(s => `<option value="${escHtml(s)}"${s===sport?' selected':''}>${escHtml(s)}</option>`).join('');
    html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
      <input type="text" class="form-input" id="batchInp${i}" value="${escHtml(b)}" style="flex:1;">
      <button class="btn btn-primary btn-xs" onclick="renameBatch(${i})">✓</button>
      <button class="btn btn-danger btn-xs" onclick="deleteBatch(${i})">✕</button>
      <span style="font-size:11px;color:var(--gray);white-space:nowrap;">${cnt} students</span>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin:-1px 0 8px 2px;">
      <span style="font-size:10px;color:var(--gray);white-space:nowrap;">🏆 Sport:</span>
      <select class="form-select" style="flex:1;font-size:11px;padding:5px 8px;" onchange="changeBatchSport('${escHtml(b)}', this.value)">${opts}</select>
    </div>`;
  });
  document.getElementById('batchListWrap').innerHTML = html || `<div style="color:var(--gray);font-size:12px;">No batches yet.</div>`;
}

// Change which sport a batch belongs to (inline). Stage 1: safe re-label.
function changeBatchSport(batchName, newSport) {
  const old = (DB.batchSport && DB.batchSport[batchName]) || 'none';
  const target = newSport || 'none';
  if (old === target) return;
  confirm_('🏆', 'Change Batch Sport',
    `Move batch "${batchName}" from sport "${old}" to "${target}"?\n\nNote: once per-sport attendance & fees are enabled, changing a batch's sport will affect how that batch's records are grouped.`,
    async () => {
      if (!DB.batchSport) DB.batchSport = {};
      if (newSport) DB.batchSport[batchName] = newSport;
      else delete DB.batchSport[batchName];
      const ok = await sbSaveSettings();
      addLog('batch_sport_change', `Batch "${batchName}" sport: ${old} → ${target}`);
      renderBatchList();
      renderSportList();
      if (ok) showToast('Sport updated ✓', 'success');
      else showToast('Could not save to cloud — check DB columns', 'error');
    });
}

function openAddBatchModal() {
  document.getElementById('newBatchName').value = '';
  // Populate the sport dropdown
  const sportSel = document.getElementById('newBatchSport');
  if (sportSel) {
    const sports = Array.isArray(DB.sports) ? DB.sports : [];
    sportSel.innerHTML = sports.length
      ? sports.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('')
      : '<option value="">— No sports yet —</option>';
  }
  openModal('modalAddBatch');
}
function saveNewBatch() {
  const name  = document.getElementById('newBatchName').value.trim();
  const sport = document.getElementById('newBatchSport')?.value || '';
  if (!name)  { showToast('Enter a batch name','error'); return; }

  // ── Plan batch limit check ──────────────────────────────────
  if (!sport) { showToast('Add a sport first, then assign the batch to it','error'); return; }

  const perSportLimit = (typeof planBatchesPerSport === 'function') ? planBatchesPerSport() : 2;
  const totalLimit    = (typeof planBatchLimit      === 'function') ? planBatchLimit()      : 4;
  const plan          = (DB.settings && DB.settings.plan) || 'trial';

  // Check batches already assigned to this specific sport
  const batchesForThisSport = (DB.batches || []).filter(b =>
    DB.batchSport && DB.batchSport[b] === sport
  ).length;

  if (batchesForThisSport >= perSportLimit) {
    const nextPlan = plan === 'basic' ? 'Pro (10 batches per sport)' : 'Premium (20 batches per sport)';
    showToast(
      (typeof planDisplayName==='function'?planDisplayName():'Basic') +
      ' plan: max ' + perSportLimit + ' batches per sport. Upgrade to ' + nextPlan + '.',
      'error'
    );
    setTimeout(() => { if (typeof fzOpenPlans === 'function') fzOpenPlans(); }, 800);
    return;
  }

  // Also check total batch limit
  if (totalLimit !== null && (DB.batches||[]).length >= totalLimit) {
    const nextPlan = plan === 'basic' ? 'Pro (100 total batches)' : 'Premium (400 total batches)';
    showPlanLimitToast('total batches', totalLimit, nextPlan);
    setTimeout(() => { if (typeof fzOpenPlans === 'function') fzOpenPlans(); }, 800);
    return;
  }

  if (DB.batches.length >= 400) { showToast('Maximum batches reached','error'); return; }
  if (DB.batches.includes(name)) { showToast('Batch already exists','error'); return; }
  confirm_('➕','Add Batch',`Add batch "${name}" under sport "${sport}"?`, () => {
    DB.batches.push(name);
    if (!DB.batchSport) DB.batchSport = {};
    DB.batchSport[name] = sport;
    sbAddBatch(name, DB.batches.length - 1);
    sbSaveSettings(); // persist the batch→sport mapping
    addLog('batch_add', `Added batch "${name}" (sport: ${sport})`);
    closeModal('modalAddBatch');
    renderBatchList();
    renderSportBatch();
    renderBatchChips('student'); renderBatchChips('att'); renderBatchChips('fee');
    showToast('Batch added ✓','success');
  });
}
function renameBatch(i) {
  const newName = document.getElementById(`batchInp${i}`)?.value.trim();
  if (!newName) return;
  const old = DB.batches[i];
  confirm_('✏️','Rename Batch',`Rename "${old}" → "${newName}"?`, () => {
    DB.students.forEach(s => { if (s.batch===old) s.batch=newName; });
    DB.batches[i] = newName;
    // Carry the sport mapping to the new name
    if (DB.batchSport && DB.batchSport[old] !== undefined) {
      DB.batchSport[newName] = DB.batchSport[old];
      delete DB.batchSport[old];
    }
    sbRenameBatch(old, newName);
    sbSaveSettings();
    addLog('batch_rename', `"${old}" → "${newName}"`);
    renderBatchList();
    renderBatchChips('student'); renderBatchChips('att'); renderBatchChips('fee');
    showToast('Renamed ✓','success');
  });
}
function deleteBatch(i) {
  const old = DB.batches[i];
  const cnt = DB.students.filter(s => s.batch===old).length;
  confirm_('🗑️','Delete Batch',`Delete "${old}"? ${cnt} students will be moved to first available batch.`, () => {
    const fallback = DB.batches.filter((_,j)=>j!==i)[0] || '';
    DB.students.forEach(s => { if (s.batch===old) s.batch=fallback; });
    DB.batches.splice(i,1);
    if (DB.batchSport) delete DB.batchSport[old];
    sbDeleteBatch(old, fallback);
    sbSaveSettings();
    addLog('batch_delete', `Deleted batch "${old}"`);
    renderBatchList();
    renderBatchChips('student'); renderBatchChips('att'); renderBatchChips('fee');
    showToast('Deleted','success');
  });
}

let _userMgmtTab = 'admins';
function setUserMgmtTab(tab) {
  _userMgmtTab = tab;
  const adminsBtn = document.getElementById('userTabAdmins');
  const staffBtn  = document.getElementById('userTabStaff');
  if (adminsBtn && staffBtn) {
    const active   = 'background:var(--accent2);color:#fff;';
    const inactive = 'background:var(--card2);color:var(--gray);';
    const base = 'flex:1;padding:7px 0;border-radius:8px;border:none;font-size:12px;font-weight:700;cursor:pointer;transition:all .15s;';
    adminsBtn.style.cssText = base + (tab === 'admins' ? active : inactive);
    staffBtn.style.cssText  = base + (tab === 'staff'  ? active : inactive);
  }
  renderUserList();
}
function renderUserList() {
  let html = '';
  const admin = isAdmin();
  // Staff see only their own entry; admins see everyone, filtered by the Admins/Staff sub-tab
  let list = admin ? DB.users : DB.users.filter(u => u.id === (currentUser?.id) || u.uid === (currentUser?.uid));
  if (admin) list = list.filter(u => (_userMgmtTab === 'staff') ? u.role === 'staff' : u.role !== 'staff');
  const titleEl = document.getElementById('userCardTitle');
  if (titleEl) titleEl.textContent = admin ? '🔑 User Management' : '👤 My Profile';

  // ── Staff count badge ──────────────────────────────────────────
  if (admin && typeof planStaffLimit === 'function') {
    const limit       = planStaffLimit();
    const staffCount  = (DB.users||[]).filter(u => u.role === 'staff').length;
    const badgeEl     = document.getElementById('staffLimitBadge');
    if (badgeEl) {
      if (limit === null) {
        badgeEl.textContent = staffCount + ' staff';
        badgeEl.style.cssText = 'font-size:11px;font-weight:600;padding:2px 9px;border-radius:12px;background:var(--card2);color:var(--gray);';
      } else {
        const near = staffCount / limit >= 0.8;
        const full = staffCount >= limit;
        badgeEl.textContent = staffCount + ' / ' + limit + ' staff';
        badgeEl.style.cssText = 'font-size:11px;font-weight:600;padding:2px 9px;border-radius:12px;'
          + 'background:' + (full ? 'rgba(232,57,47,.15)' : near ? 'rgba(245,158,11,.15)' : 'var(--card2)') + ';'
          + 'color:' + (full ? '#e8392f' : near ? '#f59e0b' : 'var(--gray)') + ';';
      }
    }
  }
  list.forEach(u => {
    const batches = Array.isArray(u.assignedBatches) && u.assignedBatches.length > 0
      ? u.assignedBatches.map(b => `<span class="badge badge-blue" style="font-size:10px;">${escHtml(b)}</span>`).join(' ')
      : (u.role === 'staff' ? '<span style="font-size:10px;color:var(--graydk);">All batches</span>' : '');
    const sports = Array.isArray(u.assignedSports) && u.assignedSports.length > 0
      ? u.assignedSports.map(s => `<span class="badge badge-gold" style="font-size:10px;">🏆 ${escHtml(s)}</span>`).join(' ')
      : (u.role === 'staff' ? '<span style="font-size:10px;color:var(--graydk);">All sports</span>' : '');
    html += `<div style="padding:9px 10px;background:var(--card2);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:700;color:var(--offwhite);">👤 ${escHtml(u.name||u.email||u.id)} <span class="badge ${u.role==='admin'?'badge-gold':'badge-blue'}">${u.role}</span></div>
          <div style="font-size:11px;color:var(--gray);margin-top:2px;">📧 ${escHtml(u.email||u.id)}</div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0;">
          ${(admin && u.role==='staff')?`<button onclick="openEditUser('${escHtml(u.id)}')" class="btn btn-outline btn-xs">✏️ Edit</button>`:''}
          ${(admin && u.role==='staff')?`<button onclick="deleteUser('${escHtml(u.id)}')" class="btn btn-danger btn-xs">🗑️</button>`:''}
        </div>
      </div>
      ${u.role==='staff'?`<div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
        <span style="font-size:10px;color:var(--graydk);">Sports:</span> ${sports}
      </div>
      <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap;align-items:center;">
        <span style="font-size:10px;color:var(--graydk);">Batches:</span> ${batches}
      </div>`:''}
    </div>`;
  });
  document.getElementById('userListWrap').innerHTML = html || `<div style="color:var(--gray);font-size:12px;">No ${admin && _userMgmtTab==='staff' ? 'staff' : 'admins'} yet.</div>`;
}
function toggleAcc(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}
function openAddUserModal(role='staff') {
  document.getElementById('modalUserTitle').textContent = 'Add ' + (role==='admin'?'Admin':'Staff');
  document.getElementById('editUserId').value = '';
  document.getElementById('newUserId').value = '';
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPass').value = '';
  const roleEl = document.getElementById('newUserRole');
  if (roleEl) roleEl.value = role;
  const errEl = document.getElementById('userSaveError');
  if (errEl) errEl.style.display = 'none';
  populateSportAssignCheckboxes([]);
  populateBatchAssignCheckboxes([], []);
  toggleBatchAssignField();
  openModal('modalUser');
}
function openEditUser(id) {
  const u = DB.users.find(x => x.id===id);
  if (!u) return;
  document.getElementById('modalUserTitle').textContent = 'Edit User';
  document.getElementById('editUserId').value = id;
  document.getElementById('newUserId').value = u.email || u.id;
  document.getElementById('newUserName').value = u.name || '';
  document.getElementById('newUserPass').value = '';
  const roleEl = document.getElementById('newUserRole');
  if (roleEl) roleEl.value = u.role;
  const errEl = document.getElementById('userSaveError');
  if (errEl) errEl.style.display = 'none';
  populateSportAssignCheckboxes(u.assignedSports || []);
  populateBatchAssignCheckboxes(u.assignedBatches || [], u.assignedSports || []);
  toggleBatchAssignField();
  openModal('modalUser');
}
async function saveUser() {
  const eid    = document.getElementById('editUserId').value;
  const email  = document.getElementById('newUserId').value.trim().toLowerCase();
  const name   = document.getElementById('newUserName').value.trim();
  const pass   = document.getElementById('newUserPass').value;
  const roleEl = document.getElementById('newUserRole');
  const role   = roleEl ? roleEl.value : 'staff';
  const errEl  = document.getElementById('userSaveError');
  const btn    = document.getElementById('saveUserBtn');

  if (errEl) errEl.style.display = 'none';
  if (!email) { showToast('Email is required','error'); return; }

  // ── Plan staff limit check (only for new staff, not edits) ──────
  if (!eid && role === 'staff') {
    const limit = (typeof planStaffLimit === 'function') ? planStaffLimit() : 2;
    if (limit !== null) {
      const currentStaff = (DB.users||[]).filter(u => u.role === 'staff').length;
      if (currentStaff >= limit) {
        const nextPlan = limit <= 2 ? 'Pro (4 staff)' : limit <= 4 ? 'Premium (20 staff)' : 'Premium';
        if (errEl) {
          errEl.textContent = (typeof planDisplayName==='function' ? planDisplayName() : 'Basic')
            + ' plan limit: ' + limit + ' staff members. Upgrade to ' + nextPlan + '.';
          errEl.style.display = '';
        }
        showToast('Staff limit reached. Upgrade your plan to add more.', 'error');
        setTimeout(() => { if (typeof fzOpenPlans === 'function') fzOpenPlans(); }, 1000);
        return;
      }
    }
  }

  // For new users, validate password
  if (!eid) {
    if (!pass || pass.length < 6) {
      if (errEl) { errEl.textContent = 'Password must be at least 6 characters.'; errEl.style.display = ''; }
      return;
    }
    if (DB.users.find(u => u.email === email)) { showToast('Email already exists','error'); return; }
  }

  const uid = email.replace(/[^a-z0-9]/g, '_');

  // Staff must have at least one sport AND one batch assigned
  if (role === 'staff') {
    const selSports  = getSelectedSportAssignments();
    const selBatches = getSelectedBatchAssignments();
    if (!selSports.length) {
      if (errEl) { errEl.textContent = 'Please assign at least one sport.'; errEl.style.display = ''; }
      return;
    }
    if (!selBatches.length) {
      if (errEl) { errEl.textContent = 'Please assign at least one batch.'; errEl.style.display = ''; }
      return;
    }
  }

  // For edits — update database profile (name, role, batches)
  if (eid) {
    confirm_('👤','Save User',`Update profile for "${email}"?`, async () => {
      const idx = DB.users.findIndex(u => u.id===eid);
      const newBatches = getSelectedBatchAssignments();
      const newSports  = getSelectedSportAssignments();
      if (idx>=0) DB.users[idx] = { ...DB.users[idx], id:uid, email, name:name||email, role, assignedBatches: newBatches, assignedSports: newSports };
      // Update the app_users profile row in Supabase (by old login id)
      await sbUpdateUserByLogin(eid, {
        login_id: uid, email, name: name||email, role, assigned_batches: newBatches, assigned_sports: newSports
      });
      addLog('user', `Edited user "${email}"`);
      // NOTE: changing a Supabase Auth user's password from the client isn't
      // possible with the anon key. Password changes need the Supabase dashboard
      // or an Edge Function. (Flagged for Stage D.)
      closeModal('modalUser');
      renderUserList();
      showToast('User updated ✓', 'success');
    });
    return;
  }

  // For new users — create the Supabase Auth account via an Edge Function,
  // then save the profile row. (Edge Function 'create-user' must be deployed.)
  confirm_('👤','Create User',`Create login for "${email}" as ${role}?`, async () => {
    if (btn) { btn.textContent = 'Creating...'; btn.disabled = true; }
    try {
      const { data, error } = await sb().functions.invoke('create-user', {
        body: { email, password: pass, name: name||email, role: 'staff',
                academy_id: acadId(), login_id: uid,
                assigned_batches: getSelectedBatchAssignments(),
                assigned_sports: getSelectedSportAssignments() }
      });
      if (error) {
      let realMsg = error.message || 'Failed to create user';
      if (error.context && typeof error.context.json === 'function') {
      try {
      const body = await error.context.json();
      if (body && body.error) realMsg = body.error;
      } catch(_) { /* response wasn't JSON — keep generic message */ }
      }
      throw new Error(realMsg);
      }
      if (data && data.error) throw new Error(data.error);
      // Profile is created server-side by the function; reflect locally
      DB.users.push({ id:uid, uid: data && data.uid, email, name:name||email, role, assignedBatches: getSelectedBatchAssignments(), assignedSports: getSelectedSportAssignments() });
      addLog('user', `Added user "${email}" (${role})`);
      closeModal('modalUser');
      renderUserList();
      showToast('User created ✓ — they can now log in', 'success');

    } catch(err) {
      if (errEl) { errEl.textContent = '⚠️ ' + (err.message || 'Could not create user'); errEl.style.display = ''; }
      showToast('Error: ' + (err.message || 'Could not create user'), 'error');
    } finally {
      if (btn) { btn.textContent = '💾 Save User'; btn.disabled = false; }
    }
  });
}
function deleteUser(id) {
  const u = DB.users.find(x => x.id === id);
  const label = u ? (u.name || u.email || id) : id;
  confirm_('🗑️','Delete Staff',`Permanently delete "${label}"? Their login and access will be removed. This cannot be undone.`, async () => {
    try {
      // Try full removal (profile + auth login) via the Edge Function
      const { data, error } = await sb().functions.invoke('delete-user', {
        body: { login_id: id, uid: u && u.uid }
      });
      if (error) throw new Error(error.message || 'Delete failed');
      if (data && data.error) throw new Error(data.error);
      // Reflect locally
      DB.users = DB.users.filter(x => x.id !== id);
      addLog('user', `Deleted staff "${label}"`);
      renderUserList();
      if (data && data.warning) showToast(data.warning, 'warn');
      else showToast('Staff deleted ✓', 'success');
    } catch (err) {
      // Fallback: remove the profile row only (login may linger until cleaned in dashboard)
      DB.users = DB.users.filter(x => x.id !== id);
      await sbDeleteUserByLogin(id);
      addLog('user', `Deleted staff profile "${label}" (auth login may remain)`);
      renderUserList();
      showToast('Removed profile. Note: ' + (err.message || 'login may remain'), 'warn');
    }
  });
}

let logTab = 'admin';
// ── Activity Log category filter (multi-select) ──
const LOG_CATEGORIES = {
  'Students':          ['student_add','student_edit','student_delete','student_ban','student_unban','student_bulk_edit','student_import'],
  'Attendance':        ['attendance'],
  'Fees':              ['fee'],
  'Sports & Batches':  ['sport_add','sport_rename','sport_delete','batch_add','batch_rename','batch_edit','batch_delete','batch_sport_change'],
  'Classes':           ['classlog'],
  'Queries':           ['enquiry'],
  'Messages':          ['message'],
  'Users':             ['user'],
  'Settings':          ['settings','snapshot'],
  'Login / Session':   ['login','logout'],
};
function _catOfAction(action) {
  for (const cat of Object.keys(LOG_CATEGORIES)) {
    if (LOG_CATEGORIES[cat].includes(action)) return cat;
  }
  return 'Other';
}
let _actSelectedCats = []; // empty = all
function toggleCatMenu(which) {
  const menu = document.getElementById('actCatMenu');
  if (!menu) return;
  const showing = menu.style.display !== 'none';
  if (showing) { menu.style.display = 'none'; return; }
  renderCatMenu();
  menu.style.display = '';
}
function renderCatMenu() {
  const menu = document.getElementById('actCatMenu');
  if (!menu) return;
  const cats = Object.keys(LOG_CATEGORIES);
  menu.innerHTML = cats.map(c => `
    <label class="cat-opt">
      <input type="checkbox" value="${escHtml(c)}" ${_actSelectedCats.includes(c)?'checked':''}
        onchange="onCatToggle('${escHtml(c)}',this.checked)">
      <span>${escHtml(c)}</span>
    </label>`).join('') +
    `<div style="display:flex;gap:6px;margin-top:6px;">
      <button class="btn btn-xs btn-outline" style="flex:1;" onclick="clearCats()">Clear</button>
      <button class="btn btn-xs btn-primary" style="flex:1;" onclick="toggleCatMenu('act')">Done</button>
    </div>`;
}
function onCatToggle(cat, checked) {
  const i = _actSelectedCats.indexOf(cat);
  if (checked && i < 0) _actSelectedCats.push(cat);
  if (!checked && i >= 0) _actSelectedCats.splice(i,1);
  updateCatBtnLabel();
  renderChangeLog();
}
function clearCats() {
  _actSelectedCats = [];
  renderCatMenu();
  updateCatBtnLabel();
  renderChangeLog();
}
function updateCatBtnLabel() {
  const btn = document.getElementById('actCatBtn');
  if (btn) btn.textContent = _actSelectedCats.length ? `🔽 Categories (${_actSelectedCats.length})` : '🔽 Categories';
}

// ── Fees Log channel filter (WhatsApp / SMS) ──
const FEE_LOG_TYPES = { 'WhatsApp': 'whatsapp', 'SMS': 'sms' };
let _feeSelectedTypes = []; // empty = all
function toggleFeeCatMenu() {
  const menu = document.getElementById('feeCatMenu');
  if (!menu) return;
  const showing = menu.style.display !== 'none';
  if (showing) { menu.style.display = 'none'; return; }
  renderFeeCatMenu();
  menu.style.display = '';
}
function renderFeeCatMenu() {
  const menu = document.getElementById('feeCatMenu');
  if (!menu) return;
  const cats = Object.keys(FEE_LOG_TYPES);
  menu.innerHTML = cats.map(c => `
    <label class="cat-opt">
      <input type="checkbox" value="${escHtml(c)}" ${_feeSelectedTypes.includes(c)?'checked':''}
        onchange="onFeeCatToggle('${escHtml(c)}',this.checked)">
      <span>${c === 'WhatsApp' ? '💬' : '📱'} ${escHtml(c)}</span>
    </label>`).join('') +
    `<div style="display:flex;gap:6px;margin-top:6px;">
      <button class="btn btn-xs btn-outline" style="flex:1;" onclick="clearFeeCats()">Clear</button>
      <button class="btn btn-xs btn-primary" style="flex:1;" onclick="toggleFeeCatMenu()">Done</button>
    </div>`;
}
function onFeeCatToggle(cat, checked) {
  const i = _feeSelectedTypes.indexOf(cat);
  if (checked && i < 0) _feeSelectedTypes.push(cat);
  if (!checked && i >= 0) _feeSelectedTypes.splice(i,1);
  updateFeeCatBtnLabel();
  renderMsgLog();
}
function clearFeeCats() {
  _feeSelectedTypes = [];
  renderFeeCatMenu();
  updateFeeCatBtnLabel();
  renderMsgLog();
}
function updateFeeCatBtnLabel() {
  const btn = document.getElementById('feeCatBtn');
  if (btn) btn.textContent = _feeSelectedTypes.length ? `🔽 Type (${_feeSelectedTypes.length})` : '🔽 Type';
}

function renderChangeLog(tab) {
  if (tab) logTab = tab;
  const el = document.getElementById('changeLogWrap');
  if (!el) return;

  // Apply plan retention window filter
  const retDays = (typeof planLogRetentionDays === 'function') ? planLogRetentionDays() : 90;
  const retLabel = (typeof planLogRetentionLabel === 'function') ? planLogRetentionLabel() : '3 months';
  const cutoff = new Date(Date.now() - retDays * 24 * 60 * 60 * 1000).toISOString();
  const planName = (typeof planDisplayName === 'function') ? planDisplayName() : 'Basic';
  const nextPlan = planName === 'Basic' ? 'Pro (6 months)' : planName === 'Pro' ? 'Premium (9 months)' : null;

  const all = (DB.changelog || []).filter(l => l.time >= cutoff);
  let adminLogs = all.filter(l => l.role === 'admin' || (!l.role && DB.users.find(u=>u.id===l.user)?.role==='admin'));
  let staffLogs = all.filter(l => l.role === 'staff' || (!l.role && DB.users.find(u=>u.id===l.user)?.role==='staff'));
  if (_actSelectedCats.length) {
    const f = l => _actSelectedCats.includes(_catOfAction(l.action));
    adminLogs = adminLogs.filter(f);
    staffLogs = staffLogs.filter(f);
  }
  const show = logTab === 'admin' ? adminLogs : staffLogs;

  // Retention badge
  const retBadge = `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:var(--card2);border-radius:7px;margin-bottom:8px;font-size:11px;">
    <span style="color:var(--gray);">
      <span style="color:var(--accent2);font-weight:700;">${planName}</span> plan · ${retLabel} history
    </span>
    ${nextPlan ? `<span style="color:var(--gold);cursor:pointer;" onclick="if(typeof fzOpenPlans==='function')fzOpenPlans()">↑ ${nextPlan}</span>` : ''}
  </div>`;

  const tabHtml = `<div style="display:flex;gap:6px;margin-bottom:8px;">
    <button onclick="renderChangeLog('admin')" style="flex:1;padding:5px;border-radius:7px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:${logTab==='admin'?'var(--accent2)':'var(--card2)'};color:${logTab==='admin'?'#fff':'var(--gray)'};">🔑 Admin (${adminLogs.length})</button>
    <button onclick="renderChangeLog('staff')" style="flex:1;padding:5px;border-radius:7px;border:none;font-size:12px;font-weight:600;cursor:pointer;background:${logTab==='staff'?'var(--accent2)':'var(--card2)'};color:${logTab==='staff'?'#fff':'var(--gray)'};">👤 Staff (${staffLogs.length})</button>
  </div>`;

  const rowsHtml = show.length
    ? show.slice(0,200).map(l =>
        `<div class="log-row">
          <div style="font-size:12px;">${escHtml(l.action)}: ${escHtml(l.detail)}</div>
          <div class="log-meta">${escHtml(l.user)} · ${new Date(l.time).toLocaleString()}</div>
        </div>`).join('')
    : `<div style="color:var(--gray);font-size:12px;padding:8px;">No ${logTab} activity in the last ${retLabel}.</div>`;

  el.innerHTML = retBadge + tabHtml + `<div style="max-height:200px;overflow-y:auto;">${rowsHtml}</div>`;
}

// ----------------------------------------------------------------
// LOGO
// ----------------------------------------------------------------
function changeLogo(e) {
  const file = e.target.files[0];
  if (!file) return;
  // Reset input so same file can be re-selected
  e.target.value = '';
  const reader = new FileReader();
  reader.onload = ev => openLogoCropper(ev.target.result);
  reader.readAsDataURL(file);
}

// ── Logo Cropper ─────────────────────────────────────────────────
let _cropImg = null, _cropScale = 1, _cropOffX = 0, _cropOffY = 0;
let _cropDrag = false, _cropLastX = 0, _cropLastY = 0;

function openLogoCropper(src) {
  _cropImg = new Image();
  _cropImg.onload = () => {
    _cropScale = 1; _cropOffX = 0; _cropOffY = 0;
    document.getElementById('cropZoomVal').textContent = '100%';
    document.getElementById('cropZoomRange').value = 100;
    _drawCrop();
    openModal('modalLogoCrop');
  };
  _cropImg.src = src;
}

function _drawCrop() {
  const canvas = document.getElementById('cropCanvas');
  if (!canvas || !_cropImg) return;
  const SIZE = canvas.width;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);

  // Draw checkerboard background
  ctx.fillStyle = '#e0e0e0';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#c0c0c0';
  for (let r = 0; r < SIZE; r += 16)
    for (let c = 0; c < SIZE; c += 16)
      if ((r/16 + c/16) % 2 === 0) ctx.fillRect(c, r, 16, 16);

  // Draw image
  const iw = _cropImg.naturalWidth * _cropScale;
  const ih = _cropImg.naturalHeight * _cropScale;
  const x = SIZE/2 - iw/2 + _cropOffX;
  const y = SIZE/2 - ih/2 + _cropOffY;
  ctx.drawImage(_cropImg, x, y, iw, ih);

  // Dim outside circle
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.rect(0, 0, SIZE, SIZE);
  ctx.arc(SIZE/2, SIZE/2, SIZE/2 - 4, 0, Math.PI*2, true);
  ctx.fill();
  ctx.restore();

  // Circle border
  ctx.save();
  ctx.strokeStyle = '#5b7cc4';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(SIZE/2, SIZE/2, SIZE/2 - 4, 0, Math.PI*2);
  ctx.stroke();
  ctx.restore();
}

function _cropSetZoom(val) {
  _cropScale = val / 100;
  document.getElementById('cropZoomVal').textContent = val + '%';
  _drawCrop();
}

function _cropPointerDown(e) {
  _cropDrag = true;
  const pt = e.touches ? e.touches[0] : e;
  _cropLastX = pt.clientX; _cropLastY = pt.clientY;
  e.preventDefault();
}
function _cropPointerMove(e) {
  if (!_cropDrag) return;
  const pt = e.touches ? e.touches[0] : e;
  _cropOffX += pt.clientX - _cropLastX;
  _cropOffY += pt.clientY - _cropLastY;
  _cropLastX = pt.clientX; _cropLastY = pt.clientY;
  _drawCrop();
  e.preventDefault();
}
function _cropPointerUp() { _cropDrag = false; }

function _cropWheel(e) {
  e.preventDefault();
  const range = document.getElementById('cropZoomRange');
  let v = parseInt(range.value) + (e.deltaY < 0 ? 5 : -5);
  v = Math.min(300, Math.max(50, v));
  range.value = v;
  _cropSetZoom(v);
}

function saveLogoCrop() {
  const canvas = document.getElementById('cropCanvas');
  if (!canvas || !_cropImg) return;
  // Render final 128×128 (smaller = faster save, still crisp on mobile)
  const out = document.createElement('canvas');
  out.width = out.height = 96;
  const ctx = out.getContext('2d');
  ctx.beginPath();
  ctx.arc(48, 48, 48, 0, Math.PI*2);
  ctx.clip();
  const SIZE = canvas.width;
  const iw = _cropImg.naturalWidth * _cropScale;
  const ih = _cropImg.naturalHeight * _cropScale;
  const x = SIZE/2 - iw/2 + _cropOffX;
  const y = SIZE/2 - ih/2 + _cropOffY;
  const ratio = 96 / SIZE;
  ctx.drawImage(_cropImg, x * ratio, y * ratio, iw * ratio, ih * ratio);
  // Use JPEG at 0.60 quality — keeps file small enough for Supabase TEXT column
  const dataUrl = out.toDataURL('image/jpeg', 0.60);
  DB.settings.logoUrl = dataUrl;
  // Persist to localStorage immediately as a reliable fallback
  try { localStorage.setItem('fezo_logo_' + (acadId()||'local'), dataUrl); } catch(e) {}
  sbSaveLogo();
  updateLogos();
  addLog('settings', 'Logo changed');
  closeModal('modalLogoCrop');
  showToast('Logo updated ✓', 'success');
}
function refreshProfileMsgField() {
  const el = document.getElementById('profileMsgTemplate');
  if (el) el.value = getDefaultMsgTemplate();
}

function updateLogos() {
  // Try DB first, then localStorage fallback (survives refresh before Supabase loads)
  let url = DB.settings.logoUrl;
  if (!url) {
    try { url = localStorage.getItem('fezo_logo_' + (acadId()||'local')) || ''; } catch(e) {}
    if (url) DB.settings.logoUrl = url; // restore into DB so rest of app sees it
  }
  ['topLogo','profileLogo','profileLogoEdit'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = url ? `<img src="${url}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit;">` : '⚔️';
  });
  const ll = document.getElementById('loginLogo');
  if (ll) ll.innerHTML = url ? `<img src="${url}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">` : '<svg viewBox="0 0 24 24" fill="#e8392f" width="40" height="40"><circle cx="12" cy="8" r="4"/><path d="M12 14c-4.4 0-8 2.2-8 5v1h16v-1c0-2.8-3.6-5-8-5z"/></svg>';
}

// ----------------------------------------------------------------
// NOTES
// ----------------------------------------------------------------
function openNoteModal() {
  document.getElementById('noteText').value = DB.notes || '';
  openModal('modalNote');
}
function saveNote() {
  DB.notes = document.getElementById('noteText').value;
  addLog('notes', 'Notes updated');
  sbSaveSettings(); // notes is a column on the academies row
  closeModal('modalNote');
  showToast('Note saved ✓','success');
}

// ----------------------------------------------------------------
// DOWNLOAD PDF / XL
// ----------------------------------------------------------------
// ── Plan feature gate helper ─────────────────────────────────────
// Checks if the current plan allows a feature. If not, shows upgrade prompt.
// feature: 'reports' | 'bulk_import' | 'whatsapp'
function gatedFeature(feature, fnName, args) {
  const plan = (DB.settings && DB.settings.plan) || 'trial';
  // Trial is a Premium-tier trial — unlock the same feature set as Pro/Premium
  const proPlans = ['pro', 'premium', 'trial'];
  const featureMap = {
    reports:     { plans: proPlans, label: 'PDF & Excel reports',    upgrade: 'Pro' },
    bulk_import: { plans: proPlans, label: 'Bulk import / export',   upgrade: 'Pro' },
    whatsapp:    { plans: proPlans, label: 'WhatsApp reports',        upgrade: 'Pro' },
    performance: { plans: proPlans, label: 'Performance tracking',   upgrade: 'Pro' },
    schedules:   { plans: proPlans, label: 'Staff scheduling',        upgrade: 'Premium' },
  };
  const gate = featureMap[feature];
  if (!gate) { window[fnName] && window[fnName](...args); return; }
  if (gate.plans.includes(plan)) {
    // Plan allows it — call the function (no eval, use window scope safely)
    const fn = window[fnName];
    if (typeof fn === 'function') fn(...args);
    return;
  }
  // Plan doesn't allow it — show upgrade toast + open plans modal
  showToast(
    (typeof planDisplayName === 'function' ? planDisplayName() : 'Basic') +
    ' plan does not include ' + gate.label + '. Upgrade to ' + gate.upgrade + ' to unlock.',
    'error'
  );
  setTimeout(() => { if (typeof fzOpenPlans === 'function') fzOpenPlans(); }, 800);
}

function downloadAttendance(fmt) {
  const y = document.getElementById('attYear').value;
  const m = document.getElementById('attMonth').value;
  const d = document.getElementById('attDate').value;
  const viewType = document.getElementById('attViewType').value;
  const batch = selectedBatch.att;
  const searchQ = (document.getElementById('attSearch')?.value || '').trim().toLowerCase();
  const statusFilter = document.getElementById('attStatusFilter')?.value || 'all';

  const sp = attCurrentSport();
  const _spSids = sp === 'ALL'
    ? new Set((DB.enrollments||[]).map(e => e.studentId))
    : new Set((DB.enrollments||[]).filter(e => e.sport === sp).map(e => e.studentId));
  let students = getActiveStudents().filter(s => _spSids.has(s._sid || s.id));
  if (batch !== 'ALL') students = students.filter(s => s.batch===batch);
  if (searchQ) students = students.filter(s => (s.name||'').toLowerCase().includes(searchQ) || String(s.rollNo||'').toLowerCase().includes(searchQ));

  if (viewType === 'day') {
    const dk = `${y}-${pad(m)}-${pad(d)}`;
    const dayData = attDayMap(dk);
    const classDay = isClassDay(dk);
    let enrolled = students.filter(s => isEnrolledOnDate(s, parseInt(y), parseInt(m), parseInt(d)));
    // Apply status filter
    if (statusFilter === 'present') enrolled = enrolled.filter(s => dayData[s.id]==='P');
    else if (statusFilter === 'absent') enrolled = enrolled.filter(s => dayData[s.id]==='A' || (!dayData[s.id] && classDay));
    const headers = ['Name','Batch','Status'];
    const rows = enrolled.map(s => {
      const v = dayData[s.id];
      let status = '';
      if (!classDay) status = 'Holiday';
      else if (v==='P') status = 'Present';
      else if (v==='A') status = 'Absent';
      else status = 'Leave';
      return [s.name, s.batch||'', status];
    });
    const title = `${sp} Attendance — ${pad(d)} ${MONTHS[parseInt(m)-1]} ${y}`;
    if (fmt==='pdf') genPDF(`Att_${sp}_${pad(d)}_${MONTHS[parseInt(m)-1]}_${y}`, headers, rows, title);
    else genXL(`Att_${sp}_${pad(d)}_${MONTHS[parseInt(m)-1]}_${y}`, headers, rows);
  } else {
    const prefix = `${y}-${pad(m)}-`;
    const classDays = Object.keys(DB.attendance).filter(k=>k.startsWith(prefix)&&isClassDay(k)).sort();
    let enrolled = students.filter(s => isEnrolledOnDate(s, parseInt(y), parseInt(m), 0));
    // Apply status filter for month view
    if (statusFilter === 'present') enrolled = enrolled.filter(s => studentAttendedMonth(s.id, parseInt(y), parseInt(m)));
    else if (statusFilter === 'absent') enrolled = enrolled.filter(s => !studentAttendedMonth(s.id, parseInt(y), parseInt(m)));
    const headers = ['Name','Batch','Present Days','Absent Days','Leave Days','Present Dates'];
    const rows = enrolled.map(s => {
      let p=0,a=0,l=0,dates=[];
      classDays.forEach(dk => { const v=attGet(dk, s.id); if(v==='P'){p++;dates.push(parseInt(dk.split('-')[2]));}else if(v==='A')a++;else l++; });
      return [s.name, s.batch||'', p, a, l, dates.join(', ')];
    });
    const title = `Attendance — ${MONTHS[parseInt(m)-1]} ${y} (${classDays.length} class days)`;
    if (fmt==='pdf') genPDF(`Att_${MONTHS[parseInt(m)-1]}_${y}`, headers, rows, title);
    else genXL(`Att_${MONTHS[parseInt(m)-1]}_${y}`, headers, rows);
  }
}

function downloadFees(fmt) {
  const batch = selectedBatch.fee;
  const statusFilter = document.getElementById('feeStatusFilter')?.value || 'all';
  const searchQ = (document.getElementById('feeSearch')?.value || '').trim().toLowerCase();
  const headers = ['Name','Batch','Contact','Joined','Month','Attendance','Fee Status','Amount (₹)','Method','Payment Date'];
  let rows = [];
  let titleStr = '';
  let feeMonthKeys = [];

  const feeSp = feeCurrentSport();
  const sortBy = document.getElementById('feeSortBy')?.value || 'roll';
  const statusLabel = statusFilter === 'paid' ? ' · Paid only' : statusFilter === 'unpaid' ? ' · Not Paid only' : '';
  const batchLabel = batch !== 'ALL' ? ' · ' + batch : '';
  if (feeFilterMode === 'year') {
    const fy = getFeeYear();
    for (let m = 1; m <= 12; m++) feeMonthKeys.push(`${fy}-${pad(m)}`);
    titleStr = `${feeSp} Fee Report — Year ${fy}${batchLabel}${statusLabel}`;
  } else {
    feeMonthKeys = [getFeeKey()];
    const [fy, fm] = feeMonthKeys[0].split('-').map(Number);
    titleStr = `${feeSp} Fee Payment — ${MONTHS[fm-1]} ${fy}${batchLabel}${statusLabel}`;
  }

  const _spSids = feeSp === 'ALL'
    ? new Set((DB.enrollments||[]).map(e => e.studentId))
    : new Set((DB.enrollments||[]).filter(e => e.sport === feeSp).map(e => e.studentId));
  let students = getActiveStudents().filter(s => _spSids.has(s._sid || s.id));
  if (batch !== 'ALL') students = students.filter(s => s.batch === batch);
  if (searchQ) students = students.filter(s =>
    (s.name||'').toLowerCase().includes(searchQ) ||
    String(s.rollNo||'').toLowerCase().includes(searchQ)
  );
  // Sort to match the screen
  students.sort(makeSorter(sortBy));

  feeMonthKeys.forEach(fk => {
    const [fy, fm] = fk.split('-').map(Number);
    const feeData = feeMonthMap(fk);
    const monthStudents = students.filter(s => isEnrolledOnDate(s, fy, fm, 0));
    // Only include students who attended (same logic as renderFees)
    const eligible = monthStudents.filter(s => studentAttendedMonth(s.id, fy, fm));
    eligible.forEach(s => {
      const e = feeData[s.id] || {};
      const p = isPaid(e);
      // Apply status filter
      if (statusFilter === 'paid' && !p) return;
      if (statusFilter === 'unpaid' && p) return;
      rows.push([s.name, s.batch||'', s.contact||'', s.joinDate||'',
        MONTHS[fm-1]+' '+fy, 'Yes', p?'Paid':'Not Paid',
        e.amount||'', e.method||'',
        e.date ? new Date(e.date).toLocaleDateString() : '']);
    });
  });

  const fname = `Fees_${feeSp}_${feeMonthKeys[0]}_to_${feeMonthKeys[feeMonthKeys.length-1]}`.replace(/-/g,'');
  if (fmt==='pdf') genPDF(fname, headers, rows, titleStr);
  else genXL(fname, headers, rows);
}

function genPDF(filename, headers, rows, title) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: rows[0]?.length > 5 ? 'landscape' : 'portrait' });
    doc.setFontSize(13); doc.setTextColor(30,58,138);
    doc.text(DB.settings.academyName, 14, 14);
    doc.setFontSize(10); doc.setTextColor(100,116,139);
    doc.text(title, 14, 21);
    doc.autoTable({
      head:[headers], body:rows, startY:26,
      styles:{fontSize:8, cellPadding:3},
      headStyles:{fillColor:[30,58,138], textColor:255, fontStyle:'bold'},
      alternateRowStyles:{fillColor:[240,245,255]},
      margin:{left:14,right:14}
    });
    doc.save(filename + '.pdf');
    showToast('PDF downloaded ✓','success');
  } catch(e){ showToast('PDF error: '+e.message,'error'); }
}
function genXL(filename, headers, rows) {
  try {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers,...rows]);
    // Style header row width
    ws['!cols'] = headers.map(() => ({wch:18}));
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, filename + '.xlsx');
    showToast('Excel downloaded ✓','success');
  } catch(e){ showToast('XL error: '+e.message,'error'); }
}

// ----------------------------------------------------------------
// XSS SAFE HTML
// ----------------------------------------------------------------
function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ----------------------------------------------------------------
// EXPORT — Activity Log & Message Log
// ----------------------------------------------------------------
function exportActivityLog(fmt) {
  let logs = [];
  if (isAdmin()) {
    logs = DB.changelog.slice();
  } else if (currentUser) {
    logs = DB.changelog.filter(l => l.user === currentUser.id);
  }
  // Apply the same category filter as the on-screen list
  if (_actSelectedCats.length) logs = logs.filter(l => _actSelectedCats.includes(_catOfAction(l.action)));
  logs = logs.slice(0, 500);
  const headers = ['User', 'Role', 'Category', 'Action', 'Detail', 'Date & Time'];
  const rows = logs.map(l => [
    l.user || '', l.role || '',
    _catOfAction(l.action), l.action || '', l.detail || '',
    new Date(l.time).toLocaleString()
  ]);
  const catNote = _actSelectedCats.length ? ' (' + _actSelectedCats.join(', ') + ')' : '';
  const title = (isAdmin() ? 'Activity Log — All Users' : 'My Activity Log') + catNote;
  const fname = 'ActivityLog_' + new Date().toISOString().slice(0,10).replace(/-/g,'');
  if (!rows.length) { showToast('No log entries to export', 'warn'); return; }
  if (fmt === 'pdf') genPDF(fname, headers, rows, title);
  else genXL(fname, headers, rows);
}

function exportFeesLog(fmt) {
  const logs = (Array.isArray(DB.msgLogs) ? DB.msgLogs : [])
    .filter(l => (l.kind || 'reminder') === _feesLogTab)
    .filter(l => !_feeSelectedTypes.length || _feeSelectedTypes.some(c => FEE_LOG_TYPES[c] === l.type))
    .slice(0, 500);
  if (!logs.length) { showToast('No logs to export', 'warn'); return; }
  const headers = ['Student', 'Month', 'Contact', 'Type', 'Sent By', 'Date & Time'];
  const rows = logs.map(l => {
    const d = new Date(l.at);
    const timeStr = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${((d.getHours()%12)||12)}:${pad(d.getMinutes())} ${d.getHours()>=12?'PM':'AM'}`;
    return [l.to || '', l.month || '', l.contact || '', l.type || '', l.by || '', timeStr];
  });
  const label = _feesLogTab === 'paid' ? 'Payment Greetings' : 'Reminders';
  const title = 'Fees Log — ' + label + ' — ' + (DB.settings.academyName || 'Academy');
  const fname = 'FeesLog_' + (_feesLogTab === 'paid' ? 'Paid' : 'Reminders') + '_' + new Date().toISOString().slice(0,10).replace(/-/g,'');
  if (fmt === 'pdf') genPDF(fname, headers, rows, title); else genXL(fname, headers, rows);
}

function exportMsgLog(fmt) {
  const logs = Array.isArray(DB.msgLogs) ? DB.msgLogs.slice(0, 200) : [];
  if (!logs.length) { showToast('No message logs to export', 'warn'); return; }
  const headers = ['Student', 'Month', 'Contact', 'Type', 'Sent By', 'Date & Time'];
  const rows = logs.map(l => {
    const d = new Date(l.at);
    const timeStr = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${((d.getHours()%12)||12)}:${pad(d.getMinutes())} ${d.getHours()>=12?'PM':'AM'}`;
    return [l.to || '', l.month || '', l.contact || '', l.type || '', l.by || '', timeStr];
  });
  const title = 'Fee Reminder Message Log — ' + (DB.settings.academyName || 'Academy');
  const fname = 'MsgLog_' + new Date().toISOString().slice(0,10).replace(/-/g,'');
  if (fmt === 'pdf') genPDF(fname, headers, rows, title);
  else genXL(fname, headers, rows);
}

// ── Performance export (respects current sport/batch/schedule filters) ──
function exportPerformance(fmt) {
  const sportSel = document.getElementById('perfSportFilter');
  const batchSel = document.getElementById('perfBatchFilter');
  const sport   = sportSel?.value || 'ALL';
  const batch   = batchSel?.value || 'ALL';
  const schedId = 'ALL';

  // Same student filtering logic as renderLeaderboard
  let students = (DB.students||[]).filter(s => !s.banned);
  if (batch !== 'ALL') {
    const ids = _enrolledIds(e => e.batch === batch);
    students = students.filter(s => _studentInSet(s, ids));
  } else if (sport !== 'ALL') {
    const ids = _enrolledIds(e => e.sport === sport);
    students = students.filter(s => _studentInSet(s, ids));
  }
  if (!isAdmin()) {
    const ab  = Array.isArray(currentUser?.assignedBatches) ? currentUser.assignedBatches : [];
    const as_ = Array.isArray(currentUser?.assignedSports)  ? currentUser.assignedSports  : [];
    if (ab.length || as_.length) {
      const ids = _enrolledIds(e =>
        (ab.length  ? ab.includes(e.batch)  : true) &&
        (as_.length ? as_.includes(e.sport) : true)
      );
      students = students.filter(s => _studentInSet(s, ids));
    }
  }

  if (!students.length) { showToast('No students found for this filter', 'warn'); return; }

  const scheds = schedId !== 'ALL'
    ? [(DB.schedules||[]).find(s=>s.id===schedId)].filter(Boolean)
    : (perfGetAllowedSchedules().filter(s => sport==='ALL'||s.sport===sport||!s.sport));
  const maxPossible = scheds.reduce((a,s) => a + scheduleMaxMark(s), 0);

  const withScores = students.map(s => {
    const total  = studentTotalScore(s.id, schedId);
    const attPct = studentAttPct(s.id, s._sid);
    const ptsPct = maxPossible > 0 ? (total / maxPossible) * 100 : 0;
    const w = DB.perfWeights || { points: 70, attendance: 30 };
    const combined = (ptsPct * (w.points/100)) + ((attPct !== null ? attPct : 0) * (w.attendance/100));
    return { ...s, total, attPct, ptsPct: Math.round(ptsPct), combined };
  }).sort((a,b) =>
    b.combined - a.combined ||
    b.total    - a.total    ||
    (b.attPct||0) - (a.attPct||0)
  );
  withScores.forEach((s, i) => {
    if (i === 0) { s.rank = 1; }
    else {
      const prev = withScores[i-1];
      s.rank = (s.combined === prev.combined && s.total === prev.total && (s.attPct||0) === (prev.attPct||0))
        ? prev.rank : i + 1;
    }
  });

  const headers = ['Rank', 'Student', 'Batch', 'Score', 'Max', 'Score %', 'Attendance %', 'Combined %'];
  const rows = withScores.map(s => [
    s.rank, s.name, s.batch || '',
    s.total, maxPossible || '—',
    maxPossible ? s.ptsPct + '%' : '—',
    s.attPct !== null ? s.attPct + '%' : '—',
    Math.round(s.combined) + '%'
  ]);

  const schedName = schedId !== 'ALL' ? ((DB.schedules||[]).find(s=>s.id===schedId)?.name || 'Schedule') : 'All Schedules';
  const title = `Performance — Sport: ${sport} · Batch: ${batch} · Schedule: ${schedName}`;
  const fname = `Performance_${sport}_${batch}_${schedName}`.replace(/[^a-zA-Z0-9_]+/g,'_').replace(/_+/g,'_');

  if (fmt === 'pdf') genPDF(fname, headers, rows, title);
  else genXL(fname, headers, rows);
}

// ================================================================
// INIT
// ================================================================
// Firebase Auth is the source of truth — clear stale app data
try { localStorage.removeItem('sac_db'); } catch(e){}
// Firebase URL is now baked into the config above — no localStorage needed
updateLogos();
applyAcadSettings();

// Always show login screen — setup screen no longer needed
document.getElementById('loginScreen').style.display = 'flex';

setInterval(updateClock, 1000);
updateClock();
setInterval(checkMidnightSnapshot, 60000);

// Tapping anywhere on a date/time input opens the native picker (not just the icon)
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t && t.tagName === 'INPUT' && (t.type === 'time' || t.type === 'date' || t.type === 'month')) {
    if (typeof t.showPicker === 'function') {
      try { t.showPicker(); } catch (err) { /* showPicker can throw if not user-activated; ignore */ }
    }
  }
});

// Close modals on overlay tap
// (Swipe navigation removed — use topbar tabs or drawer to switch pages)

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if(e.target===el) el.classList.remove('active'); });
});
// Close overview popup on outside click
document.addEventListener('click', e => {
  const popup = document.getElementById('attOverviewPopup');
  if (popup && !popup.contains(e.target) && !e.target.closest('[onclick*="toggleAttOverview"]')) {
    popup.style.display = 'none';
  }
});

// Redraw chart on resize
window.addEventListener('resize', () => {
  if (currentPage === 'home') { renderDashChart(); renderHomeTileChart(); }
  const pg = document.getElementById('pageChartMax');
  if (pg && pg.classList.contains('active')) renderChartMax();
});

// ── Session Management: 30-minute inactivity timeout ──────────────
const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes in ms

function touchSession() {
  try { localStorage.setItem('sac_session_time', Date.now()); } catch(e) {}
}
function clearSession() {
  try { localStorage.removeItem('sac_session'); } catch(e) {}
  try { localStorage.removeItem('sac_session_time'); } catch(e) {}
}

// Update last-active timestamp on any user interaction
['click','keydown','touchstart','scroll'].forEach(evt => {
  document.addEventListener(evt, touchSession, { passive: true });
});

// Check every minute if session has expired while app is open
setInterval(() => {
  try {
    const lastActive = parseInt(localStorage.getItem('sac_session_time') || '0', 10);
    if (currentUser && lastActive && (Date.now() - lastActive > SESSION_TIMEOUT)) {
      showToast('Session expired — please log in again', 'warn');
      clearSession();
      currentUser = null;
      if (typeof stopRealtimeSync === 'function') stopRealtimeSync();
      if (window._sbSignOut) window._sbSignOut().catch(()=>{});
      document.getElementById('app').classList.remove('active');
      document.getElementById('loginScreen').style.display = 'flex';
      document.getElementById('loginId').value = '';
      document.getElementById('loginPass').value = '';
    }
  } catch(e) {}
}, 60000);

// Auto-login: Supabase persists the session in localStorage automatically.
// onAuthStateChanged fires on page load if the user is still signed in.
(function waitForAuth() {
  if (!window._onAuthStateChanged) { setTimeout(waitForAuth, 100); return; }
  window._onAuthStateChanged(async (supabaseUser) => {
    if (!supabaseUser) return; // not signed in — stay on login screen
    // Supabase fires this on token refresh / tab focus too. Only launch once;
    // ignore later events if the app is already running.
    if (_appLaunched || currentUser) return;
    // Refresh the session timestamp on every page load/refresh.
    // The setInterval handles inactivity while the app is open.
    // Never sign out on refresh — that is intentional user activity.
    touchSession();
    // Signed in — fetch app user profile from Supabase and launch.
    // Retry up to 5 times (500ms apart) to handle JWT-not-ready timing on refresh.
    try {
      _appLaunched = true;
      let profile = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data, error } = await window._sb
          .from('app_users').select('*').eq('id', supabaseUser.id).single();
        if (data) { profile = data; break; }
        if (error) console.warn('auto-login profile attempt', attempt + 1, error.message);
        await new Promise(r => setTimeout(r, 500));
      }
      const user = profile ? {
        id: profile.login_id || profile.email, uid: profile.id, academyId: profile.academy_id,
        email: profile.email, name: profile.name, role: profile.role,
        assignedBatches: profile.assigned_batches || [],
        assignedSports: profile.assigned_sports || []
      } : null;
      // Only sign out if we genuinely have no profile after retries.
      // Never sign out due to a transient network error.
      if (!user) {
        console.warn('auto-login: no app profile found for uid', supabaseUser.id);
        _appLaunched = false; // allow manual login to proceed
        if (window._sbSignOut) await window._sbSignOut();
        return;
      }
      _currentAcademyId = user.academyId;
      window._currentAcademyId = user.academyId;   // expose for other <script> blocks (plans/config patch)
      DB.users = [user];
      currentUser = user;
      touchSession();
      const overlay = document.getElementById('loadingOverlay');

      // FeeZo patch: check frozen BEFORE loading dashboard (auto-login path)
      // Fully self-contained — same logic as manual login, no external dependency
      {
        try {
          const { data: _fzd2 } = await window._sb
            .from('academies')
            .select('plan, trial_ends_at, plan_ends_at, frozen_at')
            .eq('id', _currentAcademyId)
            .single();
          if (_fzd2) {
            const _fp2 = _fzd2.plan, _fte2 = _fzd2.trial_ends_at, _fpe2 = _fzd2.plan_ends_at, _fn2 = Date.now();
            const _ff2 = _fp2 === 'frozen'
              || (_fp2 === 'trial' && _fte2 && new Date(_fte2) < _fn2)
              || (['basic','pro','premium'].includes(_fp2) && _fpe2 && new Date(_fpe2) < _fn2);
            if (_ff2) {
              const _fsel2 = document.getElementById('fzFrozenScreen');
              if (_fsel2) {
                document.body.style.overflow = 'hidden';
                _fsel2.style.cssText = 'display:flex !important;position:fixed;inset:0;z-index:2147483647;background:linear-gradient(135deg,#0f1f3d,#1a1040,#0a1628);align-items:center;justify-content:center;padding:20px;overflow-y:auto;font-family:Poppins,sans-serif;';
                const _kind2 = _fp2 === 'frozen' ? 'manual' : (_fp2 === 'trial' ? 'trial' : 'plan');
                const _titles2 = {trial:'Your Free Trial Has Ended',plan:'Your Subscription Has Expired',manual:'Your Account Is On Hold'};
                const _badges2 = {trial:'Free Trial Ended',plan:'Subscription Expired',manual:'Account On Hold'};
                const _emojis2 = {trial:'⏰',plan:'🔄',manual:'🔒'};
                const _el2 = id => document.getElementById(id);
                if(_el2('fzFrozenTitle')) _el2('fzFrozenTitle').textContent = _titles2[_kind2];
                if(_el2('fzFrozenBadge')) _el2('fzFrozenBadge').textContent = _badges2[_kind2];
                if(_el2('fzFrozenEmoji')) _el2('fzFrozenEmoji').textContent = _emojis2[_kind2];
                if(_el2('fzFrozenSub'))   _el2('fzFrozenSub').textContent   = 'Subscribe now to restore full access. Your data is 100% safe.';
                if(_el2('fzReasonTitle')) _el2('fzReasonTitle').textContent = _fp2 === 'trial' ? 'Your 7-day free trial has expired' : (_fp2 === 'frozen' ? 'Your account has been put on hold' : 'Your '+_fp2+' plan has expired');
                const _expDate2 = _fp2 === 'trial' ? _fte2 : (_fp2 === 'frozen' ? _fzd2.frozen_at : _fpe2);
                const _ds2 = _expDate2 ? new Date(_expDate2).toLocaleDateString('en-IN',{day:'numeric',month:'long',year:'numeric'}) : '—';
                if(_el2('fzReasonSub')) _el2('fzReasonSub').innerHTML = 'Your account was paused on <span style="color:#fff;font-weight:700;">' + _ds2 + '</span>';
                if (window.fzShowFrozenPublic) window.fzShowFrozenPublic(_kind2);
              }
              return; // dashboard never loads
            }
          }
        } catch(_fze2) { console.warn('FeeZo auto-login frozen check failed:', _fze2); }
      }

      if (overlay) overlay.classList.add('active');
      startLoadProgress();
      document.getElementById('topRoleBadge').textContent = isAdmin() ? 'Admin' : 'Staff';
      applyRoleUI();
      updateLogos();
      loadAllData().then(() => {
        finishLoadProgress(() => {
          if (overlay) overlay.classList.remove('active');
          updateLogos();
          applyAcadSettings();
          applyRoleUI();  // re-apply now that DB.settings.plan is populated from Supabase
          initNotifSystem();
          addLog('login', 'Auto-login (session restored)');
          showToast('Welcome back, ' + (user.name || user.id) + '! ✓', 'success');
          launchApp();
        });
      });
    } catch(e) {
      console.warn('auto-login exception:', e);
      _appLaunched = false; // allow manual login to proceed
    }
  });
})();


// ================================================================
// PERFORMANCE TAB
// ================================================================

let _perfView = 'leaderboard';
let _editScheduleId = null;

function setPerfView(v) {
  _perfView = v;
  ['leaderboard','schedules'].forEach(x => {
    const btn = document.getElementById('perfView' + x.charAt(0).toUpperCase() + x.slice(1));
    if (btn) btn.style.background = x === v ? 'var(--accent2)' : 'var(--card2)';
    if (btn) btn.style.color = x === v ? '#fff' : '';
  });
  renderPerformancePage();
}

// ── Filter helpers ──────────────────────────────────────────────
function perfGetAllowedSports() {
  const all = Array.isArray(DB.sports) ? DB.sports : [];
  if (isAdmin()) return all;
  const u = currentUser;
  const assigned = Array.isArray(u && u.assignedSports) && u.assignedSports.length ? u.assignedSports : null;
  return assigned ? all.filter(s => assigned.includes(s)) : all;
}
function perfGetAllowedBatches(sport) {
  const all = Array.isArray(DB.batches) ? DB.batches : [];
  let filtered = sport && sport !== 'ALL'
    ? all.filter(b => (DB.batchSport[b] || '') === sport || !DB.batchSport[b])
    : all;
  if (!isAdmin()) {
    const u = currentUser;
    const ab = Array.isArray(u && u.assignedBatches) && u.assignedBatches.length ? u.assignedBatches : null;
    if (ab) filtered = filtered.filter(b => ab.includes(b));
  }
  return filtered;
}
function perfGetAllowedSchedules() {
  // Admins always see all schedules.
  // Staff only see schedules whose sport/batch matches their assignments.
  if (isAdmin()) return DB.schedules || [];
  const allowedSports = perfGetAllowedSports();
  const allowedBatches = perfGetAllowedBatches('ALL');
  return (DB.schedules || []).filter(s =>
    (!s.sport || allowedSports.includes(s.sport)) &&
    (!s.batch || allowedBatches.includes(s.batch))
  );
}

// ── Main render ──────────────────────────────────────────────────
function _setSelectVal(sel, val) {
  // Reliably set a select value after rebuilding innerHTML
  if (!sel) return;
  for (let i = 0; i < sel.options.length; i++) {
    if (sel.options[i].value === val) { sel.selectedIndex = i; return; }
  }
  sel.selectedIndex = 0; // fallback to first option
}

// ── Combined-rank weighting (admin editable) ──────────────────────
function openPerfWeightsModal() {
  if (!isAdmin()) { showToast('Admin only', 'error'); return; }
  const w = DB.perfWeights || { points: 70, attendance: 30 };
  document.getElementById('perfWeightPoints').value = w.points;
  document.getElementById('perfWeightAttendance').value = w.attendance;
  openModal('modalPerfWeights');
}

function _syncPerfWeightInputs(changed) {
  const ptsEl = document.getElementById('perfWeightPoints');
  const attEl = document.getElementById('perfWeightAttendance');
  let pts = Math.max(0, Math.min(100, Number(ptsEl.value) || 0));
  let att = Math.max(0, Math.min(100, Number(attEl.value) || 0));
  if (changed === 'points') { att = 100 - pts; attEl.value = att; }
  else { pts = 100 - att; ptsEl.value = pts; }
}

function savePerfWeights() {
  if (!isAdmin()) { showToast('Admin only', 'error'); return; }
  const pts = Math.round(Number(document.getElementById('perfWeightPoints').value) || 0);
  const att = Math.round(Number(document.getElementById('perfWeightAttendance').value) || 0);
  if (pts < 0 || pts > 100 || att < 0 || att > 100 || (pts + att) !== 100) {
    showToast('Weights must add up to 100%', 'error');
    return;
  }
  DB.perfWeights = { points: pts, attendance: att };
  sbSavePerformance();
  addLog('perf', `Combined rank weighting changed to ${pts}% points / ${att}% attendance`);
  showToast('Weighting saved ✓', 'success');
  closeModal('modalPerfWeights');
  renderPerformancePage();
}

function renderPerformancePage() {
  const sportSel = document.getElementById('perfSportFilter');
  const batchSel = document.getElementById('perfBatchFilter');
  if (!sportSel) return;

  // Save current selections before rebuilding
  const curSport = sportSel.value || 'ALL';
  const curBatch = batchSel.value || 'ALL';

  // Rebuild sport options and restore selection
  const allowedSports = perfGetAllowedSports();
  sportSel.innerHTML = '<option value="ALL">All Sports</option>' +
    allowedSports.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
  _setSelectVal(sportSel, curSport);
  const sport = sportSel.value || 'ALL';

  // Rebuild batch options based on selected sport, restore selection
  const allowedBatches = perfGetAllowedBatches(sport);
  batchSel.innerHTML = '<option value="ALL">All Batches</option>' +
    allowedBatches.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');
  _setSelectVal(batchSel, curBatch);
  const batch = batchSel.value || 'ALL';

  const schedId = 'ALL';

  setPerfViewBtns();

  const el = document.getElementById('perfContent');
  if (_perfView === 'leaderboard') el.innerHTML = renderLeaderboard(sport, batch, schedId);
  else el.innerHTML = renderSchedulesList();
}

function setPerfViewBtns() {
  ['leaderboard','schedules'].forEach(x => {
    const btn = document.getElementById('perfView' + x.charAt(0).toUpperCase() + x.slice(1));
    if (!btn) return;
    btn.style.background = x === _perfView ? 'var(--accent2)' : 'var(--card2)';
    btn.style.color      = x === _perfView ? '#fff' : '';
  });
}

// ── Student total score helper ───────────────────────────────────
function studentTotalScore(sid, schedId) {
  const scores = DB.perfScores || {};
  let total = 0;
  const schedules = schedId && schedId !== 'ALL'
    ? [(DB.schedules||[]).find(s => s.id === schedId)].filter(Boolean)
    : (DB.schedules || []);
  schedules.forEach(sched => {
    const sc = (scores[sched.id] || {})[sid] || {};
    Object.values(sc).forEach(m => { total += Number(m) || 0; });
  });
  return total;
}

function scheduleMaxMark(sched) {
  return (sched.tasks || []).reduce((a,t) => a + (Number(t.maxMark)||10), 0);
}

function studentSchedScore(sid, schedId) {
  return Object.values(((DB.perfScores||{})[schedId]||{})[sid]||{}).reduce((a,v)=>a+(Number(v)||0),0);
}

// ── Attendance % helper ──────────────────────────────────────────
function studentAttPct(sid, sid2) {
  // sid = student id, sid2 = _sid fallback
  const att = DB.attendance || {};
  let present = 0, total = 0;
  Object.values(att).forEach(dayObj => {
    Object.values(dayObj).forEach(sportObj => {
      const val = sportObj[sid] !== undefined ? sportObj[sid]
                : (sid2 && sportObj[sid2] !== undefined ? sportObj[sid2] : undefined);
      if (val !== undefined) {
        total++;
        if (val === 'P') present++;
      }
    });
  });
  return total ? Math.round((present/total)*100) : null;
}

// ── Leaderboard view ─────────────────────────────────────────────
// Match student to enrollment by id or _sid (UUID)
function _enrolledIds(filterFn) {
  return new Set((DB.enrollments||[]).filter(filterFn).map(e => e.studentId));
}
function _studentInSet(s, idSet) {
  return idSet.has(s.id) || idSet.has(s._sid);
}

function renderLeaderboard(sport, batch, schedId) {
  let students = (DB.students||[]).filter(s => !s.banned);

  // Filter by batch first, then sport
  if (batch !== 'ALL') {
    const ids = _enrolledIds(e => e.batch === batch);
    students = students.filter(s => _studentInSet(s, ids));
  } else if (sport !== 'ALL') {
    const ids = _enrolledIds(e => e.sport === sport);
    students = students.filter(s => _studentInSet(s, ids));
  }

  // Staff: further restrict to assigned batches/sports
  if (!isAdmin()) {
    const ab  = Array.isArray(currentUser?.assignedBatches) ? currentUser.assignedBatches : [];
    const as_ = Array.isArray(currentUser?.assignedSports)  ? currentUser.assignedSports  : [];
    if (ab.length || as_.length) {
      const ids = _enrolledIds(e =>
        (ab.length  ? ab.includes(e.batch)  : true) &&
        (as_.length ? as_.includes(e.sport) : true)
      );
      students = students.filter(s => _studentInSet(s, ids));
    }
  }

  // Search filter
  const perfSearch = (document.getElementById('perfSearch')?.value || '').toLowerCase().trim();
  if (perfSearch) {
    students = students.filter(s =>
      s.name.toLowerCase().includes(perfSearch) ||
      String(s.rollNo || '').toLowerCase().includes(perfSearch)
    );
  }

  if (!students.length) return '<div style="text-align:center;color:var(--gray);padding:30px;">No students found for this filter.</div>';

  // Max possible
  const scheds = schedId !== 'ALL'
    ? [(DB.schedules||[]).find(s=>s.id===schedId)].filter(Boolean)
    : (perfGetAllowedSchedules().filter(s => sport==='ALL'||s.sport===sport||!s.sport));
  const maxPossible = scheds.reduce((a,s) => a + scheduleMaxMark(s), 0);

  // Calculate scores + combined rank score
  const w = DB.perfWeights || { points: 70, attendance: 30 };
  const withScores = students.map(s => {
    const total  = studentTotalScore(s.id, schedId);
    const attPct = studentAttPct(s.id, s._sid);
    const ptsPct = maxPossible > 0 ? (total / maxPossible) * 100 : 0;
    const combined = (ptsPct * (w.points/100)) + ((attPct !== null ? attPct : 0) * (w.attendance/100));
    return { ...s, total, attPct, ptsPct: Math.round(ptsPct), combined };
  });

  // Sort by user-chosen option (default: combined score)
  const perfSortBy = document.getElementById('perfSortBy')?.value || 'combined';
  switch (perfSortBy) {
    case 'pts_desc':  withScores.sort((a,b) => b.total    - a.total    || b.combined - a.combined); break;
    case 'pts_asc':   withScores.sort((a,b) => a.total    - b.total    || a.combined - b.combined); break;
    case 'att_desc':  withScores.sort((a,b) => (b.attPct||0) - (a.attPct||0) || b.combined - a.combined); break;
    case 'att_asc':   withScores.sort((a,b) => (a.attPct||0) - (b.attPct||0) || a.combined - b.combined); break;
    case 'name_az':   withScores.sort((a,b) => a.name.localeCompare(b.name)); break;
    case 'name_za':   withScores.sort((a,b) => b.name.localeCompare(a.name)); break;
    case 'roll_asc':  withScores.sort(makeSorter('roll_asc')); break;
    case 'roll_desc': withScores.sort(makeSorter('roll_desc')); break;
    default:          withScores.sort((a,b) => b.combined - a.combined || b.total - a.total || (b.attPct||0) - (a.attPct||0)); break;
  }

  // Assign combined-score rank (always based on combined, independent of display sort)
  // First compute combined-rank positions from a separate sorted copy
  const byRank = [...withScores].sort((a,b) => b.combined - a.combined || b.total - a.total || (b.attPct||0) - (a.attPct||0));
  byRank.forEach((s, i) => {
    if (i === 0) { s.rank = 1; }
    else {
      const prev = byRank[i-1];
      s.rank = (s.combined === prev.combined && s.total === prev.total && (s.attPct||0) === (prev.attPct||0))
        ? prev.rank : i + 1;
    }
  });

  // No scores entered yet
  const totalScoresEntered = withScores.reduce((a,s) => a + s.total, 0);
  if (totalScoresEntered === 0 && schedId !== 'ALL') {
    return `<div style="text-align:center;padding:40px 20px;">
      <div style="font-size:36px;margin-bottom:12px;">📋</div>
      <div style="font-weight:700;font-size:15px;margin-bottom:6px;">No scores yet</div>
      <div style="color:var(--gray);font-size:12px;margin-bottom:16px;">Tap "✏️ Give Marks" to enter scores for this schedule.</div>
      ${isAdmin() ? `<button class="btn btn-primary" style="font-size:13px;padding:8px 20px;" onclick="openGiveMarksModal()">✏️ Give Marks</button>` : ''}
    </div>`;
  }

  let html = `
  <div style="margin-bottom:10px;">
    <div style="font-size:11px;color:var(--gray);margin-bottom:6px;">${withScores.length} students · Max score: ${maxPossible || '—'}</div>
    <div onclick="openPerfWeightsModal()" style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:8px 11px;font-size:11px;color:var(--gray);line-height:1.7;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:6px;" title="${isAdmin() ? 'Tap to edit weighting' : ''}">
      <span>🏆 <b style="color:var(--offwhite);">Combined Rank</b> = Points <b style="color:var(--accent2);">${w.points}%</b> + Attendance <b style="color:var(--green);">${w.attendance}%</b></span>
      ${isAdmin() ? '<span style="font-size:13px;">✏️</span>' : ''}
    </div>
  </div>`;

  withScores.forEach((s, i) => {
    const medal = s.rank===1?'🥇':s.rank===2?'🥈':s.rank===3?'🥉':'';
    const rankLabel = medal || `<span style="font-size:11px;font-weight:700;color:var(--gray);">#${s.rank}</span>`;
    const isTied = withScores.filter(x => x.rank === s.rank).length > 1;

    const attColor = s.attPct !== null ? (s.attPct >= 75 ? 'var(--green)' : s.attPct >= 50 ? 'var(--orange)' : 'var(--red)') : 'var(--gray)';
    const attLabel = s.attPct !== null ? `${s.attPct}%` : '—';

    const ptsBarW  = maxPossible > 0 ? Math.round((s.total/maxPossible)*100) : 0;
    const attBarW  = s.attPct !== null ? s.attPct : 0;
    const combBarW = Math.round(s.combined);

    const ptsBarColor  = ptsBarW  >= 75 ? 'var(--green)' : ptsBarW  >= 50 ? 'var(--gold)' : 'var(--accent2)';
    const attBarColor  = attBarW  >= 75 ? 'var(--green)' : attBarW  >= 50 ? 'var(--orange)' : 'var(--red)';
    const combBarColor = combBarW >= 75 ? 'var(--green)' : combBarW >= 50 ? 'var(--gold)' : 'var(--accent2)';

    html += `
    <div class="card" style="padding:10px 12px;cursor:pointer;${s.rank<=3?'border-left:3px solid '+(s.rank===1?'#f59e0b':s.rank===2?'#94a3b8':'#c87941')+';':''}" onclick="openStudentScores('${escHtml(s.id)}')">
      <div style="display:flex;align-items:center;gap:10px;">
        <div style="font-size:20px;min-width:28px;text-align:center;flex-shrink:0;">${rankLabel}</div>
        <div style="flex:1;min-width:0;">
          <div style="display:flex;align-items:center;gap:5px;">
            <span style="font-weight:700;font-size:13px;">${escHtml(s.name)}</span>
            ${isTied ? `<span style="font-size:9px;background:var(--card2);border:1px solid var(--border);border-radius:4px;padding:1px 4px;color:var(--gray);">TIE</span>` : ''}
          </div>
          <div style="display:flex;gap:8px;margin-top:3px;flex-wrap:wrap;">
            <span style="font-size:10px;color:var(--accent2);">🎯 ${s.total} pts${maxPossible ? ' ('+ptsBarW+'%)' : ''}</span>
            <span style="font-size:10px;color:${attColor};">📅 ${attLabel}</span>
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;">
          <div style="font-size:16px;font-weight:800;color:var(--gold);">${Math.round(s.combined)}</div>
          <div style="font-size:9px;color:var(--gray);">combined</div>
        </div>
      </div>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;">
        ${maxPossible ? `<div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:9px;color:var(--gray);min-width:22px;">Pts</span>
          <div style="flex:1;height:4px;background:var(--card2);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${ptsBarW}%;background:${ptsBarColor};border-radius:3px;transition:width .4s;"></div>
          </div>
          <span style="font-size:9px;color:var(--gray);min-width:26px;text-align:right;">${ptsBarW}%</span>
        </div>` : ''}
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:9px;color:var(--gray);min-width:22px;">Att</span>
          <div style="flex:1;height:4px;background:var(--card2);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${attBarW}%;background:${attBarColor};border-radius:3px;transition:width .4s;"></div>
          </div>
          <span style="font-size:9px;color:${attColor};min-width:26px;text-align:right;">${attLabel}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-size:9px;color:var(--gold);min-width:22px;font-weight:600;">Rank</span>
          <div style="flex:1;height:5px;background:var(--card2);border-radius:3px;overflow:hidden;">
            <div style="height:100%;width:${combBarW}%;background:${combBarColor};border-radius:3px;transition:width .4s;"></div>
          </div>
          <span style="font-size:9px;color:var(--gold);min-width:26px;text-align:right;font-weight:700;">${combBarW}%</span>
        </div>
      </div>
    </div>`;
  });
  return html;
}

// ── Schedules list view ──────────────────────────────────────────
function renderSchedulesList() {
  const allowed = perfGetAllowedSchedules();

  let html = isAdmin()
    ? `<div style="margin-bottom:10px;text-align:right;">
        <button class="btn btn-primary" style="font-size:12px;padding:6px 12px;" onclick="openAddScheduleModal()" id="perfAddScheduleBtn">+ Schedule</button>
      </div>`
    : '';

  if (!allowed.length) return html + '<div style="text-align:center;color:var(--gray);padding:30px;">No schedules yet. ' + (isAdmin()?'Tap "+ Schedule" to create one.':'Contact admin.') + '</div>';

  allowed.forEach(sched => {
    const maxM = scheduleMaxMark(sched);
    html += `
    <div class="card" style="padding:12px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
        <div style="flex:1;cursor:pointer;" onclick="viewScheduleLeaderboard('${escHtml(sched.id)}')">
          <div style="font-weight:700;font-size:14px;">${escHtml(sched.name)} <span style="font-size:10px;color:var(--accent2);">▶ View</span></div>
          <div style="font-size:11px;color:var(--gray);">${escHtml(sched.sport||'All Sports')}${sched.batch ? ' · ' + escHtml(sched.batch) : ' · All Batches'} · Max: ${maxM} marks</div>
        </div>
        ${isAdmin() ? `<div style="display:flex;gap:6px;">
          <button class="btn" style="font-size:11px;padding:4px 8px;background:var(--card2);" onclick="event.stopPropagation();openEditSchedule('${escHtml(sched.id)}')">✏️</button>
          <button class="btn" style="font-size:11px;padding:4px 8px;background:#dc262622;color:var(--red);" onclick="event.stopPropagation();deleteSchedule('${escHtml(sched.id)}')">🗑️</button>
        </div>` : ''}
      </div>
      <div style="display:flex;flex-direction:column;gap:3px;">
        ${(sched.tasks||[]).map((t,i)=>`
          <div style="display:flex;justify-content:space-between;font-size:12px;padding:4px 8px;background:var(--card2);border-radius:6px;">
            <span>${i+1}. ${escHtml(t.name)}</span>
            <span style="color:var(--gold);font-weight:700;">${t.maxMark||10} pts</span>
          </div>`).join('')}
      </div>
    </div>`;
  });
  return html;
}

function viewScheduleLeaderboard(schedId) {
  // Schedule-specific filtering removed along with the dropdown;
  // just switch to the (combined) leaderboard view.
  _perfView = 'leaderboard';
  renderPerformancePage();
}

// ── Open student score detail ────────────────────────────────────
let _curStudentScoresSid = null;

function openStudentScores(sid) {
  const student = (DB.students||[]).find(s=>s.id===sid);
  if (!student) return;
  _curStudentScoresSid = sid;
  const title = document.getElementById('studentScoresTitle');
  const body  = document.getElementById('studentScoresBody');
  const saveBar = document.getElementById('studentScoresSaveBar');
  if (title) title.textContent = '📊 ' + student.name;
  if (saveBar) saveBar.style.display = isAdmin() ? '' : 'none';

  const scheds = perfGetAllowedSchedules();
  let html = '';

  // Attendance summary
  const student2 = (DB.students||[]).find(s=>s.id===sid||s._sid===sid);
  const attPct = studentAttPct(sid, student2?._sid);
  html += `<div style="padding:10px 12px;background:var(--card2);border-radius:8px;margin-bottom:10px;display:flex;justify-content:space-between;">
    <span style="font-size:13px;font-weight:700;">📅 Attendance</span>
    <span style="font-size:13px;font-weight:800;color:${attPct!==null&&attPct>=75?'var(--green)':'var(--red)'};">${attPct!==null?attPct+'%':'—'}</span>
  </div>`;

  if (!scheds.length) { html += '<div style="text-align:center;color:var(--gray);padding:20px;">No schedules assigned.</div>'; }

  scheds.forEach(sched => {
    const sc = ((DB.perfScores||{})[sched.id]||{})[sid]||{};
    const total = Object.values(sc).reduce((a,v)=>a+(Number(v)||0),0);
    const maxM  = scheduleMaxMark(sched);
    const pct   = maxM ? Math.round((total/maxM)*100) : 0;
    html += `<div class="card" style="margin-bottom:8px;padding:10px 12px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span style="font-weight:700;font-size:13px;">${escHtml(sched.name)}</span>
        <span style="font-size:13px;font-weight:800;color:var(--gold);" id="studentSchedTotal_${escHtml(sched.id)}">${total}/${maxM}</span>
      </div>
      <div style="height:5px;background:var(--card2);border-radius:4px;overflow:hidden;margin-bottom:8px;">
        <div style="height:100%;width:${pct}%;background:${pct>=75?'var(--green)':pct>=50?'var(--gold)':'var(--accent2)'};border-radius:4px;"></div>
      </div>
      ${(sched.tasks||[]).map((t,i)=> isAdmin() ? `
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--offwhite);">${escHtml(t.name)}</span>
          <span>
            <input type="number" class="form-input student-mark-input" data-sched="${escHtml(sched.id)}" data-task="${i}"
              value="${sc[i]!==undefined?sc[i]:''}" min="0" max="${t.maxMark||10}"
              style="width:52px;text-align:center;padding:4px;font-size:12px;"
              oninput="clampMarkInput(this); updateStudentSchedTotal('${escHtml(sched.id)}')">
            <span style="color:var(--gray);font-size:11px;"> / ${t.maxMark||10}</span>
          </span>
        </div>` : `
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0;border-bottom:1px solid var(--border);">
          <span style="color:var(--offwhite);">${escHtml(t.name)}</span>
          <span style="font-weight:700;color:${sc[i]>=t.maxMark?'var(--green)':'var(--offwhite)'};">${sc[i]!==undefined?sc[i]:'—'} / ${t.maxMark||10}</span>
        </div>`).join('')}
    </div>`;
  });

  if (body) body.innerHTML = html;
  openModal('modalStudentScores');
}

function updateStudentSchedTotal(schedId) {
  const sched = (DB.schedules||[]).find(s=>s.id===schedId);
  if (!sched) return;
  const inputs = document.querySelectorAll(`.student-mark-input[data-sched="${schedId}"]`);
  let total = 0;
  inputs.forEach(inp => { total += Number(inp.value) || 0; });
  const el = document.getElementById('studentSchedTotal_' + schedId);
  if (el) el.textContent = total + '/' + scheduleMaxMark(sched);
}

function saveStudentScores() {
  const sid = _curStudentScoresSid;
  if (!sid) return;
  const inputs = document.querySelectorAll('.student-mark-input');
  if (!inputs.length) { closeModal('modalStudentScores'); return; }

  if (!DB.perfScores) DB.perfScores = {};
  let clamped = false;
  inputs.forEach(inp => {
    const schedId = inp.dataset.sched;
    const task = inp.dataset.task;
    let val  = inp.value.trim();
    if (!DB.perfScores[schedId]) DB.perfScores[schedId] = {};
    if (!DB.perfScores[schedId][sid]) DB.perfScores[schedId][sid] = {};
    if (val !== '') {
      let num = Number(val);
      const sched = (DB.schedules||[]).find(s=>s.id===schedId);
      const maxM = Number((sched?.tasks||[])[task]?.maxMark) || 10;
      if (num > maxM) { num = maxM; clamped = true; }
      if (num < 0) num = 0;
      DB.perfScores[schedId][sid][task] = num;
    }
    else delete DB.perfScores[schedId][sid][task];
  });
  if (clamped) showToast('Some marks exceeded max and were capped', 'warn');

  sbSavePerformance();
  const student = (DB.students||[]).find(s=>s.id===sid);
  addLog('perf', 'Marks updated for ' + (student?.name || sid));
  showToast('Marks saved ✓', 'success');
  closeModal('modalStudentScores');
  renderPerformancePage(); // refresh leaderboard/list behind the modal
}

// ── Add/Edit Schedule ────────────────────────────────────────────
function _populateSchedBatch(selectedSport, selectedBatch) {
  const bt = document.getElementById('schedBatch');
  if (!bt) return;
  if (!selectedSport) {
    bt.innerHTML = '<option value="">Select sport first</option>';
    bt.disabled = true;
    return;
  }
  const batches = (DB.batches || []).filter(b => (DB.batchSport && DB.batchSport[b]) === selectedSport);
  bt.innerHTML = '<option value="">Select Batch</option>' +
    batches.map(b => `<option value="${escHtml(b)}" ${b === selectedBatch ? 'selected' : ''}>${escHtml(b)}</option>`).join('');
  bt.disabled = false;
}

function onSchedSportChange() {
  const sport = document.getElementById('schedSport').value || '';
  _populateSchedBatch(sport, '');
}

function openAddScheduleModal() {
  if (!isAdmin()) { showToast('Admin only', 'error'); return; }
  _editScheduleId = null;
  document.getElementById('scheduleModalTitle').textContent = '📋 New Schedule';
  document.getElementById('schedName').value = '';

  const sp = document.getElementById('schedSport');
  const sports = DB.sports || [];
  sp.innerHTML = '<option value="">Select Sport</option>' +
    sports.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
  _populateSchedBatch('', '');

  document.getElementById('schedTaskList').innerHTML = '';
  const defaults = ['Task 1','Task 2'];
  defaults.forEach(t => addScheduleTaskRow(t, 10));
  openModal('modalAddSchedule');
}

function openEditSchedule(id) {
  if (!isAdmin()) { showToast('Admin only', 'error'); return; }
  const sched = (DB.schedules||[]).find(s=>s.id===id);
  if (!sched) return;
  _editScheduleId = id;
  document.getElementById('scheduleModalTitle').textContent = '✏️ Edit Schedule';
  document.getElementById('schedName').value = sched.name;

  const sp = document.getElementById('schedSport');
  const sports = DB.sports || [];
  sp.innerHTML = '<option value="">Select Sport</option>' +
    sports.map(s => `<option value="${escHtml(s)}" ${s === sched.sport ? 'selected' : ''}>${escHtml(s)}</option>`).join('');
  _populateSchedBatch(sched.sport || '', sched.batch || '');

  document.getElementById('schedTaskList').innerHTML = '';
  (sched.tasks||[]).forEach(t => addScheduleTaskRow(t.name, t.maxMark||10));
  openModal('modalAddSchedule');
}

function addScheduleTaskRow(name='', maxMark=10) {
  const list = document.getElementById('schedTaskList');
  if (!list) return;
  const existing = list.querySelectorAll('.sched-task-row').length;
  if (existing >= 10) { showToast('Max 10 tasks per schedule', 'warn'); return; }
  const row = document.createElement('div');
  row.className = 'sched-task-row';
  row.style.cssText = 'display:flex;gap:6px;align-items:center;';
  row.innerHTML = `
    <input type="text" class="form-input sched-task-name" placeholder="Task name" value="${escHtml(name)}" style="flex:1;font-size:12px;padding:7px 10px;">
    <input type="number" class="form-input sched-task-mark" placeholder="Pts" value="${maxMark}" min="1" max="100" style="width:60px;font-size:12px;padding:7px 8px;text-align:center;">
    <button class="btn" style="padding:6px 8px;background:var(--card2);font-size:13px;" onclick="this.closest('.sched-task-row').remove()">×</button>`;
  list.appendChild(row);
}

function saveSchedule() {
  if (!isAdmin()) { showToast('Admin only', 'error'); return; }
  const name = (document.getElementById('schedName').value || '').trim();
  if (!name) { showToast('Enter a schedule name', 'error'); return; }
  const sport = document.getElementById('schedSport').value || '';
  if (!sport) { showToast('Select a sport', 'error'); return; }
  const batch = document.getElementById('schedBatch').value || '';
  if (!batch) { showToast('Select a batch', 'error'); return; }
  const rows  = document.querySelectorAll('#schedTaskList .sched-task-row');
  if (!rows.length) { showToast('Add at least one task', 'error'); return; }
  const tasks = Array.from(rows).map(r => ({
    name:    (r.querySelector('.sched-task-name').value || '').trim() || 'Task',
    maxMark: parseInt(r.querySelector('.sched-task-mark').value) || 10
  })).filter(t => t.name);
  if (!tasks.length) { showToast('Add at least one task', 'error'); return; }

  if (!DB.schedules) DB.schedules = [];
  if (_editScheduleId) {
    const idx = DB.schedules.findIndex(s => s.id === _editScheduleId);
    if (idx >= 0) DB.schedules[idx] = { ...DB.schedules[idx], name, sport, batch, tasks };
  } else {
    DB.schedules.push({ id: 'sched_' + Date.now(), name, sport, batch, tasks, createdAt: Date.now() });
  }

  sbSavePerformance().catch(e => console.warn('save perf:', e));
  closeModal('modalAddSchedule');
  addLog('perf', (_editScheduleId ? 'Edited' : 'Created') + ' schedule: ' + name);
  showToast('Schedule saved ✓', 'success');
  _perfView = 'schedules';
  renderPerformancePage();
}

function deleteSchedule(id) {
  if (!isAdmin()) return;
  if (!confirm('Delete this schedule and all its scores?')) return;
  DB.schedules = (DB.schedules||[]).filter(s=>s.id!==id);
  if (DB.perfScores) delete DB.perfScores[id];
  sbSavePerformance();
  addLog('perf', 'Deleted schedule id: ' + id);
  showToast('Schedule deleted', 'success');
  _perfView = 'schedules';
  renderPerformancePage();
}

// ── Give Marks Modal ─────────────────────────────────────────────
function openGiveMarksModal(preselectSchedId) {
  const schedSel = document.getElementById('markScheduleSel');
  const batchSel = document.getElementById('markBatchSel');

  const allowed = perfGetAllowedSchedules();
  schedSel.innerHTML = allowed.map(s=>`<option value="${escHtml(s.id)}">${escHtml(s.name)}</option>`).join('');
  if (!allowed.length) { showToast('No schedules available', 'warn'); return; }

  if (preselectSchedId) {
    for (let i = 0; i < schedSel.options.length; i++) {
      if (schedSel.options[i].value === preselectSchedId) { schedSel.selectedIndex = i; break; }
    }
  }

  const batchOpts = perfGetAllowedBatches((allowed.find(s=>s.id===schedSel.value) || allowed[0])?.sport || 'ALL');
  batchSel.innerHTML = batchOpts.map(b=>`<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');

  renderMarkStudentList();
  openModal('modalGiveMarks');
}

function renderMarkStudentList() {
  const schedId = document.getElementById('markScheduleSel')?.value;
  const batch   = document.getElementById('markBatchSel')?.value;
  const el      = document.getElementById('markStudentList');
  if (!el || !schedId) return;

  const sched = (DB.schedules||[]).find(s=>s.id===schedId);
  if (!sched) { el.innerHTML = '<div style="color:var(--gray);text-align:center;padding:20px;">Select a schedule</div>'; return; }

  // Update batch options when schedule changes
  const batchSel = document.getElementById('markBatchSel');
  const curBatch = batchSel?.value;
  const batchOpts = perfGetAllowedBatches(sched.sport || 'ALL');
  if (batchSel) {
    batchSel.innerHTML = batchOpts.map(b=>`<option value="${escHtml(b)}" ${b===curBatch?'selected':''}>${escHtml(b)}</option>`).join('');
  }
  const selBatch = batchSel?.value;

  // Filter students
  let students = (DB.students||[]).filter(s=>!s.banned);
  if (selBatch && selBatch !== 'ALL') {
    const ids = _enrolledIds(e => e.batch === selBatch);
    students = students.filter(s => _studentInSet(s, ids));
  } else if (sched && sched.sport) {
    const ids = _enrolledIds(e => e.sport === sched.sport);
    students = students.filter(s => _studentInSet(s, ids));
  }

  if (!students.length) { el.innerHTML='<div style="color:var(--gray);text-align:center;padding:20px;">No students in this batch.</div>'; return; }

  // Search by name or roll number
  const search = (document.getElementById('markSearchInput')?.value || '').trim().toLowerCase();
  if (search) {
    students = students.filter(s =>
      (s.name||'').toLowerCase().includes(search) ||
      String(s.rollNo||'').toLowerCase().includes(search)
    );
  }
  if (!students.length) { el.innerHTML='<div style="color:var(--gray);text-align:center;padding:20px;">No students match your search.</div>'; return; }

  let html = `<div style="font-size:12px;color:var(--gray);margin-bottom:8px;padding:0 2px;">
    Schedule: <strong style="color:var(--gold);">${escHtml(sched.name)}</strong> · ${(sched.tasks||[]).length} tasks · Max ${scheduleMaxMark(sched)} pts
  </div>
  <div style="overflow-x:auto;">
  <table style="width:100%;border-collapse:collapse;font-size:12px;min-width:400px;">
    <thead>
      <tr style="background:var(--card2);">
        <th style="padding:7px 8px;text-align:left;font-size:11px;position:sticky;left:0;background:var(--card2);">Student</th>
        ${(sched.tasks||[]).map((t,i)=>`<th style="padding:7px 6px;text-align:center;min-width:60px;" title="${escHtml(t.name)}">${escHtml(t.name.length>8?t.name.slice(0,7)+'…':t.name)}<br><span style="color:var(--gold);font-weight:normal;">/${t.maxMark||10}</span></th>`).join('')}
        <th style="padding:7px 8px;text-align:center;color:var(--gold);">Total</th>
      </tr>
    </thead>
    <tbody>`;

  // Compute each student's current total for this schedule, then sort
  const sortBy = document.getElementById('markSortSel')?.value || 'az';
  const withTotals = students.map(s => {
    const sc = ((DB.perfScores||{})[schedId]||{})[s.id]||{};
    const total = Object.values(sc).reduce((a,v)=>a+(Number(v)||0),0);
    return { s, total };
  });
  withTotals.sort((a,b) => {
    if (sortBy === 'za') return b.s.name.localeCompare(a.s.name);
    if (sortBy === 'high') return b.total - a.total;
    if (sortBy === 'low') return a.total - b.total;
    return a.s.name.localeCompare(b.s.name); // az (default)
  });

  withTotals.forEach(({s, total}) => {
    const sc = ((DB.perfScores||{})[schedId]||{})[s.id]||{};
    html += `<tr style="border-bottom:1px solid var(--border);">
      <td style="padding:7px 8px;font-weight:600;position:sticky;left:0;background:var(--royal);">${escHtml(s.name)}${s.rollNo ? `<span style="color:var(--gray);font-weight:400;font-size:10px;"> (${escHtml(String(s.rollNo))})</span>` : ''}</td>
      ${(sched.tasks||[]).map((t,i)=>`
        <td style="padding:4px 4px;text-align:center;">
          <input type="number" class="form-input mark-input" data-sid="${escHtml(s.id)}" data-task="${i}"
            value="${sc[i]!==undefined?sc[i]:''}" min="0" max="${t.maxMark||10}"
            style="width:52px;text-align:center;padding:4px;font-size:12px;"
            oninput="clampMarkInput(this); updateMarkTotal('${escHtml(s.id)}')">
        </td>`).join('')}
      <td style="padding:7px 6px;text-align:center;font-weight:800;color:var(--gold);" id="markTotal_${escHtml(s.id)}">${total}</td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  el.innerHTML = html;
}

function clampMarkInput(inp) {
  const max = Number(inp.max);
  const min = Number(inp.min) || 0;
  let val = inp.value === '' ? '' : Number(inp.value);
  if (val === '') return;
  if (Number.isFinite(max) && val > max) {
    val = max;
    showToast(`Max ${max} pts for this task`, 'warn');
  }
  if (val < min) val = min;
  inp.value = val;
}

function updateMarkTotal(sid) {
  const inputs = document.querySelectorAll(`.mark-input[data-sid="${sid}"]`);
  let total = 0;
  inputs.forEach(inp => { total += Number(inp.value) || 0; });
  const el = document.getElementById('markTotal_' + sid);
  if (el) el.textContent = total;
}

function saveMarks() {
  const schedId = document.getElementById('markScheduleSel')?.value;
  if (!schedId) return;
  const sched = (DB.schedules||[]).find(s=>s.id===schedId);
  if (!sched) return;

  if (!DB.perfScores) DB.perfScores = {};
  if (!DB.perfScores[schedId]) DB.perfScores[schedId] = {};

  const inputs = document.querySelectorAll('.mark-input');
  let clamped = false;
  inputs.forEach(inp => {
    const sid = inp.dataset.sid;
    const task = inp.dataset.task;
    let val  = inp.value.trim();
    if (!DB.perfScores[schedId][sid]) DB.perfScores[schedId][sid] = {};
    if (val !== '') {
      let num = Number(val);
      const maxM = Number((sched.tasks||[])[task]?.maxMark) || 10;
      if (num > maxM) { num = maxM; clamped = true; }
      if (num < 0) num = 0;
      DB.perfScores[schedId][sid][task] = num;
    }
    else delete DB.perfScores[schedId][sid][task];
  });
  if (clamped) showToast('Some marks exceeded max and were capped', 'warn');

  sbSavePerformance();
  closeModal('modalGiveMarks');
  addLog('perf', 'Marks saved for schedule: ' + sched.name);
  showToast('Marks saved ✓', 'success');
  renderPerformancePage();
}

// ── Supabase: save/load performance data ─────────────────────────
async function sbSavePerformance() {
  try {
    const aid = acadId();
    if (!aid) return;
    const { error } = await sb().from('academies').update({
      sports_config: {
        sports:      DB.sports      || [],
        batchSport:  DB.batchSport  || {},
        attDone:     DB.attDone     || {},
        feeDone:     DB.feeDone     || {},
        schedules:   DB.schedules   || [],
        perfScores:  DB.perfScores  || {},
        perfWeights: DB.perfWeights || { points: 70, attendance: 30 }
      }
    }).eq('id', aid);
    if (error) {
      console.error('sbSavePerformance failed:', error);
      showToast('Cloud save failed: ' + error.message, 'error');
    }
  } catch(e) {
    console.error('sbSavePerformance exception:', e);
    showToast('Cloud save error: ' + e.message, 'error');
  }
}

async function _getAcadSportsConfig() {
  try {
    const aid = acadId();
    const { data } = await sb().from('academies').select('sports_config').eq('id', aid).single();
    return (data && data.sports_config && typeof data.sports_config === 'object') ? data.sports_config : {};
  } catch(e) { return {}; }
}


// ================================================================
// SETTINGS MODAL
// ================================================================
// ================================================================
// CLASS ACTIVITY LOG
// ================================================================
function openClassLogAddModal() {
  // Populate sport dropdown
  const spSel = document.getElementById('classLogSport');
  const sports = Array.isArray(DB.sports) ? DB.sports : [];
  if (spSel) {
    spSel.innerHTML = sports.length
      ? sports.map(sp => `<option value="${escHtml(sp)}">${escHtml(sp)}</option>`).join('')
      : '<option value="">— No sports —</option>';
  }
  document.getElementById('classLogDate').value = todayStr();
  document.getElementById('classLogInTime').value = '';
  document.getElementById('classLogOutTime').value = '';
  document.getElementById('classLogNote').value = '';
  onClassLogSportChange(); // fill batch dropdown for the selected sport
  openModal('modalClassLogAdd');
}
// Batch dropdown in the class log modal reflects the chosen sport
function onClassLogSportChange() {
  const sp = document.getElementById('classLogSport')?.value || '';
  const bSel = document.getElementById('classLogBatch');
  if (!bSel) return;
  const staffBatches = getStaffBatches();
  let batches = DB.batches.filter(b => (DB.batchSport && DB.batchSport[b]) === sp);
  if (staffBatches.length) batches = batches.filter(b => staffBatches.includes(b));
  bSel.innerHTML = batches.length
    ? batches.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('')
    : '<option value="">— No batches in this sport —</option>';
}

function openClassLogEditModal(id) {
  if (!isAdmin()) { showToast('Only admins can edit entries', 'error'); return; }
  const e = (DB.classLog || []).find(x => x.id === id);
  if (!e) return;
  const bSel = document.getElementById('editClassLogBatch');
  if (bSel) bSel.innerHTML = DB.batches.map(b => `<option value="${escHtml(b)}"${b===e.batch?' selected':''}>${escHtml(b)}</option>`).join('');
  document.getElementById('editClassLogId').value = e.id;
  document.getElementById('editClassLogDate').value = e.date || '';
  document.getElementById('editClassLogInTime').value = e.inTime || '';
  document.getElementById('editClassLogOutTime').value = e.outTime || '';
  document.getElementById('editClassLogNote').value = e.note || '';
  openModal('modalClassLogEdit');
}

function saveClassLogEdit() {
  if (!isAdmin()) { showToast('Only admins can edit entries', 'error'); return; }
  const id      = document.getElementById('editClassLogId').value;
  const date    = document.getElementById('editClassLogDate').value;
  const batch   = document.getElementById('editClassLogBatch').value;
  const inTime  = document.getElementById('editClassLogInTime').value;
  const outTime = document.getElementById('editClassLogOutTime').value;
  const note    = (document.getElementById('editClassLogNote').value || '').trim();

  if (!date)  { showToast('Please select a date', 'error'); return; }
  if (!batch) { showToast('Please select a batch', 'error'); return; }

  // Calculate duration if both times provided
  let duration = '';
  if (inTime && outTime) {
    const [ih, im] = inTime.split(':').map(Number);
    const [oh, om] = outTime.split(':').map(Number);
    const mins = (oh * 60 + om) - (ih * 60 + im);
    if (mins > 0) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      duration = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
  }

  const idx = (DB.classLog || []).findIndex(x => x.id === id);
  if (idx < 0) return;
  DB.classLog[idx] = { ...DB.classLog[idx], date, batch, inTime, outTime, duration, note };

  sbUpdateClassLog(DB.classLog[idx].id, DB.classLog[idx]);
  addLog('classlog', `Class log edited: ${batch} on ${date}`);
  showToast('Entry updated ✓', 'success');
  closeModal('modalClassLogEdit');
  renderClassLog();
}

function saveClassLog() {
  const date    = document.getElementById('classLogDate').value;
  const sport   = document.getElementById('classLogSport')?.value || '';
  const batch   = document.getElementById('classLogBatch').value;
  const inTime  = document.getElementById('classLogInTime').value;
  const outTime = document.getElementById('classLogOutTime').value;
  const note    = (document.getElementById('classLogNote').value || '').trim();

  if (!date)  { showToast('Please select a date', 'error'); return; }
  if (!batch) { showToast('Please select a batch', 'error'); return; }

  // Calculate duration if both times provided
  let duration = '';
  if (inTime && outTime) {
    const [ih, im] = inTime.split(':').map(Number);
    const [oh, om] = outTime.split(':').map(Number);
    const mins = (oh * 60 + om) - (ih * 60 + im);
    if (mins > 0) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      duration = h > 0 ? `${h}h ${m}m` : `${m}m`;
    }
  }

  if (!Array.isArray(DB.classLog)) DB.classLog = [];

  const by = currentUser ? (currentUser.name || currentUser.id) : 'Unknown';
  const newLog = {
    id: 'cl_' + Date.now(),
    date, sport, batch, inTime, outTime, duration, note, by,
    at: new Date().toISOString()
  };
  DB.classLog.unshift(newLog);

  sbInsertClassLog(newLog).then(row => {
    if (row) {
      const idx = DB.classLog.findIndex(x => x.id === newLog.id);
      if (idx >= 0) DB.classLog[idx].id = row.id;
    }
  });
  addLog('classlog', `Class logged: ${batch} on ${date} by ${by}`);
  showToast('Class entry saved ✓', 'success');
  closeModal('modalClassLogAdd');
  renderClassLog();
}

function renderClassLog() {
  const wrap = document.getElementById('classLogList');
  if (!wrap) return;

  if (!Array.isArray(DB.classLog)) DB.classLog = [];

  const filterSport = document.getElementById('classLogFilterSport')?.value || '';
  const filterBatch = document.getElementById('classLogFilterBatch')?.value || '';
  const viewType    = document.getElementById('classLogViewType')?.value || 'month';
  const filterDate  = document.getElementById('classLogFilterDate')?.value || '';
  const filterMonth = document.getElementById('classLogFilterMonth')?.value || '';
  const filterYear  = document.getElementById('classLogFilterYear')?.value || '';

  // Populate the sport filter dropdown
  const spSel = document.getElementById('classLogFilterSport');
  if (spSel) {
    const cur = spSel.value;
    let sports = Array.isArray(DB.sports) ? DB.sports : [];
    if (!isAdmin()) {
      const ss = getStaffSports();
      sports = sports.filter(sp => ss.includes(sp));
    }
    const stillValid = sports.includes(cur);
    spSel.innerHTML = '<option value="">All Sports</option>' +
      sports.map(sp => `<option value="${escHtml(sp)}"${(stillValid && cur===sp)?' selected':''}>${escHtml(sp)}</option>`).join('');
  }

  // Staff only see entries for their assigned batches; admins see all
  const staffBatches = getStaffBatches();

  // Staff only see entries for their assigned batches; admins see all.
  // A staff member with NO assigned batches sees nothing (not everything).
  let list = [...DB.classLog].sort((a, b) => b.date.localeCompare(a.date));
  if (!isAdmin()) {
    list = staffBatches.length ? list.filter(e => staffBatches.includes(e.batch)) : [];
  }
  if (filterSport) list = list.filter(e => (e.sport||'') === filterSport);
  if (filterBatch) list = list.filter(e => e.batch === filterBatch);
  // Date filtering by view mode
  if (viewType === 'day' && filterDate) list = list.filter(e => e.date === filterDate);
  else if (viewType === 'year' && filterYear) list = list.filter(e => e.date.startsWith(filterYear + '-'));
  else if (viewType === 'month' && filterMonth) list = list.filter(e => e.date.startsWith(filterMonth));

  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:20px;">No entries found.</div>';
    return;
  }

  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  wrap.innerHTML = list.map(e => {
    const d = new Date(e.date + 'T00:00:00');
    const dayName = DAYS[d.getDay()];
    const dateDisp = `${dayName}, ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    const canManage = isAdmin();

    // Format time as 12-hour
    const fmt12 = t => {
      if (!t) return '';
      const [h, m] = t.split(':').map(Number);
      return `${((h % 12) || 12)}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`;
    };
    const inDisp  = fmt12(e.inTime);
    const outDisp = fmt12(e.outTime);

    return `<div class="hover-row" style="padding:11px 13px;border-bottom:1px solid var(--border);display:flex;align-items:flex-start;gap:10px;transition:background .15s ease;">
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
          <span style="font-size:13px;font-weight:700;color:var(--gold);">${escHtml(dateDisp)}</span>
          <span class="badge badge-blue" style="font-size:10px;">${escHtml(e.batch)}</span>
        </div>
        ${(inDisp || outDisp) ? `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:4px;flex-wrap:wrap;">
          ${inDisp  ? `<span style="font-size:12px;font-weight:600;"><span style="color:#4ade80;">🟢 In:</span> <span style="color:var(--offwhite);">${escHtml(inDisp)}</span></span>` : ''}
          ${outDisp ? `<span style="font-size:12px;font-weight:600;"><span style="color:#f87171;">🔴 Out:</span> <span style="color:var(--offwhite);">${escHtml(outDisp)}</span></span>` : ''}
          ${e.duration ? `<span class="badge badge-gold" style="font-size:10px;">⏱ ${escHtml(e.duration)}</span>` : ''}
        </div>` : ''}
        ${e.note ? `<div style="font-size:12px;color:var(--offwhite);line-height:1.5;margin-bottom:3px;">${escHtml(e.note)}</div>` : ''}
        <div style="font-size:10px;color:var(--graydk);">✍️ ${escHtml(e.by)} · ${new Date(e.at).toLocaleString('en-GB',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'})}</div>
      </div>
      ${canManage ? `<div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;">
        <button onclick="openClassLogEditModal('${escHtml(e.id)}')" class="btn btn-primary btn-xs">✏️ Edit</button>
        <button onclick="deleteClassLog('${escHtml(e.id)}')" class="btn btn-danger btn-xs">🗑️ Delete</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function deleteClassLog(id) {
  if (!isAdmin()) { showToast('Only admins can delete entries', 'error'); return; }
  confirm_('🗑️', 'Delete Entry', 'Delete this class log entry?', async () => {
    // Remove from local DB
    DB.classLog = (DB.classLog || []).filter(e => e.id !== id);
    // Delete from Supabase
    sbDeleteClassLog(id);
    addLog('classlog', 'Deleted class log entry ' + id);
    showToast('Entry deleted ✓', 'success');
    renderClassLog();
  });
}

// Activity sport filter → reset+repopulate batch dropdown for that sport
function onClassLogSportFilterChange() {
  const sp = document.getElementById('classLogFilterSport')?.value || '';
  const fSel = document.getElementById('classLogFilterBatch');
  if (fSel) {
    const staffBatches = getStaffBatches();
    let batches = sp ? DB.batches.filter(b => (DB.batchSport && DB.batchSport[b]) === sp) : DB.batches;
    if (staffBatches.length) batches = batches.filter(b => staffBatches.includes(b));
    fSel.innerHTML = '<option value="">All Batches</option>' +
      batches.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');
  }
  renderClassLog();
}

// Toggle which date input shows based on the view mode (day/month/year)
function onClassLogViewChange() {
  const vt = document.getElementById('classLogViewType')?.value || 'month';
  const dEl = document.getElementById('classLogFilterDate');
  const mEl = document.getElementById('classLogFilterMonth');
  const yEl = document.getElementById('classLogFilterYear');
  if (dEl) dEl.style.display = vt === 'day'   ? '' : 'none';
  if (mEl) mEl.style.display = vt === 'month' ? '' : 'none';
  if (yEl) yEl.style.display = vt === 'year'  ? '' : 'none';
  // Sensible defaults when switching
  const now = new Date();
  if (vt === 'day'  && dEl && !dEl.value) dEl.value = todayStr();
  if (vt === 'year' && yEl && !yEl.value) yEl.value = String(now.getFullYear());
  renderClassLog();
}

function renderActivityPage() {
  // Set today's date as default
  const dateEl = document.getElementById('classLogDate');
  if (dateEl && !dateEl.value) dateEl.value = todayStr();

  const noteEl = document.getElementById('classLogNote');
  if (noteEl) noteEl.value = '';

  // Populate batch dropdowns restricted to staff's assigned batches
  const staffBatches = getStaffBatches();
  const allowedBatches = staffBatches.length > 0 ? staffBatches : DB.batches;

  const bSel = document.getElementById('classLogBatch');
  if (bSel) bSel.innerHTML = allowedBatches.map(b => `<option value="${escHtml(b)}">${escHtml(b)}</option>`).join('');

  const fSel = document.getElementById('classLogFilterBatch');
  if (fSel) {
    const cur = fSel.value;
    fSel.innerHTML = '<option value="">All Batches</option>' +
      allowedBatches.map(b => `<option value="${escHtml(b)}"${cur===b?' selected':''}>${escHtml(b)}</option>`).join('');
  }
  // Populate sport filter
  const spFil = document.getElementById('classLogFilterSport');
  if (spFil) {
    const cur = spFil.value;
    let sports = Array.isArray(DB.sports) ? DB.sports : [];
    const staffSports = getStaffSports();
    if (staffSports.length) sports = sports.filter(sp => staffSports.includes(sp));
    const stillValid = sports.includes(cur);
    spFil.innerHTML = '<option value="">All Sports</option>' +
      sports.map(sp => `<option value="${escHtml(sp)}"${(stillValid && cur===sp)?' selected':''}>${escHtml(sp)}</option>`).join('');
  }

  // Set filter month to current month if not set
  const mEl = document.getElementById('classLogFilterMonth');
  if (mEl && !mEl.value) {
    const now = new Date();
    mEl.value = now.getFullYear() + '-' + pad(now.getMonth() + 1);
  }
  // Populate year dropdown
  const yEl = document.getElementById('classLogFilterYear');
  if (yEl) {
    const nowY = new Date().getFullYear();
    const cur = yEl.value;
    let opts = '';
    for (let yy = nowY + 1; yy >= nowY - 5; yy--) opts += `<option value="${yy}"${String(yy)===cur?' selected':''}>${yy}</option>`;
    yEl.innerHTML = opts;
    if (!cur) yEl.value = String(nowY);
  }
  // Ensure the right date input is visible for the current view mode
  onClassLogViewChange();

  renderClassLog();
}

function populateSportAssignCheckboxes(assignedSports) {
  const wrap = document.getElementById('sportAssignCheckboxes');
  if (!wrap) return;
  const sports = Array.isArray(DB.sports) ? DB.sports : [];
  wrap.innerHTML = sports.length ? sports.map(sp => `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:var(--card);border:1px solid var(--border);border-radius:7px;padding:6px 10px;font-size:12px;font-weight:600;">
      <input type="checkbox" value="${escHtml(sp)}" ${(assignedSports||[]).includes(sp)?'checked':''}
        onchange="onAssignSportChange()" style="width:15px;height:15px;accent-color:var(--accent2);cursor:pointer;">
      🏆 ${escHtml(sp)}
    </label>`).join('') : '<span style="font-size:12px;color:var(--gray);">No sports yet — add a sport first.</span>';
}
function getSelectedSportAssignments() {
  const cbs = document.querySelectorAll('#sportAssignCheckboxes input[type=checkbox]');
  return Array.from(cbs).filter(cb => cb.checked).map(cb => cb.value);
}
// When sports change, only show batches that belong to the selected sports
function onAssignSportChange() {
  const selectedSports = getSelectedSportAssignments();
  const currentBatches = getSelectedBatchAssignments();
  populateBatchAssignCheckboxes(currentBatches, selectedSports);
}
function populateBatchAssignCheckboxes(assigned, limitSports) {
  const wrap = document.getElementById('batchAssignCheckboxes');
  if (!wrap) return;
  let batches = DB.batches;
  // If sports are selected, only show batches in those sports
  if (Array.isArray(limitSports) && limitSports.length) {
    batches = DB.batches.filter(b => limitSports.includes((DB.batchSport && DB.batchSport[b]) || ''));
  }
  if (!batches.length) {
    wrap.innerHTML = '<span style="font-size:12px;color:var(--gray);">Select a sport above to see its batches.</span>';
    return;
  }
  wrap.innerHTML = batches.map(b => `
    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;background:var(--card);border:1px solid var(--border);border-radius:7px;padding:6px 10px;font-size:12px;font-weight:600;">
      <input type="checkbox" value="${escHtml(b)}" ${(assigned||[]).includes(b)?'checked':''}
        style="width:15px;height:15px;accent-color:var(--accent2);cursor:pointer;">
      ${escHtml(b)}
    </label>`).join('');
}
function toggleBatchAssignField() {
  const role = document.getElementById('newUserRole')?.value;
  const grp  = document.getElementById('batchAssignGroup');
  if (grp) grp.style.display = role === 'staff' ? '' : 'none';
}
function getSelectedBatchAssignments() {
  const cbs = document.querySelectorAll('#batchAssignCheckboxes input[type=checkbox]');
  return Array.from(cbs).filter(cb => cb.checked).map(cb => cb.value);
}

// Returns the batches a staff member is restricted to (empty = all)
function getStaffBatches() {
  if (isAdmin()) return [];
  const batches = currentUser?.assignedBatches;
  return Array.isArray(batches) && batches.length > 0 ? batches : [];
}
// Returns the sports a staff member is restricted to (empty = all)
function getStaffSports() {
  if (isAdmin()) return [];
  const sports = currentUser?.assignedSports;
  return Array.isArray(sports) && sports.length > 0 ? sports : [];
}

function openAssignBatchModal(userId) {
  const u = DB.users.find(x => x.id === userId);
  if (!u) return;
  document.getElementById('assignBatchUserId').value = userId;
  document.getElementById('assignBatchUserName').textContent = '👤 ' + (u.name || u.email || u.id);
  document.getElementById('assignBatchUserEmail').textContent = '📧 ' + (u.email || u.id);
  const assigned = Array.isArray(u.assignedBatches) ? u.assignedBatches : [];
  document.getElementById('assignBatchCheckboxes').innerHTML = DB.batches.map(b => `
    <label style="display:flex;align-items:center;gap:10px;cursor:pointer;background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;transition:border-color .15s;"
      onclick="this.style.borderColor=this.querySelector('input').checked?'var(--border)':'var(--accent2)'">
      <input type="checkbox" value="${escHtml(b)}" ${assigned.includes(b)?'checked':''}
        style="width:17px;height:17px;accent-color:var(--accent2);cursor:pointer;flex-shrink:0;">
      <span style="font-size:13px;font-weight:600;color:var(--offwhite);">${escHtml(b)}</span>
    </label>`).join('');
  openModal('modalAssignBatch');
}
function saveAssignBatch() {
  const userId = document.getElementById('assignBatchUserId').value;
  const cbs = document.querySelectorAll('#assignBatchCheckboxes input[type=checkbox]');
  const assignedBatches = Array.from(cbs).filter(cb => cb.checked).map(cb => cb.value);
  const idx = DB.users.findIndex(u => u.id === userId);
  if (idx < 0) return;
  const userName = DB.users[idx].name || DB.users[idx].email || userId;
  DB.users[idx].assignedBatches = assignedBatches;
  sbUpdateUserByLogin(userId, { assigned_batches: assignedBatches });
  addLog('user', `Batch assigned to "${userName}": ${assignedBatches.join(', ') || 'All batches'}`);
  closeModal('modalAssignBatch');
  renderUserList();
  showToast(assignedBatches.length
    ? `Assigned ${assignedBatches.length} batch(es) to ${userName} ✓`
    : `${userName} can now access all batches ✓`, 'success');
}

function toggleTheme() {
  const dark = document.body.classList.toggle('dark-theme');
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = dark ? '☀️ Light' : '🌙 Dark';
  try { localStorage.setItem('sac_theme', dark ? 'dark' : 'light'); } catch(e) {}
  // Redraw charts so canvas colors match the new theme
  if (typeof renderHomeTileChart === 'function') { try { renderHomeTileChart(); } catch(e) {} }
}
// Apply saved theme on load
(function(){
  try {
    if (localStorage.getItem('sac_theme') === 'dark') {
      document.body.classList.add('dark-theme');
      const setLabel = () => { const b=document.getElementById('themeToggleBtn'); if(b) b.textContent='☀️ Light'; };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setLabel);
      else setLabel();
    }
  } catch(e) {}
})();

// ── Realtime "who changed this" popup — admin-only, per-device preference, OFF by default ──
function isRtPopupEnabled() {
  if (typeof isAdmin !== 'function' || !isAdmin()) return false; // staff never get this popup
  try { return localStorage.getItem('sac_rt_popup') === 'on'; } catch(e) { return false; }
}
function toggleRtPopup() {
  if (typeof isAdmin !== 'function' || !isAdmin()) return; // defensive: staff can't enable even via devtools
  const enabled = !isRtPopupEnabled();
  try { localStorage.setItem('sac_rt_popup', enabled ? 'on' : 'off'); } catch(e) {}
  const btn = document.getElementById('rtPopupToggleBtn');
  if (btn) btn.textContent = enabled ? 'On' : 'Off';
}
// Reflect saved state on the settings button whenever the modal opens
function syncRtPopupToggleLabel() {
  const btn = document.getElementById('rtPopupToggleBtn');
  if (btn) btn.textContent = isRtPopupEnabled() ? 'On' : 'Off';
}

function openSettingsModal() {

  const adminOnly = document.getElementById('settingsAdminOnly');
  if (adminOnly) adminOnly.style.display = isAdmin() ? '' : 'none';

  syncRtPopupToggleLabel();

  if (isAdmin()) {
    renderSnapshotListSettings();
  }

  openModal('modalSettings');
}

async function renderSnapshotListSettings() {
  const wrap = document.getElementById('snapshotListWrapSettings');
  if (!wrap) return;
  wrap.innerHTML = '<div class="empty-state" style="padding:14px;">🔄 Loading snapshots…</div>';
  let list = [];
  try {
    const aid = acadId();
    const { data, error } = await sb().from('snapshots')
      .select('snap_key,label,created_at').eq('academy_id', aid)
      .order('created_at', { ascending: false });
    if (error) throw error;
    list = (data || []).map(s => ({ key: s.snap_key, time: s.created_at, label: s.label || 'auto' }));
    DB.snapshotIndex = list.map(s => ({ key: s.key, time: s.time, label: s.label }));
  } catch(e) {
    list = Array.isArray(DB.snapshotIndex) ? [...DB.snapshotIndex].sort((a,b) => b.key.localeCompare(a.key)) : [];
  }
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-state" style="padding:14px;">No snapshots yet. Tap 📸 Snap Now to create one.</div>';
    return;
  }
  wrap.innerHTML = list.map(s => {
    const d   = new Date(s.time);
    const lbl = s.label === 'manual' ? '🖐 Manual' : '🕛 Auto';
    const col = s.label === 'manual' ? 'var(--accent2)' : 'var(--gold)';
    const ts  = d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) +
                ' ' + d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border);gap:8px;">
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--white);">📅 ${escHtml(s.key)}</div>
        <div style="font-size:11px;color:var(--gray);margin-top:2px;">
          <span style="color:${col};font-weight:600;">${lbl}</span> · ${escHtml(ts)}
        </div>
      </div>
      <div style="display:flex;gap:5px;flex-shrink:0;">
        <button onclick="restoreSnapshot('${escHtml(s.key)}')" class="btn btn-warning btn-xs">↩ Restore</button>
        <button onclick="deleteSnapshotSettings('${escHtml(s.key)}')" class="btn btn-danger btn-xs">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

async function deleteSnapshotSettings(key) {
  confirm_('🗑️', 'Delete Snapshot', 'Delete snapshot ' + key + '? This cannot be undone.',
    async () => {
      try {
        await sbDeleteSnapshot(key);
        DB.snapshotIndex = (DB.snapshotIndex || []).filter(s => s.key !== key);
        renderSnapshotListSettings();
        renderSnapshotList();
        addLog('snapshot', 'Deleted snapshot ' + key);
        showToast('Snapshot deleted ✓', 'success');
      } catch(e) { showToast('Delete failed: ' + e.message, 'error'); }
    });
}

async function takeSnapshotFromSettings() {
  confirm_('📸', 'Take Snapshot', 'Save a snapshot of all current data?', async () => {
    const key = await takeSnapshot('manual');
    if (key) {
      showToast('📸 Snapshot saved: ' + key, 'success');
      addLog('snapshot', 'Manual snapshot: ' + key);
      renderSnapshotListSettings();
      renderSnapshotList();
    } else {
      showToast('Snapshot failed', 'error');
    }
  });
}

