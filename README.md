# Capitular

Juego diario de acrósticos en español. Cada día hay tres acrósticos (Fácil, Medio y Difícil): resuelve las definiciones y sus iniciales, leídas de arriba abajo, forman la palabra del día.

Es una PWA estática (HTML, CSS y JavaScript sin frameworks ni compilación) pensada para GitHub Pages.

## Estructura

| Archivo | Qué es |
|---|---|
| `index.html` | La página del juego |
| `styles.css` | Estilos (paleta del logo; tema luminoso por defecto y oscuro a elegir en la ayuda) |
| `app.js` | Lógica del juego, guardado y estadísticas |
| `partidas.json` | Las partidas, una por día |
| `manifest.webmanifest` | Manifiesto de la PWA |
| `sw.js` | Service worker para jugar sin conexión |
| `icons/` | Logo e iconos |
| `scripts/validar.js` | Comprueba `partidas.json` |

## Probar en local

Hace falta un servidor, porque el juego carga `partidas.json` con `fetch`:

```sh
python3 -m http.server 8000
```

Y abre <http://localhost:8000>.

- **Forzar la fecha:** `http://localhost:8000/?fecha=2026-10-25`. Solo funciona en local o en la red de casa (`localhost`, `192.168.x.x`, `10.x.x.x`, `*.local`), nunca en la web publicada. Con la fecha forzada, el progreso se guarda aparte (`capitular-dev`) para no mezclarlo con tus partidas reales.
- **Simular una racha:** añade `&racha=3` a la fecha forzada (`?fecha=2026-10-25&racha=3`) para dar por completados en su día los tres días anteriores.
- **Probar desde el móvil:** abre `http://<IP-del-ordenador>:8000/?fecha=2026-10-25` con el móvil en la misma wifi.
- **Service worker:** en local no se registra (para no servir archivos viejos mientras desarrollas). Para probarlo, añade `?sw` a la URL.
- **Volver a ver la ayuda inicial:** borra los datos del sitio, o en la consola `localStorage.clear()`.

## Añadir días nuevos

1. Añade un objeto por día al final de `partidas.json`:

   ```json
   {
     "fecha": "2026-10-29",
     "niveles": {
       "facil":   { "palabra": "…", "pista": "…", "filas": [ { "definicion": "…", "pista": "…", "respuesta": "…" } ] },
       "medio":   { … },
       "dificil": { … }
     }
   }
   ```

   - Hay una fila por letra de la palabra del día, y la respuesta de cada fila empieza por esa letra.
   - Respuestas en mayúsculas, con sus tildes y sin espacios (`LÁPIZ`, `AÑICOS`). Al jugar no se distinguen las tildes, pero la Ñ sí cuenta como letra distinta de la N.
   - La `pista` de cada fila es la segunda definición, más fácil, que aparece tras dos fallos.
   - El campo `efemeride` es opcional: el juego no lo muestra. Si lo pones, solo tiene que ser un texto (te sirve como nota del tema del día).

2. Valida:

   ```sh
   node scripts/validar.js
   ```

   Comprueba que las iniciales formen la palabra, que no haya fechas repetidas y que ninguna respuesta se repita entre días. Si sale algún `✗`, corrígelo antes de publicar.

3. Sube la versión de la caché en `sw.js` (`capitular-v1` → `capitular-v2`) y publica.

La partida del día se elige por la fecha de **Madrid** y cambia a medianoche peninsular. Si un día no tiene partida, el juego lo dice y ofrece las anteriores.

## Publicar en GitHub Pages

1. Sube el repositorio a GitHub.
2. En **Settings → Pages**, en *Source* elige **Deploy from a branch**, rama `main` y carpeta `/ (root)`.
3. En un par de minutos estará en `https://<usuario>.github.io/Capitular/`.

Todas las rutas son relativas, así que funciona igual en un subdirectorio de GitHub Pages que en un dominio propio.

**En cada despliegue sube `VERSION` en `sw.js`**; si no, quien ya tenga el juego instalado seguirá viendo los archivos antiguos (las partidas nuevas sí se descargan siempre, porque `partidas.json` va con red primero).

## Guardado

Todo se guarda en el navegador (`localStorage`): el progreso a medias, los resultados y las estadísticas. Las rachas solo cuentan las partidas terminadas el mismo día; las del archivo suman a las estadísticas pero no a las rachas.
