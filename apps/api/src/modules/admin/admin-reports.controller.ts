import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import {
  ProviderReportSchema,
  ReportQuerySchema,
  ReportsOverviewSchema,
  type ProviderReport,
  type ReportQuery,
  type ReportsOverview,
} from '@vrp/contracts';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodResponse } from '../../openapi/zod-openapi';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminReportsService } from './admin-reports.service';
import { CSV_CONTENT_TYPE } from './csv';

const QueryPipe = new ZodValidationPipe(ReportQuerySchema);

/** Operational reports and their fixed CSV exports (Phase 9, PRD FR-AD7). */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly service: AdminReportsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Funnel, status counts, GMV, money, supply / demand and operations for a day range',
  })
  @ApiZodResponse(200, ReportsOverviewSchema)
  overview(@Query(QueryPipe) query: ReportQuery): Promise<ReportsOverview> {
    return this.service.overview(query);
  }

  @Get('overview.csv')
  @Header('Content-Type', CSV_CONTENT_TYPE)
  @Header('Content-Disposition', 'attachment; filename="overview.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'The overview report as CSV (section, metric, value)' })
  overviewCsv(@Query(QueryPipe) query: ReportQuery): Promise<string> {
    return this.service.overviewCsv(query);
  }

  @Get('providers')
  @ApiOperation({ summary: 'Per-provider operational metrics (Phase 8 formulas); no ranking' })
  @ApiZodResponse(200, ProviderReportSchema)
  providers(): Promise<ProviderReport> {
    return this.service.providers();
  }

  @Get('providers.csv')
  @Header('Content-Type', CSV_CONTENT_TYPE)
  @Header('Content-Disposition', 'attachment; filename="providers.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'The provider report as CSV' })
  providersCsv(): Promise<string> {
    return this.service.providersCsv();
  }

  @Get('zero-result-searches.csv')
  @Header('Content-Type', CSV_CONTENT_TYPE)
  @Header('Content-Disposition', 'attachment; filename="zero-result-searches.csv"')
  @ApiProduces('text/csv')
  @ApiOperation({ summary: 'Zero-result searches grouped by place, category and dates (no PII)' })
  zeroResultsCsv(@Query(QueryPipe) query: ReportQuery): Promise<string> {
    return this.service.zeroResultSearchesCsv(query);
  }
}
