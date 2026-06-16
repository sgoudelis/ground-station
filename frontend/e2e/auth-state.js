import path from 'path';
import { fileURLToPath } from 'url';

const e2eDir = path.dirname(fileURLToPath(import.meta.url));

export const storageStatePath = path.resolve(e2eDir, '.auth/state.json');
