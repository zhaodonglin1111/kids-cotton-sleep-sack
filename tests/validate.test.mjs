import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

test("尺寸、图形与内容自检全部通过", () => {
  const result = spawnSync(process.execPath, [join(here, "validate.mjs")], {
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    throw new Error("validate.mjs 自检未通过");
  }
});
