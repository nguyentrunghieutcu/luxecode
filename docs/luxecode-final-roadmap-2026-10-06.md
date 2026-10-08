# LuxeCode — Final Roadmap

Ngày chốt: **06/10/2026**, giờ Việt Nam. Trạng thái: **kế hoạch triển khai**, chưa phải danh sách tính năng đã hoàn tất.

Cập nhật triển khai **07/10/2026**: xem [báo cáo P0–P1](luxecode-p0-p1.md) để phân biệt phần đã kiểm tra local/fixture với nghiệm thu model thật và release gates còn lại.

P2 đã có implementation gateway Settings + Keychain + model/combo picker + session profile isolation; xem [báo cáo P2 và hướng dẫn sử dụng](luxecode-p2.md). Nghiệm thu key thật/restart release và release gates chưa được thay bằng kết quả unit/fixture.

Tài liệu này thay phần định hướng và thứ tự roadmap của báo cáo `luxecode-review-roadmap-9router-2026-10-03.md`. Giữ báo cáo cũ làm bằng chứng audit; kết quả kiểm tra ngày 03/10/2026 không được coi là kết quả kiểm tra của các thay đổi tương lai.

## 1. Định vị và mục tiêu

**LuxeCode: giao việc cho AI, kiểm soát quá trình, nhận kết quả có bằng chứng.**

Khách hàng đầu tiên: developer cá nhân và nhóm nhỏ đang dùng coding agent. Chọn macOS local + OpenCode làm ma trận MVP đầu tiên; mở rộng OS và engine sau khi có bằng chứng tương thích.

Trải nghiệm mục tiêu:

1. Người dùng kết nối provider tại 9router bằng OAuth hoặc API key, tùy provider được hỗ trợ.
2. Trong LuxeCode, nhập endpoint và API key của 9router, kiểm tra kết nối, chọn model/combo.
3. LuxeCode kiểm tra OpenCode đã được cài; nếu thiếu, hướng dẫn cài, không tự tải/chạy binary chưa được duyệt.
4. Giao task có tiêu chí nghiệm thu; xem diff và bằng chứng kiểm tra trước khi quyết định chấp nhận kết quả.

**Không cần đăng nhập upstream riêng trong OpenCode khi đường custom provider qua 9router đã được nghiệm thu.** Vẫn cần API key của gateway và engine thực thi công cụ. Không hứa chỉ đăng nhập 9router là dùng được mọi harness. OpenCode chạy model Claude không đồng nghĩa chạy Claude Code.

## 2. Kiến trúc đã chốt

```text
LuxeCode UI
    → Native: tra profile, lấy secret, kiểm tra endpoint
    → OpenCode engine qua harness adapter hiện có
        → 9router độc lập → Provider/model upstream
        → Files / shell / MCP / approvals theo khả năng engine
    ← Session events / diff / bằng chứng kiểm tra
```

| Thành phần | Trách nhiệm                                                                                                   | Không làm                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| LuxeCode   | Workspace, task, session, permissions, diff/review, bằng chứng và usage quan sát được                         | Không tự xây agent loop hoặc giữ token đăng nhập upstream        |
| OpenCode   | Agent loop và thực thi công cụ; giữ lifecycle qua adapter hiện có                                             | Không đăng nhập upstream lần nữa trong luồng gateway đã cấu hình |
| 9router    | Provider credentials, model routing, combo/fallback và usage phía model theo khả năng phiên bản đã nghiệm thu | Không thay thế engine, sandbox, approvals hoặc session restore   |

Tái sử dụng `HarnessAdapter`, registry, session lifecycle, diff/worktree và orchestration của MonoCode. Chỉ bổ sung phần thiếu để phục vụ luồng đã chọn; không tạo harness tên `9router`, không viết lại runtime, không refactor toàn bộ `App.tsx` trước POC.

9router chạy như dịch vụ độc lập do người dùng quản lý trong MVP. Không nhúng dashboard/server vào bundle LuxeCode. Direct mode hiện có được giữ riêng; gateway lỗi không được tự chuyển sang direct.

## 3. Phạm vi MVP

### A. Kết nối gateway trong LuxeCode — bắt buộc

- Một profile gồm endpoint, secret reference và model/combo; engine MVP cố định là OpenCode.
- Native test connection và lấy catalog; launch, catalog và các lệnh sinh văn bản phụ dùng cùng profile khi chọn gateway.
- Profile được cấp riêng cho process/session; không sửa config CLI toàn cục và không làm đổi hành vi OpenCode chạy ngoài LuxeCode.
- Session lưu profile ID và metadata cần tái lập, không lưu key trong transcript hoặc task.
- Hiển thị lỗi auth, gateway chưa chạy, model không tương thích và engine chưa cài với hành động khắc phục rõ.

### B. Mục LuxeCode trong 9router CLI Tools — tiện ích onboarding

Đây là **client integration**, không phải provider model mới.

Nội dung card: LuxeCode, endpoint, key riêng cho client, model/combo, hướng dẫn engine OpenCode và Manual Config. MVP kết nối được bằng màn Settings của LuxeCode ngay cả khi card chưa tồn tại.

Triển khai card sau khi contract cấu hình phía LuxeCode đã được nghiệm thu. Chỉ thêm thao tác Apply khi có cơ chế nhận cấu hình được xác thực và người dùng duyệt; không dùng nút Apply OpenCode hiện tại để sửa config toàn cục thay cho tích hợp riêng.

Nếu cần thay đổi 9router, dùng fork/PR riêng được cho phép và kiểm thử trên phiên bản pin. Việc upstream có nhận PR hay không không được chặn MVP. Không đưa secret vào URL/deep link hoặc file export; profile export chỉ chứa thông tin không bí mật, key được nhập riêng.

### C. Task có bằng chứng — khác biệt sản phẩm ưu tiên

- Task có yêu cầu và checklist nghiệm thu do người dùng xác nhận; gắn với session hiện có, không tạo một workflow engine mới.
- Kết quả gồm diff, các kiểm tra đã chạy, exit status/kết quả, tiêu chí còn thiếu và việc cần người dùng quyết định.
- Phân biệt rõ: chưa kiểm tra, kiểm tra đạt, kiểm tra không đạt và người dùng đã chấp nhận. Câu trả lời “done” của agent không tự hoàn thành checklist.
- Bằng chứng phải gắn với checkout/revision hoặc trạng thái diff được kiểm tra; code thay đổi sau đó làm kết quả cũ cần xác minh lại.
- Không tự commit, merge, push hoặc chạy thao tác nhạy cảm ngoài permission mode và phê duyệt của người dùng.

## 4. Roadmap triển khai

Ước lượng cho một engineer hiểu TS/Rust, có QA hỗ trợ theo đợt. Tuần tính từ ngày bắt đầu triển khai, **không phải deadline cam kết**. Chỉ chuyển giai đoạn khi đạt điều kiện nghiệm thu; nếu thiếu thời gian, giảm scope, không bỏ kiểm tra bảo mật/độ tin cậy.

| Giai đoạn                     | Khoảng tham chiếu | Đầu ra                                                                                                                                | Điều kiện nghiệm thu                                                                                                                       |
| ----------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 — Fork độc lập             | Tuần 1            | Branding, bundle identifier, data directory/migration và desktop release riêng; không quảng bá remote trước khi host release sẵn sàng | Cài song song MonoCode không đụng dữ liệu; import có backup; nguồn update đúng và chữ ký kiểm tra được                                     |
| P1 — POC một luồng thật       | Tuần 2            | LuxeCode → OpenCode → 9router; pin cặp phiên bản engine/gateway; baseline không compression                                           | Một task đi qua read → edit → shell check → diff → follow-up → restart/resume; catalog/launch cùng profile; config CLI ngoài app không đổi |
| P2 — Gateway MVP              | Tuần 3–4          | Settings profile, native secret store, test connection, model/combo picker, trạng thái engine; chốt contract card LuxeCode            | Onboarding không cần login upstream trong OpenCode; lỗi có hướng xử lý; direct/gateway tách biệt; đổi key và restart hoạt động             |
| P3 — Kết quả có bằng chứng    | Tuần 5–6          | Task checklist, kết quả nghiệm thu, bằng chứng gắn với code; fault injection và kiểm soát interrupted turn                            | Không tự coi lời agent là kết quả đạt; khôi phục không mất draft/task metadata; stream đứt không tự replay thao tác ghi file/shell         |
| P4 — Reviewer và private beta | Tuần 7–8          | Người dùng gọi reviewer riêng bằng orchestration sẵn có; reviewer đối chiếu diff với yêu cầu; thử với 5–10 developer                  | Thu ít nhất 20 task thực đã được người dùng đánh giá; ghi cả task thất bại; phân biệt bằng chứng chạy kiểm tra với ý kiến reviewer         |
| P5 — Đo hiệu quả và chốt beta | Tuần 9–10+        | Usage/latency theo task, chi phí khi có dữ liệu, ngưỡng ngân sách đã kiểm chứng, sửa lỗi từ pilot và onboarding docs                  | Có baseline chất lượng/chi phí; dữ liệu thiếu hiển thị unknown; bộ acceptance MVP đạt; release beta không chứa secret trong log/export     |

Card LuxeCode có thể phát hành sau P2 khi phía 9router đã kiểm thử và được phép sửa/phân phối. Không trì hoãn task có bằng chứng hoặc beta chỉ để chờ card.

## 5. Bảo mật và độ tin cậy — release gates

- Gateway local bật yêu cầu API key; không public dashboard/API vô tình. Tạo key riêng cho LuxeCode nếu phiên bản đã nghiệm thu hỗ trợ; key riêng không tự bảo đảm tenant isolation.
- Lưu gateway key qua native secret store, ưu tiên OS keychain của hệ điều hành MVP. Không persist key trong renderer state, log, transcript, URL hoặc profile export.
- Endpoint loopback được phép HTTP; ngoài máy yêu cầu HTTPS. Từ chối userinfo, không bỏ TLS verification và không chuyển tiếp key qua redirect chưa được kiểm soát.
- Native nhận profile ID/các field đã kiểm tra, không nhận tùy ý một map env từ renderer. Không mở CSP thành wildcard để gọi gateway.
- Khi stream đứt sau partial output hoặc có tool đã thực thi, đánh dấu interrupted và yêu cầu quyết định resume/retry. Không tự replay toàn bộ task; tình trạng thực thi chưa rõ phải được báo rõ.
- Tận dụng receipts/metadata hiện có; kiểm thử mất kết nối trước/sau tool và sau khi ghi file. Không hứa exactly-once với mọi lệnh shell hoặc dịch vụ bên ngoài.
- Model/combo được yêu cầu và model thực chạy là hai thông tin khác nhau. Chỉ hiển thị provenance, tokens và cost khi có dữ liệu; không suy ra actual model từ tên combo.
- Ngân sách MVP chỉ chặn lượt/request mới khi dữ liệu đã quan sát vượt ngưỡng. Không quảng bá hard spending cap nếu chưa nghiệm thu enforcement phía gateway, concurrent requests và usage báo trễ; hành vi khi thiếu usage phải được công bố rõ.

## 6. Ma trận nghiệm thu tối thiểu

| Nhóm               | Ca bắt buộc                                                                       | Kết quả mong đợi                                                                                        |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Onboarding         | Máy sạch, engine thiếu, gateway tắt, key sai                                      | Hướng dẫn đúng; không đánh dấu kết nối thành công giả                                                   |
| Isolation          | Chạy CLI ngoài LuxeCode; hai session dùng profile khác nhau                       | Không sửa config người dùng; không lẫn key/model/profile                                                |
| Tool compatibility | Read/edit/shell, nhiều tool calls, approval accept/deny, cancel                   | Giữ tool ID/schema; quyền được thực thi; deny không chạy tool                                           |
| Faults             | 401, 429, 5xx, timeout, stream đứt, app/gateway restart                           | Lỗi rõ; không tự chuyển direct; không replay side effects chưa xác định                                 |
| Restore            | Draft, context metadata, task checklist, profile reference                        | Khôi phục đúng hoặc thông báo giới hạn, không âm thầm tạo session khác                                  |
| Evidence           | Test chưa chạy/thất bại; diff đổi sau test; reviewer nói đạt nhưng thiếu kiểm tra | Trạng thái không bị nâng thành đã nghiệm thu; bằng chứng cũ được đánh dấu cần xác minh                  |
| Secrets            | Logs, export, URL, key rotation, redirect                                         | Không lộ key; key cũ ngừng hoạt động theo cơ chế gateway đã nghiệm thu                                  |
| Budget/usage       | Usage thiếu hoặc trễ; vượt ngưỡng; fallback                                       | Unknown không biến thành 0; tuân thủ chính sách đã công bố; không hứa cap chính xác khi chưa chứng minh |

Mỗi lỗi phát hiện trong ma trận cần một regression check ở suite hiện có. Pin phiên bản đã nghiệm thu, kiểm tra lại trước khi nâng engine/gateway. Kết quả pass chỉ áp dụng cho ma trận đã chạy, không cho mọi model/harness.

## 7. Chỉ số quyết định tiếp tục mở rộng

Các con số dưới đây là mục tiêu pilot, chưa có baseline mới:

- Ít nhất 90% ca onboarding được hỗ trợ hoàn thành task đầu và xem diff trong 10 phút, tính từ khi engine/gateway đã sẵn sàng và có credential.
- Toàn bộ ca acceptance MVP đã liệt kê đạt trước beta; không có regression đã biết gây lộ secret, mất draft hoặc replay side effects trong ma trận.
- Thu ít nhất 20 task thực từ 5–10 developer; đo task được người dùng chấp nhận, số lượt sửa lại, thời gian hoàn thành và usage/cost quan sát được.
- So sánh gateway/direct trên cùng nhóm task và điều kiện ghi nhận được; không tuyên bố tiết kiệm từ giá token đơn lẻ hoặc từ task không đạt.

## 8. Sau MVP — chỉ mở khi có bằng chứng nhu cầu

1. **Context handoff có cấu trúc:** yêu cầu, quyết định, file/diff, kiểm tra và việc còn lại; không hứa chuyển nguyên trạng thái nội bộ giữa mọi engine.
2. **Codex rồi Claude Code qua gateway:** chỉ thêm sau compatibility spike và acceptance riêng; không xem có endpoint Responses/Messages là đủ bảo đảm fidelity hoặc bỏ được mọi bước login.
3. **Remote OpenCode:** endpoint được giải quyết trên máy host thực thi; loopback của desktop không phải loopback của host. Hoàn thiện host release/protocol, auth, secret storage và restore trước khi quảng bá remote parity.
4. **Route theo loại việc và budget enforcement mạnh hơn:** chỉ mở khi có dữ liệu chất lượng, actual usage/provenance và cơ chế enforcement được nghiệm thu.
5. **Gateway nhóm nhỏ:** chỉ khi nhu cầu lặp lại; bổ sung quyền, attribution, audit và backup/restore trước khi hứa isolation giữa người dùng.

Tạm hoãn IDE đầy đủ, marketplace, model/agent runtime tự viết, nhúng 9router, billing SaaS, tự động commit/merge/push và cam kết hỗ trợ gateway cho toàn bộ harness.

## 9. Điểm bắt đầu triển khai

**PR đầu tiên:** định danh và dữ liệu LuxeCode độc lập, có kiểm tra cài song song/import an toàn; giữ attribution/license upstream hiện có.

**PR tiếp theo:** POC profile riêng cho OpenCode qua 9router trên một project thử. Chỉ sau khi luồng này đạt nghiệm thu mới xây Settings đầy đủ và card LuxeCode trong 9router.

Không thay đổi runtime hoặc cấu hình provider chỉ để viết roadmap này. Không commit, tạo branch, sửa 9router hoặc kết nối tài khoản thật trong bước chốt tài liệu.
