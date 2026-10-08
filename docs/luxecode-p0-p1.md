# LuxeCode P0–P1

**P2 supersedes desktop activation:** bản desktop P2 dùng Settings + macOS Keychain, không kích hoạt gateway qua environment POC nữa. Xem [hướng dẫn P2](luxecode-p2.md); các lệnh POC bên dưới giữ làm lịch sử/fixture acceptance, không phải onboarding desktop hiện tại.

Ngày triển khai: 07/10/2026. Nhánh: `sync/monocode-0.8.0`. Upstream: MonoCode `v0.8.0`, commit `9ccfc094615aa3170c01ae77a44298aefacdc9de`.

Trạng thái: đã triển khai nền tảng P0 và P1 POC; native engine và GUI local đã qua nghiệm thu với model thật qua 9router ngày 07/10/2026. GUI Supervised Allow/Deny, Stop khi command đang chạy, lỗi ngắt partial stream và reconnect trong cùng hội thoại đã đạt. Chưa nghiệm thu GUI riêng cho từng HTTP 401/429/5xx/timeout, combo fidelity, remote parity hoặc phát hành bản ký; không đánh dấu toàn bộ release gates là đã đạt.

## P0 — Fork độc lập

- Đồng bộ tag chính xác bằng fast-forward trên nhánh riêng; không thay đổi `main` hoặc push.
- Desktop/package/executable: LuxeCode / `luxecode-desktop` / `luxecode`.
- Bundle identifier: `com.luxecode.desktop`; macOS app data: `~/Library/Application Support/com.luxecode.desktop`.
- Host artifact/service/data: `luxecode-host`, `com.luxecode.host`, `~/.luxecode-host`; không dùng service/data của MonoCode.
- Host downloads, updater fallback và build artifacts hướng tới repository LuxeCode. Release workflow vẫn yêu cầu signing key/endpoint riêng; không sử dụng feed hoặc public key upstream.
- Icon/logo dùng bộ ảnh LuxeCode-iOS-macOS do người dùng cung cấp: giữ ICNS macOS gốc, export PNG RGBA cho Tauri và compile lại Assets.car từ nguồn chưa bo góc; giữ MIT license và attribution của upstream.
- Giữ Rust library `monocode_lib`, các wire contracts, tên `monocode.db` và storage keys hiện có để giảm conflict và giữ khả năng import. Chúng nằm trong data directory/origin riêng của ứng dụng.

### Import dữ liệu — opt-in, không tự chạy

Quit cả MonoCode và LuxeCode. Thực hiện **trước lần chạy LuxeCode đầu tiên**, khi data directory đích chưa tồn tại:

```bash
python3 scripts/import-monocode-data.py \
  "$HOME/Library/Application Support/com.monocode.desktop" \
  "$HOME/Library/Application Support/com.luxecode.desktop"
```

Script sao chép sang thư mục riêng; dùng SQLite backup để xử lý WAL và kiểm tra integrity trước khi chuyển dữ liệu. Không sửa/xóa nguồn, không ghi đè đích có sẵn, từ chối symlink dùng chung, đặt quyền directory/file 0700/0600. Nguồn còn nguyên cũng là bản quay lui; giữ thêm backup bên ngoài trước khi import dữ liệu quan trọng.

Import chỉ bao gồm native app data directory. Không tự chuyển WebKit/browser storage bên ngoài thư mục này hoặc OS Keychain; một số account có thể cần đăng nhập lại. Không tự viết lại các đường dẫn tuyệt đối trong transcript. Nếu chuyển file thất bại sau khi tạo đích, có thể còn một bản import chưa hoàn chỉnh; kiểm tra thủ công, không nhập vào đích đó lần nữa và không xóa dữ liệu nguồn.

```bash
python3 scripts/import-monocode-data.py --self-test
```

## P1 — OpenCode → 9router, không sửa config CLI toàn cục

POC local; chưa có Settings gateway, profile picker hoặc card LuxeCode trong dashboard 9router. Các tính năng này thuộc P2. Engine kiểm tra: OpenCode `1.18.35`; thử nghiệm dùng bản cài tạm riêng, không thêm dependency vào package ứng dụng.

Activation chỉ qua environment của **process LuxeCode**, không lấy endpoint/key từ renderer:

- `LUXECODE_GATEWAY_PROFILE`: đường dẫn JSON không chứa secret.
- `LUXECODE_9ROUTER_API_KEY`: key gateway trong environment tạm; không ghi vào JSON/profile hoặc command-line argument.
- Native inject `OPENCODE_CONFIG_CONTENT`, chỉ enable provider `luxecode`; main model và small model cùng profile.
- OpenCode nhận XDG config/data/cache/state và OpenCode home riêng trong app data `opencode-poc`; bỏ các override config/auth/DB/TUI kế thừa, không đọc config project hoặc `~/.opencode`. Không đọc/ghi config hoặc session database của CLI OpenCode bên ngoài ứng dụng. Isolation flags đã kiểm tra với OpenCode `1.18.35`; phải kiểm tra lại khi nâng engine.
- Catalog, session runtime và text-generation phụ cùng đi qua native injection. Provider khác không nhận hai environment variables của gateway.
- Native probe `POST /chat/completions` với body `{}`: không key phải trả 401/403; có key phải trả 400 `Missing model`, xác minh authentication mà không gọi model. Sau đó `GET /models` xác minh model/combo có trong catalog. Khi cấu hình lỗi, gateway mất kết nối hoặc trả redirect, báo lỗi; không tự chuyển sang direct.
- Không tạo harness mới hoặc thay đổi tool/approval/session protocol của OpenCode. Không replay tool khi stream đứt; tiếp tục qua lifecycle hiện có và nghiệm thu riêng với model thật.

### Chuẩn bị 9router

1. Dùng 9router độc lập, bind loopback trong POC; login provider ở dashboard.
2. Bật **Require API Key** và tạo key riêng cho LuxeCode. Không đổi settings của một gateway đang được các client khác dùng mà chưa kiểm tra key của chúng.
3. Chọn model hoặc combo thực có trong `/v1/models`, hỗ trợ tool calls; lấy context/output limits đã xác minh. Với combo, dùng limits an toàn cho mọi thành viên.
4. Pin phiên bản gateway đã dùng khi chạy acceptance; không coi phiên bản trong screenshot hoặc nhánh mới nhất là đã được nghiệm thu.

9router `0.5.95` local trả HTTP 200 cho `/v1/models` không có Authorization; catalog công khai không chứng minh authentication của inference endpoint. POC kiểm tra authentication qua `/v1/chat/completions` như trên, không yêu cầu catalog phải private và không tự thay đổi settings/provider/credential của gateway.

### Profile ví dụ

Tạo file ngoài repository, ví dụ `$HOME/.config/luxecode/gateway-poc.json`, và đặt quyền 0600. `YOUR_MODEL_OR_COMBO` là placeholder; các con số dưới đây cũng là ví dụ, phải thay bằng limits đã xác minh:

```json
{
  "endpoint": "http://127.0.0.1:20128/v1",
  "model": "YOUR_MODEL_OR_COMBO",
  "contextWindow": 32768,
  "maxOutputTokens": 8192
}
```

HTTP chỉ được phép trên loopback; ngoài máy yêu cầu HTTPS. Từ chối URL có userinfo/query/fragment, profile có field không hợp lệ hoặc secret inline. Profile tối đa 16 KiB. Khi đổi profile/key, quit rồi mở lại LuxeCode để tránh server đang chạy giữ cấu hình cũ.

### Mở POC trên macOS bằng zsh

```zsh
export LUXECODE_GATEWAY_PROFILE="$HOME/.config/luxecode/gateway-poc.json"
read -rs "LUXECODE_9ROUTER_API_KEY?9router API key: "
echo
export LUXECODE_9ROUTER_API_KEY
./target/release/bundle/macos/LuxeCode.app/Contents/MacOS/luxecode
unset LUXECODE_9ROUTER_API_KEY LUXECODE_GATEWAY_PROFILE
```

Trong Providers/model picker, chọn OpenCode và model `luxecode/<model-or-combo>`. Trường API key dùng environment reference của OpenCode, không serialize giá trị secret trong inline configuration. Không cần `opencode auth login` cho custom provider này.

Không bật gateway env: OpenCode giữ direct mode hiện có. POC chỉ áp dụng cho native/local child; remote host chưa kế thừa profile này. Tránh chọn remote project để kiểm thử P1. OS keychain và quản lý profile qua UI để P2, không coi environment POC là giải pháp lưu secret lâu dài.

Nếu có key nhưng thiếu profile, lỗi profile/key/catalog hoặc gateway không reachable, native trả lỗi trước khi spawn engine, không chuyển sang direct mode.

### Cấu hình local đã chuẩn bị ngày 07/10/2026

- Profile không có secret: `~/.config/luxecode/gateway-poc.json`, quyền 0600; endpoint `http://127.0.0.1:20128/v1`, combo `PER`, context/output caps 32768/8192. Catalog 9router quảng bá combo hỗ trợ tools, context 1050000 và output 128000; caps POC thấp hơn, không coi đó là nghiệm thu toàn bộ context hoặc mọi nhánh fallback trong combo.
- OpenCode `1.18.35` có bản riêng tại `~/Library/Application Support/com.luxecode.desktop/engine/bin/opencode`. Chỉ sao chép engine đã có; không cài npm toàn cục hoặc thêm dependency vào repo. CLI path riêng đã lưu trong Settings → Providers → OpenCode của LuxeCode.
- Quit LuxeCode rồi chạy `zsh scripts/launch-gateway.zsh` từ repo. Script hỏi key bằng input ẩn, preflight qua mã native thực và mở bundle local với environment riêng. Có thể truyền đường dẫn `.app` làm argument duy nhất. Không dùng nút Apply ở dashboard CLI Tools vì nút đó cấu hình CLI bên ngoài ứng dụng.
- Không chạy `opencode auth login`, không lưu key trong JSON, `.env`, shell history hoặc command-line argument. Lần khởi động khác cần nhập lại key nếu không có environment của launcher.
- Desktop đã được mở lại bằng bundle mới với profile/key trong environment; OpenCode được đặt làm provider mặc định. Settings xác nhận chỉ có 1 model `PER`; các task GUI acceptance chạy OpenCode · Luxecode · PER với **Supervised** trên project tạm, không bật Full access cho nghiệm thu.

### Acceptance trước khi đánh dấu P1 hoàn tất

Trên một project/worktree thử, kiểm tra read → edit → shell test → diff → follow-up → restart/resume; approval accept/deny; cancel; 401/429/5xx/timeout/partial stream. Xác nhận config/database CLI OpenCode bên ngoài LuxeCode không đổi, model thực hỗ trợ tool schema và gateway không ghi/log key.

Unit/protocol tests và build không thay thế task thật qua provider đã đăng nhập. Không tuyên bố model fidelity, remote parity hoặc P1 end-to-end pass chỉ từ HTTP catalog hoặc fixture.

### GUI acceptance đã đạt ngày 07/10/2026

Project riêng `/private/tmp/luxecode-gui-acceptance-20261007`; dùng bundle local, engine và gateway thật đã cấu hình. Không sửa repository người dùng, gateway settings, credentials hoặc config/session CLI OpenCode toàn cục.

- **Allow:** GUI hiện diff và chờ approval; `approval-allow.txt` giữ `before-allow` khi chưa duyệt, đổi thành `after-allow` sau Allow; kết thúc với `ALLOW_DONE`.
- **Deny:** cho phép read, từ chối edit; GUI trở về Send, expanded tool hiện lỗi `The user rejected permission to use this specific tool call.`; `approval-deny.txt` vẫn là `before-deny`.
- **Stop/cancel:** duyệt command `sleep 30; printf 'after-cancel\n' > cancel.txt`, bấm Stop sau 7.925 giây; GUI trở về Send. Kiểm tra sau 93.654 giây từ lúc duyệt: `cancel.txt` vẫn là `before-cancel`, không có completion đến muộn.
- **Partial stream/error:** khi GUI đang hiển thị `STREAM_BEGIN_2` và ít nhất 37 dòng `STREAM_PROBE`, ngắt đúng OpenCode server của project tạm. GUI hiện `OpenCode event stream ended unexpectedly.` và thoát Working; không dừng 9router hoặc phiên người dùng khác.
- **Reconnect:** gửi lượt tiếp theo trong cùng hội thoại; engine tạo child mới, giữ lịch sử và trả `GUI_RECONNECT_OK`, trở về Send. Ba sentinel và hashes config/auth/session database CLI bên ngoài vẫn đúng/không đổi.

Không cần sửa thêm core: harness hiện có xử lý các ca trên. Regression OpenCode: 64 tests / 4 files pass. Bằng chứng và timing lưu trong `desktop.gui_acceptance` tại `docs/luxecode-gateway-acceptance-2026-10-07.json`. Kết quả lỗi transport này không thay thế nghiệm thu GUI từng HTTP 401/429/5xx/timeout; các ca HTTP đó hiện chỉ có fixture/native coverage.

### Kiểm tra engine cô lập

```bash
cargo build -p luxecode --example gateway-check
node scripts/check-opencode-gateway-poc.mjs /path/to/opencode
```

Fixture dùng HTTP server loopback và key giả; không gọi provider thật. Runner gọi trực tiếp `gateway::apply` qua native example, không tự mô phỏng cấu hình production. Kiểm tra catalog đơn nhất, read → edit → shell, follow-up/restart/resume, config project/home/auth/DB kế thừa bị bỏ qua, hashes config/session CLI bên ngoài không đổi và output không chứa key. Negative cases: key trống/sai, thiếu profile, inference 401/429/503, timeout, stream chưa hoàn tất. Với 429/503/timeout/partial, runner hủy process group sau 12 giây khi retry/stream còn pending; chỉ chứng minh cancel và không có lượt hoàn tất từ provider khác, không coi đó là nghiệm thu UI hiển thị lỗi.

Nghiệm thu model thật, sau khi nhập key bằng `read -rs` và export như trên:

```bash
node scripts/check-opencode-gateway-poc.mjs /path/to/opencode --live
unset LUXECODE_9ROUTER_API_KEY LUXECODE_GATEWAY_PROFILE
```

`--live` gọi provider thật và dùng `--auto` chỉ trên fixture tạm do runner tạo. Không bật auto-approve cho ứng dụng hoặc thay đổi approval policy của người dùng. Gateway settings, provider connections và API keys không bị tạo/sửa. Báo cáo scope và các gate còn lại tại `docs/luxecode-gateway-acceptance-2026-10-07.json`.

### Kết quả kiểm tra ngày 07/10/2026

- Web: 4711 passed, 13 skipped sau cập nhật icon/logo; TypeScript check pass.
- Host: 100 passed, 5 skipped; host build pass.
- Rust: 566 passed, 1 ignored khi chạy `cargo test -p luxecode --lib -- --test-threads=1`; fmt và clippy debug/release pass với `-D warnings`.
- Năm gateway regression tests pass trong 10 lượt liên tiếp. HTTP mock đọc đầy đủ headers/body trước khi đóng socket, tránh connection reset và có timeout chờ server hoàn tất.
- Engine fixture và import self-test pass; không import dữ liệu thật hoặc gọi provider thật.
- Local build pass: `LuxeCode.app` và `LuxeCode_0.8.0_aarch64.dmg`; chưa ký/notarize, không tạo updater artifacts hoặc publish release.
- 9router local `0.5.95`: inference không key và key sai trả 401; catalog không key trả 200. Native OpenCode `1.18.35` qua combo `PER` đã pass task thật read/edit/shell, follow-up, restart/resume, catalog chỉ có `luxecode/PER`, external CLI config/session hashes không đổi. Không thay đổi gateway settings hoặc lưu key trên đĩa.

Một lượt Rust suite chạy song song lỗi test signing Git sẵn có (`fs::tests::git_commit_reports_signing_failure_with_hint`). Test riêng và toàn bộ suite chạy tuần tự pass; không sửa logic signing của upstream để che lỗi này.

## Build

```bash
npm run build
npm run host:build
cargo test -p luxecode --lib
npm test
```

Local installer chưa ký/notarize, không bật updater artifacts:

```bash
npx tauri build --ci --no-sign --bundles app,dmg \
  --config '{"bundle":{"createUpdaterArtifacts":false}}'
```

Public release dùng workflow của repository LuxeCode với signing/notarization và updater secrets riêng; không phát hành local unsigned artifact như bản đã ký. Chưa thực hiện publish hoặc import dữ liệu thật trong bước triển khai này.
