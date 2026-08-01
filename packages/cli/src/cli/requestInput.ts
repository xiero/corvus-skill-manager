import {promises as fs} from 'node:fs';
import type {CliIo} from './output.js';

export type RequestReadResult =
  | {ok: true; value: unknown}
  | {ok: false; message: string};

/**
 * Reads a JSON request document from a file, or from stdin when the path is `-`.
 *
 * Empty input, invalid JSON, and multiple concatenated JSON documents are all rejected with a
 * clear message rather than being partially interpreted.
 */
export async function readRequestDocument(source: string, io: CliIo): Promise<RequestReadResult> {
  let raw: string;

  try {
    raw = source === '-' ? await io.readStdin() : await fs.readFile(source, 'utf8');
  } catch (error) {
    return {
      ok: false,
      message: `Unable to read request document from ${source === '-' ? 'stdin' : source}: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }

  return parseRequestDocument(raw, source === '-' ? 'stdin' : source);
}

export function parseRequestDocument(raw: string, sourceLabel: string): RequestReadResult {
  if (raw.trim() === '') {
    return {ok: false, message: `Request document from ${sourceLabel} is empty.`};
  }

  try {
    return {ok: true, value: JSON.parse(raw)};
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      ok: false,
      message: looksLikeMultipleDocuments(raw)
        ? `Request document from ${sourceLabel} must contain exactly one JSON document.`
        : `Request document from ${sourceLabel} is not valid JSON: ${message}`
    };
  }
}

/** Detects the common "two JSON objects back to back" mistake so the message can say so. */
function looksLikeMultipleDocuments(raw: string): boolean {
  const trimmed = raw.trim();
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === '{' || character === '[') {
      depth += 1;
      continue;
    }

    if (character === '}' || character === ']') {
      depth -= 1;

      if (depth === 0 && trimmed.slice(index + 1).trim() !== '') {
        return true;
      }
    }
  }

  return false;
}
