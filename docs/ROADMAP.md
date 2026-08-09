# Where The Fool stands, and what to ask for next

Written 8 August 2026, after a session that shipped 2.3.4 → 2.3.9.

This is an honest read of the competition and a list of prompts to hand back.
It is written to be argued with: where a claim is not measured, it says so.

---

## The field

| Harness                    | What it is genuinely best at                                                                                                        | What The Fool has that it does not                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Claude Code**            | Depth on a large codebase. The benchmark everything is judged against.                                                              | Voice. A persistent identity. A GUI. Local models as a first-class path.             |
| **Codex / Gemini CLI**     | Tight loops in a terminal, close to the vendor's model.                                                                             | The same, plus it can _host_ them rather than compete.                               |
| **Cursor / Windsurf**      | Editing. Inline diffs, tab completion, the file you are looking at.                                                                 | Work away from the editor: the whole machine, by voice, while you do something else. |
| **Cline / Roo**            | In-IDE agent with a permission model people trust.                                                                                  | A desktop of its own; not tied to VS Code.                                           |
| **OpenHands**              | Sandboxed autonomy, browser and shell in a container.                                                                               | Runs on the user's real machine, which is the point and the risk.                    |
| **Goose**                  | Extensible local agent, MCP-native, genuinely local-first.                                                                          | Voice, memory, workspaces. Goose is the closest neighbour.                           |
| **Prime Agent** (Aug 2026) | Recursive sub-agents as function calls in a live REPL; a "continual harness" that refines its own prompts and skills with rollback. | A user interface a non-technical person can use at all.                              |

**The honest summary.** On raw coding ability, the agent inside The Fool _is_
one of the above — that is the design, and it is not a weakness. Where The Fool
is alone: **spoken control of a real machine, with local speech, a memory you
can read, and a hard guarantee that it never claims work it did not do.**
Nobody else has that last one, and this session is what it cost to get it.

Where The Fool is behind, plainly:

1. **Sub-agents cannot be watched.** ~~No sub-agents.~~ **This was wrong when it
   was written.** `foolrs-agent/src/spawn_tool.rs` spawns up to five children in
   parallel, each with its own context and up to two hundred turns, and
   `fool-team` is a whole multi-agent system on top with role prompts, a task
   board, a mailbox and a scheduler. The real gap was one line in
   `spawner.rs`: children ran with a `NullSink`, so their output was discarded
   and nobody could watch them work. That was a stream to connect, not a
   subsystem to build — and prompt 4 below, written from the wrong premise,
   would have rebuilt what already exists. **Done.** Children now report
   through a `LabelledSink` onto the parent's own output: each one's tools and
   failures appear under its name, and it is announced when it starts and when
   it finishes. Their prose is not forwarded — it comes back to the parent as
   the tool result, and streaming it as well would put five answers on top of
   the parent's own.
2. **Typed chat is a second-class citizen.** Voice got the skills, the guard,
   the memory rules. The chat window did not.
3. **Nothing is measured.** No turn counts, no prompt sizes, no latency figures
   against a small local model. "Fast" is currently an aspiration.
4. **Setup still asks too much.** The logic to detect agents and gateways
   landed today; the one-click panel it feeds does not exist.
5. **No self-improvement loop.** The memory is written when asked. Nothing
   reviews a finished session and proposes what to keep.

---

## Prompts to hand back, in the order they are worth doing

Each is written to be pasted as-is. They are ordered so that the earlier ones
make the later ones measurable rather than hopeful.

### 1 — Measure before optimising

> Ölç: küçük bir yerel modelle (8 GB VRAM sınıfı) tipik bir istekte kaç tur
> dönüyoruz, prompt kaç token, ilk sese kadar kaç saniye geçiyor, ve toplam ne
> kadar sürüyor. Bunları log'a yaz ve bir ölçüm dokümanı oluştur. Hiçbir şeyi
> optimize etme — sadece gerçek sayıları çıkar. Sonra en pahalı üç şeyi söyle.

Everything about "fast" and "context optimized" is unfalsifiable until this
exists. Do it first.

### 2 — One-click setup panel

> `connectableAgents.ts` ve `localGateways.ts` zaten kararı veriyor. Bunları
> kullanan tek bir kurulum panelini yaz: makinede ne varsa tespit et, her satır
> için tek eylem göster (kullan / giriş yap / kur), OmniRoute ve LM Studio dahil.
> Hiç teknik bilmeyen biri iki tıkla model bağlayabilmeli. Kurulum sırasında
> hiçbir metin kutusuna port ya da URL yazdırma.

### 3 — Typed chat parity

> Yazılı sohbeti sesli sohbetle aynı seviyeye getir: aynı araç seti, aynı
> öğretilmiş beceriler, aynı hafıza ve kurallar, ve aynı "yapmadığını söyleyemez"
> kapısı. Ortak olanı tek yere çıkar; iki ayrı kopya bırakma. Hangi davranışın
> hangi tarafta olmadığını önce listele, sonra kapat.

### 4 — Sub-agents you can watch

**Rewritten**, because the original asked for a system that already exists. See
the correction above.

> Alt-ajanlar zaten var (`foolrs-agent/src/spawn_tool.rs`, beşe kadar paralel,
> her biri 200 tura kadar) ama `spawner.rs` onları `NullSink` ile çalıştırıyor,
> yani çıktıları çöpe gidiyor. Bunu gerçek bir stream'e bağla: her alt-ajanın
> konuşması Claude Code'daki gibi ayrı ayrı izlenebilsin, biri takılırsa
> diğerlerini öldürmesin. Yeni bir alt-ajan sistemi yazma — var olanı görünür
> yap.

### 5 — Spotify, uçtan uca

> `spotifyPlayback.ts` karar mantığı hazır. Üzerine OAuth akışını ve MCP
> sunucusunu yaz: kullanıcı bir kez izin versin, sonra "favori şarkımı çal"
> arkaplanda, odağı çalmadan, mevcut cihazında çalsın. Duraklat/ileri sar da
> çalışsın. Token'ı asla log'a yazma.

### 6 — PDF forms, uçtan uca

> `pdfForm.ts` alan adlarını ve doğrulamayı hallediyor, `pdf-lib` kurulu.
> Belgeyi okuyup dolu kopyayı yazan kısmı main process'te tamamla: sesli olarak
> her alanı sorsun, cevabı yazsın, formda olmayan alana asla yazmasın, ve
> dolmayan alan kaldıysa bunu açıkça söylesin.

### 7 — A session that reviews itself

> Prime Agent'ın `/refine` fikrini al: bir konuşma bittiğinde ne öğrenildiğini
> kanıtıyla önersin, kullanıcı onaylarsa hafızaya yazsın, ve **her yazma geri
> alınabilsin** (snapshot + rollback). Şu an hafızada hiç geri alma yok ve onu
> bir model yazıyor — en riskli kombinasyon bu.

### 8 — Applications, installed for you

> "Şu uygulamayı indir ve kur" isteğini gerçekten yapabilsin. Kaynak beyaz
> listesi olsun, indirilen dosyanın hash'ini göster, ve kurulumdan önce
> kullanıcıdan tek bir açık onay al. Sessizce hiçbir şey kurma.

---

## The one rule to keep

The thing this session actually earned is in `actionClaims.ts`: **the app
cannot tell you it did something it did not do.** Four releases went into it,
including two of my own mistakes, and it works because it is mechanical rather
than a request to the model.

Every feature above should be built so that the same is true of it. If a new
capability can report success without proof, it will — and one such lie undoes
more trust than the feature earns.
