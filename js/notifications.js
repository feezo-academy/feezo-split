// Notification system
// ══════════════════════════════════════════════════════════════════
// NOTIFICATION SYSTEM
// ══════════════════════════════════════════════════════════════════

const NOTIF_KEY = () => 'fezo_notif_read_' + (currentUser?.id || 'guest');

function _notifTodayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

function _notifTomorrowStr() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// ================================================================
// LEAVE COUNT PAGE
// ================================================================
function staffNameFor(l) {
  const u = (DB.users || []).find(u => u.id === l.staffId);
  return (u && u.name) || l.staffName || l.staffId || '';
}
function clearLeaveCountDateFilter() {
  const f = document.getElementById('leaveCountDateFrom');
  const t = document.getElementById('leaveCountDateTo');
  const s = document.getElementById('leaveCountStatusFilter');
  if (f) f.value = '';
  if (t) t.value = '';
  if (s) s.value = 'ALL';
  renderLeaveCountPage();
}

function renderLeaveCountPage() {
  const isAdm = isAdmin();

  const staffWrap = document.getElementById('leaveCountStaffFilterWrap');
  if (staffWrap) staffWrap.style.display = isAdm ? '' : 'none';

  if (isAdm) {
    const staffSel = document.getElementById('leaveCountStaffFilter');
    if (staffSel && staffSel.options.length <= 1) {
      const staff = (DB.users||[]).filter(u => u.role === 'staff');
      staffSel.innerHTML = '<option value="ALL">👥 All Staff</option>' +
        staff.map(u => `<option value="${_esc(u.id)}">${_esc(u.name||u.id)}</option>`).join('');
    }
  }

  let requests = [...(DB.leaveRequests || [])];

  if (!isAdm && currentUser) {
    requests = requests.filter(l => l.staffId === currentUser.id);
  } else if (isAdm) {
    const sv = document.getElementById('leaveCountStaffFilter')?.value || 'ALL';
    if (sv !== 'ALL') requests = requests.filter(l => l.staffId === sv);
  }

  const dateFrom = document.getElementById('leaveCountDateFrom')?.value || '';
  const dateTo   = document.getElementById('leaveCountDateTo')?.value || '';
  if (dateFrom) requests = requests.filter(l => l.date >= dateFrom);
  if (dateTo)   requests = requests.filter(l => l.date <= dateTo);

  const statusFilter = document.getElementById('leaveCountStatusFilter')?.value || 'ALL';
  if (statusFilter !== 'ALL') requests = requests.filter(l => l.status === statusFilter);

  requests.sort((a,b) => (b.date||'').localeCompare(a.date||''));

  // Summary cards
  const total    = requests.length;
  const approved = requests.filter(l => l.status === 'approved').length;
  const pending  = requests.filter(l => l.status === 'pending').length;
  const rejected = requests.filter(l => l.status === 'rejected').length;
  const summaryEl = document.getElementById('leaveCountSummary');
  if (summaryEl) {
    const cards = [
      { label: 'Total',    val: total,    color: 'var(--offwhite)' },
      { label: 'Approved', val: approved, color: '#22c55e' },
      { label: 'Pending',  val: pending,  color: '#f59e0b' },
      { label: 'Rejected', val: rejected, color: '#ef4444' },
    ];
    summaryEl.innerHTML = cards.map(c => `
      <div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:10px 6px;text-align:center;">
        <div style="font-size:19px;font-weight:800;color:${c.color};">${c.val}</div>
        <div style="font-size:10px;color:var(--gray);font-weight:600;margin-top:2px;">${c.label}</div>
      </div>
    `).join('');
  }

  // List
  const listEl = document.getElementById('leaveCountList');
  if (!listEl) return;
  if (!requests.length) {
    listEl.innerHTML = `<div style="text-align:center;padding:40px 0;color:var(--gray);font-size:13px;">No leave requests found.</div>`;
    return;
  }
  const statusColor = { pending:'#f59e0b', approved:'#22c55e', rejected:'#ef4444' };
  listEl.innerHTML = requests.map(l => {
    const sc = statusColor[l.status] || '#888';
    const dateStr = l.date ? new Date(l.date).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'}) : '';
    const canReview = isAdm && l.status === 'pending';
    return `
      <div ${canReview ? `onclick="openLeaveReview('${l.id}')" style="cursor:pointer;background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;"` : `style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:10px;"`}>
        <div style="flex:1;min-width:0;">
          ${isAdm ? `<div style="font-size:13px;font-weight:700;color:var(--offwhite);">${_esc(staffNameFor(l))}</div>` : ''}
          <div style="font-size:12px;color:var(--gray);margin-top:2px;">${dateStr}</div>
          ${l.reason ? `<div style="font-size:11px;color:var(--gray);margin-top:2px;">${_esc(l.reason)}</div>` : ''}
          ${l.reviewedBy && (l.status === 'approved' || l.status === 'rejected') ? `<div style="font-size:11px;color:var(--gray);margin-top:2px;">${l.status === 'approved' ? '✅ Approved' : '❌ Rejected'} by ${_esc(l.reviewedBy)}</div>` : ''}
        </div>
        ${canReview
          ? `<button class="btn btn-primary" style="font-size:11px;padding:6px 12px;flex-shrink:0;" onclick="event.stopPropagation();openLeaveReview('${l.id}')">✅ Review</button>`
          : `<span style="font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:${sc}22;color:${sc};border:1px solid ${sc}44;flex-shrink:0;">${l.status.charAt(0).toUpperCase()+l.status.slice(1)}</span>`}
      </div>
    `;
  }).join('');
}

// ── Compute notifications ─────────────────────────────────────────
// ================================================================
// LEAVE REQUEST SYSTEM
// ================================================================

function openApplyLeave() {
  const el = document.getElementById('leaveDate');
  if (el) el.value = todayIso();
  const r = document.getElementById('leaveReason');
  if (r) r.value = '';
  document.getElementById('leaveTaskWarning').style.display = 'none';
  openModal('modalApplyLeave');
}

// Show warning if staff has tasks on selected date
document.addEventListener('change', function(e) {
  if (e.target.id === 'leaveDate') previewLeaveTaskConflicts(e.target.value);
});
function previewLeaveTaskConflicts(date) {
  const warn = document.getElementById('leaveTaskWarning');
  if (!warn || !date || !currentUser) return;
  const myTasks = (DB.weekSchedules||[]).filter(t => t.staffId === currentUser.id && t.date === date && t.status !== 'done' && t.status !== 'cancelled');
  if (myTasks.length) {
    warn.style.display = 'block';
    warn.innerHTML = `⚠️ You have <b>${myTasks.length} task${myTasks.length>1?'s':''}</b> scheduled on this day. Admin will be notified to reassign.`;
  } else {
    warn.style.display = 'none';
  }
}

async function submitLeaveRequest() {
  const date   = document.getElementById('leaveDate')?.value;
  const reason = (document.getElementById('leaveReason')?.value||'').trim();
  if (!date)   { showToast('Please select a date', 'warn'); return; }
  if (!reason) { showToast('Please enter a reason', 'warn'); return; }

  const existing = (DB.leaveRequests||[]).find(l => l.staffId === currentUser.id && l.date === date && l.status === 'pending');
  if (existing) { showToast('You already have a pending leave request for this date', 'warn'); return; }

  const aid = acadId();
  const id  = 'leave_' + Date.now();
  const row = {
    id,
    academy_id:  aid,
    staff_id:    currentUser.id,
    staff_name:  currentUser.name || currentUser.id,
    date,
    reason,
    status:      'pending',
    applied_at:  new Date().toISOString()
  };

  const { error } = await sb().from('leave_requests').insert(row);
  if (error) { showToast('Failed to submit: ' + error.message, 'error'); return; }

  // Update local DB
  DB.leaveRequests = DB.leaveRequests || [];
  DB.leaveRequests.unshift({ id, staffId: row.staff_id, staffName: row.staff_name, date, reason, status: 'pending', appliedAt: row.applied_at });

  closeModal('modalApplyLeave');
  showToast('Leave request submitted ✓', 'success');
  refreshBellDot();
}

// ── Admin: open leave review modal ───────────────────────────────
function openLeaveReview(leaveId) {
  const leave = (DB.leaveRequests||[]).find(l => l.id === leaveId);
  if (!leave) return;

  const staffUser = (DB.users||[]).find(u => u.id === leave.staffId);
  const staffName = staffUser?.name || leave.staffName || leave.staffId;

  // Tasks on that day for this staff
  const affectedTasks = (DB.weekSchedules||[]).filter(t =>
    t.staffId === leave.staffId && t.date === leave.date &&
    t.status !== 'done' && t.status !== 'cancelled'
  );

  // Other staff available (no leave approved on same date, no task clash)
  const otherStaff = (DB.users||[]).filter(u => {
    if (u.role !== 'staff' || u.id === leave.staffId) return false;
    const hasLeave = (DB.leaveRequests||[]).some(l => l.staffId === u.id && l.date === leave.date && l.status === 'approved');
    return !hasLeave;
  });

  const taskRows = affectedTasks.length
    ? affectedTasks.map(t => `
        <div style="background:var(--card2);border-radius:8px;padding:9px 11px;margin-bottom:6px;border-left:3px solid #f59e0b;">
          <div style="font-size:13px;font-weight:700;color:var(--offwhite);">${_esc(t.task||'Task')}</div>
          <div style="font-size:11px;color:var(--gray);margin-top:2px;">${t.inTime?'⏰ '+fmt24to12(t.inTime)+(t.outTime?' – '+fmt24to12(t.outTime):''):''}${t.location?' · 📍'+_esc(t.location):''}</div>
          <div style="margin-top:7px;">
            <label style="font-size:11px;font-weight:600;color:var(--gray);">Reassign to:</label>
            <select class="form-select" id="reassign_${t.id}" style="font-size:12px;margin-top:4px;width:100%;">
              <option value="">— Keep unassigned —</option>
              ${otherStaff.map(u => `<option value="${_esc(u.id)}">${_esc(u.name||u.id)}</option>`).join('')}
            </select>
          </div>
        </div>`).join('')
    : `<div style="font-size:12px;color:var(--gray);padding:8px 0;">No active tasks on this day.</div>`;

  const availHtml = otherStaff.length
    ? otherStaff.map(u => {
        const taskCount = (DB.weekSchedules||[]).filter(t => t.staffId === u.id && t.date === leave.date && t.status !== 'done' && t.status !== 'cancelled').length;
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;background:var(--card2);margin-bottom:5px;">
          <div style="width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,var(--accent2),#7c9ee8);display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;flex-shrink:0;">${_esc((u.name||u.id).charAt(0).toUpperCase())}</div>
          <div style="flex:1;">
            <div style="font-size:13px;font-weight:700;color:var(--offwhite);">${_esc(u.name||u.id)}</div>
            <div style="font-size:11px;color:var(--gray);">${taskCount ? taskCount+' task'+(taskCount>1?'s':'')+' already on this day' : '✅ Free on this day'}</div>
          </div>
        </div>`;
      }).join('')
    : `<div style="font-size:12px;color:var(--gray);padding:8px 0;">No other staff available.</div>`;

  const statusColor = { pending:'#f59e0b', approved:'#22c55e', rejected:'#ef4444' }[leave.status] || '#888';

  document.getElementById('leaveReviewBody').innerHTML = `
    <div style="background:var(--card2);border-radius:10px;padding:12px;margin-bottom:14px;">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
        <div style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,var(--accent2),#7c9ee8);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;flex-shrink:0;">${_esc(staffName.charAt(0).toUpperCase())}</div>
        <div>
          <div style="font-size:14px;font-weight:800;color:var(--offwhite);">${_esc(staffName)}</div>
          <div style="font-size:11px;color:var(--gray);">Applied ${new Date(leave.appliedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
        </div>
        <span style="margin-left:auto;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;">${leave.status.charAt(0).toUpperCase()+leave.status.slice(1)}</span>
      </div>
      <div style="font-size:13px;font-weight:700;color:var(--offwhite);margin-bottom:4px;">📅 ${isoToDisplay(leave.date)} · ${dayName(leave.date)}</div>
      <div style="font-size:12px;color:var(--gray);">Reason: ${_esc(leave.reason)}</div>
    </div>

    ${leave.status === 'pending' ? `
    <div style="font-size:12px;font-weight:700;color:var(--offwhite);margin-bottom:8px;">📌 Affected Tasks</div>
    ${taskRows}

    <div style="font-size:12px;font-weight:700;color:var(--offwhite);margin:12px 0 8px;">👥 Available Staff on ${isoToDisplay(leave.date)}</div>
    ${availHtml}

    <div style="display:flex;gap:8px;margin-top:16px;">
      <button class="btn" style="flex:1;background:#ef444422;color:#ef4444;border:1px solid #ef444444;font-size:13px;"
        onclick="reviewLeave('${leave.id}','rejected')">❌ Reject</button>
      <button class="btn btn-primary" style="flex:2;font-size:13px;"
        onclick="reviewLeave('${leave.id}','approved')">✅ Approve & Reassign</button>
    </div>` : `
    <div style="font-size:12px;color:var(--gray);text-align:center;padding:12px 0;">
      This request was <b style="color:${statusColor};">${leave.status}</b> by ${_esc(leave.reviewedBy||'admin')} on ${leave.reviewedAt ? new Date(leave.reviewedAt).toLocaleDateString('en-IN',{day:'numeric',month:'short'}) : ''}.
    </div>`}`;

  // Store leaveId for reviewLeave()
  document.getElementById('modalLeaveReview').dataset.leaveId = leaveId;
  openModal('modalLeaveReview');
}

async function reviewLeave(leaveId, decision) {
  const idx = (DB.leaveRequests||[]).findIndex(l => l.id === leaveId);
  if (idx < 0) return;
  const leave = DB.leaveRequests[idx];

  // Apply task reassignments if approving
  if (decision === 'approved') {
    const affectedTasks = (DB.weekSchedules||[]).filter(t =>
      t.staffId === leave.staffId && t.date === leave.date &&
      t.status !== 'done' && t.status !== 'cancelled'
    );
    for (const t of affectedTasks) {
      const sel = document.getElementById('reassign_' + t.id);
      const newStaffId = sel?.value;
      if (newStaffId) {
        const { error } = await sb().from('week_schedules').update({
          staff_id: newStaffId, updated_by: currentUser?.id, updated_at: new Date().toISOString()
        }).eq('id', t.id);
        if (!error) {
          const ti = DB.weekSchedules.findIndex(x => x.id === t.id);
          if (ti >= 0) { DB.weekSchedules[ti].staffId = newStaffId; }
        }
      }
    }
  }

  const reviewedBy = currentUser?.name || currentUser?.id;
  const reviewedAt = new Date().toISOString();

  const { error } = await sb().from('leave_requests').update({
    status: decision,
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt
  }).eq('id', leaveId);

  if (error) { showToast('Failed to update: ' + error.message, 'error'); return; }

  // Update local DB
  DB.leaveRequests[idx].status     = decision;
  DB.leaveRequests[idx].reviewedBy = reviewedBy;
  DB.leaveRequests[idx].reviewedAt = reviewedAt;

  closeModal('modalLeaveReview');
  showToast(`Leave ${decision === 'approved' ? 'approved ✓' : 'rejected'}`, decision === 'approved' ? 'success' : 'error');
  renderSchedulesPage();
  refreshBellDot();
}

function computeNotifs() {
  const today   = _notifTodayStr();
  const now     = new Date(); now.setHours(0,0,0,0);
  const myId    = currentUser?.id;
  const admin   = isAdmin();

  const sections = [];

  // ── 1. OVERDUE FEES ──────────────────────────────────────────
  // All months before current month that have unpaid active students
  const curYear  = now.getFullYear();
  const curMonth = now.getMonth() + 1; // 1-based
  const overdueFee = [];

  const activeStudents = getActiveStudents();
  // check last 6 months max
  for (let i = 1; i <= 6; i++) {
    let m = curMonth - i; let y = curYear;
    if (m <= 0) { m += 12; y--; }
    const fk = y + '-' + String(m).padStart(2,'0');
    const feeMonth = DB.fees[fk] || {};
    activeStudents.forEach(s => {
      // Skip students who hadn't joined yet by this month or who didn't attend it --
      // same eligibility rules the Fees tab uses, so the bell only flags rows that
      // would actually appear there as unpaid
      if (!isEnrolledOnDate(s,y,m,0)) return;
      if (!studentAttendedMonth(s.id,y,m)) return;
      // Find all sports this student is enrolled in
      const enrSports = (DB.enrollments||[]).filter(e => e.studentId === (s._sid||s.id)).map(e => e.sport);
      if (!enrSports.length) enrSports.push('');
      enrSports.forEach(sp => {
        const entry = ((feeMonth[sp]||{})[s.id] || (feeMonth[sp]||{})[s._sid]);
        const paid = entry && (entry.status === 'paid' || entry.status === 'partial');
        if (!paid) {
          overdueFee.push({ name: s.name, contact: s.contact||'', month: (MONTHS[m-1]||'')+' '+y, sport: sp });
        }
      });
    });
  }
  // Deduplicate by student+month
  const feeDedup = {};
  for (const f of overdueFee) {
    const k = f.name + '|' + f.month;
    if (!feeDedup[k]) feeDedup[k] = f;
  }
  const feeItems = Object.values(feeDedup);

  if (feeItems.length) {
    sections.push({ id:'fees', icon:'💰', label:'Overdue Fees', color:'#ef4444', count: feeItems.length, items: feeItems.map(f => ({ title: f.name, sub: f.month + (f.sport?' · '+f.sport:''), contact: f.contact })) });
  }

  // ── 2. ENQUIRIES (today's + tomorrow's reminder + overdue) ────
  const tomorrow = _notifTomorrowStr();
  let enqList = DB.enquiries || [];
  if (!admin) {
    enqList = enqList.filter(q => q.assignedTo === myId || q.assignedTo === (currentUser?.name));
  }
  const enqAlert = enqList.filter(q => {
    if (!q.reminderDate) return false;
    return q.reminderDate <= tomorrow;
  });
  if (enqAlert.length) {
    sections.push({ id:'enquiries', icon:'💬', label:'Enquiry Follow-ups', color:'#f59e0b', count: enqAlert.length, items: enqAlert.map(q => ({ title: q.name, sub: q.reminderDate === today ? 'Today' : q.reminderDate === tomorrow ? 'Tomorrow' : 'Overdue · '+q.reminderDate, contact: q.phone||'' })) });
  }

  // ── 3. TASKS (today + overdue, not done/cancelled) ────────────
  let taskList = DB.weekSchedules || [];
  if (!admin) {
    taskList = taskList.filter(t => t.staffId === myId);
  }
  const taskAlert = taskList.filter(t => {
    if (!t.date) return false;
    if (t.status === 'done' || t.status === 'cancelled') return false;
    return t.date <= today;
  });
  if (taskAlert.length) {
    sections.push({ id:'tasks', icon:'📅', label:'Scheduled Tasks', color:'#8b5cf6', count: taskAlert.length, items: taskAlert.map(t => ({
      title: t.task||'Task',
      sub: t.date === today ? 'Today'+(t.inTime?' · '+fmt24to12(t.inTime):'') : 'Overdue · '+t.date,
      sport: t.sport||'',
      batch: t.batch||'',
      staffId: t.staffId||'',
      inTime: t.inTime||'',
      outTime: t.outTime||'',
      status: t.status||'scheduled'
    })) });
  }

  // ── 4. LEAVE REQUESTS (pending, admin only) ───────────────────
  if (admin) {
    const pendingLeaves = (DB.leaveRequests||[]).filter(l => l.status === 'pending');
    if (pendingLeaves.length) {
      sections.push({
        id: 'leaves',
        icon: '🏖️',
        label: 'Leave Requests',
        color: '#f59e0b',
        count: pendingLeaves.length,
        items: pendingLeaves.map(l => ({
          title: l.staffName || l.staffId,
          sub: isoToDisplay(l.date) + ' · ' + _esc(l.reason||''),
          contact: '',
          leaveId: l.id
        }))
      });
    }
  }

  return sections;
}

// ── Badge dot ─────────────────────────────────────────────────────
function refreshBellDot() {
  if (!currentUser) return;
  try {
    const sections = computeNotifs();
    const total = sections.reduce((s,sec) => s + sec.count, 0);
    const lastRead = parseInt(localStorage.getItem(NOTIF_KEY()) || '0');
    const dot = document.getElementById('bellDot');
    if (!dot) return;
    // Show dot if there are items AND user hasn't dismissed since last load
    dot.style.display = total > 0 && !window._notifRead ? 'block' : 'none';
  } catch(e) {}
}

// ── Toggle panel ──────────────────────────────────────────────────
function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  const ov    = document.getElementById('notifOverlay');
  if (!panel) return;
  const open = panel.style.display === 'flex';
  if (open) { closeNotifPanel(); return; }

  // Render sections
  renderNotifPanel();
  panel.style.display = 'flex';
  if (ov) ov.style.display = 'block';

  // Mark as read (hide dot)
  window._notifRead = true;
  const dot = document.getElementById('bellDot');
  if (dot) dot.style.display = 'none';
}

function closeNotifPanel() {
  const panel = document.getElementById('notifPanel');
  const ov    = document.getElementById('notifOverlay');
  if (panel) panel.style.display = 'none';
  if (ov)    ov.style.display    = 'none';
}

function markAllNotifsRead() {
  window._notifRead = true;
  const dot = document.getElementById('bellDot');
  if (dot) dot.style.display = 'none';
  closeNotifPanel();
  showToast('All notifications marked as read ✓', 'success');
}

// ── Render panel ──────────────────────────────────────────────────
function renderNotifPanel() {
  const body = document.getElementById('notifBody');
  if (!body) return;

  let sections;
  try { sections = computeNotifs(); } catch(e) { sections = []; }

  if (!sections.length) {
    body.innerHTML = `<div style="padding:28px 14px;text-align:center;color:var(--gray);">
      <div style="font-size:28px;margin-bottom:8px;">✅</div>
      <div style="font-size:13px;font-weight:600;">All clear! No pending items.</div>
    </div>`;
    return;
  }

  body.innerHTML = sections.map(sec => `
    <div onclick="openNotifDetail('${sec.id}')"
      style="display:flex;align-items:center;gap:12px;padding:11px 14px;cursor:pointer;border-bottom:1px solid var(--border);transition:background .15s;"
      onmouseover="this.style.background='var(--card2)'" onmouseout="this.style.background=''">
      <div style="width:40px;height:40px;border-radius:50%;background:${sec.color}18;border:1.5px solid ${sec.color}44;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;">${sec.icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--offwhite);">${sec.label}</div>
        <div style="font-size:11px;color:var(--gray);margin-top:2px;">${sec.count} item${sec.count>1?'s':''} need${sec.count===1?'s':''} attention</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <span style="background:${sec.color};color:#fff;border-radius:20px;padding:2px 9px;font-size:11px;font-weight:800;">${sec.count}</span>
        <span style="color:var(--gray);font-size:16px;">›</span>
      </div>
    </div>`).join('');
}

// ── Drill-down detail modal ───────────────────────────────────────
function openNotifDetail(sectionId) {
  let sections;
  try { sections = computeNotifs(); } catch(e) { sections = []; }
  const sec = sections.find(s => s.id === sectionId);
  if (!sec) return;

  // Leave requests: tap each row to open the review modal directly
  if (sectionId === 'leaves') {
    closeNotifPanel();
    if (sec.items.length === 1) {
      openLeaveReview(sec.items[0].leaveId);
    } else {
      document.getElementById('notifDetailTitle').textContent = sec.icon + ' ' + sec.label;
      const rows = sec.items.map(item => `
        <div onclick="closeModal('modalNotifDetail');openLeaveReview('${item.leaveId}')"
          style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer;">
          <div style="width:36px;height:36px;border-radius:50%;background:${sec.color}18;border:1.5px solid ${sec.color}33;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">${sec.icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:700;color:var(--offwhite);">${escHtml(item.title)}</div>
            <div style="font-size:11px;color:var(--gray);margin-top:2px;">${escHtml(item.sub)}</div>
          </div>
          <span style="color:var(--gray);font-size:16px;">›</span>
        </div>`).join('');
      document.getElementById('notifDetailBody').innerHTML = rows;
      openModal('modalNotifDetail');
    }
    return;
  }

  closeNotifPanel();

  document.getElementById('notifDetailTitle').textContent = sec.icon + ' ' + sec.label;

  // Scheduled Tasks: richer, professional card layout (sport, batch, assigned to, timings, status)
  if (sectionId === 'tasks') {
    const rows = sec.items.map(item => {
      const color = SCHED_COLORS[item.status] || SCHED_COLORS.scheduled;
      const label = SCHED_LABELS[item.status] || SCHED_LABELS.scheduled;
      const meta = [];
      if (item.sport) meta.push(`<span style="font-size:10px;font-weight:700;background:var(--accent2)22;color:var(--accent2);border:1px solid var(--accent2)44;padding:2px 7px;border-radius:6px;">🏅 ${escHtml(item.sport)}${item.batch?' · '+escHtml(item.batch):''}</span>`);
      if (item.staffId) meta.push(`<span style="background:var(--card2);border:1px solid var(--border);border-radius:6px;padding:2px 7px;font-size:10px;font-weight:700;color:var(--offwhite);">👤 ${escHtml(staffName(item.staffId))}</span>`);
      if (item.inTime) meta.push(`<span style="font-size:11px;font-weight:700;color:${color};">⏰ ${fmt24to12(item.inTime)}${item.outTime?' – '+fmt24to12(item.outTime):''}</span>`);

      return `
      <div style="padding:11px 0;border-bottom:1px solid var(--border);">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
          <div style="font-size:13px;font-weight:800;color:var(--offwhite);">${escHtml(item.title)}</div>
          <span style="flex-shrink:0;font-size:10px;font-weight:800;padding:3px 9px;border-radius:99px;background:${color}22;color:${color};border:1px solid ${color}44;white-space:nowrap;">${label}</span>
        </div>
        <div style="font-size:11px;color:var(--gray);margin-top:2px;">${escHtml(item.sub)}</div>
        ${meta.length ? `<div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:7px;">${meta.join('')}</div>` : ''}
      </div>`;
    }).join('');

    document.getElementById('notifDetailBody').innerHTML = rows ||
      `<div style="padding:20px;text-align:center;color:var(--gray);">No items</div>`;

    openModal('modalNotifDetail');
    return;
  }

  const rows = sec.items.map(item => `
    <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);">
      <div style="width:36px;height:36px;border-radius:50%;background:${sec.color}18;border:1.5px solid ${sec.color}33;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0;">${sec.icon}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:13px;font-weight:700;color:var(--offwhite);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(item.title)}</div>
        <div style="font-size:11px;color:var(--gray);margin-top:2px;">${escHtml(item.sub)}</div>
      </div>
      ${item.contact ? `
      <a href="tel:${escHtml(item.contact)}"
        style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:#22c55e18;border:1px solid #22c55e44;color:#22c55e;font-size:15px;flex-shrink:0;text-decoration:none;"
        title="${escHtml(item.contact)}">📞</a>` : ''}
    </div>`).join('');

  document.getElementById('notifDetailBody').innerHTML = rows ||
    `<div style="padding:20px;text-align:center;color:var(--gray);">No items</div>`;

  openModal('modalNotifDetail');
}

// ── Auto-refresh bell dot every 5 min ────────────────────────────
function initNotifSystem() {
  window._notifRead = false;
  refreshBellDot();
  setInterval(() => { if (!window._notifRead) refreshBellDot(); }, 5 * 60 * 1000);
}
