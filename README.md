# Jarvis — Root Node

Gerüst: Express-Server + Config-System + Steuermatrix-Dashboard.
Steuert, welche Funktion für welches Projekt aktiv ist und auf welcher
Freigabestufe (aus / beobachten / freigabe / autonom).

## Deploy (Railway, wie das AI Command Center)

1. Repo auf GitHub anlegen, diesen Ordner pushen
2. In Railway: New Project → Deploy from GitHub Repo
3. Kein ENV-Var nötig für das Gerüst (PORT wird von Railway automatisch gesetzt)
4. Nach dem Deploy: `<projekt>.up.railway.app` öffnen → Steuermatrix

## Lokal testen

```
npm install
npm start
```
Dashboard läuft dann auf http://localhost:3000

## Neues Funktionsmodul hinzufügen

1. In `config.json` unter `functions` einen neuen Eintrag anlegen (id + label)
   und in jedem Projekt unter `matrix` mit Startwert `"off"` ergänzen
2. `modules/_template.js` kopieren, `MODULE_ID` auf die neue functions-id setzen
3. Die drei Zweige (`beobachten` / `freigabe` / `autonom`) in `run()` mit
   echter Logik füllen — die Freigabestufe wird automatisch aus der Config
   gelesen, bevor das Modul etwas tut
4. Die neue Funktion taucht automatisch als Zeile in der Steuermatrix auf,
   ohne Frontend-Änderung nötig

## Aktuell angedockte Projekte

Pawvero, Wabipaper, Luminara Syndicate, MagnaTrade-AI — Ids und Labels
stehen in `config.json` unter `projects`.
