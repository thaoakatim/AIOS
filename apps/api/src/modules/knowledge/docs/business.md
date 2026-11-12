# Knowledge Module — Business Document

## 1. Mục tiêu nghiệp vụ

Knowledge Module giúp AIOS chuyển từ một chatbot tổng quát thành hệ thống có khả năng học từ tài liệu và trả lời dựa trên nguồn dữ liệu thực. Người dùng có thể:

- Tải tài liệu lên hệ thống.
- Trích xuất nội dung từ file.
- Tìm kiếm ngữ nghĩa trong kho tri thức.
- Đưa các đoạn văn bản liên quan vào prompt.
- Nhận câu trả lời có dẫn nguồn từ tài liệu đã được index.

## 2. Vấn đề cần giải quyết

Người dùng thường có nhiều tài liệu rời rạc, chẳng hạn:

- Tài liệu PDF, DOCX, TXT và Markdown.
- Hồ sơ dự án.
- Quy trình vận hành (SOP) và tài liệu nội bộ.
- Ghi chú cá nhân.
- Tài liệu liên quan đến từng cuộc hội thoại.

Nếu AIOS chỉ dựa vào kiến thức có sẵn của mô hình, hệ thống sẽ không biết nội dung riêng trong các tài liệu này. Câu trả lời có thể thiếu căn cứ, không cập nhật hoặc khó kiểm chứng.

Knowledge Module giải quyết vấn đề đó bằng cách truy xuất các đoạn nội dung liên quan từ tài liệu đã index, đưa chúng vào ngữ cảnh khi trả lời và hỗ trợ truy nguyên nguồn dữ liệu.

## 3. Giá trị mang lại

### 3.1 Trả lời dựa trên tài liệu

AIOS tìm các đoạn văn bản liên quan trong kho tri thức và sử dụng chúng làm ngữ cảnh để tạo câu trả lời.

### 3.2 Truy nguyên nguồn

Câu trả lời có thể gắn với các đoạn hoặc tài liệu đã được sử dụng, giúp người dùng kiểm tra căn cứ.

### 3.3 Hỗ trợ cá nhân hóa

AIOS có thể khai thác tài liệu và ngữ cảnh phù hợp với từng người dùng hoặc cuộc hội thoại, thay vì chỉ đưa ra câu trả lời chung chung.

## 4. Người dùng và lợi ích

### Người dùng cuối

- Tải tài liệu lên và đặt câu hỏi về nội dung.
- Liên kết tài liệu với một message cụ thể.
- Truy xuất ngữ cảnh phù hợp cho cuộc trò chuyện.

### Quản trị viên và vận hành

- Theo dõi trạng thái xử lý tài liệu.
- Kiểm tra tài liệu đã được index thành công hay chưa.
- Thử xử lý lại khi tài liệu gặp lỗi.

### Nhà phát triển

- Kiểm tra chất lượng retrieval.
- Kiểm tra chunks và vector store.
- Theo dõi hiệu năng của pipeline.

## 5. Luồng nghiệp vụ chính

### 5.1 Tải tài liệu lên

Người dùng gửi file qua API. Hệ thống xác thực định dạng, lưu file gốc và tạo bản ghi tài liệu trong PostgreSQL.

### 5.2 Xây dựng kho tri thức

Hệ thống trích xuất văn bản từ file, chia nội dung thành các chunk, tạo embedding và lưu dữ liệu cần thiết vào vector store. Sau khi hoàn tất, nội dung có thể được tìm kiếm theo ngữ nghĩa.

### 5.3 Tìm kiếm và truy xuất

Khi người dùng đặt câu hỏi, hệ thống tìm các chunk phù hợp nhất trong kho tri thức. Các chunk này được đưa vào context của prompt để hỗ trợ tạo câu trả lời.

### 5.4 Liên kết tài liệu với message

Tài liệu có thể được liên kết với một message cụ thể để hỗ trợ truy nguyên nguồn và cung cấp ngữ cảnh phù hợp cho câu trả lời.

## 6. KPI thành công

- Tỷ lệ tải tài liệu lên thành công cao.
- Thời gian xử lý tài liệu nằm trong ngưỡng chấp nhận được.
- Các chunk được truy xuất có mức độ liên quan cao với câu hỏi.
- Có thể xác định nguồn tài liệu đã được dùng để tạo câu trả lời.
- Có thể theo dõi và xử lý lại tài liệu gặp lỗi.