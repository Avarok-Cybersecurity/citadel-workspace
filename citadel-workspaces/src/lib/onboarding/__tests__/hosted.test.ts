import { describe, it, expect } from 'vitest';
import { isAvarokHosted } from '../hosted';

describe('isAvarokHosted', () => {
  it.each(['acme.work.avarok.net', 'acme.work.avarok.net:12349', 'wss://acme.work.avarok.net/x', 'ACME.Work.Avarok.net', 'work.avarok.net'])(
    '%s is a server Avarok hosts', (address: string) => {
      expect(isAvarokHosted(address)).toBe(true);
    });

  it.each(['localhost:12349', '127.0.0.1:12349', 'citadel.example.com', 'evilwork.avarok.net', 'work.avarok.net.evil.example', 'avarok.net', 'acme.work.avarok.net.evil.example:1', ''])(
    '%s is not', (address: string) => {
      expect(isAvarokHosted(address)).toBe(false);
    });
});
