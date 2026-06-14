<script setup lang="ts">
import { computed } from 'vue';
import { getSeverityColor } from '@vessel/shared';
import type { TankStateData } from '../types/frontend';

const props = defineProps<{
  state: TankStateData;
  isSelected: boolean;
}>();

const emit = defineEmits<{
  (e: 'select', tankId: string): void;
}>();

const severityColor = computed(() => getSeverityColor(props.state.sloshingSeverity));

const severityText = computed(() => {
  const map: Record<string, string> = {
    none: '正常',
    low: '轻微',
    moderate: '中等',
    high: '较高',
    critical: '危险',
    extreme: '极端',
  };
  return map[props.state.sloshingSeverity] || '未知';
});

const stabilityPercent = computed(() => Math.round(props.state.stabilityIndex * 100));

const fillingPercent = computed(() => Math.round(props.state.fillingRatio * 100));

const formatValue = (value: number, unit: string, decimals = 2) => {
  return `${value.toFixed(decimals)} ${unit}`;
};
</script>

<template>
  <div
    class="tank-overview"
    :class="{ selected: isSelected }"
    @click="emit('select', state.id)"
  >
    <div class="tank-header">
      <span class="tank-name">{{ state.name }}</span>
      <span class="severity-badge" :style="{ backgroundColor: severityColor }">
        {{ severityText }}
      </span>
    </div>

    <div class="tank-body">
      <div class="tank-diagram">
        <div class="tank-outline">
          <div
            class="tank-liquid"
            :style="{
              height: `${fillingPercent}%`,
              backgroundColor: severityColor + '40',
              boxShadow: `0 0 20px ${severityColor}60`,
            }"
          ></div>
          <div
            class="wave-indicator"
            :style="{
              bottom: `${fillingPercent}%`,
              opacity: state.impactForce > 50 ? 1 : 0.3,
            }"
          >
            <div class="wave-line" :style="{ backgroundColor: severityColor }"></div>
          </div>
        </div>
      </div>

      <div class="tank-metrics">
        <div class="metric-row">
          <span class="metric-label">液位</span>
          <span class="metric-value">{{ formatValue(state.currentLevel, 'm') }}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">压力</span>
          <span class="metric-value">{{ formatValue(state.currentPressure, 'kPa') }}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">温度</span>
          <span class="metric-value">{{ formatValue(state.currentTemperature, '°C') }}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">横摇</span>
          <span class="metric-value">{{ formatValue(state.inclination.x, '°') }}</span>
        </div>
        <div class="metric-row">
          <span class="metric-label">冲击力</span>
          <span class="metric-value" :style="{ color: severityColor }">
            {{ formatValue(state.impactForce, 'N', 1) }}
          </span>
        </div>
        <div class="metric-row">
          <span class="metric-label">稳性</span>
          <div class="stability-bar">
            <div
              class="stability-fill"
              :style="{
                width: `${stabilityPercent}%`,
                backgroundColor: stabilityPercent > 70 ? '#00ff88' : stabilityPercent > 40 ? '#ffcc00' : '#ff6600',
              }"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <div class="tank-footer">
      <span class="update-time">
        {{ new Date(state.lastUpdateUs / 1000).toLocaleTimeString('zh-CN', { hour12: false }) }}
      </span>
      <span class="tank-position">
        X: {{ state.position.x.toFixed(0) }}m
      </span>
    </div>
  </div>
</template>

<style scoped>
.tank-overview {
  background: rgba(10, 15, 25, 0.85);
  border: 1px solid rgba(100, 150, 200, 0.3);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.tank-overview:hover {
  border-color: rgba(100, 200, 255, 0.6);
  transform: translateY(-2px);
  box-shadow: 0 4px 20px rgba(0, 150, 255, 0.2);
}

.tank-overview.selected {
  border-color: #00aaff;
  box-shadow: 0 0 20px rgba(0, 170, 255, 0.4);
}

.tank-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.tank-name {
  font-size: 14px;
  font-weight: bold;
  color: #ffffff;
}

.severity-badge {
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: bold;
  color: #000;
  text-transform: uppercase;
}

.tank-body {
  display: flex;
  gap: 12px;
  align-items: stretch;
}

.tank-diagram {
  width: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.tank-outline {
  width: 24px;
  height: 80px;
  border: 2px solid rgba(100, 150, 200, 0.5);
  border-radius: 2px;
  position: relative;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.3);
}

.tank-liquid {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  transition: height 0.3s ease;
}

.wave-indicator {
  position: absolute;
  left: 0;
  right: 0;
  height: 4px;
  transition: bottom 0.1s ease;
}

.wave-line {
  height: 2px;
  width: 100%;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.tank-metrics {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.metric-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.metric-label {
  color: #88aacc;
}

.metric-value {
  color: #ffffff;
  font-family: monospace;
}

.stability-bar {
  width: 60px;
  height: 6px;
  background: rgba(50, 50, 50, 0.8);
  border-radius: 3px;
  overflow: hidden;
}

.stability-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.tank-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(100, 150, 200, 0.2);
  font-size: 10px;
  color: rgba(136, 170, 204, 0.7);
}
</style>
