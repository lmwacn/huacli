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
  const commandParent = ensureCommandPath(parent, commandDefinition.parentPath ?? []);
  const command = commandParent.command(commandDefinition.name).description(commandDefinition.description);

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
    const context = buildContext(currentCommand);
    await commandDefinition.action(context);
  });
}

function ensureCommandPath(parent: Command, segments: string[]): Command {
  let currentParent = parent;

  for (const segment of segments) {
    const normalizedSegment = segment.trim();
    if (!normalizedSegment) {
      continue;
    }

    const existing = currentParent.commands.find((subCommand) => subCommand.name() === normalizedSegment);
    if (existing) {
      currentParent = existing;
      continue;
    }

    currentParent = currentParent.command(normalizedSegment);
  }

  return currentParent;
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
