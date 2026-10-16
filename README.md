# WebPAU

Archivo público de exámenes de la PAU (Prueba de Acceso a la Universidad) en
Andalucía, y panel de administración para subirlos.

La web pública es estática y se publica en **GitHub Pages** sin coste. Los datos
—el catálogo en JSON y los PDF— viven **dentro del propio repositorio**, así que
GitHub hace de base de datos y de histórico: cada cambio es un commit y se puede
revertir.

```
┌──────────────┐   sube PDF    ┌───────────────┐   commit + push   ┌────────────┐
│  Panel admin │ ────────────▶ │  El repo      │ ────────────────▶ │  GitHub    │
│  (local)     │               │  data/*.json  │                   │  Pages     │
└──────────────┘               │  public/exams │                   │  (web)     │
                               └───────────────┘                   └────────────┘
```

---

## La PAU en Andalucía

El catálogo sigue el modelo vigente de la **PAU** andaluza:

- **Fase de acceso** (obligatoria): cuatro ejercicios —Lengua Castellana y
  Literatura II, Lengua Extranjera II, Historia de España o Historia de la
  Filosofía, y la materia obligatoria de la modalidad cursada.
- **Fase de admisión** (voluntaria): hasta tres materias de 2.º de Bachillerato
  distintas de las del acceso, más una segunda lengua extranjera, para mejorar
  la nota.
- **Dos convocatorias al año**: ordinaria (junio) y extraordinaria (julio).

Cada asignatura de `data/subjects.json` declara en qué fases entra. Varias
materias de modalidad cuentan en las dos, por eso `phases` es una lista.

---

## Puesta en marcha

```bash
git clone https://github.com/ElioXY/WebPAU.git
cd WebPAU
npm install
```

## Uso diario

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Sitio público en <http://localhost:4321> |
| `npm run admin` | Panel de administración en <http://127.0.0.1:4321> |
| `npm run build` | Genera el sitio estático en `dist/` |
| `npm run preview` | Sirve `dist/` como lo hará GitHub Pages |
| `npm run check` | Comprobación de tipos de Astro y TypeScript |

## Subir exámenes

1. `npm run admin`
2. Copia el **token** que imprime la terminal y pégalo en el panel.
3. Arrastra los PDF (puedes soltar varios a la vez).
4. Elige **asignatura**, **año**, **convocatoria** y **tipo de documento**.
5. «Subir» → «Subir a GitHub».

Mientras no pulses «Subir a GitHub» nada sale de tu máquina: los archivos se
quedan en `public/exams/` y las entradas en `data/exams.json`. Eso te deja
revisar, corregir o borrar antes de publicar.

Al hacer push, la acción **Deploy** de `.github/workflows/deploy.yml` recompila
y publica la web automáticamente (tarda 1–2 minutos).

### Editar y borrar

Desde la tabla del panel puedes corregir cualquier campo de un documento ya
subido, o eliminarlo (se borra también su PDF del disco). Si borras algo por
error, `git checkout data/exams.json public/exams` lo recupera desde el
histórico, siempre que ya tengas hecho `git add` y commit.

### Añadir una asignatura nueva

Edita `data/subjects.json` y reinicia `npm run admin`. Cada asignatura necesita:

```json
{
  "code": "GEO",
  "name": "Geografía",
  "short": "Geogr.",
  "phases": ["admision"],
  "aliases": ["geografia", "geografía", "geography"]
}
```

- `code` — 2–4 letras, único. Es el directorio donde se guarda el PDF.
- `short` — la abreviatura que ve el público en los filtros.
- `phases` — `acceso`, `admision` o ambas (`["acceso", "admision"]`).
- `aliases` — términos de búsqueda alternativos.

---

## Estructura

```
data/
  subjects.json      catálogo de asignaturas (edítalo a mano)
  exams.json         los documentos subidos (no lo edites a mano)
public/
  exams/<año>/<convocatoria>/<asignatura>/<id>.pdf
src/
  lib/catalog.ts     tipos, lectura/escritura del catálogo — lo comparten
                      el sitio y el panel
  pages/index.astro  la web pública
  scripts/archive.ts filtrado en el cliente (sin framework)
  styles/global.css  el sistema visual
admin/
  server.ts          servidor local: subida, edición, git
  public/            interfaz del panel
```

## Filtros de la web pública

El estado vive en la URL, así que cualquier vista se puede compartir o enlazar:

```
?s=MAT          asignatura
?y=2025         año
?ss=ordinaria   convocatoria (ordinaria | extraordinaria)
?t=enunciados   tipo de documento (enunciados | soluciones | criterios | plantilla)
?p=acceso       fase (acceso | admision)
?q=filosofia    búsqueda libre
```

Ejemplo: <https://elioxy.github.io/WebPAU/?s=HFI&y=2025&t=soluciones>

### Interfaz

- **Tema claro / oscuro.** Se elige automáticamente según el sistema y puedes
  cambiarlo con el botón flotante; la preferencia se guarda en el navegador.
- **Atajo `/`.** Enfoca el buscador al instante. `Esc` lo desenfoca.
- **Volver arriba.** Aparece un botón flotante al bajar por la página.
- Cuando el archivo está vacío, la web oculta los filtros y muestra un estado
  de bienvenida con acceso al repositorio.

## Notas prácticas

- **Tamaño del repositorio.** Cada PDF aumenta el tamaño del repo para siempre
  (Git guarda el histórico). Con ~300 documentos de 1–2 MB el repo se queda
  alrededor de 400–600 MB. GitHub Pages admite 1 GB por sitio. Si te acercas al
  límite, sirve los PDF desde otro sitio (un bucket, un CDN) y guarda en
  `exams.json` solo la URL externa.
- **Sin base de datos ni servidor.** Todo el coste es cero y el histórico es
  gratis. A cambio, «borrar» es un commit, no un `DELETE`.
- **Primera publicación.** En GitHub: *Settings → Pages → Source → GitHub
  Actions*. Las ejecuciones siguientes ya se solas.
- **Dominio propio.** Si lo añades, define `SITE_URL` y `SITE_BASE=/` en el
  workflow y ajusta `site` en `astro.config.mjs`.

## Legal

Los documentos son obra de los organismos que los emiten. WebPAU solo los reúne
y los hace accesibles. Si eres titular de alguno y prefieres que no se difunda,
abre un issue y se retira.
