import { IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

export class WebChatMessageDto {
  @IsUUID('4')
  sessionId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  message!: string;
}
