import { useState, useEffect, useRef, useCallback } from "react";
// ─── Config ───────────────────────────────────────────────────────────────────
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";
const CLAUDE_MODEL = "claude-sonnet-4-20250514";
const GOOGLE_CLIENT_ID = ""; // Set your Google OAuth Client ID here (e.g. "xxx.apps.googleusercontent.com")
// ─── Supabase client ──────────────────────────────────────────────────────────
function createSupabaseClient(url, key) {
  if (!url || !key) return null;
  const h = { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` };
  return {
    async upsert(table, data) {
      const r = await fetch(`${url}/rest/v1/${table}`, { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates" }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error(await r.text());
      return r.json().catch(() => data);
    },
    async select(table, filter = "") {
      const r = await fetch(`${url}/rest/v1/${table}?${filter}`, { headers: h });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    async insert(table, data) {
      const r = await fetch(`${url}/rest/v1/${table}`, { method: "POST", headers: { ...h, Prefer: "return=representation" }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
  };
}
const db = createSupabaseClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// ─── Storage ──────────────────────────────────────────────────────────────────
const store = {
  async saveRequest(req) {
    if (db) { await db.upsert("ff_requests", req); return; }
    const all = JSON.parse(localStorage.getItem("ff_requests") || "{}");
    all[req.id] = req;
    localStorage.setItem("ff_requests", JSON.stringify(all));
  },
  async getRequest(id) {
    if (db) { const rows = await db.select("ff_requests", `id=eq.${id}`); return rows[0] || null; }
    const all = JSON.parse(localStorage.getItem("ff_requests") || "{}");
    return all[id] || null;
  },
  async listRequests() {
    if (db) return db.select("ff_requests", "order=created_at.desc");
    const all = JSON.parse(localStorage.getItem("ff_requests") || "{}");
    return Object.values(all).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },
  async deleteRequest(id) {
    if (db) return; // TODO: implement for Supabase
    const all = JSON.parse(localStorage.getItem("ff_requests") || "{}");
    delete all[id];
    localStorage.setItem("ff_requests", JSON.stringify(all));
  },
  async saveResponse(resp) {
    if (db) { await db.insert("ff_responses", resp); return; }
    const all = JSON.parse(localStorage.getItem("ff_responses") || "[]");
    all.push(resp);
    localStorage.setItem("ff_responses", JSON.stringify(all));
  },
  async getResponses(requestId) {
    if (db) return db.select("ff_responses", `request_id=eq.${requestId}`);
    const all = JSON.parse(localStorage.getItem("ff_responses") || "[]");
    return all.filter((r) => r.request_id === requestId);
  },
  async saveSynthesis(requestId, synthesis) {
    if (db) { await db.upsert("ff_synthesis", { request_id: requestId, synthesis, updated_at: new Date().toISOString() }); return; }
    const all = JSON.parse(localStorage.getItem("ff_synthesis") || "{}");
    all[requestId] = synthesis;
    localStorage.setItem("ff_synthesis", JSON.stringify(all));
  },
  async getSynthesis(requestId) {
    if (db) { const rows = await db.select("ff_synthesis", `request_id=eq.${requestId}`); return rows[0]?.synthesis || null; }
    const all = JSON.parse(localStorage.getItem("ff_synthesis") || "{}");
    return all[requestId] || null;
  },
  getSeenCount(requestId) {
    const all = JSON.parse(localStorage.getItem("ff_seen") || "{}");
    return all[requestId] || 0;
  },
  setSeenCount(requestId, count) {
    const all = JSON.parse(localStorage.getItem("ff_seen") || "{}");
    all[requestId] = count;
    localStorage.setItem("ff_seen", JSON.stringify(all));
  },
  getSlackConfig() { return JSON.parse(localStorage.getItem("ff_slack") || "{}"); },
  saveSlackConfig(cfg) { localStorage.setItem("ff_slack", JSON.stringify(cfg)); },
  getAnthropicConfig() { return JSON.parse(localStorage.getItem("ff_anthropic") || "{}"); },
  saveAnthropicConfig(cfg) { localStorage.setItem("ff_anthropic", JSON.stringify(cfg)); },

  // ── User / Auth ──
  getCurrentUser() {
    try {
      const user = JSON.parse(localStorage.getItem("ff_current_user") || "null");
      if (!user) return null;
      // Migrate legacy single-team users: teamId → teamIds + activeTeamId
      if (user.teamId !== undefined && !user.teamIds) {
        user.teamIds = user.teamId ? [user.teamId] : [];
        user.activeTeamId = user.teamId || null;
        delete user.teamId;
        localStorage.setItem("ff_current_user", JSON.stringify(user));
      }
      return user;
    } catch { localStorage.removeItem("ff_current_user"); return null; }
  },
  setCurrentUser(user) { localStorage.setItem("ff_current_user", JSON.stringify(user)); },
  clearCurrentUser() { localStorage.removeItem("ff_current_user"); },

  // ── Teams ──
  getTeams() { return JSON.parse(localStorage.getItem("ff_teams") || "{}"); },
  saveTeam(team) {
    const all = JSON.parse(localStorage.getItem("ff_teams") || "{}");
    all[team.id] = team;
    localStorage.setItem("ff_teams", JSON.stringify(all));
  },
  getTeam(id) {
    const all = JSON.parse(localStorage.getItem("ff_teams") || "{}");
    return all[id] || null;
  },
  getTeamByInviteCode(code) {
    const all = JSON.parse(localStorage.getItem("ff_teams") || "{}");
    return Object.values(all).find((t) => t.inviteCode === code) || null;
  },
  getPublicTeams() {
    const all = JSON.parse(localStorage.getItem("ff_teams") || "{}");
    return Object.values(all).filter((t) => t.visibility === "public");
  },
  getUserTeams(teamIds) {
    if (!teamIds || !teamIds.length) return [];
    const all = JSON.parse(localStorage.getItem("ff_teams") || "{}");
    return teamIds.map((id) => all[id]).filter(Boolean);
  },

  // ── Folders ──
  getFolders(teamId) {
    const all = JSON.parse(localStorage.getItem("ff_folders") || "{}");
    if (teamId) return Object.values(all).filter((f) => f.teamId === teamId || !f.teamId);
    return Object.values(all);
  },
  saveFolder(folder) {
    const all = JSON.parse(localStorage.getItem("ff_folders") || "{}");
    all[folder.id] = folder;
    localStorage.setItem("ff_folders", JSON.stringify(all));
  },
  deleteFolder(id) {
    const all = JSON.parse(localStorage.getItem("ff_folders") || "{}");
    delete all[id];
    localStorage.setItem("ff_folders", JSON.stringify(all));
  },

  // Override listRequests to support team / folder filtering
  async listRequestsFiltered({ userId, teamId } = {}) {
    const all = JSON.parse(localStorage.getItem("ff_requests") || "{}");
    let items = Object.values(all).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (userId || teamId) {
      items = items.filter((r) => {
        const ownedByMe = r.ownerId === userId;
        const sharedWithTeam = r.visibility === "team" && r.teamId === teamId;
        const sharedWithMember = Array.isArray(r.sharedWith) && r.sharedWith.includes(userId);
        return ownedByMe || sharedWithTeam || sharedWithMember;
      });
    }
    return items;
  },
};
// ─── Helpers ──────────────────────────────────────────────────────────────────
function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }
function isArtiumEmail(email) { return email.trim().toLowerCase().endsWith("@artium.ai"); }
function makeInviteCode() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function getInviteUrl(inviteCode) { return `${window.location.origin}${window.location.pathname}#join/${inviteCode}`; }
function loadGoogleGSI() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) { resolve(); return; }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Sign-In"));
    document.head.appendChild(script);
  });
}
function decodeJWT(token) {
  try {
    const payload = token.split(".")[1];
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decoded);
  } catch { return null; }
}
function navigate(path) { window.location.hash = path; }
function parseRoute() {
  const hash = window.location.hash.replace("#", "");
  if (!hash) return { view: "home" };
  const [view, id] = hash.split("/");
  return { view, id };
}
function formatDeadline(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}
// ─── URL helpers ──────────────────────────────────────────────────────────────
function detectUrlType(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace("www.", "");
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "url_youtube";
    if (host.includes("figma.com")) return "url_figma";
    if (host.includes("loom.com")) return "url_loom";
    return "url_embed";
  } catch { return null; }
}
function getYouTubeEmbedUrl(url) {
  try {
    const u = new URL(url);
    let id = u.searchParams.get("v");
    if (!id && u.hostname === "youtu.be") id = u.pathname.slice(1).split("?")[0];
    const t = u.searchParams.get("t");
    return `https://www.youtube.com/embed/${id}${t ? `?start=${t}` : ""}`;
  } catch { return null; }
}
function getFigmaEmbedUrl(url) {
  return `https://www.figma.com/embed?embed_host=ff&url=${encodeURIComponent(url)}`;
}
function getLoomEmbedUrl(url) {
  return url.replace("/share/", "/embed/").split("?")[0];
}
// ─── Claude synthesis ─────────────────────────────────────────────────────────
async function synthesizeFeedback(request, responses, apiKey) {
  if (!apiKey) return "⚠️ Add your Anthropic API key in Settings (⚙) to enable AI synthesis.";
  const prompt = `You are a senior product consultant synthesizing reviewer feedback.
FEEDBACK REQUEST: ${request.title}
Context: ${request.context || "none"}
Questions: ${JSON.stringify(request.questions, null, 2)}
RESPONSES (${responses.length}):
${responses.map((r, i) => `Reviewer ${i + 1} (${r.reviewer_name}):
- Initial reaction: ${r.initial_reaction}
- Pre-bias: ${typeof r.pre_bias === "object" ? JSON.stringify(r.pre_bias) : (r.pre_bias || "none")}
- Answers: ${JSON.stringify(r.answers)}${r.closing_answer ? `\n- Additional notes: ${r.closing_answer}` : ""}${r.reviewer_questions ? `\n- Questions raised by reviewer: ${r.reviewer_questions}` : ""}`).join("\n\n")}
Produce:
1. **Overall sentiment** (1-2 sentences)
2. **Key themes** (bullet points)
3. **Prioritized action items** (numbered, concrete)
4. **Flags / open questions**
Be direct and actionable.`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model: CLAUDE_MODEL, max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return `⚠️ Synthesis failed: ${err.error?.message || res.statusText}`;
    }
    const data = await res.json();
    return data.content?.[0]?.text || "Synthesis unavailable.";
  } catch (e) {
    return `⚠️ Synthesis error: ${e.message}`;
  }
}
async function sendSlackMessage(webhookUrl, message) {
  await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: message }),
  });
}
// ════════════════════════════════════════════════════════════════════════════════
// CSS
// ════════════════════════════════════════════════════════════════════════════════
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Lato:wght@400;700;900&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --ink:#17171C;--paper:#FFFAF5;--warm:#F1F1F3;--accent:#FC55DE;--accent-light:#FFF5FD;
  --secondary:#3877DD;--muted:#9090A2;--border:#E3E3E8;--success:#166534;--success-bg:#F0FDF4;
  --success-border:#BBF7D0;--info-bg:#F5F9FF;--info-border:#C5DBFD;
  --radius:6px;--radius-lg:12px;
  --shadow:0 2px 12px rgba(23,23,28,.08);--shadow-lg:0 8px 40px rgba(23,23,28,.14);
}
body{font-family:'DM Sans',sans-serif;background:var(--paper);color:var(--ink);font-size:15px;line-height:1.6;min-height:100vh}
h1,h2,h3{font-family:'Lato',sans-serif;font-weight:700;line-height:1.2}
.app{min-height:100vh;display:flex;flex-direction:column}
.topbar{height:52px;border-bottom:1px solid var(--border);display:flex;align-items:center;padding:0 20px;gap:12px;background:var(--paper);position:sticky;top:0;z-index:200}
.logo{font-family:'Lato',sans-serif;font-weight:900;font-size:18px;cursor:pointer;display:flex;align-items:center;gap:7px}
.topbar-right{margin-left:auto;display:flex;gap:8px;align-items:center}
.topbar-nav{display:flex;gap:4px;margin-left:16px}
.topbar-nav a{font-size:13px;font-weight:500;padding:5px 10px;border-radius:var(--radius);color:var(--muted);cursor:pointer;text-decoration:none;transition:all .15s}
.topbar-nav a:hover{color:var(--ink);background:var(--warm)}
.topbar-nav a.active{color:var(--ink);background:var(--warm);font-weight:600}
.page{flex:1;padding:44px 24px;max-width:780px;margin:0 auto;width:100%}
.eyebrow{font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:8px}
.page-title{font-size:clamp(26px,5vw,38px);margin-bottom:8px}
.page-subtitle{color:var(--muted);font-size:15px;margin-bottom:36px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:var(--radius);font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;cursor:pointer;border:none;transition:all .15s;white-space:nowrap}
.btn-primary{background:var(--accent);color:white}
.btn-primary:hover{background:#e040c8;transform:translateY(-1px);box-shadow:0 4px 12px rgba(252,85,222,.3)}
.btn-accent{background:var(--secondary);color:white}
.btn-accent:hover{background:#2d63c0;transform:translateY(-1px)}
.btn-ghost{background:transparent;color:var(--ink);border:1px solid var(--border)}
.btn-ghost:hover{background:var(--warm)}
.btn-danger{background:#EF4444;color:white;border:none}
.btn-danger:hover{background:#DC2626;transform:translateY(-1px)}
.btn-slack{background:#4A154B;color:white}
.btn-slack:hover{background:#611f64;transform:translateY(-1px)}
.btn-sm{padding:5px 11px;font-size:13px}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none!important}
.field{margin-bottom:22px}
.label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}
.hint{font-size:12px;color:var(--muted);margin-top:4px}
input[type=text],input[type=url],input[type=date],textarea,select{width:100%;padding:10px 13px;border:1px solid var(--border);border-radius:var(--radius);font-family:'DM Sans',sans-serif;font-size:14px;background:white;color:var(--ink);transition:border-color .15s;outline:none}
input::placeholder,textarea::placeholder{color:#C5C5CF}
input:focus,textarea:focus,select:focus{border-color:var(--accent)}
textarea{resize:vertical;min-height:76px}
.card{background:white;border:1px solid var(--border);border-radius:var(--radius-lg);padding:22px;margin-bottom:14px}
.card-accent{border-left:3px solid var(--accent)}
.alert{padding:11px 15px;border-radius:var(--radius);font-size:13px;margin-bottom:14px;display:flex;align-items:flex-start;gap:8px}
.alert-success{background:var(--success-bg);color:#14532D;border:1px solid var(--success-border)}
.alert-info{background:var(--info-bg);color:#0E3C87;border:1px solid var(--info-border)}
.alert-warn{background:#FFFBEB;color:#92400E;border:1px solid #FDE68A}
.progress-bar{height:3px;background:var(--border);border-radius:2px;margin-bottom:26px;overflow:hidden}
.progress-fill{height:100%;background:var(--accent);border-radius:2px;transition:width .4s ease}
.question-card{background:var(--warm);border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px;margin-bottom:10px}
.q-type-badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;background:var(--accent-light);color:var(--accent);margin-bottom:9px}
.content-type-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}
.content-type-tab{padding:6px 13px;border:1px solid var(--border);border-radius:20px;font-size:13px;cursor:pointer;background:white;font-family:'DM Sans',sans-serif;transition:all .15s;color:var(--muted)}
.content-type-tab:hover{border-color:var(--ink);color:var(--ink)}
.content-type-tab.active{background:var(--ink);color:white;border-color:var(--ink)}
.dropzone{border:2px dashed var(--border);border-radius:var(--radius-lg);padding:28px 20px;text-align:center;cursor:pointer;transition:all .2s;background:var(--warm)}
.dropzone:hover,.dropzone.drag-over{border-color:var(--accent);background:var(--accent-light)}
.dropzone-icon{font-size:26px;margin-bottom:7px}
.dropzone-label{font-size:14px;font-weight:500}
.dropzone-hint{font-size:12px;color:var(--muted);margin-top:3px}
.content-items{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.content-item-row{display:flex;align-items:center;gap:10px;background:white;border:1px solid var(--border);border-radius:var(--radius);padding:9px 12px;font-size:13px}
.content-item-icon{font-size:16px;flex-shrink:0}
.content-item-label-wrap{flex:1;display:flex;align-items:center;gap:4px;overflow:hidden;min-width:0}.content-item-label{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.content-item-pencil{opacity:0;flex-shrink:0;cursor:pointer;font-size:12px;color:var(--muted);border:none;background:none;padding:0 2px;line-height:1;transition:opacity .15s}.content-item-row:hover .content-item-pencil{opacity:1}.content-item-pencil:hover{color:var(--accent)}.content-item-label-edit{flex:1;border:1px solid var(--accent);border-radius:4px;padding:2px 6px;font-size:13px;font-family:inherit;outline:none;min-width:0}
.content-item-remove{color:var(--muted);cursor:pointer;font-size:16px;line-height:1;flex-shrink:0;background:none;border:none;padding:2px 4px}
.content-item-remove:hover{color:var(--accent)}
.hotspot-canvas-overlay{position:absolute;inset:0;cursor:crosshair;z-index:10}
.hotspot-box{position:absolute;border:2px solid var(--accent);background:rgba(252,85,222,.15);border-radius:3px;pointer-events:none}
.hotspot-pulse{position:absolute;border:2px solid var(--accent);border-radius:3px;animation:hs-pulse 1.8s ease-in-out infinite;pointer-events:none}
@keyframes hs-pulse{0%,100%{box-shadow:0 0 0 0 rgba(252,85,222,.45)}60%{box-shadow:0 0 0 10px rgba(252,85,222,0)}}
.hotspot-label{position:absolute;top:-22px;left:0;background:var(--accent);color:white;font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;white-space:nowrap}
.reactions{display:flex;gap:16px;flex-wrap:wrap}
.reaction-group{display:flex;flex-direction:column;gap:5px}
.reaction-group-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--muted)}
.reaction-row{display:flex;gap:5px}
.reaction-btn{display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 11px;border:2px solid var(--border);border-radius:var(--radius-lg);cursor:pointer;background:white;transition:all .15s;font-family:'DM Sans',sans-serif;min-width:54px}
.reaction-btn:hover{border-color:var(--ink);background:var(--warm)}
.reaction-btn.selected{border-color:var(--accent);background:var(--accent-light)}
.reaction-emoji{font-size:20px}
.reaction-label{font-size:10px;font-weight:600;color:var(--muted)}
.reaction-btn.selected .reaction-label{color:var(--accent)}
.likert-scale{display:flex;gap:5px;align-items:center;flex-wrap:wrap}
.likert-btn{width:42px;height:42px;border:2px solid var(--border);border-radius:var(--radius);background:white;cursor:pointer;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:600;transition:all .15s;display:flex;align-items:center;justify-content:center;color:var(--muted)}
.likert-btn:hover{border-color:var(--ink);color:var(--ink)}
.likert-btn.selected{background:var(--accent);border-color:var(--accent);color:white}
.likert-labels{display:flex;justify-content:space-between;margin-top:5px;font-size:11px;color:var(--muted)}
.split{display:flex;height:calc(100vh - 52px);overflow:hidden}
.split-left{flex:1;border-right:1px solid var(--border);display:flex;flex-direction:column;background:var(--warm);min-width:0;overflow:hidden}
.split-left-header{background:var(--ink);flex-shrink:0}
.split-left-tabs{display:flex;overflow-x:auto;scrollbar-width:none}
.split-left-tabs::-webkit-scrollbar{display:none}
.split-tab{padding:10px 16px;font-size:12px;font-weight:500;cursor:pointer;white-space:nowrap;border-right:1px solid rgba(255,255,255,.1);color:rgba(255,255,255,.6);transition:all .15s;flex-shrink:0}
.split-tab:hover{color:white;background:rgba(255,255,255,.08)}
.split-tab.active{color:white;background:rgba(255,255,255,.15)}
.split-content{flex:1;overflow:hidden;display:flex;flex-direction:column;position:relative}
.split-right{width:400px;flex-shrink:0;overflow-y:auto;padding:24px 22px}
.embed-frame{flex:1;border:none;width:100%;height:100%}
.ext-link-bar{background:rgba(255,255,255,.1);padding:7px 14px;font-size:12px;display:flex;align-items:center;gap:10px;flex-shrink:0;color:rgba(255,255,255,.8)}
.image-gallery{display:flex;flex-wrap:wrap;gap:8px;padding:12px;overflow-y:auto;max-height:100%;align-content:flex-start}
.image-gallery img{max-width:100%;border-radius:var(--radius);border:1px solid var(--border)}
.text-display{padding:20px;overflow-y:auto;height:100%;font-size:14px;line-height:1.75;white-space:pre-wrap}
.code-display{padding:16px 20px;overflow:auto;height:100%;font-family:'Fira Code','Courier New',monospace;font-size:13px;line-height:1.6;background:#1a1917;color:#e8e4dc;white-space:pre}
.share-box{display:flex;gap:8px;align-items:center;background:var(--warm);border:1px dashed var(--border);border-radius:var(--radius);padding:11px 13px}
.share-url{flex:1;font-size:13px;font-family:monospace;color:var(--ink);word-break:break-all}
.slack-msg-box{font-family:monospace;background:white;padding:12px;border-radius:4px;line-height:1.7;font-size:13px}
.request-list{display:flex;flex-direction:column;gap:10px}
.request-card{background:white;border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 18px;transition:all .15s;display:flex;flex-direction:column;gap:0}
.request-card-row{display:flex;align-items:center;gap:12px;cursor:pointer}
.request-card:hover{border-color:var(--accent);box-shadow:var(--shadow);transform:translateY(-1px)}
.request-card.archived{opacity:.55}
.request-card-title{font-weight:600;font-size:15px;margin-bottom:3px}
.request-card-meta{font-size:12px;color:var(--muted);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.req-actions{display:flex;gap:3px;opacity:0;transition:opacity .15s;flex-shrink:0}
.request-card:hover .req-actions{opacity:1}
.req-menu{position:absolute;right:0;top:calc(100% + 4px);background:white;border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);min-width:160px;z-index:200;overflow:hidden;padding:4px 0}
.req-menu-item{padding:8px 14px;font-size:13px;cursor:pointer;transition:background .12s}
.req-menu-item:hover{background:var(--warm)}
.req-menu-danger{color:#ef4444}
.req-menu-danger:hover{background:#fef2f2}
.req-menu-divider{height:1px;background:var(--border);margin:4px 0}
.notif-badge{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:10px;background:var(--accent);color:white;font-size:11px;font-weight:700;padding:0 5px}
.status-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.status-active{background:#22C55E}
.status-done{background:var(--muted)}
.status-archived{background:#ccc}
.filter-bar{display:inline-flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px;padding:8px 12px;background:var(--warm);border:1px solid var(--border);border-radius:var(--radius-lg);margin-left:auto}
.filter-select{padding:5px 9px;border:1px solid var(--border);border-radius:var(--radius);font-family:'DM Sans',sans-serif;font-size:13px;background:white;color:var(--ink);cursor:pointer;outline:none}
.filter-select:focus{border-color:var(--accent)}
.tag-chip{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;background:var(--warm);border:1px solid var(--border);border-radius:20px;font-size:11px;cursor:pointer;transition:all .15s;white-space:nowrap;font-family:'DM Sans',sans-serif}
.tag-chip:hover{border-color:var(--ink)}
.tag-chip.active-tag{background:var(--accent);color:white;border-color:var(--accent)}
.tag-chip-remove{background:none;border:none;cursor:pointer;font-size:10px;color:inherit;padding:0 0 0 2px;line-height:1;opacity:.7}
.tag-chip-remove:hover{opacity:1}
.reshare-panel{background:var(--warm);border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin-top:8px}
.modal-overlay{position:fixed;inset:0;background:rgba(23,23,28,.5);z-index:500;display:flex;align-items:center;justify-content:center;padding:20px}
.modal{background:white;border-radius:var(--radius-lg);padding:28px;max-width:520px;width:100%;box-shadow:var(--shadow-lg);max-height:90vh;overflow-y:auto}
.modal h2{font-size:22px;margin-bottom:6px}
.modal-subtitle{color:var(--muted);font-size:13px;margin-bottom:22px}
.modal-section-divider{border:none;border-top:1px solid var(--border);margin:20px 0}
.voice-btn{display:flex;align-items:center;gap:5px;padding:7px 13px;border:1px solid var(--border);border-radius:var(--radius);background:white;cursor:pointer;font-size:13px;font-family:'DM Sans',sans-serif;transition:all .15s;color:var(--muted);margin-top:8px}
.voice-btn.recording{border-color:var(--accent);background:var(--accent-light);color:var(--accent);animation:pulse 1.2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
.synthesis-block{background:var(--ink);color:white;border-radius:var(--radius-lg);padding:26px;margin-bottom:22px}
.synthesis-block h2{color:white;margin-bottom:14px;font-size:21px}
.synthesis-content{white-space:pre-wrap;font-size:14px;line-height:1.75}
.divider{border:none;border-top:1px solid var(--border);margin:24px 0}
.tag{display:inline-flex;align-items:center;gap:3px;padding:2px 9px;border-radius:20px;font-size:12px;font-weight:500;background:var(--warm);border:1px solid var(--border);color:var(--muted)}
.text-muted{color:var(--muted)}.text-sm{font-size:13px}.bold{font-weight:600}
.mt-4{margin-top:4px}.mt-8{margin-top:8px}.mt-12{margin-top:12px}.mt-16{margin-top:16px}.mt-24{margin-top:24px}
.mb-4{margin-bottom:4px}.mb-8{margin-bottom:8px}.mb-12{margin-bottom:12px}.mb-16{margin-bottom:16px}
.hero{padding:72px 24px 56px;max-width:680px;margin:0 auto}
.hero h1{font-size:clamp(34px,6vw,54px);margin-bottom:14px;line-height:1.1}
.hero p{font-size:17px;color:var(--muted);margin-bottom:32px;max-width:480px}
.feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-top:44px}
.feature-tile{background:white;border:1px solid var(--border);border-radius:var(--radius-lg);padding:18px}
.feature-icon{font-size:20px;margin-bottom:7px}
.feature-title{font-weight:600;font-size:13px;margin-bottom:3px}
.feature-desc{font-size:12px;color:var(--muted)}
.step-tag{font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:5px}
.deadline-badge{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;background:var(--accent-light);border:1px solid #FBAEE3;border-radius:20px;font-size:12px;font-weight:500;color:#9B1E8A}
.prebias-row{display:flex;gap:8px;align-items:center;margin-bottom:8px}
.prebias-row input{flex:1}
.footer{border-top:1px solid var(--border);padding:20px 24px;text-align:center;font-size:12px;color:var(--muted);background:var(--warm);margin-top:auto;flex-shrink:0}
.footer a{color:var(--muted);text-decoration:underline;transition:color .15s}
.footer a:hover{color:var(--ink)}
@media(max-width:700px){
  .split{flex-direction:column}
  .split-left{height:45vh;border-right:none;border-bottom:1px solid var(--border)}
  .split-right{width:100%;overflow-y:visible}
}
/* ─── Auth / team ─── */
.auth-page{min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--paper);padding:24px}
.auth-card{background:white;border:1px solid var(--border);border-radius:var(--radius-lg);padding:40px 36px;max-width:440px;width:100%;box-shadow:var(--shadow-lg)}
.auth-logo{display:flex;align-items:center;gap:8px;margin-bottom:28px}
.auth-logo-mark{width:32px;height:32px;display:flex;align-items:center;justify-content:center;color:var(--ink);flex-shrink:0}
.avatar{width:28px;height:28px;border-radius:50%;background:var(--accent);color:white;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'Lato',sans-serif}
.user-pill{display:flex;align-items:center;gap:7px;padding:4px 10px 4px 4px;border:1px solid var(--border);border-radius:20px;cursor:pointer;transition:all .15s;background:white}
.user-pill:hover{border-color:var(--ink)}
.user-pill-name{font-size:13px;font-weight:500;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-badge{font-size:11px;background:var(--accent-light);color:var(--accent);border-radius:20px;padding:2px 8px;font-weight:600;border:1px solid #FBAEE3}
.user-menu{position:absolute;right:0;top:calc(100% + 6px);background:white;border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);min-width:200px;z-index:300;overflow:hidden}
.user-menu-header{padding:12px 14px}
.user-menu-divider{border-top:1px solid var(--border)}
.user-menu-item{padding:9px 14px;font-size:13px;cursor:pointer;transition:all .12s}
.user-menu-item:hover{background:var(--warm);color:var(--ink)}
.teams-dropdown{position:absolute;left:0;top:calc(100% + 6px);background:white;border:1px solid var(--border);border-radius:var(--radius-lg);box-shadow:var(--shadow-lg);min-width:220px;z-index:300;overflow:hidden;padding:4px 0}
.teams-dropdown-item{padding:10px 14px;font-size:13px;cursor:pointer;transition:all .12s;display:flex;align-items:center;justify-content:space-between;gap:12px}
.teams-dropdown-item:hover{background:var(--warm)}
.teams-dropdown-item.active{background:var(--accent-light);font-weight:600}
.teams-dropdown-name{font-weight:500}
/* ─── Folders sidebar ─── */
.requests-layout{display:flex;gap:0;align-items:flex-start}
.folder-sidebar{width:200px;flex-shrink:0;margin-right:24px;position:sticky;top:72px}
.folder-sidebar-title{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);margin-bottom:8px;padding:0 8px}
.folder-item{display:flex;align-items:center;gap:7px;padding:7px 10px;border-radius:var(--radius);font-size:13px;cursor:pointer;transition:all .15s;color:var(--ink)}
.folder-item:hover{background:var(--warm)}
.folder-item.active{background:var(--accent-light);color:var(--accent);font-weight:600}
.folder-item-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.folder-item-count{font-size:11px;color:var(--muted)}
.folder-actions{opacity:0;transition:opacity .15s}
.folder-item:hover .folder-actions{opacity:1}
/* ─── Grid view ─── */
.requests-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.request-grid-card{background:white;border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px 18px;transition:all .15s;cursor:pointer;display:flex;flex-direction:column;gap:8px}
.request-grid-card:hover{border-color:var(--accent);box-shadow:var(--shadow);transform:translateY(-1px)}
.request-grid-card.archived{opacity:.55}
/* ─── Visibility badge ─── */
.vis-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:600}
.vis-team{background:#F5F9FF;color:#0E3C87;border:1px solid #C5DBFD}
.vis-members{background:#F0FDF4;color:#14532D;border:1px solid #BBF7D0}
.vis-private{background:var(--warm);color:var(--muted);border:1px solid var(--border)}
.vis-external{background:#FFFBEB;color:#92400E;border:1px solid #FDE68A}
/* ─── View toggle ─── */
.view-toggle{display:flex;border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.view-toggle-btn{padding:5px 10px;background:white;border:none;cursor:pointer;font-size:14px;color:var(--muted);transition:all .15s}
.view-toggle-btn.active{background:var(--ink);color:white}
/* ─── Empty state ─── */
.empty-state-card{border:2px dashed var(--border);background:var(--paper)}
.empty-state-card h2{font-family:'Lato',sans-serif}
/* ─── Auth divider ─── */
.auth-divider{display:flex;align-items:center;gap:12px;margin:20px 0;color:var(--muted);font-size:12px}
.auth-divider::before,.auth-divider::after{content:'';flex:1;border-top:1px solid var(--border)}
`;
// ─── Style injector ───────────────────────────────────────────────────────────
function StyleInjector() {
  useEffect(() => {
    const el = document.createElement("style");
    el.textContent = CSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);
  return null;
}
// ─── Artium logo (monogram) ───────────────────────────────────────────────────
function ArtiumMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 344 344" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M101.99 240.555H95.7319L169.154 91.4836H180.047L251.581 240.555H245.527L176.066 95.6005H172.618L101.99 240.555Z" fill="currentColor" stroke="currentColor" strokeWidth="2.89411"/>
      <path fillRule="evenodd" clipRule="evenodd" d="M145.064 206.57L173.015 250.833H174.803L202.753 206.57H196.097L173.909 241.981L151.72 206.57H145.064Z" fill="#FC55DE" stroke="#FC55DE" strokeWidth="2.89411" strokeMiterlimit="16"/>
    </svg>
  );
}
// ─── Footer ───────────────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="footer">
      Built by <a href="https://artium.ai/" target="_blank" rel="noreferrer">Artium.ai</a> · © 2026
    </footer>
  );
}
// ─── Settings modal ───────────────────────────────────────────────────────────
function SettingsModal({ onClose }) {
  const [cfg, setCfg] = useState(store.getSlackConfig());
  const [anthCfg, setAnthCfg] = useState(store.getAnthropicConfig());
  const [saved, setSaved] = useState(false);
  function save() {
    store.saveSlackConfig(cfg);
    store.saveAnthropicConfig(anthCfg);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>Settings</h2>
        <p className="modal-subtitle">Configure integrations and API keys.</p>

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 20 }}>✨</span><strong>AI Synthesis (Anthropic)</strong>
        </div>
        <div className="field">
          <label className="label">Anthropic API Key</label>
          <input type="password" placeholder="sk-ant-api03-…" value={anthCfg.apiKey || ""} onChange={(e) => setAnthCfg({ ...anthCfg, apiKey: e.target.value })} />
          <div className="hint">Get your key at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>console.anthropic.com</a> → API Keys. Required for AI synthesis on results pages.</div>
        </div>

        <hr className="modal-section-divider" />

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 20 }}>💬</span><strong>Slack Integration</strong>
        </div>
        <div className="field">
          <label className="label">Incoming Webhook URL</label>
          <input type="url" placeholder="https://hooks.slack.com/services/T.../B.../" value={cfg.webhookUrl || ""} onChange={(e) => setCfg({ ...cfg, webhookUrl: e.target.value })} />
          <div className="hint">
            Go to <a href="https://api.slack.com/apps" target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>api.slack.com/apps</a> → Create New App → under <strong>Features</strong> enable <strong>Incoming Webhooks</strong> → Add New Webhook to Workspace.
          </div>
        </div>
        <div className="field">
          <label className="label">Channel name (display only)</label>
          <input type="text" placeholder="#ebay-product-feedback" value={cfg.channel || ""} onChange={(e) => setCfg({ ...cfg, channel: e.target.value })} />
        </div>
        <div className="field">
          <label className="label">Your name (shown in messages)</label>
          <input type="text" placeholder="Kate" value={cfg.senderName || ""} onChange={(e) => setCfg({ ...cfg, senderName: e.target.value })} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-primary" onClick={save}>{saved ? "✓ Saved" : "Save settings"}</button>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
// ─── Top bar ──────────────────────────────────────────────────────────────────
function TopBar({ activeView, extra, user }) {
  const [showSettings, setShowSettings] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showTeamsDropdown, setShowTeamsDropdown] = useState(false);
  const menuRef = useRef(null);
  const teamsRef = useRef(null);
  const userTeams = user?.teamIds?.length ? store.getUserTeams(user.teamIds) : [];
  const activeTeam = user?.activeTeamId ? store.getTeam(user.activeTeamId) : null;
  useEffect(() => {
    if (!showUserMenu && !showTeamsDropdown) return;
    function handleClick(e) {
      if (showUserMenu && menuRef.current && !menuRef.current.contains(e.target)) setShowUserMenu(false);
      if (showTeamsDropdown && teamsRef.current && !teamsRef.current.contains(e.target)) setShowTeamsDropdown(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showUserMenu, showTeamsDropdown]);
  return (
    <>
      <div className="topbar">
        <div className="logo" onClick={() => navigate("requests")}>
          <span style={{ color: "var(--accent)" }}>◆</span>
          <span>Feedback<span style={{ color: "var(--accent)" }}>.</span>Facilitator</span>
        </div>
        <nav className="topbar-nav">
          <a className={activeView === "requests" ? "active" : ""} onClick={() => navigate("requests")}>My Requests</a>
          {userTeams.length === 1 && activeTeam && (
            <a className={activeView === "team" ? "active" : ""} onClick={() => navigate("team/" + activeTeam.id)}>👥 {activeTeam.name}</a>
          )}
          {userTeams.length > 1 && (
            <div style={{ position: "relative" }} ref={teamsRef}>
              <a className={activeView === "team" ? "active" : ""} onClick={() => setShowTeamsDropdown((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                👥 Teams <span style={{ fontSize: 10, marginLeft: 2 }}>{showTeamsDropdown ? "▲" : "▼"}</span>
              </a>
              {showTeamsDropdown && (
                <div className="teams-dropdown">
                  {userTeams.map((t) => (
                    <div key={t.id} className={`teams-dropdown-item${t.id === user.activeTeamId ? " active" : ""}`} onClick={() => { setShowTeamsDropdown(false); navigate("team/" + t.id); }}>
                      <span className="teams-dropdown-name">{t.name}</span>
                      <span className="text-sm text-muted">{t.members.length} member{t.members.length !== 1 ? "s" : ""}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </nav>
        <div className="topbar-right">
          {activeView !== "create" && (
            <button className="btn btn-primary btn-sm" onClick={() => navigate("create")}>+ New Request</button>
          )}
          {user && (
            <div style={{ position: "relative" }} ref={menuRef}>
              <div className="user-pill" onClick={() => setShowUserMenu((v) => !v)} title={user.email}>
                <div className="avatar">{user.name.charAt(0).toUpperCase()}</div>
                <span className="user-pill-name">{user.name.split(" ")[0]}</span>
              </div>
              {showUserMenu && (
                <div className="user-menu">
                  <div className="user-menu-header">
                    <div className="bold text-sm">{user.name}</div>
                    <div className="text-sm text-muted">{user.email}</div>
                  </div>
                  <div className="user-menu-divider" />
                  <div className="user-menu-item" onClick={() => { setShowUserMenu(false); setShowSettings(true); }}>⚙ Settings</div>
                  <div className="user-menu-item" onClick={() => { setShowUserMenu(false); navigate("new-team"); }}>＋ New Team</div>
                  <div className="user-menu-divider" />
                  <div className="user-menu-item" onClick={() => { if (window.google?.accounts?.id) window.google.accounts.id.disableAutoSelect(); store.clearCurrentUser(); navigate(""); window.location.reload(); }}>Log out</div>
                </div>
              )}
            </div>
          )}
          {extra}
        </div>
      </div>
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
    </>
  );
}
// ─── Content input ────────────────────────────────────────────────────────────
const CONTENT_ICONS = { url_youtube: "▶️", url_figma: "🎨", url_loom: "🎥", url_embed: "🔗", images: "🖼️", pdf: "📄", text: "📝", code: "💻" };
function ContentInput({ items, onChange }) {
  const [mode, setMode] = useState("url");
  const [urlInput, setUrlInput] = useState("");
  const [textInput, setTextInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const MODES = [{ id: "url", label: "🔗 Link / URL" }, { id: "files", label: "📎 Upload files" }, { id: "text", label: "📝 Paste text" }, { id: "code", label: "💻 Paste code" }];
  function addItem(item) { onChange([...items, { ...item, id: uid() }]); }
  function removeItem(id) { onChange(items.filter((i) => i.id !== id)); }
  function handleUrlAdd() {
    if (!urlInput.trim()) return;
    const type = detectUrlType(urlInput);
    if (!type) return;
    const labels = { url_youtube: "YouTube video", url_figma: "Figma file", url_loom: "Loom video", url_embed: urlInput };
    addItem({ type, rawUrl: urlInput, label: labels[type] });
    setUrlInput("");
  }
  function handleFiles(files) {
    const arr = Array.from(files);
    const images = arr.filter((f) => f.type.startsWith("image/"));
    const pdfs = arr.filter((f) => f.type === "application/pdf");
    if (images.length) {
      Promise.all(images.map((f) => new Promise((res) => {
        const r = new FileReader();
        r.onload = () => res({ name: f.name, dataUrl: r.result });
        r.readAsDataURL(f);
      }))).then((imgs) => addItem({ type: "images", value: imgs, label: imgs.length === 1 ? imgs[0].name : `${imgs[0].name} + ${imgs.length - 1} more` }));
    }
    if (pdfs.length) pdfs.forEach((f) => {
      const reader = new FileReader();
      reader.onload = () => addItem({ type: "pdf", value: reader.result, label: f.name });
      reader.readAsDataURL(f);
    });
  }
  return (
    <div className="field">
      <label className="label">Content to review *</label>
      {items.length > 0 && (
        <div className="content-items">
          {items.map((item) => (
            <div className="content-item-row" key={item.id}>
              <span className="content-item-icon">{CONTENT_ICONS[item.type] || "📎"}</span>
              <span className="content-item-label-wrap">
                {editingId === item.id ? (
                  <input
                    className="content-item-label-edit"
                    value={editValue}
                    autoFocus
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={() => {
                      if (editValue.trim() && editValue.trim() !== item.label) {
                        onChange(items.map((i) => i.id === item.id ? { ...i, label: editValue.trim() } : i));
                      }
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); if (e.key === "Escape") setEditingId(null); }}
                  />
                ) : (
                  <span className="content-item-label">{item.label}</span>
                )}
                {editingId !== item.id && (
                  <button className="content-item-pencil" title="Rename" onClick={() => { setEditingId(item.id); setEditValue(item.label); }}>✏</button>
                )}
              </span>
              <button className="content-item-remove" onClick={() => removeItem(item.id)}>✕</button>
            </div>
          ))}
        </div>
      )}
      <div className="content-type-tabs">
        {MODES.map((m) => <button key={m.id} className={`content-type-tab${mode === m.id ? " active" : ""}`} onClick={() => setMode(m.id)} type="button">{m.label}</button>)}
      </div>
      {mode === "url" && (
        <div style={{ display: "flex", gap: 8 }}>
          <input type="url" placeholder="YouTube, Figma, GitHub Pages, Miro, Loom, etc." value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleUrlAdd()} style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" onClick={handleUrlAdd} disabled={!urlInput.trim()}>Add</button>
        </div>
      )}
      {mode === "files" && (
        <div>
          <div className={`dropzone${dragOver ? " drag-over" : ""}`} onClick={() => fileRef.current?.click()} onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}>
            <div className="dropzone-icon">📁</div>
            <div className="dropzone-label">Drop files here or click to browse</div>
            <div className="dropzone-hint">Images (PNG, JPG, GIF, WebP) or PDF — multiple allowed</div>
          </div>
          <input ref={fileRef} type="file" accept="image/*,.pdf" multiple style={{ display: "none" }} onChange={(e) => handleFiles(e.target.files)} />
        </div>
      )}
      {mode === "text" && (
        <div>
          <textarea placeholder="Paste text content — PRD, email, doc, Slack message…" value={textInput} onChange={(e) => setTextInput(e.target.value)} rows={5} />
          <button className="btn btn-primary btn-sm mt-8" onClick={() => { if (!textInput.trim()) return; addItem({ type: "text", value: textInput, label: textInput.slice(0, 50) + (textInput.length > 50 ? "…" : "") }); setTextInput(""); }} disabled={!textInput.trim()}>Add text</button>
        </div>
      )}
      {mode === "code" && (
        <div>
          <textarea placeholder="Paste code here…" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} rows={5} style={{ fontFamily: "monospace", fontSize: 13 }} />
          <button className="btn btn-primary btn-sm mt-8" onClick={() => { if (!codeInput.trim()) return; addItem({ type: "code", value: codeInput, label: "Code snippet" }); setCodeInput(""); }} disabled={!codeInput.trim()}>Add code</button>
        </div>
      )}
      {items.length === 0 && <div className="hint mt-8">Add at least one item — you can mix links, files, and text.</div>}
    </div>
  );
}
// ─── Hotspot picker ───────────────────────────────────────────────────────────
function MiniPreview({ item }) {
  if (!item) return <div style={{ flex: 1, background: "#eee", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: "var(--muted)" }}>No content</div>;
  const s = { flex: 1, border: "none", width: "100%", pointerEvents: "none" };
  if (item.type === "url_youtube") return <iframe src={getYouTubeEmbedUrl(item.rawUrl)} style={s} title="yt" />;
  if (item.type === "url_figma") return <iframe src={getFigmaEmbedUrl(item.rawUrl)} style={s} title="fig" />;
  if (item.type === "url_loom") return <iframe src={getLoomEmbedUrl(item.rawUrl)} style={s} title="loom" />;
  if (item.type === "url_embed") return <iframe src={item.rawUrl} sandbox="allow-scripts allow-same-origin" style={s} title="embed" />;
  if (item.type === "images") return <div style={{ flex: 1, overflow: "hidden", background: "#f5f0e8", display: "flex", flexWrap: "wrap", padding: 6, gap: 4, alignContent: "flex-start" }}>{item.value.map((img, i) => <img key={i} src={img.dataUrl} style={{ maxHeight: 72, maxWidth: "48%", borderRadius: 3 }} alt="" />)}</div>;
  if (item.type === "pdf") return <object data={item.value} type="application/pdf" style={{ flex: 1, width: "100%", pointerEvents: "none" }} />;
  if (item.type === "text") return <div style={{ flex: 1, padding: "8px 10px", fontSize: 11, lineHeight: 1.5, overflow: "hidden", background: "white" }}>{item.value.slice(0, 400)}</div>;
  if (item.type === "code") return <div style={{ flex: 1, padding: "8px 10px", fontSize: 10, fontFamily: "monospace", background: "#1a1917", color: "#e8e4dc", overflow: "hidden" }}>{item.value.slice(0, 400)}</div>;
  return null;
}
function HotspotPicker({ contentItems, value, onChange }) {
  const [activeItem, setActiveItem] = useState(value?.contentItemIndex ?? 0);
  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState(null);
  const [current, setCurrent] = useState(null);
  const containerRef = useRef();
  function rel(e) {
    const rect = containerRef.current.getBoundingClientRect();
    return { x: (e.clientX - rect.left) / rect.width, y: (e.clientY - rect.top) / rect.height };
  }
  function onMouseDown(e) { e.preventDefault(); const p = rel(e); setStart(p); setCurrent(p); setDrawing(true); }
  function onMouseMove(e) { if (!drawing) return; setCurrent(rel(e)); }
  function onMouseUp() {
    if (!drawing || !start || !current) return;
    setDrawing(false);
    const x = Math.min(start.x, current.x), y = Math.min(start.y, current.y);
    const w = Math.abs(current.x - start.x), h = Math.abs(current.y - start.y);
    if (w > 0.02 && h > 0.02) onChange({ contentItemIndex: activeItem, x, y, w, h });
    setStart(null); setCurrent(null);
  }
  const liveBox = drawing && start && current ? { x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), w: Math.abs(current.x - start.x), h: Math.abs(current.y - start.y) } : null;
  return (
    <div style={{ marginTop: 14 }}>
      <div className="label" style={{ marginBottom: 6 }}>Hotspot — highlight where reviewers should focus</div>
      {contentItems.length > 1 && (
        <div className="content-type-tabs" style={{ marginBottom: 10 }}>
          {contentItems.map((item, i) => (
            <button key={item.id} className={`content-type-tab${activeItem === i ? " active" : ""}`} onClick={() => setActiveItem(i)} type="button">
              {CONTENT_ICONS[item.type]} {item.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ position: "relative", height: 160, border: "1px solid var(--border)", borderRadius: "var(--radius)", overflow: "hidden", background: "var(--warm)", display: "flex" }} ref={containerRef}>
        <MiniPreview item={contentItems[activeItem]} />
        <div className="hotspot-canvas-overlay" onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} />
        {liveBox && <div className="hotspot-box" style={{ left: `${liveBox.x * 100}%`, top: `${liveBox.y * 100}%`, width: `${liveBox.w * 100}%`, height: `${liveBox.h * 100}%` }} />}
        {value && value.contentItemIndex === activeItem && (
          <div className="hotspot-box" style={{ left: `${value.x * 100}%`, top: `${value.y * 100}%`, width: `${value.w * 100}%`, height: `${value.h * 100}%` }}>
            <span className="hotspot-label">Focus here</span>
          </div>
        )}
      </div>
      <div className="hint mt-4">
        {value ? "✅ Hotspot set — drag to update." : "Click and drag to draw the focus area."}
        {value && <button className="btn btn-ghost btn-sm" style={{ marginLeft: 8, padding: "2px 8px", fontSize: 12 }} onClick={() => onChange(null)}>Clear</button>}
      </div>
    </div>
  );
}
// ─── Pre-bias builder ─────────────────────────────────────────────────────────
function PreBiasBuilder({ questions, onChange }) {
  const [newQ, setNewQ] = useState("");
  function add() {
    if (!newQ.trim()) return;
    onChange([...questions, newQ.trim()]);
    setNewQ("");
  }
  function remove(idx) { onChange(questions.filter((_, i) => i !== idx)); }
  function update(idx, val) { onChange(questions.map((q, i) => (i === idx ? val : q))); }
  return (
    <div className="field">
      <label className="label">Pre-bias questions <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span></label>
      <div className="hint mb-8">Capture unprimed thinking before reviewers see any content.</div>
      {questions.map((q, i) => (
        <div className="prebias-row" key={i}>
          <input type="text" value={q} onChange={(e) => update(i, e.target.value)} placeholder={`Question ${i + 1}`} />
          <button className="btn btn-ghost btn-sm" onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <input type="text" placeholder="e.g. What do you think 'guardrails' means for an AI agent?" value={newQ} onChange={(e) => setNewQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={add} disabled={!newQ.trim()}>+ Add</button>
      </div>
    </div>
  );
}
// ─── Question builder ─────────────────────────────────────────────────────────
const Q_TYPES = [{ value: "likert", label: "Likert scale" }, { value: "open", label: "Open-ended" }, { value: "reaction", label: "Reaction" }, { value: "choice", label: "Multiple choice" }];
function QuestionBuilder({ questions, onChange, contentItems }) {
  const [expandedHotspot, setExpandedHotspot] = useState(null);
  function add(type) {
    onChange([...questions, { id: uid(), type, text: "", placeholder: "", options: type === "choice" ? ["Option A", "Option B"] : [], lowLabel: "Strongly disagree", highLabel: "Strongly agree", hotspot: null }]);
  }
  function update(id, patch) { onChange(questions.map((q) => q.id === id ? { ...q, ...patch } : q)); }
  function remove(id) { onChange(questions.filter((q) => q.id !== id)); }
  return (
    <div>
      {questions.map((q, i) => (
        <div className="question-card" key={q.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <span className="q-type-badge">{Q_TYPES.find((t) => t.value === q.type)?.label}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => remove(q.id)} style={{ color: "var(--muted)", borderColor: "transparent" }}>✕</button>
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label className="label">Question {i + 1}</label>
            <input type="text" placeholder="e.g. How easy was it to complete the task?" value={q.text} onChange={(e) => update(q.id, { text: e.target.value })} />
          </div>
          {q.type === "open" && (
            <div className="field" style={{ marginBottom: 10 }}>
              <label className="label">Placeholder / guidance</label>
              <input type="text" placeholder="e.g. Focus on terminology, not layout" value={q.placeholder} onChange={(e) => update(q.id, { placeholder: e.target.value })} />
            </div>
          )}
          {q.type === "likert" && (
            <div style={{ display: "flex", gap: 10 }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}><label className="label">Low label</label><input type="text" value={q.lowLabel} onChange={(e) => update(q.id, { lowLabel: e.target.value })} /></div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}><label className="label">High label</label><input type="text" value={q.highLabel} onChange={(e) => update(q.id, { highLabel: e.target.value })} /></div>
            </div>
          )}
          {q.type === "choice" && (
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label">Options (one per line)</label>
              <textarea rows={3} value={q.options.join("\n")} onChange={(e) => update(q.id, { options: e.target.value.split("\n") })} />
            </div>
          )}
          {q.type === "reaction" && (
            <div className="hint">Reviewers will see: ❤️ · 😊 · ❓ · 💬 · 👎 · 😢</div>
          )}
          {contentItems.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setExpandedHotspot(expandedHotspot === q.id ? null : q.id)} type="button">
                {q.hotspot ? "🎯 Hotspot set — edit" : "＋ Add focus hotspot"}
              </button>
              {expandedHotspot === q.id && (
                <HotspotPicker contentItems={contentItems} value={q.hotspot} onChange={(hs) => update(q.id, { hotspot: hs })} />
              )}
            </div>
          )}
        </div>
      ))}
      <div className="card" style={{ background: "var(--warm)", textAlign: "center", padding: 14 }}>
        <div className="text-sm text-muted mb-8">Add a question</div>
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "center" }}>
          {Q_TYPES.map((t) => <button key={t.value} className="btn btn-ghost btn-sm" onClick={() => add(t.value)}>+ {t.label}</button>)}
        </div>
      </div>
    </div>
  );
}
// ─── Content display (reviewer) ───────────────────────────────────────────────
function ContentDisplay({ item, hotspot }) {
  if (!item) return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--muted)", fontSize: 13 }}>No content</div>;
  const { type, value, rawUrl } = item;
  const overlay = hotspot ? (
    <div style={{ position: "absolute", left: `${hotspot.x * 100}%`, top: `${hotspot.y * 100}%`, width: `${hotspot.w * 100}%`, height: `${hotspot.h * 100}%`, pointerEvents: "none", zIndex: 10 }} className="hotspot-pulse">
      <span className="hotspot-label">Focus here</span>
    </div>
  ) : null;
  const wrap = { flex: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" };
  if (type === "url_youtube") return <div style={wrap}><iframe src={getYouTubeEmbedUrl(rawUrl)} className="embed-frame" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen title="YouTube" />{overlay}</div>;
  if (type === "url_figma") return <div style={wrap}><iframe src={getFigmaEmbedUrl(rawUrl)} className="embed-frame" allowFullScreen title="Figma" />{overlay}</div>;
  if (type === "url_loom") return <div style={wrap}><iframe src={getLoomEmbedUrl(rawUrl)} className="embed-frame" allowFullScreen title="Loom" />{overlay}</div>;
  if (type === "url_embed") return (
    <div style={wrap}>
      <div className="ext-link-bar"><span>🔗 Interactive prototype</span><a href={rawUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", marginLeft: "auto", fontSize: 12 }}>Open in new tab ↗</a></div>
      <iframe src={rawUrl} className="embed-frame" sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox" title="Prototype" />
      {overlay}
    </div>
  );
  if (type === "images") return <div style={wrap}><div className="image-gallery">{value.map((img, i) => <img key={i} src={img.dataUrl} alt={img.name} style={{ maxWidth: "100%" }} />)}</div>{overlay}</div>;
  if (type === "pdf") return <div style={wrap}><object data={value} type="application/pdf" style={{ flex: 1, width: "100%", height: "100%", border: "none" }}><a href={value} download className="btn btn-primary btn-sm" style={{ margin: 20 }}>Download PDF</a></object>{overlay}</div>;
  if (type === "text") return <div style={wrap}><div className="text-display">{value}</div>{overlay}</div>;
  if (type === "code") return <div style={wrap}><div className="code-display">{value}</div>{overlay}</div>;
  return null;
}
// ─── Answer components ────────────────────────────────────────────────────────
function useVoiceInput(onTranscript) {
  const [recording, setRecording] = useState(false);
  const ref = useRef(null);
  const toggle = useCallback(() => {
    if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) { alert("Voice input not supported. Try Chrome."); return; }
    if (recording) { ref.current?.stop(); setRecording(false); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = true; r.interimResults = false;
    r.onresult = (e) => onTranscript(Array.from(e.results).map((res) => res[0].transcript).join(" "));
    r.onerror = () => setRecording(false); r.onend = () => setRecording(false);
    r.start(); ref.current = r; setRecording(true);
  }, [recording, onTranscript]);
  return { recording, toggle };
}

// ─── Reactions ────────────────────────────────────────────────────────────────
const REACTION_GROUPS = [
  { label: "Positive", items: [{ emoji: "🩷", label: "Love it" }, { emoji: "👍", label: "Happy" }] },
  { label: "Neutral",  items: [{ emoji: "❓", label: "Unsure" }, { emoji: "💬", label: "Comment" }] },
  { label: "Negative", items: [{ emoji: "👎", label: "Nope" },   { emoji: "❌", label: "Sad" }] },
];
const CUSTOM_EMOJIS = ["🎉","🔥","💯","🤔","😍","🙌","✅","⚡","🎯","💪","🚀","🏆","👀","💡","🤷","😅","🫠","🥳","👏","🤩"];
const REACTIONS = REACTION_GROUPS.flatMap((g) => g.items);

function ReactionAnswer({ value, onChange }) {
  const [showCustom, setShowCustom] = useState(false);
  const isCustom = value && value.startsWith("custom:");
  const customEmoji = isCustom ? value.slice(7) : null;
  return (
    <div className="reactions">
      {REACTION_GROUPS.map((group) => (
        <div key={group.label} className="reaction-group">
          <div className="reaction-group-label">{group.label}</div>
          <div className="reaction-row">
            {group.items.map((r) => (
              <button key={r.label} className={`reaction-btn${value === r.label ? " selected" : ""}`} onClick={() => { onChange(value === r.label ? null : r.label); setShowCustom(false); }} title={r.label}>
                <span className="reaction-emoji">{r.emoji}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      <div className="reaction-group">
        <div className="reaction-group-label">Custom</div>
        <div className="reaction-row">
          <button className={`reaction-btn${isCustom ? " selected" : ""}`} onClick={() => setShowCustom((v) => !v)} title="Pick an emoji" style={{ position: "relative" }}>
            <span className="reaction-emoji">{customEmoji || "＋"}</span>
          </button>
        </div>
        {showCustom && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6, padding: "8px", background: "white", border: "1px solid var(--border)", borderRadius: "var(--radius)", boxShadow: "var(--shadow)" }}>
            {CUSTOM_EMOJIS.map((e) => (
              <button key={e} className={`reaction-btn${value === "custom:" + e ? " selected" : ""}`} style={{ width: 36, height: 36, padding: 0 }} onClick={() => { onChange(value === "custom:" + e ? null : "custom:" + e); setShowCustom(false); }} title={e}>
                <span className="reaction-emoji">{e}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function LikertAnswer({ question, value, onChange }) {
  return (
    <div>
      <div className="likert-scale">
        {[1, 2, 3, 4, 5].map((n) => <button key={n} className={`likert-btn${value === n ? " selected" : ""}`} onClick={() => onChange(n)}>{n}</button>)}
        {value && <span className="text-sm text-muted" style={{ marginLeft: 6 }}>Selected: {value}</span>}
      </div>
      <div className="likert-labels"><span>{question.lowLabel}</span><span>{question.highLabel}</span></div>
    </div>
  );
}
function OpenAnswer({ question, value, onChange }) {
  const handleTranscript = useCallback((t) => onChange((value || "") + " " + t), [value, onChange]);
  const { recording, toggle } = useVoiceInput(handleTranscript);
  return (
    <div>
      <textarea placeholder={question.placeholder || "Your thoughts…"} value={value || ""} onChange={(e) => onChange(e.target.value)} rows={3} />
      <button className={`voice-btn${recording ? " recording" : ""}`} onClick={toggle}>{recording ? "🔴 Recording… click to stop" : "🎙️ Use voice input"}</button>
    </div>
  );
}
function ChoiceAnswer({ question, value, onChange }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {question.options.filter(Boolean).map((opt) => (
        <button key={opt} className={`reaction-btn${value === opt ? " selected" : ""}`} style={{ flexDirection: "row", justifyContent: "flex-start", minWidth: "unset", width: "100%", padding: "9px 14px" }} onClick={() => onChange(opt)}>
          <span style={{ fontSize: 14 }}>{opt}</span>
        </button>
      ))}
    </div>
  );
}
// ─── Answer complete check ────────────────────────────────────────────────────
function isAnswered(answer) {
  if (answer === undefined || answer === null) return false;
  if (typeof answer === "string" && !answer.trim()) return false;
  return true;
}
// ─── Current user hook ────────────────────────────────────────────────────────
function useCurrentUser() {
  const [user, setUser] = useState(() => store.getCurrentUser());
  function login(u) { store.setCurrentUser(u); setUser(u); }
  function logout() { store.clearCurrentUser(); setUser(null); }
  function refresh() { setUser(store.getCurrentUser()); }
  return { user, login, logout, refresh };
}
// ─── Sign In / Register ───────────────────────────────────────────────────────
function SignInView({ onSignedIn, inviteCode = null, inline = false }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  // Steps: "choose" (Google vs external), "form" (manual name/email), "team-setup"
  const [step, setStep] = useState(inviteCode ? "form" : (GOOGLE_CLIENT_ID ? "choose" : "form"));
  const [teamName, setTeamName] = useState("Artium");
  const [error, setError] = useState("");
  const [gsiLoading, setGsiLoading] = useState(false);
  const googleBtnRef = useRef(null);

  const isArtium = isArtiumEmail(email);

  // Load Google Sign-In when on "choose" step
  useEffect(() => {
    if (step !== "choose" || !GOOGLE_CLIENT_ID) return;
    setGsiLoading(true);
    loadGoogleGSI().then(() => {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleGoogleResponse,
      });
      if (googleBtnRef.current) {
        window.google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline",
          size: "large",
          width: 360,
          text: "signin_with",
        });
      }
      setGsiLoading(false);
    }).catch(() => {
      setError("Could not load Google Sign-In. Try refreshing.");
      setGsiLoading(false);
    });
  }, [step]);

  function handleGoogleResponse(response) {
    const payload = decodeJWT(response.credential);
    if (!payload) { setError("Could not verify Google sign-in."); return; }
    const { email: gEmail, name: gName, hd } = payload;
    if (hd !== "artium.ai") {
      setError("Please use your @artium.ai Google account. For non-Artium users, use the external reviewer option below.");
      return;
    }
    // Check if user already exists in a team
    const teams = store.getTeams();
    const existingTeam = Object.values(teams).find((t) =>
      (t.members || []).some((m) => m.email.toLowerCase() === gEmail.toLowerCase())
    );
    if (existingTeam) {
      const member = existingTeam.members.find((m) => m.email.toLowerCase() === gEmail.toLowerCase());
      onSignedIn({ id: member.id, name: member.name, email: member.email, teamIds: [existingTeam.id], activeTeamId: existingTeam.id });
      return;
    }
    // New artium user — save their info and go to team setup
    setName(gName || "");
    setEmail(gEmail || "");
    setStep("team-setup");
  }

  function handleContinue() {
    if (!name.trim() || !email.trim()) { setError("Please enter your name and email."); return; }
    setError("");
    const userId = uid();

    if (inviteCode) {
      const team = store.getTeamByInviteCode(inviteCode);
      if (!team) { setError("That invite link is invalid or has expired."); return; }
      const member = { id: userId, name: name.trim(), email: email.trim(), joinedAt: new Date().toISOString() };
      const updatedTeam = { ...team, members: [...(team.members || []), member] };
      store.saveTeam(updatedTeam);
      onSignedIn({ id: userId, name: name.trim(), email: email.trim(), teamIds: [team.id], activeTeamId: team.id });
      return;
    }

    if (isArtium) {
      const teams = store.getTeams();
      const existingTeam = Object.values(teams).find((t) =>
        (t.members || []).some((m) => m.email.toLowerCase() === email.trim().toLowerCase())
      );
      if (existingTeam) {
        const member = existingTeam.members.find((m) => m.email.toLowerCase() === email.trim().toLowerCase());
        onSignedIn({ id: member.id, name: member.name, email: member.email, teamIds: [existingTeam.id], activeTeamId: existingTeam.id });
        return;
      }
      setStep("team-setup");
    } else {
      onSignedIn({ id: userId, name: name.trim(), email: email.trim(), teamIds: [], activeTeamId: null });
    }
  }

  function handleCreateTeam() {
    if (!teamName.trim()) return;
    const newTeamId = uid();
    const userId = uid();
    const member = { id: userId, name: name.trim(), email: email.trim(), joinedAt: new Date().toISOString(), role: "admin" };
    const team = { id: newTeamId, name: teamName.trim(), members: [member], inviteCode: makeInviteCode(), createdAt: new Date().toISOString(), visibility: "private" };
    store.saveTeam(team);
    onSignedIn({ id: userId, name: name.trim(), email: email.trim(), teamIds: [newTeamId], activeTeamId: newTeamId });
  }
  function handleSkipTeam() {
    const userId = uid();
    onSignedIn({ id: userId, name: name.trim(), email: email.trim(), teamIds: [], activeTeamId: null });
  }

  const cardContent = (
      <div className="auth-card" style={inline ? { boxShadow: "var(--shadow-lg)", maxWidth: "none" } : undefined}>
        {!inline && (
          <div className="auth-logo">
            <div className="auth-logo-mark"><ArtiumMark size={32} /></div>
            <span style={{ fontFamily: "'Lato',sans-serif", fontWeight: 700, fontSize: 17 }}>Artium · Feedback Facilitator</span>
          </div>
        )}
        {inline && step === "choose" && <h2 style={{ marginBottom: 16 }}>Sign in</h2>}

        {step === "choose" ? (
          <>
            <h2 style={{ marginBottom: 6 }}>Welcome</h2>
            <p className="text-sm text-muted" style={{ marginBottom: 24 }}>
              Sign in with your Artium Google account to create or join a team.
            </p>
            {error && <div className="alert alert-warn" style={{ marginBottom: 16 }}>⚠️ {error}</div>}
            <div style={{ display: "flex", justifyContent: "center", marginBottom: 20 }}>
              <div ref={googleBtnRef}>
                {gsiLoading && <div className="text-sm text-muted">Loading Google Sign-In...</div>}
              </div>
            </div>
            <div className="auth-divider"><span>or</span></div>
            <p className="text-sm text-muted" style={{ textAlign: "center", marginBottom: 12 }}>
              Not an Artium member? Reviewing something?
            </p>
            <button className="btn btn-ghost" style={{ width: "100%" }} onClick={() => setStep("form")}>
              Continue as external reviewer →
            </button>
          </>
        ) : step === "form" ? (
          <>
            <h2 style={{ marginBottom: 6 }}>{inviteCode ? "You've been invited!" : "Sign in"}</h2>
            <p className="text-sm text-muted" style={{ marginBottom: 24 }}>
              {inviteCode
                ? "Someone on your team shared this invite. Enter your details to join."
                : "Enter your details to get started."}
            </p>
            {error && <div className="alert alert-warn" style={{ marginBottom: 16 }}>⚠️ {error}</div>}
            <div className="field">
              <label className="label">Your name</label>
              <input type="text" placeholder="e.g. Artimus Aims" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label className="label">Email address</label>
              <input type="text" placeholder="email@website.com" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleContinue()} />
              {isArtium && <div className="hint mt-4" style={{ color: "var(--accent)" }}>✓ Artium email — you can create or join a team.</div>}
            </div>
            <button className="btn btn-primary" style={{ width: "100%" }} onClick={handleContinue} disabled={!name.trim() || !email.trim()}>
              Continue →
            </button>
            {GOOGLE_CLIENT_ID && !inviteCode && (
              <button className="btn btn-ghost" style={{ width: "100%", marginTop: 10, fontSize: 13, color: "var(--muted)" }} onClick={() => setStep("choose")}>
                ← Sign in with Google instead
              </button>
            )}
          </>
        ) : (
          <>
            <h2 style={{ marginBottom: 6 }}>Set up your team</h2>
            <p className="text-sm text-muted" style={{ marginBottom: 24 }}>Give your team a name. You can invite colleagues after signing in.</p>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end", marginBottom: 16 }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label className="label">Team name</label>
                <input type="text" value={teamName} onChange={(e) => setTeamName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreateTeam()} autoFocus />
              </div>
              <button className="btn btn-primary" onClick={handleCreateTeam} disabled={!teamName.trim()} style={{ whiteSpace: "nowrap" }}>Create team →</button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <a style={{ color: "var(--muted)", fontSize: 13, cursor: "pointer" }} onClick={() => setStep(GOOGLE_CLIENT_ID ? "choose" : "form")}>← Back</a>
              <a style={{ color: "var(--muted)", fontSize: 13, cursor: "pointer" }} onClick={handleSkipTeam}>Skip for now →</a>
            </div>
            {store.getPublicTeams().length > 0 && (
              <div style={{ marginTop: 24 }}>
                <div style={{ borderTop: "1px solid var(--border)", margin: "0 0 16px" }} />
                <div className="eyebrow" style={{ marginBottom: 8 }}>Or join an existing team</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {store.getPublicTeams().map((t) => (
                    <div key={t.id} className="card" style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, marginBottom: 0 }}>
                      <div style={{ flex: 1 }}>
                        <div className="bold text-sm">{t.name}</div>
                        <div className="text-sm text-muted">{t.members.length} member{t.members.length !== 1 ? "s" : ""}</div>
                      </div>
                      <button className="btn btn-primary btn-sm" onClick={() => {
                        const userId = uid();
                        const member = { id: userId, name: name.trim(), email: email.trim(), joinedAt: new Date().toISOString() };
                        const updated = { ...t, members: [...(t.members || []), member] };
                        store.saveTeam(updated);
                        onSignedIn({ id: userId, name: name.trim(), email: email.trim(), teamIds: [t.id], activeTeamId: t.id });
                      }}>Join →</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
  );

  if (inline) return cardContent;
  return (
    <div className="auth-page">
      <StyleInjector />
      {cardContent}
    </div>
  );
}
// ─── Join Team View (via invite link) ─────────────────────────────────────────
function JoinTeamView({ inviteCode }) {
  const { login } = useCurrentUser();
  const team = store.getTeamByInviteCode(inviteCode);
  if (!team) return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo"><div className="auth-logo-mark"><ArtiumMark size={32} /></div><span style={{ fontFamily: "'Lato',sans-serif", fontWeight: 700, fontSize: 17 }}>Artium · Feedback Facilitator</span></div>
        <h2 style={{ marginBottom: 8 }}>Invalid invite link</h2>
        <p className="text-sm text-muted" style={{ marginBottom: 20 }}>This link may have expired or already been used. Ask your team admin for a new one.</p>
        <button className="btn btn-ghost" onClick={() => navigate("")}>Go home</button>
      </div>
    </div>
  );
  return <SignInView inviteCode={inviteCode} onSignedIn={(u) => { login(u); navigate("requests"); }} />;
}
// ─── Team view ────────────────────────────────────────────────────────────────
function TeamView({ user, teamId: routeTeamId }) {
  const viewingTeamId = routeTeamId || user?.activeTeamId;
  const team = viewingTeamId ? store.getTeam(viewingTeamId) : null;
  const [inviteCopied, setInviteCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [teamNameInput, setTeamNameInput] = useState(team?.name || "");
  const [newInviteCode, setNewInviteCode] = useState(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inlineTeamName, setInlineTeamName] = useState("Artium");
  const [showCreateInline, setShowCreateInline] = useState(false);
  const [teamRequests, setTeamRequests] = useState([]);

  useEffect(() => {
    if (viewingTeamId) store.listRequestsFiltered({ teamId: viewingTeamId }).then(setTeamRequests);
  }, [viewingTeamId]);

  function handleInlineCreateTeam() {
    if (!inlineTeamName.trim()) return;
    const newTeamId = uid();
    const member = { id: user.id, name: user.name, email: user.email, joinedAt: new Date().toISOString(), role: "admin" };
    const newTeam = { id: newTeamId, name: inlineTeamName.trim(), members: [member], inviteCode: makeInviteCode(), createdAt: new Date().toISOString(), visibility: "private" };
    store.saveTeam(newTeam);
    const updatedUser = { ...user, teamIds: [...(user.teamIds || []), newTeamId], activeTeamId: newTeamId };
    store.setCurrentUser(updatedUser);
    window.location.reload();
  }

  if (!team) return (
    <div className="app"><StyleInjector /><TopBar activeView="team" user={user} />
      <div className="page" style={{ maxWidth: 580 }}>
        <div className="eyebrow">Team</div>
        <h1 className="page-title">Your team awaits</h1>
        <div className="card empty-state-card" style={{ textAlign: "center", padding: "48px 32px" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>👥</div>
          <h2 style={{ fontSize: 20, marginBottom: 8 }}>You're not on a team yet</h2>
          <p className="text-sm text-muted" style={{ marginBottom: 24, maxWidth: 360, margin: "0 auto 24px" }}>
            Teams let you collaborate on feedback requests, share files, and invite colleagues.
            {isArtiumEmail(user?.email || "")
              ? " Create a team to get started, or ask a colleague for an invite link."
              : " Ask a colleague for an invite link to join their team."}
          </p>
          {isArtiumEmail(user?.email || "") && !showCreateInline && (
            <button className="btn btn-primary" onClick={() => setShowCreateInline(true)}>Create a team →</button>
          )}
          {showCreateInline && (
            <div style={{ maxWidth: 320, margin: "0 auto", textAlign: "left" }}>
              <div className="field">
                <label className="label">Team name</label>
                <input type="text" value={inlineTeamName} onChange={(e) => setInlineTeamName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleInlineCreateTeam()} autoFocus />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-primary" onClick={handleInlineCreateTeam} disabled={!inlineTeamName.trim()}>Create team →</button>
                <button className="btn btn-ghost" onClick={() => setShowCreateInline(false)}>Cancel</button>
              </div>
            </div>
          )}
          {isArtiumEmail(user?.email || "") && <BrowseTeamsView user={user} />}
        </div>
      </div>
      <Footer />
    </div>
  );

  const inviteUrl = getInviteUrl(newInviteCode || team.inviteCode);

  function copyInvite() {
    navigator.clipboard.writeText(inviteUrl);
    setInviteCopied(true);
    setTimeout(() => setInviteCopied(false), 2500);
  }
  function saveTeamName() {
    if (!teamNameInput.trim()) return;
    const updated = { ...team, name: teamNameInput.trim() };
    store.saveTeam(updated);
    setEditingName(false);
  }
  function rotateInvite() {
    const code = makeInviteCode();
    const updated = { ...team, inviteCode: code };
    store.saveTeam(updated);
    setNewInviteCode(code);
  }
  function removeMember(memberId) {
    if (memberId === user.id) { alert("You can't remove yourself."); return; }
    const updated = { ...team, members: team.members.filter((m) => m.id !== memberId) };
    store.saveTeam(updated);
    window.location.reload();
  }
  function sendEmailInvite() {
    if (!inviteEmail.trim()) return;
    const subject = encodeURIComponent(`Join ${team.name} on Feedback Facilitator`);
    const body = encodeURIComponent(`Hi!\n\nYou've been invited to join the "${team.name}" team on Feedback Facilitator.\n\nClick this link to join:\n${inviteUrl}\n\nSee you there!`);
    window.open(`mailto:${inviteEmail.trim()}?subject=${subject}&body=${body}`, "_self");
    setInviteEmail("");
  }

  return (
    <div className="app"><StyleInjector /><TopBar activeView="team" user={user} />
      <div className="page" style={{ maxWidth: 620 }}>
        <div className="eyebrow">Your team</div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          {editingName
            ? <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1 }}>
                <input type="text" value={teamNameInput} onChange={(e) => setTeamNameInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveTeamName()} autoFocus style={{ fontSize: 24, fontWeight: 700, fontFamily: "'Lato',sans-serif" }} />
                <button className="btn btn-primary btn-sm" onClick={saveTeamName}>Save</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditingName(false)}>Cancel</button>
              </div>
            : <h1 className="page-title" style={{ marginBottom: 0 }}>{team.name} <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, marginLeft: 8 }} onClick={() => { setTeamNameInput(team.name); setEditingName(true); }}>✏️ Rename</button></h1>
          }
        </div>
        <p className="page-subtitle">{team.members.length} member{team.members.length !== 1 ? "s" : ""} · Created {new Date(team.createdAt).toLocaleDateString()}</p>

        {teamRequests.filter((r) => r.visibility === "team" && r.status !== "archived").length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, marginBottom: 14 }}>Shared Requests</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {teamRequests.filter((r) => r.visibility === "team" && r.status !== "archived").map((req) => (
                <div key={req.id} className="card" style={{ padding: "14px 18px", marginBottom: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 12 }} onClick={() => navigate("results/" + req.id)}>
                  <div style={{ flex: 1 }}>
                    <div className="bold text-sm">{req.title}</div>
                    <div className="text-sm text-muted">{new Date(req.created_at).toLocaleDateString()}{req.focusOn ? ` · ${req.focusOn}` : ""}</div>
                  </div>
                  <span className="vis-badge vis-team">👥 {team?.name || "Team"}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <h2 style={{ fontSize: 18, marginBottom: 14 }}>Members</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {team.members.map((m) => (
            <div key={m.id} className="card" style={{ padding: "12px 16px", marginBottom: 0, display: "flex", alignItems: "center", gap: 12 }}>
              <div className="avatar" style={{ width: 36, height: 36, fontSize: 14 }}>{m.name.charAt(0).toUpperCase()}</div>
              <div style={{ flex: 1 }}>
                <div className="bold text-sm">{m.name} {m.id === user.id && <span className="tag" style={{ marginLeft: 4 }}>you</span>}</div>
                <div className="text-sm text-muted">{m.email}</div>
              </div>
              {m.role === "admin" && <span className="vis-badge vis-team">admin</span>}
              {m.id !== user.id && (
                <button className="btn btn-ghost btn-sm" style={{ color: "var(--muted)", fontSize: 12 }} onClick={() => removeMember(m.id)}>Remove</button>
              )}
            </div>
          ))}
        </div>

        <div className="card" style={{ marginTop: 24, padding: "20px 24px" }}>
          <div className="bold mb-8">Invite people</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <input type="email" placeholder="colleague@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && inviteEmail.trim() && sendEmailInvite()} style={{ flex: 1 }} />
            <button className="btn btn-primary btn-sm" onClick={sendEmailInvite} disabled={!inviteEmail.trim()}>Send invite</button>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <div className="share-box" style={{ flex: 1, marginBottom: 0 }}>
              <div className="share-url" style={{ fontSize: 12 }}>{inviteUrl}</div>
              <button className="btn btn-primary btn-sm" onClick={copyInvite}>{inviteCopied ? "✓ Copied!" : "Copy link"}</button>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: "var(--muted)" }} onClick={rotateInvite}>↻ Regenerate link</button>
            {(team.members.find((m) => m.id === user.id)?.role === "admin") && (
              <button
                className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: "var(--muted)" }}
                onClick={() => {
                  const updated = { ...team, visibility: team.visibility === "public" ? "private" : "public" };
                  store.saveTeam(updated);
                  window.location.reload();
                }}
              >
                {team.visibility === "public" ? "🌐 Public team" : "🔒 Private team"}
              </button>
            )}
          </div>
        </div>

        {(teamRequests.length === 0 || team.members.length < 2) && (
          <div className="card" style={{ marginTop: 20, textAlign: "center", padding: "36px 28px", borderLeft: "3px solid var(--accent)" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🚀</div>
            <h2 style={{ fontSize: 18, marginBottom: 8 }}>Get your team going!</h2>
            <p className="text-sm text-muted" style={{ marginBottom: 20 }}>
              {teamRequests.length === 0 && team.members.length < 2
                ? "Start by inviting colleagues and creating your first feedback request."
                : teamRequests.length === 0
                ? "Your team is set up! Create your first feedback request to start collecting insights."
                : "Great start! Invite more team members so they can review and provide feedback."}
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              {teamRequests.length === 0 && (
                <button className="btn btn-primary" onClick={() => navigate("create")}>✨ Create your first request</button>
              )}
              {team.members.length < 2 && (
                <button className="btn btn-ghost" onClick={copyInvite}>{inviteCopied ? "✓ Link copied!" : "📋 Copy invite link"}</button>
              )}
            </div>
          </div>
        )}
      </div>
      <Footer />
    </div>
  );
}
// ─── Browse public teams ──────────────────────────────────────────────────────
function BrowseTeamsView({ user, onJoinTeam }) {
  const publicTeams = store.getPublicTeams();
  const availableTeams = publicTeams.filter((t) =>
    !(user?.teamIds || []).includes(t.id) &&
    !(t.members || []).some((m) => m.email?.toLowerCase() === user?.email?.toLowerCase())
  );
  if (availableTeams.length === 0) return null;

  function joinTeam(team) {
    const member = { id: user.id, name: user.name, email: user.email, joinedAt: new Date().toISOString() };
    const updated = { ...team, members: [...(team.members || []), member] };
    store.saveTeam(updated);
    const updatedUser = { ...user, teamIds: [...(user.teamIds || []), team.id], activeTeamId: team.id };
    store.setCurrentUser(updatedUser);
    if (onJoinTeam) onJoinTeam(updatedUser);
    else window.location.reload();
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>Public teams</div>
      <p className="text-sm text-muted" style={{ marginBottom: 16 }}>These teams are open to anyone with an @artium.ai email.</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {availableTeams.map((t) => (
          <div key={t.id} className="card" style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 12, marginBottom: 0 }}>
            <div style={{ flex: 1 }}>
              <div className="bold text-sm">{t.name}</div>
              <div className="text-sm text-muted">{t.members.length} member{t.members.length !== 1 ? "s" : ""}</div>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => joinTeam(t)}>Join →</button>
          </div>
        ))}
      </div>
    </div>
  );
}
// ─── New Team View (post-signup team creation) ───────────────────────────────
function NewTeamView({ user }) {
  const [teamName, setTeamName] = useState("");
  const [error, setError] = useState("");

  function handleCreate() {
    if (!teamName.trim()) return;
    const newTeamId = uid();
    const member = { id: user.id, name: user.name, email: user.email, joinedAt: new Date().toISOString(), role: "admin" };
    const team = { id: newTeamId, name: teamName.trim(), members: [member], inviteCode: makeInviteCode(), createdAt: new Date().toISOString(), visibility: "private" };
    store.saveTeam(team);
    const updatedUser = { ...user, teamIds: [...(user.teamIds || []), newTeamId], activeTeamId: newTeamId };
    store.setCurrentUser(updatedUser);
    window.location.hash = "team/" + newTeamId;
    window.location.reload();
  }

  return (
    <div className="app"><StyleInjector /><TopBar activeView="" user={user} />
      <div className="page" style={{ maxWidth: 540 }}>
        <div className="eyebrow">Teams</div>
        <h1 className="page-title">Create a new team</h1>
        <p className="page-subtitle">Teams let you collaborate on feedback requests, share files, and invite colleagues.</p>
        {error && <div className="alert alert-warn" style={{ marginBottom: 16 }}>⚠️ {error}</div>}
        <div className="card" style={{ padding: 24 }}>
          <div className="field">
            <label className="label">Team name</label>
            <input type="text" placeholder="e.g. Design Team, Product, Engineering" value={teamName} onChange={(e) => setTeamName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreate()} autoFocus />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn btn-primary" onClick={handleCreate} disabled={!teamName.trim()}>Create team →</button>
            <button className="btn btn-ghost" onClick={() => navigate("requests")}>Cancel</button>
          </div>
        </div>
        {isArtiumEmail(user?.email || "") && <BrowseTeamsView user={user} />}
      </div>
      <Footer />
    </div>
  );
}
// ════════════════════════════════════════════════════════════════════════════════
// VIEWS
// ════════════════════════════════════════════════════════════════════════════════
function HomeView({ user }) {
  return (
    <div className="app"><StyleInjector /><TopBar activeView="home" user={user} />
      <div className="hero">
        <div className="eyebrow">Artium · Feedback Facilitator</div>
        <h1>Feedback that<br /><em>moves things forward.</em></h1>
        <p>Collect structured, useful feedback on prototypes, designs, and docs — distributed via Slack, reviewed in context, synthesized into action.</p>
        <button className="btn btn-accent" style={{ fontSize: "16px", padding: "12px 28px" }} onClick={() => navigate("create")}>Create a feedback request →</button>
        <div className="feature-grid">
          {[
            { icon: "🔗", title: "Any content type", desc: "Links, images, PDFs, videos, code — all displayed in-context." },
            { icon: "🎯", title: "Focus hotspots", desc: "Draw attention to exactly what needs eyes on it, per question." },
            { icon: "💬", title: "Slack-native", desc: "Send structured requests to your channel with one click." },
            { icon: "✨", title: "AI synthesis", desc: "Responses distilled into prioritized action items." },
          ].map((f) => (
            <div className="feature-tile" key={f.title}><div className="feature-icon">{f.icon}</div><div className="feature-title">{f.title}</div><div className="feature-desc">{f.desc}</div></div>
          ))}
        </div>
      </div>
      <Footer />
    </div>
  );
}
// ─── Create view ──────────────────────────────────────────────────────────────
function CreateView({ editId = null, user = null }) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ title: "", context: "", contentItems: [], focusOn: "", ignoreNote: "", preBiasQuestions: [], deadline: "", questions: [], addFirstImpression: false, addClosingQuestion: false, visibility: "private", sharedWith: [], folderId: "", allowAnonymous: false });
  const [shareUrl, setShareUrl] = useState(null);
  const [requestId, setRequestId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedSlack, setCopiedSlack] = useState(false);
  const [slackSent, setSlackSent] = useState(false);
  const [slackSending, setSlackSending] = useState(false);
  const [showFirstImpressionPreview, setShowFirstImpressionPreview] = useState(false);
  const [showClosingPreview, setShowClosingPreview] = useState(false);
  useEffect(() => {
    if (!editId) return;
    store.getRequest(editId).then((req) => {
      if (!req) return;
      setForm({ title: req.title || "", context: req.context || "", contentItems: req.contentItems || [], focusOn: req.focusOn || "", ignoreNote: req.ignoreNote || "", preBiasQuestions: req.preBiasQuestions || [], deadline: req.deadline || "", questions: req.questions || [], addFirstImpression: req.addFirstImpression || false, addClosingQuestion: req.addClosingQuestion || false, visibility: req.visibility || "private", sharedWith: req.sharedWith || [], folderId: req.folderId || "", allowAnonymous: req.allowAnonymous || false });
      const url = `${window.location.origin}${window.location.pathname}#review/${editId}`;
      setShareUrl(url); setRequestId(editId);
    });
  }, [editId]);
  function patch(key, val) { setForm((f) => ({ ...f, [key]: val })); }
  async function generateLink() {
    setSaving(true);
    if (editId) {
      const existing = await store.getRequest(editId);
      const updated = { ...(existing || {}), ...form, id: editId, updated_at: new Date().toISOString() };
      await store.saveRequest(updated);
      setSaving(false); setStep(3);
    } else {
      const id = uid();
      const request = { id, ...form, created_at: new Date().toISOString(), status: "active", tags: [], ownerId: user?.id || null, teamId: user?.activeTeamId || null };
      await store.saveRequest(request);
      const url = `${window.location.origin}${window.location.pathname}#review/${id}`;
      setShareUrl(url); setRequestId(id); setStep(3); setSaving(false);
    }
  }
  function copyLink() { navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  function slackText() {
    const cfg = store.getSlackConfig();
    const deadlineStr = form.deadline ? formatDeadline(form.deadline) : "[DATE]";
    return [
      `👋 ${cfg.senderName || "The team"} is requesting feedback on *${form.title}*`,
      `It should take ~10 min. Please review by ${deadlineStr}.`,
      form.focusOn ? `🎯 *Focus on:* ${form.focusOn}` : null,
      form.ignoreNote ? `⏭️ *Skip:* ${form.ignoreNote}` : null,
      ``, `→ ${shareUrl}`,
    ].filter((l) => l !== null).join("\n");
  }
  function copySlack() { navigator.clipboard.writeText(slackText()); setCopiedSlack(true); setTimeout(() => setCopiedSlack(false), 2500); }
  async function sendToSlack() {
    const cfg = store.getSlackConfig();
    if (!cfg.webhookUrl) { alert("Add your Slack webhook URL in Settings (⚙) first."); return; }
    setSlackSending(true);
    try { await sendSlackMessage(cfg.webhookUrl, slackText()); setSlackSent(true); setTimeout(() => setSlackSent(false), 4000); }
    catch { alert("Slack send failed — check your webhook URL in Settings."); }
    setSlackSending(false);
  }
  return (
    <div className="app"><StyleInjector />
      <TopBar activeView="create" user={user} />
      <div className="page">
        <div className="progress-bar"><div className="progress-fill" style={{ width: `${(step / 3) * 100}%` }} /></div>
        {step === 1 && (
          <>
            <div className="eyebrow">Step 1 of 3</div>
            <h1 className="page-title">Set up your request</h1>
            <p className="page-subtitle">Give reviewers everything they need to give useful feedback.</p>
            <div className="field">
              <label className="label">Request title *</label>
              <input type="text" placeholder="e.g. Agent Builder — Guardrails concept review" value={form.title} onChange={(e) => patch("title", e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Introduction: Context/Scenario *</label>
              <textarea placeholder="e.g. You're a PM setting up an AI agent for eBay's seller support team…" value={form.context} onChange={(e) => patch("context", e.target.value)} rows={4} />
              <div className="hint">Required — this is the first thing reviewers read. Write this like a usability test scenario to get reviewers in the right headspace.</div>
            </div>
            <PreBiasBuilder questions={form.preBiasQuestions} onChange={(q) => patch("preBiasQuestions", q)} />
            <ContentInput items={form.contentItems} onChange={(items) => patch("contentItems", items)} />
            <div className="field">
              <label className="label">What needs feedback</label>
              <input type="text" placeholder="e.g. Terminology comprehension, task friction, mental model of guardrails" value={form.focusOn} onChange={(e) => patch("focusOn", e.target.value)} />
            </div>
            <div className="field">
              <label className="label">What doesn't need feedback</label>
              <input type="text" placeholder="e.g. Visual design, color choices, copy tone" value={form.ignoreNote} onChange={(e) => patch("ignoreNote", e.target.value)} />
            </div>
            <div className="field">
              <label className="label">Deadline <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span></label>
              <input type="date" value={form.deadline} onChange={(e) => patch("deadline", e.target.value)} style={{ maxWidth: 220 }} />
              <div className="hint">Shown to reviewers and included in your Slack message.</div>
            </div>
            {/* Sharing options — only visible when user is in a team */}
            {user?.activeTeamId && (() => {
              const team = store.getTeam(user.activeTeamId);
              const folders = store.getFolders(user.activeTeamId);
              return (
                <>
                  <div className="field">
                    <label className="label">Share with</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {[
                        { value: "private", icon: "🔒", label: "Just me", desc: "Only you can see this request." },
                        { value: "team", icon: "👥", label: `${team?.name} (whole team)`, desc: "All team members can see this in their Requests list." },
                        { value: "members", icon: "✉️", label: "Specific members", desc: "Choose individual team members." },
                        { value: "external", icon: "🌐", label: "External only", desc: "Not visible in the team — share the link manually." },
                      ].map((opt) => (
                        <label key={opt.value} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "10px 12px", border: `1px solid ${form.visibility === opt.value ? "var(--accent)" : "var(--border)"}`, borderRadius: "var(--radius)", background: form.visibility === opt.value ? "var(--accent-light)" : "white", transition: "all .15s" }}>
                          <input type="radio" name="visibility" value={opt.value} checked={form.visibility === opt.value} onChange={() => patch("visibility", opt.value)} style={{ marginTop: 2, accentColor: "var(--accent)" }} />
                          <div>
                            <div style={{ fontWeight: 500, fontSize: 14 }}>{opt.icon} {opt.label}</div>
                            <div className="hint" style={{ marginTop: 2 }}>{opt.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                  {form.visibility === "members" && team?.members && (
                    <div className="field">
                      <label className="label">Select members</label>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {team.members.filter((m) => m.id !== user.id).map((m) => (
                          <label key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "7px 10px", border: "1px solid var(--border)", borderRadius: "var(--radius)", background: "white" }}>
                            <input type="checkbox" checked={form.sharedWith.includes(m.id)} onChange={(e) => { const s = e.target.checked ? [...form.sharedWith, m.id] : form.sharedWith.filter((id) => id !== m.id); patch("sharedWith", s); }} style={{ accentColor: "var(--accent)" }} />
                            <div className="avatar" style={{ width: 24, height: 24, fontSize: 10 }}>{m.name.charAt(0).toUpperCase()}</div>
                            <span className="text-sm">{m.name}</span>
                            <span className="text-sm text-muted">({m.email})</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  {folders.length > 0 && (
                    <div className="field">
                      <label className="label">Add to folder <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span></label>
                      <select value={form.folderId} onChange={(e) => patch("folderId", e.target.value)}>
                        <option value="">— No folder —</option>
                        {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </div>
                  )}
                  <div className="field">
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "12px 14px", border: `1px solid ${form.allowAnonymous ? "var(--accent)" : "var(--border)"}`, borderRadius: "var(--radius)", background: form.allowAnonymous ? "var(--accent-light)" : "white", transition: "all .15s" }}>
                      <input type="checkbox" checked={form.allowAnonymous} onChange={(e) => patch("allowAnonymous", e.target.checked)} style={{ accentColor: "var(--accent)" }} />
                      <div>
                        <div style={{ fontWeight: 500, fontSize: 14 }}>Allow anonymous responses</div>
                        <div className="hint" style={{ marginTop: 2 }}>When enabled, reviewers can choose to submit feedback anonymously.</div>
                      </div>
                    </label>
                  </div>
                </>
              );
            })()}
            <button className="btn btn-primary" onClick={() => setStep(2)} disabled={!form.title || form.contentItems.length === 0 || !form.context.trim()}>Next: Build questions →</button>
          </>
        )}
        {step === 2 && (
          <>
            <div className="eyebrow">Step 2 of 3</div>
            <h1 className="page-title">Build your questions</h1>
            <p className="page-subtitle">Add structured questions. Use hotspots to direct attention to specific areas for each question.</p>
            {form.questions.length === 0 && (
              <div className="alert alert-info" style={{ marginBottom: 18 }}>
                💡 Mix Likert questions (quantitative signal) with 1–2 bounded open-ended prompts. Add hotspots to direct reviewer attention per question.
              </div>
            )}
            <div className="field" style={{ marginBottom: 16, background: "var(--warm)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
                  <input type="checkbox" checked={form.addFirstImpression} onChange={(e) => patch("addFirstImpression", e.target.checked)} style={{ width: "auto", cursor: "pointer" }} />
                  Start with "First impression?" reaction
                </label>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setShowFirstImpressionPreview((v) => !v)}>{showFirstImpressionPreview ? "Hide preview" : "Preview"}</button>
              </div>
              <div className="hint mt-4">Asks reviewers for a gut-reaction emoji before they answer your questions.</div>
              {showFirstImpressionPreview && (
                <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "16px", background: "white" }}>
                  <div className="text-sm text-muted" style={{ marginBottom: 8, fontStyle: "italic" }}>Reviewer will see:</div>
                  <div className="bold mb-8">First impression?</div>
                  <div className="text-sm text-muted mb-12">Gut reaction before you dig in — required to continue.</div>
                  <ReactionAnswer value={null} onChange={() => {}} />
                </div>
              )}
            </div>
            <QuestionBuilder questions={form.questions} onChange={(q) => patch("questions", q)} contentItems={form.contentItems} />
            <div className="field" style={{ marginTop: 16, background: "var(--warm)", border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 14, fontWeight: 500 }}>
                  <input type="checkbox" checked={form.addClosingQuestion} onChange={(e) => patch("addClosingQuestion", e.target.checked)} style={{ width: "auto", cursor: "pointer" }} />
                  End with "Is there anything else you'd like to add?"
                </label>
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 12, padding: "4px 10px" }} onClick={() => setShowClosingPreview((v) => !v)}>{showClosingPreview ? "Hide preview" : "Preview"}</button>
              </div>
              <div className="hint mt-4">Appends an optional open-ended catch-all question after your structured questions.</div>
              {showClosingPreview && (
                <div style={{ marginTop: 12, border: "1px solid var(--border)", borderRadius: "var(--radius)", padding: "16px", background: "white" }}>
                  <div className="text-sm text-muted" style={{ marginBottom: 8, fontStyle: "italic" }}>Reviewer will see:</div>
                  <div className="step-tag" style={{ marginBottom: 8 }}>Final question</div>
                  <h2 style={{ fontSize: 19, marginBottom: 14 }}>Is there anything else you'd like to add?</h2>
                  <textarea placeholder="Any other thoughts, observations, or feedback…" disabled rows={3} style={{ opacity: 0.6 }} />
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setStep(1)}>← Back</button>
              <button className="btn btn-primary" onClick={generateLink} disabled={saving || form.questions.length === 0}>{saving ? (editId ? "Saving…" : "Generating…") : (editId ? "Save changes →" : "Generate share link →")}</button>
            </div>
          </>
        )}
        {step === 3 && shareUrl && (
          <>
            <div className="eyebrow">Step 3 of 3</div>
            <h1 className="page-title">{editId ? "Changes saved ✓" : "Your request is live"}</h1>
            <p className="page-subtitle">{editId ? "Your feedback request has been updated. The review link stays the same." : "Share this link — it contains all content and the feedback form in one page."}</p>
            <div className="card">
              <div className="bold mb-8">Share link</div>
              <div className="share-box">
                <div className="share-url">{shareUrl}</div>
                <button className="btn btn-primary btn-sm" onClick={copyLink}>{copied ? "✓ Copied" : "Copy"}</button>
              </div>
              <div className="hint mt-8">Each reviewer types their name — no login needed.</div>
            </div>
            <div className="card" style={{ background: "var(--warm)", borderStyle: "dashed" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <div className="bold">Slack message</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={copySlack}>{copiedSlack ? "✓ Copied!" : "📋 Copy"}</button>
                  <button className="btn btn-slack btn-sm" onClick={sendToSlack} disabled={slackSending}>{slackSent ? "✓ Sent!" : slackSending ? "Sending…" : "💬 Send to Slack"}</button>
                </div>
              </div>
              <div className="slack-msg-box">
                👋 Your feedback is requested on <strong>{form.title}</strong><br />
                Please review by {form.deadline ? formatDeadline(form.deadline) : "[DATE]"}.<br />
                {form.focusOn && <>🎯 <strong>Focus on:</strong> {form.focusOn}<br /></>}
                {form.ignoreNote && <>⏭️ <strong>Not needed today:</strong> {form.ignoreNote}<br /></>}
                <br />→ {shareUrl}
              </div>
              {slackSent && <div className="alert alert-success mt-8" style={{ marginTop: 10, marginBottom: 0 }}>✓ Sent to {store.getSlackConfig().channel || "your Slack channel"}</div>}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              {!editId && <button className="btn btn-ghost" onClick={() => navigate("create")}>+ New request</button>}
              <button className="btn btn-ghost" onClick={() => navigate("requests")}>View all requests</button>
              <button className="btn btn-primary" onClick={() => navigate(`results/${requestId}`)}>View results →</button>
            </div>
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
// ─── Requests view ────────────────────────────────────────────────────────────
function RequestsView({ user }) {
  const [requests, setRequests] = useState([]);
  const [responseCounts, setResponseCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState("date_desc");
  const [filterTag, setFilterTag] = useState("");
  const [filterFolder, setFilterFolder] = useState("");
  const [inviteDismissed, setInviteDismissed] = useState(false);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [reshareId, setReshareId] = useState(null);
  const [reshareCopied, setReshareCopied] = useState(false);
  const [tagInput, setTagInput] = useState({ id: null, value: "" });
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [showArchived, setShowArchived] = useState(false);
  const [viewMode, setViewMode] = useState("list"); // list | grid
  const [newFolder, setNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [folders, setFolders] = useState(() => store.getFolders(user?.activeTeamId));

  useEffect(() => { load(); const t = setInterval(refreshCounts, 30000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!openMenuId) return;
    const close = (e) => { if (!e.target.closest(".req-menu") && !e.target.closest(".req-actions button")) setOpenMenuId(null); };
    const t = setTimeout(() => document.addEventListener("click", close), 0);
    return () => { clearTimeout(t); document.removeEventListener("click", close); };
  }, [openMenuId]);

  async function load() {
    setLoading(true);
    const reqs = await store.listRequestsFiltered({ userId: user?.id, teamId: user?.activeTeamId });
    setRequests(reqs);
    const counts = {};
    await Promise.all(reqs.map(async (req) => { const res = await store.getResponses(req.id); counts[req.id] = res.length; }));
    setResponseCounts(counts);
    setLoading(false);
  }
  async function refreshCounts() {
    const reqs = await store.listRequestsFiltered({ userId: user?.id, teamId: user?.activeTeamId });
    const counts = {};
    await Promise.all(reqs.map(async (req) => { const res = await store.getResponses(req.id); counts[req.id] = res.length; }));
    setResponseCounts(counts);
  }
  function getNewCount(req) { return Math.max(0, (responseCounts[req.id] || 0) - store.getSeenCount(req.id)); }

  async function handleArchive(id) {
    const req = requests.find((r) => r.id === id);
    if (!req) return;
    const updated = { ...req, status: req.status === "archived" ? "active" : "archived" };
    await store.saveRequest(updated);
    setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }
  async function handleDelete(id) {
    await store.deleteRequest(id);
    setRequests((prev) => prev.filter((r) => r.id !== id));
    setConfirmDeleteId(null);
  }
  async function exportAllCSV() {
    const escCSV = (v) => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') || s.includes("\n") ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const resolveEmoji = (val) => { if (!val) return ""; const found = REACTIONS.find((r) => r.label === val); if (found) return found.emoji + " " + val; if (val.startsWith("custom:")) return val.slice(7); return val; };
    const headers = ["Request Title", "Reviewer", "Submitted", "First Impression", "Question", "Answer", "Closing Answer"];
    const rows = [];
    for (const req of requests) {
      const resps = await store.getResponses(req.id);
      if (resps.length === 0) continue;
      const qs = req.questions || [];
      for (const r of resps) {
        if (qs.length > 0) {
          qs.forEach((q) => {
            const ans = r.answers[q.id];
            rows.push([req.title, r.reviewer_name, new Date(r.submitted_at).toLocaleDateString(), resolveEmoji(r.initial_reaction), q.title || q.prompt || "", q.type === "reaction" ? resolveEmoji(ans) : (ans ?? ""), r.closing_answer || ""].map(escCSV).join(","));
          });
        } else {
          rows.push([req.title, r.reviewer_name, new Date(r.submitted_at).toLocaleDateString(), resolveEmoji(r.initial_reaction), "", "", r.closing_answer || ""].map(escCSV).join(","));
        }
      }
    }
    const csv = [headers.map(escCSV).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "all_feedback_results.csv"; a.click(); URL.revokeObjectURL(a.href);
  }
  const requestsWithResponses = Object.values(responseCounts).filter((c) => c > 0).length;

  async function handleDuplicate(id) {
    const req = requests.find((r) => r.id === id);
    if (!req) return;
    const newReq = { ...req, id: uid(), title: req.title + " (copy)", created_at: new Date().toISOString(), status: "active" };
    await store.saveRequest(newReq);
    setRequests((prev) => [newReq, ...prev]);
  }
  async function addTag(id, tag) {
    if (!tag.trim()) return;
    const req = requests.find((r) => r.id === id);
    if (!req) return;
    const tags = [...new Set([...(req.tags || []), tag.trim()])];
    const updated = { ...req, tags };
    await store.saveRequest(updated);
    setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
    setTagInput({ id: null, value: "" });
  }
  async function removeTag(id, tag) {
    const req = requests.find((r) => r.id === id);
    if (!req) return;
    const updated = { ...req, tags: (req.tags || []).filter((t) => t !== tag) };
    await store.saveRequest(updated);
    setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
  }

  const allTags = [...new Set(requests.flatMap((r) => r.tags || []))];

  function createFolder() {
    if (!newFolderName.trim()) return;
    const folder = { id: uid(), name: newFolderName.trim(), teamId: user?.activeTeamId || null, createdAt: new Date().toISOString() };
    store.saveFolder(folder);
    setFolders(store.getFolders(user?.activeTeamId));
    setNewFolderName(""); setNewFolder(false);
    setFilterFolder(folder.id);
  }
  function deleteFolder(folderId) {
    store.deleteFolder(folderId);
    if (filterFolder === folderId) setFilterFolder("");
    setFolders(store.getFolders(user?.activeTeamId));
  }

  // Sort + filter
  let sorted = [...requests];
  if (sortBy === "date_desc") sorted.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  else if (sortBy === "date_asc") sorted.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else if (sortBy === "responses_desc") sorted.sort((a, b) => (responseCounts[b.id] || 0) - (responseCounts[a.id] || 0));
  else if (sortBy === "responses_asc") sorted.sort((a, b) => (responseCounts[a.id] || 0) - (responseCounts[b.id] || 0));
  if (filterTag) sorted = sorted.filter((r) => (r.tags || []).includes(filterTag));
  if (filterFolder) sorted = sorted.filter((r) => r.folderId === filterFolder);

  const active = sorted.filter((r) => !r.status || r.status === "active");
  const completed = sorted.filter((r) => r.status === "completed");
  const archived = sorted.filter((r) => r.status === "archived");

  const reviewUrlFor = (id) => `${window.location.origin}${window.location.pathname}#review/${id}`;

  function visBadge(req) {
    if (!req.visibility || req.visibility === "private") return <span className="vis-badge vis-private">🔒 Private</span>;
    if (req.visibility === "team") { const t = req.teamId ? store.getTeam(req.teamId) : null; return <span className="vis-badge vis-team">👥 {t?.name || "Team"}</span>; }
    if (req.visibility === "members") return <span className="vis-badge vis-members">✉️ Members</span>;
    if (req.visibility === "external") return <span className="vis-badge vis-external">🌐 External</span>;
    return null;
  }

  function getContentTypeIcon(req) {
    const items = req.contentItems || [];
    if (items.length === 0) return "📋";
    const types = items.map((i) => i.type);
    if (types.some((t) => t === "code")) return "💻";
    if (types.some((t) => t === "url_figma")) return "🎨";
    if (types.some((t) => t === "url_youtube")) return "▶️";
    if (types.some((t) => t === "url_loom")) return "🎥";
    if (types.some((t) => t === "images")) return "🖼️";
    if (types.some((t) => t === "pdf")) return "📄";
    if (types.some((t) => t === "text")) return "📝";
    return "🔗";
  }

  function RequestCard({ req }) {
    const total = responseCounts[req.id] || 0;
    const newCount = getNewCount(req);
    const isResharing = reshareId === req.id;
    const isConfirmingDelete = confirmDeleteId === req.id;
    const isTagging = tagInput.id === req.id;
    return (
      <div className={`request-card${req.status === "archived" ? " archived" : ""}`}>
        <div className="request-card-row" onClick={() => { store.setSeenCount(req.id, total); navigate(`results/${req.id}`); }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: "var(--warm)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{getContentTypeIcon(req)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="request-card-title">{req.title}</div>
            <div className="request-card-meta">
              <span>{new Date(req.created_at).toLocaleDateString()}</span>
              <span>{req.contentItems?.length || 0} content item{req.contentItems?.length !== 1 ? "s" : ""}</span>
              <span>{req.questions?.length || 0} question{req.questions?.length !== 1 ? "s" : ""}</span>
              <span style={{ color: total > 0 ? "var(--success)" : undefined }}>{total} response{total !== 1 ? "s" : ""}</span>
              {req.deadline && <span className="deadline-badge" style={{ fontSize: 11, padding: "1px 7px" }}>📅 {formatDeadline(req.deadline)}</span>}
              {user?.activeTeamId && visBadge(req)}
              {req.folderId && folders.find((f) => f.id === req.folderId) && <span className="tag">📁 {folders.find((f) => f.id === req.folderId)?.name}</span>}
            </div>
            {(req.tags || []).length > 0 && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
                {(req.tags || []).map((tag) => (
                  <span key={tag} className="tag-chip" onClick={(e) => { e.stopPropagation(); setFilterTag(filterTag === tag ? "" : tag); }}>
                    {tag}
                    <button className="tag-chip-remove" onClick={(e) => { e.stopPropagation(); removeTag(req.id, tag); }}>✕</button>
                  </span>
                ))}
              </div>
            )}
          </div>
          {newCount > 0 && <span className="notif-badge">{newCount} new</span>}
          <div className="req-actions" onClick={(e) => e.stopPropagation()} style={{ position: "relative", ...(openMenuId === req.id && { opacity: 1 }) }}>
            <button className="btn btn-ghost btn-sm" style={{ fontSize: 18, padding: "2px 6px", lineHeight: 1 }} onClick={() => setOpenMenuId(openMenuId === req.id ? null : req.id)}>⋮</button>
            {openMenuId === req.id && (
              <div className="req-menu">
                <div className="req-menu-item" onClick={() => { setOpenMenuId(null); navigate(`edit/${req.id}`); }}>Edit</div>
                <div className="req-menu-item" onClick={() => { setOpenMenuId(null); setTagInput(isTagging ? { id: null, value: "" } : { id: req.id, value: "" }); }}>Tag</div>
                <div className="req-menu-item" onClick={() => { setOpenMenuId(null); handleDuplicate(req.id); }}>Duplicate</div>
                <div className="req-menu-item" onClick={() => { setOpenMenuId(null); setReshareId(isResharing ? null : req.id); setReshareCopied(false); }}>Copy Link</div>
                <div className="req-menu-item" onClick={() => { setOpenMenuId(null); handleArchive(req.id); }}>{req.status === "archived" ? "Unarchive" : "Archive"}</div>
                <div className="req-menu-divider" />
                {isConfirmingDelete
                  ? <div className="req-menu-item req-menu-danger" onClick={() => { setOpenMenuId(null); handleDelete(req.id); }}>Confirm delete</div>
                  : <div className="req-menu-item req-menu-danger" onClick={() => setConfirmDeleteId(req.id)}>Delete</div>
                }
              </div>
            )}
          </div>
        </div>
        {isResharing && (
          <div className="reshare-panel">
            <div className="text-sm bold mb-8">Review link</div>
            <div className="share-box">
              <div className="share-url">{reviewUrlFor(req.id)}</div>
              <button className="btn btn-primary btn-sm" onClick={() => { navigator.clipboard.writeText(reviewUrlFor(req.id)); setReshareCopied(true); setTimeout(() => setReshareCopied(false), 2000); }}>{reshareCopied ? "✓ Copied" : "Copy"}</button>
            </div>
          </div>
        )}
        {isTagging && (
          <div className="reshare-panel" style={{ display: "flex", gap: 8 }}>
            <input type="text" placeholder="Tag name…" value={tagInput.value} onChange={(e) => setTagInput({ id: req.id, value: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(req.id, tagInput.value); } if (e.key === "Escape") setTagInput({ id: null, value: "" }); }} style={{ flex: 1 }} autoFocus />
            <button className="btn btn-primary btn-sm" onClick={() => addTag(req.id, tagInput.value)} disabled={!tagInput.value.trim()}>Add</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setTagInput({ id: null, value: "" })}>Cancel</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app"><StyleInjector /><TopBar activeView="requests" user={user} />
      <div className="page" style={{ maxWidth: 980 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
          {/* ── Folder Sidebar ── */}
          <div className="folder-sidebar">
            <div className="folder-sidebar-title">Folders</div>
            <div className={`folder-item${!filterFolder ? " active" : ""}`} onClick={() => setFilterFolder("")}>
              <span>🗂️</span><span className="folder-item-name">All requests</span>
              <span className="folder-item-count">{requests.length}</span>
            </div>
            {folders.map((f) => (
              <div key={f.id} className={`folder-item${filterFolder === f.id ? " active" : ""}`} onClick={() => setFilterFolder(f.id)}>
                <span>📁</span>
                <span className="folder-item-name">{f.name}</span>
                <span className="folder-item-count">{requests.filter((r) => r.folderId === f.id).length}</span>
                <div className="folder-actions" onClick={(e) => { e.stopPropagation(); deleteFolder(f.id); }}>
                  <button className="btn btn-ghost btn-sm" style={{ padding: "1px 6px", fontSize: 11 }}>✕</button>
                </div>
              </div>
            ))}
            {newFolder ? (
              <div style={{ padding: "6px 8px" }}>
                <input type="text" autoFocus placeholder="Folder name…" value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") createFolder(); if (e.key === "Escape") { setNewFolder(false); setNewFolderName(""); } }} style={{ fontSize: 13, padding: "5px 8px" }} />
                <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                  <button className="btn btn-primary btn-sm" onClick={createFolder} disabled={!newFolderName.trim()}>Add</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => { setNewFolder(false); setNewFolderName(""); }}>✕</button>
                </div>
              </div>
            ) : (
              <div className="folder-item" style={{ color: "var(--muted)" }} onClick={() => setNewFolder(true)}>
                <span>＋</span><span className="folder-item-name">New folder</span>
              </div>
            )}
            {(() => { const t = user?.activeTeamId ? store.getTeam(user.activeTeamId) : null; return t && t.members.length < 2 && !inviteDismissed; })() && (
              <div style={{ marginTop: 16, padding: "10px 10px", background: "var(--warm)", border: "1px dashed var(--border)", borderRadius: "var(--radius)", fontSize: 13 }}>
                <div className="bold" style={{ marginBottom: 4 }}>👥 Invite your team</div>
                <div className="text-muted" style={{ fontSize: 12, marginBottom: 8 }}>Feedback gets better with more perspectives.</div>
                <button className="btn btn-sm" style={{ background: "#3B82F6", color: "white", border: "none", fontSize: 12, width: "100%" }} onClick={() => { const t = store.getTeam(user.activeTeamId); if (t) { navigator.clipboard.writeText(getInviteUrl(t.inviteCode)); setInviteLinkCopied(true); setTimeout(() => setInviteLinkCopied(false), 2500); } }}>{inviteLinkCopied ? "✓ Link copied!" : "Copy invite link"}</button>
              </div>
            )}
          </div>

          {/* ── Main content ── */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="eyebrow">Your workspace</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <h1 className="page-title" style={{ marginBottom: 0 }}>Feedback Requests</h1>
              {requestsWithResponses >= 2 && <button className="btn btn-ghost btn-sm" onClick={exportAllCSV}>📥 Export .CSV</button>}
            </div>
            <p className="page-subtitle">All your active and past requests. Click any to view responses.</p>
            {(!user?.teamIds || user.teamIds.length === 0) && !inviteDismissed && (
              <div className="card" style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", marginBottom: 20, background: "var(--warm)", border: "1px dashed var(--border)" }}>
                <span style={{ fontSize: 22 }}>👥</span>
                <div style={{ flex: 1 }}>
                  <div className="bold text-sm">Join or create a team</div>
                  <div className="text-sm text-muted">Teams let you collaborate on feedback requests and share insights with colleagues.</div>
                </div>
                <button className="btn btn-sm" style={{ background: "#3B82F6", color: "white", border: "none" }} onClick={() => navigate("new-team")}>＋ New Team</button>
                <button className="btn btn-ghost btn-sm" style={{ padding: "4px 8px", color: "var(--muted)" }} onClick={() => setInviteDismissed(true)}>✕</button>
              </div>
            )}
            {loading ? <div className="text-muted text-sm">Loading…</div> : requests.length === 0 ? (
              <div className="card" style={{ textAlign: "center", padding: 44, color: "var(--muted)" }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>📭</div>
                <div className="bold mb-4">No requests yet</div>
                <div className="text-sm mb-16">Create your first feedback request to get started.</div>
                <button className="btn btn-primary" onClick={() => navigate("create")}>+ New Request</button>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
                  <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <select className="filter-select" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                      <option value="date_desc">Newest first</option>
                      <option value="date_asc">Oldest first</option>
                      <option value="responses_desc">Most responses</option>
                      <option value="responses_asc">Fewest responses</option>
                    </select>
                    {allTags.length > 0 && (
                      <>
                        <span className="text-sm bold" style={{ color: "var(--muted)" }}>Tag</span>
                        {allTags.map((tag) => (
                          <span key={tag} className={`tag-chip${filterTag === tag ? " active-tag" : ""}`} onClick={() => setFilterTag(filterTag === tag ? "" : tag)}>{tag}</span>
                        ))}
                      </>
                    )}
                    {filterTag && <button className="btn btn-ghost btn-sm" onClick={() => setFilterTag("")}>✕ Clear filter</button>}
                  </div>
                </div>

                {active.length > 0 && (
                  <>
                    <div className="eyebrow" style={{ marginBottom: 10 }}>Active</div>
                    <div className="request-list">{active.map((req) => <RequestCard key={req.id} req={req} />)}</div>
                  </>
                )}
                {completed.length > 0 && (
                  <>
                    <div className="divider" />
                    <div className="eyebrow" style={{ marginBottom: 10 }}>Completed</div>
                    <div className="request-list">{completed.map((req) => <RequestCard key={req.id} req={req} />)}</div>
                  </>
                )}
                {archived.length > 0 && (
                  <>
                    <div className="divider" />
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div className="eyebrow" style={{ marginBottom: 0 }}>Archived ({archived.length})</div>
                      <button className="btn btn-ghost btn-sm" onClick={() => setShowArchived((v) => !v)}>{showArchived ? "Hide" : "Show"}</button>
                    </div>
                    {showArchived && <div className="request-list">{archived.map((req) => <RequestCard key={req.id} req={req} />)}</div>}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}
// ─── Review view ──────────────────────────────────────────────────────────────
function ReviewView({ requestId }) {
  const [request, setRequest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState("name");
  const [reviewerName, setReviewerName] = useState("");
  const [preBiasAnswers, setPreBiasAnswers] = useState({});
  const [preBiasStep, setPreBiasStep] = useState(0);
  const [initialReaction, setInitialReaction] = useState(null);
  const [answers, setAnswers] = useState({});
  const [currentQ, setCurrentQ] = useState(0);
  const [activeTab, setActiveTab] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [closingAnswer, setClosingAnswer] = useState("");
  const [reviewerQuestions, setReviewerQuestions] = useState("");
  const [reviewerFocusItem, setReviewerFocusItem] = useState(0);
  const [submitAnonymously, setSubmitAnonymously] = useState(false);
  useEffect(() => { store.getRequest(requestId).then((r) => { setRequest(r); setLoading(false); }); }, [requestId]);
  useEffect(() => {
    if (!request) return;
    const q = request.questions?.[currentQ];
    if (q?.hotspot?.contentItemIndex != null) setActiveTab(q.hotspot.contentItemIndex);
  }, [currentQ, request]);
  function setAnswer(qId, val) { setAnswers((a) => ({ ...a, [qId]: val })); }
  async function submit() {
    setSubmitting(true);
    const items = request?.contentItems || [];
    await store.saveResponse({
      id: uid(),
      request_id: requestId,
      reviewer_name: submitAnonymously ? "Anonymous" : reviewerName,
      pre_bias: preBiasAnswers,
      initial_reaction: initialReaction,
      answers,
      closing_answer: closingAnswer || null,
      reviewer_questions: reviewerQuestions || null,
      reviewer_focus_item: items.length > 1 ? reviewerFocusItem : null,
      submitted_at: new Date().toISOString()
    });
    setStep("done");
    setSubmitting(false);
  }

  if (loading) return <div className="app"><StyleInjector /><TopBar /><div className="page" style={{ textAlign: "center", paddingTop: 100 }}><div className="text-muted">Loading…</div></div></div>;
  if (!request) return <div className="app"><StyleInjector /><TopBar /><div className="page"><h2>Request not found</h2></div></div>;

  // Normalize pre-bias questions (backward compat with old single string)
  const preBiasQs = request.preBiasQuestions?.length
    ? request.preBiasQuestions
    : (request.preBiasQuestion ? [request.preBiasQuestion] : []);

  if (step === "done") return (
    <div className="app"><StyleInjector /><TopBar />
      <div className="page" style={{ textAlign: "center", paddingTop: 80 }}>
        <div style={{ fontSize: 48, marginBottom: 14 }}>✅</div>
        <h1 className="page-title">Thanks{submitAnonymously ? "" : `, ${reviewerName}`}!</h1>
        <p className="page-subtitle">Your feedback has been recorded{submitAnonymously ? " anonymously" : ""} and will be reviewed by the team.</p>
      </div>
      <Footer />
    </div>
  );

  if (step === "name") return (
    <div className="app"><StyleInjector /><TopBar />
      <div className="page" style={{ maxWidth: 520 }}>
        <div className="eyebrow">Feedback Review</div>
        <h1 className="page-title">{request.title}</h1>
        {request.deadline && (
          <div style={{ marginBottom: 16 }}>
            <span className="deadline-badge">📅 Please review by {formatDeadline(request.deadline)}</span>
          </div>
        )}
        {request.context && <div className="card card-accent" style={{ marginBottom: 20 }}><div className="bold text-sm mb-4">📋 Your scenario</div><div className="text-sm" style={{ lineHeight: 1.75 }}>{request.context}</div></div>}
        {request.focusOn && <div className="alert alert-success">🎯 <span><strong>Focus on:</strong> {request.focusOn}</span></div>}
        {request.ignoreNote && <div className="alert alert-warn">⏭️ <span><strong>Not needed today:</strong> {request.ignoreNote}</span></div>}
        <div className="field mt-24">
          <label className="label">Your name</label>
          <input type="text" placeholder="e.g. Sarah Chen" value={reviewerName} onChange={(e) => setReviewerName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && reviewerName.trim() && setStep(preBiasQs.length > 0 ? "prebias" : "feedback")} />
        </div>
        {request.allowAnonymous && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: 16, fontSize: 14 }}>
            <input type="checkbox" checked={submitAnonymously} onChange={(e) => setSubmitAnonymously(e.target.checked)} style={{ accentColor: "var(--accent)" }} />
            <span>Submit anonymously</span>
            <span className="text-sm text-muted">— your name won't be shown</span>
          </label>
        )}
        <button className="btn btn-primary" disabled={!submitAnonymously && !reviewerName.trim()} onClick={() => { if (submitAnonymously && !reviewerName.trim()) setReviewerName("Anonymous"); setStep(preBiasQs.length > 0 ? "prebias" : "feedback"); }}>Start reviewing →</button>
        <div className="hint mt-8">Voice input available.</div>
      </div>
      <Footer />
    </div>
  );

  if (step === "prebias") {
    const currentPBQ = preBiasQs[preBiasStep];
    const currentAnswer = preBiasAnswers[preBiasStep] || "";
    const isLast = preBiasStep === preBiasQs.length - 1;
    return (
      <div className="app"><StyleInjector /><TopBar />
        <div className="page" style={{ maxWidth: 520 }}>
          <div className="eyebrow">Before you look at anything — {preBiasStep + 1} of {preBiasQs.length}</div>
          <h1 className="page-title">Quick gut check</h1>
          <p className="page-subtitle">Answer before you see the content — we want your unbiased first instinct.</p>
          <div className="card">
            <div className="bold mb-8">{currentPBQ}</div>
            <OpenAnswer question={{ placeholder: "Your first instinct…" }} value={currentAnswer} onChange={(v) => setPreBiasAnswers((a) => ({ ...a, [preBiasStep]: v }))} />
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            {preBiasStep > 0 && <button className="btn btn-ghost" onClick={() => setPreBiasStep((s) => s - 1)}>← Back</button>}
            {isLast
              ? <button className="btn btn-primary" disabled={!currentAnswer.trim()} onClick={() => setStep("feedback")}>Now see the content →</button>
              : <button className="btn btn-primary" disabled={!currentAnswer.trim()} onClick={() => setPreBiasStep((s) => s + 1)}>Next →</button>
            }
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  const contentItems = request.contentItems || [];
  const totalQ = request.questions.length;
  const effectiveTotalQ = totalQ + (request.addClosingQuestion ? 1 : 0);
  const isClosingQ = request.addClosingQuestion && currentQ === totalQ;
  const q = isClosingQ ? null : request.questions[currentQ];
  const allAnswered = request.questions.every((q) => isAnswered(answers[q.id]));
  const hotspot = q?.hotspot?.contentItemIndex === activeTab ? q.hotspot : null;
  const currentAnswered = isClosingQ ? true : isAnswered(answers[q?.id]);
  const canGoNext = currentAnswered && (currentQ > 0 || !request.addFirstImpression || initialReaction);

  if (step === "reviewer_questions") {
    return (
      <div className="app"><StyleInjector />
        <TopBar extra={<div className="text-sm text-muted">{reviewerName} · Your questions</div>} />
        <div className="split">
          <div className="split-left">
            <div className="split-left-header">
              <div className="split-left-tabs">
                {contentItems.map((item, i) => (
                  <div key={item.id} className={`split-tab${reviewerFocusItem === i ? " active" : ""}`} onClick={() => setReviewerFocusItem(i)}>
                    {CONTENT_ICONS[item.type]} {item.label}
                  </div>
                ))}
              </div>
            </div>
            <div className="split-content">
              <ContentDisplay item={contentItems[reviewerFocusItem]} hotspot={null} />
            </div>
          </div>
          <div className="split-right">
            <div className="eyebrow" style={{ marginBottom: 6 }}>Your turn</div>
            <h2 style={{ fontSize: 19, marginBottom: 8, fontFamily: "'Lato', sans-serif" }}>Questions for the team?</h2>
            <p className="text-sm text-muted" style={{ marginBottom: 18 }}>Got something you want to flag or ask? Add it here.</p>
            <div className="field">
              <label className="label">Questions / comments <span style={{ fontWeight: 400, color: "var(--muted)" }}>(optional)</span></label>
              <textarea
                placeholder="e.g. What happens when a user tries to…? / I wasn't sure about… / Can you explain…"
                value={reviewerQuestions}
                onChange={(e) => setReviewerQuestions(e.target.value)}
                rows={5}
              />
            </div>
            <div style={{ display: "flex", gap: 9, marginTop: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                if (request.addClosingQuestion) { setCurrentQ(totalQ); }
                else { setCurrentQ(totalQ - 1); }
                setStep("feedback");
              }}>← Back</button>
              <button className="btn btn-accent" disabled={submitting || !allAnswered || (request.addFirstImpression && !initialReaction)} onClick={submit}>
                {submitting ? "Submitting…" : "Submit feedback ✓"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app"><StyleInjector />
      <TopBar extra={<div className="text-sm text-muted">{reviewerName} · {isClosingQ ? "Closing question" : `Q${currentQ + 1}/${totalQ}`}</div>} />
      <div className="split">
        <div className="split-left">
          <div className="split-left-header">
            <div className="split-left-tabs">
              {contentItems.map((item, i) => (
                <div key={item.id} className={`split-tab${activeTab === i ? " active" : ""}`} onClick={() => setActiveTab(i)}>
                  {CONTENT_ICONS[item.type]} {item.label}
                </div>
              ))}
            </div>
          </div>
          <div className="split-content">
            <ContentDisplay item={contentItems[activeTab]} hotspot={hotspot} />
          </div>
        </div>
        <div className="split-right">
          <div className="progress-bar"><div className="progress-fill" style={{ width: `${((currentQ + (currentAnswered ? 1 : 0)) / effectiveTotalQ) * 100}%` }} /></div>
          {currentQ === 0 && request.addFirstImpression && (
            <div className="card" style={{ marginBottom: 20, border: initialReaction ? "1px solid var(--border)" : "2px solid var(--accent)" }}>
              <div className="bold mb-8">First impression?</div>
              <div className="text-sm text-muted mb-12">Gut reaction before you dig in — required to continue.</div>
              <ReactionAnswer value={initialReaction} onChange={setInitialReaction} />
            </div>
          )}
          {isClosingQ ? (
            <div>
              <div className="step-tag">Final question</div>
              <h2 style={{ fontSize: 19, marginBottom: 14, fontFamily: "'Lato', sans-serif" }}>Is there anything else you'd like to add?</h2>
              <textarea
                placeholder="Any other thoughts, observations, or feedback…"
                value={closingAnswer}
                onChange={(e) => setClosingAnswer(e.target.value)}
                rows={4}
              />
              <div style={{ display: "flex", gap: 9, marginTop: 18 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setCurrentQ((c) => c - 1)}>← Back</button>
                <button className="btn btn-primary btn-sm" onClick={() => setStep("reviewer_questions")}>Next →</button>
              </div>
            </div>
          ) : q ? (
            <div>
              <div className="step-tag">Question {currentQ + 1} of {totalQ}</div>
              <h2 style={{ fontSize: 19, marginBottom: 14, fontFamily: "'Lato', sans-serif" }}>{q.text}</h2>
              {q.hotspot && q.hotspot.contentItemIndex !== activeTab && (
                <div className="alert alert-info" style={{ marginBottom: 12 }}>
                  🎯 Focus on: <strong>{contentItems[q.hotspot.contentItemIndex]?.label}</strong>
                  <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={() => setActiveTab(q.hotspot.contentItemIndex)}>Switch →</button>
                </div>
              )}
              {q.type === "likert" && <LikertAnswer question={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />}
              {q.type === "open" && <OpenAnswer question={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />}
              {q.type === "reaction" && <ReactionAnswer value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />}
              {q.type === "choice" && <ChoiceAnswer question={q} value={answers[q.id]} onChange={(v) => setAnswer(q.id, v)} />}
              <div style={{ display: "flex", gap: 9, marginTop: 18 }}>
                {currentQ > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setCurrentQ((c) => c - 1)}>← Back</button>}
                {currentQ < totalQ - 1
                  ? <button className="btn btn-primary btn-sm" disabled={!canGoNext} onClick={() => setCurrentQ((c) => c + 1)}>Next →</button>
                  : <button className="btn btn-primary btn-sm" disabled={!canGoNext} onClick={() => {
                      if (request.addClosingQuestion) setCurrentQ(totalQ);
                      else setStep("reviewer_questions");
                    }}>Next →</button>
                }
              </div>
              {currentQ === 0 && request.addFirstImpression && !initialReaction && (
                <div className="hint mt-8" style={{ color: "var(--accent)" }}>↑ Please give your first impression before continuing.</div>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
// ─── Results view ─────────────────────────────────────────────────────────────
function ResultsView({ requestId, user }) {
  const [request, setRequest] = useState(null);
  const [responses, setResponses] = useState([]);
  const [synthesis, setSynthesis] = useState(null);
  const [synthesizing, setSynthesizing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [newNotif, setNewNotif] = useState(false);
  const [reshareCopied, setReshareCopied] = useState(false);

  useEffect(() => { loadAll(); const t = setInterval(poll, 30000); return () => clearInterval(t); }, [requestId]);

  async function loadAll() {
    const [req, res, syn] = await Promise.all([store.getRequest(requestId), store.getResponses(requestId), store.getSynthesis(requestId)]);
    setRequest(req); setResponses(res); setSynthesis(syn);
    store.setSeenCount(requestId, res.length);
    setLoading(false);
    // Auto-synthesize on first load if responses exist and no prior synthesis
    if (res.length > 0 && !syn) {
      const { apiKey } = store.getAnthropicConfig();
      if (apiKey) runSynthesisInternal(req, res, apiKey);
    }
  }
  async function poll() {
    const res = await store.getResponses(requestId);
    const seen = store.getSeenCount(requestId);
    if (res.length > seen) { setNewNotif(true); setTimeout(() => setNewNotif(false), 6000); }
    setResponses(res); store.setSeenCount(requestId, res.length);
  }
  async function runSynthesisInternal(reqData, resData, apiKey) {
    setSynthesizing(true);
    const text = await synthesizeFeedback(reqData, resData, apiKey);
    setSynthesis(text);
    await store.saveSynthesis(requestId, text);
    setSynthesizing(false);
  }
  async function runSynthesis() {
    const { apiKey } = store.getAnthropicConfig();
    if (!apiKey) {
      setSynthesis("⚠️ Add your Anthropic API key in Settings (⚙) to enable AI synthesis.");
      return;
    }
    runSynthesisInternal(request, responses, apiKey);
  }
  async function markComplete() {
    const updated = { ...request, status: "completed" };
    await store.saveRequest(updated); setRequest(updated);
  }

  if (loading) return <div className="app"><StyleInjector /><TopBar /><div className="page" style={{ textAlign: "center", paddingTop: 100 }}><div className="text-muted">Loading…</div></div></div>;
  if (!request) return <div className="app"><StyleInjector /><TopBar /><div className="page"><h2>Request not found</h2></div></div>;

  const reactionCounts = responses.reduce((acc, r) => { if (r.initial_reaction) acc[r.initial_reaction] = (acc[r.initial_reaction] || 0) + 1; return acc; }, {});
  const topReaction = Object.entries(reactionCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  const topReactionEmoji = REACTIONS.find((r) => r.label === topReaction)?.emoji || (topReaction?.startsWith("custom:") ? topReaction.slice(7) : undefined);

  function exportCSV() {
    if (!request || responses.length === 0) return;
    const qs = request.questions || [];
    const headers = ["Reviewer", "Submitted", request.addFirstImpression ? "First Impression" : null, ...qs.map((q) => q.title || q.prompt || "Question"), request.addClosingQuestion ? "Closing Answer" : null, "Reviewer Questions"].filter(Boolean);
    const escCSV = (v) => { const s = String(v ?? ""); return s.includes(",") || s.includes('"') || s.includes("\n") ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const resolveEmoji = (val) => { if (!val) return ""; const found = REACTIONS.find((r) => r.label === val); if (found) return found.emoji + " " + val; if (val.startsWith("custom:")) return val.slice(7); return val; };
    const rows = responses.map((r) => {
      const cells = [r.reviewer_name, new Date(r.submitted_at).toLocaleDateString()];
      if (request.addFirstImpression) cells.push(resolveEmoji(r.initial_reaction));
      qs.forEach((q) => { const ans = r.answers[q.id]; cells.push(q.type === "reaction" ? resolveEmoji(ans) : (ans ?? "")); });
      if (request.addClosingQuestion) cells.push(r.closing_answer || "");
      cells.push(r.reviewer_questions || "");
      return cells.map(escCSV).join(",");
    });
    const csv = [headers.map(escCSV).join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (request.title || "feedback") .replace(/[^a-z0-9]/gi, "_") + "_results.csv"; a.click(); URL.revokeObjectURL(a.href);
  }
  const reviewUrl = `${window.location.origin}${window.location.pathname}#review/${requestId}`;

  return (
    <div className="app"><StyleInjector />
      <TopBar activeView="requests" user={user} extra={
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={poll}>↻ Refresh</button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate(`edit/${requestId}`)}>✏️ Edit</button>
          {responses.length > 0 && <button className="btn btn-ghost btn-sm" onClick={exportCSV}>📥 Export CSV</button>}
          {request.status !== "completed" && <button className="btn btn-ghost btn-sm" onClick={markComplete}>Mark complete</button>}
          <button className="btn btn-primary btn-sm" onClick={runSynthesis} disabled={synthesizing || responses.length === 0}>
            {synthesizing ? "Synthesizing…" : synthesis ? "✨ Re-synthesize" : "✨ Synthesize"}
          </button>
        </div>
      } />
      <div className="page">
        {newNotif && <div className="alert alert-success" style={{ marginBottom: 16 }}>🔔 New feedback just arrived! Results updated.</div>}
        <div className="eyebrow">Results</div>
        <h1 className="page-title">{request.title}</h1>
        {request.status === "completed" && <div className="tag" style={{ marginBottom: 14 }}>✓ Completed</div>}
        <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
          {[
            { label: "Responses", value: responses.length },
            { label: "Questions", value: request.questions?.length || 0 },
            { label: "Top reaction", value: topReaction ? `${topReactionEmoji} ${topReaction?.startsWith("custom:") ? topReaction.slice(7) : topReaction}` : "—" },
          ].map((s) => (
            <div key={s.label} className="card" style={{ textAlign: "center", padding: "14px 20px", flex: 1, minWidth: 110, marginBottom: 0 }}>
              <div style={{ fontSize: s.label === "Top reaction" ? 18 : 26, fontFamily: "'Lato', sans-serif", fontWeight: 700 }}>{s.value}</div>
              <div className="text-sm text-muted">{s.label}</div>
            </div>
          ))}
        </div>

        <div className="card" style={{ marginBottom: 20, padding: "12px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="text-sm bold">🔗 Review link</span>
            <code style={{ fontSize: 12, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--muted)" }}>{reviewUrl}</code>
            <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(reviewUrl); setReshareCopied(true); setTimeout(() => setReshareCopied(false), 2000); }}>{reshareCopied ? "✓ Copied" : "Copy"}</button>
          </div>
        </div>

        {synthesizing && (
          <div className="synthesis-block" style={{ opacity: 0.7 }}>
            <h2>AI Synthesis</h2>
            <div className="synthesis-content" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ animation: "pulse 1s infinite" }}>✨</span> Analyzing {responses.length} response{responses.length !== 1 ? "s" : ""}…
            </div>
          </div>
        )}
        {synthesis && !synthesizing && (
          <div className="synthesis-block">
            <h2>AI Synthesis</h2>
            <div className="synthesis-content">{synthesis}</div>
          </div>
        )}

        {responses.length === 0 && <div className="card" style={{ textAlign: "center", padding: 36, color: "var(--muted)" }}>No responses yet. Share the review link above.</div>}

        {request.questions?.map((q) => {
          const qAnswers = responses.map((r) => ({ name: r.reviewer_name, answer: r.answers[q.id] })).filter((a) => a.answer !== undefined);
          const avg = q.type === "likert" && qAnswers.length ? (qAnswers.reduce((s, a) => s + (Number(a.answer) || 0), 0) / qAnswers.length).toFixed(1) : null;
          return (
            <div className="card" key={q.id} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
                <div>
                  <span className="q-type-badge">{q.type}</span>
                  {q.hotspot && <span className="tag" style={{ marginLeft: 6 }}>🎯 hotspot</span>}
                  <div className="bold mt-4">{q.text}</div>
                </div>
                {avg && <div style={{ textAlign: "center", flexShrink: 0 }}><div style={{ fontSize: 26, fontFamily: "'Lato', sans-serif" }}>{avg}</div><div className="text-sm text-muted">avg / 5</div></div>}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 12 }}>
                {qAnswers.map((a, i) => {
                  const emoji = q.type === "reaction" ? (REACTIONS.find((r) => r.label === a.answer)?.emoji || (a.answer?.startsWith?.("custom:") ? a.answer.slice(7) : "") ) : "";
                  const displayAnswer = a.answer?.startsWith?.("custom:") ? a.answer.slice(7) : String(a.answer);
                  return (
                    <div key={i} style={{ background: "var(--warm)", borderRadius: "var(--radius)", padding: "8px 12px" }}>
                      <div className="text-sm bold mb-4">{a.name}</div>
                      <div className="text-sm text-muted">{emoji} {displayAnswer}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}

        {responses.some((r) => r.reviewer_questions) && (
          <>
            <hr className="divider" />
            <h2 style={{ fontSize: 22, marginBottom: 6 }}>❓ Reviewer Questions</h2>
            <p className="text-sm text-muted" style={{ marginBottom: 16 }}>Questions and comments raised by your reviewers.</p>
            {responses.filter((r) => r.reviewer_questions).map((r) => (
              <div key={r.id} className="card card-accent" style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span className="bold text-sm">{r.reviewer_name}</span>
                  {r.reviewer_focus_item !== null && r.reviewer_focus_item !== undefined && request.contentItems?.[r.reviewer_focus_item] && (
                    <span className="tag" style={{ marginLeft: 4 }}>🎯 {request.contentItems[r.reviewer_focus_item]?.label}</span>
                  )}
                </div>
                <div className="text-sm" style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{r.reviewer_questions}</div>
              </div>
            ))}
          </>
        )}

        {responses.length > 0 && (
          <>
            <hr className="divider" />
            <h2 style={{ fontSize: 22, marginBottom: 14 }}>All responses</h2>
            {responses.map((r) => {
              const reactionEmoji = REACTIONS.find((rx) => rx.label === r.initial_reaction)?.emoji || (r.initial_reaction?.startsWith("custom:") ? r.initial_reaction.slice(7) : "");
              const reactionDisplay = r.initial_reaction?.startsWith("custom:") ? r.initial_reaction.slice(7) : r.initial_reaction;
              return (
                <div key={r.id} className="card" style={{ cursor: "pointer" }} onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div className="bold">{r.reviewer_name}</div>
                    {r.initial_reaction && <span className="tag">{reactionEmoji} {reactionDisplay}</span>}
                    <span className="text-sm text-muted" style={{ marginLeft: "auto" }}>{new Date(r.submitted_at).toLocaleDateString()} {expanded === r.id ? "▲" : "▼"}</span>
                  </div>
                  {expanded === r.id && (
                    <div style={{ marginTop: 14 }}>
                      {typeof r.pre_bias === "object" && Object.keys(r.pre_bias).length > 0 && (
                        Object.entries(r.pre_bias).map(([idx, ans]) => {
                          const pbQs = request.preBiasQuestions?.length ? request.preBiasQuestions : (request.preBiasQuestion ? [request.preBiasQuestion] : []);
                          return <div key={idx} style={{ background: "var(--warm)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 8 }}><div className="text-sm bold mb-4">Pre-bias: {pbQs[idx] || `Question ${Number(idx) + 1}`}</div><div className="text-sm">{ans}</div></div>;
                        })
                      )}
                      {typeof r.pre_bias === "string" && r.pre_bias && (
                        <div style={{ background: "var(--warm)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 8 }}><div className="text-sm bold mb-4">Pre-bias answer</div><div className="text-sm">{r.pre_bias}</div></div>
                      )}
                      {Object.entries(r.answers).map(([qId, ans]) => {
                        const question = request.questions?.find((q) => q.id === qId);
                        const emoji = question?.type === "reaction" ? (REACTIONS.find((rx) => rx.label === ans)?.emoji || (ans?.startsWith?.("custom:") ? ans.slice(7) : "")) : "";
                        const ansDisplay = ans?.startsWith?.("custom:") ? ans.slice(7) : String(ans);
                        return <div key={qId} style={{ background: "var(--warm)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 8 }}><div className="text-sm bold mb-4">{question?.text || qId}</div><div className="text-sm">{emoji} {ansDisplay}</div></div>;
                      })}
                      {r.closing_answer && (
                        <div style={{ background: "var(--warm)", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 8 }}>
                          <div className="text-sm bold mb-4">Is there anything else you'd like to add?</div>
                          <div className="text-sm">{r.closing_answer}</div>
                        </div>
                      )}
                      {r.reviewer_questions && (
                        <div style={{ background: "var(--accent-light)", border: "1px solid #FBAEE3", borderRadius: "var(--radius)", padding: "8px 12px", marginBottom: 8 }}>
                          <div className="text-sm bold mb-4">❓ Questions for the team</div>
                          {r.reviewer_focus_item !== null && r.reviewer_focus_item !== undefined && request.contentItems?.[r.reviewer_focus_item] && (
                            <div className="text-sm text-muted mb-4">🎯 Focus: <strong>{request.contentItems[r.reviewer_focus_item]?.label}</strong></div>
                          )}
                          <div className="text-sm" style={{ whiteSpace: "pre-wrap" }}>{r.reviewer_questions}</div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
      <Footer />
    </div>
  );
}
// ─── Landing page with sign-in ────────────────────────────────────────────────
function LandingWithSignIn({ onSignedIn }) {
  return (
    <div className="app"><StyleInjector />
      <div className="topbar">
        <div className="logo">
          <span style={{ color: "var(--accent)" }}>◆</span>
          <span>Feedback<span style={{ color: "var(--accent)" }}>.</span>Facilitator</span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 48, maxWidth: 1040, margin: "0 auto", padding: "48px 24px 56px" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow">Artium · Feedback Facilitator</div>
          <h1 style={{ fontSize: "clamp(32px,5vw,48px)", marginBottom: 14, lineHeight: 1.1, fontFamily: "'Lato',sans-serif" }}>Feedback that<br /><em>moves things forward.</em></h1>
          <p style={{ fontSize: 17, color: "var(--muted)", marginBottom: 32, maxWidth: 440 }}>Collect structured, useful feedback on prototypes, designs, and docs — distributed via Slack, reviewed in context, synthesized into action.</p>
          <div className="feature-grid" style={{ marginTop: 0 }}>
            {[
              { icon: "🔗", title: "Any content type", desc: "Links, images, PDFs, videos, code — all displayed in-context." },
              { icon: "🎯", title: "Focus hotspots", desc: "Draw attention to exactly what needs eyes on it, per question." },
              { icon: "💬", title: "Slack-native", desc: "Send structured requests to your channel with one click." },
              { icon: "✨", title: "AI synthesis", desc: "Responses distilled into prioritized action items." },
            ].map((f) => (
              <div className="feature-tile" key={f.title}><div className="feature-icon">{f.icon}</div><div className="feature-title">{f.title}</div><div className="feature-desc">{f.desc}</div></div>
            ))}
          </div>
        </div>
        <div style={{ width: 400, flexShrink: 0 }}>
          <SignInView onSignedIn={onSignedIn} inline />
        </div>
      </div>
      <Footer />
    </div>
  );
}
// ─── Router ───────────────────────────────────────────────────────────────────
export default function App() {
  const [route, setRoute] = useState(parseRoute());
  const { user, login } = useCurrentUser();
  useEffect(() => {
    const h = () => setRoute(parseRoute());
    window.addEventListener("hashchange", h);
    return () => window.removeEventListener("hashchange", h);
  }, []);
  const { view, id } = route;

  // Join-team route: anyone with the invite link can access without signing in first
  if (view === "join" && id) return <JoinTeamView inviteCode={id} />;

  // Review route: external reviewers don't need to sign in
  if (view === "review" && id) return <ReviewView requestId={id} />;

  // All other routes: require sign-in — show landing page with sign-in on the right
  if (!user) return <LandingWithSignIn onSignedIn={(u) => { login(u); navigate(view !== "home" ? `${view}${id ? "/" + id : ""}` : "requests"); }} />;

  if (view === "create") return <CreateView user={user} />;
  if (view === "edit" && id) return <CreateView editId={id} user={user} />;
  if (view === "team") return <TeamView user={user} teamId={id} />;
  if (view === "new-team") return <NewTeamView user={user} />;
  if (view === "requests") return <RequestsView user={user} />;
  if (view === "results" && id) return <ResultsView requestId={id} user={user} />;
  return <RequestsView user={user} />;
}
