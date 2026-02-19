# Paper Labeler

一个用于试卷题目框选、模块标注、答案标注与 PDF 导出的本地工具。  
后端基于 `FastAPI + SQLite`，前端为原生 Vue 运行时组件。

## 功能概览

- 试卷管理
  - 上传 PDF，自动切页为图片
  - 区分题卷（QP）/答案卷（MS）
  - 试卷列表、完成状态、快速切换
- 题目标注（Mark）
  - 手动框选题目区域（支持多框）
  - OCR 自动识别初稿（可手动补框）
  - 模块/分类标注（支持大类 + 小类）
  - 撤销/重做（`Ctrl+Z` / `Ctrl+Y`）
- 题库管理（Filter）
  - 按模块/试卷/年份/季度/收藏筛选
  - 题号跳转、分页、多选批量操作
  - 筛选预设（保存/应用/删除）
  - 列表虚拟化与骨架屏
- 答案标注（Answer）
  - 绑定题目，标注答案框
  - 题间快捷切换（`K/J`）
  - 撤销/重做
- 导出 PDF
  - 常规导出 + 随机导出
  - 头部信息可选、答案放置方式可选
  - 导出任务队列 + 进度显示 + 取消队列任务
  - 文件名推荐模板、默认导出目录、筛选信息页可选字段
  - 导出缓存（加速重复导出）
- 数据维护
  - 完整性检查、修复工具（设置页）

## 目录结构

```text
backend/
  main.py                 # FastAPI 入口
  database.py             # SQLite 模型与初始化
  routers/                # 业务路由（papers/questions/export/...）
frontend/
  index.html              # 全局样式与挂载点
  main.js                 # createApp + mount
  app/
    store.js              # 全局状态
    components/           # 视图组件
    use/                  # 逻辑 composables
  modules/
    api.js                # fetch 封装
    settings.js           # 本地设置持久化
data/
  app.db                  # SQLite 数据库
  pdfs/                   # 上传 PDF
  pages/                  # 切页图片
  _export_jobs/           # 导出任务产物
scripts/
  build_windows_exe.ps1   # Windows 打包脚本
```

## 环境要求

- Python `3.10+`（建议 3.12）
- Windows（当前脚本与打包流程以 Windows 为主）
- 浏览器（本地访问 `http://127.0.0.1:8000/ui/`）

## 安装与启动（开发运行）

1. 创建并激活虚拟环境

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

2. 安装依赖（项目未提供 `requirements.txt`，手动安装）

```powershell
pip install fastapi uvicorn sqlalchemy pydantic pillow fpdf2
```

3. 启动后端（会自动初始化数据库）

```powershell
python backend/main.py
```

4. 打开前端

```text
http://127.0.0.1:8000/ui/
```

## 打包 EXE（Windows）

```powershell
.\scripts\build_windows_exe.ps1 -StopRunning
```

常用参数：

- `-Clean`：清理旧 build/dist
- `-OutDir dist_exe`：指定输出目录

生成后运行：

```text
dist_exe\paper_labeler.exe
```

## 快速使用流程

1. 左侧上传题卷 PDF（可批量）
2. 在“题目标注”中框选题目并保存
3. 如需答案，进入“答案标注”标注 MS 框
4. 在“题库管理”中筛选、检查、批量修订
5. 点击“导出 PDF”，配置导出项并生成

## 常用快捷键

- 题目标注页：`J/K` 下一页/上一页
- 答案标注页：`J/K` 下一题/上一题
- 标注编辑：`Ctrl+Z` 撤销，`Ctrl+Y` 重做

## 导出说明

- 支持两类导出：
  - 常规导出（按当前筛选）
  - 随机导出（按分类题量配置）
- 导出面板会记住上次“非随机导出”设置。
- 支持“首页筛选信息页”：
  - 可勾选是否包含
  - 可逐项勾选显示内容（默认全选）
- 导出目录：
  - 可在设置中配置默认目录（直接保存，不走浏览器下载）
- 导出任务：
  - 进入队列后可看到状态、进度与排队信息
  - 可取消“排队中”任务

## 筛选与题号定位说明

- “题号跳转”默认使用数据库题号（`questions.question_no`）。
- 当**只选择了 1 张试卷**且输入数字时，会优先按“该试卷内第 N 题”定位。

## 缓存机制说明

- 导出缓存：用于复用筛选结果 ID，减少重复统计耗时。
- 设置页可查看缓存信息并手动清除缓存。
- 重启后端不影响前端本地缓存（localStorage 仍在）。

## 数据文件与备份建议

关键数据都在 `data/`：

- `data/app.db`：数据库
- `data/pdfs/`：原 PDF
- `data/pages/`：切页图片

建议定期备份整个 `data/` 目录。

## 开发注意事项

- 数据库为 SQLite，默认路径固定在 `data/app.db`。
- 静态资源路径：
  - 前端：`/ui`
  - 数据文件：`/data`

## API 入口（简要）

- 健康检查：`GET /health`
- 试卷管理：`/papers...`
- 题目管理：`/questions...`
- 分类管理：`/section_defs`, `/section_groups`
- 导出：`/export/questions_pdf_job`, `/export/download/{job_id}`
- CIE 导入：`/cie_import/...`
