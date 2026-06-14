import { Injectable, OnModuleInit } from '@nestjs/common';
import { SensorCleanedData } from '@vessel/shared';
import { TankState, SloshingSeverity } from '@vessel/shared';
import { ConfigService } from '../config/config.service';

@Injectable()
export class TankService implements OnModuleInit {
  private tankStates = new Map<string, TankState>();

  constructor(private config: ConfigService) {}

  onModuleInit() {
    this.initializeTankStates();
  }

  private initializeTankStates(): void {
    for (const config of this.config.tankConfigs) {
      this.tankStates.set(config.id, {
        id: config.id,
        config,
        lastUpdateUs: 0,
        currentLevel: config.dimensions.height * config.fillingRatio,
        currentPressure: 101.325,
        currentTemperature: 25,
        inclination: { x: 0, y: 0, z: 0 },
        sloshingSeverity: SloshingSeverity.NONE,
        impactForce: 0,
        stabilityIndex: 1.0,
      });
    }

    console.log(`[Tank Service] Initialized ${this.tankStates.size} tanks`);
  }

  updateFromSensorData(data: SensorCleanedData): void {
    const state = this.tankStates.get(data.tankId);
    if (!state) return;

    state.lastUpdateUs = data.timestampUs;
    state.currentLevel = data.liquidLevel;
    state.currentPressure = data.pressure;
    state.currentTemperature = data.temperature;
    state.inclination = { ...data.inclination };
  }

  updateSloshingAnalysis(
    tankId: string,
    severity: SloshingSeverity,
    impactForce: number,
    stabilityIndex: number
  ): void {
    const state = this.tankStates.get(tankId);
    if (!state) return;

    state.sloshingSeverity = severity;
    state.impactForce = impactForce;
    state.stabilityIndex = stabilityIndex;
  }

  getTankState(tankId: string): TankState | undefined {
    return this.tankStates.get(tankId);
  }

  getAllTankStates(): TankState[] {
    return Array.from(this.tankStates.values());
  }

  getTankConfigs() {
    return this.config.tankConfigs;
  }
}
