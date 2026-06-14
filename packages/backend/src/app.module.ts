import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { MqttModule } from './mqtt/mqtt.module';
import { InfluxModule } from './influx/influx.module';
import { WebsocketModule } from './websocket/websocket.module';
import { SloshingModule } from './sloshing/sloshing.module';
import { TankModule } from './tank/tank.module';
import { DataPipelineModule } from './data-pipeline/data-pipeline.module';

@Module({
  imports: [
    ConfigModule,
    MqttModule,
    InfluxModule,
    WebsocketModule,
    TankModule,
    SloshingModule,
    DataPipelineModule,
  ],
})
export class AppModule {}
