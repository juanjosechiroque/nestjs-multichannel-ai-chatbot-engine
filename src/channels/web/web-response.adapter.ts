import { Injectable } from '@nestjs/common';
import type { ChatResult } from '../../chat/chat.types';
import type { WebChatResponseDto } from './dto/web-chat-response.dto';

export type WebChatResponse = WebChatResponseDto;

/**
 * Translates the channel-neutral chat result into the web API contract.
 *
 * The web client renders `reply` as text and recognizes only `**strong**`
 * emphasis. All other Markdown is reduced to readable text here; model output
 * is never treated as HTML in the browser.
 */
@Injectable()
export class WebResponseAdapter {
  adapt(result: ChatResult): WebChatResponse {
    return {
      reply: this.toWidgetText(result.reply),
      ...(result.content ? { content: result.content } : {}),
    };
  }

  private toWidgetText(markdown: string): string {
    return markdown
      .replaceAll('\r\n', '\n')
      .replaceAll('\r', '\n')
      .replace(/```(?:[\w-]+)?\n?([\s\S]*?)```/g, '$1')
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g, '$1 ($2)')
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)(?:\s+"[^"]*")?\)/g,
        (_match: string, label: string, url: string) => (label === url ? url : `${label} (${url})`),
      )
      .replace(/^ {0,3}#{1,6}[\t ]+/gm, '')
      .replace(/^ {0,3}>[\t ]?/gm, '')
      .replace(/^ {0,3}(?:\*{3,}|-{3,}|_{3,})[\t ]*$/gm, '')
      .replace(/^([\t ]*)[+*][\t ]+/gm, '$1- ')
      .replace(/~~([^\n]+?)~~/g, '$1')
      .replace(/\*{3}([^\n]+?)\*{3}/g, '**$1**')
      .replace(/_{3}([^\n]+?)_{3}/g, '**$1**')
      .replace(/__([^\n]+?)__/g, '**$1**')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/(^|[\s(])\*([^*\n]+?)\*(?=$|[\s).,!?:;])/g, '$1$2')
      .replace(/(^|[\s(])_([^_\n]+?)_(?=$|[\s).,!?:;])/g, '$1$2')
      .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1')
      .replaceAll('¿', '')
      .replaceAll('¡', '')
      .replace(/(S\/\s*\d+(?:[.,]\d{1,2})?)\s+PEN\b/gi, '$1')
      .replace(/\bTeléfono:\s*(\d{3})\b/gi, 'Teléfono terminado en $1')
      .trim();
  }
}
