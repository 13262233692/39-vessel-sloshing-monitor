import { Injectable } from '@nestjs/common';
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
} from '@vessel/shared';
import { TankService } from '../tank/tank.service';
import { InfluxService } from '../influx/influx.service';

interface TankAnalysisState {
  waveStates: WaveState[];
  startTime: number;
  lastWaveHeight: number;
  maxImpactForce: number;
}

@Injectable()
export class SloshingService {
  private analysisStates = new Map<string, TankAnalysisState>();
  private readonly SURFACE_SAMPLE_COUNT = 100;

  constructor(
    private tankService: TankService,
    private influx: InfluxService,
  ) {}

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

    const impactLocation = this.findImpactLocation(surfacePoints, params);

    const velocityField = this.calculateVelocityField(t, params, data);

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

    for (let i = 0; i < this.SURFACE_SAMPLE_COUNT; i++) {
      const x = (i / (this.SURFACE_SAMPLE_COUNT - 1) - 0.5) * params.tankLength;
      const y = 0;
      points[i] = calculateFreeSurfaceElevation(x, y, t, params, data.inclination, state.waveStates);
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

  private calculateVelocityField(
    t: number,
    params: FreeSurfaceParameters,
    data: SensorCleanedData
  ): Array<{ x: number; y: number; u: number; v: number }> {
    const field: Array<{ x: number; y: number; u: number; v: number }> = [];
    const state = this.analysisStates.get(data.tankId)!;
    const gridSize = 5;

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

          u += amplitude * omega * Math.cos(phase) * (kx / (kx * kx + ky * ky));
          v += amplitude * omega * Math.cos(phase) * (ky / (kx * kx + ky * ky));
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
