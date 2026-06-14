import { Module, forwardRef } from '@nestjs/common';
import { WebsocketService } from './websocket.service';
import { SloshingGateway } from './sloshing.gateway';
import { BallastModule } from '../ballast/ballast.module';

@Module({
  imports: [forwardRef(() => BallastModule)],
  providers: [WebsocketService, SloshingGateway],
  exports: [WebsocketService],
})
export class WebsocketModule {}
