import { Module } from '@nestjs/common';
import { MqttService } from './mqtt.service';
import { MqttSubscriber } from './mqtt.subscriber';

@Module({
  providers: [MqttService, MqttSubscriber],
  exports: [MqttService],
})
export class MqttModule {}
