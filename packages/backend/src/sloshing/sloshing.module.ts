import { Module } from '@nestjs/common';
import { SloshingService } from './sloshing.service';
import { TankModule } from '../tank/tank.module';
import { InfluxModule } from '../influx/influx.module';

@Module({
  imports: [TankModule, InfluxModule],
  providers: [SloshingService],
  exports: [SloshingService],
})
export class SloshingModule {}
