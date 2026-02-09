import React, { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { 
  Upload, FileText, Check, CreditCard, Shield, Zap, 
  LogOut, Layout, ArrowRight, User, History, 
  BarChart3, MessageSquare, X
} from "lucide-react";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import "./index.css";

// --- CONFIGURATION ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

const supabase = (SUPABASE_URL && SUPABASE_KEY) 
  ? createClient(SUPABASE_URL, SUPABASE_KEY) 
  : null;

const RATES = { bw_single: 1.5, bw_double: 1.0, col_single: 5.0, col_double: 4.5 };

// --- 1. LANDING PAGE COMPONENT ---
const LandingView = ({ onLogin }) => {
  const [scrollP, setScrollP] = useState(0);
  
  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const maxScroll = scrollHeight - clientHeight;
    setScrollP(Math.min(Math.max(scrollTop / maxScroll, 0), 1));
  };

  const fileY = Math.min(scrollP * 300, 130);
  const fileOp = 1 - Math.max(0, (scrollP - 0.3) * 5);
  const printY = Math.max(0, (scrollP - 0.6) * 200);
  const printOp = scrollP > 0.6 ? 1 : 0;

  return (
    <div className="landing-view" onScroll={handleScroll}>
      <div className="hero-section">
        <div className="logo-box-lg">PV</div>
        <h1 className="hero-title">PrintVend</h1>
        <p className="hero-subtitle">Secure. Instant. Cashless.</p>
        <button className="btn-google" onClick={onLogin}>
           Login with Google
        </button>
        <div className="scroll-indicator">Scroll to see the magic ▼</div>
      </div>

      <div className="story-section">
         <div className="sticky-printer-stage">
            <div className="digital-file" style={{ transform: `translateY(${fileY}px) scale(${1-scrollP*0.3})`, opacity: fileOp }}>
               <FileText size={40} color="#6366f1" />
               <div className="file-label">DOCS.pdf</div>
            </div>
            <div className="printer-machine">
               <div className="printer-slot"></div>
               <div className="printer-light"></div>
            </div>
            <div className="physical-print" style={{ transform: `translateY(${printY}px)`, opacity: printOp }}>
               <FileText size={40} color="black" />
               <div className="file-label-dark">DOCS.pdf</div>
               <div className="security-tag"><Check size={10} /> DELETED</div>
            </div>
         </div>
      </div>
    </div>
  );
};

// --- 2. MAIN APP COMPONENT ---
export default function App() {
  if (!supabase) return <div className="error-screen">Error: Missing .env Keys</div>;

  // Global State
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("HOME"); // HOME, ADMIN, HISTORY
  
  // Data State
  const [wallet, setWallet] = useState(0);
  const [orders, setOrders] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [adminStats, setAdminStats] = useState(null);

  // Form State
  const [file, setFile] = useState(null);
  const [settings, setSettings] = useState({ color: false, doubleSide: false, copies: 1, numPages: 1 });
  const [useCoins, setUseCoins] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [successQr, setSuccessQr] = useState(null);
  
  // Support Modal State
  const [showSupport, setShowSupport] = useState(false);
  const [supportMsg, setSupportMsg] = useState("");

  // Admin Secret Trigger
  const [logoClicks, setLogoClicks] = useState(0);

  // --- INITIALIZATION ---
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) refreshData(user.id);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
      if (session?.user) refreshData(session.user.id);
      else setLoading(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  const refreshData = async (uid) => {
    try {
      // 1. User Data
      const res = await fetch(`${API_URL}/user-data/${uid}`);
      if(res.ok) {
         const data = await res.json();
         setWallet(data.wallet || 0);
         setOrders(data.orders || []);
      }
      // 2. Transaction History
      const histRes = await fetch(`${API_URL}/wallet/history/${uid}`);
      if(histRes.ok) {
         setTransactions(await histRes.json());
      }
    } catch (e) { console.error("Data Load Error", e); }
  };

  const fetchAdminStats = async () => {
    try {
       const res = await fetch(`${API_URL}/admin/stats`);
       if(res.ok) setAdminStats(await res.json());
    } catch(e) {}
  };

  // --- HANDLERS ---
  const handleLogoClick = () => {
     setLogoClicks(prev => {
        if(prev + 1 >= 5) {
           fetchAdminStats();
           setView("ADMIN");
           return 0;
        }
        return prev + 1;
     });
  };

  const handleSupportSubmit = async () => {
     if(!supportMsg) return;
     await fetch(`${API_URL}/support`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id, message: supportMsg })
     });
     setSupportMsg("");
     setShowSupport(false);
     alert("Ticket Sent!");
  };

  // Calculation
  const calculateTotal = () => {
     const rate = settings.color 
       ? (settings.doubleSide ? RATES.col_double : RATES.col_single)
       : (settings.doubleSide ? RATES.bw_double : RATES.bw_single);
     
     const sheets = settings.doubleSide ? Math.ceil(settings.numPages/2) : parseInt(settings.numPages);
     const totalSheets = sheets * settings.copies;
     let subtotal = totalSheets * rate;
     let tax = subtotal * 0.18;
     let total = subtotal + tax;
     let discount = 0;

     if (useCoins && wallet > 0) {
        const coinVal = wallet * 0.1; 
        discount = Math.min(total, coinVal);
        total -= discount;
     }
     return { subtotal, tax, total, discount, rate, totalSheets };
  };

  const { total, subtotal, tax, discount, rate, totalSheets } = calculateTotal();

  const handleProcess = async () => {
     if (!file) return;
     setProcessing(true);
     const formData = new FormData();
     formData.append("file", file);
     formData.append("meta", JSON.stringify({
        userId: user.id, userEmail: user.email, ...settings, useCoins
     }));

     try {
        const res = await fetch(`${API_URL}/process-print`, { method: "POST", body: formData });
        const data = await res.json();
        if (data.success) {
           setSuccessQr(data.qr);
           refreshData(user.id); 
           setFile(null); 
        } else { alert(data.error); }
     } catch (e) { alert("Server Error"); }
     setProcessing(false);
  };

  if (loading) return <div className="spinner-overlay"><div className="spinner"></div></div>;
  if (!user) return <LandingView onLogin={() => supabase.auth.signInWithOAuth({ provider: "google" })} />;

  if (successQr) return (
     <div className="app-container centered">
        <div className="card text-center">
           <div className="icon-circle success"><Check size={32} /></div>
           <h2>Order Success!</h2>
           <p className="subtext">Scan at Kiosk</p>
           <div className="qr-display">
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${successQr}`} alt="QR" />
           </div>
           <h1 className="qr-text">{successQr}</h1>
           <button className="btn-primary" onClick={() => setSuccessQr(null)}>Done</button>
        </div>
     </div>
  );

  // --- ADMIN VIEW ---
  if (view === "ADMIN") return (
     <div className="app-container">
        <div className="header">
           <h2>Admin Dashboard</h2>
           <button onClick={() => setView("HOME")} className="btn-close">✕</button>
        </div>
        {adminStats && (
           <>
             <div className="stats-grid">
                <div className="card stat-card">
                   <h3>${adminStats.dayRevenue}</h3>
                   <p>Today's Revenue</p>
                </div>
                <div className="card stat-card">
                   <h3>{adminStats.dayCount}</h3>
                   <p>Today's Orders</p>
                </div>
             </div>
             <div className="card">
                <h3>Revenue (7 Days)</h3>
                <div style={{height: 200, marginTop: 20}}>
                   <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={adminStats.chartData}>
                         <XAxis dataKey="name" fontSize={12} tickLine={false} axisLine={false}/>
                         <Tooltip cursor={{fill: 'transparent'}} />
                         <Bar dataKey="value" fill="#6366f1" radius={[4,4,0,0]} barSize={20}/>
                      </BarChart>
                   </ResponsiveContainer>
                </div>
             </div>
           </>
        )}
     </div>
  );

  // --- MAIN VIEW ---
  return (
    <div className="app-container">
       <div className="header">
          <div className="brand" onClick={handleLogoClick}>
             <div className="logo-box">PV</div>
             <div className="brand-text">
                <div className="name">PrintVend</div>
                <div className="user">{user.user_metadata.full_name?.split(' ')[0]}</div>
             </div>
          </div>
          <button className="coin-badge" onClick={() => supabase.auth.signOut()}>
             <div className="dot"></div> {wallet} Coins <LogOut size={12} style={{marginLeft:5}}/>
          </button>
       </div>

       {/* UPLOAD */}
       <div className="card">
          {!file ? (
             <label className="upload-area">
                <Upload size={32} className="p-icon" />
                <p className="bold">Tap to Upload PDF</p>
                <input type="file" accept="application/pdf" hidden onChange={(e) => {
                   if(e.target.files[0]) { setFile(e.target.files[0]); setSettings(s => ({...s, numPages: 1})); }
                }} />
             </label>
          ) : (
             <div className="file-preview-row">
                <FileText color="#6366f1"/> 
                <span className="filename">{file.name}</span>
                <button onClick={() => setFile(null)} className="btn-close">✕</button>
             </div>
          )}
       </div>

       {/* SETTINGS */}
       <div className="card">
          <div className="card-header">
             <h3>Settings</h3>
             <div className="rate-pill">${rate.toFixed(2)}/sheet</div>
          </div>
          <div className="toggle-group">
             <button className={!settings.color?'active':''} onClick={()=>setSettings({...settings, color:false})}>B&W</button>
             <button className={settings.color?'active':''} onClick={()=>setSettings({...settings, color:true})}>Color</button>
          </div>
          <div className="toggle-group mt-2">
             <button className={!settings.doubleSide?'active':''} onClick={()=>setSettings({...settings, doubleSide:false})}>Single Side</button>
             <button className={settings.doubleSide?'active':''} onClick={()=>setSettings({...settings, doubleSide:true})}>Double Side</button>
          </div>
          <div className="input-row mt-3">
             <div className="input-col">
                <label>Copies</label>
                <input type="number" min="1" value={settings.copies} onChange={e=>setSettings({...settings, copies: e.target.value})}/>
             </div>
             <div className="input-col">
                <label>Pages (PDF)</label>
                <input type="number" min="1" value={settings.numPages} onChange={e=>setSettings({...settings, numPages: e.target.value})}/>
             </div>
          </div>
       </div>

       {/* BILL */}
       <div className="card">
          <div className="bill-row"><span>Subtotal</span> <span>{subtotal.toFixed(2)}</span></div>
          <div className="bill-row"><span>Tax (18%)</span> <span>{tax.toFixed(2)}</span></div>
          {wallet > 0 && (
             <label className="coin-row">
                 <div className="coin-label"><div className="coin-icon">C</div> Use {wallet} Coins</div>
                 <input type="checkbox" checked={useCoins} onChange={e => setUseCoins(e.target.checked)}/>
             </label>
          )}
          {useCoins && discount > 0 && <div className="bill-row discount"><span>Discount</span> <span>-{discount.toFixed(2)}</span></div>}
          <div className="bill-total"><span>Total</span><span>${total.toFixed(2)}</span></div>
          <button className="btn-primary" disabled={!file || processing} onClick={handleProcess}>
             {processing ? "Processing..." : `Pay $${total.toFixed(2)}`}
          </button>
       </div>

       {/* ORDERS & SUPPORT */}
       <div className="section-header">
          <h3>Recent Orders</h3>
          <button className="btn-icon" onClick={() => setShowSupport(true)}><MessageSquare size={16}/></button>
       </div>
       
       <div className="card order-list">
          {orders.length === 0 ? <p className="empty">No active orders</p> : orders.map(o => (
             <div key={o.order_id} className="order-item">
                <div className="order-info">
                   <div className="qr-code-text">{o.qr_code}</div>
                   <div className="date">{new Date(o.created_at).toLocaleDateString()}</div>
                </div>
                <div className={`badge ${o.status}`}>{o.status}</div>
             </div>
          ))}
       </div>

       {/* SUPPORT MODAL */}
       {showSupport && (
          <div className="modal-overlay">
             <div className="modal">
                <div className="modal-header">
                   <h3>Support</h3>
                   <button onClick={()=>setShowSupport(false)}>✕</button>
                </div>
                <textarea 
                   placeholder="Describe your issue..." 
                   value={supportMsg}
                   onChange={e => setSupportMsg(e.target.value)}
                />
                <button className="btn-primary mt-3" onClick={handleSupportSubmit}>Submit Ticket</button>
             </div>
          </div>
       )}
    </div>
  );
}
