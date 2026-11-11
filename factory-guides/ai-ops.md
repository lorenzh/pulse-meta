# Factory-Guide: Rolle AI Ops

Stand: 11.11.2026. Hier steht nur, was wir mit Pulse tatsächlich erlebt haben. Der Guide wird nach und nach ergänzt.

## Aufgabe der Rolle

AI Ops hält die Factory technisch am Laufen: Workflows, Scripts, Tokens und Limits, Agent-Fehler und Repo-Instruktionen. Bei Factory-PRs prüft AI Ops im Dreier-Review mit PM und Architekt, ob die CI grün ist, ob nichts unter `.factory/` geändert wurde und ob es Nebenwirkungen auf die Factory gibt.

## Erfahrungen

### Zuerst lesen, dann ändern
Die erste Analyse war rein lesend: Runs, Logs, offene PRs und Issues. Sie hat gezeigt, dass Doku und Wirklichkeit auseinanderlaufen. Die Doku nannte die Factory-Version 0.8, tatsächlich lief 0.10. Außerdem war der Self-hosted-Runner seit Tagen offline, und doppelte PRs entstanden durch Manager-Rework, nicht durch einen Fehler. Erst danach haben wir einzelne kleine Fixes vorgeschlagen.

### Typische Ursachen, wenn die Factory hängt
Diese Fälle haben wir beobachtet:
- Security-Audit-Reviews scheiterten am Cyber-Filter des Modells.
- Ein Issue (#509) stand nach einem GraphQL-Fehler ohne State da.
- Der Sweeper lief selten, weil GitHub zeitgesteuerte Workflows (Cron) drosselt.

Die Lehre daraus: Zuerst das Run-Log lesen und erst dann an Prompts drehen.

### Bot-Token und Workflow-Dateien
Ein Push, der `.github/workflows/` ändert, braucht beim gh-Token den Scope `workflow`. Ohne ihn lehnt GitHub den Push mit „refusing to allow an OAuth App to create or update workflow“ ab. Lorenz muss den Scope selbst freigeben, mit `gh auth refresh -s workflow` per Gerätecode. Ein Konnektor ist dafür kein Ersatz.

### Regeln technisch absichern
„Die Factory ändert nie `.factory/`“ war zuerst nur eine Absprache. Bevor wir den Path-Guard (#957) schrieben, haben wir an echten Daten nachgesehen, was Factory-PRs wirklich anfassen. Das waren 109 PRs, deren Dateien unter `.factory/` alle in `.factory/work/<issue>/` lagen. Die Allowlist im Guard folgt genau diesem Befund. Ein Check signalisiert nur, solange er kein Pflicht-Check ist.

### Branch Protection, wenn alle Bots als derselbe Nutzer arbeiten
Alle Bots handeln als `lorenzh`. Pflicht-Reviews auf GitHub würden sich deshalb nie erfüllen lassen, weil niemand den eigenen PR genehmigen kann. Die Dreier-Freigabe läuft daher als Review-Kommentar mit Log in #955. Technisch erzwingen wir sie über Pflicht-Checks und das Verbot von Direkt-Pushes auf `main`. Vor dem Aktivieren haben wir geprüft, dass die Factory selbst nie direkt auf `main` pusht.

### Prompt-Änderungen unter `.factory/` reviewen
Für `.factory/prompts/` gibt es keine CI. Das Review ist hier also die einzige Absicherung. Wir prüfen dabei:
- ob die Parser in `scripts/` (z. B. die Regex für `Files:` und `Behavior change:`) weiter passen,
- ob alte Specs ohne die neue Zeile weiterlaufen,
- ob laufende Runs betroffen sind.

Bei #958 hätte ein neues Pflichtfeld jeden PR der laufenden Meta-Issues einmal zurück an `implement` geschickt. Die Lösung war, dass ein fehlendes Feld bei alten Specs als Standardwert gilt und nur einen Hinweis erzeugt.

### Abhängigkeiten zwischen Bot-PRs nennen
Wenn ein PR auf Dateien aus einem anderen offenen PR verweist (#958 auf das ADR aus #956), gehört die Merge-Reihenfolge in den PR-Text.

## Arbeitsweise, die sich bewährt hat
- Kleine PRs auf Branches `bot/ai-ops/<thema>`, die Rolle steht im PR-Text, Lorenz merged.
- Jede relevante Aktion kommt kurz in den Team-Log #955: wer, was, warum, Link und Ergebnis.
- Fix-Ideen erst im Team-Chat vorschlagen und dann einzeln umsetzen.
