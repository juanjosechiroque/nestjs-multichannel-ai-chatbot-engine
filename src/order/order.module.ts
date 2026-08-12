import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { OrderStateMachine } from './order-state-machine';
import { OrderService } from './order.service';

@Module({
  imports: [DatabaseModule],
  providers: [OrderService, OrderStateMachine],
  exports: [OrderService, OrderStateMachine],
})
export class OrderModule {}
