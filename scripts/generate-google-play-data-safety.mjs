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
  if (questionId === "PSL_DATA_COLLECTION_USER_REQUEST_DELETE") {
    return declaration.supportsDeletionRequest ? "TRUE" : "FALSE";
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
for (const row of rows.slice(1)) row[2] = responseFor(row, declaration);
await writeFile(path.resolve(outputPath), encodeCsv(rows));
