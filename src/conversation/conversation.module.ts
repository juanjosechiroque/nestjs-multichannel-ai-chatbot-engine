import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ConversationService } from './conversation.service';

@Module({
  imports: [DatabaseModule],
  providers: [ConversationService],
  exports: [ConversationService],
})
export class ConversationModule {}
