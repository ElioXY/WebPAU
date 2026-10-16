/* =========================================================================
   Cliente mínimo de la API de GitHub, pensado para el navegador.

   El panel de administración ya no necesita un servidor local: lee el
   catálogo del repositorio y lo modifica con un único commit atómico, así
   que GitHub Pages reconstruye la web sola.

   Sin dependencias y sin `node:` (esto se ejecuta en el navegador).
   ========================================================================= */

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface FileChange {
  /** Ruta relativa a la raíz del repositorio. */
  path: string;
  /** Contenido en base64, o `null` para borrar el archivo. */
  base64: string | null;
}

export class GithubError extends Error {
  status: number;
  detail: string;

  constructor(status: number, message: string, detail = '') {
    super(message);
    this.name = 'GithubError';
    this.status = status;
    this.detail = detail;
  }
}

/* ------------------------------------------------------------------ red */

interface RequestOptions {
  method?: string;
  body?: unknown;
  accept?: string;
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * Petición a la API. Va con XMLHttpRequest en vez de `fetch` porque es la
 * única forma de saber cuánto ha subido ya un PDF grande.
 */
function request<T>(token: string, url: string, options: RequestOptions = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method ?? 'GET', url, true);
    xhr.setRequestHeader('Accept', options.accept ?? 'application/vnd.github+json');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('X-GitHub-Api-Version', API_VERSION);
    if (options.body !== undefined) xhr.setRequestHeader('Content-Type', 'application/json');

    if (options.onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) options.onProgress?.(event.loaded, event.total);
      });
    }

    xhr.addEventListener('load', () => {
      let parsed: unknown = null;
      try {
        parsed = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      } catch {
        /* respuesta que no es JSON: nos quedamos con el texto crudo */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(parsed as T);
        return;
      }
      reject(toError(xhr.status, parsed, xhr.responseText));
    });
    xhr.addEventListener('error', () =>
      reject(new GithubError(0, 'No se pudo contactar con GitHub. Comprueba tu conexión.'))
    );
    xhr.addEventListener('abort', () =>
      reject(new GithubError(0, 'La operación se canceló antes de terminar.'))
    );

    xhr.send(options.body !== undefined ? JSON.stringify(options.body) : null);
  });
}

function toError(status: number, body: unknown, raw: string): GithubError {
  const detail =
    (body as { message?: string } | null)?.message ?? String(raw ?? '').slice(0, 300);

  if (status === 401) {
    return new GithubError(401, 'GitHub no acepta el token: estará caducado o mal copiado.', detail);
  }
  if (status === 403) {
    return new GithubError(
      403,
      'GitHub ha rechazado la operación. Al token le falta el permiso «Contents: Read and write» sobre este repositorio, o se ha agotado la cuota.',
      detail
    );
  }
  if (status === 404) {
    return new GithubError(
      404,
      'No encuentro el repositorio, la rama o el archivo. Revisa que el token incluya este repositorio.',
      detail
    );
  }
  if (status === 409 || status === 422) {
    return new GithubError(
      status,
      'Alguien ha publicado cambios mientras trabajabas. Sincroniza y vuelve a intentarlo.',
      detail
    );
  }
  return new GithubError(status, `GitHub ha devuelto un error ${status}.`, detail);
}

function repoUrl(ref: RepoRef, rest: string): string {
  return `${API}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}${rest}`;
}

/* -------------------------------------------------------------- base64 */

export function bytesToBase64(bytes: Uint8Array): string {
  // Troceado a mano: `String.fromCharCode(...bytes)` revienta la pila con
  // archivos de varios megas.
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function textToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text));
}

function base64ToText(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* ----------------------------------------------------------- operaciones */

export interface RepoInfo {
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
}

export async function getRepoInfo(token: string, ref: RepoRef): Promise<RepoInfo> {
  const data = await request<{
    default_branch: string;
    private: boolean;
    html_url: string;
  }>(token, repoUrl(ref, ''));

  return {
    defaultBranch: data.default_branch,
    private: data.private,
    htmlUrl: data.html_url,
  };
}

export interface JsonFile<T> {
  data: T;
  /** SHA del blob, necesario si luego se reescribe con la API de contenidos. */
  sha: string;
}

/**
 * Lee un JSON del repositorio. Devuelve `null` si el archivo no existe, para
 * distinguirlo de un error de red o de permisos.
 */
export async function readJsonFile<T>(
  token: string,
  ref: RepoRef,
  branch: string,
  path: string
): Promise<JsonFile<T> | null> {
  let content: string;
  let sha: string;

  try {
    const meta = await request<{ content?: string; encoding?: string; sha: string; size: number }>(
      token,
      repoUrl(ref, `/contents/${path}?ref=${encodeURIComponent(branch)}`)
    );
    sha = meta.sha;
    content =
      meta.encoding === 'base64' && meta.content
        ? base64ToText(meta.content)
        : // Archivos por encima de 1 MB: la API omite el contenido y hay que
          // pedirlo en crudo.
          await request<string>(token, repoUrl(ref, `/contents/${path}?ref=${encodeURIComponent(branch)}`), {
            accept: 'application/vnd.github.raw',
          });
  } catch (error) {
    if (error instanceof GithubError && error.status === 404) return null;
    throw error;
  }

  return { data: JSON.parse(content) as T, sha };
}

/** Rutas de todos los archivos del árbol, en una sola petición. */
export async function readTreePaths(
  token: string,
  ref: RepoRef,
  branch: string
): Promise<{ paths: Set<string>; truncated: boolean }> {
  const data = await request<{
    truncated: boolean;
    tree: { path: string; type: string }[];
  }>(token, repoUrl(ref, `/git/trees/${encodeURIComponent(branch)}?recursive=1`));

  const paths = new Set<string>();
  for (const entry of data.tree) {
    if (entry.type === 'blob') paths.add(entry.path);
  }
  return { paths, truncated: data.truncated };
}

export interface CommitResult {
  sha: string;
  url: string;
}

export interface CommitOptions {
  token: string;
  ref: RepoRef;
  branch: string;
  message: string;
  files: FileChange[];
  /** Progreso de 0 a 1 mientras se suben los blobs. */
  onProgress?: (label: string, ratio: number) => void;
}

/**
 * Publica todos los cambios en un único commit.
 *
 * Se usa la API de datos de Git (blobs → árbol → commit → ref) en lugar de la
 * de contenidos para que un alta de cinco PDFs no sean cinco commits ni cinco
 * reconstrucciones de Pages. La ref se actualiza con `force: false`: si la
 * rama ha avanzado por debajo, GitHub rechaza el empujón en vez de pisar.
 */
export async function commitFiles(options: CommitOptions): Promise<CommitResult> {
  const { token, ref, branch, message, files, onProgress } = options;

  const head = await request<{ object: { sha: string } }>(
    token,
    repoUrl(ref, `/git/ref/heads/${encodeURIComponent(branch)}`)
  );
  const headSha = head.object.sha;

  const parent = await request<{ tree: { sha: string } }>(
    token,
    repoUrl(ref, `/git/commits/${headSha}`)
  );
  const baseTree = parent.tree.sha;

  const writes = files.filter((file) => file.base64 !== null);
  const entries: { path: string; mode: string; type: string; sha: string | null }[] = [];

  for (const [index, file] of writes.entries()) {
    const name = file.path.split('/').pop() ?? file.path;
    onProgress?.(`Subiendo ${name}`, writes.length ? index / writes.length : 0);

    const blob = await request<{ sha: string }>(token, repoUrl(ref, '/git/blobs'), {
      method: 'POST',
      body: { content: file.base64, encoding: 'base64' },
    });
    entries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  // GitHub rechaza el árbol entero si se intenta borrar algo que no existe,
  // así que las bajas se comprueban antes contra el árbol real.
  const deletions = files.filter((file) => file.base64 === null);
  if (deletions.length) {
    const { paths } = await readTreePaths(token, ref, branch);
    for (const file of deletions) {
      if (paths.has(file.path)) {
        entries.push({ path: file.path, mode: '100644', type: 'blob', sha: null });
      }
    }
  }

  onProgress?.('Publicando', 1);

  const tree = await request<{ sha: string }>(token, repoUrl(ref, '/git/trees'), {
    method: 'POST',
    body: { base_tree: baseTree, tree: entries },
  });

  const commit = await request<{ sha: string; html_url: string }>(
    token,
    repoUrl(ref, '/git/commits'),
    {
      method: 'POST',
      body: { message, tree: tree.sha, parents: [headSha] },
    }
  );

  await request(token, repoUrl(ref, `/git/refs/heads/${encodeURIComponent(branch)}`), {
    method: 'PATCH',
    body: { sha: commit.sha, force: false },
  });

  return { sha: commit.sha, url: commit.html_url };
}
