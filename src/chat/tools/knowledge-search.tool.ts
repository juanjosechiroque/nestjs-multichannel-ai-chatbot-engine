import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '../../common/request-context';
import type { ChatHistoryMessage } from '../../memory/memory.types';
import { RagService } from '../../rag/rag.service';
import { buildRetrievalQuery } from '../../rag/retrieval-query';

const RAG_TOP_K = 5;

export interface KnowledgeSearchInput {
  query: string;
  history: ChatHistoryMessage[];
  context: RequestContext;
}

@Injectable()
export class KnowledgeSearchTool {
  constructor(
    @Inject(RagService)
    private readonly rag: Pick<RagService, 'getContext'>,
  ) {}

  async execute({ query, history, context }: KnowledgeSearchInput): Promise<string> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      throw new RangeError('Knowledge search query cannot be empty');
    }

    return this.rag.getContext(buildRetrievalQuery(normalizedQuery, history), RAG_TOP_K, context);
  }
}
