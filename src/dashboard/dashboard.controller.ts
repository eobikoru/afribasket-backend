import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators';
import { JwtAuthGuard, RolesGuard } from '../auth/guards';
import { DashboardService } from './dashboard.service';

@ApiTags('admin-dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  @ApiQuery({ name: 'from', required: false, description: 'ISO start of the revenue trend' })
  @ApiQuery({ name: 'to', required: false, description: 'ISO end of the revenue trend' })
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.dashboard.summary(from, to);
  }
}
