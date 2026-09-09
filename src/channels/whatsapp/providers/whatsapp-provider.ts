export const WHATSAPP_PROVIDER = Symbol('WHATSAPP_PROVIDER');

export interface SendWhatsAppTextInput {
  phoneNumberId: string;
  recipientPhoneNumber: string;
  text: string;
}

export interface SendWhatsAppTextResult {
  providerMessageId?: string;
}

export interface WhatsAppProvider {
  sendText(input: SendWhatsAppTextInput): Promise<SendWhatsAppTextResult>;
}
