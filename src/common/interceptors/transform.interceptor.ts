import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  StreamableFile,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { Paginated } from '../dto/pagination.dto';
import { serialize } from '../utils/serialize';

/** Wraps every successful JSON response in the `{ success: true, data }` envelope. */
@Injectable()
export class TransformInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result: unknown) => {
        // Files (e.g. Excel exports) are sent as-is, not wrapped in the JSON envelope.
        if (result instanceof StreamableFile) return result;
        if (result instanceof Paginated) {
          return { success: true, data: serialize(result.items), pagination: result.pagination };
        }
        return { success: true, data: serialize(result ?? null) };
      }),
    );
  }
}
