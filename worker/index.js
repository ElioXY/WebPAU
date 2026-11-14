/* =========================================================================
   Worker de /api — inicio de sesión con GitHub.

   El sitio sigue siendo estático: HTML, CSS, JS y PDFs los sirve Workers
   Static Assets sin ejecutar este script, así que esos accesos siguen siendo
   gratuitos e ilimitados. Solo las rutas /api/* llegan aquí, y son unas pocas
   peticiones por sesión.

   Rutas
     GET  /api/login     → redirige a GitHub con un `state` en cookie
     GET  /api/callback  → canjea el código, comprueba la cuenta y abre sesión
     GET  /api/me        → quién soy (401 si no hay sesión)
     POST /api/logout    → cierra la sesión
     *    /api/gh/*      → proxy de la API de GitHub con el token de la cookie

   Por qué hay un proxy: el canje del código en GitHub exige `client_secret` y
   su endpoint no manda cabeceras CORS, así que un navegador no puede hacerlo
   solo. De paso, el panel deja de llamar a api.github.com —que la CSP del
   sitio bloquea— y habla con su propio origen.

   Variables (wrangler.jsonc → vars, y `wrangler secret put` para los secretos)
     GITHUB_CLIENT_ID       público, de la OAuth App
     GITHUB_CLIENT_SECRET   secreto
     SESSION_SECRET         secreto: firma la cookie de sesión
     ALLOWED_LOGIN          logins autorizados, separados por comas
     GITHUB_SCOPE           por defecto `public_repo`
   ========================================================================= */

const SESSION_COOKIE = 'webpau_session';
const STATE_COOKIE = 'webpau_state';
const SESSION_SECONDS = 60 * 60 * 12;
const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'WebPAU';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/* ------------------------------------------------------------- respuestas */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });

/* Página de error sin estilos inline: la CSP del sitio también se aplica aquí. */
const page = (title, message, status = 400) =>
  new Response(
    `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} · WebPAU</title></head>
<body>
<main>
<h1>${title}</h1>
<p>${message}</p>
<p><a href="/admin">Volver al panel</a> · <a href="/">Ir a la web</a></p>
</main>
</body>
</html>`,
    {
      status,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    }
  );

/* ---------------------------------------------------------------- helpers */

const toBase64Url = (bytes) => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromBase64Url = (value) => {
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const randomToken = (bytes = 16) => {
  const buffer = crypto.getRandomValues(new Uint8Array(bytes));
  return Array.from(buffer, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Comparación en tiempo constante: evita filtrar el secreto por el tiempo. */
const timingSafeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

async function unsign(value, secret) {
  const dot = value.lastIndexOf('.');
  if (dot < 1) return null;
  const expected = await sign(value.slice(0, dot), secret);
  if (!timingSafeEqual(value, expected)) return null;
  try {
    return JSON.parse(decoder.decode(fromBase64Url(value.slice(0, dot))));
  } catch {
    return null;
  }
}

function readCookie(request, name) {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

function setCookie(name, value, maxAge, url) {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (url.protocol === 'https:') parts.push('Secure');
  return parts.join('; ');
}

/** Sesión válida o `null`. El token vive dentro de la cookie firmada. */
async function readSession(request, env) {
  if (!env.SESSION_SECRET) return null;
  const value = readCookie(request, SESSION_COOKIE);
  if (!value) return null;
  const data = await unsign(value, env.SESSION_SECRET);
  if (!data || typeof data.t !== 'string' || typeof data.e !== 'number') return null;
  if (data.e < Date.now()) return null;
  return data;
}

const configured = (env) =>
  Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && env.SESSION_SECRET);

const allowedLogins = (env) =>
  String(env.ALLOWED_LOGIN ?? '')
    .split(',')
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean);

/* ----------------------------------------------------------------- rutas */

async function login(request, env, url) {
  if (!configured(env)) {
    return page(
      'Falta configurar el acceso',
      'Al Worker le falta <code>GITHUB_CLIENT_ID</code>, <code>GITHUB_CLIENT_SECRET</code> o <code>SESSION_SECRET</code>. Los secretos se ponen con <code>wrangler secret put</code>.',
      500
    );
  }
  if (allowedLogins(env).length === 0) {
    return page('Falta la lista de cuentas', 'Define <code>ALLOWED_LOGIN</code> con los usuarios de GitHub que pueden publicar.', 500);
  }

  const state = randomToken(16);
  const authorize = new URL('https://github.com/login/oauth/authorize');
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', `${url.origin}/api/callback`);
  authorize.searchParams.set('scope', env.GITHUB_SCOPE || 'public_repo');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('allow_signup', 'false');

  return new Response(null, {
    status: 302,
    headers: {
      location: authorize.href,
      'set-cookie': setCookie(STATE_COOKIE, state, 600, url),
      'cache-control': 'no-store',
    },
  });
}

async function callback(request, env, url) {
  if (!configured(env)) return page('Falta configurar el acceso', 'El Worker no tiene sus credenciales.', 500);

  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expected = readCookie(request, STATE_COOKIE);
  const clearState = setCookie(STATE_COOKIE, '', 0, url);

  if (!code || !state || !expected || !timingSafeEqual(state, expected)) {
    return new Response(
      page(
        'No se pudo verificar la vuelta de GitHub',
        'La petición de acceso ha caducado o no venía de este sitio. Vuelve a intentarlo desde el panel.',
        400
      ).body,
      { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': clearState } }
    );
  }

  let token = '';
  try {
    const exchange = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT,
      },
      body: new URLSearchParams({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/api/callback`,
      }),
    });
    const data = await exchange.json();
    token = typeof data.access_token === 'string' ? data.access_token : '';
  } catch {
    token = '';
  }

  if (!token) {
    return new Response(
      page(
        'GitHub no ha dado acceso',
        'El código de acceso no era válido o ha caducado. Vuelve a intentarlo desde el panel.',
        400
      ).body,
      { status: 400, headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': clearState } }
    );
  }

  let login = '';
  try {
    const response = await fetch(`${GITHUB_API}/user`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': USER_AGENT,
        'x-github-api-version': '2022-11-28',
      },
    });
    if (response.ok) {
      const user = await response.json();
      login = typeof user.login === 'string' ? user.login : '';
    }
  } catch {
    login = '';
  }

  if (!login) {
    return new Response(
      page('No se pudo leer la cuenta', 'GitHub no ha devuelto el usuario de este token.', 502).body,
      { status: 502, headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': clearState } }
    );
  }

  if (!allowedLogins(env).includes(login.toLowerCase())) {
    return new Response(
      page(
        'Esta cuenta no puede publicar',
        `La cuenta de GitHub <code>${login.replace(/[<>&"]/g, '')}</code> no está en la lista de administradores del archivo.`,
        403
      ).body,
      { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'set-cookie': clearState } }
    );
  }

  const payload = toBase64Url(
    encoder.encode(JSON.stringify({ t: token, u: login, e: Date.now() + SESSION_SECONDS * 1000 }))
  );
  const value = await sign(payload, env.SESSION_SECRET);

  const headers = new Headers({
    location: `${url.origin}/admin`,
    'cache-control': 'no-store',
  });
  headers.append('set-cookie', setCookie(SESSION_COOKIE, value, SESSION_SECONDS, url));
  headers.append('set-cookie', clearState);
  return new Response(null, { status: 302, headers });
}

async function me(request, env) {
  const session = await readSession(request, env);
  if (!session) return json({ authenticated: false }, 401);
  return json({ authenticated: true, login: session.u });
}

async function logout(request, env, url) {
  if (request.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'set-cookie': setCookie(SESSION_COOKIE, '', 0, url),
    },
  });
}

/** Proxy mínimo a la API de GitHub: el navegador nunca ve el token. */
async function proxy(request, env, url) {
  const session = await readSession(request, env);
  if (!session) return json({ message: 'La sesión ha caducado. Vuelve a entrar con GitHub.' }, 401);

  /* el cookie es SameSite=Lax, pero un POST de otro sitio no debe pasar */
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ message: 'Origen no permitido' }, 403);
  }

  const rest = url.pathname.replace(/^\/api\/gh/, '') || '/';
  const target = new URL(`${GITHUB_API}${rest}${url.search}`);

  const headers = new Headers({
    authorization: `Bearer ${session.t}`,
    'user-agent': USER_AGENT,
    'x-github-api-version': '2022-11-28',
  });
  const accept = request.headers.get('Accept');
  if (accept) headers.set('accept', accept);
  const contentType = request.headers.get('Content-Type');
  if (contentType) headers.set('content-type', contentType);

  const init = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    init.body = request.body;
  }

  const response = await fetch(target, init);
  const out = new Headers({ 'cache-control': 'no-store' });
  const type = response.headers.get('content-type');
  if (type) out.set('content-type', type);
  return new Response(response.body, { status: response.status, headers: out });
}

/* --------------------------------------------------------------- arranque */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    /* Todo lo que no sea /api sale por los estáticos: no invoca el Worker, así
       que el HTML y los PDFs siguen siendo gratuitos e ilimitados. */
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) {
      return env.ASSETS.fetch(request);
    }

    try {
      if (url.pathname === '/api/login') return await login(request, env, url);
      if (url.pathname === '/api/callback') return await callback(request, env, url);
      if (url.pathname === '/api/me') return await me(request, env);
      if (url.pathname === '/api/logout') return await logout(request, env, url);
      if (url.pathname.startsWith('/api/gh/')) return await proxy(request, env, url);
      return json({ error: 'Ruta desconocida' }, 404);
    } catch (error) {
      return json(
        { error: 'Error interno', detail: error instanceof Error ? error.message : '' },
        500
      );
    }
  },
};
