import { Command } from "commander";
import context, { DevctlContext } from "./context.mjs";
import utils from './utils/index.mjs';
import { ConsolaInstance, consola } from "consola";
import * as ejs from "ejs";
import { readFile, writeFile } from "fs/promises";


type DevctlCommandOpts = {
  verbose?: boolean;
}

export default class DevctlCommand extends Command {
  private ctx: DevctlContext;
  private consola: ConsolaInstance;
  public _name: string;
  public verbose = false;
  public utils;


  constructor(name) {
    super(name);
    this._name = name;
    this.ctx = context;
    this.utils = utils;
    this.consola = consola;

    this.consola.debug(`Initializing command \`${name}\`...`)
  }

  public get context(): DevctlContext {
    return this.ctx;
  }

  public get logger(): ConsolaInstance {
    if (this.verbose) {
      this.consola.level = 4;
    } else {
      this.consola.level = 0;
    }

    return this.consola;
  }

  public async generateTemplate(templateFile: string, target: string, props: object) {
    const content = await ejs.renderFile(templateFile, { props });
    await writeFile(target, content);
  }
}