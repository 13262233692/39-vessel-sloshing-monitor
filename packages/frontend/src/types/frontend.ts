import { SloshingSeverity, TriaxialInclination } from '@vessel/shared';

export interface TankStateData {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  dimensions: { length: number; width: number; height: number; maxLiquidVolume: number };
  lastUpdateUs: number;
  currentLevel: number;
  currentPressure: number;
  currentTemperature: number;
  inclination: TriaxialInclination;
  sloshingSeverity: SloshingSeverity;
  impactForce: number;
  stabilityIndex: number;
  fillingRatio: number;
}

export interface TankUpdateMessage {
  type: string;
  tankId: string;
  timestampUs: number;
  sensor: {
    inclination: TriaxialInclination;
    liquidLevel: number;
    pressure: number;
    temperature: number;
    stressWaveform: number[];
    signalQuality: number;
  };
  analysis: {
    severity: SloshingSeverity;
    impactForce: number;
    impactLocation: { x: number; y: number };
    stabilityIndex: number;
    naturalFrequency: number;
    waveHeight: number;
    wavePeriod: number;
    surfacePoints: number[];
    velocityField: Array<{ x: number; y: number; u: number; v: number }>;
  };
}

export interface AllTanksMessage {
  type: string;
  states: TankStateData[];
}

export interface SystemStatus {
  mqttConnected: boolean;
  influxConnected: boolean;
  messageRate: number;
  tankCount: number;
}

export interface RendererConfig {
  showVelocityField: boolean;
  showImpactZones: boolean;
  showWaveform: boolean;
  wireframeMode: boolean;
  antiAliasing: boolean;
  smoothingLevel: number;
}

export const DEFAULT_RENDERER_CONFIG: RendererConfig = {
  showVelocityField: true,
  showImpactZones: true,
  showWaveform: true,
  wireframeMode: false,
  antiAliasing: true,
  smoothingLevel: 0.7,
};
