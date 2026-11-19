# 汇报成稿 BriefDeck

BriefDeck 是一个 Anna App。粘贴项目笔记即可生成六页中文进展汇报，再逐页编辑并下载 PowerPoint。生成使用 Anna 的模型，样例、预览、编辑和导出均在浏览器中运行。

## 试用

1. 在 Anna 中打开「汇报成稿 BriefDeck」。
2. 填写汇报对象与项目笔记，点击「使用 Anna 生成」。也可以先点击「载入示例」，直接体验编辑和导出。
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

## 实现

- `bundle/deck.js` 定义六页数据结构、生成请求、示例和输出校验。
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

在控制台或用 `anna-app apps cut 0.1.0 --account https://staging.anna.partners` 创建版本。在 staging 打开开发版本跑通真实生成、编辑和导出，记录额度后提交审核。审核通过后，在控制台发布版本或执行 `anna-app apps release 0.1.0 --account https://staging.anna.partners`。

[Anna 官方发布文档](https://github.com/Anna-Partners/anna-developer-docs/blob/main/docs/apps/app-publish.md)

[产品规格](SPEC.md) · [验证、额度与发布记录](docs/DELIVERY.md)
