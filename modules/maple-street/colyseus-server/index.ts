/**
 * Colyseus game server. Run with `npm install && npm run dev` in /server,
 * then start the client with ?server=ws://localhost:2567
 */
import { createServer } from 'node:http';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { NeighborhoodRoom } from './NeighborhoodRoom';

const port = Number(process.env.PORT ?? 2567);
const gameServer = new Server({ transport: new WebSocketTransport({ server: createServer() }) });

// One persistent room per neighborhood id (?hood=... could map to filterBy later).
gameServer.define('neighborhood', NeighborhoodRoom);
gameServer.listen(port).then(() => console.log(`[server] neighborhood-sim listening on ws://localhost:${port}`));
