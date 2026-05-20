# Norwin Tilbudskalkulator — Funksjonskrav og teknisk spec

**Versjon:** 1.1  
**Sist oppdatert:** 2026-05-20  
**Forfatter:** Marius Nielsen Matatula (Norwin AS) — dokumentert av NORA AI som CTO  
**Kilde:** Gjennomgang av `app/index.html`, `context/MASTERPROMPT.md`, `system/PROSJEKT-REGLER.md`

---

## 1. Formål og overordnet arkitektur

Tilbudskalkulatoren er en **enkeltfil-webapplikasjon** (`app/index.html`) som lar selgere hos Norwin AS konvertere innkjøpstilbud fra produsenten HCTC (skrevet på engelsk) til profesjonelle norske kundetilbud med norske priser.

```
PDF-tilbud fra HCTC (engelsk)
        ↓
PDF.js (tekst- og bildeutvinning i nettleser)
        ↓
Claude API (claude-sonnet-4-20250514, systemPrompt fra MASTERPROMPT.md)
  userMessage: "Faktorpåslag: X.XXXX\n\n[PDF-tekst]"
        ↓
Strukturert JSON (norsk)
        ↓
Norsk kundetilbud rendret i nettleser
        ↓
Utskrift (med eller uten priser)
```

Appen kjøres som en lokal HTML-fil (`file://`) eller via webserver. Den har ingen backend — alt skjer i nettleseren.

---

## 2. Funksjonelle krav

### 2.1 PDF-opplasting (Tilbud fra produsent)

- **To dropzone-felt** for PDF-filer: "Tilbud fra produsent 1" (påkrevd) og "Tilbud fra produsent 2" (valgfri)
- Begge støtter **drag-and-drop** og **klikk-for-å-velge**
- Når fil er valgt vises filnavn og grønt checkmark i dropzonen
- Filer leses med **PDF.js v3.11.174** (CDN: cdnjs.cloudflare.com)
- PDF-tekstinnhold utvinnes og sendes til Claude API
- PDF-skisser (produkttegninger) utvinnes separat med piksel-presise crop-koordinater

**Teknisk viktig:** PDF.js v3.x CDN-bygg eksponerer seg som `window.pdfjsLib` — IKKE `window['pdfjs-dist/build/pdf']`. Bruk alltid `window.pdfjsLib` i koden.

### 2.2 Valutakurs — Norges Bank

- Ved oppstart hentes automatisk **offisiell EUR/NOK dagskurs fra Norges Bank**
- API-endepunkt: `https://data.norges-bank.no/api/data/EXR/B.EUR.NOK.SP?format=sdmx-json&lastNObservations=1&locale=no`
- Kurs caches i `localStorage` + `sessionStorage` med dagens dato som nøkkel
- Hvis kurs allerede er hentet i dag, brukes cachet verdi uten nytt API-kall
- Hvis henting feiler → fallback til siste lagrede kurs (vises med gult varsel)
- Fallback-kurs ved ingen caching: 11.20 (hardkodet nødverdi)
- Bruker kan overstyre kurs manuelt via "Overstyr"-lenke
- Statusboks viser tydelig om kursen er offisiell (grønn) eller estimert (gul)

**Robusthet:** Kallet prøver direkteforbindelse først. Ved CORS-feil (typisk ved `file://`-protokoll) brukes CORS-proxy `https://corsproxy.io/` automatisk som fallback. JSON-parsing er defensiv og håndterer begge SDMX-JSON-versjoner (`data.data.dataSets` og `data.dataSets`), og bruker første tilgjengelige serie-nøkkel i stedet for hardkodet `'0:0:0:0'`.

### 2.3 Selger-valg

- Rullegardinliste med autocomplete for selgere
- Selgere i systemet:
  - Bente Jul-Larsen (bente@norwin.no, 98653255)
  - Grete Holt (grete@norwin.no, 47910660)
  - Marius Nielsen Matatula (marius@norwin.no, 48355995)
  - Per Schiøtz (per@norwin.no, 90583823)
  - Tom Ektvedt (tom@norwin.no, 98826002)
- Selgers kontaktinfo brukes i utskrift/tilbudshode

### 2.4 Faktorpåslag

- Selger angir faktorpåslag (desimaltall, f.eks. 9.0000)
- Faktorpåslaget injiseres i brukermeldingen til Claude API (IKKE i systemprompten)
- Format til API: `"Faktorpåslag: X.XXXX\n\n[PDF-tekst]"`
- NOK-pris per stk. = faktorpåslag × EUR listepris (avrundet til 2 desimaler)
- MVA = 25%
- Alternativposisjoner (`alt: true`) regnes med men ekskluderes fra totalsummer

### 2.5 Tolking av HCTC-tilbud (Claude API)

- Modell: `claude-sonnet-4-20250514`
- Max tokens: 8000
- API-nøkkel hentes fra URL-parameter `?key=` eller `window.NORWIN_API_KEY`
- Systemprompten er ALLTID hentet fra `context/MASTERPROMPT.md` (autoritativ kilde)
- Returformat: Kompakt JSON uten Markdown-innpakning

JSON-rotnivå-felt:
`t` (tilbudsnr), `d` (dato), `r` (rabatt%), `kunde`, `kontakt`, `kadr`, `mob`, `epost`, `prosjekt`, `uv`, `vekt`, `p[]` (produkter), `eksMva`, `mva`, `tot`

Per produkt i `p[]`:
`n` (posisjonsnr), `dim`, `m2`, `ant`, `eur`, `nok`, `sum`, `alt`, `s[]` (spesparlag med `l`/`v`)

### 2.6 Norsk tilbud — visning

- Produkter vises med kompakt spec-tabell (norske feltnavn og verdier)
- Feltrekkefølge følger produkttype (dør / vindu / IV-78) — se MASTERPROMPT.md
- Alternativposisjoner vises tydelig merket
- Skisser (produkttegninger fra PDF) vises ved siden av hvert produkt
- Pris per stk., sum per posisjon og totalsummer (eks. MVA, MVA, inkl. MVA) vises
- Tilbudsnr, dato, kunde- og prosjektinfo vises i hode

### 2.7 Utskrift

- Knapper for utskrift **med priser** og **uten priser**
- Uten priser: pris-kolonner skjules via CSS (`no-print`-klasser)
- Skisser medfølger utskriften
- `@media print`-regler sikrer korrekt sideskift og farger

### 2.8 GitHub-logging

- Ved utskrift logges endringslogg til GitHub-repo (`hakunamatatula/norwin-kalkyle`)
- GitHub-token hentes fra URL-parameter `?key=` og `?ghrepo=`
- Loggfil lagres som `endringslogger/DATO_PROSJEKT_SELGER.json`
- Loggen inneholder: dato, prosjekt, selger, utskrifttype, valutakurs, endringer

---

## 3. Kjente feil og løsninger

| Feil | Årsak | Løsning |
|------|-------|---------|
| PDF drag-and-drop fungerer ikke | `window['pdfjs-dist/build/pdf']` er `undefined` i CDN-bygg | Bytt til `window.pdfjsLib` (rettet 2026-05-20) |
| Valutakurs hentes ikke | Hardkodet serie-nøkkel `'0:0:0:0'`, manglende `resp.ok`-sjekk, ingen CORS-proxy | Dynamisk serie-nøkkel, `resp.ok`-sjekk, corsproxy.io fallback (rettet 2026-05-20) |
| Valutakurs hentes ikke (CORS) | `file://`-protokoll blokkerer cross-origin requests i noen nettlesere | CORS-proxy fallback via corsproxy.io (rettet 2026-05-20) |

---

## 4. Tekniske regler (ikke endre uten god grunn)

1. **Enkeltfil-arkitektur** — all kode i `app/index.html`, ingen separate CSS/JS-filer
2. **Systemprompten endres aldri direkte i koden** — oppdater `context/MASTERPROMPT.md` og kopier inn
3. **Faktorpåslaget hører i brukermeldingen**, ikke systemprompten
4. **Modell:** `claude-sonnet-4-20250514`, `max_tokens: 8000` — ikke endre uten eksplisitt beskjed
5. **PDF.js CDN:** `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js` — global er `window.pdfjsLib`
6. **Valutakurs-cache:** `localStorage` + `sessionStorage` med dato-nøkkel `norwin_eur_date`
7. **Norges Bank API:** SDMX-JSON format, defensiv parsing mot begge strukturvarianter
8. **Aldri slett eller overskriv filer uten bekreftelse** fra Marius

---

## 5. Mappestruktur

```
Norwin Tilbudskalkulator/
├── FUNKSJONSKRAV.md          ← Denne filen (autoritativ kilde for funksjonalitet)
├── README.md                 ← Hurtigstart og mappeforklaring
├── system/
│   ├── PROSJEKT-REGLER.md   ← Regler og arkitektur for AI-assistenten
│   └── GLOBAL-INSTRUCTIONS.md
├── context/
│   └── MASTERPROMPT.md      ← AUTORITATIV kilde for systemprompten til Claude API
├── app/
│   └── index.html           ← Selve kalkulatoren (all kode her)
└── outputs/
    ├── tilbud/              ← Lagrede JSON-tilbud (format: TILBUDSNR_DATO.json)
    └── logger/              ← Endringsnotater og sesjonslogs
```

---

## 6. Endringslogg

| Dato | Versjon | Endring |
|------|---------|---------|
| 2026-05-20 | 1.1 | Rettet kritisk bug: `window['pdfjs-dist/build/pdf']` → `window.pdfjsLib` i `extractPdfText` og `extractPdfSkisser` |
| 2026-05-20 | 1.1 | Forbedret Norges Bank-henting: `resp.ok`-sjekk, dynamisk serie-nøkkel, CORS-proxy fallback, defensiv SDMX-JSON parsing |
| 2026-05-20 | 1.0 | Første versjon av FUNKSJONSKRAV.md opprettet — dokumenterer all funksjonalitet og teknisk arkitektur |
