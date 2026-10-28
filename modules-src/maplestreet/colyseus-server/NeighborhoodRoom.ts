/**
 * Thin Colyseus wrapper around the shared, authoritative NeighborhoodLogic.
 * All rules (lot ownership, build validation, money, loan cap, mow pay,
 * delivery checks) live in /shared so the browser host and this server
 * can never disagree.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Client, Room } from 'colyseus';
import type { ClientMsg, JoinOptions, ServerMsg } from '../shared/Protocol';
import { NeighborhoodLogic, Persisted } from '../shared/RoomLogic';

const SAVE_DIR = process.env.SAVE_DIR ?? './data';
const SAVE_FILE = `${SAVE_DIR}/neighborhood.json`;

export class NeighborhoodRoom extends Room {
  maxClients = 32;
  autoDispose = false;                 // the neighborhood keeps existing when empty
  private logic!: NeighborhoodLogic;
  private byId = new Map<string, Client>();
  private saveTimer?: NodeJS.Timeout;

  onCreate() {
    let saved: Persisted | null = null;
    try { if (existsSync(SAVE_FILE)) saved = JSON.parse(readFileSync(SAVE_FILE, 'utf8')); } catch (e) { console.warn('[room] bad save, starting fresh', e); }

    this.logic = new NeighborhoodLogic({
      send: (id, msg: ServerMsg) => this.byId.get(id)?.send('m', msg),
      broadcast: (msg: ServerMsg, except?: string) => this.broadcast('m', msg, except ? { except: this.byId.get(except) } : undefined),
    }, saved);

    this.onMessage('m', (client, msg: ClientMsg) => {
      try { this.logic.message(client.sessionId, msg); }
      catch (e) { console.warn('[room] bad message from', client.sessionId, e); }
    });

    this.setSimulationInterval(dtMs => this.logic.tick(dtMs / 1000), 1000 / 30);
    this.saveTimer = setInterval(() => this.save(), 15_000);
  }

  onJoin(client: Client, options: JoinOptions) {
    this.byId.set(client.sessionId, client);
    this.logic.join(client.sessionId, options);
  }

  onLeave(client: Client) {
    this.logic.leave(client.sessionId);
    this.byId.delete(client.sessionId);
  }

  onDispose() {
    clearInterval(this.saveTimer);
    this.save();
  }

  private save() {
    try {
      mkdirSync(SAVE_DIR, { recursive: true });
      writeFileSync(SAVE_FILE, JSON.stringify(this.logic.serialize()));
    } catch (e) { console.error('[room] save failed', e); }
  }
}
