import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Logger } from '@sheet-music/server-common';
import { ScoresController } from './scores.controller';
import { SystemController } from './system.controller';
import { API_LOGGER, API_ON_CLOSE, API_USE_CASES, type ApiUseCases } from './tokens';

/** Releases what the composition root opened (the database pool) when the app closes. */
@Injectable()
class ShutdownHook implements OnApplicationShutdown {
  constructor(@Inject(API_ON_CLOSE) private readonly onClose: () => Promise<void>) {}

  async onApplicationShutdown(): Promise<void> {
    await this.onClose();
  }
}

export interface ApiModuleOptions {
  readonly useCases: ApiUseCases;
  readonly logger: Logger;
  readonly onClose: () => Promise<void>;
}

/**
 * Root module of the HTTP composition root. It wires the adapters chosen by
 * `createApiApp` to the shared music-application use cases; it owns no
 * business rules (ADR-003).
 */
@Module({})
export class ApiModule {
  static register(options: ApiModuleOptions): DynamicModule {
    return {
      module: ApiModule,
      controllers: [SystemController, ScoresController],
      providers: [
        { provide: API_USE_CASES, useValue: options.useCases },
        { provide: API_LOGGER, useValue: options.logger },
        { provide: API_ON_CLOSE, useValue: options.onClose },
        ShutdownHook,
      ],
    };
  }
}
