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
        theme: 'pink',     // pink | lavender | wine | auto
        cute: true,        // милые всплывающие окна
        mAch: true,        // достижения
        mEnd: true,        // архив концовок
        mCal: true,        // календарь и события
        extra: '',         // свои пожелания к Системе
        pos: null,
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
        if (typeof toastr === 'undefined') return;
        if (!force && !S().notify) return;
        toastr[type](msg, '✦ Система');
    }

    // ─── милые всплывающие окна (как уведомления в манхве) ────────────────

    const POP = {
        quest: ['📜', 'Задание'], reward: ['🎁', 'Награда'], penalty: ['⚠️', 'Штраф'], ach: ['🏆', 'Достижение'],
        event: ['✦', 'Событие'], stage: ['💞', 'Этап отношений'], news: ['📰', 'Газета'], stat: ['💗', 'Чувства'],
    };
    const LEVEL_TITLE = { minor: 'Малый штраф', major: 'Серьёзный штраф', critical: 'Критическое последствие' };

    function popup(kind, text, title) {
        if (!S().notify) return;
        const [icon, def] = POP[kind] || POP.event;
        if (!S().cute) { toast(`${title || def}: ${text}`, kind === 'penalty' ? 'warning' : 'info'); return; }
        let box = document.getElementById('otm-popups');
        if (!box) {
            box = document.createElement('div');
            box.id = 'otm-popups';
            document.body.appendChild(box);
        }
        const el = document.createElement('div');
        el.className = `otm-pop otm-pop-${kind}`;
        el.innerHTML = `<span class="otm-pop-ic">${icon}</span><div class="otm-pop-tx"><b>${esc(title || def)}</b><span>${esc(text)}</span></div><i class="otm-spark">✧</i><i class="otm-spark s2">✦</i>`;
        el.addEventListener('click', () => el.remove());
        box.appendChild(el);
        setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 450); }, 5000);
        while (box.children.length > 4) box.firstChild.remove();
    }

    // что показать после обновления: сравниваем старое состояние с новым
    function announce(old, st, events, fresh) {
        if (!old) { popup('stage', st.stage || 'Система создана', 'Система запущена ✦'); return; }
        const out = [];
        const oldQ = new Map(old.quests.map(q => [q.id, q]));
        for (const q of st.quests) {
            const o = oldQ.get(q.id);
            if (!o && q.status === 'active') out.push(['quest', `«${q.title}»`, 'Новое задание!']);
            else if (o && o.status === 'locked' && q.status === 'active') out.push(['quest', `«${q.title}»`, 'Скрытое задание открыто!']);
            else if (o && o.status === 'active' && q.status === 'done') out.push(['reward', `«${q.title}»${q.reward ? ' — ' + q.reward : ''}`, 'Задание выполнено!']);
            else if (o && o.status === 'active' && q.status === 'failed') out.push(['penalty', `«${q.title}»${q.penalty ? ' — ' + q.penalty : ''}`, 'Задание провалено']);
        }
        if (st.stage && old.stage && st.stage !== old.stage) out.push(['stage', st.stage, 'Этап отношений изменился']);
        st.stats.filter(x => Math.abs(x.value - x.prev) >= 6).slice(0, 2).forEach(x => {
            const d = x.value - x.prev;
            out.push(['stat', `${x.icon} ${x.name} ${d > 0 ? '+' : ''}${d}`, d > 0 ? 'Чувства растут' : 'Чувства остывают']);
        });
        for (const e of events) if (e.type === 'penalty') out.push(['penalty', e.text, LEVEL_TITLE[e.level] || 'Штраф']);
        (fresh?.ach || []).forEach(a => out.push(['ach', `${a.icon} ${a.title}`, 'Достижение получено!']));
        if (st.hook && st.hook.title !== old.hook?.title) out.push(['event', st.hook.title, 'Новое событие']);
        out.slice(0, 5).forEach(([k, text, title], i) => setTimeout(() => popup(k, text, title), i * 450));
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

    const SCHEMA_BASE = `{
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
  "diary": "<optional: one private diary line of the character, or empty string>"@@EXTRA@@
}`;

    function buildSchema() {
        const s = S();
        let extra = '';
        if (s.mAch) extra += `,
  "achievements": [{"icon": "<emoji>", "title": "<short>", "desc": "<short>"}]`;
        if (s.mEnd) extra += `,
  "endings": [{"id": "e1", "kind": "good|neutral|bad|true", "title": "", "hint": "<what has to happen>", "progress": 0, "revealed": true}]`;
        if (s.mCal) extra += `,
  "calendar": {"date": "<in-story date from the chat, or Unknown>", "season": "<season or Unknown>", "upcoming": [{"title": "", "when": "<date or 'через N дней'>", "note": "<short>", "source": "story|suggested"}]}`;
        return SCHEMA_BASE.replace('@@EXTRA@@', extra);
    }

    function moduleRules() {
        const s = S();
        let r = '';
        if (s.mAch) r += `- achievements: only NEW ones clearly earned in the recent chat (a first fight, a confession, a revealed secret, a kept promise...). Usually zero, max 2. Never repeat existing ones.
`;
        if (s.mEnd) r += `- endings: 3-5 possible story directions (tendencies, not scripts; do not spoil). Keep ids stable. progress 0-100 = how close the story is to each right now. A "true" ending stays revealed=false until the story has clearly opened it. Set "ending" to the one-line direction of the leading route.
`;
        if (s.mCal) r += `- calendar: up to 5 upcoming dated events: those already mentioned in the chat or card (source "story") and at most 2 plausible seasonal or social ones for this world (source "suggested": a ball, a holiday, a birthday, a departure). Use the in-story date from the chat.
`;
        return r;
    }

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
            ...(S().mAch ? { achievements: (st.achievements || []).slice(0, 12).map(a => a.title) } : {}),
            ...(S().mEnd ? { endings: (st.endings || []).map(e => ({ id: e.id, kind: e.kind, title: e.title, progress: e.progress, revealed: e.revealed })) } : {}),
            ...(S().mCal ? { calendar: st.calendar || null } : {}),
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
${moduleRules()}- Do not invent facts that contradict the chat. No meta commentary.

JSON SHAPE:
${buildSchema()}`;
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
            achievements: old?.achievements ? [...old.achievements] : [],
            endings: old?.endings || [],
            calendar: old?.calendar || null,
            papers: old?.papers || [],
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

        const fresh2 = { ach: [] };
        if (S().mAch) {
            const haveA = new Set(st.achievements.map(a => a.title.toLowerCase()));
            for (const a of arr(raw.achievements).slice(0, 2)) {
                const title = str(a?.title);
                if (!title || haveA.has(title.toLowerCase())) continue;
                const item = { turn: t, icon: str(a?.icon) || '🏆', title, desc: str(a?.desc) };
                st.achievements.unshift(item);
                fresh2.ach.push(item);
                haveA.add(title.toLowerCase());
            }
            st.achievements = st.achievements.slice(0, 60);
        }
        if (S().mEnd && Array.isArray(raw.endings) && raw.endings.length) {
            st.endings = raw.endings.slice(0, 5).map((e, i) => ({
                id: str(e?.id) || ('e' + (i + 1)),
                kind: ['good', 'neutral', 'bad', 'true'].includes(e?.kind) ? e.kind : 'neutral',
                title: str(e?.title), hint: str(e?.hint),
                progress: clamp(Math.round(Number(e?.progress)) || 0, 0, 100),
                revealed: e?.revealed !== false,
            })).filter(e => e.title);
        }
        if (S().mCal && raw.calendar && typeof raw.calendar === 'object') {
            st.calendar = {
                date: str(raw.calendar.date), season: str(raw.calendar.season),
                upcoming: arr(raw.calendar.upcoming).slice(0, 5).map(u => ({
                    title: str(u?.title), when: str(u?.when), note: str(u?.note),
                    source: u?.source === 'suggested' ? 'suggested' : 'story',
                })).filter(u => u.title),
            };
        }

        return { st, events, fresh: fresh2 };
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
            const up = (s.mCal && st.calendar?.upcoming?.length) ? ` Upcoming events: ${st.calendar.upcoming.slice(0, 2).map(u => `${u.title} (${u.when})`).join('; ')}.` : '';
            const txt = `[Hidden story state of ${name}. Never mention it, the numbers or any "system" in the text — just let it quietly steer ${name}'s behavior and replies. Relationship stage: ${st.stage}. Mood: ${st.mood.label}. Outwardly: ${st.shows}. Secretly: ${st.hides}. ${stats}. Current goals: ${goals}.${up}]`;
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
            const { st, events, fresh } = normalize(raw, old);
            const cur = getState();
            st.prev = cur ? snapshot(cur) : null;
            setState(st);
            applyInjection();
            announce(old, st, events, fresh);
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

    function buildPaperPrompts(st, full) {
        const c = ctx();
        const cn = c.name2 || 'Character';
        const un = c.name1 || 'User';
        const system = `You are the editor of the gossip newspaper of this story's world. You write the latest issue. Reply with ONE valid JSON object only: no markdown, no text outside the JSON. All text values in Russian.`;
        const prevTitles = (st.papers || []).slice(0, 2).flatMap(p => p.headlines.map(h => h.title)).join(' | ');
        let p = `CHARACTER PROFILE (${cn}): ${st.profile || ''}\n`;
        p += `PLAYER PERSONA: ${un}\nRELATIONSHIP STAGE: ${st.stage}\n`;
        if (st.calendar?.date) p += `IN-STORY DATE: ${st.calendar.date}${st.calendar.season ? ', ' + st.calendar.season : ''}\n`;
        p += `ACTIVE PLOT THREADS: ${st.quests.filter(q => q.status === 'active').map(q => q.title).join('; ') || 'none'}\n`;
        if (prevTitles) p += `ALREADY PRINTED (do not repeat): ${prevTitles}\n`;
        if (S().extra.trim()) p += `PLAYER'S WISHES: ${S().extra.trim()}\n`;
        p += full ? '\nThe recent chat is the conversation above.\n' : `\nRECENT CHAT:\n${recent(6, 900)}\n`;
        p += `
TASK: write a new issue of the gossip paper.
RULES:
- 5-6 items. At least 3 are about the wider world and have NOTHING to do with the protagonists: politics, borders and war, the economy, weather, crime, fashion, culture, other noble houses or other circles of this setting.
- 1-2 items are gossip about ${un} and ${cn}, based ONLY on what could plausibly have been witnessed in the recent chat. Gossip may be exaggerated or distorted (truth "rumor" or "scandal"); world news is "fact".
- Everything must fit the setting and not contradict the chat or the profile. The paper's name, tone and sections must feel native to this world.
- Short: each text is 1-3 sentences. End with one tiny funny classified ad. Nothing explicit.

JSON SHAPE:
{"paper": "<name of the newspaper>", "date": "<date of the issue in the world's style or empty>", "headlines": [{"section": "<section name>", "title": "<headline>", "text": "<1-3 sentences>", "truth": "fact|rumor|scandal"}], "ad": "<classified ad>"}`;
        return { system, prompt: p };
    }

    async function runPaper() {
        if (busy) return;
        const st = getState();
        if (!st) return;
        busy = true;
        setBusyUI(true);
        try {
            const { system, prompt } = buildPaperPrompts(st, S().fullPreset);
            const raw = await callLLM(system, prompt, S().fullPreset);
            if (!raw || !Array.isArray(raw.headlines) || !raw.headlines.length) {
                toast('Газета не вышла: модель не вернула номер. Попробуйте ещё раз.', 'error', true);
                return;
            }
            const issue = {
                turn: turns(), paper: str(raw.paper), date: str(raw.date), ad: str(raw.ad),
                headlines: raw.headlines.slice(0, 7).map(h => ({
                    section: str(h?.section) || 'Новости', title: str(h?.title), text: str(h?.text),
                    truth: ['fact', 'rumor', 'scandal'].includes(h?.truth) ? h.truth : 'rumor',
                })).filter(h => h.title),
            };
            const cur = getState() || st;
            cur.papers = [issue, ...(cur.papers || [])].slice(0, 6);
            setState(cur);
            paperIdx = 0;
            popup('news', issue.paper || 'Свежий номер', 'Вышел свежий номер!');
            render();
        } catch (e) {
            console.error(`[${EXT}]`, e);
            toast('Ошибка выпуска газеты, подробности в консоли.', 'error', true);
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
                popup('penalty', `Время вышло: «${q.title}». Штраф: ${q.penalty || '—'}`, 'Задание просрочено');
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

    function portrait() {
        const c = ctx();
        const ch = c.characters?.[c.characterId];
        if (!ch?.avatar) return '<div class="otm-portrait-wrap"><span class="otm-noimg">✦</span></div>';
        let url = `/thumbnail?type=avatar&file=${encodeURIComponent(ch.avatar)}`;
        try { if (typeof c.getThumbnailUrl === 'function') url = c.getThumbnailUrl('avatar', ch.avatar) || url; } catch (e) { /* запасной адрес */ }
        return `<div class="otm-portrait-wrap"><span class="otm-noimg">✦</span><img class="otm-portrait" src="${esc(url)}" alt="" onerror="this.remove()"></div>`;
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
        return `
            <div class="otm-mood">
                ${portrait()}
                <div class="otm-mtext"><div class="otm-cname">${name}</div><div class="otm-mlabel">${esc(st.mood.emoji)} ${esc(st.mood.label)}</div><div class="otm-stage">${esc(st.stage)}</div></div>
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

    function section(title) { return `<div class="otm-sec">${title}</div>`; }

    function viewLog(st) {
        if (!st) return emptyView();
        const ev = st.log.slice(0, 30).map(e => `<div class="otm-log ${e.type}"><span>${LOG_ICON[e.type] || '✦'}</span><div>${e.level ? `<b class="otm-lv ${e.level}">${LEVEL[e.level]}</b> ` : ''}${esc(e.text)}<small>ход ${e.turn}</small></div></div>`).join('');
        const mem = (st.memories || []).slice(0, 15).map(e => `<div class="otm-mem">${esc(e.text)}<small>ход ${e.turn}</small></div>`).join('');
        const dia = (st.diary || []).slice(0, 10).map(e => `<div class="otm-dia">${esc(e.text)}<small>ход ${e.turn}</small></div>`).join('');
        return `${section('События')}${ev || '<div class="otm-none">Пока пусто</div>'}${mem ? section('Память: обещания, конфликты, секреты') + mem : ''}${dia ? section('Дневник героя') + dia : ''}`;
    }

    // последняя строка локации из инфоблока [IB] в чате: дата, время, место, погода (бесплатно, без запросов)
    function lastIB() {
        const chat = ctx().chat || [];
        for (let i = chat.length - 1; i >= Math.max(0, chat.length - 8); i--) {
            const m = chat[i];
            if (!m || m.is_user) continue;
            const mm = String(m.mes || '').match(/\[IB\]([\s\S]*?)\[\/IB\]/i);
            if (!mm) continue;
            const line = mm[1].split('\n').map(x => x.trim()).find(x => /^L:/i.test(x));
            if (line) {
                const p = line.slice(2).split('|').map(x => x.trim());
                return { loc: p[0] || '', date: p[1] || '', time: p[2] || '', weather: p[3] || '' };
            }
        }
        return null;
    }

    function seasonOf(date, fallback) {
        const m = String(date || '').match(/\b(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})\b/);
        if (m) {
            const mon = Number(m[2]);
            if (mon === 12 || (mon >= 1 && mon <= 2)) return ['❄️', 'Зима'];
            if (mon >= 3 && mon <= 5) return ['🌸', 'Весна'];
            if (mon >= 6 && mon <= 8) return ['☀️', 'Лето'];
            if (mon >= 9 && mon <= 11) return ['🍂', 'Осень'];
        }
        const f = String(fallback || '');
        if (/зим|winter/i.test(f)) return ['❄️', 'Зима'];
        if (/весн|spring/i.test(f)) return ['🌸', 'Весна'];
        if (/лет[оа]|summer/i.test(f)) return ['☀️', 'Лето'];
        if (/осен|autumn|fall/i.test(f)) return ['🍂', 'Осень'];
        return ['✦', ''];
    }

    function viewCalendar(st) {
        if (!st) return emptyView();
        const ib = lastIB();
        const cal = st.calendar || {};
        const date = ib?.date || cal.date || '';
        const [se, sn] = seasonOf(date, cal.season);
        const sub = [sn, ib?.time, ib?.loc, ib?.weather].filter(Boolean).map(esc).join(' · ');
        const up = (cal.upcoming || []).map(u => `<div class="otm-ev"><span class="otm-evw">${esc(u.when)}</span><div><b>${esc(u.title)}</b>${u.note ? `<small>${esc(u.note)}</small>` : ''}</div><i class="otm-src ${u.source}">${u.source === 'suggested' ? 'идея' : 'сюжет'}</i></div>`).join('');
        return `<div class="otm-cal"><div class="otm-season">${se}</div><div><div class="otm-date">${esc(date || 'Дата неизвестна')}</div><div class="otm-calsub">${sub}</div></div></div>
            ${section('Ближайшие события')}${up || '<div class="otm-none">Событий пока нет. Они появятся после обновления Системы.</div>'}
            <div class="otm-hint">Дата, время и место берутся из инфоблока последнего ответа.</div>`;
    }

    let paperIdx = 0;
    const TRUTH = { fact: 'ФАКТ', rumor: 'СЛУХ', scandal: 'СКАНДАЛ' };

    function viewNews(st) {
        if (!st) return emptyView();
        const papers = st.papers || [];
        const btn = '<button class="otm-btn otm-primary" data-act="paper">📰 Выпустить свежий номер</button>';
        if (!papers.length) {
            return `<div class="otm-empty"><div class="otm-big">📰</div><div class="otm-etitle">Сплетник</div><div class="otm-edesc">Газета этого мира: новости двора, армии и города плюс слухи о вас. Выходит только по вашему запросу.</div>${btn}</div>`;
        }
        paperIdx = Math.min(Math.max(0, paperIdx), papers.length - 1);
        const p = papers[paperIdx];
        const items = p.headlines.map((h, j) => `<article class="otm-news ${esc(h.truth)}">
            <div class="otm-nh"><span class="otm-sectag">${esc(h.section)}</span><span class="otm-truth ${esc(h.truth)}">${TRUTH[h.truth] || 'СЛУХ'}</span></div>
            <h4>${esc(h.title)}</h4><p>${esc(h.text)}</p>
            <button class="otm-mini-btn" data-act="news" data-i="${paperIdx}" data-j="${j}">➜ в сюжет</button></article>`).join('');
        return `<div class="otm-paper">
            <div class="otm-mast">${esc(p.paper || 'Вестник')}</div>
            <div class="otm-issue">${esc(p.date || '')}${p.date ? ' · ' : ''}ход ${p.turn}</div>
            ${items}${p.ad ? `<div class="otm-ad">${esc(p.ad)}</div>` : ''}
            </div>
            <div class="otm-pager"><button class="otm-mini-btn" data-act="pprev" ${paperIdx >= papers.length - 1 ? 'disabled' : ''}>‹ раньше</button><span>${paperIdx + 1} / ${papers.length}</span><button class="otm-mini-btn" data-act="pnext" ${paperIdx <= 0 ? 'disabled' : ''}>новее ›</button></div>
            <div class="otm-foot2">${btn}</div>`;
    }

    function viewCollection(st) {
        if (!st) return emptyView();
        const achs = st.achievements || [];
        const ach = achs.map(a => `<div class="otm-ach"><span>${esc(a.icon)}</span><div><b>${esc(a.title)}</b><small>${esc(a.desc)} · ход ${a.turn}</small></div></div>`).join('');
        return `${section(`Достижения · ${achs.length}`)}${ach || '<div class="otm-none">Пока ни одного. Всё впереди ✦</div>'}`;
    }

    const KIND = { good: 'ХОРОШАЯ', neutral: 'НЕЙТРАЛЬНАЯ', bad: 'ПЛОХАЯ', true: 'ИСТИННАЯ' };

    function viewEndings(st) {
        if (!st) return emptyView();
        const list = [...(st.endings || [])].sort((a, b) => b.progress - a.progress);
        if (!list.length) return `<div class="otm-none">${st.ending ? esc(st.ending) : 'Направления появятся после обновления Системы.'}</div>`;
        return list.map(e => e.revealed
            ? `<div class="otm-end ${e.kind}"><div class="otm-qh"><span class="otm-chip">${KIND[e.kind]}</span><span class="otm-due">${e.progress}%</span></div><div class="otm-qt">${esc(e.title)}</div><div class="otm-qd">${esc(e.hint)}</div><div class="otm-bar"><i style="width:${e.progress}%"></i></div></div>`
            : `<div class="otm-end otm-locked"><div class="otm-qh"><span class="otm-chip">${KIND[e.kind]}</span></div><div class="otm-qt">🔒 ???</div><div class="otm-qd">Эта концовка ещё не открыта</div></div>`).join('')
            + '<div class="otm-hint">Это тенденции, а не жёсткие сценарии: история может свернуть куда угодно.</div>';
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
            <label class="otm-row otm-sel"><span>Тема окна</span><select data-set="theme" class="otm-select">${[['pink', 'Розовая'], ['lavender', 'Лавандовая'], ['wine', 'Винная'], ['auto', 'От темы ST']].map(([v, l]) => `<option value="${v}" ${s.theme === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
            ${chk('cute', 'Милые всплывающие окна', 'Как уведомления в манхве. Выключите, чтобы получать обычные окна таверны')}
            ${chk('mAch', 'Достижения', 'Входят в обновления, добавляют немного токенов')}
            ${chk('mEnd', 'Архив концовок')}
            ${chk('mCal', 'Календарь и события')}
            ${chk('inject', 'Подмешивать состояние в промпт', 'Персонаж ведёт себя по настроению и чувствам (около 80 токенов)')}
            ${chk('notify', 'Всплывающие уведомления')}
            ${chk('floating', 'Плавающая кнопка на экране')}
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
        const views = { status: viewStatus, quests: viewQuests, calendar: viewCalendar, news: viewNews, collection: viewCollection, endings: viewEndings, log: viewLog };
        body.innerHTML = tab === 'settings' ? viewSettings() : views[tab](st);
        document.querySelectorAll('#otm-modal .otm-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
        const sub = document.getElementById('otm-sub');
        if (sub) sub.textContent = st ? (ctx().name2 || '') : '';
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
                    <div class="otm-title">✦ СИСТЕМА ♡ <span id="otm-sub"></span><span class="otm-spin">⏳</span></div>
                    <button class="otm-x" data-act="close">✕</button>
                </div>
                <div class="otm-tabs">
                    <button class="otm-tab" data-tab="status">Статус</button>
                    <button class="otm-tab" data-tab="quests">Задания</button>
                    <button class="otm-tab" data-tab="calendar">Календарь</button>
                    <button class="otm-tab" data-tab="news">Газета</button>
                    <button class="otm-tab" data-tab="collection">Достижения</button>
                    <button class="otm-tab" data-tab="endings">Концовки</button>
                    <button class="otm-tab" data-tab="log">Журнал</button>
                    <button class="otm-tab" data-tab="settings">⚙</button>
                </div>
                <div class="otm-body" id="otm-body"></div>
            </div>`;
        document.body.appendChild(m);

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
            } else if (act === 'paper') {
                await runPaper();
            } else if (act === 'pprev') {
                paperIdx++;
                render();
            } else if (act === 'pnext') {
                paperIdx = Math.max(0, paperIdx - 1);
                render();
            } else if (act === 'news') {
                const pp = getState()?.papers?.[Number(el.dataset.i)];
                const h = pp?.headlines?.[Number(el.dataset.j)];
                const ta = document.getElementById('send_textarea');
                if (h && ta) {
                    ta.value = `Я читаю «${pp.paper || 'газету'}»: ${h.title}. ${h.text}`;
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
            applyTheme();
            applyFloating();
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

    function applyTheme() {
        document.documentElement.dataset.otmTheme = S().theme || 'pink';
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
        Object.assign(globalThis.__OTOME_TEST__, { extractJson, normalize, buildPrompts, compact, cut, clean, seasonOf, lastIB, buildPaperPrompts, announce, views: { status: viewStatus, quests: viewQuests, calendar: viewCalendar, news: viewNews, collection: viewCollection, endings: viewEndings, log: viewLog, settings: viewSettings } });
    }

    jQuery(async () => {
        const { eventSource, event_types } = ctx();
        applyTheme();
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
