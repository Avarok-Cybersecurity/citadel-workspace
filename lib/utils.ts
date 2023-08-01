import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { uuid } from 'uuidv4';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function genUuid() {
  return uuid();
}
