# 汇报成稿 BriefDeck

BriefDeck 是面向项目负责人和团队成员的 Anna App：将项目笔记、文档和截图整理为中文汇报 PPT，在画布上修改，再下载可继续编辑的 PowerPoint 文件。

**交付基线：开发测试版 0.1.17（ID701，工作草稿 rev19）**。既有应用为 `@keyzhang/briefdeck`，应用 ID 为 `280`，目标环境为 Anna staging。用户已确认该版本通过真实 **T05 多文件生成测试**；这代表一个真实场景通过，不代表所有模型、资料或生产环境全面验证。本轮先完成 GitHub 交付，尚未将 0.1.17 正式发布。npm 的私有开发包版本与 Anna 发布版本分别管理。

## 核心功能与使用流程

1. 粘贴笔记，或添加 DOCX、UTF-8 TXT、带文字层的 PDF、PNG/JPEG 截图；可混合使用。选择 4–12 页（默认6页）、汇报对象、科技/简约风、自选主色和制作要求。
2. 点击「使用 Anna 生成」。模型返回 JSON 内容及可选设计参数，应用校验后呈现。也可以「载入示例」，免费体验编辑、布局和导出。
3. 切换页签，点击画布上的标题或要点编辑；Enter 保存，Esc 取消。每页可添加多张图片，拖动、等比缩放或删除。
4. 使用 **P2 更换布局**选择当前内容支持的排版，不调用 Anna；支持撤销与恢复原布局。**P2.5 AI重新设计本页**只调整当前页设计，保留正文和图片，先展示候选，确认后才应用。
5. 在「我的 PPT」保存、切换、新建或删除文稿，再下载 `.pptx`。文字、形状和图片保持原生对象；Anna 中保存到本人账号，本地预览保存到当前浏览器。

## 技术架构与选型

```text
笔记 / DOCX / TXT / PDF / 截图
  → Anna Runtime：整稿内容 JSON / 单页设计 JSON
  → 内容、来源、指标关系与设计校验
  → 共享布局数据（文本、形状、图片、几何、字号）
  → 浏览器预览 + PptxGenJS 原生可编辑 PPTX
```

前端采用原生 JavaScript ES Modules、HTML/CSS，不引入大型编辑器。PDF.js 在浏览器提取文字层，JSZip 读取 DOCX XML，PptxGenJS 导出 PPTX。依赖版本通过 `package-lock.json` 固定，导出及 PDF 资源随静态包部署。测试使用 Node.js Test Runner 和 Playwright。

AI 决定内容重点和有限的设计参数，不返回可执行 HTML/CSS/JavaScript。前端对结构化指标的数值、单位、原文来源和编辑后有效性进行校验；不兼容设计安全回退。浏览器和导出共用布局，避免维护两套排版。

| 主要文件 | 职责 |
| --- | --- |
| `bundle/deck.js`、`generation-operation.js` | 整稿 Prompt、结构校验、动态预算、受控截断重试 |
| `bundle/layout.js`、`density.js`、`slide-design.js` | 内容密度适配、共享几何、设计安全校验、P2候选 |
| `bundle/metric.js`、`relationships.js` | 可追溯指标、角色职责及明确流程关系 |
| `bundle/redesign.js`、`redesign-operation.js` | P2.5单页候选、最多4次受控纠错、累计用量 |
| `bundle/app.js`、`library.js` | 编辑与请求状态、取消、候选确认、历史保存恢复 |
| `bundle/export.js`、`sources.js`、`pdf-source.js` | 原生PPTX导出、文件解析 |

## 本地运行

要求 Node.js 22.13+ 或24+、npm。以下命令在仓库根目录执行：

```sh
npm ci
npm test
npm run build
python -m http.server 8080 --bind 127.0.0.1 --directory release/bundle
```

打开 [http://127.0.0.1:8080](http://127.0.0.1:8080)。也可使用其他静态服务器，但不要直接双击 HTML。本地可载入示例、编辑、保存和下载；真实 AI 能力需要从 Anna 宿主打开，浏览器本地页不会直接调用模型。

`release/`、`node_modules/`、`.anna/`、环境变量和凭据文件不入库。`npm run build` 可重建静态部署包 `release/bundle/`；Anna CLI 工具需另行安装并登录，不随仓库分发。

## Anna 运行与部署

既有应用：`@keyzhang/briefdeck`，ID280；部署目标：`https://staging.anna.partners`。请在 [开发者控制台](https://staging.anna.partners/developer)核对应用和版本，安装 **0.1.17 开发测试版**后打开。普通下载入口要求已发布的公开版本，不能用该入口判断开发测试版是否上传成功。

使用已安装的 Anna CLI（本项目验证版本0.1.64）：

```sh
anna-app login --host https://staging.anna.partners
anna-app validate --bundle release/bundle --strict
anna-app apps push --bundle-dir release/bundle --account https://staging.anna.partners
```

首次在新机器绑定仓库时，应按官方流程关联既有应用，核对 slug 和 ID280，避免误创建新应用。`apps push` 更新工作草稿；`apps cut <新版本号>` 创建不可变开发测试版，已存在的0.1.17无需重复切版。提交审核及正式发布是后续独立步骤，须核对平台审批与目标版本，不把上传或测试安装写成正式上线。操作细节见[交付记录](docs/DELIVERY.md#anna-上传与发布操作)和 [Anna 官方文档](https://staging.anna.partners/developers)。

## 积分与可靠性边界

- Anna 随机分配模型，BriefDeck不指定或切换模型；`thinking:false` 不保证推理关闭。
- 整稿按页数动态预留输出预算，仅明确 `maxTokens` 截断时最多加预算重试一次；明确受模型/通道硬上限限制时停止。其他错误不自动重试。
- 单页AI重新设计一次授权最多4次尝试，首个有效候选即停止。每次请求都可能计费，生成前会提示。取消后不发新请求，已发请求仍可能计费，迟到响应不能覆盖原稿。
- 用量按原始回执精确累计，用户界面只显示本次累计**积分，两位小数**。内部保留完整用量及诊断；未知用量显示待确认。示例、手动编辑、P2切换及导出不调用模型。

## 已知限制

- 输入总文字上限6000字符，单个文件上限5MB，每种输入类型最多2个（PNG/JPEG合计作为图片类）；画布插图与输入资料分别管理。PDF最多50页，仅提取文字层，不做本地OCR。
- 结构化指标支持有限的单值、前后/目标比较、完成量与总量关系。缺少可靠来源、单位不一致或空间不足时保留原文，不强行绘图；编辑相关原文后停用过期指标。
- 正文不会为迁就布局只保留前三条。过密内容无法安全呈现时会报错并保护原稿，不静默删减，也不自动拆页改变指定页数。
- P2只展示兼容选项，不保证每页都有多个方案。P2.5暂不支持封面，受现有组件和网格约束，仍可能在限定尝试次数内失败。
- 不提供通用PowerPoint编辑器、AI生图或扫描PDF OCR。随机模型的事实忠实度、可选设计字段采用率和视觉质量仍须人工核对；T05通过不能代替全场景验证。
- PPTX为原生可编辑对象，但浏览器、字体环境及不同Office软件可能产生细微排版差异。历史原生PowerPoint复核有证据，本次收尾未重复全部人工Office场景。

## 测试

```sh
npm test
npm run test:browser
```

单元测试覆盖协议、来源和数值安全、完整性、密度回退、历史兼容、P2/P2.5、截断重试、取消及精确积分累计。浏览器测试通过路由拦截使用mock Anna，不调用真实付费模型，覆盖编辑、保存恢复、候选确认、布局、下载及PPTX内部原生对象检查。

Windows默认使用已安装Chrome；其他环境可用 `BRIEFDECK_CHROMIUM` 指定浏览器，或运行 `npx playwright-core install chromium` 安装。可选PowerPoint原生复核脚本依赖Windows Office及对应测试生成物，运行条件和历史结果见验收记录，不是 `npm test` 的必需依赖。

## 规格、验收与交付记录

| 文档 | 内容 |
| --- | --- |
| [功能规格](SPEC.md) | 输入、生成、编辑、存储、导出及各阶段验收契约 |
| [产品与技术决策](docs/PRODUCT-DECISIONS.md) | 用户、范围、选型与取舍；早期决策保留为历史 |
| [测试验收](docs/TEST-CASES.md) | 正反例、真实与mock区别、失败及复测截图和运行证据 |
| [交付记录](docs/DELIVERY.md) | 当前版本、测试结果、发布状态、操作流程与额度记录 |

开发采用“规约与验收用例对齐 → 增量实现 → mock回归 → 有限真实验证”的协作方式。功能已冻结；最新状态以文档顶部为准，历史失败和旧版本记录保留，不将开发测试通过表述为全面生产验证。
