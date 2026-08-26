# Lieder für den kompletten Lauf

Audiodateien hier hineinlegen — `tests/lied-komplettlauf.test.ts` fährt für
jede den ganzen Weg des Generators durch und prüft, ob ein brauchbares
Tekk-Set herauskommt: Tempo im Tekk-Bereich, Bank passt ins Sample-RAM, die
Aufbau-Kette wächst bis zum Drop, die Kick läuft und wiederholt sich nicht,
das Pattern lässt Luft, die Vocalspur verteilt sich über die Kette, und
gerendert ist der Drop lauter als der Anfang, ohne zu übersteuern.

```bash
npx vitest run tests/lied-komplettlauf.test.ts
# oder mit einem anderen Ordner:
LIED_DIR=/pfad/zu/liedern npx vitest run tests/lied-komplettlauf.test.ts
```

Gelesen wird **WAV** — MP3/M4A brauchen ffmpeg und laufen deshalb über die App
selbst. Umwandeln geht so:

```bash
ffmpeg -i lied.mp3 -ac 2 -ar 44100 examples/lieder/lied.wav
```

Ohne Dateien überspringt sich der Test; er meldet nur, was er gefunden hat.

**Audio gehört nicht ins Repository.** Die `.gitignore` daneben hält alles
außer dieser Datei heraus — fremde Lieder haben in einem öffentlichen
Repository nichts zu suchen.

## Was der Lauf NICHT enthält

Die Stem-Trennung mit Demucs. Die läuft über Python und die Electron-Brücke;
der Test fährt den Vollmix-Weg und nimmt die Drums aus `examples/e2s/tekk4.all`
dazu — genau das, was die App anbietet, wenn Demucs fehlt oder ein Lied keine
brauchbaren Drums hergibt. Alles danach ist identisch.
