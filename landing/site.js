(function(){
  // Scale fixed-size mock-ups (the tablet drawing on the home page) to their box.
  var boxes = Array.prototype.slice.call(document.querySelectorAll('[data-fit]'));
  function fit(box){ var w = +box.getAttribute('data-fit'); var k = box.clientWidth / w; if (k > 0) box.style.setProperty('--k', k); }
  boxes.forEach(fit);
  if ('ResizeObserver' in window) { var ro = new ResizeObserver(function(es){ es.forEach(function(e){ fit(e.target); }); }); boxes.forEach(function(b){ ro.observe(b); }); }
  else { window.addEventListener('resize', function(){ boxes.forEach(fit); }); }

  var APP_URL = 'https://whiteboard-app-beta.vercel.app';

  // ?ref=reddit (which post sent the visitor) is passed on to every app link.
  // It is remembered for this tab only, so it survives a click to another page here.
  var REF_RE = /^[A-Za-z0-9_-]{1,40}$/;
  var REF = null;
  try { REF = new URLSearchParams(window.location.search).get('ref'); } catch (err) {}
  if (!REF || !REF_RE.test(REF)) REF = null;
  try {
    if (REF) window.sessionStorage.setItem('cs_ref', REF);
    else REF = window.sessionStorage.getItem('cs_ref');
  } catch (err) {}
  if (!REF || !REF_RE.test(REF)) REF = null;
  function withRef(url){ return REF ? url + (url.indexOf('?') < 0 ? '?' : '&') + 'ref=' + encodeURIComponent(REF) : url; }
  if (REF) Array.prototype.forEach.call(document.querySelectorAll('a[href^="' + APP_URL + '"]'), function(a){ a.href = withRef(a.getAttribute('href')); });

  // Join form: check the code, then open the app's join screen with it filled in.
  var form = document.getElementById('joinForm'), input = document.getElementById('classCode'), msg = document.getElementById('joinMsg');
  if (!form || !input || !msg) return;
  var CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;
  form.addEventListener('submit', function(e){
    e.preventDefault();
    var code = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) { msg.textContent = 'Type the code shown on your teacher’s board, like 7KQ42M.'; input.focus(); return; }
    if (!CODE_RE.test(code)) { msg.textContent = 'Class codes are 6 letters and numbers, like 7KQ42M. Check the code on your teacher’s board.'; input.focus(); return; }
    var url = withRef(APP_URL + '/join?code=' + encodeURIComponent(code));
    var inFrame = false; try { inFrame = window.top !== window.self; } catch (err) { inFrame = true; }
    if (!inFrame) { window.location.assign(url); return; }
    msg.innerHTML = '';
    var a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Continue to class ' + code + ' →';
    msg.appendChild(a);
  });
})();
