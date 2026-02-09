import React, { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { 
  Upload, FileText, Check, CreditCard, Shield, Zap, 
  LogOut, Layout, ArrowRight, User, History, 
  BarChart3, MessageSquare, X, DollarSign, Printer
} from "lucide-react";
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer } from 'recharts';
import "./index.css";

// --- ENV SAFEGUARDS ---
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// Initialize Supabase safely
const supabase = (SUPABASE_URL && SUPABASE_KEY) 
  ? createClient(SUPABASE_URL, SUPABASE_KEY) 
  : null;

// INR Rates
const RATES = { bw_single: 2.0, bw_double: 1.5, col_single: 10.0, col_double: 8.0 };

// --- LANDING PAGE ---
const LandingView = ({ onLogin }) => {
  const [scrollP, setScrollP] = useState(0);
  
  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const max = scrollHeight - clientHeight;
    setScrollP(Math.min(scrollTop / max, 1));
  };

  const fileY = Math.min(scrollP * 250, 100);
  const fileOp = 1 - (scrollP * 1.5);
  const outY = Math.max(0, (scrollP - 0.5) * 200);
  const outOp = scrollP > 0.5 ? 1 : 0;

  return (
    <div className="landing-view" onScroll={handleScroll}>
      <div className="hero">
         <div style={{fontSize: 40, marginBottom:10}}>🖨️</div>
         <h1>PrintVend</h1>
         <p>India's Smartest Campus Printing Solution</p>
         <button className="btn-google" onClick={onLogin}>
            <img src="https://www.svgrepo.com/show/475656/google-color.svg" width="20" alt="G"/>
            Login with Google
         </button>
         <div style={{marginTop: 50, opacity: 0.5, fontSize:12, animation:'float 2s infinite'}}>Scroll Down ▼</div>
      </div>

      <div className="printer-stage">
         {/* Input Paper */}
         <div className="paper in" style={{ transform: `translateY(${fileY}px) scale(${1-scrollP*0.2})`, opacity: fileOp }}>
            <div style={{textAlign:'center'}}>
              <FileText size={40} color="#4338ca"/>
              <div style={{fontSize:10, fontWeight:700, marginTop:5}}>Thesis.pdf</div>
            </div>
         </div>

         {/* Printer */}
         <div className="printer-box">
             <div className="printer-slot"></div>
             <div style={{position:'absolute', right:20, bottom:10, width:8, height:8, background:'#22c55e', borderRadius:'50%'}}></div>
         </div>

         {/* Output Paper */}
         <div className="paper out" style={{ transform: `translateY(${outY}px)`, opacity: outOp }}>
             <div style={{textAlign:'center'}}>
               <FileText size={40} color="black"/>
               <div style={{fontSize:10, fontWeight:700, marginTop:5}}>Thesis.pdf</div>
               <div style={{background:'#dcfce7', color:'#166534', fontSize:9, padding:'2px 6px', borderRadius:10, marginTop:5}}><b>✓ DELETED</b></div>
             </div>
         </div>
      </div>
    </div>
  );
};

// --- MAIN APP ---
export default function App() {
  if (!supabase) return <div style={{padding:40, textAlign:'center'}}><h2>Setup Error</h2><p>Check .env files</p></div>;

  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("HOME"); // HOME, ADMIN
  
  // Data
  const [wallet, setWallet] = useState(0);
  const [orders, setOrders] = useState([]);
  const [adminStats, setAdminStats] = useState(null);
  
  // Form
  const [file, setFile] = useState(null);
  const [settings, setSettings] = useState({ color: false, doubleSide: false, copies: 1, numPages: 1 });
  const [useCoins, setUseCoins] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [successQr, setSuccessQr] = useState(null);
  
  // Support
  const [showSupport, setShowSupport] = useState(false);
  const [supportMsg, setSupportMsg] = useState("");
  
  // Secret Admin Access (Click Logo 5 times)
  const [clicks, setClicks] = useState(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUser(user);
      if (user) loadData(user.id);
      setLoading(false);
    });
    supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user ?? null);
      if(session?.user) loadData(session.user.id);
    });
  }, []);

  const loadData = async (uid) => {
    try {
       const res = await fetch(`${API_URL}/user-data/${uid}`);
       if(res.ok) {
          const data = await res.json();
          setWallet(data.wallet || 0);
          setOrders(data.orders || []);
       }
    } catch(e) { console.error(e); }
  };

  const handleLogoClick = () => {
    setClicks(p => {
       if(p+1 >= 5) {
          fetch(`${API_URL}/admin/stats`).then(r=>r.json()).then(setAdminStats);
          setView("ADMIN");
          return 0;
       }
       return p+1;
    });
  };

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
        discount = Math.min(total, wallet); // 1 coin = 1 rupee
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
     formData.append("meta", JSON.stringify({ userId: user.id, userEmail: user.email, ...settings, useCoins }));

     try {
        const res = await fetch(`${API_URL}/process-print`, { method: "POST", body: formData });
        const data = await res.json();
        if (data.success) {
           setSuccessQr(data.qr);
           loadData(user.id);
           setFile(null);
        } else { alert(data.error); }
     } catch (e) { alert("Server Error"); }
     setProcessing(false);
  };

  const handleSupport = async () => {
     if(!supportMsg) return;
     await fetch(`${API_URL}/support`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({userId: user.id, message: supportMsg})});
     setSupportMsg(""); setShowSupport(false); alert("Ticket Sent!");
  };

  if (loading) return <div style={{height:'100vh', display:'grid', placeItems:'center'}}>Loading...</div>;
  if (!user) return <LandingView onLogin={() => supabase.auth.signInWithOAuth({ provider: "google" })} />;

  if (successQr) return (
     <div className="app-container" style={{textAlign:'center', paddingTop:60}}>
        <div className="card">
           <div style={{width:60, height:60, background:'#dcfce7', borderRadius:'50%', display:'grid', placeItems:'center', margin:'0 auto 20px'}}><Check color="#166534"/></div>
           <h2>Order Success!</h2>
           <p style={{color:'#64748b'}}>Scan this at the Kiosk</p>
           <div style={{background:'white', padding:10, borderRadius:10, display:'inline-block', margin:'20px 0'}}>
              <img src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${successQr}`} alt="QR" />
           </div>
           <h1>{successQr}</h1>
           <button className="btn-main" onClick={()=>setSuccessQr(null)}>Done</button>
        </div>
     </div>
  );

  if (view === "ADMIN") return (
     <div className="app-container">
        <div className="header"><h2>Admin</h2> <button onClick={()=>setView("HOME")} style={{border:'none', background:'none'}}>✕</button></div>
        {adminStats && (
           <>
             <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
                <div className="card"><h3>₹{adminStats.dayRevenue}</h3><p>Today</p></div>
                <div className="card"><h3>{adminStats.dayCount}</h3><p>Orders</p></div>
             </div>
             <div className="card" style={{height:250}}>
                <h3>Weekly Revenue</h3>
                <ResponsiveContainer width="100%" height="100%">
                   <BarChart data={adminStats.chartData}>
                      <XAxis dataKey="name" fontSize={10} axisLine={false} tickLine={false}/>
                      <Tooltip />
                      <Bar dataKey="value" fill="#4338ca" radius={[4,4,0,0]} />
                   </BarChart>
                </ResponsiveContainer>
             </div>
           </>
        )}
     </div>
  );

  return (
    <div className="app-container">
       <div className="header">
          <div onClick={handleLogoClick}>
             <div className="logo">PrintVend</div>
             <div style={{fontSize:11, opacity:0.6}}>{user.user_metadata.full_name?.split(' ')[0]}</div>
          </div>
          <div className="coin-badge" onClick={()=>supabase.auth.signOut()}>
             <div style={{width:8, height:8, background:'#f59e0b', borderRadius:'50%'}}></div> {wallet}
          </div>
       </div>

       {/* Upload */}
       <div className="card">
          {!file ? (
             <label className="upload-zone">
                <Upload size={32} color="#4338ca" />
                <p><b>Tap to Upload PDF</b></p>
                <input type="file" accept="application/pdf" hidden onChange={e=>{
                   if(e.target.files[0]) { setFile(e.target.files[0]); setSettings(s=>({...s, numPages:1})); }
                }} />
             </label>
          ) : (
             <div className="file-row">
                <FileText color="#4338ca"/> <span style={{flex:1, fontWeight:600}}>{file.name}</span>
                <button onClick={()=>setFile(null)} style={{border:'none', background:'none', color:'red'}}>✕</button>
             </div>
          )}
       </div>

       {/* Settings */}
       <div className="card">
          <div className="header" style={{marginBottom:10}}>
             <h3>Settings</h3> <div className="coin-badge">₹{rate.toFixed(1)}/sheet</div>
          </div>
          <div className="toggle-group">
             <button className={`toggle-btn ${!settings.color?'active':''}`} onClick={()=>setSettings({...settings, color:false})}>B&W</button>
             <button className={`toggle-btn ${settings.color?'active':''} `} onClick={()=>setSettings({...settings, color:true})}>Color</button>
          </div>
          <div className="toggle-group">
             <button className={`toggle-btn ${!settings.doubleSide?'active':''} `} onClick={()=>setSettings({...settings, doubleSide:false})}>Single Side</button>
             <button className={`toggle-btn ${settings.doubleSide?'active':''} `} onClick={()=>setSettings({...settings, doubleSide:true})}>Double Side</button>
          </div>
          <div className="input-row">
             <div className="input-wrap"><label>Copies</label><input type="number" min="1" className="glass-input" value={settings.copies} onChange={e=>setSettings({...settings,copies:e.target.value})}/></div>
             <div className="input-wrap"><label>Pages</label><input type="number" min="1" className="glass-input" value={settings.numPages} onChange={e=>setSettings({...settings,numPages:e.target.value})}/></div>
          </div>
       </div>

       {/* Bill */}
       <div className="card">
          <div className="bill-row"><span>Subtotal ({totalSheets} sheets)</span> <span>₹{subtotal.toFixed(2)}</span></div>
          <div className="bill-row"><span>GST (18%)</span> <span>₹{tax.toFixed(2)}</span></div>
          {wallet > 0 && <div className="bill-row" style={{alignItems:'center'}}>
             <span>Use {wallet} Coins</span> <input type="checkbox" checked={useCoins} onChange={e=>setUseCoins(e.target.checked)}/>
          </div>}
          {useCoins && discount > 0 && <div className="bill-row" style={{color:'#f59e0b'}}><span>Discount</span><span>-₹{discount.toFixed(2)}</span></div>}
          <div className="bill-total"><span>Total</span><span>₹{total.toFixed(2)}</span></div>
          <button className="btn-main" disabled={!file || processing} onClick={handleProcess}>
             {processing ? <div className="spinner"></div> : `Pay ₹${total.toFixed(2)}`}
          </button>
       </div>

       {/* Orders */}
       <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', padding:'0 10px'}}>
          <h3>Orders</h3> <button onClick={()=>setShowSupport(true)} style={{border:'none', background:'none'}}><MessageSquare size={18}/></button>
       </div>
       <div className="card" style={{padding:'10px 20px'}}>
          {orders.length===0 ? <p style={{opacity:0.5, textAlign:'center'}}>No orders</p> : orders.map(o=>(
             <div key={o.order_id} className="order-item">
                <div><b>{o.qr_code}</b><br/><span style={{fontSize:11, opacity:0.6}}>{new Date(o.created_at).toLocaleDateString()}</span></div>
                <div className={`status ${o.status}`}>{o.status}</div>
             </div>
          ))}
       </div>

       {/* Support Modal */}
       {showSupport && <div className="modal-overlay">
          <div className="modal">
             <h3>Support</h3>
             <textarea style={{width:'100%', padding:10, borderRadius:10, border:'1px solid #ccc', margin:'10px 0'}} rows="4" value={supportMsg} onChange={e=>setSupportMsg(e.target.value)} placeholder="Issue description..."></textarea>
             <button className="btn-main" onClick={handleSupport}>Submit Ticket</button>
             <button className="btn-main" style={{background:'#ccc', marginTop:10}} onClick={()=>setShowSupport(false)}>Cancel</button>
          </div>
       </div>}
    </div>
  );
}
