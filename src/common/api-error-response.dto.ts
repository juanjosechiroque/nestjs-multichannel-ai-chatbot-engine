import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({
    oneOf: [
      { type: 'string', example: 'Conversation not found' },
      { type: 'array', items: { type: 'string' } },
    ],
  })
  message!: string | string[];

  @ApiPropertyOptional({ example: 'Bad Request' })
  error?: string;
}
