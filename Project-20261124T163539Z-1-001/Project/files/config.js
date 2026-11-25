/* ===== ตั้งค่า: แก้ที่ไฟล์นี้ไฟล์เดียว =====

   API_BASE = ที่อยู่ API ที่ต่อกับ database เช่น "https://api.example.com"
              ถ้าอยู่โดเมนเดียวกับหน้าเว็บใส่ "/api" ได้

   รูปแบบ API ที่หน้าเว็บคาดหวัง
     GET    {API_BASE}/cars          -> [{ plate, floor, zone, slot, at, photo }, ...]
     POST   {API_BASE}/cars          body JSON {plate,floor,zone,slot,photo} -> 201 | 409 ถ้าป้ายหรือช่องซ้ำ
     DELETE {API_BASE}/cars/{plate}  -> 204
   photo = รูปถ่าย เป็น data URL (data:image/jpeg;base64,...) หรือ URL https ของรูป (ไม่บังคับ)
   POST/DELETE ส่ง header  Authorization: Bearer <รหัสผ่านแอดมิน>  (401/403 = รหัสผิด) */
const API_BASE = "";

const REFRESH_MS = 30000;               // โหลดข้อมูลใหม่ทุกกี่ ms
const ZONES = ["A", "B"];               // โซนในแต่ละชั้น
const SLOTS = 10;                       // จำนวนช่องต่อโซน
const FLOORS = [1, 2, 3, 4];            // ชั้นที่มี

/* แปลงแถวจาก API ให้เป็นรูปแบบที่หน้าเว็บใช้ ถ้าชื่อ field ใน database ต่างไป แก้ตรงนี้ที่เดียว
   at = เวลาเข้าจอด (ISO string หรือ ms) */
const fromApi = (r) => ({
  plate: String(r.plate),
  floor: Number(r.floor),
  zone: String(r.zone),
  slot: Number(r.slot),
  at: typeof r.at === "number" ? r.at : Date.parse(r.at),
  photo: /^(data:image\/|https?:\/\/)/i.test(r.photo || "") ? String(r.photo) : ""   // รับเฉพาะรูปที่ปลอดภัย
});
