import { Module } from '@nestjs/common';
import { SloshingService } from './sloshing.service';
import { TankModule } from '../tank/tank.module';
import { InfluxModule } from '../influx/influx.module';
import { WorkerModule } from '../worker/worker.module';

@Module({
  imports: [TankModule, InfluxModule, WorkerModule],
  providers: [SloshingService],
  exports: [SloshingService],
})
export class SloshingModule {}
