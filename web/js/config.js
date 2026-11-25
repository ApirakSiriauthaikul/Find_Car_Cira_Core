/* ===== ตั้งค่า: แก้ที่ไฟล์นี้ไฟล์เดียว =====

   API_BASE = ที่อยู่ API ที่ต่อกับ database เช่น "https://api.example.com"
              ถ้าอยู่โดเมนเดียวกับหน้าเว็บใส่ "/api" ได้

   รูปแบบ API ที่หน้าเว็บคาดหวัง
     GET    {API_BASE}/cars          -> [{ plate, floor, zone, slot, at, photo }, ...]
     POST   {API_BASE}/cars          body JSON {plate,floor,zone,slot,photo} -> 201 | 409 ถ้าป้ายหรือช่องซ้ำ
     DELETE {API_BASE}/cars/{plate}  -> 204
   photo = รูปถ่าย เป็น data URL (data:image/jpeg;base64,...) หรือ URL https ของรูป (ไม่บังคับ)
   POST/DELETE ส่ง header  Authorization: Bearer <รหัสผ่านแอดมิน>  (401/403 = รหัสผิด) */
const API_BASE = "/api";   // เว็บเสิร์ฟจาก server.py ตัวเดียวกัน จึงใช้ /api ได้เลย

const REFRESH_MS = 30000;               // โหลดข้อมูลใหม่ทุกกี่ ms
const ZONES = ["A"];                    // โซนในแต่ละชั้น (ช่อง A1-1 = โซน A ชั้น 1 ช่อง 1)
const SLOTS = 4;                        // จำนวนช่องต่อโซน
const FLOORS = [1];                     // ชั้นที่มี

/* แปลงแถวจาก GET /api/slots ให้เป็นรูปแบบที่หน้าเว็บใช้
   slot_id "A1-3" = โซน A, ชั้น 1, ช่อง 3
   เซิร์ฟเวอร์ส่ง parked_at (epoch วินาที) มาให้ ถ้าไม่มีจะคำนวณจาก parked_since (HH:MM:SS ของวันนี้) */
const SLOT_ID_RE = /^([A-Za-z]+)(\d+)-(\d+)$/;
const fromApi = (r) => {
  const m = SLOT_ID_RE.exec(r.slot_id || "") || [];
  let at = typeof r.parked_at === "number" ? r.parked_at * 1000 : NaN;
  if (isNaN(at) && r.parked_since) {
    const [h, mi, sec] = r.parked_since.split(":").map(Number), d = new Date();
    d.setHours(h, mi, sec || 0, 0);
    at = d.getTime() > Date.now() ? d.getTime() - 86400000 : d.getTime();
  }
  return {
    slot_id: String(r.slot_id),
    plate: String(r.plate),
    province: r.province || "",
    zone: m[1] || String(r.slot_id),
    floor: Number(m[2]) || 1,
    slot: Number(m[3]) || 0,
    at: at,
    photo: /^\/images\/[\w.\-]+$/.test(r.image_url || "") ? r.image_url : ""   // รับเฉพาะรูปจากเซิร์ฟเวอร์เรา
  };
};
