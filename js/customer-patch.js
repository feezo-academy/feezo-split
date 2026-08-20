// FeeZoapp Customer Patch — runs alongside the core app code
// ====================================================================
// FeeZoapp Customer Patch — runs alongside your existing index.html code
// ====================================================================
(function(){
  let _fzPlans = null;
  let _fzAppConfig = null;
  let _fzAcademy = null;
  // ── Wait for the existing app to be ready ─────────────────────────
  function fzWaitForApp() {
    return new Promise(resolve => {
      let tries = 0;
      const check = () => {
        // _currentAcademyId starts as null, becomes a UUID after login
        // Must be a non-empty string, not null/undefined/false
        const aid = window._currentAcademyId;
        if (window._sb && aid && typeof aid === 'string' && aid.length > 10) {
          resolve();
        } else if (tries++ > 200) {
          // Give up after 60s — user not logged in
          resolve();
        } else {
          setTimeout(check, 300);
        }
      };
      check();
    });
  }

  // ── SUPERADMIN REDIRECT ───────────────────────────────────────────
  // If a superadmin logs into index.html, redirect them to admin.html.
  // We hook into the existing login completion by polling for the role.
  async function fzCheckSuperadminRedirect() {
    try {
      if (!window._sb) return;
      const { data: { session } } = await window._sb.auth.getSession();
      if (!session) return;
      const { data: prof } = await window._sb.from('app_users').select('role').eq('id', session.user.id).single();
      if (prof && prof.role === 'superadmin') {
        // It's a superadmin — they shouldn't be in the customer app
        const url = new URL(window.location.href);
        const target = url.pathname.replace(/index\.html?$|\/$/i, '') + 'admin.html';
        await window._sb.auth.signOut();
        alert('This account is for admin access. Redirecting you to admin.html...');
        window.location.href = target;
      }
    } catch(e) { /* silent */ }
  }

  // ── LOAD ACADEMY + CONFIG + PLANS ─────────────────────────────────
  async function fzLoadStatus() {
    try {
      const aid = window._currentAcademyId;
      if (!aid || !window._sb) return;

      const [acadRes, cfgRes, plansRes] = await Promise.all([
        window._sb.from('academies').select('plan, trial_ends_at, plan_ends_at, frozen_at').eq('id', aid).single(),
        window._sb.from('app_config').select('*').eq('id', 1).maybeSingle(),
        window._sb.from('plans').select('*').eq('is_active', true).order('sort_order')
      ]);

      _fzAcademy   = acadRes.data || null;
      _fzAppConfig = cfgRes.data || null;
      _fzPlans     = plansRes.data || [];

      // ── Sync plan into DB.settings so applyRoleUI() reads the latest ──
      if (_fzAcademy && window.DB && window.DB.settings) {
        const newPlan = _fzAcademy.plan || 'trial';
        const oldPlan = window.DB.settings.plan || 'trial';
        if (newPlan !== oldPlan) {
          // Plan changed while user is logged in — update and refresh UI
          window.DB.settings.plan        = newPlan;
          window.DB.settings.trialEndsAt = _fzAcademy.trial_ends_at || null;
          window.DB.settings.planEndsAt  = _fzAcademy.plan_ends_at  || null;
          // Refresh tabs, badges, plan limits without requiring logout
          if (typeof applyRoleUI === 'function') applyRoleUI();
          // Re-init year dropdowns in case history window changed
          if (typeof initAttFilters === 'function') initAttFilters();
          if (typeof initFeeFilters === 'function') initFeeFilters();
          // Re-render snapshot list in case retention changed
          if (typeof renderSnapshotList === 'function') renderSnapshotList();
          //Re-render student list so the count/limit badge reflects the new plan
          if(typeof renderStudentList==='function') renderStudentList();
          console.log(`FeeZo: plan updated live ${oldPlan} → ${newPlan}`);
        }
      }

      fzUpdateBannerAndFrozen();
    } catch(e) {
      console.warn('FeeZo patch: status load failed', e);
    }
  }

  // ── DECIDE: show banner, frozen screen, or nothing ────────────────
  function fzUpdateBannerAndFrozen() {
    if (!_fzAcademy) return;
    const a = _fzAcademy;
    const now = Date.now();
    const trialEnd = a.trial_ends_at ? new Date(a.trial_ends_at).getTime() : null;
    const planEnd  = a.plan_ends_at  ? new Date(a.plan_ends_at).getTime()  : null;

    const isFrozenManual  = a.plan === 'frozen';
    const isTrialExpired  = a.plan === 'trial' && trialEnd && trialEnd < now;
    const isPlanExpired   = ['basic','pro','premium'].includes(a.plan) && planEnd && planEnd < now;
    const isFrozen        = isFrozenManual || isTrialExpired || isPlanExpired;

    if (isFrozen) {
      fzShowFrozen(isFrozenManual ? 'manual' : (isTrialExpired ? 'trial' : 'plan'));
      return;
    }

    fzHideFrozen();
  }

  // ── FROZEN SCREEN ─────────────────────────────────────────────────
  // fzShowFrozen is defined below with the new professional version

  function fzShowFrozen(kind) {
    // Generate stars if not already done
    const starsEl = document.getElementById('fzStars');
    if (starsEl && !starsEl.children.length) {
      for (let i = 0; i < 40; i++) {
        const s = document.createElement('div');
        s.className = 'fz-star-dot';
        const size = Math.random() * 2.5 + 1;
        s.style.cssText = `width:${size}px;height:${size}px;top:${Math.random()*100}%;left:${Math.random()*100}%;animation-duration:${Math.random()*3+2}s;animation-delay:${Math.random()*3}s;`;
        starsEl.appendChild(s);
      }
    }

    const el = id => document.getElementById(id);
    const a = _fzAcademy || {};

    // Swap SVG icon based on state
    const svgIcons = {
      trial: '<svg class="fz-frozen-icon-svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
      plan:  '<svg class="fz-frozen-icon-svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
      manual:'<svg class="fz-frozen-icon-svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
    };
    const iconWrap = el('fzIconWrap');
    if (iconWrap) iconWrap.innerHTML = svgIcons[kind] || svgIcons.manual;

    // ── Format the expiry date ──
    let expiryDate = '—';
    if (kind === 'trial' && a.trial_ends_at) {
      expiryDate = new Date(a.trial_ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    } else if (kind === 'plan' && a.plan_ends_at) {
      expiryDate = new Date(a.plan_ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    } else if (kind === 'manual' && a.frozen_at) {
      expiryDate = new Date(a.frozen_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    }

    // ── Reason banner (the "why" line) ──
    const reasons = {
      trial:  { icon: '⏰', title: 'Your 7-day free trial has expired', sub: 'Your account was automatically paused on' },
      plan:   { icon: '🔄', title: `Your ${(a.plan||'').charAt(0).toUpperCase()+(a.plan||'').slice(1)} plan has expired`, sub: 'Your subscription ended on' },
      manual: { icon: '🔒', title: 'Your account has been put on hold', sub: 'Your account was paused on' },
    };
    const reason = reasons[kind] || reasons.trial;
    if (el('fzReasonIcon'))  el('fzReasonIcon').textContent  = reason.icon;
    if (el('fzReasonTitle')) el('fzReasonTitle').textContent = reason.title;
    if (el('fzReasonSub'))   el('fzReasonSub').innerHTML     = reason.sub + ' <span id="fzReasonDate">' + expiryDate + '</span>';

    // ── Main card ──
    const configs = {
      trial:  { badge: 'Free Trial Ended',       emoji: '⏰', title: 'Your Free Trial Has Ended',         subtitle: 'Subscribe now to continue managing your academy without interruption.' },
      plan:   { badge: 'Subscription Expired',   emoji: '🔄', title: 'Your Subscription Has Expired',     subtitle: 'Renew your plan to restore full access. Your data is safe and waiting for you.' },
      manual: { badge: 'Account On Hold',         emoji: '🔒', title: 'Your Account Is On Hold',           subtitle: 'Your account has been temporarily paused. Please contact support to reactivate.' },
    };
    const cfg = configs[kind] || configs.trial;
    if (el('fzFrozenBadge'))    el('fzFrozenBadge').textContent    = cfg.badge;
    if (el('fzFrozenEmoji'))    el('fzFrozenEmoji').textContent    = cfg.emoji;
    if (el('fzFrozenTitle'))    el('fzFrozenTitle').textContent    = cfg.title;
    if (el('fzFrozenSub'))      el('fzFrozenSub').textContent      = cfg.subtitle;

    // ── Support email from app_config ──
    if (_fzAppConfig && _fzAppConfig.support_email) {
      const emailLink = el('fzSupportEmail');
      if (emailLink) { emailLink.textContent = _fzAppConfig.support_email; emailLink.href = 'mailto:' + _fzAppConfig.support_email; }
    }

    // ── Live engagement stats ──
    if (window._sb && window._currentAcademyId) {
      Promise.all([
        window._sb.from('students').select('id', { count: 'exact', head: true }).eq('academy_id', window._currentAcademyId),
        window._sb.from('attendance').select('id', { count: 'exact', head: true }).eq('academy_id', window._currentAcademyId),
        window._sb.from('academies').select('created_at').eq('id', window._currentAcademyId).single()
      ]).then(([stu, att, acad]) => {
        const stuCount = stu.count || 0;
        const attCount = att.count || 0;
        const days = acad.data?.created_at ? Math.max(1, Math.floor((Date.now() - new Date(acad.data.created_at).getTime()) / 86400000)) : '—';
        const statsEl = el('fzFrozenStats');
        if (statsEl && stuCount > 0) {
          if (el('fzStatStudents'))   el('fzStatStudents').textContent   = stuCount;
          if (el('fzStatAttendance')) el('fzStatAttendance').textContent = attCount;
          if (el('fzStatDays'))       el('fzStatDays').textContent       = days;
          statsEl.style.display = 'grid';
        }
      }).catch(() => {});
    }

    // ── Show overlay + block app ──
    document.getElementById('fzFrozenScreen').classList.add('show');
    document.body.style.overflow = 'hidden';

    // Kill any open drawers, modals, overlays the app may have open
    // so they don't bleed through on the edges
    document.querySelectorAll('.drawer, .confirm-overlay, .chart-page')
      .forEach(el => { el.style.display = 'none'; });
  }
  function fzHideFrozen() {
    document.getElementById('fzFrozenScreen').classList.remove('show');
    document.body.style.overflow = '';
  }

  function fzContactSupport() {
    const cfg = _fzAppConfig || {};
    const num = (cfg.whatsapp_number || '').replace(/[^0-9]/g,'');
    if (!num) { alert('Support contact not configured yet.'); return; }
    const aname = (window.DB && window.DB.settings && window.DB.settings.academyName) || 'my academy';
    const msg = `Hi! My account for "${aname}" is on hold. Please help me reactivate. Thanks!`;
    window.open(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`, '_blank');
  }

  async function fzSignOutFromFrozen() {
    if (window._sbSignOut) await window._sbSignOut();
    location.reload();
  }

  // ── PLANS MODAL ───────────────────────────────────────────────────
  let _fzSelectedPlan = 'pro';

  // Hardcoded plan data (fallback if DB unavailable)
  const _fzDefaultPlans = [
    { code:'basic', name:'Basic', is_recommended:false,
      tagline:'For small academies just getting started',
      features:[
        {text:'Up to 50 students', lim:'2 staff'},
        {text:'1 sport · 3 batches'},
        {text:'Attendance & fee tracking'},
        {text:'Basic reports'},
        {text:'7-day data snapshots'},
      ], ideal:'New academies · single-sport centres'
    },
    { code:'pro', name:'Pro', is_recommended:true,
      tagline:'For growing academies that want to look professional',
      features:[
        {text:'Everything in Basic', lim:'250 students · 4 staff'},
        {text:'WhatsApp fee reminders'},
        {text:'WhatsApp attendance reports'},
        {text:'Bulk import / export · PDF & Excel'},
        {text:'Enquiry & lead management'},
        {text:'Class log & activity audit'},
        {text:'15-day snapshots · Priority email'},
      ], ideal:'Established academies · multi-batch centres'
    },
    { code:'premium', name:'Premium', is_recommended:false,
      tagline:'For professional academies and multi-branch operations',
      features:[
        {text:'Everything in Pro', lim:'Unlimited students'},
        {text:'Up to 20 staff'},
        {text:'Performance tracking & leaderboards'},
        {text:'Staff task scheduler & leave management'},
        {text:'30-day data snapshots'},
        {text:'Priority WhatsApp & email support'},
      ], ideal:'Large academies · chains · sports institutes'
    }
  ];

  async function fzOpenPlans() {
    document.getElementById('fzPlansOverlay').classList.add('show');
    document.body.style.overflow = 'hidden';
    if (!_fzPlans || _fzPlans.length===0) await fzLoadStatus();
    fzRenderPlans();
    fzRenderContactRow();
  }
  function fzClosePlans() {
    document.getElementById('fzPlansOverlay').classList.remove('show');
    document.body.style.overflow = '';
  }

  function fzRenderPlans() {
    const plans = (_fzPlans && _fzPlans.length) ? _fzPlans.map(p=>({
      code:p.code, name:p.name, is_recommended:p.is_recommended, tagline:p.tagline||'',
      features:(p.highlights||[]).map(h=>({text:h})), ideal:''
    })) : _fzDefaultPlans;

    document.getElementById('fzPlansGrid').innerHTML = plans.map(p => {
      const isPro = p.is_recommended;
      const isSel = p.code === _fzSelectedPlan;
      const bdr   = isSel ? '2px solid #2563eb' : '0.5px solid #e2e8f0';
      return '<div class="fz-plan-card'+(isPro?' featured':'')+'" onclick="fzSelectPlan(\''+p.code+'\')" style="border:'+bdr+';">'
        +(isPro?'<div class="fz-plan-pop">⭐ Most popular</div>':'')
        +'<div class="fz-plan-body">'
        +'<div class="fz-plan-hdr">'
        +'<div class="fz-plan-left"><div class="fz-plan-name">'+escapeHtml(p.name)+'</div>'
        +'<div class="fz-plan-tagline">'+escapeHtml(p.tagline)+'</div></div>'
        +'</div>'
        +'<div class="fz-plan-divider"></div>'
        +'<div class="fz-plan-feats">'
        +(p.features||[]).map(f=>'<div class="fz-plan-feat"><i class="ti ti-check fz-plan-feat-check"></i><span>'+escapeHtml(f.text||f)+'</span>'+(f.lim?'<span class="fz-plan-feat-lim">'+escapeHtml(f.lim)+'</span>':'')+'</div>').join('')
        +(p.ideal?'<div class="fz-plan-feat" style="margin-top:4px;font-style:italic;color:#94a3b8;"><i class="ti ti-users fz-plan-feat-check" style="color:#94a3b8;"></i><span>'+escapeHtml(p.ideal)+'</span></div>':'')
        +'</div></div></div>';
    }).join('');
    fzUpdateCta();
  }

  function fzSelectPlan(code) {
    _fzSelectedPlan = code;
    document.querySelectorAll('.fz-plan-card').forEach(el => {
      const isMe  = el.getAttribute('onclick') && el.getAttribute('onclick').includes("'"+code+"'");
      el.style.border = isMe ? '2px solid #2563eb' : '0.5px solid #e2e8f0';
    });
    fzUpdateCta();
  }

  function fzUpdateCta() {
    const names = {basic:'Basic',pro:'Pro',premium:'Premium'};
    const el    = document.getElementById('fzCtaText');
    if (el) el.textContent = 'Call to activate '+(names[_fzSelectedPlan]||'Pro');
  }

  function fzRenderContactRow() {
    const cfg = _fzAppConfig || {};
    const ph1 = cfg.phone_number || '';
    const ph2 = cfg.whatsapp_number || '';
    const em  = cfg.support_email || '';
    const e1=document.getElementById('fzPhone1Link'), e2=document.getElementById('fzPhone2Link'), ee=document.getElementById('fzEmailLink');
    if(e1){e1.textContent=ph1||'Not set';e1.href=ph1?'tel:'+ph1.replace(/\s/g,''):'#';}
    if(e2){e2.textContent=ph2||'Not set';e2.href=ph2?'https://wa.me/'+ph2.replace(/[^0-9]/g,''):'#';}
    if(ee){ee.textContent=em||'Not set';ee.href=em?'mailto:'+em:'#';}
  }

  function fzCallToActivate() {
    const cfg = _fzAppConfig||{};
    const ph  = cfg.phone_number||'';
    if (!ph) { alert('Support phone not configured. Please contact us on WhatsApp.'); return; }
    window.location.href = 'tel:'+ph.replace(/\s/g,'');
  }

  function fzSubscribeWhatsApp() {
    const cfg   = _fzAppConfig||{};
    const num   = (cfg.whatsapp_number||'').replace(/[^0-9]/g,'');
    const aname = (window.DB&&window.DB.settings&&window.DB.settings.academyName)||'';
    const aphone= (window.DB&&window.DB.settings&&window.DB.settings.phone)||'';
    const plan  = _fzDefaultPlans.find(p=>p.code===_fzSelectedPlan)||_fzDefaultPlans[1];

    const lines = [
      'Hi FeeZo team! 👋',
      '',
      `I'd like to subscribe to the *${plan.name}* plan for my academy.`,
      ''
    ];
    if (aname)  lines.push(`📌 Academy: ${aname}`);
    if (aphone) lines.push(`📞 Contact: ${aphone}`);
    lines.push('', 'Please help me activate this plan. Thank you!');
    const msg = lines.join('\n');

    if (!num) { alert('WhatsApp number not configured. Please contact us directly.'); return; }
    window.open('https://wa.me/'+num+'?text='+encodeURIComponent(msg),'_blank');
  }

  function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ── BOOT ──────────────────────────────────────────────────────────
  // PRE-FILL Academy ID from URL on page load
  // Supports: ?a=silambam-academy  OR  /silambam-academy
  function fzPrefillAcademyFromURL() {
    try {
      const acadField = document.getElementById('loginAcademyId');
      if (!acadField) return;

      // Step 0 — Wipe any autofilled/stale value first (e.g. "srcdoc" from iframe preview)
      const blocked = new Set(['srcdoc','about','blank','data','file','localhost','index','index.html','admin','admin.html','signup','signup.html','login','home']);
      if (acadField.value) {
        const cur = acadField.value.trim().toLowerCase();
        if (blocked.has(cur) || !/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(cur)) {
          acadField.value = '';
        }
      }

      // Block paths/values that come from previewing inside an iframe (srcdoc, about:blank, file://)
      const proto = window.location.protocol;
      if (proto === 'about:' || proto === 'data:' || proto === 'blob:') return;
      if (window.location.href.startsWith('about:srcdoc')) return;

      const url = new URL(window.location.href);
      // 1. Try ?a=slug query param
      let slug = (url.searchParams.get('a') || '').trim().toLowerCase();

      // 2. Try /slug path
      if (!slug) {
        const path = url.pathname.replace(/\/$/, '');
        const last = path.substring(path.lastIndexOf('/') + 1).replace(/\.html?$/i, '');
        if (/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(last) && !blocked.has(last)) {
          slug = last;
        }
      }

      // Final sanity check — must match slug format AND not be in the blocked list
      if (!slug || blocked.has(slug)) return;
      if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(slug)) return;

      // Only fill if currently empty (don't override user typing)
      if (!acadField.value) {
        acadField.value = slug;
        const emailField = document.getElementById('loginId');
        if (emailField) setTimeout(() => emailField.focus(), 100);
      }
    } catch(e) { /* silent */ }
  }
  fzPrefillAcademyFromURL();
  // Re-run after a short delay to override late browser autofill
  setTimeout(fzPrefillAcademyFromURL, 100);
  setTimeout(fzPrefillAcademyFromURL, 500);
  setTimeout(fzPrefillAcademyFromURL, 1500);

  // Run superadmin check immediately on page load (before login completes)
  setTimeout(() => fzCheckSuperadminRedirect(), 1000);

  // PRIMARY: fzReloadStatus() is called directly from the login flow (see login patches above)
  // BACKUP: polling every 15s catches edge cases (admin freezes while customer is already logged in)
  setInterval(() => {
    if (window._currentAcademyId && typeof window._currentAcademyId === 'string') {
      fzLoadStatus();
    }
  }, 15000);

  // Re-check when tab comes back into focus
  window.addEventListener('focus', () => {
    if (window._currentAcademyId) fzLoadStatus();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && window._currentAcademyId) fzLoadStatus();
  });

  // Expose so frozen screen + UI can trigger
  window.fzOpenPlans = fzOpenPlans;
  window.fzClosePlans = fzClosePlans;
  window.fzContactSupport = fzContactSupport;
  window.fzSignOutFromFrozen = fzSignOutFromFrozen;
  window.fzReloadStatus = fzLoadStatus;
  window.fzCallToActivate = fzCallToActivate;
  window.fzSubscribeWhatsApp = fzSubscribeWhatsApp;
  window.fzSelectPlan = fzSelectPlan;
  // Expose frozen screen controls to login flow
  window.fzShowFrozenPublic = fzShowFrozen;
  window._fzSetAcademy = (data) => { _fzAcademy = data; };
  window.fzReloadStatus = fzLoadStatus;  // call this after admin actions if needed
})();
