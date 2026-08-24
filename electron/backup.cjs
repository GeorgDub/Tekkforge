/**
 * backup.cjs — Namens- und Rotationslogik fuer Auto-Backups.
 *
 * Bewusst als reines CJS-Modul ohne Node-Abhaengigkeiten: electron/main.cjs
 * nutzt es fuer die Dateibruecke, tests/backup-rotation.test.ts prueft es
 * direkt. Format: "<original>.<JJJJMMTT-HHMMSS>.bak".
 */

const MUSTER = /^(.+)\.(\d{8})-(\d{6})\.bak$/;

function zwei(n) {
  return String(n).padStart(2, "0");
}

/** Backup-Dateiname fuer einen Originalnamen zu einem Zeitpunkt. */
function backupDateiname(original, zeit) {
  const d = zeit instanceof Date ? zeit : new Date(zeit);
  const datum = `${d.getFullYear()}${zwei(d.getMonth() + 1)}${zwei(d.getDate())}`;
  const uhr = `${zwei(d.getHours())}${zwei(d.getMinutes())}${zwei(d.getSeconds())}`;
  return `${original}.${datum}-${uhr}.bak`;
}

/** Original + Zeitpunkt aus einem Backup-Namen; null wenn kein Backup-Muster. */
function backupInfo(dateiname) {
  const m = MUSTER.exec(String(dateiname));
  if (!m) return null;
  const [, original, datum, uhr] = m;
  const wann = new Date(
    Number(datum.slice(0, 4)),
    Number(datum.slice(4, 6)) - 1,
    Number(datum.slice(6, 8)),
    Number(uhr.slice(0, 2)),
    Number(uhr.slice(2, 4)),
    Number(uhr.slice(4, 6)),
  );
  return Number.isNaN(wann.getTime()) ? null : { original, wann };
}

/**
 * Welche Dateien muessen weg, damit vom Original hoechstens `max` Backups
 * bleiben? Aelteste zuerst; Fremddateien und andere Originale bleiben unberuehrt.
 */
function zuLoeschen(dateinamen, original, max) {
  const eigene = dateinamen
    .map((n) => ({ n, info: backupInfo(n) }))
    .filter((e) => e.info && e.info.original === original)
    .sort((a, b) => a.info.wann.getTime() - b.info.wann.getTime());
  const ueber = eigene.length - max;
  return ueber > 0 ? eigene.slice(0, ueber).map((e) => e.n) : [];
}

module.exports = { backupDateiname, backupInfo, zuLoeschen };
