/**
 * updateCheck — Versionsvergleich fuer den GitHub-Update-Check (MKM-Angleich).
 * Der eigentliche Netz-Aufruf laeuft im Main-Prozess (update:pruefen).
 */

function teile(v: string): number[] {
  const m = v.trim().replace(/^v/i, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Unlesbare Version: "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Ist das Release-Tag neuer, gleich oder aelter als die laufende Version? */
export function vergleicheVersionen(aktuell: string, tag: string): "neuer" | "gleich" | "aelter" {
  const a = teile(aktuell);
  const b = teile(tag);
  for (let i = 0; i < 3; i++) {
    if (b[i] > a[i]) return "neuer";
    if (b[i] < a[i]) return "aelter";
  }
  return "gleich";
}
