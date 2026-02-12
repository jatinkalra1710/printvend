import React, { useEffect, useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { Document, Page, pdfjs } from "react-pdf";
import { QRCodeCanvas } from "qrcode.react";
import "./index.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const RATES = { bw_single: 1.5, bw_double: 1.1, col_single: 5.0, col_double: 4.5 };
const GST = 0.18;
const COIN_VAL = 0.1;

const SUPPORTED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/jpg",
];

const isPDF = (file) => file?.type === "application/pdf";

function makeOrderId() {
  const now = new Date();
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `INPVD${String(now.getDate()).padStart(2, "0")}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getFullYear()).slice(-2)}${rand}`;
}
function isQrActive(order) {
  if (order.status === "PRINTED") return false;
  return new Date(order.expires_at) > new Date();
}

// format currency
const fmt = (n) => `₹${Number(n || 0).toFixed(2)}`;

// returns total seconds remaining (can be negative)
function getSecondsLeft(expiresAt) {
  return Math.floor((new Date(expiresAt) - new Date()) / 1000);
}

// format seconds -> Hh Mm Ss or mm:ss
function formatSeconds(seconds) {
  if (seconds <= 0) return "Expired";

  const s = seconds % 60;
  const m = Math.floor((seconds % 3600) / 60);
  const h = Math.floor(seconds / 3600);

  if (h > 0) {
    return `${h}h ${m}m ${String(s).padStart(2, "0")}s`;
  }

  return `${m}m ${String(s).padStart(2, "0")}s`;
}


/* ---------- Countdown component (updates every second) ---------- */
function Countdown({ expiresAt, onExpire }) {
  const [secs, setSecs] = useState(getSecondsLeft(expiresAt));
  const ref = useRef(null);

  useEffect(() => {
    setSecs(getSecondsLeft(expiresAt));
    if (ref.current) clearInterval(ref.current);
    ref.current = setInterval(() => {
      setSecs((p) => {
        const next = getSecondsLeft(expiresAt);
        if (next <= 0) {
          clearInterval(ref.current);
          if (onExpire) onExpire();
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(ref.current);
  }, [expiresAt, onExpire]);

let cls = "timer-normal";
if (secs <= 60) cls = "timer-danger";
else if (secs <= 300) cls = "timer-warning";

if (secs <= 0) {
  return <span className="timer-danger">Expired</span>;
}

return (
  <span className={cls}>
    {formatSeconds(secs)}
  </span>
);


}

/* ---------- UI components ---------- */
const Spinner = () => (
  <div className="spinner-overlay">
    <div className="printer-loader">
      <div className="printer-top"></div>
      <div className="printer-paper"></div>
      <div className="printer-bottom">
        <div className="printer-light"></div>
      </div>
    </div>
  </div>
);

const StatusIcon = ({ type }) => (
  <div className={`status-icon-box ${type === "success" ? "success-bg" : "error-bg"}`}>
    {type === "success" ? (
      <svg xmlns="http://www.w3.org/2000/svg" className="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    ) : (
      <svg xmlns="http://www.w3.org/2000/svg" className="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="15" y1="9" x2="9" y2="15"></line>
        <line x1="9" y1="9" x2="15" y2="15"></line>
      </svg>
    )}
  </div>
);

const SupportModal = ({ order, profile, onClose, onSubmit }) => {
  const [msg, setMsg] = useState("");
  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Report Issue</h3>
          <button className="link-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 10 }}>
          Order: <b>{order.order_id}</b>
        </p>
        <textarea className="glass-input" rows={4} placeholder="Describe issue..." value={msg} onChange={(e) => setMsg(e.target.value)} autoFocus />
        <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
          <button className="btn" onClick={() => onSubmit(order.order_id, `[${profile.full_name}] ${msg}`)} disabled={!msg.trim()}>
            Submit
          </button>
        </div>
      </div>
    </div>
  );
};

const WalletModal = ({ history, onClose }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal" onClick={(e) => e.stopPropagation()}>
      <div className="modal-header">
        <h3>Wallet History</h3>
        <button className="link-btn" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="modal-content">
        {history.length === 0 && <p style={{ textAlign: "center", opacity: 0.5 }}>No transactions.</p>}
        {history.map((tx, i) => (
          <div key={i} className="history-item">
            <div className="h-left">
              <div className="h-id">{tx.type === "EARN" ? "Cashback Received" : "Payment Made"}</div>
              <div className="h-date">{new Date(tx.created_at).toLocaleDateString()}</div>
            </div>
            <div className="h-right" style={{ color: tx.amount > 0 ? "#16a34a" : "#dc2626", fontWeight: 800 }}>
              {tx.amount > 0 ? "+" : ""}
              {tx.amount}
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

export default function App() {
  // state
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({});
  const [file, setFile] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [selectedPages, setSelectedPages] = useState([]);
  const [color, setColor] = useState(false);
  const [doubleSide, setDoubleSide] = useState(false);
  const [copies, setCopies] = useState(1);
  const [coins, setCoins] = useState(0);
  const [orders, setOrders] = useState([]);
  const [walletHistory, setWalletHistory] = useState([]);
  const [adminStats, setAdminStats] = useState(null);
  const [adminDate, setAdminDate] = useState(new Date().toISOString().split("T")[0]);
  const [tab, setTab] = useState("home");
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState(null);
  const [useCoins, setUseCoins] = useState(false);
  const [viewHistory, setViewHistory] = useState(false);
  const [supportOrder, setSupportOrder] = useState(null);
  const [showWallet, setShowWallet] = useState(false);

  // derived pricing state (recalculated on relevant changes)
  const calculate = () => {
    const isVIP = profile?.role === "VIP";
    const rate = color ? (doubleSide ? RATES.col_double : RATES.col_single) : doubleSide ? RATES.bw_double : RATES.bw_single;
    const totalSheets = (selectedPages?.length || 0) * (Number(copies) || 1);
    let subtotal = isVIP ? 0 : totalSheets * rate;
    let tax = isVIP ? 0 : subtotal * GST;
    let total = subtotal + tax;

    let discount = 0;
    if (applied && !isVIP) discount = (total * applied.percent) / 100;

    let coinDed = 0;
    if (useCoins && !isVIP) {
      coinDed = Math.min(total - discount, coins * COIN_VAL);
    }

    const final = Number(Math.max(0, total - discount - coinDed).toFixed(2));
    const coinsEarned = !isVIP ? Math.floor(subtotal / 10) : 0;
    return { rate, subtotal, tax, discount, coinDed, final, coinsEarned, totalSheets, isVIP, total };
  };

  const pricing = calculate(); // compute on every render (fast)

  // auth + initial loads
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data?.session?.user || null));
    supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user || null));
    const t = setInterval(() => setOrders((p) => [...p]), 1000); // keep UI re-rendering for timers
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      let { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (!p) {
        const { data: np } = await supabase.from("profiles").insert([{ id: user.id, email: user.email, full_name: user.user_metadata?.full_name }]).select().single();
        setProfile(np);
      } else setProfile(p);

      let { data: w } = await supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle();
      if (!w) {
        await supabase.from("wallets").insert([{ user_id: user.id, balance: 0 }]);
        setCoins(0);
      } else setCoins(Number(w.balance));
      await loadOrders();
      await fetchWallet();
    })();
  }, [user]);

  const loadOrders = async () => {
    if (!user) return;
    const { data } = await supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if (data) setOrders(data);
  };

  const fetchWallet = async () => {
    if (!user) return;
    const res = await fetch(`${API}/api/wallet/history/${user.id}`);
    if (res.ok) setWalletHistory(await res.json());
  };

  const fetchAdminStats = async () => {
    const res = await fetch(`${API}/api/admin/stats?date=${adminDate}`);
    if (res.ok) setAdminStats(await res.json());
  };

  // payment
  const pay = async () => {
    setLoading(true);
    try {
      const order_id = makeOrderId();
      const currentPricing = calculate();
      const form = new FormData();
      form.append("file", file);
      form.append(
        "meta",
        JSON.stringify({
          order_id,
          userId: user.id,
          email: user.email,
          pages: selectedPages,
          color,
          doubleSide,
          copies,
          couponCode: applied?.code,
          useCoins,
          fileType: file?.type || null,
          amount: currentPricing.final,
        })
      );
      const res = await fetch(`${API}/api/process-print`, { method: "POST", body: form });
      if (!res.ok) {
        const txt = await res.text().catch(() => null);
        throw new Error(txt || "Payment Failed");
      }
      // success
      alert("Order Successful!");
      setFile(null);
      setSelectedPages([]);
      setStep(0);
      setTab("orders");
      setApplied(null);
      setCoupon("");
      setUseCoins(false);
      setCopies(1);
      await loadOrders();
      await fetchWallet();
      const spentCoins = currentPricing.coinDed / COIN_VAL;
      setCoins((c) => Math.max(0, c - spentCoins + currentPricing.coinsEarned));
    } catch (e) {
      alert(e.message);
    }
    setLoading(false);
  };

  const checkCoupon = async () => {
    if (!coupon) return;
    try {
      const res = await fetch(`${API}/api/check-coupon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: coupon, userId: user.id }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d?.message || "Invalid Coupon");
      setApplied({ code: coupon, percent: d.percent });
      alert("Coupon Applied!");
    } catch (e) {
      alert(e.message);
      setApplied(null);
    }
  };

  const handleSupport = async (id, msg) => {
    await fetch(`${API}/api/support`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id, orderId: id, message: msg }) });
    alert("Ticket Submitted");
    setSupportOrder(null);
  };

  // UI: when user clicks continue for non-PDF files, server will recalc pages
  // file selection
  const onFileChange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!SUPPORTED_TYPES.includes(f.type)) {
      alert("Unsupported file type. Use PDF, DOC/DOCX, PNG or JPEG.");
      return;
    }
    setFile(f);
  };

  // when an order expires we reload orders to refresh status
  const onOrderExpire = async () => {
    await loadOrders();
  };

  if (!user)
  return (
<div className="landing-hero-center">

  <div className="landing-brand">
    <div className="landing-logo">PV</div>
    <div className="landing-name">PrintVend</div>
  </div>

  <h1 className="landing-heading">
    Cloud Printing <br />
    <span>Made Instant</span>
  </h1>

  <p className="landing-desc">
<div className="landing-glass-features">
  <div>⚡ Instant Prints</div>
  <div>🔒 Secure Files</div>
  <div>🕒 24/7 Access</div>
  <div>🚫 No Queue</div>
</div>

  </p>

  <button
    className="btn"
    onClick={() =>
      supabase.auth.signInWithOAuth({ provider: "google" })
    }
  >
    Start Printing
  </button>
</div>



  );


  return (
    <div className={`app ${dark ? "dark" : ""}`}>
      {loading && <Spinner />}
      {supportOrder && <SupportModal order={supportOrder} profile={profile} onClose={() => setSupportOrder(null)} onSubmit={handleSupport} />}
      {showWallet && <WalletModal history={walletHistory} onClose={() => setShowWallet(false)} />}

      <div className="header">
        <div className="brand">
          <div className="logo-box">PV</div>
          <span className="brand-name">PrintVend</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <div className="coin-badge" onClick={() => setShowWallet(true)}>
            🪙 {Math.floor(coins)}
          </div>
          <button className="btn secondary" style={{ width: "auto", padding: "8px 12px" }} onClick={() => setDark(!dark)}>
            {dark ? "☀️" : "🌙"}
          </button>
        </div>
      </div>

      {/* ---------- HOME / PRINT FLOW ---------- */}
      {tab === "home" && (
        <div className="fade-in">
          {step === 0 && (
            <>
              <div className="hero-section">
                <div className="hero-title">
  Hello,{" "}
  <span className="hero-name">
    {profile.full_name?.split(" ")[0]}
  </span>{" "}
  <span className="wave">👋</span>
</div>

                <div className="hero-subtitle">Ready to print your next document?</div>
                <button
                  className="btn"
                  style={{ boxShadow: "0 10px 25px rgba(99,102,241,0.4)" }}
                  onClick={() => {
                    setStep(1);
                    setSelectedPages([]);
                    setNumPages(0);
                  }}
                >
                  Start New Print
                </button>
              </div>

              <div className="process-grid">
                <div className="process-step">
                  <span className="p-icon">📂</span>
                  <div className="p-title">1. Upload</div>
                  <div className="p-desc">PDF, DOCX, Image</div>
                </div>
                <div className="process-step">
                  <span className="p-icon">⚙️</span>
                  <div className="p-title">2. Setup</div>
                  <div className="p-desc">Customize</div>
                </div>
                <div className="process-step">
                  <span className="p-icon">💳</span>
                  <div className="p-title">3. Pay</div>
                  <div className="p-desc">Coins/UPI</div>
                </div>
                <div className="process-step">
                  <span className="p-icon">🖨️</span>
                  <div className="p-title">4. Scan</div>
                  <div className="p-desc">Get Print</div>
                </div>
              </div>
            </>
          )}

          {/* STEP 1 - UPLOAD */}
          {step === 1 && (
            <div className="card">
              <h3>Upload Document</h3>
              <div className="upload-box" onClick={() => document.getElementById("f")?.click()}>
                <input type="file" id="f" hidden accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" onChange={onFileChange} />
                <div style={{ fontWeight: 800 }}>{file ? `📄 ${file.name}` : "Click to select PDF"}</div>
                <div style={{ marginTop: 8, opacity: 0.75 }}>Files are encrypted and will be auto-deleted after printing.</div>
              </div>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button className="btn" disabled={!file} onClick={() => setStep(2)}>Next Step</button>
                <button className="btn secondary" onClick={() => { setFile(null); setSelectedPages([]); }}>Reset</button>
              </div>
            </div>
          )}

          {/* STEP 2 - SELECT PAGES & SETTINGS */}
          {step === 2 && (
            <div className="card">
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, alignItems: "center" }}>
                <h3 style={{ margin: 0 }}>Select Pages</h3>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="small-btn select" onClick={() => setSelectedPages([...Array(numPages)].map((_, i) => i + 1))}>Select All</button>
                  <button className="small-btn clear" onClick={() => setSelectedPages([])}>Clear</button>
                </div>
              </div>

              {isPDF(file) ? (
                <Document file={file} onLoadSuccess={({ numPages }) => { setNumPages(numPages); setSelectedPages([...Array(numPages)].map((_, i) => i + 1)); }}>
                  <div className="page-grid">
                    {[...Array(numPages)].map((_, i) => (
                      <div
                        key={i}
                        className={`page-thumb ${selectedPages.includes(i + 1) ? "selected" : ""}`}
                        onClick={() => setSelectedPages((p) => (p.includes(i + 1) ? p.filter((x) => x !== i + 1) : [...p, i + 1]))}
                      >
                        <Page pageNumber={i + 1} width={80} renderTextLayer={false} renderAnnotationLayer={false} />
                        <div className="page-num">{i + 1}</div>
                      </div>
                    ))}
                  </div>
                </Document>
              ) : (
                <div className="card" style={{ textAlign: "center", padding: 20 }}>
                  <div style={{ fontSize: 28 }}>📄</div>
                  <p style={{ fontWeight: 700, marginTop: 10 }}>This file will be converted to PDF on the server</p>
                  <p style={{ fontSize: 13, opacity: 0.7 }}>Page preview is not available for this file type. After conversion the server will compute actual page count and proceed with printing.</p>
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 12 }}>
                    <button className="btn" onClick={() => { setSelectedPages([1]); setStep(3); }}>Continue</button>
                    <button className="btn secondary" onClick={() => { setFile(null); setSelectedPages([]); setStep(1); }}>Choose different file</button>
                  </div>
                </div>
              )}

              <div style={{ display: "grid", gap: 15, margin: "20px 0" }}>
                <div className="toggle-group">
                  <button className={!color ? "active" : ""} onClick={() => setColor(false)}>
                    <span className="toggle-title">B/W</span>
                    <span className="toggle-sub">₹{(doubleSide ? RATES.bw_double : RATES.bw_single).toFixed(2)}/pg</span>
                  </button>
                  <button className={color ? "active" : ""} onClick={() => setColor(true)}>
                    <span className="toggle-title">Color</span>
                    <span className="toggle-sub">₹{(doubleSide ? RATES.col_double : RATES.col_single).toFixed(2)}/pg</span>
                  </button>
                </div>

                <div className="toggle-group">
                  <button className={!doubleSide ? "active" : ""} onClick={() => setDoubleSide(false)}>
                    <span className="toggle-title">Single</span>
                    <span className="toggle-sub">1 Side</span>
                  </button>
                  <button className={doubleSide ? "active" : ""} onClick={() => setDoubleSide(true)}>
                    <span className="toggle-title">Double</span>
                    <span className="toggle-sub">2 Sides</span>
                  </button>
                </div>

                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontWeight: 600 }}>Copies</span>
                  <div className="qty-counter">
                    <button className="qty-btn" onClick={() => setCopies((c) => Math.max(1, c - 1))}>-</button>
                    <span style={{ fontWeight: 700 }}>{copies}</span>
                    <button className="qty-btn" onClick={() => setCopies((c) => c + 1)}>+</button>
                  </div>
                </div>

                <div className="live-price card" style={{ display: "flex", justifyContent: "space-between", padding: 12 }}>
                  <div style={{ fontWeight: 700 }}>Est. Payable</div>
                  <div style={{ fontWeight: 900 }}>{fmt(pricing.final)}</div>
                </div>
              </div>

              <button className="btn" disabled={selectedPages.length === 0} onClick={() => setStep(3)}>Summary</button>
            </div>
          )}

          {/* STEP 3 - SUMMARY & PAY */}
          {step === 3 && (
            <div className="card">
              <h3>Payment Summary</h3>

              {/* QR disclaimer banner (like screenshot) */}
              <div style={{ margin: "12px 0 18px" }} className="card">
                <div style={{ background: "linear-gradient(90deg, rgba(255,243,205,1), rgba(255,249,230,1))", padding: 12, borderRadius: 12, display: "flex", gap: 12, alignItems: "center", color: "#92400e" }}>
                  <div style={{ fontSize: 20 }}>⚠️</div>
                  <div style={{ fontSize: 13, fontWeight: 700 }}>
                    QR Code is valid for 1 Hour after payment.
                    <div style={{ fontSize: 12, fontWeight: 600, opacity: 0.9 }}>Please collect within the validity period.</div>
                  </div>
                </div>
              </div>

              <div className="bill-table">
                <div className="row"><span>Rate per page</span><span>{fmt(pricing.rate)}</span></div>
                <div className="row"><span>Total Sheets</span><span>{pricing.totalSheets}</span></div>
                <div className="row"><span>Subtotal</span><span>{fmt(pricing.subtotal)}</span></div>
                <div className="row"><span>GST (18%)</span><span>{fmt(pricing.tax)}</span></div>
                {pricing.discount > 0 && <div className="row" style={{ color: "#16a34a" }}><span>Coupon ({applied?.code})</span><span>-{fmt(pricing.discount)}</span></div>}
                {pricing.coinDed > 0 && <div className="row" style={{ color: "#16a34a" }}><span>Coins Used</span><span>-{fmt(pricing.coinDed)}</span></div>}
                <div className="row total"><span>Total Payable</span><span>{fmt(pricing.final)}</span></div>
                <div style={{ fontSize: 12, color: "#d97706", marginTop: 8, display: "flex", justifyContent: "space-between" }}>
                  <div>Coins you'll earn</div>
                  <div style={{ fontWeight: 800, color: "var(--primary)" }}>+{pricing.coinsEarned}</div>
                </div>
              </div>

              {/* coupon + coins */}
              {!pricing.isVIP && (
                <div style={{ marginBottom: 20 }}>
                  <div className="coupon-input">
                    <input placeholder="COUPON CODE" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
                    <button className="btn" onClick={checkCoupon}>APPLY</button>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div className={`coin-card ${useCoins ? "active" : ""}`} onClick={() => setUseCoins((v) => !v)}>
                      <div className="checkbox-circle" />
                      <div>
                        <div className="coin-text">Use Coins</div>
                        <div className="coin-sub">Bal: {Math.floor(coins)}</div>
                      </div>
                      <div style={{ marginLeft: 8, fontWeight: 800 }}>{useCoins ? `- ${fmt(pricing.coinDed)}` : ""}</div>
                    </div>
                  </div>
                </div>
              )}

              <button className="btn" onClick={pay}>Pay & Print</button>
            </div>
          )}
        </div>
      )}

      {/* ---------- ORDERS (QR cards etc) ---------- */}
      {tab === "orders" && (
        <div className="fade-in">


          {orders.length === 0 && <div style={{ textAlign: "center", opacity: 0.5, marginTop: 50 }}>No active orders</div>}

          {orders.map((o) => {
            const active = isQrActive(o);
            const expired = !active && o.status !== "PRINTED";
            const seconds = getSecondsLeft(o.expires_at);
            return (
              <div key={o.id} className="card" style={{ textAlign: "center" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 15 }}>
                  <div>
                    <div style={{ fontSize: 11, opacity: 0.6 }}>ORDER ID</div>
                    <div style={{ fontWeight: 700 }}>{o.order_id}</div>
                  </div>
                  <div className={`status ${o.status === "PRINTED" ? "PAID" : active ? "ACTIVE" : "EXPIRED"}`}>{o.status === "PRINTED" ? "PRINTED" : active ? "ACTIVE" : "EXPIRED"}</div>
                </div>

                <div style={{ textAlign: "center" }}>
                  <div className={`qr-box ${active ? "qr-active" : ""}`}>
                    {active && <QRCodeCanvas value={o.qr_code} size={150} />}
                    {o.status === "PRINTED" && <StatusIcon type="success" />}
                    {expired && <StatusIcon type="error" />}
                  </div>

                  {/* countdown with seconds */}
                <div className="order-info">

                  {active ? (
                    <div className="order-expiry">
                      ⏳ Expires in{" "}
                      <Countdown
                        expiresAt={o.expires_at}
                        onExpire={onOrderExpire}
                      />
                    </div>
                  ) : (
                    <div className="order-expiry">
                      Expired
                    </div>
                  )}

                  <div className="order-meta">
                    {fmt(o.total_amount)} • {new Date(o.created_at).toLocaleDateString()}
                  </div>

                </div>



                  {/* <div style={{ marginTop: 12, display: "flex", gap: 8, justifyContent: "center" }}>
                    <button className="btn secondary" onClick={() => setSupportOrder(o)} style={{ width: 140 }}>Report</button>
                  </div> */}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ---------- ADMIN ---------- */}
      {tab === "admin" && (
        <div className="fade-in">
          <h2 style={{ marginBottom: 20 }}>Admin Dashboard</h2>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <input type="date" value={adminDate} onChange={(e) => setAdminDate(e.target.value)} className="glass-input" style={{ flex: 1 }} />
            <button className="btn secondary" style={{ width: "auto" }} onClick={fetchAdminStats}>Refresh</button>
          </div>
          {adminStats ? (
            <div>
              <div className="stats-grid">
                <div className="stat-card"><div className="stat-val">₹{adminStats.dayRevenue}</div><div className="stat-label">Today's Revenue</div></div>
                <div className="stat-card"><div className="stat-val">{adminStats.dayCount}</div><div className="stat-label">Orders Today</div></div>
              </div>
              <div className="card">
                <h3>Weekly Overview</h3>
                <div style={{ display: "flex", alignItems: "flex-end", height: 100, gap: 10, marginTop: 10 }}>
                  {adminStats.chartData.map((d, i) => (
                    <div key={i} style={{ flex: 1, textAlign: "center" }}>
                      <div className="chart-bar" style={{ height: `${Math.min(100, d.value)}px` }}></div>
                      <div style={{ fontSize: 10, marginTop: 5 }}>{d.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : <p>Loading stats...</p>}
        </div>
      )}

      {/* ---------- PROFILE ---------- */}
      {tab === "profile" && (
        <div className="fade-in card" style={{ textAlign: "center", padding: 30 }}>
          <div style={{ width: 80, height: 80, background: "var(--primary)", borderRadius: "50%", margin: "0 auto 20px", display: "grid", placeItems: "center", fontSize: 32, color: "white", fontWeight: 700 }}>{profile.full_name?.[0]}</div>
          <h2>{profile.full_name}</h2>
          <p style={{ opacity: 0.6 }}>{user.email}</p>
          {profile.role === "VIP" && <span className="status PAID" style={{ marginTop: 10 }}>✨ VIP MEMBER</span>}
          <div style={{ display: "flex", justifyContent: "center", gap: 15, margin: "30px 0" }}>
            <div className="stat-card" style={{ width: 100 }}><div className="stat-val">{orders.length}</div><div className="stat-label">Orders</div></div>
            <div className="stat-card" style={{ width: 100 }}><div className="stat-val">{Math.floor(coins)}</div><div className="stat-label">Coins</div></div>
          </div>
          <button className="btn" onClick={() => setViewHistory(true)}>Order History</button>
          <button className="btn secondary" style={{ marginTop: 10 }} onClick={() => supabase.auth.signOut()}>Logout</button>
        </div>
      )}

      {/* HISTORY MODAL */}
      {viewHistory && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-header">
              <h3>History</h3>
              <button className="link-btn" onClick={() => setViewHistory(false)}>✕</button>
            </div>
            <div className="modal-content">
              {orders.map((o) => (
                <div key={o.id} className="history-item">
                  <div className="h-left">
                    <div className="h-id">{o.order_id}</div>
                    <div className="h-date">{new Date(o.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="h-right">
                    <div className="h-price">₹{o.total_amount}</div>
                    <button className="small-btn" onClick={() => setSupportOrder(o)} style={{ fontSize: 10, padding: "4px 8px" }}>Report</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {supportOrder && <SupportModal order={supportOrder} profile={profile} onClose={() => setSupportOrder(null)} onSubmit={handleSupport} />}

      <div className="footer">© 2026 PrintVend. All Rights Reserved.</div>

      <nav className="bottom-nav">
        <button className={`nav-btn ${tab === "home" ? "active" : ""}`} onClick={() => setTab("home")}>Print</button>
        <button className={`nav-btn ${tab === "orders" ? "active" : ""}`} onClick={() => setTab("orders")}>Orders</button>
        {profile?.role === "ADMIN" && <button className={`nav-btn ${tab === "admin" ? "active" : ""}`} onClick={() => { setTab("admin"); fetchAdminStats(); }}>Admin</button>}
        <button className={`nav-btn ${tab === "profile" ? "active" : ""}`} onClick={() => { setTab("profile"); setViewHistory(false); }}>Profile</button>
      </nav>
    </div>
  );
}
