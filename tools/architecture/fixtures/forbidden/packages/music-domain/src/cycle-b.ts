import { first } from './cycle-a';

export const second = (): number => (first.length > 0 ? 0 : 1);
