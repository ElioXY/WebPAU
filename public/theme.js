/* =========================================================================
   Arranque del tema, como archivo aparte y no como script inline.

   El sitio se sirve con una Content-Security-Policy `script-src 'self'`, que
   bloquea cualquier script escrito dentro del HTML. Este archivo externo se
   carga de forma bloqueante desde el <head>, así que el tema ya está puesto
   antes del primer pintado y no hay destello de papel claro.

   También marca el documento con la clase `js`: el CSS la usa para saber que
   puede esconder lo que el JavaScript va a revelar.
   ========================================================================= */

(function () {
  var root = document.documentElement;
  root.classList.add('js');

  try {
    var saved = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme =
      saved === 'light' || saved === 'dark' ? saved : prefersDark ? 'dark' : 'light';
  } catch (error) {
    root.dataset.theme = 'light';
  }
})();
