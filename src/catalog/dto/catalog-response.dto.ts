import { ApiProperty } from '@nestjs/swagger';

class CatalogRecordDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  active!: boolean;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: Date;
}

export class ProductResponseDto extends CatalogRecordDto {
  @ApiProperty({ example: 'Cappuccino Nube' })
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: String, example: '13' })
  price!: string;

  @ApiProperty({ example: 'PEN' })
  currency!: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  category!: { slug: string; label: string };

  @ApiProperty()
  availableForOrdering!: boolean;
}

export class PromotionResponseDto extends CatalogRecordDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  startsAt!: Date | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  endsAt!: Date | null;
}

export class FaqResponseDto extends CatalogRecordDto {
  @ApiProperty()
  question!: string;

  @ApiProperty()
  answer!: string;

  @ApiProperty()
  category!: string;
}
