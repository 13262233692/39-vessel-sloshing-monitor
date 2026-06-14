<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue';
import { TankRenderer } from '../renderer/TankRenderer';
import { websocketService } from '../services/websocket';
import { DEFAULT_RENDERER_CONFIG } from '../types/frontend';
import type { RendererConfig, TankUpdateMessage, TankStateData } from '../types/frontend';

const props = defineProps<{
  tankId: string;
  config?: Partial<RendererConfig>;
}>();

const emit = defineEmits<{
  (e: 'update', data: TankUpdateMessage): void;
}>();

const canvasRef = ref<HTMLCanvasElement | null>(null);
let renderer: TankRenderer | null = null;
let currentState: TankStateData | null = null;

const rendererConfig = computed<RendererConfig>(() => ({
  ...DEFAULT_RENDERER_CONFIG,
  ...props.config,
}));

const handleResize = () => {
  if (renderer) {
    renderer.resize();
  }
};

const handleTankUpdate = (msg: TankUpdateMessage) => {
  if (renderer && msg.tankId === props.tankId) {
    if (currentState) {
      renderer.setTankState(currentState);
    }
    renderer.setTankUpdate(msg);
    emit('update', msg);
  }
};

const handleAllTanks = (states: TankStateData[]) => {
  const state = states.find(s => s.id === props.tankId);
  if (state) {
    currentState = state;
    if (renderer) {
      renderer.setTankState(state);
    }
  }
};

watch(() => props.config, (newConfig) => {
  if (renderer && newConfig) {
    renderer.updateConfig(newConfig);
  }
}, { deep: true });

onMounted(() => {
  if (!canvasRef.value) return;

  renderer = new TankRenderer(canvasRef.value, rendererConfig.value);
  renderer.start();

  websocketService.subscribeToTank(props.tankId, handleTankUpdate);
  websocketService.onAllTanks(handleAllTanks);

  const initialState = websocketService.getTankState(props.tankId);
  if (initialState) {
    currentState = initialState;
    renderer.setTankState(initialState);
  }

  const initialUpdate = websocketService.getTankUpdate(props.tankId);
  if (initialUpdate) {
    renderer.setTankUpdate(initialUpdate);
  }

  window.addEventListener('resize', handleResize);
});

onUnmounted(() => {
  websocketService.unsubscribeFromTank(props.tankId);
  websocketService.offAllTanks(handleAllTanks);
  window.removeEventListener('resize', handleResize);

  if (renderer) {
    renderer.destroy();
    renderer = null;
  }
});

defineExpose({
  getRenderer: () => renderer,
});
</script>

<template>
  <div class="tank-canvas-wrapper">
    <canvas ref="canvasRef" class="tank-canvas"></canvas>
  </div>
</template>

<style scoped>
.tank-canvas-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.tank-canvas {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
