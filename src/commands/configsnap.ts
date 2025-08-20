import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  AttachmentBuilder,
} from "discord.js";
import {
  makeSnapshot,
  validateSnapshot,
  applySnapshot,
  getGuildMeta,
  CONFIG_VERSION,
} from "../config/snapshot.js";
import { makeEmbed, replyEmbedText } from "../lib/embeds.js";

export const data = new SlashCommandBuilder()
  .setName("configsnap")
  .setDescription("Config snapshot tools")
  .addSubcommand((sc) =>
    sc.setName("export").setDescription("Export this guild config as JSON")
  )
  .addSubcommand((sc) =>
    sc
      .setName("verify")
      .setDescription("Verify pasted snapshot JSON")
      .addStringOption((o) =>
        o.setName("json").setDescription("Snapshot JSON").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("import")
      .setDescription("Import snapshot JSON")
      .addStringOption((o) =>
        o.setName("json").setDescription("Snapshot JSON").setRequired(true)
      )
      .addBooleanOption((o) =>
        o
          .setName("clear_multipliers")
          .setDescription("Clear then import multipliers")
      )
      .addBooleanOption((o) =>
        o
          .setName("clear_level_roles")
          .setDescription("Clear then import level roles")
      )
  )
  .addSubcommand((sc) =>
    sc.setName("version").setDescription("Show stored config version")
  );

function ereply(i: ChatInputCommandInteraction, s: string) {
  return replyEmbedText(i, "Config snapshot", s, true);
}

export async function execute(i: ChatInputCommandInteraction) {
  if (!i.guildId) {
    await ereply(i, "Guild only.");
    return;
  }
  const sub = i.options.getSubcommand(true);

  if (sub === "export") {
    const snap = makeSnapshot(i.guildId);
    const buf = Buffer.from(JSON.stringify(snap, null, 2), "utf8");
    const file = new AttachmentBuilder(buf, {
      name: `config-${i.guildId}.json`,
    });
    await i.reply({
      embeds: [
        makeEmbed(
          "Config snapshot",
          `version=${snap.version} checksum=${snap.checksum.slice(0, 16)}…`
        ),
      ],
      files: [file],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "verify") {
    const json = i.options.getString("json", true);
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      await ereply(i, "invalid-json");
      return;
    }
    const v = validateSnapshot(parsed);
    if (!v.ok) {
      await ereply(i, `invalid: ${v.reason}`);
      return;
    }
    await ereply(
      i,
      `ok version=${v.snap.version} guildId=${
        v.snap.guildId
      } checksum=${v.snap.checksum.slice(0, 16)}…`
    );
    return;
  }

  if (sub === "import") {
    const json = i.options.getString("json", true);
    const clearMult = i.options.getBoolean("clear_multipliers") ?? false;
    const clearLR = i.options.getBoolean("clear_level_roles") ?? false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      await ereply(i, "invalid-json");
      return;
    }
    const v = validateSnapshot(parsed);
    if (!v.ok) {
      await ereply(i, `invalid: ${v.reason}`);
      return;
    }
    if (v.snap.guildId !== i.guildId) {
      await ereply(i, "guildId-mismatch");
      return;
    }
    applySnapshot(i.guildId, v.snap, {
      clearMultipliers: clearMult,
      clearLevelRoles: clearLR,
    });
    await ereply(
      i,
      `applied version=${CONFIG_VERSION} checksum=${v.snap.checksum.slice(
        0,
        16
      )}…`
    );
    return;
  }

  // version
  const meta = getGuildMeta(i.guildId);
  await ereply(
    i,
    meta
      ? `stored-version=${meta.version} updated_ms=${meta.updatedMs}`
      : `no-version • current=${CONFIG_VERSION}`
  );
}
