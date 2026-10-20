/* Nora AI: demo av Tilbudskalkulator uten AI-kall.
   Viser hele eksempeltilbudet slik det ser ut i den ekte appen (samme design), ferdig innlest.
   Brukeren kan endre faktor, og velge tilbud med eller uten priser. Ingen server, ingen kostnad. */
(function () {
  var rot = document.getElementById('dm-rot');
  if (!rot) return;
  var BASE = 'https://app.noraai.no/demo/';
  var EKS = BASE + 'Eksempeltilbud-Produsent.pdf';
  var RABATT = 0.35;
  var faktor = 11.5, utenPriser = false;
  var kurs = null, kursDato = '', kursKilde = '', modus = 'faktor';

  var LOGO = 'data:image/svg+xml;utf8,' + encodeURIComponent(
    "<svg xmlns='http://www.w3.org/2000/svg' width='220' height='60' viewBox='0 0 220 60'><rect x='2' y='8' width='40' height='44' rx='3' fill='none' stroke='#1a3a5c' stroke-width='4'/><line x1='22' y1='8' x2='22' y2='52' stroke='#1a3a5c' stroke-width='3'/><line x1='2' y1='30' x2='42' y2='30' stroke='#1a3a5c' stroke-width='3'/><text x='54' y='28' font-family='Arial,sans-serif' font-size='19' font-weight='700' fill='#1a3a5c'>Eksempel</text><text x='54' y='48' font-family='Arial,sans-serif' font-size='19' fill='#1a3a5c'>Vinduer AS</text></svg>");

  var KUNDE = [['Kunde', 'Vestbygg Prosjekt AS'], ['Kontaktperson', 'Ola Nordmann'], ['Prosjekt', 'Bjørkelia Terrasse, bygg B'],
    ['Adresse', 'Storgata 14, 3050 Mjøndalen'], ['Mobil', '+47 900 12 345'], ['E-post', 'post@vestbyggprosjekt.no']];

  var GL1 = '44.1TH/14Ar/4/14Ar/4TH (44.1 (8,38mm) Thermofloat 1.1/14Ar/4mm Float/14Ar/4mm Thermofloat 1.1) (Avstandsskinner: Varm kant, grå)';
  var GL3 = '33.1TH/14Ar/4/12Ar/4TH (33.1 (6,38mm) Thermofloat 1.1/14Ar/4mm Float/12Ar/4mm Thermofloat 1.1) (Avstandsskinner: Varm kant, grå)';
  var GL5 = '44.1TH/16Ar/4/16Ar/44.1TH (44.1 (8,38mm) Thermofloat 1.1/16Ar/4mm Float/16Ar/44.1 (8,38mm) Thermofloat 1.1) (Avstandsskinner: Varm kant, grå)';
  var GLD = '33.2TH/14Ar/4TH (33.2 (6,76mm) Thermofloat 1.1/14Ar/4mm Thermofloat 1.1) (Avstandsskinner: Varm kant, grå)';
  var SEAL_B = 'Inne: Hvit malbar fugemasse / Ute: Svart fugemasse';
  var VANN_S = 'Liten vannavviser i RAL-farge, svarte endestykker 7016, vannavviser i tre';
  var VANN_H = 'Liten vannavviser i RAL-farge, hvite endestykker 9010';
  var GRA = 'Mørk grå RAL 7016';

  // m: [inne, ute]
  var POS = [
    { dim: '1200x1400mm', m2: '1,68', ant: 12, eur: 742.35, v: 'V1', sk: 1, m: ['Hvit RAL 9010', GRA], s: [
      ['Type', 'Produsent W92 innadslående vindu R4 (standard)'], ['Tresort', 'Fingerskjøtet furu'], ['@M'],
      ['Glass', GL1], ['Rammer/beslag', '1 x Fast karm, 1 x Innadslående dreie-kipp'], ['Bunnkarm', VANN_S], ['Pakninger', 'Svarte pakninger'],
      ['Glassforsegling', SEAL_B], ['Not for foringer', 'Standard 5x10mm'], ['Spor i underkant', 'V1 / L1'], ['Sett fra', 'Innsiden'], ['Vekt', '54 kg'], ['Uw', 'Uw <= 0.94']] },
    { dim: '900x1200mm', m2: '1,08', ant: 8, eur: 561.90, v: 'V1', sk: 2, m: ['Hvit RAL 9010', GRA], s: [
      ['Type', 'Produsent W92 innadslående vindu R4 (standard)'], ['Tresort', 'Fingerskjøtet furu'], ['@M'],
      ['Glass', GL1], ['Rammer/beslag', '1 x Innadslående dreie-kipp, teleskopisk lufting / barnesikring'], ['Bunnkarm', VANN_S], ['Pakninger', 'Svarte pakninger'],
      ['Glassforsegling', SEAL_B], ['Not for foringer', 'Standard 5x10mm'], ['Spor i underkant', 'V1 / L1'], ['Sett fra', 'Innsiden'], ['Vekt', '36 kg'], ['Uw', 'Uw <= 0.96']] },
    { dim: '1600x1700mm', m2: '2,72', ant: 4, eur: 968.44, v: 'V1', sk: 3, m: ['Hvit RAL 9010', 'Hvit RAL 9010'], s: [
      ['Type', 'Produsent W78 innadslående vindu R4 (standard)'], ['Tresort', 'Fingerskjøtet furu'], ['@M'],
      ['Glass', GL3], ['Rammer/beslag', '2 x Fast karm, 1 x Innadslående dreie-kipp'], ['Bunnkarm', 'Liten vannavviser i RAL-farge, hvite endestykker 9010, vannavviser i tre'], ['Pakninger', 'Hvite pakninger'],
      ['Glassforsegling', 'Hvit malbar fugemasse'], ['Not for foringer', 'Standard 5x10mm'], ['Spor i underkant', 'V1 / L1'], ['Sett fra', 'Innsiden'], ['Vekt', '88 kg'], ['Uw', 'Uw <= 0.99']] },
    { dim: '2000x900mm', m2: '1,80', ant: 6, eur: 604.15, v: 'V1', sk: 4, m: ['Hvit RAL 9010', 'Hvit RAL 9010'], s: [
      ['Type', 'Produsent W78 fast vindu R4 (standard)'], ['Tresort', 'Fingerskjøtet furu'], ['@M'],
      ['Glass', GL3], ['Rammer/beslag', '1 x Fast karm'], ['Bunnkarm', VANN_H], ['Pakninger', 'Hvite pakninger'],
      ['Glassforsegling', 'Hvit malbar fugemasse'], ['Not for foringer', 'Standard 5x10mm'], ['Spor i underkant', 'V1 / L1'], ['Sett fra', 'Innsiden'], ['Vekt', '41 kg'], ['Uw', 'Uw <= 1.02']] },
    { dim: '2400x2300mm', m2: '5,52', ant: 2, eur: 3287.60, v: 'V1', sk: 5, m: ['Hvit RAL 9010', GRA], s: [
      ['Type', 'Produsent LS-160 løfte-skyvedør (aluterskel)'], ['Tresort', 'Fingerskjøtet furu'], ['@M'],
      ['Glass', GL5], ['Rammer/beslag', '1 x Fast karm, 1 x Løfte-skyvefløy som skyves mot venstre, Løfte-skyvehåndtak i børstet stål'], ['Bunnkarm', 'Aluterskel 68/62, termisk brudd'], ['Pakninger', 'Svarte pakninger'],
      ['Glassforsegling', SEAL_B], ['Not for foringer', 'Standard 10x10mm'], ['Spor i underkant', 'V1 / L1'], ['Sett fra', 'Innsiden'], ['Vekt', '214 kg'], ['Uw', 'Uw <= 1.18']] },
    { dim: '900x2100mm', m2: '1,89', ant: 3, eur: 1145.70, v: 'V1', sk: 6, m: ['Hvit RAL 9010', GRA], s: [
      ['Type', 'Produsent W92 innadslående balkongdør (aluterskel)'], ['Tresort', 'Fingerskjøtet furu'], ['@M'],
      ['Glass', GL1], ['Rammer/beslag', '1 x Høyre innadslående dør, Håndtak i børstet stål, Hengsler i rustfritt stål'], ['Bunnkarm', 'Aluterskel 68/62, termisk brudd'], ['Pakninger', 'Svarte pakninger'],
      ['Glassforsegling', SEAL_B], ['Not for foringer', 'Standard 10x10mm'], ['Spor i underkant', 'V1 / L1'], ['Sett fra', 'Innsiden'], ['Vekt', '63 kg'], ['Uw', 'Uw <= 1.06']] },
    { dim: '1000x2100mm', m2: '2,10', ant: 1, eur: 2418.90, v: 'D1', sk: 7, m: ['Hvit RAL 9010', GRA], s: [
      ['Type', 'Produsent D115 utadslående ytterdør (karm 53x115 / aluterskel)'], ['Tresort', 'Fingerskjøtet furu'], ['@M'],
      ['Glass', 'Rektangulært glass (450x750mm, 1 stk) ' + GLD], ['Rammer/beslag', '1 x Venstre utadslående dør, Håndtaksett sylinder/sylinder i nikkel, Hengsler i rustfritt stål, 3-punkts lås'],
      ['Sprosser', '24mm sprosser UTV: skråkantet INN: rund'], ['Bunnkarm', 'Tre'], ['Pakninger', 'Grå pakninger'],
      ['Glassforsegling', 'Hvit fugemasse'], ['Not for foringer', 'Standard 10x10mm'], ['Sett fra', 'Utsiden'], ['Vekt', '79 kg'], ['Uw', 'Uw <= 1.14']] },
    { dim: '1600x2100mm', m2: '3,36', ant: 1, eur: 3892.45, v: 'D2', sk: 8, m: ['Hvit RAL 9010', GRA], s: [
      ['Type', 'Produsent D115 utadslående dobbel ytterdør (karm 53x115 / aluterskel)'], ['Tresort', 'Fingerskjøtet furu'], ['@M'],
      ['Glass', 'Rektangulært glass (350x900mm, 2 stk) ' + GLD], ['Rammer/beslag', '1 x Høyre utadslående dobbeldør, Håndtaksett sylinder/sylinder i nikkel, Hengsler i rustfritt stål, 3-punkts lås, espagnolett i sekundærfløy'],
      ['Sprosser', '24mm sprosser UTV: skråkantet INN: rund'], ['Bunnkarm', 'Tre'], ['Pakninger', 'Grå pakninger'],
      ['Glassforsegling', 'Hvit fugemasse'], ['Not for foringer', 'Standard 10x10mm'], ['Sett fra', 'Utsiden'], ['Vekt', '126 kg'], ['Uw', 'Uw <= 1.21']] }
  ];
  var VILKAR = ['Varene utleveres til avtalt leveringsadresse, hvis ikke annet er avtalt.',
    'Tilbudet forutsetter innbetaling av 25% ved bestilling og er gyldig i 14 dager.',
    'Akseptert tilbud av kunde betyr at kunden har kontrollert, forstått og akseptert tilbudet.',
    'Eksempel Vinduer AS har salgspant i varene inntil fullstendig oppgjør er mottatt.',
    'Generell garantiperiode er 5 år.'];

  function h(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function nok(n) { return n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function dato() { return '10.08.2026'; }

  function offerHtml() {
    var tot = 0, totAnt = 0, areal = 0;
    var seksjoner = POS.map(function (p, i) {
      var enhet = Math.round(p.eur * (1 - RABATT) * faktor * 100) / 100;
      var sum = enhet * p.ant; tot += sum; totAnt += p.ant; areal += parseFloat(p.m2.replace(',', '.')) * p.ant;
      p._enhet = enhet; p._sum = sum;
      var rader = p.s.map(function (r) {
        if (r[0] === '@M') return '<div class="spec-row"><span class="spec-label"><em>Malingfarge:</em></span><span class="spec-val-wrap">Inne:&nbsp;<span class="spec-val">' + h(p.m[0]) + '</span>&nbsp; Ute:&nbsp;<span class="spec-val">' + h(p.m[1]) + '</span></span></div>';
        return '<div class="spec-row"><span class="spec-label"><em>' + h(r[0]) + ':</em></span><span class="spec-val">' + h(r[1]) + '</span></div>';
      }).join('');
      return '<div class="product-section"><div class="product-header">Posisjon ' + (i + 1) + ' — ' + p.dim + ' &nbsp;|&nbsp; ' + p.m2 + ' m² &nbsp;|&nbsp; Antall: ' + p.ant + ' stk.</div>' +
        '<div style="border:1px solid #dde2ea;border-top:none;"><div class="product-layout">' +
        '<div class="product-skisse"><img src="' + BASE + 'skisse-' + p.sk + '.png" alt="Teknisk skisse posisjon ' + (i + 1) + '"/><div class="skisse-vnr">' + p.v + '</div></div>' +
        '<div class="product-content"><div class="product-body">' + rader + '</div>' +
        '<div class="price-col prisl" style="border-top:1px solid #eee;padding:8px 14px;display:flex;gap:24px;font-size:12px;background:#f9fbff;">' +
        '<span><span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;">Enhetspris</span><br>kr ' + nok(enhet) + '</span>' +
        '<span><span style="color:#888;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;">Totalpris (' + p.ant + ' stk.)</span><br><strong>kr ' + nok(sum) + '</strong></span></div>' +
        '</div></div></div></div>';
    }).join('');
    var rader = POS.map(function (p) {
      return '<tr><td>' + p.dim + '</td><td style="text-align:center;">' + p.m2 + '</td><td style="text-align:center;">' + p.ant + '</td><td style="text-align:right;" class="price-col">kr ' + nok(p._enhet) + '</td><td style="font-weight:600;text-align:right;" class="sum-col">kr ' + nok(p._sum) + '</td></tr>';
    }).join('');
    var mva = tot * 0.25;
    return '<div class="offer-top"><div class="offer-logo"><img src="' + LOGO + '" alt="Logo"/></div><div class="offer-title-block"><h1>TILBUD</h1><div class="offer-date">' + dato() + '</div><div style="font-size:11px;color:#888;margin-top:3px;letter-spacing:0.05em;">Tilbudsnr. 100482</div></div></div>' +
      '<div class="customer-block">' + KUNDE.map(function (k) { return '<div><div class="cb-label">' + k[0] + '</div><div class="cb-val">' + h(k[1]) + '</div></div>'; }).join('') + '</div>' +
      '<div style="background:#f5f7fa;border:1px solid #e0e5ee;border-radius:6px;padding:10px 16px;margin-bottom:16px;font-size:12px;color:#555;"><strong style="color:#1a3a5c;text-transform:uppercase;font-size:10px;letter-spacing:0.1em;">Omfang</strong><div style="margin-top:4px;display:flex;gap:20px;flex-wrap:wrap;"><span>Antall konstruksjoner: <strong>' + totAnt + '</strong></span><span>Totalt areal: <strong>' + nok(areal).replace(',00', ',00') + '&nbsp;m²</strong></span></div></div>' +
      seksjoner +
      '<div class="price-table-wrapper"><table class="price-table"><thead><tr><th style="text-align:left;">Dimensjon</th><th style="text-align:center;">m²</th><th style="text-align:center;">Antall</th><th class="price-col" style="text-align:right;">Enhetspris, NOK</th><th class="sum-col" style="text-align:right;">Totalpris, NOK</th></tr></thead><tbody>' + rader + '</tbody></table>' +
      '<div class="totals-block"><div class="totals-inner"><div class="total-row"><span>Total ekskl. MVA</span><span>kr ' + nok(tot) + '</span></div><div class="total-row"><span>MVA 25%</span><span>kr ' + nok(mva) + '</span></div><div class="total-row"><span>Total inkl. MVA</span><span>kr ' + nok(tot + mva) + '</span></div></div></div>' +
      '<div style="margin-top:10px;font-size:12px;color:#555;display:flex;gap:24px;padding:8px 4px;border-top:1px solid #dde2ea;"><span>Gjennomsnittlig U-verdi: <strong>1.03</strong></span><span>Total vekt: <strong>2356 kg</strong></span></div></div>' +
      '<div class="vilkar-block"><h4>Vilkår og bestillingsavtale</h4>' + VILKAR.map(function (v, i) { return '<p style="display:block;margin:0 0 3px 0;">' + (i + 1) + '. ' + h(v) + '</p>'; }).join('') + '</div>' +
      '<div class="offer-footer"><div class="seller-block"><div class="seller-name">Kari Selger</div><div class="seller-info">Tlf: 900 00 000</div><div class="seller-info">kari@eksempel-vinduer.example</div></div></div>';
  }

  var FONT = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap">';

  // Kontroller
  var st = document.createElement('style');
  st.textContent = '.dk-bar{display:flex;flex-wrap:wrap;gap:14px 22px;align-items:flex-end;background:#faf8f5;border:1px solid #e3ddd6;border-radius:14px;padding:16px 18px;margin:16px 0}.dk-g{display:flex;flex-direction:column;gap:5px}.dk-g label,.dk-l{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;opacity:.75}.dk-g input{width:90px;font-size:16px;padding:9px 10px;border:1px solid #b9b2a8;border-radius:8px;background:#fff}.dk-seg{display:inline-flex;border:1px solid #21263e;border-radius:999px;overflow:hidden}.dk-seg button{border:0;background:#fff;color:#21263e;padding:11px 18px;font-size:15px;font-weight:700;cursor:pointer}.dk-seg button.on{background:#21263e;color:#fff}.dk-pr{background:#e0654f;color:#fff;border:0;border-radius:999px;padding:12px 20px;font-size:15px;font-weight:700;cursor:pointer}.dk-pr:hover{background:#c9533e}.dk-tip{flex:1 1 100%;font-size:14px;opacity:.85;margin:0}.dk-hint{font-size:12px;opacity:.75;max-width:200px}.dk-kurs{flex:1 1 100%;font-size:14px;margin:0;padding-top:12px;border-top:1px solid #e3ddd6}.dk-kurs span{display:block;font-size:13px;opacity:.75;margin-top:3px}.dk-seg button:disabled{opacity:.4;cursor:not-allowed}.dk-ramme{border:1px solid #e3ddd6;border-radius:14px;overflow:hidden;background:#fff}.dk-ramme iframe{display:block;width:100%;border:0;min-height:200px}.dk-cta{background:#fff5f2;border:1px solid #f0c9c0;border-radius:14px;padding:18px 20px;margin-top:14px}.dk-cta p{margin:0 0 12px}.dk-cta .knapp{margin:0 10px 8px 0}@media(max-width:600px){.dk-seg button{padding:10px 12px;font-size:14px}}';
  document.head.appendChild(st);

  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  var bar = el('div', 'dk-bar');
  var gM = el('div', 'dk-g'); gM.appendChild(el('span', 'dk-l', 'Beregn med'));
  var segM = el('div', 'dk-seg'); var m1 = el('button', 'on', 'Faktor'), m2 = el('button', null, 'Fortjeneste %'); m1.type = m2.type = 'button'; segM.appendChild(m1); segM.appendChild(m2); gM.appendChild(segM);
  var gF = el('div', 'dk-g'); var lf = el('label', null, 'Faktor'); lf.setAttribute('for', 'dk-faktor');
  var inp = el('input'); inp.id = 'dk-faktor'; inp.type = 'text'; inp.inputMode = 'decimal'; inp.value = '11,5'; gF.appendChild(lf); gF.appendChild(inp);
  var hint = el('span', 'dk-hint'); gF.appendChild(hint);
  var gV = el('div', 'dk-g'); gV.appendChild(el('span', 'dk-l', 'Visning'));
  var seg = el('div', 'dk-seg'); var b1 = el('button', 'on', 'Med priser'), b2 = el('button', null, 'Uten priser'); b1.type = b2.type = 'button'; seg.appendChild(b1); seg.appendChild(b2); gV.appendChild(seg);
  var pr = el('button', 'dk-pr', 'Skriv ut / Lagre som PDF'); pr.type = 'button';
  var tip = el('p', 'dk-tip', 'Prøv selv: endre faktoren, eller velg i stedet hvor stor fortjeneste du vil ha, og se prisene regnes om med en gang. Er du forhandler eller montør, velger du «Uten priser» når tilbudet skal til sluttkunden. Da skjules alle priser og summer, men spesifikasjonene står igjen.');
  var kursP = el('p', 'dk-kurs', 'Henter dagens kurs ...');
  bar.appendChild(gM); bar.appendChild(gF); bar.appendChild(gV); bar.appendChild(pr); bar.appendChild(kursP); bar.appendChild(tip);
  var ramme = el('div', 'dk-ramme'); var fr = document.createElement('iframe'); fr.title = 'Eksempel på ferdig tilbud'; ramme.appendChild(fr);
  var lenke = el('p', 'dm-note'); lenke.appendChild(document.createTextNode('Slik så leverandørtilbudet ut (engelsk, euro): '));
  var a = el('a', null, 'åpne eksempeltilbudet som PDF'); a.href = EKS; a.target = '_blank'; a.rel = 'noopener'; lenke.appendChild(a);
  var cta = el('div', 'dk-cta');
  cta.appendChild(el('p', null, 'Dette er et eksempel. I den fulle versjonen laster du opp ditt eget leverandørtilbud, og Nora lager tilbudet for deg med din egen faktor, dine kunder og din logo.'));
  var k1 = el('a', 'knapp stor', 'Kom i gang'); k1.href = '/priser/#tilbudskalkulator'; cta.appendChild(k1);
  var k2 = el('a', 'knapp stor lys', 'Book en prat, så prøver vi med ditt tilbud'); k2.href = '/book-mote/'; cta.appendChild(k2);
  rot.appendChild(bar); rot.appendChild(ramme); rot.appendChild(lenke); rot.appendChild(cta);

  var cssTekst = null;
  function tegn() {
    var d = fr.contentDocument; if (!d || !d.getElementById('offer-doc')) return;
    d.getElementById('offer-doc').className = 'offer-doc' + (utenPriser ? ' hide-prices' : '');
    d.getElementById('offer-doc').innerHTML = offerHtml();
    d.title = utenPriser ? 'Tilbud 100482 (uten priser)' : 'Tilbud 100482';
    pass();
  }
  function pass() { var d = fr.contentDocument; if (!d || !d.body) return; fr.style.height = '120px'; fr.style.height = (d.documentElement.scrollHeight + 4) + 'px'; }
  function bygg(css) {
    fr.srcdoc = '<!doctype html><html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tilbud 100482</title>' + FONT + '<style>' + css + '</style></head><body><div class="offer-doc" id="offer-doc"></div></body></html>';
  }
  fr.addEventListener('load', function () { tegn(); var d = fr.contentDocument; d.querySelectorAll('img').forEach(function (i) { i.addEventListener('load', pass); }); setTimeout(pass, 800); setTimeout(pass, 2500); });
  window.addEventListener('resize', function () { setTimeout(pass, 150); });
  fetch(BASE + 'tilbud.css?v=1').then(function (r) { return r.text(); }).then(bygg).catch(function () { rot.insertBefore(el('p', null, 'Klarte ikke å laste eksempelet. Last siden på nytt.'), rot.firstChild); });

  function sett(u) { utenPriser = u; b1.className = u ? '' : 'on'; b2.className = u ? 'on' : ''; tegn(); }
  b1.addEventListener('click', function () { sett(false); });
  b2.addEventListener('click', function () { sett(true); });
  function tall(n, d) { return n.toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: d }); }
  function datoNo(iso) { var p = String(iso).split('-'); return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : ''; }
  // Fortjeneste i prosent av salgspris, slik den vises i den fulle appen: (salg - kost) / salg
  function oppdaterHint() {
    if (!kurs) { hint.textContent = ''; return; }
    hint.textContent = modus === 'faktor'
      ? 'Gir fortjeneste ' + tall(100 * (1 - kurs / faktor), 1) + ' % av salgsprisen'
      : 'Tilsvarer faktor ' + tall(faktor, 2);
  }
  function settModus(m) {
    if (m === 'fortjeneste' && !kurs) return;
    modus = m; m1.className = m === 'faktor' ? 'on' : ''; m2.className = m === 'fortjeneste' ? 'on' : '';
    lf.textContent = m === 'faktor' ? 'Faktor' : 'Fortjeneste i %';
    inp.value = m === 'faktor' ? tall(faktor, 2) : tall(100 * (1 - kurs / faktor), 1);
    oppdaterHint();
  }
  m1.addEventListener('click', function () { settModus('faktor'); });
  m2.addEventListener('click', function () { settModus('fortjeneste'); });
  m2.disabled = true;
  inp.addEventListener('input', function () {
    var v = parseFloat(String(inp.value).replace(',', '.'));
    if (!isFinite(v)) return;
    if (modus === 'faktor') { if (v > 0 && v < 100) faktor = v; else return; }
    else { if (v >= 0 && v < 90) faktor = kurs / (1 - v / 100); else return; }
    oppdaterHint(); tegn();
  });
  fetch('https://app.noraai.no/rate.json?' + new Date().toISOString().slice(0, 10)).then(function (r) { return r.json(); }).then(function (j) {
    var r = parseFloat(j.rate);
    if (!isFinite(r) || r < 5 || r > 30) throw new Error('ugyldig kurs');
    kurs = r; kursDato = j.date || ''; kursKilde = j.source === 'norges-bank' ? 'Norges Bank' : '';
    kursP.textContent = '';
    kursP.appendChild(document.createTextNode('Dagens valutakurs: 1 euro = ' + tall(kurs, 4) + ' kr' + (kursKilde || kursDato ? ' (' + [kursKilde, datoNo(kursDato)].filter(Boolean).join(', ') + ')' : '') + '. Fortjenesten regnes mot denne kursen.'));
    kursP.appendChild(el('span', null, 'Eksempelet er i euro. I den fulle versjonen kan du velge en annen valuta, men det er ikke mulig i testversjonen.'));
    m2.disabled = false; oppdaterHint();
  }).catch(function () {
    kursP.textContent = 'Dagens kurs kunne ikke hentes akkurat nå, så valget Fortjeneste % er ikke tilgjengelig. Eksempelet er i euro. I den fulle versjonen kan du velge en annen valuta, men det er ikke mulig i testversjonen.';
  });
  pr.addEventListener('click', function () { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { window.print(); } });
})();
