export interface TriaxialInclination {
  x: number;
  y: number;
  z: number;
}

export interface DynamicStressPoint {
  t: number;
  value: number;
}

export interface SensorRawPayload {
  tankId: string;
  timestamp: number;
  inclination: TriaxialInclination;
  liquidLevel: number;
  stressWaveform: DynamicStressPoint[];
  pressure: number;
  temperature: number;
}

export interface SensorCleanedData {
  tankId: string;
  timestampUs: number;
  inclination: TriaxialInclination;
  liquidLevel: number;
  stressWaveform: Float32Array;
  pressure: number;
  temperature: number;
  signalQuality: number;
}

export const SENSOR_SAMPLE_RATE = 50;
export const STRESS_WAVEFORM_SAMPLES = 128;
export const SENSOR_TOPIC_PATTERN = 'vessel/tank/+/data';

export function parseSensorTopic(topic: string): { tankId: string } | null {
  const match = topic.match(/^vessel\/tank\/([^/]+)\/data$/);
  return match ? { tankId: match[1] } : null;
}

export function buildSensorTopic(tankId: string): string {
  return `vessel/tank/${tankId}/data`;
}
