import { Module } from '@nestjs/common';
import { WebsocketService } from './websocket.service';
import { SloshingGateway } from './sloshing.gateway';

@Module({
  providers: [WebsocketService, SloshingGateway],
  exports: [WebsocketService],
})
export class WebsocketModule {}
