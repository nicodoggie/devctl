import { Command } from 'commander';
import { resolve } from 'path';
import glob from "fast-glob";
import { consola } from 'consola';
import readJson from "read-package-json";
import DevctlCommand from './lib/command.mjs';

let verbose = false;

// Set consola log-level if verbosity is set.
if (process.argv.includes('-v') || process.argv.includes('--verbose')) {
  verbose = true;
  consola.level = 4;
}

process.on('uncaughtException', (e) => {
  consola.error(e);
})

readJson(resolve('package.json'), consola.error, false, async (err, packageJson) => {
  // Fail if package.json isn't readable
  if (err) {
    consola.error(err);
    return;
  }
  const program = new Command('devctl-beta');

  // Set version based on package.json version attribute
  program
    .version(packageJson.version, '-V, --version');
  program
    .command('version')
    .action(() => {
      console.log(packageJson.version);
    });

  // Set debug verbosity
  program
    .option('--dry-run', 'Dry run but don\'t execute', false)
    .option('-v,--verbose', 'Show verbose output', false);

  // Load all Command objects from subcommands directory
  const subcommandDir = new URL('./subcommands/*.(mjs|js)', import.meta.url)
  const subcommandFiles = await glob(subcommandDir.pathname);

  consola.debug('Attempting to load subcommands:');
  consola.debug(subcommandFiles);
  for (let module of subcommandFiles) {
    try {
      const command = await import(module);
      const subcommand = command.default;
      if (subcommand instanceof DevctlCommand) {
        subcommand.verbose = verbose;
        program.addCommand(subcommand);
      } else {
        consola.debug(new Error(`Imported module ${module} not a valid Command object.`));
      }
    } catch (e) {
      consola.error(e);
    }
  }

  program.hook('preSubcommand', (thisCommand, actionCommand: DevctlCommand) => {
    actionCommand.logger.debug('Running `preSubcommand` Hook');
    actionCommand.logger.debug('Global Options:', thisCommand.optsWithGlobals());
  })

  // Parse argv and execute command
  await program.parseAsync(process.argv);
});