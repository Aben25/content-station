import { useState, useEffect, useRef, useMemo } from "react";

// ---------------------------------------------------------------------------
// ContentStation design board, P0 pass 1
// Implements: ContentStation Board.dc.html (+ Wall App, Owner App, ios-frame)
// Single-file React. Inline styles mirror the prototype 1:1.
// ---------------------------------------------------------------------------

// Inline CSS string -> React style object (cached). Keeps the handoff values verbatim.
const styleCache = new Map();
function st(css) {
  if (styleCache.has(css)) return styleCache.get(css);
  const out = {};
  for (const decl of css.split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const k = decl.slice(0, i).trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (k) out[k] = decl.slice(i + 1).trim();
  }
  styleCache.set(css, out);
  return out;
}

const FONT = "Outfit,system-ui,sans-serif";
const AMBER = "#E08A2E";
const INK = "#171614";

function GlobalStyle() {
  useEffect(() => {
    const id = "cs-outfit-font";
    if (document.getElementById(id)) return;
    const l = document.createElement("link");
    l.id = id;
    l.rel = "stylesheet";
    l.href = "https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap";
    document.head.appendChild(l);
  }, []);
  return (
    <style>{`
      @keyframes wallpulse{0%,100%{opacity:.55}50%{opacity:1}}
      @keyframes wallbar{0%{width:12%}100%{width:78%}}
      @keyframes qrpulse{0%,100%{opacity:.4}50%{opacity:1}}
      .cs-board input{outline:none}
      .cs-board button{cursor:pointer;font-family:${FONT}}
      .cs-board a{color:${INK}}
      .cs-board a:hover{color:${AMBER}}
      @media (prefers-reduced-motion: reduce){.cs-board *{animation-duration:.001s !important}}
    `}</style>
  );
}

// ---------------------------------------------------------------------------
// iOS device frame (port of ios-frame.jsx, only what the board uses)
// ---------------------------------------------------------------------------
function IOSStatusBar({ dark = false, time = "9:41" }) {
  const c = dark ? "#fff" : "#000";
  return (
    <div style={{ display: "flex", gap: 154, alignItems: "center", justifyContent: "center", padding: "21px 24px 19px", boxSizing: "border-box", position: "relative", zIndex: 20, width: "100%" }}>
      <div style={{ flex: 1, height: 22, display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 1.5 }}>
        <span style={{ fontFamily: '-apple-system, "SF Pro", system-ui', fontWeight: 590, fontSize: 17, lineHeight: "22px", color: c }}>{time}</span>
      </div>
      <div style={{ flex: 1, height: 22, display: "flex", alignItems: "center", justifyContent: "center", gap: 7, paddingTop: 1, paddingRight: 1 }}>
        <svg width="19" height="12" viewBox="0 0 19 12">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.7" fill={c} />
          <rect x="4.8" y="5" width="3.2" height="7" rx="0.7" fill={c} />
          <rect x="9.6" y="2.5" width="3.2" height="9.5" rx="0.7" fill={c} />
          <rect x="14.4" y="0" width="3.2" height="12" rx="0.7" fill={c} />
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12">
          <path d="M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z" fill={c} />
          <path d="M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z" fill={c} />
          <circle cx="8.5" cy="10.5" r="1.5" fill={c} />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke={c} strokeOpacity="0.35" fill="none" />
          <rect x="2" y="2" width="20" height="9" rx="2" fill={c} />
          <path d="M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z" fill={c} fillOpacity="0.4" />
        </svg>
      </div>
    </div>
  );
}

function IOSDevice({ children, width = 402, height = 874, dark = false }) {
  return (
    <div style={{ width, height, borderRadius: 48, overflow: "hidden", position: "relative", background: dark ? "#000" : "#F2F2F7", boxShadow: "0 40px 80px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.12)", fontFamily: "-apple-system, system-ui, sans-serif", WebkitFontSmoothing: "antialiased", flex: "none" }}>
      <div style={{ position: "absolute", top: 11, left: "50%", transform: "translateX(-50%)", width: 126, height: 37, borderRadius: 24, background: "#000", zIndex: 50 }} />
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 }}>
        <IOSStatusBar dark={dark} />
      </div>
      <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
        <div style={{ flex: 1, overflow: "auto" }}>{children}</div>
      </div>
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, zIndex: 60, height: 34, display: "flex", justifyContent: "center", alignItems: "flex-end", paddingBottom: 8, pointerEvents: "none" }}>
        <div style={{ width: 139, height: 5, borderRadius: 100, background: dark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.25)" }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Wall app (port of Wall App.dc.html)
// ---------------------------------------------------------------------------
export const WALL_STATES = ["waiting", "reading", "connecting", "framing", "recording", "paused", "nointernet", "nointernet_long", "reframe", "hot", "fault"];

const WALL = {
  waiting: { glyph: "Code", line1: "Open cs.ai/start on your phone", line2: "Then hold your phone up to the camera", code: "4KP7" },
  reading: { glyph: "Dot", line1: "Got it.", line2: "You can lower your phone" },
  connecting: { glyph: "Bar", line1: "Joining Fade Society Wi-Fi", line2: "Then checking in with contentstation" },
  framing: { glyph: null },
  recording: { glyph: null },
  paused: { glyph: "Pause", line1: "Paused until 3:00 PM", line2: "Resume from your phone" },
  nointernet: { glyph: "Off", line1: "No internet. Buffering.", line2: "Footage is safe on this phone" },
  nointernet_long: { glyph: "Off", line1: "Still no internet.", line2: "Re-scan QR from your phone" },
  reframe: { glyph: "Frame", line1: "Camera moved.", line2: "Check your phone" },
  hot: { glyph: "Hot", line1: "Cooling down. Back soon.", line2: "Footage is safe" },
  fault: { glyph: "Fault", line1: "Text us: (415) 555-0142", line2: "Code E-31" },
};

function WallGlyph({ glyph, code }) {
  switch (glyph) {
    case "Code":
      return <div style={st("font-size:112px;font-weight:700;letter-spacing:.12em;line-height:1;color:#E08A2E;font-variant-numeric:tabular-nums")}>{code}</div>;
    case "Dot":
      return <div style={st("width:120px;height:120px;border-radius:50%;background:#E08A2E")} />;
    case "Ring":
      return <div style={st("width:120px;height:120px;border-radius:50%;border:10px solid #E08A2E;animation:wallpulse 1.6s ease-in-out infinite")} />;
    case "Pause":
      return (
        <div style={st("display:flex;gap:26px")}>
          <div style={st("width:34px;height:120px;border-radius:8px;background:#F2EFE9")} />
          <div style={st("width:34px;height:120px;border-radius:8px;background:#F2EFE9")} />
        </div>
      );
    case "Off":
      return <div style={st("width:120px;height:120px;border-radius:50%;border:10px dashed #8E8A82;box-sizing:border-box")} />;
    case "Frame":
      return <div style={st("width:130px;height:130px;border:10px solid #E08A2E;border-radius:14px;box-sizing:border-box;transform:rotate(9deg)")} />;
    case "Hot":
      return <div style={st("width:120px;height:120px;border-radius:50%;background:radial-gradient(circle,#E08A2E 0 40%,transparent 41%),radial-gradient(circle,transparent 0 60%,rgba(224,138,46,.35) 61%)")} />;
    case "Fault":
      return <div style={st("width:120px;height:120px;border-radius:50%;border:10px solid #F2EFE9;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:72px;font-weight:700;line-height:1")}>!</div>;
    case "Bar":
      return (
        <div style={st("width:220px;height:14px;border-radius:7px;background:#2a2926;overflow:hidden")}>
          <div style={st("height:100%;background:#E08A2E;border-radius:7px;animation:wallbar 3s ease-out forwards")} />
        </div>
      );
    default:
      return null;
  }
}

export function WallApp({ state = "waiting" }) {
  const d = WALL[state] || {};
  const isFraming = state === "framing";
  const isRecording = state === "recording";
  return (
    <IOSDevice width={390} height={844} dark>
      <div style={st("position:relative;width:100%;height:100%;background:#000;color:#F2EFE9;font-family:Outfit,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 32px;box-sizing:border-box;overflow:hidden")}>
        {isFraming && (
          <>
            <div style={st("position:absolute;inset:0;background:repeating-linear-gradient(135deg,#1a1917 0 14px,#151412 14px 28px)")} />
            <div style={st("position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:500 13px ui-monospace,Menlo,monospace;color:rgba(242,239,233,.35);letter-spacing:.04em")}>live preview: chair 1, mirror, station</div>
            <div style={st("position:absolute;left:36px;right:36px;top:200px;bottom:250px;border:3px solid #E08A2E;border-radius:10px")} />
            <div style={st("position:absolute;left:0;right:0;bottom:120px;font-size:34px;font-weight:600;line-height:1.15")}>Adjust from your phone</div>
          </>
        )}
        {isRecording && (
          <>
            <div style={st("position:absolute;inset:0;box-shadow:inset 0 0 48px 10px rgba(224,138,46,.6);pointer-events:none")} />
            <div style={st("position:absolute;left:0;right:0;bottom:60px;display:flex;justify-content:center")}>
              <div style={st("width:14px;height:14px;border-radius:50%;background:#E08A2E;box-shadow:0 0 24px 6px rgba(224,138,46,.7)")} />
            </div>
          </>
        )}
        {!isFraming && !isRecording && (
          <div style={st("display:flex;flex-direction:column;align-items:center;gap:44px;width:100%")}>
            <WallGlyph glyph={d.glyph} code={d.code} />
            <div style={st("display:flex;flex-direction:column;gap:18px")}>
              <div style={st("font-size:44px;font-weight:600;line-height:1.12;text-wrap:balance")}>{d.line1 || ""}</div>
              <div style={st("font-size:28px;font-weight:400;line-height:1.3;color:#B8B3AA;text-wrap:balance")}>{d.line2 || ""}</div>
            </div>
          </div>
        )}
      </div>
    </IOSDevice>
  );
}

// ---------------------------------------------------------------------------
// Owner app (port of Owner App.dc.html)
// ---------------------------------------------------------------------------
const CLIPS = [
  { id: 0, caption: "Clean skin fade, start to finish.", dur: "0:14", footage: "footage: skin fade at chair 1, clippers to finish", bg: "repeating-linear-gradient(135deg,#3a3835 0 14px,#2c2a27 14px 28px)" },
  { id: 1, caption: "Beard lineup with the straight razor.", dur: "0:09", footage: "footage: beard lineup, close on the razor", bg: "repeating-linear-gradient(135deg,#34322f 0 14px,#262421 14px 28px)" },
  { id: 2, caption: "Hot towel. The best part of the cut.", dur: "0:11", footage: "footage: hot towel finish, client in the chair", bg: "repeating-linear-gradient(135deg,#403d39 0 14px,#302e2a 14px 28px)" },
];

const STATUS = (pausedUntil) => ({
  recording: { color: "#2F8F5B", bg: "#E6F0E9", title: "Recording since 9:02 AM", sub: "Filming chair 1. Clips arrive tomorrow at 8 AM.", short: "Recording", wifi: "Strong", seen: "Just now" },
  offline: { color: "#D9A21B", bg: "#F6EEDB", title: "No internet since 2:14 PM", sub: "The camera is buffering footage and will upload when it reconnects. If your Wi-Fi changed, re-scan the QR.", short: "No internet since 2:14 PM", wifi: "None", seen: "2:14 PM" },
  attention: { color: "#C94B32", bg: "#F5E3DE", title: "Needs attention", sub: "The camera may have moved. Check the shot and adjust the arm.", short: "Needs attention", wifi: "Strong", seen: "Just now" },
  paused: { color: "#D9A21B", bg: "#F6EEDB", title: "Paused until " + pausedUntil, sub: "Nothing is being filmed. Recording resumes on its own at " + pausedUntil + ".", short: "Paused until " + pausedUntil, wifi: "Strong", seen: "Just now" },
});

// Deterministic QR-like pattern, 21 x 21
function buildQrCells() {
  const cells = [];
  let seed = 7;
  for (let i = 0; i < 441; i++) {
    const r = Math.floor(i / 21), c = i % 21;
    const corner = (r < 7 && c < 7) || (r < 7 && c > 13) || (r > 13 && c < 7);
    let on;
    if (corner) {
      const rr = r < 7 ? r : r - 14, cc = c < 7 ? c : c - 14;
      on = rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4);
    } else {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      on = (seed >> 16) % 2 === 0;
    }
    cells.push(on ? "#171614" : "#fff");
  }
  return cells;
}

const S_INPUT = "height:56px;border:1px solid rgba(23,22,20,.14);border-radius:14px;padding:0 16px;font:500 18px Outfit,system-ui,sans-serif;background:#fff;color:#171614";
const S_LABEL = "font-size:13px;font-weight:500;color:#6F6B64";
const S_PRIMARY = "height:56px;border:0;border-radius:14px;background:#171614;color:#fff;font-size:17px;font-weight:600";
const S_BACK = "background:none;border:0;padding:8px 0;font-size:15px;color:#6F6B64";
const S_STEP = "font-size:13px;color:#6F6B64";
const S_H1 = "font-size:28px;font-weight:600;line-height:1.15";
const S_ROW = "display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border:0;border-bottom:1px solid rgba(23,22,20,.08);background:none;text-align:left;gap:12px";
const S_SHEET_BTN = "height:56px;border-radius:14px;border:1px solid rgba(23,22,20,.14);background:#fff;font-size:17px;font-weight:500;color:#171614;display:flex;justify-content:space-between;align-items:center;padding:0 18px";
const S_REPORT_BTN = "height:52px;border-radius:14px;border:1px solid rgba(23,22,20,.14);background:#fff;font-size:16px;font-weight:500;color:#171614;text-align:left;padding:0 18px";
const S_GHOST_DARK = "flex:1;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.16);background:none;color:#F2EFE9;font-size:14px;font-weight:500";

export function OwnerApp({ screen: screenProp = "home", cameraState = "recording", emptyHome = false, sheet: sheetProp = "" }) {
  const [s, setS] = useState(() => ({ screen: screenProp, flow: "onboarding", qr: "Waiting", paused: null, sheet: sheetProp || null, toast: null, skipped: [], showPw: false, cur: 0 }));
  const sRef = useRef(s);
  sRef.current = s;
  const timers = useRef([]);
  const qrCells = useMemo(buildQrCells, []);

  const patch = (extra) => setS((prev) => ({ ...prev, ...(typeof extra === "function" ? extra(prev) : extra) }));
  const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };
  const toast = (t) => { patch({ toast: t }); later(() => patch({ toast: null }), 2400); };
  function go(screen, extra) { clear(); patch({ screen, sheet: null, ...(extra || {}) }); if (screen === "qr") startQr(); }
  function startQr() {
    patch({ qr: "Waiting" });
    later(() => patch({ qr: "Reading" }), 2500);
    later(() => patch({ qr: "Connected" }), 4500);
    later(() => { if (sRef.current.flow === "rescan") { go("camera"); toast("Camera reconnected"); } else go("frame"); }, 5800);
  }

  useEffect(() => { if (sRef.current.screen === "qr") startQr(); return clear; }, []);
  const firstRender = useRef(true);
  useEffect(() => { if (firstRender.current) { firstRender.current = false; return; } if (screenProp) go(screenProp); }, [screenProp]);

  const cam = s.paused ? "paused" : cameraState;
  const pausedUntil = s.paused || "3:00 PM";
  const stt = STATUS(pausedUntil)[cam];
  const isPaused = cam === "paused";
  const visible = CLIPS.filter((c) => !s.skipped.includes(c.id));
  const homeEmpty = !!emptyHome || visible.length === 0;
  const curClip = CLIPS[s.cur] || CLIPS[0];
  const showNav = ["home", "camera", "settings"].includes(s.screen);
  const isDark = ["clip", "frame"].includes(s.screen);
  const wifiStep = s.flow === "rescan" ? "Re-scan, 1 of 2" : "Step 3 of 7";
  const qrStep = s.flow === "rescan" ? "Re-scan, 2 of 2" : "Step 4 of 7";
  const frameStep = s.flow === "framing" ? "" : "Step 5 of 7";
  const qrDotColor = s.qr === "Connected" ? "#2F8F5B" : "#E08A2E";
  const qrAnim = s.qr === "Connected" ? "none" : "qrpulse 1.2s ease-in-out infinite";
  const shopTypes = ["Barbershop", "Detailing", "Wrap shop", "Tattoo"].map((name, i) => ({ name, bg: i === 0 ? "#171614" : "#fff", color: i === 0 ? "#fff" : "#171614", border: i === 0 ? "#171614" : "rgba(23,22,20,.14)" }));
  const codeDigits = ["4", "2", "8", "", "", ""];
  const tabs = [["Clips", "home", "4px"], ["Camera", "camera", "50%"], ["Settings", "settings", "11px"]];
  const settingsRows = [["Business profile", "Fade Society, Barbershop"], ["Posting", "Clips at 8 AM by text and push"], ["Recording", "Mon to Sat, 9 to 7. Face blur on."], ["Team", "You and 1 staff"], ["Billing", "Next charge Oct 1"]];

  const skipId = (id) => patch((p) => ({ skipped: [...p.skipped, id] }));
  const shareToast = () => toast("Share sheet opens: Instagram, TikTok, Save");
  const closeSheet = () => patch({ sheet: null });

  return (
    <IOSDevice width={393} height={852} dark={isDark}>
      <div style={st("position:relative;width:100%;height:100%;display:flex;flex-direction:column;background:#F7F6F3;color:#171614;font-family:Outfit,system-ui,sans-serif;font-size:17px;line-height:1.35;overflow:hidden")}>

        {s.screen === "signin" && (
          <div style={st("flex:1;display:flex;flex-direction:column;padding:120px 24px 40px;gap:28px")}>
            <div style={st("display:flex;flex-direction:column;gap:10px")}>
              <div style={st("font-size:13px;font-weight:600;letter-spacing:.08em;color:#E08A2E")}>CONTENTSTATION</div>
              <div style={st("font-size:32px;font-weight:600;line-height:1.1;text-wrap:balance")}>Your shop, filmed while you work.</div>
              <div style={st("color:#6F6B64")}>Sign in with your phone number. No password.</div>
            </div>
            <div style={st("display:flex;flex-direction:column;gap:8px")}>
              <label style={st(S_LABEL)}>Mobile number</label>
              <input defaultValue="(415) 555-0198" inputMode="tel" style={st("height:56px;border:1px solid rgba(23,22,20,.14);border-radius:14px;padding:0 16px;font:500 20px Outfit,system-ui,sans-serif;background:#fff;color:#171614")} />
            </div>
            <div style={st("flex:1")} />
            <button onClick={() => go("code")} style={st(S_PRIMARY)}>Text me a code</button>
          </div>
        )}

        {s.screen === "code" && (
          <div style={st("flex:1;display:flex;flex-direction:column;padding:70px 24px 40px;gap:28px")}>
            <button onClick={() => go("signin")} style={st("align-self:flex-start;" + S_BACK)}>Back</button>
            <div style={st("display:flex;flex-direction:column;gap:10px")}>
              <div style={st(S_H1)}>Enter the code we texted</div>
              <div style={st("color:#6F6B64")}>Sent to (415) 555-0198</div>
            </div>
            <div style={st("display:flex;gap:8px")}>
              {codeDigits.map((d, i) => (
                <div key={i} style={st("flex:1;height:64px;border-radius:12px;background:#fff;border:1px solid rgba(23,22,20,.14);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:600")}>{d}</div>
              ))}
            </div>
            <button style={st("align-self:flex-start;background:none;border:0;padding:0;font-size:15px;color:#6F6B64;text-decoration:underline")}>Text it again</button>
            <div style={st("flex:1")} />
            <button onClick={() => go("shop")} style={st(S_PRIMARY)}>Continue</button>
          </div>
        )}

        {s.screen === "shop" && (
          <div style={st("flex:1;display:flex;flex-direction:column;padding:70px 24px 40px;gap:24px")}>
            <div style={st("display:flex;justify-content:space-between;align-items:center")}>
              <button onClick={() => go("code")} style={st(S_BACK)}>Back</button>
              <div style={st(S_STEP)}>Step 2 of 7</div>
            </div>
            <div style={st(S_H1)}>Your shop</div>
            <div style={st("display:flex;flex-direction:column;gap:8px")}>
              <label style={st(S_LABEL)}>Shop name</label>
              <input defaultValue="Fade Society" style={st(S_INPUT)} />
            </div>
            <div style={st("display:flex;flex-direction:column;gap:8px")}>
              <label style={st(S_LABEL)}>Type of shop</label>
              <div style={st("display:flex;flex-wrap:wrap;gap:8px")}>
                {shopTypes.map((t) => (
                  <button key={t.name} style={{ ...st("height:44px;padding:0 16px;border-radius:22px;font-size:16px;font-weight:500"), border: "1px solid " + t.border, background: t.bg, color: t.color }}>{t.name}</button>
                ))}
              </div>
            </div>
            <div style={st("display:flex;flex-direction:column;gap:8px")}>
              <label style={st(S_LABEL)}>Instagram (optional)</label>
              <input placeholder="@yourshop" defaultValue="@fadesociety" style={st(S_INPUT)} />
            </div>
            <div style={st("flex:1")} />
            <button onClick={() => go("wifi")} style={st(S_PRIMARY)}>Next</button>
          </div>
        )}

        {s.screen === "wifi" && (
          <div style={st("flex:1;display:flex;flex-direction:column;padding:70px 24px 40px;gap:24px")}>
            <div style={st("display:flex;justify-content:space-between;align-items:center")}>
              <button onClick={() => go(s.flow === "rescan" ? "rescan" : "shop")} style={st(S_BACK)}>Back</button>
              <div style={st(S_STEP)}>{wifiStep}</div>
            </div>
            <div style={st("display:flex;flex-direction:column;gap:8px")}>
              <div style={st(S_H1)}>Shop Wi-Fi</div>
              <div style={st("color:#6F6B64")}>The camera joins this network. We found the one your phone is on.</div>
            </div>
            <div style={st("display:flex;flex-direction:column;gap:8px")}>
              <label style={st(S_LABEL)}>Network</label>
              <input defaultValue="FadeSociety_5G" style={st(S_INPUT)} />
            </div>
            <div style={st("display:flex;flex-direction:column;gap:8px")}>
              <label style={st(S_LABEL)}>Password</label>
              <div style={st("position:relative;display:flex")}>
                <input type={s.showPw ? "text" : "password"} defaultValue="cleanfades2024" style={st("flex:1;height:56px;border:1px solid rgba(23,22,20,.14);border-radius:14px;padding:0 72px 0 16px;font:500 18px Outfit,system-ui,sans-serif;background:#fff;color:#171614")} />
                <button onClick={() => patch({ showPw: !s.showPw })} style={st("position:absolute;right:8px;top:8px;height:40px;padding:0 12px;border:0;border-radius:10px;background:#F1EFEA;font-size:14px;font-weight:500;color:#171614")}>{s.showPw ? "Hide" : "Show"}</button>
              </div>
            </div>
            <div style={st("flex:1")} />
            <button onClick={() => go("qr")} style={st(S_PRIMARY)}>Next</button>
          </div>
        )}

        {s.screen === "qr" && (
          <div style={st("flex:1;display:flex;flex-direction:column;padding:70px 24px 40px;gap:20px;align-items:center")}>
            <div style={st("display:flex;justify-content:space-between;align-items:center;width:100%")}>
              <button onClick={() => go("wifi")} style={st(S_BACK)}>Back</button>
              <div style={st(S_STEP)}>{qrStep}</div>
            </div>
            <div style={st("font-size:28px;font-weight:600;line-height:1.15;text-align:center;text-wrap:balance")}>Hold this up to the camera</div>
            <div style={st("width:280px;height:280px;padding:16px;background:#fff;border-radius:20px;box-sizing:border-box;display:grid;grid-template-columns:repeat(21,1fr);gap:0")}>
              {qrCells.map((c, i) => <div key={i} style={{ background: c }} />)}
            </div>
            <div style={st("display:flex;align-items:center;gap:10px;height:44px;padding:0 18px;border-radius:22px;background:#fff;border:1px solid rgba(23,22,20,.1)")}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: qrDotColor, animation: qrAnim }} />
              <div style={st("font-size:15px;font-weight:500")}>{s.qr}</div>
            </div>
            <div style={st("width:100%;height:120px;border-radius:14px;background:repeating-linear-gradient(135deg,#ECEAE5 0 8px,#E4E1DA 8px 16px);display:flex;align-items:center;justify-content:center;text-align:center;padding:0 24px;font:12px ui-monospace,Menlo,monospace;color:#6F6B64;box-sizing:border-box")}>illustration: person on the shop floor holding a phone up toward a corner-mounted camera</div>
            <div style={st("flex:1")} />
            <div style={st("text-align:center;color:#6F6B64;font-size:15px;text-wrap:balance")}>Stand 6 to 8 feet from the camera. This screen moves on by itself.</div>
          </div>
        )}

        {s.screen === "frame" && (
          <div style={st("flex:1;display:flex;flex-direction:column;background:#0E0D0C;color:#F2EFE9")}>
            <div style={st("position:relative;flex:1;background:repeating-linear-gradient(135deg,#1c1b19 0 14px,#171614 14px 28px)")}>
              <div style={st("position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:12px ui-monospace,Menlo,monospace;color:rgba(242,239,233,.35)")}>live preview from wall camera</div>
              <div style={st("position:absolute;left:28px;right:28px;top:160px;bottom:190px;border:3px solid #E08A2E;border-radius:12px")} />
              <div style={st("position:absolute;top:70px;left:24px;right:24px;display:flex;justify-content:space-between;align-items:center")}>
                <button onClick={() => go(s.flow === "framing" ? "camera" : "qr")} style={st("height:40px;padding:0 14px;border-radius:20px;border:0;background:rgba(255,255,255,.12);color:#F2EFE9;font-size:15px")}>Back</button>
                <div style={st("font-size:13px;color:rgba(242,239,233,.6)")}>{frameStep}</div>
              </div>
              <div style={st("position:absolute;left:24px;right:24px;bottom:120px;display:flex;flex-direction:column;gap:6px")}>
                <div style={st("font-size:24px;font-weight:600;line-height:1.15;text-wrap:balance")}>Keep the chair and mirror inside the box</div>
                <div style={st("color:rgba(242,239,233,.7);font-size:15px")}>Move the arm by hand. The preview updates live.</div>
              </div>
            </div>
            <div style={st("padding:16px 24px 44px;background:#0E0D0C")}>
              <button onClick={() => { if (s.flow === "framing") { go("camera"); toast("Shot saved"); } else go("hours"); }} style={st("width:100%;height:56px;border:0;border-radius:14px;background:#E08A2E;color:#171614;font-size:17px;font-weight:600")}>Looks good</button>
            </div>
          </div>
        )}

        {s.screen === "hours" && (
          <div style={st("flex:1;display:flex;flex-direction:column;padding:70px 24px 40px;gap:22px")}>
            <div style={st("display:flex;justify-content:space-between;align-items:center")}>
              <button onClick={() => go("frame", { flow: "onboarding" })} style={st(S_BACK)}>Back</button>
              <div style={st(S_STEP)}>Step 6 of 7</div>
            </div>
            <div style={st(S_H1)}>When should the camera record?</div>
            <div style={st("background:#fff;border:1px solid rgba(23,22,20,.1);border-radius:16px;padding:18px;display:flex;flex-direction:column;gap:6px")}>
              <div style={st("font-size:13px;color:#6F6B64")}>Hours we found for Fade Society</div>
              <div style={st("font-size:20px;font-weight:600")}>Mon to Sat, 9:00 AM to 7:00 PM</div>
              <div style={st("font-size:15px;color:#6F6B64")}>Closed Sunday</div>
            </div>
            <button style={st("height:48px;border-radius:12px;border:1px solid rgba(23,22,20,.14);background:none;font-size:16px;font-weight:500;color:#171614")}>Set my own hours</button>
            <div style={st("flex:1")} />
            <div style={st("display:flex;flex-direction:column;gap:8px;padding:16px;border-radius:14px;background:#F1EFEA")}>
              <div style={st("font-weight:600;font-size:15px")}>Good to know</div>
              <div style={st("font-size:15px;color:#3F3C37;line-height:1.45")}>The camera records only during these hours. Faces of anyone who isn't staff are blurred. Pause any time from the Camera tab, two taps. Raw footage is deleted after 48 hours.</div>
            </div>
            <button onClick={() => go("done")} style={st(S_PRIMARY)}>Use these hours</button>
          </div>
        )}

        {s.screen === "done" && (
          <div style={st("flex:1;display:flex;flex-direction:column;padding:120px 24px 40px;gap:24px")}>
            <div style={st("width:64px;height:64px;border-radius:50%;background:#E08A2E")} />
            <div style={st("display:flex;flex-direction:column;gap:10px")}>
              <div style={st("font-size:32px;font-weight:600;line-height:1.1")}>You're set.</div>
              <div style={st("color:#6F6B64;font-size:18px;text-wrap:pretty")}>The camera is recording. First clips arrive tomorrow at 8 AM. It will look like this:</div>
            </div>
            <div style={st("display:flex;gap:12px;padding:14px;border-radius:20px;background:rgba(255,255,255,.9);border:1px solid rgba(23,22,20,.08);box-shadow:0 8px 24px rgba(0,0,0,.08)")}>
              <div style={st("width:44px;height:44px;border-radius:11px;background:#171614;display:flex;align-items:center;justify-content:center;flex:none")}>
                <div style={st("width:14px;height:14px;border-radius:50%;background:#E08A2E")} />
              </div>
              <div style={st("flex:1;display:flex;flex-direction:column;gap:2px")}>
                <div style={st("display:flex;justify-content:space-between;font-size:15px")}><span style={st("font-weight:600")}>contentstation</span><span style={st("color:#6F6B64;font-size:13px")}>8:00 AM</span></div>
                <div style={st("font-size:15px;line-height:1.3")}>3 clips from today. Tap to see.</div>
              </div>
              <div style={st("width:40px;height:56px;border-radius:8px;background:repeating-linear-gradient(135deg,#3a3835 0 6px,#2c2a27 6px 12px);flex:none")} />
            </div>
            <div style={st("flex:1")} />
            <button onClick={() => go("home")} style={st(S_PRIMARY)}>Done</button>
          </div>
        )}

        {s.screen === "home" && (
          <div style={st("flex:1;overflow:auto;display:flex;flex-direction:column")}>
            <div style={st("padding:66px 20px 12px;display:flex;flex-direction:column;gap:6px")}>
              <div style={st("font-size:28px;font-weight:600;line-height:1.1")}>Today</div>
              <button onClick={() => go("camera")} style={st("display:flex;align-items:center;gap:8px;background:none;border:0;padding:0;font-size:15px;color:#6F6B64;text-align:left")}>
                <div style={{ width: 9, height: 9, borderRadius: "50%", background: stt.color, flex: "none" }} />
                {stt.short}
              </button>
            </div>
            {homeEmpty ? (
              <div style={st("padding:8px 20px 24px;display:flex;flex-direction:column;gap:14px")}>
                <div style={st("aspect-ratio:9/12;border-radius:20px;background:repeating-linear-gradient(135deg,#3a3835 0 14px,#2c2a27 14px 28px);position:relative;display:flex;align-items:flex-end;padding:18px;box-sizing:border-box")}>
                  <div style={st("position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:12px ui-monospace,Menlo,monospace;color:rgba(242,239,233,.45)")}>still: what the camera saw at 11:40 AM</div>
                  <div style={st("color:#F2EFE9;font-size:14px;background:rgba(0,0,0,.45);padding:6px 10px;border-radius:8px;position:relative")}>Seen today, 11:40 AM</div>
                </div>
                <div style={st("font-size:20px;font-weight:600")}>No clips yet</div>
                <div style={st("color:#6F6B64;font-size:16px;line-height:1.45;text-wrap:pretty")}>The camera has recorded 2 hours so far. Clips arrive tomorrow at 8 AM, once there's a full day to pick from.</div>
              </div>
            ) : (
              <div style={st("padding:8px 20px 24px;display:flex;flex-direction:column;gap:28px")}>
                {visible.map((clip) => (
                  <div key={clip.id} style={st("display:flex;flex-direction:column;gap:12px")}>
                    <button onClick={() => go("clip", { cur: clip.id })} style={{ ...st("position:relative;padding:0;border:0;aspect-ratio:9/16;border-radius:20px;overflow:hidden;text-align:left;display:block;width:100%"), background: clip.bg }}>
                      <div style={st("position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:12px ui-monospace,Menlo,monospace;color:rgba(242,239,233,.45);padding:0 40px;text-align:center")}>{clip.footage}</div>
                      <div style={st("position:absolute;left:14px;bottom:14px;padding:5px 9px;border-radius:8px;background:rgba(0,0,0,.55);color:#F2EFE9;font-size:13px;font-weight:500;font-variant-numeric:tabular-nums")}>{clip.dur}</div>
                      <div style={st("position:absolute;right:14px;bottom:14px;width:40px;height:40px;border-radius:50%;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center")}>
                        <div style={st("width:0;height:0;border-left:12px solid #F2EFE9;border-top:7px solid transparent;border-bottom:7px solid transparent;margin-left:3px")} />
                      </div>
                    </button>
                    <div style={st("font-size:16px;line-height:1.35;color:#171614")}>{clip.caption}</div>
                    <div style={st("display:flex;gap:10px")}>
                      <button onClick={shareToast} style={st("flex:1;height:48px;border:0;border-radius:12px;background:#171614;color:#fff;font-size:16px;font-weight:600")}>Share</button>
                      <button onClick={() => { skipId(clip.id); toast("Skipped. We'll show fewer like this."); }} style={st("flex:1;height:48px;border-radius:12px;border:1px solid rgba(23,22,20,.14);background:none;font-size:16px;font-weight:500;color:#171614")}>Skip</button>
                    </div>
                  </div>
                ))}
                <div style={st("display:flex;align-items:center;justify-content:space-between;padding:12px 0 8px;border-top:1px solid rgba(23,22,20,.08)")}>
                  <div style={st("color:#6F6B64;font-size:15px")}>Yesterday</div>
                  <div style={st("font-size:15px;font-weight:500")}>2 clips</div>
                </div>
              </div>
            )}
          </div>
        )}

        {s.screen === "clip" && (
          <div style={st("flex:1;display:flex;flex-direction:column;background:#0E0D0C;color:#F2EFE9")}>
            <div style={{ ...st("position:relative;flex:1"), background: curClip.bg }}>
              <div style={st("position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:12px ui-monospace,Menlo,monospace;color:rgba(242,239,233,.45);padding:0 40px;text-align:center")}><span>{curClip.footage}, playing with sound on</span></div>
              <div style={st("position:absolute;top:66px;left:20px;right:20px;display:flex;justify-content:space-between;align-items:center")}>
                <button onClick={() => go("home")} style={st("height:40px;padding:0 14px;border-radius:20px;border:0;background:rgba(255,255,255,.14);color:#F2EFE9;font-size:15px")}>Back</button>
                <div style={st("font-size:13px;color:rgba(242,239,233,.7);font-variant-numeric:tabular-nums")}>{curClip.dur}</div>
              </div>
              <div style={st("position:absolute;left:20px;right:20px;bottom:16px;height:3px;border-radius:2px;background:rgba(255,255,255,.25)")}>
                <div style={st("width:38%;height:100%;border-radius:2px;background:#E08A2E")} />
              </div>
            </div>
            <div style={st("padding:16px 20px 44px;display:flex;flex-direction:column;gap:14px;background:#0E0D0C")}>
              <div style={st("display:flex;flex-direction:column;gap:6px")}>
                <div style={st("font-size:12px;color:rgba(242,239,233,.55);font-weight:500;letter-spacing:.04em")}>CAPTION, TAP TO EDIT</div>
                <input key={curClip.id} defaultValue={curClip.caption} style={st("height:48px;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:0 14px;background:rgba(255,255,255,.06);color:#F2EFE9;font:400 16px Outfit,system-ui,sans-serif")} />
              </div>
              <button onClick={shareToast} style={st("height:56px;border:0;border-radius:14px;background:#E08A2E;color:#171614;font-size:17px;font-weight:600")}>Share</button>
              <div style={st("display:flex;gap:8px")}>
                <button style={st(S_GHOST_DARK)}>Download</button>
                <button onClick={() => { go("home", { skipped: [...s.skipped, s.cur] }); toast("Skipped. We'll show fewer like this."); }} style={st(S_GHOST_DARK)}>Skip</button>
                <button onClick={() => patch({ sheet: "delete" })} style={st(S_GHOST_DARK)}>Delete</button>
                <button onClick={() => patch({ sheet: "report" })} style={st(S_GHOST_DARK)}>Report</button>
              </div>
            </div>
          </div>
        )}

        {s.screen === "camera" && (
          <div style={st("flex:1;overflow:auto;display:flex;flex-direction:column")}>
            <div style={st("padding:66px 20px 12px;font-size:28px;font-weight:600;line-height:1.1")}>Camera</div>
            <div style={st("padding:8px 20px 24px;display:flex;flex-direction:column;gap:16px")}>
              <div style={{ ...st("border-radius:20px;padding:20px;display:flex;flex-direction:column;gap:14px;color:#171614"), background: stt.bg }}>
                <div style={st("display:flex;align-items:center;gap:10px")}>
                  <div style={{ width: 12, height: 12, borderRadius: "50%", background: stt.color }} />
                  <div style={st("font-size:22px;font-weight:600;line-height:1.15")}>{stt.title}</div>
                </div>
                <div style={st("font-size:15px;color:#3F3C37;line-height:1.4")}>{stt.sub}</div>
                {isPaused && <button onClick={() => { patch({ paused: null }); toast("Recording again."); }} style={st("height:48px;border:0;border-radius:12px;background:#171614;color:#fff;font-size:16px;font-weight:600")}>Resume now</button>}
                <div style={st("display:flex;gap:14px;align-items:center")}>
                  <div style={st("width:72px;height:96px;border-radius:10px;background:repeating-linear-gradient(135deg,#3a3835 0 8px,#2c2a27 8px 16px);flex:none")} />
                  <div style={st("display:flex;flex-direction:column;gap:6px;font-size:15px;flex:1")}>
                    <div style={st("display:flex;justify-content:space-between")}><span style={st("color:#6F6B64")}>Wi-Fi</span><span style={st("font-weight:500")}>{stt.wifi}</span></div>
                    <div style={st("display:flex;justify-content:space-between")}><span style={st("color:#6F6B64")}>Temperature</span><span style={st("font-weight:500")}>Normal</span></div>
                    <div style={st("display:flex;justify-content:space-between")}><span style={st("color:#6F6B64")}>Last seen</span><span style={st("font-weight:500")}>{stt.seen}</span></div>
                    <div style={st("display:flex;justify-content:space-between")}><span style={st("color:#6F6B64")}>Records</span><span style={st("font-weight:500")}>Mon to Sat, 9 to 7</span></div>
                  </div>
                </div>
              </div>
              <div style={st("background:#fff;border:1px solid rgba(23,22,20,.08);border-radius:20px;overflow:hidden;display:flex;flex-direction:column")}>
                <button onClick={() => patch({ sheet: "pause" })} style={st(S_ROW)}>
                  <div style={st("display:flex;flex-direction:column;gap:2px")}><div style={st("font-size:17px;font-weight:600")}>{isPaused ? "Change pause" : "Pause recording"}</div><div style={st("font-size:14px;color:#6F6B64")}>For an hour, the rest of today, or until you say</div></div>
                  <div style={st("color:#B8B3AA;font-size:20px")}>›</div>
                </button>
                <button onClick={() => go("frame", { flow: "framing" })} style={st(S_ROW)}>
                  <div style={st("display:flex;flex-direction:column;gap:2px")}><div style={st("font-size:17px;font-weight:600")}>Check the shot</div><div style={st("font-size:14px;color:#6F6B64")}>Live preview and framing guide</div></div>
                  <div style={st("color:#B8B3AA;font-size:20px")}>›</div>
                </button>
                <button onClick={() => go("rescan")} style={st(S_ROW)}>
                  <div style={st("display:flex;flex-direction:column;gap:2px")}><div style={st("font-size:17px;font-weight:600")}>Re-scan QR</div><div style={st("font-size:14px;color:#6F6B64")}>If you changed your Wi-Fi password</div></div>
                  <div style={st("color:#B8B3AA;font-size:20px")}>›</div>
                </button>
                <button onClick={() => go("replace")} style={{ ...st(S_ROW), borderBottom: 0 }}>
                  <div style={st("display:flex;flex-direction:column;gap:2px")}><div style={st("font-size:17px;font-weight:600")}>Replace camera</div><div style={st("font-size:14px;color:#6F6B64")}>Swap in a spare phone</div></div>
                  <div style={st("color:#B8B3AA;font-size:20px")}>›</div>
                </button>
              </div>
              <div style={st("font-size:13px;color:#6F6B64;line-height:1.45;padding:0 4px")}>This camera films the work at chair 1. Faces of anyone who isn't staff are blurred. Raw footage is deleted after 48 hours.</div>
            </div>
          </div>
        )}

        {s.screen === "rescan" && (
          <div style={st("flex:1;display:flex;flex-direction:column;padding:70px 24px 40px;gap:24px")}>
            <button onClick={() => go("camera")} style={st("align-self:flex-start;" + S_BACK)}>Back</button>
            <div style={st("display:flex;flex-direction:column;gap:10px")}>
              <div style={st(S_H1)}>Re-scan QR</div>
              <div style={st("color:#6F6B64;font-size:17px;line-height:1.45;text-wrap:pretty")}>Use this if you changed your Wi-Fi name or password, or the camera says "Re-scan QR". Takes about a minute. You'll enter the Wi-Fi, then hold your phone up to the camera.</div>
            </div>
            <div style={st("flex:1")} />
            <button onClick={() => go("wifi", { flow: "rescan" })} style={st(S_PRIMARY)}>Start</button>
          </div>
        )}

        {s.screen === "replace" && (
          <div style={st("flex:1;display:flex;flex-direction:column;padding:70px 24px 40px;gap:24px")}>
            <button onClick={() => go("camera")} style={st("align-self:flex-start;" + S_BACK)}>Back</button>
            <div style={st(S_H1)}>Replace camera</div>
            <div style={st("display:flex;flex-direction:column;gap:14px")}>
              {[
                "Unclip the old phone from the mount. Nothing else to do on it.",
                "Clip in the spare and plug it in. Wait for the code to show.",
                "Tap Next and hold your phone up to it. Your framing and hours carry over.",
              ].map((t, i) => (
                <div key={i} style={st("display:flex;gap:14px;align-items:baseline")}>
                  <div style={st("font-size:22px;font-weight:600;color:#E08A2E;width:24px")}>{i + 1}</div>
                  <div style={st("font-size:17px;line-height:1.4")}>{t}</div>
                </div>
              ))}
            </div>
            <div style={st("flex:1")} />
            <button onClick={() => go("wifi", { flow: "rescan" })} style={st(S_PRIMARY)}>Next</button>
          </div>
        )}

        {s.screen === "settings" && (
          <div style={st("flex:1;overflow:auto;display:flex;flex-direction:column")}>
            <div style={st("padding:66px 20px 12px;font-size:28px;font-weight:600;line-height:1.1")}>Settings</div>
            <div style={st("padding:8px 20px 24px;display:flex;flex-direction:column;gap:16px")}>
              <div style={st("background:#fff;border:1px solid rgba(23,22,20,.08);border-radius:20px;overflow:hidden;display:flex;flex-direction:column")}>
                {settingsRows.map(([name, sub]) => (
                  <div key={name} style={st("display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid rgba(23,22,20,.08);gap:12px")}>
                    <div style={st("display:flex;flex-direction:column;gap:2px")}><div style={st("font-size:17px;font-weight:600")}>{name}</div><div style={st("font-size:14px;color:#6F6B64")}>{sub}</div></div>
                    <div style={st("color:#B8B3AA;font-size:20px")}>›</div>
                  </div>
                ))}
              </div>
              <div style={st("font-size:13px;color:#6F6B64;line-height:1.45;padding:0 4px")}>Raw footage is deleted after 48 hours. Clips are kept until you delete them.</div>
              <div style={st("font-size:12px;color:#B8B3AA;padding:0 4px")}>Full settings are P1.</div>
            </div>
          </div>
        )}

        {showNav && (
          <div style={st("display:flex;border-top:1px solid rgba(23,22,20,.08);background:#F7F6F3;padding:8px 0 28px")}>
            {tabs.map(([name, k, radius]) => {
              const color = s.screen === k ? "#171614" : "#A39E95";
              return (
                <button key={k} onClick={() => go(k)} style={{ ...st("flex:1;height:48px;border:0;background:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px"), color }}>
                  <div style={{ width: 22, height: 22, borderRadius: radius, border: "2.5px solid " + color, boxSizing: "border-box" }} />
                  <div style={st("font-size:12px;font-weight:600")}>{name}</div>
                </button>
              );
            })}
          </div>
        )}

        {s.sheet === "pause" && (
          <>
            <div onClick={closeSheet} style={st("position:absolute;inset:0;background:rgba(23,22,20,.4)")} />
            <div style={st("position:absolute;left:8px;right:8px;bottom:8px;background:#F7F6F3;border-radius:28px;padding:22px 20px 24px;display:flex;flex-direction:column;gap:14px;box-shadow:0 -8px 40px rgba(0,0,0,.2)")}>
              <div style={st("display:flex;flex-direction:column;gap:4px")}><div style={st("font-size:22px;font-weight:600")}>Pause recording</div><div style={st("font-size:15px;color:#6F6B64")}>Nothing is filmed while paused. It's now 1:58 PM.</div></div>
              <button onClick={() => { patch({ paused: "3:00 PM", sheet: null }); toast("Paused. Resumes at 3:00 PM."); }} style={st(S_SHEET_BTN)}><span>1 hour</span><span style={st("color:#6F6B64;font-size:15px")}>Resumes 3:00 PM</span></button>
              <button onClick={() => { patch({ paused: "tomorrow 9:00 AM", sheet: null }); toast("Paused. Resumes tomorrow at 9:00 AM."); }} style={st(S_SHEET_BTN)}><span>Rest of today</span><span style={st("color:#6F6B64;font-size:15px")}>Resumes tomorrow 9:00 AM</span></button>
              <button onClick={() => { patch({ paused: "you resume", sheet: null }); toast("Paused until you resume."); }} style={st(S_SHEET_BTN)}><span>Until I resume</span><span style={st("color:#6F6B64;font-size:15px")}>We'll remind you daily</span></button>
              <button onClick={closeSheet} style={st("height:48px;border:0;background:none;font-size:16px;color:#6F6B64")}>Cancel</button>
            </div>
          </>
        )}

        {s.sheet === "delete" && (
          <>
            <div onClick={closeSheet} style={st("position:absolute;inset:0;background:rgba(0,0,0,.5)")} />
            <div style={st("position:absolute;left:8px;right:8px;bottom:8px;background:#F7F6F3;border-radius:28px;padding:22px 20px 24px;display:flex;flex-direction:column;gap:14px;color:#171614")}>
              <div style={st("display:flex;flex-direction:column;gap:6px")}><div style={st("font-size:22px;font-weight:600")}>Delete forever?</div><div style={st("font-size:15px;color:#3F3C37;line-height:1.45")}>This removes the clip and the 42 seconds of footage it came from. It can't be recovered.</div></div>
              <button onClick={() => { go("home", { skipped: [...s.skipped, s.cur] }); toast("Deleted. Clip and footage are gone."); }} style={st("height:56px;border:0;border-radius:14px;background:#C94B32;color:#fff;font-size:17px;font-weight:600")}>Delete clip and footage</button>
              <button onClick={closeSheet} style={st("height:48px;border:0;background:none;font-size:16px;color:#6F6B64")}>Keep it</button>
            </div>
          </>
        )}

        {s.sheet === "report" && (
          <>
            <div onClick={closeSheet} style={st("position:absolute;inset:0;background:rgba(0,0,0,.5)")} />
            <div style={st("position:absolute;left:8px;right:8px;bottom:8px;background:#F7F6F3;border-radius:28px;padding:22px 20px 24px;display:flex;flex-direction:column;gap:10px;color:#171614")}>
              <div style={st("font-size:22px;font-weight:600;margin-bottom:4px")}>What's wrong with it?</div>
              {["Wrong moment", "Bad crop", "Shouldn't have been filmed"].map((t) => (
                <button key={t} onClick={() => { go("home", { skipped: [...s.skipped, s.cur] }); toast("Thanks. We'll take a look."); }} style={st(S_REPORT_BTN)}>{t}</button>
              ))}
              <button onClick={closeSheet} style={st("height:48px;border:0;background:none;font-size:16px;color:#6F6B64")}>Cancel</button>
            </div>
          </>
        )}

        {s.toast && (
          <div style={st("position:absolute;left:20px;right:20px;top:66px;display:flex;justify-content:center;pointer-events:none")}>
            <div style={st("padding:12px 18px;border-radius:14px;background:#171614;color:#fff;font-size:15px;font-weight:500;box-shadow:0 8px 24px rgba(0,0,0,.2)")}>{s.toast}</div>
          </div>
        )}
      </div>
    </IOSDevice>
  );
}

// ---------------------------------------------------------------------------
// Board (port of ContentStation Board.dc.html)
// ---------------------------------------------------------------------------
const WALL_BOARD = [
  ["waiting", "Waiting for setup", "Short code doubles as the glyph. Exits when the QR is read."],
  ["reading", "Reading QR", "Solid amber disc. Tells the owner to lower the phone."],
  ["connecting", "Connecting", "Real progress bar with the network name. Never a bare spinner."],
  ["framing", "Framing", "Live preview and guide box. The owner watches on their own phone."],
  ["recording", "Recording", "Black screen, amber edge glow, one dot. This is all a customer sees."],
  ["paused", "Paused", "Resume time in plain words."],
  ["nointernet", "No internet, 2 min", "Dashed ring. Footage is safe on the phone."],
  ["nointernet_long", "No internet, 10 min", "Escalates to the re-scan instruction."],
  ["reframe", "Re-frame needed", "Tilted frame glyph. Sends the owner to their phone."],
  ["hot", "Too hot", "Cooling down. No numbers."],
  ["fault", "Fault", "Our number and an error code. Manual exit."],
].map(([id, name, note]) => ({ id, name, note }));

const ONBOARDING_BOARD = [
  ["signin", "Step 1, sign in", "Phone number only."],
  ["code", "Step 1b, code", "Six digits, auto-advances on the last one."],
  ["shop", "Step 2, your shop", "Three fields max. Type drives the framing guide."],
  ["wifi", "Step 3, Wi-Fi", "Network pre-filled when the browser allows. Password reveal."],
  ["qr", "Step 4, show the camera", "Live status below the QR. Advances by itself, no tap."],
  ["frame", "Step 5, frame the shot", "Barbershop guide. One button."],
  ["hours", "Step 6, recording hours", "Hours from Google, plus the consent moment."],
  ["done", "Step 7, done", "Preview of tomorrow's notification."],
].map(([id, name, note]) => ({ id, name, note }));

const HOME_BOARD = [
  { id: "home", empty: false, sheet: "", name: "Home, today's clips", note: "Status line under the date links to Camera. Autoplay muted on scroll." },
  { id: "home", empty: true, sheet: "", name: "Home, empty", note: "A still of what the camera saw, and when clips are expected. Never blank." },
  { id: "clip", empty: false, sheet: "", name: "Clip detail", note: "Sound on. Caption editable in place. Nothing else." },
  { id: "clip", empty: false, sheet: "delete", name: "Delete forever", note: "Says exactly what goes: the clip and its source footage." },
];

const CAMERA_BOARD = [
  { id: "camera", cam: "recording", sheet: "", name: "Status, recording", note: "Green. Last frame, Wi-Fi, temperature as a word, last seen, hours." },
  { id: "camera", cam: "offline", sheet: "", name: "Status, no internet", note: "Yellow. Points to re-scan if Wi-Fi changed." },
  { id: "camera", cam: "attention", sheet: "", name: "Status, needs attention", note: "Red. Camera moved, check the shot." },
  { id: "camera", cam: "recording", sheet: "pause", name: "Pause sheet", note: "Each option shows exactly when recording resumes." },
  { id: "camera", cam: "paused", sheet: "", name: "Status, paused", note: "Resume now is right in the card." },
  { id: "rescan", cam: "recording", sheet: "", name: "Re-scan QR", note: "One line on when to use it. Re-runs Wi-Fi and QR only." },
  { id: "replace", cam: "recording", sheet: "", name: "Replace camera", note: "Three steps. Framing and hours carry over." },
];

const S_SECTION = "padding:40px 56px;border-bottom:1px solid rgba(23,22,20,.08);display:flex;flex-direction:column;gap:20px";
const S_SECTION_HEAD = "display:flex;align-items:baseline;gap:14px;flex-wrap:wrap";
const S_H2 = "font-size:24px;font-weight:600";
const S_SUB = "font-size:14px;color:#6F6B64";
const S_CARD_NAME = "font-size:26px;font-weight:600";
const S_CARD_NOTE = "font-size:22px;color:#6F6B64;line-height:1.4";

function Caption({ name, note }) {
  return (
    <>
      <div style={st(S_CARD_NAME)}>{name}</div>
      <div style={st(S_CARD_NOTE)}>{note}</div>
    </>
  );
}

function Card({ width, children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 14, width }}>{children}</div>;
}

function Switcher({ options, value, onChange, labels }) {
  return (
    <div style={st("display:flex;flex-wrap:wrap;gap:8px")}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button key={o} onClick={() => onChange(o)} style={{ ...st("height:36px;padding:0 14px;border-radius:18px;font-size:14px;font-weight:500"), border: "1px solid " + (on ? INK : "rgba(23,22,20,.14)"), background: on ? INK : "#fff", color: on ? "#fff" : INK }}>
            {labels ? labels[o] : o}
          </button>
        );
      })}
    </div>
  );
}

function PrototypeSection() {
  const [wallState, setWallState] = useState("waiting");
  const [ownerKey, setOwnerKey] = useState(0);
  const wallLabels = Object.fromEntries(WALL_BOARD.map((w) => [w.id, w.name]));
  return (
    <section id="prototype" style={st(S_SECTION)}>
      <div style={st(S_SECTION_HEAD)}>
        <div style={st(S_H2)}>Prototypes</div>
        <div style={st(S_SUB)}>Owner app end to end from sign in, and the wall app with a state switcher.</div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 56, alignItems: "flex-start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={st("display:flex;align-items:center;gap:12px")}>
            <div style={st("font-size:16px;font-weight:600")}>Owner App</div>
            <button onClick={() => setOwnerKey((k) => k + 1)} style={{ ...st("height:36px;padding:0 14px;border-radius:18px;font-size:14px;font-weight:500;background:#fff;color:#171614"), border: "1px solid rgba(23,22,20,.14)" }}>Restart from sign in</button>
          </div>
          <OwnerApp key={ownerKey} screen="signin" />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 560 }}>
          <div style={st("font-size:16px;font-weight:600")}>Wall App</div>
          <Switcher options={WALL_STATES} value={wallState} onChange={setWallState} labels={wallLabels} />
          <WallApp key={wallState} state={wallState} />
        </div>
      </div>
    </section>
  );
}

export default function ContentStationBoard() {
  return (
    <div className="cs-board" style={{ margin: 0, background: "#ECEAE5", fontFamily: FONT, color: INK, minHeight: "100vh" }}>
      <GlobalStyle />

      <section id="context" style={st("padding:48px 56px 40px;border-bottom:1px solid rgba(23,22,20,.08);display:flex;flex-direction:column;gap:20px;max-width:1100px")}>
        <div style={st("font-size:13px;font-weight:600;letter-spacing:.08em;color:#E08A2E")}>CONTENTSTATION.AI, P0 DESIGN PASS 1</div>
        <div style={st("font-size:40px;font-weight:600;line-height:1.05;text-wrap:balance")}>Wall app states, onboarding, Home, Clip detail, Camera</div>
        <div style={st("display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:28px;font-size:15px;line-height:1.5;color:#3F3C37")}>
          <div><div style={st("font-weight:600;color:#171614;margin-bottom:6px")}>Direction</div>Quiet utility. Warm off-white, near-black ink, one amber accent used only for recording state and the primary action on dark screens. Outfit for everything. Footage is the UI; chrome stays thin.</div>
          <div><div style={st("font-weight:600;color:#171614;margin-bottom:6px")}>Assumptions</div>Sample shop is a barbershop, Fade Society, chair 1. Placeholder striped panels stand in for footage and the QR illustration. Wall phone shows nothing to customers but the amber edge glow. Numbers, names, and times are fictional.</div>
          <div><div style={st("font-weight:600;color:#171614;margin-bottom:6px")}>How to use this</div>Every phone below is live. Tap through the owner app in any frame, or jump to the <a href="#prototype">Prototypes</a> section for the full owner app from sign in and the wall app state switcher. Pause is two taps from anywhere: Camera tab, then Pause.</div>
        </div>
      </section>

      <section id="wall" style={st(S_SECTION)}>
        <div style={st(S_SECTION_HEAD)}>
          <div style={st(S_H2)}>1. Wall app, all states</div>
          <div style={st(S_SUB)}>iPhone 12, 390 by 844. Dark background, 44px line one, legible at 8 ft and minimum brightness. No touch targets.</div>
        </div>
        <div style={{ zoom: 0.5, display: "flex", flexWrap: "wrap", gap: 40, alignItems: "flex-start" }}>
          {WALL_BOARD.map((w) => (
            <Card key={w.id} width={390}>
              <WallApp state={w.id} />
              <Caption name={w.name} note={w.note} />
            </Card>
          ))}
        </div>
        <div style={st("display:flex;gap:24px;align-items:flex-start;padding:20px;background:#fff;border-radius:16px;max-width:900px")}>
          <div style={st("width:60px;height:110px;border-radius:12px;background:#000;box-shadow:inset 0 0 14px 3px rgba(224,138,46,.7);flex:none")} />
          <div style={st("font-size:15px;line-height:1.5;color:#3F3C37")}>
            <div style={st("font-weight:600;color:#171614")}>Recording indicator</div>
            A steady warm amber glow along the screen edge, plus a 14px dot. Amber, not red, so it never reads as a security camera. The glow is the only thing a customer sees; the screen itself stays black. Every other state is also mirrored in the owner app and as a notification, since the wall screen may face the ceiling.
          </div>
        </div>
      </section>

      <section id="onboarding" style={st(S_SECTION)}>
        <div style={st(S_SECTION_HEAD)}>
          <div style={st(S_H2)}>2. Onboarding, box open to first frame</div>
          <div style={st(S_SUB)}>Target under five minutes. The wall phone is never touched after mounting. Back is always available.</div>
        </div>
        <div style={{ zoom: 0.6, display: "flex", flexWrap: "wrap", gap: 40, alignItems: "flex-start" }}>
          <Card width={393}>
            <div style={st("width:393px;height:852px;display:flex;align-items:center;justify-content:center")}>
              <div style={st("width:380px;height:266px;background:#F7F6F3;border-radius:6px;box-shadow:0 20px 50px rgba(0,0,0,.18),0 0 0 1px rgba(0,0,0,.06);padding:30px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between")}>
                <div style={st("font-size:12px;font-weight:600;letter-spacing:.08em;color:#E08A2E")}>CONTENTSTATION</div>
                <div style={st("font-size:30px;font-weight:600;line-height:1.15;text-wrap:balance")}>Mount it.<br />Plug it in.<br />Text START to (415) 555-0142.</div>
                <div style={st("font-size:13px;color:#6F6B64")}>That's the whole setup. We'll text you a link. Takes about five minutes.</div>
              </div>
            </div>
            <Caption name="Step 0, card in the box" note="5 by 3.5 in. Front only. The text reply carries the sign-in link." />
          </Card>
          {ONBOARDING_BOARD.map((o) => (
            <Card key={o.id} width={393}>
              <OwnerApp screen={o.id} />
              <Caption name={o.name} note={o.note} />
            </Card>
          ))}
        </div>
      </section>

      <section id="home" style={st(S_SECTION)}>
        <div style={st(S_SECTION_HEAD)}>
          <div style={st(S_H2)}>3. Home and Clip detail</div>
          <div style={st(S_SUB)}>Opened from the morning notification. Clips first, one column, Share and Skip under every card.</div>
        </div>
        <div style={{ zoom: 0.6, display: "flex", flexWrap: "wrap", gap: 40, alignItems: "flex-start" }}>
          {HOME_BOARD.map((o, i) => (
            <Card key={i} width={393}>
              <OwnerApp screen={o.id} emptyHome={o.empty} sheet={o.sheet} />
              <Caption name={o.name} note={o.note} />
            </Card>
          ))}
        </div>
      </section>

      <section id="camera" style={st(S_SECTION)}>
        <div style={st(S_SECTION_HEAD)}>
          <div style={st(S_H2)}>4. Camera</div>
          <div style={st(S_SUB)}>Status card first, then four actions. Pause is reachable in two taps from anywhere.</div>
        </div>
        <div style={{ zoom: 0.6, display: "flex", flexWrap: "wrap", gap: 40, alignItems: "flex-start" }}>
          {CAMERA_BOARD.map((o, i) => (
            <Card key={i} width={393}>
              <OwnerApp screen={o.id} cameraState={o.cam} sheet={o.sheet} />
              <Caption name={o.name} note={o.note} />
            </Card>
          ))}
        </div>
      </section>

      <PrototypeSection />

      <section id="next" style={st("padding:40px 56px 64px;display:flex;flex-direction:column;gap:12px;max-width:900px")}>
        <div style={st(S_H2)}>Next</div>
        <div style={st("font-size:15px;line-height:1.6;color:#3F3C37")}>Not yet designed from P0: lock-screen notification mockups, the printable recording sign, and the four flow diagrams. Open for your call: whether the Skip button belongs on the Home card or only in Clip detail, and whether staff can delete clips. Footage panels are placeholders until real clips exist.</div>
      </section>
    </div>
  );
}
