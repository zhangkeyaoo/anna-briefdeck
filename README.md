# 汇报成稿 BriefDeck

BriefDeck 是一个 Anna App。用项目笔记、Word、TXT 或截图生成 4–12 页中文进展汇报，再逐页编辑并下载 PowerPoint。生成使用 Anna 的模型，样例、预览、编辑和导出均在浏览器中运行。

## 开发里程碑

当前基线对应 Anna staging 测试版 `0.1.2`，应用完整 slug 为 `@keyzhang/briefdeck`。

- 已实现混合资料输入、4–12 页设置、一次调用生成、页下文字编辑及可编辑 PPTX 导出。
- 本地单元、浏览器与 PowerPoint 桌面验收已通过。首次 staging 生成出现截断并消耗 14 CU，修复版的真实复测待完成。
- 下一轮聚焦首次生成的多版式成稿，以及直接在幻灯片画布上编辑文字。公开上架仍待验收与审核。

验收证据、失败记录和额度见[测试用例](docs/TEST-CASES.md)与[交付记录](docs/DELIVERY.md)。

## 试用

1. 在 Anna 中打开「汇报成稿 BriefDeck」。
2. 选页数，粘贴笔记或添加资料，点击「使用 Anna 生成」。也可以先点击「载入示例」，直接体验编辑和导出。
3. 点击页签查看页面，修改标题和要点，然后下载 `.pptx`。

[验收输入及预期](docs/ACCEPTANCE-INPUT.md)提供了一份可复制的项目笔记。

## 本地运行

要求 Node.js 22+ 和 npm。

```sh
npm ci
npm test
npm run build
```

构建输出位于 `release/bundle/`。用任意本地静态服务器打开这个目录，即可体验样例编辑和下载。例如，安装 Python 后可以运行：

```sh
python -m http.server 8080 --bind 127.0.0.1 --directory release/bundle
```

然后打开 [本地预览](http://127.0.0.1:8080)。真实生成需要从 Anna staging 中打开 App。

## 回归测试

`npm test` 运行单元测试，`npm run test:browser` 构建后在 Chromium 中运行端到端回归，模型由本地测试模拟。Windows 默认使用已安装的 Chrome。其他环境可通过 `BRIEFDECK_CHROMIUM` 指定 Chromium 可执行文件，或运行 `npx playwright-core install chromium` 安装测试浏览器。

用例按规格编号记录，失败和复测截图可直接在[验收用例](docs/TEST-CASES.md)中查看。

## 实现

- `bundle/deck.js` 定义可变页数的数据结构、生成请求、示例和输出校验。
- `bundle/app.js` 连接 Anna Runtime 并处理编辑、生成状态和错误恢复。
- `bundle/layout.js` 为浏览器预览和 PowerPoint 提供同一份几何及字体配置。
- `bundle/export.js` 用 PptxGenJS 生成原生文本与形状。依赖随 UI 包上传。

## Anna staging 交付

使用 Anna CLI 0.1.64。完成开发者激活后，运行：

```sh
anna-app login --host https://staging.anna.partners
anna-app validate --bundle release/bundle --strict
anna-app apps push --bundle-dir release/bundle --account https://staging.anna.partners
```

用 `anna-app apps cut <版本号> --account https://staging.anna.partners` 创建测试版本。打开 [staging 开发者控制台](https://staging.anna.partners/developer)，在「我的应用」找到 BriefDeck。在「版本」确认当前候选版本 `0.1.2`，再从开发者页安装，到「已安装应用」打开。商店的普通下载入口要求已有公开版本，草稿阶段报 `App has no published version available` 时，返回开发者页选择测试安装。

在 staging 跑通真实生成、编辑和导出，记录额度后提交审核。审核通过后，在控制台发布版本或执行 `anna-app apps release <版本号> --account https://staging.anna.partners`。 [Anna 官方安装教程](https://forum.anna.partners/t/build-on-anna-101/228) · [Anna 官方发布文档](https://github.com/Anna-Partners/anna-developer-docs/blob/main/docs/apps/app-publish.md)

[产品规格](SPEC.md) · [产品与技术决策](docs/PRODUCT-DECISIONS.md) · [验证、额度与发布记录](docs/DELIVERY.md)
