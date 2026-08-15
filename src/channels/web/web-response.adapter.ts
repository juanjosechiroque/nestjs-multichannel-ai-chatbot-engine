import { Injectable } from '@nestjs/common';
import type { ChatContent, ChatResult } from '../../chat/chat.types';

export interface WebChatResponse {
  reply: string;
  content?: ChatContent[];
}

/**
 * Translates the channel-neutral chat result into the web API contract.
 *
 * The web client renders `reply` as text, so Markdown is reduced to readable
 * plain text here instead of trusting model-generated HTML in the browser.
 */
@Injectable()
export class WebResponseAdapter {
  adapt(result: ChatResult): WebChatResponse {
    return {
      reply: this.toPlainText(result.reply),
      ...(result.content ? { content: result.content } : {}),
    };
  }

  private toPlainText(markdown: string): string {
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
      .replace(/\*{3}([^\n]+?)\*{3}/g, '$1')
      .replace(/_{3}([^\n]+?)_{3}/g, '$1')
      .replace(/\*\*([^\n]+?)\*\*/g, '$1')
      .replace(/__([^\n]+?)__/g, '$1')
      .replace(/`([^`\n]+)`/g, '$1')
      .replace(/(^|[\s(])\*([^*\n]+?)\*(?=$|[\s).,!?:;])/g, '$1$2')
      .replace(/(^|[\s(])_([^_\n]+?)_(?=$|[\s).,!?:;])/g, '$1$2')
      .replaceAll('**', '')
      .replace(/\\([\\`*_[\]{}()#+\-.!>])/g, '$1')
      .trim();
  }
}
