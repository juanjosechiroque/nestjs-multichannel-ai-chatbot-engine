import { plainToInstance, Transform, type TransformFnParams, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  IsTimeZone,
  IsUrl,
  Max,
  MinLength,
  Min,
  validateSync,
} from 'class-validator';

function parseCorsAllowedOrigins(value: unknown): unknown {
  if (typeof value !== 'string') return value;

  return value
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
}

class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @Transform(({ value }: TransformFnParams) => parseCorsAllowedOrigins(value as unknown))
  @IsArray()
  @ArrayNotEmpty()
  @IsUrl(
    { protocols: ['http', 'https'], require_protocol: true, require_tld: false },
    { each: true },
  )
  CORS_ALLOWED_ORIGINS: string[] = ['http://localhost:4173'];

  @IsString()
  @IsNotEmpty()
  OPENAI_API_KEY!: string;

  @IsString()
  @IsNotEmpty()
  OPENAI_MODEL = 'gpt-5.6-luna';

  @IsString()
  @IsNotEmpty()
  OPENAI_EMBEDDING_MODEL = 'text-embedding-3-small';

  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(120_000)
  OPENAI_TIMEOUT_MS = 20_000;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  OPENAI_MAX_RETRIES = 1;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  RAG_MIN_SIMILARITY = 0.5;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  RATE_LIMIT_CONVERSATIONS_PER_HOUR = 5;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  RATE_LIMIT_MESSAGES_PER_MINUTE = 10;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  WHATSAPP_VERIFY_TOKEN!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(32)
  WHATSAPP_APP_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(20)
  WHATSAPP_ACCESS_TOKEN!: string;

  @IsString()
  @IsNotEmpty()
  BUSINESS_NAME!: string;

  @IsTimeZone()
  BUSINESS_TIME_ZONE = 'America/Lima';
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration: ${errors.toString()}`);
  }

  return validated;
}
