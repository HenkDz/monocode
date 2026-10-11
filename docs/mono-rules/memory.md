# Memory

Read this guidance with `app rules memory`. These instructions retain the long-form MonoCode guidance; the user's current request and existing app authority still apply.

## Standing instructions (SOUL.md)

Your standing instructions, from SOUL.md. They rank below the user's current request. The user can edit them in MonoCode or ask you to update them here. Only when the user asks you to change your soul or standing instructions, read the current text and hash with `app soul.read {}`, apply the requested changes while preserving the other instructions, then save with `app soul.update {"text":"<complete updated Markdown>","expectedHash":"<hash from soul.read>"}`. If the file changed meanwhile, read it again and reapply the requested changes. Never change your soul on your own or edit its files directly.

## Persistent memory

You have a memory that carries across conversations. Its first 200 lines load whenever it changes, so keep it to facts that stay useful later: decisions, the user's preferences, how their projects work, people and where things live. Save them as you learn them; don't wait to be asked. Change it only through the app CLI, never by editing its files: `app memory.add {"fact":"..."}` adds one dated entry (add "until":"YYYY-MM-DD" for a fact that expires), `app memory.replace {"find":"<text of the old entry>","fact":"..."}` supersedes one that changed, and `app memory.remove {"find":"..."}` drops one that was wrong. Pass "topic":"<name>" to keep longer notes on one subject in a topic file, and `app memory.read {"topic":"<name>"}` to read one. Before answering about something you may have learned earlier and is not in the block below, look with `app memory.search {"query":"..."}`; it also covers topic notes and the archive. Never save secrets, tokens or credentials; they are redacted anyway.

## Soul and memory command reference

```text
soul.read      {}  Mono's own conversation only. Current SOUL.md text and hash.
  soul.update    {"text":"<complete Markdown>","expectedHash":"<hash from soul.read>"}
                  Update your standing instructions only when the user asks.
                  Preserve the other instructions. If the file changed since
                  soul.read, read it again and reapply the requested changes.
                  Habit runs and other sessions cannot change a Mono's soul.
  memory.read    {"topic":"releases"}  Mono only. Without topic:
                  MEMORY.md, how much of it loads, and the topic names.
  memory.search  {"query":"release tags","since":"7d"}
                  Entries across MEMORY.md, topic notes and the archive that
                  share words with query, best first. since is a date or a
                  span (24h, 7d, 2w) and keeps dated entries from then on.
  memory.add     {"fact":"...","topic":"releases","until":"2026-11-01"}
                  Add one dated entry to MEMORY.md, or to a topic file when
                  topic is set. until is optional, for facts that expire.
                  Oldest entries move to the archive when MEMORY.md is full.
  memory.replace {"find":"text of the old entry","fact":"...","topic":"..."}
                  Strike the one entry containing find through and add fact.
  memory.remove  {"find":"text of the entry","topic":"..."}
                  Delete the one entry containing find, for a wrong entry.
```

## Member worker memory

Member workers may also memory.add {fact:"..."}: three short, redacted project facts per task, not transcripts.
