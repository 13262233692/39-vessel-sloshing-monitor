import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WebsocketService } from './websocket.service';
import { TankService } from '../tank/tank.service';
import { ConfigService } from '../config/config.service';

@WebSocketGateway({
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
})
export class SloshingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(
    private websocketService: WebsocketService,
    private tankService: TankService,
    private config: ConfigService,
  ) {}

  afterInit() {
    this.websocketService.setServer(this.server);
    console.log(`[WebSocket Gateway] Listening on port ${this.config.backend.websocketPort}`);

    setInterval(() => {
      const states = this.tankService.getAllTankStates();
      this.websocketService.broadcastAllTankStates(states);
    }, 100);
  }

  handleConnection(client: Socket) {
    this.websocketService.clientConnected();

    const states = this.tankService.getAllTankStates();
    client.emit('all_tanks', {
      type: 'all_tanks',
      states: states.map((s) => ({
        id: s.id,
        name: s.config.name,
        position: s.config.position,
        dimensions: s.config.dimensions,
        lastUpdateUs: s.lastUpdateUs,
        currentLevel: s.currentLevel,
        currentPressure: s.currentPressure,
        currentTemperature: s.currentTemperature,
        inclination: s.inclination,
        sloshingSeverity: s.sloshingSeverity,
        impactForce: s.impactForce,
        stabilityIndex: s.stabilityIndex,
        fillingRatio: s.config.fillingRatio,
      })),
    });
  }

  handleDisconnect() {
    this.websocketService.clientDisconnected();
  }

  @SubscribeMessage('subscribe_tank')
  handleSubscribeTank(
    @MessageBody() data: { tankId: string },
    @ConnectedSocket() client: Socket
  ): void {
    if (data?.tankId) {
      client.join(`tank:${data.tankId}`);
      console.log(`[WebSocket] Client subscribed to tank ${data.tankId}`);
    }
  }

  @SubscribeMessage('unsubscribe_tank')
  handleUnsubscribeTank(
    @MessageBody() data: { tankId: string },
    @ConnectedSocket() client: Socket
  ): void {
    if (data?.tankId) {
      client.leave(`tank:${data.tankId}`);
      console.log(`[WebSocket] Client unsubscribed from tank ${data.tankId}`);
    }
  }

  @SubscribeMessage('get_tank_configs')
  handleGetTankConfigs(): { type: string; configs: unknown[] } {
    return {
      type: 'tank_configs',
      configs: this.tankService.getTankConfigs(),
    };
  }

  @SubscribeMessage('ping')
  handlePing(): { type: string; timestamp: number } {
    return { type: 'pong', timestamp: Date.now() };
  }
}
