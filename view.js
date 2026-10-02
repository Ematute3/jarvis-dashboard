/* Picks the phone or desktop version of the home page.
   - First visit: phones (narrow screen or mobile user agent) get mobile.html,
     everything else gets index.html.
   - "PHONE VIEW" / "DESKTOP VIEW" links remember your choice on this device.
   - ?view=mobile or ?view=desktop in the URL also sets it. */
window.JarvisView = (function () {
  var KEY = 'jarvis-view';
  function get() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function set(v) { try { localStorage.setItem(KEY, v); } catch (e) { /* private mode */ } }
  function isPhone() {
    return window.matchMedia('(max-width: 720px)').matches ||
      /iPhone|iPod|Android.+Mobile/i.test(navigator.userAgent);
  }
  function wanted() {
    var q = /[?&]view=(desktop|mobile)/.exec(location.search);
    if (q) { set(q[1]); return q[1]; }
    return get() || (isPhone() ? 'mobile' : 'desktop');
  }
  return {
    route: function (page) {
      var w = wanted();
      if (w !== page) location.replace(w === 'mobile' ? 'mobile.html' : 'index.html');
    },
    switchTo: function (v) {
      set(v);
      location.href = v === 'mobile' ? 'mobile.html' : 'index.html';
    },
  };
})();
