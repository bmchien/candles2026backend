import { Module } from '@nestjs/common';
import { ScentsController } from './scents.controller';
import { ScentsService } from './scents.service';

/** Scent showcase (display-only catalogue of fragrances) and its admin management. */
@Module({
  controllers: [ScentsController],
  providers: [ScentsService],
})
export class ScentsModule {}
