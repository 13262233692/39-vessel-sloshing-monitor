import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { connect, MqttClient } from 'mqtt';
import { ConfigService } from '../config/config.service';
import { Subject } from 'rxjs';
import { SensorRawPayload, parseSensorTopic, SENSOR_TOPIC_PATTERN } from '@vessel/shared';

@Injectable()
export class MqttService implements OnModuleInit, OnModuleDestroy {
  private client: MqttClient | null = null;
  private readonly messageSubject = new Subject<{ topic: string; payload: SensorRawPayload }>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  readonly messages$ = this.messageSubject.asObservable();

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    if (this.client) {
      this.client.end();
    }
    this.messageSubject.complete();
  }

  private async connect(): Promise<void> {
    const { host, port, username, password } = this.config.emqx;
    const url = `mqtt://${host}:${port}`;

    console.log(`[MQTT] Connecting to ${url}...`);

    this.client = connect(url, {
      username,
      password,
      clientId: `vessel-backend-${Date.now()}`,
      clean: false,
      reconnectPeriod: 1000,
      connectTimeout: 5000,
    });

    this.client.on('connect', () => {
      console.log(`[MQTT] Connected to ${url}`);
      this.reconnectAttempts = 0;
      this.subscribeToTopics();
    });

    this.client.on('reconnect', () => {
      this.reconnectAttempts++;
      console.log(`[MQTT] Reconnecting... Attempt ${this.reconnectAttempts}`);
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error(`[MQTT] Max reconnection attempts reached`);
      }
    });

    this.client.on('error', (err) => {
      console.error(`[MQTT] Connection error:`, err.message);
    });

    this.client.on('close', () => {
      console.warn(`[MQTT] Connection closed`);
    });

    this.client.on('message', (topic, message) => {
      try {
        const payload = JSON.parse(message.toString()) as SensorRawPayload;
        this.messageSubject.next({ topic, payload });
      } catch (err) {
        console.error(`[MQTT] Failed to parse message from ${topic}:`, err);
      }
    });
  }

  private subscribeToTopics(): void {
    if (!this.client) return;

    const topic = SENSOR_TOPIC_PATTERN;
    this.client.subscribe(topic, { qos: 1 }, (err) => {
      if (err) {
        console.error(`[MQTT] Failed to subscribe to ${topic}:`, err);
      } else {
        console.log(`[MQTT] Subscribed to ${topic}`);
      }
    });

    for (let i = 1; i <= this.config.tankCount; i++) {
      const tankTopic = `vessel/tank/tank-${i}/data`;
      this.client.subscribe(tankTopic, { qos: 1 });
    }
  }

  publish(topic: string, payload: unknown, qos: 0 | 1 | 2 = 1): void {
    if (!this.client || !this.client.connected) {
      console.warn(`[MQTT] Not connected, cannot publish to ${topic}`);
      return;
    }

    this.client.publish(topic, JSON.stringify(payload), { qos });
  }

  getConnectionStatus(): { connected: boolean; reconnectAttempts: number } {
    return {
      connected: this.client?.connected || false,
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}
