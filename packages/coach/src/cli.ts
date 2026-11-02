// The coach from the command line: review a folder of photos, or run the test
// set. Needs ANTHROPIC_API_KEY (or an `ant auth login` profile). Every run
// calls Claude and costs money.
//
//   npm run coach -- review <folder> [--zone photography] [--quest "Shadows that tell a story"]
//   npm run coach -- eval <testset folder> [--out report.json]
import Anthropic from "@anthropic-ai/sdk";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeCoach, modelsFromEnv } from "./claude";
import { EvalCase, runEval } from "./eval";

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
  const [command, folder, ...rest] = process.argv.slice(2);
  if (!command || !folder || !["review", "eval"].includes(command)) {
    console.error("usage: coach review <folder> [--zone z] [--quest title] | coach eval <testset folder> [--out file]");
    process.exit(2);
  }
  const llm = claudeCoach(new Anthropic(), modelsFromEnv(process.env));
  const read = (file: string) => readFile(join(folder, file)).then((b) => new Uint8Array(b));

  let cases: EvalCase[];
  if (command === "eval") {
    cases = EvalCase.array().parse(JSON.parse(await readFile(join(folder, "cases.json"), "utf8")));
  } else {
    const zone = flag(rest, "zone") ?? "photography";
    const title = flag(rest, "quest") ?? "Shadows that tell a story";
    const files = (await readdir(folder)).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
    cases = files.map((file) =>
      EvalCase.parse({
        file,
        zone,
        quest: { title, brief: "Make something for today's quest.", trainsSkill: `${zone}.${zone === "photography" ? "light" : "colour"}`, tips: [] },
        expect: "review_or_retake",
      }),
    );
  }

  const { rows, summary } = await runEval(cases, read, llm);
  for (const r of rows) console.log(JSON.stringify(r));
  console.log(JSON.stringify({ summary }, null, 2));
  const out = flag(rest, "out");
  if (out) await writeFile(out, JSON.stringify({ summary, rows }, null, 2));
  if (command === "eval" && !summary.passed) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
