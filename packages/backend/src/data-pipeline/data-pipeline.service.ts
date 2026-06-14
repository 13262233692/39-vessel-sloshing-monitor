import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SensorRawPayload, SensorCleanedData, STRESS_WAVEFORM_SAMPLES } from '@vessel/shared';
import { InfluxService } from '../influx/influx.service';
import { TankService } from '../tank/tank.service';
import { SloshingService, AdvancedAnalysisResult } from '../sloshing/sloshing.service';
import { WebsocketService } from '../websocket/websocket.service';
import { ConfigService } from '../config/config.service';
import { WorkerPoolService } from '../worker/worker-pool.service';

interface BatchItem {
  data: SensorCleanedData;
  timestamp: number;
}

@Injectable()
export class DataPipelineService implements OnModuleInit, OnModuleDestroy {
  private readonly batchSize = 100;
  private readonly flushInterval = 10;
  private batchMap = new Map<string, BatchItem[]>();
  private flushTimer: NodeJS.Timeout | null = null;
  private stats = {
    ingested: 0,
    cleaned: 0,
    dropped: 0,
    batchesWritten: 0,
    lastStatsUpdate: Date.now(),
  };

  private cleanupFns: Array<() => void> = [];
  private metricsTimer: NodeJS.Timeout | null = null;

  constructor(
    private influx: InfluxService,
    private tankService: TankService,
    private sloshingService: SloshingService,
    private websocket: WebsocketService,
    private config: ConfigService,
    private workerPool: WorkerPoolService,
  ) {}

  onModuleInit() {
    this.flushTimer = setInterval(() => this.flushAll(), this.flushInterval);
    setInterval(() => this.logStats(), 10000);

    this.metricsTimer = setInterval(() => {
      const metrics = this.workerPool.getMetrics();
      this.websocket.broadcastWorkerMetrics(metrics);
    }, 2000);

    const tankConfigs = this.config.getAllTankConfigs();
    for (const cfg of tankConfigs) {
      const unsub = this.sloshingService.onAdvancedAnalysis(
        cfg.id,
        (tankId: string, result: AdvancedAnalysisResult) => {
          this.websocket.broadcastAdvancedAnalysis(tankId, {
            tankId,
            gzCurve: result.gzCurve,
            stabilitySensitivities: result.stabilitySensitivities,
          });
        }
      );
      this.cleanupFns.push(unsub);
    }
  }

  onModuleDestroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
    }
    for (const fn of this.cleanupFns) {
      try { fn(); } catch (_) {}
    }
    this.cleanupFns = [];
    this.flushAll();
  }

  ingest(raw: SensorRawPayload): void {
    this.stats.ingested++;

    const cleaned = this.cleanData(raw);
    if (!cleaned) {
      this.stats.dropped++;
      return;
    }

    this.stats.cleaned++;

    const tankBatch = this.batchMap.get(cleaned.tankId) || [];
    tankBatch.push({ data: cleaned, timestamp: Date.now() });
    this.batchMap.set(cleaned.tankId, tankBatch);

    this.tankService.updateFromSensorData(cleaned);
    const analysis = this.sloshingService.analyze(cleaned);
    this.websocket.broadcastTankData(cleaned, analysis);

    if (tankBatch.length >= this.batchSize) {
      this.flushBatch(cleaned.tankId);
    }
  }

  private cleanData(raw: SensorRawPayload): SensorCleanedData | null {
    if (!raw || !raw.tankId) {
      return null;
    }

    const tankConfig = this.config.getTankConfig(raw.tankId);
    if (!tankConfig) {
      return null;
    }

    const { dimensions } = tankConfig;

    let signalQuality = 1;

    const inclination = {
      x: this.clamp(this.sanitize(raw.inclination?.x, 0), -45, 45),
      y: this.clamp(this.sanitize(raw.inclination?.y, 0), -45, 45),
      z: this.clamp(this.sanitize(raw.inclination?.z, 0), -180, 180),
    };

    const maxLevel = dimensions.height;
    let liquidLevel = this.clamp(this.sanitize(raw.liquidLevel, 0), 0, maxLevel);
    if (liquidLevel < 0 || liquidLevel > maxLevel) {
      signalQuality *= 0.8;
    }

    const pressure = this.sanitize(raw.pressure, 101.325);
    const temperature = this.clamp(this.sanitize(raw.temperature, 25), -200, 100);

    const stressWaveform = new Float32Array(STRESS_WAVEFORM_SAMPLES);
    if (raw.stressWaveform && Array.isArray(raw.stressWaveform)) {
      const len = Math.min(raw.stressWaveform.length, STRESS_WAVEFORM_SAMPLES);
      for (let i = 0; i < len; i++) {
        const val = raw.stressWaveform[i]?.value ?? 0;
        stressWaveform[i] = this.sanitize(val, 0);
      }
      if (len < STRESS_WAVEFORM_SAMPLES * 0.5) {
        signalQuality *= 0.7;
      }
    } else {
      signalQuality *= 0.5;
    }

    const timestampUs = this.getMicrosecondTimestamp();

    return {
      tankId: raw.tankId,
      timestampUs,
      inclination,
      liquidLevel,
      stressWaveform,
      pressure,
      temperature,
      signalQuality,
    };
  }

  private sanitize(value: number | undefined | null, fallback: number): number {
    if (value === undefined || value === null || Number.isNaN(value) || !Number.isFinite(value)) {
      return fallback;
    }
    return value;
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private getMicrosecondTimestamp(): number {
    const now = Date.now();
    const [seconds, nanoseconds] = process.hrtime();
    return now * 1000 + Math.floor(nanoseconds / 1000);
  }

  private flushBatch(tankId: string): void {
    const batch = this.batchMap.get(tankId);
    if (!batch || batch.length === 0) return;

    this.influx.writeSensorBatch(batch.map((b) => b.data));
    this.stats.batchesWritten++;
    this.batchMap.set(tankId, []);
  }

  private flushAll(): void {
    for (const tankId of this.batchMap.keys()) {
      this.flushBatch(tankId);
    }
  }

  private logStats(): void {
    const now = Date.now();
    const elapsed = (now - this.stats.lastStatsUpdate) / 1000;
    const ingestRate = Math.round(this.stats.ingested / elapsed);

    console.log(
      `[Data Pipeline] Ingested: ${this.stats.ingested}, ` +
      `Cleaned: ${this.stats.cleaned}, ` +
      `Dropped: ${this.stats.dropped}, ` +
      `Rate: ${ingestRate}/s, ` +
      `Batches: ${this.stats.batchesWritten}`
    );

    this.stats.ingested = 0;
    this.stats.cleaned = 0;
    this.stats.dropped = 0;
    this.stats.batchesWritten = 0;
    this.stats.lastStatsUpdate = now;
  }
}
