import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class WebChatMessageDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Backend-created public web conversation identifier.',
    example: 'a51f973c-4f93-4cc5-832d-63ae2ff86d65',
  })
  @IsUUID('4')
  sessionId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Client-created idempotency identifier. Reuse it only when retrying this message.',
    example: 'd355b4d6-a0dc-4a46-bb7d-f86886ea75dc',
  })
  @IsUUID('4')
  messageId!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 2_000,
    example: '¿Qué bebidas calientes tienen y cuánto cuestan?',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  message!: string;
}
