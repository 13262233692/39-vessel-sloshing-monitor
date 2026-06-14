import { Module } from '@nestjs/common';
import { DataPipelineService } from './data-pipeline.service';
import { InfluxModule } from '../influx/influx.module';
import { TankModule } from '../tank/tank.module';
import { SloshingModule } from '../sloshing/sloshing.module';
import { WebsocketModule } from '../websocket/websocket.module';
import { WorkerModule } from '../worker/worker.module';
import { BallastModule } from '../ballast/ballast.module';

@Module({
  imports: [InfluxModule, TankModule, SloshingModule, WebsocketModule, WorkerModule, BallastModule],
  providers: [DataPipelineService],
  exports: [DataPipelineService],
})
export class DataPipelineModule {}
