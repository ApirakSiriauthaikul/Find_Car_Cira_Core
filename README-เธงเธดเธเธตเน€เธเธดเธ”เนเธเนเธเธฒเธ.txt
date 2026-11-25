วิธีเปิดใช้งาน Parking UI

1) แตกไฟล์ ZIP นี้
2) วางโฟลเดอร์ web ไว้ในโฟลเดอร์เดียวกับ server.py (ใน ZIP จัดไว้ให้แล้ว)
3) เปิด Terminal ที่โฟลเดอร์ที่มี server.py
4) ติดตั้งครั้งแรก: python -m pip install fastapi uvicorn
5) รัน: python server.py
6) เปิดหน้า User: http://127.0.0.1:8000/
7) เปิดหน้า Admin: http://127.0.0.1:8000/admin.html

หมายเหตุ:
- เปิดผ่านพอร์ต 8000 ของ FastAPI ไม่ใช้ Live Server (5500) เพราะ API ต้องอยู่โดเมน/พอร์ตเดียวกัน
- API /api/seen และ /api/slots รวมถึงการบันทึกรูปใน /images ยังคงอยู่ใน server.py
- รูปจาก Cira Core ที่ส่งเข้า POST /api/seen พร้อม image_b64 จะยังถูกบันทึกและแสดงในหน้า User/Admin
- อย่าปิด Terminal ขณะใช้งาน Server
