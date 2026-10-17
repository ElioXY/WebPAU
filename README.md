# WebPAU

**Un archivo público de los exámenes de la PAU de Andalucía** (Prueba de Acceso
a la Universidad): los enunciados que se reparten en el aula, sus soluciones,
los criterios con que se corrigen y la hoja de respuestas en blanco, de las
convocatorias ordinaria y extraordinaria, ordenados por asignatura y año.

La web está en **<https://elioxy.github.io/WebPAU>**.

Es estática y gratuita, sin cuentas ni registro: se entra, se filtra por
asignatura, año, convocatoria, fase o tipo de documento, y el PDF **se abre en
el visor del navegador** en vez de empezar a descargarse. Y cualquier vista se
puede compartir: el estado de los filtros vive en la URL.

Detrás no hay base de datos ni servidor que mantener. El catálogo (un JSON) y
los PDF viven **dentro de este repositorio**, así que GitHub hace de base de
datos y de histórico —cada publicación es un commit y se puede revertir—, y el
panel de administración es **una página más del propio sitio**, que habla con la
API de GitHub desde el navegador. Por eso se puede subir un examen desde el
móvil, sin instalar nada.

## Para qué sirve

- **Estudiar con exámenes reales.** Repetir los ejercicios que ya han caído, por
  asignatura y por año, en lugar de con modelos inventados.
- **Entender cómo se puntúa.** Cada enunciado tiene al lado sus soluciones y sus
  criterios de corrección, que es lo que de verdad cambia la nota.
- **Preparar la convocatoria que toca.** Separar lo que es fase de acceso de lo
  que es fase de admisión, y lo ordinario de lo extraordinario.
- **Compartir exactamente lo que buscas.** Cualquier vista filtrada tiene su
  URL: se pega en un grupo de clase y el otro ve lo mismo.
- **Publicar sin montar nada.** Quien mantiene el archivo sube los PDF desde el
  panel y la web se reconstruye sola; no hay servidor ni base de datos que
  administrar.
- **No perder el archivo.** Al ser commits, un borrado accidental se deshace con
  `git revert`, y queda constancia de cuándo entró cada documento.

## Cómo se publica

```
┌────────────────────┐   un commit con   ┌───────────────┐   recompila   ┌──────────┐
│  Panel (en la web) │ ─── PDF + JSON ─▶ │  El repo      │ ────────────▶ │  GitHub  │
│  /WebPAU/admin     │                   │  data/*.json  │               │  Pages   │
└────────────────────┘                   │  public/exams │               │  (web)   │
                                         └───────────────┘               └──────────┘
```

La web se publica en **GitHub Pages** sin coste: el workflow
`.github/workflows/deploy.yml` reconstruye el sitio en cada push que toque
`src/`, `data/` o `public/` (1–2 minutos).

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

### Qué documentos guarda

| Tipo | Qué es |
| --- | --- |
| **Enunciado** | El examen que se reparte en el aula. |
| **Soluciones** | Las respuestas oficiales del tribunal. |
| **Criterios** | Cómo se puntúa cada pregunta, con la rúbrica. |
| **Hoja** | La plantilla de respuestas (OMR) en blanco. |

Los documentos oficiales se marcan como tales; si algo está reconstruido o
procede de otra fuente, la fila lo advierte con **no oficial** en rojo.

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
| `npm run dev` | Sitio público y panel en <http://localhost:4321> |
| `npm run build` | Genera el sitio estático en `dist/` |
| `npm run preview` | Sirve `dist/` como lo hará GitHub Pages |
| `npm run check` | Comprobación de tipos de Astro y TypeScript |

El panel vive en **`/admin`** —en local,
<http://localhost:4321/WebPAU/admin>— y no necesita ningún comando aparte.

## Subir exámenes

Entra en <https://elioxy.github.io/WebPAU/admin> desde cualquier dispositivo
—el móvil vale— y pega tu **token de GitHub**.

1. Arrastra los PDF (puedes soltar varios a la vez).
2. Elige **asignatura**, **año**, **convocatoria**, **tipo** y, si quieres,
   idioma, notas y si el documento es oficial.
3. «Publicar».

El PDF y el catálogo viajan juntos en **un único commit**, y la acción
**Deploy** de `.github/workflows/deploy.yml` recompila la web sola (1–2
minutos). Cuando termina, el documento ya está en línea.

### El token

El panel no tiene login propio: la autenticación es un **token *fine-grained*
de GitHub**, limitado a este repositorio y con permiso **Contents: Read and
write**. Créalo en
<https://github.com/settings/personal-access-tokens/new> (el propio panel te
recuerda los tres ajustes).

> **Se guarda en el navegador.** El panel lo deja en `localStorage` de ese
dispositivo para no pedírtelo cada vez. Si lo usas en un ordenador compartido,
pulsa «Salir» al terminar; y si pierdes el dispositivo, revócalo desde GitHub.
> Al estar limitado a un repositorio y a contenidos, el alcance del daño es
> pequeño, pero no es un token que convenga dejar suelto.

### Editar y borrar

Desde la tabla puedes corregir cualquier campo de un documento ya subido o
eliminarlo; en ese caso el commit borra también su PDF del repositorio. Las
acciones se bloquean mientras hay una publicación en marcha, para no escribir
un catálogo viejo que resucitaría registros ya borrados.

La tabla marca con **falta el PDF** los registros cuyo archivo no está en la
rama, y el filtro «Solo sin PDF» los agrupa: es lo que verás si editas
`exams.json` a mano o si algo dejó el catálogo y los archivos descuadrados.

Si borras algo por error, `git revert` del commit correspondiente lo devuelve
todo.

### Añadir una asignatura nueva

Edita `data/subjects.json`, haz commit y espera a que Pages reconstruya: el
panel lee el catálogo de la rama cada vez que se abre. Cada asignatura necesita:

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
  lib/catalog.ts     tipos y lectura del catálogo (solo Node)
  lib/github.ts      cliente de la API de GitHub (navegador)
  lib/slug.ts        slug e id de archivo, compartidos con el panel
  pages/index.astro  la web pública
  pages/admin.astro  el panel
  scripts/archive.ts filtrado de la web pública
  scripts/admin.ts   lógica del panel: subida, edición y commits
  styles/global.css  el sistema visual de la web
  styles/admin.css   el del panel
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

- **El PDF se abre, no se descarga.** El botón «Ver» de cada fila (y el título)
  abren el documento en el visor del navegador, en otra pestaña, para poder
  leerlo sin pasar por la carpeta de descargas.
- **Tema claro / oscuro.** Se elige automáticamente según el sistema y puedes
  cambiarlo con el botón flotante; la preferencia se guarda en el navegador, y
  el cambio se funde en vez de dar un salto.
- **Atajo `/`.** Enfoca el buscador al instante. `Esc` lo desenfoca.
- **Volver arriba.** Aparece un botón flotante al bajar por la página.
- **Móvil.** Las filas se apilan y los cinco tipos de documento pasan a una
  rejilla de dos columnas, sin nada que se salga de la pantalla.
- **Movimiento discreto.** Cada pieza entra o se reordena en menos de medio
  segundo, con opacidad y desplazamiento; con «reducir movimiento» del sistema
  no se anima nada.
- Cuando el archivo está vacío, la web oculta los filtros y muestra un estado
  de bienvenida con acceso al repositorio.

## Notas prácticas

- **Tamaño del repositorio.** Cada PDF aumenta el tamaño del repo para siempre
  (Git guarda el histórico). Con ~300 documentos de 1–2 MB el repo se queda
  alrededor de 400–600 MB. GitHub Pages admite 1 GB por sitio. Si te acercas al
  límite, sirve los PDF desde otro sitio (un bucket, un CDN) y guarda en
  `exams.json` solo la URL externa.
- **Sin base de datos ni servidor.** El panel se sirve como una página estática
  más y habla con la API de GitHub desde el navegador: no hay nada encendido,
  ni en tu máquina ni en la nube. A cambio, «borrar» es un commit y no un
  `DELETE`, y publicar obliga a que Pages recompile (1–2 minutos).
- **PDF muy grandes.** La API de blobs de GitHub obliga a codificar el archivo
  en base64 en memoria del navegador; por encima de unos 50 MB puede quedarse
  sin aire. Para escaneos enormes, súbelos por `git` a mano y añade la entrada
  a `data/exams.json`.
- **Primera publicación.** En GitHub: *Settings → Pages → Source → GitHub
  Actions*. Las ejecuciones siguientes ya se lanzan solas.
- **Dominio propio.** Si lo añades, define `SITE_URL` y `SITE_BASE=/` en el
  workflow y ajusta `site` en `astro.config.mjs`.

## Legal

Los documentos son obra de los organismos que los emiten. WebPAU solo los reúne
y los hace accesibles. Si eres titular de alguno y prefieres que no se difunda,
abre un issue y se retira.
