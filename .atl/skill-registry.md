# Skill Registry

**Orchestrator use only.** Read this registry once per session to resolve skill paths, then pass pre-resolved paths directly to each sub-agent's launch prompt. Sub-agents receive the path and load the skill directly — they do NOT read this registry.

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When user asks to create a new skill, add agent instructions, or document patterns for AI | skill-creator | `C:\Users\Alcatraz\.claude\skills\skill-creator\SKILL.md` |
| When writing Go tests, using teatest, or adding test coverage | go-testing | `C:\Users\Alcatraz\.claude\skills\go-testing\SKILL.md` |

## Project Conventions

No convention files detected (brand new project).
