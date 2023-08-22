import { Chalk } from "chalk";
import { consola } from "consola";
import { box } from 'consola/utils'
import { checkbox, confirm as confirmInq } from "@inquirer/prompts";
import { Choice } from "@inquirer/checkbox";
import ora from "ora";

const chalk = new Chalk({
  level: 3
})

function title(message: string) {
  const final = box(message, {
    style: {
      borderColor: "blue",
    },

  })
  console.log(final);
}

function message(message: string) {
  console.log(message);
}

function alert(message: string) {
  const tmpl = chalk.bold.whiteBright.bgRed;
  console.log(tmpl(message));
}

function success(message: string) {
  const tmpl = chalk.bold.greenBright;
  console.log(tmpl(message));
}

function ask(message: string, choiceInput: string[] | Choice<string>[]) {
  const choices = choiceInput.map((item: string | Choice<string>) => {
    if (typeof item === 'object') {
      return item;
    }
    return {
      name: item,
      value: item,
    } as Choice<string>
  })

  return checkbox({
    message,
    choices,
  })
}

async function confirm(message) {
  return confirmInq({ message });
}

const spinner = ora;

export {
  chalk,
  title,
  alert,
  message,
  ask,
  confirm,
  success,
  spinner,
};