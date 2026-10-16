#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const joinedClosures =
  /\b(?:closes?|fix(?:es|ed)?|resolves?)\s+#\d+\s*(?:,|and|&)\s*#\d+/i;
const assistantName =
  /\b(?:Claude(?: Code)?|Gemini|Antigravity|Copilot|Cursor|ChatGPT|Codex|OpenAI|Anthropic)\b|🤖/i;

export function lintText(value) {
  const errors = [];
  if (joinedClosures.test(value)) {
    errors.push("Use one closing keyword per issue on separate lines.");
  }
  if (
    /generated with/i.test(value) ||
    assistantName.test(value) ||
    /^co-authored-by:\s*.*(\bAI\b|\[bot\])/im.test(value)
  ) {
    errors.push("Remove assistant attribution from public text.");
  }
  return errors;
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length > 3) {
    console.error(
      "Usage: node scripts/fork-check-pr-body.mjs [body-file] < body.md",
    );
    process.exitCode = 2;
  } else {
    try {
      const body = readFileSync(process.argv[2] ?? 0, "utf8");
      const errors = lintText(body);
      if (errors.length) {
        for (const error of errors) console.error(error);
        process.exitCode = 1;
      } else {
        console.log("PR text check passed.");
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 2;
    }
  }
}
