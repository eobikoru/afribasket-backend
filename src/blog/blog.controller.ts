import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BlogPostStatus } from '@prisma/client';
import type { Request } from 'express';
import { z } from 'zod';
import { AuditService } from '../admins/admins.service';
import { CurrentUser, Roles } from '../auth/decorators';
import type { AuthUser } from '../auth/auth.types';
import { JwtAuthGuard, OptionalCustomerGuard, RolesGuard } from '../auth/guards';
import { Errors } from '../common/errors/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { paginationSchema } from '../common/pagination';
import { ImageStorage } from '../catalog/image-storage';
import { blogCategorySchema, blogPostSchema, BlogService, commentSchema } from './blog.service';

const listQuery = paginationSchema.extend({
  category: z.string().optional(),
  tag: z.string().optional(),
});

@ApiTags('blog')
@Controller('blog')
export class BlogController {
  constructor(private readonly blog: BlogService) {}

  @Get('posts')
  posts(@Query(new ZodValidationPipe(listQuery)) query: z.infer<typeof listQuery>) {
    return this.blog.listPublic(query);
  }

  @Get('posts/:slug')
  post(@Param('slug') slug: string) {
    return this.blog.getBySlug(slug);
  }

  @Get('posts/:slug/related')
  related(@Param('slug') slug: string) {
    return this.blog.relatedBySlug(slug);
  }

  @Post('posts/:slug/comments')
  @UseGuards(OptionalCustomerGuard)
  comment(
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(commentSchema)) body: z.infer<typeof commentSchema>,
    @Req() req: Request,
  ) {
    const user = (req as Request & { user?: AuthUser }).user;
    return this.blog.comment(slug, body, req.ip ?? 'unknown', user?.type === 'customer' ? user.id : undefined);
  }

  @Get('categories')
  categories() {
    return this.blog.listCategories();
  }
}

@ApiTags('admin-blog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN', 'BLOG_AUTHOR')
@Controller('admin/blog')
export class AdminBlogController {
  constructor(
    private readonly blog: BlogService,
    private readonly images: ImageStorage,
    private readonly audit: AuditService,
  ) {}

  @Get('posts')
  posts(@Query(new ZodValidationPipe(paginationSchema.extend({ status: z.nativeEnum(BlogPostStatus).optional() }))) query: { page: number; perPage: number; status?: BlogPostStatus }) {
    return this.blog.listAdmin(query);
  }

  @Post('posts')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(blogPostSchema)) body: z.infer<typeof blogPostSchema>) {
    const post = await this.blog.createPost(user.id, body);
    await this.audit.record({ adminId: user.id, action: 'create', entityType: 'blog_post', entityId: post.id });
    return post;
  }

  @Patch('posts/:id')
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(blogPostSchema.partial())) body: Partial<z.infer<typeof blogPostSchema>>,
  ) {
    const post = await this.blog.updatePost(id, user.id, body);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'blog_post', entityId: id });
    return post;
  }

  @Delete('posts/:id')
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.blog.removePost(id);
    await this.audit.record({ adminId: user.id, action: 'delete', entityType: 'blog_post', entityId: id });
    return result;
  }

  @Post('images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw Errors.badRequest('Image file is required');
    return this.images.upload(file.buffer, 'blog');
  }

  @Get('categories')
  categories() {
    return this.blog.listCategories();
  }

  @Post('categories')
  async createCategory(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(blogCategorySchema)) body: z.infer<typeof blogCategorySchema>) {
    const category = await this.blog.createCategory(body);
    await this.audit.record({ adminId: user.id, action: 'create', entityType: 'blog_category', entityId: category.id });
    return category;
  }

  @Get('tags')
  tags() {
    return this.blog.listTags();
  }

  @Post('tags')
  async createTag(@CurrentUser() user: AuthUser, @Body() body: { name: string; slug?: string }) {
    const tag = await this.blog.createTag(body.name, body.slug);
    await this.audit.record({ adminId: user.id, action: 'create', entityType: 'blog_tag', entityId: tag.id });
    return tag;
  }

  @Post('comments/:id/hide')
  async hide(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const comment = await this.blog.hideComment(id, true);
    await this.audit.record({ adminId: user.id, action: 'update', entityType: 'blog_comment', entityId: id, metadata: { hidden: true } });
    return comment;
  }

  @Delete('comments/:id')
  async removeComment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const result = await this.blog.deleteComment(id);
    await this.audit.record({ adminId: user.id, action: 'delete', entityType: 'blog_comment', entityId: id });
    return result;
  }
}
