import { createApp } from 'vue';
import App from './App.vue';
import { websocketService } from './services/websocket';

websocketService.connect();

const app = createApp(App);
app.mount('#app');
