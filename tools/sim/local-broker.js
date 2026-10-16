// Local MQTT broker for offline development (no internet needed).
// Then run the other scripts with MQTT_URL=mqtt://localhost:1883
// Wokwi cannot reach this broker (it lives on your laptop); use the public broker with Wokwi.
import { createServer } from 'node:net';
import Aedes from 'aedes';

const port = Number(process.env.PORT ?? 1883);
const aedes = new Aedes();
const server = createServer(aedes.handle);
server.listen(port, () => console.log(`local MQTT broker on mqtt://localhost:${port}`));
aedes.on('client', (c) => console.log('client connected', c.id));
aedes.on('clientDisconnect', (c) => console.log('client left', c.id));
