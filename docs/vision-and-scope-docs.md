# AIOS - Vision & Requirement Analysis

> **Sprint -1 — Day 1**
> **Vai trò:** Solution Architect

---

# 1. Project Vision

## 1.1 Bối cảnh

Hiện nay, một Software Engineer hoặc AI Engineer phải sử dụng rất nhiều công cụ khác nhau trong công việc hằng ngày.

Ví dụ:

* ChatGPT
* Claude
* GitHub
* Gmail
* Google Calendar
* Google Drive
* Notion
* VSCode
* Jira
* Slack
* Browser
* PDF Reader

Mỗi công cụ chỉ giải quyết **một phần** của quy trình làm việc.

Ví dụ:

```text
ChatGPT
    ↓
Không biết GitHub

GitHub
    ↓
Không biết Calendar

Calendar
    ↓
Không biết Deadline

Notion
    ↓
Không biết Source Code
```

Người dùng phải tự tổng hợp thông tin từ nhiều nơi trước khi đưa ra quyết định.

---

## 1.2 Ý tưởng

AIOS (AI Operating System) sẽ đóng vai trò là một **Personal AI Operating System**.

AIOS không thay thế các công cụ hiện có.

AIOS đóng vai trò là trung tâm điều phối giữa:

* LLM
* Calendar
* GitHub
* Knowledge Base
* Email
* Local Files
* Todo
* Workflow

Ví dụ:

**User**

> Hôm nay mình nên làm gì?

AIOS sẽ tự động:

* Kiểm tra Calendar
* Đọc GitHub Issues
* Kiểm tra Deadline
* Kiểm tra Todo
* Đọc lịch sử làm việc

Sau đó trả lời:

```text
Bạn còn:

- 2 GitHub Issues chưa xử lý
- Demo vào ngày mai
- Deadline SWP còn 2 ngày
- Tối nay nên hoàn thành bài học MCP
```

---

# 2. Problem Statement

Thông tin của người dùng hiện đang bị phân tán ở rất nhiều hệ thống.

Ví dụ:

* GitHub
* Calendar
* Email
* Notion
* PDF
* Chat History

Muốn biết:

> Hôm nay mình nên làm gì?

Người dùng phải tự mở từng ứng dụng để tổng hợp thông tin.

AIOS hướng tới việc gom toàn bộ thông tin này thành **một giao diện AI duy nhất**.

---

# 3. Business Goal

Mục tiêu của dự án không phải là thương mại hóa.

Mục tiêu là xây dựng một AI Agent có khả năng:

* Hiểu người dùng
* Quản lý tri thức
* Lập kế hoạch
* Tự động hóa công việc
* Điều phối nhiều công cụ

Đồng thời, dự án đóng vai trò là nền tảng học tập cho các chủ đề:

* AI Agent
* AI Engineering
* Backend Architecture
* Clean Architecture
* System Design

---

# 4. Target User

## Giai đoạn 1

Đối tượng sử dụng:

**Chỉ một người dùng duy nhất.**

Chính là người phát triển hệ thống.

Không xây dựng:

* SaaS
* Multi-Tenant
* Multi-User

Điều này giúp giảm đáng kể độ phức tạp trong giai đoạn đầu.

---

# 5. Product Vision

AIOS không phải:

* Chatbot
* Search Engine
* Voice Assistant

AIOS hướng tới vai trò:

> **Personal Chief of Staff**

Ví dụ:

Người dùng hỏi:

> Tôi nên làm gì tiếp?

AIOS có thể tự đánh giá:

* Deadline
* Lịch làm việc
* Tiến độ Project
* Kiến thức đang học
* Các Issue đang mở
* Mục tiêu dài hạn

Sau đó đưa ra đề xuất phù hợp.

---

# 6. Core Capabilities

## Capability 1 — Conversation

Cho phép người dùng:

* Chat
* Streaming Response
* Conversation History

---

## Capability 2 — Knowledge

Cho phép:

* Upload PDF
* Upload Markdown
* Upload DOCX
* Hỏi đáp trên tài liệu

---

## Capability 3 — Memory

AI ghi nhớ:

* Hồ sơ người dùng
* Sở thích
* Dự án
* Thói quen
* Thông tin quan trọng

---

## Capability 4 — Planning

AI có thể:

* Lập kế hoạch
* Chia nhỏ công việc
* Xây dựng roadmap
* Quản lý task

---

## Capability 5 — Execution

AI có thể thực hiện hành động thông qua Tool.

Ví dụ:

* Search
* Calculator
* Filesystem
* GitHub
* Email
* Weather

---

## Capability 6 — Reflection

AI tự đánh giá kết quả.

Ví dụ:

* Review Code
* Review Essay
* Review Plan
* Improve Output

---

## Capability 7 — Workflow

AI có thể thực hiện nhiều bước liên tiếp.

Ví dụ:

```text
Research
    ↓
Summarize
    ↓
Generate Quiz
    ↓
Publish
```

---

## Capability 8 — Multi-Agent

Hệ thống hỗ trợ nhiều Agent chuyên biệt.

Ví dụ:

* Research Agent
* Coding Agent
* Learning Agent
* Review Agent

---

# 7. Functional Requirements

## Chat Module

* Chat với AI
* Streaming Response
* Conversation History

---

## Knowledge Module

* Upload File
* Delete File
* Search File
* Ask Document

---

## Memory Module

* Save Memory
* Update Memory
* Delete Memory

---

## Planner Module

* Create Plan
* Update Plan
* Complete Plan

---

## Tool Module

* Weather Tool
* Search Tool
* Calculator Tool
* Filesystem Tool

---

## Workflow Module

* Execute Workflow
* Resume Workflow
* Cancel Workflow

---

## Agent Module

* Create Agent
* Execute Agent
* Route Agent

---

# 8. Non-Functional Requirements

## Performance

* Chat phản hồi dưới 3 giây (không tính thời gian xử lý của LLM)
* Tool nội bộ phản hồi dưới 500ms

---

## Scalability

* Thiết kế module độc lập
* Có thể tách service trong tương lai

---

## Maintainability

* Module có ranh giới rõ ràng
* Hạn chế phụ thuộc chéo

---

## Observability

Hệ thống cần ghi nhận:

* Prompt
* Tool Calling
* Planning
* Reflection
* Latency
* Token Usage

---

## Security

* Không hard-code API Key
* Có cơ chế phân quyền Tool trong tương lai
* Bảo vệ dữ liệu người dùng

---

# 9. Project Constraints

Trong giai đoạn đầu, **không triển khai**:

* Authentication
* Authorization
* Payment
* SaaS
* Multi-Tenant
* Microservices
* Kubernetes
* Mobile Application

Mục tiêu duy nhất là:

> Tập trung vào AI Engineering và AI Agent Architecture.

---

# 10. Success Criteria

Sau khi hoàn thành toàn bộ dự án, AIOS cần đạt được các tiêu chí sau:

* ✅ Chat với LLM
* ✅ Upload tài liệu
* ✅ RAG
* ✅ Memory
* ✅ Planner
* ✅ Workflow Engine
* ✅ Tool Calling
* ✅ MCP Integration
* ✅ Multi-Agent
* ✅ Production-ready Architecture

---

# 11. Architecture Questions

Đây là các câu hỏi bắt buộc phải trả lời trước khi bắt đầu coding.

## Domain

* AIOS giải quyết bài toán gì?
* Điều gì nằm ngoài phạm vi của AIOS?
* Các Domain chính là gì?

---

## Architecture

* Monolith hay Microservice?
* Vì sao lựa chọn kiến trúc đó?
* Module nào có thể tách thành Service trong tương lai?

---

## AI

* Khi nào sử dụng LLM?
* Khi nào gọi Tool?
* Khi nào sử dụng RAG?
* Khi nào lưu Memory?
* Khi nào kích hoạt Reflection?

---

## Data

* Dữ liệu nào lưu PostgreSQL?
* Dữ liệu nào lưu Redis?
* Dữ liệu nào lưu Vector Database?
* Dữ liệu nào chỉ tồn tại trong Runtime?

---

# Deliverables

Kết thúc Sprint -1 Day 1, dự án cần hoàn thành:

* Project Vision
* Problem Statement
* Business Goal
* Target User
* Core Capabilities
* Functional Requirements
* Non-Functional Requirements
* Project Constraints
* Success Criteria
* Architecture Questions

> **Lưu ý:** Kết thúc Day 1 **không viết bất kỳ dòng code nào**. Toàn bộ thời gian được dành để phân tích yêu cầu và xác định phạm vi dự án.
