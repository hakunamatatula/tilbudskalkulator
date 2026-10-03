(function () {
  var base = document.currentScript.src.replace(/[^/]*$/, ''), v = 'ef06caec5e';
  var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = base + 'app.css?v=' + v; document.head.appendChild(css);
  var list = [['https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'], [base + 'supabase.js?v=2.117.2'], [base + 'core.js?v=' + v, 'coreSrc'], [base + 'app.js?v=' + v]];
  function next() {
    var it = list.shift(); if (!it) return;
    var s = document.createElement('script'); s.src = it[0]; if (it[1]) s.id = it[1]; s.async = false;
    s.onload = next; s.onerror = function () { if (/jszip/.test(it[0])) { next(); return; } document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px;font:15px system-ui">Fjelluft Vent kunne ikke lastes. Sjekk nettforbindelsen og last siden på nytt.</p>'); };
    document.body.appendChild(s);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', next); else next();
})();
