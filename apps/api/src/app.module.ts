import { Module } from '@nestjs/common';

/**
 * Root module of the HTTP composition root. It wires adapters to the shared
 * music-application use cases; it owns no business rules (ADR-003).
 * Saved-score, health and version routes attach here in #21.
 */
@Module({})
export class AppModule {}
