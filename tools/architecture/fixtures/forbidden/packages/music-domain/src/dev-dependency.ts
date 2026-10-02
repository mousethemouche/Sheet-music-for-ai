// Forbidden: production code importing a devDependency (its entry point sits under dist/).
import { describe } from 'test-runner';

export const suite = describe;
