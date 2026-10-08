import { Injectable, PipeTransform } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
import { ErrorCode } from '../exceptions/error-codes';

/** Parses a positive integer path parameter into a BigInt id. */
@Injectable()
export class ParseIdPipe implements PipeTransform<string, bigint> {
  transform(value: string): bigint {
    if (typeof value !== 'string' || !/^[1-9]\d{0,18}$/.test(value)) {
      throw AppException.badRequest(ErrorCode.VALIDATION_ERROR, `Invalid id "${value}"`);
    }
    return BigInt(value);
  }
}
