# Knowledge Module — Business Document

## 1. Mục tiêu nghiệp vụ

Knowledge Module giúp AIOS biến từ một chatbot tổng quát thành một hệ thống có khả năng “học từ tài liệu” và “trả lời dựa trên nguồn dữ liệu thực”. Nói cách khác, AIOS có thể:

- upload tài liệu từ người dùng,
- trích xuất nội dung từ file,
- tìm kiếm ngữ nghĩa trong kho tri thức,
- đưa những đoạn văn bản liên quan vào prompt,
- trả lời dựa trên bằng chứng rõ ràng từ tài liệu đã index.

## 2. Vấn đề cần giải quyết

Người dùng thường có rất nhiều tài liệu rời rạc:

- tài liệu PDF, DOCX, TXT, Markdown,
- hồ sơ dự án,
- SOP, tài liệu nội bộ,
- ghi chú cá nhân,
- tài liệu liên quan đến cuộc hội thoại.

Nếu AIOS chỉ dựa vào hNếu AIOS chỉ dựa vào hNếu AIOS chỉ dựa vào hNếu AIOS chỉ dựa vào hNếu AIOS chỉ dựa vào hNếu AIOS chỉ dỳng vai trò “bộ nhớ kiến thức” Nếu AIOS chỉ dựa vm khảo Nếu AIOS chỉ dựa vào hNếu AIOS chỉ dựa vào hNếu AIOS chỉ dựa vào hNếu AIOS chỉ dựa vào hNếu AIOS chỉ dựa vào hNếu AIOS chỉ dỳng vai trò “bộ nhớ kiến thức” Nếu AIOS chỉ dựa s�Nếu AIOS chỉ dựa vào hNếu AIOS  vNếu AIOS chỉ dựa vào hNếu Aậy
Câu trả lời được tạo ra dựa trên chunks đã index và có khả năng truy nguyên nguồn gốc dữ liệu.

### 3.3 Cá nhân hóa AIOS
AIOS không chỉ biết cách tAIOS không chỉ biết cách tAIOS màAIOS không chỉ biết cách tAIOS không chỉ biết cách tA dùAIOS không chỉ biết cách tAIOS k�AIOS không chỉ bc
AIOS không chỉ biết các�AIOS không chỉ bnneAIOS không chỉ biết các�AIOS không chỉ bnnhức cho các quy trình có tính quyết định cao.

## 4. Người dùng và lợi ích

### Người dùng cuối
- upload tài liệu,
- hỏi câu hỏi trên tài liệu,
- liên kết tài liệu với message cụ thể,
- truy xuất ngữ cảnh cho các cuộc trò chuyện.

### Quản trị viên / vận hành
- theo dõi trạng thái xử lý tài liệu,
- kiểm tra file nào đã index thành công,
- retry khi gặp lỗi hoặc document bị fail.

### Nhà phát triển
- debug retrieval quality,
- kiểm tra chunk và vector store,
- đo lường performance của pipeline.

## 5. Luồng nghiệp vụ chính

### 5.1 Upload tài liệu
Người dùng gửi file qua API. Hệ thống xác thực định dạng, lưu file gốc và tạo bản ghi document trong PostgreSQL.

### 5.2 Tạo kho tri thức
File được trích xuất text, chia thành chunk, tạo embedding và lưu vào vector store. Từ đó, dữ liệu có thể được truy vấn giống như ngân hàng tri thức.

### 5.3 Search và truy xuất
Khi người dùng hỏKhi người dùng hỏhóa câu hỏi, tìm top K chunks phù hợp và trả về kKhi người dùng h� dùng làm context cho prompt.

### 5.4 Gắn tài liệu với message
Document có thể gắn với từng message để phục vụ truy nguyên, kiểm chứng và contextual grounding khi trả lời.

## 6. KPI thành công

- tỷ lệ upload thành công cao,
- thời gian xử lý document chấp nhận được,
- retrieval trả về chunk liên qu- retrieval trả về chunk liêa tr- retrieval trả về chunk liên qu- re ti- retrieval trả về chunk l tiế- retrieval trả về chg - retrieval trả về chunk liên qu- retrieval trả về chunk liêa tr- retrieval trả về chunk liên qu- re ti- retrieval trảđọ- retrieval trả về chum m- retrieval trả về chunk liên qu- retrieval trả về chunk liêa tr- retrieval trả về chunk liên qu- re ti- retrieval trả về chunk l tiế- retrieval trả về chg - reModule là “hệ thống trí nh- retrieval trả về chunk liên qu- retrieval trả về chunk liêa tr- retrieval trả về chunk liên qu- re ti- retrieval trả về chunk l tiế- rethiệp vụ thật. Đây là yếu tố quan trọng giúp AIOS hoạt động như một trợ lý chủ chốt trong môi trường công việc và doanh nghiệp.
