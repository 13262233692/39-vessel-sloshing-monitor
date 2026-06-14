<script setup lang="ts">
import { ref, reactive } from 'vue';
import type { RendererConfig } from '../types/frontend';

const props = defineProps<{
  config: RendererConfig;
}>();

const emit = defineEmits<{
  (e: 'update:config', config: RendererConfig): void;
}>();

const localConfig = reactive<RendererConfig>({ ...props.config });

const updateConfig = () => {
  emit('update:config', { ...localConfig });
};

const toggleOption = (key: keyof RendererConfig) => {
  if (typeof localConfig[key] === 'boolean') {
    (localConfig[key] as boolean) = !(localConfig[key] as boolean);
    updateConfig();
  }
};

const updateSlider = (key: keyof RendererConfig, value: number) => {
  (localConfig[key] as number) = value;
  updateConfig();
};

const isExpanded = ref(true);
</script>

<template>
  <div class="control-panel">
    <div class="panel-header" @click="isExpanded = !isExpanded">
      <span class="panel-title">渲染控制</span>
      <span class="expand-icon">{{ isExpanded ? '▼' : '▶' }}</span>
    </div>

    <div v-show="isExpanded" class="panel-content">
      <div class="control-section">
        <div class="section-title">显示选项</div>

        <div class="control-item" @click="toggleOption('showVelocityField')">
          <div class="checkbox" :class="{ checked: localConfig.showVelocityField }">
            <span v-if="localConfig.showVelocityField">✓</span>
          </div>
          <span class="control-label">速度场向量</span>
        </div>

        <div class="control-item" @click="toggleOption('showImpactZones')">
          <div class="checkbox" :class="{ checked: localConfig.showImpactZones }">
            <span v-if="localConfig.showImpactZones">✓</span>
          </div>
          <span class="control-label">冲击区域高亮</span>
        </div>

        <div class="control-item" @click="toggleOption('showWaveform')">
          <div class="checkbox" :class="{ checked: localConfig.showWaveform }">
            <span v-if="localConfig.showWaveform">✓</span>
          </div>
          <span class="control-label">波形与应力图</span>
        </div>

        <div class="control-item" @click="toggleOption('wireframeMode')">
          <div class="checkbox" :class="{ checked: localConfig.wireframeMode }">
            <span v-if="localConfig.wireframeMode">✓</span>
          </div>
          <span class="control-label">线框模式</span>
        </div>

        <div class="control-item" @click="toggleOption('antiAliasing')">
          <div class="checkbox" :class="{ checked: localConfig.antiAliasing }">
            <span v-if="localConfig.antiAliasing">✓</span>
          </div>
          <span class="control-label">抗锯齿</span>
        </div>
      </div>

      <div class="control-section">
        <div class="section-title">渲染质量</div>

        <div class="control-slider">
          <div class="slider-label">
            <span>平滑度</span>
            <span class="slider-value">{{ (localConfig.smoothingLevel * 100).toFixed(0) }}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            :value="localConfig.smoothingLevel"
            @input="updateSlider('smoothingLevel', parseFloat(($event.target as HTMLInputElement).value))"
          />
        </div>
      </div>

      <div class="control-section">
        <div class="section-title">快捷操作</div>
        <div class="action-buttons">
          <button class="action-btn" @click="localConfig.wireframeMode = !localConfig.wireframeMode; updateConfig()">
            {{ localConfig.wireframeMode ? '实体' : '线框' }}
          </button>
          <button class="action-btn" @click="Object.assign(localConfig, props.config); updateConfig()">
            重置
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.control-panel {
  background: rgba(10, 15, 25, 0.9);
  border: 1px solid rgba(100, 150, 200, 0.3);
  border-radius: 8px;
  overflow: hidden;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  background: rgba(0, 100, 150, 0.2);
  cursor: pointer;
  user-select: none;
}

.panel-title {
  font-size: 13px;
  font-weight: bold;
  color: #88ccff;
}

.expand-icon {
  font-size: 10px;
  color: #88aacc;
  transition: transform 0.2s ease;
}

.panel-content {
  padding: 12px;
}

.control-section {
  margin-bottom: 16px;
}

.control-section:last-child {
  margin-bottom: 0;
}

.section-title {
  font-size: 11px;
  color: #88aacc;
  margin-bottom: 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid rgba(100, 150, 200, 0.2);
}

.control-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 4px;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.2s ease;
}

.control-item:hover {
  background: rgba(100, 150, 200, 0.1);
}

.checkbox {
  width: 16px;
  height: 16px;
  border: 1px solid rgba(100, 150, 200, 0.5);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #00ff88;
}

.checkbox.checked {
  background: rgba(0, 255, 136, 0.2);
  border-color: #00ff88;
}

.control-label {
  font-size: 12px;
  color: #c0d0e0;
}

.control-slider {
  padding: 4px;
}

.slider-label {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #c0d0e0;
  margin-bottom: 6px;
}

.slider-value {
  font-family: monospace;
  color: #88ccff;
}

input[type="range"] {
  width: 100%;
  height: 4px;
  background: rgba(50, 70, 90, 0.8);
  border-radius: 2px;
  outline: none;
  -webkit-appearance: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 14px;
  height: 14px;
  background: #00aaff;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 0 8px rgba(0, 170, 255, 0.6);
}

.action-buttons {
  display: flex;
  gap: 8px;
}

.action-btn {
  flex: 1;
  padding: 6px 10px;
  background: rgba(0, 100, 150, 0.3);
  border: 1px solid rgba(100, 150, 200, 0.4);
  border-radius: 4px;
  color: #88ccff;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background: rgba(0, 150, 200, 0.4);
  border-color: rgba(100, 200, 255, 0.6);
}
</style>
