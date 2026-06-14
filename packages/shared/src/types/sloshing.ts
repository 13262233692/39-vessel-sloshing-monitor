import { TriaxialInclination } from './sensor';
import { SloshingSeverity } from './tank';

export interface SloshingAnalysisResult {
  tankId: string;
  timestampUs: number;
  severity: SloshingSeverity;
  impactForce: number;
  impactLocation: { x: number; y: number };
  stabilityIndex: number;
  naturalFrequency: number;
  waveHeight: number;
  wavePeriod: number;
  surfacePoints: Float32Array;
  velocityField: Array<{ x: number; y: number; u: number; v: number }>;
}

export interface FreeSurfaceParameters {
  gravity: number;
  liquidDensity: number;
  tankLength: number;
  tankWidth: number;
  fillingHeight: number;
  viscosity: number;
  surfaceTension: number;
}

export interface WaveState {
  amplitude: number;
  frequency: number;
  phase: number;
  direction: number;
  damping: number;
}

export interface ImpactEvent {
  id: string;
  tankId: string;
  timestampUs: number;
  force: number;
  location: { x: number; y: number };
  duration: number;
  pressurePeak: number;
  severity: SloshingSeverity;
}

export const DEFAULT_SLOSHING_PARAMS: FreeSurfaceParameters = {
  gravity: 9.81,
  liquidDensity: 425,
  tankLength: 40,
  tankWidth: 25,
  fillingHeight: 15,
  viscosity: 0.00015,
  surfaceTension: 0.008,
};

export function calculateNaturalFrequency(
  params: FreeSurfaceParameters,
  mode: { n: number; m: number }
): number {
  const { gravity, tankLength, tankWidth, fillingHeight } = params;
  const k = Math.sqrt(
    Math.pow((mode.n * Math.PI) / tankLength, 2) +
    Math.pow((mode.m * Math.PI) / tankWidth, 2)
  );
  return Math.sqrt(gravity * k * Math.tanh(k * fillingHeight)) / (2 * Math.PI);
}

export function calculateFreeSurfaceElevation(
  x: number,
  y: number,
  t: number,
  params: FreeSurfaceParameters,
  inclination: TriaxialInclination,
  waveStates: WaveState[]
): number {
  let elevation = 0;

  const gx = params.gravity * Math.sin(inclination.x);
  const gy = params.gravity * Math.sin(inclination.y);

  const tiltSurface = -(gx * x + gy * y) / params.gravity;
  elevation += tiltSurface;

  for (const wave of waveStates) {
    const kx = (Math.PI / params.tankLength) * Math.cos(wave.direction);
    const ky = (Math.PI / params.tankWidth) * Math.sin(wave.direction);
    const omega = 2 * Math.PI * wave.frequency;
    const decay = Math.exp(-wave.damping * t);

    const waveElevation =
      wave.amplitude * decay *
      Math.sin(kx * x + ky * y - omega * t + wave.phase) *
      (1 + 0.1 * Math.sin(2 * omega * t + wave.phase * 0.5));

    elevation += waveElevation;
  }

  const breakingThreshold = params.tankWidth * 0.02;
  if (Math.abs(elevation) > breakingThreshold) {
    const excess = Math.abs(elevation) - breakingThreshold;
    elevation = Math.sign(elevation) * (breakingThreshold + Math.sqrt(excess * breakingThreshold));
  }

  return elevation;
}

export function calculateImpactForce(
  waveHeight: number,
  wavePeriod: number,
  liquidDensity: number,
  tankWidth: number
): number {
  const velocity = (2 * Math.PI * waveHeight) / wavePeriod;
  const impactArea = tankWidth * waveHeight * 0.5;
  return liquidDensity * velocity * velocity * impactArea * 0.5;
}

export function calculateStabilityIndex(
  gm: number,
  rollAngle: number,
  fillingRatio: number
): number {
  const gmEffect = Math.min(1, gm / 2.5);
  const rollEffect = Math.max(0, 1 - Math.abs(rollAngle) / 30);
  const fillingEffect = 1 - Math.abs(fillingRatio - 0.5) * 0.3;
  return (gmEffect * 0.5 + rollEffect * 0.35 + fillingEffect * 0.15);
}
