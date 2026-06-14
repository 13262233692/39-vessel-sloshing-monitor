<script setup lang="ts">
import { ref, reactive, onMounted, computed } from 'vue';
import StatusBar from './components/StatusBar.vue';
import TankOverview from './components/TankOverview.vue';
import TankCanvas from './components/TankCanvas.vue';
import ControlPanel from './components/ControlPanel.vue';
import { websocketService } from './services/websocket';
import { DEFAULT_RENDERER_CONFIG } from './types/frontend';
import type { TankStateData, RendererConfig } from './types/frontend';
import { getSeverityColor } from '@vessel/shared';

const selectedTankId = ref<string | null>(null);
const rendererConfig = reactive<RendererConfig>({ ...DEFAULT_RENDERER_CONFIG });
const viewMode = ref<'overview' | 'detail'>('overview');

const tankStates = computed(() => websocketService.getAllTankStates());

const selectedTankState = computed(() =>
  selectedTankId.value ? websocketService.getTankState(selectedTankId.value) : null
);

const selectTank = (tankId: string) => {
  selectedTankId.value = tankId;
  viewMode.value = 'detail';
};

const backToOverview = () => {
  selectedTankId.value = null;
  viewMode.value = 'overview';
};

const overallStatus = computed(() => {
  const states = tankStates.value;
  if (states.length === 0) return { level: 'normal', maxSeverity: 'none' };

  const severityOrder = ['none', 'low', 'moderate', 'high', 'critical', 'extreme'];
  let maxIndex = 0;

  for (const state of states) {
    const idx = severityOrder.indexOf(state.sloshingSeverity);
    if (idx > maxIndex) maxIndex = idx;
  }

  const maxSeverity = severityOrder[maxIndex];
  const level = maxIndex >= 4 ? 'critical' : maxIndex >= 3 ? 'warning' : 'normal';

  return { level, maxSeverity, count: states.length };
});

const alertMessage = computed(() => {
  const { level, maxSeverity } = overallStatus.value;
  if (level === 'critical') {
    return `⚠️ 检测到 ${maxSeverity} 级晃荡风险，请立即采取措施！`;
  }
  if (level === 'warning') {
    return `⚠️ 检测到 ${maxSeverity} 级晃荡，请密切关注`;
  }
  return null;
});

onMounted(() => {
  const states = tankStates.value;
  if (states.length > 0) {
    selectedTankId.value = states[0].id;
  }
});
</script>

<template>
  <div class="app-container">
    <StatusBar />

    <div v-if="alertMessage" class="alert-banner" :class="overallStatus.level">
      {{ alertMessage }}
    </div>

    <div class="main-content">
      <div class="sidebar">
        <div class="sidebar-header">
          <h3>液舱概览</h3>
          <span class="tank-count">{{ tankStates.length }} 个舱</span>
        </div>

        <div class="tank-list">
          <TankOverview
            v-for="state in tankStates"
            :key="state.id"
            :state="state"
            :is-selected="selectedTankId === state.id"
            @select="selectTank"
          />
        </div>

        <ControlPanel
          :config="rendererConfig"
          @update:config="(c) => Object.assign(rendererConfig, c)"
        />
      </div>

      <div class="content-area">
        <div v-if="viewMode === 'overview'" class="overview-view">
          <div class="overview-header">
            <h2>液舱晃荡态势总览</h2>
            <div class="overall-indicator">
              <span class="indicator-label">整体状态</span>
              <span
                class="indicator-value"
                :style="{ backgroundColor: getSeverityColor(overallStatus.maxSeverity as any) }"
              >
                {{ overallStatus.level === 'critical' ? '危险' : overallStatus.level === 'warning' ? '警告' : '正常' }}
              </span>
            </div>
          </div>

          <div class="overview-grid">
            <div
              v-for="state in tankStates"
              :key="state.id"
              class="overview-tank-card"
              @click="selectTank(state.id)"
            >
              <div class="card-header">
                <span>{{ state.name }}</span>
                <span
                  class="severity-dot"
                  :style="{ backgroundColor: getSeverityColor(state.sloshingSeverity) }"
                ></span>
              </div>
              <div class="card-canvas">
                <TankCanvas
                  :tank-id="state.id"
                  :config="{
                    ...rendererConfig,
                    showVelocityField: false,
                    showImpactZones: false,
                    showWaveform: false,
                  }"
                />
              </div>
              <div class="card-footer">
                <span>稳性: {{ (state.stabilityIndex * 100).toFixed(0) }}%</span>
                <span>冲击: {{ state.impactForce.toFixed(0) }}N</span>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="detail-view">
          <div class="detail-header">
            <button class="back-btn" @click="backToOverview">
              ← 返回总览
            </button>
            <h2 v-if="selectedTankState">
              {{ selectedTankState.name }} 实时监控
            </h2>
            <div class="detail-actions">
              <button
                class="view-toggle"
                :class="{ active: viewMode === 'detail' }"
                @click="viewMode = 'detail'"
              >
                单舱视图
              </button>
            </div>
          </div>

          <div class="detail-content">
            <TankCanvas
              v-if="selectedTankId"
              :tank-id="selectedTankId"
              :config="rendererConfig"
              class="main-canvas"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app-container {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.alert-banner {
  padding: 10px 20px;
  text-align: center;
  font-weight: bold;
  font-size: 14px;
  animation: alertPulse 1s ease-in-out infinite;
}

.alert-banner.warning {
  background: rgba(255, 150, 0, 0.3);
  color: #ffcc00;
  border-bottom: 1px solid rgba(255, 200, 0, 0.5);
}

.alert-banner.critical {
  background: rgba(255, 0, 0, 0.3);
  color: #ff6666;
  border-bottom: 1px solid rgba(255, 0, 0, 0.5);
}

@keyframes alertPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.7; }
}

.main-content {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.sidebar {
  width: 320px;
  min-width: 320px;
  background: rgba(10, 15, 25, 0.7);
  border-right: 1px solid rgba(100, 150, 200, 0.3);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

.sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  border-bottom: 1px solid rgba(100, 150, 200, 0.3);
}

.sidebar-header h3 {
  font-size: 14px;
  color: #88ccff;
  margin: 0;
}

.tank-count {
  font-size: 12px;
  color: #88aacc;
  background: rgba(100, 150, 200, 0.2);
  padding: 2px 8px;
  border-radius: 4px;
}

.tank-list {
  flex: 1;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow-y: auto;
}

.content-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.overview-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.overview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid rgba(100, 150, 200, 0.2);
}

.overview-header h2 {
  margin: 0;
  font-size: 18px;
  color: #ffffff;
}

.overall-indicator {
  display: flex;
  align-items: center;
  gap: 10px;
}

.indicator-label {
  font-size: 13px;
  color: #88aacc;
}

.indicator-value {
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: bold;
  color: #000;
}

.overview-grid {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 16px;
  padding: 16px 24px;
  overflow-y: auto;
}

.overview-tank-card {
  background: rgba(10, 15, 25, 0.8);
  border: 1px solid rgba(100, 150, 200, 0.3);
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
}

.overview-tank-card:hover {
  border-color: rgba(100, 200, 255, 0.6);
  transform: translateY(-4px);
  box-shadow: 0 8px 30px rgba(0, 150, 255, 0.3);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: rgba(0, 100, 150, 0.2);
  font-weight: bold;
  color: #ffffff;
}

.severity-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  box-shadow: 0 0 8px currentColor;
}

.card-canvas {
  flex: 1;
  height: 280px;
  min-height: 280px;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  padding: 8px 14px;
  border-top: 1px solid rgba(100, 150, 200, 0.2);
  font-size: 11px;
  color: #88aacc;
}

.detail-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px 24px;
  border-bottom: 1px solid rgba(100, 150, 200, 0.2);
}

.back-btn {
  padding: 6px 14px;
  background: rgba(100, 150, 200, 0.2);
  border: 1px solid rgba(100, 150, 200, 0.4);
  border-radius: 4px;
  color: #88ccff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.back-btn:hover {
  background: rgba(100, 150, 200, 0.3);
}

.detail-header h2 {
  flex: 1;
  margin: 0;
  font-size: 16px;
  color: #ffffff;
}

.detail-actions {
  display: flex;
  gap: 8px;
}

.view-toggle {
  padding: 6px 14px;
  background: rgba(100, 150, 200, 0.2);
  border: 1px solid rgba(100, 150, 200, 0.4);
  border-radius: 4px;
  color: #88aacc;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.view-toggle.active {
  background: rgba(0, 150, 200, 0.4);
  border-color: rgba(0, 200, 255, 0.6);
  color: #ffffff;
}

.detail-content {
  flex: 1;
  overflow: hidden;
}

.main-canvas {
  width: 100%;
  height: 100%;
}
</style>
