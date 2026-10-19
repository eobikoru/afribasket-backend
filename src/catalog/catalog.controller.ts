import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Roles } from '../auth/decorators';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { Errors } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ApiFilterQuery, ApiZodBody, PAGE_QUERIES } from '../common/swagger';
import { AuditService } from '../admins/admins.service';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import {
  categorySchema,
  imageReorderSchema,
  productListSchema,
  productSchema,
  productUpdateSchema,
  tagSchema,
  variantSchema,
} from './catalog.schemas';
import { CategoriesService, TagsService } from './categories.service';
import { ImageStorage } from './image-storage';
import { ProductsService } from './products.service';

@ApiTags('catalog')
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'Search the public catalog' })
  @ApiFilterQuery([
    ...PAGE_QUERIES,
    { name: 'q', description: 'Search name, brand, SKU, or description' },
    { name: 'category', description: 'Category id or slug, including child categories' },
    { name: 'tag', description: 'Tag slug' },
    { name: 'country', description: 'ISO country of origin' },
    { name: 'region', description: 'west_africa, east_africa, southern_africa, north_africa, or pan_african' },
    { name: 'storageType', description: 'ambient, refrigerated, or frozen' },
    { name: 'dietary', description: 'halal, vegetarian, vegan, gluten_free, or spicy' },
    { name: 'minPrice', description: 'Minimum price in cents', type: 'number' },
    { name: 'maxPrice', description: 'Maximum price in cents', type: 'number' },
    { name: 'inStock', description: 'true to hide unavailable products' },
    { name: 'featured', description: 'true for featured products' },
    { name: 'sort', description: 'newest, price_asc, price_desc, name_asc, or name_desc' },
  ])
  list(@Query(new ZodValidationPipe(productListSchema)) query: z.infer<typeof productListSchema>) {
    return this.products.listPublic(query);
  }

  @Get('featured')
  @ApiOperation({ summary: 'Featured products' })
  featured() {
    return this.products.featured();
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Product detail by slug' })
  bySlug(@Param('slug') slug: string) {
    return this.products.getBySlug(slug);
  }

  @Get(':id/related')
  @ApiOperation({ summary: 'Related products by category and tags' })
  related(@Param('id') id: string) {
    return this.products.related(id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Product detail by id' })
  byId(@Param('id') id: string) {
    return this.products.getById(id);
  }
}

@ApiTags('categories')
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  @ApiOperation({ summary: 'Active category tree' })
  tree() {
    return this.categories.tree(true);
  }
}

@ApiTags('admin-catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/products')
export class AdminProductsController {
  constructor(
    private readonly products: ProductsService,
    private readonly images: ImageStorage,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiFilterQuery([...PAGE_QUERIES, { name: 'q', description: 'Search' }, { name: 'sort', description: 'newest, price_asc, price_desc, name_asc, name_desc' }])
  list(@Query(new ZodValidationPipe(productListSchema)) query: z.infer<typeof productListSchema>) {
    return this.products.listAdmin(query);
  }

  @Post()
  @ApiZodBody(productSchema)
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(productSchema)) body: z.infer<typeof productSchema>) {
    const product = await this.products.create(body);
    await this.audit.record({ adminId: user.id, action: 'create', entityType: 'product', entityId: product.id });
    return product;
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.products.getById(id, true);
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(productUpdateSchema)) body: z.infer<typeof productUpdateSchema>,
  ) {
    const product = await this.products.update(id, body);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'product', entityId: id });
    return product;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.products.remove(id);
    await this.audit.record({ adminId: user.id, action: 'delete', entityType: 'product', entityId: id });
    return result;
  }

  @Post(':id/variants')
  async addVariant(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(variantSchema)) body: z.infer<typeof variantSchema>,
  ) {
    const variant = await this.products.addVariant(id, body);
    await this.audit.record({ adminId: user.id, action: 'create', entityType: 'variant', entityId: variant.id });
    return variant;
  }

  @Patch(':id/variants/:variantId')
  async updateVariant(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body(new ZodValidationPipe(variantSchema.partial())) body: Partial<z.infer<typeof variantSchema>>,
  ) {
    const variant = await this.products.updateVariant(id, variantId, body);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'variant', entityId: variantId });
    return variant;
  }

  @Delete(':id/variants/:variantId')
  async removeVariant(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('variantId') variantId: string) {
    const result = await this.products.removeVariant(id, variantId);
    await this.audit.record({ adminId: user.id, action: 'delete', entityType: 'variant', entityId: variantId });
    return result;
  }

  @Post(':id/images')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('altText') altText?: string,
  ) {
    if (!file) throw Errors.badRequest('Image file is required');
    const stored = await this.images.upload(file.buffer, 'products');
    const image = await this.products.addImage(id, { ...stored, altText });
    await this.audit.record({ adminId: user.id, action: 'create', entityType: 'product_image', entityId: image.id });
    return image;
  }

  @Patch(':id/images')
  async reorder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(imageReorderSchema)) body: z.infer<typeof imageReorderSchema>,
  ) {
    const images = await this.products.reorderImages(id, body.images);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'product', entityId: id, metadata: { images: true } });
    return images;
  }

  @Delete(':id/images/:imageId')
  async removeImage(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('imageId') imageId: string) {
    const image = await this.products.deleteImage(id, imageId);
    await this.images.destroy(image.publicId);
    await this.audit.record({ adminId: user.id, action: 'delete', entityType: 'product_image', entityId: imageId });
    return { ok: true };
  }
}

@ApiTags('admin-catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(
    private readonly categories: CategoriesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  tree() {
    return this.categories.tree(false);
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(categorySchema)) body: z.infer<typeof categorySchema>) {
    const category = await this.categories.create(body);
    await this.audit.record({ adminId: user.id, action: 'create', entityType: 'category', entityId: category.id });
    return category;
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(categorySchema.partial())) body: Partial<z.infer<typeof categorySchema>>,
  ) {
    const category = await this.categories.update(id, body);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'category', entityId: id });
    return category;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.categories.remove(id);
    await this.audit.record({ adminId: user.id, action: 'delete', entityType: 'category', entityId: id });
    return result;
  }
}

@ApiTags('admin-catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/tags')
export class AdminTagsController {
  constructor(
    private readonly tags: TagsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.tags.list();
  }

  @Post()
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(tagSchema)) body: z.infer<typeof tagSchema>) {
    const tag = await this.tags.create(body);
    await this.audit.record({ adminId: user.id, action: 'create', entityType: 'tag', entityId: tag.id });
    return tag;
  }

  @Patch(':id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(tagSchema.partial())) body: Partial<z.infer<typeof tagSchema>>,
  ) {
    const tag = await this.tags.update(id, body);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'tag', entityId: id });
    return tag;
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.tags.remove(id);
    await this.audit.record({ adminId: user.id, action: 'delete', entityType: 'tag', entityId: id });
    return result;
  }
}
