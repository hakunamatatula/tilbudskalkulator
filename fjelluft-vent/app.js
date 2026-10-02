(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = FV.fmt;
  var clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  var parseNum = function (v) { if (v === null || v === undefined) return null; v = String(v).trim().replace(/\s/g, '').replace(',', '.'); if (v === '') return null; var n = Number(v); return isFinite(n) ? n : null; };
  var nowIso = function () { return new Date().toISOString(); };
  var datoTekst = function (iso) { try { return new Date(iso).toLocaleString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso || ''; } };
  var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } };
  var lsSet = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignorert */ } };

  var STANDARD_INNST = { vmaxHoved: 5, vmaxGren: 3, rmax: 1.0, ruhet: 0.15, standardSystem: '360.01' };
  var TABS = [['oversikt', 'Oversikt'], ['rom', 'Rom og luftmengder'], ['systemer', 'Systemer'], ['kanaler', 'Kanaler og trykkfall'], ['rapport', 'Rapport og eksport'], ['grunnlag', 'Beregningsgrunnlag']];

  var S = {
    mode: 'kobler', side: 'prosjekt', atab: null, session: null, me: null, bedrift: null, bedrifter: [], planer: [], ctx: null, adm: null, versjon: null, konflikt: false,
    canWrite: false, projects: [], pid: null, data: null, tab: lsGet('fv-tab') || 'oversikt',
    sel: null, checked: new Set(), q: '', etasje: 'alle', statusF: 'alle', view: lsGet('fv-view') || 'tabell', planEtasje: null,
    ifc: null, saving: false, dirty: false, saveTimer: null, hurtig: { q: 400, type: 'hoved' }
  };

  function meta() { return S.projects.find(function (p) { return p.id === S.pid; }) || null; }
  function innst() { return Object.assign({}, STANDARD_INNST, (S.data && S.data.innstillinger) || {}); }
  function rom() { return (S.data && S.data.rom) || []; }
  function sortRom(list) {
    return list.slice().sort(function (a, b) { return (a.etasjeKote || 0) - (b.etasjeKote || 0) || String(a.etasje).localeCompare(String(b.etasje), 'nb') || String(a.nummer || '').localeCompare(String(b.nummer || ''), 'nb', { numeric: true }) || String(a.navn).localeCompare(String(b.navn), 'nb'); });
  }
  function emptyData() { return { rom: [], strekninger: [], innstillinger: clone(STANDARD_INNST), ifc: null }; }
  function uid(p) { return (p || 'id') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  // ---------- Innlogging og lagring (Supabase) ----------
  var SB_URL = 'https://hdxadkzycukcjcpaxcsz.supabase.co';
  var SB_KEY = 'sb_publishable_rtx4JdkM_oY5YNchjY8m7g_6nJALa7C';
  var KONTAKT = 'marius@fjelluft.no';
  var sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'fjelluft-vent-auth' } });
  var ROLLE_NAVN = { eier: 'Eier', admin: 'Administrator', prosjekterende: 'Prosjekterende', leser: 'Leser' };
  var ROLLE_HJELP = { eier: 'Full tilgang, administrerer brukere og abonnement', admin: 'Administrerer brukere og alle prosjekter', prosjekterende: 'Oppretter og endrer prosjekter', leser: 'Kan se prosjekter, ikke endre' };
  var META_FELT = ['id', 'bedrift_id', 'navn', 'nummer', 'byggtype', 'adresse', 'ansvarlig', 'kontrollert', 'merknad', 'antall_rom', 'arkivert', 'endret', 'opprettet', 'versjon'];

  function idag() { return new Date().toISOString().slice(0, 10); }
  function ctxBedrift() { return S.bedrifter.find(function (b) { return b.id === S.ctx; }) || S.bedrift; }
  function bedriftKanSkrive(b) { if (!b || b.status !== 'aktiv') return false; if (b.plan === 'prove' && b.prove_til && b.prove_til < idag()) return false; return true; }
  function erAdmin() { return !!S.me && (S.me.superadmin || S.me.rolle === 'eier' || S.me.rolle === 'admin'); }
  function kanSlette() { return !!S.me && S.canWrite && (S.me.superadmin || S.me.rolle === 'eier' || S.me.rolle === 'admin'); }
  function beregnTilgang() {
    var b = ctxBedrift();
    S.canWrite = !!S.me && (S.me.superadmin || ((S.me.rolle === 'eier' || S.me.rolle === 'admin' || S.me.rolle === 'prosjekterende') && bedriftKanSkrive(b)));
  }
  function setSaveState(kind, text) {
    var el = $('#saveState'); if (!el) return;
    el.innerHTML = text ? '<i class="dot ' + kind + '"></i><span>' + esc(text) + '</span>' : '';
  }
  function resetAll() {
    S.me = null; S.bedrift = null; S.bedrifter = []; S.projects = []; S.pid = null; S.data = null; S.ctx = null; S.side = 'prosjekt'; S.adm = null; S.ifc = null; S.dirty = false;
  }

  async function init() {
    renderAll();
    var res = await sb.auth.getSession();
    sb.auth.onAuthStateChange(function (ev, session) {
      S.session = session;
      if (ev === 'SIGNED_OUT') { resetAll(); S.mode = 'login'; renderAll(); }
    });
    S.session = res.data.session;
    if (!S.session) { S.mode = 'login'; renderAll(); return; }
    await lastBruker(false);
  }

  async function login(epost, passord) {
    var r = await sb.auth.signInWithPassword({ email: epost.trim().toLowerCase(), password: passord });
    if (r.error) {
      var m = r.error.message || '';
      if (/invalid login/i.test(m)) return 'Feil e-post eller passord.';
      if (/banned/i.test(m)) return 'Kontoen er deaktivert. Kontakt administratoren i bedriften din.';
      if (/rate|too many/i.test(m)) return 'For mange forsøk. Vent noen minutter og prøv igjen.';
      return 'Innloggingen feilet: ' + m;
    }
    S.session = r.data.session;
    await lastBruker(true);
    return null;
  }
  async function loggUt() { flushSave(); await sb.auth.signOut(); }

  async function lastBruker(nyInnlogging) {
    S.mode = 'kobler'; renderAll();
    var uid0 = S.session.user.id;
    var me = await sb.from('profiler').select('*').eq('id', uid0).maybeSingle();
    if (me.error || !me.data || !me.data.aktiv) { S.mode = 'inaktiv'; renderAll(); return; }
    S.me = me.data;
    var res = await Promise.all([sb.from('bedrifter').select('*').order('navn'), sb.from('planer').select('*').order('sortering')]);
    S.bedrifter = res[0].data || []; S.planer = res[1].data || [];
    S.bedrift = S.bedrifter.find(function (b) { return b.id === S.me.bedrift_id; }) || null;
    var lagretCtx = lsGet('fv-ctx');
    S.ctx = S.me.superadmin && lagretCtx && S.bedrifter.some(function (b) { return b.id === lagretCtx; }) ? lagretCtx : S.me.bedrift_id;
    if (nyInnlogging) sb.rpc('registrer_innlogging').then(function () { /* logget */ });
    if (S.me.ma_bytte_passord) { S.mode = 'bytt-passord'; renderAll(); return; }
    S.mode = 'app'; beregnTilgang();
    await lastProsjekter();
  }

  async function lastProsjekter() {
    var r = await sb.from('prosjekter').select(META_FELT.join(',')).eq('bedrift_id', S.ctx).order('endret', { ascending: false });
    if (r.error) toast('Kunne ikke hente prosjektene. Prøv å laste siden på nytt.');
    S.projects = r.data || [];
    if (S.pid && !S.projects.some(function (p) { return p.id === S.pid; })) closeProject();
    if (!S.pid && S.side === 'prosjekt') {
      var aktive = S.projects.filter(function (p) { return !p.arkivert; });
      var last = lsGet('fv-pid'); var p = aktive.find(function (x) { return x.id === last; }) || aktive[0];
      if (p) { await openProject(p.id); return; }
    }
    renderAll();
  }

  function closeProject() { S.pid = null; S.data = null; S.sel = null; S.checked.clear(); S.versjon = null; }

  async function openProject(pid) {
    flushSave();
    S.pid = pid; S.data = null; S.sel = null; S.checked.clear(); S.ifc = null; S.planEtasje = null; S.side = 'prosjekt';
    lsSet('fv-pid', pid); renderAll();
    var r = await sb.from('prosjekter').select('*').eq('id', pid).maybeSingle();
    if (S.pid !== pid) return;
    if (r.error || !r.data) { toast('Kunne ikke åpne prosjektet.'); S.pid = null; renderAll(); return; }
    S.versjon = r.data.versjon;
    S.data = Object.assign(emptyData(), r.data.data || {}); normalize();
    oppdaterMetaFraRad(r.data); renderAll();
  }
  function oppdaterMetaFraRad(row) {
    var m = {}; META_FELT.forEach(function (k) { if (k in row) m[k] = row[k]; });
    var i = S.projects.findIndex(function (p) { return p.id === row.id; });
    if (i >= 0) S.projects[i] = Object.assign({}, S.projects[i], m); else S.projects.unshift(m);
  }
  function normalize() { if (!S.data.rom) S.data.rom = []; if (!S.data.strekninger) S.data.strekninger = []; S.data.innstillinger = Object.assign({}, STANDARD_INNST, S.data.innstillinger || {}); }

  function changed() {
    if (!S.canWrite) return;
    S.dirty = true; setSaveState('busy', 'Ulagrede endringer');
    clearTimeout(S.saveTimer); S.saveTimer = setTimeout(doSave, 800);
  }
  function flushSave() { if (S.dirty) { clearTimeout(S.saveTimer); doSave(); } }
  async function doSave(overstyr) {
    if (!S.pid || !S.data) return;
    if (S.saving) { S.saveTimer = setTimeout(doSave, 400); return; }
    S.saving = true; S.dirty = false;
    var pid = S.pid, m = meta() || {};
    var payload = { data: clone(S.data), navn: m.navn || 'Uten navn', nummer: m.nummer || null, byggtype: m.byggtype === 'yrkesbygg' ? 'yrkesbygg' : 'bolig', adresse: m.adresse || null, ansvarlig: m.ansvarlig || null, kontrollert: m.kontrollert || null, merknad: m.merknad || null, arkivert: !!m.arkivert };
    setSaveState('busy', 'Lagrer');
    try {
      var q = sb.from('prosjekter').update(payload).eq('id', pid);
      if (!overstyr) q = q.eq('versjon', S.versjon);
      var r = await q.select('id,versjon,endret,antall_rom');
      if (r.error) throw r.error;
      if (!r.data || !r.data.length) {
        if (!S.canWrite) return;
        var finnes = await sb.from('prosjekter').select('versjon').eq('id', pid).maybeSingle();
        if (finnes.data) { konflikt(); return; }
        S.canWrite = false; setSaveState('off', 'Kun lesetilgang'); renderAll(); toast('Du har ikke lenger tilgang til å endre dette prosjektet.'); return;
      }
      if (S.pid === pid) S.versjon = r.data[0].versjon;
      oppdaterMetaFraRad(r.data[0]);
      setSaveState('', 'Lagret ' + new Date().toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }));
      renderHeader();
    } catch (e) {
      S.dirty = true; setSaveState('err', 'Ikke lagret. Prøver igjen');
      clearTimeout(S.saveTimer); S.saveTimer = setTimeout(doSave, 4000);
    } finally { S.saving = false; if (S.dirty && !S.konflikt) { clearTimeout(S.saveTimer); S.saveTimer = setTimeout(doSave, 800); } }
  }
  function konflikt() {
    S.konflikt = true; setSaveState('err', 'Ikke lagret');
    modal('<h2>Noen andre har endret prosjektet</h2><p>Prosjektet er lagret av en annen bruker etter at du åpnet det. Velg hva som skal skje med endringene dine.</p><div class="modal-actions"><button class="btn" type="button" data-act="konflikt-last">Hent siste versjon (mine endringer forkastes)</button><button class="btn primary" type="button" data-act="konflikt-overskriv">Behold mine endringer</button></div>');
  }

  async function saveMeta(pid, m) {
    var i = S.projects.findIndex(function (p) { return p.id === pid; });
    if (i >= 0) S.projects[i] = Object.assign({}, S.projects[i], m);
    if (pid === S.pid) changed();
  }

  async function createProject(m, data) {
    if (!S.canWrite) return;
    var d = data ? Object.assign(emptyData(), clone(data)) : emptyData();
    var row = { bedrift_id: S.ctx, navn: m.navn, nummer: m.nummer || null, byggtype: m.byggtype === 'yrkesbygg' ? 'yrkesbygg' : 'bolig', adresse: m.adresse || null, ansvarlig: m.ansvarlig || null, kontrollert: m.kontrollert || null, merknad: m.merknad || null, data: d };
    var r = await sb.from('prosjekter').insert(row).select(META_FELT.join(',')).single();
    if (r.error) { toast('Kunne ikke opprette prosjektet. ' + (/row-level/.test(r.error.message) ? 'Du mangler tilgang.' : r.error.message)); return; }
    S.projects.unshift(r.data); await openProject(r.data.id); toast('Prosjektet er opprettet');
  }
  async function deleteProject(pid) {
    var r = await sb.from('prosjekter').delete().eq('id', pid).select('id');
    if (r.error || !r.data || !r.data.length) { toast('Kunne ikke slette prosjektet. Bare eier og administrator kan slette.'); return; }
    S.projects = S.projects.filter(function (p) { return p.id !== pid; }); closeProject(); lsSet('fv-pid', '');
    await lastProsjekter(); toast('Prosjektet er slettet');
  }
  async function settArkivert(pid, verdi) {
    flushSave();
    var r = await sb.from('prosjekter').update({ arkivert: verdi }).eq('id', pid).select('id,versjon,arkivert,endret');
    if (r.error || !r.data || !r.data.length) { toast('Kunne ikke endre prosjektet.'); return; }
    if (pid === S.pid) S.versjon = r.data[0].versjon;
    oppdaterMetaFraRad(r.data[0]); renderAll(); toast(verdi ? 'Prosjektet er arkivert' : 'Prosjektet er hentet fram igjen');
  }
  function logg(handling, objekt, detaljer) { sb.rpc('logg_hendelse', { p_handling: handling, p_objekt: objekt || null, p_objekt_id: S.pid || null, p_detaljer: detaljer || null }).then(function () { /* logget */ }); }

  async function adminKall(body) {
    var r = await sb.functions.invoke('vent-admin', { body: body });
    if (r.error) {
      var msg = 'Noe gikk galt. Prøv igjen.';
      try { var j = await r.error.context.json(); if (j && j.feil) msg = j.feil; } catch (e) { /* ingen detaljer */ }
      throw new Error(msg);
    }
    return r.data;
  }

  // ---------- Hjelpere for UI ----------
  function toast(msg) {
    var r = $('#toastRoot'); r.innerHTML = '<div class="toast" role="status">' + esc(msg) + '</div>';
    clearTimeout(toast.t); toast.t = setTimeout(function () { r.innerHTML = ''; }, 3600);
  }
  function modal(html, onBind) {
    var root = $('#modalRoot');
    root.innerHTML = '<div class="modal-bg" data-act="modal-bg"><div class="modal" role="dialog" aria-modal="true">' + html + '</div></div>';
    var first = root.querySelector('input,select,button.primary'); if (first) setTimeout(function () { first.focus(); }, 20);
    if (onBind) onBind(root.querySelector('.modal'));
  }
  function closeModal() { $('#modalRoot').innerHTML = ''; }
  function dis() { return S.canWrite ? '' : ' disabled'; }

  function saveFile(filename, data) {
    try {
      var blob = data instanceof Blob ? data : new Blob([data], { type: /\.csv$/.test(filename) ? 'text/csv;charset=utf-8' : /\.html$/.test(filename) ? 'text/html;charset=utf-8' : 'application/json' });
      var url = URL.createObjectURL(blob); var a = document.createElement('a');
      a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      toast('Lastet ned: ' + filename); return true;
    } catch (e) { toast('Kunne ikke lage filen.'); return false; }
  }
  function safeName(s) { return String(s || 'prosjekt').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'prosjekt'; }

  // ---------- Rendering ----------
  function renderAll() { renderHeader(); renderTabs(); renderMain(); }
  function renderHeader() {
    var app = S.mode === 'app';
    $('#projBox').hidden = !app || S.side !== 'prosjekt';
    $('#userBox').hidden = !(app || S.mode === 'bytt-passord');
    var ctxBox = $('#ctxBox'); ctxBox.hidden = !app || !S.me || !S.me.superadmin || S.side === 'admin';
    if (!app) { if (S.mode === 'bytt-passord') $('#userBox').innerHTML = '<button class="btn sm ghost" type="button" data-act="logg-ut">Logg ut</button>'; return; }
    var sel = $('#projSel');
    var aktive = S.projects.filter(function (p) { return !p.arkivert; }), ark = S.projects.filter(function (p) { return p.arkivert; });
    var opt = function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === S.pid ? ' selected' : '') + '>' + esc((p.nummer ? p.nummer + ' ' : '') + p.navn) + '</option>'; };
    if (!S.projects.length) { sel.innerHTML = '<option value="">Ingen prosjekter ennå</option>'; sel.disabled = true; }
    else { sel.disabled = false; sel.innerHTML = (S.pid ? '' : '<option value="">Velg prosjekt</option>') + aktive.map(opt).join('') + (ark.length ? '<optgroup label="Arkivert">' + ark.map(opt).join('') + '</optgroup>' : ''); }
    $('#newProjBtn').disabled = !S.canWrite;
    if (S.me && S.me.superadmin) ctxBox.innerHTML = '<select id="ctxSel" aria-label="Bedrift" title="Bedriften du ser prosjektene til">' + S.bedrifter.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === S.ctx ? ' selected' : '') + '>' + esc(b.navn) + '</option>'; }).join('') + '</select>';
    var navn = (S.me && (S.me.navn || S.me.epost)) || '';
    $('#userBox').innerHTML = (erAdmin() ? '<button class="btn sm' + (S.side === 'admin' ? ' primary' : '') + '" type="button" data-act="side" data-side="' + (S.side === 'admin' ? 'prosjekt' : 'admin') + '">' + (S.side === 'admin' ? 'Til prosjektene' : 'Administrasjon') + '</button>' : (S.side !== 'prosjekt' ? '<button class="btn sm" type="button" data-act="side" data-side="prosjekt">Til prosjektene</button>' : '')) +
      '<button class="btn sm ghost user" type="button" data-act="side" data-side="profil" title="Min profil"><span class="avatar">' + esc(initialer(navn)) + '</span><span class="uname">' + esc(navn) + '<small>' + esc(S.bedrift ? S.bedrift.navn : '') + '</small></span></button>';
  }
  function initialer(n) { var p = String(n || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean); return ((p[0] || '?')[0] + (p[1] ? p[1][0] : '')).toUpperCase(); }
  function renderTabs() {
    var nav = $('#tabs');
    if (S.mode !== 'app') { nav.innerHTML = ''; return; }
    if (S.side === 'admin') {
      nav.innerHTML = adminTabs().map(function (t) { return '<button role="tab" type="button" data-atab="' + t[0] + '" aria-selected="' + (S.atab === t[0]) + '">' + t[1] + '</button>'; }).join('');
      return;
    }
    if (S.side !== 'prosjekt' || !S.pid) { nav.innerHTML = ''; return; }
    var avvik = rom().filter(function (r) { return FV.romStatus(r).status !== 'ok'; }).length;
    nav.innerHTML = TABS.map(function (t) {
      var extra = t[0] === 'rom' ? '<span class="count' + (avvik ? ' bad' : '') + '">' + (avvik ? avvik + ' avvik' : rom().length) + '</span>' : '';
      return '<button role="tab" type="button" data-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] + extra + '</button>';
    }).join('');
  }
  function statusBanner() {
    var b = ctxBedrift(); if (!b || !S.me) return '';
    var h = '';
    if (S.me.superadmin && b.id !== S.me.bedrift_id && S.side === 'prosjekt') h += '<div class="banner info">Du ser prosjektene til <b>' + esc(b.navn) + '</b> som Fjelluft-administrator. Endringer du gjør lagres i deres prosjekter.</div>';
    if (b.status === 'sperret') h += '<div class="banner">Abonnementet til ' + esc(b.navn) + ' er sperret. Prosjektene kan leses, men ikke endres. Kontakt ' + KONTAKT + '.</div>';
    else if (b.status === 'avsluttet') h += '<div class="banner">Abonnementet til ' + esc(b.navn) + ' er avsluttet. Prosjektene kan leses og lastes ned.</div>';
    else if (b.plan === 'prove' && b.prove_til) {
      var dager = Math.ceil((new Date(b.prove_til + 'T23:59:59') - new Date()) / 86400000);
      if (dager < 0) h += '<div class="banner">Prøveperioden gikk ut ' + esc(datoKort(b.prove_til)) + '. Prosjektene kan leses, men ikke endres. Kontakt ' + KONTAKT + ' for å fortsette.</div>';
      else h += '<div class="banner info">Prøveperiode: ' + dager + ' ' + (dager === 1 ? 'dag' : 'dager') + ' igjen (til ' + esc(datoKort(b.prove_til)) + '). Kontakt ' + KONTAKT + ' for å bestille abonnement.</div>';
    }
    if (!S.me.superadmin && S.me.rolle === 'leser' && S.side === 'prosjekt') h += '<div class="banner info">Du har lesetilgang. Be administratoren i bedriften om rollen Prosjekterende for å kunne endre.</div>';
    var m = meta();
    if (S.side === 'prosjekt' && m && m.arkivert) h += '<div class="banner">Prosjektet er arkivert. <button class="btn sm" type="button" data-act="unarchive"' + dis() + '>Hent fram</button></div>';
    return h;
  }
  function prosjektKnapper(m) {
    return '<div class="row" style="gap:4px">' + (S.canWrite ? '<button class="btn sm ghost" type="button" data-act="' + (m.arkivert ? 'unarchive' : 'archive') + '">' + (m.arkivert ? 'Hent fram' : 'Arkiver') + '</button>' : '') + (kanSlette() ? '<button class="btn sm ghost danger" type="button" data-act="delete-project">Slett prosjekt</button>' : '') + '</div>';
  }
  function datoKort(d) { try { return new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric' }); } catch (e) { return d; } }
  function renderMain() {
    var main = $('#main');
    var active = document.activeElement && document.activeElement.id && main.contains(document.activeElement) ? document.activeElement.id : null;
    var scroll = window.scrollY;
    var html = '';
    if (S.mode === 'kobler') html = '<div class="panel muted">Laster…</div>';
    else if (S.mode === 'login') html = renderLogin();
    else if (S.mode === 'bytt-passord') html = renderByttPassord(true);
    else if (S.mode === 'inaktiv') html = '<section class="panel empty"><h2>Kontoen er ikke aktiv</h2><p class="muted">Brukeren din er deaktivert eller ikke koblet til en bedrift. Kontakt administratoren i bedriften din, eller ' + KONTAKT + '.</p><div><button class="btn" type="button" data-act="logg-ut">Logg ut</button></div></section>';
    else {
      html += statusBanner();
      if (S.side === 'admin') html += renderAdmin();
      else if (S.side === 'profil') html += renderProfil();
      else if (!S.pid) html += renderEmpty();
      else if (!S.data) html += '<div class="panel muted">Henter prosjektet…</div>';
      else {
        var fn = { oversikt: renderOversikt, rom: renderRom, systemer: renderSystemer, kanaler: renderKanaler, rapport: renderRapport, grunnlag: renderGrunnlag }[S.tab] || renderOversikt;
        html += fn();
      }
    }
    main.innerHTML = html;
    if (active) { var el = document.getElementById(active); if (el) { el.focus(); if (el.select && el.type !== 'select-one') try { el.select(); } catch (e) { /* ikke støttet */ } } }
    window.scrollTo(0, scroll);
  }
  function later(fn) { setTimeout(fn, 0); }
  function bindPlan() { /* klikk håndteres via delegering */ }

  // ---------- Innlogging og profil ----------
  function renderLogin() {
    return '<div class="login">' +
      '<section class="login-pitch"><h1>Prosjekter ventilasjon fra arkitektens IFC</h1><p>Fjelluft Vent leser rommene i arkitektmodellen, beregner luftmengder etter TEK17, dimensjonerer kanaler og lager romskjema, beregningsrapport og IFC med luftmengder tilbake til BIM-koordineringen.</p><ul><li>Ingen installasjon, kjører i nettleseren</li><li>Åpent IFC-format inn og ut</li><li>Beregninger med kilde og forklaring for hvert rom</li></ul><p class="muted small">Vil bedriften din prøve? Kontakt ' + KONTAKT + '.</p></section>' +
      '<section class="panel login-box"><h2>Logg inn</h2><form id="loginForm" novalidate class="stack">' +
      '<label class="f"><span>E-post</span><input type="email" id="li-epost" autocomplete="username" required></label>' +
      '<label class="f"><span>Passord</span><input type="password" id="li-pass" autocomplete="current-password" required></label>' +
      '<p class="small" id="li-err" role="alert" hidden style="color:var(--crit);margin:0"></p>' +
      '<button class="btn primary" type="submit" id="li-btn">Logg inn</button>' +
      '<p class="small muted" style="margin:0">Glemt passordet? Be administratoren i bedriften din om å nullstille det, eller kontakt ' + KONTAKT + '.</p></form></section></div>';
  }
  function renderByttPassord(tvunget) {
    return '<section class="panel" style="max-width:480px;justify-self:center;width:100%"><h2>' + (tvunget ? 'Velg ditt eget passord' : 'Bytt passord') + '</h2>' + (tvunget ? '<p class="muted small">Du logget inn med et midlertidig passord. Velg et nytt før du fortsetter.</p>' : '') +
      '<form id="pwForm" novalidate class="stack"><label class="f"><span>Nytt passord (minst 10 tegn)</span><input type="password" id="pw1" autocomplete="new-password" minlength="10" required></label>' +
      '<label class="f"><span>Gjenta nytt passord</span><input type="password" id="pw2" autocomplete="new-password" required></label>' +
      '<p class="small" id="pw-err" role="alert" hidden style="color:var(--crit);margin:0"></p><div><button class="btn primary" type="submit">Lagre passord</button></div></form></section>';
  }
  function renderProfil() {
    var me = S.me || {};
    return '<div class="grid2" style="align-items:start"><section class="panel"><h3>Min profil</h3><div class="stack" style="margin-top:10px">' +
      '<label class="f"><span>Navn</span><input type="text" id="pf-navn" value="' + esc(me.navn || '') + '"></label>' +
      '<dl class="kv"><dt>E-post</dt><dd>' + esc(me.epost) + '</dd><dt>Bedrift</dt><dd>' + esc(S.bedrift ? S.bedrift.navn : '') + '</dd><dt>Rolle</dt><dd>' + esc(ROLLE_NAVN[me.rolle] || me.rolle) + (me.superadmin ? ', Fjelluft-administrator' : '') + '</dd></dl>' +
      '<div class="row"><button class="btn" type="button" data-act="lagre-navn">Lagre navn</button><button class="btn ghost danger" type="button" data-act="logg-ut">Logg ut</button></div></div></section>' +
      renderByttPassord(false) + '</div>';
  }

  // ---------- Tomtilstand ----------
  function renderEmpty() {
    var b = ctxBedrift();
    return '<section class="panel empty">' +
      '<h2>' + (S.projects.length ? 'Velg et prosjekt' : 'Velkommen til Fjelluft Vent') + '</h2>' +
      '<p class="muted">Prosjektene til ' + esc(b ? b.navn : 'bedriften') + ' ligger her og deles med alle i bedriften.</p>' +
      '<ol class="steps"><li>Opprett et prosjekt.</li><li>Last inn arkitektens IFC-fil. Rommene hentes automatisk med areal og etasje.</li><li>Kontroller romtyper, personer og senger. Luftmengdene regnes ut fortløpende.</li><li>Dimensjoner kanalene og eksporter rapport og IFC.</li></ol>' +
      '<div class="row"><button class="btn primary" type="button" data-act="new-project"' + dis() + '>+ Nytt prosjekt</button><button class="btn" type="button" data-act="import-json"' + dis() + '>Åpne prosjektfil (.json)</button></div>' +
      '</section>';
  }

  // ---------- Oversikt ----------
  function issues() {
    return sortRom(rom()).map(function (r) { return { r: r, st: FV.romStatus(r) }; }).filter(function (x) { return x.st.status !== 'ok' || x.r.fjernet; });
  }
  function kpis() {
    var list = rom(), A = 0, T = 0, Av = 0, F = 0;
    list.forEach(function (r) { var st = FV.romStatus(r); A += Number(r.areal) || 0; T += st.tilluft; Av += st.avtrekk; F += st.krav.forsert !== null ? Math.max(st.krav.forsert, st.avtrekk) : st.avtrekk; });
    return { n: list.length, A: A, T: T, Av: Av, F: F, avvik: issues().length };
  }
  function renderOversikt() {
    var m = meta() || {}, k = kpis(), iss = issues(), sum = FV.oppsummer(rom(), m.byggtype), d = S.data;
    var html = '<div class="kpis">' +
      kpi('Rom', fmt(k.n), '') + kpi('Areal', fmt(k.A, 1), 'm²') + kpi('Tilluft', fmt(k.T), 'm³/h', 't') + kpi('Avtrekk', fmt(k.Av), 'm³/h', 'a') + kpi('Forsert avtrekk', fmt(k.F), 'm³/h', 'a') + kpi('Avvik', fmt(k.avvik), '') + '</div>';
    html += '<div class="grid2" style="align-items:start">';
    // Prosjektinfo
    html += '<section class="panel"><div class="panel-h"><h3>Prosjekt</h3>' + prosjektKnapper(m) + '</div><div class="grid2">' +
      fld('Prosjektnavn', 'navn', m.navn) + fld('Prosjektnummer', 'nummer', m.nummer) + fld('Adresse', 'adresse', m.adresse) +
      '<label class="f"><span>Byggtype</span><select id="m-byggtype" data-meta="byggtype"' + dis() + '><option value="bolig"' + (m.byggtype !== 'yrkesbygg' ? ' selected' : '') + '>Bolig (TEK17 § 13-2)</option><option value="yrkesbygg"' + (m.byggtype === 'yrkesbygg' ? ' selected' : '') + '>Yrkesbygg / publikumsbygg (§ 13-3)</option></select></label>' +
      fld('Ansvarlig prosjekterende', 'ansvarlig', m.ansvarlig) + fld('Kontrollert av', 'kontrollert', m.kontrollert) +
      '</div><label class="f" style="margin-top:12px"><span>Merknader</span><textarea id="m-merknad" data-meta="merknad"' + dis() + '>' + esc(m.merknad) + '</textarea></label></section>';
    // IFC
    html += '<section class="panel"><div class="panel-h"><h3>Arkitektmodell (IFC)</h3>' + (d.ifc ? '<span class="tag">' + esc(d.ifc.skjema) + '</span>' : '') + '</div>';
    if (d.ifc) html += '<dl class="small" style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0 0 12px"><dt class="muted">Fil</dt><dd style="margin:0;overflow-wrap:anywhere">' + esc(d.ifc.filnavn) + '</dd><dt class="muted">Lest inn</dt><dd style="margin:0">' + esc(datoTekst(d.ifc.lest)) + '</dd><dt class="muted">Rom i modellen</dt><dd style="margin:0">' + fmt(d.ifc.antallRom) + ' fordelt på ' + fmt((d.ifc.etasjer || []).length) + ' etasjer</dd>' + (S.ifc ? '<dt class="muted">Status</dt><dd style="margin:0">Filen er åpen i denne økten og klar for IFC-eksport</dd>' : '') + '</dl>';
    html += '<div class="drop" id="dropZone"><div><b>' + (d.ifc ? 'Last inn ny versjon av modellen' : 'Slipp arkitektens IFC-fil her') + '</b></div><div class="small muted">' + (d.ifc ? 'Rommene oppdateres. Romtyper og luftmengder du har lagt inn beholdes.' : 'IFC2x3, IFC4 og IFC4x3 fra Revit, ArchiCAD og andre program') + '</div><button class="btn' + (d.ifc ? '' : ' primary') + '" type="button" data-act="pick-ifc"' + dis() + '>Velg IFC-fil</button><div class="progress" id="ifcProg" hidden style="width:100%"><i></i></div></div>';
    html += '<p class="small muted" style="margin:10px 0 0">Filen leses i nettleseren. Selve modellfilen lagres ikke, bare rommene som hentes ut.</p></section>';
    html += '</div>';
    // Avvik + boenheter
    html += '<div class="grid2" style="align-items:start">';
    html += '<section class="panel"><div class="panel-h"><h3>Må følges opp</h3><span class="tag">' + iss.length + '</span></div>';
    if (!rom().length) html += '<p class="muted small">Ingen rom ennå. Last inn en IFC-fil eller legg til rom manuelt under Rom og luftmengder.</p>';
    else if (!iss.length) html += '<p class="small"><span class="pill ok">Alle rom oppfyller kravene</span></p>';
    else html += '<ul class="issues">' + iss.slice(0, 14).map(function (x) { return '<li><span class="pill ' + (x.r.fjernet ? 'mangler' : x.st.status) + '">' + (x.r.fjernet ? 'Ikke i modellen' : x.st.status === 'under' ? 'Under krav' : 'Mangler') + '</span><span>' + esc((x.r.nummer ? x.r.nummer + ' ' : '') + x.r.navn) + ' <span class="muted">' + esc(x.r.fjernet ? 'Rommet finnes ikke i siste modell' : x.st.melding) + '</span></span><button type="button" data-act="goto-room" data-id="' + esc(x.r.id) + '">Vis</button></li>'; }).join('') + (iss.length > 14 ? '<li class="muted">og ' + (iss.length - 14) + ' til</li>' : '') + '</ul>';
    html += '</section>';
    if (m.byggtype !== 'yrkesbygg') {
      html += '<section class="panel"><h3>Kontroll per boenhet</h3><p class="small muted" style="margin:6px 0 10px">Snitt tilluft for boenheten skal være minst 1,2 m³/h per m² (TEK17 § 13-2). Tilluft og avtrekk bør være i balanse.</p>';
      html += sum.boenheter.length ? '<div class="tablewrap"><table><thead><tr><th>Boenhet</th><th class="n">Areal</th><th class="n">Krav snitt</th><th class="n t">Tilluft</th><th class="n a">Avtrekk</th><th class="n">Balanse</th><th>Status</th><th></th></tr></thead><tbody>' + sum.boenheter.map(function (b) { return '<tr><td>' + esc(b.boenhet) + '</td><td class="n">' + fmt(b.areal, 1) + '</td><td class="n">' + fmt(b.kravSnitt, 0) + '</td><td class="n t">' + fmt(b.tilluft) + '</td><td class="n a">' + fmt(b.avtrekk) + '</td><td class="n">' + (b.balanse > 0 ? '+' : '') + fmt(b.balanse) + '</td><td>' + (b.ok ? '<span class="pill ok">OK</span>' : '<span class="pill under">For lite tilluft</span>') + (Math.abs(b.balanse) > 5 ? ' <span class="pill mangler">Ubalanse</span>' : '') + '</td><td>' + (!b.ok || Math.abs(b.balanse) > 5 ? '<button class="btn sm" type="button" data-act="balanser" data-b="' + esc(b.boenhet) + '"' + dis() + '>Balanser</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div><p class="small muted" style="margin:8px 0 0">Balanser løfter tilluften i stue og soverom til kravet for boenheten, og fordeler avtrekket på kjøkken, bad, toalett og vaskerom slik at tilluft og avtrekk blir like. Verdiene legges inn som prosjektert luftmengde og kan justeres etterpå.</p>' : '<p class="muted small">Ingen rom ennå.</p>';
      html += '</section>';
    } else {
      html += '<section class="panel"><h3>Systemer</h3>' + systemTable(sum.systemer) + '</section>';
    }
    html += '</div>';
    return html;
  }
  function kpi(l, v, unit, cls) { return '<div class="kpi ' + (cls || '') + '"><span class="l">' + l + '</span><span class="v">' + v + (unit ? '<small>' + unit + '</small>' : '') + '</span></div>'; }
  function fld(label, key, val) { return '<label class="f"><span>' + label + '</span><input type="text" id="m-' + key + '" data-meta="' + key + '" value="' + esc(val) + '"' + dis() + '></label>'; }

  // ---------- Rom ----------
  function typeOptions(sel) {
    var groups = {}; FV.ROMTYPER.forEach(function (t) { (groups[t.gruppe] = groups[t.gruppe] || []).push(t); });
    return Object.keys(groups).map(function (g) { return '<optgroup label="' + g + '">' + groups[g].map(function (t) { return '<option value="' + t.id + '"' + (t.id === sel ? ' selected' : '') + '>' + esc(t.navn) + '</option>'; }).join('') + '</optgroup>'; }).join('');
  }
  function filteredRom() {
    var q = S.q.trim().toLowerCase();
    return sortRom(rom()).filter(function (r) {
      if (S.etasje !== 'alle' && r.etasje !== S.etasje) return false;
      if (q && (String(r.nummer) + ' ' + r.navn + ' ' + (r.system || '')).toLowerCase().indexOf(q) < 0) return false;
      if (S.statusF === 'avvik' && FV.romStatus(r).status === 'ok' && !r.fjernet) return false;
      return true;
    });
  }
  function etasjer() { var seen = {}, out = []; sortRom(rom()).forEach(function (r) { if (!seen[r.etasje]) { seen[r.etasje] = 1; out.push(r.etasje); } }); return out; }

  function renderRom() {
    var m = meta() || {}, bolig = m.byggtype !== 'yrkesbygg';
    var list = filteredRom(), et = etasjer();
    var html = '<div class="toolbar">' +
      '<input type="search" id="romSok" placeholder="Søk på romnummer, navn eller system" value="' + esc(S.q) + '" aria-label="Søk i rom">' +
      '<select id="etasjeF" aria-label="Etasje"><option value="alle">Alle etasjer</option>' + et.map(function (e) { return '<option' + (S.etasje === e ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('') + '</select>' +
      '<select id="statusF" aria-label="Status"><option value="alle">Alle rom</option><option value="avvik"' + (S.statusF === 'avvik' ? ' selected' : '') + '>Bare avvik</option></select>' +
      '<div class="seg" role="group" aria-label="Visning"><button type="button" data-act="view" data-v="tabell" aria-pressed="' + (S.view === 'tabell') + '">Tabell</button><button type="button" data-act="view" data-v="plan" aria-pressed="' + (S.view === 'plan') + '">Plantegning</button></div>' +
      '<span style="flex:1"></span><button class="btn" type="button" data-act="add-room"' + dis() + '>+ Legg til rom</button></div>';
    if (S.checked.size && S.canWrite) {
      html += '<div class="bulk"><b>' + S.checked.size + ' rom valgt</b><select id="bulkType"><option value="">Sett romtype…</option>' + typeOptions('') + '</select>' +
        '<input type="text" id="bulkSystem" placeholder="System, f.eks. 360.01" class="w-m">' + (bolig ? '<input type="text" id="bulkBoenhet" placeholder="Boenhet" class="w-m">' : '') +
        '<button class="btn sm primary" type="button" data-act="bulk-apply">Bruk på valgte</button><button class="btn sm ghost" type="button" data-act="bulk-clear">Fjern valg</button><button class="btn sm ghost danger" type="button" data-act="bulk-delete">Slett valgte</button></div>';
    }
    html += '<div class="split"><div style="min-width:0;display:grid;gap:12px">';
    if (!rom().length) {
      html += '<div class="panel empty"><h3>Ingen rom ennå</h3><p class="muted">Last inn arkitektens IFC-fil under Oversikt, eller legg til rom manuelt.</p><div class="row"><button class="btn primary" type="button" data-act="pick-ifc"' + dis() + '>Velg IFC-fil</button><button class="btn" type="button" data-act="add-room"' + dis() + '>+ Legg til rom</button></div></div>';
    } else if (S.view === 'plan') {
      html += renderPlan();
    } else {
      var allChecked = list.length && list.every(function (r) { return S.checked.has(r.id); });
      html += '<div class="tablewrap"><table><thead><tr><th><input type="checkbox" id="chkAll" aria-label="Velg alle"' + (allChecked ? ' checked' : '') + dis() + '></th><th>Nr</th><th>Romnavn</th><th>Etasje</th><th class="n">Areal m²</th><th>Romtype</th><th class="n">Pers. / senger</th><th>System</th>' + (bolig ? '<th>Boenhet</th>' : '') + '<th class="n t">Krav T</th><th class="n a">Krav A</th><th class="n t">Prosj. T</th><th class="n a">Prosj. A</th><th>Status</th></tr></thead><tbody>';
      var T = 0, A = 0, AR = 0;
      list.forEach(function (r) {
        var st = FV.romStatus(r), k = st.krav; T += st.tilluft; A += st.avtrekk; AR += Number(r.areal) || 0;
        var pp = k.regel === 'person' ? '<input type="text" inputmode="decimal" class="n w-s" id="r-' + r.id + '-personer" data-id="' + esc(r.id) + '" data-f="personer" value="' + esc(r.personer === null || r.personer === undefined ? '' : r.personer) + '" placeholder="' + k.personer + '" title="Antall personer"' + dis() + '>'
          : k.regel === 'seng' ? '<input type="text" inputmode="decimal" class="n w-s" id="r-' + r.id + '-senger" data-id="' + esc(r.id) + '" data-f="senger" value="' + esc(r.senger === null || r.senger === undefined ? '' : r.senger) + '" placeholder="' + k.senger + '" title="Antall senger"' + dis() + '>' : '<span class="muted">–</span>';
        html += '<tr data-row="' + esc(r.id) + '" class="' + (S.sel === r.id ? 'sel' : '') + (r.fjernet ? ' gone' : '') + '">' +
          '<td><input type="checkbox" data-chk="' + esc(r.id) + '" aria-label="Velg rom"' + (S.checked.has(r.id) ? ' checked' : '') + dis() + '></td>' +
          '<td><input type="text" class="w-s" id="r-' + r.id + '-nummer" data-id="' + esc(r.id) + '" data-f="nummer" value="' + esc(r.nummer) + '"' + dis() + '></td>' +
          '<td><input type="text" class="w-l" id="r-' + r.id + '-navn" data-id="' + esc(r.id) + '" data-f="navn" value="' + esc(r.navn) + '"' + dis() + '></td>' +
          '<td class="small">' + esc(r.etasje) + '</td>' +
          '<td class="n"><input type="text" inputmode="decimal" class="n" id="r-' + r.id + '-areal" data-id="' + esc(r.id) + '" data-f="areal" value="' + (r.areal === null || r.areal === undefined ? '' : String(r.areal).replace('.', ',')) + '" title="' + esc(r.arealKilde || '') + '"' + dis() + '></td>' +
          '<td><select id="r-' + r.id + '-type" data-id="' + esc(r.id) + '" data-f="type"' + dis() + '>' + typeOptions(r.type) + '</select></td>' +
          '<td class="n">' + pp + '</td>' +
          '<td><input type="text" class="w-m" id="r-' + r.id + '-system" data-id="' + esc(r.id) + '" data-f="system" value="' + esc(r.system || '') + '"' + dis() + '></td>' +
          (bolig ? '<td><input type="text" class="w-m" id="r-' + r.id + '-boenhet" data-id="' + esc(r.id) + '" data-f="boenhet" value="' + esc(r.boenhet || '') + '"' + dis() + '></td>' : '') +
          '<td class="n t">' + (k.tilluft ? fmt(k.tilluft, 0) : '–') + '</td><td class="n a">' + (k.avtrekk ? fmt(k.avtrekk, 0) : '–') + '</td>' +
          '<td class="n"><input type="text" inputmode="decimal" class="n" id="r-' + r.id + '-tilluftProsj" data-id="' + esc(r.id) + '" data-f="tilluftProsj" value="' + esc(r.tilluftProsj === null || r.tilluftProsj === undefined ? '' : r.tilluftProsj) + '" placeholder="' + fmt(st.tilluft) + '"' + dis() + '></td>' +
          '<td class="n"><input type="text" inputmode="decimal" class="n" id="r-' + r.id + '-avtrekkProsj" data-id="' + esc(r.id) + '" data-f="avtrekkProsj" value="' + esc(r.avtrekkProsj === null || r.avtrekkProsj === undefined ? '' : r.avtrekkProsj) + '" placeholder="' + fmt(st.avtrekk) + '"' + dis() + '></td>' +
          '<td>' + statusPill(st, r) + '</td></tr>';
      });
      html += '<tr class="sum"><td></td><td colspan="3">Sum (' + list.length + ' rom)</td><td class="n">' + fmt(AR, 1) + '</td><td colspan="' + (bolig ? 5 : 4) + '"></td><td></td><td class="n t">' + fmt(T) + '</td><td class="n a">' + fmt(A) + '</td><td></td></tr>';
      html += '</tbody></table></div><p class="small muted" style="margin:0">Prosjektert luftmengde settes automatisk til kravet rundet opp til nærmeste 5 m³/h. Skriv inn en annen verdi for å overstyre. Tomt felt gir automatisk verdi.</p>';
    }
    html += '</div><aside class="detail' + (findRoom(S.sel) ? '' : ' none') + '">' + renderDetail() + '</aside></div>';
    return html;
  }
  function statusPill(st, r) {
    if (r && r.fjernet) return '<span class="pill mangler" title="Rommet finnes ikke i siste versjon av modellen">Ikke i modellen</span>';
    if (st.status === 'ok') return '<span class="pill ok">OK</span>';
    return '<span class="pill ' + st.status + '" title="' + esc(st.melding) + '">' + (st.status === 'under' ? 'Under krav' : 'Mangler') + '</span>';
  }
  function renderDetail() {
    var r = rom().find(function (x) { return x.id === S.sel; });
    if (!r) return '<section class="panel"><h3>Romdetaljer</h3><p class="small muted">Velg et rom i tabellen eller plantegningen for å se beregningen, kilden til arealet og merknader.</p><p class="small muted">Farger: <span class="pill ok">OK</span> <span class="pill under">Under krav</span> <span class="pill mangler">Mangler data</span></p></section>';
    var st = FV.romStatus(r), k = st.krav, t = FV.TYPE_BY_ID[r.type] || FV.TYPE_BY_ID.annet;
    return '<section class="panel"><div class="panel-h"><h3>' + esc((r.nummer ? r.nummer + ' ' : '') + r.navn) + '</h3>' + statusPill(st, r) + '<button class="btn sm ghost x" type="button" data-act="close-detail" aria-label="Lukk romdetaljer">×</button></div>' +
      '<dl><dt>Etasje</dt><dd>' + esc(r.etasje) + '</dd><dt>Romtype</dt><dd>' + esc(t.navn) + '</dd><dt>Areal</dt><dd class="num">' + fmt(r.areal, 2) + ' m²</dd><dt>Arealkilde</dt><dd>' + esc(r.arealKilde || 'Manuelt') + (r.arealGeometri && r.areal && Math.abs(r.arealGeometri - r.areal) > 0.05 ? '<br><span class="muted small">Geometri gir ' + fmt(r.arealGeometri, 2) + ' m²</span>' : '') + '</dd>' + (r.hoyde ? '<dt>Romhøyde</dt><dd class="num">' + fmt(r.hoyde, 2) + ' m</dd><dt>Volum</dt><dd class="num">' + fmt((r.areal || 0) * r.hoyde, 1) + ' m³</dd>' : '') + '</dl>' +
      '<div><div class="small muted" style="margin-bottom:4px">Beregning</div><div class="calc">' + esc(k.forklaring || k.grunnlag) + '</div><div class="small muted" style="margin-top:6px">Grunnlag: ' + esc(k.grunnlag) + '. Kilde: ' + esc(k.kilde) + '.</div></div>' +
      '<dl><dt class="t">Tilluft</dt><dd class="num">krav ' + fmt(k.tilluft, 1) + ', prosjektert ' + fmt(st.tilluft) + ' m³/h</dd><dt class="a">Avtrekk</dt><dd class="num">krav ' + fmt(k.avtrekk, 1) + ', prosjektert ' + fmt(st.avtrekk) + ' m³/h</dd>' + (k.forsert !== null ? '<dt class="a">Forsert</dt><dd class="num">' + fmt(k.forsert) + ' m³/h</dd>' : '') + (k.utenDrift !== null ? '<dt>Utenfor drift</dt><dd class="num">' + fmt(k.utenDrift, 1) + ' m³/h</dd>' : '') + (r.hoyde && r.areal && (st.tilluft || st.avtrekk) ? '<dt>Luftskifte</dt><dd class="num">' + fmt(Math.max(st.tilluft, st.avtrekk) / (r.areal * r.hoyde), 1) + ' h⁻¹</dd>' : '') + '</dl>' +
      '<label class="f"><span>Merknad</span><textarea id="r-' + r.id + '-merknad" data-id="' + esc(r.id) + '" data-f="merknad"' + dis() + '>' + esc(r.merknad || '') + '</textarea></label>' +
      (r.guid ? '<div class="tag" style="overflow-wrap:anywhere">IFC GUID ' + esc(r.guid) + '</div>' : '<div class="tag">Lagt til manuelt</div>') +
      '<div class="row"><button class="btn sm ghost danger" type="button" data-act="delete-room" data-id="' + esc(r.id) + '"' + dis() + '>Slett rom</button></div></section>';
  }

  // Plantegning (SVG)
  function centroid(pts) { var a = 0, cx = 0, cy = 0; for (var i = 0; i < pts.length; i++) { var p = pts[i], q = pts[(i + 1) % pts.length], f = p[0] * q[1] - q[0] * p[1]; a += f; cx += (p[0] + q[0]) * f; cy += (p[1] + q[1]) * f; } if (Math.abs(a) < 1e-9) { var sx = 0, sy = 0; pts.forEach(function (p) { sx += p[0]; sy += p[1]; }); return [sx / pts.length, sy / pts.length]; } return [cx / (3 * a), cy / (3 * a)]; }
  function renderPlan() {
    var et = etasjer(); if (!S.planEtasje || et.indexOf(S.planEtasje) < 0) S.planEtasje = (S.etasje !== 'alle' ? S.etasje : et[0]);
    var list = filteredRom().filter(function (r) { return r.etasje === S.planEtasje; });
    var withPoly = list.filter(function (r) { return r.poly && r.poly.length; });
    var html = '<div class="row"><label class="f" style="grid-auto-flow:column;align-items:center;gap:8px"><span>Etasje</span><select id="planEt">' + et.map(function (e) { return '<option' + (e === S.planEtasje ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('') + '</select></label><span class="small muted">' + withPoly.length + ' av ' + list.length + ' rom har geometri</span></div>';
    if (!withPoly.length) return html + '<div class="panel muted small">Ingen rom med geometri i denne etasjen. Plantegningen bygges fra romgeometrien i IFC-filen.</div>';
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    withPoly.forEach(function (r) { r.poly.forEach(function (pl) { pl.forEach(function (p) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }); }); });
    var w = Math.max(maxx - minx, 1), h = Math.max(maxy - miny, 1), pad = Math.max(w, h) * 0.03;
    var fs = Math.max(Math.min(w, h) / 32, Math.max(w, h) / 90);
    var X = function (x) { return (x - minx + pad).toFixed(3); }, Y = function (y) { return (maxy - y + pad).toFixed(3); };
    var svg = '<svg viewBox="0 0 ' + (w + 2 * pad).toFixed(2) + ' ' + (h + 2 * pad).toFixed(2) + '" role="img" aria-label="Plantegning ' + esc(S.planEtasje) + '">';
    withPoly.forEach(function (r) {
      var st = FV.romStatus(r); var cls = 'plan-room ' + (r.fjernet ? 'mangler' : st.status) + (S.sel === r.id ? ' sel' : '');
      var d = r.poly.map(function (pl) { return 'M' + pl.map(function (p) { return X(p[0]) + ' ' + Y(p[1]); }).join('L') + 'Z'; }).join(' ');
      svg += '<path class="' + cls + '" d="' + d + '" fill-rule="evenodd" data-plan="' + esc(r.id) + '"><title>' + esc((r.nummer ? r.nummer + ' ' : '') + r.navn + ': tilluft ' + fmt(st.tilluft) + ', avtrekk ' + fmt(st.avtrekk) + ' m³/h') + '</title></path>';
    });
    withPoly.forEach(function (r) {
      var st = FV.romStatus(r); var big = r.poly.slice().sort(function (a, b) { return Math.abs(FV.polyArea(b)) - Math.abs(FV.polyArea(a)); })[0];
      var c = centroid(big); var cx = X(c[0]), cy = Number(Y(c[1]));
      var label = (r.nummer ? r.nummer + ' ' : '') + r.navn; if (label.length > 18) label = label.slice(0, 17) + '…';
      svg += '<text class="plan-label" x="' + cx + '" y="' + (cy - fs * 0.6).toFixed(3) + '" font-size="' + (fs * 0.95).toFixed(3) + '" text-anchor="middle">' + esc(label) + '</text>';
      var parts = [];
      if (st.tilluft) parts.push('<tspan class="plan-flow-t">T ' + fmt(st.tilluft) + '</tspan>');
      if (st.avtrekk) parts.push('<tspan class="plan-flow-a">A ' + fmt(st.avtrekk) + '</tspan>');
      if (parts.length) svg += '<text x="' + cx + '" y="' + (cy + fs * 0.6).toFixed(3) + '" font-size="' + (fs * 0.85).toFixed(3) + '" text-anchor="middle" class="plan-flow-t">' + parts.join('<tspan>  </tspan>') + '</text>';
    });
    svg += '</svg>';
    var noGeo = list.length - withPoly.length;
    return html + '<div class="planwrap">' + svg + '<div class="legend"><span><i style="background:var(--ok-soft)"></i>OK</span><span><i style="background:var(--crit-soft)"></i>Under krav</span><span><i style="background:var(--warn-soft)"></i>Mangler data</span><span class="t">T tilluft m³/h</span><span class="a">A avtrekk m³/h</span>' + (noGeo ? '<span>' + noGeo + ' rom uten geometri vises bare i tabellen</span>' : '') + '</div></div>';
  }

  // ---------- Systemer ----------
  function systemTable(systemer) {
    if (!systemer.length) return '<p class="muted small">Ingen rom ennå.</p>';
    var T = 0, A = 0;
    var rows = systemer.map(function (s) { T += s.tilluft; A += s.avtrekk; var dim = Math.max(s.tilluft, s.forsert, s.avtrekk); return '<tr><td><b>' + esc(s.system) + '</b></td><td class="n">' + s.rom + '</td><td class="n">' + fmt(s.areal, 1) + '</td><td class="n t">' + fmt(s.tilluft) + '</td><td class="n a">' + fmt(s.avtrekk) + '</td><td class="n a">' + fmt(s.forsert) + '</td><td class="n">' + (s.balanse > 0 ? '+' : '') + fmt(s.balanse) + '</td><td class="n">' + fmt(dim) + ' m³/h<br><span class="muted">' + fmt(dim / 3600, 3) + ' m³/s</span></td><td>' + (s.avvik ? '<span class="pill under">' + s.avvik + ' avvik</span>' : '<span class="pill ok">OK</span>') + '</td></tr>'; }).join('');
    return '<div class="tablewrap"><table><thead><tr><th>System</th><th class="n">Rom</th><th class="n">Areal m²</th><th class="n t">Tilluft</th><th class="n a">Avtrekk</th><th class="n a">Forsert avtr.</th><th class="n">Balanse</th><th class="n">Dimensjonerende</th><th>Status</th></tr></thead><tbody>' + rows + '<tr class="sum"><td>Sum</td><td></td><td></td><td class="n t">' + fmt(T) + '</td><td class="n a">' + fmt(A) + '</td><td></td><td class="n">' + ((T - A) > 0 ? '+' : '') + fmt(T - A) + '</td><td></td><td></td></tr></tbody></table></div>';
  }
  function renderSystemer() {
    var m = meta() || {}; var sum = FV.oppsummer(rom(), m.byggtype); var inn = innst();
    var html = '<section class="panel"><div class="panel-h"><h3>Luftmengder per system</h3><label class="f" style="grid-auto-flow:column;align-items:center;gap:8px"><span>Standard system for nye rom</span><input type="text" id="i-standardSystem" class="w-m" data-innst="standardSystem" value="' + esc(inn.standardSystem) + '"' + dis() + '></label></div>' + systemTable(sum.systemer) +
      '<p class="small muted" style="margin:10px 0 0">Dimensjonerende luftmengde er den største av tilluft, avtrekk og forsert avtrekk. Bruk den som utgangspunkt for valg av aggregat. Systemnummer følger rommenes systemfelt, for eksempel 360.01 etter NS 3451.</p></section>';
    // Per etasje
    var perEt = {}; sortRom(rom()).forEach(function (r) { var st = FV.romStatus(r); var o = perEt[r.etasje] || (perEt[r.etasje] = { t: 0, a: 0, n: 0, A: 0 }); o.t += st.tilluft; o.a += st.avtrekk; o.n++; o.A += Number(r.areal) || 0; });
    html += '<section class="panel"><h3>Luftmengder per etasje</h3><div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Etasje</th><th class="n">Rom</th><th class="n">Areal m²</th><th class="n t">Tilluft</th><th class="n a">Avtrekk</th><th class="n">m³/h per m²</th></tr></thead><tbody>' + Object.keys(perEt).map(function (e) { var o = perEt[e]; return '<tr><td>' + esc(e) + '</td><td class="n">' + o.n + '</td><td class="n">' + fmt(o.A, 1) + '</td><td class="n t">' + fmt(o.t) + '</td><td class="n a">' + fmt(o.a) + '</td><td class="n">' + fmt(o.A ? o.t / o.A : 0, 2) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    return html;
  }

  // ---------- Kanaler ----------
  function renderKanaler() {
    var inn = innst();
    var html = '<div class="grid2" style="align-items:start">';
    html += '<section class="panel"><h3>Dimensjoneringskriterier</h3><div class="grid2" style="margin-top:10px">' +
      innFld('Maks hastighet hovedkanal', 'vmaxHoved', inn.vmaxHoved, 'm/s') + innFld('Maks hastighet grenkanal', 'vmaxGren', inn.vmaxGren, 'm/s') + innFld('Maks friksjonstap', 'rmax', inn.rmax, 'Pa/m') + innFld('Ruhet kanalvegg', 'ruhet', inn.ruhet, 'mm') +
      '</div><p class="small muted" style="margin:10px 0 0">Standardverdier for lavhastighetsanlegg. Lavere hastighet gir lavere lyd og energibruk. Ruhet 0,15 mm tilsvarer spirofalset stålkanal.</p></section>';
    // Hurtigdimensjonering
    var q = S.hurtig.q, vmax = S.hurtig.type === 'gren' ? inn.vmaxGren : inn.vmaxHoved, valgt = FV.velgDimensjon(q || 0, vmax, inn.rmax, inn.ruhet);
    html += '<section class="panel"><h3>Hurtigdimensjonering</h3><div class="row" style="margin-top:10px"><label class="f"><span>Luftmengde m³/h</span><input type="text" inputmode="decimal" class="n" id="hq" value="' + esc(q) + '" style="width:110px"></label><label class="f"><span>Kanal</span><select id="htype"><option value="hoved"' + (S.hurtig.type === 'hoved' ? ' selected' : '') + '>Hovedkanal</option><option value="gren"' + (S.hurtig.type === 'gren' ? ' selected' : '') + '>Grenkanal</option></select></label><div class="kpi" style="padding:0 6px"><span class="l">Anbefalt</span><span class="v">Ø' + valgt.d + '</span></div></div>';
    html += '<div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Dimensjon</th><th class="n">v m/s</th><th class="n">R Pa/m</th><th class="n">pd Pa</th><th></th></tr></thead><tbody>' + FV.RUND.filter(function (d) { return d >= 100 && d <= 800; }).map(function (d) { var k = FV.rundKanal(q || 0, d, inn.ruhet); var okk = k.v <= vmax && k.R <= inn.rmax; return '<tr class="' + (d === valgt.d ? 'sel' : '') + '"><td class="num">Ø' + d + '</td><td class="n">' + fmt(k.v, 2) + '</td><td class="n">' + fmt(k.R, 2) + '</td><td class="n">' + fmt(k.pd, 1) + '</td><td>' + (d === valgt.d ? '<span class="pill ok">Valgt</span>' : okk ? '<span class="muted small">Innenfor</span>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    html += '</div>';
    // Strekninger
    var res = S.data.strekninger.map(function (s) { return { s: s, r: FV.beregnStrekning(s, inn) }; });
    var maxBy = {}; res.forEach(function (x) { var key = (x.s.system || '') + '|' + x.s.side; if (!maxBy[key] || x.r.sum > maxBy[key].r.sum) maxBy[key] = x; });
    html += '<section class="panel"><div class="panel-h"><div><h3>Trykkfallsberegning</h3><p class="small muted" style="margin:4px 0 0">Legg inn strekningen fra aggregatet til ventilen lengst unna, delt opp der luftmengden endres. Den strekningen med høyest trykkfall per system og side er kritisk og bestemmer viftens eksterne trykk.</p></div><button class="btn primary" type="button" data-act="add-strekning"' + dis() + '>+ Ny strekning</button></div>';
    if (Object.keys(maxBy).length) {
      html += '<div class="kpis" style="margin-bottom:12px">' + Object.keys(maxBy).sort().map(function (k) { var x = maxBy[k]; return kpi((x.s.system || 'Uten system') + ' ' + (x.s.side === 'avtrekk' ? 'avtrekk' : 'tilluft'), fmt(x.r.sum, 0), 'Pa', x.s.side === 'avtrekk' ? 'a' : 't'); }).join('') + '</div>';
    }
    if (!res.length) html += '<p class="muted small">Ingen strekninger ennå.</p>';
    html += '<div style="display:grid;gap:12px">' + res.map(function (x) { return renderStrekning(x.s, x.r, maxBy[(x.s.system || '') + '|' + x.s.side] === x && res.filter(function (y) { return (y.s.system || '') === (x.s.system || '') && y.s.side === x.s.side; }).length > 1); }).join('') + '</div>';
    html += '<datalist id="dimlist"><option value="auto">' + FV.RUND.map(function (d) { return '<option value="' + d + '">'; }).join('') + '<option value="400x200"><option value="500x250"><option value="600x300"></datalist>';
    html += '</section>';
    return html;
  }
  function innFld(label, key, val, unit) { return '<label class="f"><span>' + label + ' (' + unit + ')</span><input type="text" inputmode="decimal" class="n" id="i-' + key + '" data-innst="' + key + '" value="' + esc(String(val).replace('.', ',')) + '"' + dis() + '></label>'; }
  function renderStrekning(s, r, kritisk) {
    var html = '<div class="strekning"><div class="strekning-h">' +
      '<input type="text" class="name" id="s-' + s.id + '-navn" data-sid="' + s.id + '" data-sf="navn" value="' + esc(s.navn) + '" aria-label="Navn på strekning"' + dis() + '>' +
      '<label class="small muted">System <input type="text" class="w-m" id="s-' + s.id + '-system" data-sid="' + s.id + '" data-sf="system" value="' + esc(s.system || '') + '"' + dis() + '></label>' +
      '<select id="s-' + s.id + '-side" data-sid="' + s.id + '" data-sf="side" aria-label="Tilluft eller avtrekk"' + dis() + '><option value="tilluft"' + (s.side !== 'avtrekk' ? ' selected' : '') + '>Tilluft</option><option value="avtrekk"' + (s.side === 'avtrekk' ? ' selected' : '') + '>Avtrekk</option></select>' +
      (kritisk ? '<span class="kritisk">Kritisk</span>' : '') + '<span class="num" style="margin-left:auto"><b>' + fmt(r.sum, 0) + ' Pa</b></span>' +
      '<button class="btn sm ghost danger" type="button" data-act="del-strekning" data-sid="' + s.id + '"' + dis() + '>Slett</button></div>';
    html += '<div style="overflow-x:auto"><table><thead><tr><th>Delstrekning</th><th class="n">q m³/h</th><th>Type</th><th class="n">Lengde m</th><th>Dim.</th><th class="n">Σζ</th><th class="n">Komponent Pa</th><th>Valgt</th><th class="n">v m/s</th><th class="n">R Pa/m</th><th class="n">Δp Pa</th><th></th></tr></thead><tbody>';
    (s.deler || []).forEach(function (d, i) {
      var k = r.rader[i];
      html += '<tr><td><input type="text" class="w-l" id="d-' + d.id + '-navn" data-sid="' + s.id + '" data-did="' + d.id + '" data-df="navn" value="' + esc(d.navn) + '"' + dis() + '></td>' +
        '<td class="n"><input type="text" inputmode="decimal" class="n" id="d-' + d.id + '-q" data-sid="' + s.id + '" data-did="' + d.id + '" data-df="q" value="' + esc(d.q === null || d.q === undefined ? '' : d.q) + '"' + dis() + '></td>' +
        '<td><select id="d-' + d.id + '-type" data-sid="' + s.id + '" data-did="' + d.id + '" data-df="type"' + dis() + '><option value="hoved"' + (d.type !== 'gren' ? ' selected' : '') + '>Hoved</option><option value="gren"' + (d.type === 'gren' ? ' selected' : '') + '>Gren</option></select></td>' +
        '<td class="n"><input type="text" inputmode="decimal" class="n" id="d-' + d.id + '-lengde" data-sid="' + s.id + '" data-did="' + d.id + '" data-df="lengde" value="' + esc(d.lengde === null || d.lengde === undefined ? '' : String(d.lengde).replace('.', ',')) + '"' + dis() + '></td>' +
        '<td><input type="text" style="width:72px" list="dimlist" id="d-' + d.id + '-dim" data-sid="' + s.id + '" data-did="' + d.id + '" data-df="dim" value="' + esc(d.dim && d.dim !== 'auto' ? d.dim : '') + '" placeholder="auto" title="Tomt gir automatisk valg. Rund: 200. Rektangulær: 400x200"' + dis() + '></td>' +
        '<td class="n"><div class="zcell"><input type="text" inputmode="decimal" class="n" style="width:56px" id="d-' + d.id + '-zeta" data-sid="' + s.id + '" data-did="' + d.id + '" data-df="zeta" value="' + esc(d.zeta === null || d.zeta === undefined ? '' : String(d.zeta).replace('.', ',')) + '"' + dis() + '><select id="d-' + d.id + '-zadd" data-zadd="1" data-sid="' + s.id + '" data-did="' + d.id + '" aria-label="Legg til enkeltmotstand" title="Legg til enkeltmotstand"' + dis() + '><option value="">+</option>' + FV.ZETA.map(function (z, zi) { return '<option value="' + zi + '">' + esc(z.navn) + ' (ζ ' + String(z.z).replace('.', ',') + ')</option>'; }).join('') + '</select></div></td>' +
        '<td class="n"><input type="text" inputmode="decimal" class="n" style="width:60px" id="d-' + d.id + '-komponentPa" data-sid="' + s.id + '" data-did="' + d.id + '" data-df="komponentPa" value="' + esc(d.komponentPa === null || d.komponentPa === undefined ? '' : d.komponentPa) + '" title="Trykkfall i ventil, lyddemper, spjeld, filter o.l. fra produktdata"' + dis() + '></td>' +
        '<td class="num">' + esc(k.dimTekst || '–') + '</td><td class="n">' + fmt(k.v, 2) + '</td><td class="n">' + fmt(k.R, 2) + '</td><td class="n"><b>' + fmt(k.dp, 1) + '</b></td>' +
        '<td>' + (k.varsel ? '<span class="pill mangler" title="' + esc(k.varsel) + '">' + esc(k.varsel) + '</span>' : '') + ' <button class="btn sm ghost danger" type="button" data-act="del-del" data-sid="' + s.id + '" data-did="' + d.id + '" aria-label="Slett delstrekning"' + dis() + '>×</button></td></tr>';
    });
    html += '</tbody></table></div><div class="row" style="padding:8px 12px"><button class="btn sm" type="button" data-act="add-del" data-sid="' + s.id + '"' + dis() + '>+ Delstrekning</button><span class="small muted">Friksjon ' + fmt(r.rader.reduce(function (a, x) { return a + x.dpFriksjon; }, 0), 1) + ' Pa, enkeltmotstander ' + fmt(r.rader.reduce(function (a, x) { return a + x.dpEnkelt; }, 0), 1) + ' Pa, komponenter ' + fmt(r.rader.reduce(function (a, x) { return a + x.dpKomponent; }, 0), 1) + ' Pa</span></div></div>';
    return html;
  }

  // ---------- Rapport og eksport ----------
  function renderRapport() {
    var d = S.data;
    var html = '<div class="grid2" style="align-items:start">';
    html += exportCard('Romskjema', 'Alle rom med areal, romtype, krav og prosjekterte luftmengder. Åpnes i Excel.', 'export-csv', 'Last ned romskjema (.csv)');
    html += exportCard('Beregningsrapport', 'Ferdig rapport med forutsetninger, romskjema, systemer, kontroll per boenhet, trykkfall og kilder. Åpne filen i nettleseren og skriv ut til PDF.', 'export-report', 'Last ned rapport (.html)');
    html += exportCard('IFC med luftmengder', 'Arkitektens IFC-fil med egenskapssettet ' + FV.PSET + ' på hvert rom: romtype, system, krav og prosjektert tilluft og avtrekk. Leveres til BIM-koordinator.' + (S.ifc ? ' Filen ' + d.ifc.filnavn + ' er klar.' : d.ifc ? ' Du blir bedt om å velge ' + d.ifc.filnavn + ' på nytt.' : ' Krever at prosjektet er lest inn fra en IFC-fil.'), 'export-ifc', 'Last ned IFC (.zip)', !d.ifc);
    html += exportCard('Prosjektfil', 'Hele prosjektet som én fil. Brukes som sikkerhetskopi eller for å flytte prosjektet.', 'export-json', 'Last ned prosjektfil (.json)');
    html += '</div>';
    html += '<section class="panel"><div class="panel-h"><h3>Forhåndsvisning av rapporten</h3></div><div style="overflow-x:auto">' + reportBody(true) + '</div></section>';
    return html;
  }
  function exportCard(title, text, act, label, disabled) { return '<section class="panel" style="display:grid;gap:10px;align-content:start"><h3>' + title + '</h3><p class="small muted" style="margin:0">' + esc(text) + '</p><div><button class="btn" type="button" data-act="' + act + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button></div></section>'; }

  function reportBody(preview) {
    var m = meta() || {}, inn = innst(), sum = FV.oppsummer(rom(), m.byggtype), list = sortRom(rom()), k = kpis();
    var t = function (s) { return esc(s); };
    var h = '<div class="rep">';
    h += '<h1 style="font-family:var(--f-head,inherit);font-size:24px;margin:0 0 4px">Ventilasjon: beregning av luftmengder</h1><div style="color:#5b6872;margin-bottom:14px">' + t(m.navn) + (m.nummer ? ' · Prosjekt ' + t(m.nummer) : '') + (m.adresse ? ' · ' + t(m.adresse) : '') + '</div>';
    h += '<table class="kv"><tr><td>Byggtype</td><td>' + (m.byggtype === 'yrkesbygg' ? 'Yrkesbygg / publikumsbygg (TEK17 § 13-3)' : 'Bolig (TEK17 § 13-2)') + '</td></tr><tr><td>Ansvarlig prosjekterende</td><td>' + t(m.ansvarlig || '') + '</td></tr><tr><td>Kontrollert av</td><td>' + t(m.kontrollert || '') + '</td></tr><tr><td>Grunnlag</td><td>' + (S.data.ifc ? 'Arkitektmodell ' + t(S.data.ifc.filnavn) + ' (' + t(S.data.ifc.skjema) + '), lest inn ' + t(datoTekst(S.data.ifc.lest)) : 'Rom lagt inn manuelt') + '</td></tr><tr><td>Rapport laget</td><td>' + t(datoTekst(nowIso())) + ' med Fjelluft Vent v0.1</td></tr></table>';
    h += '<h2>Sammendrag</h2><table class="kv"><tr><td>Antall rom</td><td>' + k.n + '</td></tr><tr><td>Samlet areal</td><td>' + fmt(k.A, 1) + ' m²</td></tr><tr><td>Tilluft</td><td>' + fmt(k.T) + ' m³/h</td></tr><tr><td>Avtrekk</td><td>' + fmt(k.Av) + ' m³/h</td></tr><tr><td>Forsert avtrekk</td><td>' + fmt(k.F) + ' m³/h</td></tr><tr><td>Rom med avvik</td><td>' + k.avvik + '</td></tr></table>';
    h += '<h2>Forutsetninger</h2><ul><li>Luftmengder for bolig etter TEK17 § 13-2 med veiledning: 1,2 m³/h per m² gulvareal i snitt for boenheten, 26 m³/h per sengeplass i soverom, avtrekk kjøkken 36 (forsert 108), bad 54 (forsert 108), toalett 36 og vaskerom 36 (forsert 72) m³/h.</li><li>Luftmengder for yrkesbygg etter TEK17 § 13-3: 26 m³/h per person ved lett aktivitet og 2,5 m³/h per m² for materialer og produkter når rommet er i bruk, 0,7 m³/h per m² utenfor driftstid.</li><li>Prosjektert luftmengde er kravet rundet opp til nærmeste 5 m³/h, om ikke annen verdi er lagt inn.</li><li>Kanaldimensjonering: maks ' + fmt(inn.vmaxHoved, 1) + ' m/s i hovedkanal, ' + fmt(inn.vmaxGren, 1) + ' m/s i grenkanal og ' + fmt(inn.rmax, 1) + ' Pa/m friksjonstap. Ruhet ' + fmt(inn.ruhet, 2) + ' mm. Friksjonsfaktor etter Swamee og Jain (tilnærming til Colebrook), luft 1,2 kg/m³.</li></ul>';
    h += '<h2>Romskjema</h2><table class="grid"><thead><tr><th>Etasje</th><th>Nr</th><th>Rom</th><th>Romtype</th><th class="r">Areal m²</th><th class="r">P/S</th><th>System</th><th class="r">Krav T</th><th class="r">Krav A</th><th class="r">Prosj. T</th><th class="r">Prosj. A</th><th class="r">Forsert</th><th>Status</th></tr></thead><tbody>';
    list.forEach(function (r) { var st = FV.romStatus(r), kk = st.krav, ty = FV.TYPE_BY_ID[r.type] || FV.TYPE_BY_ID.annet; h += '<tr><td>' + t(r.etasje) + '</td><td>' + t(r.nummer) + '</td><td>' + t(r.navn) + '</td><td>' + t(ty.navn) + '</td><td class="r">' + fmt(r.areal, 1) + '</td><td class="r">' + (kk.personer !== null ? kk.personer : kk.senger !== null ? kk.senger : '') + '</td><td>' + t(r.system || '') + '</td><td class="r">' + fmt(kk.tilluft, 0) + '</td><td class="r">' + fmt(kk.avtrekk, 0) + '</td><td class="r">' + fmt(st.tilluft) + '</td><td class="r">' + fmt(st.avtrekk) + '</td><td class="r">' + (kk.forsert !== null ? fmt(kk.forsert) : '') + '</td><td>' + (r.fjernet ? 'Ikke i modellen' : st.status === 'ok' ? 'OK' : t(st.melding)) + '</td></tr>'; });
    h += '</tbody></table>';
    h += '<h2>Systemer</h2><table class="grid"><thead><tr><th>System</th><th class="r">Rom</th><th class="r">Areal m²</th><th class="r">Tilluft m³/h</th><th class="r">Avtrekk m³/h</th><th class="r">Forsert m³/h</th><th class="r">Balanse</th></tr></thead><tbody>' + sum.systemer.map(function (s) { return '<tr><td>' + t(s.system) + '</td><td class="r">' + s.rom + '</td><td class="r">' + fmt(s.areal, 1) + '</td><td class="r">' + fmt(s.tilluft) + '</td><td class="r">' + fmt(s.avtrekk) + '</td><td class="r">' + fmt(s.forsert) + '</td><td class="r">' + fmt(s.balanse) + '</td></tr>'; }).join('') + '</tbody></table>';
    if (m.byggtype !== 'yrkesbygg' && sum.boenheter.length) h += '<h2>Kontroll per boenhet</h2><table class="grid"><thead><tr><th>Boenhet</th><th class="r">Areal m²</th><th class="r">Krav 1,2 m³/h·m²</th><th class="r">Tilluft</th><th class="r">Avtrekk</th><th>Status</th></tr></thead><tbody>' + sum.boenheter.map(function (b) { return '<tr><td>' + t(b.boenhet) + '</td><td class="r">' + fmt(b.areal, 1) + '</td><td class="r">' + fmt(b.kravSnitt, 0) + '</td><td class="r">' + fmt(b.tilluft) + '</td><td class="r">' + fmt(b.avtrekk) + '</td><td>' + (b.ok ? 'OK' : 'For lite tilluft') + (Math.abs(b.balanse) > 5 ? ', ubalanse ' + fmt(b.balanse) + ' m³/h' : '') + '</td></tr>'; }).join('') + '</tbody></table>';
    if (S.data.strekninger.length) {
      h += '<h2>Trykkfall</h2>';
      S.data.strekninger.forEach(function (s) { var r = FV.beregnStrekning(s, inn); h += '<h3>' + t(s.navn) + ' · ' + t(s.system || '') + ' ' + (s.side === 'avtrekk' ? 'avtrekk' : 'tilluft') + ' · ' + fmt(r.sum, 0) + ' Pa</h3><table class="grid"><thead><tr><th>Delstrekning</th><th class="r">q m³/h</th><th>Dim.</th><th class="r">L m</th><th class="r">v m/s</th><th class="r">R Pa/m</th><th class="r">Σζ</th><th class="r">Komp. Pa</th><th class="r">Δp Pa</th></tr></thead><tbody>' + (s.deler || []).map(function (d, i) { var k2 = r.rader[i]; return '<tr><td>' + t(d.navn) + '</td><td class="r">' + fmt(k2.q) + '</td><td>' + t(k2.dimTekst || '') + '</td><td class="r">' + fmt(d.lengde, 1) + '</td><td class="r">' + fmt(k2.v, 2) + '</td><td class="r">' + fmt(k2.R, 2) + '</td><td class="r">' + fmt(d.zeta, 2) + '</td><td class="r">' + fmt(k2.dpKomponent, 0) + '</td><td class="r">' + fmt(k2.dp, 1) + '</td></tr>'; }).join('') + '</tbody></table>'; });
    }
    h += '<h2>Kilder</h2><ul><li>Byggteknisk forskrift (TEK17) § 13-2 Ventilasjon i boligbygning, med veiledning. Direktoratet for byggkvalitet, dibk.no.</li><li>Byggteknisk forskrift (TEK17) § 13-3 Ventilasjon i byggverk for publikum og arbeidsbygning, med veiledning. Direktoratet for byggkvalitet, dibk.no.</li></ul>';
    h += '<p style="margin-top:28px;font-size:12px;color:#5b6872">Beregningen er utført med Fjelluft Vent og skal kontrolleres av ansvarlig prosjekterende. Produktdata for ventiler, lyddempere og aggregat hentes fra leverandør.</p>';
    h += '<table class="kv" style="margin-top:20px"><tr><td>Kontrollert, signatur</td><td style="border-bottom:1px solid #999;width:260px">&nbsp;</td></tr><tr><td>Dato</td><td style="border-bottom:1px solid #999">&nbsp;</td></tr></table></div>';
    var css = '<style>.rep{font-size:13px;color:var(--ink,#15212b)}.rep h2{font-size:17px;margin:22px 0 8px}.rep h3{font-size:14px;margin:14px 0 6px}.rep table{border-collapse:collapse;width:100%;margin-bottom:6px}.rep table.kv{width:auto}.rep table.kv td{padding:3px 16px 3px 0;border:0;white-space:normal}.rep table.kv td:first-child{color:var(--muted,#5b6872)}.rep table.grid th,.rep table.grid td{border:1px solid var(--line,#d5dcdf);padding:4px 6px;font-size:12px;white-space:nowrap;position:static;text-transform:none;letter-spacing:0}.rep table.grid th{background:var(--sheet-2,#f2f4f5)}.rep .r{text-align:right;font-variant-numeric:tabular-nums}.rep ul{padding-left:20px}</style>';
    return css + h;
  }
  function reportDocument() {
    var m = meta() || {};
    return '<!doctype html><html lang="nb"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc('Ventilasjon ' + (m.nummer ? m.nummer + ' ' : '') + m.navn) + '</title><style>body{font:13px/1.45 "IBM Plex Sans",Arial,sans-serif;color:#15212b;margin:32px auto;max-width:1100px;padding:0 24px}h1,h2,h3{font-family:"IBM Plex Sans Condensed","Arial Narrow",Arial,sans-serif}@media print{body{margin:0;max-width:none}h2{break-after:avoid}tr{break-inside:avoid}}@page{size:A4 landscape;margin:14mm}</style></head><body>' + reportBody(false) + '</body></html>';
  }

  // ---------- Beregningsgrunnlag ----------
  function renderGrunnlag() {
    var html = '<section class="panel"><h3>Romtyper og krav</h3><div class="tablewrap" style="margin-top:10px"><table><thead><tr><th>Gruppe</th><th>Romtype</th><th>Grunnlag</th><th>Kilde</th></tr></thead><tbody>' + FV.ROMTYPER.map(function (t) { return '<tr><td>' + esc(t.gruppe) + '</td><td>' + esc(t.navn) + '</td><td style="white-space:normal">' + esc(t.grunnlag) + '</td><td>' + esc(t.kilde) + '</td></tr>'; }).join('') + '</tbody></table></div></section>';
    html += '<section class="panel src"><h3>Slik regner programmet</h3><ul>' +
      '<li><b>Areal</b> hentes fra IFC i denne rekkefølgen: mengden NetFloorArea, deretter GrossFloorArea, deretter egenskaper som Area eller Netto areal, og til slutt beregnet fra romgeometrien. Kilden vises for hvert rom.</li>' +
      '<li><b>Standard antall personer</b> der det ikke er fylt inn: kontor 1 per 10 m², møterom og klasserom 1 per 2 m², kantine 1 per 1,7 m². Soverom får 2 senger fra 12 m², ellers 1. Kontroller mot brukerens romprogram.</li>' +
      '<li><b>Kanalfriksjon</b> etter Darcy-Weisbach med friksjonsfaktor fra Swamee og Jain. Luft 20 °C: tetthet 1,2 kg/m³, kinematisk viskositet 15,1·10⁻⁶ m²/s. Rektangulære kanaler regnes med hydraulisk diameter.</li>' +
      '<li><b>Enkeltmotstander</b> legges inn som summen av ζ-verdier og ganges med dynamisk trykk. Hurtigknappene bruker veiledende verdier: bend 90° 0,3, bend 45° 0,15, T-stykke gjennomløp 0,3, T-stykke avgrening 1,0, overgang 0,1, innløp eller utløp 1,0. Bruk produsentens verdier der de finnes.</li>' +
      '<li><b>IFC-eksport</b> legger egenskapssettet ' + FV.PSET + ' på hvert IfcSpace i arkitektens fil. Resten av filen endres ikke. Eksporterer du på nytt, erstattes de gamle verdiene.</li></ul>' +
      '<h3>Kilder</h3><ul><li><a href="https://www.dibk.no/regelverk/byggteknisk-forskrift-tek17/13/i/13-2" target="_blank" rel="noopener">TEK17 § 13-2 Ventilasjon i boligbygning (DiBK)</a></li><li><a href="https://www.dibk.no/regelverk/byggteknisk-forskrift-tek17/13/i/13-3" target="_blank" rel="noopener">TEK17 § 13-3 Ventilasjon i byggverk for publikum og arbeidsbygning (DiBK)</a></li></ul>' +
      '<p class="small muted">Fjelluft Vent er et arbeidsverktøy. Ansvarlig prosjekterende kontrollerer alle beregninger før de brukes i prosjektet.</p></section>';
    return html;
  }

  // ---------- IFC-import ----------
  function parseInWorker(text, onProg) {
    return new Promise(function (resolve, reject) {
      var w;
      var fallback = function () { try { var r = FV.parseIFC(text); delete r._model; resolve(r); } catch (e) { reject(e); } };
      try {
        var cs0 = $('#coreSrc'); var src = (cs0.src ? 'importScripts(' + JSON.stringify(cs0.src) + ');' : cs0.textContent) + '\n;onmessage=function(e){try{var r=FV.parseIFC(e.data,function(p){postMessage({p:p})});delete r._model;postMessage({ok:r})}catch(err){postMessage({err:String(err&&err.message||err)})}};';
        w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      } catch (e) { fallback(); return; }
      w.onmessage = function (e) { if (e.data.p !== undefined) { onProg && onProg(e.data.p); return; } w.terminate(); if (e.data.ok) resolve(e.data.ok); else reject(new Error(e.data.err)); };
      w.onerror = function (e) { e.preventDefault && e.preventDefault(); w.terminate(); fallback(); };
      w.postMessage(text);
    });
  }
  function hull(points) {
    var p = points.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (p.length < 3) return p;
    var cr = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); };
    var lo = [], up = [];
    p.forEach(function (q) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); });
    p.slice().reverse().forEach(function (q) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); });
    up.pop(); lo.pop(); return lo.concat(up);
  }
  function compactPoly(poly) {
    if (!poly) return null;
    var n = poly.reduce(function (a, pl) { return a + pl.length; }, 0);
    if (n <= 160) return poly;
    var all = []; poly.forEach(function (pl) { all = all.concat(pl); }); return [hull(all)];
  }

  async function handleIfcFile(file, purpose) {
    if (!file) return;
    if (!/\.ifc$/i.test(file.name)) { toast('Velg en fil som slutter på .ifc. IFC-zip (.ifczip) og XML støttes ikke ennå.'); return; }
    var prog = $('#ifcProg'); if (prog) { prog.hidden = false; prog.firstChild.style.width = '5%'; }
    var text;
    try { text = await file.text(); } catch (e) { toast('Kunne ikke lese filen.'); return; }
    if (purpose === 'export') { await exportIfcWith(text, file.name); return; }
    var t0 = Date.now();
    try {
      var res = await parseInWorker(text, function (p) { if (prog) prog.firstChild.style.width = Math.round(10 + p * 85) + '%'; });
      if (prog) prog.firstChild.style.width = '100%';
      S.ifc = { text: text, navn: file.name };
      showImportDialog(res, file, Date.now() - t0);
    } catch (e) { toast('Kunne ikke lese IFC-filen: ' + (e.message || e)); if (prog) prog.hidden = true; }
  }

  function showImportDialog(res, file, ms) {
    var existing = new Map(rom().filter(function (r) { return r.guid; }).map(function (r) { return [r.guid, r]; }));
    var incoming = new Set(res.rom.map(function (r) { return r.guid; }));
    var nye = res.rom.filter(function (r) { return !existing.has(r.guid); }).length;
    var oppd = res.rom.length - nye;
    var borte = Array.from(existing.keys()).filter(function (g) { return !incoming.has(g); }).length;
    var src = { q: 0, p: 0, g: 0, m: 0 }; res.rom.forEach(function (r) { if (/^Mengde/.test(r.arealKilde)) src.q++; else if (/^Egenskap/.test(r.arealKilde)) src.p++; else if (/geometri/.test(r.arealKilde)) src.g++; else src.m++; });
    var m = meta() || {};
    var html = '<h2>Les inn ' + esc(file.name) + '</h2>' +
      '<dl style="display:grid;grid-template-columns:auto 1fr;gap:4px 14px;margin:0;font-size:13px"><dt class="muted">Format</dt><dd style="margin:0">' + esc(res.schema) + ', lengdeenhet ' + esc(res.units.lengthName) + '</dd><dt class="muted">Prosjekt i filen</dt><dd style="margin:0">' + esc(res.prosjektnavn || '–') + '</dd><dt class="muted">Etasjer</dt><dd style="margin:0">' + esc(res.etasjer.map(function (e) { return e.navn; }).join(', ') || '–') + '</dd><dt class="muted">Rom funnet</dt><dd style="margin:0"><b>' + res.rom.length + '</b> (lest på ' + fmt(ms / 1000, 1) + ' s)</dd><dt class="muted">Areal fra</dt><dd style="margin:0">mengder ' + src.q + ', egenskaper ' + src.p + ', geometri ' + src.g + (src.m ? ', <b style="color:var(--crit)">mangler ' + src.m + '</b>' : '') + '</dd>' +
      (res.antall.kanaler || res.antall.ventiler ? '<dt class="muted">Ventilasjon i filen</dt><dd style="margin:0">' + res.antall.kanaler + ' kanaler, ' + res.antall.ventiler + ' ventiler (leses ikke inn i v0.1)</dd>' : '') + '</dl>';
    if (!res.rom.length) html += '<div class="banner">Filen inneholder ingen rom (IfcSpace). Be arkitekten eksportere IFC med rom inkludert. I Revit: huk av for «Export rooms in 3D views» eller eksporter rom. I ArchiCAD: ta med Zones.</div>';
    if (rom().length) html += '<div class="banner info">Oppdatering av prosjektet: <b>' + nye + '</b> nye rom, <b>' + oppd + '</b> oppdateres (romtype og luftmengder beholdes), <b>' + borte + '</b> finnes ikke lenger i modellen og blir markert.</div>';
    html += '<label class="f"><span>Romtyper for nye rom gjettes ut fra romnavnet som</span><select id="impType"><option value="bolig"' + (m.byggtype !== 'yrkesbygg' ? ' selected' : '') + '>Bolig</option><option value="yrkesbygg"' + (m.byggtype === 'yrkesbygg' ? ' selected' : '') + '>Yrkesbygg</option></select></label>';
    html += '<div class="modal-actions"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" type="button" data-act="import-confirm"' + (res.rom.length ? '' : ' disabled') + '>Les inn ' + res.rom.length + ' rom</button></div>';
    S.pendingImport = { res: res, file: file.name };
    modal(html);
  }
  function applyImport(byggtype) {
    var pi = S.pendingImport; if (!pi) return;
    var res = pi.res, inn = innst();
    var byGuid = new Map(rom().filter(function (r) { return r.guid; }).map(function (r) { return [r.guid, r]; }));
    var seen = new Set();
    res.rom.forEach(function (s) {
      seen.add(s.guid);
      var geo = { guid: s.guid, nummer: s.nummer, navn: s.navn, etasje: s.etasje, etasjeKote: s.etasjeKote, areal: s.areal, arealKilde: s.arealKilde, arealGeometri: s.arealGeometri, hoyde: s.hoyde, poly: compactPoly(s.poly), fjernet: false };
      var ex = byGuid.get(s.guid);
      if (ex) { if (ex.arealManuell) { delete geo.areal; delete geo.arealKilde; } Object.assign(ex, geo); }
      else S.data.rom.push(Object.assign({ id: s.guid, type: FV.gjettRomtype(s.navn, byggtype), personer: null, senger: null, system: inn.standardSystem, boenhet: 'Boenhet 1', tilluftProsj: null, avtrekkProsj: null, merknad: '' }, geo));
    });
    S.data.rom.forEach(function (r) { if (r.guid && !seen.has(r.guid)) r.fjernet = true; });
    S.data.ifc = { filnavn: pi.file, skjema: res.schema, lest: nowIso(), antallRom: res.rom.length, etasjer: res.etasjer, enhet: res.units.lengthName };
    S.pendingImport = null;
    var m = meta(); if (m && byggtype && m.byggtype !== byggtype) { var nm = Object.assign({}, m, { byggtype: byggtype }); saveMeta(S.pid, nm); }
    closeModal(); changed(); S.tab = 'rom'; lsSet('fv-tab', 'rom'); renderAll();
    toast(res.rom.length + ' rom lest inn. Kontroller romtypene.'); logg('ifc_importert', (meta() || {}).navn, { fil: pi.file, rom: res.rom.length });
  }

  async function exportIfcWith(text, name) {
    var ifcGuids = new Set((text.match(/IFCSPACE\s*\(\s*'([^']{22})'/gi) || []).map(function (s) { return s.slice(-22); }));
    var hits = rom().filter(function (r) { return r.guid && ifcGuids.has(r.guid); }).length;
    if (!hits) { toast('Ingen av rommene i prosjektet finnes i denne filen. Velg samme modell som ble lest inn.'); return; }
    S.ifc = { text: text, navn: name };
    try {
      var w = FV.writeIFC(text, FV.ifcVerdier(S.data));
      var base = name.replace(/\.ifc$/i, '');
      var fname = base + '_Fjelluft_luftmengder.ifc';
      if (typeof JSZip === 'undefined') { toast('Komprimering er ikke tilgjengelig. Prøv igjen om litt.'); return; }
      var zip = new JSZip(); zip.file(fname, w.text);
      var blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
      saveFile(base + '_Fjelluft_luftmengder.zip', blob); logg('eksport_ifc', (meta() || {}).navn, { rom: w.antallRom });
      if (hits < rom().filter(function (r) { return r.guid; }).length) toast(w.antallRom + ' rom fikk luftmengder. Noen rom finnes ikke i denne filen.');
    } catch (e) { toast('Kunne ikke lage IFC-filen: ' + (e.message || e)); }
  }

  // ---------- Administrasjon ----------
  var HANDLING = {
    innlogging: 'Logget inn', passord_byttet: 'Byttet passord', passord_nullstilt: 'Nullstilte passordet til', bruker_opprettet: 'La til bruker', bruker_endret: 'Endret bruker',
    bruker_slettet: 'Slettet bruker', bedrift_opprettet: 'Opprettet bedrift', bedrift_endret: 'Endret bedrift', prosjekt_opprettet: 'Opprettet prosjekt', prosjekt_slettet: 'Slettet prosjekt',
    prosjekt_arkivert: 'Arkiverte prosjekt', prosjekt_gjenopprettet: 'Hentet fram prosjekt', prosjekt_omdopt: 'Endret navn på prosjekt', ifc_importert: 'Leste inn IFC i', eksport_ifc: 'Eksporterte IFC fra',
    eksport_rapport: 'Lastet ned rapport for', eksport_romskjema: 'Lastet ned romskjema for', eksport_alle: 'Lastet ned alle prosjekter', superadmin_opprettet: 'Opprettet Fjelluft-administrator'
  };
  var STATUS_NAVN = { aktiv: 'Aktiv', sperret: 'Sperret', avsluttet: 'Avsluttet' };
  function adminTabs() {
    if (S.me && S.me.superadmin) return [['a-oversikt', 'Oversikt'], ['a-bedrifter', 'Bedrifter'], ['a-brukere', 'Brukere'], ['a-aktivitet', 'Aktivitetslogg'], ['a-planer', 'Planer og priser']];
    return [['a-brukere', 'Brukere'], ['a-bedrift', 'Bedrift og abonnement'], ['a-aktivitet', 'Aktivitetslogg']];
  }
  function planNavn(k) { var p = S.planer.find(function (x) { return x.kode === k; }); return p ? p.navn : k; }
  function planPris(k) { var p = S.planer.find(function (x) { return x.kode === k; }); return p ? p.pris_mnd : 0; }
  function bedriftNavn(id) { var b = S.bedrifter.find(function (x) { return x.id === id; }); return b ? b.navn : ''; }
  function kr(x) { return fmt(x) + ' kr'; }

  async function lastAdmin() {
    if (S.adm && S.adm.laster) return;
    S.adm = Object.assign(S.adm || {}, { laster: true });
    var res = await Promise.all([
      sb.from('bedrifter').select('*').order('navn'),
      sb.from('profiler').select('*').order('epost'),
      sb.from('prosjekter').select('id,bedrift_id,endret,arkivert'),
      sb.from('aktivitet').select('*').order('tid', { ascending: false }).limit(400),
      sb.from('planer').select('*').order('sortering')
    ]);
    S.bedrifter = res[0].data || S.bedrifter; S.bedrift = S.bedrifter.find(function (b) { return b.id === S.me.bedrift_id; }) || S.bedrift;
    S.planer = res[4].data || S.planer;
    S.adm = { brukere: res[1].data || [], prosjekter: res[2].data || [], aktivitet: res[3].data || [], lastet: true, laster: false, filterBedrift: (S.adm && S.adm.filterBedrift) || (S.me.superadmin ? 'alle' : S.me.bedrift_id) };
    beregnTilgang();
    if (S.side === 'admin') { renderHeader(); renderMain(); }
  }

  function renderAdmin() {
    if (!S.atab || !adminTabs().some(function (t) { return t[0] === S.atab; })) S.atab = adminTabs()[0][0];
    if (!S.adm || !S.adm.lastet) { lastAdmin(); return '<div class="panel muted">Henter oversikt…</div>'; }
    return ({ 'a-oversikt': admOversikt, 'a-bedrifter': admBedrifter, 'a-brukere': admBrukere, 'a-aktivitet': admAktivitet, 'a-planer': admPlaner, 'a-bedrift': admBedrift }[S.atab])();
  }

  function bedriftStats(b) {
    var br = S.adm.brukere.filter(function (u) { return u.bedrift_id === b.id; });
    var aktive = br.filter(function (u) { return u.aktiv; });
    var sist = br.map(function (u) { return u.sist_innlogget; }).filter(Boolean).sort().pop() || null;
    var pr = S.adm.prosjekter.filter(function (p) { return p.bedrift_id === b.id; });
    var betalende = b.status === 'aktiv' && b.plan !== 'prove' && b.plan !== 'intern';
    return { brukere: br.length, aktive: aktive.length, sist: sist, prosjekter: pr.filter(function (p) { return !p.arkivert; }).length, mrr: betalende ? planPris(b.plan) : 0 };
  }
  function statusPillB(b) {
    if (b.status !== 'aktiv') return '<span class="pill ' + (b.status === 'sperret' ? 'under' : 'mangler') + '">' + STATUS_NAVN[b.status] + '</span>';
    if (b.plan === 'prove' && b.prove_til && b.prove_til < idag()) return '<span class="pill under">Prøve utløpt</span>';
    if (b.plan === 'prove') return '<span class="pill mangler">Prøve</span>';
    return '<span class="pill ok">Aktiv</span>';
  }

  function admOversikt() {
    var bs = S.bedrifter.filter(function (b) { return b.plan !== 'intern'; });
    var mrr = 0, prove = 0, aktive = 0, sperret = 0;
    bs.forEach(function (b) { var s = bedriftStats(b); mrr += s.mrr; if (b.status === 'aktiv' && b.plan === 'prove') prove++; else if (b.status === 'aktiv') aktive++; if (b.status === 'sperret') sperret++; });
    var for30 = new Date(Date.now() - 30 * 86400000).toISOString();
    var aktiveBrukere = S.adm.brukere.filter(function (u) { return u.sist_innlogget && u.sist_innlogget > for30; }).length;
    var snart = S.bedrifter.filter(function (b) { if (b.plan !== 'prove' || b.status !== 'aktiv' || !b.prove_til) return false; var d = (new Date(b.prove_til) - new Date()) / 86400000; return d < 8; });
    var h = '<div class="kpis">' + kpi('Månedlig inntekt', fmt(mrr), 'kr', 't') + kpi('Årlig inntekt', fmt(mrr * 12), 'kr') + kpi('Betalende kunder', fmt(aktive), '') + kpi('I prøveperiode', fmt(prove), '') + kpi('Sperret', fmt(sperret), '') + kpi('Brukere innlogget siste 30 d', fmt(aktiveBrukere) + ' / ' + fmt(S.adm.brukere.filter(function (u) { return u.aktiv; }).length), '') + kpi('Prosjekter', fmt(S.adm.prosjekter.filter(function (p) { return !p.arkivert; }).length), '') + '</div>';
    h += '<div class="grid2" style="align-items:start"><section class="panel"><div class="panel-h"><h3>Prøveperioder som går ut</h3><button class="btn sm primary" type="button" data-act="ny-bedrift">+ Ny kunde</button></div>' +
      (snart.length ? '<ul class="issues">' + snart.map(function (b) { return '<li>' + statusPillB(b) + '<span><b>' + esc(b.navn) + '</b> <span class="muted">til ' + esc(datoKort(b.prove_til)) + (b.kontakt_epost ? ', ' + esc(b.kontakt_epost) : '') + '</span></span><button type="button" data-act="rediger-bedrift" data-id="' + esc(b.id) + '">Endre plan</button></li>'; }).join('') + '</ul>' : '<p class="small muted">Ingen prøveperioder går ut den neste uken.</p>') + '</section>';
    h += '<section class="panel"><div class="panel-h"><h3>Siste aktivitet</h3><button class="btn sm ghost" type="button" data-atab="a-aktivitet">Se alt</button></div>' + aktivitetListe(S.adm.aktivitet.slice(0, 10), true) + '</section></div>';
    return h;
  }

  function admBedrifter() {
    var h = '<section class="panel"><div class="panel-h"><div><h3>Bedrifter</h3><p class="small muted" style="margin:4px 0 0">Kundene som har tilgang til Fjelluft Vent. Hver bedrift ser bare sine egne prosjekter og brukere.</p></div><button class="btn primary" type="button" data-act="ny-bedrift">+ Ny kunde</button></div>';
    h += '<div class="tablewrap"><table><thead><tr><th>Bedrift</th><th>Org.nr</th><th>Plan</th><th>Status</th><th class="n">Brukere</th><th class="n">Prosjekter</th><th>Sist aktiv</th><th>Prøve til</th><th class="n">Kr/mnd</th><th></th></tr></thead><tbody>';
    S.bedrifter.forEach(function (b) {
      var s = bedriftStats(b);
      h += '<tr><td><b>' + esc(b.navn) + '</b>' + (b.kontakt_epost ? '<br><span class="small muted">' + esc(b.kontakt_epost) + '</span>' : '') + '</td><td class="num">' + esc(b.orgnr || '') + '</td><td>' + esc(planNavn(b.plan)) + '</td><td>' + statusPillB(b) + '</td><td class="n">' + s.aktive + ' / ' + b.maks_brukere + '</td><td class="n">' + s.prosjekter + '</td><td class="small">' + (s.sist ? esc(datoTekst(s.sist)) : '<span class="muted">Aldri</span>') + '</td><td class="small">' + (b.prove_til ? esc(datoKort(b.prove_til)) : '') + '</td><td class="n">' + (s.mrr ? fmt(s.mrr) : '–') + '</td>' +
        '<td><div class="row" style="flex-wrap:nowrap;gap:4px"><button class="btn sm" type="button" data-act="rediger-bedrift" data-id="' + esc(b.id) + '">Endre</button><button class="btn sm ghost" type="button" data-act="vis-brukere" data-id="' + esc(b.id) + '">Brukere</button><button class="btn sm ghost" type="button" data-act="vis-prosjekter" data-id="' + esc(b.id) + '">Prosjekter</button></div></td></tr>';
    });
    h += '</tbody></table></div></section>';
    return h;
  }

  function admBrukere() {
    var sup = S.me.superadmin, f = S.adm.filterBedrift;
    var list = S.adm.brukere.filter(function (u) { return f === 'alle' || u.bedrift_id === f; });
    var b = f !== 'alle' ? S.bedrifter.find(function (x) { return x.id === f; }) : null;
    var aktive = b ? S.adm.brukere.filter(function (u) { return u.bedrift_id === b.id && u.aktiv; }).length : 0;
    var h = '<section class="panel"><div class="panel-h"><div><h3>Brukere</h3>' + (b ? '<p class="small muted" style="margin:4px 0 0">' + esc(b.navn) + ': ' + aktive + ' av ' + b.maks_brukere + ' brukerplasser i bruk.</p>' : '') + '</div><div class="row">' +
      (sup ? '<select id="admBedriftF" aria-label="Bedrift"><option value="alle">Alle bedrifter</option>' + S.bedrifter.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === f ? ' selected' : '') + '>' + esc(x.navn) + '</option>'; }).join('') + '</select>' : '') +
      '<button class="btn primary" type="button" data-act="ny-bruker">+ Ny bruker</button></div></div>';
    h += '<div class="tablewrap"><table><thead><tr><th>Navn</th><th>E-post</th>' + (sup ? '<th>Bedrift</th>' : '') + '<th>Rolle</th><th>Status</th><th>Sist innlogget</th><th></th></tr></thead><tbody>';
    list.forEach(function (u) {
      var seg = u.id === S.me.id, lås = (u.superadmin && !sup) || (u.rolle === 'eier' && !sup && S.me.rolle !== 'eier');
      h += '<tr class="' + (u.aktiv ? '' : 'gone') + '"><td>' + esc(u.navn || '') + (u.superadmin ? ' <span class="tag">Fjelluft-admin</span>' : '') + (seg ? ' <span class="tag">deg</span>' : '') + '</td><td>' + esc(u.epost) + '</td>' + (sup ? '<td class="small">' + esc(bedriftNavn(u.bedrift_id)) + '</td>' : '') +
        '<td><select id="ur-' + esc(u.id) + '" data-urolle="' + esc(u.id) + '"' + (seg || lås ? ' disabled' : '') + '>' + Object.keys(ROLLE_NAVN).filter(function (r) { return r !== 'eier' || sup || S.me.rolle === 'eier' || u.rolle === 'eier'; }).map(function (r) { return '<option value="' + r + '"' + (u.rolle === r ? ' selected' : '') + '>' + ROLLE_NAVN[r] + '</option>'; }).join('') + '</select></td>' +
        '<td>' + (u.aktiv ? (u.ma_bytte_passord ? '<span class="pill mangler" title="Har ikke logget inn og valgt eget passord ennå">Venter på første innlogging</span>' : '<span class="pill ok">Aktiv</span>') : '<span class="pill under">Deaktivert</span>') + '</td>' +
        '<td class="small">' + (u.sist_innlogget ? esc(datoTekst(u.sist_innlogget)) : '<span class="muted">Aldri</span>') + '</td>' +
        '<td><div class="row" style="flex-wrap:nowrap;gap:4px">' + (seg || lås ? '' : '<button class="btn sm" type="button" data-act="nullstill" data-id="' + esc(u.id) + '">Nytt passord</button><button class="btn sm ghost" type="button" data-act="aktiver" data-id="' + esc(u.id) + '" data-v="' + (u.aktiv ? '0' : '1') + '">' + (u.aktiv ? 'Deaktiver' : 'Aktiver') + '</button><button class="btn sm ghost danger" type="button" data-act="slett-bruker" data-id="' + esc(u.id) + '">Slett</button>') + '</div></td></tr>';
    });
    if (!list.length) h += '<tr><td colspan="7" class="muted">Ingen brukere.</td></tr>';
    h += '</tbody></table></div><p class="small muted" style="margin:10px 0 0">Roller: ' + Object.keys(ROLLE_NAVN).map(function (r) { return '<b>' + ROLLE_NAVN[r] + '</b> ' + ROLLE_HJELP[r].toLowerCase(); }).join('. ') + '. Deaktiverte brukere kan ikke logge inn, men prosjektene deres beholdes.</p></section>';
    return h;
  }

  function aktivitetListe(list, kort) {
    if (!list.length) return '<p class="small muted">Ingen aktivitet ennå.</p>';
    return '<div class="tablewrap"><table><thead><tr><th>Tid</th><th>Bruker</th>' + (S.me.superadmin && !kort ? '<th>Bedrift</th>' : '') + '<th>Hendelse</th></tr></thead><tbody>' + list.map(function (a) {
      return '<tr><td class="small num">' + esc(datoTekst(a.tid)) + '</td><td class="small">' + esc(a.bruker_epost || '') + '</td>' + (S.me.superadmin && !kort ? '<td class="small">' + esc(bedriftNavn(a.bedrift_id)) + '</td>' : '') + '<td style="white-space:normal">' + esc(HANDLING[a.handling] || a.handling) + (a.objekt ? ' <b>' + esc(a.objekt) + '</b>' : '') + '</td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function admAktivitet() {
    var f = S.adm.filterBedrift, list = S.adm.aktivitet.filter(function (a) { return f === 'alle' || a.bedrift_id === f; });
    return '<section class="panel"><div class="panel-h"><div><h3>Aktivitetslogg</h3><p class="small muted" style="margin:4px 0 0">Innlogginger, brukerendringer, prosjekter og eksporter. De siste 400 hendelsene.</p></div>' + (S.me.superadmin ? '<select id="admBedriftF" aria-label="Bedrift"><option value="alle">Alle bedrifter</option>' + S.bedrifter.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === f ? ' selected' : '') + '>' + esc(x.navn) + '</option>'; }).join('') + '</select>' : '') + '</div>' + aktivitetListe(list, false) + '</section>';
  }

  function admPlaner() {
    return '<section class="panel"><div class="panel-h"><div><h3>Planer og priser</h3><p class="small muted" style="margin:4px 0 0">Prisene brukes i inntektsoversikten og når du velger plan for en kunde. Endringer gjelder med en gang. Priser eks. mva.</p></div></div><div class="tablewrap"><table><thead><tr><th>Kode</th><th>Navn</th><th class="n">Pris per måned</th><th class="n">Brukere inkludert</th><th>Beskrivelse</th></tr></thead><tbody>' +
      S.planer.map(function (p) { return '<tr><td class="num">' + esc(p.kode) + '</td><td><input type="text" class="w-l" id="pl-' + p.kode + '-navn" data-plan="' + p.kode + '" data-pf="navn" value="' + esc(p.navn) + '"></td><td class="n"><input type="text" inputmode="numeric" class="n" id="pl-' + p.kode + '-pris" data-plan="' + p.kode + '" data-pf="pris_mnd" value="' + esc(p.pris_mnd) + '"></td><td class="n"><input type="text" inputmode="numeric" class="n" id="pl-' + p.kode + '-maks" data-plan="' + p.kode + '" data-pf="maks_brukere" value="' + esc(p.maks_brukere) + '"></td><td><input type="text" style="width:260px" id="pl-' + p.kode + '-besk" data-plan="' + p.kode + '" data-pf="beskrivelse" value="' + esc(p.beskrivelse || '') + '"></td></tr>'; }).join('') +
      '</tbody></table></div></section>';
  }

  function admBedrift() {
    var b = S.bedrift; if (!b) return '<div class="panel muted">Fant ikke bedriften.</div>';
    var s = bedriftStats(b);
    var pr = S.adm.prosjekter.filter(function (p) { return p.bedrift_id === b.id; });
    return '<div class="grid2" style="align-items:start"><section class="panel"><div class="panel-h"><h3>' + esc(b.navn) + '</h3>' + statusPillB(b) + '</div><dl class="kv"><dt>Org.nr</dt><dd>' + esc(b.orgnr || '–') + '</dd><dt>Abonnement</dt><dd>' + esc(planNavn(b.plan)) + (planPris(b.plan) ? ', ' + kr(planPris(b.plan)) + ' per måned eks. mva.' : '') + '</dd>' + (b.prove_til ? '<dt>Prøveperiode til</dt><dd>' + esc(datoKort(b.prove_til)) + '</dd>' : '') + '<dt>Brukerplasser</dt><dd>' + s.aktive + ' av ' + b.maks_brukere + ' i bruk</dd><dt>Prosjekter</dt><dd>' + s.prosjekter + ' aktive, ' + (pr.length - s.prosjekter) + ' arkivert</dd><dt>Kontaktperson</dt><dd>' + esc([b.kontakt_navn, b.kontakt_epost, b.telefon].filter(Boolean).join(', ') || '–') + '</dd></dl><p class="small muted" style="margin:12px 0 0">Vil dere endre abonnement, få flere brukerplasser eller si opp? Kontakt ' + KONTAKT + '.</p></section>' +
      '<section class="panel"><h3>Dataene deres</h3><p class="small muted" style="margin:8px 0 12px">Last ned alle prosjektene til bedriften som én fil, for eksempel som sikkerhetskopi eller før oppsigelse. Filen kan åpnes igjen i Fjelluft Vent.</p><button class="btn" type="button" data-act="eksport-alle">Last ned alle prosjekter (.json)</button></section></div>';
  }

  // Dialoger
  function bedriftDialog(b) {
    var ny = !b; b = b || { plan: 'prove', status: 'aktiv', maks_brukere: (S.planer.find(function (p) { return p.kode === 'prove'; }) || {}).maks_brukere || 3 };
    var proveStd = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
    modal('<h2>' + (ny ? 'Ny kunde' : 'Endre ' + esc(b.navn)) + '</h2><form id="bdForm" class="grid2" novalidate>' +
      '<label class="f" style="grid-column:1/-1"><span>Bedriftsnavn</span><input type="text" id="bd-navn" value="' + esc(b.navn || '') + '" required></label>' +
      '<label class="f"><span>Org.nr</span><input type="text" id="bd-orgnr" inputmode="numeric" value="' + esc(b.orgnr || '') + '"></label>' +
      '<label class="f"><span>Kontaktperson</span><input type="text" id="bd-kontakt_navn" value="' + esc(b.kontakt_navn || '') + '"></label>' +
      '<label class="f"><span>Kontakt e-post</span><input type="email" id="bd-kontakt_epost" value="' + esc(b.kontakt_epost || '') + '"></label>' +
      '<label class="f"><span>Telefon</span><input type="text" id="bd-telefon" value="' + esc(b.telefon || '') + '"></label>' +
      '<label class="f" style="grid-column:1/-1"><span>Fakturaadresse</span><input type="text" id="bd-fakturaadresse" value="' + esc(b.fakturaadresse || '') + '"></label>' +
      '<label class="f"><span>Plan</span><select id="bd-plan">' + S.planer.map(function (p) { return '<option value="' + p.kode + '"' + (p.kode === b.plan ? ' selected' : '') + '>' + esc(p.navn) + (p.pris_mnd ? ' (' + kr(p.pris_mnd) + '/mnd)' : '') + '</option>'; }).join('') + '</select></label>' +
      '<label class="f"><span>Brukerplasser</span><input type="text" inputmode="numeric" id="bd-maks_brukere" value="' + esc(b.maks_brukere) + '"></label>' +
      '<label class="f"><span>Prøveperiode til</span><input type="date" id="bd-prove_til" value="' + esc(b.prove_til || (ny ? proveStd : '')) + '"></label>' +
      (ny ? '' : '<label class="f"><span>Status</span><select id="bd-status">' + Object.keys(STATUS_NAVN).map(function (k) { return '<option value="' + k + '"' + (b.status === k ? ' selected' : '') + '>' + STATUS_NAVN[k] + '</option>'; }).join('') + '</select></label>') +
      '<label class="f" style="grid-column:1/-1"><span>Intern merknad</span><input type="text" id="bd-merknad" value="' + esc(b.merknad || '') + '"></label>' +
      (ny ? '<fieldset style="grid-column:1/-1;border:1px solid var(--line);border-radius:6px;padding:10px 12px;display:grid;gap:8px"><legend class="small muted">Første bruker (eier i bedriften), valgfritt</legend><div class="grid2"><label class="f"><span>E-post</span><input type="email" id="bd-u-epost"></label><label class="f"><span>Navn</span><input type="text" id="bd-u-navn"></label></div></fieldset>' : '') +
      '<p class="small" id="bd-err" role="alert" hidden style="grid-column:1/-1;color:var(--crit);margin:0"></p>' +
      '<div class="modal-actions" style="grid-column:1/-1"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" type="submit">' + (ny ? 'Opprett kunde' : 'Lagre') + '</button></div></form>', function (root) {
      var planSel = root.querySelector('#bd-plan'), maks = root.querySelector('#bd-maks_brukere');
      planSel.addEventListener('change', function () { var p = S.planer.find(function (x) { return x.kode === planSel.value; }); if (p) maks.value = p.maks_brukere; });
      root.querySelector('#bdForm').addEventListener('submit', async function (ev) {
        ev.preventDefault();
        var felt = {}; ['navn', 'orgnr', 'kontakt_navn', 'kontakt_epost', 'telefon', 'fakturaadresse', 'plan', 'maks_brukere', 'prove_til', 'merknad', 'status'].forEach(function (k) { var el = root.querySelector('#bd-' + k); if (el) felt[k] = el.value.trim(); });
        var err = root.querySelector('#bd-err');
        if (!felt.navn) { err.textContent = 'Skriv inn bedriftsnavn.'; err.hidden = false; return; }
        if (felt.plan !== 'prove' && !ny && !root.querySelector('#bd-prove_til').dataset.touched) felt.prove_til = felt.prove_til || '';
        var btn = root.querySelector('button[type=submit]'); btn.disabled = true;
        try {
          var r = await adminKall(ny ? { handling: 'opprett_bedrift', bedrift: felt } : { handling: 'oppdater_bedrift', id: b.id, bedrift: felt });
          var uEpost = ny ? root.querySelector('#bd-u-epost').value.trim() : '';
          if (ny && uEpost) {
            var u = await adminKall({ handling: 'opprett_bruker', bruker: { bedrift_id: r.bedrift.id, epost: uEpost, navn: root.querySelector('#bd-u-navn').value.trim(), rolle: 'eier' } });
            await lastAdmin(); visPassord(u.epost, u.midlertidig_passord, true, r.bedrift.navn);
          } else { closeModal(); await lastAdmin(); toast(ny ? 'Kunden er opprettet' : 'Endringene er lagret'); }
        } catch (e2) { err.textContent = e2.message; err.hidden = false; btn.disabled = false; }
      });
    });
  }
  function brukerDialog() {
    var sup = S.me.superadmin, f = S.adm.filterBedrift !== 'alle' ? S.adm.filterBedrift : S.me.bedrift_id;
    modal('<h2>Ny bruker</h2><form id="buForm" class="stack" novalidate>' +
      (sup ? '<label class="f"><span>Bedrift</span><select id="bu-bedrift">' + S.bedrifter.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === f ? ' selected' : '') + '>' + esc(x.navn) + '</option>'; }).join('') + '</select></label>' : '') +
      '<label class="f"><span>E-post</span><input type="email" id="bu-epost" required></label><label class="f"><span>Navn</span><input type="text" id="bu-navn"></label>' +
      '<label class="f"><span>Rolle</span><select id="bu-rolle">' + Object.keys(ROLLE_NAVN).filter(function (r) { return r !== 'eier' || sup || S.me.rolle === 'eier'; }).map(function (r) { return '<option value="' + r + '"' + (r === 'prosjekterende' ? ' selected' : '') + '>' + ROLLE_NAVN[r] + ': ' + ROLLE_HJELP[r] + '</option>'; }).join('') + '</select></label>' +
      '<p class="small muted" style="margin:0">Brukeren får et midlertidig passord som du gir videre. Ved første innlogging må brukeren velge sitt eget passord.</p>' +
      '<p class="small" id="bu-err" role="alert" hidden style="color:var(--crit);margin:0"></p><div class="modal-actions"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" type="submit">Opprett bruker</button></div></form>', function (root) {
      root.querySelector('#buForm').addEventListener('submit', async function (ev) {
        ev.preventDefault(); var err = root.querySelector('#bu-err'), btn = root.querySelector('button[type=submit]');
        var body = { handling: 'opprett_bruker', bruker: { epost: root.querySelector('#bu-epost').value.trim(), navn: root.querySelector('#bu-navn').value.trim(), rolle: root.querySelector('#bu-rolle').value, bedrift_id: sup ? root.querySelector('#bu-bedrift').value : S.me.bedrift_id } };
        if (!body.bruker.epost) { err.textContent = 'Skriv inn e-postadressen.'; err.hidden = false; return; }
        btn.disabled = true;
        try { var r = await adminKall(body); await lastAdmin(); visPassord(r.epost, r.midlertidig_passord, true, bedriftNavn(body.bruker.bedrift_id)); }
        catch (e2) { err.textContent = e2.message; err.hidden = false; btn.disabled = false; }
      });
    });
  }
  function visPassord(epost, passord, ny, bedrift) {
    var lenke = location.origin + location.pathname;
    var melding = 'Hei!\n\n' + (ny ? 'Du har fått tilgang til Fjelluft Vent' + (bedrift ? ' for ' + bedrift : '') + '.' : 'Passordet ditt til Fjelluft Vent er nullstilt.') + '\n\nLogg inn her: ' + lenke + '\nE-post: ' + epost + '\nMidlertidig passord: ' + passord + '\n\nDu velger ditt eget passord første gang du logger inn.\n';
    modal('<h2>' + (ny ? 'Brukeren er opprettet' : 'Nytt passord er laget') + '</h2><p>Gi denne informasjonen til <b>' + esc(epost) + '</b>. Passordet vises bare én gang.</p>' +
      '<div class="calc" style="font-size:15px">Midlertidig passord: <b id="pwVis">' + esc(passord) + '</b></div>' +
      '<label class="f"><span>Ferdig melding du kan sende</span><textarea id="pwMelding" rows="8" readonly>' + esc(melding) + '</textarea></label>' +
      '<div class="modal-actions"><button class="btn" type="button" data-act="kopier-melding">Kopier melding</button><button class="btn primary" type="button" data-act="modal-close">Ferdig</button></div>');
  }

  async function adminClick(act, a) {
    if (act === 'ny-bedrift') { bedriftDialog(null); return true; }
    if (act === 'rediger-bedrift') { bedriftDialog(S.bedrifter.find(function (b) { return b.id === a.dataset.id; })); return true; }
    if (act === 'vis-brukere') { S.adm.filterBedrift = a.dataset.id; S.atab = 'a-brukere'; renderTabs(); renderMain(); return true; }
    if (act === 'vis-prosjekter') { S.ctx = a.dataset.id; lsSet('fv-ctx', S.ctx); S.side = 'prosjekt'; closeProject(); beregnTilgang(); await lastProsjekter(); return true; }
    if (act === 'ny-bruker') { brukerDialog(); return true; }
    if (act === 'kopier-melding') { var t = $('#pwMelding'); try { await navigator.clipboard.writeText(t.value); toast('Meldingen er kopiert'); } catch (e) { t.select(); toast('Merk teksten og kopier den'); } return true; }
    if (act === 'nullstill') {
      var u = S.adm.brukere.find(function (x) { return x.id === a.dataset.id; });
      modal('<h2>Nytt passord til ' + esc(u.epost) + '?</h2><p>Det gamle passordet slutter å virke med en gang. Brukeren får et midlertidig passord og må velge nytt ved neste innlogging.</p><div class="modal-actions"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" type="button" data-act="nullstill-ok" data-id="' + esc(u.id) + '">Lag nytt passord</button></div>');
      return true;
    }
    if (act === 'nullstill-ok') { try { var r = await adminKall({ handling: 'nullstill_passord', id: a.dataset.id }); await lastAdmin(); visPassord(r.epost, r.midlertidig_passord, false); } catch (e) { toast(e.message); } return true; }
    if (act === 'aktiver') { try { await adminKall({ handling: 'oppdater_bruker', id: a.dataset.id, bruker: { aktiv: a.dataset.v === '1' } }); await lastAdmin(); toast(a.dataset.v === '1' ? 'Brukeren er aktivert' : 'Brukeren er deaktivert og kan ikke logge inn'); } catch (e) { toast(e.message); } return true; }
    if (act === 'slett-bruker') {
      var u2 = S.adm.brukere.find(function (x) { return x.id === a.dataset.id; });
      modal('<h2>Slette ' + esc(u2.epost) + '?</h2><p>Brukeren slettes for godt. Prosjektene brukeren har laget beholdes i bedriften. Vil du bare stenge tilgangen midlertidig, velg Deaktiver i stedet.</p><div class="modal-actions"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" style="background:var(--crit);border-color:var(--crit)" type="button" data-act="slett-bruker-ok" data-id="' + esc(u2.id) + '">Slett brukeren</button></div>');
      return true;
    }
    if (act === 'slett-bruker-ok') { try { await adminKall({ handling: 'slett_bruker', id: a.dataset.id }); closeModal(); await lastAdmin(); toast('Brukeren er slettet'); } catch (e) { toast(e.message); } return true; }
    if (act === 'eksport-alle') {
      var r2 = await sb.from('prosjekter').select('*').eq('bedrift_id', S.me.bedrift_id);
      if (r2.error) { toast('Kunne ikke hente prosjektene.'); return true; }
      saveFile(safeName('Fjelluft Vent ' + (S.bedrift ? S.bedrift.navn : '') + ' alle prosjekter') + '.json', JSON.stringify({ format: 'fjelluft-vent-bedrift', versjon: 1, eksportert: nowIso(), bedrift: S.bedrift, prosjekter: r2.data }, null, 1));
      logg('eksport_alle', S.bedrift ? S.bedrift.navn : null, { antall: r2.data.length }); return true;
    }
    return false;
  }
  async function adminChange(t) {
    if (t.id === 'admBedriftF') { S.adm.filterBedrift = t.value; renderMain(); return true; }
    if (t.dataset.urolle) { try { await adminKall({ handling: 'oppdater_bruker', id: t.dataset.urolle, bruker: { rolle: t.value } }); await lastAdmin(); toast('Rollen er endret'); } catch (e) { toast(e.message); await lastAdmin(); } return true; }
    if (t.dataset.plan) {
      var p = S.planer.find(function (x) { return x.kode === t.dataset.plan; }); var f = t.dataset.pf, v = t.value.trim();
      if (f === 'pris_mnd' || f === 'maks_brukere') { var n = parseInt(v.replace(/\s/g, ''), 10); if (!isFinite(n) || n < 0) { toast('Skriv inn et heltall'); renderMain(); return true; } v = n; }
      var patch = {}; patch[f] = v;
      var r = await sb.from('planer').update(patch).eq('kode', p.kode).select();
      if (r.error || !r.data.length) toast('Kunne ikke lagre planen'); else { Object.assign(p, r.data[0]); toast('Planen er lagret'); }
      return true;
    }
    return false;
  }

  // ---------- Hendelser ----------
  function findRoom(id) { return rom().find(function (r) { return r.id === id; }); }
  function findStr(sid) { return S.data.strekninger.find(function (s) { return s.id === sid; }); }
  var NUM_FIELDS = { areal: 1, personer: 1, senger: 1, tilluftProsj: 1, avtrekkProsj: 1 };

  document.addEventListener('click', async function (e) {
    var atab = e.target.closest('[data-atab]');
    if (atab) { S.atab = atab.dataset.atab; renderTabs(); renderMain(); window.scrollTo(0, 0); return; }
    var a0 = e.target.closest('[data-act]');
    if (a0) {
      var act0 = a0.dataset.act;
      if (act0 === 'logg-ut') { closeModal(); await loggUt(); return; }
      if (act0 === 'side') { flushSave(); S.side = a0.dataset.side; if (S.side === 'admin') { S.adm = null; } if (S.side === 'prosjekt' && !S.pid) { await lastProsjekter(); return; } renderAll(); window.scrollTo(0, 0); return; }
      if (act0 === 'lagre-navn') { var nv0 = $('#pf-navn').value.trim(); var rr = await sb.rpc('oppdater_mitt_navn', { p_navn: nv0 }); if (rr.error) toast('Kunne ikke lagre navnet'); else { S.me.navn = nv0; renderHeader(); toast('Navnet er lagret'); } return; }
      if (act0 === 'konflikt-last') { closeModal(); S.konflikt = false; S.dirty = false; var p0 = S.pid; S.pid = null; await openProject(p0); toast('Siste versjon er lastet inn'); return; }
      if (act0 === 'konflikt-overskriv') { closeModal(); S.konflikt = false; await doSave(true); return; }
      if (act0 === 'archive' || act0 === 'unarchive') { await settArkivert(S.pid, act0 === 'archive'); return; }
      if (S.side === 'admin' && await adminClick(act0, a0)) return;
    }
    var tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { flushSave(); S.tab = tabBtn.dataset.tab; lsSet('fv-tab', S.tab); renderTabs(); renderMain(); window.scrollTo(0, 0); return; }
    var planEl = e.target.closest('[data-plan]');
    if (planEl) { S.sel = planEl.dataset.plan; renderMain(); return; }
    var row = e.target.closest('tr[data-row]');
    if (row && !e.target.closest('input,select,button,textarea')) { S.sel = row.dataset.row; renderMain(); return; }
    var a = e.target.closest('[data-act]'); if (!a) return;
    var act = a.dataset.act;
    if (act === 'modal-bg') { if (e.target === a) closeModal(); return; }
    if (act === 'modal-close') { closeModal(); return; }
    if (act === 'new-project') { newProjectDialog(); return; }
    if (act === 'pick-ifc') { $('#ifcFile').dataset.purpose = 'import'; $('#ifcFile').click(); return; }
    if (act === 'import-confirm') { applyImport($('#impType') ? $('#impType').value : 'bolig'); return; }
    if (act === 'import-json') { $('#jsonFile').click(); return; }
    if (act === 'view') { S.view = a.dataset.v; lsSet('fv-view', S.view); renderMain(); return; }
    if (act === 'goto-room') { S.tab = 'rom'; S.sel = a.dataset.id; S.statusF = 'alle'; S.etasje = 'alle'; S.q = ''; renderTabs(); renderMain(); var tr = document.querySelector('tr[data-row="' + CSS.escape(a.dataset.id) + '"]'); if (tr) tr.scrollIntoView({ block: 'center' }); return; }
    if (act === 'export-csv') { var m1 = meta() || {}; saveFile(safeName('Romskjema ' + (m1.nummer ? m1.nummer + ' ' : '') + m1.navn) + '.csv', FV.csvRomskjema(S.data)); logg('eksport_romskjema', m1.navn); return; }
    if (act === 'export-report') { var m2 = meta() || {}; saveFile(safeName('Ventilasjonsrapport ' + (m2.nummer ? m2.nummer + ' ' : '') + m2.navn) + '.html', reportDocument()); logg('eksport_rapport', m2.navn); return; }
    if (act === 'export-json') { var m3 = meta() || {}; var body = { format: 'fjelluft-vent', versjon: 1, eksportert: nowIso(), prosjekt: Object.assign({}, m3), data: S.data }; delete body.prosjekt.id; delete body.prosjekt.bedrift_id; saveFile(safeName('Fjelluft Vent ' + (m3.nummer ? m3.nummer + ' ' : '') + m3.navn) + '.json', JSON.stringify(body, null, 1)); return; }
    if (act === 'export-ifc') {
      if (S.ifc) { exportIfcWith(S.ifc.text, S.ifc.navn); return; }
      modal('<h2>Velg arkitektens IFC-fil</h2><p>For å legge luftmengdene inn i modellen trenger programmet den samme IFC-filen som ble lest inn' + (S.data.ifc ? ': <b>' + esc(S.data.ifc.filnavn) + '</b>' : '') + '. Filen lagres ikke, den brukes bare til eksporten.</p><div class="modal-actions"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" type="button" data-act="pick-ifc-export">Velg IFC-fil</button></div>');
      return;
    }
    if (act === 'close-detail') { S.sel = null; renderMain(); return; }
    if (act === 'pick-ifc-export') { closeModal(); $('#ifcFile').dataset.purpose = 'export'; $('#ifcFile').click(); return; }
    if (!S.canWrite) return;
    if (act === 'delete-project') {
      var mm = meta();
      modal('<h2>Slette prosjektet?</h2><p>' + esc(mm ? mm.navn : '') + ' med ' + rom().length + ' rom slettes for alle i teamet. Dette kan ikke angres. Last gjerne ned prosjektfilen først.</p><div class="modal-actions"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" style="background:var(--crit);border-color:var(--crit)" type="button" data-act="delete-project-confirm">Slett prosjektet</button></div>');
      return;
    }
    if (act === 'delete-project-confirm') { closeModal(); deleteProject(S.pid); return; }
    if (act === 'add-room') {
      var inn = innst(); var id = uid('m');
      var et = S.etasje !== 'alle' ? S.etasje : (etasjer()[0] || '1. etasje');
      var kote = (rom().find(function (r) { return r.etasje === et; }) || {}).etasjeKote || 0;
      S.data.rom.push({ id: id, guid: null, nummer: '', navn: 'Nytt rom', etasje: et, etasjeKote: kote, areal: null, arealKilde: 'Manuelt', arealManuell: true, type: (meta() || {}).byggtype === 'yrkesbygg' ? 'y_opphold' : 'b_stue', personer: null, senger: null, system: inn.standardSystem, boenhet: 'Boenhet 1', tilluftProsj: null, avtrekkProsj: null, merknad: '' });
      S.sel = id; S.view = 'tabell'; S.statusF = 'alle'; S.q = ''; changed(); renderAll();
      var inp = document.getElementById('r-' + id + '-navn'); if (inp) { inp.focus(); inp.select(); }
      return;
    }
    if (act === 'delete-room') { S.data.rom = rom().filter(function (r) { return r.id !== a.dataset.id; }); S.checked.delete(a.dataset.id); S.sel = null; changed(); renderAll(); toast('Rommet er slettet'); return; }
    if (act === 'bulk-clear') { S.checked.clear(); renderMain(); return; }
    if (act === 'bulk-delete') { var n0 = S.checked.size; S.data.rom = rom().filter(function (r) { return !S.checked.has(r.id); }); S.checked.clear(); S.sel = null; changed(); renderAll(); toast(n0 + ' rom slettet'); return; }
    if (act === 'bulk-apply') {
      var ty = $('#bulkType').value, sy = $('#bulkSystem').value.trim(), bo = $('#bulkBoenhet') ? $('#bulkBoenhet').value.trim() : '';
      if (!ty && !sy && !bo) { toast('Velg romtype, system eller boenhet først'); return; }
      rom().forEach(function (r) { if (!S.checked.has(r.id)) return; if (ty) r.type = ty; if (sy) r.system = sy; if (bo) r.boenhet = bo; });
      var n1 = S.checked.size; S.checked.clear(); changed(); renderAll(); toast(n1 + ' rom oppdatert'); return;
    }
    if (act === 'balanser') {
      var bnavn = a.dataset.b; var liste = rom().filter(function (r) { return (r.boenhet || 'Boenhet 1') === bnavn; });
      var br = FV.balanserBoenhet(liste);
      if (!br.ok) { toast(br.melding); return; }
      changed(); renderAll(); toast(bnavn + ' balansert: tilluft ' + fmt(br.tilluft) + ' og avtrekk ' + fmt(br.avtrekk) + ' m³/h'); return;
    }
    if (act === 'add-strekning') {
      var inn2 = innst(); var sid = uid('s');
      S.data.strekninger.push({ id: sid, navn: 'Strekning ' + (S.data.strekninger.length + 1), system: inn2.standardSystem, side: 'tilluft', deler: [{ id: uid('d'), navn: 'Aggregat til første avgrening', q: null, type: 'hoved', lengde: null, dim: 'auto', zeta: null, komponentPa: null }] });
      changed(); renderMain(); return;
    }
    if (act === 'del-strekning') { S.data.strekninger = S.data.strekninger.filter(function (s) { return s.id !== a.dataset.sid; }); changed(); renderMain(); return; }
    if (act === 'add-del') { var s1 = findStr(a.dataset.sid); if (s1) { var last = s1.deler[s1.deler.length - 1]; s1.deler.push({ id: uid('d'), navn: 'Delstrekning ' + (s1.deler.length + 1), q: null, type: last && last.type === 'gren' ? 'gren' : 'hoved', lengde: null, dim: 'auto', zeta: null, komponentPa: null }); changed(); renderMain(); } return; }
    if (act === 'del-del') { var s2 = findStr(a.dataset.sid); if (s2) { s2.deler = s2.deler.filter(function (d) { return d.id !== a.dataset.did; }); changed(); renderMain(); } return; }
    if (act === 'add-zeta') { var s3 = findStr(a.dataset.sid); var d3 = s3 && s3.deler.find(function (d) { return d.id === a.dataset.did; }); if (d3) { d3.zeta = Math.round(((Number(d3.zeta) || 0) + FV.ZETA[+a.dataset.z].z) * 100) / 100; changed(); renderMain(); } return; }
  });

  document.addEventListener('change', async function (e) {
    var t = e.target;
    if (t.id === 'ctxSel') { flushSave(); S.ctx = t.value; lsSet('fv-ctx', S.ctx); closeProject(); lsSet('fv-pid', ''); beregnTilgang(); await lastProsjekter(); return; }
    if (S.side === 'admin' && await adminChange(t)) return;
    if (t.id === 'projSel') { if (t.value) { flushSave(); openProject(t.value); } return; }
    if (t.id === 'ifcFile') { var f = t.files[0]; var purpose = t.dataset.purpose; t.value = ''; handleIfcFile(f, purpose); return; }
    if (t.id === 'jsonFile') { var jf = t.files[0]; t.value = ''; if (jf) importJson(jf); return; }
    if (t.id === 'etasjeF') { S.etasje = t.value; S.planEtasje = t.value !== 'alle' ? t.value : S.planEtasje; renderMain(); return; }
    if (t.id === 'statusF') { S.statusF = t.value; renderMain(); return; }
    if (t.id === 'planEt') { S.planEtasje = t.value; renderMain(); return; }
    if (t.id === 'htype') { S.hurtig.type = t.value; renderMain(); return; }
    if (t.id === 'chkAll') { filteredRom().forEach(function (r) { if (t.checked) S.checked.add(r.id); else S.checked.delete(r.id); }); renderMain(); return; }
    if (t.dataset.chk) { if (t.checked) S.checked.add(t.dataset.chk); else S.checked.delete(t.dataset.chk); renderMain(); return; }
    if (!S.canWrite) return;
    if (t.dataset.meta) {
      var m = meta(); if (!m) return; var nm = Object.assign({}, m); nm[t.dataset.meta] = t.value.trim();
      if (t.dataset.meta === 'navn' && !nm.navn) { toast('Prosjektet må ha et navn'); t.value = m.navn; return; }
      saveMeta(S.pid, nm).then(function () { S.projects = S.projects.map(function (p) { return p.id === S.pid ? nm : p; }); renderHeader(); if (t.dataset.meta === 'byggtype') later(renderMain); }).catch(function (err) { toast('Kunne ikke lagre (' + (err.code || 'feil') + ')'); });
      return;
    }
    if (t.dataset.innst) {
      var key = t.dataset.innst; var v = key === 'standardSystem' ? t.value.trim() : parseNum(t.value);
      if (key !== 'standardSystem' && (v === null || v <= 0)) { toast('Skriv inn et tall større enn null'); later(renderMain); return; }
      S.data.innstillinger[key] = v; changed(); later(renderMain); return;
    }
    if (t.dataset.f && t.dataset.id) {
      var r = findRoom(t.dataset.id); if (!r) return; var f2 = t.dataset.f;
      if (NUM_FIELDS[f2]) {
        var nv = parseNum(t.value);
        if (t.value.trim() !== '' && nv === null) { toast('Skriv inn et tall, for eksempel 12,5'); later(renderMain); return; }
        if (nv !== null && nv < 0) { toast('Verdien kan ikke være negativ'); later(renderMain); return; }
        r[f2] = nv; if (f2 === 'areal') { r.arealManuell = true; r.arealKilde = 'Manuelt'; }
      } else r[f2] = t.value;
      changed(); later(function () { renderTabs(); renderMain(); }); return;
    }
    if (t.dataset.zadd) { var sz = findStr(t.dataset.sid); var dz = sz && sz.deler.find(function (x) { return x.id === t.dataset.did; }); if (dz && t.value !== '') { dz.zeta = Math.round(((Number(dz.zeta) || 0) + FV.ZETA[+t.value].z) * 100) / 100; changed(); later(renderMain); } return; }
    if (t.dataset.sid) {
      var s = findStr(t.dataset.sid); if (!s) return;
      if (t.dataset.sf) { s[t.dataset.sf] = t.value; changed(); later(renderMain); return; }
      var d = s.deler.find(function (x) { return x.id === t.dataset.did; }); if (!d) return; var df = t.dataset.df;
      if (df === 'q' || df === 'lengde' || df === 'zeta' || df === 'komponentPa') { var nv2 = parseNum(t.value); if (t.value.trim() !== '' && nv2 === null) { toast('Skriv inn et tall'); later(renderMain); return; } d[df] = nv2; }
      else if (df === 'dim') { var dv = t.value.trim().toLowerCase(); if (dv && dv !== 'auto' && !/^\d+$/.test(dv) && !/^\d+\s*[x×*]\s*\d+$/.test(dv)) { toast('Dimensjon skrives som 200 (rund) eller 400x200 (rektangulær)'); later(renderMain); return; } d.dim = dv || 'auto'; }
      else d[df] = t.value;
      changed(); later(renderMain); return;
    }
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'romSok') { S.q = t.value; clearTimeout(S.qt); S.qt = setTimeout(renderMain, 200); return; }
    if (t.id === 'hq') { var v = parseNum(t.value); S.hurtig.q = v === null ? '' : v; clearTimeout(S.ht); S.ht = setTimeout(renderMain, 350); return; }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('#modalRoot').innerHTML) { closeModal(); return; }
    if (e.key === 'Enter' && e.target.matches('td input[type=text]')) { e.target.blur(); }
  });
  // Dra og slipp IFC
  document.addEventListener('dragover', function (e) { var dz = e.target.closest && e.target.closest('#dropZone'); if (dz) { e.preventDefault(); dz.classList.add('over'); } });
  document.addEventListener('dragleave', function (e) { var dz = e.target.closest && e.target.closest('#dropZone'); if (dz) dz.classList.remove('over'); });
  document.addEventListener('drop', function (e) { var dz = e.target.closest && e.target.closest('#dropZone'); if (dz) { e.preventDefault(); dz.classList.remove('over'); if (!S.canWrite) return; handleIfcFile(e.dataTransfer.files[0], 'import'); } });
  $('#newProjBtn').addEventListener('click', newProjectDialog);
  document.addEventListener('submit', async function (e) {
    if (e.target.id === 'loginForm') {
      e.preventDefault(); var err = $('#li-err'), btn = $('#li-btn'); err.hidden = true;
      var ep = $('#li-epost').value, pw = $('#li-pass').value;
      if (!ep || !pw) { err.textContent = 'Skriv inn e-post og passord.'; err.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Logger inn…';
      var feil = await login(ep, pw);
      if (feil) { S.mode = 'login'; renderAll(); var e2 = $('#li-err'); e2.textContent = feil; e2.hidden = false; $('#li-epost').value = ep; $('#li-pass').focus(); }
      return;
    }
    if (e.target.id === 'pwForm') {
      e.preventDefault(); var pe = $('#pw-err'); pe.hidden = true;
      var p1 = $('#pw1').value, p2 = $('#pw2').value;
      if (p1.length < 10) { pe.textContent = 'Passordet må ha minst 10 tegn.'; pe.hidden = false; return; }
      if (p1 !== p2) { pe.textContent = 'Passordene er ikke like.'; pe.hidden = false; return; }
      var r = await sb.auth.updateUser({ password: p1 });
      if (r.error) { pe.textContent = /same|different/i.test(r.error.message) ? 'Velg et annet passord enn det midlertidige.' : /weak|pwned|leaked/i.test(r.error.message) ? 'Passordet er for svakt eller kjent fra lekkasjer. Velg et annet.' : 'Kunne ikke lagre passordet: ' + r.error.message; pe.hidden = false; return; }
      await sb.rpc('passord_byttet');
      toast('Passordet er lagret');
      if (S.mode === 'bytt-passord') { S.me.ma_bytte_passord = false; S.mode = 'app'; beregnTilgang(); await lastProsjekter(); }
      else { $('#pw1').value = ''; $('#pw2').value = ''; }
      return;
    }
  });

  function newProjectDialog() {
    if (!S.canWrite) return;
    modal('<h2>Nytt prosjekt</h2><form id="npForm" class="grid2" novalidate>' +
      '<label class="f" style="grid-column:1/-1"><span>Prosjektnavn</span><input type="text" id="np-navn" required placeholder="For eksempel Enebolig Haugveien 12"></label>' +
      '<label class="f"><span>Prosjektnummer</span><input type="text" id="np-nummer" placeholder="Valgfritt"></label>' +
      '<label class="f"><span>Byggtype</span><select id="np-byggtype"><option value="bolig">Bolig</option><option value="yrkesbygg">Yrkesbygg / publikumsbygg</option></select></label>' +
      '<label class="f" style="grid-column:1/-1"><span>Adresse</span><input type="text" id="np-adresse" placeholder="Valgfritt"></label>' +
      '<p class="small muted" id="np-err" style="grid-column:1/-1;margin:0;color:var(--crit)" hidden>Skriv inn et prosjektnavn.</p>' +
      '<div class="modal-actions" style="grid-column:1/-1"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" type="submit">Opprett prosjekt</button></div></form>', function (root) {
      root.querySelector('#npForm').addEventListener('submit', function (ev) {
        ev.preventDefault(); var navn = $('#np-navn').value.trim();
        if (!navn) { $('#np-err').hidden = false; $('#np-navn').focus(); return; }
        var m = { navn: navn, nummer: $('#np-nummer').value.trim(), byggtype: $('#np-byggtype').value, adresse: $('#np-adresse').value.trim() };
        closeModal(); S.tab = 'oversikt'; createProject(m);
      });
    });
  }
  async function importJson(file) {
    try {
      var body = JSON.parse(await file.text());
      if (!body || body.format !== 'fjelluft-vent' || !body.data) throw new Error('Filen er ikke en prosjektfil fra Fjelluft Vent.');
      var m = body.prosjekt || {}; m.navn = (m.navn || 'Importert prosjekt') + (S.projects.some(function (p) { return p.navn === m.navn; }) ? ' (kopi)' : '');
      await createProject(m, body.data);
    } catch (e) { toast(e.message || 'Kunne ikke lese prosjektfilen'); }
  }

  window.addEventListener('beforeunload', function () { flushSave(); });
  init();
})();
