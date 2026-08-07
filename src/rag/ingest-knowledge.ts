import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';

async function ingestKnowledge(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule);

  try {
    await application.get(KnowledgeIngestionService).ingest();
  } finally {
    await application.close();
  }
}

ingestKnowledge().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown ingestion error';
  console.error(`Knowledge ingestion failed: ${message}`);
  process.exitCode = 1;
});
