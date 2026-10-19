import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { addressSchema, changePasswordSchema, updateProfileSchema } from '../auth/auth.schemas';
import { AuthService } from '../auth/auth.service';
import { CurrentUser } from '../auth/decorators';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import type { AuthUser } from '../auth/auth.types';
import { Roles } from '../auth/decorators';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { paginationSchema } from '../common/pagination';
import { ApiFilterQuery, PAGE_QUERIES } from '../common/swagger';
import { z } from 'zod';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class CustomersController {
  constructor(
    private readonly customers: CustomersService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Current customer profile' })
  me(@CurrentUser() user: AuthUser) {
    return this.customers.get(user.id);
  }

  @Patch()
  @ApiOperation({ summary: 'Update profile, phone, marketing opt-in, or default address' })
  update(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(updateProfileSchema)) body: z.infer<typeof updateProfileSchema>,
  ) {
    return this.customers.update(user.id, body);
  }

  @Post('password')
  @ApiOperation({ summary: 'Change password and revoke refresh tokens' })
  password(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>,
  ) {
    return this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Saved US shipping addresses' })
  addresses(@CurrentUser() user: AuthUser) {
    return this.customers.listAddresses(user.id);
  }

  @Post('addresses')
  @ApiOperation({ summary: 'Save a US address' })
  createAddress(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(addressSchema)) body: z.infer<typeof addressSchema>) {
    return this.customers.createAddress(user.id, body);
  }

  @Patch('addresses/:id')
  @ApiOperation({ summary: 'Update a saved address' })
  updateAddress(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(addressSchema.partial())) body: Partial<z.infer<typeof addressSchema>>,
  ) {
    return this.customers.updateAddress(user.id, id, body);
  }

  @Delete('addresses/:id')
  @ApiOperation({ summary: 'Delete a saved address' })
  deleteAddress(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.customers.deleteAddress(user.id, id);
  }
}

const customerQuery = paginationSchema.extend({ q: z.string().trim().optional() });

@ApiTags('admin-customers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @ApiOperation({ summary: 'List customers' })
  @ApiFilterQuery([...PAGE_QUERIES, { name: 'q', description: 'Search email or name' }])
  list(@Query(new ZodValidationPipe(customerQuery)) query: z.infer<typeof customerQuery>) {
    return this.customers.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Customer detail' })
  get(@Param('id') id: string) {
    return this.customers.getForAdmin(id);
  }
}
