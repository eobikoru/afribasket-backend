import { Module } from '@nestjs/common';
import { AdminsModule } from '../admins/admins.module';
import { AuthModule } from '../auth/auth.module';
import { AdminReviewsController, ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [AuthModule, AdminsModule],
  controllers: [ReviewsController, AdminReviewsController],
  providers: [ReviewsService],
})
export class ReviewsModule {}
