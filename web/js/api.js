/* ===== เรียก API (server.py) ===== */
async function api(path, opts = {}) {
  let res;
  try { res = await fetch(API_BASE + path, opts); }
  catch (e) { const err = new Error("เชื่อมต่อเซิร์ฟเวอร์ไม่ได้"); err.status = 0; throw err; }
  if (!res.ok) {
    let d = ""; try { d = (await res.json()).detail || ""; } catch (e) {}
    const err = new Error(d || "เซิร์ฟเวอร์ตอบกลับผิดพลาด (" + res.status + ")"); err.status = res.status; throw err;
  }
  return res.status === 204 ? null : res.json();
}
const authHeaders = (key) => ({ "Content-Type": "application/json", "Authorization": "Bearer " + key });

/* รถที่ยังจอดอยู่ทั้งหมด (ช่องว่างไม่เอา) */
async function fetchCars() {
  const rows = await api("/slots");
  return rows.filter((r) => r.occupied && r.plate).map(fromApi);
}
