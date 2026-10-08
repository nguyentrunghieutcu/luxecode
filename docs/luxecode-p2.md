# LuxeCode P2 — 9router Gateway MVP

Triển khai ngày **07/10/2026**, macOS local + OpenCode. Báo cáo này mô tả phần code và kiểm tra local; không thay bằng chứng P1 bằng tuyên bố nghiệm thu upstream mới.

## Sử dụng

1. Trong 9router, kết nối tài khoản upstream, bật **Require API Key**, tạo key dành cho LuxeCode và tạo combo hỗ trợ tool calls nếu muốn.
2. Trong LuxeCode mở **Settings → Providers → 9router gateway**. OpenCode phải đạt **1.18.35+**; bản 1.18.35 là baseline isolation đã kiểm tra ở P1. Nếu chưa cài, cài engine bên ngoài app hoặc đặt CLI path rồi chọn **Recheck OpenCode**.
3. Nhập endpoint, ví dụ `http://127.0.0.1:20128/v1`, và key. Chọn **Test connection & load models/combos**.
4. Chọn ID model/combo nguyên bản từ catalog. Nhập context/output limits đã xác minh; không tự đoán limits khi catalog không cung cấp. Với combo dùng limits an toàn cho mọi tuyến có thể được chọn.
5. Chọn **Save & use through OpenCode**, rồi tạo conversation OpenCode mới. Các kết nối cũng xuất hiện trong model picker, nhóm **9router · tên kết nối**.
6. Đổi key bằng **Replace key**, rồi restart app/session khi lượt hiện tại kết thúc. Endpoint/model/limits bất biến: tạo profile mới để thay đổi, không đổi route của session cũ.

Không cần login upstream riêng trong OpenCode cho đường gateway. Chỉ hỗ trợ gateway qua OpenCode local; không thêm harness 9router và không thay cấu hình Codex/Claude Code. Các model OpenCode khác vẫn là **direct**. Nếu muốn chuyển direct/gateway hoặc đổi profile, tạo conversation mới.

## Lưu trữ và cách ly

- Profile metadata trong app data `gateway-profiles/<UUID>.json`; không chứa secret. File được ghi qua temporary + rename, quyền 0600 trên macOS.
- Key nằm trong macOS Keychain, service `com.luxecode.desktop.9router`, account UUID. Renderer chỉ nhận metadata; ô key không dùng React state/localStorage và được xóa sau khi lưu/đổi key. Key không xuất qua command-line argument.
- Model session chứa `opencode:luxecode-<UUID>/<requested-model-or-combo>`, chính là profile reference không bí mật đã persist qua session model hiện có. Restore giữ nguyên ID kể cả khi catalog chưa tải hoặc profile thiếu; không thay bằng model direct.
- Native lấy profile/key, xác minh engine và probe gateway trước spawn. Main model và small model dùng cùng connection. Title của session nhận model đã chọn; text/Git phụ không có session riêng sử dụng lựa chọn OpenCode mặc định của người dùng.
- Mỗi profile có XDG config/data/cache/state và OpenCode home riêng. Native xóa override config/auth/DB/TUI kế thừa, disable project config và chỉ enable provider UUID tương ứng. OpenCode bên ngoài LuxeCode không bị sửa.
- Key rotation giữ UUID/runtime database. Các engine đang chạy giữ key cũ đến restart; không ngắt lượt hay replay công cụ tự động.
- Gateway lỗi, key mất/Keychain khóa, profile thiếu, engine cũ hoặc model biến mất đều báo lỗi; không fallback direct.
- Native HTTP: HTTPS ngoài loopback; không userinfo/query/fragment; không theo redirect; timeout và giới hạn payload. Probe `{}` không inference: request không key phải trả 401/403, có key phải trả 400 `Missing model`, rồi đọc `/models`.
- Tên model/combo là **requested route**, không chứng minh actual upstream model, chi phí hoặc provenance. Không hiển thị các giá trị suy đoán.

Hai biến POC `LUXECODE_GATEWAY_PROFILE` / `LUXECODE_9ROUTER_API_KEY` không còn kích hoạt gateway trong desktop P2. `gateway-check` và script acceptance P1 vẫn phục vụ test fixture/POC riêng. Launcher chuyển người dùng sang Settings; không đọc/import key POC tự động.

Session POC cũ có model `opencode:luxecode/<model>` được giữ nguyên khi restore nhưng chặn chạy với hướng dẫn migration; không fuzzy-match sang route khác hoặc fallback direct. Tạo kết nối trong Settings và conversation mới để dùng P2.

## Contract card LuxeCode trong 9router CLI Tools

Card là client integration, không phải provider: tên **LuxeCode**, engine **OpenCode local**, endpoint `/v1`, key riêng, ID model/combo nguyên bản và Manual Config với hướng dẫn Settings ở trên. Key nhập riêng; không dùng URL/deep link/query hay export profile chứa secret. Context/output limits phải xác minh cho tuyến đã chọn. Không chỉnh sửa hay phân phối 9router trong thay đổi này; card upstream không chặn MVP.

## Kiểm tra và giới hạn

- Kiểm tra local ngày 07/10/2026: 4.728 frontend tests đạt (13 skipped), TypeScript đạt; 572 native tests đạt. P1 fixture acceptance qua OpenCode 1.18.35 đạt với 24 inference requests vào fixture, không gọi provider thật. Regression bổ sung xác minh session POC/malformed restore không làm lỗi startup và không chạy direct.
- Tests native: endpoint/auth/catalog/redirect, profile round-trip và quyền file, ID traversal, không secret inline, version gate, isolation giữa hai profile, main/small model cùng route, direct không nhận key.
- Tests frontend: onboarding combo, limits bắt buộc khi unknown, lỗi auth, engine thiếu, xóa key khỏi form, rotation, mapping ID, restore không fallback, pin profile khi spawn, chặn đổi route trong session đang chạy hoặc đã park, text phụ qua cùng profile.
- Keychain dùng API Security.framework trong dependency đã có trong lockfile, không chạy `security -w <secret>`. Test native Keychain trên máy macOS đã đạt: lưu/đọc/đổi key giả với UUID riêng, xóa sau kiểm tra và xác minh missing-key fail-closed. Nghiệm thu UI với key thật, restart release app và quyền Keychain sau ký/phát hành vẫn cần người dùng thực hiện; không tự đọc key 9router hay gọi inference thật để kiểm tra.
- Gateway profile MVP chỉ local/macOS. Không export/import secrets, không xóa profile đang được session tham chiếu và không hỗ trợ sửa route tại chỗ. Không thay phiên bản 9router/engine, tự cài engine hay sửa global CLI config.
- P3 interrupted-turn/fault injection và P0 release signature/update gates vẫn theo roadmap, không được coi là hoàn tất bởi P2.
