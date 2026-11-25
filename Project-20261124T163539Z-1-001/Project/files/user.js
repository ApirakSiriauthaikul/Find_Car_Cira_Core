/* ===== หน้าค้นหา (index.html) ===== */
let cars = [], loaded = false, loading = false, lastOk = 0;
let result = null, current = null;

function showBanner(msg) {
  const b = $("banner");
  if (!msg) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = "<b>โหลดข้อมูลไม่สำเร็จ</b>" + esc(msg) + (loaded ? "<br>ข้อมูลที่เห็นอาจไม่ใช่ล่าสุด" : "") +
    '<br><button id="retryBtn">ลองใหม่</button>';
  $("retryBtn").onclick = loadCars;
}

function stamp() {
  $("stamp").textContent = !loaded ? (loading ? "กำลังโหลดข้อมูล…" : "ยังไม่มีข้อมูล")
    : "ข้อมูลล่าสุด " + new Date(lastOk).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) +
      " · รถในลาน " + cars.length + " คัน";
}

async function loadCars() {
  if (loading) return;
  loading = true; stamp();
  try {
    cars = await fetchCars();
    loaded = true; lastOk = Date.now(); showBanner("");
    if (current) {                                   // อัปเดตรถที่กำลังดูอยู่ให้ตรงกับข้อมูลใหม่
      const again = cars.find((c) => c.plate === current.plate);
      if (again) current = again; else { current = null; result = null; }
    }
  } catch (e) { showBanner(e.message); }
  loading = false; stamp(); renderOut();
}

/* วาดผลลัพธ์ทั้งหมดใต้ช่องค้นหา */
function renderOut() {
  if (!loaded) { $("out").innerHTML = ""; return; }
  let h = "";
  if (result && !result.hits.length)
    h += '<div class="card empty"><b>ไม่พบรถคันนี้</b>ตรวจป้ายทะเบียนอีกครั้ง หรือรถอาจเพิ่งเข้าจอดและระบบยังประมวลผลอยู่</div>';
  if (result && result.hits.length > 1 && !current) {
    h += '<div class="card"><p class="hint">พบ ' + result.hits.length + ' คัน เลือกคันของคุณ</p><ul class="list">' +
      result.hits.map((c, i) => '<li><div><span class="pl">' + esc(c.plate) + "</span><small>ชั้น " + c.floor + " ช่อง " + label(c) +
        '</small></div><button class="pick" data-pick="' + i + '">เลือก</button></li>').join("") + "</ul></div>";
  }
  if (current) {
    if (result && result.hits.length === 1 && result.note) h += '<p class="hint">' + esc(result.note) + "</p>";
    h += '<div class="card"><div class="sign"><div class="big"><span>ชั้น</span><b>' + current.floor + "</b></div>" +
      '<div class="det"><small>ป้าย ' + esc(current.plate) + "</small><strong>โซน " + esc(current.zone) + " ช่อง " + label(current) + "</strong>" +
      '<span class="chip">เข้าจอด ' + clock(current.at) + " · จอดมา " + ago(current.at) + "</span></div></div>" +
      (current.photo ? '<img class="photo" src="' + esc(current.photo) + '" alt="รูปรถหรือช่องจอด ป้าย ' + esc(current.plate) + '">' : "") + "</div>";
  }
  $("out").innerHTML = h;
}

function select(c) { current = c; }

async function search(raw) {
  if (!norm(raw)) return;
  $("searchBtn").disabled = true;
  await loadCars();                                  // ดึงข้อมูลล่าสุดก่อนค้นหาทุกครั้ง
  $("searchBtn").disabled = false;
  if (!loaded) return;
  result = findCars(cars, raw);
  if (result.hits.length === 1) select(result.hits[0]); else current = null;
  renderOut();
}

/* ===== ผูกปุ่มและเริ่มทำงาน ===== */
$("searchBtn").onclick = () => search($("q").value);
$("q").onkeydown = (e) => { if (e.key === "Enter") search($("q").value); };
$("out").onclick = (e) => {
  const pb = e.target.closest("[data-pick]");
  if (pb) { select(result.hits[+pb.dataset.pick]); renderOut(); }
};
loadCars();
setInterval(() => { if (!document.hidden) loadCars(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) loadCars(); });
