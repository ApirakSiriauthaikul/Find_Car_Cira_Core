import base64
import difflib
import os
import re
import sqlite3
import time
from typing import Optional
from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
 
BASE = os.path.dirname(os.path.abspath(__file__))
IMG_DIR = os.path.join(BASE, "images")
DB_PATH = os.path.join(BASE, "parking.db")
os.makedirs(IMG_DIR, exist_ok=True)
 
# ---------- ตั้งค่า ----------
SLOTS = ["A1-1", "A1-2", "A1-3", "A1-4"]  
LEAVE_TIMEOUT = float(os.environ.get("LEAVE_TIMEOUT", "60"))  
SAME_CAR = 0.8       
CHANGE_CONFIRM = 2   
 
THAI_DIGITS = str.maketrans("๐๑๒๓๔๕๖๗๘๙", "0123456789")

CONFUSABLE = str.maketrans({"ฒ": "ผ", "ฎ": "ภ"})
SLOT_RE = re.compile(r"^[A-Za-z0-9_-]{1,20}$")
 
 
def clean(s: str) -> str:
    return "".join(s.split()).translate(THAI_DIGITS)
 
 
def norm(s: str) -> str:
    return clean(s).translate(CONFUSABLE)
 
 
def similar(a: str, b: str) -> bool:
    return difflib.SequenceMatcher(None, a, b).ratio() >= SAME_CAR
 
 
def db():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    return con
 
 
def init_db():
    con = db()
    con.execute(
        """CREATE TABLE IF NOT EXISTS slots(
            slot_id TEXT PRIMARY KEY,
            plate TEXT, plate_norm TEXT, province TEXT, confidence REAL,
            image_file TEXT, parked_at REAL, last_seen REAL,
            cand_norm TEXT, cand_count INTEGER DEFAULT 0)"""
    )
    for s in SLOTS:
        con.execute("INSERT OR IGNORE INTO slots(slot_id) VALUES(?)", (s,))
    con.commit()
    con.close()
 
 
init_db()
app = FastAPI(title="Parking slots")
app.mount("/images", StaticFiles(directory=IMG_DIR), name="images")
# เสิร์ฟไฟล์หน้าเว็บ User/Admin จากโฟลเดอร์ web ที่อยู่ข้าง server.py
WEB_DIR = os.path.join(BASE, "web")
app.mount("/css", StaticFiles(directory=os.path.join(WEB_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(WEB_DIR, "js")), name="js")
 
 
def remove_image(name):
    if name:
        try:
            os.remove(os.path.join(IMG_DIR, name))
        except OSError:
            pass
 
 
def empty_slot(con, slot_id, image_file):
    remove_image(image_file)
    con.execute(
        "UPDATE slots SET plate=NULL, plate_norm=NULL, province=NULL, confidence=NULL, "
        "image_file=NULL, parked_at=NULL, last_seen=NULL, cand_norm=NULL, cand_count=0 "
        "WHERE slot_id=?", (slot_id,))
 
 
def expire(con, now):
    """ช่องไหนไม่มีสัญญาณเกินเวลา = รถออก ลบข้อมูลและรูปทิ้ง"""
    rows = con.execute(
        "SELECT slot_id, image_file FROM slots WHERE plate IS NOT NULL AND last_seen < ?",
        (now - LEAVE_TIMEOUT,)).fetchall()
    for r in rows:
        empty_slot(con, r["slot_id"], r["image_file"])
    if rows:
        con.commit()
 
 
def save_image(b64, slot_id, now):
    try:
        data = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="image_b64 is not valid base64")
    name = "{}_{}_{:03d}.jpg".format(
        slot_id, time.strftime("%Y%m%d_%H%M%S", time.localtime(now)), int((now % 1) * 1000))
    with open(os.path.join(IMG_DIR, name), "wb") as f:
        f.write(data)
    return name
 
 
class SeenIn(BaseModel):
    slot_id: str
    plate: str
    province: str = ""
    confidence: float = 0.0
    image_b64: Optional[str] = None
 
 
@app.post("/api/seen")
def seen(p: SeenIn):
    slot_id = p.slot_id.strip()
    if not SLOT_RE.match(slot_id):
        raise HTTPException(status_code=400, detail="slot_id must be letters/digits/-/_ (max 20)")
    plate = clean(p.plate)
    if not plate:
        raise HTTPException(status_code=400, detail="plate is empty")
    plate_n = norm(plate)
    now = time.time()
 
    con = db()
    try:
        expire(con, now)
        con.execute("INSERT OR IGNORE INTO slots(slot_id) VALUES(?)", (slot_id,))
        row = con.execute("SELECT * FROM slots WHERE slot_id=?", (slot_id,)).fetchone()
 
        def park(status):
            img = save_image(p.image_b64, slot_id, now) if p.image_b64 else None
            if row["plate"] is not None:
                remove_image(row["image_file"])
            con.execute(
                "UPDATE slots SET plate=?, plate_norm=?, province=?, confidence=?, image_file=?, "
                "parked_at=?, last_seen=?, cand_norm=NULL, cand_count=0 WHERE slot_id=?",
                (plate, plate_n, p.province, p.confidence, img, now, now, slot_id))
            con.commit()
            return {"status": status, "slot_id": slot_id, "plate": plate}
 
        if row["plate"] is None:
            return park("parked")                      # ช่องว่าง มีรถเข้าใหม่
 
        if similar(plate_n, row["plate_norm"]):        # รถคันเดิม แค่ต่อสัญญาณ
            con.execute("UPDATE slots SET last_seen=?, cand_norm=NULL, cand_count=0 "
                        "WHERE slot_id=?", (now, slot_id))
            con.commit()
            return {"status": "refreshed", "slot_id": slot_id, "plate": row["plate"]}
 
        # ป้ายต่างจากคันเดิม: รอให้เห็นซ้ำก่อน กันอ่านพลาดครั้งเดียวแล้วเปลี่ยนรถ
        cnt = row["cand_count"] + 1 if row["cand_norm"] and similar(plate_n, row["cand_norm"]) else 1
        if cnt >= CHANGE_CONFIRM:
            return park("replaced")
        con.execute("UPDATE slots SET cand_norm=?, cand_count=? WHERE slot_id=?",
                    (plate_n, cnt, slot_id))
        con.commit()
        return {"status": "pending", "slot_id": slot_id, "seen_times": cnt}
    finally:
        con.close()
 
 
def slot_dict(r, now):
    occupied = r["plate"] is not None
    return {
        "slot_id": r["slot_id"],
        "occupied": occupied,
        "plate": r["plate"],
        "province": r["province"],
        "image_url": f"/images/{r['image_file']}" if occupied and r["image_file"] else None,
        "parked_since": time.strftime("%H:%M:%S", time.localtime(r["parked_at"])) if occupied else None,
        "seconds_since_seen": round(now - r["last_seen"]) if occupied else None,
    }
 
 
def matches(q_norm, plate_norm, province):
    province_norm = norm(province or "")

    if q_norm.isdigit():
        return q_norm in plate_norm

    if q_norm in plate_norm:
        return True

    if q_norm in province_norm:
        return True
   
    return difflib.SequenceMatcher(
        None, q_norm, plate_norm
    ).ratio() >= 0.6
 
 
@app.get("/api/slots")
def list_slots(q: str = ""):
    now = time.time()
    con = db()
    try:
        expire(con, now)
        rows = con.execute("SELECT * FROM slots ORDER BY rowid").fetchall()
        if not q.strip():

            return [slot_dict(r, now) for r in rows]
        qn = norm(q)    # ค้นได้เฉพาะรถที่ยังจอดอยู่
        return [slot_dict(r, now) for r in rows
                if r["plate"] is not None and matches(qn, r["plate_norm"], r["province"])]
    finally:
        con.close()
 
 
@app.post("/api/slots/{slot_id}/clear")
def clear_slot(slot_id: str):
    """เคลียร์ช่องด้วยมือ (ใช้ทดสอบ หรือถ้าอยากให้กล้องส่งสัญญาณรถออกทันที)"""
    con = db()
    try:
        row = con.execute("SELECT image_file FROM slots WHERE slot_id=?", (slot_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="unknown slot")
        empty_slot(con, slot_id, row["image_file"])
        con.commit()
        return {"status": "cleared", "slot_id": slot_id}
    finally:
        con.close()
 
 

PAGE = """<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Parking Dashboard</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700&display=swap');

:root {
  --bg: #f4f7f5;
  --card: #ffffff;
  --ink: #17251f;
  --muted: #7b8981;
  --green: #176b4a;
  --green-light: #e7f3ec;
  --red: #d9534f;
  --line: #e6ece8;
  --shadow: 0 5px 22px rgba(20,50,35,.055);
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: 'Prompt', sans-serif;
}

header {
  background: #123e2e;
  color: white;
  padding: 22px 5%;
}

.header-inner {
  max-width: 1200px;
  margin: auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
}

.brand {
  display: flex;
  align-items: center;
  gap: 13px;
}

.brand-icon {
  width: 45px;
  height: 45px;
  border-radius: 13px;
  background: rgba(255,255,255,.14);
  display: grid;
  place-items: center;
  font-size: 23px;
}

.brand h1 {
  font-size: 20px;
  margin: 0;
  font-weight: 600;
}

.brand p {
  margin: 2px 0 0;
  font-size: 12px;
  color: #c5d9ce;
}

.live {
  font-size: 12px;
  color: #c9f4d9;
  background: rgba(255,255,255,.12);
  border-radius: 30px;
  padding: 8px 13px;
}

main {
  max-width: 1200px;
  margin: auto;
  padding: 30px 20px 55px;
}

.welcome {
  margin-bottom: 23px;
}

.welcome h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}

.welcome p {
  margin: 5px 0 0;
  color: var(--muted);
  font-size: 13px;
}

.stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 25px;
}

.stat {
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 15px;
  padding: 19px 21px;
  box-shadow: var(--shadow);
}

.stat-label {
  color: var(--muted);
  font-size: 13px;
}

.stat-value {
  font-size: 30px;
  font-weight: 600;
  margin-top: 4px;
}

.stat-total { color: #344d40; }
.stat-occupied { color: var(--green); }
.stat-free { color: #89958e; }

.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 15px;
  margin: 28px 0 16px;
  flex-wrap: wrap;
}

.toolbar h3 {
  margin: 0;
  font-size: 18px;
}

.search {
  position: relative;
  width: min(420px, 100%);
}

.search input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 11px;
  padding: 13px 15px 13px 42px;
  background: white;
  font-family: inherit;
  font-size: 13px;
  outline: none;
}

.search input:focus {
  border-color: var(--green);
  box-shadow: 0 0 0 3px rgba(23,107,74,.09);
}

.search span {
  position: absolute;
  left: 14px;
  top: 10px;
  font-size: 18px;
}

#status {
  color: var(--muted);
  font-size: 12px;
  margin: 0 0 14px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(245px, 1fr));
  gap: 17px;
}

.slot {
  background: white;
  border: 1px solid var(--line);
  border-radius: 15px;
  overflow: hidden;
  box-shadow: var(--shadow);
  transition: transform .18s, box-shadow .18s;
}

.slot:hover {
  transform: translateY(-3px);
  box-shadow: 0 9px 25px rgba(20,50,35,.09);
}

.slot-head {
  padding: 13px 15px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--line);
}

.slot-id {
  font-size: 14px;
  font-weight: 600;
}

.state {
  border-radius: 30px;
  padding: 4px 10px;
  font-size: 11px;
}

.state.occupied {
  color: var(--green);
  background: var(--green-light);
}

.state.free {
  color: #77827c;
  background: #f0f2f0;
}

.slot img {
  width: 100%;
  height: 165px;
  object-fit: contain;
  background: #f1f4f2;
  display: block;
}

.no-image {
  height: 165px;
  background: #f1f4f2;
  display: grid;
  place-items: center;
  color: #9aa69f;
  font-size: 13px;
}

.slot-body {
  padding: 15px;
}

.plate {
  font-size: 22px;
  font-weight: 600;
  letter-spacing: .5px;
}

.province {
  color: var(--green);
  font-size: 13px;
  margin-top: 2px;
}

.meta {
  color: var(--muted);
  font-size: 11px;
  margin-top: 11px;
}

.empty {
  grid-column: 1 / -1;
  text-align: center;
  padding: 55px 15px;
  background: white;
  border: 1px dashed #cbd7cf;
  border-radius: 15px;
  color: var(--muted);
}

footer {
  text-align: center;
  color: #9aa69f;
  font-size: 11px;
  padding: 25px;
}

@media(max-width: 600px) {
  main { padding: 23px 14px 40px; }
  .stats { gap: 9px; }
  .stat { padding: 13px 11px; }
  .stat-value { font-size: 24px; }
  .stat-label { font-size: 11px; }
  .welcome h2 { font-size: 21px; }
  .header-inner { align-items: flex-start; }
}
</style>
</head>

<body>
<header>
  <div class="header-inner">
    <div class="brand">
      <div class="brand-icon">P</div>
      <div>
        <h1>Parking System</h1>
        <p>Smart Parking Management</p>
      </div>
    </div>
    <div class="live">● LIVE MONITORING</div>
  </div>
</header>

<main>
  <section class="welcome">
    <h2>ภาพรวมลานจอดรถ</h2>
  </section>

  <section class="stats">
    <div class="stat">
      <div class="stat-label">ช่องจอดทั้งหมด</div>
      <div class="stat-value stat-total" id="total">0</div>
    </div>
    <div class="stat">
      <div class="stat-label">มีรถจอด</div>
      <div class="stat-value stat-occupied" id="occupied">0</div>
    </div>
    <div class="stat">
      <div class="stat-label">ช่องว่าง</div>
      <div class="stat-value stat-free" id="free">0</div>
    </div>
  </section>

  <section class="toolbar">
    <h3>สถานะช่องจอด</h3>
    <div class="search">
      <span>⌕</span>
      <input id="q" type="search"
        placeholder="ค้นหาทะเบียนรถ หรือจังหวัด..."
        autocomplete="off">
    </div>
  </section>

  <div id="status">กำลังโหลดข้อมูล...</div>
  <section class="grid" id="grid"></section>
</main>

<footer>Smart Parking Management System</footer>

<script>
const q = document.getElementById('q');
const grid = document.getElementById('grid');
const statusEl = document.getElementById('status');

let timer = null;
let loading = false;

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;',
    '"':'&quot;', "'":'&#39;'
  })[c]);
}

function card(s) {
  const id = escapeHTML(s.slot_id);
  if (!s.occupied) {
    return `
      <article class="slot">
        <div class="slot-head">
          <span class="slot-id">${id}</span>
          <span class="state free">ว่าง</span>
        </div>
        <div class="no-image">ไม่มีรถจอด</div>
        <div class="slot-body">
          <div class="meta">ช่องจอดพร้อมใช้งาน</div>
        </div>
      </article>`;
  }

  const plate = escapeHTML(s.plate || 'ไม่พบทะเบียน');
  const province = escapeHTML(s.province || 'ยังไม่ทราบจังหวัด');
  const image = s.image_url
    ? `<img src="${encodeURI(s.image_url)}" alt="ภาพทะเบียน"
         onerror="this.outerHTML='<div class=&quot;no-image&quot;>ไม่พบรูปภาพ</div>'">`
    : `<div class="no-image">ไม่มีภาพบันทึก</div>`;

  return `
    <article class="slot">
      <div class="slot-head">
        <span class="slot-id">${id}</span>
        <span class="state occupied">มีรถจอด</span>
      </div>
      ${image}
      <div class="slot-body">
        <div class="plate">${plate}</div>
        <div class="province">${province}</div>
        <div class="meta">เริ่มจอด ${escapeHTML(s.parked_since || '-')}</div>
      </div>
    </article>`;
}

async function load() {
  if (loading) return;
  loading = true;

  try {
    const res = await fetch('/api/slots?q=' + encodeURIComponent(q.value));
    if (!res.ok) throw new Error('API error');

    const slots = await res.json();

    // สถิติอ้างอิงทุกช่อง ไม่ใช่เฉพาะผลการค้นหา
    if (!q.value.trim()) {
      document.getElementById('total').textContent = slots.length;
      document.getElementById('occupied').textContent =
        slots.filter(s => s.occupied).length;
      document.getElementById('free').textContent =
        slots.filter(s => !s.occupied).length;
    }

    const occupiedSlots = slots.filter(s => s.occupied).length;

    if (q.value.trim()) {
      statusEl.textContent = slots.length
        ? `พบ ${occupiedSlots} ช่องที่มีรถตรงกับคำค้นหา`
        : 'ไม่พบรถที่ตรงกับคำค้นหา';
    } else {
      statusEl.textContent =
        `แสดงช่องจอดทั้งหมด ${slots.length} ช่อง`;
    }

    grid.innerHTML = slots.length
      ? slots.map(card).join('')
      : '<div class="empty">ไม่พบข้อมูลที่ตรงกับการค้นหา</div>';

  } catch (e) {
    statusEl.textContent = 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้';
  } finally {
    loading = false;
  }
}

q.addEventListener('input', () => {
  clearTimeout(timer);
  timer = setTimeout(load, 300);
});

setInterval(load, 3000);
load();
</script>
</body>
</html>
"""

 
 
@app.get("/", response_class=HTMLResponse)
def home():
    return FileResponse(os.path.join(WEB_DIR, "index.html"))


@app.get("/admin.html", response_class=HTMLResponse)
def admin_page():
    return FileResponse(os.path.join(WEB_DIR, "admin.html"))
 
 
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)