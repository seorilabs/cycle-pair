import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function encodeCsv(rows) {
  return `${rows.map(row => row.map(csvCell).join(",")).join("\n")}\n`;
}

function responseFor(row, declaration) {
  const [questionId, responseId] = row;
  if (questionId === "PSL_DATA_COLLECTION_COLLECTS_PERSONAL_DATA") {
    return declaration.collectsOrSharesData ? "TRUE" : "FALSE";
  }
  if (questionId === "PSL_DATA_COLLECTION_ENCRYPTED_IN_TRANSIT") {
    return declaration.encryptedInTransit ? "TRUE" : "FALSE";
  }
  if (questionId === "PSL_SUPPORTED_ACCOUNT_CREATION_METHODS") {
    return declaration.accountCreationMethods.includes(responseId) ? "TRUE" : "";
  }
  if (questionId === "PSL_ACM_SPECIFY") {
    return declaration.otherAccountCreationDescription ?? "";
  }
  if (questionId === "PSL_ACCOUNT_DELETION_URL") {
    return declaration.accountDeletionUrl ?? "";
  }
  if (questionId === "PSL_SUPPORT_DATA_DELETION_BY_USER") {
    return responseId === (declaration.supportsDeletionRequest ? "DATA_DELETION_YES" : "DATA_DELETION_NO")
      ? "TRUE"
      : "";
  }
  if (questionId === "PSL_DATA_DELETION_URL") {
    return declaration.dataDeletionUrl ?? "";
  }

  const selected = declaration.dataTypes[responseId];
  if (questionId.startsWith("PSL_DATA_TYPES_")) {
    return selected ? "TRUE" : "";
  }
  const match = questionId.match(/^PSL_DATA_USAGE_RESPONSES:([^:]+):(.+)$/);
  if (!match) return "";
  const dataType = declaration.dataTypes[match[1]];
  if (!dataType) return "";
  const question = match[2];
  if (question === "PSL_DATA_USAGE_COLLECTION_AND_SHARING") {
    return responseId === "PSL_DATA_USAGE_ONLY_COLLECTED" ? "TRUE" : "";
  }
  if (question === "PSL_DATA_USAGE_EPHEMERAL") return "FALSE";
  if (question === "DATA_USAGE_USER_CONTROL") {
    return responseId ===
      (dataType.required
        ? "PSL_DATA_USAGE_USER_CONTROL_REQUIRED"
        : "PSL_DATA_USAGE_USER_CONTROL_OPTIONAL")
      ? "TRUE"
      : "";
  }
  if (question === "DATA_USAGE_COLLECTION_PURPOSE") {
    return dataType.purposes.includes(responseId) ? "TRUE" : "";
  }
  return "";
}

const [templatePath, declarationPath, outputPath] = process.argv.slice(2);
if (!templatePath || !declarationPath || !outputPath) {
  throw new Error(
    "usage: node scripts/generate-google-play-data-safety.mjs TEMPLATE DECLARATION OUTPUT"
  );
}
const declaration = JSON.parse(await readFile(declarationPath, "utf8"));
const rows = parseCsv(await readFile(templatePath, "utf8"));
if (rows[0]?.[0] !== "Question ID (machine readable)") {
  throw new Error("Google Play Data Safety template header mismatch");
}
const accountMethods = rows.filter(row => row[0] === "PSL_SUPPORTED_ACCOUNT_CREATION_METHODS");
if (accountMethods.length > 0) {
  const selected = declaration.accountCreationMethods;
  const available = new Set(accountMethods.map(row => row[1]));
  if (!Array.isArray(selected) || selected.length === 0 || selected.some(value => !available.has(value))) {
    throw new Error("accountCreationMethods must select methods from the current Console template");
  }
  if (selected.includes("PSL_ACM_NONE") && selected.length > 1) {
    throw new Error("accountCreationMethods cannot combine no account creation with another method");
  }
  if (selected.includes("PSL_ACM_OTHER") && !declaration.otherAccountCreationDescription?.trim()) {
    throw new Error("otherAccountCreationDescription is required for guest account creation");
  }
  if (!selected.includes("PSL_ACM_NONE") && !declaration.accountDeletionUrl?.startsWith("https://")) {
    throw new Error("accountDeletionUrl must be an HTTPS deletion request page");
  }
}
if (rows.some(row => row[0] === "PSL_SUPPORT_DATA_DELETION_BY_USER") &&
    typeof declaration.supportsDeletionRequest !== "boolean") {
  throw new Error("supportsDeletionRequest must be a boolean");
}
if (rows.some(row => row[0] === "PSL_DATA_DELETION_URL") &&
    declaration.supportsDeletionRequest && !declaration.dataDeletionUrl?.startsWith("https://")) {
  throw new Error("dataDeletionUrl must describe deletion without deleting the account");
}
for (const row of rows.slice(1)) {
  row[2] = responseFor(row, declaration);
  if (row[4] !== undefined) row[4] = row[4].trimEnd();
}
await writeFile(path.resolve(outputPath), encodeCsv(rows));
