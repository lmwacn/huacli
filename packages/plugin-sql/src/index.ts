import { definePlugin } from "@hua/plugin-sdk";

export const sqlPlugin = definePlugin({
  name: "sql",
  description: "SQL tools and database commands",
  commands: [
    {
      name: "query <statement>",
      description: "Run a SQL query against a configured datasource",
      options: [
        {
          flags: "-p, --profile <name>",
          description: "Connection profile name",
        },
      ],
      async action(context) {
        const statement = context.args[0] ?? "";
        const profile = String(context.options.profile ?? "default");
        context.log(`[sql] profile=${profile}`);
        context.log(`[sql] query=${statement}`);
        context.log("SQL execution is not connected yet. Next step is wiring mysql2 and profile config.");
      },
    },
    {
      name: "profile-list",
      aliases: ["profiles"],
      description: "List configured SQL connection profiles",
      async action(context) {
        context.log("No profiles configured yet.");
      },
    },
  ],
});
