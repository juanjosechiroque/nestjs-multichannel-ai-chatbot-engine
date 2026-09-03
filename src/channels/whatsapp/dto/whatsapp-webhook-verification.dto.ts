import { IsNotEmpty, IsString } from 'class-validator';

export class WhatsAppWebhookVerificationDto {
  @IsString()
  @IsNotEmpty()
  'hub.mode'!: string;

  @IsString()
  @IsNotEmpty()
  'hub.verify_token'!: string;

  @IsString()
  @IsNotEmpty()
  'hub.challenge'!: string;
}
