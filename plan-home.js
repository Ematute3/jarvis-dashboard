/* Home-page "By class" card: each course's next couple of to-dos (from /api/plan). */
(function () {
  'use strict';
  var host = document.getElementById('planHome');
  if (!host) return;
  var HEX = { cyan: '#00E5FF', amber: '#FF9100', magenta: '#FF4FB8', violet: '#A86CFF', green: '#6CFFB0', blue: '#2979FF' };
  var limit = parseInt(host.getAttribute('data-limit'), 10) || 2;
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function short(ds) {
    var p = ds.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function render(d) {
    var rows = d.courses.map(function (c) {
      var dated = c.items.filter(function (i) { return i.date; });
      var top = dated.slice(0, limit);
      var color = HEX[c.color] || c.color || '#00E5FF';
      var lines = top.length
        ? top.map(function (i) {
            return '<li><span class="ph-d' + (i.date < d.today ? ' over' : '') + '">' + esc(short(i.date)) + '</span><span class="ph-t">' + esc(i.title) + '</span></li>';
          }).join('')
        : '<li class="ph-none">' + (c.items.length ? c.items.length + ' with no date yet' : 'Nothing posted yet') + '</li>';
      return '<div class="ph-course" style="--c:' + esc(color) + '"><div class="ph-name"><i></i>' + esc(c.name) + '</div><ul>' + lines + '</ul></div>';
    }).join('');
    host.innerHTML = rows || '<div class="ph-none">No classes to plan from yet.</div>';
    var meta = document.getElementById('planMeta');
    if (meta) meta.textContent = d.courses.length + ' CLASSES';
  }
  function load() {
    fetch('/api/plan', { credentials: 'same-origin' }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.error) { host.innerHTML = '<div class="ph-none">' + esc(d.error) + '</div>'; return; }
      render(d);
    }).catch(function () { host.innerHTML = '<div class="ph-none">Couldn’t load your classes.</div>'; });
  }
  load();
  setInterval(load, 5 * 60 * 1000);
})();
