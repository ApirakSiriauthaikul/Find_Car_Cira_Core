/* ===== ฟังก์ชันช่วยที่ใช้ร่วมกัน (ไม่ยุ่งกับหน้าจอ) ===== */
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => s.replace(/[\s-]/g, "").toLowerCase();
const label = (c) => c.slot_id || (c.zone + "-" + c.slot);
const clock = (t) => new Date(t).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" });
function ago(t) {
  const m = Math.max(1, Math.round((Date.now() - t) / 60000));
  return m < 60 ? m + " นาที" : Math.floor(m / 60) + " ชม. " + (m % 60) + " นาที";
}

/* ระยะห่างระหว่างสองข้อความ ใช้หาป้ายที่อ่านผิดไป 1 ตัว */
function dist(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/* ค้นหา: ตรงทั้งป้าย -> มีข้อความนั้นอยู่ในป้าย (3 ตัวขึ้นไป) -> ใกล้เคียง (ผิด 1 ตัว) */
function findCars(cars, raw) {
  const q = norm(raw);
  let hits = cars.filter((c) => norm(c.plate) === q), note = "";
  if (!hits.length && q.length >= 2) hits = cars.filter((c) => norm(c.province || "").includes(q));   // ค้นด้วยจังหวัด
  if (!hits.length && q.length >= 3) hits = cars.filter((c) => norm(c.plate).includes(q));
  if (!hits.length && q.length >= 4) {
    hits = cars.filter((c) => dist(norm(c.plate), q) <= 1);
    if (hits.length) note = "ไม่พบป้ายที่ตรงกันพอดี นี่คือป้ายที่ใกล้เคียง";
  }
  return { hits, note };
}

/* ย่อรูปที่เลือกให้ด้านยาวไม่เกิน max px แล้วแปลงเป็น data URL (JPEG) เพื่อให้ส่งขึ้นเซิร์ฟเวอร์ได้เร็ว */
function resizePhoto(file, max = 800) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.75));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("เปิดไฟล์รูปนี้ไม่ได้ ลองเลือกรูปอื่น")); };
    img.src = url;
  });
}
