// WebRTC P2P Online Multiplayer Manager using PeerJS (Host-Authoritative)

import Peer, { DataConnection } from 'peerjs';
import { PlayerSlotConfig, GameState } from './game';
import { ItemType } from './constants';

export interface RemoteInputPayload {
  dx: number;
  dy: number;
  bomb: boolean;
  skill: boolean;
  ultra: boolean;
}

export interface SerializedPlayer {
  id: number;
  x: number;
  y: number;
  speed: number;
  facing: 'up' | 'down' | 'left' | 'right';
  animFrame: number;
  isMoving: boolean;
  isAlive: boolean;
  deathTimer: number;
  stunTimer: number;
  invulnerableTimer: number;
  maxBombs: number;
  activeBombs: number;
  power: number;
  hasKick: boolean;
  shield: number;
  skillCooldownTimer: number;
  ultraGauge: number;
  hasMegaBomb: boolean;
  isTackling: boolean;
  tackleSlashMode: 'none' | 'skill_rush' | 'ultra_tempest';
  tackleSlashTick: number;
  slashSequenceTimer: number;
}

export interface SerializedItem {
  id: number;
  tileX: number;
  tileY: number;
  type: ItemType;
  spawnTime: number;
}

export interface SerializedBomb {
  id: number;
  tileX: number;
  tileY: number;
  pixelX: number;
  pixelY: number;
  ownerId: number;
  power: number;
  fuseTimer: number;
  maxFuseTime: number;
  isMega: boolean;
  isSliding: boolean;
  slideDx: number;
  slideDy: number;
}

export interface SerializedExplosion {
  tileX: number;
  tileY: number;
  direction: 'center' | 'up' | 'down' | 'left' | 'right';
  isEnd: boolean;
  life: number;
  maxLife: number;
}

export interface SerializedWindSlash {
  ownerId: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  tick: number;
}

export interface SerializedTempestZone {
  ownerId: number;
  centerTx: number;
  centerTy: number;
  remainingFrames: number;
}

export interface GameSnapshot {
  state: GameState;
  round: number;
  roundTimeSeconds: number;
  countdownTimer: number;
  overheadTagTimer: number;
  roundOverTimer: number;
  isHurryUp: boolean;
  scores: number[];
  winnerId: number | null;
  grid: number[][];
  activeItems: SerializedItem[];
  bombs: SerializedBomb[];
  explosions: SerializedExplosion[];
  players: SerializedPlayer[];
  windSlashes: SerializedWindSlash[];
  tempestZones: SerializedTempestZone[];
}

export type SoundEventName =
  | 'explosion'
  | 'placeBomb'
  | 'pickup'
  | 'kick'
  | 'hurry'
  | 'death'
  | 'shieldBreak'
  | 'roundOver';

export type NetMessage =
  | { type: 'WELCOME'; assignedSlot: number; slots: PlayerSlotConfig[]; connectedSlots: number[]; cursors: Record<number, number> }
  | { type: 'ROOM_FULL' }
  | { type: 'LOBBY_SYNC'; slots: PlayerSlotConfig[]; connectedSlots: number[]; cursors: Record<number, number> }
  | { type: 'START_GAME'; slots: PlayerSlotConfig[] }
  | { type: 'STATE'; snapshot: GameSnapshot }
  | { type: 'SOUND'; event: SoundEventName }
  | { type: 'SELECT_CHAR'; charId: string }
  | { type: 'CURSOR_MOVE'; charIdx: number }
  | { type: 'INPUT'; input: RemoteInputPayload };

export type NetworkRole = 'OFFLINE' | 'HOST' | 'GUEST';

const ROOM_PREFIX = 'abm-room-';

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export class NetworkManager {
  public role: NetworkRole = 'OFFLINE';
  public roomCode: string = '';
  public assignedSlot: number = 0; // 0 for Host, 1..3 for Guest
  public statusText: string = '未接続';

  private peer: Peer | null = null;
  private hostConn: DataConnection | null = null;
  private guestConns: Map<number, DataConnection> = new Map(); // slotIndex -> DataConnection
  private peerToSlot: Map<string, number> = new Map();

  public onLobbyUpdate?: (connectedSlots: number[]) => void;
  public onGuestWelcome?: (assignedSlot: number, slots: PlayerSlotConfig[], connectedSlots: number[], cursors: Record<number, number>) => void;
  public onGuestLobbySync?: (slots: PlayerSlotConfig[], connectedSlots: number[], cursors: Record<number, number>) => void;
  public onGuestStartGame?: (slots: PlayerSlotConfig[]) => void;
  public onGuestSnapshot?: (snapshot: GameSnapshot) => void;
  public onSoundEvent?: (event: SoundEventName) => void;
  public onRemoteCharSelect?: (slotIndex: number, charId: string) => void;
  public onRemoteCursorMove?: (slotIndex: number, charIdx: number) => void;
  public onRemoteInput?: (slotIndex: number, input: RemoteInputPayload) => void;
  public onStatusChange?: (status: string, isConnected: boolean) => void;
  public onDisconnect?: (reason: string) => void;

  public getInviteUrl(): string {
    if (!this.roomCode) return '';
    const base = window.location.protocol.startsWith('http')
      ? new URL('invite.html', window.location.href)
      : new URL(window.location.href);
    base.search = '';
    base.hash = '';
    base.searchParams.set('room', this.roomCode);
    return base.toString();
  }

  public getConnectedSlots(): number[] {
    return Array.from(this.guestConns.keys()).sort((a, b) => a - b);
  }

  public createRoom(
    getSlots: () => PlayerSlotConfig[],
    getCursors: () => Record<number, number>,
    assignSlotForGuest: (slotIndex: number) => void,
    releaseSlotForGuest: (slotIndex: number) => void
  ): Promise<string> {
    this.disconnect();
    this.role = 'HOST';
    this.assignedSlot = 0;
    this.roomCode = generateRoomCode();
    this.setStatus('ルーム作成中...', false);

    return new Promise((resolve, reject) => {
      const peerId = `${ROOM_PREFIX}${this.roomCode}`;
      const peer = new Peer(peerId, {
        debug: 0,
      });
      this.peer = peer;

      peer.on('open', () => {
        this.setStatus(`ルーム待機中 (${this.roomCode})`, true);
        resolve(this.roomCode);
      });

      peer.on('connection', (conn) => {
        conn.on('open', () => {
          const slots = getSlots();
          // Find an available slot among 1, 2, 3 (prefer COM or OFF not already taken by a guest)
          let targetSlot = -1;
          for (const idx of [1, 2, 3]) {
            if (!this.guestConns.has(idx) && slots[idx]?.control !== 'OFF') {
              targetSlot = idx;
              break;
            }
          }
          if (targetSlot === -1) {
            for (const idx of [1, 2, 3]) {
              if (!this.guestConns.has(idx)) {
                targetSlot = idx;
                break;
              }
            }
          }

          if (targetSlot === -1) {
            conn.send({ type: 'ROOM_FULL' } satisfies NetMessage);
            setTimeout(() => conn.close(), 200);
            return;
          }

          this.guestConns.set(targetSlot, conn);
          this.peerToSlot.set(conn.peer, targetSlot);
          assignSlotForGuest(targetSlot);

          const updatedSlots = getSlots();
          const updatedCursors = getCursors();
          const connectedSlots = this.getConnectedSlots();
          conn.send({
            type: 'WELCOME',
            assignedSlot: targetSlot,
            slots: updatedSlots,
            connectedSlots,
            cursors: updatedCursors,
          } satisfies NetMessage);

          this.broadcastLobbySync(updatedSlots, updatedCursors);
          this.onLobbyUpdate?.(connectedSlots);
        });

        conn.on('data', (raw) => {
          const msg = raw as NetMessage;
          const slotIdx = this.peerToSlot.get(conn.peer);
          if (slotIdx === undefined || !msg) return;

          if (msg.type === 'SELECT_CHAR') {
            this.onRemoteCharSelect?.(slotIdx, msg.charId);
          } else if (msg.type === 'CURSOR_MOVE') {
            this.onRemoteCursorMove?.(slotIdx, msg.charIdx);
          } else if (msg.type === 'INPUT') {
            this.onRemoteInput?.(slotIdx, msg.input);
          }
        });

        conn.on('close', () => {
          const slotIdx = this.peerToSlot.get(conn.peer);
          if (slotIdx !== undefined) {
            this.peerToSlot.delete(conn.peer);
            this.guestConns.delete(slotIdx);
            releaseSlotForGuest(slotIdx);
            const connectedSlots = this.getConnectedSlots();
            this.broadcastLobbySync(getSlots(), getCursors());
            this.onLobbyUpdate?.(connectedSlots);
          }
        });
      });

      peer.on('error', (err) => {
        this.setStatus(`接続エラー: ${err.type || err.message}`, false);
        reject(err);
      });
    });
  }

  public joinRoom(roomCode: string): Promise<void> {
    this.disconnect();
    this.role = 'GUEST';
    this.roomCode = roomCode.trim().toUpperCase();
    this.setStatus(`ルーム ${this.roomCode} に接続中...`, false);

    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      this.peer = peer;

      peer.on('open', () => {
        const conn = peer.connect(`${ROOM_PREFIX}${this.roomCode}`, {
          reliable: true,
        });
        this.hostConn = conn;

        conn.on('open', () => {
          this.setStatus(`ルーム ${this.roomCode} に参加済み`, true);
          resolve();
        });

        conn.on('data', (raw) => {
          const msg = raw as NetMessage;
          if (!msg) return;
          switch (msg.type) {
            case 'WELCOME':
              this.assignedSlot = msg.assignedSlot;
              this.setStatus(`${msg.assignedSlot + 1}P として参加中 (${this.roomCode})`, true);
              this.onGuestWelcome?.(msg.assignedSlot, msg.slots, msg.connectedSlots, msg.cursors || {});
              break;
            case 'ROOM_FULL':
              this.setStatus('ルームが満員です', false);
              this.disconnect();
              this.onDisconnect?.('ルームが満員のため参加できませんでした。');
              break;
            case 'LOBBY_SYNC':
              this.onGuestLobbySync?.(msg.slots, msg.connectedSlots, msg.cursors || {});
              break;
            case 'START_GAME':
              this.onGuestStartGame?.(msg.slots);
              break;
            case 'STATE':
              this.onGuestSnapshot?.(msg.snapshot);
              break;
            case 'SOUND':
              this.onSoundEvent?.(msg.event);
              break;
          }
        });

        conn.on('close', () => {
          if (this.role === 'GUEST') {
            this.setStatus('ホストとの接続が切れました', false);
            this.onDisconnect?.('ホストとの接続が切断されました。');
          }
        });

        conn.on('error', (err) => {
          this.setStatus(`通信エラー: ${err.message}`, false);
          reject(err);
        });
      });

      peer.on('error', (err) => {
        this.setStatus(`接続失敗: ${err.type || err.message}`, false);
        reject(err);
      });
    });
  }

  public broadcastLobbySync(slots: PlayerSlotConfig[], cursors: Record<number, number>) {
    if (this.role !== 'HOST') return;
    const msg: NetMessage = {
      type: 'LOBBY_SYNC',
      slots,
      connectedSlots: this.getConnectedSlots(),
      cursors,
    };
    this.broadcast(msg);
  }

  public broadcastStartGame(slots: PlayerSlotConfig[]) {
    if (this.role !== 'HOST') return;
    this.broadcast({ type: 'START_GAME', slots });
  }

  public broadcastSnapshot(snapshot: GameSnapshot) {
    if (this.role !== 'HOST') return;
    for (const conn of this.guestConns.values()) {
      if (conn.open) {
        // Drop snapshot if WebRTC data channel buffer is congested to avoid latency buildup
        const dc = (conn as any).dataChannel as RTCDataChannel | undefined;
        if (dc && dc.bufferedAmount > 8192) {
          continue;
        }
        conn.send({ type: 'STATE', snapshot });
      }
    }
  }

  public broadcastSound(event: SoundEventName) {
    if (this.role !== 'HOST') return;
    this.broadcast({ type: 'SOUND', event });
  }

  public sendCharSelect(charId: string) {
    if (this.role === 'GUEST' && this.hostConn?.open) {
      this.hostConn.send({ type: 'SELECT_CHAR', charId } satisfies NetMessage);
    }
  }

  public sendCursorMove(charIdx: number) {
    if (this.role === 'GUEST' && this.hostConn?.open) {
      this.hostConn.send({ type: 'CURSOR_MOVE', charIdx } satisfies NetMessage);
    }
  }

  public sendInput(input: RemoteInputPayload) {
    if (this.role === 'GUEST' && this.hostConn?.open) {
      this.hostConn.send({ type: 'INPUT', input } satisfies NetMessage);
    }
  }

  private broadcast(msg: NetMessage) {
    for (const conn of this.guestConns.values()) {
      if (conn.open) {
        conn.send(msg);
      }
    }
  }

  private setStatus(text: string, isConnected: boolean) {
    this.statusText = text;
    this.onStatusChange?.(text, isConnected);
  }

  public disconnect() {
    for (const conn of this.guestConns.values()) {
      try {
        conn.close();
      } catch {
        // ignore
      }
    }
    this.guestConns.clear();
    this.peerToSlot.clear();
    if (this.hostConn) {
      try {
        this.hostConn.close();
      } catch {
        // ignore
      }
      this.hostConn = null;
    }
    if (this.peer) {
      try {
        this.peer.destroy();
      } catch {
        // ignore
      }
      this.peer = null;
    }
    this.role = 'OFFLINE';
    this.roomCode = '';
    this.assignedSlot = 0;
    this.setStatus('ローカルモード', false);
  }
}
