import { Allow, IsNotEmpty, IsString } from 'class-validator';

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

  // Meta's current developer dashboard sends underscore aliases together with
  // the documented dotted parameters. They are redundant and intentionally
  // ignored, but must be whitelisted so strict global DTO validation does not
  // reject the verification request before it reaches the controller.
  @Allow()
  hub_mode?: unknown;

  @Allow()
  hub_verify_token?: unknown;

  @Allow()
  hub_challenge?: unknown;
}
