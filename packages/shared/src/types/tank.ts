export interface TankDimensions {
  length: number;
  width: number;
  height: number;
  maxLiquidVolume: number;
}

export interface TankConfig {
  id: string;
  name: string;
  position: { x: number; y: number; z: number };
  dimensions: TankDimensions;
  liquidType: 'LNG' | 'LOX' | 'LN2' | 'FUEL_OIL' | 'OTHER';
  fillingRatio: number;
  sensorCount: number;
  sensorPositions: Array<{ x: number; y: number; z: number }>;
}

export interface TankState {
  id: string;
  config: TankConfig;
  lastUpdateUs: number;
  currentLevel: number;
  currentPressure: number;
  currentTemperature: number;
  inclination: { x: number; y: number; z: number };
  sloshingSeverity: SloshingSeverity;
  impactForce: number;
  stabilityIndex: number;
}

export enum SloshingSeverity {
  NONE = 'none',
  LOW = 'low',
  MODERATE = 'moderate',
  HIGH = 'high',
  CRITICAL = 'critical',
  EXTREME = 'extreme',
}

export function getSeverityColor(severity: SloshingSeverity): string {
  switch (severity) {
    case SloshingSeverity.NONE: return '#00ff88';
    case SloshingSeverity.LOW: return '#88ff00';
    case SloshingSeverity.MODERATE: return '#ffcc00';
    case SloshingSeverity.HIGH: return '#ff6600';
    case SloshingSeverity.CRITICAL: return '#ff0000';
    case SloshingSeverity.EXTREME: return '#ff00ff';
    default: return '#00ff88';
  }
}

export function calculateSloshingSeverity(
  impactForce: number,
  stabilityIndex: number,
  fillingRatio: number
): SloshingSeverity {
  const normalizedImpact = impactForce / 1000;
  const riskScore = normalizedImpact * (1 - stabilityIndex) * (fillingRatio > 0.2 && fillingRatio < 0.8 ? 1.5 : 1);

  if (riskScore < 0.1) return SloshingSeverity.NONE;
  if (riskScore < 0.25) return SloshingSeverity.LOW;
  if (riskScore < 0.45) return SloshingSeverity.MODERATE;
  if (riskScore < 0.65) return SloshingSeverity.HIGH;
  if (riskScore < 0.85) return SloshingSeverity.CRITICAL;
  return SloshingSeverity.EXTREME;
}
