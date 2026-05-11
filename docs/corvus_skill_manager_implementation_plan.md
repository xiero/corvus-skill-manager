# Corvus Skill Manager — TUI-first implementációs terv

> Cél: egy saját, GitHub-alapú skillgyűjtemény read-only telepítője és konfigurátora, amely a skilleket a user gépén egy központi `~/.agents` könyvtárból teszi elérhetővé több coding agent számára.

## 1. Kiinduló koncepció

A Corvus Skill Manager egy **TUI-first skill installer/manager** lesz.

Nem marketplace.
Nem package publisher.
Nem skill editor.
Nem repo updater.
Nem GitHub admin tool.

Hanem:

- letölti vagy frissíti helyben a kiválasztott skillpack forrását **read-only módon**;
- validálja, hogy a repo skillként értelmezhető könyvtárakat tartalmaz;
- a user kiválasztja TUI-ban, melyik skill melyik agenthez legyen bekötve;
- a manager symlinkkel, junctionnel vagy fallback copy móddal láthatóvá teszi a skilleket az adott agent célkönyvtárában;
- `doctor` nézetben megmutatja, mi van rendben, mi törött, mi hiányzik.

A projekt vibe-ja:

> Mérnökbarát, kontrollált, auditálható skill-fegyvertár. Nem vibe-coding varázsdoboz, hanem egy precíz agent tooling réteg.

---

## 2. Fontos termékdöntések

### 2.1 TUI-first, nincs külön Slice 1 CLI-only alap

Az MVP is TUI-val indul.

A CLI parancs csak belépési pont:

```bash
corvus-skills
```

Opcionálisan később:

```bash
corvus-skills doctor
corvus-skills status
corvus-skills tui
```

De az első élmény TUI legyen, mert kell a dopamin hit.

### 2.2 A manager nem módosíthatja a skill repót

Ez kritikus szabály.

A Corvus Skill Manager **nem írhat bele** a skill repositoryba:

- nem commitol;
- nem pushol;
- nem generál új skillt a repo alá;
- nem módosít `SKILL.md` fájlokat;
- nem futtat formattert a skill repon;
- nem próbál dependencyt installálni a skill repo belsejében;
- nem ír lock fájlt a skill repo könyvtárába.

Minden saját állapot a user home alatti manager könyvtárban él:

```text
~/.agents/corvus-skill-manager/
  config.json
  lock.json
  logs/
  cache/
```

A skillpack checkout revision-alapú, read-only assetként kezelhető:

```text
~/.agents/skillpacks/<skillpack-id>/
  revisions/<commit>/repo
  current -> revisions/<active-commit>/repo
```

### 2.3 A skill repo kezelése read-only revision modellben

A manager csak ezt teheti:

- ha nincs aktív `current`: initial clone egy `revisions/<commit>/repo` snapshotba;
- remote változást read-only módon detektál, például `git ls-remote` alapján;
- update preview kérésre új, inaktív revision snapshotot klónoz;
- explicit jóváhagyás után a manager-owned `current` linket átállítja;
- ha dirty vagy sérült a checkout, nem javítja, hanem jelzi.

Viszont a user kérése alapján még szigorúbb változat javasolt:

> MVP-ben a manager **ne update-eljen automatikusan**. Első installkor klónoz, utána remote változást jelez, preview-t ad, és csak explicit user action után aktivál új snapshotot.

Így a manager nem válik véletlenül repo-kezelő eszközzé.

---

## 3. Cél agent lista

Az első támogatott agentek:

| Agent              | Adapter ID | Elsődleges integráció                                                             | Megjegyzés                                                    |
| ------------------ | ---------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| OpenAI Codex CLI   | `codex`    | `~/.agents/skills` vagy Codex-specifikus path                                     | Agent Skills kompatibilis cél                                 |
| Claude Code        | `claude`   | `~/.claude/skills`                                                                | Natív skill folder modell                                     |
| GitHub Copilot CLI | `copilot`  | `~/.copilot/skills` vagy `~/.agents/skills`                                       | Copilot CLI Agent Skills támogatás                            |
| Gemini CLI         | `gemini`   | `~/.gemini/commands` adapterelt parancsok, később skill path ha natív lesz/stabil | Gemini custom slash command `.toml` modell miatt adapter kell |
| OpenCode           | `opencode` | `~/.config/opencode/skills` vagy `~/.agents/skills`                               | Natív Agent Skills támogatás                                  |
| Pi Agent           | `pi`       | `~/.pi/agent/skills` vagy `~/.agents/skills`                                      | Natív Agent Skills standard támogatás                         |
| Custom Agent       | `custom`   | user által megadott skills path                                                   | bármilyen kompatibilis agenthez                               |

Megjegyzés: a különböző agentek eltérően kezelik a skilleket. Codex, Claude, Copilot, OpenCode és Pi esetén a `SKILL.md` alapú Agent Skills forma jól illeszthető. Gemini CLI jelenleg elsősorban custom slash command `.toml` fájlokat támogat, ezért ott adapterelt command generálás vagy későbbi natív skill támogatás lehet a jó irány.

---

## 4. Javasolt technológiai stack

### 4.1 Runtime és nyelv

```text
Node.js LTS
TypeScript
pnpm workspace
```

### 4.2 TUI

```text
React
Ink
ink-select-input
ink-multi-select
ink-text-input
ink-spinner
```

### 4.3 Core utilok

```text
zod                 # config, registry, skill frontmatter validáció
execa               # git és shell parancsok kontrollált futtatásához
simple-git          # opcionális, ha git műveleteket nem execa-val akarjuk
fs-extra            # fájlműveletek
js-yaml             # SKILL.md frontmatter olvasás, vagy gray-matter
gray-matter         # markdown frontmatter parsing
picocolors          # szép terminál output
untildify           # ~ path kezelés
```

### 4.4 Tesztelés

```text
vitest
memfs vagy tmp-promise
@testing-library/react opcionálisan Ink komponensekhez
```

### 4.5 Express?

MVP-be nem kell.

Express csak később indokolt, ha lesz:

- lokális web dashboard;
- remote skill registry;
- team/org skill catalog;
- audit API;
- self-hosted marketplace;
- böngészős config UI.

---

## 5. Repository felépítés

Javasolt két külön repo:

```text
corvus-skill-manager/   # maga a TUI installer app
corvus-skills/          # saját skillgyűjtemény
```

### 5.1 `corvus-skill-manager` repo

```text
corvus-skill-manager/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md

  packages/
    core/
      package.json
      src/
        agents/
          AgentAdapter.ts
          codexAdapter.ts
          claudeAdapter.ts
          copilotAdapter.ts
          geminiAdapter.ts
          opencodeAdapter.ts
          piAdapter.ts
          customAdapter.ts
          index.ts

        config/
          configSchema.ts
          loadConfig.ts
          saveConfig.ts
          paths.ts

        git/
          cloneSkillpack.ts
          inspectRepo.ts
          resolveCommit.ts
          ensureReadOnlyCheckout.ts

        registry/
          registrySchema.ts
          loadRegistry.ts
          validateRegistry.ts

        skills/
          skillSchema.ts
          discoverSkills.ts
          readSkillMetadata.ts
          validateSkill.ts
          normalizeSkillId.ts

        links/
          createSkillLink.ts
          removeSkillLink.ts
          detectLinkStatus.ts
          resolveLinkMode.ts

        safety/
          scanSkill.ts
          classifySkillRisk.ts
          permissionSummary.ts

        status/
          buildStatusReport.ts
          buildDoctorReport.ts

    tui/
      package.json
      src/
        main.tsx
        App.tsx
        screens/
          WelcomeScreen.tsx
          SkillpackSetupScreen.tsx
          AgentSelectionScreen.tsx
          SkillSelectionScreen.tsx
          ApplyPlanScreen.tsx
          StatusScreen.tsx
          DoctorScreen.tsx
          SettingsScreen.tsx
        components/
          Header.tsx
          FooterHelp.tsx
          StatusBadge.tsx
          SkillRiskBadge.tsx
          AgentCard.tsx
          ConfirmDangerBox.tsx

    cli/
      package.json
      src/
        main.ts
```

### 5.2 `corvus-skills` repo

```text
corvus-skills/
  README.md
  registry.json
  skills/
    spec-driven-dev/
      SKILL.md
      references/
        workflow.md
        architecture-checklist.md
      templates/
        task-template.md
        adr-template.md

    cpp-agent-mentor/
      SKILL.md
      references/
        cpp-roadmap.md
        modern-cpp-style.md

    tdd-loop/
      SKILL.md
      references/
        red-green-refactor.md

    architecture-review/
      SKILL.md
      references/
        modularity-checklist.md
```

---

## 6. Helyi fájlrendszer layout

### 6.1 Központi skillpack tárolás

```text
~/.agents/
  skillpacks/
    corvus-skills/
      repo/                 # read-only Git checkout

  corvus-skill-manager/
    config.json
    lock.json
    logs/
    cache/
```

### 6.2 Agent célkönyvtárak

```text
~/.agents/skills/                  # univerzális Agent Skills cél
~/.claude/skills/                  # Claude Code
~/.copilot/skills/                 # GitHub Copilot CLI
~/.config/opencode/skills/         # OpenCode natív global config
~/.pi/agent/skills/                # Pi Agent natív global config
~/.gemini/commands/                # Gemini CLI custom slash commands
```

### 6.3 Symlink példa

```text
~/.agents/skills/spec-driven-dev
  -> ~/.agents/skillpacks/corvus-skills/repo/skills/spec-driven-dev

~/.claude/skills/spec-driven-dev
  -> ~/.agents/skillpacks/corvus-skills/repo/skills/spec-driven-dev

~/.pi/agent/skills/spec-driven-dev
  -> ~/.agents/skillpacks/corvus-skills/repo/skills/spec-driven-dev
```

Gemini esetén nem sima skill symlink az elsődleges MVP, hanem generált `.toml` command wrapper lehet:

```text
~/.gemini/commands/corvus/spec-driven-dev.toml
```

A wrapper prompt csak hivatkozik a skillre, például:

```toml
description = "Run the Corvus spec-driven-dev workflow."
prompt = """
Read and follow this skill:
~/.agents/skillpacks/corvus-skills/repo/skills/spec-driven-dev/SKILL.md

User request:
{{args}}
"""
```

---

## 7. Config modell

### 7.1 `config.json`

```json
{
  "version": 1,
  "defaultLinkMode": "symlink",
  "skillpacks": [
    {
      "id": "corvus-skills",
      "repoUrl": "git@github.com:csabi/corvus-skills.git",
      "branch": "main",
      "localPath": "~/.agents/skillpacks/corvus-skills/repo",
      "updatePolicy": "manual-readonly"
    }
  ],
  "agents": {
    "codex": {
      "enabled": true,
      "targetPath": "~/.agents/skills",
      "linkMode": "symlink"
    },
    "claude": {
      "enabled": true,
      "targetPath": "~/.claude/skills",
      "linkMode": "symlink"
    },
    "copilot": {
      "enabled": true,
      "targetPath": "~/.copilot/skills",
      "linkMode": "symlink"
    },
    "gemini": {
      "enabled": true,
      "targetPath": "~/.gemini/commands/corvus",
      "linkMode": "generated-command"
    },
    "opencode": {
      "enabled": true,
      "targetPath": "~/.config/opencode/skills",
      "linkMode": "symlink"
    },
    "pi": {
      "enabled": true,
      "targetPath": "~/.pi/agent/skills",
      "linkMode": "symlink"
    }
  },
  "enabledSkills": {
    "codex": ["spec-driven-dev", "tdd-loop"],
    "claude": ["spec-driven-dev"],
    "copilot": ["spec-driven-dev"],
    "gemini": ["spec-driven-dev"],
    "opencode": ["spec-driven-dev"],
    "pi": ["spec-driven-dev"]
  }
}
```

### 7.2 `lock.json`

```json
{
  "version": 1,
  "skillpacks": {
    "corvus-skills": {
      "repoUrl": "git@github.com:csabi/corvus-skills.git",
      "branch": "main",
      "commit": "a1b2c3d4",
      "installedAt": "2026-05-08T12:00:00.000Z",
      "managerVersion": "0.1.0"
    }
  }
}
```

A lock fájl a manager saját állapota, nem kerül a skill repo alá.

---

## 8. Skill registry formátum

A skill repo gyökerében:

```json
{
  "schemaVersion": 1,
  "id": "corvus-skills",
  "name": "Corvus Skills",
  "description": "Engineer-grade agent skills for controlled AI-assisted software development.",
  "skills": [
    {
      "id": "spec-driven-dev",
      "path": "skills/spec-driven-dev",
      "title": "Spec Driven Development",
      "description": "Turn a feature idea into a specification-first implementation plan with tests and architecture checks.",
      "tags": ["planning", "architecture", "coding"],
      "agents": ["codex", "claude", "copilot", "opencode", "pi", "gemini"],
      "defaultEnabled": true,
      "risk": "low"
    },
    {
      "id": "cpp-agent-mentor",
      "path": "skills/cpp-agent-mentor",
      "title": "C++ Agent Mentor",
      "description": "A guided C++17-to-modern-C++ learning workflow while building a TUI coding agent.",
      "tags": ["cpp", "mentor", "agent"],
      "agents": ["codex", "claude", "copilot", "opencode", "pi"],
      "defaultEnabled": false,
      "risk": "low"
    }
  ]
}
```

A manager ellenőrizze:

- `registry.json` létezik;
- a `skills[].path` a repo gyökéren belül marad;
- minden skill mappában van `SKILL.md`;
- a `SKILL.md` frontmatter tartalmaz legalább `name` és `description` mezőt;
- a `name` egyezzen a skill ID-val vagy legyen explicit mapping;
- nincs path traversal (`../`) támadás;
- nincs abszolút path a registryben.

---

## 9. AgentAdapter interface

```ts
export type LinkMode = "symlink" | "junction" | "copy" | "generated-command";

export interface AgentAdapter {
  id: string;
  displayName: string;

  defaultTargetPath(): string;

  detect(): Promise<{
    installed: boolean;
    confidence: "high" | "medium" | "low";
    details?: string;
  }>;

  supportsSkill(skill: SkillMetadata): boolean;

  planEnable(input: {
    skill: SkillMetadata;
    sourcePath: string;
    targetRoot: string;
    linkMode: LinkMode;
  }): Promise<ApplyOperation[]>;

  planDisable(input: {
    skillId: string;
    targetRoot: string;
  }): Promise<ApplyOperation[]>;

  listEnabled(targetRoot: string): Promise<EnabledSkill[]>;
}
```

### 9.1 ApplyOperation

```ts
export type ApplyOperation =
  | {
      type: "ensure-dir";
      path: string;
    }
  | {
      type: "create-link";
      sourcePath: string;
      targetPath: string;
      mode: "symlink" | "junction" | "copy";
    }
  | {
      type: "write-generated-file";
      targetPath: string;
      content: string;
      overwritePolicy: "managed-only";
    }
  | {
      type: "remove-managed-link";
      targetPath: string;
    };
```

Fontos: csak manager által létrehozott linket/fájlt törlünk. Ezt markerrel vagy manifesttel kell követni.

---

## 10. Agentenkénti adapter terv

### 10.1 Codex adapter

Preferált cél:

```text
~/.agents/skills
```

Működés:

- skill mappa symlink a központi skillpackból;
- `SKILL.md` marad eredeti helyén;
- validáció: `SKILL.md` frontmatter.

### 10.2 Claude adapter

Preferált cél:

```text
~/.claude/skills
```

Működés:

- skill mappa symlink;
- közvetlen `/skill-name` használható;
- a manager nem ír `CLAUDE.md` fájlba.

### 10.3 GitHub Copilot CLI adapter

Preferált cél:

```text
~/.copilot/skills
```

Alternatív cél:

```text
~/.agents/skills
```

Működés:

- skill mappa symlink;
- később támogatható custom agent vagy instruction file generálás, de MVP-ben csak skills.

### 10.4 Gemini CLI adapter

Preferált cél MVP-ben:

```text
~/.gemini/commands/corvus
```

Működés:

- nem natív `SKILL.md` symlinkként indul;
- generált `.toml` slash command készül minden engedélyezett skillhez;
- a `.toml` prompt hivatkozik az eredeti skill `SKILL.md` pathjára;
- a command név lehet `/corvus:spec-driven-dev`.

Példa:

```text
~/.gemini/commands/corvus/spec-driven-dev.toml
```

```toml
description = "Use Corvus skill: spec-driven-dev."
prompt = """
Use the following Corvus skill instructions as the authoritative workflow:
~/.agents/skillpacks/corvus-skills/repo/skills/spec-driven-dev/SKILL.md

Apply it to this request:
{{args}}
"""
```

### 10.5 OpenCode adapter

Preferált cél:

```text
~/.config/opencode/skills
```

Alternatív cél:

```text
~/.agents/skills
```

Működés:

- skill mappa symlink;
- OpenCode több discovery pathot is támogat, ezért TUI-ban választható legyen:
  - universal: `~/.agents/skills`
  - native: `~/.config/opencode/skills`

### 10.6 Pi adapter

Preferált cél:

```text
~/.pi/agent/skills
```

Alternatív cél:

```text
~/.agents/skills
```

Működés:

- skill mappa symlink;
- Pi skill commandként is használhatja: `/skill:<name>`.

### 10.7 Custom adapter

TUI kérdezze meg:

```text
Custom agent display name:
Target skills directory:
Link mode:
```

Mentés:

```json
{
  "agents": {
    "custom:my-agent": {
      "enabled": true,
      "displayName": "My Agent",
      "targetPath": "~/my-agent/skills",
      "linkMode": "symlink"
    }
  }
}
```

---

## 11. TUI flow

### 11.1 Welcome screen

```text
Corvus Skill Manager

Engineer-grade skill wiring for coding agents.

Detected:
✓ Home: /home/csabi
✓ Config: ~/.agents/corvus-skill-manager/config.json

What do you want to do?
> Setup / configure
  Enable skills
  Disable skills
  Status
  Doctor
  Settings
  Exit
```

### 11.2 Skillpack setup

```text
Skillpack source

Repo URL:
> git@github.com:csabi/corvus-skills.git

Branch:
> main

Local path:
> ~/.agents/skillpacks/corvus-skills/repo

Policy:
> readonly manual install
```

Apply után:

```text
✓ Repository cloned
✓ registry.json found
✓ 4 skills discovered
✓ 4 valid SKILL.md files
```

Ha már létezik:

```text
Skillpack already installed.

Commit: a1b2c3d4
Path: ~/.agents/skillpacks/corvus-skills/repo

This manager will not modify the skill repository.
```

### 11.3 Agent selection

```text
Select target agents

[x] Codex CLI        ~/.agents/skills
[x] Claude Code      ~/.claude/skills
[x] Copilot CLI      ~/.copilot/skills
[x] Gemini CLI       ~/.gemini/commands/corvus
[x] OpenCode         ~/.config/opencode/skills
[x] Pi Agent         ~/.pi/agent/skills
[ ] Custom Agent
```

### 11.4 Skill selection

```text
Enable skills for selected agents

[x] spec-driven-dev       low risk      planning, architecture, coding
[x] tdd-loop              low risk      testing, implementation
[ ] cpp-agent-mentor      low risk      cpp, mentor, agent
[ ] architecture-review   low risk      architecture, review
```

### 11.5 Apply plan

```text
Planned operations

Codex:
  create link ~/.agents/skills/spec-driven-dev

Claude:
  create link ~/.claude/skills/spec-driven-dev

Copilot:
  create link ~/.copilot/skills/spec-driven-dev

Gemini:
  write generated command ~/.gemini/commands/corvus/spec-driven-dev.toml

OpenCode:
  create link ~/.config/opencode/skills/spec-driven-dev

Pi:
  create link ~/.pi/agent/skills/spec-driven-dev

Apply changes?
> Yes
  No
```

### 11.6 Status screen

```text
Status

Skillpack: corvus-skills
Path: ~/.agents/skillpacks/corvus-skills/repo
Commit: a1b2c3d4
Repo state: clean
Manager mode: read-only

Agents:
✓ Codex       2 skills enabled
✓ Claude      1 skill enabled
✓ Copilot     1 skill enabled
✓ Gemini      1 command generated
✓ OpenCode    1 skill enabled
✓ Pi          1 skill enabled
```

### 11.7 Doctor screen

```text
Doctor report

✓ config.json valid
✓ lock.json valid
✓ skillpack path exists
✓ registry.json valid
✓ all enabled skill sources exist
✓ all Codex links valid
✓ all Claude links valid
⚠ Gemini command wrapper is stale for spec-driven-dev
✗ OpenCode link broken: architecture-review

Suggested fixes:
- Regenerate Gemini managed command wrappers
- Remove or recreate broken OpenCode link
```

---

## 12. Biztonsági modell

### 12.1 Skill risk scan

A manager ne futtasson skill scriptet.

Csak statikusan jelezzen:

- van-e `scripts/` mappa;
- van-e executable fájl;
- vannak-e shell fájlok;
- van-e `curl | bash`, `rm -rf`, token/env exfiltration gyanús minta;
- van-e abszolút path;
- van-e hálózati műveletre utalás.

Kockázati szintek:

```text
low      csak markdown/reference/template
medium   van script, de nem gyanús
high     gyanús shell/network/destructive minta
unknown  nem olvasható vagy invalid
```

### 12.2 Trust gate

Ha egy skill `medium` vagy `high`:

```text
⚠ This skill contains executable resources.
Review before enabling.

[ ] I reviewed this skill and trust it
```

A TUI ne engedje tovább checkbox nélkül.

### 12.3 Managed ownership

A manager csak azt módosíthatja/törölheti, amit ő hozott létre.

Ehhez manifest:

```json
{
  "managedTargets": [
    {
      "agent": "claude",
      "skillId": "spec-driven-dev",
      "targetPath": "~/.claude/skills/spec-driven-dev",
      "sourcePath": "~/.agents/skillpacks/corvus-skills/repo/skills/spec-driven-dev",
      "type": "symlink"
    }
  ]
}
```

Ha egy target már létezik, de nem manager-created:

```text
Target already exists and is not managed by Corvus.
Options:
- skip
- show details
- use different target path
```

Ne írja felül automatikusan.

---

## 13. Link stratégia

### 13.1 Alapértelmezett

Linux/macOS:

```text
symlink
```

Windows:

```text
junction directory esetén
copy fallback, ha nincs jogosultság
```

### 13.2 Link mode enum

```ts
export type LinkMode =
  | "symlink"
  | "junction"
  | "copy"
  | "generated-command";
```

### 13.3 Fallback szabály

Ha symlink nem sikerül:

```text
1. Windows: próbálj junctiont
2. Ha az sem megy: kérdezz rá copy fallbackre
3. Copy fallback esetén jelezd, hogy frissítéskor újra kell generálni
```

---

## 14. MVP scope

### Benne van az MVP-ben

- TUI indulás `corvus-skills` paranccsal;
- skillpack repo első klónozása;
- `registry.json` olvasás;
- skill validálás;
- agent választás:
  - Codex
  - Claude
  - Copilot CLI
  - Gemini CLI
  - OpenCode
  - Pi Agent
  - Custom
- skill választás checkboxos UI-val;
- apply plan preview;
- symlink/junction/copy létrehozás;
- Gemini `.toml` wrapper generálás;
- status screen;
- doctor screen;
- config és lock mentés;
- manager-owned target manifest;
- basic risk scan.

### Nincs benne az MVP-ben

- skill repo szerkesztés;
- skill repo update;
- skill generálás;
- remote registry API;
- Express backend;
- auth;
- cloud sync;
- marketplace;
- skill futtatás;
- script execution;
- automatikus dependency install.

---

## 15. Implementációs slice-ok

## Slice 1 — TUI app skeleton és core config

### Cél

Elinduljon a TUI, legyen menü, config path, és lehessen alapbeállítást menteni.

### Feladatok

1. `pnpm-workspace.yaml` létrehozása.
2. `packages/core`, `packages/tui`, `packages/cli` létrehozása.
3. TypeScript config.
4. Ink app minimál layout.
5. `WelcomeScreen`.
6. `SettingsScreen` alap pathokkal.
7. `loadConfig/saveConfig` zod validációval.

### Acceptance criteria

- `pnpm dev` elindítja a TUI-t.
- Ha nincs config, létrehozza a default configot.
- A TUI megmutatja a config helyét.
- Unit teszt van config load/save-re.

---

## Slice 2 — Skillpack install read-only módban

### Cél

A TUI-ból megadható legyen egy GitHub repo URL, amit a manager lokálisan klónoz, de nem módosít.

### Feladatok

1. `SkillpackSetupScreen`.
2. Repo URL input.
3. Branch input.
4. Local path számítás.
5. `cloneSkillpackRevision()`.
6. `inspectRepo()` commit hash olvasással.
7. `ensureReadOnlyCheckout()` dirty state ellenőrzéssel.
8. Lock file írás a manager saját könyvtárába.

### Acceptance criteria

- Friss installnál commit-alapú revision snapshotot klónoz.
- Létező checkoutnál nem pullol automatikusan.
- Dirty checkout esetén figyelmeztet.
- Meglévő skill repo revision alá nem ír semmit.

---

## Slice 3 — Registry és SKILL.md validáció

### Cél

A manager listázza és validálja a skill repo skilleket.

### Feladatok

1. `registrySchema.ts`.
2. `loadRegistry.ts`.
3. `discoverSkills.ts`.
4. `readSkillMetadata.ts` gray-matterrel.
5. `validateSkill.ts`.
6. Risk scan alapverzió.
7. Skill list UI.

### Acceptance criteria

- Hiányzó `registry.json` esetén érthető hiba.
- Hiányzó `SKILL.md` esetén invalid skill.
- Valid skillnél látszik title, description, tags, risk.
- A TUI nem omlik össze invalid skill miatt.

---

## Slice 4 — Agent adapterek alapjai

### Cél

Minden cél agenthez legyen adapter skeleton és default path.

### Feladatok

1. `AgentAdapter` interface.
2. `codexAdapter`.
3. `claudeAdapter`.
4. `copilotAdapter`.
5. `geminiAdapter`.
6. `opencodeAdapter`.
7. `piAdapter`.
8. `customAdapter`.
9. Agent selection UI.

### Acceptance criteria

- A TUI listázza a támogatott agenteket.
- Minden agentnél látszik a default target path.
- A user ki/be tudja pipálni az agenteket.
- Custom agentnél megadható path.

---

## Slice 5 — Apply plan és symlink manager

### Cél

A kiválasztott skillekhez és agentekhez készül egy preview plan, majd alkalmazható.

### Feladatok

1. `createSkillLink()`.
2. `removeSkillLink()`.
3. `detectLinkStatus()`.
4. `ApplyPlanScreen`.
5. Managed target manifest.
6. Existing target conflict kezelés.
7. Symlink/junction/copy fallback.

### Acceptance criteria

- Apply előtt látszik minden fájlrendszer művelet.
- A manager csak user confirmation után ír célkönyvtárba.
- Már létező, nem managed célpontot nem ír felül.
- Sikeres apply után a linkek léteznek.
- Manifestben megjelennek a managed targetek.

---

## Slice 6 — Gemini command wrapper

### Cél

Gemini CLI-hez `.toml` slash command wrapper generálás.

### Feladatok

1. `geminiAdapter.planEnable()` `write-generated-file` operationnel.
2. Command namespace: `corvus/<skill-id>.toml`.
3. Managed-only overwrite policy.
4. Stale wrapper detection.
5. Doctor warning, ha a wrapper régi source pathra mutat.

### Acceptance criteria

- `~/.gemini/commands/corvus/spec-driven-dev.toml` létrejön.
- A prompt az eredeti `SKILL.md` pathra hivatkozik.
- Nem ír felül kézzel létrehozott Gemini commandot.

---

## Slice 7 — Status és Doctor

### Cél

A user lássa, mi van telepítve, mi törött, mi stale.

### Feladatok

1. `buildStatusReport()`.
2. `buildDoctorReport()`.
3. `StatusScreen`.
4. `DoctorScreen`.
5. Broken symlink felismerés.
6. Missing source felismerés.
7. Invalid config felismerés.

### Acceptance criteria

- Status mutatja a skillpack commitot.
- Status mutatja agentenként az enabled skilleket.
- Doctor felismeri a törött linket.
- Doctor felismeri a hiányzó skill source-ot.
- Doctor nem módosít automatikusan semmit.

---

## Slice 8 — Polish, UX, release

### Cél

Használható, szép, stabil első kiadás.

### Feladatok

1. Szebb TUI layout.
2. Keyboard shortcutok.
3. Error boundary Ink apphoz.
4. README.
5. Install docs.
6. `npm pack` teszt.
7. GitHub Actions CI.
8. Release script.

### Acceptance criteria

- `npm i -g` után működik.
- README alapján friss gépen kipróbálható.
- CI futtat typechecket és teszteket.
- Nincs skill repo write operation.

---

## 16. Első konkrét fájlok, amelyeket érdemes létrehozni

```text
corvus-skill-manager/
  package.json
  pnpm-workspace.yaml
  tsconfig.base.json
  README.md

  packages/core/src/config/paths.ts
  packages/core/src/config/configSchema.ts
  packages/core/src/config/loadConfig.ts
  packages/core/src/config/saveConfig.ts

  packages/core/src/agents/AgentAdapter.ts
  packages/core/src/agents/codexAdapter.ts
  packages/core/src/agents/claudeAdapter.ts
  packages/core/src/agents/copilotAdapter.ts
  packages/core/src/agents/geminiAdapter.ts
  packages/core/src/agents/opencodeAdapter.ts
  packages/core/src/agents/piAdapter.ts
  packages/core/src/agents/customAdapter.ts

  packages/tui/src/main.tsx
  packages/tui/src/App.tsx
  packages/tui/src/screens/WelcomeScreen.tsx
  packages/tui/src/screens/SkillpackSetupScreen.tsx
  packages/tui/src/screens/AgentSelectionScreen.tsx
  packages/tui/src/screens/SkillSelectionScreen.tsx
  packages/tui/src/screens/ApplyPlanScreen.tsx
  packages/tui/src/screens/StatusScreen.tsx
  packages/tui/src/screens/DoctorScreen.tsx
```

---

## 17. Korai tesztstratégia

### 17.1 Unit tesztek

- config schema default valid;
- registry schema valid/invalid;
- skill name normalizálás;
- frontmatter parsing;
- path traversal tiltás;
- adapter default pathok;
- apply operation generálás.

### 17.2 Fájlrendszer tesztek temp dirrel

- symlink létrehozás;
- broken symlink detection;
- existing unmanaged target conflict;
- managed target remove;
- Gemini TOML wrapper generálás.

### 17.3 Manual smoke test

```bash
pnpm install
pnpm dev
```

Majd:

1. add skillpack repo;
2. select Codex + Claude + Pi;
3. enable `spec-driven-dev`;
4. apply;
5. run status;
6. run doctor;
7. ellenőrizd a cél pathokat.

---

## 18. Védőkorlátok Codexnek / implementáló agentnek

Ezt érdemes az implementációs promptba is betenni:

```text
Do not implement any feature that modifies the skill repository contents.
The skill repository is read-only from the manager's perspective.
All manager state must be stored under ~/.agents/corvus-skill-manager.
Do not add automatic update/pull behavior after initial clone.
Do not execute scripts from installed skills.
Do not overwrite existing files unless they are marked as managed by Corvus Skill Manager.
Prefer symlinks on Unix-like systems and junctions on Windows.
Gemini CLI integration should generate managed .toml command wrappers instead of pretending Gemini has the exact same skill discovery model as SKILL.md-based agents.
```

---

## 19. Javasolt első user story-k

### Story 1 — First run

Mint user, szeretném elindítani a `corvus-skills` TUI-t, hogy lássam, hol lesz a config és milyen lépések várnak rám.

### Story 2 — Install read-only skillpack

Mint user, szeretnék megadni egy GitHub skill repo URL-t, hogy a manager lokálisan klónozza, de ne módosítsa.

### Story 3 — Select agents

Mint user, szeretném kiválasztani, hogy Codex, Claude, Copilot CLI, Gemini CLI, OpenCode és Pi közül melyikhez legyenek bekötve a skillek.

### Story 4 — Enable skills

Mint user, szeretném checkboxokkal kiválasztani a skilleket, és preview után bekötni őket az agentekhez.

### Story 5 — Doctor

Mint user, szeretném látni, ha egy symlink törött, egy skill invalid, vagy egy generated Gemini command stale.

---

## 20. Rövid végkövetkeztetés

Az MVP legjobb formája:

```text
TUI-first
read-only skillpack revisions
multi-agent adapter layer
symlink-first install
Gemini deferred for MVP
no Express
no mutable repo modification
doctor/status beépítve
```

Ez egy nagyon jó első Corvus tooling projekt lehet: kicsi, hasznos, látványos, mégis mérnökileg tiszta. Pont olyan, mint egy jó TUI: nem harsány, de amikor működik, az ember kicsit úgy érzi, hogy terminálból vezérli a Batmobilt.

---

## 21. Ellenőrzött referencia pontok

- OpenAI Codex Agent Skills: `SKILL.md`, `scripts/`, `references/`, `assets/`, user-level skills.
- Claude Code Skills: `SKILL.md` alapú skill folder modell, `/skill-name` invocation.
- GitHub Copilot CLI Agent Skills: személyes skill könyvtárak, `~/.copilot/skills` és `~/.agents/skills`.
- Gemini CLI custom commands: `~/.gemini/commands/*.toml`, `{{args}}`, namespacing.
- OpenCode Agent Skills: `.opencode/skills`, `~/.config/opencode/skills`, `.agents/skills`, `.claude/skills` discovery.
- Pi Agent Skills: `~/.pi/agent/skills`, `~/.agents/skills`, Agent Skills standard, `/skill:name` commands.
