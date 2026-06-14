import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { ConfigService } from '../config/config.service';
import { SensorCleanedData } from '@vessel/shared';

@Injectable()
export class InfluxService implements OnModuleInit, OnModuleDestroy {
  private client: InfluxDB | null = null;
  private writeApi: ReturnType<InfluxDB['getWriteApi']> | null = null;
  private queryApi: ReturnType<InfluxDB['getQueryApi']> | null = null;
  private connected = false;

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.connect();
  }

  onModuleDestroy() {
    if (this.writeApi) {
      this.writeApi.close().catch((err) => {
        console.error('[InfluxDB] Error closing write API:', err);
      });
    }
  }

  private connect(): void {
    const { url, token, org, bucket } = this.config.influx;

    try {
      this.client = new InfluxDB({ url, token });
      this.writeApi = this.client.getWriteApi(org, bucket, 'ns');
      this.queryApi = this.client.getQueryApi(org);
      this.connected = true;

      console.log(`[InfluxDB] Connected to ${url}, org: ${org}, bucket: ${bucket}`);
    } catch (err) {
      console.error('[InfluxDB] Connection failed:', err);
      this.connected = false;
    }
  }

  writeSensorBatch(data: SensorCleanedData[]): void {
    if (!this.writeApi || !this.connected) {
      console.warn('[InfluxDB] Not connected, skipping write');
      return;
    }

    try {
      const points: Point[] = [];

      for (const item of data) {
        const timestamp = new Date(Math.floor(item.timestampUs / 1000));

        const basePoint = new Point('sensor_data')
          .tag('tankId', item.tankId)
          .timestamp(timestamp);

        points.push(
          basePoint
            .floatField('inclination_x', item.inclination.x)
            .floatField('inclination_y', item.inclination.y)
            .floatField('inclination_z', item.inclination.z)
        );

        points.push(
          new Point('sensor_data')
            .tag('tankId', item.tankId)
            .floatField('liquidLevel', item.liquidLevel)
            .floatField('pressure', item.pressure)
            .floatField('temperature', item.temperature)
            .floatField('signalQuality', item.signalQuality)
            .timestamp(timestamp)
        );

        for (let i = 0; i < item.stressWaveform.length; i++) {
          points.push(
            new Point('stress_waveform')
              .tag('tankId', item.tankId)
              .intField('sampleIndex', i)
              .floatField('value', item.stressWaveform[i])
              .timestamp(timestamp)
          );
        }
      }

      this.writeApi.writePoints(points);
      this.writeApi.flush();

      console.log(`[InfluxDB] Wrote ${points.length} points`);
    } catch (err) {
      console.error('[InfluxDB] Write error:', err);
    }
  }

  writeSloshingAnalysis(data: {
    tankId: string;
    timestampUs: number;
    severity: string;
    impactForce: number;
    stabilityIndex: number;
    waveHeight: number;
  }): void {
    if (!this.writeApi || !this.connected) return;

    try {
      const timestamp = new Date(Math.floor(data.timestampUs / 1000));
      const point = new Point('sloshing_analysis')
        .tag('tankId', data.tankId)
        .tag('severity', data.severity)
        .floatField('impactForce', data.impactForce)
        .floatField('stabilityIndex', data.stabilityIndex)
        .floatField('waveHeight', data.waveHeight)
        .timestamp(timestamp);

      this.writeApi.writePoint(point);
    } catch (err) {
      console.error('[InfluxDB] Sloshing analysis write error:', err);
    }
  }

  async queryHistoricalData(
    tankId: string,
    startTime: Date,
    endTime: Date
  ): Promise<Array<{ time: Date; value: number }>> {
    if (!this.queryApi) return [];

    const fluxQuery = `
      from(bucket: "${this.config.influx.bucket}")
        |> range(start: ${startTime.toISOString()}, stop: ${endTime.toISOString()})
        |> filter(fn: (r) => r._measurement == "sensor_data" and r.tankId == "${tankId}")
        |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
    `;

    try {
      const result = await this.queryApi.collectRows(fluxQuery);
      return result.map((row: any) => ({
        time: new Date(row._time),
        value: row._value,
      }));
    } catch (err) {
      console.error('[InfluxDB] Query error:', err);
      return [];
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
