// Local MQTT broker for offline development (no internet needed).
// Then run the other scripts with MQTT_URL=mqtt://localhost:1883
// The web console connects over WebSocket: VITE_MQTT_WS_URL=ws://localhost:8080
// Wokwi cannot reach this broker (it lives on your laptop); use the public broker with Wokwi.
import { createServer } from 'node:net';
import Aedes from 'aedes';
import { WebSocketServer, createWebSocketStream } from 'ws';

const port = Number(process.env.PORT ?? 1883);
const wsPort = Number(process.env.WS_PORT ?? 8080);
const aedes = new Aedes();

const server = createServer(aedes.handle);
server.listen(port, () => console.log(`local MQTT broker on mqtt://localhost:${port}`));

// MQTT over WebSocket for browsers (the web console)
const wss = new WebSocketServer({ port: wsPort });
wss.on('connection', (socket) => aedes.handle(createWebSocketStream(socket)));
wss.on('listening', () => console.log(`local MQTT over WebSocket on ws://localhost:${wsPort}`));

aedes.on('client', (c) => console.log('client connected', c.id));
aedes.on('clientDisconnect', (c) => console.log('client left', c.id));
