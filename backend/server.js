import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

dotenv.config();
const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

// Initialize Supabase Admin
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const upload = multer({ storage: multer.memoryStorage() });

// --- CONFIGURATION (INR) ---
// Rates in Rupees
const RATES = { 
  bw_single: 2.0, bw_double: 1.5, 
  col_single: 10.0, col_double: 8.0 
};
const COIN_VAL = 1.0; // 1 Coin = ₹1
const TAX_RATE = 0.18; // 18% GST

/* --- 1. PROCESS PRINT --- */
app.post("/api/process-print", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    let meta = {};
    try { meta = JSON.parse(req.body.meta || "{}"); } catch (e) { return res.status(400).json({error: "Invalid Metadata"}); }

    const { userId, userEmail, couponCode, useCoins, copies = 1, numPages = 1 } = meta;

    // 1. VIP Check
    const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
    const isVIP = profile?.role === 'VIP';

    // 2. Calculate Base Cost
    const rate = meta.color 
      ? (meta.doubleSide ? RATES.col_double : RATES.col_single) 
      : (meta.doubleSide ? RATES.bw_double : RATES.bw_single);
    
    // Logic: Double sided = ceil(pages/2) sheets
    const sheetsPerCopy = meta.doubleSide ? Math.ceil(parseInt(numPages) / 2) : parseInt(numPages);
    const totalSheets = sheetsPerCopy * parseInt(copies);
    
    let subtotal = totalSheets * rate;
    let total = subtotal + (subtotal * TAX_RATE);

    if (isVIP) { subtotal = 0; total = 0; }

    // 3. Coupons
    if (couponCode && !isVIP && total > 0) {
      const { data: c } = await supabase.from("coupons").select("*").eq("code", couponCode).single();
      if (c && c.active) {
        const { data: used } = await supabase.from("used_coupons").select("*").eq("user_id", userId).eq("coupon_code", couponCode).maybeSingle();
        if (!c.is_one_time || !used) {
           total -= (total * c.discount_percent) / 100;
           if(c.is_one_time) await supabase.from("used_coupons").insert([{ user_id: userId, coupon_code: couponCode }]);
        }
      }
    }

    // 4. Wallet
    let coinsRedeemed = 0;
    if (useCoins && total > 0 && !isVIP) {
      const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", userId).single();
      if (w && w.balance > 0) {
        const coinValueAvailable = w.balance * COIN_VAL;
        const valueToCover = Math.min(total, coinValueAvailable);
        coinsRedeemed = valueToCover / COIN_VAL;
        total -= valueToCover;
      }
    }

    // 5. Generate Identity
    const random6 = crypto.randomBytes(3).toString("hex").toUpperCase();
    const char7 = meta.color ? '1' : '0';
    const char8 = meta.doubleSide ? '1' : '0';
    const qrCode = `${random6}${char7}${char8}`;
    const fileName = `${qrCode}_${Date.now()}.pdf`;

    // 6. Upload
    const { error: uploadErr } = await supabase.storage.from("prints").upload(fileName, req.file.buffer, { contentType: "application/pdf" });
    if(uploadErr) throw new Error("Storage Upload Failed");

    // 7. Record Order
    await supabase.from("orders").insert([{
      user_id: userId,
      user_email: userEmail,
      qr_code: qrCode,
      file_path: fileName,
      pages_selected: totalSheets,
      color: meta.color,
      double_sided: meta.doubleSide,
      total_amount: Math.max(0, total).toFixed(2),
      status: "PAID",
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
      printed: false,
      expired: false
    }]);

    // 8. Transactions
    if (coinsRedeemed > 0) {
      await supabase.from("wallet_transactions").insert([{ user_id: userId, amount: -coinsRedeemed, type: "DEBIT", note: `Paid for ${qrCode}` }]);
    }
    
    // Cashback: 1 Coin for every ₹50 spent
    const earned = !isVIP ? Math.floor(subtotal / 50) : 0;
    if (earned > 0) {
      await supabase.from("wallet_transactions").insert([{ user_id: userId, amount: earned, type: "EARN", note: `Cashback ${qrCode}` }]);
    }
    
    if (coinsRedeemed > 0 || earned > 0) {
      const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", userId).single();
      const newBal = (w?.balance || 0) - coinsRedeemed + earned;
      await supabase.from("wallets").upsert({ user_id: userId, balance: newBal });
    }

    res.json({ success: true, qr: qrCode });

  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* --- 2. FETCH DATA --- */
app.get("/api/user-data/:uid", async (req, res) => {
    try {
        const { uid } = req.params;
        const [walletRes, ordersRes] = await Promise.all([
            supabase.from("wallets").select("balance").eq("user_id", uid).single(),
            supabase.from("orders").select("*").eq("user_id", uid).order("created_at", { ascending: false }).limit(20)
        ]);
        res.json({ wallet: walletRes.data?.balance || 0, orders: ordersRes.data || [] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

/* --- 3. ADMIN STATS --- */
app.get("/api/admin/stats", async (req, res) => {
  try {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const { data: dayOrders } = await supabase.from("orders").select("total_amount").gte("created_at", todayStart.toISOString());
    const dayRevenue = dayOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount)||0), 0);

    const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
    const { data: weekOrders } = await supabase.from("orders").select("total_amount, created_at").gte("created_at", weekAgo.toISOString());
    
    const graphData = {};
    weekOrders.forEach(o => {
        const day = new Date(o.created_at).toLocaleDateString('en-US', { weekday: 'short' });
        graphData[day] = (graphData[day] || 0) + (parseFloat(o.total_amount) || 0);
    });
    
    const chart = Object.keys(graphData).map(key => ({ name: key, value: graphData[key] }));

    res.json({ dayRevenue, dayCount: dayOrders.length, chartData: chart });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* --- 4. PRINT EXECUTION --- */
app.post("/api/print/consume", async (req, res) => {
  try {
    const { qr } = req.body;
    const { data: order } = await supabase.from("orders").select("*").eq("qr_code", qr).single();
    
    if (!order) return res.status(404).json({ error: "Not Found" });
    if (order.printed) return res.status(400).json({ error: "Used Code" });
    if (new Date(order.expires_at) < new Date()) {
        await supabase.from("orders").update({ expired: true, status: "EXPIRED" }).eq("qr_code", qr);
        return res.status(400).json({ error: "Expired" });
    }

    await supabase.from("orders").update({ status: "PRINTED", printed: true, printed_at: new Date() }).eq("qr_code", qr);
    if(order.file_path) await supabase.storage.from("prints").remove([order.file_path]);
    
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* --- 5. SUPPORT & HISTORY --- */
app.post("/api/support", async (req, res) => {
    try {
        const { userId, message } = req.body;
        await supabase.from("support_tickets").insert([{ user_id: userId, message }]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/wallet/history/:uid", async (req, res) => {
    const { data } = await supabase.from("wallet_transactions").select("*").eq("user_id", req.params.uid).order("created_at", { ascending: false });
    res.json(data || []);
});

app.listen(PORT, () => console.log(`🚀 Server running on ${PORT}`));
