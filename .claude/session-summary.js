'use strict';
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const os = require('os');
const { OpenAI } = require('openai');

const ROOT = process.cwd();
const CLAUDE_MD   = path.join(ROOT, 'CLAUDE.md');
const NEXT_SESSION = path.join(ROOT, 'NEXT_SESSION.md');
const FUTURE_PLAN  = path.join(ROOT, 'FUTURE_PLAN.md');

function readIfExists(filePath) {
  try { return fs.readFileSync(filePath, 'utf8'); } catch { return null; }
}

// Walk ~/.claude/projects/ and return path of most recently modified .jsonl
function findRecentTranscript() {
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  let bestPath = null;
  let bestMtime = 0;

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (e.isFile() && e.name.endsWith('.jsonl')) {
        try {
          const { mtimeMs } = fs.statSync(full);
          if (mtimeMs > bestMtime) { bestMtime = mtimeMs; bestPath = full; }
        } catch {}
      }
    }
  }

  walk(claudeDir);
  return bestPath;
}

function extractText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n');
  }
  return '';
}

function extractMessages(transcriptPath) {
  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  const messages = [];
  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== 'user' && entry.type !== 'assistant') continue;
      const msg = entry.message;
      if (!msg) continue;
      const text = extractText(msg.content);
      if (text.trim()) messages.push({ role: msg.role || entry.type, text });
    } catch {}
  }
  return messages;
}

function buildTranscriptText(messages) {
  const recent = messages.slice(-60);
  let text = recent.map(m => `[${m.role.toUpperCase()}]\n${m.text}`).join('\n\n---\n\n');
  if (text.length > 15000) text = '...(truncated)\n\n' + text.slice(-15000);
  return text;
}

function formatDate() {
  return new Date().toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
  });
}

const GPT_SCHEMA = `{
  "completed": ["One line per thing actually finished and working. Only include if verifiably complete. Max 5 items."],
  "in_progress": {
    "what": "Single sentence — what was being built",
    "where_stopped": "Exact file and function name",
    "next_step": "The exact next action needed"
  },
  "next_instruction": "The exact Claude Code prompt to continue next session. Specific enough to paste directly. Include file names, function names, and success criteria. Null if session was complete.",
  "errors_discovered": ["Any bugs, workarounds, or broken things found. One line each. Empty if none."],
  "claude_md_updates": ["Only if something was built that should update the Built section of CLAUDE.md. One line per item. Empty if nothing changed architecturally."],
  "future_plan": ["Deferred decisions or technical debt intentionally skipped. Only genuinely new items not already tracked. Empty if nothing new."],
  "breakthrough": "Only if a genuine architectural or strategic insight occurred that changes how Clearpath should be built. 2-3 sentences max. Null if nothing qualifies. High bar — most sessions return null here."
}`;

async function main() {
  const now = formatDate();

  const claudeMd   = readIfExists(CLAUDE_MD) || '';
  const nextSession = readIfExists(NEXT_SESSION) || '';
  const futurePlan  = readIfExists(FUTURE_PLAN) || '';

  const transcriptPath = findRecentTranscript();
  if (!transcriptPath) {
    console.warn('Session memory: no transcript found — skipping');
    return;
  }

  const messages = extractMessages(transcriptPath);
  if (messages.length === 0) {
    console.warn('Session memory: empty transcript — skipping');
    return;
  }

  const transcriptText = buildTranscriptText(messages);

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: 'You are the memory system for Clearpath, an AI-native healthcare SaaS built in Node.js with Express, PostgreSQL, and Medplum FHIR. You extract only what matters for the next coding session. Be ruthlessly concise.'
      },
      {
        role: 'user',
        content: `Session transcript:\n${transcriptText}\n\nCurrent CLAUDE.md:\n${claudeMd}\n\nReturn JSON only — no other text:\n${GPT_SCHEMA}`
      }
    ]
  });

  const summary = JSON.parse(response.choices[0].message.content);

  // --- Write NEXT_SESSION.md (overwrite every time) ---
  const completedLines  = (summary.completed || []).map(c => `- ${c}`).join('\n') || '- Nothing recorded';
  const ip              = summary.in_progress || {};
  const errorsLines     = (summary.errors_discovered || []).map(e => `- ${e}`).join('\n') || 'None';
  const claudeMdLines   = (summary.claude_md_updates || []).map(u => `- ${u}`).join('\n') || 'None';
  const nextInstruction = (summary.next_instruction && summary.next_instruction !== 'null')
    ? summary.next_instruction
    : 'Session was complete. Read CLAUDE.md and continue from the To Build list.';

  const nextSessionContent = `# Next Session Brief — ${now}

## Completed this session
${completedLines}

## In progress
${ip.what || 'Nothing in progress'}
Stopped at: ${ip.where_stopped || 'N/A'}
Next step: ${ip.next_step || 'N/A'}

## Paste this to continue
${nextInstruction}

## Errors and workarounds
${errorsLines}

## Claude.md needs these updates
${claudeMdLines}
`;
  fs.writeFileSync(NEXT_SESSION, nextSessionContent, 'utf8');

  // --- Append to FUTURE_PLAN.md only if new items ---
  const hasFuture      = summary.future_plan && summary.future_plan.length > 0;
  const hasBreakthrough = summary.breakthrough &&
                          summary.breakthrough !== 'null' &&
                          summary.breakthrough !== null;

  if (hasFuture || hasBreakthrough) {
    let appendContent = `\n## ${now}\n`;
    if (hasFuture) {
      appendContent += `### Deferred\n${summary.future_plan.map(f => `- ${f}`).join('\n')}\n`;
    }
    if (hasBreakthrough) {
      appendContent += `\n### ⚡ Breakthrough\n${summary.breakthrough}\n`;
    }
    fs.appendFileSync(FUTURE_PLAN, appendContent, 'utf8');
  }

  // --- Append pending-update comment to CLAUDE.md if needed ---
  if (summary.claude_md_updates && summary.claude_md_updates.length > 0) {
    const updateLines = summary.claude_md_updates.map(u => `- ${u}`).join('\n');
    fs.appendFileSync(CLAUDE_MD, `\n## Pending updates from ${now} session\n${updateLines}\n`, 'utf8');
  }

  console.log('Session recorded. Next session brief ready.');
  if (nextInstruction) {
    console.log('\n--- NEXT SESSION ---');
    console.log(nextInstruction);
    console.log('--------------------\n');
  }
}

main().catch(err => {
  console.warn('Session memory: non-fatal error —', err.message);
  process.exit(0);
});
