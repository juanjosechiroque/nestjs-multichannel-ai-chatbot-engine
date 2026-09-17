import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class WebDocumentContentDto {
  @ApiProperty({ enum: ['document'], example: 'document' })
  type!: 'document';

  @ApiProperty({ example: 'Carta del negocio' })
  title!: string;

  @ApiProperty({ example: '/api/menu' })
  url!: string;

  @ApiProperty({ enum: ['application/pdf'], example: 'application/pdf' })
  mimeType!: 'application/pdf';
}

export class WebChatResponseDto {
  @ApiProperty({ example: 'El cappuccino cuesta S/ 13.' })
  reply!: string;

  @ApiPropertyOptional({ type: [WebDocumentContentDto] })
  content?: WebDocumentContentDto[];
}

export class CreateWebConversationResponseDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Public session identifier that the web client must persist.',
    example: 'a51f973c-4f93-4cc5-832d-63ae2ff86d65',
  })
  sessionId!: string;
}
