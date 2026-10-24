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

test("현재 Console 양식의 계정 생성과 삭제 응답을 빠뜨리지 않는다", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "cyclepair-data-safety-account-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const template = path.join(root, "template.csv");
  const declaration = path.join(root, "declaration.json");
  const output = path.join(root, "output.csv");
  await writeFile(template, [
    "Question ID (machine readable),Response ID (machine readable),Response value",
    "PSL_SUPPORTED_ACCOUNT_CREATION_METHODS,PSL_ACM_USER_ID_PASSWORD,",
    "PSL_SUPPORTED_ACCOUNT_CREATION_METHODS,PSL_ACM_OTHER,",
    "PSL_SUPPORTED_ACCOUNT_CREATION_METHODS,PSL_ACM_OAUTH,",
    "PSL_ACM_SPECIFY,,",
    "PSL_ACCOUNT_DELETION_URL,,",
    "PSL_SUPPORT_DATA_DELETION_BY_USER,DATA_DELETION_YES,",
    "PSL_SUPPORT_DATA_DELETION_BY_USER,DATA_DELETION_NO,",
    "PSL_DATA_DELETION_URL,,",
  ].join("\n"));
  const source = {
    dataTypes: {},
    accountCreationMethods: ["PSL_ACM_USER_ID_PASSWORD", "PSL_ACM_OTHER"],
    otherAccountCreationDescription: "Anonymous guest accounts; optional email/password linking.",
    accountDeletionUrl: "https://www.seorilabs.com/apps/cycle-pair/account-deletion/",
    supportsDeletionRequest: true,
    dataDeletionUrl: "https://www.seorilabs.com/apps/cycle-pair/account-deletion/#delete-data-without-account",
  };
  await writeFile(declaration, JSON.stringify(source));
  await execFileAsync(process.execPath, ["scripts/generate-google-play-data-safety.mjs", template, declaration, output]);
  const csv = await readFile(output, "utf8");
  assert.match(csv, /PSL_ACM_USER_ID_PASSWORD,TRUE/);
  assert.match(csv, /PSL_ACM_OTHER,TRUE/);
  assert.match(csv, /PSL_ACM_OAUTH,\n/);
  assert.match(csv, /PSL_ACM_SPECIFY,,Anonymous guest accounts/);
  assert.match(csv, /PSL_ACCOUNT_DELETION_URL,,https:\/\/www\.seorilabs\.com\/apps\/cycle-pair\/account-deletion\//);
  assert.match(csv, /DATA_DELETION_YES,TRUE/);
  assert.match(csv, /DATA_DELETION_NO,\n/);
  assert.match(csv, /PSL_DATA_DELETION_URL,,https:\/\/www\.seorilabs\.com\/apps\/cycle-pair\/account-deletion\/#delete-data-without-account/);

  delete source.dataDeletionUrl;
  await writeFile(declaration, JSON.stringify(source));
  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/generate-google-play-data-safety.mjs", template, declaration, output]),
    /dataDeletionUrl/,
  );
  source.dataDeletionUrl = "https://www.seorilabs.com/apps/cycle-pair/account-deletion/#delete-data-without-account";

  delete source.accountCreationMethods;
  await writeFile(declaration, JSON.stringify(source));
  await assert.rejects(
    execFileAsync(process.execPath, ["scripts/generate-google-play-data-safety.mjs", template, declaration, output]),
    /accountCreationMethods/,
  );
});
