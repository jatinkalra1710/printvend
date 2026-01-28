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

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const upload = multer({ storage: multer.memoryStorage() });

const RATES = { bw_single: 1.5, bw_double: 1.0, col_single: 5.0, col_double: 4.5 };
const COIN_VAL = 0.1; 

/* --- 1. PROCESS PRINT --- */
app.post("/api/process-print", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file" });

    const meta = JSON.parse(req.body.meta || "{}");
    const { userId, couponCode, useCoins, copies = 1 } = meta;

    const { data: profile } = await supabase.from("profiles").select("role").eq("id", userId).single();
    const isVIP = profile?.role === 'VIP';

    const rate = meta.color 
      ? (meta.doubleSide ? RATES.col_double : RATES.col_single) 
      : (meta.doubleSide ? RATES.bw_double : RATES.bw_single);
    
    const numPages = parseInt(meta.pages.length || 0);
    const totalSheets = numPages * parseInt(copies); 
    
    let subtotal = totalSheets * rate;
    let total = subtotal + (subtotal * 0.18); 

    if (isVIP) { subtotal = 0; total = 0; }

    if (couponCode && !isVIP) {
      const { data: c } = await supabase.from("coupons").select("*").eq("code", couponCode).single();
      if (c && c.active) {
        const { data: used } = await supabase.from("used_coupons").select("*").eq("user_id", userId).eq("coupon_code", couponCode).maybeSingle();
        if (!c.is_one_time || !used) {
           total -= (total * c.discount_percent) / 100;
           if(c.is_one_time) await supabase.from("used_coupons").insert([{ user_id: userId, coupon_code: couponCode }]);
        }
      }
    }

    let coinsRedeemed = 0;
    if (useCoins && total > 0 && !isVIP) {
      const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", userId).single();
      coinsRedeemed = Math.min(w?.balance || 0, total / COIN_VAL);
      total -= coinsRedeemed * COIN_VAL;
    }

    const random6 = crypto.randomBytes(3).toString("hex").toUpperCase(); 
    const char7 = meta.color ? '1' : '0';
    const char8 = meta.doubleSide ? '1' : '0';
    const qrCode = `${random6}${char7}${char8}`; 

    const fileName = `${qrCode}.pdf`; 
    await supabase.storage.from("prints").upload(fileName, req.file.buffer, { contentType: "application/pdf" });

    await supabase.from("orders").insert([{
      order_id: meta.order_id, 
      user_id: userId,
      user_email: meta.email,
      qr_code: qrCode,
      file_path: fileName,
      pages_selected: totalSheets, 
      color: meta.color,
      double_sided: meta.doubleSide,
      total_amount: total.toFixed(2),
      status: "PAID",
      expires_at: new Date(Date.now() + 3600 * 1000).toISOString()
    }]);

    if (coinsRedeemed > 0) {
      await supabase.from("wallet_transactions").insert([{ user_id: userId, amount: -coinsRedeemed, type: "DEBIT", note: `Paid for ${qrCode}` }]);
    }
    
    const earned = !isVIP ? Math.floor(subtotal / 10) : 0;
    if (earned > 0) {
      await supabase.from("wallet_transactions").insert([{ user_id: userId, amount: earned, type: "EARN", note: `Cashback for ${qrCode}` }]);
    }
    
    const { data: w } = await supabase.from("wallets").select("balance").eq("user_id", userId).single();
    await supabase.from("wallets").update({ balance: (w?.balance || 0) - coinsRedeemed + earned }).eq("user_id", userId);

    res.json({ success: true, qr: qrCode });

  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* --- 2. ADMIN STATS (With Graph Data) --- */
app.get("/api/admin/stats", async (req, res) => {
  try {
    const { date } = req.query; // Optional date filter
    const targetDate = date ? new Date(date) : new Date();
    
    const startOfDay = new Date(targetDate.setHours(0,0,0,0)).toISOString();
    const endOfDay = new Date(targetDate.setHours(23,59,59,999)).toISOString();

    // 1. Daily Stats
    const { data: dayOrders } = await supabase.from("orders")
      .select("total_amount, created_at")
      .gte("created_at", startOfDay)
      .lte("created_at", endOfDay);

    const dayRevenue = dayOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
    
    // 2. Weekly Graph Data (Last 7 Days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const { data: weekData } = await supabase.from("orders")
      .select("total_amount, created_at")
      .gte("created_at", sevenDaysAgo.toISOString());

    // Group by Day
    const graphData = {};
    weekData.forEach(o => {
      const day = new Date(o.created_at).toLocaleDateString('en-US', { weekday: 'short' });
      graphData[day] = (graphData[day] || 0) + o.total_amount;
    });

    const chart = Object.keys(graphData).map(key => ({ name: key, value: graphData[key] }));

    res.json({ 
      dayRevenue: dayRevenue.toFixed(2),
      dayCount: dayOrders.length,
      chartData: chart
    });

  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/print/consume", async (req, res) => {
  try {
    const { qr } = req.body;
    const { data: order } = await supabase.from("orders").select("*").eq("qr_code", qr).single();
    if (!order) return res.status(404).json({ error: "Not found" });
    if (order.status === "PRINTED") return res.status(400).json({ error: "Used" });
    if (new Date(order.expires_at) < new Date()) return res.status(400).json({ error: "Expired" });

    await supabase.from("orders").update({ status: "PRINTED", printed_at: new Date() }).eq("qr_code", qr);
    if(order.file_path) await supabase.storage.from("prints").remove([order.file_path]);
    
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/check-coupon", async (req, res) => {
    try {
        const { code, userId } = req.body;
        const { data: c } = await supabase.from("coupons").select("*").eq("code", code).maybeSingle();
        if (!c || !c.active) return res.status(400).json({ error: "Invalid" });
        if (c.is_one_time) {
          const { data: u } = await supabase.from("used_coupons").select("*").eq("user_id", userId).eq("coupon_code", code).maybeSingle();
          if (u) return res.status(400).json({ error: "Used" });
        }
        res.json({ success: true, percent: c.discount_percent });
      } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/support", async (req, res) => {
    try {
        const { userId, orderId, message } = req.body;
        await supabase.from("support_tickets").insert([{ user_id: userId, order_id: orderId, message }]);
        res.json({ success: true });
      } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/wallet/history/:uid", async (req, res) => {
    const { data } = await supabase.from("wallet_transactions").select("*").eq("user_id", req.params.uid).order("created_at", { ascending: false });
    res.json(data || []);
});

app.listen(PORT, () => console.log(`🚀 Server on ${PORT}`));