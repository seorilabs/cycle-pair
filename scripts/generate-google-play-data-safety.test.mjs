import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

test("Data safety 공식 CSV 응답을 선언 파일에서 결정적으로 생성한다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cyclepair-data-safety-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const template = path.join(root, "template.csv");
  const declaration = path.join(root, "declaration.json");
  const firstOutput = path.join(root, "first.csv");
  const secondOutput = path.join(root, "second.csv");
  await writeFile(
    template,
    [
      "Question ID (machine readable),Response ID (machine readable),Answer",
      "PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA,PSL_YES,",
      "PSL_DATA_TYPES_HEALTH,PSL_HEALTH,",
      "PSL_DATA_USAGE_RESPONSES:PSL_HEALTH:PSL_DATA_USAGE_COLLECTION_AND_SHARING,PSL_DATA_USAGE_ONLY_COLLECTED,",
      "PSL_DATA_USAGE_RESPONSES:PSL_HEALTH:DATA_USAGE_USER_CONTROL,PSL_DATA_USAGE_USER_CONTROL_OPTIONAL,",
      "PSL_DATA_USAGE_RESPONSES:PSL_HEALTH:DATA_USAGE_COLLECTION_PURPOSE,PSL_APP_FUNCTIONALITY,",
    ].join("\r\n"),
  );
  await writeFile(
    declaration,
    JSON.stringify({
      collectsOrSharesData: true,
      encryptedInTransit: true,
      supportsDeletionRequest: true,
      dataTypes: {
        PSL_HEALTH: {
          required: false,
          purposes: ["PSL_APP_FUNCTIONALITY"],
        },
      },
    }),
  );

  for (const output of [firstOutput, secondOutput]) {
    await execFileAsync(process.execPath, [
      "scripts/generate-google-play-data-safety.mjs",
      template,
      declaration,
      output,
    ]);
  }

  const first = await readFile(firstOutput, "utf8");
  assert.equal(first, await readFile(secondOutput, "utf8"));
  assert.match(first, /PSL_DATA_TYPES_HEALTH,PSL_HEALTH,TRUE/);
  assert.match(first, /PSL_DATA_USAGE_ONLY_COLLECTED,TRUE/);
  assert.match(first, /PSL_DATA_USAGE_USER_CONTROL_OPTIONAL,TRUE/);
  assert.match(first, /PSL_APP_FUNCTIONALITY,TRUE/);
});
