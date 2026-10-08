import { applyDecorators, HttpStatus, Type } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { PaginationMetaDto } from '../dto/pagination.dto';

export class ErrorResponseDto {
  @ApiProperty({ example: false })
  success: boolean;

  @ApiProperty({ example: 'Product not found' })
  message: string;

  @ApiProperty({ example: 'PRODUCT_NOT_FOUND' })
  code: string;

  @ApiPropertyOptional({ description: 'Extra error information (e.g. validation errors)' })
  details?: unknown;
}

/** Documents `{ success: true, data: <model> }` (or `data: <model>[]` when `isArray`). */
export function ApiOkWrapped<T extends Type<unknown>>(
  model: T,
  options: { status?: number; isArray?: boolean; description?: string } = {},
) {
  const data = options.isArray
    ? { type: 'array', items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };
  return applyDecorators(
    ApiExtraModels(model),
    ApiResponse({
      status: options.status ?? HttpStatus.OK,
      description: options.description,
      schema: {
        type: 'object',
        required: ['success', 'data'],
        properties: { success: { type: 'boolean', example: true }, data },
      },
    }),
  );
}

/** Documents `{ success: true, data: <model>[], pagination }`. */
export function ApiPaginatedWrapped<T extends Type<unknown>>(model: T, description?: string) {
  return applyDecorators(
    ApiExtraModels(model, PaginationMetaDto),
    ApiResponse({
      status: HttpStatus.OK,
      description,
      schema: {
        type: 'object',
        required: ['success', 'data', 'pagination'],
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'array', items: { $ref: getSchemaPath(model) } },
          pagination: { $ref: getSchemaPath(PaginationMetaDto) },
        },
      },
    }),
  );
}

/** Documents the shared error envelope for the given status codes. */
export function ApiErrors(...statuses: HttpStatus[]) {
  return applyDecorators(
    ...statuses.map((status) => ApiResponse({ status, type: ErrorResponseDto })),
  );
}
