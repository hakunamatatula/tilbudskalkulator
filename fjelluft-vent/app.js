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
  var TABS = [['oversikt', 'Oversikt'], ['rom', 'Rom og luftmengder'], ['tegning', 'Tegning'], ['systemer', 'Systemer'], ['kanaler', 'Kanaler og trykkfall'], ['rapport', 'Rapport og eksport'], ['grunnlag', 'Beregningsgrunnlag']];

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
  var BEDRIFT_KOL = 'id,navn,orgnr,kontakt_navn,kontakt_epost,telefon,fakturaadresse,plan,status,maks_brukere,prove_til,opprettet,endret,stripe_customer_id,stripe_subscription_id,betaling_status,abonnement_til,registrert_selv';
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
    var res = await Promise.all([sb.from('bedrifter').select(BEDRIFT_KOL).order('navn'), sb.from('planer').select('*').order('sortering')]);
    S.bedrifter = res[0].data || []; S.planer = res[1].data || [];
    S.bedrift = S.bedrifter.find(function (b) { return b.id === S.me.bedrift_id; }) || null;
    var lagretCtx = lsGet('fv-ctx');
    S.ctx = S.me.superadmin && lagretCtx && S.bedrifter.some(function (b) { return b.id === lagretCtx; }) ? lagretCtx : S.me.bedrift_id;
    if (nyInnlogging) sb.rpc('registrer_innlogging').then(function () { /* logget */ });
    if (S.me.ma_bytte_passord) { S.mode = 'bytt-passord'; renderAll(); return; }
    S.mode = 'app'; beregnTilgang();
    await lastProsjekter();
    sjekkBetalingRetur();
  }

  // Retur fra Stripe Checkout (?betaling=ok / ?betaling=avbrutt)
  function sjekkBetalingRetur() {
    var q = new URLSearchParams(location.search), v = q.get('betaling'); if (!v) return;
    q.delete('betaling'); try { history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash); } catch (e) { /* ikke støttet */ }
    if (v === 'avbrutt') { toast('Betalingen ble avbrutt. Ingenting er trukket.'); return; }
    toast('Takk! Vi aktiverer abonnementet…');
    var forsok = 0;
    (async function sjekk() {
      forsok++;
      var r = await sb.from('bedrifter').select(BEDRIFT_KOL).eq('id', S.me.bedrift_id).maybeSingle();
      if (r.data) {
        var i = S.bedrifter.findIndex(function (b) { return b.id === r.data.id; });
        if (i >= 0) S.bedrifter[i] = r.data; else S.bedrifter.push(r.data);
        S.bedrift = r.data;
        if (r.data.plan !== 'prove' && r.data.betaling_status === 'ok') { beregnTilgang(); S.adm = null; renderAll(); toast('Abonnementet ' + (S.planer.find(function (p) { return p.kode === r.data.plan; }) || { navn: r.data.plan }).navn + ' er aktivt. Takk!'); return; }
      }
      if (forsok < 12) setTimeout(sjekk, 2500); else toast('Betalingen er mottatt. Abonnementet vises om litt. Last siden på nytt om det ikke oppdateres.');
    })();
  }

  // Selvregistrering
  async function registrerKall(body) {
    var r = await sb.functions.invoke('vent-registrer', { body: body });
    if (r.error) {
      var msg = 'Noe gikk galt. Prøv igjen, eller kontakt ' + KONTAKT + '.';
      try { var j = await r.error.context.json(); if (j && j.feil) msg = j.feil; } catch (e) { /* ingen detaljer */ }
      throw new Error(msg);
    }
    return r.data;
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
    var vs = document.querySelector('.brand span'); if (vs) vs.textContent = 'v0.3';
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
      var kjop = b.id === S.me.bedrift_id && (S.me.rolle === 'eier' || S.me.rolle === 'admin') && !(S.side === 'admin' && S.atab === 'a-bedrift');
      var knapp = kjop ? ' <button class="btn sm primary" type="button" data-act="til-abonnement">Velg abonnement</button>' : '';
      var hvem = kjop ? '' : ' Be eieren av bedriften velge abonnement' + (S.me.superadmin ? '' : ', eller kontakt ' + KONTAKT) + '.';
      if (dager < 0) h += '<div class="banner">Prøveperioden gikk ut ' + esc(datoKort(b.prove_til)) + '. Prosjektene kan leses, men ikke endres før dere velger abonnement.' + hvem + knapp + '</div>';
      else if (dager <= 7 || S.side !== 'admin') h += '<div class="banner' + (dager <= 7 ? '' : ' info') + '">Prøveperiode: ' + dager + ' ' + (dager === 1 ? 'dag' : 'dager') + ' igjen (til ' + esc(datoKort(b.prove_til)) + ').' + (dager <= 7 ? ' Velg abonnement for å fortsette uten avbrudd.' + hvem : '') + knapp + '</div>';
    }
    if (b.betaling_status === 'feilet' && b.status === 'aktiv') h += '<div class="banner">Siste betaling for abonnementet feilet. Oppdater kortet for å unngå at tilgangen stenges.' + (b.id === S.me.bedrift_id && (S.me.rolle === 'eier' || S.me.rolle === 'admin') ? ' <button class="btn sm primary" type="button" data-act="betalingsportal">Oppdater kort</button>' : ' Gi beskjed til eieren av bedriften.') + '</div>';
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
        var fn = { oversikt: renderOversikt, rom: renderRom, tegning: renderTegning, systemer: renderSystemer, kanaler: renderKanaler, rapport: renderRapport, grunnlag: renderGrunnlag }[S.tab] || renderOversikt;
        html += fn();
      }
    }
    main.innerHTML = html;
    if (S.mode === 'app' && S.side === 'prosjekt' && S.data && S.tab === 'tegning') bindTegning();
    if (active) { var el = document.getElementById(active); if (el) { el.focus(); if (el.select && el.type !== 'select-one') try { el.select(); } catch (e) { /* ikke støttet */ } } }
    window.scrollTo(0, scroll);
  }
  function later(fn) { setTimeout(fn, 0); }
  function bindPlan() { /* klikk håndteres via delegering */ }

  // ---------- Innlogging og profil ----------
  function renderLogin() {
    var reg = S.loginVisning === 'registrer';
    return '<div class="login">' +
      '<section class="login-pitch"><h1>Prosjekter ventilasjon fra arkitektens IFC</h1><p>Fjelluft Vent leser rommene i arkitektmodellen, beregner luftmengder etter TEK17, dimensjonerer kanaler og lager romskjema, beregningsrapport og IFC med luftmengder tilbake til BIM-koordineringen.</p><ul><li>Ingen installasjon, kjører i nettleseren</li><li>Åpent IFC-format inn og ut, PDF- og PNG-plantegninger som underlag</li><li>Beregninger med kilde og forklaring for hvert rom</li><li>30 dager gratis, uten kort. Deretter fra 990 kr/mnd eks. mva., ingen bindingstid</li></ul>' +
      (reg ? '' : '<div class="row" style="margin-top:6px"><button class="btn primary" type="button" data-act="vis-registrer">Prøv gratis i 30 dager</button></div>') + '</section>' +
      (reg ? renderRegistrer() :
      '<section class="panel login-box"><h2>Logg inn</h2><form id="loginForm" novalidate class="stack">' +
      '<label class="f"><span>E-post</span><input type="email" id="li-epost" autocomplete="username" required></label>' +
      '<label class="f"><span>Passord</span><input type="password" id="li-pass" autocomplete="current-password" required></label>' +
      '<p class="small" id="li-err" role="alert" hidden style="color:var(--crit);margin:0"></p>' +
      '<button class="btn primary" type="submit" id="li-btn">Logg inn</button>' +
      '<p class="small muted" style="margin:0">Glemt passordet? Be administratoren i bedriften din om å nullstille det, eller kontakt ' + KONTAKT + '.</p>' +
      '<p class="small" style="margin:0">Ny her? <a href="#" data-act="vis-registrer">Registrer bedriften og prøv gratis</a></p></form></section>') + '</div>';
  }
  function renderRegistrer() {
    return '<section class="panel login-box"><h2>Prøv gratis i 30 dager</h2><p class="small muted" style="margin:-4px 0 0">Ingen kort, ingen binding. Du blir eier av bedriftskontoen og kan invitere kolleger.</p><form id="regForm" novalidate class="stack">' +
      '<label class="f"><span>Organisasjonsnummer</span><input type="text" id="rg-orgnr" inputmode="numeric" autocomplete="off" maxlength="11" placeholder="9 siffer" required></label>' +
      '<p class="small muted" id="rg-brreg" style="margin:-6px 0 0" aria-live="polite"></p>' +
      '<label class="f"><span>Bedriftsnavn</span><input type="text" id="rg-bedrift" autocomplete="organization" required></label>' +
      '<label class="f"><span>Ditt navn</span><input type="text" id="rg-navn" autocomplete="name" required></label>' +
      '<label class="f"><span>E-post (jobb)</span><input type="email" id="rg-epost" autocomplete="email" required></label>' +
      '<label class="f"><span>Telefon (valgfritt)</span><input type="text" inputmode="tel" id="rg-telefon" autocomplete="tel"></label>' +
      '<label class="f"><span>Velg passord (minst 10 tegn)</span><input type="password" id="rg-passord" autocomplete="new-password" minlength="10" required></label>' +
      '<label class="f hp" aria-hidden="true"><span>Nettside</span><input type="text" id="rg-nettside" tabindex="-1" autocomplete="off"></label>' +
      '<label class="check small"><input type="checkbox" id="rg-vilkar"> <span>Jeg godtar <a href="https://fjelluft.no/vent-vilkar/" target="_blank" rel="noopener">vilkårene</a> og at Fjelluft behandler opplysningene i tråd med <a href="https://fjelluft.no/personvern/" target="_blank" rel="noopener">personvernerklæringen</a>.</span></label>' +
      '<p class="small" id="rg-err" role="alert" hidden style="color:var(--crit);margin:0"></p>' +
      '<button class="btn primary" type="submit" id="rg-btn">Start prøveperioden</button>' +
      '<p class="small" style="margin:0">Har dere konto allerede? <a href="#" data-act="vis-logginn">Logg inn</a>. Er bedriften registrert, be eieren legge deg til som bruker.</p></form></section>';
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
    var sjekk = '';
    if (!S.projects.length && b && b.id === S.me.bedrift_id && !S.me.superadmin) {
      var admin = S.me.rolle === 'eier' || S.me.rolle === 'admin';
      var steg = [[true, 'Bedriften er registrert', b.plan === 'prove' && b.prove_til ? 'Prøveperioden varer til ' + datoKort(b.prove_til) + '.' : ''], [false, 'Opprett første prosjekt', 'Gi det navn og prosjektnummer, så last inn IFC eller en PDF-plantegning.']];
      if (admin) steg.push([false, 'Inviter kollegene dine', 'Under Administrasjon → Brukere. Prøveperioden har plass til ' + b.maks_brukere + ' brukere.', 'side', 'admin']);
      if (admin && b.plan === 'prove') steg.push([false, 'Velg abonnement før prøveperioden går ut', 'Betal med kort, faktura med mva. på e-post. Ingen binding.', 'til-abonnement']);
      sjekk = '<section class="panel"><h3>Kom i gang</h3><ul class="onboard">' + steg.map(function (x) { return '<li class="' + (x[0] ? 'ferdig' : '') + '"><span class="ob-ikon" aria-hidden="true">' + (x[0] ? '✓' : '') + '</span><div><b>' + esc(x[1]) + '</b>' + (x[2] ? '<div class="small muted">' + esc(x[2]) + '</div>' : '') + '</div>' + (x[3] ? '<button class="btn sm" type="button" data-act="' + x[3] + '"' + (x[4] ? ' data-side="' + x[4] + '"' : '') + '>Gå dit</button>' : '') + '</li>'; }).join('') + '</ul></section>';
    }
    return sjekk + '<section class="panel empty">' +
      '<h2>' + (S.projects.length ? 'Velg et prosjekt' : 'Velkommen til Fjelluft Vent') + '</h2>' +
      '<p class="muted">Prosjektene til ' + esc(b ? b.navn : 'bedriften') + ' ligger her og deles med alle i bedriften.</p>' +
      '<ol class="steps"><li>Opprett et prosjekt.</li><li>Last inn arkitektens IFC-fil. Rommene hentes automatisk med areal og etasje. Har du bare PDF eller PNG, bruk fanen Tegning.</li><li>Kontroller romtyper, personer og senger. Luftmengdene regnes ut fortløpende.</li><li>Dimensjoner kanalene og eksporter rapport og IFC.</li></ol>' +
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
    html += '<section class="panel"><div class="panel-h"><div><h3>Trykkfallsberegning</h3><p class="small muted" style="margin:4px 0 0">Legg inn strekningen fra aggregatet til ventilen lengst unna, delt opp der luftmengden endres. Den strekningen med høyest trykkfall per system og side er kritisk og bestemmer viftens eksterne trykk.</p></div><div class="row"><button class="btn" type="button" data-act="tg-til-kanaler"' + dis() + '>Hent fra tegningen</button><button class="btn primary" type="button" data-act="add-strekning"' + dis() + '>+ Ny strekning</button></div></div>';
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
    eksport_rapport: 'Lastet ned rapport for', eksport_romskjema: 'Lastet ned romskjema for', eksport_alle: 'Lastet ned alle prosjekter', bedrift_slettet: 'Slettet bedrift', superadmin_opprettet: 'Opprettet Fjelluft-administrator',
    bedrift_registrert: 'Registrerte bedriften', betaling_startet: 'Startet betaling for', abonnement_byttet: 'Byttet abonnement til', abonnement_oppdatert: 'Abonnement oppdatert:', faktura_betalt: 'Faktura betalt', betaling_feilet: 'Betaling feilet for faktura',
    stripe_oppsett: 'Koblet til Stripe', stripe_nokkel_lagret: 'Lagret Stripe-nøkkel', plantegning_lastet: 'Lastet opp plantegning i', eksport_tegning: 'Eksporterte tegning fra'
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
      sb.from('bedrifter').select(BEDRIFT_KOL).order('navn'),
      sb.from('profiler').select('*').order('epost'),
      sb.from('prosjekter').select('id,bedrift_id,endret,arkivert'),
      sb.from('aktivitet').select('*').order('tid', { ascending: false }).limit(400),
      sb.from('planer').select('*').order('sortering'),
      S.me.superadmin ? adminKall({ handling: 'hent_intern' }).catch(function () { return { intern: [] }; }) : Promise.resolve({ intern: [] })
    ]);
    var intern = {}; (res[5].intern || []).forEach(function (x) { intern[x.bedrift_id] = x.merknad || ''; });
    S.bedrifter = res[0].data || S.bedrifter; S.bedrift = S.bedrifter.find(function (b) { return b.id === S.me.bedrift_id; }) || S.bedrift;
    S.planer = res[4].data || S.planer;
    S.adm = { brukere: res[1].data || [], prosjekter: res[2].data || [], aktivitet: res[3].data || [], intern: intern, stripe: S.adm && S.adm.stripe, lastet: true, laster: false, filterBedrift: (S.adm && S.adm.filterBedrift) || (S.me.superadmin ? 'alle' : S.me.bedrift_id) };
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
        '<td><div class="row" style="flex-wrap:nowrap;gap:4px"><button class="btn sm" type="button" data-act="rediger-bedrift" data-id="' + esc(b.id) + '">Endre</button><button class="btn sm ghost" type="button" data-act="vis-brukere" data-id="' + esc(b.id) + '">Brukere</button><button class="btn sm ghost" type="button" data-act="vis-prosjekter" data-id="' + esc(b.id) + '">Prosjekter</button>' + (b.id !== S.me.bedrift_id ? '<button class="btn sm ghost danger" type="button" data-act="slett-bedrift" data-id="' + esc(b.id) + '">Slett</button>' : '') + '</div></td></tr>';
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
      '</tbody></table></div><p class="small muted" style="margin:10px 0 0">Planene Start, Proff og Bedrift kan kjøpes på nett. Har du endret en pris, trykk «Synkroniser priser med Stripe» under. Eksisterende abonnenter beholder gammel pris til du flytter dem.</p></section>' + stripePanel();
  }
  function stripePanel() {
    var st = S.adm.stripe;
    if (!st) { adminKall({ handling: 'stripe_status' }).then(function (r) { S.adm.stripe = r; if (S.atab === 'a-planer') renderMain(); }).catch(function (e) { S.adm.stripe = { feil: e.message }; if (S.atab === 'a-planer') renderMain(); }); return '<section class="panel muted">Henter betalingsoppsett…</section>'; }
    if (st.feil) return '<section class="panel"><h3>Betaling med Stripe</h3><p class="small" style="color:var(--crit)">' + esc(st.feil) + '</p></section>';
    var klar = st.nokkel && st.webhook && (st.planer || []).every(function (p) { return p.stripe_price_id; });
    var pill = !st.nokkel ? '<span class="pill warn">Ikke koblet til</span>' : klar ? '<span class="pill ' + (st.modus === 'live' ? 'ok' : 'info') + '">' + (st.modus === 'live' ? 'Live: tar ekte betaling' : 'Testmodus') + '</span>' : '<span class="pill warn">Nøkkel lagret, ikke synkronisert</span>';
    return '<section class="panel"><div class="panel-h"><div><h3>Betaling med Stripe</h3><p class="small muted" style="margin:4px 0 0">Kundene betaler med kort i Stripe og får faktura med 25 % mva. på e-post. Abonnementet fornyes hver måned og oppdateres automatisk her.</p></div>' + pill + '</div>' +
      '<ol class="steps small" style="margin:6px 0 14px"><li>Opprett konto på <a href="https://dashboard.stripe.com/register" target="_blank" rel="noopener">stripe.com</a> med Fjelluft AS sitt org.nr og bankkonto.</li><li>Gå til Utviklere → API-nøkler i Stripe og kopier <b>hemmelig nøkkel</b>. Start med testnøkkelen (sk_test_…).</li><li>Lim inn nøkkelen under og trykk Lagre. Trykk deretter «Koble til Stripe».</li><li>Test et kjøp med kortnummer 4242 4242 4242 4242, en fremtidig dato og valgfri CVC. Når alt virker: gjenta med live-nøkkelen (sk_live_…).</li></ol>' +
      '<form id="stripeForm" class="row" style="gap:8px;flex-wrap:wrap" novalidate><input type="password" id="st-nokkel" autocomplete="off" placeholder="' + (st.nokkel ? 'Nøkkel lagret. Lim inn ny for å bytte' : 'sk_test_…') + '" style="flex:1;min-width:240px" aria-label="Stripe hemmelig nøkkel"><button class="btn" type="submit">Lagre nøkkel</button><button class="btn primary" type="button" data-act="stripe-oppsett"' + (st.nokkel ? '' : ' disabled') + '>' + (klar ? 'Synkroniser priser med Stripe' : 'Koble til Stripe') + '</button></form>' +
      '<p class="small" id="st-err" role="alert" hidden style="color:var(--crit);margin:8px 0 0"></p>' +
      (st.planer && st.planer.length ? '<dl class="kv" style="margin-top:12px">' + st.planer.map(function (p) { return '<dt>' + esc(p.navn) + '</dt><dd>' + kr(p.pris_mnd) + '/mnd ' + (p.stripe_price_id ? '<span class="pill ok">Klar for salg</span>' : '<span class="pill warn">Ikke i Stripe ennå</span>') + '</dd>'; }).join('') + '</dl>' : '') +
      '<p class="small muted" style="margin:10px 0 0">Nøkkelen sjekkes mot Stripe og lagres i en lukket tabell som bare serveren kan lese. Den vises aldri igjen, verken for deg eller kundene.</p></section>';
  }

  function abonnementPanel(b) {
    var kanKjope = S.planer.filter(function (p) { return p.kan_kjopes; });
    var aktivtAbo = b.stripe_subscription_id && b.betaling_status && b.betaling_status !== 'avsluttet';
    var kort = kanKjope.map(function (p) {
      var dette = aktivtAbo && b.plan === p.kode;
      return '<div class="plankort' + (dette ? ' valgt' : '') + '"><h4>' + esc(p.navn) + '</h4><div class="pris">' + kr(p.pris_mnd) + '<small> / mnd eks. mva.</small></div><p class="small muted">' + esc(p.beskrivelse || '') + '</p><p class="small">Inntil ' + p.maks_brukere + ' brukere</p>' +
        (dette ? '<span class="pill ok">Nåværende plan</span>' : '<button class="btn' + (p.kode === 'proff' ? ' primary' : '') + '" type="button" data-act="velg-plan" data-plan="' + esc(p.kode) + '">' + (aktivtAbo ? 'Bytt til ' + esc(p.navn) : 'Velg ' + esc(p.navn)) + '</button>') + '</div>';
    }).join('');
    var tekst = aktivtAbo ? 'Abonnementet fornyes automatisk hver måned' + (b.abonnement_til ? ', neste gang ' + esc(datoKort(b.abonnement_til)) : '') + '. Bytter dere plan, regnes mellomlegget ut automatisk på neste faktura.' : b.plan === 'prove' ? 'Velg plan for å fortsette etter prøveperioden. Dere betaler med kort og får faktura med mva. på e-post. Ingen bindingstid, si opp når som helst.' : 'Dere har i dag en avtale med Fjelluft utenom nettbetaling. Ta kontakt med ' + KONTAKT + ' om dere vil endre den.';
    return '<section class="panel" style="grid-column:1/-1"><div class="panel-h"><h3>Abonnement</h3>' + (b.betaling_status === 'feilet' ? '<span class="pill warn">Betaling feilet</span>' : '') + '</div><p class="small muted" style="margin:4px 0 14px">' + tekst + '</p>' +
      (kanKjope.length && (aktivtAbo || b.plan === 'prove' || !b.plan) ? '<div class="plangrid">' + kort + '</div>' : '') +
      (b.stripe_customer_id ? '<div class="row" style="margin-top:14px"><button class="btn" type="button" data-act="betalingsportal">Kort, fakturaer og oppsigelse</button></div>' : '') + '</section>';
  }

  function admBedrift() {
    var b = S.bedrift; if (!b) return '<div class="panel muted">Fant ikke bedriften.</div>';
    var s = bedriftStats(b);
    var pr = S.adm.prosjekter.filter(function (p) { return p.bedrift_id === b.id; });
    return '<div class="grid2" style="align-items:start"><section class="panel"><div class="panel-h"><h3>' + esc(b.navn) + '</h3>' + statusPillB(b) + '</div><dl class="kv"><dt>Org.nr</dt><dd>' + esc(b.orgnr || '–') + '</dd><dt>Abonnement</dt><dd>' + esc(planNavn(b.plan)) + (planPris(b.plan) ? ', ' + kr(planPris(b.plan)) + ' per måned eks. mva.' : '') + '</dd>' + (b.prove_til ? '<dt>Prøveperiode til</dt><dd>' + esc(datoKort(b.prove_til)) + '</dd>' : '') + '<dt>Brukerplasser</dt><dd>' + s.aktive + ' av ' + b.maks_brukere + ' i bruk</dd><dt>Prosjekter</dt><dd>' + s.prosjekter + ' aktive, ' + (pr.length - s.prosjekter) + ' arkivert</dd><dt>Kontaktperson</dt><dd>' + esc([b.kontakt_navn, b.kontakt_epost, b.telefon].filter(Boolean).join(', ') || '–') + '</dd></dl><p class="small muted" style="margin:12px 0 0">Spørsmål om abonnementet? Kontakt ' + KONTAKT + '.</p></section>' +
      '<section class="panel"><h3>Dataene deres</h3><p class="small muted" style="margin:8px 0 12px">Last ned alle prosjektene til bedriften som én fil, for eksempel som sikkerhetskopi eller før oppsigelse. Filen kan åpnes igjen i Fjelluft Vent.</p><button class="btn" type="button" data-act="eksport-alle">Last ned alle prosjekter (.json)</button></section>' + (S.me.rolle === 'eier' || S.me.rolle === 'admin' ? abonnementPanel(b) : '') + '</div>';
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
      '<label class="f" style="grid-column:1/-1"><span>Intern merknad</span><input type="text" id="bd-merknad" value="' + esc((S.adm && S.adm.intern && S.adm.intern[b.id]) || '') + '"></label><p class="small muted" style="grid-column:1/-1;margin:-4px 0 0">Merknaden er bare synlig for Fjelluft, ikke for kunden.</p>' +
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
    if (act === 'slett-bedrift') {
      var sb0 = S.bedrifter.find(function (x) { return x.id === a.dataset.id; }); if (!sb0) return true;
      var st0 = bedriftStats(sb0), npr = S.adm.prosjekter.filter(function (p) { return p.bedrift_id === sb0.id; }).length;
      modal('<h2>Slette ' + esc(sb0.navn) + '?</h2><p>Dette sletter for godt bedriften, alle ' + st0.brukere + ' brukere og alle ' + npr + ' prosjekter. Det kan ikke angres. Vil du bare stenge tilgangen, velg Endre og sett status til Sperret eller Avsluttet i stedet.</p>' +
        '<form id="sbForm" class="stack" novalidate><label class="f"><span>Skriv <b>' + esc(sb0.navn) + '</b> for å bekrefte</span><input type="text" id="sb-navn" autocomplete="off"></label><p class="small" id="sb-err" role="alert" hidden style="color:var(--crit);margin:0"></p>' +
        '<div class="modal-actions"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" style="background:var(--crit);border-color:var(--crit)" type="submit" disabled>Slett bedriften for godt</button></div></form>', function (root) {
        var inp = root.querySelector('#sb-navn'), btn = root.querySelector('button[type=submit]'), err = root.querySelector('#sb-err');
        inp.addEventListener('input', function () { btn.disabled = inp.value.trim() !== sb0.navn; });
        root.querySelector('#sbForm').addEventListener('submit', async function (ev) {
          ev.preventDefault(); if (inp.value.trim() !== sb0.navn) return; btn.disabled = true; btn.textContent = 'Sletter…';
          try {
            var r = await adminKall({ handling: 'slett_bedrift', id: sb0.id, bekreft: inp.value.trim() });
            if (S.ctx === sb0.id) { S.ctx = S.me.bedrift_id; lsSet('fv-ctx', S.ctx); }
            closeModal(); await lastAdmin(); toast(sb0.navn + ' er slettet med ' + r.brukere + ' brukere og ' + r.prosjekter + ' prosjekter');
          } catch (e3) { err.textContent = e3.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Slett bedriften for godt'; }
        });
      });
      return true;
    }
    if (act === 'velg-plan') {
      var kode = a.dataset.plan, pl = S.planer.find(function (x) { return x.kode === kode; });
      a.disabled = true; var tekst0 = a.textContent; a.textContent = 'Åpner betaling…';
      try {
        var rk = await adminKall({ handling: 'kjop', plan: kode });
        if (rk.url) { location.href = rk.url; return true; }
        if (rk.byttet) { toast('Abonnementet er byttet til ' + (pl ? pl.navn : kode)); setTimeout(function () { S.adm = null; lastBruker(false).then(function () { S.side = 'admin'; S.atab = 'a-bedrift'; renderAll(); }); }, 2500); }
      } catch (e) { toast(e.message); a.disabled = false; a.textContent = tekst0; }
      return true;
    }
    if (act === 'betalingsportal') { a.disabled = true; try { var rp = await adminKall({ handling: 'portal' }); location.href = rp.url; } catch (e) { toast(e.message); a.disabled = false; } return true; }
    if (act === 'stripe-oppsett') {
      a.disabled = true; a.textContent = 'Kobler til…'; var se = $('#st-err'); se.hidden = true;
      try { var ro = await adminKall({ handling: 'stripe_oppsett' }); S.adm.stripe = null; var rs = await adminKall({ handling: 'stripe_status' }); S.adm.stripe = rs; var rp2 = await sb.from('planer').select('*').order('sortering'); if (rp2.data) S.planer = rp2.data; renderMain(); toast(ro.rapport.length ? 'Stripe er klart (' + ro.modus + '): ' + ro.rapport.join(', ') : 'Stripe er allerede oppdatert'); }
      catch (e) { se.textContent = e.message; se.hidden = false; a.disabled = false; a.textContent = 'Koble til Stripe'; }
      return true;
    }
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

  async function stripeNokkelSubmit(form) {
    var inp = form.querySelector('#st-nokkel'), err = $('#st-err'), k = inp.value.trim(); err.hidden = true;
    if (!k) { err.textContent = 'Lim inn den hemmelige nøkkelen fra Stripe.'; err.hidden = false; return; }
    if (/^pk_/.test(k)) { err.textContent = 'Dette er den publiserbare nøkkelen (pk_). Bruk den hemmelige nøkkelen som starter med sk_.'; err.hidden = false; return; }
    var btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'Sjekker…';
    try { S.adm.stripe = await adminKall({ handling: 'stripe_lagre_nokkel', nokkel: k }); inp.value = ''; renderMain(); toast('Nøkkelen er godkjent av Stripe og lagret'); }
    catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Lagre nøkkel'; }
  }

  // ---------- Tegning ----------
  var TG_SIDER = {
    tilluft: { navn: 'Tilluft', farge: 'var(--supply)', fast: '#1d64a6' },
    avtrekk: { navn: 'Avtrekk', farge: 'var(--exhaust)', fast: '#b0532a' },
    uteluft: { navn: 'Uteluft', farge: 'var(--uteluft)', fast: '#2f8a57' },
    avkast: { navn: 'Avkast', farge: 'var(--avkast)', fast: '#7a5aa6' }
  };
  var TG_VERKTOY = [
    ['velg', 'Velg', 'Velg, flytt og endre. Dra i tomt område for å flytte tegningen.'],
    ['kanal', 'Kanal', 'Klikk for hvert knekkpunkt. Dobbeltklikk, Enter eller klikk på en ventil for å avslutte. Kanalen retter seg etter 90° og 45° (hold Alt for fri vinkel).'],
    ['ventil', 'Ventil', 'Klikk i et rom for å plassere en ventil. Luftmengden hentes fra rommet. Med Uteluft eller Avkast valgt blir det en rist.'],
    ['aggregat', 'Aggregat', 'Klikk for å plassere aggregatet. Kanalene regnes ut fra aggregatet og ut til ventilene.'],
    ['rom', 'Rom', 'Klikk hjørnene i rommet. Klikk på første punkt eller trykk Enter for å lukke. Arealet regnes ut av målestokken.'],
    ['maal', 'Mål', 'Klikk to punkter for å måle avstanden.'],
    ['kalib', 'Målestokk', 'Klikk to punkter med kjent avstand, for eksempel endene av en vegg med målsetting. Skriv deretter inn lengden.']
  ];
  var PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

  function tgData() {
    if (!S.data.tegning) S.data.tegning = { etasjer: {}, elementer: [], innst: { ventilPa: 30, ristPa: 15 } };
    var t = S.data.tegning; if (!t.etasjer) t.etasjer = {}; if (!t.elementer) t.elementer = []; if (!t.innst) t.innst = { ventilPa: 30, ristPa: 15 };
    return t;
  }
  function tgS() {
    if (!S.tg || S.tg.pid !== S.pid) S.tg = { pid: S.pid, verktoy: 'velg', side: 'tilluft', etasje: null, view: null, utkast: [], valgt: null, bilder: {}, hist: [], fremtid: [], visRom: true, mus: null, drag: null, res: null };
    return S.tg;
  }
  function tgEtasjer() {
    var t = tgData(), seen = {}, out = [];
    sortRom(rom()).forEach(function (r) { if (r.etasje && !seen[r.etasje]) { seen[r.etasje] = 1; out.push(r.etasje); } });
    Object.keys(t.etasjer).concat(t.elementer.map(function (e) { return e.etasje; })).forEach(function (e) { if (e && !seen[e]) { seen[e] = 1; out.push(e); } });
    if (!out.length) out.push('1. etasje');
    return out;
  }
  function tgEt() { var g = tgS(), l = tgEtasjer(); if (!g.etasje || l.indexOf(g.etasje) < 0) g.etasje = l[0]; return g.etasje; }
  function tgEtData(et) { var t = tgData(); if (!t.etasjer[et]) t.etasjer[et] = { underlag: null }; return t.etasjer[et]; }
  function tgElementer(et) { return tgData().elementer.filter(function (e) { return e.etasje === et; }); }
  function tgRomPolys(et) {
    // Rom med geometri: IFC-koordinater (y opp) speiles til tegneretning (y ned)
    var harUnderlag = !!(S.data.tegning && S.data.tegning.etasjer && S.data.tegning.etasjer[et] && S.data.tegning.etasjer[et].underlag);
    return rom().filter(function (r) { return r.etasje === et && r.poly && r.poly.length && !r.fjernet && (!harUnderlag || r.tegnet); }).map(function (r) {
      return { rom: r, polys: r.poly.map(function (pl) { return pl.map(function (p) { return [p[0], -p[1]]; }); }) };
    });
  }
  function tgSnapshot() { return JSON.stringify({ t: S.data.tegning || null, r: S.data.rom }); }
  function tgFor() { var g = tgS(); g.hist.push(tgSnapshot()); if (g.hist.length > 60) g.hist.shift(); g.fremtid = []; }
  function tgEtter() { changed(); tgTegn(); tgPanel(); }
  function tgAngre(frem) {
    var g = tgS(), fra = frem ? g.fremtid : g.hist, til = frem ? g.hist : g.fremtid;
    if (!fra.length) { toast(frem ? 'Ingenting å gjøre om' : 'Ingenting å angre'); return; }
    til.push(tgSnapshot()); var s = JSON.parse(fra.pop()); S.data.tegning = s.t; S.data.rom = s.r; g.valgt = null; g.utkast = [];
    changed(); tgTegn(); tgPanel();
  }

  // Geometri
  function d2(a, b) { var dx = a[0] - b[0], dy = a[1] - b[1]; return Math.sqrt(dx * dx + dy * dy); }
  function projSeg(p, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy; if (!l2) return { p: a.slice(), t: 0, d: d2(p, a) };
    var t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2; t = Math.max(0, Math.min(1, t));
    var q = [a[0] + t * dx, a[1] + t * dy]; return { p: q, t: t, d: d2(p, q) };
  }
  function inPoly(p, pl) { var c = false; for (var i = 0, j = pl.length - 1; i < pl.length; j = i++) { var a = pl[i], b = pl[j]; if (((a[1] > p[1]) !== (b[1] > p[1])) && (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0])) c = !c; } return c; }
  function rnd(v) { return Math.round(v * 1000) / 1000; }
  function nkey(et, p) { return et + '|' + Math.round(p[0] * 100) + '|' + Math.round(p[1] * 100); }
  function vinkel(a, b, c) { // vinkelendring i grader ved b
    var x1 = b[0] - a[0], y1 = b[1] - a[1], x2 = c[0] - b[0], y2 = c[1] - b[1];
    var l = Math.hypot(x1, y1) * Math.hypot(x2, y2); if (!l) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (x1 * x2 + y1 * y2) / l))) * 180 / Math.PI;
  }
  function romVed(et, p) {
    var hit = null; tgRomPolys(et).forEach(function (rp) { if (!hit && rp.polys.some(function (pl) { return inPoly(p, pl); })) hit = rp.rom; });
    return hit;
  }

  // ---------- Nettverksberegning ----------
  function tgBeregn() {
    var t = tgData(), inn = innst(), res = { kanter: [], anlegg: [], varsler: [], mengde: {}, kritiske: {}, vq: {}, vdp: {} };
    var els = t.elementer;
    var ventiler = els.filter(function (e) { return e.type === 'ventil'; });
    var aggregater = els.filter(function (e) { return e.type === 'aggregat'; });
    // Antall ventiler per rom og side
    var perRom = {}; ventiler.forEach(function (v) { if (v.romId) { var k = v.romId + '|' + v.side; perRom[k] = (perRom[k] || 0) + 1; } });
    function autoQ(v) {
      if (v.q !== null && v.q !== undefined && v.q !== '') return Number(v.q) || 0;
      var r = v.romId && findRoom(v.romId); if (!r) return 0;
      var st = FV.romStatus(r), n = perRom[v.romId + '|' + v.side] || 1;
      return (v.side === 'avtrekk' ? st.avtrekk : v.side === 'tilluft' ? st.tilluft : 0) / n;
    }
    var totaler = {}; // aggregat-id -> {tilluft, avtrekk}
    ['tilluft', 'avtrekk', 'uteluft', 'avkast'].forEach(function (side) {
      // Bygg graf
      var noder = {}, kanter = [];
      function node(et, p) { var k = nkey(et, p); if (!noder[k]) noder[k] = { k: k, p: p, et: et, kanter: [] }; return noder[k]; }
      var kanaler = els.filter(function (e) { return e.type === 'kanal' && e.side === side && e.pts && e.pts.length > 1; });
      var ankre = {}; // per etasje: punkter som kan dele kanaler
      els.forEach(function (e) {
        var lst = ankre[e.etasje] || (ankre[e.etasje] = []);
        if (e.type === 'kanal' && e.side === side) e.pts.forEach(function (p) { lst.push(p); });
        else if ((e.type === 'ventil' && e.side === side) || e.type === 'aggregat') lst.push([e.x, e.y]);
      });
      kanaler.forEach(function (k) {
        for (var i = 0; i < k.pts.length - 1; i++) {
          var a = k.pts[i], b = k.pts[i + 1], mellom = [];
          (ankre[k.etasje] || []).forEach(function (p) { var pr = projSeg(p, a, b); if (pr.d < 0.02 && pr.t > 0.001 && pr.t < 0.999) mellom.push({ p: p, t: pr.t }); });
          mellom.sort(function (x, y) { return x.t - y.t; });
          var rekke = [a].concat(mellom.map(function (m) { return m.p; })).concat([b]);
          for (var j = 0; j < rekke.length - 1; j++) {
            var na = node(k.etasje, rekke[j]), nb = node(k.etasje, rekke[j + 1]);
            if (na === nb) continue;
            var ed = { id: kanter.length, a: na, b: nb, len: d2(rekke[j], rekke[j + 1]), el: k, side: side, et: k.etasje };
            kanter.push(ed); na.kanter.push(ed); nb.kanter.push(ed);
          }
        }
      });
      var terminaler = {}; ventiler.filter(function (v) { return v.side === side; }).forEach(function (v) { var k = nkey(v.etasje, [v.x, v.y]); (terminaler[k] = terminaler[k] || []).push(v); });
      var brukt = {};
      aggregater.forEach(function (ag) {
        var rot = noder[nkey(ag.etasje, [ag.x, ag.y])]; if (!rot) return;
        // DFS-tre
        var foreldre = {}, rekkef = [], besokt = {}; besokt[rot.k] = true;
        var stakk = [rot];
        while (stakk.length) {
          var n = stakk.pop(); rekkef.push(n);
          n.kanter.forEach(function (ed) {
            var m = ed.a === n ? ed.b : ed.a;
            if (besokt[m.k]) { if (!foreldre[n.k] || foreldre[n.k].ed !== ed) ed.lokke = true; return; }
            besokt[m.k] = true; foreldre[m.k] = { ed: ed, fra: n }; ed.ned = m; ed.opp = n; brukt[ed.id] = true; stakk.push(m);
          });
        }
        // Luftmengder
        var qNode = {}, nTerm = {};
        for (var i = rekkef.length - 1; i >= 0; i--) {
          var n2 = rekkef[i], q = 0, nt = 0;
          (terminaler[n2.k] || []).forEach(function (v) { if (side === 'uteluft' || side === 'avkast') return; res.vq[v.id] = autoQ(v); q += res.vq[v.id]; nt++; });
          n2.kanter.forEach(function (ed) { if (ed.opp === n2 && foreldre[ed.ned.k] && foreldre[ed.ned.k].ed === ed) { q += qNode[ed.ned.k] || 0; nt += nTerm[ed.ned.k] || 0; } });
          qNode[n2.k] = q; nTerm[n2.k] = nt;
        }
        if (side === 'tilluft' || side === 'avtrekk') { totaler[ag.id] = totaler[ag.id] || { tilluft: 0, avtrekk: 0 }; totaler[ag.id][side] = qNode[rot.k] || 0; }
        if (side === 'uteluft' || side === 'avkast') {
          var tot = (totaler[ag.id] || {})[side === 'uteluft' ? 'tilluft' : 'avtrekk'] || 0;
          rekkef.forEach(function (n3) { qNode[n3.k] = tot; nTerm[n3.k] = 2; (terminaler[n3.k] || []).forEach(function (v) { res.vq[v.id] = tot; }); });
        }
        // Dimensjon per kant
        Object.keys(foreldre).forEach(function (k) {
          var ed = foreldre[k].ed, qq = qNode[k] || 0, gren = (nTerm[k] || 0) <= 1;
          var dimEl = ed.el.dim && ed.el.dim !== 'auto' ? ed.el.dim : null;
          var kk = !qq ? null : dimEl ? (/x/i.test(dimEl) ? FV.rektKanal(qq, +dimEl.split(/x/i)[0], +dimEl.split(/x/i)[1], inn.ruhet) : FV.rundKanal(qq, +dimEl, inn.ruhet)) : FV.velgDimensjon(qq, gren ? inn.vmaxGren : inn.vmaxHoved, inn.rmax, inn.ruhet);
          ed.q = qq; ed.k = kk; ed.dimTekst = kk ? (kk.a ? kk.a + '×' + kk.b : 'Ø' + kk.d) : '–'; ed.d = kk ? kk.d : 0; ed.ag = ag;
        });
        // Trykkfall til hver terminal
        var verst = null;
        Object.keys(terminaler).forEach(function (tk) {
          if (!besokt[tk]) return;
          terminaler[tk].forEach(function (v) {
            var dp = 0, sti = [], node2 = noder[tk], forrige = null, zetaSum = 0;
            while (foreldre[node2.k]) {
              var f = foreldre[node2.k], ed2 = f.ed, kk2 = ed2.k;
              var dpe = kk2 ? kk2.R * ed2.len : 0, z = 0;
              if (forrige && kk2) {
                var deg = f.fra === node2 ? 0 : node2.kanter.length;
                var a3 = forrige.ned === node2 ? forrige.opp.p : forrige.ned.p;
                var ang = vinkel(f.fra.p, node2.p, forrige.ned.p);
                if (node2.kanter.length >= 3) z += ang < 20 ? 0.3 : 1.0; else if (ang > 20) z += 0.3 * Math.min(ang, 90) / 90;
                if (forrige.d && kk2.d && Math.abs(forrige.d - kk2.d) > 1) z += 0.1;
                var pdBarn = forrige.k ? forrige.k.pd : 0; dp += z * pdBarn; zetaSum += z;
                forrige.zeta = (forrige.zeta || 0);
              }
              dp += dpe; sti.push(ed2); forrige = ed2; node2 = f.fra;
            }
            var term = side === 'uteluft' || side === 'avkast' ? Number(v.pa !== undefined && v.pa !== null && v.pa !== '' ? v.pa : t.innst.ristPa) : Number(v.pa !== undefined && v.pa !== null && v.pa !== '' ? v.pa : t.innst.ventilPa);
            dp += term || 0; res.vdp[v.id] = dp;
            if (!verst || dp > verst.dp) verst = { dp: dp, ventil: v, sti: sti };
          });
        });
        var navnA = ag.anlegg || innst().standardSystem;
        res.anlegg.push({ ag: ag, side: side, anlegg: navnA, q: qNode[rot.k] || 0, dp: verst ? verst.dp : 0, kritisk: verst, antall: Object.keys(terminaler).filter(function (tk) { return besokt[tk]; }).reduce(function (a, tk) { return a + terminaler[tk].length; }, 0) });
        if (verst) verst.sti.forEach(function (ed) { res.kritiske[ed.el.id + '|' + ed.id + '|' + side] = true; ed.kritisk = true; });
      });
      kanter.forEach(function (ed) { if (!brukt[ed.id]) { ed.lost = true; } res.kanter.push(ed); });
      // Varsler
      ventiler.filter(function (v) { return v.side === side; }).forEach(function (v) {
        var k = nkey(v.etasje, [v.x, v.y]);
        var tilkoblet = noder[k] && noder[k].kanter.some(function (ed) { return brukt[ed.id]; });
        if (!tilkoblet) res.varsler.push({ el: v, tekst: (side === 'uteluft' || side === 'avkast' ? 'Rist' : 'Ventil') + ' ' + (v.navn || '') + ' er ikke koblet til et aggregat' });
        else if ((side === 'tilluft' || side === 'avtrekk') && !res.vq[v.id]) res.varsler.push({ el: v, tekst: 'Ventil uten luftmengde. Koble den til et rom eller skriv inn luftmengde.' });
      });
      if (kanter.some(function (ed) { return ed.lost; })) res.varsler.push({ tekst: TG_SIDER[side].navn + ': ' + kanter.filter(function (ed) { return ed.lost; }).length + ' kanalbiter er ikke koblet til et aggregat' });
      if (kanter.some(function (ed) { return ed.lokke; })) res.varsler.push({ tekst: TG_SIDER[side].navn + ': kanalnettet har en ring. Luftmengden kan bli feil fordelt.' });
    });
    // Rom uten ventil
    var ventRom = {}; ventiler.forEach(function (v) { if (v.romId) ventRom[v.romId + '|' + v.side] = true; });
    if (ventiler.length) rom().forEach(function (r) {
      if (r.fjernet) return; var st = FV.romStatus(r);
      if (st.tilluft > 0 && !ventRom[r.id + '|tilluft']) res.varsler.push({ rom: r, tekst: 'Mangler tilluftsventil: ' + (r.nummer ? r.nummer + ' ' : '') + r.navn + ' (' + fmt(st.tilluft) + ' m³/h)' });
      if (st.avtrekk > 0 && !ventRom[r.id + '|avtrekk']) res.varsler.push({ rom: r, tekst: 'Mangler avtrekksventil: ' + (r.nummer ? r.nummer + ' ' : '') + r.navn + ' (' + fmt(st.avtrekk) + ' m³/h)' });
    });
    // Mengdeliste
    var ml = { kanal: {}, bend90: {}, bend45: {}, tstk: {}, overgang: 0, ventiler: {}, aggregat: aggregater.length };
    res.kanter.forEach(function (ed) { var k = ed.side + '|' + (ed.dimTekst && ed.dimTekst !== '–' ? ed.dimTekst : (ed.el.dim && ed.el.dim !== 'auto' ? (/x/i.test(ed.el.dim) ? ed.el.dim.replace(/x/i, '×') : 'Ø' + ed.el.dim) : 'Udimensjonert')); ml.kanal[k] = (ml.kanal[k] || 0) + ed.len; });
    var allNoder = {};
    res.kanter.forEach(function (ed) { [ed.a, ed.b].forEach(function (n) { allNoder[n.k + '|' + ed.side] = { n: n, side: ed.side }; }); });
    Object.keys(allNoder).forEach(function (key) {
      var o = allNoder[key], ks = o.n.kanter.filter(function (ed) { return ed.side === o.side; });
      var dimMax = ks.reduce(function (m, ed) { return Math.max(m, ed.d || 0); }, 0), dt = dimMax ? 'Ø' + dimMax : 'Udim.';
      if (ks.length === 2) {
        var p1 = ks[0].a === o.n ? ks[0].b.p : ks[0].a.p, p2 = ks[1].a === o.n ? ks[1].b.p : ks[1].a.p;
        var ang = vinkel(p1, o.n.p, p2);
        if (ang > 60) ml.bend90[o.side + '|' + dt] = (ml.bend90[o.side + '|' + dt] || 0) + 1;
        else if (ang > 20) ml.bend45[o.side + '|' + dt] = (ml.bend45[o.side + '|' + dt] || 0) + 1;
        if (ks[0].d && ks[1].d && ks[0].d !== ks[1].d) ml.overgang++;
      } else if (ks.length >= 3) ml.tstk[o.side + '|' + dt] = (ml.tstk[o.side + '|' + dt] || 0) + 1;
    });
    ventiler.forEach(function (v) { var k = (v.side === 'uteluft' ? 'Inntaksrist' : v.side === 'avkast' ? 'Avkastrist / takhatt' : v.side === 'tilluft' ? 'Tilluftsventil' : 'Avtrekksventil'); ml.ventiler[k] = (ml.ventiler[k] || 0) + 1; });
    res.mengde = ml;
    tgS().res = res;
    return res;
  }

  // ---------- Visning ----------
  function renderTegning() {
    var g = tgS(), et = tgEt(), ed = tgEtData(et), skriv = S.canWrite;
    var h = '<div class="tg">';
    h += '<div class="tg-bar">' +
      '<select id="tgEt" aria-label="Etasje">' + tgEtasjer().map(function (e) { return '<option' + (e === et ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('') + '</select>' +
      '<div class="seg tg-tools" role="group" aria-label="Verktøy">' + TG_VERKTOY.map(function (v) { var av = !skriv && v[0] !== 'velg' && v[0] !== 'maal'; return '<button type="button" data-act="tg-verktoy" data-v="' + v[0] + '" aria-pressed="' + (g.verktoy === v[0]) + '" title="' + esc(v[2]) + '"' + (av ? ' disabled' : '') + '>' + v[1] + '</button>'; }).join('') + '</div>' +
      '<select id="tgSide" aria-label="Kanalsystem" class="tg-side-sel">' + Object.keys(TG_SIDER).map(function (k) { return '<option value="' + k + '"' + (g.side === k ? ' selected' : '') + '>' + TG_SIDER[k].navn + '</option>'; }).join('') + '</select>' +
      '<span style="flex:1"></span>' +
      '<button class="btn sm" type="button" data-act="tg-underlag"' + dis() + '>' + (ed.underlag ? 'Bytt plantegning' : 'Last inn plantegning') + '</button>' +
      '<div class="row" style="gap:2px"><button class="btn sm ghost" type="button" data-act="tg-zoom" data-z="0.8" aria-label="Zoom ut">−</button><button class="btn sm ghost" type="button" data-act="tg-zoom" data-z="1.25" aria-label="Zoom inn">+</button><button class="btn sm ghost" type="button" data-act="tg-tilpass">Tilpass</button></div>' +
      '<button class="btn sm ghost" type="button" data-act="tg-angre"' + dis() + ' title="Angre (Ctrl+Z)">Angre</button>' +
      '<button class="btn sm" type="button" data-act="tg-png">Last ned tegning</button></div>';
    var hint = '';
    if (ed.underlag && !ed.underlag.kalibrert) hint = '<div class="banner" style="margin:0">Plantegningen har ikke målestokk ennå. Velg <b>Målestokk</b> og klikk på to punkter med kjent avstand, ellers blir lengder og arealer feil.</div>';
    else if (!ed.underlag && !tgRomPolys(et).length && !tgElementer(et).length) hint = '<div class="banner info" style="margin:0">Dra plantegningen fra e-posten eller en mappe rett inn her, eller klikk «Last inn plantegning». PDF, PNG og JPG fungerer. Har prosjektet rom fra IFC-filen, vises de her automatisk.</div>';
    h += hint;
    h += '<div class="tg-main"><div class="tg-canvas" id="tgCanvas"><svg id="tgSvg" role="application" aria-label="Tegneflate for ' + esc(et) + '"><g id="tgWorld"></g><g id="tgOverlay"></g></svg><div class="tg-hint" id="tgHint"></div><div class="tg-scale" id="tgScale"></div></div>' +
      '<aside class="tg-panel" id="tgPanel"></aside></div></div>';
    return h;
  }
  function bindTegning() {
    var svg = $('#tgSvg'); if (!svg) return;
    var g = tgS(), et = tgEt();
    var ed = tgEtData(et);
    if (ed.underlag && !g.bilder[ed.underlag.path]) lastBilde(ed.underlag.path);
    if (!g.view || g.view.et !== et) tgTilpass();
    if (location.protocol === 'file:') window.__FV = { S: S, beregn: tgBeregn };
    svg.addEventListener('pointerdown', tgDown);
    svg.addEventListener('pointermove', tgMove);
    svg.addEventListener('pointerup', tgUp);
    svg.addEventListener('pointerleave', function () { g.mus = null; tgOverlay(); });
    svg.addEventListener('dblclick', function (e) { e.preventDefault(); tgFullfor(); });
    svg.addEventListener('wheel', function (e) { e.preventDefault(); var r = svg.getBoundingClientRect(); tgZoom(Math.pow(1.0015, -e.deltaY), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    tgTegn(); tgPanel();
  }
  async function lastBilde(path) {
    var g = tgS(); g.bilder[path] = 'laster';
    var r = await sb.storage.from('underlag').download(path);
    if (r.error || !r.data) { g.bilder[path] = 'feil'; toast('Kunne ikke hente plantegningen.'); return; }
    g.bilder[path] = URL.createObjectURL(r.data); tgTegn();
  }
  function tgBounds(et) {
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    function inc(p) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
    var u = tgEtData(et).underlag; if (u) { inc([0, 0]); inc([u.bredde * u.mPerPx, u.hoyde * u.mPerPx]); }
    tgRomPolys(et).forEach(function (rp) { rp.polys.forEach(function (pl) { pl.forEach(inc); }); });
    tgElementer(et).forEach(function (e) { if (e.pts) e.pts.forEach(inc); else inc([e.x, e.y]); });
    if (minx === Infinity) return { minx: 0, miny: 0, maxx: 20, maxy: 14 };
    return { minx: minx, miny: miny, maxx: maxx, maxy: maxy };
  }
  function tgTilpass() {
    var svg = $('#tgSvg'), g = tgS(), et = tgEt(); if (!svg) return;
    var W = svg.clientWidth || 800, H = svg.clientHeight || 600, b = tgBounds(et);
    var w = Math.max(b.maxx - b.minx, 1), h = Math.max(b.maxy - b.miny, 1), s = Math.min(W / w, H / h) * 0.92;
    g.view = { et: et, s: s, x: b.minx - (W / s - w) / 2, y: b.miny - (H / s - h) / 2 };
    tgTegn();
  }
  function tgZoom(f, sx, sy) {
    var g = tgS(), svg = $('#tgSvg'); if (!g.view || !svg) return;
    if (sx === undefined) { sx = svg.clientWidth / 2; sy = svg.clientHeight / 2; }
    var wx = g.view.x + sx / g.view.s, wy = g.view.y + sy / g.view.s;
    g.view.s = Math.max(2, Math.min(4000, g.view.s * f)); g.view.x = wx - sx / g.view.s; g.view.y = wy - sy / g.view.s;
    clearTimeout(tgZoom.t); tgTransform(); tgZoom.t = setTimeout(tgTegn, 60);
  }
  function tgTransform() { var g = tgS(), w = $('#tgWorld'), o = $('#tgOverlay'); if (!w || !g.view) return; var tr = 'matrix(' + g.view.s + ',0,0,' + g.view.s + ',' + (-g.view.x * g.view.s) + ',' + (-g.view.y * g.view.s) + ')'; w.setAttribute('transform', tr); o.setAttribute('transform', tr); tgSkala(); }
  function tgSkala() {
    var g = tgS(), el = $('#tgScale'); if (!el || !g.view) return;
    var mal = 120 / g.view.s, p = Math.pow(10, Math.floor(Math.log10(mal))), n = [1, 2, 5, 10].map(function (k) { return k * p; }).filter(function (x) { return x <= mal; }).pop() || p;
    el.innerHTML = '<span style="width:' + Math.round(n * g.view.s) + 'px"></span>' + fmt(n, n < 1 ? 1 : 0) + ' m';
  }
  function px(n) { return n / tgS().view.s; }

  function tgTegn() {
    var w = $('#tgWorld'); if (!w) return;
    var g = tgS(), et = tgEt(), ed = tgEtData(et), res = tgBeregn(), h = '';
    tgTransform();
    var fs = px(11.5);
    if (ed.underlag) {
      var src = g.bilder[ed.underlag.path];
      if (src && src !== 'laster' && src !== 'feil') h += '<image href="' + src + '" x="0" y="0" width="' + ed.underlag.bredde * ed.underlag.mPerPx + '" height="' + ed.underlag.hoyde * ed.underlag.mPerPx + '" preserveAspectRatio="none" class="tg-img"/>';
    }
    if (g.visRom) tgRomPolys(et).forEach(function (rp) {
      var st = FV.romStatus(rp.rom);
      var d = rp.polys.map(function (pl) { return 'M' + pl.map(function (p) { return rnd(p[0]) + ' ' + rnd(p[1]); }).join('L') + 'Z'; }).join(' ');
      h += '<path d="' + d + '" class="tg-rom' + (ed.underlag ? ' over' : '') + '" fill-rule="evenodd"/>';
      var c = centroid(rp.polys[0]);
      h += '<text x="' + rnd(c[0]) + '" y="' + rnd(c[1]) + '" font-size="' + fs + '" class="tg-romtxt" text-anchor="middle">' + esc((rp.rom.nummer ? rp.rom.nummer + ' ' : '') + rp.rom.navn) + '</text>';
      var tt = []; if (st.tilluft) tt.push('<tspan class="t">T ' + fmt(st.tilluft) + '</tspan>'); if (st.avtrekk) tt.push('<tspan class="a">A ' + fmt(st.avtrekk) + '</tspan>');
      if (tt.length) h += '<text x="' + rnd(c[0]) + '" y="' + rnd(c[1] + fs * 1.25) + '" font-size="' + fs * 0.92 + '" class="tg-romtxt" text-anchor="middle">' + tt.join('<tspan> </tspan>') + '</text>';
    });
    // Kanaler (fra beregnede kanter)
    var etKanter = res.kanter.filter(function (k) { return k.et === et; });
    etKanter.forEach(function (k) {
      var bw = Math.max((k.d || 100) / 1000, px(2.5));
      var sel = g.valgt === k.el.id;
      h += '<line x1="' + rnd(k.a.p[0]) + '" y1="' + rnd(k.a.p[1]) + '" x2="' + rnd(k.b.p[0]) + '" y2="' + rnd(k.b.p[1]) + '" stroke="' + TG_SIDER[k.side].farge + '" stroke-width="' + rnd(bw) + '" class="tg-kanal' + (k.lost ? ' lost' : '') + (sel ? ' sel' : '') + '"/>';
      if (k.kritisk) h += '<line x1="' + rnd(k.a.p[0]) + '" y1="' + rnd(k.a.p[1]) + '" x2="' + rnd(k.b.p[0]) + '" y2="' + rnd(k.b.p[1]) + '" stroke-width="' + rnd(px(1.2)) + '" stroke-dasharray="' + rnd(px(5)) + ' ' + rnd(px(4)) + '" class="tg-krit"/>';
    });
    // Kanaler uten kanter (1 punkt) og valgte knekkpunkter
    tgElementer(et).filter(function (e) { return e.type === 'kanal'; }).forEach(function (e) {
      if (g.valgt === e.id && S.canWrite) e.pts.forEach(function (p, i) { h += '<rect x="' + rnd(p[0] - px(4)) + '" y="' + rnd(p[1] - px(4)) + '" width="' + rnd(px(8)) + '" height="' + rnd(px(8)) + '" class="tg-handle"/>'; });
    });
    // Etiketter på kanaler
    etKanter.forEach(function (k) {
      if (k.len * g.view.s < 70 || !k.q) return;
      var mx = (k.a.p[0] + k.b.p[0]) / 2, my = (k.a.p[1] + k.b.p[1]) / 2, ang = Math.atan2(k.b.p[1] - k.a.p[1], k.b.p[0] - k.a.p[0]) * 180 / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      var txt = k.dimTekst + ' · ' + fmt(k.q);
      h += '<g transform="translate(' + rnd(mx) + ' ' + rnd(my) + ') rotate(' + rnd(ang) + ')"><text y="' + rnd(-px(6)) + '" font-size="' + fs * 0.9 + '" text-anchor="middle" class="tg-lbl" style="fill:' + TG_SIDER[k.side].farge + '">' + esc(txt) + '</text></g>';
    });
    // Ventiler og aggregat
    tgElementer(et).forEach(function (e) {
      var sel = g.valgt === e.id;
      if (e.type === 'ventil') {
        var r = px(9), rist = e.side === 'uteluft' || e.side === 'avkast';
        h += '<g class="tg-el' + (sel ? ' sel' : '') + '" transform="translate(' + rnd(e.x) + ' ' + rnd(e.y) + ')">' + (rist ? '<rect x="' + rnd(-r) + '" y="' + rnd(-r * 0.6) + '" width="' + rnd(2 * r) + '" height="' + rnd(1.2 * r) + '" stroke="' + TG_SIDER[e.side].farge + '" stroke-width="' + rnd(px(2)) + '" class="tg-sym"/><line x1="' + rnd(-r * 0.6) + '" y1="0" x2="' + rnd(r * 0.6) + '" y2="0" stroke="' + TG_SIDER[e.side].farge + '" stroke-width="' + rnd(px(1.5)) + '"/>' :
          '<circle r="' + rnd(r) + '" stroke="' + TG_SIDER[e.side].farge + '" stroke-width="' + rnd(px(2)) + '" class="tg-sym"/><path d="M' + rnd(-r * 0.55) + ' ' + rnd(-r * 0.55) + 'L' + rnd(r * 0.55) + ' ' + rnd(r * 0.55) + 'M' + rnd(-r * 0.55) + ' ' + rnd(r * 0.55) + 'L' + rnd(r * 0.55) + ' ' + rnd(-r * 0.55) + '" stroke="' + TG_SIDER[e.side].farge + '" stroke-width="' + rnd(px(1.5)) + '"/>') +
          (res.vq[e.id] ? '<text x="' + rnd(r + px(3)) + '" y="' + rnd(px(4)) + '" font-size="' + fs * 0.9 + '" class="tg-lbl" style="fill:' + TG_SIDER[e.side].farge + '">' + fmt(res.vq[e.id]) + '</text>' : '') + '</g>';
      } else if (e.type === 'aggregat') {
        var aw = px(46), ah = px(24);
        h += '<g class="tg-el' + (sel ? ' sel' : '') + '" transform="translate(' + rnd(e.x) + ' ' + rnd(e.y) + ')"><rect x="' + rnd(-aw / 2) + '" y="' + rnd(-ah / 2) + '" width="' + rnd(aw) + '" height="' + rnd(ah) + '" class="tg-agg" stroke-width="' + rnd(px(2)) + '"/><text y="' + rnd(fs * 0.35) + '" font-size="' + fs + '" text-anchor="middle" class="tg-aggtxt">' + esc(e.anlegg || 'AGG') + '</text></g>';
      }
    });
    w.innerHTML = h;
    tgOverlay();
  }

  function tgOverlay() {
    var o = $('#tgOverlay'); if (!o) return;
    var g = tgS(), h = '', m = g.mus, hint = '';
    var v = TG_VERKTOY.find(function (x) { return x[0] === g.verktoy; }); hint = v ? v[2] : '';
    var u = g.utkast;
    if (u.length) {
      var pts = u.concat(m ? [m.p] : []);
      var farge = g.verktoy === 'kanal' ? TG_SIDER[g.side].farge : g.verktoy === 'rom' ? 'var(--ink)' : 'var(--warn)';
      h += '<polyline points="' + pts.map(function (p) { return rnd(p[0]) + ',' + rnd(p[1]); }).join(' ') + '" fill="' + (g.verktoy === 'rom' ? 'rgba(29,100,166,.08)' : 'none') + '" stroke="' + farge + '" stroke-width="' + rnd(px(2)) + '" stroke-dasharray="' + rnd(px(6)) + ' ' + rnd(px(4)) + '"/>';
      if (m && u.length) {
        var L = d2(u[u.length - 1], m.p) * (g.verktoy === 'kalib' ? 1 : 1);
        hint = (g.verktoy === 'kalib' ? 'Avstand på tegningen ' : 'Lengde ') + fmt(L, 2) + ' m';
        if (g.verktoy === 'rom' && u.length >= 2) hint += '. Areal ' + fmt(Math.abs(FV.polyArea(u.concat([m.p]))), 1) + ' m²';
      }
    }
    if (g.maal) { h += '<line x1="' + rnd(g.maal[0][0]) + '" y1="' + rnd(g.maal[0][1]) + '" x2="' + rnd(g.maal[1][0]) + '" y2="' + rnd(g.maal[1][1]) + '" stroke="var(--warn)" stroke-width="' + rnd(px(2)) + '"/>'; if (!u.length) hint = 'Målt avstand ' + fmt(d2(g.maal[0], g.maal[1]), 2) + ' m'; }
    if (m && m.snap) h += '<circle cx="' + rnd(m.p[0]) + '" cy="' + rnd(m.p[1]) + '" r="' + rnd(px(6)) + '" class="tg-snap ' + m.snap + '"/>';
    o.innerHTML = h;
    var hi = $('#tgHint'); if (hi) hi.textContent = hint;
  }

  function tgPanel() {
    var el = $('#tgPanel'); if (!el) return;
    var g = tgS(), res = g.res || tgBeregn(), t = tgData(), e = g.valgt && t.elementer.find(function (x) { return x.id === g.valgt; });
    var h = '';
    if (e) {
      h += '<section class="panel"><div class="panel-h"><h3>' + ({ kanal: 'Kanal', ventil: e.side === 'uteluft' ? 'Inntaksrist' : e.side === 'avkast' ? 'Avkastrist' : 'Ventil', aggregat: 'Aggregat' }[e.type]) + '</h3><button class="btn sm ghost x" type="button" data-act="tg-fjernvalg" aria-label="Lukk">×</button></div><div class="stack">';
      if (e.type !== 'aggregat') h += '<label class="f"><span>System</span><select id="tgp-side" data-tgp="side"' + dis() + '>' + Object.keys(TG_SIDER).map(function (k) { return '<option value="' + k + '"' + (e.side === k ? ' selected' : '') + '>' + TG_SIDER[k].navn + '</option>'; }).join('') + '</select></label>';
      if (e.type === 'kanal') {
        var ks = res.kanter.filter(function (k) { return k.el === e; }), L = ks.reduce(function (a, k) { return a + k.len; }, 0);
        h += '<label class="f"><span>Dimensjon (tomt = automatisk)</span><input type="text" id="tgp-dim" data-tgp="dim" list="dimlist2" value="' + esc(e.dim && e.dim !== 'auto' ? e.dim : '') + '" placeholder="auto"' + dis() + '></label>';
        h += '<dl class="kv"><dt>Lengde</dt><dd>' + fmt(L, 2) + ' m</dd><dt>Biter</dt><dd>' + ks.map(function (k) { return k.dimTekst + ' ' + fmt(k.q) + ' m³/h' + (k.k ? ', ' + fmt(k.k.v, 1) + ' m/s' : ''); }).filter(function (x, i, a) { return a.indexOf(x) === i; }).map(esc).join('<br>') + '</dd></dl>';
      }
      if (e.type === 'ventil') {
        var romLst = rom().filter(function (r) { return r.etasje === e.etasje && !r.fjernet; });
        if (e.side === 'tilluft' || e.side === 'avtrekk') h += '<label class="f"><span>Rom</span><select id="tgp-rom" data-tgp="romId"' + dis() + '><option value="">Ikke koblet til rom</option>' + sortRom(romLst).map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === e.romId ? ' selected' : '') + '>' + esc((r.nummer ? r.nummer + ' ' : '') + r.navn) + '</option>'; }).join('') + '</select></label>';
        h += '<label class="f"><span>Luftmengde m³/h (tomt = fra rommet)</span><input type="text" inputmode="decimal" id="tgp-q" data-tgp="q" value="' + esc(e.q === null || e.q === undefined ? '' : e.q) + '" placeholder="' + fmt(res.vq[e.id] || 0) + '"' + dis() + '></label>';
        h += '<label class="f"><span>Trykkfall i ' + (e.side === 'uteluft' || e.side === 'avkast' ? 'rist' : 'ventil') + ' Pa</span><input type="text" inputmode="decimal" id="tgp-pa" data-tgp="pa" value="' + esc(e.pa === null || e.pa === undefined ? '' : e.pa) + '" placeholder="' + (e.side === 'uteluft' || e.side === 'avkast' ? t.innst.ristPa : t.innst.ventilPa) + '"' + dis() + '></label>';
        h += '<label class="f"><span>Merking / produkt</span><input type="text" id="tgp-navn" data-tgp="navn" value="' + esc(e.navn || '') + '" placeholder="For eksempel TV-01"' + dis() + '></label>';
        if (res.vdp[e.id]) h += '<dl class="kv"><dt>Trykkfall fra aggregat</dt><dd>' + fmt(res.vdp[e.id], 0) + ' Pa</dd></dl>';
      }
      if (e.type === 'aggregat') {
        h += '<label class="f"><span>System / anlegg</span><input type="text" id="tgp-anlegg" data-tgp="anlegg" value="' + esc(e.anlegg || '') + '"' + dis() + '></label>';
        h += '<dl class="kv">' + res.anlegg.filter(function (a) { return a.ag === e; }).map(function (a) { return '<dt>' + TG_SIDER[a.side].navn + '</dt><dd>' + fmt(a.q) + ' m³/h, ' + fmt(a.dp, 0) + ' Pa</dd>'; }).join('') + '</dl><p class="small muted" style="margin:0">Trykket er eksternt trykkfall i kanalnettet til den kritiske ventilen, inkludert ventilen.</p>';
      }
      if (S.canWrite) h += '<div><button class="btn sm ghost danger" type="button" data-act="tg-slett">Slett</button></div>';
      h += '</div></section>';
    }
    // Resultater
    h += '<section class="panel"><h3>Anlegg</h3>';
    if (!res.anlegg.length) h += '<p class="small muted" style="margin:8px 0 0">Plasser et aggregat og tegn kanaler ut til ventilene. Luftmengder, dimensjoner og trykkfall regnes ut fortløpende.</p>';
    else h += '<div class="tablewrap" style="margin-top:8px"><table><thead><tr><th>Anlegg</th><th class="n">m³/h</th><th class="n">Pa</th></tr></thead><tbody>' + res.anlegg.map(function (a) { return '<tr><td><span class="dotc" style="background:' + TG_SIDER[a.side].farge + '"></span>' + esc(a.anlegg) + ' ' + TG_SIDER[a.side].navn.toLowerCase() + '</td><td class="n">' + fmt(a.q) + '</td><td class="n">' + fmt(a.dp, 0) + '</td></tr>'; }).join('') + '</tbody></table></div><p class="small muted" style="margin:6px 0 0">Stiplet linje viser kritisk strekning.</p><div class="row" style="margin-top:8px"><button class="btn sm" type="button" data-act="tg-til-kanaler"' + dis() + '>Bruk i trykkfallsberegningen</button></div>';
    h += '</section>';
    if (res.varsler.length) h += '<section class="panel"><h3>Må følges opp <span class="tag">' + res.varsler.length + '</span></h3><ul class="issues" style="margin-top:8px">' + res.varsler.slice(0, 12).map(function (v) { return '<li><span class="pill mangler">!</span><span class="small">' + esc(v.tekst) + '</span>' + (v.el ? '<button type="button" data-act="tg-vis" data-id="' + esc(v.el.id) + '">Vis</button>' : '') + '</li>'; }).join('') + '</ul></section>';
    // Mengdeliste
    var ml = res.mengde, rader = [];
    Object.keys(ml.kanal).sort().forEach(function (k) { var p = k.split('|'); rader.push([TG_SIDER[p[0]].navn, 'Kanal ' + p[1], fmt(ml.kanal[k], 1) + ' m']); });
    [['bend90', 'Bend 90°'], ['bend45', 'Bend 45°'], ['tstk', 'T-stykke']].forEach(function (b) { Object.keys(ml[b[0]]).sort().forEach(function (k) { var p = k.split('|'); rader.push([TG_SIDER[p[0]].navn, b[1] + ' ' + p[1], ml[b[0]][k] + ' stk']); }); });
    if (ml.overgang) rader.push(['', 'Overganger', ml.overgang + ' stk']);
    Object.keys(ml.ventiler).forEach(function (k) { rader.push(['', k, ml.ventiler[k] + ' stk']); });
    if (ml.aggregat) rader.push(['', 'Aggregat', ml.aggregat + ' stk']);
    if (rader.length) h += '<section class="panel"><div class="panel-h" style="margin-bottom:6px"><h3>Mengdeliste</h3><button class="btn sm ghost" type="button" data-act="tg-mengde-csv">Last ned</button></div><div class="tablewrap"><table><tbody>' + rader.map(function (r) { return '<tr><td class="small muted">' + esc(r[0]) + '</td><td>' + esc(r[1]) + '</td><td class="n">' + esc(r[2]) + '</td></tr>'; }).join('') + '</tbody></table></div><p class="small muted" style="margin:6px 0 0">Gjelder alle etasjer. Bend og T-stykker telles fra tegningen.</p></section>';
    h += '<section class="panel small"><h3>Visning</h3><label class="row" style="margin-top:8px"><input type="checkbox" id="tgVisRom"' + (g.visRom ? ' checked' : '') + '> Vis rom og luftmengder</label>' + (tgEtData(tgEt()).underlag ? '<div class="row" style="margin-top:8px"><button class="btn sm ghost danger" type="button" data-act="tg-fjern-underlag"' + dis() + '>Fjern plantegningen</button></div>' : '') + '</section>';
    h += '<datalist id="dimlist2">' + FV.RUND.map(function (d) { return '<option value="' + d + '">'; }).join('') + '<option value="400x200"><option value="500x250"></datalist>';
    el.innerHTML = h;
  }

  // ---------- Interaksjon ----------
  function tgPunkt(e) { var svg = $('#tgSvg'), r = svg.getBoundingClientRect(), g = tgS(); return [g.view.x + (e.clientX - r.left) / g.view.s, g.view.y + (e.clientY - r.top) / g.view.s]; }
  function tgSnap(p, e, opts) {
    var g = tgS(), et = tgEt(), tol = px(12), best = null, bd = tol;
    opts = opts || {};
    function kand(q, type) { var d = d2(p, q); if (d < bd) { bd = d; best = { p: [q[0], q[1]], snap: type }; } }
    tgElementer(et).forEach(function (el) {
      if (opts.ignorer && opts.ignorer(el)) return;
      if (el.type === 'kanal') el.pts.forEach(function (q) { kand(q, 'node'); });
      else kand([el.x, el.y], 'node');
    });
    if (g.verktoy === 'rom' && g.utkast.length >= 3) kand(g.utkast[0], 'node');
    if (!best && (g.verktoy === 'rom' || g.verktoy === 'kalib' || g.verktoy === 'maal')) tgRomPolys(et).forEach(function (rp) { rp.polys.forEach(function (pl) { pl.forEach(function (q) { kand(q, 'node'); }); }); });
    if (!best && !opts.ingenLinje) {
      bd = tol;
      tgElementer(et).forEach(function (el) {
        if (el.type !== 'kanal' || (opts.ignorer && opts.ignorer(el))) return;
        for (var i = 0; i < el.pts.length - 1; i++) { var pr = projSeg(p, el.pts[i], el.pts[i + 1]); if (pr.d < bd) { bd = pr.d; best = { p: pr.p, snap: 'linje' }; } }
      });
    }
    if (best) return best;
    var prev = g.utkast.length ? g.utkast[g.utkast.length - 1] : null;
    if (prev && !(e && e.altKey) && (g.verktoy === 'kanal' || g.verktoy === 'rom')) {
      var dx = p[0] - prev[0], dy = p[1] - prev[1], L = Math.hypot(dx, dy), a = Math.atan2(dy, dx), step = Math.PI / 4;
      var ar = Math.round(a / step) * step;
      if (Math.abs(a - ar) < 8 * Math.PI / 180) return { p: [prev[0] + Math.cos(ar) * L, prev[1] + Math.sin(ar) * L], snap: null };
    }
    return { p: p, snap: null };
  }
  function tgTreff(p) {
    var et = tgEt(), tol = px(10), best = null, bd = Infinity;
    tgElementer(et).forEach(function (el) {
      var d;
      if (el.type === 'kanal') { d = Infinity; for (var i = 0; i < el.pts.length - 1; i++) d = Math.min(d, projSeg(p, el.pts[i], el.pts[i + 1]).d); d += px(3); }
      else d = d2(p, [el.x, el.y]);
      if (d < tol && d < bd) { bd = d; best = el; }
    });
    return best;
  }
  function tgDown(e) {
    var g = tgS(), svg = $('#tgSvg'); if (!g.view) return;
    var p = tgPunkt(e);
    if (e.button === 1 || e.button === 2 || (g.verktoy === 'velg' && e.button === 0 && !tgTreff(p) && !tgHandle(p))) {
      g.drag = { type: 'pan', sx: e.clientX, sy: e.clientY, vx: g.view.x, vy: g.view.y, klikk: g.verktoy === 'velg' && e.button === 0 }; svg.setPointerCapture(e.pointerId); svg.classList.add('panning'); return;
    }
    if (e.button !== 0) return;
    if (g.verktoy === 'velg') {
      var hd = tgHandle(p);
      if (hd && S.canWrite) { tgFor(); g.drag = { type: 'node', el: hd.el, idx: hd.idx, start: hd.el.pts[hd.idx].slice() }; svg.setPointerCapture(e.pointerId); return; }
      var hit = tgTreff(p); g.valgt = hit ? hit.id : null;
      if (hit && hit.type !== 'kanal' && S.canWrite) { tgFor(); g.drag = { type: 'flytt', el: hit, start: [hit.x, hit.y], moved: false }; svg.setPointerCapture(e.pointerId); }
      tgTegn(); tgPanel(); return;
    }
    if (!S.canWrite && g.verktoy !== 'maal') return;
    var sp = tgSnap(p, e);
    if (g.verktoy === 'kanal') {
      if (g.utkast.length && d2(g.utkast[g.utkast.length - 1], sp.p) < px(3)) return;
      g.utkast.push(sp.p);
      var paVentil = tgElementer(tgEt()).some(function (el) { return el.type !== 'kanal' && d2([el.x, el.y], sp.p) < 1e-6; });
      if (g.utkast.length >= 2 && paVentil && sp.snap === 'node') tgFullfor();
      tgOverlay(); return;
    }
    if (g.verktoy === 'rom') {
      if (g.utkast.length >= 3 && d2(g.utkast[0], sp.p) < 1e-6) { tgFullfor(); return; }
      g.utkast.push(sp.p); tgOverlay(); return;
    }
    if (g.verktoy === 'maal' || g.verktoy === 'kalib') {
      if (!g.utkast.length) { g.utkast = [sp.p]; g.maal = null; tgOverlay(); return; }
      var a = g.utkast[0], b = sp.p; g.utkast = [];
      if (g.verktoy === 'maal') { g.maal = [a, b]; tgOverlay(); return; }
      tgKalibrer(a, b); return;
    }
    if (g.verktoy === 'ventil') {
      tgFor();
      var rm = (g.side === 'tilluft' || g.side === 'avtrekk') ? romVed(tgEt(), sp.p) : null;
      var nv = { id: uid('v'), type: 'ventil', etasje: tgEt(), side: g.side, x: rnd(sp.p[0]), y: rnd(sp.p[1]), romId: rm ? rm.id : null, q: null, pa: null, navn: '' };
      tgData().elementer.push(nv); g.valgt = nv.id; tgEtter();
      if (!rm && (g.side === 'tilluft' || g.side === 'avtrekk')) toast('Ventilen er ikke koblet til et rom. Velg rom i panelet til høyre.');
      return;
    }
    if (g.verktoy === 'aggregat') {
      tgFor();
      var na = { id: uid('a'), type: 'aggregat', etasje: tgEt(), x: rnd(sp.p[0]), y: rnd(sp.p[1]), anlegg: innst().standardSystem };
      tgData().elementer.push(na); g.valgt = na.id; g.verktoy = 'kanal'; tgEtter(); renderToolbarState(); toast('Aggregatet er plassert. Tegn kanalene fra aggregatet.');
    }
  }
  function tgHandle(p) {
    var g = tgS(), e = g.valgt && tgData().elementer.find(function (x) { return x.id === g.valgt; });
    if (!e || e.type !== 'kanal') return null;
    for (var i = 0; i < e.pts.length; i++) if (d2(p, e.pts[i]) < px(8)) return { el: e, idx: i };
    return null;
  }
  function flyttTilkoblede(fra, til, unntatt) {
    tgElementer(tgEt()).forEach(function (el) {
      if (el === unntatt) return;
      if (el.type === 'kanal') el.pts.forEach(function (q, i) { if (d2(q, fra) < 1e-6) el.pts[i] = til.slice(); });
    });
  }
  function tgMove(e) {
    var g = tgS(); if (!g.view) return;
    if (g.drag && g.drag.type === 'pan') { g.view.x = g.drag.vx - (e.clientX - g.drag.sx) / g.view.s; g.view.y = g.drag.vy - (e.clientY - g.drag.sy) / g.view.s; tgTransform(); return; }
    var p = tgPunkt(e);
    if (g.drag && g.drag.type === 'flytt') {
      var el = g.drag.el, sp = tgSnap(p, e, { ignorer: function (x) { return x === el; }, ingenLinje: false });
      var fra = [el.x, el.y]; el.x = rnd(sp.p[0]); el.y = rnd(sp.p[1]); flyttTilkoblede(fra, [el.x, el.y], el); g.drag.moved = true; tgTegn(); return;
    }
    if (g.drag && g.drag.type === 'node') {
      var k = g.drag.el, sp2 = tgSnap(p, e, { ignorer: function (x) { return x === k; } });
      var gammel = k.pts[g.drag.idx].slice(); var ny = [rnd(sp2.p[0]), rnd(sp2.p[1])];
      k.pts[g.drag.idx] = ny; flyttTilkoblede(gammel, ny, k); tgTegn(); return;
    }
    g.mus = g.verktoy === 'velg' ? null : tgSnap(p, e);
    tgOverlay();
  }
  function tgUp(e) {
    var g = tgS(), svg = $('#tgSvg'); if (!g.drag) return;
    try { svg.releasePointerCapture(e.pointerId); } catch (x) { /* ok */ }
    svg.classList.remove('panning');
    var d = g.drag; g.drag = null;
    if (d.type === 'pan' && d.klikk && Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) < 4 && g.valgt) { g.valgt = null; tgTegn(); tgPanel(); return; }
    if (d.type === 'flytt' || d.type === 'node') {
      if (d.type === 'flytt' && !d.moved) { g.hist.pop(); tgPanel(); return; }
      if (d.type === 'flytt' && (d.el.side === 'tilluft' || d.el.side === 'avtrekk')) { var rm = romVed(tgEt(), [d.el.x, d.el.y]); if (rm) d.el.romId = rm.id; }
      tgEtter();
    }
  }
  function tgFullfor() {
    var g = tgS();
    if (g.verktoy === 'kanal' && g.utkast.length >= 2) {
      tgFor();
      var pts = g.utkast.filter(function (p, i, a) { return i === 0 || d2(p, a[i - 1]) > 1e-6; }).map(function (p) { return [rnd(p[0]), rnd(p[1])]; });
      if (pts.length >= 2) { var k = { id: uid('k'), type: 'kanal', etasje: tgEt(), side: g.side, pts: pts, dim: 'auto' }; tgData().elementer.push(k); }
      g.utkast = []; tgEtter(); return;
    }
    if (g.verktoy === 'rom' && g.utkast.length >= 3) { var poly = g.utkast.slice(); g.utkast = []; tgOverlay(); tgNyttRom(poly); return; }
    g.utkast = []; tgOverlay();
  }
  function tgNyttRom(poly) {
    var A = Math.abs(FV.polyArea(poly)), m = meta() || {};
    modal('<h2>Nytt rom</h2><p class="small muted">Areal fra tegningen: <b>' + fmt(A, 2) + ' m²</b></p><form id="nrForm" class="grid2" novalidate>' +
      '<label class="f"><span>Romnummer</span><input type="text" id="nr-nummer"></label><label class="f"><span>Romnavn</span><input type="text" id="nr-navn" required></label>' +
      '<label class="f" style="grid-column:1/-1"><span>Romtype</span><select id="nr-type">' + typeOptions(m.byggtype === 'yrkesbygg' ? 'y_opphold' : 'b_stue') + '</select></label>' +
      '<div class="modal-actions" style="grid-column:1/-1"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" type="submit">Legg til rom</button></div></form>', function (root) {
      var navn = root.querySelector('#nr-navn'), typ = root.querySelector('#nr-type');
      navn.addEventListener('input', function () { typ.value = FV.gjettRomtype(navn.value, m.byggtype); });
      root.querySelector('#nrForm').addEventListener('submit', function (ev) {
        ev.preventDefault(); if (!navn.value.trim()) { navn.focus(); return; }
        tgFor();
        var et = tgEt(), kote = (rom().find(function (r) { return r.etasje === et; }) || {}).etasjeKote || 0;
        var r = { id: uid('m'), guid: null, nummer: root.querySelector('#nr-nummer').value.trim(), navn: navn.value.trim(), etasje: et, etasjeKote: kote, areal: Math.round(A * 100) / 100, arealKilde: 'Tegnet på plantegning', arealManuell: false, tegnet: true, poly: [poly.map(function (p) { return [rnd(p[0]), rnd(-p[1])]; })], type: typ.value, personer: null, senger: null, system: innst().standardSystem, boenhet: 'Boenhet 1', tilluftProsj: null, avtrekkProsj: null, merknad: '' };
        S.data.rom.push(r); closeModal(); tgEtter(); renderTabs(); toast('Rommet er lagt til med ' + fmt(A, 1) + ' m²');
      });
    });
  }
  function tgKalibrer(a, b) {
    var et = tgEt(), u = tgEtData(et).underlag;
    if (!u) { toast('Last inn en plantegning først. Rom fra IFC har allerede riktig målestokk.'); return; }
    var naa = d2(a, b); if (naa < 1e-6) return;
    modal('<h2>Sett målestokk</h2><p>Hvor lang er avstanden du klikket i virkeligheten?</p><form id="kbForm" class="stack" novalidate><label class="f"><span>Lengde i meter</span><input type="text" inputmode="decimal" id="kb-l" placeholder="For eksempel 4,2"></label><p class="small" id="kb-err" hidden style="color:var(--crit);margin:0"></p><div class="modal-actions"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" type="submit">Bruk målestokken</button></div></form>', function (root) {
      root.querySelector('#kbForm').addEventListener('submit', function (ev) {
        ev.preventDefault(); var L = parseNum(root.querySelector('#kb-l').value);
        if (!L || L <= 0) { var er = root.querySelector('#kb-err'); er.textContent = 'Skriv inn en lengde større enn null.'; er.hidden = false; return; }
        tgFor(); tgSkaler(et, L / naa); u.kalibrert = true; closeModal(); tgS().verktoy = 'velg'; tgS().view = null; changed(); renderMain(); toast('Målestokken er satt');
      });
    });
  }
  function tgSkaler(et, f) {
    var u = tgEtData(et).underlag; if (u) u.mPerPx = u.mPerPx * f;
    tgElementer(et).forEach(function (el) { if (el.pts) el.pts = el.pts.map(function (p) { return [rnd(p[0] * f), rnd(p[1] * f)]; }); else { el.x = rnd(el.x * f); el.y = rnd(el.y * f); } });
    rom().forEach(function (r) { if (r.etasje === et && r.tegnet && r.poly) { r.poly = r.poly.map(function (pl) { return pl.map(function (p) { return [rnd(p[0] * f), rnd(p[1] * f)]; }); }); r.areal = Math.round(Math.abs(FV.polyArea(r.poly[0])) * 100) / 100; } });
  }
  function renderToolbarState() { document.querySelectorAll('[data-act=tg-verktoy]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.v === tgS().verktoy)); }); var svg = $('#tgSvg'); if (svg) svg.dataset.tool = tgS().verktoy; tgOverlay(); }

  // ---------- Plantegning (underlag) ----------
  function lastSkript(url) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = url; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
  async function pdfjs() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await lastSkript(PDFJS + 'pdf.min.js');
    try { var w = await (await fetch(PDFJS + 'pdf.worker.min.js')).text(); window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([w], { type: 'text/javascript' })); } catch (e) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js'; }
    return window.pdfjsLib;
  }
  function underlagDialog(forhandsfil) {
    modal('<h2>Plantegning for ' + esc(tgEt()) + '</h2><p class="small muted">PDF, PNG eller JPG. Tegninger fra arkitekt i PDF gir skarpest resultat.</p><form id="ulForm" class="stack" novalidate>' +
      '<label class="f"><span>Fil</span><input type="file" id="ul-fil" accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"></label>' +
      '<div id="ul-pdf" hidden class="grid2"><label class="f"><span>Side i PDF-en</span><select id="ul-side"></select></label><label class="f"><span>Målestokk på tegningen</span><select id="ul-mal"><option value="">Vet ikke, settes etterpå</option><option value="20">1:20</option><option value="50">1:50</option><option value="100">1:100</option><option value="200">1:200</option><option value="500">1:500</option></select></label></div>' +
      '<p class="small muted" id="ul-info" style="margin:0"></p><p class="small" id="ul-err" hidden style="color:var(--crit);margin:0"></p>' +
      '<div class="modal-actions"><button class="btn" type="button" data-act="modal-close">Avbryt</button><button class="btn primary" type="submit" disabled>Last inn</button></div></form>', function (root) {
      var fil = root.querySelector('#ul-fil'), btn = root.querySelector('button[type=submit]'), err = root.querySelector('#ul-err'), info = root.querySelector('#ul-info'), pdfDok = null;
      fil.addEventListener('change', async function () {
        err.hidden = true; pdfDok = null; root.querySelector('#ul-pdf').hidden = true; btn.disabled = true;
        var f = fil.files[0]; if (!f) return;
        if (f.size > 60 * 1024 * 1024) { err.textContent = 'Filen er større enn 60 MB.'; err.hidden = false; return; }
        if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
          info.textContent = 'Leser PDF…';
          try { var lib = await pdfjs(); pdfDok = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise; }
          catch (e) { err.textContent = 'Kunne ikke lese PDF-en.'; err.hidden = false; info.textContent = ''; return; }
          var sel = root.querySelector('#ul-side'); sel.innerHTML = ''; for (var i = 1; i <= pdfDok.numPages; i++) sel.innerHTML += '<option value="' + i + '">Side ' + i + '</option>';
          root.querySelector('#ul-pdf').hidden = false; info.textContent = pdfDok.numPages + ' side' + (pdfDok.numPages > 1 ? 'r' : '') + '. Står målestokken på tegningen (for eksempel 1:100 på A3), kan du velge den.';
        } else info.textContent = 'Målestokken setter du etterpå ved å klikke på et kjent mål.';
        btn.disabled = false;
      });
      if (forhandsfil) {
        try { var dtf = new DataTransfer(); dtf.items.add(forhandsfil); fil.files = dtf.files; fil.dispatchEvent(new Event('change')); }
        catch (x) { info.textContent = 'Kunne ikke ta imot filen direkte. Velg den med knappen over.'; }
      }
      root.querySelector('#ulForm').addEventListener('submit', async function (ev) {
        ev.preventDefault(); var f = fil.files[0]; if (!f) return; btn.disabled = true; btn.textContent = 'Laster inn…'; err.hidden = true;
        try {
          var canvas = document.createElement('canvas'), ctx = canvas.getContext('2d'), mPerPx = 0.01, kalibrert = false;
          if (pdfDok) {
            var side = await pdfDok.getPage(+root.querySelector('#ul-side').value), vp0 = side.getViewport({ scale: 1 });
            var sc = Math.min(4, 4200 / Math.max(vp0.width, vp0.height)), vp = side.getViewport({ scale: sc });
            canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            await side.render({ canvasContext: ctx, viewport: vp }).promise;
            var mal = +root.querySelector('#ul-mal').value;
            if (mal) { mPerPx = (25.4 / 72 / 1000) / sc * mal; kalibrert = true; }
          } else {
            var img = await new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = URL.createObjectURL(f); });
            var k = Math.min(1, 4200 / Math.max(img.naturalWidth, img.naturalHeight));
            canvas.width = Math.round(img.naturalWidth * k); canvas.height = Math.round(img.naturalHeight * k);
            ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
          var blob = await new Promise(function (res) { canvas.toBlob(res, 'image/jpeg', 0.86); });
          var m = meta() || {}, path = (m.bedrift_id || S.ctx) + '/' + S.pid + '/' + uid('u') + '.jpg';
          var up = await sb.storage.from('underlag').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
          if (up.error) throw new Error(/row-level|policy/i.test(up.error.message) ? 'Du mangler tilgang til å laste opp.' : up.error.message);
          var et = tgEt(), ed = tgEtData(et), gammel = ed.underlag;
          tgFor();
          if (gammel && gammel.kalibrert && !kalibrert) { /* behold elementenes posisjon */ }
          ed.underlag = { path: path, bredde: canvas.width, hoyde: canvas.height, mPerPx: mPerPx, kalibrert: kalibrert, fil: f.name };
          tgS().bilder[path] = URL.createObjectURL(blob);
          if (gammel) sb.storage.from('underlag').remove([gammel.path]).then(function () { /* ryddet */ });
          closeModal(); tgS().view = null; changed(); logg('plantegning_lastet', (meta() || {}).navn, { fil: f.name, etasje: et });
          if (!kalibrert) { tgS().verktoy = 'kalib'; }
          renderMain(); toast(kalibrert ? 'Plantegningen er lastet inn med målestokk 1:' + root.querySelector('#ul-mal').value : 'Plantegningen er lastet inn. Klikk to punkter med kjent avstand for å sette målestokk.');
        } catch (e) { err.textContent = 'Kunne ikke laste inn: ' + (e.message || e); err.hidden = false; btn.disabled = false; btn.textContent = 'Last inn'; }
      });
    });
  }

  // ---------- Eksport ----------
  async function tgEksportPng() {
    var g = tgS(), et = tgEt(), ed = tgEtData(et), b = tgBounds(et), m = meta() || {};
    var pad = Math.max(b.maxx - b.minx, b.maxy - b.miny) * 0.04, W = 3200;
    var ww = b.maxx - b.minx + 2 * pad, wh = b.maxy - b.miny + 2 * pad, s = W / ww, H = Math.round(wh * s), topp = 150, bunn = 120;
    var gammel = g.view; g.view = { et: et, s: s / 2.4, x: b.minx - pad, y: b.miny - pad };
    tgTegn();
    var verden = $('#tgWorld').innerHTML;
    g.view = gammel; tgTegn();
    if (ed.underlag && g.bilder[ed.underlag.path] && g.bilder[ed.underlag.path].length > 10) {
      var blob = await (await fetch(g.bilder[ed.underlag.path])).blob();
      var dataUrl = await new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(r.result); }; r.readAsDataURL(blob); });
      verden = verden.replace(/href="blob:[^"]+"/, 'href="' + dataUrl + '"');
    }
    var cs = getComputedStyle(document.documentElement), varer = ['--supply', '--exhaust', '--uteluft', '--avkast', '--ink', '--muted', '--sheet', '--line', '--crit', '--ok-soft'];
    var css = ':root{' + varer.map(function (v) { return v + ':' + (v === '--sheet' ? '#ffffff' : v === '--ink' ? '#15212b' : v === '--muted' ? '#5b6872' : v === '--line' ? '#d5dcdf' : v === '--ok-soft' ? '#e2f1e7' : TG_FAST[v] || cs.getPropertyValue(v)); }).join(';') + '}' + TG_CSS_EKSPORT;
    var legend = Object.keys(TG_SIDER).map(function (k, i) { return '<g transform="translate(' + (40 + i * 260) + ' ' + (H + topp + 50) + ')"><line x1="0" y1="0" x2="60" y2="0" stroke="' + TG_SIDER[k].fast + '" stroke-width="10"/><text x="76" y="9" font-size="26" fill="#15212b">' + TG_SIDER[k].navn + '</text></g>'; }).join('');
    var malBar = (function () { var n = [1, 2, 5, 10, 20, 50].filter(function (x) { return x * s < 600; }).pop() || 1; return '<g transform="translate(' + (W - 40 - n * s) + ' ' + (H + topp + 50) + ')"><rect x="0" y="-8" width="' + n * s + '" height="16" fill="#15212b"/><text x="' + n * s / 2 + '" y="44" font-size="24" text-anchor="middle" fill="#15212b">' + n + ' m</text></g>'; })();
    var tittel = '<text x="40" y="62" font-size="44" font-weight="600" fill="#15212b">' + esc((m.nummer ? m.nummer + ' ' : '') + (m.navn || '')) + '</text><text x="40" y="112" font-size="28" fill="#5b6872">Ventilasjon, ' + esc(et) + '. ' + esc(datoKort(new Date().toISOString())) + '. Fjelluft Vent</text>';
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + (H + topp + bunn) + '"><style>' + css + '</style><rect width="100%" height="100%" fill="#fff"/>' + tittel +
      '<g transform="translate(0 ' + topp + ') matrix(' + s + ',0,0,' + s + ',' + (-(b.minx - pad) * s) + ',' + (-(b.miny - pad) * s) + ')">' + verden + '</g>' + legend + malBar + '</svg>';
    var url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    var img = await new Promise(function (res, rej) { var im = new Image(); im.onload = function () { res(im); }; im.onerror = rej; im.src = url; });
    var c = document.createElement('canvas'); c.width = W; c.height = H + topp + bunn; c.getContext('2d').drawImage(img, 0, 0);
    var png = await new Promise(function (res) { c.toBlob(res, 'image/png'); });
    saveFile(safeName('Ventilasjon ' + (m.nummer ? m.nummer + ' ' : '') + (m.navn || '') + ' ' + et) + '.png', png); logg('eksport_tegning', m.navn, { etasje: et });
  }
  var TG_FAST = { '--supply': '#1d64a6', '--exhaust': '#b0532a', '--uteluft': '#2f8a57', '--avkast': '#7a5aa6', '--crit': '#b3261e' };
  var TG_CSS_EKSPORT = 'text{font-family:Arial,Helvetica,sans-serif}.tg-rom{fill:rgba(29,100,166,.05);stroke:#15212b;stroke-width:0.02}.tg-rom.over{fill:none;stroke:none}.tg-romtxt{fill:#15212b}.tg-romtxt .t{fill:#1d64a6}.tg-romtxt .a{fill:#b0532a}.tg-kanal{stroke-linecap:round;opacity:.9}.tg-krit{stroke:#15212b;fill:none}.tg-sym{fill:#fff}.tg-agg{fill:#fff;stroke:#15212b}.tg-aggtxt{fill:#15212b;font-weight:600}.tg-lbl{font-weight:600}.tg-handle{display:none}';

  function tgMengdeCsv() {
    var res = tgS().res || tgBeregn(), ml = res.mengde, rows = [['System', 'Komponent', 'Dimensjon', 'Mengde', 'Enhet']];
    Object.keys(ml.kanal).sort().forEach(function (k) { var p = k.split('|'); rows.push([TG_SIDER[p[0]].navn, 'Kanal', p[1], ml.kanal[k].toFixed(1).replace('.', ','), 'm']); });
    [['bend90', 'Bend 90°'], ['bend45', 'Bend 45°'], ['tstk', 'T-stykke']].forEach(function (b) { Object.keys(ml[b[0]]).sort().forEach(function (k) { var p = k.split('|'); rows.push([TG_SIDER[p[0]].navn, b[1], p[1], ml[b[0]][k], 'stk']); }); });
    if (ml.overgang) rows.push(['', 'Overgang', '', ml.overgang, 'stk']);
    Object.keys(ml.ventiler).forEach(function (k) { rows.push(['', k, '', ml.ventiler[k], 'stk']); });
    if (ml.aggregat) rows.push(['', 'Aggregat', '', ml.aggregat, 'stk']);
    var m = meta() || {};
    saveFile(safeName('Mengdeliste ' + (m.nummer ? m.nummer + ' ' : '') + (m.navn || '')) + '.csv', '﻿' + rows.map(function (r) { return r.join(';'); }).join('\r\n'));
  }
  function tgTilKanaler() {
    var res = tgS().res || tgBeregn(), t = tgData(), n = 0;
    S.data.strekninger = S.data.strekninger.filter(function (s) { return !s.fraTegning; });
    res.anlegg.forEach(function (a) {
      if (!a.kritisk || !a.kritisk.sti.length) return;
      var sti = a.kritisk.sti.slice().reverse(), deler = [], cur = null, venter = 0;
      sti.forEach(function (ed, i) {
        var dimV = ed.k ? (ed.k.a ? ed.k.a + 'x' + ed.k.b : String(ed.k.d)) : 'auto';
        if (!cur || cur.q !== Math.round(ed.q) || cur.dim !== dimV) { cur = { id: uid('d'), navn: 'Del ' + (deler.length + 1), q: Math.round(ed.q), type: 'hoved', lengde: 0, dim: dimV, zeta: Math.round(venter * 100) / 100, komponentPa: null }; deler.push(cur); venter = 0; }
        cur.lengde = Math.round((cur.lengde + ed.len) * 100) / 100;
        var nesteE = sti[i + 1];
        if (nesteE) { var node = ed.ned, ang = vinkel(ed.opp.p, node.p, nesteE.ned.p); var z = node.kanter.length >= 3 ? (ang < 20 ? 0.3 : 1.0) : (ang > 20 ? 0.3 * Math.min(ang, 90) / 90 : 0); if (nesteE.d && ed.d && nesteE.d !== ed.d) z += 0.1; var nyDel = Math.round(nesteE.q) !== Math.round(ed.q) || (nesteE.k ? (nesteE.k.a ? nesteE.k.a + 'x' + nesteE.k.b : String(nesteE.k.d)) : 'auto') !== cur.dim; if (nyDel) venter += z; else cur.zeta = Math.round((cur.zeta + z) * 100) / 100; }
      });
      var v = a.kritisk.ventil, term = v.pa !== null && v.pa !== undefined && v.pa !== '' ? Number(v.pa) : (a.side === 'uteluft' || a.side === 'avkast' ? t.innst.ristPa : t.innst.ventilPa);
      deler[deler.length - 1].komponentPa = term; deler[deler.length - 1].navn += ' til ' + (v.navn || (findRoom(v.romId) || {}).navn || 'ventil');
      S.data.strekninger.push({ id: uid('s'), fraTegning: true, navn: 'Fra tegning: ' + a.anlegg + ' ' + TG_SIDER[a.side].navn.toLowerCase(), system: a.anlegg, side: a.side === 'avtrekk' || a.side === 'avkast' ? 'avtrekk' : 'tilluft', deler: deler });
      n++;
    });
    if (!n) { toast('Tegningen har ingen komplette kanalnett ennå.'); return; }
    changed(); toast(n + ' kritiske strekninger er lagt inn under Kanaler og trykkfall');
  }

  // ---------- Hendelser for tegning ----------
  async function tgClick(act, a) {
    if (act.indexOf('tg-') !== 0) return false;
    var g = tgS();
    if (act === 'tg-verktoy') { g.verktoy = a.dataset.v; g.utkast = []; g.maal = null; if (g.verktoy !== 'velg') g.valgt = null; renderToolbarState(); tgTegn(); tgPanel(); return true; }
    if (act === 'tg-zoom') { tgZoom(+a.dataset.z); return true; }
    if (act === 'tg-tilpass') { tgTilpass(); return true; }
    if (act === 'tg-angre') { tgAngre(false); return true; }
    if (act === 'tg-png') { try { await tgEksportPng(); } catch (e) { toast('Kunne ikke lage bildet.'); } return true; }
    if (act === 'tg-mengde-csv') { tgMengdeCsv(); return true; }
    if (act === 'tg-fjernvalg') { g.valgt = null; tgTegn(); tgPanel(); return true; }
    if (act === 'tg-vis') { var el = tgData().elementer.find(function (x) { return x.id === a.dataset.id; }); if (el) { g.etasje = el.etasje; g.valgt = el.id; renderMain(); } return true; }
    if (!S.canWrite) return true;
    if (act === 'tg-underlag') { underlagDialog(); return true; }
    if (act === 'tg-slett') { tgSlettValgt(); return true; }
    if (act === 'tg-til-kanaler') { tgTilKanaler(); return true; }
    if (act === 'tg-fjern-underlag') {
      var ed = tgEtData(tgEt()); if (!ed.underlag) return true; tgFor(); var p = ed.underlag.path; ed.underlag = null;
      sb.storage.from('underlag').remove([p]).then(function () { /* ryddet */ }); changed(); renderMain(); toast('Plantegningen er fjernet'); return true;
    }
    return true;
  }
  function tgSlettValgt() {
    var g = tgS(); if (!g.valgt || !S.canWrite) return;
    tgFor(); tgData().elementer = tgData().elementer.filter(function (x) { return x.id !== g.valgt; }); g.valgt = null; tgEtter();
  }
  function tgChange(t) {
    var g = tgS();
    if (t.id === 'tgEt') { g.etasje = t.value; g.view = null; g.valgt = null; g.utkast = []; renderMain(); return true; }
    if (t.id === 'tgSide') { g.side = t.value; tgOverlay(); return true; }
    if (t.id === 'tgVisRom') { g.visRom = t.checked; tgTegn(); return true; }
    if (t.dataset.tgp) {
      if (!S.canWrite) return true;
      var e = tgData().elementer.find(function (x) { return x.id === g.valgt; }); if (!e) return true;
      var f = t.dataset.tgp, v = t.value;
      tgFor();
      if (f === 'q' || f === 'pa') { var n = parseNum(v); if (v.trim() !== '' && (n === null || n < 0)) { toast('Skriv inn et tall'); g.hist.pop(); tgPanel(); return true; } e[f] = n; }
      else if (f === 'dim') { var dv = v.trim().toLowerCase(); if (dv && !/^\d+$/.test(dv) && !/^\d+\s*[x×*]\s*\d+$/.test(dv)) { toast('Skriv 200 for rund eller 400x200 for rektangulær kanal'); g.hist.pop(); tgPanel(); return true; } e.dim = dv ? dv.replace(/[×*\s]/g, 'x').replace(/x+/g, 'x') : 'auto'; }
      else if (f === 'romId') e.romId = v || null;
      else e[f] = v;
      tgEtter(); return true;
    }
    return false;
  }
  function tgKey(e) {
    if (S.tab !== 'tegning' || S.side !== 'prosjekt' || $('#modalRoot').innerHTML) return false;
    if (e.target.matches('input,select,textarea')) return false;
    var g = tgS();
    if (e.key === 'Escape') { if (g.utkast.length) { g.utkast = []; tgOverlay(); } else { g.valgt = null; g.verktoy = 'velg'; renderToolbarState(); tgTegn(); tgPanel(); } return true; }
    if (e.key === 'Enter') { tgFullfor(); return true; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && g.valgt) { e.preventDefault(); tgSlettValgt(); return true; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); tgAngre(e.shiftKey); return true; }
    var snarvei = { v: 'velg', k: 'kanal', e: 'ventil', a: 'aggregat', r: 'rom', m: 'maal' }[e.key.toLowerCase()];
    if (snarvei && !e.ctrlKey && !e.metaKey && (S.canWrite || snarvei === 'velg' || snarvei === 'maal')) { g.verktoy = snarvei; g.utkast = []; renderToolbarState(); return true; }
    if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') { g.side = ['tilluft', 'avtrekk', 'uteluft', 'avkast'][+e.key - 1]; var s = $('#tgSide'); if (s) s.value = g.side; tgOverlay(); return true; }
    return false;
  }

  // ---------- Dra og slipp på tegneflaten ----------
  function harFiler(e) { var t = e.dataTransfer && e.dataTransfer.types; return !!t && Array.prototype.indexOf.call(t, 'Files') >= 0; }
  function tgDropAktiv(e) { return S.mode === 'app' && S.side === 'prosjekt' && S.tab === 'tegning' && S.data && e.target.closest && e.target.closest('.tg'); }
  function tgDropVis(pa) {
    var c = $('#tgCanvas'); if (!c) return;
    clearTimeout(tgDropVis.t);
    if (pa) { c.classList.add('drop'); tgDropVis.t = setTimeout(function () { c.classList.remove('drop'); }, 180); }
    else c.classList.remove('drop');
  }
  document.addEventListener('dragover', function (e) {
    if (!harFiler(e)) return;
    e.preventDefault();
    if (tgDropAktiv(e)) { e.dataTransfer.dropEffect = S.canWrite ? 'copy' : 'none'; tgDropVis(true); }
    else if (!(e.target.closest && e.target.closest('#dropZone'))) e.dataTransfer.dropEffect = 'none';
  });
  document.addEventListener('drop', function (e) {
    if (!harFiler(e)) return;
    if (!tgDropAktiv(e)) { if (!(e.target.closest && e.target.closest('#dropZone'))) e.preventDefault(); return; }
    e.preventDefault(); tgDropVis(false);
    if (!S.canWrite) { toast('Du har ikke tilgang til å endre dette prosjektet.'); return; }
    var filer = Array.prototype.slice.call(e.dataTransfer.files || []);
    if (!filer.length) { toast('Fant ingen fil. Lagre vedlegget fra e-posten først, og dra det inn derfra.'); return; }
    var ifc = filer.find(function (f) { return /\.ifc$/i.test(f.name); });
    if (ifc) { $('#ifcFile').dataset.purpose = 'import'; handleIfcFile(ifc, 'import'); return; }
    var plan = filer.find(function (f) { return /\.(pdf|png|jpe?g)$/i.test(f.name) || /^(application\/pdf|image\/(png|jpeg))$/.test(f.type); });
    if (!plan) { toast('Filtypen støttes ikke. Bruk PDF, PNG, JPG eller IFC.'); return; }
    if (filer.length > 1) toast('Flere filer ble sluppet. Leser inn ' + plan.name + ' for ' + tgEt() + '.');
    underlagDialog(plan);
  });

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
      if (act0 === 'vis-registrer' || act0 === 'vis-logginn') { e.preventDefault(); S.loginVisning = act0 === 'vis-registrer' ? 'registrer' : 'logginn'; renderMain(); var f0 = $(act0 === 'vis-registrer' ? '#rg-orgnr' : '#li-epost'); if (f0) f0.focus(); return; }
      if (act0 === 'til-abonnement') { flushSave(); S.side = 'admin'; S.atab = 'a-bedrift'; S.adm = null; renderAll(); window.scrollTo(0, 0); return; }
      if (act0 === 'betalingsportal' && S.side !== 'admin') { a0.disabled = true; try { var rp0 = await adminKall({ handling: 'portal' }); location.href = rp0.url; } catch (e5) { toast(e5.message); a0.disabled = false; } return; }
      if (act0 === 'side') { flushSave(); S.side = a0.dataset.side; if (S.side === 'admin') { S.adm = null; } if (S.side === 'prosjekt' && !S.pid) { await lastProsjekter(); return; } renderAll(); window.scrollTo(0, 0); return; }
      if (act0 === 'lagre-navn') { var nv0 = $('#pf-navn').value.trim(); var rr = await sb.rpc('oppdater_mitt_navn', { p_navn: nv0 }); if (rr.error) toast('Kunne ikke lagre navnet'); else { S.me.navn = nv0; renderHeader(); toast('Navnet er lagret'); } return; }
      if (act0 === 'konflikt-last') { closeModal(); S.konflikt = false; S.dirty = false; var p0 = S.pid; S.pid = null; await openProject(p0); toast('Siste versjon er lastet inn'); return; }
      if (act0 === 'konflikt-overskriv') { closeModal(); S.konflikt = false; await doSave(true); return; }
      if (act0 === 'archive' || act0 === 'unarchive') { await settArkivert(S.pid, act0 === 'archive'); return; }
      if (S.side === 'prosjekt' && await tgClick(act0, a0)) return;
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
    if (S.side === 'prosjekt' && tgChange(t)) return;
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
    if (tgKey(e)) return;
    if (e.key === 'Escape' && $('#modalRoot').innerHTML) { closeModal(); return; }
    if (e.key === 'Enter' && e.target.matches('td input[type=text]')) { e.target.blur(); }
  });
  // Dra og slipp IFC
  document.addEventListener('dragover', function (e) { var dz = e.target.closest && e.target.closest('#dropZone'); if (dz) { e.preventDefault(); dz.classList.add('over'); } });
  document.addEventListener('dragleave', function (e) { var dz = e.target.closest && e.target.closest('#dropZone'); if (dz) dz.classList.remove('over'); });
  document.addEventListener('drop', function (e) { var dz = e.target.closest && e.target.closest('#dropZone'); if (dz) { e.preventDefault(); dz.classList.remove('over'); if (!S.canWrite) return; handleIfcFile(e.dataTransfer.files[0], 'import'); } });
  $('#newProjBtn').addEventListener('click', newProjectDialog);
  var brregTimer = null, brregSist = '';
  document.addEventListener('input', function (e) {
    if (e.target.id !== 'rg-orgnr') return;
    var o = e.target.value.replace(/\s/g, ''), info = $('#rg-brreg');
    clearTimeout(brregTimer);
    if (!/^\d{9}$/.test(o)) { info.textContent = ''; brregSist = ''; return; }
    if (o === brregSist) return;
    info.textContent = 'Slår opp i Enhetsregisteret…';
    brregTimer = setTimeout(async function () {
      brregSist = o;
      try {
        var r = await registrerKall({ handling: 'oppslag', orgnr: o });
        if ($('#rg-orgnr').value.replace(/\s/g, '') !== o) return;
        if (r.ukjent) { info.textContent = 'Fikk ikke svar fra Enhetsregisteret. Skriv inn bedriftsnavnet selv.'; return; }
        info.textContent = r.konkurs ? 'Bedriften er registrert som slettet, konkurs eller under avvikling.' : '✓ ' + r.navn + (r.adresse ? ', ' + r.adresse : '');
        if (!r.konkurs) { var bn = $('#rg-bedrift'); bn.value = r.navn; }
      } catch (e3) { info.textContent = e3.message; }
    }, 300);
  });
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
    if (e.target.id === 'stripeForm') { e.preventDefault(); await stripeNokkelSubmit(e.target); return; }
    if (e.target.id === 'regForm') {
      e.preventDefault(); var re = $('#rg-err'), rb = $('#rg-btn'); re.hidden = true;
      var f = { orgnr: $('#rg-orgnr').value.replace(/\s/g, ''), bedrift: $('#rg-bedrift').value.trim(), navn: $('#rg-navn').value.trim(), epost: $('#rg-epost').value.trim(), telefon: $('#rg-telefon').value.trim(), passord: $('#rg-passord').value, nettside: $('#rg-nettside').value, vilkar: $('#rg-vilkar').checked };
      var mangler = !/^\d{9}$/.test(f.orgnr) ? 'Skriv inn organisasjonsnummeret (9 siffer).' : !f.bedrift ? 'Skriv inn bedriftsnavnet.' : !f.navn ? 'Skriv inn navnet ditt.' : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.epost) ? 'Skriv inn en gyldig e-postadresse.' : f.passord.length < 10 ? 'Passordet må ha minst 10 tegn.' : !f.vilkar ? 'Du må godta vilkårene for å fortsette.' : '';
      if (mangler) { re.textContent = mangler; re.hidden = false; return; }
      rb.disabled = true; rb.textContent = 'Oppretter kontoen…';
      try {
        await registrerKall(f);
        var lf = await login(f.epost, f.passord);
        if (lf) throw new Error('Kontoen er opprettet, men innloggingen feilet: ' + lf);
        S.loginVisning = null; toast('Velkommen! Prøveperioden har startet.');
      } catch (e4) { if (S.mode !== 'login') { S.mode = 'login'; renderAll(); } var re2 = $('#rg-err'); if (re2) { re2.textContent = e4.message; re2.hidden = false; } var rb2 = $('#rg-btn'); if (rb2) { rb2.disabled = false; rb2.textContent = 'Start prøveperioden'; } }
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
