// OneServe demo API (Steps 6, 14B, 17, 19) — single file
// run: node server.js

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ---------- Demo data ----------
const stores = [
  { id: "homepro-vte", name: "HomePro VTE (Demo)", lat: 17.9689, lng: 102.6337 },
  { id: "home-hardware", name: "Home Hardware Laos (Demo)", lat: 17.9678, lng: 102.6195 }
];

const inventory = {
  "homepro-vte": [
    { sku: "HAMMER-01",    name: "Steel Hammer 16oz",           price: 65000, qty: 20 },
    { sku: "PAINT-INT-1L", name: "Interior Paint 1L (White)",   price: 85000, qty: 35 },
    { sku: "LED-BULB-9W",  name: "LED Bulb 9W (E27)",           price: 22000, qty: 100 }
  ],
  "home-hardware": [
    { sku: "HAMMER-01",    name: "Steel Hammer 16oz",           price: 64000, qty: 18 },
    { sku: "LED-BULB-9W",  name: "LED Bulb 9W (E27)",           price: 21000, qty: 120 }
  ]
};

const orders = [];                        // {id,...}
const providers = new Map();              // phone -> {id,phone,name,skills[],lat,lng,online,createdAt}
const jobs = [];                          // {id,title,desc,lat,lng,when,price,status,assignedPhone?,createdAt}

const sseClients = new Set();             // SSE connections

// ---------- Utils ----------
const toRad = d => d * Math.PI / 180;
function km(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 + Math.cos(toRad(a.lat))*Math.cos(toRad(b.lat))*Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
function bcast(type, payload) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of sseClients) { try { res.write(msg); } catch {} }
}

// ---------- Health ----------
app.get("/health", (_, res) => res.json({ ok: true }));

// ---------- Stores & Inventory ----------
app.get("/stores", (_, res) => res.json(stores));
app.get("/inventory", (req, res) => res.json(inventory[String(req.query.storeId||"")] || []));

// ---------- Nearby (stores + sample providers) ----------
app.get("/nearby", (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  const rKm = parseFloat(req.query.r || "5");
  const origin = { lat, lng };

  const sampleProviders = [
    { name: "AC Pro Service",    lat: 17.9708, lng: 102.6270, category: "handy" },
    { name: "Pho Viengchan",     lat: 17.9719, lng: 102.6310, category: "food"  },
    { name: "SomSanouk (Sedan)", lat: 17.9799, lng: 102.6163, category: "ride"  }
  ];

  const list = [
    ...stores.map(s => ({ ptype:"store", name:s.name, lat:s.lat, lng:s.lng })),
    ...sampleProviders
  ].map(p => {
    const d = km(origin, { lat: p.lat, lng: p.lng });
    return { ...p, km: d, etaMins: Math.round((d / 0.35) * 2) };
  }).filter(p => isFinite(p.km) && p.km <= rKm)
    .sort((a,b) => a.km - b.km);

  res.json(list);
});

// ---------- Auth (OTP demo) ----------
const auth = { otps:new Map(), users:new Map(), tokens:new Map() }; // see Step 17
function issueToken(phone){ const t="tok_"+Math.random().toString(36).slice(2); auth.tokens.set(t, phone); return t; }
app.post("/auth/request-otp",(req,res)=>{
  const phone=String(req.body?.phone||"").trim(); if(!phone||phone.length<6) return res.status(400).json({error:"invalid phone"});
  const code=String(Math.floor(100000+Math.random()*900000)), exp=Date.now()+5*60*1000;
  auth.otps.set(phone,{code,exp}); console.log(`[OTP] ${phone} -> ${code} (5m)`); res.json({ok:true,demoCode:code,expiresIn:300});
});
app.post("/auth/verify-otp",(req,res)=>{
  const {phone,code}=req.body||{}; const rec=auth.otps.get(String(phone).trim());
  if(!rec) return res.status(400).json({error:"no otp"}); if(Date.now()>rec.exp) return res.status(400).json({error:"otp expired"});
  if(String(code)!==rec.code) return res.status(400).json({error:"wrong code"});
  let user=auth.users.get(phone); if(!user){ user={id:"U-"+Math.random().toString(36).slice(2,8).toUpperCase(),phone,name:"Guest",createdAt:new Date().toISOString()}; auth.users.set(phone,user); }
  const token=issueToken(phone); auth.otps.delete(phone); res.json({token,user});
});
app.get("/me",(req,res)=>{
  const h=req.headers.authorization||""; const token=h.startsWith("Bearer ")?h.slice(7):""; const phone=auth.tokens.get(token);
  if(!phone) return res.status(401).json({error:"unauthorized"}); res.json({user:auth.users.get(phone)});
});
function authPhone(req){ const h=req.headers.authorization||""; const tok=h.startsWith("Bearer ")?h.slice(7):""; return auth.tokens.get(tok)||null; }

// ---------- Orders (with ?mine=1 filter) ----------
app.get("/orders",(req,res)=>{
  if(String(req.query.mine)==="1"){ const phone=authPhone(req); if(!phone) return res.status(401).json({error:"unauthorized"}); return res.json(orders.filter(o=>o.phone===phone)); }
  res.json(orders);
});
app.post("/orders",(req,res)=>{
  const o=req.body||{}, now=new Date().toISOString(); const phoneFromToken=authPhone(req)||"";
  const order={ id:String(o.id||"OS-"+Math.random().toString(36).slice(2,8).toUpperCase()), createdAt:now, status:o.status||"Pending",
    total:o.total||0, grand:o.grand??o.total, fee:o.fee||0, discount:o.discount||0, mode:o.mode||"delivery", when:o.when||"ASAP",
    name:o.name||"Guest", phone:o.phone||phoneFromToken, addr:o.addr||"", items:Array.isArray(o.items)?o.items:[] };
  orders.unshift(order); res.json(order);
});

// ---------- Payments: simulate + webhook ----------
app.post("/payments/simulate",(req,res)=>{
  const {id,delay=2000}=req.body||{}; res.json({ok:true});
  setTimeout(()=>{ const o=orders.find(x=>x.id===id); if(!o) return; o.status="Confirmed"; o.paidAt=new Date().toISOString(); console.log(`[SIM] order paid → ${id}`); bcast("order:update",o); }, Math.max(1,delay));
});
app.post("/payments/webhook",(req,res)=>{
  const {id,status="Confirmed"}=req.body||{}; const o=orders.find(x=>x.id===id); if(!o) return res.status(404).json({error:"order not found"});
  o.status=status; o.paidAt=new Date().toISOString(); bcast("order:update",o); res.json({ok:true,order:o});
});

// ---------- Provider & Jobs (Step 19) ----------
app.get("/providers/me",(req,res)=>{
  const phone=authPhone(req); if(!phone) return res.status(401).json({error:"unauthorized"});
  res.json({ provider: providers.get(phone) || null });
});
app.post("/providers/register",(req,res)=>{
  const phone=authPhone(req); if(!phone) return res.status(401).json({error:"unauthorized"});
  const { name="Provider", skills=[], lat=17.9757, lng=102.6331 } = req.body||{};
  const pv = { id:"P-"+Math.random().toString(36).slice(2,8).toUpperCase(), phone, name, skills, lat, lng, online:false, createdAt:new Date().toISOString() };
  providers.set(phone, pv);
  console.log(`[PROVIDER] registered ${phone} -> ${pv.name}`);
  res.json({ provider: pv });
});
app.post("/providers/status",(req,res)=>{
  const phone=authPhone(req); if(!phone) return res.status(401).json({error:"unauthorized"});
  const pv=providers.get(phone); if(!pv) return res.status(404).json({error:"not registered"});
  const { online, lat, lng } = req.body||{};
  if(typeof online==="boolean") pv.online=online;
  if(isFinite(lat)) pv.lat=lat; if(isFinite(lng)) pv.lng=lng;
  res.json({ provider: pv });
});

// Jobs
app.get("/jobs",(req,res)=>{
  // ?available=1 => jobs without assignee; optional near=lat,lng & r=km
  // ?assigned=1  => jobs assigned to me
  const phone=authPhone(req);
  if(String(req.query.assigned)==="1"){ if(!phone) return res.status(401).json({error:"unauthorized"}); return res.json(jobs.filter(j=>j.assignedPhone===phone)); }
  let list = jobs;
  if(String(req.query.available)==="1"){ list = list.filter(j=>!j.assignedPhone && j.status==="Requested"); }
  const near=req.query.near? String(req.query.near).split(",").map(Number): null;
  const rKm=parseFloat(req.query.r||"10");
  if(near && isFinite(near[0]) && isFinite(near[1])){
    list=list.map(j=>({ ...j, km: km({lat:near[0],lng:near[1]}, {lat:j.lat,lng:j.lng}) }))
             .filter(j=>j.km<=rKm).sort((a,b)=>a.km-b.km);
  }
  res.json(list);
});
app.post("/jobs/claim",(req,res)=>{
  const phone=authPhone(req); if(!phone) return res.status(401).json({error:"unauthorized"});
  const j = jobs.find(x=>x.id===String(req.body?.id||""));
  if(!j) return res.status(404).json({error:"not found"});
  if(j.assignedPhone) return res.status(400).json({error:"already assigned"});
  j.assignedPhone=phone; j.status="Accepted"; j.acceptedAt=new Date().toISOString();
  bcast("job:update", j);
  res.json({ job:j });
});
// Demo job creator (for testing from provider page)
app.post("/jobs/demo",(req,res)=>{
  const phone=authPhone(req); if(!phone) return res.status(401).json({error:"unauthorized"});
  const pv = providers.get(phone);
  const base = pv || { lat: 17.9757, lng: 102.6331 };
  const jitter = () => (Math.random()-0.5) * 0.02;
  const job = {
    id: "J-"+Math.random().toString(36).slice(2,8).toUpperCase(),
    title: "Light bulb installation",
    desc: "Replace 2 bulbs in living room",
    lat: base.lat + jitter(), lng: base.lng + jitter(),
    when: "ASAP", price: 50000, status: "Requested",
    createdAt: new Date().toISOString()
  };
  jobs.unshift(job);
  bcast("job:update", job);
  res.json({ job });
});

// ---------- Live events (SSE) ----------
app.get("/events",(req,res)=>{
  res.setHeader("Content-Type","text/event-stream");
  res.setHeader("Cache-Control","no-cache");
  res.setHeader("Connection","keep-alive");
  res.flushHeaders?.();
  res.write(`event: ping\ndata: "ok"\n\n`);
  sseClients.add(res);
  req.on("close",()=>sseClients.delete(res));
});

// ---------- Start server ----------
const PORT = process.env.PORT || 4000;
  app.listen(PORT,"0.0.0.0",()=> {
   console.log('API listening on http://0.0.0.0:' + PORT);
  });