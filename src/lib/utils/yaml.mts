import { readFile } from 'fs/promises';
import YAML from 'js-yaml';

export default async function readYaml(path) {
  const raw = await readFile(path);

  if (!raw) {
    return null;
  }

  return YAML.load(raw.toString());
}
