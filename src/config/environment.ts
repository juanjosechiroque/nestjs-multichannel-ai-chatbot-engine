import { plainToInstance, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV = 'development';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

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
  OPENAI_GENERATION_TIMEOUT_MS = 20_000;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  OPENAI_GENERATION_MAX_RETRIES = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1_000)
  @Max(120_000)
  OPENAI_EMBEDDING_TIMEOUT_MS = 8_000;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  OPENAI_EMBEDDING_MAX_RETRIES = 1;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  RAG_MIN_SIMILARITY = 0.5;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  OPENAI_MAX_OUTPUT_TOKENS = 1_000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  BUSINESS_NAME!: string;
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
