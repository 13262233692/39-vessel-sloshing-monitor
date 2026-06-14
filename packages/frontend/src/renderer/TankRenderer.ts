import { getSeverityColor, SloshingSeverity } from '@vessel/shared';
import type { TankStateData, TankUpdateMessage, RendererConfig } from '../types/frontend';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  alpha: number;
}

interface ImpactEffect {
  x: number;
  y: number;
  force: number;
  startTime: number;
  duration: number;
}

export class TankRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number = 0;
  private height: number = 0;
  private dpr: number = 1;

  private tankState: TankStateData | null = null;
  private tankUpdate: TankUpdateMessage | null = null;
  private config: RendererConfig;

  private animationFrameId: number | null = null;
  private lastRenderTime: number = 0;
  private simulationTime: number = 0;

  private particles: Particle[] = [];
  private impactEffects: ImpactEffect[] = [];
  private surfacePointBuffer: number[] = [];
  private smoothedSurface: number[] = [];

  private colorPalette = {
    background: '#0a0a12',
    tankBorder: '#2a3a4a',
    tankFill: '#121a24',
    liquid: '#00aaff',
    liquidDark: '#0066aa',
    liquidLight: '#66ccff',
    foam: '#ffffff',
    grid: '#1a2533',
    text: '#88aacc',
    warning: '#ff6600',
    danger: '#ff0000',
  };

  constructor(canvas: HTMLCanvasElement, config: RendererConfig) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Failed to get 2D context');
    this.ctx = ctx;
    this.config = config;
    this.resize();
    this.initSurfaceBuffers();
  }

  private initSurfaceBuffers(): void {
    const pointCount = 100;
    this.surfacePointBuffer = new Array(pointCount).fill(0);
    this.smoothedSurface = new Array(pointCount).fill(0);
  }

  resize(): void {
    this.dpr = this.config.antiAliasing ? (window.devicePixelRatio || 1) : 1;
    const rect = this.canvas.getBoundingClientRect();
    this.width = rect.width;
    this.height = rect.height;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.ctx.scale(this.dpr, this.dpr);
  }

  setTankState(state: TankStateData): void {
    this.tankState = state;
  }

  setTankUpdate(update: TankUpdateMessage): void {
    this.tankUpdate = update;
    if (update.analysis.surfacePoints) {
      this.updateSurfacePoints(update.analysis.surfacePoints);
    }
    if (update.analysis.impactForce > 100) {
      this.addImpactEffect(update);
    }
  }

  updateConfig(config: Partial<RendererConfig>): void {
    this.config = { ...this.config, ...config };
    this.resize();
  }

  private updateSurfacePoints(points: number[]): void {
    const targetLen = this.surfacePointBuffer.length;
    for (let i = 0; i < targetLen; i++) {
      const t = i / (targetLen - 1);
      const srcIdx = Math.floor(t * (points.length - 1));
      const nextIdx = Math.min(srcIdx + 1, points.length - 1);
      const frac = t * (points.length - 1) - srcIdx;
      this.surfacePointBuffer[i] = points[srcIdx] * (1 - frac) + points[nextIdx] * frac;
    }

    const smooth = this.config.smoothingLevel;
    for (let i = 0; i < targetLen; i++) {
      let sum = 0;
      let weight = 0;
      const kernelSize = Math.max(1, Math.floor(smooth * 5));
      for (let j = -kernelSize; j <= kernelSize; j++) {
        const idx = Math.max(0, Math.min(targetLen - 1, i + j));
        const w = 1 - Math.abs(j) / (kernelSize + 1);
        sum += this.surfacePointBuffer[idx] * w;
        weight += w;
      }
      this.smoothedSurface[i] = sum / weight;
    }
  }

  private addImpactEffect(update: TankUpdateMessage): void {
    const { impactLocation, impactForce, severity } = update.analysis;
    const tankState = this.tankState;
    if (!tankState) return;

    const centerX = this.width / 2;
    const centerY = this.height / 2;
    const tankScale = Math.min(this.width, this.height) * 0.4 / tankState.dimensions.length;

    const x = centerX + impactLocation.x * tankScale;
    const y = centerY - (tankState.dimensions.height / 2 - update.sensor.liquidLevel) * tankScale;

    this.impactEffects.push({
      x,
      y,
      force: impactForce,
      startTime: this.simulationTime,
      duration: Math.min(2000, impactForce / 10),
    });

    const particleCount = Math.min(50, Math.floor(impactForce / 20));
    for (let i = 0; i < particleCount; i++) {
      const angle = (Math.random() - 0.5) * Math.PI;
      const speed = 50 + Math.random() * 100 * (impactForce / 500);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: -Math.sin(angle) * speed - 50,
        life: 1,
        maxLife: 0.5 + Math.random() * 1,
        size: 2 + Math.random() * 4,
        alpha: 0.8 + Math.random() * 0.2,
      });
    }
  }

  start(): void {
    if (this.animationFrameId !== null) return;

    const animate = (time: number) => {
      const deltaTime = Math.min((time - this.lastRenderTime) / 1000, 0.1);
      this.lastRenderTime = time;
      this.simulationTime += deltaTime * 1000;

      this.update(deltaTime);
      this.render();

      this.animationFrameId = requestAnimationFrame(animate);
    };

    this.lastRenderTime = performance.now();
    this.animationFrameId = requestAnimationFrame(animate);
  }

  stop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  private update(deltaTime: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.vy += 200 * deltaTime;
      p.x += p.vx * deltaTime;
      p.y += p.vy * deltaTime;
      p.life -= deltaTime / p.maxLife;
      p.alpha = Math.max(0, p.life);

      if (p.life <= 0 || p.y > this.height) {
        this.particles.splice(i, 1);
      }
    }

    for (let i = this.impactEffects.length - 1; i >= 0; i--) {
      const effect = this.impactEffects[i];
      if (this.simulationTime - effect.startTime > effect.duration) {
        this.impactEffects.splice(i, 1);
      }
    }

    while (this.particles.length > 200) {
      this.particles.shift();
    }
  }

  private render(): void {
    const { ctx, width, height } = this;

    ctx.fillStyle = this.colorPalette.background;
    ctx.fillRect(0, 0, width, height);

    this.drawGrid();
    this.drawTankCrossSection();
    this.drawLiquidSurface();
    this.drawVelocityField();
    this.drawImpactEffects();
    this.drawParticles();
    this.drawStressWaveform();
    this.drawHUD();
    this.drawSeverityIndicator();
  }

  private drawGrid(): void {
    const { ctx, width, height } = this;
    ctx.strokeStyle = this.colorPalette.grid;
    ctx.lineWidth = 1;

    const gridSize = 50;
    for (let x = 0; x < width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
  }

  private drawTankCrossSection(): void {
    if (!this.tankState) return;

    const { ctx, width, height } = this;
    const { dimensions } = this.tankState;
    const tankState = this.tankState;

    const centerX = width / 2;
    const centerY = height / 2;
    const tankScale = Math.min(width, height) * 0.4 / dimensions.length;

    const tankWidth = dimensions.length * tankScale;
    const tankHeight = dimensions.height * tankScale;
    const left = centerX - tankWidth / 2;
    const right = centerX + tankWidth / 2;
    const top = centerY - tankHeight / 2;
    const bottom = centerY + tankHeight / 2;

    const rollAngle = (tankState.inclination.x * Math.PI) / 180;
    const pitchAngle = (tankState.inclination.y * Math.PI) / 180;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rollAngle * 0.3);
    ctx.translate(-centerX, -centerY);

    if (this.config.wireframeMode) {
      ctx.strokeStyle = this.colorPalette.tankBorder;
      ctx.lineWidth = 2;
      ctx.strokeRect(left, top, tankWidth, tankHeight);

      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left + 30, top - 30);
      ctx.lineTo(right + 30, top - 30);
      ctx.lineTo(right, top);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(right, top);
      ctx.lineTo(right + 30, top - 30);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(right, bottom);
      ctx.lineTo(right + 30, bottom - 30);
      ctx.stroke();
    } else {
      const bgGradient = ctx.createLinearGradient(left, top, right, bottom);
      bgGradient.addColorStop(0, '#141e2a');
      bgGradient.addColorStop(0.5, '#0e1520');
      bgGradient.addColorStop(1, '#141e2a');
      ctx.fillStyle = bgGradient;
      ctx.fillRect(left, top, tankWidth, tankHeight);

      ctx.strokeStyle = this.colorPalette.tankBorder;
      ctx.lineWidth = 3;
      ctx.strokeRect(left, top, tankWidth, tankHeight);

      ctx.fillStyle = 'rgba(20, 30, 42, 0.8)';
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left + 30, top - 30);
      ctx.lineTo(right + 30, top - 30);
      ctx.lineTo(right, top);
      ctx.closePath();
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(right, top);
      ctx.lineTo(right + 30, top - 30);
      ctx.lineTo(right + 30, bottom - 30);
      ctx.lineTo(right, bottom);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(100, 150, 200, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left, top);
      ctx.lineTo(left + 30, top - 30);
      ctx.moveTo(right, top);
      ctx.lineTo(right + 30, top - 30);
      ctx.moveTo(right, bottom);
      ctx.lineTo(right + 30, bottom - 30);
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawLiquidSurface(): void {
    if (!this.tankState || !this.tankUpdate) return;

    const { ctx, width, height } = this;
    const { dimensions, fillingRatio } = this.tankState;
    const { analysis, sensor } = this.tankUpdate;

    const centerX = width / 2;
    const centerY = height / 2;
    const tankScale = Math.min(width, height) * 0.4 / dimensions.length;
    const tankWidth = dimensions.length * tankScale;
    const tankHeight = dimensions.height * tankScale;
    const left = centerX - tankWidth / 2;
    const right = centerX + tankWidth / 2;
    const bottom = centerY + tankHeight / 2;

    const baseLevelY = centerY + tankHeight / 2 - sensor.liquidLevel * tankScale / dimensions.height * tankHeight;

    const rollAngle = (this.tankState.inclination.x * Math.PI) / 180;
    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate(rollAngle * 0.3);
    ctx.translate(-centerX, -centerY);

    const surfacePoints: { x: number; y: number }[] = [];
    const pointCount = this.smoothedSurface.length;

    for (let i = 0; i < pointCount; i++) {
      const x = left + (i / (pointCount - 1)) * tankWidth;
      const waveAmplitude = this.smoothedSurface[i] * tankScale * 3;
      const y = baseLevelY + waveAmplitude;
      surfacePoints.push({ x, y });
    }

    if (!this.config.wireframeMode) {
      const liquidGradient = ctx.createLinearGradient(0, baseLevelY - 50, 0, bottom);
      const severityColor = getSeverityColor(analysis.severity);

      liquidGradient.addColorStop(0, this.adjustColorBrightness(this.colorPalette.liquid, 30));
      liquidGradient.addColorStop(0.3, this.colorPalette.liquid);
      liquidGradient.addColorStop(0.7, this.colorPalette.liquidDark);
      liquidGradient.addColorStop(1, '#003366');

      ctx.beginPath();
      ctx.moveTo(left, bottom);
      ctx.lineTo(surfacePoints[0].x, surfacePoints[0].y);

      for (let i = 1; i < surfacePoints.length; i++) {
        const xc = (surfacePoints[i - 1].x + surfacePoints[i].x) / 2;
        const yc = (surfacePoints[i - 1].y + surfacePoints[i].y) / 2;
        ctx.quadraticCurveTo(surfacePoints[i - 1].x, surfacePoints[i - 1].y, xc, yc);
      }

      ctx.lineTo(right, surfacePoints[surfacePoints.length - 1].y);
      ctx.lineTo(right, bottom);
      ctx.closePath();
      ctx.fillStyle = liquidGradient;
      ctx.fill();

      ctx.save();
      ctx.beginPath();
      ctx.moveTo(left, bottom);
      ctx.lineTo(surfacePoints[0].x, surfacePoints[0].y);
      for (let i = 1; i < surfacePoints.length; i++) {
        const xc = (surfacePoints[i - 1].x + surfacePoints[i].x) / 2;
        const yc = (surfacePoints[i - 1].y + surfacePoints[i].y) / 2;
        ctx.quadraticCurveTo(surfacePoints[i - 1].x, surfacePoints[i - 1].y, xc, yc);
      }
      ctx.lineTo(right, surfacePoints[surfacePoints.length - 1].y);
      ctx.lineTo(right, bottom);
      ctx.closePath();
      ctx.clip();

      const severityOverlay = ctx.createRadialGradient(
        centerX, baseLevelY, 0,
        centerX, baseLevelY, tankWidth / 2
      );
      const alpha = Math.min(0.3, analysis.impactForce / 2000);
      severityOverlay.addColorStop(0, severityColor + Math.floor(alpha * 255).toString(16).padStart(2, '0'));
      severityOverlay.addColorStop(1, 'transparent');
      ctx.fillStyle = severityOverlay;
      ctx.fillRect(left, baseLevelY - 100, tankWidth, tankHeight + 100);

      ctx.restore();
    }

    ctx.beginPath();
    ctx.moveTo(surfacePoints[0].x, surfacePoints[0].y);
    for (let i = 1; i < surfacePoints.length; i++) {
      const xc = (surfacePoints[i - 1].x + surfacePoints[i].x) / 2;
      const yc = (surfacePoints[i - 1].y + surfacePoints[i].y) / 2;
      ctx.quadraticCurveTo(surfacePoints[i - 1].x, surfacePoints[i - 1].y, xc, yc);
    }
    ctx.strokeStyle = this.colorPalette.liquidLight;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();

    if (this.config.showWaveform && analysis.waveHeight > 0.01) {
      const foamGradient = ctx.createLinearGradient(0, baseLevelY - 10, 0, baseLevelY + 10);
      foamGradient.addColorStop(0, 'rgba(255, 255, 255, 0)');
      foamGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.6)');
      foamGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

      ctx.strokeStyle = foamGradient;
      ctx.lineWidth = 8;
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawVelocityField(): void {
    if (!this.config.showVelocityField || !this.tankUpdate) return;
    if (!this.tankState) return;

    const { ctx, width, height } = this;
    const { velocityField } = this.tankUpdate.analysis;
    const { dimensions } = this.tankState;

    const centerX = width / 2;
    const centerY = height / 2;
    const tankScale = Math.min(width, height) * 0.4 / dimensions.length;

    const maxVelocity = Math.max(...velocityField.map(v => Math.sqrt(v.u ** 2 + v.v ** 2)), 0.1);

    for (const vec of velocityField) {
      const x = centerX + vec.x * tankScale;
      const y = centerY + vec.y * tankScale;
      const u = vec.u * tankScale * 2;
      const v = vec.v * tankScale * 2;
      const mag = Math.sqrt(u ** 2 + v ** 2) / maxVelocity;

      if (mag < 0.1) continue;

      const hue = 200 - mag * 120;
      ctx.strokeStyle = `hsla(${hue}, 100%, 60%, ${0.3 + mag * 0.7})`;
      ctx.lineWidth = 1 + mag * 2;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + u, y + v);
      ctx.stroke();

      const arrowSize = 3 + mag * 3;
      const angle = Math.atan2(v, u);
      ctx.beginPath();
      ctx.moveTo(x + u, y + v);
      ctx.lineTo(
        x + u - arrowSize * Math.cos(angle - Math.PI / 6),
        y + v - arrowSize * Math.sin(angle - Math.PI / 6)
      );
      ctx.moveTo(x + u, y + v);
      ctx.lineTo(
        x + u - arrowSize * Math.cos(angle + Math.PI / 6),
        y + v - arrowSize * Math.sin(angle + Math.PI / 6)
      );
      ctx.stroke();
    }
  }

  private drawImpactEffects(): void {
    if (!this.config.showImpactZones) return;

    const { ctx } = this;

    for (const effect of this.impactEffects) {
      const progress = (this.simulationTime - effect.startTime) / effect.duration;
      const alpha = 1 - progress;
      const radius = 20 + progress * Math.min(100, effect.force / 5);

      const gradient = ctx.createRadialGradient(
        effect.x, effect.y, 0,
        effect.x, effect.y, radius
      );

      const hue = 60 - progress * 60;
      gradient.addColorStop(0, `hsla(${hue}, 100%, 60%, ${alpha * 0.8})`);
      gradient.addColorStop(0.5, `hsla(${hue}, 100%, 50%, ${alpha * 0.4})`);
      gradient.addColorStop(1, 'transparent');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(effect.x, effect.y, radius, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = `hsla(${hue}, 100%, 70%, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  private drawParticles(): void {
    const { ctx } = this;

    for (const p of this.particles) {
      const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
      gradient.addColorStop(0, `rgba(200, 230, 255, ${p.alpha})`);
      gradient.addColorStop(1, 'rgba(100, 180, 255, 0)');

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawStressWaveform(): void {
    if (!this.config.showWaveform || !this.tankUpdate) return;

    const { ctx, width } = this;
    const { stressWaveform } = this.tankUpdate.sensor;

    const waveformHeight = 60;
    const waveformWidth = width * 0.9;
    const xOffset = (width - waveformWidth) / 2;
    const yOffset = this.height - waveformHeight - 20;

    ctx.fillStyle = 'rgba(10, 15, 25, 0.8)';
    ctx.fillRect(xOffset - 10, yOffset - 10, waveformWidth + 20, waveformHeight + 20);

    ctx.strokeStyle = 'rgba(100, 150, 200, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(xOffset - 10, yOffset - 10, waveformWidth + 20, waveformHeight + 20);

    ctx.strokeStyle = 'rgba(100, 150, 200, 0.2)';
    ctx.beginPath();
    ctx.moveTo(xOffset, yOffset + waveformHeight / 2);
    ctx.lineTo(xOffset + waveformWidth, yOffset + waveformHeight / 2);
    ctx.stroke();

    const maxVal = Math.max(...stressWaveform.map(Math.abs), 0.001);
    const scale = (waveformHeight / 2 - 5) / maxVal;

    ctx.strokeStyle = '#00ffaa';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    for (let i = 0; i < stressWaveform.length; i++) {
      const x = xOffset + (i / (stressWaveform.length - 1)) * waveformWidth;
      const y = yOffset + waveformHeight / 2 - stressWaveform[i] * scale;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }

    ctx.stroke();

    ctx.fillStyle = this.colorPalette.text;
    ctx.font = '10px monospace';
    ctx.fillText('动应力波形', xOffset - 5, yOffset - 15);
  }

  private drawHUD(): void {
    if (!this.tankState || !this.tankUpdate) return;

    const { ctx, width } = this;
    const { analysis, sensor } = this.tankUpdate;
    const state = this.tankState;

    const panelX = 15;
    const panelY = 15;
    const panelWidth = 200;
    const lineHeight = 22;

    ctx.fillStyle = 'rgba(10, 15, 25, 0.85)';
    ctx.fillRect(panelX, panelY, panelWidth, lineHeight * 9 + 20);

    ctx.strokeStyle = 'rgba(100, 150, 200, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(panelX, panelY, panelWidth, lineHeight * 9 + 20);

    ctx.fillStyle = this.colorPalette.text;
    ctx.font = 'bold 14px monospace';
    ctx.fillText(`${state.name} 实时数据`, panelX + 10, panelY + 25);

    ctx.font = '12px monospace';
    const items = [
      { label: '液位', value: `${sensor.liquidLevel.toFixed(2)} m` },
      { label: '压力', value: `${sensor.pressure.toFixed(2)} kPa` },
      { label: '温度', value: `${sensor.temperature.toFixed(2)} °C` },
      { label: '横摇角', value: `${state.inclination.x.toFixed(2)}°` },
      { label: '纵摇角', value: `${state.inclination.y.toFixed(2)}°` },
      { label: '波高', value: `${analysis.waveHeight.toFixed(3)} m` },
      { label: '周期', value: `${analysis.wavePeriod.toFixed(2)} s` },
      { label: '冲击力', value: `${analysis.impactForce.toFixed(1)} N` },
      { label: '稳性指数', value: `${analysis.stabilityIndex.toFixed(3)}` },
    ];

    for (let i = 0; i < items.length; i++) {
      const y = panelY + 45 + i * lineHeight;
      ctx.fillStyle = this.colorPalette.text;
      ctx.fillText(items[i].label, panelX + 10, y);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(items[i].value, panelX + 95, y);
    }

    const signalQuality = sensor.signalQuality;
    const barWidth = 80;
    const barX = panelX + 95;
    const barY = panelY + 45 + items.length * lineHeight;
    ctx.fillStyle = 'rgba(50, 50, 50, 0.8)';
    ctx.fillRect(barX, barY - 8, barWidth, 10);

    const qualityColor = signalQuality > 0.8 ? '#00ff88' : signalQuality > 0.5 ? '#ffcc00' : '#ff6600';
    ctx.fillStyle = qualityColor;
    ctx.fillRect(barX, barY - 8, barWidth * signalQuality, 10);

    ctx.fillStyle = this.colorPalette.text;
    ctx.fillText('信号质量', panelX + 10, barY);

    const timeStr = new Date(this.tankUpdate.timestampUs / 1000).toLocaleTimeString('zh-CN', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    } as any);
    ctx.fillStyle = 'rgba(100, 150, 200, 0.5)';
    ctx.font = '10px monospace';
    ctx.fillText(timeStr, panelX + 10, barY + 25);
  }

  private drawSeverityIndicator(): void {
    if (!this.tankUpdate) return;

    const { ctx, width, height } = this;
    const { severity, impactForce, stabilityIndex } = this.tankUpdate.analysis;

    const indicatorSize = 80;
    const x = width - indicatorSize - 20;
    const y = 20;

    const color = getSeverityColor(severity);
    const normalizedForce = Math.min(1, impactForce / 1000);
    const riskLevel = normalizedForce * (1 - stabilityIndex);

    ctx.fillStyle = 'rgba(10, 15, 25, 0.85)';
    ctx.fillRect(x, y, indicatorSize, indicatorSize);

    ctx.strokeStyle = 'rgba(100, 150, 200, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, indicatorSize, indicatorSize);

    const centerX = x + indicatorSize / 2;
    const centerY = y + indicatorSize / 2;
    const radius = indicatorSize / 2 - 8;

    const segments = 12;
    for (let i = 0; i < segments; i++) {
      const angle = -Math.PI / 2 + (i / segments) * Math.PI * 2;
      const nextAngle = -Math.PI / 2 + ((i + 1) / segments) * Math.PI * 2;
      const progress = i / segments;

      const isActive = progress < riskLevel;
      const hue = 120 - progress * 120;
      ctx.fillStyle = isActive
        ? `hsl(${hue}, 100%, 50%)`
        : `hsla(${hue}, 30%, 30%, 0.3)`;

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, angle, nextAngle);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = '#0a0a12';
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = color;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(this.getSeverityText(severity), centerX, centerY + 5);
    ctx.textAlign = 'left';

    ctx.fillStyle = this.colorPalette.text;
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('风险等级', centerX, y + indicatorSize + 12);
    ctx.textAlign = 'left';
  }

  private getSeverityText(severity: SloshingSeverity): string {
    switch (severity) {
      case SloshingSeverity.NONE: return '正常';
      case SloshingSeverity.LOW: return '轻微';
      case SloshingSeverity.MODERATE: return '中等';
      case SloshingSeverity.HIGH: return '较高';
      case SloshingSeverity.CRITICAL: return '危险';
      case SloshingSeverity.EXTREME: return '极端';
      default: return '未知';
    }
  }

  private adjustColorBrightness(hex: string, amount: number): string {
    const num = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.max(0, (num >> 16) + amount));
    const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + amount));
    const b = Math.min(255, Math.max(0, (num & 0x0000ff) + amount));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }

  destroy(): void {
    this.stop();
  }
}
