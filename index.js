const MODULE = 'fate_system';
const PREFIX = '[FATE SYSTEM]';
const DEFAULTS = {
    enabled: true,
    autoAnalysis: true,
    frozen: false,
    interval: 8,
    showNotifications: true,
};
const DEFAULT_STATE = {
    version: 3,
    canon: { source: 'character_card', summary: 'Read directly from the active card; never modified by FATE SYSTEM.' },
    character: { name: 'Unknown character', role: '', mood: 'Unknown', outwardBehavior: 'Unknown', currentGoal: 'Unknown' },
    relationship: { status: 'Not enough evidence', affection: null, attraction: null, trust: null, respect: null, curiosity: null, resentment: null, frustration: null, attachment: null, evidence: 'No analysis yet.', confidence: 'none' },
    thoughts: 'Not analyzed yet.',
    perception: 'Not analyzed yet.',
    hiddenFeelings: 'Unknown',
    currentEvents: [],
    quests: [],
    memories: [],
    reputation: {},
    world: { date: 'Unknown', time: 'Unknown', location: 'Unknown' },
    lastAnalysis: null,
    analyzedMessageCount: 0,
};

let ctx;
let settings;
let state = structuredClone(DEFAULT_STATE);
let chatKey = 'no-chat';
let messageCounter = 0;
let busy = false;
let panel;

function getChatKey() {
    const c = SillyTavern.getContext();
    const character = c.characters?.[c.characterId];
    const title = c.chat?.[0]?.chat_metadata?.note
        || c.chat?.[0]?.name
        || c.chat?.[0]?.chat_id
        || character?.name
        || `character-${c.characterId ?? 'unknown'}`;
    const stableId = c.chatId || c.chatMetadata?.chat_id || c.chat?.[0]?.chat_id || title;
    return `${character?.avatar || character?.name || 'unknown'}::${String(stableId).slice(0, 160)}`;
}

async function storageGet(key) {
    try {
        const lf = SillyTavern.libs?.localforage;
        if (lf) return await lf.getItem(key);
    } catch (e) { console.warn(PREFIX, 'localforage read failed', e); }
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}
async function storageSet(key, value) {
    try {
        const lf = SillyTavern.libs?.localforage;
        if (lf) return await lf.setItem(key, value);
    } catch (e) { console.warn(PREFIX, 'localforage write failed', e); }
    localStorage.setItem(key, JSON.stringify(value));
}

function getCharacterCard() {
    const c = SillyTavern.getContext();
    const ch = c.characters?.[c.characterId] || {};
    return {
        name: ch.name || 'Unknown',
        description: ch.description || '',
        personality: ch.personality || '',
        scenario: ch.scenario || '',
        first_mes: ch.first_mes || '',
        mes_example: ch.mes_example || '',
        creator_notes: ch.creator_notes || '',
    };
}
function getCanonText() {
    const card = getCharacterCard();
    return [
        card.description && `DESCRIPTION\n${card.description}`,
        card.personality && `PERSONALITY\n${card.personality}`,
        card.scenario && `SCENARIO\n${card.scenario}`,
        card.first_mes && `FIRST MESSAGE\n${card.first_mes}`,
        card.mes_example && `EXAMPLE DIALOGUE\n${card.mes_example}`,
    ].filter(Boolean).join('\n\n').slice(0, 2600) || 'No readable card fields found.';
}

function getRecentChat() {
    const chat = SillyTavern.getContext().chat || [];
    return chat.slice(-24).map(m => ({
        speaker: m.is_user ? 'USER' : (m.name || 'CHARACTER'),
        text: String(m.mes || '').slice(0, 4000),
    }));
}
function safeParse(text) {
    if (!text) throw new Error('The model returned an empty response.');
    const cleaned = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('No JSON object found in the analysis response.');
    return JSON.parse(cleaned.slice(start, end + 1));
}
function clampStat(v) {
    if (v === null || v === undefined || v === '' || Number.isNaN(Number(v))) return null;
    return Math.max(0, Math.min(100, Math.round(Number(v))));
}
function mergeAnalysis(data) {
    const str = (v, fallback = 'Unknown') => typeof v === 'string' && v.trim() ? v.trim() : fallback;
    const arr = v => Array.isArray(v) ? v : [];
    const rel = data.relationship || {};
    state.canon = { ...(state.canon || {}), ...(data.canon || {}), source: 'character_card' };
    state.character = {
        name: str(data.character?.name, getCharacterCard().name),
        role: str(data.character?.role, state.character.role || ''),
        mood: str(data.character?.mood),
        outwardBehavior: str(data.character?.outward_behavior),
        currentGoal: str(data.character?.current_goal),
    };
    state.relationship = {
        status: str(rel.status, state.relationship.status),
        affection: clampStat(rel.affection) ?? state.relationship.affection,
        attraction: clampStat(rel.attraction) ?? state.relationship.attraction,
        trust: clampStat(rel.trust) ?? state.relationship.trust,
        respect: clampStat(rel.respect) ?? state.relationship.respect,
        curiosity: clampStat(rel.curiosity) ?? state.relationship.curiosity,
        resentment: clampStat(rel.resentment) ?? state.relationship.resentment,
        frustration: clampStat(rel.frustration) ?? state.relationship.frustration,
        attachment: clampStat(rel.attachment) ?? state.relationship.attachment,
        evidence: str(rel.evidence, state.relationship.evidence || 'Insufficient evidence.'),
        confidence: ['low','medium','high'].includes(rel.confidence) ? rel.confidence : (state.relationship.confidence || 'none'),
    };
    state.thoughts = str(data.internal_monologue, 'Insufficient evidence.');
    state.perception = str(data.perception_of_user, 'Insufficient evidence.');
    state.hiddenFeelings = str(data.possible_hidden_feelings, 'Unknown');
    state.canonVsObservation = str(data.canon_vs_observation, state.canonVsObservation || 'No comparison recorded.');
    if (Array.isArray(data.current_events)) state.currentEvents = data.current_events.slice(0, 8);
    if (Array.isArray(data.quests)) state.quests = data.quests.slice(0, 12);
    if (Array.isArray(data.memories)) state.memories = [...new Set([...(state.memories || []), ...data.memories])].slice(-60);
    state.reputation = data.reputation && typeof data.reputation === 'object' ? data.reputation : state.reputation;
    state.world = {
        date: str(data.world?.date, state.world.date),
        time: str(data.world?.time, state.world.time),
        location: str(data.world?.location, state.world.location),
    };
    state.lastAnalysis = new Date().toISOString();
    state.analyzedMessageCount = getRecentChat().length;
}

function buildAnalysisPrompt() {
    const card = getCharacterCard();
    const history = getRecentChat();
    return `You are FATE SYSTEM, a PASSIVE OBSERVER and continuity analyst. You are NOT a roleplay director, co-author, character controller, or behavior regulator.

CRITICAL NON-INTERFERENCE RULES:
- The character card is the source of truth for the character's personality, backstory, scenario, motivations, established relationships, and canon feelings.
- Never rewrite, weaken, reinterpret away, contradict, or replace the character card. Never propose instructions that should be injected into the roleplay prompt.
- Your output is an external analytical dossier only. It must not be used as a command to the character or as a condition for future replies.
- Numeric relationship values are observations about recent displayed behavior, NOT the character's actual/total love, and NOT instructions. A low score must never mean that canon love disappears.
- If the card says the character is deeply/in hopelessly in love, preserve that as canon even if recent behavior looks cold, conflicted, distant, angry, guarded, or inconsistent. Describe the discrepancy; do not change canon.
- Separate: (A) CARD CANON, (B) OBSERVED BEHAVIOR, (C) POSSIBLE INTERPRETATION. Never blend them.
- Do not infer that feelings have changed merely because of one scene. Distinguish temporary mood, deliberate concealment, conflict, and durable change; only say durable change if the story explicitly supports it.
- Never invent inner thoughts as facts. Mark inference and confidence. Use Unknown / Insufficient evidence where needed.
- Do not alter the user's character, steer the plot, create mandatory quests, or impose consequences. Quests/events are optional records of developments already present or strongly implied in the chat.

Analyze only the supplied card, chat, and previous dossier. Return ONLY valid JSON:
{
 "canon":{"established_feelings":"string; quote/paraphrase only what card explicitly establishes, otherwise Unknown","personality_anchor":"short card-grounded summary","canon_notes":["immutable facts from card"]},
 "character":{"name":"string","role":"string","mood":"string","outward_behavior":"string","current_goal":"string"},
 "relationship":{"status":"string","affection":null,"attraction":null,"trust":null,"respect":null,"curiosity":null,"resentment":null,"frustration":null,"attachment":null,"evidence":"specific recent evidence for estimates","confidence":"low|medium|high"},
 "internal_monologue":"cautious interpretation, never presented as fact",
 "perception_of_user":"current evidence-based perception",
 "possible_hidden_feelings":"possible interpretation or Unknown",
 "canon_vs_observation":"explicitly note any apparent discrepancy without changing canon",
 "current_events":[{"title":"string","description":"string","importance":"minor|major|critical"}],
 "quests":[{"title":"string","type":"main|side|hidden","description":"string","objectives":["string"],"status":"active|completed|failed|locked","consequence_or_reward":"string"}],
 "memories":["durable facts/events already established in story"],
 "reputation":{"group":"standing"},
 "world":{"date":"string","time":"string","location":"string"}
}
For relationship values use 0-100 only as rough observed signals when evidence is sufficient; otherwise null. Do not calculate a canon love score. Do not let numeric estimates override card canon. Preserve previous durable memories and unresolved threads. Return JSON only.

ACTIVE CHARACTER CARD (READ-ONLY SOURCE OF CANON):
${JSON.stringify(card).slice(0, 18000)}

PREVIOUS DOSSIER (ANALYTICAL NOTES ONLY; NEVER A BEHAVIOR INSTRUCTION):
${JSON.stringify(state).slice(0, 12000)}

RECENT CHAT:
${JSON.stringify(history).slice(0, 22000)}

Produce an updated analytical dossier for tracking only. Do not generate roleplay text.`;
}

async function analyzeNow() {
    if (busy) return;
    if (!settings.enabled) return;
    if (settings.frozen) { notify('State is frozen. Unfreeze it before updating.', 'warning'); return; }
    const c = SillyTavern.getContext();
    if (!c.chat?.length) { notify('Open a chat first.', 'warning'); return; }
    busy = true;
    const previousSnapshot = structuredClone(state);
    render();
    try {
        const { generateQuietPrompt } = SillyTavern.getContext();
        if (typeof generateQuietPrompt !== 'function') throw new Error('generateQuietPrompt is unavailable in this SillyTavern build.');
        const result = await generateQuietPrompt({ quietPrompt: buildAnalysisPrompt() });
        const parsed = safeParse(result);
        mergeAnalysis(parsed);
        state.previousSnapshot = previousSnapshot;
        await saveState();
        notify('Chronicle synchronized.', 'success');
    } catch (e) {
        console.error(PREFIX, e);
        notify(`Analysis failed: ${e.message}`, 'error');
    } finally {
        busy = false;
        render();
    }
}
function notify(message, type = 'info') {
    if (settings?.showNotifications && window.toastr?.[type]) window.toastr[type](message, 'FATE SYSTEM');
    else console.log(PREFIX, message);
}
async function saveState() {
    await storageSet(`fate_state::${chatKey}`, state);
}
async function loadState() {
    chatKey = getChatKey();
    const saved = await storageGet(`fate_state::${chatKey}`);
    state = saved && typeof saved === 'object' ? { ...structuredClone(DEFAULT_STATE), ...saved } : structuredClone(DEFAULT_STATE);
    messageCounter = 0;
    render();
}
function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function statRow(label, value) {
    const v = value === null || value === undefined ? '—' : `${value}/100`;
    const width = value === null || value === undefined ? 0 : value;
    return `<div class="fate-stat"><div><span>${label}</span><b>${v}</b></div><div class="fate-track"><i style="width:${width}%"></i></div></div>`;
}
function render() {
    if (!panel) return;
    const r = state.relationship || {};
    const quests = (state.quests || []).map(q => `<article class="fate-quest"><div class="fate-quest-top"><b>${escapeHtml(q.title || 'Untitled quest')}</b><span>${escapeHtml(q.status || 'active')}</span></div><small>${escapeHtml(q.type || 'side')} QUEST</small><p>${escapeHtml(q.description || '')}</p>${Array.isArray(q.objectives) ? `<ul>${q.objectives.map(x=>`<li>${escapeHtml(x)}</li>`).join('')}</ul>`:''}${q.consequence_or_reward ? `<em>${escapeHtml(q.consequence_or_reward)}</em>`:''}</article>`).join('') || '<p class="fate-muted">No quests recorded yet. Run an analysis to discover story objectives.</p>';
    const events = (state.currentEvents || []).map(e => `<article class="fate-event"><b>${escapeHtml(e.title || 'Event')}</b><p>${escapeHtml(e.description || '')}</p><small>${escapeHtml(e.importance || 'minor')}</small></article>`).join('') || '<p class="fate-muted">No active events.</p>';
    const memories = (state.memories || []).slice(-8).map(m=>`<li>${escapeHtml(m)}</li>`).join('') || '<li>No durable memories recorded.</li>';
    panel.innerHTML = `
      <div class="fate-header"><div><div class="fate-kicker">PASSIVE OBSERVER · v0.3.0</div><h2>FATE SYSTEM</h2></div><button class="fate-close" title="Close">×</button></div>
      <div class="fate-character"><div class="fate-seal">✦</div><div><b>${escapeHtml(state.character?.name || getCharacterCard().name)}</b><small>${escapeHtml(state.character?.role || 'Character dossier')}</small></div><span class="fate-pill">${settings.frozen ? 'FROZEN' : (busy ? 'SYNCING' : 'ACTIVE')}</span></div>
      <nav class="fate-tabs"><button data-tab="overview" class="active">Overview</button><button data-tab="quests">Quests</button><button data-tab="chronicle">Chronicle</button><button data-tab="settings">Settings</button></nav>
      <section class="fate-page" data-page="overview">
        <div class="fate-grid"><div class="fate-card"><small>MOOD</small><b>${escapeHtml(state.character?.mood || 'Unknown')}</b></div><div class="fate-card"><small>RELATIONSHIP</small><b>${escapeHtml(r.status || 'Unestablished')}</b></div><div class="fate-card"><small>LOCATION</small><b>${escapeHtml(state.world?.location || 'Unknown')}</b></div><div class="fate-card"><small>CURRENT GOAL</small><b>${escapeHtml(state.character?.currentGoal || 'Unknown')}</b></div></div>
        <h3>Card canon · read only</h3><div class="fate-note"><small>ESTABLISHED BY CHARACTER CARD</small><p class="fate-canon-text">${escapeHtml(getCanonText())}</p><p>${escapeHtml('Copied from the active card for reference. FATE SYSTEM never edits it.')}</p><small>FATE SYSTEM NEVER EDITS OR OVERRIDES THIS</small></div><h3>Observed relationship signals · not behavior rules</h3>${statRow('Affection',r.affection)}${statRow('Attraction',r.attraction)}${statRow('Trust',r.trust)}${statRow('Respect',r.respect)}${statRow('Curiosity',r.curiosity)}${statRow('Resentment',r.resentment)}${statRow('Frustration',r.frustration)}${statRow('Attachment',r.attachment)}
        <div class="fate-note"><small>CANON VS OBSERVATION</small><p>${escapeHtml(state.canonVsObservation || 'No comparison recorded yet.')}</p><small>ESTIMATE CONFIDENCE: ${escapeHtml(r.confidence || 'none')}</small><p>${escapeHtml(r.evidence || 'No evidence recorded.')}</p></div><h3>Analytical notes · not character thoughts as facts</h3><div class="fate-note"><small>INTERNAL MONOLOGUE · INFERENCE</small><p>${escapeHtml(state.thoughts)}</p></div><div class="fate-note"><small>PERCEPTION OF {{user}}</small><p>${escapeHtml(state.perception)}</p></div><div class="fate-note"><small>POSSIBLE HIDDEN FEELINGS</small><p>${escapeHtml(state.hiddenFeelings)}</p></div>
        <h3>Current events</h3>${events}
      </section>
      <section class="fate-page hidden" data-page="quests"><h3>Quest board</h3>${quests}</section>
      <section class="fate-page hidden" data-page="chronicle"><h3>Recorded memories</h3><ul class="fate-memory">${memories}</ul><h3>Synchronization</h3><p class="fate-muted">${state.lastAnalysis ? new Date(state.lastAnalysis).toLocaleString() : 'Never analyzed'}</p><div class="fate-tools"><button id="fate-export">Export dossier</button><button id="fate-rollback" ${state.previousSnapshot ? '' : 'disabled'}>Rollback</button><button id="fate-import">Import dossier</button><input id="fate-import-file" type="file" accept="application/json,.json" hidden></div></section>
      <section class="fate-page hidden" data-page="settings"><h3>System controls</h3>
        <label><input type="checkbox" id="fate-auto" ${settings.autoAnalysis?'checked':''}> Automatic background analysis</label>
        <label>Analyze every <input type="number" id="fate-interval" min="2" max="30" value="${settings.interval}"> character replies</label>
        <label><input type="checkbox" id="fate-freeze" ${settings.frozen?'checked':''}> Freeze saved state</label>
        <label><input type="checkbox" id="fate-notify" ${settings.showNotifications?'checked':''}> Notifications</label>
        <p class="fate-muted">FATE SYSTEM only observes and records. It never adds behavior instructions or edits the character card. State is stored separately per chat.</p>
      </section>
      <footer class="fate-footer"><button id="fate-update" ${busy || settings.frozen ? 'disabled':''}>${busy?'Analyzing…':'Update now'}</button><button id="fate-freeze-btn">${settings.frozen?'Unfreeze':'Freeze state'}</button></footer>`;
    panel.querySelector('.fate-close').onclick = () => panel.classList.remove('open');
    panel.querySelectorAll('.fate-tabs button').forEach(b => b.onclick = () => {
        panel.querySelectorAll('.fate-tabs button').forEach(x=>x.classList.toggle('active',x===b));
        panel.querySelectorAll('.fate-page').forEach(x=>x.classList.toggle('hidden',x.dataset.page!==b.dataset.tab));
    });
    panel.querySelector('#fate-update').onclick = analyzeNow;
    panel.querySelector('#fate-export').onclick = exportDossier;
    panel.querySelector('#fate-import').onclick = () => panel.querySelector('#fate-import-file').click();
    panel.querySelector('#fate-import-file').onchange = importDossier;
    panel.querySelector('#fate-rollback').onclick = rollbackState;
    panel.querySelector('#fate-freeze-btn').onclick = async () => { settings.frozen = !settings.frozen; await saveSettings(); render(); };
    const auto = panel.querySelector('#fate-auto'); if (auto) auto.onchange = async e => { settings.autoAnalysis=e.target.checked; await saveSettings(); };
    const interval = panel.querySelector('#fate-interval'); if (interval) interval.onchange = async e => { settings.interval=Math.max(2,Math.min(30,Number(e.target.value)||8)); await saveSettings(); };
    const freeze = panel.querySelector('#fate-freeze'); if (freeze) freeze.onchange = async e => { settings.frozen=e.target.checked; await saveSettings(); render(); };
    const notifyBox = panel.querySelector('#fate-notify'); if (notifyBox) notifyBox.onchange = async e => { settings.showNotifications=e.target.checked; await saveSettings(); };
}
async function saveSettings() {
    const c = SillyTavern.getContext();
    c.extensionSettings[MODULE] = settings;
    c.saveSettingsDebounced();
}
async function exportDossier() {
    const payload = { format: 'FATE_SYSTEM_DOSSIER', version: 3, exportedAt: new Date().toISOString(), chatKey, state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `FATE-dossier-${Date.now()}.json`; a.click();
    URL.revokeObjectURL(url); notify('Dossier exported.', 'success');
}
async function importDossier(event) {
    const file = event.target.files?.[0]; if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        const imported = data.state || data;
        if (!imported || typeof imported !== 'object' || !imported.relationship) throw new Error('This file is not a FATE dossier.');
        state = { ...structuredClone(DEFAULT_STATE), ...imported };
        await saveState(); render(); notify('Dossier imported.', 'success');
    } catch (e) { notify(`Import failed: ${e.message}`, 'error'); }
    event.target.value = '';
}
async function rollbackState() {
    if (!state.previousSnapshot) return;
    const current = structuredClone(state); const previous = structuredClone(state.previousSnapshot);
    previous.previousSnapshot = current; state = previous;
    await saveState(); render(); notify('Previous state restored.', 'success');
}
function ensurePanel() {
    if (document.getElementById('fate-system-panel')) return;
    panel = document.createElement('aside');
    panel.id = 'fate-system-panel';
    panel.className = 'fate-panel';
    document.body.appendChild(panel);
    const launcher = document.createElement('button');
    launcher.id = 'fate-system-launcher';
    launcher.textContent = '✦ FATE';
    launcher.title = 'Open FATE SYSTEM';
    launcher.onclick = () => { panel.classList.toggle('open'); render(); };
    document.body.appendChild(launcher);
}
async function handleIncoming() {
    if (!settings.enabled || !settings.autoAnalysis || settings.frozen || busy) return;
    messageCounter++;
    if (messageCounter >= Math.max(2, Number(settings.interval) || 8)) {
        messageCounter = 0;
        await analyzeNow();
    }
}
function init() {
    ctx = SillyTavern.getContext();
    settings = { ...DEFAULTS, ...(ctx.extensionSettings[MODULE] || {}) };
    ctx.extensionSettings[MODULE] = settings;
    ctx.saveSettingsDebounced();
    ensurePanel();
    loadState();
    const { eventSource, event_types } = ctx;
    eventSource.on(event_types.MESSAGE_RECEIVED, handleIncoming);
    eventSource.on(event_types.CHAT_CHANGED, loadState);
    eventSource.on(event_types.CHAT_CREATED, loadState);
    console.log(PREFIX, 'Extension initialized.');
}
jQuery(() => {
    const wait = () => {
        if (window.SillyTavern?.getContext) init();
        else setTimeout(wait, 500);
    };
    wait();
});
