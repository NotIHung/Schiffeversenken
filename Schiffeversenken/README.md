# Schiffe Versenken – React + Render

Multiplayer-Schiffe-Versenken mit:
- React + Vite im Frontend
- Node.js + WebSocket im Backend
- 10×10 Spielfeld
- Lobby mit Raumcode
- 2 Spieler pro Raum
- zufällige Schiffplatzierung
- Treffer/Fehlschuss, versenkte Schiffe und Sieg
- automatische Spielneustarts

## Lokal starten

Voraussetzung: Node.js 20+.

```bash
npm install
npm run install:all
npm run dev
```

Frontend: http://localhost:5173  
Backend: http://localhost:3001

Das Frontend verbindet sich lokal automatisch mit `ws://localhost:3001`.

## Deployment

### Render
Das Backend als **Web Service** deployen:
- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`
- Node-Version: 20+

Die Render-URL z. B. `https://dein-spiel-server.onrender.com`.

### Netlify
Das Frontend als Site deployen:
- Base directory: `client`
- Build command: `npm run build`
- Publish directory: `client/dist` (bei Base Directory `client` entsprechend `dist`)

Environment Variable setzen:
```text
VITE_WS_URL=wss://dein-spiel-server.onrender.com
```

Danach neu deployen.

## Wichtig
Für Produktion muss der Render-WebSocket-Server die Netlify-Domain in `ALLOWED_ORIGINS` akzeptieren. Beispiel:

```text
ALLOWED_ORIGINS=https://dein-spiel.netlify.app
```

Bei mehreren Domains mit Komma trennen.
