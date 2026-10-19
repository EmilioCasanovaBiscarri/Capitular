#!/usr/bin/env node
'use strict';

// Comprueba partidas.json: uso `node scripts/validar.js [ruta]`

const fs = require('fs');
const path = require('path');

const archivo = process.argv[2] || path.join(__dirname, '..', 'partidas.json');
const NIVELES = ['facil', 'medio', 'dificil'];

// Mayúsculas y sin tildes, pero la Ñ se conserva (igual que en app.js).
function normalizar(s) {
  return String(s).normalize('NFC').toUpperCase()
    .replace(/Ñ/g, '\u0001')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'Ñ');
}

const esTexto = (v) => typeof v === 'string' && v.trim() !== '';
const errores = [];
const avisos = [];

let partidas;
try {
  partidas = JSON.parse(fs.readFileSync(archivo, 'utf8'));
} catch (e) {
  console.error(`✗ No se pudo leer ${archivo}: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(partidas)) {
  console.error('✗ partidas.json debe ser una lista de días');
  process.exit(1);
}

const fechas = new Set();
const respuestas = new Map(); // respuesta normalizada -> dónde apareció
const palabras = new Map();
let fechaAnterior = '';

partidas.forEach((p, i) => {
  const dia = p && p.fecha ? p.fecha : `día #${i + 1}`;

  const fechaValida = typeof p.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.fecha) &&
    !Number.isNaN(Date.parse(`${p.fecha}T00:00:00Z`)) &&
    new Date(`${p.fecha}T00:00:00Z`).toISOString().slice(0, 10) === p.fecha;
  if (!fechaValida) errores.push(`${dia}: la fecha debe ser AAAA-MM-DD`);
  if (fechas.has(p.fecha)) errores.push(`${dia}: fecha repetida`);
  fechas.add(p.fecha);
  if (fechaValida && p.fecha < fechaAnterior) avisos.push(`${dia}: no está en orden (va después de ${fechaAnterior})`);
  if (fechaValida) fechaAnterior = p.fecha;

  // La efeméride es opcional (el juego no la muestra); si está, que sea un texto.
  if (p.efemeride !== undefined && typeof p.efemeride !== 'string') errores.push(`${dia}: la efeméride debe ser un texto`);

  for (const nivel of NIVELES) {
    const n = p.niveles && p.niveles[nivel];
    const donde = `${dia} · ${nivel}`;
    if (!n) { errores.push(`${donde}: falta el nivel`); continue; }
    if (!esTexto(n.palabra)) { errores.push(`${donde}: falta la palabra`); continue; }
    if (!esTexto(n.pista)) errores.push(`${donde}: falta la pista de la palabra`);
    if (!/^\p{L}+$/u.test(n.palabra)) errores.push(`${donde}: la palabra «${n.palabra}» solo puede tener letras`);

    const clavePalabra = normalizar(n.palabra);
    if (palabras.has(clavePalabra)) avisos.push(`${donde}: la palabra ${n.palabra} ya salió en ${palabras.get(clavePalabra)}`);
    else palabras.set(clavePalabra, donde);

    if (!Array.isArray(n.filas)) { errores.push(`${donde}: faltan las filas`); continue; }
    const iniciales = Array.from(clavePalabra);
    if (n.filas.length !== iniciales.length) {
      errores.push(`${donde}: ${n.palabra} tiene ${iniciales.length} letras pero hay ${n.filas.length} filas`);
    }

    n.filas.forEach((f, j) => {
      const fila = `${donde} · fila ${j + 1}`;
      if (!esTexto(f.definicion)) errores.push(`${fila}: falta la definición`);
      if (!esTexto(f.pista)) errores.push(`${fila}: falta la pista`);
      if (!esTexto(f.respuesta)) { errores.push(`${fila}: falta la respuesta`); return; }
      if (!/^\p{L}+$/u.test(f.respuesta)) errores.push(`${fila}: «${f.respuesta}» solo puede tener letras (sin espacios)`);
      if (f.respuesta !== f.respuesta.toUpperCase()) avisos.push(`${fila}: «${f.respuesta}» no está en mayúsculas`);

      const clave = normalizar(f.respuesta);
      if (j < iniciales.length && clave[0] !== iniciales[j]) {
        errores.push(`${fila}: ${f.respuesta} empieza por ${clave[0]}, pero la letra ${j + 1} de ${n.palabra} es ${iniciales[j]}`);
      }

      const previa = respuestas.get(clave);
      if (previa && previa.fecha !== p.fecha) errores.push(`${fila}: ${f.respuesta} ya es respuesta en ${previa.donde}`);
      else if (previa) avisos.push(`${fila}: ${f.respuesta} se repite el mismo día (${previa.donde})`);
      else respuestas.set(clave, { fecha: p.fecha, donde: fila });
    });
  }
});

for (const a of avisos) console.warn(`⚠ ${a}`);
for (const e of errores) console.error(`✗ ${e}`);

if (errores.length) {
  console.error(`\n${errores.length} error(es) en ${partidas.length} días.`);
  process.exit(1);
}
const rango = partidas.length ? ` (${partidas[0].fecha} → ${partidas[partidas.length - 1].fecha})` : '';
console.log(`✓ ${partidas.length} días correctos${rango}, ${respuestas.size} respuestas distintas.`);
