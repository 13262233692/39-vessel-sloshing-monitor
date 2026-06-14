<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { websocketService } from '../services/websocket';

const stats = computed(() => ({
  connected: websocketService.connected.value,
  tankCount: websocketService.tankStates.value.size,
  systemStatus: websocketService.systemStatus.value,
}));

const connectionColor = computed(() =>
  stats.value.connected ? '#00ff88' : '#ff6600'
);

const connectionText = computed(() =>
  stats.value.connected ? '已连接' : '连接中...'
);

const formatTime = () => {
  return new Date().toLocaleString('zh-CN', {
    hour12: false,
  });
};

const currentTime = ref(formatTime());
let timer: number | null = null;

onMounted(() => {
  timer = window.setInterval(() => {
    currentTime.value = formatTime();
  }, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="status-bar">
    <div class="status-left">
      <div class="status-item">
        <span class="status-indicator" :style="{ backgroundColor: connectionColor }"></span>
        <span class="status-label">WebSocket</span>
        <span class="status-value">{{ connectionText }}</span>
      </div>
      <div class="status-item">
        <span class="status-indicator" :style="{ backgroundColor: stats.systemStatus.mqttConnected ? '#00ff88' : '#ff6600' }"></span>
        <span class="status-label">MQTT</span>
        <span class="status-value">{{ stats.systemStatus.mqttConnected ? '已连接' : '未连接' }}</span>
      </div>
      <div class="status-item">
        <span class="status-indicator" :style="{ backgroundColor: stats.systemStatus.influxConnected ? '#00ff88' : '#ff6600' }"></span>
        <span class="status-label">InfluxDB</span>
        <span class="status-value">{{ stats.systemStatus.influxConnected ? '已连接' : '未连接' }}</span>
      </div>
    </div>

    <div class="status-center">
      <div class="system-title">
        <span class="title-icon">⚓</span>
        <span class="title-text">大型液舱晃荡实时监控系统</span>
        <span class="title-sub">Vessel Sloshing Monitor v1.0</span>
      </div>
    </div>

    <div class="status-right">
      <div class="status-item">
        <span class="status-label">液舱数量</span>
        <span class="status-value highlight">{{ stats.tankCount }}</span>
      </div>
      <div class="status-item">
        <span class="status-label">数据速率</span>
        <span class="status-value">{{ stats.systemStatus.messageRate }} msg/s</span>
      </div>
      <div class="status-item">
        <span class="status-label">系统时间</span>
        <span class="status-value mono">{{ currentTime }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  background: linear-gradient(90deg, rgba(10, 15, 25, 0.95), rgba(5, 10, 20, 0.98), rgba(10, 15, 25, 0.95));
  border-bottom: 1px solid rgba(100, 150, 200, 0.3);
  height: 48px;
  min-height: 48px;
}

.status-left,
.status-right {
  display: flex;
  align-items: center;
  gap: 20px;
  min-width: 300px;
}

.status-center {
  flex: 1;
  display: flex;
  justify-content: center;
}

.status-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

.status-label {
  color: #88aacc;
}

.status-value {
  color: #ffffff;
}

.status-value.highlight {
  color: #00ff88;
  font-weight: bold;
  font-size: 14px;
}

.status-value.mono {
  font-family: monospace;
}

.system-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-icon {
  font-size: 20px;
}

.title-text {
  font-size: 16px;
  font-weight: bold;
  color: #88ccff;
  letter-spacing: 2px;
}

.title-sub {
  font-size: 11px;
  color: rgba(136, 170, 204, 0.6);
  margin-left: 8px;
}
</style>
