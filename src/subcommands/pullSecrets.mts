import DevctlCommand from "../lib/command.mjs";
import * as print from '../lib/utils/print.mjs';
import { initSecretsProvider } from "../lib/secrets.mjs";
import YAML from "js-yaml";
import { writeFile } from "fs/promises";

const cmd = new DevctlCommand('pull-secrets')
  .hook('preAction', (thisCommand: DevctlCommand) => {
    thisCommand.logger.debug(`\`${thisCommand._name}\` Options:`, thisCommand.opts());
  })
  .action(async () => {
    const secretsSpinner = print.spinner(`Pulling secrets...`).start();

    const { config } = cmd.context;

    if (!config) {
      secretsSpinner.fail(`DevCTL doesn't seem to be initialized in this repo.`);
      process.exit(1);
    }

    const { secrets: secretsProviders, current } = config;
    const { environment } = current;
    const populatedSecrets = {};

    cmd.logger.debug(`Secrets Providers:`);
    cmd.logger.debug(secretsProviders);

    if (!secretsProviders) {
      secretsSpinner.fail(`No \`secrets\` configured!`);
      process.exit(1);
    }

    for await (const secret of secretsProviders) {
      const { prefix } = secret;
      const providerSpinner = print.spinner(
        `Initializing provider for \`${prefix}\`...`
      ).start();

      const secretsProvider = await initSecretsProvider(secret, config);
      providerSpinner.info(`Authenticating \`${prefix}\`...`);
      try {
        await secretsProvider.authenticate();
      } catch (e) {
        cmd.logger.error(e);
        providerSpinner.fail(`Failed initialization for provider \`${prefix}\.`);
      }

      providerSpinner.info(`Generating secrets for \`${prefix}\`...`);
      populatedSecrets[prefix] = await secretsProvider.fetch(environment);

      await secretsProvider.generate(environment);

      providerSpinner.succeed(`Successfully initialized provider for \`${prefix}\``)
    }

    cmd.logger.debug(`Writing secrets into \`${config.paths.secrets}\`...`);

    await writeFile(config.paths.secrets, YAML.dump(populatedSecrets));
    secretsSpinner.succeed(`Successfully pulled secrets!`);
  })

export default cmd;