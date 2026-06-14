import { Module } from '@nestjs/common';
import { TankService } from './tank.service';

@Module({
  providers: [TankService],
  exports: [TankService],
})
export class TankModule {}
