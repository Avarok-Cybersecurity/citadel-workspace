/**
 * An in-memory Origin Private File System, just deep enough for RevfsOpfsStorage.
 *
 * The service tests stub RevfsIO wholesale, so they never execute the code that
 * writes the tree to disk and reads it back. A reload is exactly that round
 * trip; this lets it run for real, with the files surviving a new service.
 */
import { vi } from 'vitest';

interface FakeDir {
  kind: 'directory';
  dirs: Map<string, FakeDir>;
  files: Map<string, string>;
  getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<FakeDir>;
  getFileHandle: (name: string, opts?: { create?: boolean }) => Promise<FakeFile>;
}

interface FakeFile {
  getFile: () => Promise<{ text: () => Promise<string> }>;
  createWritable: () => Promise<{ write: (s: string) => Promise<void>; close: () => Promise<void> }>;
}

function notFound(name: string): DOMException {
  return new DOMException(`${name} not found`, 'NotFoundError');
}

function makeDir(): FakeDir {
  const dir: FakeDir = {
    kind: 'directory',
    dirs: new Map<string, FakeDir>(),
    files: new Map<string, string>(),
    getDirectoryHandle: async (name: string, opts?: { create?: boolean }): Promise<FakeDir> => {
      const found: FakeDir | undefined = dir.dirs.get(name);
      if (found) return found;
      if (!opts?.create) throw notFound(name);
      const made: FakeDir = makeDir();
      dir.dirs.set(name, made);
      return made;
    },
    getFileHandle: async (name: string, opts?: { create?: boolean }): Promise<FakeFile> => {
      if (!dir.files.has(name)) {
        if (!opts?.create) throw notFound(name);
        dir.files.set(name, '');
      }
      return {
        getFile: async (): Promise<{ text: () => Promise<string> }> => ({ text: async (): Promise<string> => dir.files.get(name) ?? '' }),
        createWritable: async (): Promise<{ write: (s: string) => Promise<void>; close: () => Promise<void> }> => {
          let buffer: string = '';
          return {
            write: async (s: string): Promise<void> => { buffer += s; },
            close: async (): Promise<void> => { dir.files.set(name, buffer); },
          };
        },
      };
    },
  };
  return dir;
}

/** Install a fresh fake OPFS on `navigator.storage`; returns its root. */
export function installFakeOpfs(): FakeDir {
  const root: FakeDir = makeDir();
  vi.stubGlobal('navigator', { ...globalThis.navigator, storage: { getDirectory: async (): Promise<FakeDir> => root } });
  return root;
}
