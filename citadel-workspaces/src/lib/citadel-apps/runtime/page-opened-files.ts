/**
 * The page's one inbox of files opened in installed apps: the file browser and chat offer to it (by app id),
 * every mount on the page takes from it (page-runtime.ts). Its own module, so offering a file
 * does not load the runtime.
 */
import { OpenedFiles } from './opened-files';

export const pageOpenedFiles: OpenedFiles = new OpenedFiles();
