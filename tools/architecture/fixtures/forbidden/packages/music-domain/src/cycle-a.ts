// Forbidden: two modules importing each other.
import { second } from './cycle-b';

export const first = (): number => second() + 1;
