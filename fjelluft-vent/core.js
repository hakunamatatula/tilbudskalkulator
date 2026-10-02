/* Fjelluft Vent: beregningskjerne (IFC-leser, TEK17-krav, kanalberegning, IFC-skriver).
   Ren JavaScript uten avhengigheter, slik at den kan testes i Node og kjøres i nettleseren. */
var FV = (function () {
  'use strict';

  // ---------- IFC: tekstdekoding ----------
  function decodeIfcString(s) {
    if (s.indexOf('\\') < 0) return s;
    var out = '', i = 0;
    while (i < s.length) {
      if (s.startsWith('\\X2\\', i)) {
        var end = s.indexOf('\\X0\\', i + 4);
        if (end < 0) { out += s.slice(i); break; }
        var hex = s.slice(i + 4, end);
        for (var k = 0; k + 4 <= hex.length; k += 4) out += String.fromCharCode(parseInt(hex.substr(k, 4), 16));
        i = end + 4;
      } else if (s.startsWith('\\X4\\', i)) {
        var end4 = s.indexOf('\\X0\\', i + 4);
        if (end4 < 0) { out += s.slice(i); break; }
        var hex4 = s.slice(i + 4, end4);
        for (var k4 = 0; k4 + 8 <= hex4.length; k4 += 8) out += String.fromCodePoint(parseInt(hex4.substr(k4, 8), 16));
        i = end4 + 4;
      } else if (s.startsWith('\\X\\', i)) {
        out += String.fromCharCode(parseInt(s.substr(i + 3, 2), 16));
        i += 5;
      } else if (s.startsWith('\\S\\', i)) {
        out += String.fromCharCode(s.charCodeAt(i + 3) + 128);
        i += 4;
      } else if (s.startsWith('\\P', i) && s.charAt(i + 3) === '\\') {
        i += 4;
      } else if (s.startsWith('\\\\', i)) {
        out += '\\'; i += 2;
      } else { out += s.charAt(i); i++; }
    }
    return out;
  }

  function encodeIfcString(s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i), ch = s.charAt(i);
      if (ch === "'") out += "''";
      else if (ch === '\\') out += '\\\\';
      else if (c >= 32 && c < 127) out += ch;
      else out += '\\X2\\' + ('0000' + c.toString(16).toUpperCase()).slice(-4) + '\\X0\\';
    }
    return "'" + out + "'";
  }

  // ---------- IFC: STEP-tokenisering ----------
  // Deler DATA-seksjonen i setninger uten å tolke argumentene (lat parsing).
  function indexStep(text) {
    var schemaM = /FILE_SCHEMA\s*\(\s*\(\s*'([^']+)'/i.exec(text.slice(0, 20000));
    var schema = schemaM ? schemaM[1].toUpperCase() : 'UKJENT';
    var dataStart = text.search(/\bDATA\s*;/);
    if (dataStart < 0) throw new Error('Fant ikke DATA-seksjonen. Er dette en IFC-fil (.ifc i STEP-format)?');
    dataStart = text.indexOf(';', dataStart) + 1;
    var ents = new Map(), byType = new Map(), maxId = 0;
    var n = text.length, i = dataStart, stmtStart = i, inStr = false, dataEnd = n;
    for (; i < n; i++) {
      var c = text.charCodeAt(i);
      if (inStr) {
        if (c === 39) { if (text.charCodeAt(i + 1) === 39) i++; else inStr = false; }
        continue;
      }
      if (c === 39) { inStr = true; continue; }
      if (c === 59) { // ;
        var stmt = text.slice(stmtStart, i);
        var t = stmt.trim();
        if (/^ENDSEC$/i.test(t)) { dataEnd = stmtStart; break; }
        if (t.charCodeAt(0) === 35) { // #
          var eq = t.indexOf('=');
          var paren = t.indexOf('(', eq);
          if (eq > 0 && paren > 0) {
            var id = parseInt(t.slice(1, eq), 10);
            var type = t.slice(eq + 1, paren).trim().toUpperCase();
            var args = t.slice(paren + 1, t.lastIndexOf(')'));
            ents.set(id, { type: type, raw: args, parsed: null, start: stmtStart, end: i + 1 });
            var arr = byType.get(type); if (!arr) byType.set(type, arr = []); arr.push(id);
            if (id > maxId) maxId = id;
          }
        }
        stmtStart = i + 1;
      }
    }
    return { schema: schema, ents: ents, byType: byType, maxId: maxId, dataEnd: dataEnd };
  }

  // Tolker en argumentliste. Referanser blir {'#':n}, enum {e:'X'}, typede verdier {t:'TYPE',v:...}.
  function parseArgs(s) {
    var i = 0, n = s.length;
    function ws() { while (i < n && (s.charCodeAt(i) <= 32)) i++; }
    function val() {
      ws();
      var c = s.charAt(i);
      if (c === '(') { i++; var list = []; ws(); if (s.charAt(i) === ')') { i++; return list; }
        for (;;) { list.push(val()); ws(); if (s.charAt(i) === ',') { i++; continue; } if (s.charAt(i) === ')') { i++; break; } break; }
        return list; }
      if (c === "'") { i++; var str = ''; for (;;) { var q = s.indexOf("'", i); if (q < 0) { str += s.slice(i); i = n; break; }
          str += s.slice(i, q); if (s.charAt(q + 1) === "'") { str += "'"; i = q + 2; } else { i = q + 1; break; } }
        return decodeIfcString(str); }
      if (c === '#') { i++; var st = i; while (i < n && /[0-9]/.test(s.charAt(i))) i++; return { '#': parseInt(s.slice(st, i), 10) }; }
      if (c === '$') { i++; return null; }
      if (c === '*') { i++; return '*'; }
      if (c === '.') { var e = s.indexOf('.', i + 1); var en = s.slice(i + 1, e); i = e + 1; return { e: en }; }
      if (c === '"') { var e2 = s.indexOf('"', i + 1); var b = s.slice(i + 1, e2); i = e2 + 1; return { bin: b }; }
      if (/[-+0-9]/.test(c)) { var st2 = i; while (i < n && /[-+0-9.eE]/.test(s.charAt(i))) i++; return parseFloat(s.slice(st2, i)); }
      if (/[A-Za-z]/.test(c)) { var st3 = i; while (i < n && /[A-Za-z0-9_]/.test(s.charAt(i))) i++; var tn = s.slice(st3, i).toUpperCase(); ws();
        if (s.charAt(i) === '(') { i++; var inner = val(); ws(); if (s.charAt(i) === ')') i++; return { t: tn, v: inner }; } return { t: tn, v: null }; }
      i++; return null;
    }
    var out = []; ws(); if (i >= n) return out;
    for (;;) { out.push(val()); ws(); if (s.charAt(i) === ',') { i++; continue; } break; }
    return out;
  }

  function Model(text) {
    var idx = indexStep(text);
    this.text = text; this.schema = idx.schema; this.ents = idx.ents; this.byType = idx.byType; this.maxId = idx.maxId; this.dataEnd = idx.dataEnd;
  }
  Model.prototype.get = function (id) {
    if (id && typeof id === 'object') id = id['#'];
    var e = this.ents.get(id); if (!e) return null;
    if (!e.parsed) e.parsed = parseArgs(e.raw);
    return { id: id, type: e.type, a: e.parsed };
  };
  Model.prototype.ids = function (type) { return this.byType.get(type) || []; };

  // ---------- Geometri ----------
  function v3(p) { return [p[0] || 0, p[1] || 0, p[2] || 0]; }
  function norm(v) { var l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  // Matrise som [xakse, yakse, zakse, origo], hver 3-vektor.
  var IDENT = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]];
  function mul(A, B) { // A etter B: punkt p i B-rom -> A-rom
    function tv(v) { return [A[0][0] * v[0] + A[1][0] * v[1] + A[2][0] * v[2], A[0][1] * v[0] + A[1][1] * v[1] + A[2][1] * v[2], A[0][2] * v[0] + A[1][2] * v[1] + A[2][2] * v[2]]; }
    var o = tv(B[3]); return [tv(B[0]), tv(B[1]), tv(B[2]), [o[0] + A[3][0], o[1] + A[3][1], o[2] + A[3][2]]];
  }
  function apply(M, p) { return [M[0][0] * p[0] + M[1][0] * p[1] + M[2][0] * (p[2] || 0) + M[3][0], M[0][1] * p[0] + M[1][1] * p[1] + M[2][1] * (p[2] || 0) + M[3][1], M[0][2] * p[0] + M[1][2] * p[1] + M[2][2] * (p[2] || 0) + M[3][2]]; }
  function applyDir(M, d) { return [M[0][0] * d[0] + M[1][0] * d[1] + M[2][0] * d[2], M[0][1] * d[0] + M[1][1] * d[1] + M[2][1] * d[2], M[0][2] * d[0] + M[1][2] * d[1] + M[2][2] * d[2]]; }

  function pointOf(m, ref) { var p = m.get(ref); return p && p.a[0] ? v3(p.a[0]) : [0, 0, 0]; }
  function dirOf(m, ref, def) { if (!ref) return def; var d = m.get(ref); return d && d.a[0] ? norm(v3(d.a[0])) : def; }

  function axis2(m, ref) {
    var e = m.get(ref); if (!e) return IDENT;
    var o = pointOf(m, e.a[0]);
    if (e.type === 'IFCAXIS2PLACEMENT2D') {
      var rx = dirOf(m, e.a[1], [1, 0, 0]); rx = norm([rx[0], rx[1], 0]);
      return [rx, [-rx[1], rx[0], 0], [0, 0, 1], o];
    }
    var z = dirOf(m, e.a[1], [0, 0, 1]);
    var x = dirOf(m, e.a[2], Math.abs(z[2]) > 0.99 ? [1, 0, 0] : [0, 0, 1]);
    var d = dot(x, z); x = norm([x[0] - d * z[0], x[1] - d * z[1], x[2] - d * z[2]]);
    return [x, cross(z, x), z, o];
  }
  function placement(m, ref, cache) {
    if (!ref) return IDENT;
    var id = ref['#']; if (cache.has(id)) return cache.get(id);
    var e = m.get(ref), M = IDENT;
    if (e && e.type === 'IFCLOCALPLACEMENT') {
      var parent = e.a[0] ? placement(m, e.a[0], cache) : IDENT;
      M = mul(parent, axis2(m, e.a[1]));
    }
    cache.set(id, M); return M;
  }

  function polyArea(pts) { var a = 0; for (var i = 0, n = pts.length; i < n; i++) { var p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  function dedupe(pts) {
    var out = [];
    pts.forEach(function (p) { var l = out[out.length - 1]; if (!l || Math.abs(l[0] - p[0]) > 1e-9 || Math.abs(l[1] - p[1]) > 1e-9) out.push(p); });
    if (out.length > 1) { var f = out[0], l2 = out[out.length - 1]; if (Math.abs(f[0] - l2[0]) < 1e-9 && Math.abs(f[1] - l2[1]) < 1e-9) out.pop(); }
    return out;
  }

  // 2D-punkter for en kurve (polylinje, indeksert polykurve, sammensatt kurve).
  function curvePts(m, ref, depth) {
    depth = depth || 0; if (depth > 6) return [];
    var c = m.get(ref); if (!c) return [];
    if (c.type === 'IFCPOLYLINE') return c.a[0].map(function (r) { return pointOf(m, r); });
    if (c.type === 'IFCINDEXEDPOLYCURVE') {
      var pl = m.get(c.a[0]); var coords = pl ? pl.a[0] : [];
      if (c.a[1] && c.a[1].length) {
        var pts = [];
        c.a[1].forEach(function (seg) { (seg.v || []).forEach(function (ix) { var p = coords[ix - 1]; if (p) pts.push(v3(p)); }); });
        return pts;
      }
      return coords.map(v3);
    }
    if (c.type === 'IFCCOMPOSITECURVE') {
      var all = [];
      c.a[0].forEach(function (sref) { var seg = m.get(sref); if (!seg) return; var pc = curvePts(m, seg.a[2], depth + 1); if (seg.a[1] === false || (seg.a[1] && seg.a[1].e === 'F')) pc = pc.slice().reverse(); all = all.concat(pc); });
      return all;
    }
    if (c.type === 'IFCTRIMMEDCURVE') {
      var pts2 = [];
      [c.a[1], c.a[2]].forEach(function (tr) { (tr || []).forEach(function (x) { if (x && x['#']) pts2.push(pointOf(m, x)); }); });
      return pts2;
    }
    return [];
  }

  // Fotavtrykk (liste av polygoner i lokale koordinater) for et profil.
  function profilePolys(m, ref) {
    var p = m.get(ref); if (!p) return [];
    if (p.type === 'IFCARBITRARYCLOSEDPROFILEDEF' || p.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS') {
      var outer = dedupe(curvePts(m, p.a[2]));
      var res = outer.length >= 3 ? [{ pts: outer, hole: false }] : [];
      if (p.type === 'IFCARBITRARYPROFILEDEFWITHVOIDS' && p.a[3]) p.a[3].forEach(function (h) { var hp = dedupe(curvePts(m, h)); if (hp.length >= 3) res.push({ pts: hp, hole: true }); });
      return res;
    }
    if (p.type === 'IFCRECTANGLEPROFILEDEF' || p.type === 'IFCROUNDEDRECTANGLEPROFILEDEF') {
      var M = p.a[2] ? axis2(m, p.a[2]) : IDENT, hx = p.a[3] / 2, hy = p.a[4] / 2;
      return [{ pts: [[-hx, -hy, 0], [hx, -hy, 0], [hx, hy, 0], [-hx, hy, 0]].map(function (q) { return apply(M, q); }), hole: false }];
    }
    if (p.type === 'IFCCIRCLEPROFILEDEF') {
      var Mc = p.a[2] ? axis2(m, p.a[2]) : IDENT, r = p.a[3], pts = [];
      for (var k = 0; k < 24; k++) pts.push(apply(Mc, [r * Math.cos(k / 24 * 2 * Math.PI), r * Math.sin(k / 24 * 2 * Math.PI), 0]));
      return [{ pts: pts, hole: false }];
    }
    return [];
  }

  // Gir fotavtrykk i verdenskoordinater (modellenheter) for et representasjonselement.
  function itemFootprint(m, ref, M, depth) {
    depth = depth || 0; if (depth > 8) return null;
    var it = m.get(ref); if (!it) return null;
    if (it.type === 'IFCEXTRUDEDAREASOLID') {
      var Mp = mul(M, it.a[1] ? axis2(m, it.a[1]) : IDENT);
      var dir = applyDir(Mp, dirOf(m, it.a[2], [0, 0, 1]));
      if (Math.abs(dir[2]) < 0.5) return null; // vertikal profil (ikke gulvplan)
      var polys = profilePolys(m, it.a[0]).map(function (pl) { return { pts: pl.pts.map(function (q) { return apply(Mp, q); }), hole: pl.hole }; });
      var zs = []; polys.forEach(function (pl) { pl.pts.forEach(function (q) { zs.push(q[2]); }); });
      var zmin = Math.min.apply(null, zs.concat([Infinity]));
      return { polys: polys, height: Math.abs(it.a[3] * dir[2]), z: zmin };
    }
    if (it.type === 'IFCBOOLEANCLIPPINGRESULT' || it.type === 'IFCBOOLEANRESULT') return itemFootprint(m, it.a[1], M, depth + 1);
    if (it.type === 'IFCFACETEDBREP' || it.type === 'IFCFACEBASEDSURFACEMODEL' || it.type === 'IFCSHELLBASEDSURFACEMODEL') {
      var shells = it.type === 'IFCFACETEDBREP' ? [it.a[0]] : (it.a[0] || []);
      var polys2 = [], zmin2 = Infinity, zmax2 = -Infinity;
      shells.forEach(function (sh) {
        var s = m.get(sh); if (!s) return;
        (s.a[0] || []).forEach(function (fr) {
          var f = m.get(fr); if (!f) return;
          (f.a[0] || []).forEach(function (br) {
            var b = m.get(br); if (!b) return; var loop = m.get(b.a[0]); if (!loop || loop.type !== 'IFCPOLYLOOP') return;
            var pts = loop.a[0].map(function (r) { return apply(M, pointOf(m, r)); });
            pts.forEach(function (q) { if (q[2] < zmin2) zmin2 = q[2]; if (q[2] > zmax2) zmax2 = q[2]; });
            // Normal via Newell
            var nx = 0, ny = 0, nz = 0; for (var i = 0; i < pts.length; i++) { var a = pts[i], c = pts[(i + 1) % pts.length]; nx += (a[1] - c[1]) * (a[2] + c[2]); ny += (a[2] - c[2]) * (a[0] + c[0]); nz += (a[0] - c[0]) * (a[1] + c[1]); }
            var l = Math.hypot(nx, ny, nz) || 1;
            if (nz / l < -0.9) polys2.push({ pts: pts, hole: b.type === 'IFCFACEBOUND', bottom: true });
          });
        });
      });
      if (!polys2.length) return null;
      // Behold kun de laveste flatene (gulvet)
      var floorZ = Math.min.apply(null, polys2.map(function (p) { return Math.min.apply(null, p.pts.map(function (q) { return q[2]; })); }));
      var tol = Math.max(1e-3, (zmax2 - zmin2) * 0.05);
      polys2 = polys2.filter(function (p) { return Math.max.apply(null, p.pts.map(function (q) { return q[2]; })) <= floorZ + tol; });
      return { polys: polys2, height: zmax2 - zmin2, z: zmin2 };
    }
    if (it.type === 'IFCTRIANGULATEDFACESET' || it.type === 'IFCPOLYGONALFACESET') {
      var pl3 = m.get(it.a[0]); var co = pl3 ? pl3.a[0].map(function (p) { return apply(M, v3(p)); }) : [];
      if (!co.length) return null;
      var tris = [];
      if (it.type === 'IFCTRIANGULATEDFACESET') (it.a[3] || []).forEach(function (t) { tris.push(t.map(function (ix) { return co[ix - 1]; })); });
      else (it.a[2] || []).forEach(function (fr) { var f = m.get(fr); if (f && f.a[0]) tris.push(f.a[0].map(function (ix) { return co[ix - 1]; })); });
      var zs3 = co.map(function (q) { return q[2]; }), zmin3 = Math.min.apply(null, zs3), zmax3 = Math.max.apply(null, zs3), tol3 = Math.max(1e-3, (zmax3 - zmin3) * 0.05);
      var polys3 = [];
      tris.forEach(function (t) {
        if (t.some(function (q) { return !q; })) return;
        var nz = 0; for (var i = 0; i < t.length; i++) { var a = t[i], c = t[(i + 1) % t.length]; nz += (a[0] - c[0]) * (a[1] + c[1]); }
        if (t.every(function (q) { return q[2] <= zmin3 + tol3; })) polys3.push({ pts: t, hole: false, tri: true });
      });
      return polys3.length ? { polys: polys3, height: zmax3 - zmin3, z: zmin3, triangles: true } : null;
    }
    if (it.type === 'IFCMAPPEDITEM') {
      var src = m.get(it.a[0]); if (!src) return null;
      var origin = m.get(src.a[0]); var rep = m.get(src.a[1]);
      var Mo = origin && origin.type.indexOf('AXIS2PLACEMENT') >= 0 ? axis2(m, src.a[0]) : IDENT;
      var Mt = cartesianOp(m, it.a[1]);
      var Mm = mul(M, mul(Mt, Mo));
      var res = null; (rep ? rep.a[3] : []).forEach(function (r) { if (!res) res = itemFootprint(m, r, Mm, depth + 1); });
      return res;
    }
    if (it.type === 'IFCGEOMETRICCURVESET' || it.type === 'IFCGEOMETRICSET') {
      var polys4 = [];
      (it.a[0] || []).forEach(function (cr) { var pts = dedupe(curvePts(m, cr)).map(function (q) { return apply(M, q); }); if (pts.length >= 3) polys4.push({ pts: pts, hole: false }); });
      if (!polys4.length) return null;
      return { polys: polys4, height: 0, z: Math.min.apply(null, polys4[0].pts.map(function (q) { return q[2]; })) };
    }
    if (it.type === 'IFCPOLYLINE' || it.type === 'IFCINDEXEDPOLYCURVE' || it.type === 'IFCCOMPOSITECURVE') {
      var pts5 = dedupe(curvePts(m, ref)).map(function (q) { return apply(M, q); });
      return pts5.length >= 3 ? { polys: [{ pts: pts5, hole: false }], height: 0, z: pts5[0][2] } : null;
    }
    return null;
  }
  function cartesianOp(m, ref) {
    var t = m.get(ref); if (!t) return IDENT;
    var o = pointOf(m, t.a[2]); var s = typeof t.a[3] === 'number' ? t.a[3] : 1;
    var x = dirOf(m, t.a[0], [1, 0, 0]), y = dirOf(m, t.a[1], [0, 1, 0]);
    var z = t.a[4] ? dirOf(m, t.a[4], [0, 0, 1]) : cross(x, y);
    return [[x[0] * s, x[1] * s, x[2] * s], [y[0] * s, y[1] * s, y[2] * s], [z[0] * s, z[1] * s, z[2] * s], o];
  }

  function footprintOf(m, prod, plCache) {
    var M = placement(m, prod.a[5], plCache);
    var pds = m.get(prod.a[6]); if (!pds) return null;
    var reps = (pds.a[2] || []).map(function (r) { return m.get(r); }).filter(Boolean);
    var order = function (r) { var id = (r.a[1] || '').toLowerCase(); return id === 'footprint' ? 0 : id === 'body' ? 1 : 2; };
    reps.sort(function (a, b) { return order(a) - order(b); });
    for (var i = 0; i < reps.length; i++) {
      var r = reps[i], acc = null;
      (r.a[3] || []).forEach(function (itm) {
        var fp = itemFootprint(m, itm, M);
        if (fp && fp.polys.length) { if (!acc) acc = fp; else { acc.polys = acc.polys.concat(fp.polys); acc.height = Math.max(acc.height, fp.height); acc.z = Math.min(acc.z, fp.z); } }
      });
      if (acc) {
        if (acc.height === 0) { // fotavtrykk uten høyde: hent høyde fra Body om mulig
          for (var j = i + 1; j < reps.length; j++) { var h = null; (reps[j].a[3] || []).forEach(function (itm) { var fp = itemFootprint(m, itm, M); if (fp && fp.height) h = fp.height; }); if (h) { acc.height = h; break; } }
        }
        return acc;
      }
    }
    return null;
  }

  // ---------- Enheter ----------
  var PREFIX = { EXA: 1e18, PETA: 1e15, TERA: 1e12, GIGA: 1e9, MEGA: 1e6, KILO: 1e3, HECTO: 1e2, DECA: 1e1, DECI: 1e-1, CENTI: 1e-2, MILLI: 1e-3, MICRO: 1e-6, NANO: 1e-9 };
  function units(m) {
    var res = { length: 1, area: 1, lengthName: 'm' };
    var proj = m.ids('IFCPROJECT')[0]; var p = proj && m.get(proj);
    var ua = p && m.get(p.a[8]); var list = ua ? ua.a[0] : [];
    list.forEach(function (r) {
      var u = m.get(r); if (!u) return;
      var type = u.a[1] && u.a[1].e;
      var f = 1;
      if (u.type === 'IFCSIUNIT') { f = u.a[2] && u.a[2].e ? PREFIX[u.a[2].e] || 1 : 1; if (type === 'AREAUNIT') f = f * f; }
      else if (u.type === 'IFCCONVERSIONBASEDUNIT' || u.type === 'IFCCONVERSIONBASEDUNITWITHOFFSET') {
        var mw = m.get(u.a[3]); var val = mw && mw.a[0] && mw.a[0].v; var base = mw && m.get(mw.a[1]);
        var bf = base && base.type === 'IFCSIUNIT' && base.a[2] && base.a[2].e ? PREFIX[base.a[2].e] || 1 : 1;
        if (base && type === 'AREAUNIT' && base.type === 'IFCSIUNIT') bf = bf * bf;
        f = (typeof val === 'number' ? val : 1) * bf;
      }
      if (type === 'LENGTHUNIT') { res.length = f; res.lengthName = f === 0.001 ? 'mm' : f === 1 ? 'm' : f === 0.3048 ? 'ft' : String(f); }
      if (type === 'AREAUNIT') res.area = f;
    });
    return res;
  }

  // ---------- Romuttrekk ----------
  var AREA_Q = ['NETFLOORAREA', 'GROSSFLOORAREA', 'NETAREA', 'AREA', 'GROSSAREA'];
  var AREA_P = ['NETFLOORAREA', 'AREA', 'NETTOAREAL', 'NETTO AREAL', 'AREAL', 'BRA', 'NTA', 'GROSSFLOORAREA', 'ROOM AREA', 'ROMAREAL'];

  function parseIFC(text, onProgress) {
    var m = new Model(text);
    var U = units(m);
    var plCache = new Map();
    // Relasjoner
    var props = new Map();
    m.ids('IFCRELDEFINESBYPROPERTIES').forEach(function (rid) {
      var r = m.get(rid); var objs = r.a[4] || []; var pd = r.a[5];
      objs.forEach(function (o) { var k = o['#']; var arr = props.get(k); if (!arr) props.set(k, arr = []); arr.push(pd['#']); });
    });
    var parentOf = new Map();
    m.ids('IFCRELAGGREGATES').forEach(function (rid) { var r = m.get(rid); (r.a[5] || []).forEach(function (o) { parentOf.set(o['#'], r.a[4]['#']); }); });
    m.ids('IFCRELCONTAINEDINSPATIALSTRUCTURE').forEach(function (rid) { var r = m.get(rid); (r.a[4] || []).forEach(function (o) { if (!parentOf.has(o['#'])) parentOf.set(o['#'], r.a[5]['#']); }); });

    var storeys = new Map();
    m.ids('IFCBUILDINGSTOREY').forEach(function (sid) { var s = m.get(sid); var M = placement(m, s.a[5], plCache); storeys.set(sid, { id: sid, guid: s.a[0], name: s.a[2] || s.a[7] || ('Etasje ' + sid), elevation: (typeof s.a[9] === 'number' ? s.a[9] : M[3][2]) * U.length }); });

    function storeyOf(id) { var seen = 0; var cur = parentOf.get(id); while (cur && seen++ < 20) { if (storeys.has(cur)) return storeys.get(cur); cur = parentOf.get(cur); } return null; }

    var spaceIds = m.ids('IFCSPACE');
    var spaces = [];
    spaceIds.forEach(function (sid, k) {
      var s = m.get(sid);
      var area = null, areaSrc = null, height = null, pnames = {};
      (props.get(sid) || []).forEach(function (pid) {
        var pd = m.get(pid); if (!pd) return;
        if (pd.type === 'IFCELEMENTQUANTITY') {
          (pd.a[5] || []).forEach(function (qr) { var q = m.get(qr); if (!q) return; var nm = String(q.a[0] || '').toUpperCase();
            if (q.type === 'IFCQUANTITYAREA') { var rank = AREA_Q.indexOf(nm); if (rank >= 0 && (areaSrc === null || areaSrc.rank > rank) ) { area = q.a[3] * U.area; areaSrc = { rank: rank, label: 'Mengde ' + q.a[0] + ' (' + (pd.a[2] || 'Qto') + ')' }; } }
            if (q.type === 'IFCQUANTITYLENGTH' && /HEIGHT/.test(nm) && height === null) height = q.a[3] * U.length; });
        } else if (pd.type === 'IFCPROPERTYSET') {
          (pd.a[4] || []).forEach(function (pr) { var p = m.get(pr); if (!p || p.type !== 'IFCPROPERTYSINGLEVALUE') return; var nm = String(p.a[0] || ''); var v = p.a[2] && p.a[2].v;
            pnames[(pd.a[2] || '') + '.' + nm] = v;
            var rank = AREA_P.indexOf(nm.toUpperCase());
            if (rank >= 0 && typeof v === 'number' && (areaSrc === null || areaSrc.rank > 10 + rank)) { area = v * (p.a[2].t === 'IFCAREAMEASURE' ? U.area : 1); areaSrc = { rank: 10 + rank, label: 'Egenskap ' + nm + ' (' + (pd.a[2] || 'Pset') + ')' }; } });
        }
      });
      var fp = null;
      try { fp = footprintOf(m, s, plCache); } catch (e) { fp = null; }
      var poly = null, geomArea = null;
      if (fp) {
        var tot = 0, polys = [];
        fp.polys.forEach(function (pl) { var a = Math.abs(polyArea(pl.pts)) * U.length * U.length; tot += pl.hole ? -a : a; polys.push(pl.pts.map(function (q) { return [Math.round(q[0] * U.length * 100) / 100, Math.round(q[1] * U.length * 100) / 100]; })); });
        geomArea = tot; poly = fp.triangles ? null : polys; if (fp.triangles) poly = polys;
        if (!height && fp.height) height = fp.height * U.length;
      }
      if (area === null && geomArea) { area = geomArea; areaSrc = { rank: 99, label: 'Beregnet fra geometri' }; }
      var st = storeyOf(sid);
      spaces.push({
        guid: s.a[0], ifcId: sid,
        nummer: s.a[7] ? (s.a[2] || '') : '', navn: s.a[7] || s.a[2] || s.a[3] || '',
        etasje: st ? st.name : 'Uten etasje', etasjeKote: st ? Math.round(st.elevation * 100) / 100 : 0,
        areal: area !== null ? Math.round(area * 100) / 100 : null,
        arealKilde: areaSrc ? areaSrc.label : 'Mangler',
        arealGeometri: geomArea !== null ? Math.round(geomArea * 100) / 100 : null,
        hoyde: height ? Math.round(height * 100) / 100 : null,
        poly: poly
      });
      if (onProgress && k % 50 === 0) onProgress(k / spaceIds.length);
    });
    var projName = ''; var pid0 = m.ids('IFCPROJECT')[0]; if (pid0) { var pe = m.get(pid0); projName = pe.a[2] || pe.a[5] || ''; }
    var stList = Array.from(storeys.values()).sort(function (a, b) { return a.elevation - b.elevation; });
    return {
      schema: m.schema, units: U, prosjektnavn: projName,
      etasjer: stList.map(function (s) { return { navn: s.name, kote: Math.round(s.elevation * 100) / 100 }; }),
      rom: spaces,
      antall: { entiteter: m.ents.size, kanaler: m.ids('IFCDUCTSEGMENT').length + m.ids('IFCFLOWSEGMENT').length, ventiler: m.ids('IFCAIRTERMINAL').length },
      _model: m
    };
  }

  // ---------- IFC-skriver: legger Fjelluft-egenskaper på rommene ----------
  var B64 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';
  function newGuid(rand) {
    var bytes = [];
    for (var i = 0; i < 16; i++) bytes.push(Math.floor((rand || Math.random)() * 256));
    var num = bytes; var out = '';
    // 128 bit -> 22 tegn (2 + 4*5 bits... standard: første tegn 2 bit, resten 6 bit)
    var bits = '';
    num.forEach(function (b) { bits += ('00000000' + b.toString(2)).slice(-8); });
    out += B64[parseInt(bits.slice(0, 2), 2)];
    for (var k = 2; k < 128; k += 6) out += B64[parseInt(bits.slice(k, k + 6), 2)];
    return out;
  }
  var PSET = 'Fjelluft_Ventilasjon';
  function fmtReal(x) { if (x === null || x === undefined || !isFinite(x)) return '$'; var s = String(Math.round(x * 1000) / 1000); if (s.indexOf('.') < 0 && s.indexOf('e') < 0) s += '.'; return s; }

  // values: Map guid -> [{navn, type:'REAL'|'LABEL'|'TEXT', verdi}]
  function writeIFC(text, values, opts) {
    opts = opts || {};
    var m = new Model(text);
    // Fjern tidligere Fjelluft-egenskapssett
    var remove = [];
    m.ids('IFCPROPERTYSET').forEach(function (pid) {
      var p = m.get(pid); if (p.a[2] !== PSET) return;
      remove.push(pid); (p.a[4] || []).forEach(function (r) { remove.push(r['#']); });
      m.ids('IFCRELDEFINESBYPROPERTIES').forEach(function (rid) { var r = m.get(rid); if (r.a[5] && r.a[5]['#'] === pid) remove.push(rid); });
    });
    var oh = m.ids('IFCOWNERHISTORY')[0];
    var ohRef = oh ? '#' + oh : '$';
    var guidToId = new Map(); m.ids('IFCSPACE').forEach(function (sid) { guidToId.set(m.get(sid).a[0], sid); });
    var next = m.maxId + 1, lines = [], count = 0;
    values.forEach(function (props, guid) {
      var sid = guidToId.get(guid); if (!sid) return;
      var pids = [];
      props.forEach(function (p) {
        var v;
        if (p.type === 'REAL') v = (p.verdi === null || p.verdi === undefined || !isFinite(p.verdi)) ? null : 'IFCREAL(' + fmtReal(p.verdi) + ')';
        else if (p.type === 'INT') v = (p.verdi === null || p.verdi === undefined) ? null : 'IFCINTEGER(' + Math.round(p.verdi) + ')';
        else v = (p.verdi === null || p.verdi === undefined || p.verdi === '') ? null : 'IFC' + (p.type === 'TEXT' ? 'TEXT' : 'LABEL') + '(' + encodeIfcString(String(p.verdi)) + ')';
        if (v === null) return;
        var id = next++; pids.push('#' + id);
        lines.push('#' + id + '=IFCPROPERTYSINGLEVALUE(' + encodeIfcString(p.navn) + ',$,' + v + ',$);');
      });
      if (!pids.length) return;
      var ps = next++;
      lines.push('#' + ps + '=IFCPROPERTYSET(' + encodeIfcString(newGuid()) + ',' + ohRef + ',' + encodeIfcString(PSET) + ',' + encodeIfcString('Ventilasjonsdata fra Fjelluft Vent') + ',(' + pids.join(',') + '));');
      var rel = next++;
      lines.push('#' + rel + '=IFCRELDEFINESBYPROPERTIES(' + encodeIfcString(newGuid()) + ',' + ohRef + ',$,$,(#' + sid + '),#' + ps + ');');
      count++;
    });
    // Bygg ny tekst: fjern gamle setninger, sett inn nye før ENDSEC i DATA.
    var cuts = remove.map(function (id) { var e = m.ents.get(id); return e ? [e.start, e.end] : null; }).filter(Boolean).sort(function (a, b) { return a[0] - b[0]; });
    var out = '', pos = 0;
    cuts.forEach(function (c) { if (c[0] >= pos) { out += text.slice(pos, c[0]); pos = c[1]; } });
    var insertAt = m.dataEnd;
    out += text.slice(pos, insertAt);
    if (!/\n$/.test(out)) out += '\n';
    out += lines.join('\n') + '\n';
    out += text.slice(insertAt);
    // Oppdater FILE_NAME-tidsstempel og opphav i overskriften
    return { text: out, antallRom: count, fjernet: remove.length };
  }

  // ---------- TEK17-krav ----------
  // Kilder: TEK17 § 13-2 (boligbygning) og § 13-3 (byggverk for publikum og arbeidsbygning) med veiledning (DiBK).
  // Tabellverdier for avtrekk i bolig: veiledning til § 13-2, tabell 1 (kjøkken 36/108, bad 54/108, toalett 36/36, vaskerom 36/72 m³/h).
  var ROMTYPER = [
    { id: 'b_stue', gruppe: 'Bolig', navn: 'Stue / oppholdsrom', regel: 'areal', tPerM2: 1.2, grunnlag: '1,2 m³/h per m² gulvareal', kilde: 'TEK17 § 13-2' },
    { id: 'b_sov', gruppe: 'Bolig', navn: 'Soverom', regel: 'seng', tPerSeng: 26, tPerM2: 1.2, grunnlag: '26 m³/h per sengeplass, minst 1,2 m³/h per m²', kilde: 'TEK17 § 13-2' },
    { id: 'b_kjokken', gruppe: 'Bolig', navn: 'Kjøkken', regel: 'avtrekk', avtrekk: 36, forsert: 108, grunnlag: 'Avtrekk 36 m³/h, forsert 108 m³/h', kilde: 'Veiledning TEK17 § 13-2, tabell 1' },
    { id: 'b_bad', gruppe: 'Bolig', navn: 'Bad', regel: 'avtrekk', avtrekk: 54, forsert: 108, grunnlag: 'Avtrekk 54 m³/h, forsert 108 m³/h', kilde: 'Veiledning TEK17 § 13-2, tabell 1' },
    { id: 'b_wc', gruppe: 'Bolig', navn: 'Toalett', regel: 'avtrekk', avtrekk: 36, forsert: 36, grunnlag: 'Avtrekk 36 m³/h', kilde: 'Veiledning TEK17 § 13-2, tabell 1' },
    { id: 'b_vask', gruppe: 'Bolig', navn: 'Vaskerom', regel: 'avtrekk', avtrekk: 36, forsert: 72, grunnlag: 'Avtrekk 36 m³/h, forsert 72 m³/h', kilde: 'Veiledning TEK17 § 13-2, tabell 1' },
    { id: 'b_bod', gruppe: 'Bolig', navn: 'Bod, gang, garderobe', regel: 'overstromning', grunnlag: 'Ingen egen luftmengde. Overstrømning', kilde: 'Fjelluft-praksis' },
    { id: 'y_kontor', gruppe: 'Yrkesbygg', navn: 'Kontor', regel: 'person', personPerM2: 0.1, grunnlag: '26 m³/h per person + 2,5 m³/h per m²', kilde: 'TEK17 § 13-3' },
    { id: 'y_mote', gruppe: 'Yrkesbygg', navn: 'Møterom', regel: 'person', personPerM2: 0.5, grunnlag: '26 m³/h per person + 2,5 m³/h per m²', kilde: 'TEK17 § 13-3' },
    { id: 'y_klasse', gruppe: 'Yrkesbygg', navn: 'Klasserom / undervisning', regel: 'person', personPerM2: 0.5, grunnlag: '26 m³/h per person + 2,5 m³/h per m²', kilde: 'TEK17 § 13-3' },
    { id: 'y_kantine', gruppe: 'Yrkesbygg', navn: 'Kantine / spiserom', regel: 'person', personPerM2: 0.6, grunnlag: '26 m³/h per person + 2,5 m³/h per m²', kilde: 'TEK17 § 13-3' },
    { id: 'y_opphold', gruppe: 'Yrkesbygg', navn: 'Annet rom for varig opphold', regel: 'person', personPerM2: 0.1, grunnlag: '26 m³/h per person + 2,5 m³/h per m²', kilde: 'TEK17 § 13-3' },
    { id: 'y_wc', gruppe: 'Yrkesbygg', navn: 'Toalett / dusj / garderobe', regel: 'manuell', grunnlag: 'Ingen preakseptert tallverdi. Fyll inn prosjektert avtrekk', kilde: 'Prosjekteres' },
    { id: 'y_lager', gruppe: 'Yrkesbygg', navn: 'Lager / teknisk rom / gang', regel: 'manuell', grunnlag: 'Ingen preakseptert tallverdi. Fyll inn ved behov', kilde: 'Prosjekteres' },
    { id: 'annet', gruppe: 'Annet', navn: 'Egendefinert', regel: 'manuell', grunnlag: 'Fyll inn prosjektert luftmengde', kilde: 'Prosjekteres' }
  ];
  var TYPE_BY_ID = {}; ROMTYPER.forEach(function (t) { TYPE_BY_ID[t.id] = t; });

  function gjettRomtype(navn, byggtype) {
    var n = String(navn || '').toLowerCase();
    var y = byggtype === 'yrkesbygg';
    if (/kj(ø|o|oe)kken|kitchen|kjk/.test(n)) return y ? 'y_kantine' : 'b_kjokken';
    if (/m(ø|o|oe)te|meeting|konferanse/.test(n)) return 'y_mote';
    if (/klasse|undervisning|grupperom|classroom/.test(n)) return 'y_klasse';
    if (/kantine|spise|canteen/.test(n)) return 'y_kantine';
    if (/kontor|office|arbeidsrom/.test(n)) return y ? 'y_kontor' : 'b_stue';
    if (/vask|laundry/.test(n)) return y ? 'y_lager' : 'b_vask';
    if (/\bbad\b|baderom|bath|dusj|shower/.test(n)) return y ? 'y_wc' : 'b_bad';
    if (/\bwc\b|toalett|toilet|\bdo\b/.test(n)) return y ? 'y_wc' : 'b_wc';
    if (/sov|bedroom|soverom|\bsr\b/.test(n)) return 'b_sov';
    if (/stue|living|opphold|tv|allrom|familie/.test(n)) return y ? 'y_opphold' : 'b_stue';
    if (/garderobe|wardrobe/.test(n)) return y ? 'y_wc' : 'b_bod';
    if (/bod|gang|entr|hall|korridor|corridor|trapp|stair|lager|storage|teknisk|sjakt/.test(n)) return y ? 'y_lager' : 'b_bod';
    return y ? 'y_opphold' : 'annet';
  }

  function ceil5(x) { var r = Math.ceil(x / 5 - 1e-9) * 5; return r === 0 ? 0 : r; }

  // Beregner krav for ett rom. rom: {type, areal, personer, senger}
  function krav(rom) {
    var t = TYPE_BY_ID[rom.type] || TYPE_BY_ID.annet;
    var A = Number(rom.areal) || 0;
    var r = { tilluft: 0, avtrekk: 0, forsert: null, utenDrift: null, personer: null, senger: null, grunnlag: t.grunnlag, kilde: t.kilde, manuell: t.regel === 'manuell', regel: t.regel, forklaring: '' };
    if (t.regel === 'areal') { r.tilluft = t.tPerM2 * A; r.forklaring = fmt(t.tPerM2, 1) + ' × ' + fmt(A, 1) + ' m² = ' + fmt(r.tilluft, 1); }
    else if (t.regel === 'seng') {
      var s = rom.senger === null || rom.senger === undefined || rom.senger === '' ? (A >= 12 ? 2 : 1) : Number(rom.senger);
      r.senger = s; var a1 = t.tPerSeng * s, a2 = t.tPerM2 * A; r.tilluft = Math.max(a1, a2);
      r.forklaring = 'maks(26 × ' + s + ' seng = ' + fmt(a1, 0) + ', 1,2 × ' + fmt(A, 1) + ' m² = ' + fmt(a2, 1) + ')';
    }
    else if (t.regel === 'avtrekk') { r.avtrekk = t.avtrekk; r.forsert = t.forsert; r.forklaring = 'Fast verdi ' + t.avtrekk + ' m³/h'; }
    else if (t.regel === 'person') {
      var p = rom.personer === null || rom.personer === undefined || rom.personer === '' ? Math.max(1, Math.ceil(A * t.personPerM2)) : Number(rom.personer);
      r.personer = p; r.tilluft = 26 * p + 2.5 * A; r.avtrekk = r.tilluft; r.utenDrift = 0.7 * A;
      r.forklaring = '26 × ' + p + ' pers + 2,5 × ' + fmt(A, 1) + ' m² = ' + fmt(r.tilluft, 1) + '. Utenfor driftstid 0,7 × ' + fmt(A, 1) + ' = ' + fmt(r.utenDrift, 1);
    }
    return r;
  }

  // Fullstendig romstatus inkl. prosjekterte verdier.
  function romStatus(rom) {
    var k = krav(rom);
    var pt = rom.tilluftProsj === null || rom.tilluftProsj === undefined || rom.tilluftProsj === '' ? null : Number(rom.tilluftProsj);
    var pa = rom.avtrekkProsj === null || rom.avtrekkProsj === undefined || rom.avtrekkProsj === '' ? null : Number(rom.avtrekkProsj);
    var tilluft = pt !== null ? pt : ceil5(k.tilluft);
    var avtrekk = pa !== null ? pa : ceil5(k.avtrekk);
    var status = 'ok', melding = '';
    if (!rom.areal && k.regel !== 'avtrekk' && k.regel !== 'overstromning' && k.regel !== 'manuell') { status = 'mangler'; melding = 'Mangler areal'; }
    else if (k.manuell && pt === null && pa === null) { status = 'mangler'; melding = 'Fyll inn prosjektert luftmengde'; }
    else if (tilluft + 1e-6 < k.tilluft) { status = 'under'; melding = 'Tilluft under krav (' + fmt(k.tilluft, 0) + ' m³/h)'; }
    else if (avtrekk + 1e-6 < k.avtrekk) { status = 'under'; melding = 'Avtrekk under krav (' + fmt(k.avtrekk, 0) + ' m³/h)'; }
    return { krav: k, tilluft: tilluft, avtrekk: avtrekk, status: status, melding: melding };
  }

  function oppsummer(romListe, byggtype) {
    var sys = {}, boenheter = {};
    romListe.forEach(function (rom) {
      var st = romStatus(rom);
      var s = rom.system || 'Uten system';
      var o = sys[s] || (sys[s] = { system: s, tilluft: 0, avtrekk: 0, forsert: 0, rom: 0, areal: 0, avvik: 0 });
      o.tilluft += st.tilluft; o.avtrekk += st.avtrekk; o.forsert += (st.krav.forsert !== null ? Math.max(st.krav.forsert, st.avtrekk) : st.avtrekk); o.rom++; o.areal += Number(rom.areal) || 0; if (st.status !== 'ok') o.avvik++;
      if (byggtype !== 'yrkesbygg') {
        var b = rom.boenhet || 'Boenhet 1';
        var bo = boenheter[b] || (boenheter[b] = { boenhet: b, areal: 0, tilluft: 0, avtrekk: 0 });
        bo.areal += Number(rom.areal) || 0; bo.tilluft += st.tilluft; bo.avtrekk += st.avtrekk;
      }
    });
    var bl = Object.keys(boenheter).map(function (k) { var b = boenheter[k]; b.kravSnitt = 1.2 * b.areal; b.ok = b.tilluft + 1e-6 >= b.kravSnitt; b.balanse = b.tilluft - b.avtrekk; return b; });
    return { systemer: Object.keys(sys).sort().map(function (k) { var o = sys[k]; o.balanse = o.tilluft - o.avtrekk; return o; }), boenheter: bl };
  }

  // ---------- Kanalberegning ----------
  var RUND = [80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250];
  var RHO = 1.2, NU = 15.1e-6;
  function lambdaSJ(Re, eps, d) { if (Re < 2300) return 64 / Math.max(Re, 1); var x = Math.log10(eps / (3.7 * d) + 5.74 / Math.pow(Re, 0.9)); return 0.25 / (x * x); }
  // q i m³/h, d i mm, ruhet i mm. Returnerer hastighet m/s, R Pa/m, pd Pa
  function rundKanal(q, dmm, ruhet) {
    var d = dmm / 1000, A = Math.PI * d * d / 4, v = (q / 3600) / A;
    var Re = v * d / NU, lam = lambdaSJ(Re, (ruhet || 0.15) / 1000, d);
    var pd = RHO * v * v / 2;
    return { d: dmm, v: v, R: lam / d * pd, pd: pd, Re: Re, lambda: lam };
  }
  // Ekvivalent diameter for rektangulær kanal (Huebscher), mm
  function ekvDiameter(a, b) { return 1.30 * Math.pow(a * b, 0.625) / Math.pow(a + b, 0.25); }
  function rektKanal(q, a, b, ruhet) {
    var de = ekvDiameter(a, b); var A = a * b / 1e6, v = (q / 3600) / A;
    var dh = 2 * a * b / (a + b) / 1000; var Re = v * dh / NU, lam = lambdaSJ(Re, (ruhet || 0.15) / 1000, dh); var pd = RHO * v * v / 2;
    return { d: de, a: a, b: b, v: v, R: lam / dh * pd, pd: pd, Re: Re, lambda: lam };
  }
  function velgDimensjon(q, vmax, rmax, ruhet) {
    for (var i = 0; i < RUND.length; i++) { var k = rundKanal(q, RUND[i], ruhet); if (k.v <= vmax + 1e-9 && k.R <= rmax + 1e-9) return k; }
    return rundKanal(q, RUND[RUND.length - 1], ruhet);
  }
  // seg: {q, lengde, dim ('auto'|tall), type ('hoved'|'gren'), zeta, komponentPa}
  function beregnDelstrekning(seg, inn) {
    var q = Number(seg.q) || 0, L = Number(seg.lengde) || 0;
    var vmax = seg.type === 'gren' ? inn.vmaxGren : inn.vmaxHoved;
    var k;
    if (!q) return { q: 0, d: null, v: 0, R: 0, pd: 0, dpFriksjon: 0, dpEnkelt: 0, dpKomponent: Number(seg.komponentPa) || 0, dp: Number(seg.komponentPa) || 0, varsel: 'Mangler luftmengde' };
    if (seg.dim && seg.dim !== 'auto') {
      var dm = String(seg.dim).match(/^(\d+)\s*[x×*]\s*(\d+)$/i);
      k = dm ? rektKanal(q, +dm[1], +dm[2], inn.ruhet) : rundKanal(q, Number(seg.dim), inn.ruhet);
    } else k = velgDimensjon(q, vmax, inn.rmax, inn.ruhet);
    var dpF = k.R * L, dpE = (Number(seg.zeta) || 0) * k.pd, dpK = Number(seg.komponentPa) || 0;
    var varsel = '';
    if (k.v > vmax + 1e-9) varsel = 'Hastighet over ' + fmt(vmax, 1) + ' m/s';
    else if (k.R > inn.rmax + 1e-9) varsel = 'Trykkfall over ' + fmt(inn.rmax, 1) + ' Pa/m';
    return { q: q, d: k.d, dimTekst: k.a ? k.a + '×' + k.b : 'Ø' + k.d, v: k.v, R: k.R, pd: k.pd, dpFriksjon: dpF, dpEnkelt: dpE, dpKomponent: dpK, dp: dpF + dpE + dpK, varsel: varsel };
  }
  function beregnStrekning(str, inn) {
    var rows = (str.deler || []).map(function (s) { return beregnDelstrekning(s, inn); });
    var sum = rows.reduce(function (a, r) { return a + r.dp; }, 0);
    return { rader: rows, sum: sum };
  }
  var ZETA = [
    { navn: 'Bend 90°', z: 0.3 }, { navn: 'Bend 45°', z: 0.15 }, { navn: 'T-stykke, gjennomløp', z: 0.3 },
    { navn: 'T-stykke, avgrening', z: 1.0 }, { navn: 'Overgang / reduksjon', z: 0.1 }, { navn: 'Innløp / utløp', z: 1.0 }
  ];

  // ---------- Formatering ----------
  function fmt(x, d) {
    if (x === null || x === undefined || !isFinite(x)) return '–';
    var f = Math.pow(10, d || 0); x = Math.round(Number(x) * f) / f; if (x === 0) x = 0;
    return Number(x).toLocaleString('nb-NO', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  }

  function csvRomskjema(prosjekt) {
    var hdr = ['Etasje', 'Romnr', 'Romnavn', 'Romtype', 'Areal m2', 'Personer', 'Senger', 'System', 'Boenhet', 'Krav tilluft m3/h', 'Krav avtrekk m3/h', 'Forsert avtrekk m3/h', 'Prosjektert tilluft m3/h', 'Prosjektert avtrekk m3/h', 'Status', 'Grunnlag', 'Kilde', 'IFC GUID'];
    var rows = [hdr];
    (prosjekt.rom || []).forEach(function (r) {
      var st = romStatus(r); var t = TYPE_BY_ID[r.type] || TYPE_BY_ID.annet;
      rows.push([r.etasje, r.nummer, r.navn, t.navn, num(r.areal, 2), st.krav.personer === null ? '' : st.krav.personer, st.krav.senger === null ? '' : st.krav.senger, r.system || '', r.boenhet || '', num(st.krav.tilluft, 1), num(st.krav.avtrekk, 1), st.krav.forsert === null ? '' : st.krav.forsert, num(st.tilluft, 0), num(st.avtrekk, 0), st.status === 'ok' ? 'OK' : st.melding, st.krav.grunnlag, st.krav.kilde, r.guid || '']);
    });
    function num(x, d) { return x === null || x === undefined || !isFinite(x) ? '' : Number(x).toFixed(d).replace('.', ','); }
    return '﻿' + rows.map(function (r) { return r.map(function (c) { c = String(c === null || c === undefined ? '' : c); return /[;"\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(';'); }).join('\r\n');
  }

  function ifcVerdier(prosjekt) {
    var map = new Map();
    (prosjekt.rom || []).forEach(function (r) {
      if (!r.guid) return; var st = romStatus(r); var t = TYPE_BY_ID[r.type] || TYPE_BY_ID.annet;
      map.set(r.guid, [
        { navn: 'Romtype', type: 'LABEL', verdi: t.navn },
        { navn: 'System', type: 'LABEL', verdi: r.system || '' },
        { navn: 'Tilluft_krav_m3h', type: 'REAL', verdi: st.krav.tilluft },
        { navn: 'Avtrekk_krav_m3h', type: 'REAL', verdi: st.krav.avtrekk },
        { navn: 'Tilluft_prosjektert_m3h', type: 'REAL', verdi: st.tilluft },
        { navn: 'Avtrekk_prosjektert_m3h', type: 'REAL', verdi: st.avtrekk },
        { navn: 'Avtrekk_forsert_m3h', type: 'REAL', verdi: st.krav.forsert },
        { navn: 'Personer', type: 'INT', verdi: st.krav.personer },
        { navn: 'Senger', type: 'INT', verdi: st.krav.senger },
        { navn: 'Grunnlag', type: 'TEXT', verdi: st.krav.grunnlag + ' (' + st.krav.kilde + ')' },
        { navn: 'Status', type: 'LABEL', verdi: st.status === 'ok' ? 'OK' : st.melding }
      ]);
    });
    return map;
  }

  function balanserBoenhet(romListe) {
    var rs = romListe.filter(function (r) { return !r.fjernet; });
    var A = rs.reduce(function (a, r) { return a + (Number(r.areal) || 0); }, 0);
    var sup = rs.filter(function (r) { var k = krav(r); return k.tilluft > 0 && k.regel !== 'manuell'; });
    var exh = rs.filter(function (r) { var k = krav(r); return k.avtrekk > 0 && k.regel !== 'manuell'; });
    if (!sup.length || !exh.length) return { ok: false, melding: !sup.length ? 'Boenheten har ingen stue eller soverom å fordele tilluft på.' : 'Boenheten har ingen kjøkken, bad eller toalett å fordele avtrekk på.' };
    var cur = function (r, side) { return romStatus(r)[side]; };
    var sum = function (list, side) { return list.reduce(function (a, r) { return a + cur(r, side); }, 0) + (side === 'tilluft' ? rs.filter(function (r) { return sup.indexOf(r) < 0; }).reduce(function (a, r) { return a + cur(r, 'tilluft'); }, 0) : rs.filter(function (r) { return exh.indexOf(r) < 0; }).reduce(function (a, r) { return a + cur(r, 'avtrekk'); }, 0)); };
    var fordel = function (list, side, mangler, vekt) {
      var W = list.reduce(function (a, r) { return a + vekt(r); }, 0) || 1;
      var base = list.map(function (r) { return cur(r, side); });
      var maal = base.reduce(function (a, b) { return a + b; }, 0) + Math.ceil(mangler / 5 - 1e-9) * 5;
      var exact = list.map(function (r, i) { return base[i] + mangler * vekt(r) / W; });
      var val = exact.map(function (x, i) { return Math.max(base[i], Math.floor(x / 5 + 1e-9) * 5); });
      var tot = val.reduce(function (a, b) { return a + b; }, 0);
      var order = exact.map(function (x, i) { return i; }).sort(function (a, b) { return (exact[b] - val[b]) - (exact[a] - val[a]); });
      for (var k = 0; tot < maal && k < 1000; k++) { var i = order[k % order.length]; val[i] += 5; tot += 5; }
      list.forEach(function (r, i) { if (side === 'tilluft') r.tilluftProsj = val[i]; else r.avtrekkProsj = val[i]; });
    };
    var aSup = function (r) { return Number(r.areal) || 1; }, aExh = function (r) { return krav(r).avtrekk || 1; };
    var T = sum(sup, 'tilluft'), maal = Math.max(T, ceil5(1.2 * A));
    if (maal > T) fordel(sup, 'tilluft', maal - T, aSup);
    T = sum(sup, 'tilluft'); var Av = sum(exh, 'avtrekk');
    if (Av < T) fordel(exh, 'avtrekk', T - Av, aExh); else if (Av > T) fordel(sup, 'tilluft', Av - T, aSup);
    T = sum(sup, 'tilluft'); Av = sum(exh, 'avtrekk');
    if (Av < T) fordel(exh, 'avtrekk', T - Av, aExh);
    T = sum(sup, 'tilluft'); Av = sum(exh, 'avtrekk');
    return { ok: true, tilluft: T, avtrekk: Av, krav: 1.2 * A };
  }

  return {
    balanserBoenhet: balanserBoenhet,
    decodeIfcString: decodeIfcString, encodeIfcString: encodeIfcString, parseArgs: parseArgs, parseIFC: parseIFC, writeIFC: writeIFC, newGuid: newGuid,
    ROMTYPER: ROMTYPER, TYPE_BY_ID: TYPE_BY_ID, gjettRomtype: gjettRomtype, krav: krav, romStatus: romStatus, oppsummer: oppsummer,
    RUND: RUND, rundKanal: rundKanal, rektKanal: rektKanal, ekvDiameter: ekvDiameter, velgDimensjon: velgDimensjon, beregnDelstrekning: beregnDelstrekning, beregnStrekning: beregnStrekning, ZETA: ZETA,
    fmt: fmt, csvRomskjema: csvRomskjema, ifcVerdier: ifcVerdier, polyArea: polyArea, PSET: PSET
  };
})();
if (typeof module !== 'undefined') module.exports = FV;
