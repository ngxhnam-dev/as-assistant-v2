# PROMPT: HE THONG AI ASSISTANT MASCOT (SPLIT-APP ARCHITECTURE)

## 1. Tong Quan Du An

Xay dung mot he thong AI Assistant gom 2 web app rieng biet chay tren 2 thiet bi khac nhau, ket noi thoi gian thuc qua nen tang trung gian nhu Pusher hoac Ably. Mascot la video animation co 3 trang thai, phan hoi bang giong noi ElevenLabs va tri tue nhan tao tu Dify RAG.

## 2. Cong Nghe Su Dung

- Frontend: React.js hoac Next.js (co the dung Vite neu tach app don gian)
- Realtime Communication: Pusher hoac Ably (WebSocket)
- AI Brain: Dify (RAG Workflow)
- Voice Synthesis: ElevenLabs API (Streaming mode)
- Mascot Media: 3 video clips (Idle, Thinking, Speaking)

## 3. Yeu Cau Chi Tiet Cho Tung Ung Dung

### Ung Dung 1: The Mascot (Display & Audio)

Vai tro: hien thi mascot, quan ly trang thai video va phat am thanh.

Chuc nang chinh:

- Video Layering: Chong 3 lop video (Idle, Thinking, Speaking) bang CSS absolute. Dieu khien an hien bang `opacity` de dam bao chuyen canh muot, khong bi flicker.
- Realtime Listener: Lang nghe tin hieu tu App 2 thong qua Pusher hoac Ably.
- Su kien `SET_THINKING`: chuyen sang video Thinking.
- Su kien `SEND_RESPONSE`: nhan text tra ve tu Dify.
- Audio Processing:
  - Khi nhan text, goi truc tiep API ElevenLabs.
  - Su dung co che streaming de phat am thanh ngay lap tuc.
- Auto-State Management:
  - Khi audio bat dau (`onPlay`): chuyen sang video Speaking.
  - Khi audio ket thuc (`onEnded`): tu dong chuyen ve video Idle.
- Giao dien: toi gian, chi hien thi mascot full man hinh. Co nut "Khoi dong" de kich hoat quyen phat audio cua trinh duyet.

### Ung Dung 2: The Controller (Input & Logic)

Vai tro: tiep nhan yeu cau cua nguoi dung va dieu phoi he thong.

Chuc nang chinh:

- Input UI: o nhap lieu (text chat) va nut ghi am (voice chat - su dung Web Speech API de chuyen voice sang text).
- Dify Integration: gui yeu cau cua nguoi dung toi Dify API.
- Signal Transmitter:
  - Ngay khi nguoi dung nhan gui: phat tin hieu `SET_THINKING` sang App 1.
  - Khi Dify tra ket qua: phat tin hieu `SEND_RESPONSE` kem noi dung text sang App 1.
- Giao dien: hien dai, hien thi khung chat de nguoi dung theo doi lich su tro chuyen.

## 4. Luong Du Lieu (Workflow)

1. User -> App 2: nhap cau hoi bang voice hoac text.
2. App 2 -> Pusher/Ably: ban su kien `SET_THINKING` de App 1 doi video.
3. App 2 -> Dify: goi API lay cau tra loi.
4. Dify -> App 2: tra ve ket qua van ban.
5. App 2 -> Pusher/Ably: ban su kien `SEND_RESPONSE` kem noi dung text.
6. App 1 -> ElevenLabs: chuyen van ban thanh tieng va phat audio.
7. App 1 UI: tu dong doi video sang Speaking, sau do quay ve Idle.

## 5. Yeu Cau Ky Thuat Quan Trong

- No lip-sync: khong can dong bo moi, chi can loop video Speaking khi co am thanh.
- Latency: uu tien toi uu toc do goi API va dung WebSockets de do tre duoi 1 giay.
- Cross-device: dam bao App 2 gui lenh thi App 1 thuc hien ngay lap tuc, ke ca khi o 2 mang khac nhau.
- Handle Interrupt: neu nguoi dung hoi cau moi khi App 1 dang noi, App 2 phai gui lenh `STOP_RESPONSE` de App 1 dung audio cu.

## 6. Yeu Cau Dau Ra Cho AI

Hay viet code mau cho:

- `App1.js`: xu ly video state, realtime listener, audio streaming, state transition
- `App2.js`: xu ly input, Dify API, Pusher/Ably event dispatch, interrupt flow
- CSS: huong dan cau hinh 3 lop video chong khit len nhau bang absolute positioning va opacity transition
