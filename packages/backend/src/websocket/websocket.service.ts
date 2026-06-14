import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';
import { SensorCleanedData, SloshingAnalysisResult, TankState } from '@vessel/shared';

export interface AdvancedAnalysisPayload {
  tankId: string;
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
}

@Injectable()
export class WebsocketService {
  private io: Server | null = null;
  private stats = {
    messagesSent: 0,
    clientsConnected: 0,
  };

  setServer(io: Server): void {
    this.io = io;
  }

  broadcastTankData(sensorData: SensorCleanedData, analysis: SloshingAnalysisResult): void {
    if (!this.io) return;

    const message = {
      type: 'tank_update',
      tankId: sensorData.tankId,
      timestampUs: sensorData.timestampUs,
      sensor: {
        inclination: sensorData.inclination,
        liquidLevel: sensorData.liquidLevel,
        pressure: sensorData.pressure,
        temperature: sensorData.temperature,
        stressWaveform: Array.from(sensorData.stressWaveform),
        signalQuality: sensorData.signalQuality,
      },
      analysis: {
        severity: analysis.severity,
        impactForce: analysis.impactForce,
        impactLocation: analysis.impactLocation,
        stabilityIndex: analysis.stabilityIndex,
        naturalFrequency: analysis.naturalFrequency,
        waveHeight: analysis.waveHeight,
        wavePeriod: analysis.wavePeriod,
        surfacePoints: Array.from(analysis.surfacePoints),
        velocityField: analysis.velocityField,
      },
    };

    this.io.to(`tank:${sensorData.tankId}`).emit('tank_data', message);
    this.io.emit('tank_update', message);
    this.stats.messagesSent++;
  }

  broadcastAllTankStates(states: TankState[]): void {
    if (!this.io) return;

    this.io.emit('all_tanks', {
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

  broadcastSystemStatus(status: {
    mqttConnected: boolean;
    influxConnected: boolean;
    messageRate: number;
    tankCount: number;
  }): void {
    if (!this.io) return;
    this.io.emit('system_status', status);
  }

  broadcastAdvancedAnalysis(tankId: string, payload: AdvancedAnalysisPayload): void {
    if (!this.io) return;
    const message = { type: 'advanced_analysis', ...payload, tankId };
    this.io.to(`tank:${tankId}`).emit('advanced_analysis', message);
    this.io.emit('advanced_analysis', message);
    this.stats.messagesSent++;
  }

  broadcastWorkerMetrics(metrics: any): void {
    if (!this.io) return;
    this.io.emit('worker_metrics', { type: 'worker_metrics', ...metrics, timestamp: Date.now() });
  }

  broadcastBallastControl(decision: any): void {
    if (!this.io) return;
    this.io.emit('ballast_control', { type: 'ballast_control', ...decision });
    this.stats.messagesSent++;
  }

  clientConnected(): void {
    this.stats.clientsConnected++;
    console.log(`[WebSocket] Client connected. Total: ${this.stats.clientsConnected}`);
  }

  clientDisconnected(): void {
    this.stats.clientsConnected = Math.max(0, this.stats.clientsConnected - 1);
    console.log(`[WebSocket] Client disconnected. Total: ${this.stats.clientsConnected}`);
  }

  getStats() {
    return { ...this.stats };
  }
}
