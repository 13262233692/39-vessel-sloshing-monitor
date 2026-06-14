import { Injectable, OnModuleInit } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { DataPipelineService } from '../data-pipeline/data-pipeline.service';
import { parseSensorTopic } from '@vessel/shared';

@Injectable()
export class MqttSubscriber implements OnModuleInit {
  private stats = {
    messagesReceived: 0,
    messagesPerSecond: 0,
    lastStatsUpdate: Date.now(),
    tankStats: new Map<string, number>(),
  };

  constructor(
    private mqttService: MqttService,
    private dataPipeline: DataPipelineService,
  ) {}

  onModuleInit() {
    this.mqttService.messages$.subscribe(({ topic, payload }) => {
      const parsed = parseSensorTopic(topic);
      if (!parsed) return;

      this.stats.messagesReceived++;
      const count = this.stats.tankStats.get(parsed.tankId) || 0;
      this.stats.tankStats.set(parsed.tankId, count + 1);

      this.updateStats();
      this.dataPipeline.ingest(payload);
    });

    setInterval(() => this.logStats(), 5000);
  }

  private updateStats(): void {
    const now = Date.now();
    const elapsed = (now - this.stats.lastStatsUpdate) / 1000;
    if (elapsed >= 1) {
      this.stats.messagesPerSecond = Math.round(this.stats.messagesReceived / elapsed);
      this.stats.lastStatsUpdate = now;
    }
  }

  private logStats(): void {
    const tankStatsArray = Array.from(this.stats.tankStats.entries())
      .map(([tankId, count]) => `${tankId}: ${count}`)
      .join(', ');

    console.log(
      `[MQTT Stats] Total: ${this.stats.messagesReceived}, ` +
      `Rate: ${this.stats.messagesPerSecond}/s, ` +
      `Per tank: [${tankStatsArray}]`
    );
  }

  getStats() {
    return {
      ...this.stats,
      tankStats: Object.fromEntries(this.stats.tankStats),
      connectionStatus: this.mqttService.getConnectionStatus(),
    };
  }
}
