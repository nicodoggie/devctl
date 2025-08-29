import {
  DevctlConfig,
  SecretsConfig,
  SecretsProviderEntry,
} from '../../types/config.js';
import { SecretsProvider } from '../../types/secrets.js';
import Bluebird from 'bluebird';
import deepmerge from 'deepmerge';
import { resolve } from 'path';
import { filesystem } from '@cipherstash/gluegun';
import spawnAsync from "@expo/spawn-async";
import { spawnSync } from 'child_process';
import { keyBy } from 'lodash';
import { createServer } from 'http';
import { URL } from 'url';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

interface VaultSecretsConfig extends SecretsConfig {
  binary: string;
  loginArgs: string[];
  endpoint: string;
}
interface VaultConfig {
  endpoint?: string;
  binary?: string;
  loginArgs?: string[];
  oidc?: {
    role: string;
    mount?: string;
    callbackPort?: number;
    clientId?: string;
    scopes?: string[];
  };
}

interface VaultEntryItem {
  name: string;
  key: string;
}

interface VaultFileItem {
  path: string;
  key: string;
}

interface VaultSecretsProviderEntry extends SecretsProviderEntry {
  config: VaultConfig;
  entries: {
    default?: VaultEntryItem[];
    [envKey: string]: VaultEntryItem[];
  };
  files: {
    default?: VaultFileItem[];
    [envKey: string]: VaultFileItem[];
  }
}

class VaultSecretsProvider extends SecretsProvider {
  binary: string;
  loginArgs: string[];
  endpoint: string;
  oidc?: VaultConfig['oidc'];
  vaultToken?: string;

  kvGetCmd: string[];

  constructor(entry: VaultSecretsProviderEntry, devctl: DevctlConfig) {
    super(entry, devctl);
    this.entry = entry;
    this.devctl = devctl;

    this.configure(entry.config);
  }

  async configure(config: VaultConfig) {
    this.binary = config.binary ?? 'vault';
    this.loginArgs = config.loginArgs ?? ['login'];
    this.endpoint = config.endpoint;
    this.oidc = config.oidc;

    this.kvGetCmd = ['kv', 'get', '-format=json', '-field=data'];
  }

  async authenticate(): Promise<void> {
    // Try to load existing vault token if we have OIDC configured
    if (this.oidc) {
      const existingToken = await this.loadStoredVaultToken();
      if (existingToken) {
        console.log('Using existing Vault token');
        this.vaultToken = existingToken;
        // Set the token for this session
        process.env.VAULT_TOKEN = existingToken;
        return;
      }

      console.log('No valid Vault token found, starting OIDC authentication...');
      await this.authenticateWithOIDC();
      return;
    }

    // Fallback to traditional authentication
    try {
      console.log(`Token lookup...`)
      console.time('lookup')
      spawnSync(this.binary, ['token', 'lookup'], {
        env: { ...process.env, VAULT_ADDR: this.endpoint }
      });
      console.timeEnd('lookup')
      console.log('Token lookup succeeded!')
    } catch (e) {
      console.log(`Token lookup failed. Authenticating...`)
      // Run login
      await spawnAsync(this.binary, [...this.loginArgs], {
        env: { ...process.env, VAULT_ADDR: this.endpoint }
      });
      console.log(`Token lookup failed. Authenticating... Done.`)
    }
  };

  private getVaultTokenStoragePath(): string {
    const homeDir = os.homedir();
    const devctlDir = path.join(homeDir, '.devctl');
    return path.join(devctlDir, 'vault-oidc-token.json');
  }

  private async loadStoredVaultToken(): Promise<string | null> {
    try {
      const tokenPath = this.getVaultTokenStoragePath();
      const tokenData = await fs.readFile(tokenPath, 'utf-8');
      const parsed = JSON.parse(tokenData);

      // Check if token is expired (with 5 minute buffer)
      if (parsed.expiresAt && Date.now() > (parsed.expiresAt - 5 * 60 * 1000)) {
        console.log('Vault token expired, will re-authenticate');
        return null;
      }

      return parsed.token;
    } catch (e) {
      return null;
    }
  }

  private async storeVaultToken(token: string, expiresAt?: number): Promise<void> {
    try {
      const tokenPath = this.getVaultTokenStoragePath();
      const tokenDir = path.dirname(tokenPath);

      // Ensure directory exists
      await fs.mkdir(tokenDir, { recursive: true });

      const tokenData = {
        token,
        expiresAt: expiresAt || (Date.now() + 12 * 60 * 60 * 1000), // Default 12h expiry
        timestamp: Date.now()
      };

      await fs.writeFile(tokenPath, JSON.stringify(tokenData, null, 2));
      console.log('Vault token stored securely');
    } catch (e) {
      console.warn('Failed to store Vault token:', e.message);
    }
  }

  private async authenticateWithOIDC(): Promise<void> {
    const { role, mount = 'oidc', callbackPort = 8080 } = this.oidc!;

    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url!, `http://localhost:${callbackPort}`);

        if (url.pathname === '/oidc/callback') {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h1>Authentication Failed</h1><p>Error: ${error}</p></body></html>`);
            server.close();
            reject(new Error(`OIDC authentication failed: ${error}`));
            return;
          }

          if (code && state) {
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<html><body><h1>Authentication Successful!</h1><p>You can close this window and return to your terminal.</p></body></html>`);

            // Exchange code for Vault token
            this.exchangeOIDCCodeForVaultToken(code, state, callbackPort)
              .then(async (vaultToken) => {
                this.vaultToken = vaultToken;
                process.env.VAULT_TOKEN = vaultToken;
                await this.storeVaultToken(vaultToken);
                server.close();
                resolve();
              })
              .catch((err) => {
                server.close();
                reject(err);
              });
          }
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      server.listen(callbackPort, async () => {
        console.log(`OIDC callback server started on port ${callbackPort}`);

        try {
          // Generate state parameter for security
          const state = Math.random().toString(36).substring(2, 15);
          const redirectUri = `http://localhost:${callbackPort}/oidc/callback`;

          // Get OIDC auth URL from Vault
          const authUrl = await this.getOIDCAuthURL(role, mount, redirectUri, state);

          console.log(`Opening browser for OIDC authentication...`);
          console.log(`If the browser doesn't open automatically, visit: ${authUrl}`);

          // Open browser
          import('open').then((openModule) => {
            const open = openModule.default;
            open(authUrl).catch((err) => {
              console.warn('Failed to open browser automatically:', err.message);
              console.log(`Please manually open: ${authUrl}`);
            });
          }).catch((err) => {
            console.warn('Failed to import open module:', err.message);
            console.log(`Please manually open: ${authUrl}`);
          });

        } catch (err) {
          server.close();
          reject(err);
        }
      });

      // Set timeout
      setTimeout(() => {
        server.close();
        reject(new Error('OIDC authentication timeout - no response received within 5 minutes'));
      }, 5 * 60 * 1000);
    });
  }

  private async getOIDCAuthURL(role: string, mount: string, redirectUri: string, state: string): Promise<string> {
    const { default: fetch } = await import('node-fetch');
    const authUrl = `${this.endpoint}/v1/auth/${mount}/oidc/auth_url`;

    const response = await fetch(authUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role,
        redirect_uri: redirectUri,
        state
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to get OIDC auth URL: ${response.status} ${response.statusText}`);
    }

    const responseData: any = await response.json();
    return responseData.data.auth_url;
  }

  private async exchangeOIDCCodeForVaultToken(code: string, state: string, callbackPort: number): Promise<string> {
    const { role, mount = 'oidc' } = this.oidc!;
    const { default: fetch } = await import('node-fetch');
    const tokenUrl = `${this.endpoint}/v1/auth/${mount}/oidc/callback`;

    const body = {
      role,
      code,
      state
    };

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Vault OIDC token exchange failed: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const responseData: any = await response.json();
    return responseData.auth.client_token;
  }

  async fetch(environment: string): Promise<Record<string, any>> {
    console.log(`Fetching secrets...`)
    const { entries } = this.entry;

    let secretEntries: Record<string, any> = {};

    if(!entries){
      return secretEntries;
    }

    if ('default' in entries) {
      secretEntries = await this.processSecretEntries(entries['default']);
    }

    if (environment in entries) {
      const envEntries = await this.processSecretEntries(entries[environment]);
      secretEntries = deepmerge(secretEntries, envEntries);
    }

    return secretEntries;
  }

  async generate(environment: string) {
    const { files } = this.entry;
    const { cwd } = this.devctl;

    if (files && 'default' in files) {
      for await (const { path, key } of files['default']) {
        const lastAtIndex = key.lastIndexOf('@');
        const keyString = key.slice(0, lastAtIndex);
        const version = key.slice(lastAtIndex + 1);

        let command = [];

        if (version === 'latest') {
          command = [...this.kvGetCmd, keyString];
        } else {
          command = [...this.kvGetCmd, `-version=${version}`, keyString];
        }

        const { stdout } = await spawnAsync(this.binary, command, {
          env: { ...process.env, VAULT_ADDR: this.endpoint }
        });

        filesystem.write(resolve(cwd, path), stdout);
      }
    }

    if (files && environment in files) {
      for await (const { path, key } of files[environment]) {
        const lastAtIndex = key.lastIndexOf('@');
        const keyString = key.slice(0, lastAtIndex);
        const version = key.slice(lastAtIndex + 1);

        let command = [];
        if (version === 'latest') {
          command = this.kvGetCmd
        } else {
          command = [...this.kvGetCmd, `-version=${version}`, keyString];
        }

        const { stdout } = await spawnAsync(this.binary, command, {
          env: { ...process.env, VAULT_ADDR: this.endpoint }
        });

        filesystem.write(resolve(cwd, path), stdout);
      }
    }
  }

  async processSecretEntries(entries: VaultEntryItem[]) {
    // Parse keys
    const secretMap = await Bluebird.map(entries, async ({ name, key }) => {
      console.log(`Fetching secret \`${name}\` from \`${key}\`...`);
      const lastAtIndex = key.lastIndexOf('@');
      const keyString = key.slice(0, lastAtIndex);
      const version = key.slice(lastAtIndex + 1)
      const [keyPath, jsonPath] = keyString.split(':');

      let command = [];
      if (version === 'latest') {
        command = [...this.kvGetCmd, keyPath];
      } else {
        command = [...this.kvGetCmd, `-version=${version}`, keyPath];
      }


      const execResult = await spawnAsync(this.binary, command, {
        env: { ...process.env, VAULT_ADDR: this.endpoint },
      });

      const parsed = JSON.parse(execResult.stdout);
      let content;
      if (jsonPath === '*') {
        content = parsed;
      } else {
        content = parsed[jsonPath];
      }

      return { name, content };
    });

    return secretMap.reduce((secrets, { name, content }) => {
      secrets[name] = content;
      return secrets;
    }, {});
  }
}

export const provider = VaultSecretsProvider;
