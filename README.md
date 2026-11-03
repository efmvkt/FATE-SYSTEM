# FATE-SYSTEM
# FATE SYSTEM — Passive Observer (v0.3.0)

Mobile-first SillyTavern UI extension. FATE SYSTEM is an **observer**, not a character controller.

## Core principle: character card remains authoritative
- The active character card is read as a read-only source of canon.
- FATE SYSTEM does not edit the card, prompt, personality, scenario, examples, or roleplay messages.
- Analysis is requested separately through SillyTavern quiet generation and is not inserted as behavior instructions into the character's reply prompt.
- Relationship numbers are rough observations of displayed behavior, never a measurement of canon love and never a command.
- Apparent contradictions are recorded as “canon vs observation”; they do not rewrite canon.

## Features
- Mobile bottom-sheet interface for iPhone.
- Separate card-canon and observed-state sections.
- Relationship signal estimates with evidence and confidence.
- Mood, outward behavior, goals, perception, cautious interpretations, events, quests, and durable memories.
- Automatic analysis after a configurable number of character replies; manual Update Now.
- Freeze/unfreeze, export/import JSON dossier, rollback.

## Install
1. Put `manifest.json`, `index.js`, and `style.css` in the root of your Git repository.
2. SillyTavern → Extensions → Install Extension → enter the repository URL.
3. Enable the extension and reload.

Private GitHub repositories may require authenticated installation; a private repo is not automatically accessible to an unauthenticated installer.

## Storage and limitations
- Per-chat dossier is stored in browser extension storage in this prototype. Export backups regularly.
- Analysis quality depends on the selected model and the amount of chat context available. Estimates can be wrong; evidence and confidence are shown to make uncertainty visible.
- Test in a separate chat first. This has not been verified on every SillyTavern build or iOS browser.
