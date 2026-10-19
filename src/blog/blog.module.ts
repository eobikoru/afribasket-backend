import { Module } from '@nestjs/common';
import { AdminsModule } from '../admins/admins.module';
import { AuthModule } from '../auth/auth.module';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminBlogController, BlogController } from './blog.controller';
import { BlogService } from './blog.service';

@Module({
  imports: [AuthModule, AdminsModule, CatalogModule],
  controllers: [BlogController, AdminBlogController],
  providers: [BlogService],
  exports: [BlogService],
})
export class BlogModule {}
