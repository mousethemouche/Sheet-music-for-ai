/**
 * Public liveness and version routes (issue #21). No token, no rate limit,
 * no database: a store outage never makes the process look dead, and the
 * answers hold no configuration, secret or user data.
 */
import { Controller, Get, Header } from '@nestjs/common';
import { version as API_VERSION } from '../package.json';
import { Public } from './auth';

export const SERVICE_NAME = 'sheet-music-api';

export interface HealthResponse {
  readonly status: 'ok';
}

export interface VersionResponse {
  readonly service: string;
  readonly version: string;
}

@Public()
@Controller()
export class SystemController {
  @Get('health')
  @Header('Cache-Control', 'no-store')
  health(): HealthResponse {
    return { status: 'ok' };
  }

  @Get('version')
  @Header('Cache-Control', 'no-store')
  version(): VersionResponse {
    return { service: SERVICE_NAME, version: API_VERSION };
  }
}
