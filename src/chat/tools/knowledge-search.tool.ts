import { Inject, Injectable } from '@nestjs/common';
import type { RequestContext } from '../../common/request-context';
import { RagService } from '../../rag/rag.service';

const RAG_TOP_K = 5;

export interface KnowledgeSearchInput {
  query: string;
  context: RequestContext;
}

@Injectable()
export class KnowledgeSearchTool {
  constructor(
    @Inject(RagService)
    private readonly rag: Pick<RagService, 'getContext'>,
  ) {}

  async execute({ query, context }: KnowledgeSearchInput): Promise<string> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      throw new RangeError('Knowledge search query cannot be empty');
    }

    return this.rag.getContext(normalizedQuery, RAG_TOP_K, context);
  }
}
