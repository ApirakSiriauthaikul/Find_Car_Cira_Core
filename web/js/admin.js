/* ===== หน้าแอดมิน (admin.html) ===== */
let cars = [], loaded = false, loading = false;
let adminKey = "", photoData = "";
try { adminKey = sessionStorage.getItem("adminKey") || ""; } catch (e) {}   // จำรหัสไว้จนกว่าจะปิดแท็บ

function saveKey(k) { adminKey = k; try { k ? sessionStorage.setItem("adminKey", k) : sessionStorage.removeItem("adminKey"); } catch (e) {} }
const authed = () => true;   // server.py ยังไม่มีระบบรหัสผ่าน จึงเข้าได้เลย (ดูหมายเหตุใน README)

function showAuth() {
  $("loginView").hidden = authed();
  $("panelView").hidden = !authed();
  if (authed()) renderAdmin();
}
function logout(msg) { saveKey(""); $("loginErr").textContent = msg || ""; showAuth(); }

/* (ไม่ได้ใช้แล้ว) ตรวจรหัสจริงโดยส่งคำสั่งลบป้ายสมมติ: 401/403 = รหัสผิด, 404 = รหัสถูก (ไม่มีป้ายนี้) */
async function login() {
  const key = $("pw").value;
  if (!key) return;
  $("loginBtn").disabled = true; $("loginErr").textContent = "";
  try {
    try { await api("/cars/" + encodeURIComponent("__auth_check__"), { method: "DELETE", headers: authHeaders(key) }); }
    catch (e) { if (e.status !== 404) throw e; }
    saveKey(key); $("pw").value = ""; showAuth();
  } catch (e) {
    $("loginErr").textContent = e.status === 401 || e.status === 403 ? "รหัสผ่านไม่ถูกต้อง ลองอีกครั้ง" : e.message;
  }
  $("loginBtn").disabled = false;
}

function say(text, bad) { const m = $("msg"); m.textContent = text; m.className = bad ? "err" : "okmsg"; }

function showBanner(msg) {
  const b = $("banner");
  if (!msg) { b.hidden = true; return; }
  b.hidden = false;
  b.innerHTML = "<b>โหลดข้อมูลไม่สำเร็จ</b>" + esc(msg) + '<br><button id="retryBtn">ลองใหม่</button>';
  $("retryBtn").onclick = loadCars;
}

async function loadCars() {
  if (loading) return;
  loading = true;
  try { cars = await fetchCars(); loaded = true; showBanner(""); }
  catch (e) { showBanner(e.message); }
  loading = false; renderAdmin();
}

function renderAdmin() {
  if (!authed() || !loaded) return;
  const sorted = [...cars].sort((a, b) => b.at - a.at);
  $("carList").innerHTML = sorted.length
    ? sorted.map((c) => '<li><div class="who">' +
        (c.photo ? '<img class="thumb" src="' + esc(c.photo) + '" alt="รูปรถ ' + esc(c.plate) + '" loading="lazy">' : "") +
        '<div><span class="pl">' + esc(c.plate) + "</span><small>ชั้น " + c.floor + " ช่อง " + label(c) +
        " · เข้า " + clock(c.at) + '</small></div></div><button class="del" data-del="' + esc(c.slot_id) + '" data-plate="' + esc(c.plate) + '">ลบ</button></li>').join("")
    : '<li class="empty"><div><b>ไม่มีรถจอดอยู่</b></div></li>';
}

/* เรียกคำสั่งเขียนข้อมูล แล้วโหลดรายการใหม่เสมอ */
async function write(fn, okText) {
  let ok = false;
  try { await fn(); say(okText, false); ok = true; }
  catch (e) {
    if (e.status === 401 || e.status === 403) return logout("รหัสผ่านไม่ถูกต้องหรือหมดสิทธิ์ กรุณาเข้าสู่ระบบใหม่");
    say(e.status === 409 ? "ป้ายหรือช่องจอดนี้มีในระบบแล้ว" : e.message, true);
  }
  await loadCars();
  return ok;
}

function clearPhoto() { photoData = ""; $("newPhoto").value = ""; $("preview").hidden = true; $("preview").removeAttribute("src"); }

async function pickPhoto() {
  const f = $("newPhoto").files[0];
  if (!f) return clearPhoto();
  try { photoData = await resizePhoto(f); $("preview").src = photoData; $("preview").hidden = false; say("", false); }
  catch (e) { clearPhoto(); say(e.message, true); }
}

async function addNew() {
  const p = $("newPlate").value.trim().replace(/\s+/g, " ");
  const f = +$("newFloor").value, z = $("newZone").value, s = +$("newSlot").value;
  const pos = "ชั้น " + f + " ช่อง " + z + f + "-" + s;
  if (p.length < 3) return say("กรอกป้ายทะเบียนอย่างน้อย 3 ตัวอักษร", true);
  if (cars.some((c) => norm(c.plate) === norm(p))) return say("มีป้ายนี้ในระบบแล้ว ลบรายการเดิมก่อนจึงจะเพิ่มใหม่ได้", true);
  if (cars.some((c) => c.floor === f && c.zone === z && c.slot === s)) return say(pos + " มีรถจอดอยู่แล้ว เลือกช่องอื่น", true);
  $("addBtn").disabled = true;
  const ok = await write(() => api("/seen", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ slot_id: z + f + "-" + s, plate: p, province: "", confidence: 1,
      image_b64: photoData ? photoData.split(",")[1] : null }) }), "เพิ่มรถ " + p + " ที่" + pos + " แล้ว");
  if (ok) { $("newPlate").value = ""; clearPhoto(); }
  $("addBtn").disabled = false;
}

/* ===== ผูกปุ่มและเริ่มทำงาน ===== */
$("newFloor").innerHTML = FLOORS.map((f) => '<option value="' + f + '">ชั้น ' + f + "</option>").join("");
$("newZone").innerHTML = ZONES.map((z) => '<option value="' + esc(z) + '">โซน ' + esc(z) + "</option>").join("");
$("newSlot").innerHTML = Array.from({ length: SLOTS }, (_, i) => '<option value="' + (i + 1) + '">ช่อง ' + (i + 1) + "</option>").join("");

$("loginBtn").onclick = login;
$("pw").onkeydown = (e) => { if (e.key === "Enter") login(); };
$("logoutBtn").onclick = () => logout();
$("reloadBtn").onclick = loadCars;
$("addBtn").onclick = addNew;
$("newPhoto").onchange = pickPhoto;
$("newPlate").onkeydown = (e) => { if (e.key === "Enter") addNew(); };
$("carList").onclick = (e) => {
  const b = e.target.closest("[data-del]");
  if (!b) return;
  const plate = b.dataset.plate, sid = b.dataset.del;
  if (!confirm("เคลียร์ช่อง " + sid + " (รถ " + plate + ")?")) return;
  b.disabled = true;
  write(() => api("/slots/" + encodeURIComponent(sid) + "/clear", { method: "POST" }), "เคลียร์ช่อง " + sid + " แล้ว");
};

showAuth();
loadCars();
setInterval(() => { if (!document.hidden) loadCars(); }, REFRESH_MS);
