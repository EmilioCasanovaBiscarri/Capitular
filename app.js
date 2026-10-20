'use strict';

/* Capitular · juego diario de acrósticos */

const NIVELES = [
  { id: 'facil', nombre: 'Fácil' },
  { id: 'medio', nombre: 'Medio' },
  { id: 'dificil', nombre: 'Difícil' },
];
const MAX_LETRAS = 2;
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- Texto ---------- */

const letras = (s) => Array.from(String(s).normalize('NFC'));

// Mayúsculas y sin tildes, pero la Ñ se conserva.
function normalizar(s) {
  return String(s).normalize('NFC').toUpperCase()
    .replace(/Ñ/g, '\u0001')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'Ñ');
}

const soloLetras = (s) => letras(String(s).normalize('NFC').toUpperCase()).filter((c) => /\p{L}/u.test(c));

/* ---------- Fechas (Europe/Madrid) ---------- */

const params = new URLSearchParams(location.search);
const esDesarrollo = location.protocol === 'file:' ||
  /^(localhost|127\.0\.0\.1|\[::1\]|10(\.\d+){3}|192\.168(\.\d+){2}|.+\.local)$/.test(location.hostname);
// ?fecha=AAAA-MM-DD solo funciona en desarrollo (localhost o red local).
const fechaForzada = esDesarrollo && /^\d{4}-\d{2}-\d{2}$/.test(params.get('fecha') || '') ? params.get('fecha') : null;

function partesMadrid(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(fecha);
  return Object.fromEntries(partes.map((p) => [p.type, p.value]));
}

function fechaMadrid() {
  if (fechaForzada) return fechaForzada;
  const p = partesMadrid();
  return `${p.year}-${p.month}-${p.day}`;
}

function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fechaCorta(fecha) {
  const [, m, d] = fecha.split('-').map(Number);
  return `${d} ${MESES[m - 1]}`;
}

function fechaLarga(fecha) {
  const texto = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date(`${fecha}T12:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/* ---------- Guardado ---------- */

const CLAVE = fechaForzada ? 'capitular-dev' : 'capitular';

function cargar() {
  try {
    const s = JSON.parse(localStorage.getItem(CLAVE));
    if (s && typeof s === 'object' && s.dias && typeof s.dias === 'object') return s;
  } catch { /* sin almacenamiento */ }
  return { dias: {}, ayudaVista: false };
}

function guardar() {
  try { localStorage.setItem(CLAVE, JSON.stringify(store)); } catch { /* sin almacenamiento */ }
}

/* ---------- Estado ---------- */

let partidas = [];
const porFecha = new Map();
const store = cargar();
let hoy = fechaMadrid();
const vista = { fecha: null, nivel: 'facil', activa: null, cursor: -1 }; // cursor: casilla de la fila activa
const vuelos = new Set(); // casillas de la franja con una letra en camino

const partida = (fecha = vista.fecha) => porFecha.get(fecha);
const defNivel = (nivel = vista.nivel, fecha = vista.fecha) => partida(fecha).niveles[nivel];
const defFila = (i) => defNivel().filas[i];

function nuevoNivel(def) {
  return {
    filas: def.filas.map(() => ({ entrada: '', fijas: [], fallos: 0, ayuda: false, estado: 'pendiente' })),
    letras: 0,
    adivinanza: null, // null | 'acierto' | 'fallo'
    estrella: null,   // { faltaban: n }
    terminado: false,
    enDia: false,     // terminado el mismo día de la partida (cuenta para rachas)
  };
}

function estNivel(nivel = vista.nivel, fecha = vista.fecha) {
  const def = defNivel(nivel, fecha);
  const dia = store.dias[fecha] || (store.dias[fecha] = { niveles: {} });
  let e = dia.niveles[nivel];
  if (!e || !Array.isArray(e.filas) || e.filas.length !== def.filas.length) {
    e = dia.niveles[nivel] = nuevoNivel(def);
  }
  return e;
}
const estFila = (i) => estNivel().filas[i];

const terminado = (nivel, fecha = vista.fecha) => !!store.dias[fecha]?.niveles?.[nivel]?.terminado;

// Letras visibles en las casillas de una fila.
function celdas(def, e) {
  const sol = letras(def.respuesta);
  if (e.estado !== 'pendiente') return sol;
  const ent = letras(e.entrada);
  let k = 0;
  return sol.map((c, p) => (e.fijas.includes(p) ? c : (ent[k++] || '').trim()));
}

// Posiciones de las casillas en las que se puede escribir (las no reveladas).
const abiertas = (def, e) => letras(def.respuesta).map((_, p) => p).filter((p) => !e.fijas.includes(p));

// Guarda las letras de las casillas abiertas; un espacio marca una casilla vacía.
function componer(def, e, cs) {
  e.entrada = abiertas(def, e).map((p) => cs[p] || ' ').join('').trimEnd();
}

// Fija (revela) la letra de la posición p sin descolocar lo ya escrito.
function fijar(def, e, p) {
  if (e.fijas.includes(p)) return;
  const cs = celdas(def, e);
  e.fijas.push(p);
  componer(def, e, cs);
}

// Dónde se pone el cursor al entrar en una fila: la primera casilla vacía o, si no hay, la última.
function cursorInicial(def, e) {
  const cs = celdas(def, e);
  const ps = abiertas(def, e);
  return ps.find((p) => !cs[p]) ?? ps[ps.length - 1] ?? -1;
}

// La casilla abierta más cercana a p hacia la derecha (dir = 1) o la izquierda (dir = -1), o -1.
function vecina(def, e, p, dir) {
  const ps = abiertas(def, e);
  return (dir > 0 ? ps.find((q) => q > p) : ps.findLast((q) => q < p)) ?? -1;
}

function inicialArriba(i, n = estNivel()) {
  const f = n.filas[i];
  return n.adivinanza === 'acierto' || f.estado !== 'pendiente' || f.fijas.includes(0);
}

function colorFila(f) {
  if (f.estado === 'rendida') return '🟥';
  if (f.estado === 'resuelta') return f.fallos || f.ayuda ? '🟨' : '🟩';
  return '⬜';
}

/* ---------- Elementos ---------- */

const el = {
  avisoArchivo: $('#aviso-archivo'),
  avisoArchivoTexto: $('#aviso-archivo-texto'),
  juego: $('#juego'),
  vacio: $('#vacio'),
  vacioTexto: $('#vacio-texto'),
  pestanas: $('#pestanas'),
  franja: $('#franja'),
  franjaCasillas: $('#franja-casillas'),
  franjaPista: $('#franja-pista'),
  franjaNota: $('#franja-nota'),
  filas: $('#filas'),
  toast: $('#toast'),
};

const filaEl = (i) => el.filas.children[i];

/* ---------- Avisos ---------- */

let temporizadorToast;
function avisar(texto, ms = 2200) {
  el.toast.textContent = texto;
  el.toast.classList.add('visible');
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => el.toast.classList.remove('visible'), ms);
}

function animarClase(nodo, clase, ms) {
  nodo.classList.remove(clase);
  void nodo.offsetWidth;
  nodo.classList.add(clase);
  setTimeout(() => nodo.classList.remove(clase), ms);
}

// Lleva una letra desde una casilla hasta otra (la inicial que sube a la franja).
function volar(desde, hacia, letra) {
  if (reducido() || !desde.isConnected || !hacia.isConnected) return Promise.resolve();
  const a = desde.getBoundingClientRect();
  const b = hacia.getBoundingClientRect();
  const v = document.createElement('span');
  v.className = 'volador';
  v.textContent = letra;
  Object.assign(v.style, {
    left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`,
    fontSize: `${a.height * 0.5}px`,
  });
  (desde.closest('dialog') || document.body).appendChild(v);
  const escala = b.width / a.width;
  const anim = v.animate([
    { transform: 'translate(0, 0) scale(1)' },
    { transform: `translate(${(b.left - a.left) * 0.5}px, ${b.top - a.top - 24}px) scale(${(1 + escala) / 2})`, offset: 0.6 },
    { transform: `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(${escala})` },
  ], { duration: 650, easing: 'cubic-bezier(.45, 0, .25, 1)' });
  return new Promise((res) => {
    anim.onfinish = anim.oncancel = () => { v.remove(); res(); };
  });
}

async function subirInicial(i) {
  const desde = filaEl(i)?.querySelector('.c');
  const hacia = el.franjaCasillas.children[i];
  if (!desde || !hacia) return;
  vuelos.add(i);
  pintarFranja();
  await volar(desde, hacia, letras(defNivel().palabra)[i]);
  vuelos.delete(i);
  pintarFranja();
  if (hacia.isConnected) animarClase(hacia, 'pop', 400);
}

/* ---------- Pintado ---------- */

function mostrar() {
  const p = partida();
  const esHoy = vista.fecha === hoy;

  el.avisoArchivo.hidden = esHoy || !p;
  if (p && !esHoy) el.avisoArchivoTexto.textContent = `Partida del ${fechaCorta(vista.fecha)} (archivo)`;

  if (!p) {
    el.juego.hidden = true;
    el.vacio.hidden = false;
    const hayAnteriores = partidas.some((x) => x.fecha < hoy);
    el.vacioTexto.textContent = hayAnteriores
      ? 'Vuelve mañana. Mientras tanto, puedes jugar las de días anteriores.'
      : 'Vuelve mañana.';
    $('#vacio-archivo').hidden = !hayAnteriores;
    return;
  }

  el.vacio.hidden = true;
  el.juego.hidden = false;
  pintarPestanas();
  montarNivel();
}

function pintarPestanas() {
  el.pestanas.replaceChildren(...NIVELES.map(({ id, nombre }, idx) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pestana';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-controls', 'panel');
    b.setAttribute('aria-selected', String(id === vista.nivel));
    b.tabIndex = id === vista.nivel ? 0 : -1;
    const hecho = terminado(id);
    b.textContent = nombre + (hecho ? ' ✓' : '');
    b.setAttribute('aria-label', `${nombre}${hecho ? ', terminado' : ''}`);
    b.addEventListener('click', () => elegirPestana(idx));
    return b;
  }));
}

function elegirPestana(idx) {
  const { id } = NIVELES[idx];
  if (id === vista.nivel) return;
  vista.nivel = id;
  pintarPestanas();
  montarNivel();
}

el.pestanas.addEventListener('keydown', (ev) => {
  if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
  const actual = NIVELES.findIndex((n) => n.id === vista.nivel);
  const dir = ev.key === 'ArrowRight' ? 1 : -1;
  const sig = (actual + dir + NIVELES.length) % NIVELES.length;
  elegirPestana(sig);
  el.pestanas.children[sig].focus();
});

function montarNivel() {
  const def = defNivel();
  vista.activa = null;
  vuelos.clear();

  const n = letras(def.palabra).length;
  el.franjaCasillas.replaceChildren(...Array.from({ length: n }, () => {
    const s = document.createElement('span');
    s.className = 'c';
    s.style.setProperty('--n', n);
    return s;
  }));
  el.franjaPista.textContent = def.pista;

  el.filas.replaceChildren(...def.filas.map(crearFila));
  def.filas.forEach((_, i) => pintarFila(i));
  pintarFranja();
}

function crearFila(f, i) {
  const n = letras(f.respuesta).length;
  const li = document.createElement('li');
  li.className = 'fila';
  li.dataset.i = i;
  li.innerHTML = `
    <div class="fila-cab">
      <span class="fila-num" aria-hidden="true">${i + 1}</span>
      <p class="fila-def" id="def-${i}"></p>
      <span class="fila-estado"></span>
    </div>
    <p class="fila-pista" id="pista-${i}" hidden></p>
    <div class="casillas${n > 10 ? ' larga' : ''}">
      ${'<span class="c" aria-hidden="true"></span>'.repeat(n)}
      <input class="entrada" type="text" autocomplete="off" autocorrect="off" autocapitalize="characters"
        spellcheck="false" enterkeyhint="go" aria-describedby="def-${i} pista-${i}">
    </div>
    <div class="acciones">
      <button type="button" class="btn btn-primario" data-accion="comprobar">Comprobar</button>
      <button type="button" class="btn" data-accion="letra"></button>
      <button type="button" class="btn" data-accion="inicial">Inicial</button>
      <button type="button" class="btn" data-accion="rendirse">Rendirse</button>
    </div>`;
  $('.fila-def', li).textContent = f.definicion;
  $('.fila-pista', li).textContent = f.pista;
  $$('.c', li).forEach((c) => c.style.setProperty('--n', n));
  $('.entrada', li).setAttribute('aria-label', `Fila ${i + 1}, ${n} letras`);
  return li;
}

function pintarFila(i) {
  const li = filaEl(i);
  if (!li) return;
  const def = defFila(i);
  const n = estNivel();
  const e = n.filas[i];
  const pendiente = e.estado === 'pendiente';
  const cs = celdas(def, e);
  const activa = vista.activa === i && pendiente;
  if (activa && (vista.cursor < 0 || e.fijas.includes(vista.cursor))) vista.cursor = cursorInicial(def, e);
  const cursor = activa ? vista.cursor : -1;

  $$('.c', li).forEach((s, p) => {
    s.textContent = cs[p];
    s.classList.toggle('inicial', p === 0);
    s.classList.toggle('fija', pendiente && e.fijas.includes(p));
    s.classList.toggle('cursor', p === cursor);
  });

  li.classList.toggle('resuelta', e.estado === 'resuelta');
  li.classList.toggle('rendida', e.estado === 'rendida');
  li.classList.toggle('activa', vista.activa === i);

  const estado = $('.fila-estado', li);
  estado.textContent = pendiente ? '' : colorFila(e);
  estado.setAttribute('aria-label', e.estado === 'rendida' ? 'Rendida'
    : e.estado === 'resuelta' ? (e.fallos || e.ayuda ? 'Resuelta con fallos o ayudas' : 'Resuelta a la primera') : '');
  estado.setAttribute('role', pendiente ? 'none' : 'img');

  $('.fila-pista', li).hidden = e.fallos < 2;

  const input = $('.entrada', li);
  input.disabled = !pendiente;
  const valor = pendiente ? VACIO : '';
  if (input.value !== valor) input.value = valor;
  if (!pendiente) input.setAttribute('aria-label', `Fila ${i + 1}: ${def.respuesta}, ${e.estado}`);

  const quedan = MAX_LETRAS - n.letras;
  const bLetra = $('[data-accion="letra"]', li);
  bLetra.textContent = `Letra (${quedan})`;
  bLetra.disabled = quedan <= 0;
  bLetra.setAttribute('aria-label', `Revelar letra, quedan ${quedan}`);
  const bInicial = $('[data-accion="inicial"]', li);
  bInicial.disabled = e.fijas.includes(0);
  bInicial.setAttribute('aria-label', 'Revelar inicial');
}

function pintarFranja() {
  const def = defNivel();
  const n = estNivel();
  const ls = letras(def.palabra);
  [...el.franjaCasillas.children].forEach((s, i) => {
    const visible = inicialArriba(i, n) && !vuelos.has(i);
    s.textContent = visible ? ls[i] : '';
    s.classList.toggle('llena', visible);
  });

  const puede = !n.terminado && n.adivinanza === null;
  el.franja.disabled = !puede;
  const conocidas = ls.map((c, i) => (inicialArriba(i, n) ? c : '_')).join(' ');
  el.franja.setAttribute('aria-label', `Palabra del día, ${ls.length} letras: ${conocidas}.${puede ? ' Toca para adivinarla.' : ''}`);

  if (n.adivinanza === 'acierto') {
    el.franjaNota.textContent = `⭐ ¡Adivinada con ${n.estrella.faltaban} ${n.estrella.faltaban === 1 ? 'fila' : 'filas'} por resolver!`;
  } else if (n.adivinanza === 'fallo') {
    el.franjaNota.textContent = 'Sin bonus de intuición en este nivel';
  } else if (!n.terminado) {
    el.franjaNota.textContent = 'Toca la franja para adivinar la palabra';
  } else {
    el.franjaNota.textContent = '';
  }
}

/* ---------- Interacción con las filas ---------- */

function activar(i, enfocar) {
  const e = estFila(i);
  if (e.estado !== 'pendiente') return;
  if (vista.activa !== i) {
    const anterior = vista.activa;
    vista.activa = i;
    vista.cursor = cursorInicial(defFila(i), e);
    if (anterior !== null) pintarFila(anterior);
    pintarFila(i);
    filaEl(i).scrollIntoView({ block: 'nearest', behavior: reducido() ? 'auto' : 'smooth' });
  }
  const input = $('.entrada', filaEl(i));
  if (enfocar && document.activeElement !== input) input.focus({ preventScroll: true });
  alFinal(input);
}

function alFinal(input) {
  const fin = input.value.length;
  try { input.setSelectionRange(fin, fin); } catch { /* algunos tipos no lo admiten */ }
}

function siguientePendiente(desde) {
  const filas = estNivel().filas;
  for (let k = 1; k <= filas.length; k++) {
    const j = (desde + k) % filas.length;
    if (filas[j].estado === 'pendiente') { activar(j, true); return; }
  }
  const anterior = vista.activa;
  vista.activa = null;
  if (anterior !== null) pintarFila(anterior);
  document.activeElement?.blur();
}

// El <input> solo guarda este espacio: si desaparece es que se ha borrado, y lo que llegue
// además son letras nuevas. Las letras de verdad viven en las casillas.
const VACIO = ' ';

function leerEntrada(i) {
  const input = $('.entrada', filaEl(i));
  const valor = input.value;
  input.value = VACIO;
  if (estFila(i).estado !== 'pendiente') return;
  if (valor.length < VACIO.length) borrar(i, true);
  else for (const c of soloLetras(valor)) escribir(i, c);
  guardar();
  pintarFila(i);
}

// Escribe en la casilla del cursor y avanza: a la siguiente vacía (o a la primera vacía
// que quede antes) y, si ya no hay vacías, a la casilla de al lado.
function escribir(i, letra) {
  const def = defFila(i);
  const e = estFila(i);
  const p = vista.cursor;
  if (p < 0 || e.fijas.includes(p)) return;
  const cs = celdas(def, e);
  cs[p] = letra;
  componer(def, e, cs);
  const ps = abiertas(def, e);
  vista.cursor = ps.find((q) => q > p && !cs[q]) ?? ps.find((q) => !cs[q]) ?? ps.find((q) => q > p) ?? p;
}

// Borra la letra del cursor; con la tecla de borrar, si la casilla ya está vacía, la de la izquierda.
function borrar(i, atras) {
  const def = defFila(i);
  const e = estFila(i);
  let p = vista.cursor;
  if (p < 0) return;
  const cs = celdas(def, e);
  if (atras && !cs[p]) {
    p = vecina(def, e, p, -1);
    if (p < 0) return;
  }
  cs[p] = '';
  vista.cursor = p;
  componer(def, e, cs);
}

function moverCursor(i, dir) {
  const q = vecina(defFila(i), estFila(i), vista.cursor, dir);
  if (q < 0) return;
  vista.cursor = q;
  pintarFila(i);
}

// Al tocar una casilla revelada, el cursor va a la abierta de su derecha (o de su izquierda).
function elegirCasilla(i, p) {
  const def = defFila(i);
  const e = estFila(i);
  if (e.estado !== 'pendiente') return;
  if (e.fijas.includes(p)) {
    const derecha = vecina(def, e, p, 1);
    p = derecha >= 0 ? derecha : vecina(def, e, p, -1);
  }
  if (p < 0) return;
  vista.cursor = p;
  pintarFila(i);
}

// Las casillas quedan debajo del <input>, así que se mira en cuál cae la x del toque.
function casillaEn(li, x) {
  const cs = $$('.c', li);
  const k = cs.findIndex((c) => x < c.getBoundingClientRect().right);
  return k < 0 ? cs.length - 1 : k;
}

const correcta = (def, e) => {
  const cs = celdas(def, e);
  return cs.every(Boolean) && normalizar(cs.join('')) === normalizar(def.respuesta);
};

function comprobar(i) {
  const def = defFila(i);
  const e = estFila(i);
  if (e.estado !== 'pendiente') return;
  if (celdas(def, e).some((c) => !c)) {
    avisar('Faltan letras');
    return;
  }
  if (correcta(def, e)) {
    resolver(i);
    return;
  }
  e.fallos++;
  guardar();
  pintarFila(i);
  animarClase(filaEl(i), 'tiembla', 500);
  avisar(e.fallos === 2 ? 'No es correcta. Tienes otra pista.' : 'No es correcta');
}

function resolver(i) {
  const e = estFila(i);
  const antes = inicialArriba(i);
  e.estado = 'resuelta';
  e.entrada = '';
  guardar();
  pintarFila(i);
  if (!antes) subirInicial(i); else pintarFranja();
  avisar(e.fallos || e.ayuda ? '¡Correcta!' : '¡Correcta a la primera!');
  siguientePendiente(i);
  comprobarFin();
}

function rendirse(i) {
  const e = estFila(i);
  if (e.estado !== 'pendiente') return;
  const antes = inicialArriba(i);
  e.estado = 'rendida';
  e.entrada = '';
  guardar();
  pintarFila(i);
  if (!antes) subirInicial(i); else pintarFranja();
  siguientePendiente(i);
  comprobarFin();
}

function revelarLetra(i) {
  const n = estNivel();
  const def = defFila(i);
  const e = n.filas[i];
  if (e.estado !== 'pendiente' || n.letras >= MAX_LETRAS) return;
  const sol = letras(def.respuesta);
  const cs = celdas(def, e);
  const p = sol.findIndex((c, q) => !e.fijas.includes(q) && normalizar(cs[q]) !== normalizar(c));
  if (p < 0) {
    avisar('Lo que has escrito está bien: pulsa Comprobar');
    return;
  }
  const antes = inicialArriba(i);
  fijar(def, e, p);
  e.ayuda = true;
  n.letras++;
  guardar();
  n.filas.forEach((_, j) => pintarFila(j)); // el contador de letras es común a todo el nivel
  if (!antes && inicialArriba(i)) subirInicial(i);
  if (correcta(def, e)) resolver(i);
}

function revelarInicial(i) {
  const def = defFila(i);
  const e = estFila(i);
  if (e.estado !== 'pendiente' || e.fijas.includes(0)) return;
  const antes = inicialArriba(i);
  fijar(def, e, 0);
  e.ayuda = true;
  guardar();
  pintarFila(i);
  if (!antes) subirInicial(i);
  if (correcta(def, e)) resolver(i);
}

let temporizadorRendirse;
function pedirRendirse(i, boton) {
  if (boton.classList.contains('confirmar')) {
    clearTimeout(temporizadorRendirse);
    boton.classList.remove('confirmar');
    boton.textContent = 'Rendirse';
    rendirse(i);
    return;
  }
  boton.classList.add('confirmar');
  boton.textContent = '¿Seguro?';
  clearTimeout(temporizadorRendirse);
  temporizadorRendirse = setTimeout(() => {
    boton.classList.remove('confirmar');
    boton.textContent = 'Rendirse';
  }, 3000);
}

const indiceDe = (nodo) => Number(nodo.closest('.fila')?.dataset.i);

el.filas.addEventListener('click', (ev) => {
  const i = indiceDe(ev.target);
  if (Number.isNaN(i)) return;
  const boton = ev.target.closest('[data-accion]');
  if (!boton) {
    activar(i, true);
    // ev.detail es 0 cuando el clic no viene de un toque o del ratón
    if (ev.target.classList.contains('entrada') && ev.detail) elegirCasilla(i, casillaEn(filaEl(i), ev.clientX));
    return;
  }
  switch (boton.dataset.accion) {
    case 'comprobar': comprobar(i); break;
    case 'letra': revelarLetra(i); break;
    case 'inicial': revelarInicial(i); break;
    case 'rendirse': pedirRendirse(i, boton); break;
  }
});

// Que los botones de la fila no quiten el foco al <input> (así no se cierra el teclado del móvil).
el.filas.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest('[data-accion]') && document.activeElement?.classList.contains('entrada')) ev.preventDefault();
});

el.filas.addEventListener('focusin', (ev) => {
  if (ev.target.classList.contains('entrada')) activar(indiceDe(ev.target), false);
});

el.filas.addEventListener('input', (ev) => {
  if (!ev.target.classList.contains('entrada') || ev.isComposing) return;
  leerEntrada(indiceDe(ev.target));
});

el.filas.addEventListener('compositionend', (ev) => {
  if (ev.target.classList.contains('entrada')) leerEntrada(indiceDe(ev.target));
});

el.filas.addEventListener('keydown', (ev) => {
  if (!ev.target.classList.contains('entrada')) return;
  const i = indiceDe(ev.target);
  if (ev.key === 'Enter') {
    ev.preventDefault();
    comprobar(i);
  } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
    ev.preventDefault();
    moverCursor(i, ev.key === 'ArrowRight' ? 1 : -1);
  } else if (ev.key === 'Delete') {
    ev.preventDefault();
    borrar(i, false);
    guardar();
    pintarFila(i);
  }
});

// El cursor del <input> siempre al final, detrás del espacio; el que se ve es el de las casillas.
document.addEventListener('selectionchange', () => {
  const a = document.activeElement;
  if (a?.classList?.contains('entrada') && a.selectionStart !== a.value.length) alFinal(a);
});

/* ---------- Fin de nivel ---------- */

function comprobarFin() {
  const n = estNivel();
  if (n.terminado || n.filas.some((f) => f.estado === 'pendiente')) return;
  n.terminado = true;
  n.enDia = vista.fecha === hoy;
  guardar();
  pintarPestanas();
  pintarFranja();
  const nivel = vista.nivel;
  const fecha = vista.fecha;
  setTimeout(() => {
    if (!reducido()) animarClase(el.franja, 'destello', 1000);
  }, reducido() ? 0 : 700);
  setTimeout(() => abrirResumen(nivel, fecha), reducido() ? 400 : 1500);
}

/* ---------- Diálogos ---------- */

function abrir(dlg) {
  for (const d of $$('dialog[open]')) if (d !== dlg) d.close();
  if (!dlg.open) dlg.showModal();
}

document.addEventListener('click', (ev) => {
  const cerrar = ev.target.closest('[data-cerrar]');
  if (cerrar) cerrar.closest('dialog').close();
  // Clic en el fondo oscuro
  if (ev.target.tagName === 'DIALOG') {
    const r = ev.target.getBoundingClientRect();
    const fuera = ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom;
    if (fuera) ev.target.close();
  }
});

/* Adivinar la palabra del día */

const dlgAdivinar = $('#dlg-adivinar');
const entradaAdivinar = $('#adivinar-entrada');

el.franja.addEventListener('click', () => {
  const n = estNivel();
  if (n.terminado || n.adivinanza !== null) return;
  const def = defNivel();
  const ls = letras(def.palabra);
  $('#adivinar-patron').textContent = ls.map((c, i) => (inicialArriba(i, n) ? c : '_')).join('');
  $('#adivinar-pista').textContent = `${def.pista} · ${ls.length} letras`;
  $('#adivinar-error').textContent = '';
  entradaAdivinar.value = '';
  entradaAdivinar.maxLength = ls.length;
  abrir(dlgAdivinar);
  entradaAdivinar.focus();
});

$('#form-adivinar').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const def = defNivel();
  const n = estNivel();
  const intento = soloLetras(entradaAdivinar.value);
  const largo = letras(def.palabra).length;
  if (intento.length !== largo) {
    $('#adivinar-error').textContent = `La palabra tiene ${largo} letras`;
    return;
  }
  dlgAdivinar.close();
  if (n.terminado || n.adivinanza !== null) return;

  if (normalizar(intento.join('')) === normalizar(def.palabra)) {
    const subir = n.filas.map((_, i) => !inicialArriba(i, n));
    const pendientes = n.filas.map((f, i) => (f.estado === 'pendiente' ? i : -1)).filter((i) => i >= 0);
    n.adivinanza = 'acierto';
    n.estrella = { faltaban: pendientes.length };
    // Regalo: las iniciales de las filas pendientes se rellenan solas (no cuenta como ayuda).
    for (const i of pendientes) fijar(def.filas[i], n.filas[i], 0);
    guardar();
    n.filas.forEach((_, i) => pintarFila(i));
    pintarFranja();
    avisar('⭐ ¡Bien visto! Ahora tienes todas las iniciales.', 3000);
    subir.forEach((s, i) => { if (s) setTimeout(() => subirInicial(i), i * 90); });
    setTimeout(() => { if (!reducido()) animarClase(el.franja, 'destello', 1000); }, 800);
    if (vista.activa !== null) activar(vista.activa, true);
  } else {
    n.adivinanza = 'fallo';
    guardar();
    pintarFranja();
    animarClase(el.franja, 'tiembla', 500);
    avisar('No es esa. Pierdes el bonus ⭐, pero sigues jugando.', 3000);
  }
});

/* Resumen y compartir */

const dlgResumen = $('#dlg-resumen');
let resumenDe = null;

function abrirResumen(nivel, fecha) {
  if (!partida(fecha)) return;
  const def = defNivel(nivel, fecha);
  const n = estNivel(nivel, fecha);
  const idx = NIVELES.findIndex((x) => x.id === nivel);
  resumenDe = { nivel, fecha };

  $('#resumen-titulo').textContent = `${NIVELES[idx].nombre} completado`;
  $('#resumen-palabra').textContent = def.palabra;
  $('#resumen-filas').textContent = n.filas.map(colorFila).join('');
  $('#resumen-filas').setAttribute('aria-label', resumenFilasTexto(n));
  $('#resumen-estrella').textContent = n.estrella
    ? `⭐ Intuición: la adivinaste con ${n.estrella.faltaban} ${n.estrella.faltaban === 1 ? 'fila' : 'filas'} por resolver`
    : '';

  // El siguiente nivel pendiente del día, empezando por el de después.
  const orden = NIVELES.map((_, k) => (idx + 1 + k) % NIVELES.length);
  const sig = orden.find((k) => !terminado(NIVELES[k].id, fecha));
  resumenDe.siguiente = sig;
  const bSig = $('#resumen-siguiente');
  bSig.hidden = sig === undefined;
  if (sig !== undefined) bSig.textContent = `Jugar ${NIVELES[sig].nombre}`;
  abrir(dlgResumen);
}

function resumenFilasTexto(n) {
  const cuenta = (c) => n.filas.filter((f) => colorFila(f) === c).length;
  return `${cuenta('🟩')} a la primera, ${cuenta('🟨')} con ayuda, ${cuenta('🟥')} rendidas`;
}

function textoCompartir(fecha) {
  const lineas = [`Capitular · ${fechaCorta(fecha)}`];
  for (const { id, nombre } of NIVELES) {
    const n = store.dias[fecha]?.niveles?.[id];
    if (!n?.terminado) continue;
    lineas.push(`${nombre.padEnd(8)}${n.filas.map(colorFila).join('')}${n.estrella ? ' ⭐' : ''}`);
  }
  return lineas.join('\n');
}

async function compartir(fecha) {
  const text = textoCompartir(fecha);
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const t = document.createElement('textarea');
    t.value = text;
    t.setAttribute('readonly', '');
    t.style.position = 'fixed';
    t.style.opacity = '0';
    document.body.appendChild(t);
    t.select();
    try { document.execCommand('copy'); } catch { /* nada más que hacer */ }
    t.remove();
  }
  avisar('Resultado copiado al portapapeles');
}

$('#resumen-compartir').addEventListener('click', () => resumenDe && compartir(resumenDe.fecha));
$('#resumen-siguiente').addEventListener('click', () => {
  dlgResumen.close();
  if (resumenDe.fecha === vista.fecha && resumenDe.siguiente !== undefined) elegirPestana(resumenDe.siguiente);
});
$('#resumen-estadisticas').addEventListener('click', abrirEstadisticas);

/* Estadísticas */

const dlgEstadisticas = $('#dlg-estadisticas');
let temporizadorCuenta;

function rachas() {
  const fechas = partidas.map((p) => p.fecha).filter((f) => f <= hoy);
  const completoEnDia = (f, ids) => ids.every((id) => {
    const n = store.dias[f]?.niveles?.[id];
    return n?.terminado && n.enDia;
  });
  const calcular = (ids) => {
    let mejor = 0;
    let seguidas = 0;
    for (const f of fechas) {
      seguidas = completoEnDia(f, ids) ? seguidas + 1 : 0;
      mejor = Math.max(mejor, seguidas);
    }
    // La racha sigue viva si hoy aún no se ha jugado.
    let k = fechas.length - 1;
    if (fechas[k] === hoy && !completoEnDia(hoy, ids)) k--;
    let actual = 0;
    while (k >= 0 && completoEnDia(fechas[k], ids)) { actual++; k--; }
    return { actual, mejor };
  };
  return { diaria: calcular(['facil']), pleno: calcular(NIVELES.map((n) => n.id)) };
}

function estadisticas() {
  let jugadas = 0, plenos = 0, estrellas = 0, filas = 0, verdes = 0;
  for (const [fecha, dia] of Object.entries(store.dias)) {
    if (!porFecha.has(fecha)) continue;
    const niveles = NIVELES.map(({ id }) => dia.niveles?.[id]).filter((n) => n?.terminado);
    if (!niveles.length) continue;
    jugadas++;
    if (niveles.length === NIVELES.length) plenos++;
    for (const n of niveles) {
      if (n.estrella) estrellas++;
      filas += n.filas.length;
      verdes += n.filas.filter((f) => colorFila(f) === '🟩').length;
    }
  }
  return { jugadas, plenos, estrellas, verde: filas ? Math.round((verdes / filas) * 100) : 0 };
}

function cifra(valor, etiqueta, extra = '') {
  const d = document.createElement('div');
  d.innerHTML = '<dd></dd><dt></dt>';
  d.firstChild.textContent = valor;
  d.lastChild.textContent = etiqueta;
  if (extra) {
    const s = document.createElement('span');
    s.className = 'extra';
    s.textContent = extra;
    d.appendChild(s);
  }
  return d;
}

function abrirEstadisticas() {
  const s = estadisticas();
  const r = rachas();
  $('#cifras').replaceChildren(
    cifra(s.jugadas, 'Jugadas'),
    cifra(s.plenos, 'Plenos'),
    cifra(s.estrellas, 'Estrellas'),
    cifra(`${s.verde}%`, 'Filas en verde'),
  );
  $('#rachas').replaceChildren(
    cifra(r.diaria.actual, 'Racha diaria', `Mejor: ${r.diaria.mejor}`),
    cifra(r.pleno.actual, 'Racha de pleno', `Mejor: ${r.pleno.mejor}`),
  );
  pintarCuentaAtras();
  clearInterval(temporizadorCuenta);
  temporizadorCuenta = setInterval(pintarCuentaAtras, 1000);
  abrir(dlgEstadisticas);
}
dlgEstadisticas.addEventListener('close', () => clearInterval(temporizadorCuenta));

function pintarCuentaAtras() {
  const hayManana = partidas.some((p) => p.fecha > hoy);
  if (fechaForzada || !hayManana) { $('#cuenta-atras').textContent = ''; return; }
  const p = partesMadrid();
  const resto = 86400 - (Number(p.hour) * 3600 + Number(p.minute) * 60 + Number(p.second));
  const dos = (x) => String(x).padStart(2, '0');
  $('#cuenta-atras').textContent =
    `Siguiente partida en ${dos(Math.floor(resto / 3600))}:${dos(Math.floor((resto % 3600) / 60))}:${dos(resto % 60)}`;
}

/* Archivo */

const dlgArchivo = $('#dlg-archivo');

function abrirArchivo() {
  const lista = $('#archivo-lista');
  const anteriores = partidas.filter((p) => p.fecha < hoy).reverse();
  if (porFecha.has(hoy)) anteriores.unshift(porFecha.get(hoy));
  if (!anteriores.length) {
    const li = document.createElement('li');
    li.className = 'archivo-vacio';
    li.textContent = 'Todavía no hay partidas anteriores.';
    lista.replaceChildren(li);
  } else {
    lista.replaceChildren(...anteriores.map((p) => {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = '<span class="fecha"></span><span class="marcas"></span>';
      $('.fecha', b).textContent = (p.fecha === hoy ? 'Hoy · ' : '') + fechaLarga(p.fecha);
      $('.marcas', b).textContent = NIVELES.map(({ id, nombre }) => {
        const n = store.dias[p.fecha]?.niveles?.[id];
        return `${nombre} ${n?.terminado ? (n.estrella ? '✓⭐' : '✓') : '·'}`;
      }).join('   ');
      b.addEventListener('click', () => {
        dlgArchivo.close();
        irA(p.fecha);
      });
      li.appendChild(b);
      return li;
    }));
  }
  abrir(dlgArchivo);
}

function irA(fecha) {
  vista.fecha = fecha;
  elegirNivelInicial();
  mostrar();
  window.scrollTo({ top: 0 });
}

/* Ayuda con ejemplo animado */

const dlgAyuda = $('#dlg-ayuda');
const EJEMPLO = { palabra: 'MAR', filas: [['Parte del cuerpo con cinco dedos', 'MANO'], ['Bulbo que espanta vampiros', 'AJO'], ['El Ebro es uno', 'RÍO']] };
let ejemploVivo = 0;

function montarEjemplo() {
  const caja = $('#ejemplo');
  const casilla = (txt, clase = '') => `<span class="c ${clase}">${txt}</span>`;
  caja.innerHTML =
    `<div class="ej-franja">${letras(EJEMPLO.palabra).map(() => casilla('')).join('')}</div>` +
    EJEMPLO.filas.map(([d, r]) =>
      `<div class="ej-fila"><span>${d}</span><span class="ej-casillas">${letras(r).map((c, i) => casilla(c, i === 0 ? 'inicial' : '')).join('')}</span></div>`).join('');
}

async function animarEjemplo() {
  const vuelta = ++ejemploVivo;
  const caja = $('#ejemplo');
  const destinos = $$('.ej-franja .c', caja);
  const origenes = $$('.ej-casillas .c:first-child', caja);
  const ls = letras(EJEMPLO.palabra);
  while (vuelta === ejemploVivo && dlgAyuda.open) {
    destinos.forEach((d) => { d.textContent = ''; d.classList.remove('llena'); });
    if (reducido()) {
      destinos.forEach((d, i) => { d.textContent = ls[i]; d.classList.add('llena'); });
      return;
    }
    await esperar(700);
    for (let i = 0; i < destinos.length; i++) {
      if (vuelta !== ejemploVivo || !dlgAyuda.open) return;
      await volar(origenes[i], destinos[i], ls[i]);
      destinos[i].textContent = ls[i];
      destinos[i].classList.add('llena');
      await esperar(250);
    }
    await esperar(2200);
  }
}

/* Tema luminoso u oscuro (se elige al pie de la ayuda) */

const CLAVE_TEMA = 'capitular-tema';

function aplicarTema(tema) {
  const oscuro = tema === 'oscuro';
  if (oscuro) document.documentElement.dataset.tema = 'oscuro';
  else delete document.documentElement.dataset.tema;
  $('meta[name="theme-color"]').content = oscuro ? '#1E1A17' : '#F5EBD8';
  for (const r of $$('input[name="tema"]')) r.checked = r.value === (oscuro ? 'oscuro' : 'luminoso');
}

for (const r of $$('input[name="tema"]')) {
  r.addEventListener('change', () => {
    aplicarTema(r.value);
    try { localStorage.setItem(CLAVE_TEMA, r.value); } catch { /* sin almacenamiento */ }
  });
}

aplicarTema(document.documentElement.dataset.tema === 'oscuro' ? 'oscuro' : 'luminoso');

function abrirAyuda() {
  montarEjemplo();
  abrir(dlgAyuda);
  animarEjemplo();
}
dlgAyuda.addEventListener('close', () => { ejemploVivo++; });

/* ---------- Portada (cortina de entrada) ---------- */

const portada = $('#portada');
const app = $('.app');
app.inert = true;

// Se queda lo justo para ver estirarse las barras; con movimiento reducido, menos.
const DURACION_PORTADA = reducido() ? 900 : 2000;
const portadaVista = esperar(DURACION_PORTADA);
let saltarPortada;
const portadaSaltada = new Promise((r) => { saltarPortada = r; });
portada.addEventListener('click', () => saltarPortada());

function cerrarPortada() {
  if (portada.hidden) return;
  app.inert = false;
  const fin = () => { portada.hidden = true; };
  if (reducido()) fin();
  else {
    portada.classList.add('saliendo');
    portada.addEventListener('transitionend', fin, { once: true });
    setTimeout(fin, 600);
  }
  if (!store.ayudaVista) {
    store.ayudaVista = true;
    guardar();
    abrirAyuda();
  }
}

/* ---------- Arranque ---------- */

$('#btn-ayuda').addEventListener('click', abrirAyuda);
$('#btn-racha').addEventListener('click', abrirEstadisticas);
$('#btn-archivo').addEventListener('click', abrirArchivo);
$('#vacio-archivo').addEventListener('click', abrirArchivo);
$('#btn-hoy').addEventListener('click', () => irA(hoy));

function elegirNivelInicial() {
  if (!partida()) return;
  const idx = NIVELES.findIndex(({ id }) => !terminado(id));
  vista.nivel = NIVELES[Math.max(idx, 0)].id;
}

// Si la app queda abierta y cambia el día en Madrid, pasa a la partida nueva.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const nueva = fechaMadrid();
  if (nueva === hoy) return;
  const estabaEnHoy = vista.fecha === hoy;
  hoy = nueva;
  if (estabaEnHoy) irA(hoy);
});

async function iniciar() {
  try {
    const r = await fetch('partidas.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(r.status);
    partidas = await r.json();
  } catch {
    el.vacio.hidden = false;
    $('#vacio h2').textContent = 'No se pudieron cargar las partidas';
    el.vacioTexto.textContent = 'Comprueba la conexión y vuelve a intentarlo.';
    $('#vacio-archivo').hidden = true;
    await Promise.race([portadaVista, portadaSaltada]);
    cerrarPortada();
    return;
  }
  partidas.sort((a, b) => a.fecha.localeCompare(b.fecha));
  for (const p of partidas) porFecha.set(p.fecha, p);

  vista.fecha = hoy;
  elegirNivelInicial();
  mostrar();
  await Promise.race([portadaVista, portadaSaltada]);
  cerrarPortada();
  if (fechaForzada) avisar(`Modo desarrollo: fecha ${fechaForzada}`, 3000);
}

iniciar();

// En desarrollo el service worker solo se registra con ?sw, para no servir archivos viejos.
if ('serviceWorker' in navigator && location.protocol.startsWith('http') && (!esDesarrollo || params.has('sw'))) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
