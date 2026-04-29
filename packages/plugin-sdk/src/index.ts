export interface CommandContext {
  args: string[];
  options: Record<string, unknown>;
  log: (message: string) => void;
  error: (message: string) => void;
}

export interface HuaCommand {
  name: string;
  description: string;
  aliases?: string[];
  arguments?: string[];
  options?: CommandOption[];
  action: (context: CommandContext) => Promise<void> | void;
}

export interface CommandOption {
  flags: string;
  description: string;
  defaultValue?: string | boolean | number;
}

export interface HuaPlugin {
  name: string;
  description: string;
  commands: HuaCommand[];
}

export function definePlugin(plugin: HuaPlugin): HuaPlugin {
  return plugin;
}
