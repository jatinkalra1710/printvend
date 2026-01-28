import React, { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { Document, Page, pdfjs } from "react-pdf";
import { QRCodeCanvas } from "qrcode.react";
import "./index.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const RATES = { bw_single: 1.5, bw_double: 1.0, col_single: 5.0, col_double: 4.5 };
const GST = 0.18;
const COIN_VAL = 0.1; 

// --- HELPERS ---
function makeOrderId() {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear()).slice(-2);
  const hour = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const rand = Math.floor(100 + Math.random() * 900);
  return `INPVD${day}${month}${year}${hour}${min}${rand}`;
}

function isQrActive(order) {
  if (order.status === "PRINTED") return false;
  if (!order.expires_at) return true;
  return new Date(order.expires_at) > new Date();
}

function getRemainingTime(expiresAt) {
  const diff = new Date(expiresAt) - new Date();
  if (diff <= 0) return "Expired";
  const m = Math.floor(diff / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return `${m}m ${s}s`;
}

// --- COMPONENTS ---
const Spinner = () => <div className="spinner-overlay"><div className="spinner"></div></div>;

const StatusIcon = ({ type }) => {
  if (type === 'success') return <div className="status-icon-box success-bg"><svg xmlns="http://www.w3.org/2000/svg" className="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg></div>;
  if (type === 'error') return <div className="status-icon-box error-bg"><svg xmlns="http://www.w3.org/2000/svg" className="icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg></div>;
  return null;
};

const SupportModal = ({ order, user, profile, onClose, onSubmit }) => {
  const [msg, setMsg] = useState("");
  const handleSubmit = () => {
    const fullMsg = `[User: ${profile.full_name}, Email: ${user.email}] Issue: ${msg}`;
    onSubmit(order.order_id, fullMsg);
  };
  return (
    <div className="modal-overlay">
      <div className="modal">
        <h3>Report Issue</h3>
        <p style={{fontSize:13, opacity:0.7, marginBottom:10}}>Order ID: <b>{order.order_id}</b></p>
        <textarea className="glass-input" rows={5} placeholder="Describe issue in detail..." value={msg} onChange={e=>setMsg(e.target.value)} autoFocus />
        <div style={{display:'flex', gap:10}}>
          <button className="btn" onClick={handleSubmit} disabled={!msg.trim()}>Submit Ticket</button>
          <button className="btn secondary" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

const WalletModal = ({ history, onClose }) => (
  <div className="modal-overlay" onClick={onClose}>
    <div className="modal" onClick={e => e.stopPropagation()}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20}}>
        <h3>Wallet History</h3>
        <button className="btn link-btn" onClick={onClose}>Close</button>
      </div>
      <div style={{maxHeight:300, overflowY:'auto'}}>
        {history.length === 0 && <p style={{textAlign:'center', opacity:0.5}}>No transactions yet.</p>}
        {history.map((tx, i) => (
          <div key={i} style={{borderBottom:'1px solid rgba(0,0,0,0.1)', padding:'12px 0', display:'flex', justifyContent:'space-between'}}>
            <div>
              <div style={{fontWeight:600}}>{tx.type === 'EARN' ? 'Cashback Earned' : 'Payment'}</div>
              <div style={{fontSize:11, opacity:0.6}}>{new Date(tx.created_at).toLocaleDateString()}</div>
            </div>
            <div style={{fontWeight:700, color: tx.amount > 0 ? '#16a34a' : '#dc2626'}}>{tx.amount > 0 ? '+' : ''}{tx.amount}</div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

// --- MAIN APP ---
export default function App() {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState({});
  const [file, setFile] = useState(null);
  const [numPages, setNumPages] = useState(0);
  const [selectedPages, setSelectedPages] = useState([]);
  
  // Settings
  const [color, setColor] = useState(false);
  const [doubleSide, setDoubleSide] = useState(false);
  const [copies, setCopies] = useState(1);
  const [rangeStart, setRangeStart] = useState("");
  const [rangeEnd, setRangeEnd] = useState("");
  
  // Money
  const [coins, setCoins] = useState(0);
  const [coupon, setCoupon] = useState("");
  const [applied, setApplied] = useState(null);
  const [useCoins, setUseCoins] = useState(false);
  
  // State
  const [orders, setOrders] = useState([]);
  const [walletHistory, setWalletHistory] = useState([]);
  const [tab, setTab] = useState("home");
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [dark, setDark] = useState(false);
  const [adminStats, setAdminStats] = useState(null);
  const [adminDate, setAdminDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [viewHistory, setViewHistory] = useState(false); 
  const [supportOrder, setSupportOrder] = useState(null);
  const [showWallet, setShowWallet] = useState(false);

  // --- INIT ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data?.session?.user || null));
    supabase.auth.onAuthStateChange((_e, s) => setUser(s?.user || null));
    const t = setInterval(() => setOrders(prev => [...prev]), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!user) return;
    const init = async () => {
      let { data: p } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
      if (!p) {
        const { data: np } = await supabase.from("profiles").insert([{ id: user.id, email: user.email, full_name: user.user_metadata?.full_name, role: 'USER' }]).select().single();
        setProfile(np);
      } else setProfile(p);
      
      let { data: w } = await supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle();
      if (!w) {
         await supabase.from("wallets").insert([{ user_id: user.id, balance: 0 }]);
         setCoins(0);
      } else setCoins(Number(w.balance));
      
      loadOrders(); fetchWallet();
    };
    init();
  }, [user]);

  const loadOrders = async () => {
    if(!user) return;
    const { data } = await supabase.from("orders").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    if(data) setOrders(data);
  };

  const fetchWallet = async () => {
    try {
        const res = await fetch(`${API}/api/wallet/history/${user.id}`);
        if(res.ok) setWalletHistory(await res.json());
    } catch(e){}
  };

  const fetchAdminStats = async () => {
    try {
      const res = await fetch(`${API}/api/admin/stats?date=${adminDate}`);
      if(res.ok) setAdminStats(await res.json());
    } catch(e){}
  };

  // --- Range Selection ---
  const applyRange = () => {
    const s = parseInt(rangeStart);
    const e = parseInt(rangeEnd);
    if(s && e && s <= e && e <= numPages) {
      const range = [];
      for(let i=s; i<=e; i++) range.push(i);
      setSelectedPages(range);
    } else {
      alert("Invalid Range");
    }
  };

  // --- LOGIC ---
  const calculate = () => {
    const isVIP = profile?.role === 'VIP';
    
    const rate = color ? (doubleSide ? RATES.col_double : RATES.col_single) : (doubleSide ? RATES.bw_double : RATES.bw_single);
    const totalSheets = selectedPages.length * copies;
    
    let subtotal = totalSheets * rate;
    let tax = subtotal * GST;
    let total = subtotal + tax;
    
    if(isVIP) { subtotal = 0; tax = 0; total = 0; }
    
    let discount = 0;
    if(applied && !isVIP) discount = (total * applied.percent) / 100;
    
    let coinDed = 0;
    if(useCoins && !isVIP) {
      const remaining = total - discount;
      const coinValue = coins * COIN_VAL;
      coinDed = Math.min(remaining, coinValue);
    }
    
    const final = Math.max(0, total - discount - coinDed);
    const coinsEarned = !isVIP ? Math.floor(subtotal / 10) : 0;

    return { rate, subtotal, tax, discount, coinDed, final, coinsEarned, totalSheets, isVIP };
  }

  const checkCoupon = async () => {
    if(!coupon) return;
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/check-coupon`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ code: coupon.toUpperCase(), userId: user.id })
      });
      const d = await res.json();
      if(!res.ok) throw new Error(d.error);
      setApplied({ code: coupon.toUpperCase(), percent: d.percent });
      alert(`Coupon applied! ${d.percent}% Off`);
    } catch(e) { alert(e.message); setApplied(null); }
    setLoading(false);
  }

  const handleSupport = async (id, msg) => {
    setLoading(true);
    try {
      await fetch(`${API}/api/support`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ userId: user.id, orderId: id, message: msg })
      });
      alert("Ticket submitted successfully.");
      setSupportOrder(null);
    } catch(e) { alert("Error"); }
    setLoading(false);
  }

  const pay = async () => {
    setLoading(true);
    const order_id = makeOrderId(); 
    const calc = calculate();
    const form = new FormData();
    form.append("file", file);
    form.append("meta", JSON.stringify({
      order_id, userId: user.id, email: user.email,
      pages: selectedPages, color, doubleSide, copies,
      couponCode: applied?.code, useCoins, location: "Library"
    }));

    try {
      const res = await fetch(`${API}/api/process-print`, { method: "POST", body: form });
      const d = await res.json();
      if(!res.ok) throw new Error(d.error);
      
      alert("Order Successful!");
      setFile(null); setSelectedPages([]); setStep(0); setTab("orders"); setApplied(null); setCoupon(""); setUseCoins(false); setCopies(1);
      
      const spentCoins = calc.coinDed / COIN_VAL;
      setCoins(c => c - spentCoins + calc.coinsEarned);
      loadOrders(); fetchWallet();
    } catch(e) { alert(e.message); }
    setLoading(false);
  }

  const calc = calculate();

  if (!user) return (
    <div className="app" style={{display:'grid', placeItems:'center'}}>
      <div className="card" style={{textAlign:'center', width:'100%'}}>
        <div className="logo-box" style={{margin:'0 auto 20px', width:60, height:60, fontSize:24}}>PV</div>
        <h2>PrintVend</h2>
        <p style={{opacity:0.6, marginBottom:20}}>Smart Cloud Printing</p>
        <button className="btn" onClick={()=>supabase.auth.signInWithOAuth({provider:"google"})}>Login with Google</button>
      </div>
    </div>
  );

  return (
    <div className={`app ${dark ? "dark" : ""}`}>
      {loading && <Spinner />}
      {supportOrder && <SupportModal order={supportOrder} user={user} profile={profile} onClose={()=>setSupportOrder(null)} onSubmit={handleSupport} />}
      {showWallet && <WalletModal history={walletHistory} onClose={()=>setShowWallet(false)} />}

      <div className="header">
        <div className="brand"><div className="logo-box">PV</div><span className="brand-name">PrintVend</span></div>
        <div style={{display:'flex', gap:10}}>
          <div className="coin-badge" onClick={()=>setShowWallet(true)}>
             <span>🪙</span> {Math.floor(coins)}
          </div>
          <button className="btn secondary" style={{width:'auto', padding:'8px 12px', borderRadius:20}} onClick={()=>setDark(!dark)}>{dark?"☀️":"🌙"}</button>
        </div>
      </div>

      {tab === "home" && (
        <div className="fade-in">
          {step === 0 && (
            <div className="card" style={{textAlign:'center', padding:'40px 20px'}}>
              <h2 style={{fontSize:26, marginBottom:10}}>Hi, {profile.full_name?.split(' ')[0]} 👋</h2>
              <p style={{opacity:0.6, marginBottom:30}}>What would you like to print today?</p>
              <button className="btn" onClick={()=>setStep(1)}>Start New Print</button>
              
              <div className="process-grid">
                <div className="process-step"><span className="p-icon">📂</span><div className="p-title">1. Upload</div></div>
                <div className="process-step"><span className="p-icon">⚙️</span><div className="p-title">2. Setup</div></div>
                <div className="process-step"><span className="p-icon">💳</span><div className="p-title">3. Pay</div></div>
                <div className="process-step"><span className="p-icon">🖨️</span><div className="p-title">4. Print</div></div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="card">
              <h3>Upload Document</h3>
              <div className="upload-box">
                <input type="file" id="f" hidden accept="application/pdf" onChange={e=>setFile(e.target.files[0])} />
                <label htmlFor="f" className="btn secondary" style={{width:'auto'}}>Select PDF</label>
                {file && <div style={{marginTop:15, fontWeight:600, color:'var(--primary)'}}>📄 {file.name}</div>}
              </div>
              <button className="btn" disabled={!file} onClick={()=>setStep(2)}>Next Step</button>
            </div>
          )}

          {step === 2 && (
            <div className="card">
              <div style={{display:'flex', justifyContent:'space-between', marginBottom:12}}>
                <h3>Select Pages</h3>
                <button className="btn link-btn" onClick={()=>setSelectedPages([...Array(numPages)].map((_,i)=>i+1))}>Select All</button>
              </div>
              
              {/* Range Selection */}
              <div className="range-input">
                <input placeholder="Start" type="number" value={rangeStart} onChange={e=>setRangeStart(e.target.value)} />
                <input placeholder="End" type="number" value={rangeEnd} onChange={e=>setRangeEnd(e.target.value)} />
                <button className="btn secondary" style={{width:'auto', padding:'0 15px'}} onClick={applyRange}>Add</button>
              </div>

              <Document file={file} onLoadSuccess={({numPages})=>setNumPages(numPages)}>
                <div className="page-grid">
                  {[...Array(numPages)].map((_,i)=>(
                    <div key={i} className={`page-thumb ${selectedPages.includes(i+1)?"selected":""}`} onClick={()=>setSelectedPages(p=>p.includes(i+1)?p.filter(x=>x!==i+1):[...p,i+1])}>
                      <Page pageNumber={i+1} width={80} renderTextLayer={false} renderAnnotationLayer={false}/>
                      <div style={{textAlign:'center', fontSize:10, padding:2, fontWeight:600}}>{i+1}</div>
                    </div>
                  ))}
                </div>
              </Document>
              <div style={{margin:'20px 0'}}>
                <div style={{display:'flex', justifyContent:'space-between', fontSize:13, fontWeight:600, marginBottom:8}}>
                   <label>Color</label><span>{color ? '₹'+RATES.col_single : '₹'+RATES.bw_single}/pg</span>
                </div>
                <div className="toggle-group">
                  <button className={!color?"active":""} onClick={()=>setColor(false)}>B/W</button>
                  <button className={color?"active":""} onClick={()=>setColor(true)}>Color</button>
                </div>
              </div>
              <div style={{marginBottom:24}}>
                <label style={{fontSize:13, fontWeight:600}}>Sides</label>
                <div className="toggle-group">
                  <button className={!doubleSide?"active":""} onClick={()=>setDoubleSide(false)}>Single Side</button>
                  <button className={doubleSide?"active":""} onClick={()=>setDoubleSide(true)}>Double Side</button>
                </div>
              </div>
              <div style={{marginBottom:24, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                <label style={{fontSize:13, fontWeight:600}}>Copies</label>
                <div className="qty-counter">
                  <button className="qty-btn" onClick={()=>setCopies(c=>Math.max(1,c-1))}>-</button>
                  <span className="qty-val">{copies}</span>
                  <button className="qty-btn" onClick={()=>setCopies(c=>c+1)}>+</button>
                </div>
              </div>
              <button className="btn" disabled={selectedPages.length===0} onClick={()=>setStep(3)}>Next Step</button>
            </div>
          )}

          {step === 3 && (
            <div className="card">
              <h3>Payment Summary</h3>
              <div className="warning-banner">⚠️ QR Code is valid for 1 Hour after payment.</div>
              <div className="bill-table">
                <div className="row"><span>Rate per page</span><span>₹{calc.rate}</span></div>
                <div className="row"><span>Total Sheets</span><span>{calc.totalSheets}</span></div>
                <div className="row"><span>Subtotal</span><span>₹{calc.subtotal.toFixed(2)}</span></div>
                <div className="row"><span>GST (18%)</span><span>₹{calc.tax.toFixed(2)}</span></div>
                {applied && <div className="row" style={{color:'#16a34a'}}><span>Coupon</span><span>-₹{calc.discount.toFixed(2)}</span></div>}
                {useCoins && <div className="row" style={{color:'#16a34a'}}><span>Coins Used</span><span>-₹{calc.coinDed.toFixed(2)}</span></div>}
                <div className="row total"><span>Total Payable</span><span>₹{calc.final.toFixed(2)}</span></div>
                {calc.isVIP && <div className="row" style={{color:'var(--primary)', fontWeight:700, justifyContent:'center'}}>✨ VIP MEMBER: FREE PRINT ✨</div>}
                {!calc.isVIP && <div className="row" style={{fontSize:12, color:'#d97706', marginTop:4}}><span>Coins you'll earn</span><span>+{calc.coinsEarned}</span></div>}
              </div>

              {!calc.isVIP && (
                <div style={{marginBottom:20}}>
                  <div className="coupon-input">
                    <input placeholder="COUPON CODE" value={coupon} onChange={e=>setCoupon(e.target.value)} />
                    <button className="btn" onClick={checkCoupon}>APPLY</button>
                  </div>
                  {coins > 0 && (
                     <div className={`coin-toggle-row ${useCoins ? 'active' : ''}`} onClick={()=>setUseCoins(!useCoins)}>
                       <div style={{fontSize:14, fontWeight:600, display:'flex', gap:8, alignItems:'center'}}>
                         <span>🪙 Use Coins</span><span style={{fontSize:12, opacity:0.7}}>(Bal: {Math.floor(coins)})</span>
                       </div>
                       <div className="toggle-switch"></div>
                     </div>
                  )}
                </div>
              )}
              <button className="btn" onClick={pay}>Pay & Print</button>
            </div>
          )}
        </div>
      )}

      {tab === "orders" && (
        <div className="fade-in">
          {orders.map(o => {
            const active = isQrActive(o);
            const expired = !active && o.status !== "PRINTED";
            return (
              <div key={o.id} className="card order-card">
                <div className="ord-top" style={{display:'flex',justifyContent:'space-between',marginBottom:10,borderBottom:'1px solid rgba(0,0,0,0.1)',paddingBottom:10}}>
                  <div><div style={{fontSize:11, opacity:0.6}}>ORDER ID</div><div style={{fontWeight:700}}>{o.order_id}</div></div>
                  <div className={`status ${o.status === "PRINTED" ? "PAID" : active ? "ACTIVE" : "EXPIRED"}`}>
                     {o.status === "PRINTED" ? "PRINTED" : active ? "ACTIVE" : "EXPIRED"}
                   </div>
                </div>
                <div style={{textAlign:'center',padding:20}}>
                   <div className="qr-box">
                      {active && <QRCodeCanvas value={o.qr_code} size={150} />}
                      {o.status === "PRINTED" && <StatusIcon type="success" />}
                      {expired && <StatusIcon type="error" />}
                   </div>
                   {active && <div style={{color:'var(--primary)', fontWeight:700, fontSize:14, marginTop:10}}>⏳ Expires in: {getRemainingTime(o.expires_at)}</div>}
                   <div style={{marginTop:15, fontSize:13}}>₹{o.total_amount} • {new Date(o.created_at).toLocaleDateString()}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === "admin" && (
        <div className="fade-in">
           <h2 style={{marginBottom:20}}>Admin Dashboard</h2>
           <input type="date" value={adminDate} onChange={e=>setAdminDate(e.target.value)} className="glass-input" style={{marginBottom:20}} />
           <button className="btn secondary" onClick={fetchAdminStats} style={{marginBottom:15}}>Refresh Stats</button>
           
           {adminStats ? (
             <div>
               <div className="page-grid" style={{gridTemplateColumns:'1fr 1fr', maxHeight:'none'}}>
                 <div className="card" style={{margin:0}}><div style={{fontSize:24, fontWeight:800}}>₹{adminStats.dayRevenue}</div><div>Today's Revenue</div></div>
                 <div className="card" style={{margin:0}}><div style={{fontSize:24, fontWeight:800}}>{adminStats.dayCount}</div><div>Orders Today</div></div>
               </div>
               
               <div className="card" style={{marginTop:20}}>
                 <h3>Weekly Overview</h3>
                 <div style={{display:'flex', alignItems:'flex-end', height:100, gap:10, marginTop:10}}>
                   {adminStats.chartData.map((d, i) => (
                     <div key={i} style={{flex:1, textAlign:'center'}}>
                       <div className="chart-bar" style={{height: `${Math.min(100, d.value)}px`, background: 'var(--primary)', opacity: 0.8}}></div>
                       <div style={{fontSize:10, marginTop:5}}>{d.name}</div>
                     </div>
                   ))}
                 </div>
               </div>
             </div>
           ) : <p>Loading stats...</p>}
        </div>
      )}

      {tab === "profile" && (
        <div className="fade-in">
          {!viewHistory ? (
            <div className="card" style={{textAlign:'center', padding:'40px 20px'}}>
              <div style={{width:80, height:80, background:'rgba(99, 102, 241, 0.1)', borderRadius:'50%', margin:'0 auto 20px', display:'grid', placeItems:'center', fontSize:32, fontWeight:700, color:'var(--primary)'}}>
                {profile.full_name?.[0]}
              </div>
              <h2>{profile.full_name}</h2>
              <p style={{opacity:0.6, marginBottom:10}}>{user.email}</p>
              {profile.role === 'VIP' && <span className="status PAID">✨ VIP MEMBER</span>}
              
              <div style={{display:'flex', justifyContent:'center', gap:20, margin:'30px 0'}}>
                 <div className="card" style={{margin:0, padding:15, minWidth:110}}>
                   <div style={{fontSize:24, fontWeight:800}}>{orders.length}</div>
                   <div style={{fontSize:12, opacity:0.7}}>Orders</div>
                 </div>
                 <div className="card" style={{margin:0, padding:15, minWidth:110}}>
                   <div style={{fontSize:24, fontWeight:800}}>{Math.floor(coins)}</div>
                   <div style={{fontSize:12, opacity:0.7}}>Coins</div>
                 </div>
              </div>
              
              <button className="btn" style={{marginBottom:15}} onClick={()=>setViewHistory(true)}>📜 Order History</button>
              <button className="btn secondary" onClick={()=>supabase.auth.signOut()}>Sign Out</button>
            </div>
          ) : (
            <div className="fade-in">
              <div className="history-header">
                <button className="back-btn" onClick={()=>setViewHistory(false)}>←</button>
                <h3>My Order History</h3>
              </div>
              {orders.map(o => (
                <div key={o.id} className="card" style={{padding:20}}>
                   <div style={{display:'flex', justifyContent:'space-between', marginBottom:10}}>
                      <div style={{fontWeight:700}}>{o.order_id}</div>
                      <div style={{fontSize:12, opacity:0.7}}>{new Date(o.created_at).toLocaleDateString()}</div>
                   </div>
                   <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                      <div style={{fontSize:18, fontWeight:700}}>₹{o.total_amount}</div>
                      <button className="btn link-btn" onClick={()=>setSupportOrder(o)}>Report Issue</button>
                   </div>
                   <div style={{fontSize:12, marginTop:8, opacity:0.6}}>Status: {o.status}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="footer"><p>© 2026 PrintVend. All Rights Reserved.</p></div>

      <nav className="bottom-nav">
        <button className={`nav-btn ${tab==="home"?"active":""}`} onClick={()=>setTab("home")}>Print</button>
        <button className={`nav-btn ${tab==="orders"?"active":""}`} onClick={()=>setTab("orders")}>Orders</button>
        {profile?.role === 'ADMIN' && <button className={`nav-btn ${tab==="admin"?"active":""}`} onClick={()=>{setTab("admin"); fetchAdminStats();}}>Admin</button>}
        <button className={`nav-btn ${tab==="profile"?"active":""}`} onClick={()=>{setTab("profile"); setViewHistory(false);}}>Profile</button>
      </nav>
    </div>
  );
}