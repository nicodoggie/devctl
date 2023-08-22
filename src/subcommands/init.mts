import { dirname, resolve } from "path";
import DevctlCommand from "../lib/command.mjs";
import * as print from '../lib/utils/print.mjs';

const init = new DevctlCommand('init')
  .hook('preAction', (thisCommand: DevctlCommand) => {
    thisCommand.logger.debug(`\`${thisCommand._name}\` Options:`, thisCommand.opts());
  })
  .option('-f, --force', 'Force reinitialization of the repo', false)
  .option('-q, --no-interactive', `Don't prompt interactively`)
  .option('--databases <databases...>', 'Databases to configure', [])

  .action(async ({ force, interactive, databases, dryRun }) => {
    print.title('Welcome to DevCTL!');
    print.message('This command will help you setup a basic devctl project.')
    print.message('Advanced users will need to deep in the YAML files generated, and/or generate new ones.');

    let executeInit = false;

    if (!init.context.config || force) {
      executeInit = true
    } else if (init.context.config) {
      const { config } = init.context;

      print.alert(`DevCTL seems to have been initialized on the project in ${config.cwd} before.`);
      if (!interactive || !(await print.confirm('Do you want to reinitialize?'))) {
        print.message('Operation terminated without initializing.');
        return;
      } else {
        executeInit = true;
      }
    }

    if (!executeInit) {
      process.exit(1);
    }
    // Execute init
    const initialize = print.spinner({
      text: "Initializing...\n",
    }).start();

    // TODO: Add initalization for databases
    // let dbs = databases;
    // if (interactive && databases.length === 0) {
    //   dbs = await print.ask(
    //     'Configure a local database?',
    //     ['mongo', 'mysql', 'postgres', 'redis']
    //   );

    // }

    // init.logger.debug(`Configure these dbs:`, dbs);

    // for await (const db in dbs) {
    //   init.logger.debug(`Configuring db \`${db}\`...`);


    // }

    // Add initialization for secrets providers

    const currentFile = new URL(import.meta.url);
    const targetDevctlPath = resolve(dirname(currentFile.pathname), '../templates/devctl.yaml.ejs');
    const targetGitignorePath = resolve(dirname(currentFile.pathname), '../templates/gitignore.ejs');

    // Generate .devctl.yaml
    const devctlSpinner = print.spinner(`Generating template in \`${process.cwd()}\` into \`${targetDevctlPath}\`.`).start();
    init
      .generateTemplate(
        targetDevctlPath,
        resolve(process.cwd(), '.devctl.yaml'),
        { values: [] },
      )
      .then(() => devctlSpinner.succeed(`Successfully generated \`.devctl.yaml\`.`))
      .catch((err) => {
        init.logger.error(err);
        devctlSpinner.fail(`Failed to generate \`.devctl.yaml\`.`);
        process.exit(1);
      })

    init.logger.debug(`Generating template in \`${process.cwd()}\` into \`${targetGitignorePath}\`.`);

    // Generate .gitignore
    const gitignoreSpinner = print.spinner(`Generating template in \`${process.cwd()}\` into \`${targetGitignorePath}\`.`).start();
    init.generateTemplate(
      targetGitignorePath,
      resolve(process.cwd(), '.gitignore'),
      { values: [] }
    )
      .then(() => gitignoreSpinner.succeed(`Successfully generated \`.gitignore\`.`))
      .catch((err) => {
        init.logger.error(err);
        gitignoreSpinner.fail(`Failed to generate \`.gitignore\`.`);
      })

    initialize.succeed(`Successfully initialized project.`);
  }
  );

export default init;