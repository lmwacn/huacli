import { Command } from "commander";
import { CommandContext, HuaCommand, HuaPlugin } from "@hua/plugin-sdk";

function buildContext(command: Command): CommandContext {
  return {
    args: command.args,
    options: command.opts<Record<string, unknown>>(),
    log: (message: string) => {
      console.log(message);
    },
    error: (message: string) => {
      console.error(message);
    },
  };
}

function registerCommand(parent: Command, commandDefinition: HuaCommand): void {
  const command = parent.command(commandDefinition.name).description(commandDefinition.description);

  for (const alias of commandDefinition.aliases ?? []) {
    command.alias(alias);
  }

  for (const argumentDefinition of commandDefinition.arguments ?? []) {
    command.argument(argumentDefinition);
  }

  for (const option of commandDefinition.options ?? []) {
    command.option(option.flags, option.description, option.defaultValue as never);
  }

  command.action(async (...actionArgs: unknown[]) => {
    const currentCommand = actionArgs[actionArgs.length - 1] as Command;
    const parsedArgs = actionArgs.slice(0, -1).map((value) => String(value));
    const context = buildContext(currentCommand);
    await commandDefinition.action({
      ...context,
      args: parsedArgs,
    });
  });
}

export class HuaCliApp {
  private readonly program: Command;

  constructor() {
    this.program = new Command();
    this.program.name("hua").description("A plugin-based CLI toolbox").version("0.1.0");
  }

  registerPlugin(plugin: HuaPlugin): void {
    const pluginCommand = this.program.command(plugin.name).description(plugin.description);

    for (const commandDefinition of plugin.commands) {
      registerCommand(pluginCommand, commandDefinition);
    }
  }

  async run(argv: string[]): Promise<void> {
    await this.program.parseAsync(argv);
  }
}
