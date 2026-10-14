/* Nora AI: demo av Tilbudskalkulator uten AI-kall. Alt her er et ferdig innlest eksempel (ingen server, ingen kostnad). */
(function () {
  var rot = document.getElementById('dm-rot');
  if (!rot) return;
  var FAKTOR = 11.5, RABATT = 0.35;
  var EKS = 'https://app.noraai.no/demo/Eksempeltilbud-Produsent.pdf';
  var TOPP = [['Tilbudsnr', '100482'], ['Dato', '10.08.2026'], ['Prosjekt', 'Bjørkelia Terrasse, bygg B'], ['Posisjoner', '8'], ['Enheter', '37']];
  var ORIG = [
    ['Type:', 'Produsent W92 inward-opening window R4 (standard)'],
    ['Wood:', 'Finger-jointed pine'],
    ['Color:', 'Inside: White RAL 9010 / Outside: Dark grey RAL 7016'],
    ['Glass:', '44.1TH/14Ar/4/14Ar/4TH (Spacer bars: Warm edge, grey)'],
    ['Frames/hardware:', '1 x Fixed frame, 1 x Inside opening tilt-turn'],
    ['Bottomframe:', 'Small rain deflector RAL colour, black endings 7016'],
    ['Uw:', '<= 0.94'],
    ['Price, EUR:', '1200x1400mm  1.68m²  742.35  Qty 12']
  ];
  var POS = [
    { n: 1, type: 'Vindu W92, innadslående', dim: '1200 x 1400', ant: 12, m2: '1,68', eur: 742.35,
      spes: [['Tre', 'Fingerskjøtet furu'], ['Farge inne', 'Hvit RAL 9010'], ['Farge ute', 'Mørk grå RAL 7016'],
             ['Glass', '3-lags energiglass, argon, varm avstandsliste (grå)'], ['Åpning', '1 fast felt og 1 innadslående dreie-kipp'],
             ['Bunnkarm', 'Liten vanndeflektor, svarte endestykker'], ['U-verdi', 'Uw ≤ 0,94']] },
    { n: 2, type: 'Vindu W92, innadslående', dim: '900 x 1200', ant: 8, m2: '1,08', eur: 561.90,
      spes: [['Tre', 'Fingerskjøtet furu'], ['Farge inne', 'Hvit RAL 9010'], ['Farge ute', 'Mørk grå RAL 7016'],
             ['Glass', '3-lags energiglass, argon, varm avstandsliste (grå)'], ['Åpning', 'Innadslående dreie-kipp med teleskopisk lufting og barnesikring'],
             ['Bunnkarm', 'Liten vanndeflektor, svarte endestykker'], ['U-verdi', 'Uw ≤ 0,96']] }
  ];
  var LAST = [
    [3, 'Vindu W78, innadslående', '1600 x 1700', 4], [4, 'Vindu W78, fast', '2000 x 900', 6],
    [5, 'Løfte-skyvedør LS-160, aluterskel', '2400 x 2300', 2], [6, 'Balkongdør W92, innadslående, aluterskel', '900 x 2100', 3],
    [7, 'Ytterdør D115, utadslående', '1000 x 2100', 1], [8, 'Dobbel ytterdør D115, utadslående', '1600 x 2100', 1]
  ];
  function el(t, c, x) { var e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  function kr(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' kr'; }
  function eur(n) { return n.toFixed(2).replace('.', ',') + ' EUR'; }

  // Forside: engelsk tilbud, knapp
  var kort = el('div', 'dm-start');
  var venstre = el('div', 'dm-orig');
  venstre.appendChild(el('div', 'dm-etikett', 'Slik ser leverandørtilbudet ut (engelsk, euro). Utdrag av posisjon 1:'));
  var tab = el('dl', 'dm-origliste');
  ORIG.forEach(function (r) { tab.appendChild(el('dt', null, r[0])); tab.appendChild(el('dd', null, r[1])); });
  venstre.appendChild(tab);
  var a = el('a', null, 'Åpne hele eksempeltilbudet (PDF)'); a.href = EKS; a.target = '_blank'; a.rel = 'noopener';
  venstre.appendChild(a);
  var hoyre = el('div', 'dm-vei');
  hoyre.appendChild(el('p', 'dm-etikett', 'Dette gjør Tilbudskalkulatoren:'));
  var ol = el('ol');
  ['Leser tilbudet fra PDF-en', 'Oversetter til norsk byggspråk', 'Regner om fra euro til norske kroner med din faktor', 'Gir deg et ferdig kundetilbud'].forEach(function (t) { ol.appendChild(el('li', null, t)); });
  hoyre.appendChild(ol);
  var knapp = el('button', 'dm-knapp', 'Vis resultatet for dette tilbudet'); knapp.type = 'button';
  hoyre.appendChild(knapp);
  hoyre.appendChild(el('small', null, 'Dette er et ferdig innlest eksempel. Det tar ingen tid og koster ingenting.'));
  kort.appendChild(venstre); kort.appendChild(hoyre);
  rot.appendChild(kort);
  var res = el('div', 'dm-res'); rot.appendChild(res);

  function vis() {
    res.textContent = '';
    res.appendChild(el('h3', 'dm-h', 'Resultatet: ferdig norsk tilbud'));
    var t = el('div', 'dm-topp');
    TOPP.forEach(function (k) { var s = el('span'); s.appendChild(el('strong', null, k[0] + ': ')); s.appendChild(document.createTextNode(k[1])); t.appendChild(s); });
    res.appendChild(t);
    POS.forEach(function (p) {
      var c = el('div', 'dm-pos');
      c.appendChild(el('h3', null, 'Pos. ' + p.n + ': ' + p.type));
      c.appendChild(el('p', 'meta', p.dim + ' mm, ' + p.m2 + ' m², ' + p.ant + ' stk'));
      var dl = el('dl'); p.spes.forEach(function (s) { dl.appendChild(el('dt', null, s[0])); dl.appendChild(el('dd', null, s[1])); });
      c.appendChild(dl);
      var netto = p.eur * (1 - RABATT);
      c.appendChild(el('div', 'dm-pris', 'Pris per stk: ' + kr(netto * FAKTOR) + ' eks. mva'));
      c.appendChild(el('div', 'dm-regn', 'Regnestykket: ' + eur(p.eur) + ' listepris, minus ' + Math.round(RABATT * 100) + ' % rabatt = ' + eur(netto) + ', ganger faktor ' + String(FAKTOR).replace('.', ',') + '.'));
      res.appendChild(c);
    });
    var l = el('div', 'dm-last');
    LAST.forEach(function (p) {
      var r = el('div'); r.appendChild(el('span', null, 'Pos. ' + p[0] + ': ' + p[1] + ', ' + p[2] + ' mm, ' + p[3] + ' stk')); r.appendChild(el('span', 'sk', '00 000 kr')); l.appendChild(r);
    });
    res.appendChild(l);
    var cta = el('div', 'dm-cta');
    cta.appendChild(el('p', null, 'Dette er et utdrag. I den fulle versjonen laster du opp ditt eget leverandørtilbud og får alle posisjonene med spesifikasjoner og skisser, norske priser med din egen faktor, totalsum og utskrift.'));
    var k1 = el('a', 'knapp stor', 'Kom i gang'); k1.href = '/priser/#tilbudskalkulator'; cta.appendChild(k1);
    var k2 = el('a', 'knapp stor lys', 'Book en prat, så prøver vi med ditt tilbud'); k2.href = '/book-mote/'; cta.appendChild(k2);
    res.appendChild(cta);
    res.className = 'dm-res vis';
    knapp.textContent = 'Vis resultatet på nytt';
    if (res.scrollIntoView) res.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  knapp.addEventListener('click', vis);
})();
