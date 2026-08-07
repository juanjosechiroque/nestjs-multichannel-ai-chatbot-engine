import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { MemoryService } from './memory.service';

@Module({
  imports: [DatabaseModule],
  providers: [MemoryService],
  exports: [MemoryService],
})
export class MemoryModule {}
