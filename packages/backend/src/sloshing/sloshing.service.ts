import { Injectable, Logger } from '@nestjs/common';
import {
  SensorCleanedData,
  SloshingAnalysisResult,
  WaveState,
  FreeSurfaceParameters,
  calculateNaturalFrequency,
  calculateFreeSurfaceElevation,
  calculateImpactForce,
  calculateStabilityIndex,
  calculateSloshingSeverity,
  DEFAULT_SLOSHING_PARAMS,
  SloshingSeverity,
} from '@vessel/shared';
import { TankService } from '../tank/tank.service';
import { InfluxService } from '../influx/influx.service';
import { WorkerPoolService } from '../worker/worker-pool.service';
import { MatrixTask } from '../worker/matrix.worker';

export interface AdvancedAnalysisResult {
  gzCurve?: {
    angles: number[];
    gz: number[];
    maxGZ: number;
    angleOfMaxGZ: number;
    range: number;
  };
  stabilitySensitivities?: Array<{
    param: string;
    sensitivity: number;
    partialDerivative: number;
  }>;
  jacobian?: number[][];
}

interface TankAnalysisState {
  waveStates: WaveState[];
  startTime: number;
  lastWaveHeight: number;
  maxImpactForce: number;
  lastAdvancedAnalysisAt: number;
  advancedAnalysisIntervalMs: number;
  severity: SloshingSeverity;
  lastAdvancedResult?: AdvancedAnalysisResult;
}

const SEVERITY_TO_ADVANCED_INTERVAL: { [K in SloshingSeverity]: number } = {
  [SloshingSeverity.NONE]: 2000,
  [SloshingSeverity.LOW]: 1000,
  [SloshingSeverity.MODERATE]: 500,
  [SloshingSeverity.HIGH]: 200,
  [SloshingSeverity.CRITICAL]: 100,
  [SloshingSeverity.EXTREME]: 50,
};

@Injectable()
export class SloshingService {
  private readonly logger = new Logger(SloshingService.name);
  private analysisStates = new Map<string, TankAnalysisState>();
  private readonly SURFACE_SAMPLE_COUNT = 100;
  private readonly SURFACE_SMOOTHING = 0.3;

  private advancedAnalysisCallbacks = new Map<
    string,
    Array<(tankId: string, result: AdvancedAnalysisResult) => void>
  >();

  constructor(
    private tankService: TankService,
    private influx: InfluxService,
    private workerPool: WorkerPoolService,
  ) {}

  onAdvancedAnalysis(
    tankId: string,
    cb: (tankId: string, result: AdvancedAnalysisResult) => void
  ): () => void {
    const list = this.advancedAnalysisCallbacks.get(tankId) || [];
    list.push(cb);
    this.advancedAnalysisCallbacks.set(tankId, list);
    return () => {
      const arr = this.advancedAnalysisCallbacks.get(tankId);
      if (arr) {
        const idx = arr.indexOf(cb);
        if (idx > -1) arr.splice(idx, 1);
      }
    };
  }

  analyze(data: SensorCleanedData): SloshingAnalysisResult {
    const tankConfig = this.tankService.getTankState(data.tankId)?.config;
    if (!tankConfig) {
      throw new Error(`Tank ${data.tankId} not found`);
    }

    let state = this.analysisStates.get(data.tankId);
    if (!state) {
      state = this.initializeAnalysisState(data.tankId);
      this.analysisStates.set(data.tankId, state);
    }

    const { dimensions, fillingRatio } = tankConfig;

    const params: FreeSurfaceParameters = {
      ...DEFAULT_SLOSHING_PARAMS,
      tankLength: dimensions.length,
      tankWidth: dimensions.width,
      fillingHeight: data.liquidLevel,
      liquidDensity: this.getLiquidDensity(tankConfig.liquidType),
    };

    this.updateWaveStates(state, data, params);

    const t = (data.timestampUs - state.startTime) / 1e6;
    const surfacePoints = this.calculateSurfacePoints(t, params, data);

    const waveHeight = this.calculateWaveHeight(surfacePoints);
    const wavePeriod = this.calculateWavePeriod(state);
    const naturalFrequency = calculateNaturalFrequency(params, { n: 1, m: 0 });

    const impactForce = calculateImpactForce(
      waveHeight,
      wavePeriod,
      params.liquidDensity,
      params.tankWidth
    );

    const gm = 2.0 - Math.abs(data.inclination.x) * 0.05;
    const stabilityIndex = calculateStabilityIndex(gm, data.inclination.x, fillingRatio);

    const severity = calculateSloshingSeverity(impactForce, stabilityIndex, fillingRatio);
    state.severity = severity;
    state.advancedAnalysisIntervalMs = SEVERITY_TO_ADVANCED_INTERVAL[severity];

    const impactLocation = this.findImpactLocation(surfacePoints, params);
    const velocityField = this.calculateVelocityFieldLight(t, params, data);

    state.lastWaveHeight = waveHeight;
    state.maxImpactForce = Math.max(state.maxImpactForce, impactForce);

    this.tankService.updateSloshingAnalysis(data.tankId, severity, impactForce, stabilityIndex);

    this.influx.writeSloshingAnalysis({
      tankId: data.tankId,
      timestampUs: data.timestampUs,
      severity,
      impactForce,
      stabilityIndex,
      waveHeight,
    });

    this.maybeScheduleAdvancedAnalysis(data.tankId, state, data, params, gm, fillingRatio);

    return {
      tankId: data.tankId,
      timestampUs: data.timestampUs,
      severity,
      impactForce,
      impactLocation,
      stabilityIndex,
      naturalFrequency,
      waveHeight,
      wavePeriod,
      surfacePoints,
      velocityField,
    };
  }

  getLastAdvancedResult(tankId: string): AdvancedAnalysisResult | undefined {
    return this.analysisStates.get(tankId)?.lastAdvancedResult;
  }

  private maybeScheduleAdvancedAnalysis(
    tankId: string,
    state: TankAnalysisState,
    data: SensorCleanedData,
    params: FreeSurfaceParameters,
    gm: number,
    fillingRatio: number
  ): void {
    const now = Date.now();
    if (now - state.lastAdvancedAnalysisAt < state.advancedAnalysisIntervalMs) {
      return;
    }
    state.lastAdvancedAnalysisAt = now;

    const priority = this.severityToPriority(state.severity);

    const gzTask: MatrixTask = {
      id: `gz-${tankId}-${now}`,
      type: 'gzCurve',
      payload: {
        gm,
        displacement: 200000,
        beam: params.tankWidth * 1.2,
        kb: params.fillingHeight * 0.5,
        bm: params.tankWidth * 0.6,
        fillingRatio,
        freeSurfaceEffect: 0.15 + state.lastWaveHeight * 0.05,
        sloshingMoment: state.maxImpactForce * params.tankWidth * 0.3,
      },
    };

    const sensitivityTask: MatrixTask = {
      id: `sens-${tankId}-${now}`,
      type: 'stabilitySensitivity',
      payload: {
        gzParams: gzTask.payload,
        perturbations: {
          gm: 0.05,
          fillingRatio: 0.02,
          freeSurfaceEffect: 0.02,
          sloshingMoment: 1e4,
          beam: 0.1,
        },
      },
    };

    Promise.all([
      this.workerPool.submit(gzTask, { priority, tankId, timeoutMs: 3000 }),
      this.workerPool.submit(sensitivityTask, { priority, tankId, timeoutMs: 3000 }),
    ])
      .then(([gzResult, sensResult]) => {
        if (!gzResult.success || !sensResult.success) {
          this.logger.warn(
            `Advanced analysis partially failed for tank ${tankId}: gz=${gzResult.error}, sens=${sensResult.error}`
          );
        }

        const advanced: AdvancedAnalysisResult = {
          gzCurve: gzResult.success ? gzResult.data : state.lastAdvancedResult?.gzCurve,
          stabilitySensitivities: sensResult.success
            ? sensResult.data.sensitivities
            : state.lastAdvancedResult?.stabilitySensitivities,
        };

        state.lastAdvancedResult = advanced;

        const cbs = this.advancedAnalysisCallbacks.get(tankId);
        if (cbs) {
          for (const cb of cbs) {
            try {
              cb(tankId, advanced);
            } catch (err: any) {
              this.logger.error(`Advanced analysis callback error: ${err.message}`);
            }
          }
        }
      })
      .catch((err) => {
        this.logger.error(`Advanced analysis error for tank ${tankId}: ${err.message}`);
      });
  }

  private severityToPriority(severity: SloshingSeverity): 'low' | 'normal' | 'high' | 'critical' {
    switch (severity) {
      case SloshingSeverity.EXTREME:
      case SloshingSeverity.CRITICAL:
        return 'critical';
      case SloshingSeverity.HIGH:
        return 'high';
      case SloshingSeverity.MODERATE:
        return 'normal';
      default:
        return 'low';
    }
  }

  private initializeAnalysisState(tankId: string): TankAnalysisState {
    return {
      waveStates: [
        { amplitude: 0.1, frequency: 0.8, phase: Math.random() * Math.PI * 2, direction: 0, damping: 0.02 },
        { amplitude: 0.05, frequency: 1.2, phase: Math.random() * Math.PI * 2, direction: Math.PI / 4, damping: 0.03 },
        { amplitude: 0.03, frequency: 0.5, phase: Math.random() * Math.PI * 2, direction: Math.PI / 2, damping: 0.015 },
      ],
      startTime: Date.now() * 1000,
      lastWaveHeight: 0,
      maxImpactForce: 0,
      lastAdvancedAnalysisAt: 0,
      advancedAnalysisIntervalMs: 1000,
      severity: SloshingSeverity.NONE,
    };
  }

  private updateWaveStates(
    state: TankAnalysisState,
    data: SensorCleanedData,
    params: FreeSurfaceParameters
  ): void {
    const excitationMagnitude = Math.sqrt(
      data.inclination.x ** 2 + data.inclination.y ** 2
    );

    for (const wave of state.waveStates) {
      const naturalFreq = calculateNaturalFrequency(params, { n: 1, m: 0 });
      const freqRatio = wave.frequency / naturalFreq;

      const resonanceGain = 1 / Math.sqrt((1 - freqRatio ** 2) ** 2 + (0.05 * freqRatio) ** 2);
      const targetAmplitude = excitationMagnitude * resonanceGain * params.tankWidth * 0.002;

      wave.amplitude += (targetAmplitude - wave.amplitude) * 0.1;

      if (Math.abs(data.inclination.x) > 5) {
        wave.frequency = naturalFreq * (0.8 + Math.random() * 0.4);
      }

      wave.phase += 0.02 * excitationMagnitude;
    }
  }

  private calculateSurfacePoints(
    t: number,
    params: FreeSurfaceParameters,
    data: SensorCleanedData
  ): Float32Array {
    const points = new Float32Array(this.SURFACE_SAMPLE_COUNT);
    const state = this.analysisStates.get(data.tankId)!;
    const s = this.SURFACE_SMOOTHING;

    for (let i = 0; i < this.SURFACE_SAMPLE_COUNT; i++) {
      const x = (i / (this.SURFACE_SAMPLE_COUNT - 1) - 0.5) * params.tankLength;
      const y = 0;
      let val = calculateFreeSurfaceElevation(x, y, t, params, data.inclination, state.waveStates);

      if (i >= 2) {
        val = s * val + (1 - s) * points[i - 1];
      }

      points[i] = val;
    }

    return points;
  }

  private calculateWaveHeight(surfacePoints: Float32Array): number {
    let min = Infinity;
    let max = -Infinity;

    for (let i = 0; i < surfacePoints.length; i++) {
      min = Math.min(min, surfacePoints[i]);
      max = Math.max(max, surfacePoints[i]);
    }

    return max - min;
  }

  private calculateWavePeriod(state: TankAnalysisState): number {
    if (state.waveStates.length === 0) return 1;
    const dominantWave = state.waveStates.reduce((a, b) =>
      a.amplitude > b.amplitude ? a : b
    );
    return 1 / dominantWave.frequency;
  }

  private findImpactLocation(
    surfacePoints: Float32Array,
    params: FreeSurfaceParameters
  ): { x: number; y: number } {
    let maxSlope = 0;
    let impactIndex = 0;

    for (let i = 1; i < surfacePoints.length - 1; i++) {
      const slope = Math.abs(surfacePoints[i + 1] - surfacePoints[i - 1]);
      if (slope > maxSlope) {
        maxSlope = slope;
        impactIndex = i;
      }
    }

    const x = (impactIndex / (surfacePoints.length - 1) - 0.5) * params.tankLength;
    return { x, y: params.tankWidth / 2 };
  }

  private calculateVelocityFieldLight(
    t: number,
    params: FreeSurfaceParameters,
    data: SensorCleanedData
  ): Array<{ x: number; y: number; u: number; v: number }> {
    const field: Array<{ x: number; y: number; u: number; v: number }> = [];
    const state = this.analysisStates.get(data.tankId)!;
    const gridSize = 4;

    for (let i = 0; i <= gridSize; i++) {
      for (let j = 0; j <= gridSize; j++) {
        const x = (i / gridSize - 0.5) * params.tankLength;
        const y = (j / gridSize - 0.5) * params.tankWidth;

        let u = 0;
        let v = 0;

        for (const wave of state.waveStates) {
          const kx = (Math.PI / params.tankLength) * Math.cos(wave.direction);
          const ky = (Math.PI / params.tankWidth) * Math.sin(wave.direction);
          const omega = 2 * Math.PI * wave.frequency;
          const decay = Math.exp(-wave.damping * t);

          const phase = kx * x + ky * y - omega * t + wave.phase;
          const amplitude = wave.amplitude * decay;

          const kNorm = kx * kx + ky * ky + 1e-9;
          u += amplitude * omega * Math.cos(phase) * (kx / kNorm);
          v += amplitude * omega * Math.cos(phase) * (ky / kNorm);
        }

        u += data.inclination.y * 0.1;
        v -= data.inclination.x * 0.1;

        field.push({ x, y, u, v });
      }
    }

    return field;
  }

  private getLiquidDensity(type: string): number {
    switch (type) {
      case 'LNG': return 425;
      case 'LOX': return 1141;
      case 'LN2': return 807;
      case 'FUEL_OIL': return 900;
      default: return 1000;
    }
  }

  getAnalysisState(tankId: string): TankAnalysisState | undefined {
    return this.analysisStates.get(tankId);
  }
}
