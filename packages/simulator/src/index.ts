import * as mqtt from 'mqtt';
import * as dotenv from 'dotenv';
import {
  SensorRawPayload,
  buildSensorTopic,
  STRESS_WAVEFORM_SAMPLES,
  DynamicStressPoint,
} from '@vessel/shared';

dotenv.config();

interface TankSimulatorState {
  tankId: string;
  baseLevel: number;
  basePressure: number;
  baseTemperature: number;
  wavePhase: number;
  rollAngle: number;
  pitchAngle: number;
  yawAngle: number;
  rollFrequency: number;
  pitchFrequency: number;
  stressNoiseAmplitude: number;
}

class MqttSimulator {
  private client: mqtt.MqttClient | null = null;
  private tanks: TankSimulatorState[] = [];
  private sampleInterval: NodeJS.Timeout | null = null;
  private stats = {
    messagesSent: 0,
    startTime: Date.now(),
    lastStatsUpdate: Date.now(),
    messagesInInterval: 0,
  };

  private readonly tankCount = Number(process.env.TANK_COUNT) || 4;
  private readonly sampleRate = Number(process.env.SAMPLE_RATE) || 50;
  private readonly waveIntensity = Number(process.env.WAVE_INTENSITY) || 1.0;
  private readonly severityLevel = process.env.SEVERITY_LEVEL || 'moderate';

  constructor() {
    this.initializeTanks();
  }

  private initializeTanks(): void {
    const severityMultiplier = this.getSeverityMultiplier();

    for (let i = 0; i < this.tankCount; i++) {
      this.tanks.push({
        tankId: `tank-${i + 1}`,
        baseLevel: 12 + Math.random() * 4,
        basePressure: 101.325 + Math.random() * 2,
        baseTemperature: -162 + Math.random() * 5,
        wavePhase: Math.random() * Math.PI * 2,
        rollAngle: 0,
        pitchAngle: 0,
        yawAngle: 0,
        rollFrequency: 0.1 + Math.random() * 0.1,
        pitchFrequency: 0.08 + Math.random() * 0.08,
        stressNoiseAmplitude: severityMultiplier * (0.5 + Math.random() * 0.5),
      });
    }
  }

  private getSeverityMultiplier(): number {
    switch (this.severityLevel) {
      case 'low': return 0.3;
      case 'moderate': return 0.7;
      case 'high': return 1.2;
      case 'extreme': return 2.0;
      default: return 0.7;
    }
  }

  async connect(): Promise<void> {
    const host = process.env.EMQX_HOST || 'localhost';
    const port = Number(process.env.EMQX_PORT) || 1883;
    const username = process.env.EMQX_USERNAME || 'admin';
    const password = process.env.EMQX_PASSWORD || 'public';

    const url = `mqtt://${host}:${port}`;
    console.log(`[Simulator] Connecting to ${url}...`);

    this.client = mqtt.connect(url, {
      username,
      password,
      clientId: `vessel-simulator-${Date.now()}`,
    });

    return new Promise((resolve, reject) => {
      this.client!.on('connect', () => {
        console.log(`[Simulator] Connected to ${url}`);
        console.log(`[Simulator] Simulating ${this.tankCount} tanks at ${this.sampleRate}Hz`);
        console.log(`[Simulator] Severity level: ${this.severityLevel}, Wave intensity: ${this.waveIntensity}`);
        this.startSimulation();
        resolve();
      });

      this.client!.on('error', (err) => {
        console.error(`[Simulator] Connection error:`, err);
        reject(err);
      });
    });
  }

  private startSimulation(): void {
    const intervalMs = 1000 / this.sampleRate;

    this.sampleInterval = setInterval(() => {
      const now = Date.now() / 1000;
      for (const tank of this.tanks) {
        const payload = this.generatePayload(tank, now);
        this.publishPayload(payload);
      }

      this.stats.messagesSent += this.tanks.length;
      this.stats.messagesInInterval += this.tanks.length;

      if (Date.now() - this.stats.lastStatsUpdate >= 5000) {
        this.logStats();
      }
    }, intervalMs);
  }

  private generatePayload(tank: TankSimulatorState, t: number): SensorRawPayload {
    const intensity = this.waveIntensity;

    tank.rollAngle = Math.sin(t * tank.rollFrequency * 2 * Math.PI + tank.wavePhase) * 15 * intensity;
    tank.pitchAngle = Math.sin(t * tank.pitchFrequency * 2 * Math.PI + tank.wavePhase + Math.PI / 3) * 10 * intensity;
    tank.yawAngle = Math.sin(t * 0.05 * 2 * Math.PI) * 5;

    const sloshEffect = Math.sin(t * 0.5 * 2 * Math.PI + tank.wavePhase) * 0.8 * intensity;
    const liquidLevel = tank.baseLevel + sloshEffect + (Math.random() - 0.5) * 0.1;

    const pressureWave = Math.sin(t * 2 * 2 * Math.PI + tank.wavePhase) * 5 * intensity;
    const pressure = tank.basePressure + pressureWave + (Math.random() - 0.5) * 0.2;

    const temperature = tank.baseTemperature + Math.sin(t * 0.1) * 0.5 + (Math.random() - 0.5) * 0.1;

    const stressWaveform: DynamicStressPoint[] = [];
    const baseFrequency = 50 + Math.random() * 30;
    const amplitude = tank.stressNoiseAmplitude * intensity;

    for (let i = 0; i < STRESS_WAVEFORM_SAMPLES; i++) {
      const sampleT = t + i * 0.001;
      const harmonic1 = Math.sin(sampleT * baseFrequency * 2 * Math.PI);
      const harmonic2 = 0.5 * Math.sin(sampleT * baseFrequency * 3 * 2 * Math.PI + tank.wavePhase);
      const harmonic3 = 0.25 * Math.sin(sampleT * baseFrequency * 5 * 2 * Math.PI);
      const noise = (Math.random() - 0.5) * 0.3;

      const value = amplitude * (harmonic1 + harmonic2 + harmonic3 + noise);
      stressWaveform.push({ t: sampleT, value });
    }

    return {
      tankId: tank.tankId,
      timestamp: Date.now(),
      inclination: {
        x: tank.rollAngle,
        y: tank.pitchAngle,
        z: tank.yawAngle,
      },
      liquidLevel,
      stressWaveform,
      pressure,
      temperature,
    };
  }

  private publishPayload(payload: SensorRawPayload): void {
    if (!this.client || !this.client.connected) return;

    const topic = buildSensorTopic(payload.tankId);
    this.client.publish(topic, JSON.stringify(payload), { qos: 1 });
  }

  private logStats(): void {
    const elapsed = (Date.now() - this.stats.lastStatsUpdate) / 1000;
    const rate = Math.round(this.stats.messagesInInterval / elapsed);
    const totalElapsed = (Date.now() - this.stats.startTime) / 1000;

    console.log(
      `[Simulator] Total: ${this.stats.messagesSent}, ` +
      `Rate: ${rate}/s, ` +
      `Running: ${totalElapsed.toFixed(1)}s`
    );

    this.stats.messagesInInterval = 0;
    this.stats.lastStatsUpdate = Date.now();
  }

  stop(): void {
    if (this.sampleInterval) {
      clearInterval(this.sampleInterval);
    }
    if (this.client) {
      this.client.end();
    }
    console.log(`[Simulator] Stopped. Total messages: ${this.stats.messagesSent}`);
  }
}

const simulator = new MqttSimulator();

process.on('SIGINT', () => {
  console.log('\n[Simulator] Received SIGINT, stopping...');
  simulator.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Simulator] Received SIGTERM, stopping...');
  simulator.stop();
  process.exit(0);
});

simulator.connect().catch((err) => {
  console.error('[Simulator] Failed to start:', err);
  process.exit(1);
});
