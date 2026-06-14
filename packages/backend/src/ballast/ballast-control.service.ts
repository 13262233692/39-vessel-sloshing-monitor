import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { SloshingSeverity, TankState } from '@vessel/shared';
import { TankService } from '../tank/tank.service';
import { MqttService } from '../mqtt/mqtt.service';
import { WebsocketService } from '../websocket/websocket.service';
import { AdvancedAnalysisResult } from '../sloshing/sloshing.service';

export interface EccentricMomentVector {
  roll: number;
  pitch: number;
  yaw: number;
  magnitude: number;
  dominantAxis: 'roll' | 'pitch';
}

export interface RestoringMomentDeficit {
  currentGZ: number;
  requiredGZ: number;
  deficit: number;
  deficitRatio: number;
  criticalAngle: number;
}

export interface BallastTankCommand {
  tankId: string;
  pumpRPM: number;
  valveOpenRatio: number;
  flowRateM3s: number;
  direction: 'fill' | 'discharge' | 'hold';
  targetVolumeDelta: number;
}

export interface BallastControlDecision {
  timestampUs: number;
  vesselId: string;
  eccentricMoment: EccentricMomentVector;
  restoringDeficit: RestoringMomentDeficit;
  commands: BallastTankCommand[];
  controlMode: 'monitor' | 'compensate' | 'emergency';
  estimatedStabilizationTime: number;
  safetyMargin: number;
  hexPayload: string;
}

interface VesselHydrostatics {
  displacement: number;
  GM: number;
  beam: number;
  length: number;
  draft: number;
  bilgeKeelArea: number;
  metacentricHeight: number;
  rollPeriod: number;
}

interface TankBallastState {
  tankId: string;
  side: 'port' | 'starboard' | 'center';
  currentVolume: number;
  maxVolume: number;
  fillableVolume: number;
  dischargeableVolume: number;
  pumpMaxRPM: number;
  pumpFlowRateAtRPM: (rpm: number) => number;
  valveMaxArea: number;
  position: { x: number; y: number; z: number };
}

const PUMP_NOMINAL_FLOW = 0.5;
const VALVE_MAX_AREA = 0.04;
const SAFETY_MARGIN_MIN = 0.15;
const COMPENSATION_KP = 2.5;
const COMPENSATION_KI = 0.3;
const COMPENSATION_KD = 0.8;
const EMERGENCY_THRESHOLD = 0.6;
const COMPENSATE_THRESHOLD = 0.25;

@Injectable()
export class BallastControlService {
  private readonly logger = new Logger(BallastControlService.name);
  private tankBallastStates = new Map<string, TankBallastState>();
  private integralError = { roll: 0, pitch: 0 };
  private lastError = { roll: 0, pitch: 0 };
  private lastControlTime = 0;
  private lastDecision: BallastControlDecision | null = null;
  private controlHistory: BallastControlDecision[] = [];
  private readonly MAX_HISTORY = 100;

  constructor(
    private tankService: TankService,
    private mqttService: MqttService,
    @Inject(forwardRef(() => WebsocketService))
    private websocketService: WebsocketService,
  ) {
    this.initializeBallastStates();
  }

  private initializeBallastStates(): void {
    const configs = this.tankService.getTankConfigs();
    const sides: Array<'port' | 'starboard' | 'center'> = ['port', 'center', 'starboard', 'center'];

    for (let i = 0; i < configs.length; i++) {
      const cfg = configs[i];
      const maxVol = cfg.dimensions.maxLiquidVolume;
      const currentVol = maxVol * cfg.fillingRatio;
      const side = sides[i % sides.length];

      this.tankBallastStates.set(cfg.id, {
        tankId: cfg.id,
        side,
        currentVolume: currentVol,
        maxVolume: maxVol,
        fillableVolume: maxVol - currentVol,
        dischargeableVolume: currentVol,
        pumpMaxRPM: 3000,
        pumpFlowRateAtRPM: (rpm: number) => (rpm / 3000) * PUMP_NOMINAL_FLOW,
        valveMaxArea: VALVE_MAX_AREA,
        position: cfg.position,
      });
    }
  }

  processAdvancedAnalysis(
    tankId: string,
    advancedResult: AdvancedAnalysisResult
  ): BallastControlDecision | null {
    const tankState = this.tankService.getTankState(tankId);
    if (!tankState) return null;

    const allStates = this.tankService.getAllTankStates();

    const eccentricMoment = this.computeEccentricMoment(allStates);

    const restoringDeficit = this.computeRestoringDeficit(advancedResult, eccentricMoment);

    const controlMode = this.determineControlMode(restoringDeficit, eccentricMoment);

    if (controlMode === 'monitor' && restoringDeficit.deficitRatio < 0.05) {
      return this.lastDecision;
    }

    const commands = this.solveOptimalBallastStrategy(
      eccentricMoment,
      restoringDeficit,
      controlMode
    );

    const now = Date.now() * 1000 + Math.floor(process.hrtime()[1] / 1000);
    const estStabTime = this.estimateStabilizationTime(commands, restoringDeficit);
    const safetyMargin = this.computeSafetyMargin(restoringDeficit, commands);

    const decision: BallastControlDecision = {
      timestampUs: now,
      vesselId: 'vessel-001',
      eccentricMoment,
      restoringDeficit,
      commands,
      controlMode,
      estimatedStabilizationTime: estStabTime,
      safetyMargin,
      hexPayload: '',
    };

    decision.hexPayload = this.encodeControlHexPayload(decision);

    this.lastDecision = decision;
    this.controlHistory.push(decision);
    if (this.controlHistory.length > this.MAX_HISTORY) {
      this.controlHistory.shift();
    }

    this.publishControlCommand(decision);

    this.websocketService.broadcastBallastControl({
      vesselId: decision.vesselId,
      mode: decision.controlMode,
      eccentricMoment: {
        roll: decision.eccentricMoment.roll,
        pitch: decision.eccentricMoment.pitch,
        magnitude: decision.eccentricMoment.magnitude,
        dominantAxis: decision.eccentricMoment.dominantAxis,
      },
      restoringDeficit: {
        currentGZ: decision.restoringDeficit.currentGZ,
        requiredGZ: decision.restoringDeficit.requiredGZ,
        deficit: decision.restoringDeficit.deficit,
        deficitRatio: decision.restoringDeficit.deficitRatio,
        criticalAngle: decision.restoringDeficit.criticalAngle,
      },
      commands: decision.commands.map(c => ({
        tankId: c.tankId,
        pumpRPM: c.pumpRPM,
        valveOpenRatio: c.valveOpenRatio,
        flowRateM3s: c.flowRateM3s,
        direction: c.direction,
        targetVolumeDelta: c.targetVolumeDelta,
      })),
      safetyMargin: decision.safetyMargin,
      estimatedStabilizationTime: decision.estimatedStabilizationTime,
      hexPayload: decision.hexPayload,
    });

    return decision;
  }

  private computeEccentricMoment(allStates: TankState[]): EccentricMomentVector {
    let rollMoment = 0;
    let pitchMoment = 0;
    let yawMoment = 0;

    for (const state of allStates) {
      const mass = state.currentLevel * state.config.dimensions.width * state.config.dimensions.length * 425;
      const armX = state.config.position.x;
      const armY = state.config.position.y;

      const sloshingForce = state.impactForce;
      const inclX = state.inclination.x;
      const inclY = state.inclination.y;

      rollMoment += mass * 9.81 * Math.sin((inclX * Math.PI) / 180) * armY + sloshingForce * armY * 0.01;
      pitchMoment += mass * 9.81 * Math.sin((inclY * Math.PI) / 180) * armX + sloshingForce * armX * 0.01;
      yawMoment += sloshingForce * Math.sin((inclX - inclY) * Math.PI / 180) * 0.001;
    }

    const magnitude = Math.sqrt(rollMoment ** 2 + pitchMoment ** 2 + yawMoment ** 2);
    const dominantAxis = Math.abs(rollMoment) >= Math.abs(pitchMoment) ? 'roll' : 'pitch';

    return { roll: rollMoment, pitch: pitchMoment, yaw: yawMoment, magnitude, dominantAxis };
  }

  private computeRestoringDeficit(
    advancedResult: AdvancedAnalysisResult,
    eccentricMoment: EccentricMomentVector
  ): RestoringMomentDeficit {
    const gzCurve = advancedResult.gzCurve;

    if (!gzCurve) {
      return {
        currentGZ: 0,
        requiredGZ: Math.abs(eccentricMoment.magnitude) / (200000 * 9.81),
        deficit: Math.abs(eccentricMoment.magnitude) / (200000 * 9.81),
        deficitRatio: 1,
        criticalAngle: 0,
      };
    }

    const currentGZ = gzCurve.maxGZ;
    const requiredGZ = Math.abs(eccentricMoment.magnitude) / (200000 * 9.81);
    const deficit = Math.max(0, requiredGZ - currentGZ);
    const deficitRatio = currentGZ > 0.01 ? deficit / currentGZ : deficit > 0 ? 1 : 0;

    let criticalAngle = 90;
    for (let i = 0; i < gzCurve.gz.length; i++) {
      if (gzCurve.gz[i] <= 0 && gzCurve.angles[i] < criticalAngle) {
        criticalAngle = gzCurve.angles[i];
        break;
      }
    }

    return { currentGZ, requiredGZ, deficit, deficitRatio, criticalAngle };
  }

  private determineControlMode(
    deficit: RestoringMomentDeficit,
    eccentric: EccentricMomentVector
  ): 'monitor' | 'compensate' | 'emergency' {
    if (deficit.deficitRatio > EMERGENCY_THRESHOLD || deficit.criticalAngle < 25) {
      return 'emergency';
    }
    if (deficit.deficitRatio > COMPENSATE_THRESHOLD || eccentric.magnitude > 1e7) {
      return 'compensate';
    }
    return 'monitor';
  }

  private solveOptimalBallastStrategy(
    eccentric: EccentricMomentVector,
    deficit: RestoringMomentDeficit,
    mode: 'monitor' | 'compensate' | 'emergency'
  ): BallastTankCommand[] {
    const now = Date.now();
    const dt = this.lastControlTime > 0 ? (now - this.lastControlTime) / 1000 : 0.02;
    this.lastControlTime = now;

    const errorRoll = deficit.deficit * Math.sign(eccentric.roll);
    const errorPitch = deficit.deficit * Math.sign(eccentric.pitch);

    this.integralError.roll += errorRoll * dt;
    this.integralError.pitch += errorPitch * dt;
    this.integralError.roll = Math.max(-2, Math.min(2, this.integralError.roll));
    this.integralError.pitch = Math.max(-2, Math.min(2, this.integralError.pitch));

    const derivRoll = dt > 0 ? (errorRoll - this.lastError.roll) / dt : 0;
    const derivPitch = dt > 0 ? (errorPitch - this.lastError.pitch) / dt : 0;
    this.lastError = { roll: errorRoll, pitch: errorPitch };

    const pidRoll = COMPENSATION_KP * errorRoll + COMPENSATION_KI * this.integralError.roll + COMPENSATION_KD * derivRoll;
    const pidPitch = COMPENSATION_KP * errorPitch + COMPENSATION_KI * this.integralError.pitch + COMPENSATION_KD * derivPitch;

    const modeMultiplier = mode === 'emergency' ? 2.0 : mode === 'compensate' ? 1.0 : 0.3;

    const commands: BallastTankCommand[] = [];

    for (const [, ballastState] of this.tankBallastStates) {
      const { tankId, side, position, pumpMaxRPM, pumpFlowRateAtRPM, valveMaxArea } = ballastState;

      let requiredFlow = 0;
      let direction: 'fill' | 'discharge' | 'hold' = 'hold';

      if (side === 'port') {
        requiredFlow = -pidRoll * modeMultiplier * position.y;
      } else if (side === 'starboard') {
        requiredFlow = pidRoll * modeMultiplier * position.y;
      }

      requiredFlow += pidPitch * modeMultiplier * Math.sign(position.x) * 0.3;

      if (Math.abs(requiredFlow) < 0.001) {
        commands.push({
          tankId,
          pumpRPM: 0,
          valveOpenRatio: 0,
          flowRateM3s: 0,
          direction: 'hold',
          targetVolumeDelta: 0,
        });
        continue;
      }

      if (requiredFlow > 0) {
        direction = 'fill';
        requiredFlow = Math.min(requiredFlow, ballastState.fillableVolume / Math.max(dt, 0.02));
      } else {
        direction = 'discharge';
        requiredFlow = Math.min(Math.abs(requiredFlow), ballastState.dischargeableVolume / Math.max(dt, 0.02));
      }

      const maxFlow = pumpFlowRateAtRPM(pumpMaxRPM);
      const clampedFlow = Math.min(Math.abs(requiredFlow), maxFlow);
      const rpm = (clampedFlow / maxFlow) * pumpMaxRPM;
      const valveRatio = Math.min(1, clampedFlow / (maxFlow + 1e-9));
      const valveArea = valveRatio * valveMaxArea;

      const volumeDelta = clampedFlow * dt * (direction === 'fill' ? 1 : -1);

      this.updateBallastState(tankId, volumeDelta);

      commands.push({
        tankId,
        pumpRPM: Math.round(rpm),
        valveOpenRatio: Math.round(valveRatio * 1000) / 1000,
        flowRateM3s: Math.round(clampedFlow * 10000) / 10000,
        direction,
        targetVolumeDelta: Math.round(volumeDelta * 1000) / 1000,
      });
    }

    return commands;
  }

  private updateBallastState(tankId: string, volumeDelta: number): void {
    const state = this.tankBallastStates.get(tankId);
    if (!state) return;

    state.currentVolume = Math.max(0, Math.min(state.maxVolume, state.currentVolume + volumeDelta));
    state.fillableVolume = state.maxVolume - state.currentVolume;
    state.dischargeableVolume = state.currentVolume;
  }

  private estimateStabilizationTime(
    commands: BallastTankCommand[],
    deficit: RestoringMomentDeficit
  ): number {
    const maxFlow = Math.max(...commands.map(c => c.flowRateM3s), 0.001);
    const totalVolumeNeeded = deficit.deficit * 200000 * 9.81 / (425 * 9.81 * 10);
    return Math.min(300, totalVolumeNeeded / maxFlow);
  }

  private computeSafetyMargin(
    deficit: RestoringMomentDeficit,
    commands: BallastTankCommand[]
  ): number {
    const activePumps = commands.filter(c => c.direction !== 'hold').length;
    const totalCapacity = commands.reduce(
      (sum, c) => sum + (c.direction === 'hold' ? 0 : c.flowRateM3s),
      0
    );
    const margin = 1 - deficit.deficitRatio + (totalCapacity / (PUMP_NOMINAL_FLOW * 4 + 1e-9)) * 0.2;
    return Math.max(0, Math.min(1, margin));
  }

  private encodeControlHexPayload(decision: BallastControlDecision): string {
    const bytes: number[] = [];

    const header = 0xba;
    bytes.push(header);

    const version = 0x01;
    bytes.push(version);

    const tsLo = decision.timestampUs & 0xff;
    const tsHi = (decision.timestampUs >> 8) & 0xff;
    bytes.push(tsLo, tsHi);

    const modeMap = { monitor: 0x00, compensate: 0x01, emergency: 0x02 };
    bytes.push(modeMap[decision.controlMode]);

    const emRoll = this.floatToHalfHex(decision.eccentricMoment.roll);
    const emPitch = this.floatToHalfHex(decision.eccentricMoment.pitch);
    bytes.push(...this.u16ToBytes(emRoll));
    bytes.push(...this.u16ToBytes(emPitch));

    const deficitShort = this.floatToHalfHex(decision.restoringDeficit.deficitRatio);
    bytes.push(...this.u16ToBytes(deficitShort));

    const safetyShort = this.floatToHalfHex(decision.safetyMargin);
    bytes.push(...this.u16ToBytes(safetyShort));

    bytes.push(decision.commands.length & 0xff);

    for (const cmd of decision.commands) {
      const tankNum = parseInt(cmd.tankId.replace('tank-', ''), 10) & 0xff;
      bytes.push(tankNum);

      const rpmHi = (cmd.pumpRPM >> 8) & 0xff;
      const rpmLo = cmd.pumpRPM & 0xff;
      bytes.push(rpmHi, rpmLo);

      const valveInt = Math.round(cmd.valveOpenRatio * 1000) & 0xffff;
      bytes.push(...this.u16ToBytes(valveInt));

      const dirMap = { hold: 0x00, fill: 0x01, discharge: 0x02 };
      bytes.push(dirMap[cmd.direction]);

      const flowInt = Math.round(cmd.flowRateM3s * 10000) & 0xffff;
      bytes.push(...this.u16ToBytes(flowInt));
    }

    let crc = 0;
    for (const b of bytes) {
      crc ^= b;
      for (let i = 0; i < 8; i++) {
        if (crc & 0x80) {
          crc = ((crc << 1) ^ 0x07) & 0xff;
        } else {
          crc = (crc << 1) & 0xff;
        }
      }
    }
    bytes.push(crc);

    return bytes.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  private floatToHalfHex(value: number): number {
    const clamped = Math.max(-65504, Math.min(65504, value));
    if (Math.abs(clamped) < 6.1e-5) return 0;
    const sign = clamped < 0 ? 1 : 0;
    const absVal = Math.abs(clamped);
    const exponent = Math.floor(Math.log2(absVal));
    const mantissa = absVal / Math.pow(2, exponent) - 1;
    const biasedExp = Math.max(0, Math.min(31, exponent + 15));
    const intMantissa = Math.round(mantissa * 1024) & 0x3ff;
    return (sign << 15) | (biasedExp << 10) | intMantissa;
  }

  private u16ToBytes(val: number): [number, number] {
    return [(val >> 8) & 0xff, val & 0xff];
  }

  private publishControlCommand(decision: BallastControlDecision): void {
    const topic = `vessel/control/ballast/${decision.vesselId}`;

    const jsonPayload = {
      mode: decision.controlMode,
      timestamp: decision.timestampUs,
      eccentricMoment: {
        roll: decision.eccentricMoment.roll,
        pitch: decision.eccentricMoment.pitch,
        magnitude: decision.eccentricMoment.magnitude,
      },
      restoringDeficit: {
        deficitRatio: decision.restoringDeficit.deficitRatio,
        criticalAngle: decision.restoringDeficit.criticalAngle,
      },
      commands: decision.commands.map(c => ({
        tankId: c.tankId,
        pumpRPM: c.pumpRPM,
        valveOpenRatio: c.valveOpenRatio,
        flowRate: c.flowRateM3s,
        direction: c.direction,
      })),
      safetyMargin: decision.safetyMargin,
      hex: decision.hexPayload,
    };

    this.mqttService.publish(topic, jsonPayload, 2);

    this.mqttService.publish(
      `vessel/control/ballast/${decision.vesselId}/hex`,
      decision.hexPayload,
      2
    );

    this.logger.debug(
      `[Ballast] Mode=${decision.controlMode} Deficit=${decision.restoringDeficit.deficitRatio.toFixed(3)} ` +
      `Commands=${decision.commands.filter(c => c.direction !== 'hold').length}/${decision.commands.length} ` +
      `Hex=${decision.hexPayload.substring(0, 20)}...`
    );
  }

  getLastDecision(): BallastControlDecision | null {
    return this.lastDecision;
  }

  getControlHistory(): BallastControlDecision[] {
    return this.controlHistory.slice();
  }

  getCurrentBallastStates(): Map<string, TankBallastState> {
    return new Map(this.tankBallastStates);
  }

  resetIntegralError(): void {
    this.integralError = { roll: 0, pitch: 0 };
    this.lastError = { roll: 0, pitch: 0 };
    this.lastControlTime = 0;
  }
}
