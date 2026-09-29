const express=require("express");
const http=require("http");
const cors=require("cors");
const jwt=require("jsonwebtoken");
const bcrypt=require("bcryptjs");
const Database=require("better-sqlite3");
const {Server}=require("socket.io");
const path=require("path");

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"}});
app.use(cors()); app.use(express.json());

const db=new Database(path.join(__dirname,"nova.db"));
db.pragma("journal_mode=WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL, phone TEXT UNIQUE, email TEXT UNIQUE,
 password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer',
 lat REAL, lng REAL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS shops(
 id INTEGER PRIMARY KEY AUTOINCREMENT, owner_id INTEGER,
 name TEXT NOT NULL, category TEXT NOT NULL, description TEXT,
 lat REAL, lng REAL, delivery_fee REAL DEFAULT 5, eta TEXT DEFAULT '20-30 دقيقة',
 active INTEGER DEFAULT 1, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT, shop_id INTEGER NOT NULL,
 name TEXT NOT NULL, description TEXT, price REAL NOT NULL, image TEXT,
 active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL,
 shop_id INTEGER NOT NULL, driver_id INTEGER, status TEXT DEFAULT 'pending',
 address TEXT, lat REAL, lng REAL, total REAL DEFAULT 0,
 created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS order_items(
 id INTEGER PRIMARY KEY AUTOINCREMENT, order_id INTEGER NOT NULL,
 product_id INTEGER NOT NULL, quantity INTEGER NOT NULL, price REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS driver_locations(
 driver_id INTEGER PRIMARY KEY, lat REAL, lng REAL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

const JWT_SECRET=process.env.JWT_SECRET||"CHANGE_THIS_NOVA_SECRET_IN_PRODUCTION";

function auth(req,res,next){
 const h=req.headers.authorization||"";
 if(!h.startsWith("Bearer "))return res.status(401).json({error:"تسجيل الدخول مطلوب"});
 try{req.user=jwt.verify(h.slice(7),JWT_SECRET);next()}catch(e){res.status(401).json({error:"جلسة غير صالحة"})}
}
function role(...roles){return (req,res,next)=>roles.includes(req.user.role)?next():res.status(403).json({error:"ليس لديك صلاحية"})}
function token(u){return jwt.sign({id:u.id,name:u.name,role:u.role},JWT_SECRET,{expiresIn:"30d"})}

const adminEmail="admin@nova.local";
if(!db.prepare("SELECT id FROM users WHERE email=?").get(adminEmail)){
 const p=bcrypt.hashSync("Nova@12345",10);
 db.prepare("INSERT INTO users(name,email,password,role) VALUES(?,?,?,?)").run("مدير نوفا",adminEmail,p,"admin");
}
if(db.prepare("SELECT COUNT(*) c FROM shops").get().c===0){
 const s=db.prepare("INSERT INTO shops(name,category,description,lat,lng,delivery_fee,eta) VALUES(?,?,?,?,?,?,?)")
 .run("مذاق نوفا","مطاعم","مطعم تجريبي",15.173,-43.58,5,"25-35 دقيقة");
 db.prepare("INSERT INTO products(shop_id,name,description,price) VALUES(?,?,?,?)").run(s.lastInsertRowid,"برجر لحم","برجر طازج",18);
 db.prepare("INSERT INTO products(shop_id,name,description,price) VALUES(?,?,?,?)").run(s.lastInsertRowid,"بطاطس","بطاطس مقرمشة",7);
}

app.get("/api/health",(req,res)=>res.json({ok:true,name:"توصيل نوفا",time:new Date().toISOString()}));

app.post("/api/auth/register",(req,res)=>{
 const {name,phone,email,password}=req.body;
 if(!name||!password||(!phone&&!email))return res.status(400).json({error:"الاسم وكلمة المرور ووسيلة تواصل مطلوبة"});
 try{
  const hash=bcrypt.hashSync(password,10);
  const r=db.prepare("INSERT INTO users(name,phone,email,password,role) VALUES(?,?,?,?,?)").run(name,phone||null,email||null,hash,"customer");
  const u=db.prepare("SELECT id,name,phone,email,role FROM users WHERE id=?").get(r.lastInsertRowid);
  res.json({token:token(u),user:u});
 }catch(e){res.status(409).json({error:"رقم الهاتف أو البريد مستخدم مسبقاً"})}
});
app.post("/api/auth/login",(req,res)=>{
 const {login,password}=req.body;
 const u=db.prepare("SELECT * FROM users WHERE phone=? OR email=?").get(login,login);
 if(!u||!bcrypt.compareSync(password,u.password))return res.status(401).json({error:"بيانات الدخول غير صحيحة"});
 res.json({token:token(u),user:{id:u.id,name:u.name,phone:u.phone,email:u.email,role:u.role}});
});

app.get("/api/shops",(req,res)=>{
 const {category,q}=req.query;
 let sql="SELECT * FROM shops WHERE active=1"; let p=[];
 if(category&&category!=="الكل"){sql+=" AND category=?";p.push(category)}
 if(q){sql+=" AND (name LIKE ? OR description LIKE ?)";p.push("%"+q+"%","%"+q+"%")}
 const shops=db.prepare(sql+" ORDER BY id DESC").all(...p);
 const out=shops.map(s=>({...s,products:db.prepare("SELECT * FROM products WHERE shop_id=? AND active=1 ORDER BY id DESC").all(s.id)}));
 res.json(out);
});
app.post("/api/shops",auth,role("admin","shop"),(req,res)=>{
 const {name,category,description,lat,lng,delivery_fee,eta}=req.body;
 if(!name||!category)return res.status(400).json({error:"اسم المتجر والتصنيف مطلوبان"});
 const owner=req.user.role==="shop"?req.user.id:null;
 const r=db.prepare("INSERT INTO shops(owner_id,name,category,description,lat,lng,delivery_fee,eta) VALUES(?,?,?,?,?,?,?,?)")
 .run(owner,name,category,description||"",lat||null,lng||null,delivery_fee||5,eta||"20-30 دقيقة");
 res.json(db.prepare("SELECT * FROM shops WHERE id=?").get(r.lastInsertRowid));
});
app.post("/api/shops/:id/products",auth,role("admin","shop"),(req,res)=>{
 const s=db.prepare("SELECT * FROM shops WHERE id=?").get(req.params.id);
 if(!s)return res.status(404).json({error:"المتجر غير موجود"});
 if(req.user.role==="shop"&&s.owner_id!==req.user.id)return res.status(403).json({error:"ليس متجرك"});
 const {name,description,price,image}=req.body;
 const r=db.prepare("INSERT INTO products(shop_id,name,description,price,image) VALUES(?,?,?,?,?)").run(s.id,name,description||"",price,image||"");
 res.json(db.prepare("SELECT * FROM products WHERE id=?").get(r.lastInsertRowid));
});

app.post("/api/orders",auth,role("customer"),(req,res)=>{
 const {shop_id,items,address,lat,lng}=req.body;
 if(!shop_id||!Array.isArray(items)||!items.length)return res.status(400).json({error:"بيانات الطلب ناقصة"});
 const shop=db.prepare("SELECT * FROM shops WHERE id=? AND active=1").get(shop_id);
 if(!shop)return res.status(404).json({error:"المتجر غير موجود"});
 let total=0, clean=[];
 for(const x of items){
  const p=db.prepare("SELECT * FROM products WHERE id=? AND shop_id=? AND active=1").get(x.product_id,shop_id);
  if(!p||!Number.isInteger(x.quantity)||x.quantity<1) return res.status(400).json({error:"سلعة غير صالحة"});
  total+=p.price*x.quantity; clean.push({p,q:x.quantity});
 }
 const tx=db.transaction(()=>{
  const o=db.prepare("INSERT INTO orders(customer_id,shop_id,address,lat,lng,total) VALUES(?,?,?,?,?,?)")
   .run(req.user.id,shop_id,address||"",lat||null,lng||null,total);
  for(const x of clean)db.prepare("INSERT INTO order_items(order_id,product_id,quantity,price) VALUES(?,?,?,?)").run(o.lastInsertRowid,x.p.id,x.q,x.p.price);
  return o.lastInsertRowid;
 });
 const id=tx(); emitOrder(id); res.json(getOrder(id));
});

function getOrder(id){
 const o=db.prepare(`SELECT o.*,s.name shop_name,u.name customer_name,u.phone customer_phone,d.name driver_name,d.phone driver_phone
 FROM orders o JOIN shops s ON s.id=o.shop_id JOIN users u ON u.id=o.customer_id
 LEFT JOIN users d ON d.id=o.driver_id WHERE o.id=?`).get(id);
 if(!o)return null;
 o.items=db.prepare(`SELECT oi.*,p.name FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?`).all(id);
 return o;
}
function emitOrder(id){const o=getOrder(id);io.to("order:"+id).emit("order:update",o);io.to("driver:"+o.driver_id).emit("order:update",o);}

app.get("/api/orders",auth,(req,res)=>{
 let rows;
 if(req.user.role==="customer")rows=db.prepare("SELECT id,status,total,address,shop_id,driver_id,created_at FROM orders WHERE customer_id=? ORDER BY id DESC").all(req.user.id);
 else if(req.user.role==="driver")rows=db.prepare("SELECT id,status,total,address,shop_id,customer_id,created_at FROM orders WHERE driver_id=? ORDER BY id DESC").all(req.user.id);
 else rows=db.prepare("SELECT id,status,total,address,shop_id,customer_id,driver_id,created_at FROM orders ORDER BY id DESC").all();
 res.json(rows);
});
app.get("/api/orders/:id",auth,(req,res)=>{
 const o=getOrder(req.params.id); if(!o)return res.status(404).json({error:"الطلب غير موجود"});
 if(req.user.role==="customer"&&o.customer_id!==req.user.id)return res.status(403).json({error:"غير مصرح"});
 if(req.user.role==="driver"&&o.driver_id!==req.user.id)return res.status(403).json({error:"غير مصرح"});
 res.json(o);
});

app.patch("/api/orders/:id/status",auth,role("admin","driver","shop"),(req,res)=>{
 const o=getOrder(req.params.id);if(!o)return res.status(404).json({error:"الطلب غير موجود"});
 const allowed=["confirmed","preparing","ready","assigned","picked_up","on_the_way","delivered","cancelled"];
 if(!allowed.includes(req.body.status))return res.status(400).json({error:"حالة غير صالحة"});
 db.prepare("UPDATE orders SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(req.body.status,o.id);
 emitOrder(o.id);res.json(getOrder(o.id));
});
app.post("/api/orders/:id/assign-driver",auth,role("admin","shop"),(req,res)=>{
 const {driver_id}=req.body;const d=db.prepare("SELECT id FROM users WHERE id=? AND role='driver'").get(driver_id);
 if(!d)return res.status(404).json({error:"المندوب غير موجود"});
 const o=getOrder(req.params.id);if(!o)return res.status(404).json({error:"الطلب غير موجود"});
 db.prepare("UPDATE orders SET driver_id=?,status='assigned',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(driver_id,o.id);
 emitOrder(o.id);res.json(getOrder(o.id));
});
app.post("/api/drivers/location",auth,role("driver"),(req,res)=>{
 const {lat,lng}=req.body;
 db.prepare("INSERT INTO driver_locations(driver_id,lat,lng,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(driver_id) DO UPDATE SET lat=excluded.lat,lng=excluded.lng,updated_at=CURRENT_TIMESTAMP")
 .run(req.user.id,lat,lng);
 const orders=db.prepare("SELECT id FROM orders WHERE driver_id=? AND status IN ('assigned','picked_up','on_the_way')").all(req.user.id);
 for(const o of orders)io.to("order:"+o.id).emit("driver:location",{driver_id:req.user.id,lat,lng});
 res.json({ok:true});
});
app.get("/api/drivers",auth,role("admin","shop"),(req,res)=>res.json(db.prepare("SELECT id,name,phone FROM users WHERE role='driver'").all()));

io.on("connection",socket=>{
 socket.on("auth",data=>{try{const u=jwt.verify(data.token,JWT_SECRET);socket.user=u;socket.join("user:"+u.id)}catch(e){}});
 socket.on("watch_order",id=>socket.join("order:"+id));
 socket.on("join_driver",id=>socket.join("driver:"+id));
});

app.use(express.static(path.join(__dirname,"../web")));
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"../web/index.html")));
const PORT=process.env.PORT||3000;
server.listen(PORT,()=>console.log("Nova server on http://localhost:"+PORT));
