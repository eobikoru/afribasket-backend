import { Module } from '@nestjs/common';
import { AdminsModule } from '../admins/admins.module';
import { AuthModule } from '../auth/auth.module';
import {
  AdminCategoriesController,
  AdminProductsController,
  AdminTagsController,
  CategoriesController,
  ProductsController,
} from './catalog.controller';
import { CategoriesService, TagsService } from './categories.service';
import { ImageStorage } from './image-storage';
import { ProductsService } from './products.service';

@Module({
  imports: [AuthModule, AdminsModule],
  controllers: [ProductsController, CategoriesController, AdminProductsController, AdminCategoriesController, AdminTagsController],
  providers: [ProductsService, CategoriesService, TagsService, ImageStorage],
  exports: [ProductsService, ImageStorage],
})
export class CatalogModule {}
