import { DevctlConfig } from '../types/config.js';

import { cosmiconfig } from 'cosmiconfig';
import { resolve, dirname } from 'path';
import { default as _ } from 'lodash';
import readYaml from './utils/yaml.mjs';

export async function loadRepoConfig() {
  // Get base .devctl config
  const repoConfig = await cosmiconfig('devctl', {
    searchPlaces: [
      '.devctl.json',
      '.devctl.yaml',
      '.devctl.yml',
      '.devctlrc.json',
      '.devctlrc.yaml',
      '.devctlrc.yml',
      'package.json',
    ],
  }).search();

  if (repoConfig === null) {
    return;
  }

  // Current Working Repo
  const cwd = dirname(repoConfig.filepath);

  // Get associated paths
  const paths = {
    project: repoConfig.filepath,
    compose: resolve(cwd, '.devctl-docker-compose.yaml'),
    current: resolve(cwd, '.devctl-current.yaml'),
    scripts: resolve(cwd, '.devctl-scripts.yaml'),
    secrets: resolve(cwd, '.devctl-secrets.yaml'),
  };

  const projectConfig = repoConfig.config;
  projectConfig.cwd = cwd;
  projectConfig.paths = paths;
  projectConfig.services = _.keyBy(projectConfig.services, 'name');
  projectConfig.environment = _.keyBy(projectConfig.environment, 'name');

  try {
    projectConfig.current = await readYaml(paths.current);
  } catch (err) {
    projectConfig.current = {};
  }

  try {
    projectConfig.compiledSecrets = await readYaml(paths.secrets);
  } catch (err) {
    projectConfig.compiledSecrets = {};
  }

  return projectConfig;
}

export const config = await loadRepoConfig() as DevctlConfig | null;

export interface DevctlContext {
  config?: DevctlConfig,
}

const context: DevctlContext = {
  config
}

export default context;