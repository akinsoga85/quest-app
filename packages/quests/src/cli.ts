// Draft a week of quests from the command line, to read before trusting the
// weekly job. Calls Claude (costs money); prints the week and any rule
// problems. Nothing is saved.
//
//   npm run quests -- draft --zone photography --week 2026-11-09
import Anthropic from "@anthropic-ai/sdk";
import { claudeWriter, writeWeek } from "./writer";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const zone = arg("zone") ?? "photography";
  const weekOf = arg("week");
  if (process.argv[2] !== "draft" || !weekOf) {
    console.error("usage: quests draft --zone <zone> --week <Monday YYYY-MM-DD>");
    process.exit(2);
  }
  const r = await writeWeek(claudeWriter(new Anthropic(), process.env.QUESTS_MODEL || undefined), { zone, weekOf, recentTitles: [] });
  console.log(JSON.stringify(r, null, 2));
  if (!r.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
