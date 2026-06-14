import { io, Socket } from 'socket.io-client';
import { ref } from 'vue';
import type { TankStateData, TankUpdateMessage, AllTanksMessage, SystemStatus } from '../types/frontend';

class WebSocketService {
  private socket: Socket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 5000;
  private readonly WS_URL = 'ws://localhost:3000';

  readonly connected = ref(false);
  readonly tankStates = ref<Map<string, TankStateData>>(new Map());
  readonly tankUpdates = ref<Map<string, TankUpdateMessage>>(new Map());
  readonly systemStatus = ref<SystemStatus>({
    mqttConnected: false,
    influxConnected: false,
    messageRate: 0,
    tankCount: 0,
  });
  readonly lastUpdateTime = ref<Map<string, number>>(new Map());

  private onTankUpdateCallbacks = new Map<string, (msg: TankUpdateMessage) => void>();
  private onAllTanksCallbacks: Array<(states: TankStateData[]) => void> = [];

  connect(): void {
    this.socket = io(this.WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: this.maxReconnectDelay,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      console.log('[WebSocket] Connected to backend');
      this.connected.value = true;
      this.reconnectAttempts = 0;
    });

    this.socket.on('disconnect', () => {
      console.warn('[WebSocket] Disconnected from backend');
      this.connected.value = false;
    });

    this.socket.on('reconnect', (attempt: number) => {
      console.log(`[WebSocket] Reconnected after ${attempt} attempts`);
      this.reconnectAttempts = attempt;
    });

    this.socket.on('reconnect_error', (err: Error) => {
      console.error('[WebSocket] Reconnection error:', err);
      this.reconnectAttempts++;
    });

    this.socket.on('tank_update', (msg: TankUpdateMessage) => {
      this.handleTankUpdate(msg);
    });

    this.socket.on('tank_data', (msg: TankUpdateMessage) => {
      this.handleTankUpdate(msg);
    });

    this.socket.on('all_tanks', (msg: AllTanksMessage) => {
      this.handleAllTanks(msg);
    });

    this.socket.on('system_status', (status: SystemStatus) => {
      this.systemStatus.value = status;
    });

    this.socket.on('connect_error', (err: Error) => {
      console.error('[WebSocket] Connection error:', err);
      this.connected.value = false;
    });
  }

  private handleTankUpdate(msg: TankUpdateMessage): void {
    this.tankUpdates.value.set(msg.tankId, msg);
    this.lastUpdateTime.value.set(msg.tankId, Date.now());

    const callback = this.onTankUpdateCallbacks.get(msg.tankId);
    if (callback) {
      callback(msg);
    }
  }

  private handleAllTanks(msg: AllTanksMessage): void {
    for (const state of msg.states) {
      this.tankStates.value.set(state.id, state);
    }

    for (const callback of this.onAllTanksCallbacks) {
      callback(msg.states);
    }
  }

  subscribeToTank(tankId: string, callback: (msg: TankUpdateMessage) => void): void {
    this.onTankUpdateCallbacks.set(tankId, callback);
    if (this.socket && this.socket.connected) {
      this.socket.emit('subscribe_tank', { tankId });
    }
  }

  unsubscribeFromTank(tankId: string): void {
    this.onTankUpdateCallbacks.delete(tankId);
    if (this.socket && this.socket.connected) {
      this.socket.emit('unsubscribe_tank', { tankId });
    }
  }

  onAllTanks(callback: (states: TankStateData[]) => void): void {
    this.onAllTanksCallbacks.push(callback);
  }

  offAllTanks(callback: (states: TankStateData[]) => void): void {
    const index = this.onAllTanksCallbacks.indexOf(callback);
    if (index > -1) {
      this.onAllTanksCallbacks.splice(index, 1);
    }
  }

  getTankState(tankId: string): TankStateData | undefined {
    return this.tankStates.value.get(tankId);
  }

  getTankUpdate(tankId: string): TankUpdateMessage | undefined {
    return this.tankUpdates.value.get(tankId);
  }

  getAllTankStates(): TankStateData[] {
    return Array.from(this.tankStates.value.values());
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connected.value = false;
  }

  isConnected(): boolean {
    return this.connected.value;
  }

  ping(): void {
    if (this.socket && this.socket.connected) {
      this.socket.emit('ping');
    }
  }
}

export const websocketService = new WebSocketService();
