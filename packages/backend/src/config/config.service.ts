import { Injectable } from '@nestjs/common';
import { TankConfig } from '@vessel/shared';

@Injectable()
export class ConfigService {
  readonly emqx = {
    host: process.env.EMQX_HOST || 'localhost',
    port: Number(process.env.EMQX_PORT) || 1883,
    username: process.env.EMQX_USERNAME || 'admin',
    password: process.env.EMQX_PASSWORD || 'public',
    wsPort: Number(process.env.EMQX_WS_PORT) || 8083,
  };

  readonly influx = {
    url: process.env.INFLUXDB_URL || 'http://localhost:8086',
    token: process.env.INFLUXDB_TOKEN || 'vessel-sloshing-token',
    org: process.env.INFLUXDB_ORG || 'vessel',
    bucket: process.env.INFLUXDB_BUCKET || 'sloshing',
  };

  readonly backend = {
    port: Number(process.env.BACKEND_PORT) || 3000,
    websocketPort: Number(process.env.WEBSOCKET_PORT) || 3001,
  };

  readonly mqtt = {
    topicPrefix: process.env.MQTT_TOPIC_PREFIX || 'vessel/tank',
    sampleRate: Number(process.env.SAMPLE_RATE) || 50,
  };

  readonly tankCount = Number(process.env.TANK_COUNT) || 4;

  readonly tankConfigs: TankConfig[] = this.generateTankConfigs();

  private generateTankConfigs(): TankConfig[] {
    const configs: TankConfig[] = [];
    const positions = [
      { x: -30, y: 0, z: 0 },
      { x: -10, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 30, y: 0, z: 0 },
    ];

    for (let i = 0; i < this.tankCount; i++) {
      configs.push({
        id: `tank-${i + 1}`,
        name: `液舱 ${i + 1}`,
        position: positions[i] || { x: 0, y: 0, z: 0 },
        dimensions: {
          length: 40,
          width: 25,
          height: 20,
          maxLiquidVolume: 40 * 25 * 20,
        },
        liquidType: 'LNG',
        fillingRatio: 0.65,
        sensorCount: 8,
        sensorPositions: this.generateSensorPositions(),
      });
    }

    return configs;
  }

  private generateSensorPositions(): Array<{ x: number; y: number; z: number }> {
    return [
      { x: 0, y: 0, z: 0 },
      { x: 0.8, y: 0, z: 0 },
      { x: 0, y: 0.8, z: 0 },
      { x: 0.8, y: 0.8, z: 0 },
      { x: 0, y: 0, z: 0.8 },
      { x: 0.8, y: 0, z: 0.8 },
      { x: 0, y: 0.8, z: 0.8 },
      { x: 0.8, y: 0.8, z: 0.8 },
    ];
  }

  getTankConfig(tankId: string): TankConfig | undefined {
    return this.tankConfigs.find((t) => t.id === tankId);
  }

  getAllTankConfigs(): TankConfig[] {
    return this.tankConfigs.slice();
  }
}
