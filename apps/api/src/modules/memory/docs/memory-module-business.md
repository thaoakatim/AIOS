# Memory Module — Phiên bản nghiệp vụ cho PM/BA và Frontend

## 1. Mục tiêu

Module Memory giúp hệ thống AI ghi nhớ thông tin quan trọng về người dùng hoặc phiên làm việc để có thể sử dụng lại trong các tương tác tiếp theo. Mục tiêu của module là nâng cao trải nghiệm cá nhân hóa và giảm số lần AI phải hỏi lại cùng một thông tin.

Ví dụ:

- User nói: “Tôi thích màu tối.”
- Sau đó AI vẫn biết điều đó và không cần hỏi lại khi đề xuất thiết kế, giao diện, hoặc phong cách phản hồi.

---

## 2. Vấn đề mà module này giải quyết

Không có memory, mỗi cuộc hội thoại đều như mới:

- AI không nhớ sở thích cá nhân
- AI không biết thông tin user đã chia sẻ trước đó
- Chatbot lặp lại câu hỏi hoặc quên ngữ cảnh

Module Memory cho phép hệ thống lưu các thông tin dài hạn và tái sử dụng khi cần.

---

## 3. Các khái niệm nghiệp vụ chính

### 3.1 Memory

Memory là một “mẩu thông tin” được lưu lại để dùng cho tương lai. Một memory có thể đại diện cho:

- sở thích người dùng
- thông tin profile
- sự thật quan trọng
- quy tắc hoặc thói quen

Ví dụ memory:

```json
{
  "key": "favoriteColor",
  "value": "blue",
  "category": "preference",
  "scope": "global"
}
```

Nghĩa là:

- key: favoriteColor
- value: blue
- category: preference
- scope: global

### 3.2 Category

Phân loại memory theo mục đích:

- profile: thông tin cá nhân / hồ sơ
- preference: sở thích và lựa chọn
- fact: sự thật, dữ kiện, ngữ cảnh quan trọng

Ví dụ:

- profile: địa điểm hiện tại, ngành nghề
- preference: màu sắc yêu thích, phong cách giao diện
- fact: công ty đang làm dự án nào

### 3.3 Scope

Phạm vi memory:

- global: memory dùng chung cho mọi session
- conversation: memory chỉ áp dụng cho một phiên chat cụ thể

Ví dụ:

- global: “User thích nền tối”
- conversation: “Trong phiên này user đang làm dự án A”

---

## 4. Nghiệp vụ chính

### 4.1 Ghi nhớ thông tin mới

Khi AI hoặc user muốn lưu một thông tin mới, hệ thống sẽ tạo một memory record.

Ví dụ:

- User: “Tôi thích màu xanh dương.”
- System lưu memory:
  - key: favoriteColor
  - value: blue
  - category: preference
  - scope: global

### 4.2 Upsert theo key

Key là định danh của memory. Nếu cùng key đã tồn tại, hệ thống sẽ cập nhật thay vì tạo bản ghi mới.

Ví dụ:

- key: favoriteColor
- lần 1: blue
- lần 2: navy blue

Hệ thống sẽ giữ một memory duy nhất với value mới nhất.

### 4.3 Tìm kiếm trong memory

User hoặc dashboard có thể tìm memory theo:

- scope
- category
- từ khóa tìm kiếm
- session nguồn

Ví dụ:

- hiển thị toàn bộ memory preference
- tìm memory chứa từ “hanoi”
- lọc memory theo session này

### 4.4 Truy hồi memory liên quan

Khi AI cần đưa ra câu trả lời, nó có thể truy hỏi: “Memory nào liên quan đến câu hỏi hiện tại?”

Ví dụ:

- query: “User thích màu gì?”
- memory: favoriteColor = blue
- hệ thống trả về memory phù hợp để AI dùng trong phản hồi.

### 4.5 Inject vào context của agent

Sau khi tìm được memory liên quan, hệ thống chuyển memory đó thành user profile và đưa vào prompt hoặc context của agent.

Ví dụ:

```json
{
  "userProfile": {
    "favoriteColor": "blue",
    "location": "Hanoi"
  }
}
```

Như vậy, AI biết ngữ cảnh người dùng ngay khi xử lý câu hỏi tiếp theo.

---

## 5. API mà frontend cần biết

### 5.1 Tạo memory mới

Endpoint:

```http
POST /memory
```

Body:

```json
{
  "key": "favoriteColor",
  "value": "blue",
  "category": "preference",
  "scope": "global",
  "sourceAgentSessionId": null
}
```

### 5.2 Upsert memory theo key

Endpoint:

```http
POST /memory/upsert
```

Dùng khi không muốn xử lý việc key đã tồn tại hay chưa.

### 5.3 Lấy danh sách memory

Endpoint:

```http
GET /memory
```

Query params:

- scope
- category
- search
- sourceAgentSessionId
- limit
- offset

Ví dụ:

```http
GET /memory?scope=global&category=preference&search=blue&limit=20&offset=0
```

### 5.4 Tìm memory liên quan

Endpoint:

```http
GET /memory/relevant
```

Ví dụ:

```http
GET /memory/relevant?query=người dùng thích màu gì&limit=10
```

### 5.5 Lấy context profile cho AI

Endpoint:

```http
GET /memory/context-profile
```

Ví dụ:

```http
GET /memory/context-profile?query=người dùng ở đâu&sessionId=uuid&limit=10
```

Response bao gồm:

- userProfile
- promptSection
- memories

### 5.6 Lấy theo id hoặc key

- GET /memory/:id
- GET /memory/key/:key

### 5.7 Cập nhật và xóa

- PATCH /memory/:id
- DELETE /memory/:id

---

## 6. Example UX cho frontend

### 6.1 Memory Board / Admin dashboard

UI có thể hiển thị bảng:

| key | value | category | scope | updatedAt |
| --- | --- | --- | --- | --- |
| favoriteColor | blue | preference | global | ... |
| location | Hanoi | profile | global | ... |

### 6.2 Form tạo memory

Frontend cần form có các trường:

- key
- value
- category
- scope
- sourceAgentSessionId (nếu biết)

### 6.3 Chatbot personalization

Trong chat, AI có thể tự động sử dụng thông tin đã lưu để trả lời cá nhân hóa như:

- “Bạn thích màu xanh dương phải không?”
- “Tôi ghi nhớ bạn đang ở Hà Nội.”

---

## 7. Business rules cần lưu ý

- key là duy nhất
- category chỉ chấp nhận: profile, preference, fact
- scope chỉ chấp nhận: global, conversation
- nếu sourceAgentSessionId có giá trị thì phải là UUID hợp lệ
- limit tối đa 100
- search tìm trong cả key và value

---

## 8. Tại sao module này quan trọng cho product

Memory là thành phần nền tảng để tạo ra trải nghiệm AI cá nhân hóa, lâu dài và “nhớ người dùng”. Nếu không có memory, AI sẽ có cảm giác như mỗi lần chat đều là lần đầu.

Module này giúp:

- tăng độ phù hợp của phản hồi
- giảm lặp lại câu hỏi không cần thiết
- làm AI “biết” người dùng tốt hơn theo thời gian
- chuẩn bị nền tảng cho các tính năng nâng cao sau này như long-term personalization, memory summarization, user profile inference

---

## 9. Tóm tắt cho team frontend

Nếu team frontend cần triển khai UI hoặc tích hợp với backend, nên chú ý các điểm sau:

- dùng endpoint /memory để list / create / update / delete
- dùng /memory/relevant hoặc /memory/context-profile cho chatbot context
- hiển thị key và value rõ ràng cho user
- truyền category và scope đúng định dạng
- khi lưu memory ở mức phiên, cần gửi sourceAgentSessionId tương ứng
- khi search, dùng query param search

---

## 10. Kết luận

Memory module là phần nền tảng giúp AI có khả năng ghi nhớ, tìm lại, và sử dụng thông tin lâu dài. Nó không chỉ là CRUD đơn giản, mà là một layer quan trọng cho trải nghiệm AI cá nhân hóa và hệ thống agent thông minh.
