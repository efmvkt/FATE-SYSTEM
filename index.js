// Otome System — окно «Системы» в стиле отомэ-манхв для SillyTavern
// Настроение, чувства, мысли, задания, штрафы, правила, подсказки, дневник.
// Данные хранятся в самом чате (у каждой истории своя Система).

(() => {
    'use strict';

    const EXT = 'ST-OtomeSystem';
    const META = 'otome_system';
    const DEFAULTS = {
        enabled: true,     // расширение включено
        auto: true,        // автообновление
        every: 4,          // раз в сколько ответов персонажа обновлять
        inject: true,      // подмешивать состояние в промпт
        notify: true,      // всплывающие уведомления
        floating: true,    // плавающая кнопка
        fullPreset: false, // обновлять через полный пресет (дороже, экспериментально)
        frozen: false,     // заморозить чувства: задания, события и память продолжают обновляться
        extra: '',         // свои пожелания к Системе
        pos: null,
        theme: 'violet',       // цветовая тема окна
    };

    // ─── helpers ───────────────────────────────────────────────────────────

    const ctx = () => SillyTavern.getContext();
    const esc = s => String(s ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
    const str = v => (typeof v === 'string' ? v.trim() : (v == null ? '' : String(v).trim()));

    function S() {
        const all = ctx().extensionSettings;
        if (!all[EXT]) all[EXT] = {};
        const s = all[EXT];
        for (const k in DEFAULTS) if (s[k] === undefined) s[k] = DEFAULTS[k];
        return s;
    }
    const saveS = () => ctx().saveSettingsDebounced();

    function getState() {
        const md = ctx().chatMetadata;
        return md ? (md[META] || null) : null;
    }
    function setState(st) {
        const c = ctx();
        if (!c.chatMetadata) return;
        if (st) c.chatMetadata[META] = st; else delete c.chatMetadata[META];
        if (typeof c.saveMetadata === 'function') c.saveMetadata();
    }

    // сколько ответов персонажа в чате — «ходы» (устойчиво к свайпам и удалениям)
    const turns = () => ctx().chat.filter(m => m && !m.is_user && !m.is_system).length;

    function toast(msg, type = 'info', force = false) {
        if (!force && !S().notify) return;
        const host = document.getElementById('otm-toast-host') || (() => {
            const el = document.createElement('div'); el.id = 'otm-toast-host'; document.body.appendChild(el); return el;
        })();
        const item = document.createElement('div');
        item.className = `otm-toast ${['success','warning','error'].includes(type) ? type : 'info'}`;
        item.innerHTML = `<span class="otm-toast-mark">${type === 'success' ? '✧' : type === 'warning' ? '⚠' : type === 'error' ? '✕' : '✦'}</span><span><b>Система</b><small>${esc(msg)}</small></span>`;
        host.appendChild(item);
        requestAnimationFrame(() => item.classList.add('show'));
        setTimeout(() => { item.classList.remove('show'); setTimeout(() => item.remove(), 260); }, 3600);
    }

    function applyTheme() {
        const modal = document.getElementById('otm-modal');
        const theme = ['violet','rose','blue','emerald','gold','crimson'].includes(S().theme) ? S().theme : 'violet';
        if (modal) modal.dataset.theme = theme;
    }

    function clean(t) {
        return String(t || '')
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .replace(/\[IB\][\s\S]*?\[\/IB\]/gi, '')
            .replace(/<[^>]+>/g, '')
            .replace(/[ \t]+\n/g, '\n')
            .trim();
    }
    function cut(t, n) {
        t = String(t || '');
        return t.length <= n ? t : t.slice(0, Math.round(n * 0.6)) + ' … ' + t.slice(-Math.round(n * 0.4));
    }
    function recent(n, len) {
        return ctx().chat.filter(m => m && !m.is_system).slice(-n)
            .map(m => `${m.name}: ${cut(clean(m.mes), len)}`).join('\n\n');
    }
    const field = (ch, k) => ch?.[k] ?? ch?.data?.[k] ?? '';

    function extractJson(t) {
        if (!t || typeof t !== 'string') return null;
        t = t.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
        const a = t.indexOf('{'), b = t.lastIndexOf('}');
        if (a < 0 || b <= a) return null;
        const body = t.slice(a, b + 1);
        try { return JSON.parse(body); } catch (e) { /* пробуем починить */ }
        try { return JSON.parse(body.replace(/,\s*([}\]])/g, '$1')); } catch (e) { /* не вышло */ }
        return null;
    }

    // ─── prompts ───────────────────────────────────────────────────────────

    const SCHEMA = `{
  "profile": "<only when creating: 5-7 sentences in Russian — who the character is, the setting, the relationship premise, his/her wounds and secrets. When updating: copy the existing profile>",
  "stage": "<short label of the current relationship stage, e.g. 'Холодное перемирие'>",
  "mood": {"emoji": "<one emoji>", "label": "<2-3 words>"},
  "thought": "<what the character thinks RIGHT NOW, first person, 1-2 short sentences>",
  "shows": "<how the character outwardly behaves, up to 12 words>",
  "hides": "<what the character really feels but hides, up to 12 words>",
  "stats": [{"name": "<Russian name>", "icon": "<emoji>", "value": 0}],
  "quests": [{"id": "q1", "type": "main|plot|relation|side", "title": "", "desc": "<1 sentence>", "reward": "<short>", "penalty": "<short>", "status": "active|done|failed|locked", "deadline": null}],
  "rules": ["<short rule of this story's system>"],
  "choices": ["<short action for the player>"],
  "ending": "<one line: where this route is heading>",
  "events": [{"type": "quest|reward|penalty|event|moment", "level": "<only for penalty: minor|major|critical>", "text": "<one short line>"}],
  "memories": ["<only NEW durable facts: promises, conflicts, insults, gifts, secrets, confessions; max 3, one short line each>"],
  "hook": {"title": "<short>", "text": "<1-2 sentences: an event that could happen next and moves the story>"},
  "diary": "<optional: one private diary line of the character, or empty string>",
  "cg": [{"id":"cg1","title":"<название ключевой сцены>","quote":"<одна короткая цитата из чата>","description":"<краткое описание сцены>","turn":0}],
  "achievements": [{"id":"a1","title":"<название>","description":"<за что получено>","rarity":"common|rare|epic|legendary","unlocked":true}],
  "endings": [{"id":"e1","title":"<название концовки>","type":"good|bad|true|hidden|alternate","status":"locked|hinted|unlocked","hint":"<подсказка без спойлера>","description":"<краткое описание, если открыта>"}],
  "calendar": {"date":"<игровая дата или пусто>","season":"<сезон или пусто>","events":[{"id":"c1","title":"<событие>","date":"<дата>","description":"<кратко>"}]}
}`;

    function compact(st) {
        if (!st) return null;
        const t = turns();
        return {
            stage: st.stage, mood: st.mood, thought: st.thought,
            stats: st.stats.map(x => ({ name: x.name, icon: x.icon, value: x.value })),
            quests: st.quests.map(q => ({
                id: q.id, type: q.type, title: q.title, desc: q.desc, reward: q.reward, penalty: q.penalty,
                status: q.status, deadline: q.dueTurn ? Math.max(0, q.dueTurn - t) : null,
            })),
            rules: st.rules,
            memories: (st.memories || []).slice(0, 8).map(m => m.text),
            cg: (st.cg || []).slice(0, 12),
            achievements: (st.achievements || []).slice(0, 30),
            endings: (st.endings || []).slice(0, 12),
            calendar: st.calendar || { date: '', season: '', events: [] },
        };
    }

    function buildPrompts(old, full, note) {
        const c = ctx();
        const s = S();
        const ch = c.characters?.[c.characterId];
        const cn = c.name2 || field(ch, 'name') || 'Character';
        const un = c.name1 || 'User';

        const system = `You are the hidden "System" of an otome-game-style roleplay (like the status windows in otome / isekai manhwa). You read the story and keep a status window for the character ${cn} and the player's persona ${un}. Reply with ONE valid JSON object only: no markdown, no comments, no text outside the JSON. All text values must be in Russian.`;

        let p = '';
        if (!full) {
            if (old) {
                p += `CHARACTER PROFILE (${cn}): ${old.profile || ''}\n\n`;
            } else {
                p += `CHARACTER CARD (${cn}):\n${cut(field(ch, 'description'), 7000)}\n`;
                const pers = field(ch, 'personality'), scen = field(ch, 'scenario');
                if (pers) p += `Personality: ${cut(pers, 800)}\n`;
                if (scen) p += `Scenario: ${cut(scen, 1200)}\n`;
                p += '\n';
            }
        } else if (old) {
            p += `CHARACTER PROFILE (${cn}): ${old.profile || ''}\n\n`;
        }
        p += `PLAYER PERSONA: ${un}\n`;
        if (s.extra.trim()) p += `PLAYER'S EXTRA WISHES FOR THE SYSTEM: ${s.extra.trim()}\n`;
        p += `\nCURRENT STATE (turn ${turns()}):\n${old ? JSON.stringify(compact(old)) : 'none — create the system from scratch'}\n`;
        if (note) p += `\nNOTE: ${note}\n`;
        p += full ? '\nThe recent chat is the conversation above.\n'
                  : `\nRECENT CHAT:\n${recent(old ? 8 : 6, 1100)}\n`;

        p += `
TASK: ${old ? 'Update' : 'Create'} the status window from the story.
RULES:
- stats: 3-4 meters that fit THIS story and relationship (for example affection, trust, plus 1-2 story-specific ones). Values 0-100. They change gradually (usually 0-8 per update), more only after major events. Keep the same stat names between updates.
- quests: keep ids stable. 3-5 active at once: at least one "main" (story goal), the rest a mix of "plot" (intrigue, family, work, danger, mystery), "relation" (romance, trust) and "side". NOT only romance. Each has a short reward and a short penalty (the consequence of failing, e.g. a drop in a stat). deadline = number of turns left, or null.
- mark a quest "done" only if the chat clearly fulfilled it, "failed" if it clearly failed. Replace finished quests with new ones that grow out of the story.
- when a quest is done: raise the related stat and add an event of type "reward". When a quest failed or a rule was broken by the player: lower the related stat and add an event of type "penalty".
- rules: 2-4 short rules of this story's "system", derived from the setting and the relationship (what the player must or must not do).
- events: only NEW things since the last update, max 4, one short line each.
- thought, shows, hides, mood must reflect the LAST messages. thought is in first person, in the character's voice, without quotation marks. mood.emoji is exactly one emoji.
- choices: 3 short actions the player could take next, first person, no quotation marks.
- judge feelings by ACTIONS, not words: if the character says one thing and does another, do not raise the stat, show the contradiction in "shows" and "hides". A good scene is not an automatic romantic breakthrough, stats may also fall.
- the character has his/her own life: at least one active "plot" quest should be the character's OWN agenda (duty, family, work, politics), independent of the player.
- if the setting has social groups (court, family, army, society), one stat may be the player's reputation among them.
- "locked" quests are hidden teasers: put the unlock condition in desc, switch to "active" only when the story triggers it.
- penalties must follow from what really happened and carry a level in the event: "minor" (mood, small loss), "major" (plot consequence), "critical" (irreversible turn). Never punish merely for ignoring a quest without consequences in the story.
- memories: durable facts worth remembering 100 messages later; never repeat ones already listed.
- hook: one event that could plausibly happen next (a letter, a visit, news, a conflict). It must move the story, not only the romance.
- Do not invent facts that contradict the chat. No meta commentary.
- cg: add only genuinely pivotal scenes clearly present in the chat; preserve existing ids and never duplicate a scene. Save a short exact quote from the chat when possible. Maximum 12 entries; do not invent images or image URLs.
- achievements: unlock only for events explicitly confirmed by the chat; preserve unlocked achievements and stable ids. Hidden achievements stay absent until discovered. Maximum 30 entries.
- endings: track plausible route outcomes from established story evidence. Do not mark an ending unlocked unless the story has actually reached it. Use locked/hinted/unlocked and spoiler-light hints. Do not infer endings from affection values alone. Preserve existing ids; maximum 12.
- calendar: only use dates, seasons, birthdays, balls and other events established by the story. Do not invent a current date; leave date/season empty when unknown. Preserve known upcoming events.

JSON SHAPE:
${SCHEMA}`;
        return { system, prompt: p };
    }

    function variants(fn, objArgs, posArgs) {
        // в новых версиях ST функции принимают объект (fn.length === 0), в старых — позиционные аргументы
        const o = () => fn(objArgs);
        const p = () => fn(...posArgs);
        return fn.length === 0 ? [o, p] : [p, o];
    }

    async function callLLM(system, prompt, full) {
        const c = ctx();
        const LEN = 2500;
        const list = [];
        if (full && typeof c.generateQuietPrompt === 'function') {
            const q = system + '\n\n' + prompt;
            list.push(...variants(c.generateQuietPrompt,
                { quietPrompt: q, skipWIAN: true, responseLength: LEN },
                [q, false, true, null, null, LEN]));
        } else if (typeof c.generateRaw === 'function') {
            list.push(...variants(c.generateRaw,
                { prompt, systemPrompt: system, responseLength: LEN },
                [prompt, null, false, false, system, LEN]));
        }
        for (const f of list) {
            try {
                const r = await f();
                const j = extractJson(typeof r === 'string' ? r : (r?.text || r?.content || ''));
                if (j) return j;
            } catch (e) {
                console.warn(`[${EXT}] generation attempt failed`, e);
            }
        }
        return null;
    }

    // ─── state ─────────────────────────────────────────────────────────────

    const EV_TYPES = ['quest', 'reward', 'penalty', 'event', 'moment'];
    const Q_TYPES = ['main', 'plot', 'relation', 'side'];

    function normalize(raw, old) {
        const t = turns();
        const arr = v => (Array.isArray(v) ? v : []);

        const st = {
            v: 1,
            profile: str(raw.profile) || old?.profile || '',
            stage: str(raw.stage),
            mood: { emoji: str(raw.mood?.emoji) || '😐', label: str(raw.mood?.label) },
            thought: str(raw.thought),
            shows: str(raw.shows),
            hides: str(raw.hides),
            ending: str(raw.ending),
            rules: arr(raw.rules).map(str).filter(Boolean).slice(0, 5),
            choices: arr(raw.choices).map(str).filter(Boolean).slice(0, 4),
            stats: [],
            quests: [],
            log: old?.log ? [...old.log] : [],
            diary: old?.diary ? [...old.diary] : [],
            memories: old?.memories ? [...old.memories] : [],
            hook: null,
            lastTurn: t,
            updatedAt: Date.now(),
        };

        st.stats = arr(raw.stats).slice(0, 5).map(x => {
            const name = str(x?.name);
            const value = clamp(Math.round(Number(x?.value)) || 0, 0, 100);
            const prev = old?.stats?.find(o => o.name.toLowerCase() === name.toLowerCase());
            return { name, icon: str(x?.icon) || '•', value, prev: prev ? prev.value : value };
        }).filter(x => x.name);

        // заморозка: чувства не трогаем, остальное обновляется
        if (S().frozen && old) {
            st.stats = old.stats.map(x => ({ ...x, prev: x.value }));
            st.stage = old.stage; st.mood = old.mood; st.thought = old.thought;
            st.shows = old.shows; st.hides = old.hides;
        }

        const fresh = arr(raw.quests).slice(0, 12).map((q, i) => {
            const id = str(q?.id) || ('q' + (i + 1));
            const o = old?.quests?.find(x => x.id === id);
            const dl = Number(q?.deadline);
            let due = o?.dueTurn ?? null;
            if (!due && Number.isFinite(dl) && dl > 0) due = t + Math.round(dl);
            const status = ['done', 'failed', 'locked'].includes(q?.status) ? q.status : 'active';
            return {
                id, type: Q_TYPES.includes(q?.type) ? q.type : 'side',
                title: str(q?.title), desc: str(q?.desc), reward: str(q?.reward), penalty: str(q?.penalty),
                status, dueTurn: status === 'active' ? due : null,
            };
        }).filter(q => q.title);

        // старые завершённые, которых модель не вернула, сохраняем как историю
        const ids = new Set(fresh.map(q => q.id));
        const isFin = q => q.status === 'done' || q.status === 'failed';
        const history = (old?.quests || []).filter(q => isFin(q) && !ids.has(q.id));
        const active = fresh.filter(q => q.status === 'active').slice(0, 6);
        const locked = fresh.filter(q => q.status === 'locked').slice(0, 3);
        const finished = [...fresh.filter(isFin), ...history].slice(0, 12);
        st.quests = [...active, ...locked, ...finished];

        const events = arr(raw.events).slice(0, 4)
            .map(e => ({ turn: t, type: EV_TYPES.includes(e?.type) ? e.type : 'event', level: ['minor', 'major', 'critical'].includes(e?.level) ? e.level : '', text: str(e?.text) }))
            .filter(e => e.text);
        st.log = [...events, ...st.log].slice(0, 80);

        const d = str(raw.diary);
        if (d) st.diary = [{ turn: t, text: d }, ...st.diary].slice(0, 40);

        const known = new Set(st.memories.map(m => m.text.toLowerCase()));
        for (const m of arr(raw.memories).slice(0, 3).map(str).filter(Boolean)) {
            if (!known.has(m.toLowerCase())) { st.memories.unshift({ turn: t, text: m }); known.add(m.toLowerCase()); }
        }
        st.memories = st.memories.slice(0, 40);
        if (str(raw.hook?.text)) st.hook = { title: str(raw.hook.title) || 'Событие', text: str(raw.hook.text) };

        // Дополнительные игровые коллекции. Существующие записи сохраняются по id.
        const mergeById = (incoming, previous, limit, mapItem) => {
            const prev = Array.isArray(previous) ? previous : [];
            const out = [...prev];
            for (const item of arr(incoming).slice(0, limit)) {
                const mapped = mapItem(item);
                if (!mapped.id || !mapped.title) continue;
                const idx = out.findIndex(x => x.id === mapped.id);
                if (idx >= 0) out[idx] = { ...out[idx], ...mapped };
                else out.unshift(mapped);
            }
            return out.slice(0, limit);
        };
        st.cg = mergeById(raw.cg, old?.cg, 12, x => ({ id: str(x?.id), title: str(x?.title), quote: str(x?.quote), description: str(x?.description), turn: clamp(Math.round(Number(x?.turn) || t), 0, t) }));
        st.achievements = mergeById(raw.achievements, old?.achievements, 30, x => ({ id: str(x?.id), title: str(x?.title), description: str(x?.description), rarity: ['common','rare','epic','legendary'].includes(x?.rarity) ? x.rarity : 'common', unlocked: x?.unlocked === true }));
        st.endings = mergeById(raw.endings, old?.endings, 12, x => ({ id: str(x?.id), title: str(x?.title), type: ['good','bad','true','hidden','alternate'].includes(x?.type) ? x.type : 'alternate', status: ['hinted','unlocked'].includes(x?.status) ? x.status : 'locked', hint: str(x?.hint), description: str(x?.description) }));
        const cal = raw.calendar && typeof raw.calendar === 'object' ? raw.calendar : {};
        st.calendar = { date: str(cal.date) || old?.calendar?.date || '', season: str(cal.season) || old?.calendar?.season || '', events: mergeById(cal.events, old?.calendar?.events, 30, x => ({ id: str(x?.id), title: str(x?.title), date: str(x?.date), description: str(x?.description) })) };

        return { st, events };
    }

    function applyInjection() {
        const c = ctx();
        const s = S();
        const st = getState();
        try {
            if (!s.enabled || !s.inject || !st) {
                c.setExtensionPrompt(EXT, '', 1, 1);
                return;
            }
            const goals = st.quests.filter(q => q.status === 'active').slice(0, 3).map(q => q.title).join('; ');
            const stats = st.stats.map(x => `${x.name} ${x.value}/100`).join(', ');
            const name = c.name2 || 'the character';
            const txt = `[Hidden story state of ${name}. Never mention it, the numbers or any "system" in the text — just let it quietly steer ${name}'s behavior and replies. Relationship stage: ${st.stage}. Mood: ${st.mood.label}. Outwardly: ${st.shows}. Secretly: ${st.hides}. ${stats}. Current goals: ${goals}.]`;
            c.setExtensionPrompt(EXT, txt, 1, 1);
        } catch (e) {
            console.warn(`[${EXT}] inject failed`, e);
        }
    }

    // ─── update ────────────────────────────────────────────────────────────

    let busy = false;
    let unseen = false;

    const snapshot = x => { const c = JSON.parse(JSON.stringify(x)); delete c.prev; return c; };

    async function runUpdate(opts = {}) {
        if (busy) return false;
        const c = ctx();
        if (!c.characters?.[c.characterId]) {
            toast('Откройте чат с персонажем, чтобы создать Систему.', 'warning', true);
            return false;
        }
        busy = true;
        setBusyUI(true);
        try {
            const old = opts.fresh ? null : getState();
            const { system, prompt } = buildPrompts(old, S().fullPreset, opts.note);
            const raw = await callLLM(system, prompt, S().fullPreset);
            if (!raw) {
                toast('Не удалось получить ответ модели. Проверьте API или выключите режим полного пресета.', 'error', true);
                return false;
            }
            const { st, events } = normalize(raw, old);
            const cur = getState();
            st.prev = cur ? snapshot(cur) : null;
            setState(st);
            applyInjection();
            for (const e of events) {
                toast(e.text, e.type === 'penalty' ? 'warning' : (e.type === 'reward' ? 'success' : 'info'));
            }
            if (!isOpen()) { unseen = true; updateFabDot(); }
            render();
            return true;
        } catch (e) {
            console.error(`[${EXT}]`, e);
            toast('Ошибка обновления Системы, подробности в консоли.', 'error', true);
            return false;
        } finally {
            busy = false;
            setBusyUI(false);
        }
    }

    function onMessage() {
        const s = S();
        if (!s.enabled) return;
        const st = getState();
        if (!st) { render(); return; }
        const t = turns();

        // просроченные задания → штраф
        const expired = st.quests.filter(q => q.status === 'active' && q.dueTurn && q.dueTurn <= t);
        let note = '';
        if (expired.length) {
            for (const q of expired) {
                q.status = 'failed';
                q.dueTurn = null;
                st.log.unshift({ turn: t, type: 'penalty', text: `Время вышло: «${q.title}». Штраф: ${q.penalty || '—'}` });
                toast(`Время вышло: «${q.title}». Штраф: ${q.penalty || '—'}`, 'warning');
            }
            note = `The timer just failed these quests: ${expired.map(q => `"${q.title}" (penalty: ${q.penalty})`).join('; ')}. Lower the related stats accordingly, but do NOT add events for them (already logged).`;
            setState(st);
            if (!isOpen()) { unseen = true; updateFabDot(); }
        }

        if (s.auto && (expired.length || t - (st.lastTurn || 0) >= s.every)) {
            setTimeout(() => runUpdate({ note }), 700);
        } else {
            render();
        }
    }

    // ─── UI ────────────────────────────────────────────────────────────────

    let tab = 'status';
    const isOpen = () => { const m = document.getElementById('otm-modal'); return !!m && !m.classList.contains('otm-hidden'); };

    function setBusyUI(v) {
        document.getElementById('otm-modal')?.classList.toggle('otm-busy', v);
        document.getElementById('otm-fab')?.classList.toggle('busy', v);
    }
    function updateFabDot() { document.getElementById('otm-fab')?.classList.toggle('dot', unseen); }

    function emptyView() {
        return `<div class="otm-empty">
            <div class="otm-big">✦</div>
            <div class="otm-etitle">Система не создана</div>
            <div class="otm-edesc">Она прочитает карточку персонажа и вашу историю, заполнит настроение, чувства, мысли и выдаст первые задания.</div>
            <button class="otm-btn otm-primary" data-act="init">✨ Создать Систему</button>
        </div>`;
    }

    function ago(ts) {
        const m = Math.round((Date.now() - ts) / 60000);
        if (m < 1) return 'только что';
        if (m < 60) return `${m} мин назад`;
        const h = Math.round(m / 60);
        return h < 24 ? `${h} ч назад` : `${Math.round(h / 24)} дн назад`;
    }

    function viewStatus(st) {
        if (!st) return emptyView();
        const name = esc(ctx().name2 || 'Персонаж');
        const stats = st.stats.map(x => {
            const d = x.value - x.prev;
            const dh = d ? `<em class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</em>` : '';
            return `<div class="otm-stat">
                <div class="otm-srow"><span>${esc(x.icon)} ${esc(x.name)}</span><b>${x.value}${dh}</b></div>
                <div class="otm-bar"><i style="width:${x.value}%"></i></div>
            </div>`;
        }).join('');
        const choices = st.choices.map((x, i) => `<button class="otm-choice" data-act="choice" data-i="${i}">${esc(x)}</button>`).join('');
        const avatar = characterAvatar();
        return `
            <div class="otm-character-banner">${avatar ? `<img src="${esc(avatar)}" alt="">` : '<span>✦</span>'}<div><b>${name}</b><small>${esc(st.stage || 'История продолжается')}</small></div></div>
            <div class="otm-mood">
                <span class="otm-emoji">${esc(st.mood.emoji)}</span>
                <div><div class="otm-mlabel">${esc(st.mood.label)}</div><div class="otm-stage">${esc(st.stage)}</div></div>
            </div>
            <div class="otm-sec">Чувства</div>
            ${stats}
            <div class="otm-sec">Мысли</div>
            <div class="otm-thought">«${esc(st.thought)}»<small>— ${name}, про себя</small></div>
            <div class="otm-two">
                <div class="otm-mini"><small>Показывает</small>${esc(st.shows)}</div>
                <div class="otm-mini"><small>Скрывает</small>${esc(st.hides)}</div>
            </div>
            ${st.ending ? `<div class="otm-sec">Куда всё идёт</div><div class="otm-ending">${esc(st.ending)}</div>` : ''}
            ${st.hook ? `<div class="otm-sec">Событие от Системы</div><div class="otm-hook"><b>${esc(st.hook.title)}</b><span>${esc(st.hook.text)}</span><button class="otm-btn" data-act="hook">➜ Ввести в сюжет</button></div>` : ''}
            ${choices ? `<div class="otm-sec">Подсказки Системы</div><div class="otm-choices">${choices}</div>` : ''}
            <div class="otm-foot"><span>Обновлено: ${ago(st.updatedAt)}</span><button class="otm-btn" data-act="update">🔄 Обновить</button></div>`;
    }

    const Q_LABEL = { main: 'ГЛАВНОЕ', plot: 'СЮЖЕТ', relation: 'ОТНОШЕНИЯ', side: 'ДОПОЛНИТЕЛЬНО' };

    function viewQuests(st) {
        if (!st) return emptyView();
        const t = turns();
        const active = st.quests.filter(q => q.status === 'active');
        const done = st.quests.filter(q => q.status === 'done' || q.status === 'failed');
        const locked = st.quests.filter(q => q.status === 'locked');
        const card = q => {
            const left = q.dueTurn ? Math.max(0, q.dueTurn - t) : null;
            return `<div class="otm-q otm-${esc(q.type)}">
                <div class="otm-qh"><span class="otm-chip">${Q_LABEL[q.type]}</span>${left !== null ? `<span class="otm-due">⏳ ${left} ход.</span>` : ''}</div>
                <div class="otm-qt">${esc(q.title)}</div>
                <div class="otm-qd">${esc(q.desc)}</div>
                <div class="otm-qr"><span class="gain">🎁 ${esc(q.reward || '—')}</span><span class="loss">⚠ ${esc(q.penalty || '—')}</span></div>
            </div>`;
        };
        return `
            <div class="otm-sec">Активные задания</div>
            ${active.map(card).join('') || '<div class="otm-none">Нет активных заданий</div>'}
            ${locked.length ? `<div class="otm-sec">Скрытые задания</div>${locked.map(q => `<div class="otm-q otm-locked"><div class="otm-qt">🔒 ???</div><div class="otm-qd">Условие: ${esc(q.desc)}</div></div>`).join('')}` : ''}
            ${st.rules.length ? `<div class="otm-sec">Правила Системы</div><ul class="otm-rules">${st.rules.map(r => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
            ${done.length ? `<div class="otm-sec">Завершённые</div>${done.map(q => `<div class="otm-fin ${q.status}">${q.status === 'done' ? '✔' : '✖'} ${esc(q.title)}</div>`).join('')}` : ''}`;
    }

    const LOG_ICON = { reward: '🎁', penalty: '⚠️', quest: '📜', event: '✦', moment: '💫' };
    const LEVEL = { minor: 'МАЛЫЙ ШТРАФ', major: 'СЕРЬЁЗНЫЙ ШТРАФ', critical: 'КРИТИЧЕСКИЙ' };

    function viewLog(st) {
        if (!st) return emptyView();
        if (!st.log.length) return '<div class="otm-none">Пока пусто. События появятся после обновлений.</div>';
        return st.log.slice(0, 50).map(e => `<div class="otm-log ${e.type}"><span>${LOG_ICON[e.type] || '✦'}</span><div>${e.level ? `<b class="otm-lv ${e.level}">${LEVEL[e.level]}</b> ` : ''}${esc(e.text)}<small>ход ${e.turn}</small></div></div>`).join('');
    }

    function viewDiary(st) {
        if (!st) return emptyView();
        const mem = st.memories || [];
        const dia = st.diary || [];
        if (!mem.length && !dia.length) return '<div class="otm-none">Пока пусто. Сюда попадают обещания, конфликты, секреты и личные записи героя.</div>';
        return `${mem.length ? `<div class="otm-sec">Память: обещания, конфликты, секреты</div>${mem.map(e => `<div class="otm-mem">${esc(e.text)}<small>ход ${e.turn}</small></div>`).join('')}` : ''}
            ${dia.length ? `<div class="otm-sec">Дневник героя</div>${dia.map(e => `<div class="otm-dia">${esc(e.text)}<small>ход ${e.turn}</small></div>`).join('')}` : ''}`;
    }

    function characterAvatar() {
        const c = ctx(); const ch = c.characters?.[c.characterId];
        const avatar = field(ch, 'avatar');
        if (!avatar || avatar === 'none') return '';
        try { return typeof getThumbnailUrl === 'function' ? getThumbnailUrl('avatar', avatar) : `/characters/${encodeURIComponent(avatar)}`; }
        catch { return ''; }
    }

    function viewCG(st) {
        if (!st) return emptyView();
        const items = st.cg || [];
        return items.length ? `<div class="otm-gallery">${items.map(x => `<article class="otm-cg"><div class="otm-cg-art">✦</div><b>${esc(x.title)}</b><blockquote>«${esc(x.quote || '…')}»</blockquote><p>${esc(x.description)}</p><small>Ход ${x.turn}</small></article>`).join('')}</div>` : '<div class="otm-none">Здесь появятся важные сцены вашей истории — Система сохранит их после подтверждения в переписке.</div>';
    }
    function viewAchievements(st) {
        if (!st) return emptyView();
        const items = st.achievements || []; const unlocked = items.filter(x => x.unlocked);
        return `<div class="otm-sec">Открыто: ${unlocked.length}</div>${unlocked.length ? unlocked.map(x => `<div class="otm-ach ${esc(x.rarity)}"><span>🏅</span><div><b>${esc(x.title)}</b><small>${esc(x.description)}</small></div><i>${esc(x.rarity)}</i></div>`).join('') : '<div class="otm-none">Пока нет открытых достижений. Скрытые не показываются до обнаружения.</div>'}`;
    }
    function viewEndings(st) {
        if (!st) return emptyView();
        const items = st.endings || [];
        const labels = { good: 'Хорошая', bad: 'Плохая', true: 'Истинная', hidden: 'Скрытая', alternate: 'Альтернативная' };
        return items.length ? items.map(x => `<div class="otm-ending-card ${x.status === 'unlocked' ? 'opened' : ''}"><div><b>${x.status === 'locked' ? '???' : esc(x.title)}</b><span>${labels[x.type] || 'Маршрут'} · ${x.status === 'unlocked' ? 'Открыта' : x.status === 'hinted' ? 'Есть подсказка' : 'Закрыта'}</span></div><p>${x.status === 'unlocked' ? esc(x.description) : esc(x.hint || 'Пока нет подсказок.')}</p></div>`).join('') : '<div class="otm-none">Архив концовок пока пуст. Система будет добавлять маршруты только по мере развития сюжета.</div>';
    }
    function viewCalendar(st) {
        if (!st) return emptyView();
        const cal = st.calendar || {}; const events = cal.events || [];
        return `<div class="otm-calendar-head"><span>📅</span><div><b>${esc(cal.date || 'Дата не установлена')}</b><small>${esc(cal.season || 'Сезон неизвестен')}</small></div></div>${events.length ? events.map(x => `<div class="otm-cal-event"><b>${esc(x.title)}</b><span>${esc(x.date || 'Дата не указана')}</span><p>${esc(x.description)}</p></div>`).join('') : '<div class="otm-none">События календаря появятся, когда даты и праздники будут установлены в истории.</div>'}`;
    }

    function viewSettings() {
        const s = S();
        const cur = getState();
        const chk = (k, label, hint = '') => `<label class="otm-row"><input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}><span>${label}${hint ? `<small>${hint}</small>` : ''}</span></label>`;
        return `
            ${chk('enabled', 'Система включена')}
            ${chk('auto', 'Автообновление', 'Отдельный запрос к модели раз в несколько ответов')}
            <label class="otm-row"><span>Обновлять каждые <input type="number" min="1" max="20" data-set="every" value="${s.every}" class="otm-num"> ответов</span></label>
            ${chk('frozen', 'Заморозить чувства', 'Настроение, показатели и мысли не меняются. Задания, события и память обновляются')}
            ${chk('inject', 'Подмешивать состояние в промпт', 'Персонаж ведёт себя по настроению и чувствам (около 80 токенов)')}
            ${chk('notify', 'Всплывающие уведомления')}
            ${chk('floating', 'Плавающая кнопка на экране')}
            <label class="otm-row otm-theme-row"><span>Цветовая тема<small>Меняет только оформление окна Системы</small></span><select data-set="theme" class="otm-theme-select">${[['violet','Аметист'],['rose','Розовая'],['blue','Сапфир'],['emerald','Изумруд'],['gold','Золото'],['crimson','Рубин']].map(([v,n]) => `<option value="${v}" ${s.theme===v?'selected':''}>${n}</option>`).join('')}</select></label>
            ${chk('fullPreset', 'Обновлять через полный пресет', 'Дороже по токенам, экспериментально. Нужно, если модель отказывается от обновлений без пресета')}
            <div class="otm-sec">Пожелания к Системе</div>
            <textarea class="otm-ta" data-set="extra" rows="3" placeholder="Например: больше интриг, жёстче штрафы, следить за ревностью">${esc(s.extra)}</textarea>
            <div class="otm-foot2">
                <button class="otm-btn" data-act="rollback" ${cur?.prev ? '' : 'disabled'}>↩ Откатить</button>
                <button class="otm-btn" data-act="export" ${cur ? '' : 'disabled'}>⬇ Экспорт</button>
                <button class="otm-btn" data-act="import">⬆ Импорт</button>
                <input type="file" id="otm-file" accept="application/json,.json" hidden>
            </div>
            <div class="otm-foot2">
                <button class="otm-btn" data-act="recreate">♻ Пересоздать</button>
                <button class="otm-btn otm-danger" data-act="wipe">🗑 Стереть данные чата</button>
            </div>`;
    }

    function render() {
        const body = document.getElementById('otm-body');
        if (!body) return;
        const st = getState();
        const views = { status: viewStatus, quests: viewQuests, cg: viewCG, achievements: viewAchievements, endings: viewEndings, calendar: viewCalendar, log: viewLog, diary: viewDiary };
        body.innerHTML = tab === 'settings' ? viewSettings() : (views[tab] || viewStatus)(st);
        document.querySelectorAll('#otm-modal .otm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        const sub = document.getElementById('otm-sub');
        if (sub) sub.textContent = st ? (ctx().name2 || '') : '';
        applyTheme();
    }

    function openPanel() {
        document.getElementById('otm-modal')?.classList.remove('otm-hidden');
        unseen = false;
        updateFabDot();
        render();
    }
    function closePanel() { document.getElementById('otm-modal')?.classList.add('otm-hidden'); }

    function buildModal() {
        if (document.getElementById('otm-modal')) return;
        const m = document.createElement('div');
        m.id = 'otm-modal';
        m.className = 'otm-hidden';
        m.innerHTML = `
            <div class="otm-backdrop" data-act="close"></div>
            <div class="otm-window">
                <div class="otm-head">
                    <div class="otm-title">✦ СИСТЕМА <span id="otm-sub"></span><span class="otm-spin">⏳</span></div>
                    <button class="otm-x" data-act="close">✕</button>
                </div>
                <div class="otm-tabs">
                    <button class="otm-tab" data-tab="status">Статус</button>
                    <button class="otm-tab" data-tab="quests">Задания</button>
                    <button class="otm-tab" data-tab="log">Журнал</button>
                    <button class="otm-tab" data-tab="diary">Память</button>
                    <button class="otm-tab" data-tab="settings">⚙</button>
                </div>
                <div class="otm-body" id="otm-body"></div>
            </div>`;
        document.body.appendChild(m);
        applyTheme();

        m.addEventListener('click', async e => {
            const tabBtn = e.target.closest('[data-tab]');
            if (tabBtn) { tab = tabBtn.dataset.tab; render(); return; }
            const el = e.target.closest('[data-act]');
            if (!el) return;
            const act = el.dataset.act;
            if (act === 'close') closePanel();
            else if (act === 'init' || act === 'update') await runUpdate();
            else if (act === 'choice') {
                const st = getState();
                const text = st?.choices?.[Number(el.dataset.i)];
                const ta = document.getElementById('send_textarea');
                if (text && ta) {
                    ta.value = text;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    closePanel();
                    ta.focus();
                }
            } else if (act === 'hook') {
                const h = getState()?.hook;
                const ta = document.getElementById('send_textarea');
                if (h && ta) {
                    ta.value = h.text;
                    ta.dispatchEvent(new Event('input', { bubbles: true }));
                    closePanel();
                    ta.focus();
                }
            } else if (act === 'rollback') {
                const cur = getState();
                if (cur?.prev) {
                    const restored = JSON.parse(JSON.stringify(cur.prev));
                    restored.prev = snapshot(cur);
                    setState(restored);
                    applyInjection();
                    render();
                    toast('Предыдущее состояние восстановлено', 'success', true);
                }
            } else if (act === 'export') {
                const blob = new Blob([JSON.stringify({ format: 'OTOME_SYSTEM', v: 1, state: getState() }, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `otome-system-${Date.now()}.json`; a.click();
                URL.revokeObjectURL(url);
            } else if (act === 'import') {
                document.getElementById('otm-file')?.click();
            } else if (act === 'recreate') {
                if (confirm('Пересоздать Систему с нуля? Журнал и дневник этого чата будут стёрты.')) {
                    await runUpdate({ fresh: true });
                }
            } else if (act === 'wipe') {
                if (confirm('Удалить все данные Системы в этом чате?')) {
                    setState(null);
                    applyInjection();
                    render();
                }
            }
        });

        m.addEventListener('change', async e => {
            if (e.target.id === 'otm-file') {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                    const data = JSON.parse(await f.text());
                    const st = data.state || data;
                    if (!st || !Array.isArray(st.stats) || !Array.isArray(st.quests)) throw new Error('это не файл Системы');
                    st.prev = null;
                    setState(st);
                    applyInjection();
                    render();
                    toast('Состояние импортировано', 'success', true);
                } catch (err) {
                    toast('Не удалось импортировать: ' + err.message, 'error', true);
                }
                e.target.value = '';
                return;
            }
            const el = e.target.closest('[data-set]');
            if (!el) return;
            const s = S();
            const k = el.dataset.set;
            if (el.type === 'checkbox') s[k] = el.checked;
            else if (el.type === 'number') s[k] = clamp(Math.round(Number(el.value)) || DEFAULTS[k], 1, 20);
            else s[k] = el.value;
            saveS();
            applyFloating();
            applyTheme();
            applyInjection();
        });
    }

    // ─── кнопки запуска ────────────────────────────────────────────────────

    function injectMenuItem() {
        if (document.getElementById('otm-menu-item')) return;
        const menu = document.getElementById('extensionsMenu');
        if (!menu) return;
        const item = document.createElement('div');
        item.id = 'otm-menu-item';
        item.className = 'list-group-item flex-container flexGap5';
        item.innerHTML = '<div class="fa-solid fa-wand-sparkles extensionsMenuExtensionButton"></div><span>Система</span>';
        item.addEventListener('click', openPanel);
        menu.appendChild(item);
    }

    function applyFloating() {
        const s = S();
        let fab = document.getElementById('otm-fab');
        if (!s.floating || !s.enabled) { fab?.remove(); return; }
        if (fab) return;

        const SIZE = 46;
        fab = document.createElement('div');
        fab.id = 'otm-fab';
        fab.className = 'otm-fab';
        fab.title = 'Система';
        fab.textContent = '✦';
        document.body.appendChild(fab);

        const place = (x, y) => {
            fab.style.left = clamp(x, 0, window.innerWidth - SIZE) + 'px';
            fab.style.top = clamp(y, 0, window.innerHeight - SIZE) + 'px';
        };
        const pos = s.pos || { x: window.innerWidth - SIZE - 12, y: window.innerHeight - 230 };
        place(pos.x, pos.y);
        window.addEventListener('resize', () => place(fab.offsetLeft, fab.offsetTop));
        updateFabDot();

        let drag = null;
        fab.addEventListener('pointerdown', e => {
            drag = { sx: e.clientX, sy: e.clientY, bx: fab.offsetLeft, by: fab.offsetTop, moved: false };
            fab.setPointerCapture(e.pointerId);
        });
        fab.addEventListener('pointermove', e => {
            if (!drag) return;
            const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
            if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
            if (drag.moved) place(drag.bx + dx, drag.by + dy);
        });
        fab.addEventListener('pointerup', () => {
            if (!drag) return;
            if (drag.moved) { S().pos = { x: fab.offsetLeft, y: fab.offsetTop }; saveS(); }
            else openPanel();
            drag = null;
        });
        fab.addEventListener('pointercancel', () => { drag = null; });
    }

    // ─── init ──────────────────────────────────────────────────────────────

    if (globalThis.__OTOME_TEST__) {
        Object.assign(globalThis.__OTOME_TEST__, { extractJson, normalize, buildPrompts, compact, cut, clean });
    }

    jQuery(async () => {
        const { eventSource, event_types } = ctx();
        buildModal();
        injectMenuItem();
        applyFloating();
        applyInjection();

        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessage);
        eventSource.on(event_types.CHAT_CHANGED, () => {
            unseen = false;
            updateFabDot();
            applyInjection();
            render();
        });
        console.log(`[${EXT}] loaded`);
    });
})();
