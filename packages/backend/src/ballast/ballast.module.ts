import { Module, forwardRef } from '@nestjs/common';
import { BallastControlService } from './ballast-control.service';
import { MqttModule } from '../mqtt/mqtt.module';
import { TankModule } from '../tank/tank.module';
import { WebsocketModule } from '../websocket/websocket.module';

@Module({
  imports: [MqttModule, TankModule, forwardRef(() => WebsocketModule)],
  providers: [BallastControlService],
  exports: [BallastControlService],
})
export class BallastModule {}
