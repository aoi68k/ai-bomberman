// WebRTC P2P Online Multiplayer Manager using PeerJS (Host-Authoritative)

import Peer, { DataConnection } from 'peerjs';
import { PlayerSlotConfig, GameState } from './game';
import { ItemType, ItemSettings, DEFAULT_ITEM_SETTINGS } from './constants';

export interface RemoteInputPayload {
  dx: number;
  dy: number;
  bomb: boolean;
  chainBomb?: boolean;
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
  chainBombAmmo: number;
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

export type SerializedFxEvent =
  | { kind: 'itemGet'; x: number; y: number; color?: string }
  | { kind: 'explosion'; x: number; y: number; count?: number }
  | { kind: 'debris'; x: number; y: number; count?: number }
  | {
      kind: 'slash';
      x: number;
      y: number;
      angle: number;
      radius?: number;
      color?: string;
      flip?: boolean;
    }
  | { kind: 'shake'; intensity: number; duration: number };

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
  fxEvents?: SerializedFxEvent[];
  playerSlots?: PlayerSlotConfig[];
  itemSettings?: ItemSettings;
}

export type SoundEventName =
  | 'explosion'
  | 'placeBomb'
  | 'pickup'
  | 'kick'
  | 'hurry'
  | 'death'
  | 'shieldBreak'
  | 'wallThud'
  | 'countdownTick'
  | 'battleStart'
  | 'roundOver';

export type NetMessage =
  | { type: 'HELLO'; clientId: string; preferredCharId?: string; cursorIdx?: number }
  | { type: 'LEAVE'; clientId?: string }
  | {
      type: 'WELCOME';
      assignedSlot: number;
      slots: PlayerSlotConfig[];
      connectedSlots: number[];
      cursors: Record<number, number>;
      itemSettings: ItemSettings;
      hostState?: GameState;
    }
  | { type: 'ROOM_FULL' }
  | {
      type: 'LOBBY_SYNC';
      slots: PlayerSlotConfig[];
      connectedSlots: number[];
      cursors: Record<number, number>;
      itemSettings: ItemSettings;
      hostState?: GameState;
    }
  | { type: 'START_GAME'; slots: PlayerSlotConfig[]; itemSettings: ItemSettings }
  | { type: 'ITEM_SETTINGS'; settings: ItemSettings }
  | { type: 'STATE'; snapshot: GameSnapshot }
  | { type: 'SOUND'; event: SoundEventName }
  | { type: 'SELECT_CHAR'; charId: string }
  | { type: 'CURSOR_MOVE'; charIdx: number }
  | { type: 'INPUT'; input: RemoteInputPayload };

export type NetworkRole = 'OFFLINE' | 'HOST' | 'GUEST';

const ROOM_PREFIX = 'abm-room-';
const CLIENT_ID_SESSION_KEY = 'abm_client_id';
const REJOIN_STORAGE_PREFIX = 'abm_rejoin_';
const ROOM_CHAR_STORAGE_PREFIX = 'abm_room_char_';

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateClientId(): string {
  return 'c_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
}

export class NetworkManager {
  public role: NetworkRole = 'OFFLINE';
  public roomCode: string = '';
  public assignedSlot: number = 0; // 0 for Host, 1..3 for Guest
  public statusText: string = '未接続';
  public clientId: string = '';

  private peer: Peer | null = null;
  private hostConn: DataConnection | null = null;
  private guestConns: Map<number, DataConnection> = new Map(); // slotIndex -> DataConnection
  private peerToSlot: Map<string, number> = new Map();
  private clientToSlot: Map<string, number> = new Map(); // clientId -> slotIndex
  private slotToClient: Map<number, string> = new Map(); // slotIndex -> clientId
  private helloRetryTimer: number | null = null;

  public onLobbyUpdate?: (connectedSlots: number[]) => void;
  public onGuestWelcome?: (
    assignedSlot: number,
    slots: PlayerSlotConfig[],
    connectedSlots: number[],
    cursors: Record<number, number>,
    itemSettings: ItemSettings,
    hostState?: GameState
  ) => void;
  public onGuestLobbySync?: (
    slots: PlayerSlotConfig[],
    connectedSlots: number[],
    cursors: Record<number, number>,
    itemSettings: ItemSettings,
    hostState?: GameState
  ) => void;
  public onGuestStartGame?: (slots: PlayerSlotConfig[], itemSettings: ItemSettings) => void;
  public onGuestItemSettings?: (settings: ItemSettings) => void;
  public onGuestSnapshot?: (snapshot: GameSnapshot) => void;
  public onSoundEvent?: (event: SoundEventName) => void;
  public onRemoteCharSelect?: (slotIndex: number, charId: string) => void;
  public onRemoteCursorMove?: (slotIndex: number, charIdx: number) => void;
  public onRemoteInput?: (slotIndex: number, input: RemoteInputPayload) => void;
  public onStatusChange?: (status: string, isConnected: boolean) => void;
  public onDisconnect?: (reason: string) => void;

  public getOrCreateClientId(roomCode?: string): string {
    const normalizedRoom = roomCode ? roomCode.trim().toUpperCase() : '';
    try {
      // Check if this tab was just reopened after closing an invite tab for the same room
      let cid = sessionStorage.getItem(CLIENT_ID_SESSION_KEY) || '';
      if (!cid && normalizedRoom) {
        const rawRejoin = localStorage.getItem(`${REJOIN_STORAGE_PREFIX}${normalizedRoom}`);
        if (rawRejoin) {
          localStorage.removeItem(`${REJOIN_STORAGE_PREFIX}${normalizedRoom}`);
          const parsed = JSON.parse(rawRejoin) as { clientId?: string; charId?: string; ts?: number };
          if (parsed.clientId && parsed.ts && Date.now() - parsed.ts < 10 * 60 * 1000) {
            cid = parsed.clientId;
            if (parsed.charId) {
              sessionStorage.setItem(`${ROOM_CHAR_STORAGE_PREFIX}${normalizedRoom}`, parsed.charId);
            }
          }
        }
      }
      if (!cid) {
        cid = generateClientId();
      }
      sessionStorage.setItem(CLIENT_ID_SESSION_KEY, cid);
      this.clientId = cid;
      return cid;
    } catch {
      if (!this.clientId) {
        this.clientId = generateClientId();
      }
      return this.clientId;
    }
  }

  public getSavedRoomChar(roomCode?: string): string | undefined {
    const code = (roomCode || this.roomCode).trim().toUpperCase();
    if (!code) return undefined;
    try {
      const saved = sessionStorage.getItem(`${ROOM_CHAR_STORAGE_PREFIX}${code}`);
      return saved || undefined;
    } catch {
      return undefined;
    }
  }

  public saveRoomChar(charId: string, roomCode?: string) {
    const code = (roomCode || this.roomCode).trim().toUpperCase();
    if (!code || !charId) return;
    try {
      sessionStorage.setItem(`${ROOM_CHAR_STORAGE_PREFIX}${code}`, charId);
    } catch {
      // ignore storage errors
    }
  }

  public saveRejoinStateOnUnload(charId?: string) {
    if (this.role !== 'GUEST' || !this.roomCode) return;
    const code = this.roomCode.trim().toUpperCase();
    const resolvedChar = charId || this.getSavedRoomChar(code);
    try {
      if (resolvedChar) {
        sessionStorage.setItem(`${ROOM_CHAR_STORAGE_PREFIX}${code}`, resolvedChar);
      }
      localStorage.setItem(
        `${REJOIN_STORAGE_PREFIX}${code}`,
        JSON.stringify({
          clientId: this.clientId || this.getOrCreateClientId(code),
          charId: resolvedChar,
          ts: Date.now(),
        })
      );
    } catch {
      // ignore storage errors
    }
  }

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

  private pruneClosedGuestConnections(releaseSlotForGuest: (slotIndex: number) => void) {
    for (const [sIdx, existingConn] of Array.from(this.guestConns.entries())) {
      const dc = (existingConn as any).dataChannel as RTCDataChannel | undefined;
      const isDead =
        !existingConn.open ||
        (dc && (dc.readyState === 'closing' || dc.readyState === 'closed'));
      if (isDead) {
        this.guestConns.delete(sIdx);
        this.peerToSlot.delete(existingConn.peer);
        releaseSlotForGuest(sIdx);
      }
    }
  }

  public createRoom(
    getSlots: () => PlayerSlotConfig[],
    getCursors: () => Record<number, number>,
    getItemSettings: () => ItemSettings,
    assignSlotForGuest: (slotIndex: number, preferredCharId?: string, cursorIdx?: number) => void,
    releaseSlotForGuest: (slotIndex: number) => void,
    getHostState?: () => GameState,
    getHostSnapshot?: () => GameSnapshot | null
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

      const sendWelcomeAndSync = (conn: DataConnection, targetSlot: number) => {
        const updatedSlots = getSlots();
        const updatedCursors = getCursors();
        const itemSettings = getItemSettings ? getItemSettings() : DEFAULT_ITEM_SETTINGS;
        const connectedSlots = this.getConnectedSlots();
        const hostState = getHostState ? getHostState() : 'SETUP';

        conn.send({
          type: 'WELCOME',
          assignedSlot: targetSlot,
          slots: updatedSlots,
          connectedSlots,
          cursors: updatedCursors,
          itemSettings,
          hostState,
        } satisfies NetMessage);

        this.broadcastLobbySync(updatedSlots, updatedCursors, itemSettings, hostState);
        this.onLobbyUpdate?.(connectedSlots);

        if (
          hostState === 'COUNTDOWN' ||
          hostState === 'PLAYING' ||
          hostState === 'ROUND_OVER' ||
          hostState === 'PAUSED'
        ) {
          const snap = getHostSnapshot ? getHostSnapshot() : null;
          if (snap) {
            conn.send({ type: 'STATE', snapshot: snap } satisfies NetMessage);
          }
        }
      };

      const bindGuestToSlot = (
        conn: DataConnection,
        clientId?: string,
        preferredCharId?: string,
        cursorIdx?: number
      ): number => {
        this.pruneClosedGuestConnections(releaseSlotForGuest);

        const existingAssigned = this.peerToSlot.get(conn.peer);
        let targetSlot = existingAssigned !== undefined ? existingAssigned : -1;

        // If clientId previously held a slot in this room, reclaim that slot
        if (clientId && this.clientToSlot.has(clientId)) {
          const prevSlot = this.clientToSlot.get(clientId)!;
          if (prevSlot >= 1 && prevSlot <= 3) {
            const currentOwnerClient = this.slotToClient.get(prevSlot);
            const oldConn = this.guestConns.get(prevSlot);
            const takenByOtherLiveGuest =
              oldConn &&
              oldConn !== conn &&
              oldConn.open &&
              currentOwnerClient &&
              currentOwnerClient !== clientId;

            if (!takenByOtherLiveGuest) {
              if (oldConn && oldConn !== conn) {
                this.peerToSlot.delete(oldConn.peer);
                this.guestConns.delete(prevSlot);
                try {
                  oldConn.close();
                } catch {
                  // ignore
                }
              }
              if (targetSlot !== -1 && targetSlot !== prevSlot) {
                if (this.guestConns.get(targetSlot) === conn) {
                  this.guestConns.delete(targetSlot);
                  releaseSlotForGuest(targetSlot);
                }
              }
              targetSlot = prevSlot;
            }
          }
        }

        const slots = getSlots();
        if (targetSlot === -1) {
          for (const idx of [1, 2, 3]) {
            if (!this.guestConns.has(idx) && slots[idx]?.control !== 'OFF') {
              targetSlot = idx;
              break;
            }
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
          return -1;
        }

        this.guestConns.set(targetSlot, conn);
        this.peerToSlot.set(conn.peer, targetSlot);
        if (clientId) {
          this.clientToSlot.set(clientId, targetSlot);
          this.slotToClient.set(targetSlot, clientId);
        }

        assignSlotForGuest(targetSlot, preferredCharId, cursorIdx);
        return targetSlot;
      };

      const handleGuestLeave = (conn: DataConnection) => {
        const slotIdx = this.peerToSlot.get(conn.peer);
        if (slotIdx !== undefined) {
          this.peerToSlot.delete(conn.peer);
          if (this.guestConns.get(slotIdx) === conn) {
            this.guestConns.delete(slotIdx);
            releaseSlotForGuest(slotIdx);
            const connectedSlots = this.getConnectedSlots();
            const itemSettings = getItemSettings ? getItemSettings() : DEFAULT_ITEM_SETTINGS;
            const hostState = getHostState ? getHostState() : 'SETUP';
            this.broadcastLobbySync(getSlots(), getCursors(), itemSettings, hostState);
            this.onLobbyUpdate?.(connectedSlots);
          }
        }
      };

      peer.on('open', () => {
        this.setStatus(`ルーム待機中 (${this.roomCode})`, true);
        resolve(this.roomCode);
      });

      peer.on('connection', (conn) => {
        const meta = (conn.metadata || {}) as {
          clientId?: string;
          preferredCharId?: string;
          cursorIdx?: number;
        };

        conn.on('open', () => {
          const targetSlot = bindGuestToSlot(
            conn,
            meta.clientId,
            meta.preferredCharId,
            meta.cursorIdx
          );
          if (targetSlot === -1) {
            conn.send({ type: 'ROOM_FULL' } satisfies NetMessage);
            setTimeout(() => conn.close(), 200);
            return;
          }
          sendWelcomeAndSync(conn, targetSlot);
        });

        conn.on('data', (raw) => {
          const msg = raw as NetMessage;
          if (!msg) return;

          if (msg.type === 'HELLO') {
            const targetSlot = bindGuestToSlot(
              conn,
              msg.clientId || meta.clientId,
              msg.preferredCharId || meta.preferredCharId,
              msg.cursorIdx ?? meta.cursorIdx
            );
            if (targetSlot === -1) {
              conn.send({ type: 'ROOM_FULL' } satisfies NetMessage);
              setTimeout(() => conn.close(), 200);
              return;
            }
            sendWelcomeAndSync(conn, targetSlot);
            return;
          }

          if (msg.type === 'LEAVE') {
            handleGuestLeave(conn);
            try {
              conn.close();
            } catch {
              // ignore
            }
            return;
          }

          const slotIdx = this.peerToSlot.get(conn.peer);
          if (slotIdx === undefined) return;

          if (msg.type === 'SELECT_CHAR') {
            this.onRemoteCharSelect?.(slotIdx, msg.charId);
          } else if (msg.type === 'CURSOR_MOVE') {
            this.onRemoteCursorMove?.(slotIdx, msg.charIdx);
          } else if (msg.type === 'INPUT') {
            this.onRemoteInput?.(slotIdx, msg.input);
          }
        });

        conn.on('close', () => {
          handleGuestLeave(conn);
        });
      });

      peer.on('error', (err) => {
        this.setStatus(`接続エラー: ${err.type || err.message}`, false);
        reject(err);
      });
    });
  }

  public joinRoom(roomCode: string, preferredCharId?: string, cursorIdx?: number): Promise<void> {
    this.disconnect();
    this.role = 'GUEST';
    this.roomCode = roomCode.trim().toUpperCase();
    const clientId = this.getOrCreateClientId(this.roomCode);
    const savedCharId = preferredCharId || this.getSavedRoomChar(this.roomCode);
    this.setStatus(`ルーム ${this.roomCode} に接続中...`, false);

    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 0 });
      this.peer = peer;
      let welcomed = false;

      const clearHelloTimer = () => {
        if (this.helloRetryTimer !== null) {
          window.clearInterval(this.helloRetryTimer);
          this.helloRetryTimer = null;
        }
      };

      peer.on('open', () => {
        const conn = peer.connect(`${ROOM_PREFIX}${this.roomCode}`, {
          reliable: true,
          metadata: {
            clientId,
            preferredCharId: savedCharId,
            cursorIdx,
          },
        });
        this.hostConn = conn;

        const sendHello = () => {
          if (conn.open && !welcomed) {
            conn.send({
              type: 'HELLO',
              clientId,
              preferredCharId: this.getSavedRoomChar(this.roomCode) || savedCharId,
              cursorIdx,
            } satisfies NetMessage);
          }
        };

        conn.on('open', () => {
          this.setStatus(`ルーム ${this.roomCode} に参加済み`, true);
          sendHello();
          clearHelloTimer();
          let attempts = 0;
          this.helloRetryTimer = window.setInterval(() => {
            attempts++;
            if (welcomed || attempts > 8 || !conn.open) {
              clearHelloTimer();
              return;
            }
            sendHello();
          }, 350);
          resolve();
        });

        conn.on('data', (raw) => {
          const msg = raw as NetMessage;
          if (!msg) return;
          switch (msg.type) {
            case 'WELCOME':
              welcomed = true;
              clearHelloTimer();
              this.assignedSlot = msg.assignedSlot;
              if (msg.slots[msg.assignedSlot]?.charId) {
                this.saveRoomChar(msg.slots[msg.assignedSlot].charId, this.roomCode);
              }
              this.setStatus(`${msg.assignedSlot + 1}P として参加中 (${this.roomCode})`, true);
              this.onGuestWelcome?.(
                msg.assignedSlot,
                msg.slots,
                msg.connectedSlots,
                msg.cursors || {},
                msg.itemSettings || DEFAULT_ITEM_SETTINGS,
                msg.hostState
              );
              break;
            case 'ROOM_FULL':
              welcomed = true;
              clearHelloTimer();
              this.setStatus('ルームが満員です', false);
              this.disconnect();
              this.onDisconnect?.('ルームが満員のため参加できませんでした。');
              break;
            case 'LOBBY_SYNC':
              welcomed = true;
              clearHelloTimer();
              if (msg.slots[this.assignedSlot]?.charId) {
                this.saveRoomChar(msg.slots[this.assignedSlot].charId, this.roomCode);
              }
              this.onGuestLobbySync?.(
                msg.slots,
                msg.connectedSlots,
                msg.cursors || {},
                msg.itemSettings || DEFAULT_ITEM_SETTINGS,
                msg.hostState
              );
              break;
            case 'START_GAME':
              this.onGuestStartGame?.(msg.slots, msg.itemSettings || DEFAULT_ITEM_SETTINGS);
              break;
            case 'ITEM_SETTINGS':
              this.onGuestItemSettings?.(msg.settings);
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
          clearHelloTimer();
          if (this.role === 'GUEST') {
            this.setStatus('ホストとの接続が切れました', false);
            this.onDisconnect?.('ホストとの接続が切断されました。');
          }
        });

        conn.on('error', (err) => {
          clearHelloTimer();
          this.setStatus(`通信エラー: ${err.message}`, false);
          reject(err);
        });
      });

      peer.on('error', (err) => {
        clearHelloTimer();
        this.setStatus(`接続失敗: ${err.type || err.message}`, false);
        reject(err);
      });
    });
  }

  public broadcastLobbySync(
    slots: PlayerSlotConfig[],
    cursors: Record<number, number>,
    itemSettings?: ItemSettings,
    hostState?: GameState
  ) {
    if (this.role !== 'HOST') return;
    const msg: NetMessage = {
      type: 'LOBBY_SYNC',
      slots,
      connectedSlots: this.getConnectedSlots(),
      cursors,
      itemSettings: itemSettings || DEFAULT_ITEM_SETTINGS,
      hostState,
    };
    this.broadcast(msg);
  }

  public broadcastStartGame(slots: PlayerSlotConfig[], itemSettings?: ItemSettings) {
    if (this.role !== 'HOST') return;
    this.broadcast({
      type: 'START_GAME',
      slots,
      itemSettings: itemSettings || DEFAULT_ITEM_SETTINGS,
    });
  }

  public broadcastItemSettings(settings: ItemSettings) {
    if (this.role !== 'HOST') return;
    this.broadcast({ type: 'ITEM_SETTINGS', settings });
  }

  public broadcastSnapshot(snapshot: GameSnapshot) {
    if (this.role !== 'HOST') return;
    const hasFx = Boolean(snapshot.fxEvents && snapshot.fxEvents.length > 0);
    for (const conn of this.guestConns.values()) {
      if (conn.open) {
        // Drop snapshot if WebRTC data channel buffer is congested to avoid latency buildup (unless it carries FX events)
        const dc = (conn as any).dataChannel as RTCDataChannel | undefined;
        if (!hasFx && dc && dc.bufferedAmount > 16384) {
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
    if (this.role === 'GUEST') {
      this.saveRoomChar(charId, this.roomCode);
      if (this.hostConn?.open) {
        this.hostConn.send({ type: 'SELECT_CHAR', charId } satisfies NetMessage);
      }
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
    if (this.helloRetryTimer !== null) {
      window.clearInterval(this.helloRetryTimer);
      this.helloRetryTimer = null;
    }
    for (const conn of this.guestConns.values()) {
      try {
        conn.close();
      } catch {
        // ignore
      }
    }
    this.guestConns.clear();
    this.peerToSlot.clear();
    this.clientToSlot.clear();
    this.slotToClient.clear();
    if (this.hostConn) {
      try {
        if (this.hostConn.open) {
          this.hostConn.send({ type: 'LEAVE', clientId: this.clientId } satisfies NetMessage);
        }
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
