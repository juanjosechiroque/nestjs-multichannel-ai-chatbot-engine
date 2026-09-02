import type OpenAI from 'openai';
import type { RequestContext } from '../../common/request-context';
import type { OrderConversationContext } from './order.tool';

export interface ToolBuildContext {
  orderContext: OrderConversationContext;
}

export interface ToolInvocationContext {
  requestContext: RequestContext;
  conversationId: string;
  orderContext: OrderConversationContext;
  message: string;
  argumentOverride?: string;
}

export interface ChatTool<TArgs = unknown> {
  readonly name: string;
  buildDefinition(context: ToolBuildContext): OpenAI.Responses.FunctionTool | null;
  parseArguments(argumentsJson: string): TArgs;
  execute(args: TArgs, context: ToolInvocationContext): Promise<string>;
}

export const CHAT_TOOLS = Symbol('CHAT_TOOLS');
